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
    return !!this.proc && !this.proc.killed;
  }

  async start(): Promise<void> {
    if (this.running) {
      vscode.window.showInformationMessage('ChucK VM is already running');
      return;
    }

    const { executable, otfPort, vmArgs } = getConfig();
    this.pidFile = path.join(os.tmpdir(), `chuck-live-${otfPort}.pid`);

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

    // Brief wait so OTF listener is up before bridge/add.
    await sleep(400);
    if (!this.running) {
      return;
    }
    this._onStatus.fire(true);
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
