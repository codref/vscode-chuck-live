import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from './config';

/**
 * Owns the long-lived `chuck --loop` process (OTF listener).
 * Shred ops talk to it via a second short-lived `chuck` client process.
 */
export class ChuckVm {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private pidFile: string | undefined;
  readonly output: vscode.OutputChannel;
  private readonly _onStatus = new vscode.EventEmitter<boolean>();
  /** Fires when VM starts (true) or stops (false). */
  readonly onStatusChange = this._onStatus.event;
  /** Raw lines from the listener (used to parse shred status). */
  private readonly _onLogLine = new vscode.EventEmitter<string>();
  readonly onLogLine = this._onLogLine.event;

  constructor() {
    this.output = vscode.window.createOutputChannel('ChucK');
  }

  get running(): boolean {
    return !!this.proc && this.proc.exitCode === null && !this.proc.killed;
  }

  async start(): Promise<void> {
    if (this.running) {
      vscode.window.showInformationMessage('ChucK VM is already running');
      return;
    }

    const { executable, otfPort, vmArgs } = getConfig();
    this.pidFile = path.join(os.tmpdir(), `chuck-live-${otfPort}.pid`);
    // Stale pid from a previous crash blocks readiness checks.
    try {
      fs.unlinkSync(this.pidFile);
    } catch {
      /* ignore */
    }

    const args = [
      '--loop',
      `--port:${otfPort}`,
      `--pid-file:${this.pidFile}`,
      ...vmArgs,
    ];

    this.output.appendLine(`$ ${executable} ${args.join(' ')}`);
    this.output.show(true);

    try {
      this.proc = spawn(executable, args, { env: process.env });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to start chuck: ${err}`);
      return;
    }

    this.proc.stdout.on('data', (buf: Buffer) => this.feed(buf.toString()));
    this.proc.stderr.on('data', (buf: Buffer) => this.feed(buf.toString()));
    this.proc.on('error', (err) => {
      this.output.appendLine(`[error] ${err.message}`);
      vscode.window.showErrorMessage(
        `chuck failed to start (is it on PATH?): ${err.message}`
      );
      this.clearProc();
    });
    this.proc.on('exit', (code, signal) => {
      this.output.appendLine(`[vm exited] code=${code} signal=${signal}`);
      this.clearProc();
    });

    // pw-jack / JACK can take well over 400ms — wait until OTF answers.
    const ready = await this.waitUntilReady(8000);
    if (!this.running) {
      return;
    }
    if (!ready) {
      this.output.appendLine(
        '[warn] OTF listener not ready — Add shred / bridge may fail until it is'
      );
      vscode.window.showWarningMessage(
        'ChucK VM started but OTF is not answering yet — wait a moment, then Add again'
      );
    }
    this._onStatus.fire(true);
  }

  /** Poll until `chuck --port ^` succeeds or the process dies. */
  private async waitUntilReady(timeoutMs: number): Promise<boolean> {
    const { executable, otfPort } = getConfig();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.running) {
        return false;
      }
      try {
        await runChuck(executable, [`--port:${otfPort}`, '^']);
        return true;
      } catch {
        await sleep(150);
      }
    }
    return false;
  }

  async stop(): Promise<void> {
    if (!this.running && !this.pidFile) {
      return;
    }
    const { executable, otfPort } = getConfig();
    try {
      await runChuck(executable, [`--port:${otfPort}`, '--kill']);
    } catch {
      // fall through to SIGTERM
    }
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
    }
    this.clearProc();
  }

  dispose(): void {
    void this.stop();
    this.output.dispose();
    this._onStatus.dispose();
    this._onLogLine.dispose();
  }

  private feed(chunk: string): void {
    this.output.append(chunk);
    for (const line of chunk.split(/\r?\n/)) {
      if (line.length) {
        this._onLogLine.fire(line);
      }
    }
  }

  private clearProc(): void {
    this.proc = undefined;
    if (this.pidFile) {
      try {
        fs.unlinkSync(this.pidFile);
      } catch {
        /* ignore */
      }
      this.pidFile = undefined;
    }
    this._onStatus.fire(false);
  }
}

/** Run a one-shot chuck OTF client; resolve with combined stdout+stderr. */
export function runChuck(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { timeout: 15_000 }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`;
      if (err) {
        reject(new Error(out || err.message));
        return;
      }
      resolve(out);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
