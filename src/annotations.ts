/**
 * Parse explicit knob/button annotations above global declarations.
 *
 *   // @knob min=0 max=1 step=0.01 default=0.5
 *   global float gain;
 *
 *   // @knob ui=slider min=110 max=880
 *   global float freq;
 *
 *   // @slider min=0 max=1   (shorthand for @knob ui=slider)
 *   global float mix;
 *
 *   // @button
 *   global Event bang;
 */

export type KnobKind = 'knob' | 'button';
export type KnobUi = 'dial' | 'slider';

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
}

const ATTR = /(\w+)\s*=\s*([^\s]+)/g;
const GLOBAL_DECL =
  /^\s*global\s+(float|int|Event)\s+([A-Za-z_][\w]*)\s*;/;

export function parseAnnotations(
  text: string,
  file?: string
): Annotation[] {
  const lines = text.split(/\r?\n/);
  const out: Annotation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let kind: KnobKind | undefined;
    let attrs: Record<string, string> = {};
    let uiHint: KnobUi | undefined;

    if (/^\/\/\s*@slider\b/.test(line)) {
      kind = 'knob';
      uiHint = 'slider';
      attrs = parseAttrs(line.replace(/^\/\/\s*@slider\b/, ''));
    } else if (/^\/\/\s*@knob\b/.test(line)) {
      kind = 'knob';
      attrs = parseAttrs(line.replace(/^\/\/\s*@knob\b/, ''));
    } else if (/^\/\/\s*@button\b/.test(line)) {
      kind = 'button';
    } else {
      continue;
    }

    // Next non-empty, non-comment line should be the global decl
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') {
      j++;
    }
    if (j >= lines.length) {
      continue;
    }
    const decl = lines[j].match(GLOBAL_DECL);
    if (!decl) {
      continue;
    }

    const type = decl[1] as Annotation['type'];
    const name = decl[2];

    if (kind === 'knob' && type !== 'float' && type !== 'int') {
      continue;
    }
    if (kind === 'button' && type !== 'Event') {
      continue;
    }

    const ann: Annotation = { kind, name, type, file };
    if (kind === 'knob') {
      ann.ui = parseUi(attrs.ui, uiHint);
      ann.min = num(attrs.min, type === 'int' ? 0 : 0);
      ann.max = num(attrs.max, type === 'int' ? 127 : 1);
      ann.step = num(attrs.step, type === 'int' ? 1 : 0.01);
      if (attrs.default !== undefined) {
        ann.default = num(attrs.default, ann.min ?? 0);
      } else {
        ann.default = ann.min ?? 0;
      }
    }
    out.push(ann);
    i = j; // skip the decl line
  }

  return out;
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

function parseUi(
  raw: string | undefined,
  hint: KnobUi | undefined
): KnobUi {
  if (raw === 'slider' || raw === 'dial') {
    return raw;
  }
  return hint ?? 'dial';
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
