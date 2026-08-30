import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getConfig } from './config';
import { ChuckVm, runChuck, otfClientExecutable } from './chuckVm';
import { resolveChuckPath } from './chuckPaths';

const ORDER_STATE_KEY = 'chuckLive.shredOrder';
const SHRED_MIME = 'application/vnd.code.tree.chuckliveshreds';

/** Client or listener text that means an OTF add/replace failed. */
const OTF_FAIL_RE =
  /(?:syntax error|parse error|REMOTE operation failed|cannot open file|skipping file|\berror:)/i;

/** Match VM log source token (basename or full path) to the file we OTF-added. */
function sourceNameMatchesBase(logSource: string, base: string): boolean {
  const logged = path.basename(logSource.replace(/\.\.\.$/, '').trim());
  return logged === base;
}

/** Parse shred id from VM log delta for a given .ck basename. */
function parseSporkIdFromLog(delta: string, base: string): number | undefined {
  const patterns = [
    /sporking incoming shred:\s*(\d+)\s*\(([^)]+)\)/g,
    /replacing shred\s+(\d+)\s+with\s+[^:]+:\s*(\S+)/gi,
    /\[shred id\]:\s*(\d+)\s*\[source\]:\s*(\S+)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(delta)) !== null) {
      if (sourceNameMatchesBase(m[2], base)) {
        return Number(m[1]);
      }
    }
  }
  return undefined;
}

export interface ShredInfo {
  id: number;
  source: string;
  /** True for the OSC bridge shred we manage. */
  isBridge?: boolean;
  /** True for the VU meter shred we manage. */
  isMeter?: boolean;
  /** True for the sequencer transport shred we manage. */
  isTransport?: boolean;
  /** True for the mod-matrix shred we manage. */
  isModMatrix?: boolean;
}

export interface ManagedShredFlags {
  isBridge?: boolean;
  isMeter?: boolean;
  isTransport?: boolean;
  isModMatrix?: boolean;
}

/**
 * Top-level .ck shreds only — not OSC bridge/meter/transport, not `spork ~ follow()` children
 * that show up in VM status as source `spork~follow`.
 */
export function isFileModule(
  source: string,
  managed?: boolean | ManagedShredFlags
): boolean {
  const isManaged =
    typeof managed === 'boolean'
      ? managed
      : !!(
          managed?.isBridge ||
          managed?.isMeter ||
          managed?.isTransport ||
          managed?.isModMatrix
        );
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
  private bridgeId: number | undefined;
  private meterId: number | undefined;
  private transportId: number | undefined;
  private modMatrixId: number | undefined;
  /** Last loaded bridge source — skip OTF replace if unchanged. */
  private lastBridgeSource = '';
  private lastMeterSource = '';
  private lastTransportSource = '';
  private lastModMatrixSource = '';
  /** User display order (absolute paths of user modules). */
  private userOrder: string[] = [];

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly vm: ChuckVm,
    readonly workspaceState?: vscode.Memento
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
        isFileModule(s.source, {
          isBridge: s.isBridge,
          isMeter: s.isMeter,
          isTransport: s.isTransport,
          isModMatrix: s.isModMatrix,
        })
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
        s.isTransport ||
        s.isModMatrix ||
        isFileModule(s.source, {
          isBridge: s.isBridge,
          isMeter: s.isMeter,
          isTransport: s.isTransport,
          isModMatrix: s.isModMatrix,
        })
    );
    const users = all.filter((s) =>
      isFileModule(s.source, {
        isBridge: s.isBridge,
        isMeter: s.isMeter,
        isTransport: s.isTransport,
        isModMatrix: s.isModMatrix,
      })
    );
    const managed = all.filter(
      (s) => s.isBridge || s.isMeter || s.isTransport || s.isModMatrix
    );

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

    // bridge → transport → mod-matrix → meter among managed
    managed.sort((a, b) => {
      const rank = (s: ShredInfo) =>
        s.isBridge
          ? 0
          : s.isTransport
            ? 1
            : s.isModMatrix
              ? 2
              : s.isMeter
                ? 3
                : 4;
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.id - b.id;
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
    const client = otfClientExecutable(executable);
    const id = await this.otfAdd(client, otfPort, abs);
    this.remember(id, abs);
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
    const client = otfClientExecutable(executable);
    await runChuck(client, [
      '--silent',
      `--port:${otfPort}`,
      '=',
      String(id),
      abs,
    ]);
    this.remember(id, abs);
    this._onDidChange.fire();
  }

  async remove(shredId: number): Promise<void> {
    this.ensureVm();
    const { executable, otfPort } = getConfig();
    const client = otfClientExecutable(executable);
    await this.otfRemove(client, otfPort, shredId);
    this.forget(shredId);
  }

  async removeAll(): Promise<void> {
    this.ensureVm();
    const { executable, otfPort } = getConfig();
    const client = otfClientExecutable(executable);
    const mark = this.vm.logMark();
    await runChuck(client, ['--silent', `--port:${otfPort}`, '--remove.all']);
    await this.vm.waitLogSince(
      mark,
      (delta) => delta.includes('removing all'),
      2500
    );
    this.byPath.clear();
    this.shreds.clear();
    this.bridgeId = undefined;
    this.meterId = undefined;
    this.transportId = undefined;
    this.modMatrixId = undefined;
    this.lastBridgeSource = '';
    this.lastMeterSource = '';
    this.lastTransportSource = '';
    this.lastModMatrixSource = '';
    this._onDidChange.fire();
  }

  async status(): Promise<void> {
    this.ensureVm();
    const { executable, otfPort } = getConfig();
    const client = otfClientExecutable(executable);
    const mark = this.vm.logMark();
    // Status prints on the *listener* console, not the client.
    await runChuck(client, ['--silent', `--port:${otfPort}`, '^']);
    await this.vm.waitLogSince(
      mark,
      (delta) => delta.includes('[shred id]:'),
      2500
    );
  }

  /** Re-sync managed shred ids from VM status and remove orphan duplicates. */
  async reconcileShredIds(): Promise<void> {
    try {
      await this.status();
    } catch (err) {
      this.vm.output.appendLine(`[warn] shred status: ${err}`);
      return;
    }
    this.syncManagedIdsFromShreds();
    await this.pruneOrphanManagedShreds();
  }

  private syncManagedIdsFromShreds(): void {
    this.bridgeId = this.pickLatestIdForPathToken('chuck-live-bridge');
    if (this.bridgeId === undefined) {
      this.bridgeId = this.pickLatestIdForPathToken('bridge.ck');
    }
    this.transportId = this.pickLatestIdForPathToken('chuck-live-transport');
    if (this.transportId === undefined) {
      this.transportId = this.pickLatestIdForPathToken('transport.ck');
    }
    this.meterId = this.pickLatestIdForPathToken('chuck-live-meter');
    if (this.meterId === undefined) {
      this.meterId = this.pickLatestIdForPathToken('meter.ck');
    }
    this.modMatrixId = this.pickLatestIdForPathToken('chuck-live-mod-matrix');
    if (this.modMatrixId === undefined) {
      this.modMatrixId = this.pickLatestIdForPathToken('mod-matrix.ck');
    }
  }

  private pickLatestIdForPathToken(token: string): number | undefined {
    let best: number | undefined;
    for (const s of this.shreds.values()) {
      if (!s.source.includes(token)) {
        continue;
      }
      if (best === undefined || s.id > best) {
        best = s.id;
      }
    }
    return best;
  }

  private isManagedGeneratedSource(source: string): boolean {
    return (
      source.includes('chuck-live-bridge') ||
      source.includes('chuck-live-transport') ||
      source.includes('chuck-live-meter') ||
      source.includes('chuck-live-mod-matrix')
    );
  }

  private async pruneOrphanManagedShreds(): Promise<void> {
    const keep = new Set(
      [this.bridgeId, this.transportId, this.meterId, this.modMatrixId].filter(
        (id): id is number => id !== undefined
      )
    );
    const { executable, otfPort } = getConfig();
    const client = otfClientExecutable(executable);
    for (const s of [...this.shreds.values()]) {
      if (!this.isManagedGeneratedSource(s.source) || keep.has(s.id)) {
        continue;
      }
      try {
        await this.otfRemove(client, otfPort, s.id);
        this.vm.output.appendLine(
          `[info] removed orphan managed shred #${s.id} (${path.basename(s.source)})`
        );
      } catch {
        /* already gone */
      }
      this.forgetSilent(s.id);
    }
  }

  private async resolveShredIdAfterAdd(
    mark: number,
    abs: string
  ): Promise<number> {
    const base = path.basename(abs);
    const fromLog = parseSporkIdFromLog(this.vm.logSince(mark), base);
    if (fromLog !== undefined) {
      return fromLog;
    }
    await this.status();
    const fromPath = this.byPath.get(path.resolve(abs));
    if (fromPath !== undefined) {
      return fromPath;
    }
    const fromStatus = this.findLatestIdByBasename(base);
    if (fromStatus !== undefined) {
      return fromStatus;
    }
    throw new Error(`OTF add: could not resolve VM shred id for ${base}`);
  }

  private findLatestIdByBasename(base: string): number | undefined {
    let best: number | undefined;
    for (const s of this.shreds.values()) {
      if (path.basename(s.source) !== base) {
        continue;
      }
      if (best === undefined || s.id > best) {
        best = s.id;
      }
    }
    return best;
  }

  private async otfReplaceManaged(
    client: string,
    otfPort: number,
    abs: string,
    shredId: number | undefined,
    flags: ManagedShredFlags
  ): Promise<number> {
    if (shredId !== undefined) {
      try {
        await runChuck(client, [
          '--silent',
          `--port:${otfPort}`,
          '=',
          String(shredId),
          abs,
        ]);
        this.remember(shredId, abs, flags, true);
        return shredId;
      } catch (err) {
        this.vm.output.appendLine(
          `[warn] OTF replace #${shredId} failed (${path.basename(abs)}): ${err}`
        );
        try {
          await this.otfRemove(client, otfPort, shredId);
        } catch {
          /* already gone */
        }
        this.forgetSilent(shredId);
      }
    }
    const id = await this.otfAdd(client, otfPort, abs);
    this.remember(id, abs, flags, true);
    return id;
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
    const client = otfClientExecutable(executable);
    this.bridgeId = await this.otfReplaceManaged(
      client,
      otfPort,
      abs,
      this.bridgeId,
      { isBridge: true }
    );
    await this.pruneOrphanManagedShreds();
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
    const client = otfClientExecutable(executable);
    this.meterId = await this.otfReplaceManaged(
      client,
      otfPort,
      abs,
      this.meterId,
      { isMeter: true }
    );
    await this.pruneOrphanManagedShreds();
    this.lastMeterSource = src;
    return true;
  }

  /**
   * Add or replace the sequencer transport shred.
   * Pass `source` to skip reload when content is unchanged.
   */
  async loadTransport(
    transportPath: string,
    source?: string,
    _force = false
  ): Promise<boolean> {
    this.ensureVm();
    const abs = path.resolve(transportPath);
    const src =
      source ??
      (() => {
        try {
          return fs.readFileSync(abs, 'utf8');
        } catch {
          return '';
        }
      })();

    if (
      src &&
      src === this.lastTransportSource &&
      this.transportId !== undefined
    ) {
      return false;
    }

    const { executable, otfPort } = getConfig();
    const client = otfClientExecutable(executable);
    this.transportId = await this.otfReplaceManaged(
      client,
      otfPort,
      abs,
      this.transportId,
      { isTransport: true }
    );
    await this.pruneOrphanManagedShreds();
    this.lastTransportSource = src;
    return true;
  }

  /**
   * Add or replace the mod-matrix shred.
   * Pass `source` to skip reload when content is unchanged.
   */
  async loadModMatrix(modPath: string, source?: string): Promise<boolean> {
    this.ensureVm();
    const abs = path.resolve(modPath);
    const src =
      source ??
      (() => {
        try {
          return fs.readFileSync(abs, 'utf8');
        } catch {
          return '';
        }
      })();

    if (
      src &&
      src === this.lastModMatrixSource &&
      this.modMatrixId !== undefined
    ) {
      return false;
    }

    const { executable, otfPort } = getConfig();
    const client = otfClientExecutable(executable);
    // Drop any duplicate mod-matrix shreds left by failed replaces (they spin forever).
    await this.pruneAllModMatrixExcept(this.modMatrixId);
    this.modMatrixId = await this.otfReplaceManaged(
      client,
      otfPort,
      abs,
      this.modMatrixId,
      { isModMatrix: true }
    );
    await this.pruneOrphanManagedShreds();
    this.lastModMatrixSource = src;
    return true;
  }

  /** Remove every mod-matrix shred except `keepId` (VM + local bookkeeping). */
  private async pruneAllModMatrixExcept(
    keepId: number | undefined
  ): Promise<void> {
    const { executable, otfPort } = getConfig();
    const client = otfClientExecutable(executable);
    for (const s of [...this.shreds.values()]) {
      const isMatrix =
        s.isModMatrix || s.source.includes('chuck-live-mod-matrix');
      if (!isMatrix) {
        continue;
      }
      if (keepId !== undefined && s.id === keepId) {
        continue;
      }
      try {
        await this.otfRemove(client, otfPort, s.id);
        this.vm.output.appendLine(
          `[info] removed duplicate mod-matrix #${s.id}`
        );
      } catch {
        /* already gone */
      }
      this.forgetSilent(s.id);
    }
  }

  clearLocal(): void {
    this.byPath.clear();
    this.shreds.clear();
    this.bridgeId = undefined;
    this.meterId = undefined;
    this.transportId = undefined;
    this.modMatrixId = undefined;
    this.lastBridgeSource = '';
    this.lastMeterSource = '';
    this.lastTransportSource = '';
    this.lastModMatrixSource = '';
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
    flags: ManagedShredFlags = {},
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
    const isTransport = flags.isTransport ?? existing?.isTransport ?? false;
    const isModMatrix = flags.isModMatrix ?? existing?.isModMatrix ?? false;
    this.shreds.set(id, {
      id,
      source: abs,
      isBridge,
      isMeter,
      isTransport,
      isModMatrix,
    });
    if (isBridge) {
      this.bridgeId = id;
    }
    if (isMeter) {
      this.meterId = id;
    }
    if (isTransport) {
      this.transportId = id;
    }
    if (isModMatrix) {
      this.modMatrixId = id;
    }
    if (
      !isBridge &&
      !isMeter &&
      !isTransport &&
      !isModMatrix &&
      isFileModule(abs, { isBridge, isMeter, isTransport, isModMatrix })
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
          isTransport: info.isTransport,
          isModMatrix: info.isModMatrix,
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
    if (this.transportId === id) {
      this.transportId = undefined;
    }
    if (this.modMatrixId === id) {
      this.modMatrixId = undefined;
    }
    this._onDidChange.fire();
  }

  private forgetSilent(id: number): void {
    const info = this.shreds.get(id);
    if (info) {
      this.byPath.delete(info.source);
      this.shreds.delete(id);
    }
    if (this.bridgeId === id) {
      this.bridgeId = undefined;
    }
    if (this.meterId === id) {
      this.meterId = undefined;
    }
    if (this.transportId === id) {
      this.transportId = undefined;
    }
    if (this.modMatrixId === id) {
      this.modMatrixId = undefined;
    }
  }

  private parseStatusLine(line: string): void {
    // ChucK 1.5+: [chuck]: (VM) sporking incoming shred: 2 (foo.ck)...
    const spork = line.match(/sporking incoming shred:\s*(\d+)\s*\(([^)]+)\)/);
    if (spork) {
      const id = Number(spork[1]);
      const sourceName = spork[2];
      const existing = [...this.shreds.values()].find((s) =>
        sourceNameMatchesBase(sourceName, path.basename(s.source))
      );
      if (existing) {
        this.remember(
          id,
          existing.source,
          {
            isBridge: existing.isBridge,
            isMeter: existing.isMeter,
            isTransport: existing.isTransport,
            isModMatrix: existing.isModMatrix,
          },
          true
        );
      }
      return;
    }

    // [chuck]: [shred id]: 1 [source]: foo.ck [spork time]: ...
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
    const isTransport =
      abs.includes('chuck-live-transport') ||
      abs.endsWith('transport.ck') ||
      /transport\.ck$/i.test(source) ||
      this.transportId === id ||
      !!existing?.isTransport;
    const isModMatrix =
      abs.includes('chuck-live-mod-matrix') ||
      abs.endsWith('mod-matrix.ck') ||
      /mod-matrix\.ck$/i.test(source) ||
      this.modMatrixId === id ||
      !!existing?.isModMatrix;
    this.remember(id, abs, { isBridge, isMeter, isTransport, isModMatrix }, true);
  }

  /**
   * OTF add via `chuck + file`. Returns the VM-assigned shred id (from listener log).
   */
  private async otfAdd(
    client: string,
    otfPort: number,
    abs: string
  ): Promise<number> {
    const base = path.basename(abs);
    const args = ['--silent', `--port:${otfPort}`, '+', abs];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const mark = this.vm.logMark();
      this.vm.output.appendLine(`$ ${client} ${args.join(' ')}`);
      try {
        const out = await runChuck(client, args, 8000);
        if (out.trim()) {
          this.vm.output.appendLine(out.trimEnd());
        }
        if (OTF_FAIL_RE.test(out)) {
          throw new Error(out.trim() || 'OTF client reported failure');
        }
        const id = await this.waitSporkId(mark, base);
        if (id !== undefined) {
          return id;
        }
        const vmRejected = await this.vm.waitLogSince(
          mark,
          (delta) => OTF_FAIL_RE.test(delta),
          200
        );
        if (vmRejected) {
          throw new Error('VM rejected OTF add');
        }
        // Log may have arrived just after waitSporkId timed out (full paths, stdbuf).
        const lateId = parseSporkIdFromLog(this.vm.logSince(mark), base);
        if (lateId !== undefined) {
          return lateId;
        }
        return await this.resolveShredIdAfterAdd(mark, abs);
      } catch (err) {
        this.vm.output.appendLine(`[warn] OTF add (${base}): ${err}`);
      }
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    throw new Error(`OTF add did not reach the VM: ${base}`);
  }

  private async otfRemove(
    client: string,
    otfPort: number,
    shredId: number
  ): Promise<void> {
    const mark = this.vm.logMark();
    const args = ['--silent', `--port:${otfPort}`, '-', String(shredId)];
    this.vm.output.appendLine(`$ ${client} ${args.join(' ')}`);
    const out = await runChuck(client, args, 8000);
    if (out.trim()) {
      this.vm.output.appendLine(out.trimEnd());
    }
    if (OTF_FAIL_RE.test(out)) {
      throw new Error(out.trim() || 'OTF remove failed');
    }
    let removed = false;
    let notFound = false;
    await this.vm.waitLogSince(mark, (delta) => {
      if (new RegExp(`removing shred:\\s*${shredId}\\b`).test(delta)) {
        removed = true;
        return true;
      }
      if (delta.includes(`cannot remove: no shred with id ${shredId}`)) {
        notFound = true;
        return true;
      }
      return false;
    }, 2500);
    if (notFound) {
      throw new Error(`Shred #${shredId} is not running in the VM`);
    }
    if (!removed) {
      throw new Error(`Remove not confirmed for shred #${shredId}`);
    }
  }

  /** Wait for VM log lines that assign a shred id to `base`. */
  private async waitSporkId(
    mark: number,
    base: string
  ): Promise<number | undefined> {
    let sporkId: number | undefined;
    await this.vm.waitLogSince(
      mark,
      (delta) => {
        const id = parseSporkIdFromLog(delta, base);
        if (id !== undefined) {
          sporkId = id;
          return true;
        }
        return false;
      },
      5000
    );
    return sporkId;
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
    } else if (el.isTransport) {
      label = `#${el.id} transport (seq)`;
    } else if (el.isModMatrix) {
      label = `#${el.id} mod-matrix`;
    } else if (el.isMeter) {
      label = `#${el.id} meter (VU)`;
    } else {
      label = `#${el.id} ${name}`;
    }
    const managed = !!(
      el.isBridge ||
      el.isMeter ||
      el.isTransport ||
      el.isModMatrix
    );
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = el.source;
    item.tooltip = managed
      ? el.source
      : `${el.source}\nDrag to reorder · Sync icon reloads`;
    item.contextValue = managed ? 'chuckManagedShred' : 'chuckUserShred';
    item.iconPath = new vscode.ThemeIcon(
      el.isBridge
        ? 'radio-tower'
        : el.isTransport
          ? 'watch'
          : el.isModMatrix
            ? 'git-merge'
            : el.isMeter
              ? 'pulse'
              : 'file-code'
    );
    if (
      isFileModule(el.source, {
        isBridge: el.isBridge,
        isMeter: el.isMeter,
        isTransport: el.isTransport,
        isModMatrix: el.isModMatrix,
      })
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
      isFileModule(s.source, {
        isBridge: s.isBridge,
        isMeter: s.isMeter,
        isTransport: s.isTransport,
        isModMatrix: s.isModMatrix,
      })
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
        isTransport: target.isTransport,
        isModMatrix: target.isModMatrix,
      })
        ? target.source
        : undefined;

    for (const src of [...sources].reverse()) {
      this.ops.moveInOrder(src, targetSource, 'before');
    }
  }
}
