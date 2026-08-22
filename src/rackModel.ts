import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Annotation, parseAnnotations } from './annotations';
import { resolveChuckPath } from './chuckPaths';
import { ShredOps, isFileModule } from './shredOps';

/** One Eurorack-style module = one loaded (non-bridge) shred + its annotations. */
export interface RackModule {
  id: number;
  title: string;
  file: string;
  knobs: Annotation[];
  /** Hint UI for master filter module chrome. */
  isMaster: boolean;
}

/** Build rack modules from currently tracked shreds (skip bridge + spork children). */
export function buildModulesFromShreds(shredOps: ShredOps): RackModule[] {
  const modules: RackModule[] = [];

  for (const shred of shredOps.list()) {
    if (!isFileModule(shred.source, shred.isBridge)) {
      continue;
    }
    const file = resolveChuckPath(shred.source);
    const knobs = annotationsForFile(file);
    const title =
      path.basename(file) ||
      path.basename(shred.source) ||
      `shred-${shred.id}`;
    modules.push({
      id: shred.id,
      title,
      file,
      knobs,
      isMaster:
        /(?:^|[/\\])master\.ck$/i.test(file) || /^master\.ck$/i.test(title),
    });
  }

  modules.sort((a, b) => {
    if (a.isMaster !== b.isMaster) {
      return a.isMaster ? -1 : 1;
    }
    return a.id - b.id;
  });

  return modules;
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
