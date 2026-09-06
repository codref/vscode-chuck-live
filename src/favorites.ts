import * as path from 'path';
import * as vscode from 'vscode';

const FAVORITES_STATE_KEY = 'chuckLive.favorites';

/**
 * Workspace-scoped favorite .ck paths for the Control sidebar.
 */
export class FavoritesStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private paths: string[];

  constructor(private readonly workspaceState: vscode.Memento) {
    this.paths = (workspaceState.get<string[]>(FAVORITES_STATE_KEY, []) ?? []).map(
      (p) => path.resolve(p)
    );
  }

  list(): string[] {
    return [...this.paths];
  }

  has(filePath: string): boolean {
    const abs = path.resolve(filePath);
    return this.paths.some((p) => p === abs);
  }

  /** Add if missing, remove if present. Returns true when now favorited. */
  toggle(filePath: string): boolean {
    const abs = path.resolve(filePath);
    const idx = this.paths.findIndex((p) => p === abs);
    if (idx >= 0) {
      this.paths.splice(idx, 1);
      this.persist();
      return false;
    }
    this.paths.push(abs);
    this.persist();
    return true;
  }

  remove(filePath: string): void {
    const abs = path.resolve(filePath);
    const next = this.paths.filter((p) => p !== abs);
    if (next.length === this.paths.length) {
      return;
    }
    this.paths = next;
    this.persist();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  private persist(): void {
    void this.workspaceState.update(FAVORITES_STATE_KEY, this.paths);
    this._onDidChange.fire();
  }
}
