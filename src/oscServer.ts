import * as dgram from 'dgram';
import { EventEmitter } from 'events';

export interface OscMessage {
  address: string;
  floats: number[];
}

/**
 * Minimal OSC 1.0 UDP receiver (address + float args).
 * Used for meter peaks from ChucK → extension.
 */
export class OscServer extends EventEmitter {
  private socket?: dgram.Socket;
  private port = 0;

  /** Start listening. No-op if already bound to the same port. */
  listen(port: number): void {
    if (this.socket && this.port === port) {
      return;
    }
    this.closeSocket();
    this.port = port;
    const sock = dgram.createSocket('udp4');
    this.socket = sock;
    sock.on('message', (buf) => {
      const msg = decodeOsc(buf);
      if (msg) {
        this.emit('message', msg);
      }
    });
    sock.on('error', (err) => {
      console.warn('OSC meter server:', err.message);
    });
    sock.bind(port, '127.0.0.1');
  }

  dispose(): void {
    this.closeSocket();
    this.removeAllListeners();
  }

  private closeSocket(): void {
    if (!this.socket) {
      return;
    }
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
    this.socket = undefined;
    this.port = 0;
  }
}

/** Decode OSC address + float args (ignores other types). */
export function decodeOsc(buf: Buffer): OscMessage | undefined {
  if (buf.length < 8) {
    return undefined;
  }
  let offset = 0;
  const address = readOscString(buf, offset);
  if (!address || !address.startsWith('/')) {
    return undefined;
  }
  offset = advanceOscString(buf, offset);

  const tags = readOscString(buf, offset);
  if (!tags || !tags.startsWith(',')) {
    return undefined;
  }
  offset = advanceOscString(buf, offset);

  const floats: number[] = [];
  for (let i = 1; i < tags.length; i++) {
    const t = tags[i];
    if (t === 'f') {
      if (offset + 4 > buf.length) {
        break;
      }
      floats.push(buf.readFloatBE(offset));
      offset += 4;
    } else if (t === 'i') {
      if (offset + 4 > buf.length) {
        break;
      }
      // Coerce ints to float for simplicity
      floats.push(buf.readInt32BE(offset));
      offset += 4;
    } else {
      // Unsupported type — stop
      break;
    }
  }

  return { address, floats };
}

function readOscString(buf: Buffer, offset: number): string | undefined {
  if (offset >= buf.length) {
    return undefined;
  }
  const end = buf.indexOf(0, offset);
  if (end < 0) {
    return undefined;
  }
  return buf.toString('utf8', offset, end);
}

function advanceOscString(buf: Buffer, offset: number): number {
  const end = buf.indexOf(0, offset);
  if (end < 0) {
    return buf.length;
  }
  const len = end - offset + 1;
  const pad = (4 - (len % 4)) % 4;
  return end + 1 + pad;
}
