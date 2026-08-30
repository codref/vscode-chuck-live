import { spawn, ChildProcessWithoutNullStreams, execFile, execFileSync } from 'child_process';
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
  /** Set when listener prints “starting main loop”. */
  private sawMainLoop = false;
  /** Monotonic count of complete log lines. */
  private lineSeq = 0;
  /** Cumulative VM stdout/stderr text (for OTF confirm). */
  private logText = '';
  /** Incomplete trailing line from the last stdout chunk. */
  private lineCarry = '';
  /** True if this VM failed to bind the OTF TCP port (orphan still holds it). */
  private sawBindFail = false;

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
    // Clear orphans hard — chuck --kill often exits 0 without freeing the port.
    await this.forceFreePort(executable, otfPort);

    this.pidFile = path.join(os.tmpdir(), `chuck-live-${otfPort}.pid`);
    try {
      fs.unlinkSync(this.pidFile);
    } catch {
      /* ignore */
    }

    const args = [
      '--loop',
      `--port:${otfPort}`,
      `--pid-file:${this.pidFile}`,
      ...(hasVerboseFlag(vmArgs) ? [] : ['-v2']),
      ...vmArgs,
    ];

    this.output.appendLine(`$ ${executable} ${args.join(' ')}`);
    this.output.show(true);

    this.sawMainLoop = false;
    this.sawBindFail = false;
    this.launchProc(executable, args);

    this.output.appendLine('[wait] audio init / main loop…');
    let ready = await this.waitUntilReady(otfPort, 15000);
    if ((!ready || this.sawBindFail) && this.running) {
      this.output.appendLine(
        '[warn] OTF bind failed or not ready — freeing port and retrying once'
      );
      this.detachProc();
      await this.forceFreePort(executable, otfPort);
      this.sawMainLoop = false;
      this.sawBindFail = false;
      this.launchProc(executable, args);
      this.output.appendLine('[wait] audio init / main loop (retry)…');
      ready = await this.waitUntilReady(otfPort, 15000);
    }
    if (!this.running) {
      vscode.window.showErrorMessage(
        'ChucK VM exited before becoming ready. Check the ChucK output for JACK/audio errors.'
      );
      return;
    }
    if (!ready || this.sawBindFail) {
      await this.failNotReady();
      return;
    }
    this.output.appendLine(`[ok] OTF :${otfPort} ready`);
    this._onStatus.fire(true);
  }

  private async failNotReady(): Promise<void> {
    this.output.appendLine(
      '[error] OTF not ready — port busy, JACK/PipeWire issue, or bind failed. Try Stop VM, then: fuser -k 8888/tcp'
    );
    vscode.window.showErrorMessage(
      'ChucK VM did not become ready. See the ChucK output channel.'
    );
    await this.stop();
  }

  /**
   * Ready when *this* VM reached main loop, bound OTF, and did not log a bind failure.
   */
  private async waitUntilReady(
    otfPort: number,
    timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.running || this.sawBindFail) {
        return false;
      }
      if (this.sawMainLoop && portIsListening(otfPort)) {
        await sleep(250);
        return this.running && !this.sawBindFail;
      }
      await sleep(80);
    }
    return (
      this.running &&
      !this.sawBindFail &&
      this.sawMainLoop &&
      portIsListening(otfPort)
    );
  }

  private async waitUntilPort(
    otfPort: number,
    wantUp: boolean,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (portIsListening(otfPort) === wantUp) {
        return;
      }
      await sleep(80);
    }
  }

  get logSeq(): number {
    return this.lineSeq;
  }

  /** Byte offset into the cumulative VM log (for OTF confirmation). */
  logMark(): number {
    return this.logText.length;
  }

  /** VM log text appended since `mark`. */
  logSince(mark: number): string {
    return this.logText.slice(mark);
  }

  /** Poll until VM log since `mark` matches `pred`, or timeout. */
  async waitLogSince(
    mark: number,
    pred: (delta: string) => boolean,
    timeoutMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pred(this.logText.slice(mark))) {
        return true;
      }
      await sleep(40);
    }
    return pred(this.logText.slice(mark));
  }

  async stop(): Promise<void> {
    const { executable, otfPort } = getConfig();
    this.detachProc();
    await this.forceFreePort(executable, otfPort);
    this.clearProc();
  }

  /** Drop child handle without waiting for exit (avoids clearProc races). */
  private detachProc(): void {
    if (!this.proc) {
      return;
    }
    this.proc.removeAllListeners();
    this.proc.stdout?.removeAllListeners();
    this.proc.stderr?.removeAllListeners();
    try {
      this.proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    this.proc = undefined;
  }

  /** Free OTF port: soft kill, pid-file kill, then fuser if needed. */
  private async forceFreePort(
    executable: string,
    otfPort: number
  ): Promise<void> {
    await this.killListener(executable, otfPort);
    killPidFile(
      path.join(os.tmpdir(), `chuck-live-${otfPort}.pid`),
      this.output
    );
    killChuckListenersOnPort(otfPort, this.output);
    if (portIsListening(otfPort)) {
      this.output.appendLine(`[kill] fuser -k ${otfPort}/tcp`);
      try {
        execFileSync('fuser', ['-k', `${otfPort}/tcp`], {
          stdio: 'ignore',
          timeout: 3000,
        });
      } catch {
        /* fuser missing or nothing to kill */
      }
    }
    await this.waitUntilPort(otfPort, false, 4000);
    if (portIsListening(otfPort)) {
      this.output.appendLine(
        `[warn] port ${otfPort} still in use after kill — OTF may fail`
      );
    }
  }

  /** `chuck --port:N --kill` — best-effort soft clear. */
  private async killListener(
    executable: string,
    otfPort: number
  ): Promise<void> {
    const client = otfClientExecutable(executable);
    this.output.appendLine(`$ ${client} --silent --port:${otfPort} --kill`);
    try {
      const out = await runChuck(
        client,
        ['--silent', `--port:${otfPort}`, '--kill'],
        3000
      );
      if (out.trim()) {
        this.output.append(out.endsWith('\n') ? out : `${out}\n`);
      }
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).trim();
      if (msg) {
        this.output.appendLine(msg);
      }
    }
  }

  dispose(): void {
    void this.stop();
    this.output.dispose();
    this._onStatus.dispose();
    this._onLogLine.dispose();
  }

  private feed(chunk: string): void {
    this.output.append(chunk);
    this.logText += chunk;
    if (this.logText.length > 120_000) {
      this.logText = this.logText.slice(-80_000);
    }
    // Only emit complete lines — partial TCP/stdio chunks must not break matchers.
    const parts = (this.lineCarry + chunk).split(/\r?\n/);
    this.lineCarry = parts.pop() ?? '';
    for (const line of parts) {
      if (!line.length) {
        continue;
      }
      this.lineSeq++;
      if (line.includes('starting main loop')) {
        this.sawMainLoop = true;
      }
      if (line.includes('cannot bind to TCP port')) {
        this.sawBindFail = true;
      }
      this._onLogLine.fire(line);
    }
  }

  private clearProc(): void {
    this.proc = undefined;
    this.sawMainLoop = false;
    this.sawBindFail = false;
    this.lineSeq = 0;
    this.logText = '';
    this.lineCarry = '';
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

  private launchProc(executable: string, args: string[]): void {
    try {
      // chuck-pw line-buffers via stdbuf so JACK/OTF lines reach the Output channel.
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
  }
}

/** True if `port` is in TCP LISTEN — reads /proc, does not connect. */
export function portIsListening(port: number): boolean {
  const needle = `:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) {
        continue;
      }
      const local = cols[1]?.toUpperCase() ?? '';
      const st = cols[3];
      if (st === '0A' && local.endsWith(needle)) {
        return true;
      }
    }
  }
  return false;
}

/** SIGKILL any `chuck --loop` still bound to our OTF port (orphan VMs). */
function killChuckListenersOnPort(
  otfPort: number,
  output: vscode.OutputChannel
): void {
  const portPat = `--port:${otfPort}`;
  try {
    const text = execFileSync('pgrep', ['-af', 'chuck'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.includes(portPat) || !trimmed.includes('--loop')) {
        continue;
      }
      const pid = Number.parseInt(trimmed.split(/\s+/)[0] ?? '', 10);
      if (pid > 1) {
        try {
          process.kill(pid, 'SIGKILL');
          output.appendLine(`[kill] SIGKILL orphan chuck pid ${pid}`);
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* pgrep missing or no matches */
  }
}

function killPidFile(
  pf: string,
  output: vscode.OutputChannel
): void {
  try {
    const pid = parseInt(fs.readFileSync(pf, 'utf8').trim(), 10);
    if (pid > 1) {
      try {
        process.kill(pid, 'SIGKILL');
        output.appendLine(`[kill] SIGKILL pid ${pid}`);
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no pid file */
  }
  try {
    fs.unlinkSync(pf);
  } catch {
    /* ignore */
  }
}

/**
 * OTF client ops (--kill, ^, +) do not need JACK. Prefer bare chuck so we do
 * not open a second pw-jack graph; callers should pass --silent.
 */
export function otfClientExecutable(loopExecutable: string): string {
  const base = path.basename(loopExecutable);
  if (base === 'chuck-pw') {
    return resolveChuckBinary();
  }
  return loopExecutable;
}

/** Absolute `chuck` when possible — extension-host PATH can be thin. */
function resolveChuckBinary(): string {
  for (const candidate of ['/usr/bin/chuck', '/usr/local/bin/chuck', 'chuck']) {
    if (candidate === 'chuck') {
      return candidate;
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return 'chuck';
}

function hasVerboseFlag(args: string[]): boolean {
  return args.some(
    (a) =>
      a === '--verbose' ||
      a.startsWith('--verbose:') ||
      a === '-v' ||
      /^-v\d+$/.test(a)
  );
}

/** Run a one-shot chuck OTF client; resolve with combined stdout+stderr. */
export function runChuck(
  executable: string,
  args: string[],
  timeoutMs = 15_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: timeoutMs, env: process.env },
      (err, stdout, stderr) => {
        const out = `${stdout}${stderr}`;
        if (err) {
          reject(new Error(out || err.message));
          return;
        }
        resolve(out);
      }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
