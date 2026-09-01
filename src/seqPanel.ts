import * as vscode from 'vscode';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { ShredOps } from './shredOps';
import { writeBridgeFile, LIVE_TRANSPORT, LIVE_SEQ } from './bridgeGen';
import { collectModTargetsForBridge } from './modModel';
import {
  writeTransportFile,
  TransportTrack,
  TransportSpec,
  transportTopologyKey,
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
  /** When true, arm pending→live copy on next bar wrap instead of immediate commit. */
  applyAtBar?: boolean;
  /** Flush a wrap-queued topology change — do not re-queue. */
  forceOtf?: boolean;
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
  private lastTopologyKey = '';
  /** Topology OTF waiting for playhead wrap (15→0). */
  private queuedTopologyDump?: SeqTransportDump;

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
    if (this.lastTransportRunning !== true) {
      return false;
    }
    const dump = this.lastTransportDump;
    if (!dump?.running) {
      return false;
    }
    const order = dump.trackOrder ?? [];
    const patterns = dump.patterns ?? {};
    return order.some((n) => patterns[n]?.running);
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
    this.lastTopologyKey = '';
    this.pendingTransportDump = undefined;
    this.queuedTopologyDump = undefined;
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
    if (wrapped && this.queuedTopologyDump) {
      const dump: SeqTransportDump = {
        ...this.queuedTopologyDump,
        sharedPlayhead: 0,
        applyAtBar: false,
        forceOtf: true,
      };
      this.queuedTopologyDump = undefined;
      // Apply on the chain without coalescing through pendingTransportDump
      // (a later dumpTransport would overwrite the wrap flush and re-queue forever).
      this.transportApplyChain = this.transportApplyChain
        .then(() => this.applyTransportDump(dump))
        .catch(() => {});
    }
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
      if (!msg.running) {
        this.lastTransportRunning = false;
        this.queuedTopologyDump = undefined;
        if (this.lastTransportDump) {
          this.lastTransportDump = { ...this.lastTransportDump, running: false };
        }
      }
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

  /** OSC-patch pending pattern arrays + mute/solo/run/swing; arm or commit. */
  private patchPatternOsc(dump: SeqTransportDump): void {
    const { oscPort } = getConfig();
    const host = '127.0.0.1';
    const spec = this.buildTransportSpec(dump);
    const tracks = spec.tracks;

    for (let i = 0; i < 16; i++) {
      const t = tracks[i];
      if (!t) {
        this.osc.send(host, oscPort, `/chuck/${LIVE_SEQ.run}`, [
          { type: 'i', value: i },
          { type: 'i', value: 0 },
        ]);
        continue;
      }
      const gates = pad16Local(t.gates, 0);
      const vals = pad16Local(t.values, 0);
      const probs = pad16Local(t.probs, 1);
      for (let s = 0; s < 16; s++) {
        this.osc.send(host, oscPort, `/chuck/${LIVE_SEQ.g}`, [
          { type: 'i', value: i },
          { type: 'i', value: s },
          { type: 'i', value: gates[s] > 0.5 ? 1 : 0 },
        ]);
        this.osc.send(host, oscPort, `/chuck/${LIVE_SEQ.v}`, [
          { type: 'i', value: i },
          { type: 'i', value: s },
          { type: 'f', value: vals[s] },
        ]);
        this.osc.send(host, oscPort, `/chuck/${LIVE_SEQ.p}`, [
          { type: 'i', value: i },
          { type: 'i', value: s },
          { type: 'f', value: probs[s] },
        ]);
      }
      this.osc.send(host, oscPort, `/chuck/${LIVE_SEQ.muted}`, [
        { type: 'i', value: i },
        { type: 'i', value: t.muted ? 1 : 0 },
      ]);
      this.osc.send(host, oscPort, `/chuck/${LIVE_SEQ.solo}`, [
        { type: 'i', value: i },
        { type: 'i', value: t.solo ? 1 : 0 },
      ]);
      this.osc.send(host, oscPort, `/chuck/${LIVE_SEQ.run}`, [
        { type: 'i', value: i },
        { type: 'i', value: t.running ? 1 : 0 },
      ]);
      this.osc.send(host, oscPort, `/chuck/${LIVE_SEQ.swingAmt}`, [
        { type: 'i', value: i },
        { type: 'f', value: t.swing },
      ]);
    }

    const applyAtBar = dump.applyAtBar === true && !!dump.running;
    if (applyAtBar) {
      this.osc.sendInt(host, oscPort, `/chuck/${LIVE_SEQ.armed}`, 1);
      this.osc.sendInt(host, oscPort, `/chuck/${LIVE_SEQ.commit}`, 0);
    } else {
      this.osc.sendInt(host, oscPort, `/chuck/${LIVE_SEQ.commit}`, 1);
      this.osc.sendInt(host, oscPort, `/chuck/${LIVE_SEQ.armed}`, 0);
    }
  }

  private async otfLoadTransport(dump: SeqTransportDump): Promise<void> {
    const chuckOwnsClock = dump.syncClocks !== false;
    const running = chuckOwnsClock ? !!dump.running : false;
    // Keep track topology even when stopped — stop is OSC-only after first load.
    const spec = this.buildTransportSpec({
      ...dump,
      running: chuckOwnsClock ? dump.running : false,
    });
    // If nothing to sequence and never started, keep a quiet clock shred.
    if (!spec.tracks.length && !this.lastTopologyKey) {
      spec.running = false;
    }
    const file = writeTransportFile(spec);
    if (file.source === this.lastAppliedTransportSource) {
      this.lastTopologyKey = transportTopologyKey(spec.tracks);
      return;
    }
    this.lastAppliedTransportSource = file.source;
    this.lastTopologyKey = transportTopologyKey(spec.tracks);
    try {
      await this.onTransportNeeded(file.path, file.source);
    } catch (err) {
      console.warn('transport reload skipped:', err);
    }
    // Re-assert bus after OTF (pattern already baked; still push run/cmd).
    this.publishTransportBus({
      bpm: dump.masterBpm,
      step: dump.sharedPlayhead ?? 0,
      running: chuckOwnsClock ? dump.running : false,
      swingEnabled: dump.swingEnabled,
    });
    if (chuckOwnsClock && running) {
      const { oscPort } = getConfig();
      this.osc.sendInt(
        '127.0.0.1',
        oscPort,
        `/chuck/${LIVE_TRANSPORT.cmd}`,
        1
      );
    }
  }

  private async applyTransportDump(dump: SeqTransportDump): Promise<void> {
    this.lastTransportDump = dump;
    const chuckOwnsClock = dump.syncClocks !== false;
    const running = chuckOwnsClock ? !!dump.running : false;
    const wasRunning = this.lastTransportRunning;
    this.lastTransportRunning = running;

    this.publishTransportBus({
      bpm: dump.masterBpm,
      // Don't rewind ChucK's playhead while the clock is (or was) running.
      step:
        chuckOwnsClock && (wasRunning || running)
          ? undefined
          : dump.sharedPlayhead,
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

    // Sync-off: host owns clocks — no ChucK pattern transport needed.
    if (!chuckOwnsClock) {
      return;
    }

    const spec = this.buildTransportSpec(dump);
    const topo = transportTopologyKey(spec.tracks);
    const hasTransport = !!this.lastTopologyKey;

    // Same topology already loaded → OSC patch only (no clock replace).
    if (hasTransport && topo === this.lastTopologyKey) {
      this.patchPatternOsc(dump);
      return;
    }

    // Topology changed while running → queue OTF for next bar wrap
    // (unless this dump is the wrap flush itself).
    if (
      hasTransport &&
      wasRunning &&
      running &&
      topo !== this.lastTopologyKey &&
      !dump.forceOtf
    ) {
      this.queuedTopologyDump = dump;
      this.panel?.webview.postMessage({
        type: 'topologyQueued',
      });
      return;
    }

    // First load, stop→start with new tracks, or stopped topology change → OTF now.
    await this.otfLoadTransport(dump);
    // After OTF, patterns are already live; clear arm/commit noise.
    const { oscPort } = getConfig();
    this.osc.sendInt('127.0.0.1', oscPort, `/chuck/${LIVE_SEQ.armed}`, 0);
    this.osc.sendInt('127.0.0.1', oscPort, `/chuck/${LIVE_SEQ.commit}`, 0);
    this.panel?.webview.postMessage({ type: 'topologyApplied' });
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
    // Ignore redundant stop dumps when already stopped and no tracks armed.
    if (!running && this.lastTransportRunning === false && tracksIdle) {
      // Still allow pattern/topology patches while stopped if we have a transport.
      if (!this.lastTopologyKey) {
        return;
      }
    }
    // Stop / sync-off / first start: apply soon.
    if (!chuckOwnsClock || !running || this.lastTransportRunning !== true) {
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
      <label class="pick sync" title="Queue pattern edits until the next 16-step wrap (no mid-bar change)">
        <input type="checkbox" id="applyAtBar" checked /> Apply at bar
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

function pad16Local(arr: number[] | undefined, fill: number): number[] {
  const out = (arr ?? []).slice(0, 16);
  while (out.length < 16) {
    out.push(fill);
  }
  return out;
}
