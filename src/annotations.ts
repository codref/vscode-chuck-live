/**
 * Parse explicit knob/button/seq annotations above global declarations.
 *
 *   // @knob min=0 max=1 step=0.01 default=0.5
 *   global float gain;
 *
 *   // @slider min=40 max=1600
 *   // @seq mode=raw
 *   global float sine_freq;
 *
 *   // @seq mode=midi min=24 max=84 gate=mb_gate
 *   global float mb_noteHz;
 *
 *   // @seqGate
 *   global Event mb_gate;
 *
 *   // @button
 *   global Event bang;
 */

export type KnobKind = 'knob' | 'button';
export type KnobUi = 'dial' | 'slider';
export type SeqMode = 'raw' | 'midi';

export interface Annotation {
  kind: KnobKind;
  name: string;
  type: 'float' | 'int' | 'Event';
  /** Visual control; only for kind === 'knob'. Default: dial. */
  ui?: KnobUi;
  min?: number;
  max?: number;
  step?: number;
  default?: number;
  /** Source file path if known */
  file?: string;
  /** Prefer this float as a sequencer target. */
  seq?: boolean;
  seqMode?: SeqMode;
  /** Optional Event name fired when a gated step runs. */
  seqGate?: string;
  /** Event is available as a sequencer gate. */
  isSeqGate?: boolean;
}

/** A float (or preferred @seq) the Sequencer panel can drive. */
export interface SeqTarget {
  name: string;
  mode: SeqMode;
  min: number;
  max: number;
  step: number;
  default: number;
  gate?: string;
  /** From explicit @seq */
  preferred: boolean;
  file?: string;
}

const ATTR = /(\w+)\s*=\s*([^\s]+)/g;
const GLOBAL_DECL =
  /^\s*global\s+(float|int|Event)\s+([A-Za-z_][\w]*)\s*;/;
const ANN_LINE = /^\/\/\s*@(slider|knob|button|seq|seqGate)\b(.*)$/;

export function parseAnnotations(
  text: string,
  file?: string
): Annotation[] {
  const lines = text.split(/\r?\n/);
  const out: Annotation[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const m0 = line.match(ANN_LINE);
    if (!m0) {
      i++;
      continue;
    }

    // Collect consecutive annotation comments (blank lines allowed between).
    const stack: { tag: string; rest: string }[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '') {
        i++;
        continue;
      }
      const m = t.match(ANN_LINE);
      if (!m) {
        break;
      }
      stack.push({ tag: m[1], rest: m[2] || '' });
      i++;
    }

    // Skip blanks then expect global decl
    while (i < lines.length && lines[i].trim() === '') {
      i++;
    }
    if (i >= lines.length) {
      break;
    }
    const decl = lines[i].match(GLOBAL_DECL);
    if (!decl) {
      continue;
    }

    const type = decl[1] as Annotation['type'];
    const name = decl[2];
    const ann = mergeStack(stack, name, type, file);
    if (ann) {
      out.push(ann);
    }
    i++; // consume decl
  }

  return out;
}

/** Float knobs (+ optional Event gates) for the Sequencer panel. */
export function seqTargetsFromAnnotations(anns: Annotation[]): SeqTarget[] {
  const gateNames = new Set(
    anns
      .filter((a) => a.kind === 'button' && a.type === 'Event')
      .map((a) => a.name)
  );

  const floats = anns.filter((a) => a.kind === 'knob');
  const targets: SeqTarget[] = floats.map((f) => {
    let gate = f.seqGate;
    if (gate && !gateNames.has(gate)) {
      gate = undefined;
    }
    const mode: SeqMode = f.seqMode ?? 'raw';
    const min = f.min ?? (mode === 'midi' ? 24 : 0);
    const max = f.max ?? (mode === 'midi' ? 84 : 1);
    return {
      name: f.name,
      mode,
      min,
      max,
      step: f.step ?? (mode === 'midi' ? 1 : 0.01),
      default: f.default ?? min,
      gate,
      preferred: !!f.seq,
      file: f.file,
    };
  });

  targets.sort((a, b) => {
    if (a.preferred !== b.preferred) {
      return a.preferred ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return targets;
}

/** Merge by name (later files win). */
export function mergeAnnotations(lists: Annotation[][]): Annotation[] {
  const map = new Map<string, Annotation>();
  for (const list of lists) {
    for (const a of list) {
      map.set(a.name, a);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeStack(
  stack: { tag: string; rest: string }[],
  name: string,
  type: Annotation['type'],
  file?: string
): Annotation | undefined {
  let kind: KnobKind | undefined;
  let ui: KnobUi | undefined;
  let attrs: Record<string, string> = {};
  let seq = false;
  let seqMode: SeqMode | undefined;
  let seqGate: string | undefined;
  let isSeqGate = false;

  for (const { tag, rest } of stack) {
    const a = parseAttrs(rest);
    if (tag === 'slider') {
      kind = 'knob';
      ui = 'slider';
      attrs = { ...attrs, ...a };
    } else if (tag === 'knob') {
      kind = 'knob';
      attrs = { ...attrs, ...a };
      if (a.ui === 'slider' || a.ui === 'dial') {
        ui = a.ui;
      }
    } else if (tag === 'button') {
      kind = 'button';
    } else if (tag === 'seq') {
      seq = true;
      if (!kind) {
        kind = 'knob';
      }
      attrs = { ...attrs, ...a };
      if (a.mode === 'midi' || a.mode === 'raw') {
        seqMode = a.mode;
      }
      if (a.gate) {
        seqGate = a.gate;
      }
    } else if (tag === 'seqGate') {
      kind = 'button';
      isSeqGate = true;
    }
  }

  if (!kind) {
    return undefined;
  }
  if (kind === 'knob' && type !== 'float' && type !== 'int') {
    return undefined;
  }
  if (kind === 'button' && type !== 'Event') {
    return undefined;
  }

  const ann: Annotation = { kind, name, type, file };
  if (kind === 'knob') {
    const mode = seqMode ?? 'raw';
    ann.ui = ui ?? 'dial';
    ann.min = num(
      attrs.min,
      type === 'int' ? 0 : mode === 'midi' ? 24 : 0
    );
    ann.max = num(
      attrs.max,
      type === 'int' ? 127 : mode === 'midi' ? 84 : 1
    );
    ann.step = num(
      attrs.step,
      type === 'int' || mode === 'midi' ? 1 : 0.01
    );
    if (attrs.default !== undefined) {
      ann.default = num(attrs.default, ann.min ?? 0);
    } else {
      ann.default = ann.min ?? 0;
    }
    if (seq) {
      ann.seq = true;
      ann.seqMode = seqMode ?? 'raw';
      if (seqGate) {
        ann.seqGate = seqGate;
      }
    }
  } else {
    if (isSeqGate) {
      ann.isSeqGate = true;
    }
  }
  return ann;
}

function parseAttrs(rest: string): Record<string, string> {
  const o: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(rest))) {
    o[m[1]] = m[2];
  }
  return o;
}

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
