import * as vscode from 'vscode';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { ShredOps } from './shredOps';
import { writeBridgeFile } from './bridgeGen';
import {
  collectAnnotations,
  collectSeqTargets,
} from './knobsPanel';

/**
 * Cascade sequencer: float lanes + gate-only Event tracks.
 * Host/UI owns the clock; each tick writes OSC.
 */
export class SeqPanel {
  private panel: vscode.WebviewPanel | undefined;
  private bridgeGate: Promise<unknown> = Promise.resolve();

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

  private async onMessage(msg: {
    type: string;
    target?: string;
    gate?: string;
    mode?: string;
    kind?: string;
    value?: number;
    gateOn?: boolean;
  }): Promise<void> {
    this.bridgeGate = this.bridgeGate
      .then(() => this.ensureBridge())
      .catch(() => undefined);
    await this.bridgeGate;

    const { oscPort } = getConfig();

    if (msg.type === 'fire' && msg.target !== undefined) {
      if (msg.gateOn === false) {
        return;
      }
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
    } else if (msg.type === 'ready') {
      void this.prepareBridgeAndSync();
    }
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'seq.css')
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'seq.js')
    );
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${css}" />
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
      <select id="addTarget" title="Parameter to sequence"></select>
      <button type="button" id="btnAdd">Add track</button>
      <button type="button" id="btnRunAll">Run all</button>
      <button type="button" id="btnStopAll">Stop all</button>
    </div>
  </header>
  <p class="hint" id="hint">Tracks · scale lock (midi) · sync = shared 16ths</p>
  <div id="tracks"></div>
  <script nonce="${nonce}" src="${js}"></script>
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
