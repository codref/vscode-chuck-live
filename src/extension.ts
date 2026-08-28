import * as vscode from 'vscode';
import * as path from 'path';
import { ChuckVm } from './chuckVm';
import { getConfig, setExtensionPath } from './config';
import { OscClient } from './oscClient';
import { OscServer } from './oscServer';
import {
  ShredOps,
  ShredTreeProvider,
  ShredTreeDragAndDropController,
  ShredInfo,
  isFileModule,
} from './shredOps';
import { StatusBar } from './statusBar';
import { KnobsPanelProvider, collectAnnotations } from './knobsPanel';
import { writeBridgeFile } from './bridgeGen';
import { writeMeterFile, meterTapName, MeterTap } from './meterGen';
import { writeTransportFile } from './transportGen';
import { writeModMatrixFile } from './modGen';
import {
  collectModCodegen,
  collectModTargetsForBridge,
} from './modModel';
import { buildModulesFromShreds } from './rackModel';
import { RackPanel } from './rackPanel';
import { SeqPanel } from './seqPanel';
import { WiringPanelProvider } from './wiringPanel';
import { runInitProjectCommand } from './projectInit';
import { AnnotationCompletionProvider } from './annotationComplete';
import { ControlTreeProvider } from './controlView';
import { ShredCodeLensProvider } from './shredLens';
import { confirmAddGuardrails } from './shredGuardrails';
import { OscMessage } from './oscServer';

async function revealSessionViews(): Promise<void> {
  // Cursor/VS Code can leave these promises pending forever — never block Start on them.
  const soft = (cmd: string): void => {
    void Promise.race([
      vscode.commands.executeCommand(cmd),
      new Promise<void>((resolve) => setTimeout(resolve, 1200)),
    ]).catch(() => {
      /* ignore */
    });
  };
  soft('workbench.view.extension.chuckLiveSession');
  soft('chuckLive.sessionShreds.focus');
}

export function activate(context: vscode.ExtensionContext): void {
  setExtensionPath(context.extensionPath);
  const version = String(context.extension.packageJSON.version ?? '');
  const vm = new ChuckVm();
  vm.output.appendLine(`[chuck-live] ${version}`);
  const shredOps = new ShredOps(vm, context.workspaceState);
  const osc = new OscClient();
  const oscServer = new OscServer();
  const statusBar = new StatusBar(vm, version);
  const tree = new ShredTreeProvider(shredOps);
  const control = new ControlTreeProvider(vm, version);
  const shredDnd = new ShredTreeDragAndDropController(shredOps);

  const loadBridge = async (
    bridgePath: string,
    source?: string
  ): Promise<boolean> => {
    if (!vm.running) {
      return false;
    }
    const changed = await shredOps.loadBridge(bridgePath, source);
    if (changed) {
      seq.republishTransportOsc();
    }
    return changed;
  };

  const knobs = new KnobsPanelProvider(
    context.extensionUri,
    osc,
    shredOps,
    loadBridge
  );

  const wiring = new WiringPanelProvider(
    context.extensionUri,
    osc,
    shredOps,
    context.workspaceState
  );

  let seq!: SeqPanel;

  const rack = new RackPanel(
    context.extensionUri,
    osc,
    shredOps,
    oscServer,
    loadBridge,
    (bpm) => seq.setMasterBpm(bpm)
  );

  const reloadMeter = async (): Promise<boolean> => {
    if (!vm.running) {
      return false;
    }
    const { meterPort } = getConfig();
    const modules = buildModulesFromShreds(shredOps);
    const taps: MeterTap[] = modules
      .filter((m) => !m.isMaster && !m.isTransport)
      .map((m) => ({
        shredId: m.id,
        name: meterTapName(m.file || m.title),
      }));
    const meterFile = writeMeterFile(meterPort, taps);
    try {
      const loaded = await shredOps.loadMeter(meterFile.path, meterFile.source);
      if (loaded) {
        rack.setPeakIds(taps.map((t) => t.shredId));
      }
      return loaded;
    } catch (err) {
      vm.output.appendLine(`[warn] meter load: ${err}`);
      return false;
    }
  };

  const loadTransport = async (
    transportPath: string,
    source?: string,
    force?: boolean
  ): Promise<boolean> => {
    if (!vm.running) {
      return false;
    }
    const loaded = await shredOps.loadTransport(transportPath, source, force);
    if (loaded) {
      vm.output.appendLine('[ok] transport reloaded');
    }
    return loaded;
  };

  const reloadTransportIdle = async (): Promise<void> => {
    if (!vm.running) {
      return;
    }
    const { meterPort } = getConfig();
    const file = writeTransportFile({
      bpm: 120,
      step: 0,
      running: false,
      swingEnabled: false,
      meterPort,
      tracks: [],
    });
    try {
      await shredOps.loadTransport(file.path, file.source);
    } catch (err) {
      vm.output.appendLine(`[warn] transport load: ${err}`);
    }
  };

  /** Coalesce bridge / meter / mod-matrix OTF reloads after shred list changes. */
  let shredFxTimer: ReturnType<typeof setTimeout> | undefined;
  let shredFxWantBridge = false;
  let shredFxRunning = false;

  const runShredSideEffects = async (): Promise<void> => {
    if (!vm.running) {
      shredFxWantBridge = false;
      return;
    }
    if (shredFxRunning) {
      scheduleShredSideEffects(shredFxWantBridge);
      return;
    }
    shredFxRunning = true;
    const wantBridge = shredFxWantBridge;
    shredFxWantBridge = false;
    try {
      if (wantBridge) {
        await knobs.refresh(true);
        if (seq.isOpen) {
          seq.pushTargets();
          if (seq.hasRunningTracks()) {
            seq.republishTransportOsc();
          }
        }
      }
      await reloadMeter();
      await reloadModMatrix();
      refreshWiringUi();
    } finally {
      shredFxRunning = false;
      if (shredFxWantBridge) {
        scheduleShredSideEffects(true);
      }
    }
  };

  const scheduleShredSideEffects = (bridge = false): void => {
    if (bridge) {
      shredFxWantBridge = true;
    }
    if (shredFxTimer !== undefined) {
      clearTimeout(shredFxTimer);
    }
    shredFxTimer = setTimeout(() => {
      shredFxTimer = undefined;
      void runShredSideEffects();
    }, 120);
  };

  const reloadModMatrix = async (): Promise<boolean> => {
    if (!vm.running) {
      return false;
    }
    const codegen = collectModCodegen(shredOps, context.workspaceState);
    if (!codegen.targets.length) {
      return false;
    }
    const modFile = writeModMatrixFile(codegen);
    try {
      await shredOps.loadModMatrix(modFile.path, modFile.source);
    } catch (err) {
      vm.output.appendLine(`[warn] mod-matrix load: ${err}`);
      return false;
    }
    return true;
  };

  const refreshWiringUi = (): void => {
    void wiring.refresh();
  };

  seq = new SeqPanel(
    context.extensionUri,
    osc,
    shredOps,
    loadBridge,
    loadTransport,
    (bpm) => rack.setLiveBpm(bpm)
  );

  const onMeterOsc = (msg: OscMessage): void => {
    if (msg.address === '/chuck/live_playhead' && msg.floats.length >= 1) {
      const running =
        msg.floats.length >= 2 ? msg.floats[1] : undefined;
      seq.onPlayheadOsc(msg.floats[0], running);
    }
  };
  oscServer.on('message', onMeterOsc);

  context.subscriptions.push(
    vm,
    osc,
    oscServer,
    statusBar,
    { dispose: () => rack.dispose() },
    { dispose: () => seq.dispose() },
    { dispose: () => oscServer.off('message', onMeterOsc) },
    vscode.window.createTreeView('chuckLive.sessionShreds', {
      treeDataProvider: tree,
      dragAndDropController: shredDnd,
      showCollapseAll: false,
    }),
    vscode.window.registerTreeDataProvider('chuckLive.control', control),
    vscode.window.registerWebviewViewProvider(KnobsPanelProvider.viewType, knobs),
    vscode.window.registerWebviewViewProvider(WiringPanelProvider.viewType, wiring),
    vscode.languages.registerCompletionItemProvider(
      { language: 'chuck' },
      new AnnotationCompletionProvider(),
      '@',
      ' ',
      '='
    ),
    vscode.languages.registerCodeLensProvider(
      [{ language: 'chuck' }, { pattern: '**/*.ck' }],
      new ShredCodeLensProvider(shredOps)
    ),
    vm.onStatusChange((on) => {
      if (!on) {
        shredOps.clearLocal();
        rack.resetMeter();
        seq.resetTransportTracking();
        void wiring.refresh();
      }
      control.refresh();
      if (rack.isOpen) {
        void rack.refresh(false);
      }
    }),
    shredOps.onDidChange(() => {
      if (rack.isOpen) {
        void rack.refresh(false);
      }
      // User-shred changes need bridge + meter refresh (managed shreds use silent remember).
      scheduleShredSideEffects(true);
    })
  );

  const cmd = (
    id: string,
    fn: (...args: never[]) => unknown
  ): vscode.Disposable =>
    vscode.commands.registerCommand(id, fn as (...args: unknown[]) => unknown);

  context.subscriptions.push(
    cmd('chuckLive.startVm', async () => {
      await vm.start();
      if (!vm.running) {
        return;
      }
      const { oscPort, meterPort } = getConfig();
      oscServer.listen(meterPort);

      // Load OSC bridge from current annotations (may be empty at first).
      const anns = collectAnnotations(shredOps);
      const modTargets = collectModTargetsForBridge(shredOps);
      const bridge = writeBridgeFile(anns, oscPort, modTargets);
      let bridgeOk = false;
      for (let attempt = 1; attempt <= 2 && !bridgeOk; attempt++) {
        try {
          await shredOps.loadBridge(bridge.path, bridge.source);
          bridgeOk = true;
          vm.output.appendLine('[ok] bridge loaded');
        } catch (err) {
          if (attempt < 2) {
            vm.output.appendLine(`[warn] bridge load retry: ${err}`);
            await new Promise((r) => setTimeout(r, 200));
          } else {
            vscode.window.showWarningMessage(`Bridge load: ${err}`);
            vm.output.appendLine(`[warn] bridge load: ${err}`);
          }
        }
      }

      try {
        await reloadTransportIdle();
        seq.resetTransportTracking();
        seq.seedTransportDefaults(120);
        rack.setLiveBpm(120);
        vm.output.appendLine('[ok] transport loaded');
      } catch (err) {
        vscode.window.showWarningMessage(`Transport load: ${err}`);
        vm.output.appendLine(`[warn] transport load: ${err}`);
      }

      try {
        const loaded = await reloadModMatrix();
        if (loaded) {
          vm.output.appendLine('[ok] mod-matrix loaded');
        }
      } catch (err) {
        vscode.window.showWarningMessage(`Mod matrix load: ${err}`);
        vm.output.appendLine(`[warn] mod-matrix load: ${err}`);
      }

      try {
        const meterLoaded = await reloadMeter();
        if (meterLoaded) {
          vm.output.appendLine('[ok] meter loaded');
        } else {
          vm.output.appendLine('[warn] meter not loaded');
        }
      } catch (err) {
        vscode.window.showWarningMessage(`Meter load: ${err}`);
        vm.output.appendLine(`[warn] meter load: ${err}`);
      }

      void knobs.refresh(false);
      refreshWiringUi();
      if (rack.isOpen) {
        void rack.refresh(false);
      }
      tree.refresh();
      control.refresh();
      void revealSessionViews();
      vm.output.appendLine('[ok] VM start complete');
      await shredOps.reconcileShredIds();
      vscode.window.showInformationMessage('ChucK VM started');
    }),

    cmd('chuckLive.stopVm', async () => {
      await vm.stop();
      rack.resetMeter();
      vscode.window.showInformationMessage('ChucK VM stopped');
    }),

    cmd('chuckLive.addShred', async () => {
      const file = await activeChuckFile();
      if (!file) {
        return;
      }
      try {
        if (!(await confirmAddGuardrails(file, shredOps))) {
          return;
        }
        await shredOps.add(file);
        scheduleShredSideEffects(true);
        if (rack.isOpen) {
          void rack.refresh(false);
        }
        vscode.window.showInformationMessage(`Added ${path.basename(file)}`);
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),

    cmd('chuckLive.runShred', () =>
      vscode.commands.executeCommand('chuckLive.replaceShred')
    ),

    cmd('chuckLive.replaceShred', async (item?: ShredInfo) => {
      let file: string | undefined;
      if (
        item &&
        typeof item.id === 'number' &&
        item.source &&
        isFileModule(item.source, {
          isBridge: item.isBridge,
          isMeter: item.isMeter,
          isTransport: item.isTransport,
          isModMatrix: item.isModMatrix,
        })
      ) {
        file = item.source;
        if (getConfig().saveBeforeAdd) {
          const doc = vscode.workspace.textDocuments.find(
            (d) => path.resolve(d.fileName) === path.resolve(file!)
          );
          if (doc?.isDirty) {
            await doc.save();
          }
        }
      } else {
        file = await activeChuckFile();
      }
      if (!file) {
        return;
      }
      try {
        if (!(await confirmAddGuardrails(file, shredOps))) {
          return;
        }
        const existing = shredOps.idForPath(file);
        if (existing === undefined) {
          await shredOps.add(file);
          vscode.window.showInformationMessage(
            `Added ${path.basename(file)} (no prior shred)`
          );
        } else {
          await shredOps.replace(file, existing);
          vscode.window.showInformationMessage(
            `Reloaded shred #${existing}`
          );
        }
        scheduleShredSideEffects(true);
        if (rack.isOpen) {
          void rack.refresh(false);
        }
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),

    cmd('chuckLive.removeShred', async (item?: ShredInfo) => {
      let id = item?.id;
      if (id === undefined) {
        const picks = shredOps.list().map((s) => ({
          label: `#${s.id} ${path.basename(s.source)}`,
          id: s.id,
          info: s,
        }));
        const chosen = await vscode.window.showQuickPick(picks, {
          placeHolder: 'Remove shred',
        });
        if (!chosen) {
          return;
        }
        id = chosen.id;
        item = chosen.info;
      }
      try {
        await shredOps.remove(id);
        scheduleShredSideEffects(!item?.isBridge);
        if (rack.isOpen) {
          void rack.refresh(false);
        }
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),

    cmd('chuckLive.removeAll', async () => {
      try {
        await shredOps.removeAll();
        rack.resetMeter();
        scheduleShredSideEffects(true);
        if (rack.isOpen) {
          void rack.refresh(false);
        }
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),

    cmd('chuckLive.refreshStatus', async () => {
      try {
        await shredOps.status();
        tree.refresh();
        control.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),

    cmd('chuckLive.refreshKnobs', async () => {
      await knobs.refresh(true);
    }),

    cmd('chuckLive.openRack', () => {
      rack.open();
    }),

    cmd('chuckLive.openSequencer', () => {
      seq.open();
    }),

    cmd('chuckLive.showWiring', async () => {
      await vscode.commands.executeCommand(
        'workbench.view.extension.chuckLivePanel'
      );
    }),

    cmd('chuckLive.showSession', async () => {
      await revealSessionViews();
    }),

    cmd('chuckLive.initProject', async () => {
      await runInitProjectCommand(context.extensionPath);
    }),

    cmd('chuckLive.initProjectForce', async () => {
      await runInitProjectCommand(context.extensionPath, { force: true });
    })
  );

  // Keep knobs / rack in sync when editing annotations / switching files
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'chuck' || doc.fileName.endsWith('.ck')) {
        // UI only — avoid bridge reload spam while sequencer runs
        void knobs.refresh(false);
        refreshWiringUi();
        if (rack.isOpen) {
          void rack.refresh(false);
        }
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed && (ed.document.languageId === 'chuck' || ed.document.fileName.endsWith('.ck'))) {
        void knobs.refresh(false);
        refreshWiringUi();
      }
    })
  );
}

export function deactivate(): void {
  /* disposables handle cleanup */
}

async function activeChuckFile(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return undefined;
  }
  const doc = editor.document;
  if (doc.languageId !== 'chuck' && !doc.fileName.endsWith('.ck')) {
    vscode.window.showWarningMessage('Active file is not a .ck file');
    return undefined;
  }
  if (getConfig().saveBeforeAdd && doc.isDirty) {
    await doc.save();
  }
  return doc.fileName;
}
