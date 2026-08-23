import * as vscode from 'vscode';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { ShredOps } from './shredOps';
import { writeBridgeFile } from './bridgeGen';
import {
  collectAnnotations,
  collectSeqTargets,
} from './knobsPanel';

const PATTERN_NAME_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Cascade sequencer: float lanes + gate-only Event tracks.
 * Host/UI owns the clock; each tick writes OSC.
 */
export class SeqPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly osc: OscClient,
    private readonly shredOps: ShredOps,
    private readonly onBridgeNeeded: (
      bridgePath: string,
      source?: string
    ) => Promise<boolean | void>
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

  async ensureBridge(): Promise<boolean> {
    const anns = collectAnnotations(this.shredOps);
    const { oscPort } = getConfig();
    const bridge = writeBridgeFile(anns, oscPort);
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

  pushTargets(): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage(this.targetsPayload());
  }

  dispose(): void {
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
    const n = raw.trim().replace(/\.json$/i, '');
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
      // exists or parent created
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

  private async listPatternNames(): Promise<string[]> {
    const dir = this.patternsDir();
    if (!dir) {
      return [];
    }
    try {
      const entries = await vscode.workspace.fs.readDirectory(dir);
      return entries
        .filter(
          ([name, type]) =>
            type === vscode.FileType.File && /\.json$/i.test(name)
        )
        .map(([name]) => name.replace(/\.json$/i, ''))
        .filter((n) => PATTERN_NAME_RE.test(n))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  private async handleSavePattern(data: unknown): Promise<void> {
    const dir = await this.ensurePatternsDir();
    if (!dir) {
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
  }

  private async handleLoadPattern(): Promise<void> {
    if (!this.workspaceRoot()) {
      void vscode.window.showErrorMessage(
        'Open a workspace folder to load sequencer patterns.'
      );
      return;
    }
    const names = await this.listPatternNames();
    if (!names.length) {
      void vscode.window.showInformationMessage(
        'No patterns in .chuck-live/patterns/ yet. Use Save As… first.'
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(names, {
      placeHolder: 'Load sequencer pattern',
    });
    if (!picked) {
      return;
    }
    const safe = this.sanitizePatternName(picked);
    if (!safe) {
      return;
    }
    const dir = this.patternsDir()!;
    const uri = vscode.Uri.joinPath(dir, `${safe}.json`);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(raw).toString('utf8');
      const data = JSON.parse(text) as unknown;
      this.panel?.webview.postMessage({ type: 'patternLoaded', data });
      void vscode.window.showInformationMessage(`Loaded pattern “${safe}”`);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to load pattern: ${String(err)}`
      );
    }
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
  }): Promise<void> {
    if (msg.type === 'requestSavePattern') {
      await this.handleSavePattern(msg.data);
      return;
    }
    if (msg.type === 'requestLoadPattern') {
      await this.handleLoadPattern();
      return;
    }

    // Fire must be synchronous — awaiting ensureBridge serialized every step
    // behind the playhead and staggered multi-track OSC.
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
      <label class="pick sync">
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
  <p class="hint" id="hint">Tracks · scale lock (midi) · sync = shared 16ths</p>
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
