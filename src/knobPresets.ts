import * as path from 'path';
import * as vscode from 'vscode';

export const KNOB_PRESET_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export interface KnobPresetSnapshot {
  version: 1;
  name: string;
  /** Workspace-relative .ck path when available; else basename. */
  module: string;
  values: Record<string, number>;
}

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Stable key for preset folders (workspace-relative path without .ck). */
export function modulePresetKey(moduleFile: string): string {
  const root = workspaceRoot()?.fsPath;
  const resolved = path.resolve(moduleFile);
  if (root) {
    const rel = path.relative(root, resolved);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return rel.replace(/\.ck$/i, '');
    }
  }
  return path.basename(resolved).replace(/\.ck$/i, '');
}

/** Stored module field in JSON (relative .ck path or basename). */
export function modulePresetLabel(moduleFile: string): string {
  const root = workspaceRoot()?.fsPath;
  const resolved = path.resolve(moduleFile);
  if (root) {
    const rel = path.relative(root, resolved);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return rel.split(path.sep).join('/');
    }
  }
  return path.basename(resolved);
}

function knobPresetsRoot(): vscode.Uri | undefined {
  const root = workspaceRoot();
  if (!root) {
    return undefined;
  }
  return vscode.Uri.joinPath(root, '.chuck-live', 'knob-presets');
}

function modulePresetsDir(moduleFile: string): vscode.Uri | undefined {
  const root = knobPresetsRoot();
  if (!root) {
    return undefined;
  }
  const key = modulePresetKey(moduleFile);
  const segments = key.split(/[/\\]/).filter(Boolean);
  return vscode.Uri.joinPath(root, ...segments);
}

export function sanitizeKnobPresetName(raw: string): string | undefined {
  const n = raw.trim().replace(/\.json$/i, '');
  if (!n || !KNOB_PRESET_NAME_RE.test(n)) {
    return undefined;
  }
  return n;
}

async function ensureDir(dir: vscode.Uri): Promise<boolean> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showErrorMessage(
      'Open a workspace folder to save knob presets.'
    );
    return false;
  }
  try {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(root, '.chuck-live')
    );
    await vscode.workspace.fs.createDirectory(knobPresetsRoot()!);
    await vscode.workspace.fs.createDirectory(dir);
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Could not create knob presets folder: ${String(err)}`
    );
    return false;
  }
}

export async function listKnobPresets(moduleFile: string): Promise<string[]> {
  const dir = modulePresetsDir(moduleFile);
  if (!dir) {
    return [];
  }
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    const names: string[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) {
        continue;
      }
      const m = name.match(/^(.+)\.json$/i);
      if (!m || !KNOB_PRESET_NAME_RE.test(m[1])) {
        continue;
      }
      names.push(m[1]);
    }
    names.sort((a, b) => a.localeCompare(b));
    return names;
  } catch {
    return [];
  }
}

export async function readKnobPreset(
  moduleFile: string,
  name: string
): Promise<KnobPresetSnapshot | undefined> {
  const safe = sanitizeKnobPresetName(name);
  const dir = modulePresetsDir(moduleFile);
  if (!safe || !dir) {
    return undefined;
  }
  const uri = vscode.Uri.joinPath(dir, `${safe}.json`);
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(Buffer.from(raw).toString('utf8')) as KnobPresetSnapshot;
    if (!data || typeof data.values !== 'object') {
      return undefined;
    }
    return {
      version: 1,
      name: safe,
      module: data.module ?? modulePresetLabel(moduleFile),
      values: data.values,
    };
  } catch {
    return undefined;
  }
}

export async function writeKnobPreset(
  moduleFile: string,
  name: string,
  values: Record<string, number>
): Promise<boolean> {
  const safe = sanitizeKnobPresetName(name);
  const dir = modulePresetsDir(moduleFile);
  if (!safe || !dir) {
    return false;
  }
  if (!(await ensureDir(dir))) {
    return false;
  }
  const snap: KnobPresetSnapshot = {
    version: 1,
    name: safe,
    module: modulePresetLabel(moduleFile),
    values,
  };
  const uri = vscode.Uri.joinPath(dir, `${safe}.json`);
  try {
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(snap, null, 2), 'utf8')
    );
    const rel = path
      .join('.chuck-live', 'knob-presets', modulePresetKey(moduleFile), `${safe}.json`)
      .split(path.sep)
      .join('/');
    void vscode.window.showInformationMessage(
      `Saved knob preset “${safe}” → ${rel}`
    );
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Could not save knob preset: ${String(err)}`
    );
    return false;
  }
}

export async function deleteKnobPreset(
  moduleFile: string,
  name: string
): Promise<boolean> {
  const safe = sanitizeKnobPresetName(name);
  const dir = modulePresetsDir(moduleFile);
  if (!safe || !dir) {
    return false;
  }
  const uri = vscode.Uri.joinPath(dir, `${safe}.json`);
  try {
    await vscode.workspace.fs.delete(uri);
    void vscode.window.showInformationMessage(`Deleted knob preset “${safe}”.`);
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Could not delete knob preset: ${String(err)}`
    );
    return false;
  }
}
