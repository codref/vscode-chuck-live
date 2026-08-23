import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type LibraryPreset = 'full' | 'busStarter';

export interface InitOptions {
  workspaceRoot: string;
  libraryDir: string;
  preset: LibraryPreset;
  deployAgents: boolean;
  overwrite: boolean;
  /** Wipe library folder (full preset) and overwrite agent files without merge prompts. */
  force?: boolean;
}

export interface RunInitOptions {
  force?: boolean;
}

/** Relative paths under `examples/` copied for each preset. */
const PRESET_PATHS: Record<LibraryPreset, string[]> = {
  full: ['.'],
  busStarter: [
    'oscillators/master.ck',
    'oscillators/sine.ck',
    'out/dac-out.ck',
    'README.md',
  ],
};

const AGENT_FILES = [
  'AGENTS.md',
  '.cursor/rules/chuck-live.mdc',
  '.github/copilot-instructions.md',
];

/**
 * Copy bundled library + optional AI agent guides into the workspace.
 */
export async function initChuckProject(
  extensionPath: string,
  options: InitOptions
): Promise<{ copied: number; skipped: number }> {
  const examplesRoot = path.join(extensionPath, 'examples');
  const templatesRoot = path.join(extensionPath, 'templates', 'project-init');
  const libDest = path.join(options.workspaceRoot, options.libraryDir);

  if (options.force && options.preset === 'full' && fs.existsSync(libDest)) {
    fs.rmSync(libDest, { recursive: true, force: true });
  }

  let copied = 0;
  let skipped = 0;

  const relPaths = PRESET_PATHS[options.preset];
  for (const rel of relPaths) {
    const src = path.join(examplesRoot, rel);
    const dest = path.join(libDest, rel === '.' ? '' : rel);
    const n = copyTree(src, dest, options.overwrite);
    copied += n.copied;
    skipped += n.skipped;
  }

  if (options.deployAgents) {
    for (const rel of AGENT_FILES) {
      const src = path.join(templatesRoot, rel);
      const dest = path.join(options.workspaceRoot, rel);
      const n = copyFile(src, dest, options.overwrite);
      if (n === 'copied') copied++;
      if (n === 'skipped') skipped++;
    }
  }

  return { copied, skipped };
}

/** Interactive init: pick preset, folder, agent deploy, overwrite policy. */
export async function runInitProjectCommand(
  extensionPath: string,
  runOpts: RunInitOptions = {}
): Promise<void> {
  const force = !!runOpts.force;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('Open a workspace folder first.');
    return;
  }

  const cfg = vscode.workspace.getConfiguration('chuckLive');
  const defaultDir = cfg.get<string>('initLibraryDir', 'chuck');

  const presetPick = await vscode.window.showQuickPick(
    [
      {
        label: 'Full library',
        description: 'All modules, drums, FX, out, standalone, docs',
        preset: 'full' as LibraryPreset,
      },
      {
        label: 'Bus starter',
        description: 'master.ck + sine.ck + dac-out.ck + README',
        preset: 'busStarter' as LibraryPreset,
      },
    ],
    {
      placeHolder: force
        ? 'Force re-init — replace bundled files'
        : 'ChucK library preset',
    }
  );
  if (!presetPick) {
    return;
  }

  const libraryDir = await vscode.window.showInputBox({
    title: 'Library folder (inside workspace)',
    value: defaultDir,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) return 'Required';
      if (path.isAbsolute(t) || t.startsWith('..')) {
        return 'Use a relative path inside the workspace';
      }
      return null;
    },
  });
  if (!libraryDir?.trim()) {
    return;
  }

  const deployAgents = await vscode.window.showQuickPick(
    [
      { label: 'Yes', deploy: true },
      { label: 'No', deploy: false },
    ],
    {
      placeHolder: force
        ? 'Force overwrite AI guides?'
        : 'Deploy AI guides (AGENTS.md, Cursor rule, Copilot instructions)?',
    }
  );
  if (!deployAgents) {
    return;
  }

  const libPath = path.join(folder.uri.fsPath, libraryDir.trim());
  const agentPaths = AGENT_FILES.map((f) =>
    path.join(folder.uri.fsPath, f)
  );
  const exists =
    fs.existsSync(libPath) ||
    (deployAgents.deploy && agentPaths.some((p) => fs.existsSync(p)));

  let overwrite = force;
  let forceMode = force;

  if (exists) {
    if (!force) {
      const policy = await vscode.window.showQuickPick(
        [
          { label: 'Merge (skip existing files)', overwrite: false, force: false },
          { label: 'Overwrite existing files', overwrite: true, force: false },
          {
            label: 'Force re-init (replace library + guides)',
            overwrite: true,
            force: true,
          },
          { label: 'Cancel', overwrite: undefined, force: undefined },
        ],
        { placeHolder: 'Some target files already exist' }
      );
      if (!policy || policy.overwrite === undefined) {
        return;
      }
      overwrite = policy.overwrite;
      forceMode = !!policy.force;
    }

    if (forceMode) {
      const wipeNote =
        presetPick.preset === 'full'
          ? `Remove and replace the entire "${libraryDir.trim()}/" folder`
          : `Overwrite bundled starter files under "${libraryDir.trim()}/"`;
      const agentNote = deployAgents.deploy
        ? ' and refresh AI guide files'
        : '';
      const ok = await vscode.window.showWarningMessage(
        `Force re-init: ${wipeNote}${agentNote}.`,
        { modal: true },
        'Re-init'
      );
      if (ok !== 'Re-init') {
        return;
      }
    }
  }

  try {
    const result = await initChuckProject(extensionPath, {
      workspaceRoot: folder.uri.fsPath,
      libraryDir: libraryDir.trim(),
      preset: presetPick.preset,
      deployAgents: deployAgents.deploy,
      overwrite: overwrite || forceMode,
      force: forceMode,
    });

    await showInitResult(result, libraryDir.trim(), libPath);
  } catch (err) {
    vscode.window.showErrorMessage(`Init failed: ${err}`);
  }
}

async function showInitResult(
  result: { copied: number; skipped: number },
  libraryDir: string,
  libPath: string
): Promise<void> {
  const msg = `ChucK project init: ${result.copied} file(s) copied${
    result.skipped ? `, ${result.skipped} skipped` : ''
  } → ${libraryDir}/`;
  vscode.window.showInformationMessage(msg);

  const openLib = await vscode.window.showInformationMessage(
    msg,
    'Open library folder'
  );
  if (openLib === 'Open library folder') {
    const uri = vscode.Uri.file(libPath);
    await vscode.commands.executeCommand('revealInExplorer', uri);
  }
}

function copyTree(
  src: string,
  dest: string,
  overwrite: boolean
): { copied: number; skipped: number } {
  let copied = 0;
  let skipped = 0;
  if (!fs.existsSync(src)) {
    throw new Error(`Missing bundled path: ${src}`);
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      const child = copyTree(
        path.join(src, name),
        path.join(dest, name),
        overwrite
      );
      copied += child.copied;
      skipped += child.skipped;
    }
  } else {
    const r = copyFile(src, dest, overwrite);
    if (r === 'copied') copied++;
    if (r === 'skipped') skipped++;
  }
  return { copied, skipped };
}

function copyFile(
  src: string,
  dest: string,
  overwrite: boolean
): 'copied' | 'skipped' {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing bundled file: ${src}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && !overwrite) {
    return 'skipped';
  }
  fs.copyFileSync(src, dest);
  return 'copied';
}
