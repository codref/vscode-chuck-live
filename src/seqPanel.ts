import * as vscode from 'vscode';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { ShredOps } from './shredOps';
import { writeBridgeFile, LIVE_TRANSPORT } from './bridgeGen';
import { collectModTargetsForBridge } from './modModel';
import {
  writeTransportFile,
  TransportTrack,
  TransportSpec,
} from './transportGen';
import {
  exportCkPattern,
  parseCkPattern,
  PatternSnapshot,
} from './patternCk';
import {
  collectAnnotations,
  collectSeqTargets,
} from './knobsPanel';
import { seedBundledPatterns } from './projectInit';

const PATTERN_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export interface SeqTransportDump {
  masterBpm?: number;
  syncClocks?: boolean;
  swingEnabled?: boolean;
  sharedPlayhead?: number;
  running?: boolean;
  trackOrder?: string[];
  patterns?: Record<
    string,
    {
      kind?: string;
      mode?: string;
      swing?: number;
      muted?: boolean;
      solo?: boolean;
      running?: boolean;
      gate?: string;
      values?: number[];
      gates?: number[];
      probs?: number[];
    }
  >;
}

/**
 * Cascade sequencer: float lanes + gate-only Event tracks.
 * Sync-on: ChucK transport owns the clock; UI dumps patterns + mirrors playhead.
 * Sync-off: host JS clock still fires OSC per track (independent BPMs).
 */
export class SeqPanel {
  private panel: vscode.WebviewPanel | undefined;
  private transportDumpTimer: ReturnType<typeof setTimeout> | undefined;
  private transportApplyChain: Promise<void> = Promise.resolve();
  private pendingTransportDump: SeqTransportDump | undefined;
  private lastPlayheadStep = -1;
  private lastTransportRunning = false;
  private lastTransportDump?: SeqTransportDump;
  private lastAppliedTransportSource = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly osc: OscClient,
    private readonly shredOps: ShredOps,
    private readonly onBridgeNeeded: (
      bridgePath: string,
      source?: string
    ) => Promise<boolean | void>,
    private readonly onTransportNeeded: (
      transportPath: string,
      source?: string,
      force?: boolean
    ) => Promise<boolean | void>,
    private readonly onLiveBpmFromSeq?: (bpm: number) => void
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      void this.prepareBridgeAndSync();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'chuckLive.sequencer',
      'ChucK Sequencer',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      }
    );

    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => {
      void this.onMessage(msg);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    void this.prepareBridgeAndSync();
  }

  get isOpen(): boolean {
    return !!this.panel;
  }

  /** True when ChucK transport was last started for a running sequencer pattern. */
  hasRunningTracks(): boolean {
    return this.lastTransportRunning === true;
  }

  /** Update master BPM from rack or host (does not re-notify rack). */
  setMasterBpm(bpm: number): void {
    const safe = Math.max(40, Math.min(200, bpm));
    this.panel?.webview.postMessage({ type: 'setMasterBpm', bpm: safe });
  }

  async ensureBridge(): Promise<boolean> {
    const anns = collectAnnotations(this.shredOps);
    const { oscPort } = getConfig();
    const modTargets = collectModTargetsForBridge(this.shredOps);
    const bridge = writeBridgeFile(anns, oscPort, modTargets);
    try {
      const changed = await this.onBridgeNeeded(bridge.path, bridge.source);
      if (changed) {
        await sleep(120);
      }
      return !!changed;
    } catch (err) {
      console.warn('seq bridge reload skipped:', err);
      return false;
    }
  }

  /** Seed default live_* values after Start VM. */
  seedTransportDefaults(bpm = 120): void {
    const { oscPort } = getConfig();
    const host = '127.0.0.1';
    const stepDur = 60 / Math.max(40, bpm) / 4;
    this.osc.sendFloat(host, oscPort, `/chuck/${LIVE_TRANSPORT.bpm}`, bpm);
    this.osc.sendFloat(host, oscPort, `/chuck/${LIVE_TRANSPORT.step}`, 0);
    this.osc.sendFloat(host, oscPort, `/chuck/${LIVE_TRANSPORT.stepDur}`, stepDur);
    this.osc.sendFloat(host, oscPort, `/chuck/${LIVE_TRANSPORT.running}`, 0);
    this.osc.sendInt(host, oscPort, `/chuck/${LIVE_TRANSPORT.swing}`, 0);
  }

  /** Clear transport reload cache (call when the VM stops or restarts). */
  resetTransportTracking(): void {
    this.lastTransportRunning = false;
    this.lastPlayheadStep = -1;
    this.lastAppliedTransportSource = '';
    this.pendingTransportDump = undefined;
  }

  /** Handle /chuck/live_playhead from the transport shred (Sync ON only). */
  onPlayheadOsc(step: number, running?: number): void {
    if (!this.panel) {
      return;
    }
    // Only ignore when transport explicitly reports stopped (not when running arg is absent).
    if (running !== undefined && running <= 0.5) {
      return;
    }
    const s = ((Math.round(step) % 16) + 16) % 16;
    const wrapped = this.lastPlayheadStep === 15 && s === 0;
    this.lastPlayheadStep = s;
    this.panel.webview.postMessage({
      type: 'playhead',
      step: s,
      running: running === undefined || running > 0.5,
      wrapped,
    });
  }

  pushTargets(): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage(this.targetsPayload());
  }

  dispose(): void {
    if (this.transportDumpTimer) {
      clearTimeout(this.transportDumpTimer);
    }
    this.panel?.dispose();
    this.panel = undefined;
  }

  private targetsPayload(): {
    type: 'targets';
    targets: ReturnType<typeof collectSeqTargets>;
    gates: string[];
  } {
    const anns = collectAnnotations(this.shredOps);
    const targets = collectSeqTargets(this.shredOps);
    const gates = anns
      .filter((a) => a.kind === 'button' && a.type === 'Event')
      .map((a) => a.name)
      .sort();
    return { type: 'targets', targets, gates };
  }

  /** Re-push live_* OSC after bridge OTF-replace (bridge no longer zeros globals). */
  republishTransportOsc(): void {
    this.republishTransportBusFromCache();
    this.panel?.webview.postMessage({ type: 'bridgeReloaded' });
  }

  /** Push cached transport bus state to bridge OSC (host-side, no webview required). */
  republishTransportBusFromCache(): void {
    const dump = this.lastTransportDump;
    if (!dump) {
      return;
    }
    const chuckOwnsClock = dump.syncClocks !== false;
    this.publishTransportBus({
      bpm: dump.masterBpm,
      step: dump.sharedPlayhead,
      running: chuckOwnsClock ? dump.running : false,
      swingEnabled: dump.swingEnabled,
    });
    if (chuckOwnsClock && dump.running) {
      const { oscPort } = getConfig();
      this.osc.sendInt(
        '127.0.0.1',
        oscPort,
        `/chuck/${LIVE_TRANSPORT.cmd}`,
        1
      );
    }
  }

  private async prepareBridgeAndSync(): Promise<void> {
    await this.ensureBridge();
    this.pushTargets();
    this.panel?.webview.postMessage({ type: 'bridgeReady' });
  }

  private workspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private patternsDir(): vscode.Uri | undefined {
    const root = this.workspaceRoot();
    if (!root) {
      return undefined;
    }
    return vscode.Uri.joinPath(root, '.chuck-live', 'patterns');
  }

  private sanitizePatternName(raw: string): string | undefined {
    const n = raw.trim().replace(/\.(json|ck)$/i, '');
    if (!n || !PATTERN_NAME_RE.test(n)) {
      return undefined;
    }
    return n;
  }

  private async ensurePatternsDir(): Promise<vscode.Uri | undefined> {
    const dir = this.patternsDir();
    if (!dir) {
      void vscode.window.showErrorMessage(
        'Open a workspace folder to save sequencer patterns.'
      );
      return undefined;
    }
    try {
      await vscode.workspace.fs.createDirectory(dir);
    } catch {
      try {
        await vscode.workspace.fs.createDirectory(
          vscode.Uri.joinPath(this.workspaceRoot()!, '.chuck-live')
        );
        await vscode.workspace.fs.createDirectory(dir);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Could not create patterns folder: ${String(err)}`
        );
        return undefined;
      }
    }
    return dir;
  }

  /** Bundled examples/sequences next to the extension. */
  private bundledSequencesDir(): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, 'examples', 'sequences');
  }

  /** Optional workspace library copy (after Init Project). */
  private librarySequencesDir(): vscode.Uri | undefined {
    const root = this.workspaceRoot();
    if (!root) {
      return undefined;
    }
    const cfg = vscode.workspace.getConfiguration('chuckLive');
    const lib = cfg.get<string>('initLibraryDir', 'chuck');
    return vscode.Uri.joinPath(root, lib, 'sequences');
  }

  /** Seed .chuck-live/patterns from extension if the folder is empty. */
  private async ensurePatternsSeeded(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      return;
    }
    const existing = await this.listPatternEntriesIn(this.patternsDir());
    if (existing.length > 0) {
      return;
    }
    await this.ensurePatternsDir();
    seedBundledPatterns(this.extensionUri.fsPath, root.fsPath, false);
  }

  private async listPatternEntriesIn(
    dir: vscode.Uri | undefined
  ): Promise<{ name: string; ext: 'json' | 'ck'; uri: vscode.Uri }[]> {
    if (!dir) {
      return [];
    }
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      const out: { name: string; ext: 'json' | 'ck'; uri: vscode.Uri }[] = [];
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File) {
          continue;
        }
        const jsonM = name.match(/^(.+)\.json$/i);
        const ckM = name.match(/^(.+)\.ck$/i);
        const base = jsonM?.[1] ?? ckM?.[1];
        if (!base || !PATTERN_NAME_RE.test(base)) {
          continue;
        }
        if (jsonM) {
          out.push({
            name: base,
            ext: 'json',
            uri: vscode.Uri.joinPath(dir, name),
          });
        } else if (ckM) {
          out.push({
            name: base,
            ext: 'ck',
            uri: vscode.Uri.joinPath(dir, name),
          });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Workspace patterns first, then library sequences, then bundled examples.
   * Prefer .json over .ck when the same name appears in multiple places.
   */
  private async listPatternEntries(): Promise<
    {
      name: string;
      ext: 'json' | 'ck';
      uri: vscode.Uri;
      source: string;
    }[]
  > {
    const sources: { dir: vscode.Uri | undefined; label: string }[] = [
      { dir: this.patternsDir(), label: '.chuck-live/patterns' },
      { dir: this.librarySequencesDir(), label: 'library sequences' },
      { dir: this.bundledSequencesDir(), label: 'bundled' },
    ];

    type Entry = {
      name: string;
      ext: 'json' | 'ck';
      uri: vscode.Uri;
      source: string;
    };
    const byKey = new Map<string, Entry>();

    for (const src of sources) {
      const entries = await this.listPatternEntriesIn(src.dir);
      for (const e of entries) {
        const key = `${e.name}.${e.ext}`;
        if (byKey.has(key)) {
          continue;
        }
        byKey.set(key, { ...e, source: src.label });
      }
    }

    const out = [...byKey.values()];
    out.sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.ext.localeCompare(b.ext) ||
        a.source.localeCompare(b.source)
    );
    return out;
  }

  private async handleSavePattern(data: unknown): Promise<void> {
    const dir = await this.ensurePatternsDir();
    if (!dir) {
      return;
    }
    const formatPick = await vscode.window.showQuickPick(
      [
        { label: 'JSON (A/B banks, Sequencer UI)', format: 'json' as const },
        { label: 'ChucK (.ck transport snapshot)', format: 'ck' as const },
      ],
      { placeHolder: 'Save pattern format' }
    );
    if (!formatPick) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: 'Pattern name (saved under .chuck-live/patterns/)',
      placeHolder: 'groove1',
      validateInput: (v) =>
        this.sanitizePatternName(v)
          ? undefined
          : 'Use letters, digits, . _ - only',
    });
    if (!name) {
      return;
    }
    const safe = this.sanitizePatternName(name);
    if (!safe) {
      return;
    }
    if (formatPick.format === 'json') {
      const payload =
        data && typeof data === 'object'
          ? { ...(data as Record<string, unknown>), name: safe, version: 1 }
          : { version: 1, name: safe };
      const uri = vscode.Uri.joinPath(dir, `${safe}.json`);
      const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(uri, body);
      void vscode.window.showInformationMessage(
        `Saved pattern “${safe}” → .chuck-live/patterns/${safe}.json`
      );
      return;
    }

    const snap =
      data && typeof data === 'object'
        ? ({ ...(data as Record<string, unknown>), name: safe, version: 1 } as PatternSnapshot)
        : ({ version: 1, name: safe, trackOrder: [], patterns: {} } as PatternSnapshot);
    const dump: SeqTransportDump = {
      masterBpm: snap.masterBpm,
      syncClocks: snap.syncClocks,
      swingEnabled: snap.swingEnabled,
      running: false,
      trackOrder: snap.trackOrder,
      patterns: snap.patterns as SeqTransportDump['patterns'],
    };
    const spec = this.buildTransportSpec(dump);
    const scale = snap.scaleName ?? 'phrygian';
    const source = exportCkPattern(spec, { name: safe, scale });
    const uri = vscode.Uri.joinPath(dir, `${safe}.ck`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(source, 'utf8'));
    void vscode.window.showInformationMessage(
      `Saved pattern “${safe}” → .chuck-live/patterns/${safe}.ck`
    );
  }

  private async handleLoadPattern(): Promise<void> {
    if (!this.workspaceRoot()) {
      // Still allow loading bundled patterns without a workspace.
      const bundled = await this.listPatternEntriesIn(this.bundledSequencesDir());
      if (!bundled.length) {
        void vscode.window.showErrorMessage(
          'Open a workspace folder to load sequencer patterns, or reinstall the extension (bundled sequences missing).'
        );
        return;
      }
    } else {
      await this.ensurePatternsSeeded();
    }

    const entries = await this.listPatternEntries();
    if (!entries.length) {
      void vscode.window.showInformationMessage(
        'No patterns found. Use Save As…, or run ChucK: Import Bundled Patterns.'
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map((e) => ({
        label: e.name,
        description: `${e.ext === 'json' ? 'JSON' : 'ChucK .ck'} · ${e.source}`,
        entry: e,
      })),
      { placeHolder: 'Load sequencer pattern' }
    );
    if (!picked) {
      return;
    }
    const safe = this.sanitizePatternName(picked.label);
    if (!safe) {
      return;
    }
    try {
      const raw = await vscode.workspace.fs.readFile(picked.entry.uri);
      const text = Buffer.from(raw).toString('utf8');
      let data: unknown;
      if (picked.entry.ext === 'json') {
        data = JSON.parse(text) as unknown;
      } else {
        const parsed = parseCkPattern(text);
        if (!parsed) {
          void vscode.window.showErrorMessage(
            'Not a valid ChucK Live pattern file (@chuckLivePattern header missing).'
          );
          return;
        }
        data = parsed;
      }
      this.panel?.webview.postMessage({ type: 'patternLoaded', data });
      void vscode.window.showInformationMessage(
        `Loaded pattern “${safe}” (${picked.entry.ext})`
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to load pattern: ${String(err)}`
      );
    }
  }

  private publishTransportBus(msg: {
    bpm?: number;
    step?: number;
    running?: boolean;
    tick?: boolean;
    swingEnabled?: boolean;
  }): void {
    const { oscPort } = getConfig();
    const host = '127.0.0.1';
    if (msg.bpm !== undefined) {
      const bpm = Math.max(40, Math.min(200, msg.bpm));
      const stepDur = 60 / bpm / 4;
      this.osc.sendFloat(host, oscPort, `/chuck/${LIVE_TRANSPORT.bpm}`, bpm);
      this.osc.sendFloat(
        host,
        oscPort,
        `/chuck/${LIVE_TRANSPORT.stepDur}`,
        stepDur
      );
    }
    if (msg.step !== undefined) {
      this.osc.sendFloat(
        host,
        oscPort,
        `/chuck/${LIVE_TRANSPORT.step}`,
        msg.step
      );
    }
    if (msg.running !== undefined) {
      this.osc.sendFloat(
        host,
        oscPort,
        `/chuck/${LIVE_TRANSPORT.running}`,
        msg.running ? 1 : 0
      );
    }
    if (msg.swingEnabled !== undefined) {
      this.osc.sendInt(
        host,
        oscPort,
        `/chuck/${LIVE_TRANSPORT.swing}`,
        msg.swingEnabled ? 1 : 0
      );
    }
    if (msg.tick) {
      this.osc.sendInt(host, oscPort, `/chuck/${LIVE_TRANSPORT.tick}`, 1);
    }
  }

  private buildTransportSpec(dump: SeqTransportDump): TransportSpec {
    const { meterPort } = getConfig();
    const bpm = Math.max(40, Math.min(200, dump.masterBpm ?? 120));
    const step = dump.sharedPlayhead ?? 0;
    const order = dump.trackOrder ?? [];
    const patterns = dump.patterns ?? {};
    const tracks: TransportTrack[] = [];

    for (const name of order) {
      const p = patterns[name];
      if (!p) {
        continue;
      }
      const kind = p.kind === 'gate' ? 'gate' : 'float';
      let values = (p.values ?? []).slice(0, 16);
      while (values.length < 16) {
        values.push(0);
      }
      if (kind === 'float' && p.mode === 'midi') {
        values = values.map((v) => midiToHz(v));
      }
      tracks.push({
        name,
        kind,
        gate: p.gate || undefined,
        muted: !!p.muted,
        solo: !!p.solo,
        swing: typeof p.swing === 'number' ? p.swing : 0,
        running: !!p.running,
        gates: p.gates ?? [],
        values,
        probs: p.probs ?? [],
      });
    }

    return {
      bpm,
      step,
      running: !!dump.running,
      swingEnabled: !!dump.swingEnabled,
      meterPort,
      tracks,
    };
  }

  private buildStoppedTransportSpec(dump?: SeqTransportDump): TransportSpec {
    const { meterPort } = getConfig();
    const bpm = Math.max(
      40,
      Math.min(200, dump?.masterBpm ?? 120)
    );
    return {
      bpm,
      step: dump?.sharedPlayhead ?? 0,
      running: false,
      swingEnabled: false,
      meterPort,
      tracks: [],
    };
  }

  private async applyTransportDump(dump: SeqTransportDump): Promise<void> {
    this.lastTransportDump = dump;
    const chuckOwnsClock = dump.syncClocks !== false;
    const running = chuckOwnsClock ? !!dump.running : false;
    this.lastTransportRunning = running;

    this.publishTransportBus({
      bpm: dump.masterBpm,
      step: dump.sharedPlayhead,
      running: chuckOwnsClock ? dump.running : false,
      swingEnabled: dump.swingEnabled,
    });
    if (chuckOwnsClock && dump.running) {
      const { oscPort } = getConfig();
      this.osc.sendInt(
        '127.0.0.1',
        oscPort,
        `/chuck/${LIVE_TRANSPORT.cmd}`,
        1
      );
    }

    // Running + sync on → bake patterns; otherwise idle transport (stable across shred adds).
    const spec =
      chuckOwnsClock && running
        ? this.buildTransportSpec(dump)
        : this.buildStoppedTransportSpec(dump);
    const file = writeTransportFile(spec);
    if (file.source === this.lastAppliedTransportSource) {
      return;
    }
    this.lastAppliedTransportSource = file.source;
    try {
      await this.onTransportNeeded(file.path, file.source);
    } catch (err) {
      console.warn('transport reload skipped:', err);
    }
  }

  private enqueueTransportDump(dump: SeqTransportDump): void {
    this.pendingTransportDump = dump;
    this.transportApplyChain = this.transportApplyChain
      .then(async () => {
        while (this.pendingTransportDump) {
          const next = this.pendingTransportDump;
          this.pendingTransportDump = undefined;
          await this.applyTransportDump(next);
        }
      })
      .catch(() => {});
  }

  private scheduleTransportDump(dump: SeqTransportDump): void {
    if (this.transportDumpTimer) {
      clearTimeout(this.transportDumpTimer);
      this.transportDumpTimer = undefined;
    }
    const chuckOwnsClock = dump.syncClocks !== false;
    const running = chuckOwnsClock ? !!dump.running : false;
    const tracksIdle =
      !dump.trackOrder?.length ||
      dump.trackOrder.every((n) => !dump.patterns?.[n]?.running);
    // Ignore redundant stop dumps (shred add used to spam these via pushTargets).
    if (!running && this.lastTransportRunning === false && tracksIdle) {
      return;
    }
    // Claim stop state before async apply so parallel dumps coalesce.
    if (!running) {
      this.lastTransportRunning = false;
    }
    // Stop / sync-off must apply immediately.
    if (!chuckOwnsClock || !running) {
      this.enqueueTransportDump(dump);
      return;
    }
    // Start must not wait on debounce.
    if (running && this.lastTransportRunning !== true) {
      this.enqueueTransportDump(dump);
      return;
    }
    this.transportDumpTimer = setTimeout(() => {
      this.transportDumpTimer = undefined;
      this.enqueueTransportDump(dump);
    }, 40);
  }

  private async onMessage(msg: {
    type: string;
    target?: string;
    gate?: string;
    mode?: string;
    kind?: string;
    value?: number;
    gateOn?: boolean;
    data?: unknown;
    bpm?: number;
    step?: number;
    running?: boolean;
    tick?: boolean;
    swingEnabled?: boolean;
  }): Promise<void> {
    if (msg.type === 'requestSavePattern') {
      await this.handleSavePattern(msg.data);
      return;
    }
    if (msg.type === 'requestLoadPattern') {
      await this.handleLoadPattern();
      return;
    }

    if (msg.type === 'transport') {
      this.publishTransportBus({
        bpm: msg.bpm,
        step: msg.step,
        running: msg.running,
        tick: msg.tick,
        swingEnabled: msg.swingEnabled,
      });
      if (msg.bpm !== undefined) {
        this.onLiveBpmFromSeq?.(Math.max(40, Math.min(200, msg.bpm)));
      }
      return;
    }

    if (msg.type === 'transportDump' && msg.data) {
      this.scheduleTransportDump(msg.data as SeqTransportDump);
      return;
    }

    // Independent-clock path (sync off): host still fires per step.
    if (msg.type === 'fire' && msg.target !== undefined) {
      if (msg.gateOn === false) {
        return;
      }
      const { oscPort } = getConfig();
      if (msg.kind === 'gate') {
        this.osc.sendInt('127.0.0.1', oscPort, `/chuck/${msg.target}`, 1);
        return;
      }
      if (msg.value === undefined) {
        return;
      }
      let v = msg.value;
      if (msg.mode === 'midi') {
        v = midiToHz(v);
      }
      this.osc.sendFloat('127.0.0.1', oscPort, `/chuck/${msg.target}`, v);
      if (msg.gate) {
        this.osc.sendInt('127.0.0.1', oscPort, `/chuck/${msg.gate}`, 1);
      }
      return;
    }

    if (msg.type === 'ready') {
      void this.prepareBridgeAndSync();
    }
  }

  private html(webview: vscode.Webview): string {
    const bust = String(Date.now());
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'seq.css')
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'seq.js')
    );
    const nonce = bust;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${css}?v=${bust}" />
</head>
<body>
  <header class="bar">
    <div class="title">Sequencer cascade</div>
    <div class="bar-actions">
      <label class="pick">Scale
        <select id="scale">
          <option value="chromatic">chromatic</option>
          <option value="minor">minor</option>
          <option value="dorian">dorian</option>
          <option value="phrygian" selected>phrygian</option>
          <option value="pentatonic_min">pentatonic min</option>
        </select>
      </label>
      <label class="bpm">Master BPM
        <input type="number" id="masterBpm" min="40" max="200" value="120" />
      </label>
      <label class="pick sync" title="Sync ON = ChucK-owned clock; OFF = independent host clocks">
        <input type="checkbox" id="syncClocks" checked /> Sync clocks
      </label>
      <label class="pick sync" title="When off, all tracks fire on the straight grid">
        <input type="checkbox" id="swingEnabled" /> Swing
      </label>
      <select id="addTarget" title="Parameter to sequence"></select>
      <button type="button" id="btnAdd">Add track</button>
      <button type="button" id="btnRunAll">Run all</button>
      <button type="button" id="btnStopAll">Stop all</button>
      <button type="button" id="btnSaveAs" title="Save to .chuck-live/patterns/">Save As…</button>
      <button type="button" id="btnLoad" title="Load from .chuck-live/patterns/">Load…</button>
    </div>
  </header>
  <p class="hint" id="hint">Tracks · scale lock (midi) · sync = ChucK 16ths</p>
  <div id="tracks"></div>
  <script nonce="${nonce}" src="${js}?v=${bust}"></script>
</body>
</html>`;
  }
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
