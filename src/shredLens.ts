import * as vscode from 'vscode';
import { FavoritesStore } from './favorites';
import { ShredOps } from './shredOps';

/**
 * Clickable Load / Reload / Favorite above the first line of a .ck file.
 * Cursor often has CodeLens off globally — we also force it on for ChucK
 * via configurationDefaults and show a play button in the editor title.
 */
export class ShredCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(
    private readonly shredOps: ShredOps,
    private readonly favorites: FavoritesStore
  ) {
    shredOps.onDidChange(() => this._onDidChange.fire());
    favorites.onDidChange(() => this._onDidChange.fire());
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

    const range = firstLineRange(document);
    const id = this.shredOps.idForPath(document.fileName);
    const favorited = this.favorites.has(document.fileName);
    const lenses: vscode.CodeLens[] = [];

    if (id === undefined) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: 'Load',
          tooltip: 'Add this file as a shred',
          command: 'chuckLive.addShred',
        })
      );
    } else {
      lenses.push(
        new vscode.CodeLens(range, {
          title: `Reload #${id}`,
          tooltip: 'Replace the running shred with this file',
          command: 'chuckLive.replaceShred',
        })
      );
    }

    lenses.push(
      new vscode.CodeLens(range, {
        title: favorited ? 'Unfavorite' : 'Favorite',
        tooltip: favorited
          ? 'Remove from Control favorites'
          : 'Add to Control favorites for quick load',
        command: 'chuckLive.toggleFavorite',
      })
    );

    return lenses;
  }

  resolveCodeLens(codeLens: vscode.CodeLens): vscode.CodeLens {
    return codeLens;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

function firstLineRange(document: vscode.TextDocument): vscode.Range {
  const n = Math.min(document.lineCount, 8);
  for (let i = 0; i < n; i++) {
    const line = document.lineAt(i);
    if (line.text.trim().length > 0) {
      return line.range;
    }
  }
  return new vscode.Range(0, 0, 0, 0);
}
