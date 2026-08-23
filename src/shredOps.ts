import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getConfig } from './config';
import { ChuckVm, runChuck } from './chuckVm';
import { resolveChuckPath } from './chuckPaths';

const ORDER_STATE_KEY = 'chuckLive.shredOrder';
const SHRED_MIME = 'application/vnd.code.tree.chuckliveshreds';

export interface ShredInfo {
  id: number;
  source: string;
  /** True for the OSC bridge shred we manage. */
  isBridge?: boolean;
  /** True for the VU meter shred we manage. */
  isMeter?: boolean;
}

/**
 * Top-level .ck shreds only — not OSC bridge/meter, not `spork ~ follow()` children
 * that show up in VM status as source `spork~follow`.
 */
export function isFileModule(
  source: string,
  managed?: boolean | { isBridge?: boolean; isMeter?: boolean }
): boolean {
  const isManaged =
    typeof managed === 'boolean'
      ? managed
      : !!(managed?.isBridge || managed?.isMeter);
  if (isManaged) {
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
  private meterId: number | undefined;
  /** Last loaded bridge source — skip OTF replace if unchanged. */
  private lastBridgeSource = '';
  private lastMeterSource = '';
  /** User display order (absolute paths of user modules). */
  private userOrder: string[] = [];

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly vm: ChuckVm,
    private readonly workspaceState?: vscode.Memento
  ) {
    // Parse lines like: [shred id]: 1 [source]: /path/foo.ck ...
    vm.onLogLine((line) => this.parseStatusLine(line));
    this.userOrder = workspaceState?.get<string[]>(ORDER_STATE_KEY, []) ?? [];
  }

  /** Persisted display order for user file modules (absolute paths). */
  getOrder(): string[] {
    return [...this.userOrder];
  }

  setOrder(paths: string[]): void {
    this.userOrder = paths.map((p) => path.resolve(p));
    void this.workspaceState?.update(ORDER_STATE_KEY, this.userOrder);
    this._onDidChange.fire();
  }

  /**
   * Reorder a dragged user shred relative to a drop target.
   * `target` undefined → append. `position` inserts before/after target.
   */
  moveInOrder(
    draggedSource: string,
    targetSource: string | undefined,
    position: 'before' | 'after' = 'before'
  ): void {
    const dragged = path.resolve(draggedSource);
    let order = this.listVisible()
      .filter((s) =>
        isFileModule(s.source, { isBridge: s.isBridge, isMeter: s.isMeter })
      )
      .map((s) => path.resolve(s.source));

    if (!order.includes(dragged)) {
      order.push(dragged);
    }
    order = order.filter((p) => p !== dragged);

    if (targetSource) {
      const target = path.resolve(targetSource);
      const idx = order.indexOf(target);
      if (idx >= 0) {
        const insertAt = position === 'before' ? idx : idx + 1;
        order.splice(insertAt, 0, dragged);
      } else {
        order.push(dragged);
      }
    } else {
      order.push(dragged);
    }

    this.setOrder(order);
  }

  list(): ShredInfo[] {
    return [...this.shreds.values()].sort((a, b) => a.id - b.id);
  }

  /** Visible tree shreds: user modules in display order, then bridge/meter. */
  listVisible(): ShredInfo[] {
    const all = this.list().filter(
      (s) =>
        s.isBridge ||
        s.isMeter ||
        isFileModule(s.source, { isBridge: s.isBridge, isMeter: s.isMeter })
    );
    const users = all.filter((s) =>
      isFileModule(s.source, { isBridge: s.isBridge, isMeter: s.isMeter })
    );
    const managed = all.filter((s) => s.isBridge || s.isMeter);

    const orderIndex = new Map(
      this.userOrder.map((p, i) => [path.resolve(p), i])
    );
    users.sort((a, b) => {
      const ai = orderIndex.get(path.resolve(a.source));
      const bi = orderIndex.get(path.resolve(b.source));
      if (ai !== undefined && bi !== undefined) {
        return ai - bi;
      }
      if (ai !== undefined) {
        return -1;
      }
      if (bi !== undefined) {
        return 1;
      }
      return a.id - b.id;
    });

    // Bridge before meter among managed
    managed.sort((a, b) => {
      if (a.isBridge !== b.isBridge) {
        return a.isBridge ? -1 : 1;
      }
      return a.id - b.id;
    });

    return [...users, ...managed];
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
    this.meterId = undefined;
    this.nextGuessId = 1;
    this.lastBridgeSource = '';
    this.lastMeterSource = '';
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
      this.remember(this.bridgeId, abs, { isBridge: true }, true);
    } else {
      await runChuck(executable, [`--port:${otfPort}`, '+', abs]);
      const id = this.nextGuessId++;
      this.bridgeId = id;
      this.remember(id, abs, { isBridge: true }, true);
      await this.status();
    }
    this.lastBridgeSource = src;
    return true;
  }

  /**
   * Add or replace the VU meter shred.
   * Pass `source` to skip reload when content is unchanged.
   */
  async loadMeter(meterPath: string, source?: string): Promise<boolean> {
    this.ensureVm();
    const abs = path.resolve(meterPath);
    const src =
      source ??
      (() => {
        try {
          return fs.readFileSync(abs, 'utf8');
        } catch {
          return '';
        }
      })();

    if (src && src === this.lastMeterSource && this.meterId !== undefined) {
      return false;
    }

    const { executable, otfPort } = getConfig();
    if (this.meterId !== undefined) {
      await runChuck(executable, [
        `--port:${otfPort}`,
        '=',
        String(this.meterId),
        abs,
      ]);
      this.remember(this.meterId, abs, { isMeter: true }, true);
    } else {
      await runChuck(executable, [`--port:${otfPort}`, '+', abs]);
      const id = this.nextGuessId++;
      this.meterId = id;
      this.remember(id, abs, { isMeter: true }, true);
      await this.status();
    }
    this.lastMeterSource = src;
    return true;
  }

  clearLocal(): void {
    this.byPath.clear();
    this.shreds.clear();
    this.bridgeId = undefined;
    this.meterId = undefined;
    this.nextGuessId = 1;
    this.lastBridgeSource = '';
    this.lastMeterSource = '';
    this._onDidChange.fire();
  }

  private ensureInOrder(abs: string): void {
    const resolved = path.resolve(abs);
    if (!this.userOrder.includes(resolved)) {
      this.userOrder = [...this.userOrder, resolved];
      void this.workspaceState?.update(ORDER_STATE_KEY, this.userOrder);
    }
  }

  private remember(
    id: number,
    source: string,
    flags: { isBridge?: boolean; isMeter?: boolean } = {},
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
    const existing = this.shreds.get(id);
    const isBridge = flags.isBridge ?? existing?.isBridge ?? false;
    const isMeter = flags.isMeter ?? existing?.isMeter ?? false;
    this.shreds.set(id, { id, source: abs, isBridge, isMeter });
    if (id >= this.nextGuessId) {
      this.nextGuessId = id + 1;
    }
    if (isBridge) {
      this.bridgeId = id;
    }
    if (isMeter) {
      this.meterId = id;
    }
    if (
      !isBridge &&
      !isMeter &&
      isFileModule(abs, { isBridge, isMeter })
    ) {
      this.ensureInOrder(abs);
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
      if (
        isFileModule(info.source, {
          isBridge: info.isBridge,
          isMeter: info.isMeter,
        })
      ) {
        const abs = path.resolve(info.source);
        this.userOrder = this.userOrder.filter((p) => p !== abs);
        void this.workspaceState?.update(ORDER_STATE_KEY, this.userOrder);
      }
    }
    if (this.bridgeId === id) {
      this.bridgeId = undefined;
    }
    if (this.meterId === id) {
      this.meterId = undefined;
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
      this.bridgeId === id ||
      !!existing?.isBridge;
    const isMeter =
      abs.includes('chuck-live-meter') ||
      abs.endsWith('meter.ck') ||
      /meter\.ck$/i.test(source) ||
      this.meterId === id ||
      !!existing?.isMeter;
    this.remember(id, abs, { isBridge, isMeter });
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
    let label: string;
    if (el.isBridge) {
      label = `#${el.id} bridge (OSC)`;
    } else if (el.isMeter) {
      label = `#${el.id} meter (VU)`;
    } else {
      label = `#${el.id} ${name}`;
    }
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = el.source;
    item.tooltip = el.isBridge || el.isMeter
      ? el.source
      : `${el.source}\nDrag to reorder · Sync icon reloads`;
    item.contextValue =
      el.isBridge || el.isMeter ? 'chuckManagedShred' : 'chuckUserShred';
    item.iconPath = new vscode.ThemeIcon(
      el.isBridge ? 'radio-tower' : el.isMeter ? 'pulse' : 'file-code'
    );
    if (
      isFileModule(el.source, { isBridge: el.isBridge, isMeter: el.isMeter })
    ) {
      try {
        item.resourceUri = vscode.Uri.file(el.source);
        item.command = {
          command: 'vscode.open',
          title: 'Open',
          arguments: [vscode.Uri.file(el.source)],
        };
      } catch {
        /* temp / missing path */
      }
    }
    return item;
  }

  getChildren(): ShredInfo[] {
    return this.ops.listVisible();
  }
}

/** Drag-and-drop reorder for user shreds (display + rack order only). */
export class ShredTreeDragAndDropController
  implements vscode.TreeDragAndDropController<ShredInfo>
{
  readonly dropMimeTypes = [SHRED_MIME];
  readonly dragMimeTypes = [SHRED_MIME];

  constructor(private readonly ops: ShredOps) {}

  handleDrag(
    source: readonly ShredInfo[],
    dataTransfer: vscode.DataTransfer
  ): void {
    const user = source.filter((s) =>
      isFileModule(s.source, { isBridge: s.isBridge, isMeter: s.isMeter })
    );
    if (user.length === 0) {
      return;
    }
    dataTransfer.set(
      SHRED_MIME,
      new vscode.DataTransferItem(user.map((s) => s.source))
    );
  }

  handleDrop(
    target: ShredInfo | undefined,
    dataTransfer: vscode.DataTransfer
  ): void {
    const transfer = dataTransfer.get(SHRED_MIME);
    if (!transfer) {
      return;
    }
    const sources = transfer.value as string[];
    if (!sources?.length) {
      return;
    }

    // Only drop onto user modules (or empty); managed stays pinned at bottom
    const targetSource =
      target &&
      isFileModule(target.source, {
        isBridge: target.isBridge,
        isMeter: target.isMeter,
      })
        ? target.source
        : undefined;

    for (const src of [...sources].reverse()) {
      this.ops.moveInOrder(src, targetSource, 'before');
    }
  }
}
