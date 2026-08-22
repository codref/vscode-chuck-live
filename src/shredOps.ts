import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getConfig } from './config';
import { ChuckVm, runChuck } from './chuckVm';
import { resolveChuckPath } from './chuckPaths';

export interface ShredInfo {
  id: number;
  source: string;
  /** True for the OSC bridge shred we manage. */
  isBridge?: boolean;
}

/**
 * Top-level .ck shreds only — not OSC bridge, not `spork ~ follow()` children
 * that show up in VM status as source `spork~follow`.
 */
export function isFileModule(source: string, isBridge?: boolean): boolean {
  if (isBridge) {
    return false;
  }
  const base = path.basename(source);
  if (/^spork~/i.test(base) || /^spork~/i.test(source)) {
    return false;
  }
  return /\.ck$/i.test(base);
}

/**
 * Wraps OTF add/replace/remove/status and keeps a local shred list
 * for the TreeView (listener status text is also parsed when available).
 */
export class ShredOps {
  /** path → shred id for files we added/replaced */
  private byPath = new Map<string, number>();
  private shreds = new Map<number, ShredInfo>();
  private nextGuessId = 1;
  private bridgeId: number | undefined;
  /** Last loaded bridge source — skip OTF replace if unchanged. */
  private lastBridgeSource = '';

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly vm: ChuckVm) {
    // Parse lines like: [shred id]: 1 [source]: /path/foo.ck ...
    vm.onLogLine((line) => this.parseStatusLine(line));
  }

  list(): ShredInfo[] {
    return [...this.shreds.values()].sort((a, b) => a.id - b.id);
  }

  idForPath(filePath: string): number | undefined {
    return this.byPath.get(path.resolve(filePath));
  }

  async add(filePath: string): Promise<number | undefined> {
    this.ensureVm();
    const abs = path.resolve(filePath);
    const { executable, otfPort } = getConfig();
    await runChuck(executable, [`--port:${otfPort}`, '+', abs]);
    const id = this.nextGuessId++;
    this.remember(id, abs);
    await this.status();
    return this.byPath.get(abs) ?? id;
  }

  async replace(filePath: string, shredId?: number): Promise<void> {
    this.ensureVm();
    const abs = path.resolve(filePath);
    const id = shredId ?? this.byPath.get(abs);
    if (id === undefined) {
      throw new Error('No shred id for this file — Add it first');
    }
    const { executable, otfPort } = getConfig();
    await runChuck(executable, [`--port:${otfPort}`, '=', String(id), abs]);
    this.remember(id, abs);
    this._onDidChange.fire();
  }

  async remove(shredId: number): Promise<void> {
    this.ensureVm();
    const { executable, otfPort } = getConfig();
    await runChuck(executable, [`--port:${otfPort}`, '-', String(shredId)]);
    this.forget(shredId);
  }

  async removeAll(): Promise<void> {
    this.ensureVm();
    const { executable, otfPort } = getConfig();
    await runChuck(executable, [`--port:${otfPort}`, 'remove.all']);
    this.byPath.clear();
    this.shreds.clear();
    this.bridgeId = undefined;
    this.nextGuessId = 1;
    this.lastBridgeSource = '';
    this._onDidChange.fire();
  }

  async status(): Promise<void> {
    this.ensureVm();
    const { executable, otfPort } = getConfig();
    // Status prints on the *listener* console, not the client.
    await runChuck(executable, [`--port:${otfPort}`, '^']);
  }

  /**
   * Add or replace the OSC bridge shred.
   * Pass `source` to skip reload when content is unchanged.
   * Returns false if skipped (no OTF).
   */
  async loadBridge(bridgePath: string, source?: string): Promise<boolean> {
    this.ensureVm();
    const abs = path.resolve(bridgePath);
    const src =
      source ??
      (() => {
        try {
          return fs.readFileSync(abs, 'utf8');
        } catch {
          return '';
        }
      })();

    if (src && src === this.lastBridgeSource && this.bridgeId !== undefined) {
      return false;
    }

    const { executable, otfPort } = getConfig();
    if (this.bridgeId !== undefined) {
      await runChuck(executable, [
        `--port:${otfPort}`,
        '=',
        String(this.bridgeId),
        abs,
      ]);
      this.remember(this.bridgeId, abs, true, true);
    } else {
      await runChuck(executable, [`--port:${otfPort}`, '+', abs]);
      const id = this.nextGuessId++;
      this.bridgeId = id;
      this.remember(id, abs, true, true);
      await this.status();
    }
    this.lastBridgeSource = src;
    return true;
  }

  clearLocal(): void {
    this.byPath.clear();
    this.shreds.clear();
    this.bridgeId = undefined;
    this.nextGuessId = 1;
    this.lastBridgeSource = '';
    this._onDidChange.fire();
  }

  private remember(
    id: number,
    source: string,
    isBridge = false,
    silent = false
  ): void {
    const abs = path.resolve(source);
    // Drop stale path→id if id moved
    for (const [p, sid] of this.byPath) {
      if (sid === id) {
        this.byPath.delete(p);
      }
    }
    this.byPath.set(abs, id);
    this.shreds.set(id, { id, source: abs, isBridge });
    if (id >= this.nextGuessId) {
      this.nextGuessId = id + 1;
    }
    if (isBridge) {
      this.bridgeId = id;
    }
    if (!silent) {
      this._onDidChange.fire();
    }
  }

  private forget(id: number): void {
    const info = this.shreds.get(id);
    if (info) {
      this.byPath.delete(info.source);
      this.shreds.delete(id);
    }
    if (this.bridgeId === id) {
      this.bridgeId = undefined;
    }
    this._onDidChange.fire();
  }

  private parseStatusLine(line: string): void {
    // [shred id]: 1 [source]: foo.ck [sporked]: ...
    const m = line.match(/\[shred id\]:\s*(\d+)\s*\[source\]:\s*(\S+)/);
    if (!m) {
      return;
    }
    const id = Number(m[1]);
    const source = m[2];
    const existing = this.shreds.get(id);
    const abs = resolveChuckPath(source, existing?.source);
    const isBridge =
      abs.includes('chuck-live-bridge') ||
      abs.endsWith('bridge.ck') ||
      /bridge\.ck$/i.test(source) ||
      this.bridgeId === id;
    this.remember(id, abs, isBridge);
  }

  private ensureVm(): void {
    if (!this.vm.running) {
      throw new Error('ChucK VM is not running — Start VM first');
    }
  }
}

export class ShredTreeProvider implements vscode.TreeDataProvider<ShredInfo> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ShredInfo | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly ops: ShredOps) {
    ops.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(el: ShredInfo): vscode.TreeItem {
    const name = path.basename(el.source);
    const label = el.isBridge
      ? `#${el.id} bridge (OSC)`
      : `#${el.id} ${name}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = el.source;
    item.tooltip = el.source;
    item.contextValue = 'chuckShred';
    item.iconPath = new vscode.ThemeIcon(el.isBridge ? 'radio-tower' : 'file-code');
    return item;
  }

  getChildren(): ShredInfo[] {
    // Hide spork~ children; keep bridge visible for debugging
    return this.ops.list().filter(
      (s) => s.isBridge || isFileModule(s.source, false)
    );
  }
}
