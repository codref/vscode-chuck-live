import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChuckVm } from './chuckVm';
import { getConfig } from './config';
import { FavoritesStore } from './favorites';
import { ShredOps } from './shredOps';

export type ControlItem =
  | { kind: 'vm'; id: string; label: string; description?: string }
  | {
      kind: 'favorite';
      id: string;
      filePath: string;
      label: string;
      description?: string;
      missing: boolean;
      loaded: boolean;
    };

/**
 * Session Control tree: VM status + favorite shreds (empty → viewsWelcome help).
 */
export class ControlTreeProvider implements vscode.TreeDataProvider<ControlItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ControlItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly vm: ChuckVm,
    private readonly version: string,
    private readonly favorites: FavoritesStore,
    private readonly shredOps: ShredOps
  ) {
    vm.onStatusChange(() => this._onDidChangeTreeData.fire(undefined));
    favorites.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
    shredOps.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(el: ControlItem): vscode.TreeItem {
    if (el.kind === 'vm') {
      const item = new vscode.TreeItem(
        el.label,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = el.description;
      item.iconPath = new vscode.ThemeIcon('play-circle');
      item.contextValue = 'chuckControl';
      return item;
    }

    const item = new vscode.TreeItem(
      el.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = el.description;
    item.tooltip = el.missing
      ? `${el.filePath}\n(file missing)`
      : `${el.filePath}\nClick to open · star actions load / unfavorite`;
    item.contextValue = el.loaded ? 'chuckFavoriteLoaded' : 'chuckFavorite';
    item.iconPath = new vscode.ThemeIcon(
      el.missing ? 'warning' : el.loaded ? 'star-full' : 'star-empty'
    );
    if (!el.missing) {
      try {
        item.resourceUri = vscode.Uri.file(el.filePath);
        item.command = {
          command: 'vscode.open',
          title: 'Open',
          arguments: [vscode.Uri.file(el.filePath)],
        };
      } catch {
        /* ignore */
      }
    }
    return item;
  }

  getChildren(): ControlItem[] {
    const items: ControlItem[] = [];

    if (this.vm.running) {
      const { otfPort } = getConfig();
      const version = this.version;
      items.push({
        kind: 'vm',
        id: 'vm',
        label: 'VM running',
        description: version
          ? `v${version} · OTF :${otfPort}`
          : `OTF :${otfPort}`,
      });
    }

    for (const filePath of this.favorites.list()) {
      const missing = !fs.existsSync(filePath);
      const loaded = this.shredOps.idForPath(filePath) !== undefined;
      const base = path.basename(filePath);
      items.push({
        kind: 'favorite',
        id: `fav:${filePath}`,
        filePath,
        label: missing ? `${base} (missing)` : base,
        description: loaded
          ? `#${this.shredOps.idForPath(filePath)}`
          : path.dirname(filePath),
        missing,
        loaded,
      });
    }

    return items;
  }
}
