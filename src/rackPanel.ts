import * as vscode from 'vscode';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { OscServer, OscMessage } from './oscServer';
import { ShredOps } from './shredOps';
import { buildRackModules, RackModule } from './rackModel';
import { writeBridgeFile, LIVE_TRANSPORT } from './bridgeGen';
import { collectAnnotations } from './knobsPanel';

/**
 * Full-page Eurorack-style case: one faceplate per loaded shred.
 * Knobs/buttons send OSC like the sidebar knobs panel.
 * Master module shows L/R VU; other modules show a peak LED.
 */
export class RackPanel {
  private panel: vscode.WebviewPanel | undefined;
  private modules: RackModule[] = [];
  private liveBpm = 120;
  /** Shred ids matching /chuck/peaks float order from the meter shred. */
  private peakIds: number[] = [];
  private readonly onOsc: (msg: OscMessage) => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly osc: OscClient,
    private readonly shredOps: ShredOps,
    private readonly oscServer: OscServer,
    private readonly onBridgeNeeded: (
      bridgePath: string,
      source?: string
    ) => Promise<boolean | void>,
    private readonly onLiveBpmChange?: (bpm: number) => void
  ) {
    this.onOsc = (msg: OscMessage) => this.forwardMeter(msg);
    this.oscServer.on('message', this.onOsc);
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      void this.refresh(false);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'chuckLive.rack',
      'ChucK Rack',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      }
    );

    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    void this.refresh(true);
  }

  get isOpen(): boolean {
    return !!this.panel;
  }

  /** Align peak OSC float indices with shred ids (from meterGen tap order). */
  setPeakIds(ids: number[]): void {
    this.peakIds = ids.slice();
  }

  /** Clear VU / LEDs when VM stops. */
  resetMeter(): void {
    this.peakIds = [];
    this.panel?.webview.postMessage({ type: 'resetMeter' });
  }

  /** Mirror sequencer / transport BPM on the rack dial (display only). */
  setLiveBpm(bpm: number): void {
    const safe = Math.max(40, Math.min(200, bpm));
    this.liveBpm = safe;
    this.panel?.webview.postMessage({
      type: 'setKnob',
      name: LIVE_TRANSPORT.bpm,
      value: safe,
    });
  }

  async refresh(reloadBridge = false): Promise<void> {
    this.modules = buildRackModules(this.shredOps, this.liveBpm);
    this.panel?.webview.postMessage({
      type: 'setRack',
      modules: this.modules,
    });

    if (reloadBridge) {
      const anns = collectAnnotations(this.shredOps);
      const { oscPort } = getConfig();
      const bridge = writeBridgeFile(anns, oscPort);
      try {
        await this.onBridgeNeeded(bridge.path, bridge.source);
      } catch (err) {
        console.warn('rack bridge reload skipped:', err);
      }
    }
  }

  dispose(): void {
    this.oscServer.off('message', this.onOsc);
    this.panel?.dispose();
    this.panel = undefined;
  }

  private forwardMeter(msg: OscMessage): void {
    if (!this.panel) {
      return;
    }
    if (msg.address !== '/chuck/vu' || msg.floats.length < 2) {
      return;
    }
    this.panel.webview.postMessage({
      type: 'vu',
      l: msg.floats[0],
      r: msg.floats[1],
    });
    if (this.peakIds.length === 0) {
      return;
    }
    const peaks: Record<string, number> = {};
    const extra = msg.floats.slice(2);
    const n = Math.min(extra.length, this.peakIds.length);
    for (let i = 0; i < n; i++) {
      peaks[String(this.peakIds[i])] = extra[i];
    }
    this.panel.webview.postMessage({ type: 'peaks', peaks });
  }

  private onMessage(msg: {
    type: string;
    name?: string;
    value?: number;
  }): void {
    const { oscPort } = getConfig();
    if (msg.type === 'knob' && msg.name !== undefined && msg.value !== undefined) {
      this.osc.sendFloat('127.0.0.1', oscPort, `/chuck/${msg.name}`, msg.value);
      if (msg.name === LIVE_TRANSPORT.bpm) {
        const bpm = Math.max(40, Math.min(200, msg.value));
        this.liveBpm = bpm;
        this.onLiveBpmChange?.(bpm);
      }
    } else if (msg.type === 'button' && msg.name !== undefined) {
      this.osc.sendInt('127.0.0.1', oscPort, `/chuck/${msg.name}`, 1);
    } else if (msg.type === 'ready') {
      this.panel?.webview.postMessage({
        type: 'setRack',
        modules: this.modules,
      });
    }
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'rack.css')
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'rack.js')
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
  <div class="rails top"></div>
  <div id="case" class="case"></div>
  <div class="rails bottom"></div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
