import * as vscode from 'vscode';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { ShredOps } from './shredOps';
import { buildModulesFromShreds, RackModule } from './rackModel';
import { writeBridgeFile } from './bridgeGen';
import { collectAnnotations } from './knobsPanel';

/**
 * Full-page Eurorack-style case: one faceplate per loaded shred.
 * Knobs/buttons send OSC like the sidebar knobs panel.
 */
export class RackPanel {
  private panel: vscode.WebviewPanel | undefined;
  private modules: RackModule[] = [];

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

  async refresh(reloadBridge = false): Promise<void> {
    this.modules = buildModulesFromShreds(this.shredOps);
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
    this.panel?.dispose();
    this.panel = undefined;
  }

  private onMessage(msg: {
    type: string;
    name?: string;
    value?: number;
  }): void {
    const { oscPort } = getConfig();
    if (msg.type === 'knob' && msg.name !== undefined && msg.value !== undefined) {
      this.osc.sendFloat('127.0.0.1', oscPort, `/chuck/${msg.name}`, msg.value);
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
