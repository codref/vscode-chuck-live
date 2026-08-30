import * as dgram from 'dgram';

export type OscArg = { type: 'i'; value: number } | { type: 'f'; value: number };

/**
 * Minimal OSC 1.0 UDP sender.
 * No external OSC library — keeps the extension small.
 */
export class OscClient {
  private socket = dgram.createSocket('udp4');

  sendFloat(host: string, port: number, address: string, value: number): void {
    this.send(host, port, address, [{ type: 'f', value }]);
  }

  sendInt(host: string, port: number, address: string, value: number): void {
    this.send(host, port, address, [{ type: 'i', value }]);
  }

  /** Multi-arg OSC (e.g. iii, iif, ii, if). */
  send(
    host: string,
    port: number,
    address: string,
    args: OscArg[]
  ): void {
    this.socket.send(encodeOsc(address, args), port, host);
  }

  dispose(): void {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}

function encodeOsc(address: string, args: OscArg[]): Buffer {
  const addr = padOsc(Buffer.from(address + '\0', 'utf8'));
  const typeTag = ',' + args.map((a) => a.type).join('') + '\0';
  const tags = padOsc(Buffer.from(typeTag, 'utf8'));
  const parts: Buffer[] = [addr, tags];
  for (const a of args) {
    const arg = Buffer.alloc(4);
    if (a.type === 'f') {
      arg.writeFloatBE(a.value, 0);
    } else {
      arg.writeInt32BE(a.value | 0, 0);
    }
    parts.push(arg);
  }
  return Buffer.concat(parts);
}

/** OSC strings/blobs are zero-padded to 4-byte boundaries. */
function padOsc(buf: Buffer): Buffer {
  const pad = (4 - (buf.length % 4)) % 4;
  if (pad === 0) {
    return buf;
  }
  return Buffer.concat([buf, Buffer.alloc(pad)]);
}
