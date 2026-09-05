import * as vscode from 'vscode';
import { getConfig } from './config';
import {
  deleteKnobPreset,
  listKnobPresets,
  readKnobPreset,
  sanitizeKnobPresetName,
  writeKnobPreset,
} from './knobPresets';
import { OscClient } from './oscClient';
import { OscServer, OscMessage } from './oscServer';
import { ShredOps } from './shredOps';
import { buildRackModules, RackModule } from './rackModel';
import { writeBridgeFile, LIVE_TRANSPORT } from './bridgeGen';
import { collectModTargetsForBridge } from './modModel';
import { collectAnnotations } from './knobsPanel';

/**
 * Full-page Eurorack-style case: one faceplate per loaded shred.
 * Knobs/buttons send OSC like the sidebar knobs panel.
 * Master module shows L/R VU.
 */
export class RackPanel {
  private panel: vscode.WebviewPanel | undefined;
  private modules: RackModule[] = [];
  private liveBpm = 120;
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
    this.panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    void this.refresh(true);
  }

  get isOpen(): boolean {
    return !!this.panel;
  }

  /** Clear VU when VM stops. */
  resetMeter(): void {
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
    await this.postRack();

    if (reloadBridge) {
      const anns = collectAnnotations(this.shredOps);
      const { oscPort } = getConfig();
      const modTargets = collectModTargetsForBridge(this.shredOps);
      const bridge = writeBridgeFile(anns, oscPort, modTargets);
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

  private async postRack(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const presetLists: Record<string, string[]> = {};
    for (const mod of this.modules) {
      if (mod.isTransport) {
        continue;
      }
      presetLists[mod.file] = await listKnobPresets(mod.file);
    }
    this.panel.webview.postMessage({
      type: 'setRack',
      modules: this.modules,
      presetLists,
    });
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
  }

  private async onMessage(msg: {
    type: string;
    name?: string;
    value?: number;
    moduleFile?: string;
    values?: Record<string, number>;
  }): Promise<void> {
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
      await this.postRack();
    } else if (msg.type === 'listKnobPresets' && msg.moduleFile) {
      await this.sendPresetList(msg.moduleFile);
    } else if (
      msg.type === 'saveKnobPreset' &&
      msg.moduleFile &&
      msg.name &&
      msg.values
    ) {
      await this.handleSavePreset(msg.moduleFile, msg.name, msg.values, false);
    } else if (
      msg.type === 'updateKnobPreset' &&
      msg.moduleFile &&
      msg.name &&
      msg.values
    ) {
      await this.handleSavePreset(msg.moduleFile, msg.name, msg.values, true);
    } else if (
      msg.type === 'deleteKnobPreset' &&
      msg.moduleFile &&
      msg.name
    ) {
      await this.handleDeletePreset(msg.moduleFile, msg.name);
    } else if (
      msg.type === 'loadKnobPreset' &&
      msg.moduleFile &&
      msg.name
    ) {
      await this.handleLoadPreset(msg.moduleFile, msg.name);
    } else if (msg.type === 'requestSaveKnobPreset' && msg.moduleFile && msg.values) {
      await this.promptSavePreset(msg.moduleFile, msg.values);
    }
  }

  private async sendPresetList(moduleFile: string): Promise<void> {
    const names = await listKnobPresets(moduleFile);
    this.panel?.webview.postMessage({
      type: 'knobPresets',
      moduleFile,
      names,
    });
  }

  private async promptSavePreset(
    moduleFile: string,
    values: Record<string, number>
  ): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Preset name (saved under .chuck-live/knob-presets/)',
      placeHolder: 'warm-bass',
      validateInput: (v) =>
        sanitizeKnobPresetName(v)
          ? undefined
          : 'Use letters, digits, . _ - only',
    });
    if (!name) {
      return;
    }
    await this.handleSavePreset(moduleFile, name, values, false);
  }

  private async handleSavePreset(
    moduleFile: string,
    name: string,
    values: Record<string, number>,
    isUpdate: boolean
  ): Promise<void> {
    const safe = sanitizeKnobPresetName(name);
    if (!safe) {
      return;
    }
    if (isUpdate) {
      const existing = await readKnobPreset(moduleFile, safe);
      if (!existing) {
        void vscode.window.showErrorMessage(`Preset “${safe}” not found.`);
        return;
      }
    }
    const ok = await writeKnobPreset(moduleFile, safe, values);
    if (ok) {
      await this.sendPresetList(moduleFile);
      this.panel?.webview.postMessage({
        type: 'knobPresetSaved',
        moduleFile,
        name: safe,
      });
    }
  }

  private async handleDeletePreset(
    moduleFile: string,
    name: string
  ): Promise<void> {
    const safe = sanitizeKnobPresetName(name);
    if (!safe) {
      return;
    }
    const pick = await vscode.window.showWarningMessage(
      `Delete knob preset “${safe}”?`,
      { modal: true },
      'Delete'
    );
    if (pick !== 'Delete') {
      return;
    }
    const ok = await deleteKnobPreset(moduleFile, safe);
    if (ok) {
      await this.sendPresetList(moduleFile);
      this.panel?.webview.postMessage({
        type: 'knobPresetDeleted',
        moduleFile,
        name: safe,
      });
    }
  }

  private async handleLoadPreset(
    moduleFile: string,
    name: string
  ): Promise<void> {
    const snap = await readKnobPreset(moduleFile, name);
    if (!snap) {
      void vscode.window.showErrorMessage(`Could not load preset “${name}”.`);
      return;
    }
    const mod = this.modules.find((m) => m.file === moduleFile);
    const allowed = new Set(
      (mod?.knobs ?? [])
        .filter((k) => k.kind === 'knob' && (k.type === 'float' || k.type === 'int'))
        .map((k) => k.name)
    );
    const values: Record<string, number> = {};
    for (const [key, val] of Object.entries(snap.values)) {
      if (allowed.has(key)) {
        values[key] = val;
      }
    }
    this.applyPresetValues(values);
    this.panel?.webview.postMessage({
      type: 'applyKnobPreset',
      moduleFile,
      name: snap.name,
      values,
    });
  }

  private applyPresetValues(values: Record<string, number>): void {
    const { oscPort } = getConfig();
    for (const [name, value] of Object.entries(values)) {
      this.osc.sendFloat('127.0.0.1', oscPort, `/chuck/${name}`, value);
      if (name === LIVE_TRANSPORT.bpm) {
        const bpm = Math.max(40, Math.min(200, value));
        this.liveBpm = bpm;
        this.onLiveBpmChange?.(bpm);
      }
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
