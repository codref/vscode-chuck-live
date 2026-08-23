import * as vscode from 'vscode';
import { ChuckVm } from './chuckVm';
import { getConfig } from './config';

interface ControlItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
}

/**
 * Session Control tree: VM status when running; empty → viewsWelcome help.
 */
export class ControlTreeProvider implements vscode.TreeDataProvider<ControlItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ControlItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly vm: ChuckVm) {
    vm.onStatusChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(el: ControlItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      el.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = el.description;
    item.iconPath = new vscode.ThemeIcon(el.icon);
    item.contextValue = 'chuckControl';
    return item;
  }

  getChildren(): ControlItem[] {
    if (!this.vm.running) {
      return [];
    }
    const { otfPort } = getConfig();
    return [
      {
        id: 'vm',
        label: 'VM running',
        description: `OTF :${otfPort}`,
        icon: 'play-circle',
      },
    ];
  }
}
