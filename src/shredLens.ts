import * as vscode from 'vscode';
import { ShredOps } from './shredOps';

/**
 * Clickable Load / Reload above the first line of a .ck file.
 */
export class ShredCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private readonly shredOps: ShredOps) {
    shredOps.onDidChange(() => this._onDidChange.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== 'file') {
      return [];
    }
    if (
      document.languageId !== 'chuck' &&
      !document.fileName.endsWith('.ck')
    ) {
      return [];
    }

    const top = new vscode.Range(0, 0, 0, 0);
    const id = this.shredOps.idForPath(document.fileName);
    if (id === undefined) {
      return [
        new vscode.CodeLens(top, {
          title: '$(add) Load',
          tooltip: 'Add this file as a shred',
          command: 'chuckLive.addShred',
        }),
      ];
    }
    return [
      new vscode.CodeLens(top, {
        title: `$(sync) Reload #${id}`,
        tooltip: 'Replace the running shred with this file',
        command: 'chuckLive.replaceShred',
      }),
    ];
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
