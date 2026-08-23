import * as vscode from 'vscode';
import { OscServer, OscMessage } from './oscServer';

/**
 * Session sidebar webview: L/R peak VU bars fed by OSC /chuck/vu.
 */
export class MeterPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'chuckLive.sessionMeter';

  private view?: vscode.WebviewView;
  private readonly onMessage: (msg: OscMessage) => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly oscServer: OscServer
  ) {
    this.onMessage = (msg: OscMessage) => {
      if (msg.address !== '/chuck/vu' || msg.floats.length < 2) {
        return;
      }
      this.view?.webview.postMessage({
        type: 'vu',
        l: msg.floats[0],
        r: msg.floats[1],
      });
    };
    this.oscServer.on('message', this.onMessage);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.html(webviewView.webview);
  }

  /** Clear meters when VM stops. */
  reset(): void {
    this.view?.webview.postMessage({ type: 'vu', l: 0, r: 0 });
  }

  dispose(): void {
    this.oscServer.off('message', this.onMessage);
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'meter.css')
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'meter.js')
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
  <div class="meter" id="meter">
    <div class="channel">
      <div class="label">L</div>
      <div class="bar-wrap">
        <div class="bar" id="barL"></div>
        <div class="peak-mark" id="peakL"></div>
      </div>
      <div class="peak-led" id="ledL" title="Peak"></div>
      <div class="db" id="dbL">−∞</div>
    </div>
    <div class="channel">
      <div class="label">R</div>
      <div class="bar-wrap">
        <div class="bar" id="barR"></div>
        <div class="peak-mark" id="peakR"></div>
      </div>
      <div class="peak-led" id="ledR" title="Peak"></div>
      <div class="db" id="dbR">−∞</div>
    </div>
    <div class="scale" aria-hidden="true">
      <span class="scale-spacer"></span>
      <div class="scale-ticks">
        <span>−60</span>
        <span>−48</span>
        <span>−36</span>
        <span>−24</span>
        <span>−12</span>
        <span>0</span>
      </div>
      <span class="scale-led-spacer"></span>
      <span class="scale-db-spacer"></span>
    </div>
  </div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
