import * as vscode from 'vscode';
import * as path from 'path';
import { ChuckVm } from './chuckVm';
import { getConfig, setExtensionPath } from './config';
import { OscClient } from './oscClient';
import { ShredOps, ShredTreeProvider, ShredInfo } from './shredOps';
import { StatusBar } from './statusBar';
import { KnobsPanelProvider, collectAnnotations } from './knobsPanel';
import { writeBridgeFile } from './bridgeGen';
import { RackPanel } from './rackPanel';
import { SeqPanel } from './seqPanel';

export function activate(context: vscode.ExtensionContext): void {
  setExtensionPath(context.extensionPath);
  const vm = new ChuckVm();
  const shredOps = new ShredOps(vm);
  const osc = new OscClient();
  const statusBar = new StatusBar(vm);
  const tree = new ShredTreeProvider(shredOps);

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

  context.subscriptions.push(
    vm,
    osc,
    statusBar,
    { dispose: () => rack.dispose() },
    { dispose: () => seq.dispose() },
    vscode.window.registerTreeDataProvider('chuckLive.shreds', tree),
    vscode.window.registerWebviewViewProvider(KnobsPanelProvider.viewType, knobs),
    vm.onStatusChange((on) => {
      if (!on) {
        shredOps.clearLocal();
      }
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
      // Load OSC bridge from current annotations (may be empty at first).
      const anns = collectAnnotations(shredOps);
      const { oscPort } = getConfig();
      const bridge = writeBridgeFile(anns, oscPort);
      try {
        await shredOps.loadBridge(bridge.path, bridge.source);
      } catch (err) {
        vscode.window.showWarningMessage(`Bridge load: ${err}`);
      }
      await knobs.refresh(false);
      if (rack.isOpen) {
        void rack.refresh(false);
      }
      vscode.window.showInformationMessage('ChucK VM started');
    }),

    cmd('chuckLive.stopVm', async () => {
      await vm.stop();
      vscode.window.showInformationMessage('ChucK VM stopped');
    }),

    cmd('chuckLive.addShred', async () => {
      const file = await activeChuckFile();
      if (!file) {
        return;
      }
      try {
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

    cmd('chuckLive.replaceShred', async () => {
      const file = await activeChuckFile();
      if (!file) {
        return;
      }
      try {
        const existing = shredOps.idForPath(file);
        if (existing === undefined) {
          await shredOps.add(file);
          vscode.window.showInformationMessage(
            `Added ${path.basename(file)} (no prior shred)`
          );
        } else {
          await shredOps.replace(file, existing);
          vscode.window.showInformationMessage(
            `Replaced shred #${existing}`
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

    cmd('chuckLive.refreshStatus', async () => {
      try {
        await shredOps.status();
        tree.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    }),

    cmd('chuckLive.refreshKnobs', async () => {
      await knobs.refresh(true);
    }),

    cmd('chuckLive.toggleKnobsScope', () => {
      knobs.toggleScope();
    }),

    cmd('chuckLive.openRack', () => {
      rack.open();
    }),

    cmd('chuckLive.openSequencer', () => {
      seq.open();
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
