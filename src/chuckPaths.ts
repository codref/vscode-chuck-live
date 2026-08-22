import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Resolve a shred source (often basename-only from VM status) to a real path
 * using open editors and the workspace.
 */
export function resolveChuckPath(
  source: string,
  existingAbs?: string
): string {
  const base = path.basename(source);

  if (
    existingAbs &&
    path.isAbsolute(existingAbs) &&
    path.basename(existingAbs) === base &&
    fs.existsSync(existingAbs)
  ) {
    return path.resolve(existingAbs);
  }

  if (path.isAbsolute(source)) {
    const abs = path.resolve(source);
    if (fs.existsSync(abs)) {
      return abs;
    }
  }

  const openExact = vscode.workspace.textDocuments.find(
    (d) => path.resolve(d.fileName) === path.resolve(source)
  );
  if (openExact) {
    return path.resolve(openExact.fileName);
  }

  const openBase = vscode.workspace.textDocuments.filter(
    (d) =>
      path.basename(d.fileName) === base &&
      (d.languageId === 'chuck' || d.fileName.endsWith('.ck'))
  );
  if (openBase.length === 1) {
    return path.resolve(openBase[0].fileName);
  }
  if (openBase.length > 1) {
    const parent = path.basename(path.dirname(source));
    const prefer = openBase.find((d) =>
      path.dirname(d.fileName).includes(parent)
    );
    return path.resolve((prefer ?? openBase[0]).fileName);
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    if (source.includes('/') || source.includes('\\')) {
      const candidate = path.join(folder.uri.fsPath, source);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    try {
      const hit = walkFind(folder.uri.fsPath, base, 5);
      if (hit) {
        return hit;
      }
    } catch {
      /* ignore */
    }
  }

  return path.isAbsolute(source) ? path.resolve(source) : source;
}

function walkFind(
  root: string,
  basename: string,
  depth: number
): string | undefined {
  if (depth < 0) {
    return undefined;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') {
      continue;
    }
    const full = path.join(root, ent.name);
    if (ent.isFile() && ent.name === basename) {
      return full;
    }
    if (ent.isDirectory()) {
      const found = walkFind(full, basename, depth - 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}
