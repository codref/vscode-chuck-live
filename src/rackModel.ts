import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Annotation, parseAnnotations } from './annotations';
import { LIVE_TRANSPORT } from './bridgeGen';
import { resolveChuckPath } from './chuckPaths';
import { ShredOps, isFileModule } from './shredOps';

/** One Eurorack-style module = one loaded (non-bridge) shred + its annotations. */
export interface RackModule {
  id: number;
  title: string;
  file: string;
  knobs: Annotation[];
  /** Hint UI for master filter module chrome. */
  isMaster?: boolean;
  /** Virtual sequencer / transport faceplate (live_bpm). */
  isTransport?: boolean;
}

/** Wired-only shreds: stay loaded but are not rack faceplates. */
export function isRackHiddenModule(file: string, title?: string): boolean {
  return (
    /(?:^|[/\\])dac-out\.ck$/i.test(file) ||
    /^dac-out\.ck$/i.test(title ?? '')
  );
}

/** Build rack modules from currently tracked shreds (skip bridge + spork children). */
export function buildModulesFromShreds(shredOps: ShredOps): RackModule[] {
  const modules: RackModule[] = [];

  for (const shred of shredOps.listVisible()) {
    if (!isFileModule(shred.source, {
      isBridge: shred.isBridge,
      isMeter: shred.isMeter,
      isTransport: shred.isTransport,
      isModMatrix: shred.isModMatrix,
    })) {
      continue;
    }
    const file = resolveChuckPath(shred.source);
    const title =
      path.basename(file) ||
      path.basename(shred.source) ||
      `shred-${shred.id}`;
    if (isRackHiddenModule(file, title)) {
      continue;
    }
    const knobs = annotationsForFile(file);
    modules.push({
      id: shred.id,
      title,
      file,
      knobs,
      isMaster:
        /(?:^|[/\\])master\.ck$/i.test(file) || /^master\.ck$/i.test(title),
    });
  }

  // listVisible already applies user order; keep master first within that list
  modules.sort((a, b) => {
    if (a.isMaster !== b.isMaster) {
      return a.isMaster ? -1 : 1;
    }
    return 0; // stable — preserve listVisible order
  });

  return modules;
}

/** Virtual rack module for master tempo (`live_bpm` on the OSC bridge). */
export function buildTransportRackModule(bpm = 120): RackModule {
  const safe = Math.max(40, Math.min(200, bpm));
  return {
    id: -1,
    title: 'sequencer',
    file: 'chuck-live-transport',
    isTransport: true,
    knobs: [
      {
        kind: 'knob',
        name: LIVE_TRANSPORT.bpm,
        type: 'float',
        ui: 'dial',
        min: 40,
        max: 200,
        step: 1,
        default: safe,
      },
    ],
  };
}

/** User modules plus optional transport faceplate when the VM bridge is loaded. */
export function buildRackModules(
  shredOps: ShredOps,
  liveBpm = 120
): RackModule[] {
  const user = buildModulesFromShreds(shredOps);
  const vmUp = shredOps.list().some((s) => s.isBridge);
  if (!vmUp) {
    return user;
  }
  return [buildTransportRackModule(liveBpm), ...user];
}

function annotationsForFile(resolvedPath: string): Annotation[] {
  const base = path.basename(resolvedPath);

  const openExact = vscode.workspace.textDocuments.find(
    (d) => path.resolve(d.fileName) === path.resolve(resolvedPath)
  );
  if (openExact) {
    return parseAnnotations(openExact.getText(), openExact.fileName);
  }

  const openBase = vscode.workspace.textDocuments.find(
    (d) =>
      path.basename(d.fileName) === base &&
      (d.languageId === 'chuck' || d.fileName.endsWith('.ck'))
  );
  if (openBase) {
    return parseAnnotations(openBase.getText(), openBase.fileName);
  }

  try {
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      return parseAnnotations(
        fs.readFileSync(resolvedPath, 'utf8'),
        resolvedPath
      );
    }
  } catch {
    /* missing file */
  }
  return [];
}
