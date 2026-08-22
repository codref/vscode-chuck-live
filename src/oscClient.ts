import * as dgram from 'dgram';

/**
 * Minimal OSC 1.0 UDP sender (address + float or int).
 * No external OSC library — keeps the extension small.
 */
export class OscClient {
  private socket = dgram.createSocket('udp4');

  sendFloat(host: string, port: number, address: string, value: number): void {
    this.socket.send(encodeOsc(address, 'f', value), port, host);
  }

  sendInt(host: string, port: number, address: string, value: number): void {
    this.socket.send(encodeOsc(address, 'i', value), port, host);
  }

  dispose(): void {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}

function encodeOsc(
  address: string,
  type: 'f' | 'i',
  value: number
): Buffer {
  const addr = padOsc(Buffer.from(address + '\0', 'utf8'));
  const tags = padOsc(Buffer.from(',' + type + '\0', 'utf8'));
  const arg = Buffer.alloc(4);
  if (type === 'f') {
    arg.writeFloatBE(value, 0);
  } else {
    arg.writeInt32BE(value | 0, 0);
  }
  return Buffer.concat([addr, tags, arg]);
}

/** OSC strings/blobs are zero-padded to 4-byte boundaries. */
function padOsc(buf: Buffer): Buffer {
  const pad = (4 - (buf.length % 4)) % 4;
  if (pad === 0) {
    return buf;
  }
  return Buffer.concat([buf, Buffer.alloc(pad)]);
}
