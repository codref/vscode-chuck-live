import * as path from 'path';
import * as vscode from 'vscode';

export const SEQ_PRESET_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export interface SeqBankSnapshot {
  values: number[];
  gates: number[];
  probs: number[];
}

/** Single-track sequencer preset (A/B banks). Independent of full-pattern Save As. */
export interface SeqPresetSnapshot {
  version: 1;
  name: string;
  /** Sequencer target global name. */
  track: string;
  kind?: string;
  mode?: string;
  gate?: string;
  swing?: number;
  activeBank?: 'A' | 'B';
  editBank?: 'A' | 'B';
  banks: {
    A: SeqBankSnapshot;
    B: SeqBankSnapshot;
  };
}

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function seqPresetsRoot(): vscode.Uri | undefined {
  const root = workspaceRoot();
  if (!root) {
    return undefined;
  }
  return vscode.Uri.joinPath(root, '.chuck-live', 'seq-presets');
}

function trackPresetsDir(trackName: string): vscode.Uri | undefined {
  const root = seqPresetsRoot();
  if (!root) {
    return undefined;
  }
  const key = sanitizeTrackKey(trackName);
  if (!key) {
    return undefined;
  }
  return vscode.Uri.joinPath(root, key);
}

export function sanitizeTrackKey(raw: string): string | undefined {
  const n = raw.trim();
  if (!n || !SEQ_PRESET_NAME_RE.test(n)) {
    return undefined;
  }
  return n;
}

export function sanitizeSeqPresetName(raw: string): string | undefined {
  const n = raw.trim().replace(/\.json$/i, '');
  if (!n || !SEQ_PRESET_NAME_RE.test(n)) {
    return undefined;
  }
  return n;
}

async function ensureDir(dir: vscode.Uri): Promise<boolean> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showErrorMessage(
      'Open a workspace folder to save track sequence presets.'
    );
    return false;
  }
  try {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(root, '.chuck-live')
    );
    await vscode.workspace.fs.createDirectory(seqPresetsRoot()!);
    await vscode.workspace.fs.createDirectory(dir);
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Could not create seq presets folder: ${String(err)}`
    );
    return false;
  }
}

function pad16(arr: number[] | undefined, fill: number): number[] {
  const out = (arr ?? []).slice(0, 16);
  while (out.length < 16) {
    out.push(fill);
  }
  return out;
}

function normalizeBank(raw: unknown): SeqBankSnapshot | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const b = raw as Record<string, unknown>;
  return {
    values: pad16(Array.isArray(b.values) ? (b.values as number[]) : [], 0),
    gates: pad16(Array.isArray(b.gates) ? (b.gates as number[]) : [], 0),
    probs: pad16(Array.isArray(b.probs) ? (b.probs as number[]) : [], 1),
  };
}

export async function listSeqPresets(trackName: string): Promise<string[]> {
  const dir = trackPresetsDir(trackName);
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
      if (!m || !SEQ_PRESET_NAME_RE.test(m[1])) {
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

export async function readSeqPreset(
  trackName: string,
  name: string
): Promise<SeqPresetSnapshot | undefined> {
  const safe = sanitizeSeqPresetName(name);
  const track = sanitizeTrackKey(trackName);
  const dir = trackPresetsDir(trackName);
  if (!safe || !track || !dir) {
    return undefined;
  }
  const uri = vscode.Uri.joinPath(dir, `${safe}.json`);
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(Buffer.from(raw).toString('utf8')) as SeqPresetSnapshot;
    const bankA = normalizeBank(data?.banks?.A);
    const bankB = normalizeBank(data?.banks?.B);
    if (!bankA || !bankB) {
      return undefined;
    }
    return {
      version: 1,
      name: safe,
      track: data.track ?? track,
      kind: typeof data.kind === 'string' ? data.kind : undefined,
      mode: typeof data.mode === 'string' ? data.mode : undefined,
      gate: typeof data.gate === 'string' ? data.gate : undefined,
      swing: typeof data.swing === 'number' ? data.swing : undefined,
      activeBank: data.activeBank === 'B' ? 'B' : 'A',
      editBank: data.editBank === 'B' ? 'B' : 'A',
      banks: { A: bankA, B: bankB },
    };
  } catch {
    return undefined;
  }
}

export async function writeSeqPreset(
  trackName: string,
  name: string,
  snap: Omit<SeqPresetSnapshot, 'version' | 'name' | 'track'> & {
    banks: { A: SeqBankSnapshot; B: SeqBankSnapshot };
  }
): Promise<boolean> {
  const safe = sanitizeSeqPresetName(name);
  const track = sanitizeTrackKey(trackName);
  const dir = trackPresetsDir(trackName);
  if (!safe || !track || !dir) {
    return false;
  }
  if (!(await ensureDir(dir))) {
    return false;
  }
  const bankA = normalizeBank(snap.banks.A);
  const bankB = normalizeBank(snap.banks.B);
  if (!bankA || !bankB) {
    return false;
  }
  const payload: SeqPresetSnapshot = {
    version: 1,
    name: safe,
    track,
    kind: snap.kind,
    mode: snap.mode,
    gate: snap.gate,
    swing: snap.swing,
    activeBank: snap.activeBank === 'B' ? 'B' : 'A',
    editBank: snap.editBank === 'B' ? 'B' : 'A',
    banks: { A: bankA, B: bankB },
  };
  const uri = vscode.Uri.joinPath(dir, `${safe}.json`);
  try {
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
    );
    const rel = path
      .join('.chuck-live', 'seq-presets', track, `${safe}.json`)
      .split(path.sep)
      .join('/');
    void vscode.window.showInformationMessage(
      `Saved track preset “${safe}” → ${rel}`
    );
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Could not save track preset: ${String(err)}`
    );
    return false;
  }
}

export async function deleteSeqPreset(
  trackName: string,
  name: string
): Promise<boolean> {
  const safe = sanitizeSeqPresetName(name);
  const dir = trackPresetsDir(trackName);
  if (!safe || !dir) {
    return false;
  }
  const uri = vscode.Uri.joinPath(dir, `${safe}.json`);
  try {
    await vscode.workspace.fs.delete(uri);
    void vscode.window.showInformationMessage(`Deleted track preset “${safe}”.`);
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Could not delete track preset: ${String(err)}`
    );
    return false;
  }
}
