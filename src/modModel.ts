import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  ModRoute,
  ModSource,
  ModTarget,
  parseModMatrixFromFile,
} from './annotations';
import { buildModulesFromShreds, RackModule } from './rackModel';
import { ShredOps } from './shredOps';

export const MOD_ROUTES_STATE_KEY = 'chuckLive.modRoutes';

/** Persisted user route override. */
export interface ModRouteState {
  dst: string;
  src: string;
  depth: number;
  moduleFile: string;
}

/** Active route for UI + OSC. */
export interface ModRouteActive {
  dst: string;
  src: string;
  srcIndex: number;
  depth: number;
  isDefault: boolean;
}

/** One rack module block in the wiring panel. */
export interface ModModule {
  id: number;
  title: string;
  file: string;
  sources: ModSource[];
  targets: ModTarget[];
  routes: ModRouteActive[];
  defaults: ModRoute[];
}

export interface ModMatrixModel {
  vmUp: boolean;
  sources: ModSource[];
  modules: ModModule[];
}

export function readModRoutes(
  workspaceState?: vscode.Memento
): ModRouteState[] {
  return workspaceState?.get<ModRouteState[]>(MOD_ROUTES_STATE_KEY, []) ?? [];
}

export async function writeModRoutes(
  workspaceState: vscode.Memento | undefined,
  routes: ModRouteState[]
): Promise<void> {
  await workspaceState?.update(MOD_ROUTES_STATE_KEY, routes);
}

function annotationsForFile(resolvedPath: string): ReturnType<
  typeof parseModMatrixFromFile
> {
  const base = path.basename(resolvedPath);

  const openExact = vscode.workspace.textDocuments.find(
    (d) => path.resolve(d.fileName) === path.resolve(resolvedPath)
  );
  if (openExact) {
    return parseModMatrixFromFile(openExact.getText(), openExact.fileName);
  }

  const openBase = vscode.workspace.textDocuments.find(
    (d) =>
      path.basename(d.fileName) === base &&
      (d.languageId === 'chuck' || d.fileName.endsWith('.ck'))
  );
  if (openBase) {
    return parseModMatrixFromFile(openBase.getText(), openBase.fileName);
  }

  try {
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      return parseModMatrixFromFile(
        fs.readFileSync(resolvedPath, 'utf8'),
        resolvedPath
      );
    }
  } catch {
    /* missing */
  }
  return { sources: [], targets: [], routes: [] };
}

function labelIndex(
  sources: ModSource[],
  label: string
): ModSource | undefined {
  const key = label.toLowerCase();
  return sources.find((s) => s.label.toLowerCase() === key);
}

function resolveActiveRoutes(
  module: RackModule,
  moduleSources: ModSource[],
  allSources: ModSource[],
  fileDefaults: ModRoute[],
  persisted: ModRouteState[]
): ModRouteActive[] {
  const out: ModRouteActive[] = [];
  const meta = annotationsForFile(module.file);
  const targets = meta.targets;

  for (const t of targets) {
    const persistedRoute = persisted.find(
      (r) => r.dst === t.modName && r.moduleFile === module.file
    );
    if (persistedRoute) {
      const src = allSources.find((s) => s.name === persistedRoute.src);
      out.push({
        dst: t.modName,
        src: persistedRoute.src,
        srcIndex: src?.index ?? 0,
        depth: persistedRoute.depth,
        isDefault: false,
      });
      continue;
    }

    const def = fileDefaults.find(
      (r) =>
        labelIndex(moduleSources, r.srcLabel) &&
        t.label.toLowerCase() === r.dstLabel.toLowerCase()
    );
    if (def && def.default) {
      const src = labelIndex(moduleSources, def.srcLabel);
      if (src?.index) {
        out.push({
          dst: t.modName,
          src: src.name,
          srcIndex: src.index,
          depth: def.depth,
          isDefault: true,
        });
      }
    }
  }
  return out;
}

export function buildModMatrixModel(
  shredOps: ShredOps,
  workspaceState?: vscode.Memento
): ModMatrixModel {
  const vmUp = shredOps.list().some((s) => s.isBridge);
  const modules = buildModulesFromShreds(shredOps).filter(
    (m) => !m.isMaster && !m.isTransport
  );
  const persisted = readModRoutes(workspaceState);

  const allSources: ModSource[] = [];
  const sourceKey = new Set<string>();
  let nextIndex = 1;

  const moduleBlocks: ModModule[] = [];

  for (const mod of modules) {
    const meta = annotationsForFile(mod.file);
    const localSources = meta.sources.map((s) => ({ ...s, file: mod.file }));
    for (const s of localSources) {
      if (!sourceKey.has(s.name)) {
        sourceKey.add(s.name);
        allSources.push({ ...s, index: nextIndex++ });
      }
    }
  }

  for (const mod of modules) {
    const meta = annotationsForFile(mod.file);
    const localSources = meta.sources.map((s) => {
      const global = allSources.find((g) => g.name === s.name);
      return { ...s, file: mod.file, index: global?.index };
    });
    const targets = meta.targets.map((t) => ({
      ...t,
      file: mod.file,
      moduleFile: mod.file,
      moduleTitle: mod.title,
      shredId: mod.id,
    }));

    if (!localSources.length && !targets.length) {
      continue;
    }

    moduleBlocks.push({
      id: mod.id,
      title: mod.title,
      file: mod.file,
      sources: localSources,
      targets,
      routes: resolveActiveRoutes(
        mod,
        localSources,
        allSources,
        meta.routes,
        persisted
      ),
      defaults: meta.routes,
    });
  }

  return { vmUp, sources: allSources, modules: moduleBlocks };
}

/** All mod targets + sources for codegen. */
export function collectModCodegen(
  shredOps: ShredOps,
  workspaceState?: vscode.Memento
): {
  sources: ModSource[];
  targets: ModTarget[];
  routes: Map<string, { srcIndex: number; depth: number }>;
} {
  const model = buildModMatrixModel(shredOps, workspaceState);
  const targets: ModTarget[] = [];
  const routes = new Map<string, { srcIndex: number; depth: number }>();

  for (const mod of model.modules) {
    targets.push(...mod.targets);
    for (const r of mod.routes) {
      routes.set(r.dst, { srcIndex: r.srcIndex, depth: r.depth });
    }
  }

  return { sources: model.sources, targets, routes };
}

export function pruneModRoutes(
  routes: ModRouteState[],
  validDst: Set<string>,
  validSrc: Set<string>
): ModRouteState[] {
  return routes.filter(
    (r) => validDst.has(r.dst) && validSrc.has(r.src)
  );
}

/** Mod targets for OSC bridge codegen. */
export function collectModTargetsForBridge(shredOps: ShredOps): ModTarget[] {
  return collectModCodegen(shredOps, shredOps.workspaceState).targets;
}
