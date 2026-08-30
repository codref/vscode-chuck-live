import * as vscode from 'vscode';
import { ChuckVm } from './chuckVm';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { ShredOps } from './shredOps';
import {
  ModMatrixModel,
  ModRouteActive,
  ModRouteState,
  buildModMatrixModel,
  normalizeModModuleFile,
  readModRoutes,
  writeModRoutes,
} from './modModel';

/**
 * Bottom-panel mod matrix: source × destination click grid.
 */
export class WiringPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'chuckLive.wiring';
  /** Bump when wiring.js / wiring.css layout changes (forces webview remount). */
  private static readonly UI_EPOCH = 'matrix-cells-5';

  private view?: vscode.WebviewView;
  private model: ModMatrixModel = { vmUp: false, sources: [], modules: [] };
  private remountNonce = 0;
  private lastOscPushKey = '';
  private oscPushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly osc: OscClient,
    private readonly shredOps: ShredOps,
    private readonly workspaceState: vscode.Memento,
    private readonly globalState: vscode.Memento,
    private readonly extensionVersion: string,
    private readonly vm?: ChuckVm
  ) {}

  /** Reload webview HTML (clears cached wiring.js from prior extension builds). */
  remountWebview(): void {
    if (!this.view) {
      return;
    }
    this.remountNonce += 1;
    this.view.webview.html = this.html(this.view.webview, this.remountNonce);
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
    webviewView.webview.onDidReceiveMessage((msg) => {
      void this.onMessage(msg);
    });
    this.remountWebview();
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.model = buildModMatrixModel(
      this.shredOps,
      this.workspaceState,
      this.globalState
    );
    const persisted = readModRoutes(this.workspaceState, this.globalState);
    this.view?.webview.postMessage({
      type: 'setMatrix',
      model: this.model,
      persistedRoutes: persisted,
    });
    // Only push OSC when the VM process is actually up (model.vmUp can be stale).
    if (this.vm?.running) {
      this.schedulePushRoutesOsc();
    }
  }

  /** Coalesce OSC route dumps — opening/refreshing the panel must not flood the bridge. */
  private schedulePushRoutesOsc(): void {
    if (this.oscPushTimer !== undefined) {
      clearTimeout(this.oscPushTimer);
    }
    this.oscPushTimer = setTimeout(() => {
      this.oscPushTimer = undefined;
      this.pushRoutesOsc();
    }, 80);
  }

  private pushRoutesOsc(): void {
    if (!this.vm?.running || !this.model.vmUp) {
      return;
    }
    const key = this.model.modules
      .flatMap((m) =>
        m.routes
          .filter((r) => r.srcIndex >= 1)
          .map((r) => `${r.dst}:${r.srcIndex}:${r.depth.toFixed(3)}`)
      )
      .sort()
      .join('|');
    if (key === this.lastOscPushKey) {
      return;
    }
    this.lastOscPushKey = key;

    const { oscPort } = getConfig();
    const host = '127.0.0.1';
    for (const mod of this.model.modules) {
      for (const route of mod.routes) {
        if (route.srcIndex < 1) {
          continue;
        }
        const target = mod.targets.find((t) => t.modName === route.dst);
        if (!target) {
          continue;
        }
        this.osc.sendInt(host, oscPort, `/chuck/${target.srcName}`, route.srcIndex);
        this.osc.sendFloat(
          host,
          oscPort,
          `/chuck/${target.depthName}`,
          route.depth
        );
      }
    }
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
      if (!target) {
        void vscode.window.showWarningMessage(
          `Mod matrix: unknown destination ${msg.dst}`
        );
        return;
      }
      if (srcIndex < 1) {
        void vscode.window.showWarningMessage(
          `Mod matrix: source ${msg.src} is not registered — reload shreds with @modSource.`
        );
        return;
      }

      await this.persistRoute({
        dst: msg.dst,
        src: msg.src,
        depth,
        moduleFile: normalizeModModuleFile(msg.moduleFile),
      });

      this.osc.sendInt(host, oscPort, `/chuck/${target.srcName}`, srcIndex);
      this.osc.sendFloat(host, oscPort, `/chuck/${target.depthName}`, depth);
      // Invalidate OSC dump cache so a later refresh re-pushes if needed.
      this.lastOscPushKey = '';
      // Live route edits use OSC only — do not OTF-reload mod-matrix (avoids shred ID thrash).
      this.vm?.output.appendLine(
        `[mod] ${msg.src} (#${srcIndex}) → ${msg.dst} depth ${depth.toFixed(2)}`
      );
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
      this.lastOscPushKey = '';
      this.view?.webview.postMessage({ type: 'routeCleared', dst: msg.dst });
      this.vm?.output.appendLine(`[mod] cleared ${msg.dst}`);
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
      const routes = readModRoutes(this.workspaceState, this.globalState);
      let existing = routes.find((r) => r.dst === msg.dst);
      if (!existing && msg.moduleFile && msg.src) {
        existing = {
          dst: msg.dst,
          src: msg.src,
          depth,
          moduleFile: normalizeModModuleFile(msg.moduleFile),
        };
        routes.push(existing);
      } else if (existing) {
        existing.depth = depth;
      }
      if (existing) {
        void writeModRoutes(this.workspaceState, routes, this.globalState);
        this.patchModelDepth(msg.dst, depth);
      }
      const srcEntry = this.model.sources.find(
        (s) => s.name === (existing?.src ?? msg.src)
      );
      const srcIndex = srcEntry?.index ?? 0;
      if (srcIndex >= 1) {
        this.osc.sendInt(host, oscPort, `/chuck/${target.srcName}`, srcIndex);
      }
      this.osc.sendFloat(host, oscPort, `/chuck/${target.depthName}`, depth);
    }
  }

  /** Update cached depth without re-rendering the webview (keeps sliders draggable). */
  private patchModelDepth(dst: string, depth: number): void {
    for (const mod of this.model.modules) {
      const route = mod.routes.find((r) => r.dst === dst);
      if (route) {
        route.depth = depth;
      }
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

  private applyRouteToModel(route: ModRouteState): void {
    const srcEntry = this.model.sources.find((s) => s.name === route.src);
    const active: ModRouteActive = {
      dst: route.dst,
      src: route.src,
      srcIndex: srcEntry?.index ?? 0,
      depth: route.depth,
      isDefault: false,
    };
    for (const mod of this.model.modules) {
      if (!mod.targets.some((t) => t.modName === route.dst)) {
        continue;
      }
      mod.routes = mod.routes.filter((r) => r.dst !== route.dst);
      mod.routes.push(active);
      break;
    }
  }

  private notifyRoutePatched(route: ModRouteState): void {
    this.view?.webview.postMessage({
      type: 'routePatched',
      dst: route.dst,
      src: route.src,
      depth: route.depth,
    });
  }

  private async persistRoute(route: ModRouteState): Promise<void> {
    const routes = readModRoutes(this.workspaceState, this.globalState).filter(
      (r) => r.dst !== route.dst
    );
    routes.push(route);
    await writeModRoutes(this.workspaceState, routes, this.globalState);
    this.applyRouteToModel(route);
    this.notifyRoutePatched(route);
  }

  private async removeRoute(dst: string): Promise<void> {
    const routes = readModRoutes(this.workspaceState, this.globalState).filter(
      (r) => r.dst !== dst
    );
    await writeModRoutes(this.workspaceState, routes, this.globalState);
    for (const mod of this.model.modules) {
      mod.routes = mod.routes.filter((r) => r.dst !== dst);
    }
  }

  private html(webview: vscode.Webview, remountNonce: number): string {
    const bust = `${this.extensionVersion}-${WiringPanelProvider.UI_EPOCH}-${remountNonce}`;
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'wiring.css')
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'wiring.js')
    );
    const nonce = bust;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <link rel="stylesheet" href="${css}?v=${bust}" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${js}?v=${bust}"></script>
</body>
</html>`;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
