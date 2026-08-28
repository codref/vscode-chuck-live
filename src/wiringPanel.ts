import * as vscode from 'vscode';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { ShredOps } from './shredOps';
import {
  ModMatrixModel,
  ModRouteState,
  buildModMatrixModel,
  readModRoutes,
  writeModRoutes,
} from './modModel';

/**
 * Bottom-panel mod matrix: MicroBrute-style source → destination routing.
 */
export class WiringPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'chuckLive.wiring';

  private view?: vscode.WebviewView;
  private model: ModMatrixModel = { vmUp: false, sources: [], modules: [] };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly osc: OscClient,
    private readonly shredOps: ShredOps,
    private readonly workspaceState: vscode.Memento
  ) {}

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
    webviewView.webview.onDidReceiveMessage((msg) => {
      void this.onMessage(msg);
    });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.model = buildModMatrixModel(this.shredOps, this.workspaceState);
    this.view?.webview.postMessage({
      type: 'setMatrix',
      model: this.model,
    });
  }

  private async onMessage(msg: {
    type: string;
    moduleFile?: string;
    dst?: string;
    src?: string;
    srcIndex?: number;
    depth?: number;
  }): Promise<void> {
    const { oscPort } = getConfig();
    const host = '127.0.0.1';

    if (msg.type === 'ready') {
      await this.refresh();
      return;
    }

    if (msg.type === 'connect' && msg.dst && msg.src && msg.moduleFile) {
      const depth = clamp01(msg.depth ?? 0.5);
      const srcEntry = this.model.sources.find((s) => s.name === msg.src);
      const srcIndex = srcEntry?.index ?? msg.srcIndex ?? 0;
      const target = this.lookupTarget(msg.dst);
      if (!target || srcIndex < 1) {
        return;
      }

      await this.persistRoute({
        dst: msg.dst,
        src: msg.src,
        depth,
        moduleFile: msg.moduleFile,
      });

      this.osc.sendInt(host, oscPort, `/chuck/${target.srcName}`, srcIndex);
      this.osc.sendFloat(host, oscPort, `/chuck/${target.depthName}`, depth);
      return;
    }

    if (msg.type === 'disconnect' && msg.dst) {
      const target = this.lookupTarget(msg.dst);
      if (!target) {
        return;
      }
      await this.removeRoute(msg.dst);
      this.osc.sendInt(host, oscPort, `/chuck/${target.srcName}`, 0);
      this.osc.sendFloat(host, oscPort, `/chuck/${target.depthName}`, 0);
      await this.refresh();
      return;
    }

    if (
      msg.type === 'setDepth' &&
      msg.dst !== undefined &&
      msg.depth !== undefined
    ) {
      const target = this.lookupTarget(msg.dst);
      if (!target) {
        return;
      }
      const depth = clamp01(msg.depth);
      const routes = readModRoutes(this.workspaceState);
      let existing = routes.find((r) => r.dst === msg.dst);
      if (!existing && msg.moduleFile && msg.src) {
        existing = {
          dst: msg.dst,
          src: msg.src,
          depth,
          moduleFile: msg.moduleFile,
        };
        routes.push(existing);
      } else if (existing) {
        existing.depth = depth;
      }
      if (existing) {
        await writeModRoutes(this.workspaceState, routes);
        await this.refresh();
      }
      const srcEntry = this.model.sources.find((s) => s.name === (existing?.src ?? msg.src));
      const srcIndex = srcEntry?.index ?? 0;
      if (srcIndex >= 1) {
        this.osc.sendInt(host, oscPort, `/chuck/${target.srcName}`, srcIndex);
      }
      this.osc.sendFloat(host, oscPort, `/chuck/${target.depthName}`, depth);
    }
  }

  private lookupTarget(
    dst: string
  ): { srcName: string; depthName: string } | undefined {
    for (const mod of this.model.modules) {
      const t = mod.targets.find((x) => x.modName === dst);
      if (t) {
        return { srcName: t.srcName, depthName: t.depthName };
      }
    }
    return undefined;
  }

  private async persistRoute(route: ModRouteState): Promise<void> {
    const routes = readModRoutes(this.workspaceState).filter(
      (r) => r.dst !== route.dst
    );
    routes.push(route);
    await writeModRoutes(this.workspaceState, routes);
    await this.refresh();
  }

  private async removeRoute(dst: string): Promise<void> {
    const routes = readModRoutes(this.workspaceState).filter(
      (r) => r.dst !== dst
    );
    await writeModRoutes(this.workspaceState, routes);
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'wiring.css')
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'wiring.js')
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
  <div id="root"></div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
