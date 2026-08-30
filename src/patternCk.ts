import {
  generateTransportSource,
  TransportSpec,
  TransportTrack,
} from './transportGen';

/** Snapshot shape compatible with Sequencer `applyPatternFile`. */
export interface PatternSnapshot {
  version: number;
  name: string;
  scaleName?: string;
  masterBpm?: number;
  syncClocks?: boolean;
  swingEnabled?: boolean;
  trackOrder: string[];
  patterns: Record<
    string,
    {
      kind: 'float' | 'gate';
      mode?: 'raw' | 'midi';
      bpm?: number;
      swing?: number;
      muted?: boolean;
      solo?: boolean;
      gate?: string;
      activeBank?: string;
      editBank?: string;
      banks?: {
        A: { values: number[]; gates: number[]; probs: number[] };
        B: { values: number[]; gates: number[]; probs: number[] };
      };
    }
  >;
}

export interface CkPatternMeta {
  name: string;
  bpm: number;
  scale: string;
  version: number;
}

const TRACK_LINE =
  /^\/\/\s*track\s+(\d+):\s*(\S+)\s+\((float|gate)\)(?:\s+gate=(\S+))?/i;
const HEADER_NAME = /@chuckLivePattern\b.*\bname=([^\s]+)/i;
const HEADER_BPM = /\bbpm=(\d+(?:\.\d+)?)/i;
const HEADER_SCALE = /\bscale=(\S+)/i;
const HEADER_VERSION = /\bversion=(\d+)/i;
const ARRAY_LINE = /^\[([^\]]*)\]\s*@=>\s*(?:int|float)\s+(t\d+_[gvp])\[\]/;

function pad16(arr: number[], fill: number): number[] {
  const out = arr.slice(0, 16);
  while (out.length < 16) {
    out.push(fill);
  }
  return out;
}

function parseArrayBody(body: string): number[] {
  if (!body.trim()) {
    return Array(16).fill(0);
  }
  return body.split(',').map((s) => parseFloat(s.trim()));
}

function hzToMidi(hz: number): number {
  if (hz <= 0) {
    return 0;
  }
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

function inferFloatMode(values: number[], gate?: string): 'raw' | 'midi' {
  if (!gate) {
    return 'raw';
  }
  let max = 0;
  for (const v of values) {
    if (v > max) {
      max = v;
    }
  }
  // Transport bakes MIDI lanes as Hz; accent/velocity lanes stay 0–1.
  return max > 20 ? 'midi' : 'raw';
}

/** Export transport spec as a loadable / standalone .ck pattern file. */
export function exportCkPattern(
  spec: TransportSpec,
  meta: { name: string; scale?: string }
): string {
  const scale = meta.scale ?? 'phrygian';
  const header = [
    `// @chuckLivePattern version=1 name=${meta.name} bpm=${spec.bpm} scale=${scale}`,
    '// ChucK Live pattern — editable step arrays below',
    '',
  ];
  return header.join('\n') + generateTransportSource(spec);
}

/** Parse header metadata from a pattern .ck file. */
export function parseCkMeta(source: string): CkPatternMeta | null {
  const firstLines = source.split('\n').slice(0, 8).join('\n');
  const nameM = firstLines.match(HEADER_NAME);
  if (!nameM) {
    return null;
  }
  const bpmM = firstLines.match(HEADER_BPM);
  const scaleM = firstLines.match(HEADER_SCALE);
  const verM = firstLines.match(HEADER_VERSION);
  return {
    name: nameM[1],
    bpm: bpmM ? parseFloat(bpmM[1]) : 120,
    scale: scaleM ? scaleM[1] : 'phrygian',
    version: verM ? parseInt(verM[1], 10) : 1,
  };
}

interface ParsedTrack {
  index: number;
  name: string;
  kind: 'float' | 'gate';
  gate?: string;
  gates: number[];
  values: number[];
  probs: number[];
  swing: number;
  muted: boolean;
  solo: boolean;
  running: boolean;
}

/** Parse a transport-style .ck pattern into a Sequencer snapshot (bank A only). */
export function parseCkPattern(source: string): PatternSnapshot | null {
  const meta = parseCkMeta(source);
  if (!meta) {
    return null;
  }

  const trackInfo = new Map<number, ParsedTrack>();
  const arrayData = new Map<string, number[]>();

  for (const line of source.split('\n')) {
    const tm = line.match(TRACK_LINE);
    if (tm) {
      const idx = parseInt(tm[1], 10);
      trackInfo.set(idx, {
        index: idx,
        name: tm[2],
        kind: tm[3] as 'float' | 'gate',
        gate: tm[4] || undefined,
        gates: Array(16).fill(0),
        values: Array(16).fill(0),
        probs: Array(16).fill(1),
        swing: 0,
        muted: false,
        solo: false,
        running: true,
      });
      continue;
    }

    const am = line.match(ARRAY_LINE);
    if (am) {
      arrayData.set(am[2], parseArrayBody(am[1]));
      continue;
    }

    // New live_seq_* seed format (index = track*16+step).
    const gSeed = line.match(
      /^(\d+)\s*=>\s*live_seq_g\[(\d+)\];/
    );
    if (gSeed) {
      const idx = parseInt(gSeed[2], 10);
      const tr = Math.floor(idx / 16);
      const st = idx % 16;
      const t = trackInfo.get(tr);
      if (t && st < 16) {
        t.gates[st] = parseInt(gSeed[1], 10) > 0 ? 1 : 0;
      }
      continue;
    }
    const vSeed = line.match(
      /^(-?\d+(?:\.\d+)?)\s*=>\s*live_seq_v\[(\d+)\];/
    );
    if (vSeed) {
      const idx = parseInt(vSeed[2], 10);
      const tr = Math.floor(idx / 16);
      const st = idx % 16;
      const t = trackInfo.get(tr);
      if (t && st < 16) {
        t.values[st] = parseFloat(vSeed[1]);
      }
      continue;
    }
    const pSeed = line.match(
      /^(-?\d+(?:\.\d+)?)\s*=>\s*live_seq_p\[(\d+)\];/
    );
    if (pSeed) {
      const idx = parseInt(pSeed[2], 10);
      const tr = Math.floor(idx / 16);
      const st = idx % 16;
      const t = trackInfo.get(tr);
      if (t && st < 16) {
        t.probs[st] = parseFloat(pSeed[1]);
      }
      continue;
    }

    const swingNew = line.match(
      /^(-?\d+(?:\.\d+)?)\s*=>\s*live_seq_swing\[(\d+)\];/
    );
    if (swingNew) {
      const t = trackInfo.get(parseInt(swingNew[2], 10));
      if (t) {
        t.swing = parseFloat(swingNew[1]);
      }
      continue;
    }
    const mutedNew = line.match(/^(\d+)\s*=>\s*live_seq_muted\[(\d+)\];/);
    if (mutedNew) {
      const t = trackInfo.get(parseInt(mutedNew[2], 10));
      if (t) {
        t.muted = mutedNew[1] === '1';
      }
      continue;
    }
    const soloNew = line.match(/^(\d+)\s*=>\s*live_seq_solo\[(\d+)\];/);
    if (soloNew) {
      const t = trackInfo.get(parseInt(soloNew[2], 10));
      if (t) {
        t.solo = soloNew[1] === '1';
      }
      continue;
    }
    const runNew = line.match(/^(\d+)\s*=>\s*live_seq_run\[(\d+)\];/);
    if (runNew) {
      const t = trackInfo.get(parseInt(runNew[2], 10));
      if (t) {
        t.running = runNew[1] === '1';
      }
      continue;
    }

    // Legacy tN_* format.
    const swingM = line.match(/^(\d+(?:\.\d+)?)\s*=>\s*float\s+t(\d+)_swing;/);
    if (swingM) {
      const t = trackInfo.get(parseInt(swingM[2], 10));
      if (t) {
        t.swing = parseFloat(swingM[1]);
      }
      continue;
    }

    const mutedM = line.match(/^(\d+)\s*=>\s*int\s+t(\d+)_muted;/);
    if (mutedM) {
      const t = trackInfo.get(parseInt(mutedM[2], 10));
      if (t) {
        t.muted = mutedM[1] === '1';
      }
      continue;
    }

    const soloM = line.match(/^(\d+)\s*=>\s*int\s+t(\d+)_solo;/);
    if (soloM) {
      const t = trackInfo.get(parseInt(soloM[2], 10));
      if (t) {
        t.solo = soloM[1] === '1';
      }
      continue;
    }

    const runM = line.match(/^(\d+)\s*=>\s*int\s+t(\d+)_run;/);
    if (runM) {
      const t = trackInfo.get(parseInt(runM[2], 10));
      if (t) {
        t.running = runM[1] === '1';
      }
    }
  }

  if (!trackInfo.size) {
    return null;
  }

  const sorted = [...trackInfo.values()].sort((a, b) => a.index - b.index);
  const trackOrder: string[] = [];
  const patterns: PatternSnapshot['patterns'] = {};

  for (const t of sorted) {
    const gArr = arrayData.get(`t${t.index}_g`) ?? t.gates;
    const vArr = arrayData.get(`t${t.index}_v`) ?? t.values;
    const pArr = arrayData.get(`t${t.index}_p`) ?? t.probs;
    t.gates = pad16(gArr, 0).map((g) => (g > 0.5 ? 1 : 0));
    t.values = pad16(vArr, 0);
    t.probs = pad16(pArr, 1);

    const mode =
      t.kind === 'float' ? inferFloatMode(t.values, t.gate) : 'raw';
    if (mode === 'midi') {
      t.values = t.values.map((v) => (v > 0 ? hzToMidi(v) : 0));
    }

    trackOrder.push(t.name);
    patterns[t.name] = {
      kind: t.kind,
      mode,
      bpm: meta.bpm,
      swing: t.swing,
      muted: t.muted,
      solo: t.solo,
      gate: t.gate ?? '',
      activeBank: 'A',
      editBank: 'A',
      banks: {
        A: { values: t.values, gates: t.gates, probs: t.probs },
        B: { values: t.values, gates: t.gates, probs: t.probs },
      },
    };
  }

  return {
    version: 1,
    name: meta.name,
    scaleName: meta.scale,
    masterBpm: meta.bpm,
    syncClocks: true,
    swingEnabled: false,
    trackOrder,
    patterns,
  };
}

/** Build TransportSpec from a pattern snapshot (for .ck export). */
export function snapshotToTransportSpec(
  snap: PatternSnapshot,
  meterPort: number,
  midiToHzFn: (n: number) => number
): TransportSpec {
  const tracks: TransportTrack[] = [];
  for (const name of snap.trackOrder ?? []) {
    const p = snap.patterns?.[name];
    if (!p) {
      continue;
    }
    const bank = p.banks?.A ?? {
      values: [],
      gates: [],
      probs: [],
    };
    const kind = p.kind === 'gate' ? 'gate' : 'float';
    let values = pad16(bank.values, 0);
    if (kind === 'float' && p.mode === 'midi') {
      values = values.map((v) => midiToHzFn(v));
    }
    tracks.push({
      name,
      kind,
      gate: p.gate || undefined,
      muted: !!p.muted,
      solo: !!p.solo,
      swing: p.swing ?? 0,
      running: true,
      gates: pad16(bank.gates, 0),
      values,
      probs: pad16(bank.probs, 1),
    });
  }
  return {
    bpm: snap.masterBpm ?? 120,
    step: 0,
    running: false,
    swingEnabled: !!snap.swingEnabled,
    meterPort,
    tracks,
  };
}
