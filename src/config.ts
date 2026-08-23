import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Set from activate() so we can resolve bin/chuck-pw. */
let extensionPath = '';

export function setExtensionPath(p: string): void {
  extensionPath = p;
}

/**
 * Resolve chuck binary. Default prefers the PipeWire JACK wrapper
 * shipped at bin/chuck-pw (needed when chuck is JACK-only).
 * Set chuckLive.executable to an absolute path to override.
 */
export function getConfig() {
  const c = vscode.workspace.getConfiguration('chuckLive');
  const configured = c.get<string>('executable', 'chuck');
  return {
    executable: resolveExecutable(configured),
    otfPort: c.get<number>('otfPort', 8888),
    oscPort: c.get<number>('oscPort', 9000),
    meterPort: c.get<number>('meterPort', 9001),
    vmArgs: c.get<string[]>('vmArgs', []),
    saveBeforeAdd: c.get<boolean>('saveBeforeAdd', true),
  };
}

function resolveExecutable(configured: string): string {
  // User override (not the default token "chuck")
  if (configured && configured !== 'chuck') {
    return configured;
  }
  if (extensionPath) {
    const wrapped = path.join(extensionPath, 'bin', 'chuck-pw');
    try {
      fs.accessSync(wrapped, fs.constants.X_OK);
      return wrapped;
    } catch {
      /* wrapper missing or not executable */
    }
  }
  return 'chuck';
}
