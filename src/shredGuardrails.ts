import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ShredOps, isFileModule } from './shredOps';

export type ShredRole = 'master' | 'busModule' | 'speakerOut' | 'other';

/** Strip // line comments so header notes don't false-positive classification. */
export function stripLineComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');
}

export function classifyCkSource(src: string): ShredRole {
  const code = stripLineComments(src);

  const hasGlobalRack = /\bglobal\s+Gain\s+rackBus\b/.test(code);
  const hasGlobalMain = /\bglobal\s+Gain\s+mainBus\b/.test(code);
  const hasRackToMain =
    /\brackBus\s*=>/.test(code) && /=>\s*mainBus\b/.test(code);
  if (hasGlobalRack && hasGlobalMain && hasRackToMain) {
    return 'master';
  }

  // Into rackBus (instrument / drum), not the master chain itself
  if (/=>\s*rackBus\b/.test(code)) {
    return 'busModule';
  }

  // Speaker path: mainBus … => dac (dac-out or bus-fx). Record tap has no => dac.
  if (/\bmainBus\b/.test(code) && /=>\s*dac\b/.test(code)) {
    return 'speakerOut';
  }

  return 'other';
}

function readCkText(filePath: string): string {
  const abs = path.resolve(filePath);
  const open = vscode.workspace.textDocuments.find(
    (d) => path.resolve(d.fileName) === abs
  );
  if (open) {
    return open.getText();
  }
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

export function classifyCkFile(filePath: string): ShredRole {
  return classifyCkSource(readCkText(filePath));
}

interface SessionRoles {
  hasMaster: boolean;
  speakerOuts: { path: string; name: string }[];
}

function sessionRoles(
  shredOps: ShredOps,
  excludePath?: string
): SessionRoles {
  const exclude = excludePath ? path.resolve(excludePath) : undefined;
  let hasMaster = false;
  const speakerOuts: { path: string; name: string }[] = [];

  for (const shred of shredOps.list()) {
    if (
      !isFileModule(shred.source, {
        isBridge: shred.isBridge,
        isMeter: shred.isMeter,
        isTransport: shred.isTransport,
      })
    ) {
      continue;
    }
    const abs = path.resolve(shred.source);
    if (exclude && abs === exclude) {
      continue;
    }
    const role = classifyCkFile(abs);
    if (role === 'master') {
      hasMaster = true;
    } else if (role === 'speakerOut') {
      speakerOuts.push({ path: abs, name: path.basename(abs) });
    }
  }

  return { hasMaster, speakerOuts };
}

function warningForAdd(
  filePath: string,
  role: ShredRole,
  session: SessionRoles
): string | undefined {
  const name = path.basename(filePath);

  if (role === 'busModule' && !session.hasMaster) {
    return `${name} feeds rackBus. Load oscillators/master.ck first, or audio stays silent.`;
  }

  if (role === 'speakerOut') {
    if (session.speakerOuts.length > 0) {
      const other = session.speakerOuts.map((s) => s.name).join(', ');
      return `${name} would double-wire dac (already have ${other}). Remove the other output shred first, or Cancel.`;
    }
    if (!session.hasMaster) {
      return `Load master.ck before ${name} so mainBus exists.`;
    }
  }

  return undefined;
}

/**
 * Preflight bus-role checks before Add / Reload.
 * Returns false if the user cancels; true to proceed (no issue or Add anyway).
 */
export async function confirmAddGuardrails(
  filePath: string,
  shredOps: ShredOps
): Promise<boolean> {
  const abs = path.resolve(filePath);
  const role = classifyCkFile(abs);
  const session = sessionRoles(shredOps, abs);
  const msg = warningForAdd(abs, role, session);
  if (!msg) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    msg,
    'Add anyway',
    'Cancel'
  );
  return choice === 'Add anyway';
}
