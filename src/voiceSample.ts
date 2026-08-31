import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { getConfig } from './config';

const execFileAsync = promisify(execFile);

/** Doom-friendly picks shown at the top when present in the live catalog. */
const PINNED_VOICE_NAMES = [
  'en-US-GuyNeural',
  'en-US-ChristopherNeural',
  'en-US-AndrewNeural',
  'en-GB-RyanNeural',
  'en-US-JennyNeural',
  'en-GB-SoniaNeural',
];

interface EdgeVoice {
  name: string;
  gender: string;
  categories: string;
  personality: string;
}

const SAMPLE_NAME = 'doom-vox.wav';

const COMMON_BIN_DIRS = ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];

/** Resolve bare tool names to an absolute path when the extension PATH is thin. */
export function resolveToolPath(configured: string): string {
  const raw = (configured || '').trim();
  if (!raw) {
    return raw;
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  for (const dir of COMMON_BIN_DIRS) {
    const candidate = path.join(dir, raw);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return raw;
}

/**
 * Probe a binary. ffmpeg uses `-version` (exit 0); `--version` exits non-zero
 * on many builds even though it prints a banner — that was a false "not found".
 */
async function toolOk(bin: string): Promise<boolean> {
  for (const args of [['-version'], ['--version']] as string[][]) {
    try {
      await execFileAsync(bin, args, { timeout: 8000 });
      return true;
    } catch {
      /* try next flag */
    }
  }
  return false;
}

/** Prefer library / examples voices/samples, else .chuck-live/samples. */
export function resolveDoomVoxOutPath(
  extensionPath: string,
  workspaceRoot: string
): string {
  const cfg = vscode.workspace.getConfiguration('chuckLive');
  const libDir = cfg.get<string>('initLibraryDir', 'chuck');

  const candidates = [
    path.join(workspaceRoot, libDir, 'voices', 'samples', SAMPLE_NAME),
    path.join(workspaceRoot, 'examples', 'voices', 'samples', SAMPLE_NAME),
    path.join(workspaceRoot, '.chuck-live', 'samples', SAMPLE_NAME),
  ];

  const editor = vscode.window.activeTextEditor;
  if (editor?.document.fileName.endsWith('doom-vox.ck')) {
    const beside = path.join(
      path.dirname(editor.document.fileName),
      'samples',
      SAMPLE_NAME
    );
    candidates.unshift(beside);
  }

  for (const p of candidates) {
    const dir = path.dirname(p);
    const parentVoices = path.dirname(dir);
    if (
      fs.existsSync(parentVoices) ||
      fs.existsSync(path.join(path.dirname(parentVoices), 'voices')) ||
      p.includes(`${path.sep}examples${path.sep}voices${path.sep}`) ||
      p.includes(`${path.sep}${libDir}${path.sep}voices${path.sep}`)
    ) {
      return p;
    }
  }

  // Extension-repo fallback when developing without init
  const bundled = path.join(
    extensionPath,
    'examples',
    'voices',
    'samples',
    SAMPLE_NAME
  );
  if (fs.existsSync(path.dirname(path.dirname(bundled)))) {
    return bundled;
  }

  return candidates[candidates.length - 1];
}

async function run(
  bin: string,
  args: string[],
  opts?: { cwd?: string }
): Promise<void> {
  await execFileAsync(bin, args, {
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    cwd: opts?.cwd,
  });
}

function formatTtsError(err: unknown, voice: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('NoAudioReceived') || msg.includes('No audio was received')) {
    return (
      `edge-tts returned no audio for voice "${voice}". ` +
      `Pick another voice from the list or run \`edge-tts --list-voices\`. ` +
      `Also check network access to Microsoft's TTS service.`
    );
  }
  const firstLine = msg.split('\n').find((l) => l.trim()) ?? msg;
  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}…` : firstLine;
}

/** Parse `edge-tts --list-voices` table output. */
export function parseEdgeTtsVoiceList(stdout: string): EdgeVoice[] {
  const voices: EdgeVoice[] = [];
  for (const line of stdout.split('\n').slice(2)) {
    if (!line.trim()) {
      continue;
    }
    const m = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) {
      continue;
    }
    const rest = m[3].trim();
    const split = rest.match(/^(.+?)\s{2,}(.+)$/);
    voices.push({
      name: m[1],
      gender: m[2],
      categories: split ? split[1].trim() : rest,
      personality: split ? split[2].trim() : '',
    });
  }
  return voices;
}

function toQuickPickItem(v: EdgeVoice): vscode.QuickPickItem & { voiceName: string } {
  const detail = [v.categories, v.personality].filter(Boolean).join(' · ');
  return {
    label: v.name,
    description: `${v.gender}${detail ? ` — ${detail}` : ''}`,
    voiceName: v.name,
  };
}

async function loadVoiceQuickPickItems(
  edgeBin: string,
  preferredName: string
): Promise<(vscode.QuickPickItem & { voiceName: string })[]> {
  const { stdout } = await execFileAsync(edgeBin, ['--list-voices'], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const catalog = parseEdgeTtsVoiceList(stdout);
  if (catalog.length === 0) {
    throw new Error('edge-tts --list-voices returned no voices');
  }

  const byName = new Map(catalog.map((v) => [v.name, v]));
  const items: (vscode.QuickPickItem & { voiceName: string })[] = [];
  const seen = new Set<string>();

  const push = (name: string, prefix: string) => {
    if (seen.has(name)) {
      return;
    }
    const v = byName.get(name);
    if (!v) {
      return;
    }
    seen.add(name);
    items.push({
      ...toQuickPickItem(v),
      label: `${prefix}${v.name}`,
    });
  };

  if (preferredName) {
    push(preferredName, '$(star) ');
  }
  for (const name of PINNED_VOICE_NAMES) {
    push(name, '$(pin) ');
  }
  for (const v of catalog.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!seen.has(v.name)) {
      seen.add(v.name);
      items.push(toQuickPickItem(v));
    }
  }
  return items;
}

/**
 * Prompt for text/voice, run edge-tts + ffmpeg → mono 44.1 kHz WAV for doom-vox.ck.
 * Binaries come from chuckLive.edgeTtsExecutable / chuckLive.ffmpegExecutable.
 */
export async function generateVoiceSampleCommand(
  extensionPath: string
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Open a workspace folder first.');
    return;
  }

  const {
    edgeTtsExecutable,
    ffmpegExecutable,
    edgeTtsVoice,
  } = getConfig();

  const edgeBin = resolveToolPath(edgeTtsExecutable);
  const ffmpegBin = resolveToolPath(ffmpegExecutable);

  if (!(await toolOk(edgeBin))) {
    void vscode.window.showErrorMessage(
      `edge-tts not found (${edgeBin}). Install with: pip install edge-tts — or set chuckLive.edgeTtsExecutable to the full path.`
    );
    return;
  }

  if (!(await toolOk(ffmpegBin))) {
    void vscode.window.showErrorMessage(
      `ffmpeg not found (${ffmpegBin}). Install ffmpeg — or set chuckLive.ffmpegExecutable to the full path (e.g. /usr/bin/ffmpeg).`
    );
    return;
  }

  const text = await vscode.window.showInputBox({
    title: 'Doom voice — text to speak',
    prompt: 'Phrase for edge-tts (saved as doom-vox.wav)',
    placeHolder: 'We are the hollow men…',
    ignoreFocusOut: true,
  });
  if (text === undefined) {
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    void vscode.window.showWarningMessage('Empty text — cancelled.');
    return;
  }

  let voiceItems: (vscode.QuickPickItem & { voiceName: string })[];
  try {
    voiceItems = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading edge-tts voices…',
        cancellable: false,
      },
      () => loadVoiceQuickPickItems(edgeBin, edgeTtsVoice)
    );
  } catch (err) {
    void vscode.window.showErrorMessage(formatTtsError(err, edgeTtsVoice));
    return;
  }

  const voicePick = await vscode.window.showQuickPick(voiceItems, {
    title: 'edge-tts voice',
    placeHolder: `Type to filter (${voiceItems.length} voices). Default: ${edgeTtsVoice}`,
    matchOnDescription: true,
    ignoreFocusOut: true,
  });
  if (!voicePick) {
    return;
  }
  const voiceName = voicePick.voiceName;

  const defaultOut = resolveDoomVoxOutPath(
    extensionPath,
    folder.uri.fsPath
  );
  const outInput = await vscode.window.showInputBox({
    title: 'Output WAV path',
    value: defaultOut,
    prompt: 'doom-vox.ck loads me.dir() + "samples/doom-vox.wav"',
    ignoreFocusOut: true,
  });
  if (!outInput) {
    return;
  }
  const outPath = path.resolve(outInput.trim());

  let generated = false;
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating doom-vox sample…',
        cancellable: false,
      },
      async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chuck-live-tts-'));
        const mp3Path = path.join(tmpDir, 'speech.mp3');
        try {
          await run(edgeBin, [
            '--voice',
            voiceName,
            '--text',
            trimmed,
            '--write-media',
            mp3Path,
          ]);
          if (!fs.existsSync(mp3Path) || fs.statSync(mp3Path).size < 64) {
            throw new Error('NoAudioReceived: output file empty');
          }
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          await run(ffmpegBin, [
            '-y',
            '-i',
            mp3Path,
            '-ac',
            '1',
            '-ar',
            '44100',
            '-sample_fmt',
            's16',
            outPath,
          ]);
          generated = true;
        } finally {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      }
    );
  } catch (err) {
    void vscode.window.showErrorMessage(formatTtsError(err, voiceName));
    return;
  }

  if (!generated) {
    return;
  }

  const reload = 'Reload shred';
  const choice = await vscode.window.showInformationMessage(
    `Saved voice sample → ${outPath}. Reload doom-vox.ck to hear it.`,
    reload
  );
  if (choice === reload) {
    await vscode.commands.executeCommand('chuckLive.replaceShred');
  }
}
