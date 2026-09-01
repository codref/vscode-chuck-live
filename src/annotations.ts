/**
 * Parse explicit knob/button/seq/mod annotations above global declarations.
 *
 *   // @knob min=0 max=1 step=0.01 default=0.5
 *   global float gain;
 *
 *   // @modSource label=LFO bipolar=1
 *   global float mb_lfoOut;
 *
 *   // @modTarget label=Pitch unit=hz
 *   global float mb_pitchMod;
 *
 *   // @modRoute src=LFO dst=Pitch default=1 depth=0.05
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
  /** Accepts external modulation via mod matrix. */
  isModTarget?: boolean;
  modLabel?: string;
  modUnit?: string;
  modScale?: number;
  /** Rack section from nearest preceding `// ---- name ----` comment. */
  section?: string;
}

/** Modulation source exported by a patch (`@modSource`). */
export interface ModSource {
  name: string;
  label: string;
  bipolar: boolean;
  file?: string;
  /** 1-based index assigned at scan time (global across session). */
  index?: number;
}

/** Modulation destination (`@modTarget`). */
export interface ModTarget {
  /** Base global name from declaration. */
  name: string;
  /** Global written by mod-matrix shred. */
  modName: string;
  /** Route selector global (0 = patch default). */
  srcName: string;
  /** Route depth global 0..1. */
  depthName: string;
  label: string;
  unit?: string;
  scale?: number;
  /** True when the declared global is the mod offset itself (not a knob). */
  dedicated: boolean;
  file?: string;
  moduleFile?: string;
  moduleTitle?: string;
  shredId?: number;
}

/** Factory default route (`@modRoute`). */
export interface ModRoute {
  srcLabel: string;
  dstLabel: string;
  default: boolean;
  depth: number;
  file?: string;
}

/** Per-file mod matrix metadata. */
export interface ModMatrixFileMeta {
  sources: ModSource[];
  targets: ModTarget[];
  routes: ModRoute[];
}

const ATTR = /(\w+)\s*=\s*([^\s]+)/g;
const GLOBAL_DECL =
  /^\s*global\s+(float|int|Event)\s+([A-Za-z_][\w]*)\s*;/;
const ANN_LINE =
  /^\/\/\s*@(slider|knob|button|seq|seqGate|modSource|modTarget)\b(.*)$/;
const MOD_ROUTE_LINE = /^\/\/\s*@modRoute\b(.*)$/;
const SECTION_LINE = /^\/\/\s*----\s*(.+?)\s*----\s*$/;

/** Route bus global names for a mod target. */
export function modBusNames(
  baseName: string,
  dedicated: boolean
): { modName: string; srcName: string; depthName: string } {
  const modName = dedicated ? baseName : `${baseName}_mod`;
  return {
    modName,
    srcName: `${modName}_src`,
    depthName: `${modName}_depth`,
  };
}

export function parseAnnotations(
  text: string,
  file?: string
): Annotation[] {
  return parseFileAnnotations(text, file).annotations;
}

export function parseModMatrixFromFile(
  text: string,
  file?: string
): ModMatrixFileMeta {
  return parseFileAnnotations(text, file).mod;
}

function parseFileAnnotations(
  text: string,
  file?: string
): { annotations: Annotation[]; mod: ModMatrixFileMeta } {
  const lines = text.split(/\r?\n/);
  const annotations: Annotation[] = [];
  const sources: ModSource[] = [];
  const targets: ModTarget[] = [];
  const routes: ModRoute[] = [];

  for (const raw of lines) {
    const routeM = raw.trim().match(MOD_ROUTE_LINE);
    if (routeM) {
      const attrs = parseAttrs(routeM[1] || '');
      if (attrs.src && attrs.dst) {
        routes.push({
          srcLabel: attrs.src,
          dstLabel: attrs.dst,
          default: attrs.default === '1' || attrs.default === 'true',
          depth: num(attrs.depth, 0.5),
          file,
        });
      }
    }
  }

  let i = 0;
  let currentSection: string | undefined;
  while (i < lines.length) {
    const line = lines[i].trim();
    const sectionM = line.match(SECTION_LINE);
    if (sectionM) {
      currentSection = normalizeSection(sectionM[1]);
      i++;
      continue;
    }
    const m0 = line.match(ANN_LINE);
    if (!m0) {
      i++;
      continue;
    }

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

    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '') {
        i++;
        continue;
      }
      // Skip doc lines like "// Extension: …" between @knob and the global decl.
      if (t.startsWith('//') && !ANN_LINE.test(t)) {
        i++;
        continue;
      }
      break;
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

    const modSource = stack.find((s) => s.tag === 'modSource');
    if (modSource && type === 'float') {
      const attrs = parseAttrs(modSource.rest);
      sources.push({
        name,
        label: attrs.label || name,
        bipolar: attrs.bipolar === '1' || attrs.bipolar === 'true',
        file,
      });
    }

    const modTargetTag = stack.find((s) => s.tag === 'modTarget');
    if (modTargetTag && type === 'float') {
      const attrs = parseAttrs(modTargetTag.rest);
      const hasKnob = stack.some(
        (s) => s.tag === 'knob' || s.tag === 'slider' || s.tag === 'seq'
      );
      const dedicated = !hasKnob;
      const bus = modBusNames(name, dedicated);
      targets.push({
        name,
        modName: bus.modName,
        srcName: bus.srcName,
        depthName: bus.depthName,
        label: attrs.label || name,
        unit: attrs.unit,
        scale: attrs.scale !== undefined ? num(attrs.scale, 1) : undefined,
        dedicated,
        file,
      });
    }

    const ann = mergeStack(stack, name, type, file);
    if (ann) {
      if (modTargetTag && type === 'float') {
        const attrs = parseAttrs(modTargetTag.rest);
        ann.isModTarget = true;
        ann.modLabel = attrs.label || name;
        ann.modUnit = attrs.unit;
        if (attrs.scale !== undefined) {
          ann.modScale = num(attrs.scale, 1);
        }
      }
      if (currentSection) {
        ann.section = currentSection;
      }
      annotations.push(ann);
    }
    i++;
  }

  return {
    annotations,
    mod: { sources, targets, routes },
  };
}

/** Float knobs + @seqGate Events for the Sequencer panel. */
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
      kind: 'float' as const,
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

  for (const a of anns) {
    if (a.kind === 'button' && a.type === 'Event' && a.isSeqGate) {
      targets.push({
        name: a.name,
        kind: 'gate',
        mode: 'raw',
        min: 0,
        max: 1,
        step: 1,
        default: 1,
        preferred: true,
        file: a.file,
      });
    }
  }

  targets.sort((a, b) => {
    if (a.preferred !== b.preferred) {
      return a.preferred ? -1 : 1;
    }
    if (a.kind !== b.kind) {
      return a.kind === 'gate' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return targets;
}

/** A float or gate-only Event the Sequencer panel can drive. */
export interface SeqTarget {
  name: string;
  /** float = value lane; gate = Event trigger pads only */
  kind: 'float' | 'gate';
  mode: SeqMode;
  min: number;
  max: number;
  step: number;
  default: number;
  gate?: string;
  /** From explicit @seq or @seqGate */
  preferred: boolean;
  file?: string;
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
  const hasModSourceOnly =
    stack.length === 1 && stack[0].tag === 'modSource';
  const hasModTargetOnly =
    stack.length === 1 && stack[0].tag === 'modTarget';

  if (hasModSourceOnly || hasModTargetOnly) {
    return undefined;
  }

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

function normalizeSection(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
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
