import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  Annotation,
  SeqTarget,
  mergeAnnotations,
  parseAnnotations,
  seqTargetsFromAnnotations,
} from './annotations';
import { getConfig } from './config';
import { OscClient } from './oscClient';
import { writeBridgeFile } from './bridgeGen';
import { ShredOps, isFileModule } from './shredOps';
import { resolveChuckPath } from './chuckPaths';

/** How the knobs panel lists controls. */
export type KnobsScope = 'current' | 'all';

export interface KnobGroup {
  /** Absolute path, or empty for untitled */
  file: string;
  title: string;
  knobs: Annotation[];
}

/**
 * Sidebar webview: dials/sliders/buttons from annotations.
 * Scope: current file only, or all sources grouped by file.
 * OSC bridge always receives the union of all knobs (so hidden groups still work).
 */
export class KnobsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'chuckLive.knobs';

  private view?: vscode.WebviewView;
  private groups: KnobGroup[] = [];
  private allForBridge: Annotation[] = [];
  private scope: KnobsScope = 'current';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly osc: OscClient,
    private readonly shredOps: ShredOps,
    private readonly onBridgeNeeded: (
      bridgePath: string,
      source?: string
    ) => Promise<boolean | void>
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
    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    void this.refresh();
  }

  setScope(scope: KnobsScope): void {
    this.scope = scope;
    void this.refresh(false);
  }

  toggleScope(): void {
    this.setScope(this.scope === 'current' ? 'all' : 'current');
  }

  getScope(): KnobsScope {
    return this.scope;
  }

  /** Re-scan sources; update UI. Optionally regenerate OSC bridge from *all* knobs. */
  async refresh(reloadBridge = true): Promise<Annotation[]> {
    const sources = collectAnnotationSources(this.shredOps);
    this.allForBridge = mergeAnnotations(sources.map((s) => s.annotations));
    this.groups = groupsForScope(sources, this.scope);

    this.view?.webview.postMessage({
      type: 'setKnobs',
      scope: this.scope,
      groups: this.groups,
    });

    if (reloadBridge) {
      const { oscPort } = getConfig();
      const bridge = writeBridgeFile(this.allForBridge, oscPort);
      try {
        await this.onBridgeNeeded(bridge.path, bridge.source);
      } catch (err) {
        console.warn('bridge reload skipped:', err);
      }
    }
    return this.allForBridge;
  }

  private onMessage(msg: {
    type: string;
    name?: string;
    value?: number;
    scope?: KnobsScope;
  }): void {
    const { oscPort } = getConfig();
    if (msg.type === 'knob' && msg.name !== undefined && msg.value !== undefined) {
      this.osc.sendFloat('127.0.0.1', oscPort, `/chuck/${msg.name}`, msg.value);
    } else if (msg.type === 'button' && msg.name !== undefined) {
      this.osc.sendInt('127.0.0.1', oscPort, `/chuck/${msg.name}`, 1);
    } else if (msg.type === 'setScope' && (msg.scope === 'current' || msg.scope === 'all')) {
      this.scope = msg.scope;
      void this.refresh(false);
    } else if (msg.type === 'ready') {
      this.view?.webview.postMessage({
        type: 'setKnobs',
        scope: this.scope,
        groups: this.groups,
      });
    }
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'knobs.css')
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'knobs.js')
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
  <div id="toolbar" class="toolbar"></div>
  <div id="root">
    <p class="hint">Annotate with <code>// @knob</code>, <code>// @slider</code>, or <code>// @button</code>.</p>
  </div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

export interface AnnotationSource {
  file: string;
  annotations: Annotation[];
}

/** Open .ck editors + shred-mapped files (each keeps its own annotations). */
export function collectAnnotationSources(
  shredOps: ShredOps
): AnnotationSource[] {
  const sources: AnnotationSource[] = [];
  const seen = new Set<string>();

  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId !== 'chuck' && !doc.fileName.endsWith('.ck')) {
      continue;
    }
    const abs = path.resolve(doc.fileName);
    seen.add(abs);
    const annotations = parseAnnotations(doc.getText(), doc.fileName);
    if (annotations.length) {
      sources.push({ file: abs, annotations });
    }
  }

  for (const shred of shredOps.list()) {
    if (shred.isBridge || !isFileModule(shred.source, shred.isBridge)) {
      continue;
    }
    const abs = resolveChuckPath(shred.source);
    if (!path.isAbsolute(abs) || seen.has(abs)) {
      continue;
    }
    try {
      const text = fs.readFileSync(abs, 'utf8');
      const annotations = parseAnnotations(text, abs);
      if (annotations.length) {
        sources.push({ file: abs, annotations });
        seen.add(abs);
      }
    } catch {
      /* missing file */
    }
  }

  return sources;
}

/** Flat list for bridge / Start VM (unique names). */
export function collectAnnotations(shredOps: ShredOps): Annotation[] {
  return mergeAnnotations(
    collectAnnotationSources(shredOps).map((s) => s.annotations)
  );
}

/** Sequenceable float targets (+ preferred @seq) from loaded shreds. */
export function collectSeqTargets(shredOps: ShredOps): SeqTarget[] {
  return seqTargetsFromAnnotations(collectAnnotations(shredOps));
}

function groupsForScope(
  sources: AnnotationSource[],
  scope: KnobsScope
): KnobGroup[] {
  let filtered = sources;
  if (scope === 'current') {
    const active = vscode.window.activeTextEditor?.document;
    if (!active || (active.languageId !== 'chuck' && !active.fileName.endsWith('.ck'))) {
      return [];
    }
    const abs = path.resolve(active.fileName);
    filtered = sources.filter((s) => s.file === abs);
    // Active file may be open with no prior source entry if empty — parse live
    if (!filtered.length) {
      const annotations = parseAnnotations(active.getText(), active.fileName);
      if (annotations.length) {
        filtered = [{ file: abs, annotations }];
      }
    }
  }

  return filtered.map((s) => ({
    file: s.file,
    title: path.basename(s.file) || 'untitled',
    knobs: s.annotations,
  }));
}
