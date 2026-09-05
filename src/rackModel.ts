import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Annotation, parseAnnotations } from './annotations';
import { LIVE_TRANSPORT } from './bridgeGen';
import { resolveChuckPath } from './chuckPaths';
import { modulePresetKey } from './knobPresets';
import { ShredOps, isFileModule } from './shredOps';

/** One Eurorack-style module = one loaded (non-bridge) shred + its annotations. */
export interface RackControlGroup {
  /** Section divider text; omitted for pinned primary block. */
  label?: string;
  /** Gate / gain block pinned at top of scroll area. */
  pinned?: boolean;
  knobs: Annotation[];
}

export interface RackModule {
  id: number;
  title: string;
  file: string;
  /** Workspace-relative path key for knob presets (no .ck). */
  moduleKey: string;
  knobs: Annotation[];
  /** Layout groups for rack faceplate (primary + section dividers). */
  groups: RackControlGroup[];
  /** Hint UI for master filter module chrome. */
  isMaster?: boolean;
  /** Virtual sequencer / transport faceplate (live_bpm). */
  isTransport?: boolean;
}

const GAIN_NAME = /(?:^|_)(amp|gain|level|vol)$|^master(_amp)?$/i;

function isPrimaryGain(k: Annotation): boolean {
  return k.kind === 'knob' && GAIN_NAME.test(k.name);
}

/** Title-case section labels while preserving slash separators. */
export function formatSectionLabel(section: string): string {
  return section
    .split('/')
    .map((part) => part.trim())
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' / ');
}

/** Primary (gate/gain) block + section groups in source order. */
export function buildRackControlGroups(knobs: Annotation[]): RackControlGroup[] {
  const primaryNames = new Set<string>();
  const primaryKnobs: Annotation[] = [];

  for (const k of knobs) {
    if (k.kind === 'button') {
      primaryKnobs.push(k);
      primaryNames.add(k.name);
    }
  }
  for (const k of knobs) {
    if (isPrimaryGain(k) && !primaryNames.has(k.name)) {
      primaryKnobs.push(k);
      primaryNames.add(k.name);
    }
  }

  const rest = knobs.filter((k) => !primaryNames.has(k.name));
  const hasAnySection = rest.some((k) => !!k.section);
  const groups: RackControlGroup[] = [];

  if (primaryKnobs.length) {
    groups.push({ pinned: true, knobs: primaryKnobs });
  }

  let i = 0;
  while (i < rest.length) {
    const section = rest[i].section;
    const bucket: Annotation[] = [];
    while (i < rest.length && rest[i].section === section) {
      bucket.push(rest[i]);
      i++;
    }
    if (!bucket.length) {
      continue;
    }
    groups.push({
      label: section
        ? formatSectionLabel(section)
        : hasAnySection
          ? 'Controls'
          : undefined,
      knobs: bucket,
    });
  }

  return groups.length ? groups : [{ knobs }];
}

/** Wired-only shreds: stay loaded but are not rack faceplates. */
export function isRackHiddenModule(file: string, title?: string): boolean {
  return (
    /(?:^|[/\\])dac-out\.ck$/i.test(file) ||
    /^dac-out\.ck$/i.test(title ?? '')
  );
}

/** Build rack modules from currently tracked shreds (skip bridge + spork children). */
export function buildModulesFromShreds(shredOps: ShredOps): RackModule[] {
  const modules: RackModule[] = [];

  for (const shred of shredOps.listVisible()) {
    if (!isFileModule(shred.source, {
      isBridge: shred.isBridge,
      isMeter: shred.isMeter,
      isTransport: shred.isTransport,
      isModMatrix: shred.isModMatrix,
    })) {
      continue;
    }
    const file = path.resolve(
      resolveChuckPath(shred.source, shred.source)
    );
    const title =
      path.basename(file) ||
      path.basename(shred.source) ||
      `shred-${shred.id}`;
    if (isRackHiddenModule(file, title)) {
      continue;
    }
    const knobs = annotationsForFile(file);
    modules.push({
      id: shred.id,
      title,
      file,
      moduleKey: modulePresetKey(file),
      knobs,
      groups: buildRackControlGroups(knobs),
      isMaster:
        /(?:^|[/\\])master\.ck$/i.test(file) || /^master\.ck$/i.test(title),
    });
  }

  // listVisible already applies user order; keep master first within that list
  modules.sort((a, b) => {
    if (a.isMaster !== b.isMaster) {
      return a.isMaster ? -1 : 1;
    }
    return 0; // stable — preserve listVisible order
  });

  return modules;
}

/** Virtual rack module for master tempo (`live_bpm` on the OSC bridge). */
export function buildTransportRackModule(bpm = 120): RackModule {
  const safe = Math.max(40, Math.min(200, bpm));
  const knobs: Annotation[] = [
    {
      kind: 'knob',
      name: LIVE_TRANSPORT.bpm,
      type: 'float',
      ui: 'dial',
      min: 40,
      max: 200,
      step: 1,
      default: safe,
    },
  ];
  return {
    id: -1,
    title: 'sequencer',
    file: 'chuck-live-transport',
    moduleKey: 'chuck-live-transport',
    isTransport: true,
    knobs,
    groups: [{ knobs }],
  };
}

/** User modules plus optional transport faceplate when the VM bridge is loaded. */
export function buildRackModules(
  shredOps: ShredOps,
  liveBpm = 120
): RackModule[] {
  const user = buildModulesFromShreds(shredOps);
  const vmUp = shredOps.list().some((s) => s.isBridge);
  if (!vmUp) {
    return user;
  }
  return [buildTransportRackModule(liveBpm), ...user];
}

function annotationsForFile(resolvedPath: string): Annotation[] {
  const base = path.basename(resolvedPath);

  const openExact = vscode.workspace.textDocuments.find(
    (d) => path.resolve(d.fileName) === path.resolve(resolvedPath)
  );
  if (openExact) {
    return parseAnnotations(openExact.getText(), openExact.fileName);
  }

  const openBase = vscode.workspace.textDocuments.find(
    (d) =>
      path.basename(d.fileName) === base &&
      (d.languageId === 'chuck' || d.fileName.endsWith('.ck'))
  );
  if (openBase) {
    return parseAnnotations(openBase.getText(), openBase.fileName);
  }

  try {
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      return parseAnnotations(
        fs.readFileSync(resolvedPath, 'utf8'),
        resolvedPath
      );
    }
  } catch {
    /* missing file */
  }
  return [];
}
