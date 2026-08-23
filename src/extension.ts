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
import { writeMeterFile } from './meterGen';
import { RackPanel } from './rackPanel';
import { SeqPanel } from './seqPanel';
import { MeterPanelProvider } from './meterPanel';
import { runInitProjectCommand } from './projectInit';
import { AnnotationCompletionProvider } from './annotationComplete';
import { ControlTreeProvider } from './controlView';
import { ShredCodeLensProvider } from './shredLens';
import { confirmAddGuardrails } from './shredGuardrails';

async function revealSessionViews(): Promise<void> {
  try {
    await vscode.commands.executeCommand(
      'workbench.view.extension.chuckLiveSession'
    );
  } catch {
    /* ignore */
  }
  try {
    await vscode.commands.executeCommand('chuckLive.sessionShreds.focus');
  } catch {
    /* ignore */
  }
}

export function activate(context: vscode.ExtensionContext): void {
  setExtensionPath(context.extensionPath);
  const vm = new ChuckVm();
  const shredOps = new ShredOps(vm, context.workspaceState);
  const osc = new OscClient();
  const oscServer = new OscServer();
  const statusBar = new StatusBar(vm);
  const tree = new ShredTreeProvider(shredOps);
  const control = new ControlTreeProvider(vm);
  const shredDnd = new ShredTreeDragAndDropController(shredOps);

  const loadBridge = async (
    bridgePath: string,
    source?: string
  ): Promise<boolean> => {
    if (!vm.running) {
      return false;
    }
    return shredOps.loadBridge(bridgePath, source);
  };

  const knobs = new KnobsPanelProvider(
    context.extensionUri,
    osc,
    shredOps,
    loadBridge
  );

  const rack = new RackPanel(
    context.extensionUri,
    osc,
    shredOps,
    loadBridge
  );

  const seq = new SeqPanel(
    context.extensionUri,
    osc,
    shredOps,
    loadBridge
  );

  const meter = new MeterPanelProvider(context.extensionUri, oscServer);

  context.subscriptions.push(
    vm,
    osc,
    oscServer,
    statusBar,
    { dispose: () => rack.dispose() },
    { dispose: () => seq.dispose() },
    { dispose: () => meter.dispose() },
    vscode.window.createTreeView('chuckLive.sessionShreds', {
      treeDataProvider: tree,
      dragAndDropController: shredDnd,
      showCollapseAll: false,
    }),
    vscode.window.registerTreeDataProvider('chuckLive.control', control),
    vscode.window.registerWebviewViewProvider(KnobsPanelProvider.viewType, knobs),
    vscode.window.registerWebviewViewProvider(MeterPanelProvider.viewType, meter),
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
        meter.reset();
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
      // Do NOT call seq.ensureBridge here — loadBridge fires onDidChange and loops.
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
      const bridge = writeBridgeFile(anns, oscPort);
      try {
        await shredOps.loadBridge(bridge.path, bridge.source);
      } catch (err) {
        vscode.window.showWarningMessage(`Bridge load: ${err}`);
      }

      const meterFile = writeMeterFile(meterPort);
      try {
        await shredOps.loadMeter(meterFile.path, meterFile.source);
      } catch (err) {
        vscode.window.showWarningMessage(`Meter load: ${err}`);
      }

      await knobs.refresh(false);
      if (rack.isOpen) {
        void rack.refresh(false);
      }
      await revealSessionViews();
      vscode.window.showInformationMessage('ChucK VM started');
    }),

    cmd('chuckLive.stopVm', async () => {
      await vm.stop();
      meter.reset();
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
        await knobs.refresh(true);
        if (rack.isOpen) {
          void rack.refresh(false);
        }
        if (seq.isOpen) {
          void seq.ensureBridge().then(() => seq.pushTargets());
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
        await knobs.refresh(true);
        if (rack.isOpen) {
          void rack.refresh(false);
        }
        if (seq.isOpen) {
          void seq.ensureBridge().then(() => seq.pushTargets());
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
        }));
        const chosen = await vscode.window.showQuickPick(picks, {
          placeHolder: 'Remove shred',
        });
        if (!chosen) {
          return;
        }
        id = chosen.id;
      }
      try {
        await shredOps.remove(id);
        await knobs.refresh(true);
        if (rack.isOpen) {
          void rack.refresh(false);
        }
        if (seq.isOpen) {
          void seq.ensureBridge().then(() => seq.pushTargets());
        }
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),

    cmd('chuckLive.removeAll', async () => {
      try {
        await shredOps.removeAll();
        await knobs.refresh(true);
        if (rack.isOpen) {
          void rack.refresh(false);
        }
        if (seq.isOpen) {
          void seq.ensureBridge().then(() => seq.pushTargets());
        }
        meter.reset();
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
        if (rack.isOpen) {
          void rack.refresh(false);
        }
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed && (ed.document.languageId === 'chuck' || ed.document.fileName.endsWith('.ck'))) {
        void knobs.refresh(false);
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
