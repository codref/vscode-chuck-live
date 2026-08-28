import * as vscode from 'vscode';

const TAGS = [
  'knob',
  'slider',
  'button',
  'seq',
  'seqGate',
  'modSource',
  'modTarget',
  'modRoute',
] as const;
type AnnTag = (typeof TAGS)[number];

const RANGE_ATTRS = ['min', 'max', 'step', 'default'] as const;

const ATTRS: Record<AnnTag, readonly string[]> = {
  knob: [...RANGE_ATTRS, 'ui'],
  slider: [...RANGE_ATTRS],
  seq: [...RANGE_ATTRS, 'mode', 'gate'],
  button: [],
  seqGate: [],
  modSource: ['label', 'bipolar'],
  modTarget: ['label', 'unit', 'scale'],
  modRoute: ['src', 'dst', 'default', 'depth'],
};

const ATTR_DOCS: Record<string, string> = {
  min: 'Lower bound (default 0, or 24 when `mode=midi`).',
  max: 'Upper bound (default 1, or 84 when `mode=midi`).',
  step: 'Increment (default 0.01, or 1 for int / midi).',
  default:
    'Initial knob value (defaults to `min`), or `1` for `@modRoute` factory routes.',
  ui: '`dial` (default) or `slider`.',
  mode: '`raw` (default) or `midi`.',
  gate: 'Event name broadcast when a gated sequencer step runs.',
  label: 'Jack label in the Mod Matrix panel.',
  bipolar: '`1` for ±1 LFO-style sources; `0` for 0..1 envelope-style.',
  unit: 'Destination unit hint (`hz`, `semitones`, etc.).',
  scale: 'Multiplier applied in the patch `follow()` loop.',
  src: 'Source jack label for `@modRoute`.',
  dst: 'Destination jack label for `@modRoute`.',
  depth: 'Mod amount 0..1 for `@modRoute` or live matrix cables.',
};

const VALUE_ENUMS: Record<string, readonly { value: string; doc: string }[]> = {
  ui: [
    { value: 'dial', doc: 'Rotary knob (default).' },
    { value: 'slider', doc: 'Horizontal range slider.' },
  ],
  mode: [
    { value: 'raw', doc: 'Sequence the float as-is.' },
    { value: 'midi', doc: 'Treat values as MIDI notes (default range 24–84).' },
  ],
};

const TAG_META: Record<
  AnnTag,
  { detail: string; doc: string; snippet: string }
> = {
  knob: {
    detail: 'global float | int',
    doc: 'Rotary control. OSC `/chuck/<name>` float. Optional attrs: `min`, `max`, `step`, `default`, `ui`.',
    snippet: 'knob min=${1:0} max=${2:1} step=${3:0.01} default=${4:0.5}',
  },
  slider: {
    detail: 'global float | int',
    doc: 'Horizontal slider (same OSC as `@knob`). Optional attrs: `min`, `max`, `step`, `default`.',
    snippet: 'slider min=${1:0} max=${2:1} step=${3:0.01} default=${4:0.5}',
  },
  button: {
    detail: 'global Event',
    doc: 'Bang button. OSC `/chuck/<name>` int → `Event.broadcast()`.',
    snippet: 'button',
  },
  seq: {
    detail: 'sequencer float track',
    doc: 'Prefer this float as a Sequencer lane. Attrs: `mode` (`raw`|`midi`), `gate`, plus knob range attrs.',
    snippet: 'seq mode=${1:raw}',
  },
  seqGate: {
    detail: 'global Event',
    doc: 'Prefer this Event as a gate-only Sequencer track (pads, no value lane).',
    snippet: 'seqGate',
  },
  modSource: {
    detail: 'global float',
    doc: 'Mod matrix source output. Patch writes the live value in `follow()`. Attrs: `label`, `bipolar`.',
    snippet: 'modSource label=${1:LFO} bipolar=${2:1}',
  },
  modTarget: {
    detail: 'global float',
    doc: 'Mod matrix destination. Matrix writes `<name>` or `<knob>_mod`. Attrs: `label`, `unit`, `scale`.',
    snippet: 'modTarget label=${1:Pitch}',
  },
  modRoute: {
    detail: 'factory default route',
    doc: 'Default mod patch when route src is 0. Standalone line: `// @modRoute src=LFO dst=Pitch default=1 depth=0.05`',
    snippet: 'modRoute src=${1:LFO} dst=${2:Pitch} default=1 depth=${3:0.05}',
  },
};

const EVENT_DECL = /^\s*global\s+Event\s+([A-Za-z_][\w]*)\s*;/gm;

export type AnnCompleteKind = 'tag' | 'attr' | 'value';

export interface AnnCompleteContext {
  kind: AnnCompleteKind;
  replaceStart: number;
  replaceEnd: number;
  partial: string;
  tag?: AnnTag;
  usedAttrs?: Set<string>;
  attr?: string;
}

export function analyzeAnnotationLine(
  line: string,
  character: number
): AnnCompleteContext | undefined {
  const prefix = line.slice(0, character);
  const m = prefix.match(/^(\s*)\/\/(.*)$/);
  if (!m) {
    return undefined;
  }

  const slashIndex = m[1].length;
  const body = m[2];
  const bodyStart = slashIndex + 2;
  const leadWs = (body.match(/^\s*/) || [''])[0];
  const trimmed = body.slice(leadWs.length);

  if (trimmed === '') {
    return {
      kind: 'tag',
      replaceStart: character,
      replaceEnd: character,
      partial: '',
    };
  }
  if (!trimmed.startsWith('@')) {
    return undefined;
  }

  const atInLine = bodyStart + leadWs.length;
  const afterAt = trimmed.slice(1);
  const tagM = afterAt.match(/^([A-Za-z]*)([\s\S]*)$/);
  if (!tagM) {
    return undefined;
  }
  const tagPartial = tagM[1];
  const afterTag = tagM[2];

  if (afterTag === '') {
    return {
      kind: 'tag',
      replaceStart: atInLine,
      replaceEnd: character,
      partial: tagPartial,
    };
  }
  if (!/^\s/.test(afterTag)) {
    return undefined;
  }

  const known = TAGS.find((t) => t === tagPartial);
  if (!known) {
    return undefined;
  }

  const afterTagStart = atInLine + 1 + tagPartial.length;
  const lastSpace = prefix.lastIndexOf(' ');
  const tokenStart = lastSpace >= afterTagStart ? lastSpace + 1 : afterTagStart;
  const token = prefix.slice(tokenStart);
  const beforeToken = line.slice(afterTagStart, tokenStart);
  const usedAttrs = parseUsedAttrs(beforeToken);

  const eq = token.indexOf('=');
  if (eq >= 0) {
    return {
      kind: 'value',
      tag: known,
      attr: token.slice(0, eq),
      partial: token.slice(eq + 1),
      replaceStart: tokenStart + eq + 1,
      replaceEnd: character,
      usedAttrs,
    };
  }

  return {
    kind: 'attr',
    tag: known,
    partial: token,
    replaceStart: tokenStart,
    replaceEnd: character,
    usedAttrs,
  };
}

export function eventNamesInText(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  EVENT_DECL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EVENT_DECL.exec(text))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      names.push(m[1]);
    }
  }
  return names;
}

function parseUsedAttrs(text: string): Set<string> {
  const keys = new Set<string>();
  const re = /(\w+)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    keys.add(m[1]);
  }
  return keys;
}

export class AnnotationCompletionProvider
  implements vscode.CompletionItemProvider
{
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const line = document.lineAt(position.line).text;
    const ctx = analyzeAnnotationLine(line, position.character);
    if (!ctx) {
      return [];
    }
    if (ctx.kind === 'tag') {
      return tagItems(ctx, position.line);
    }
    if (ctx.kind === 'attr') {
      return attrItems(ctx, position.line);
    }
    return valueItems(ctx, position.line, document.getText());
  }
}

function tagItems(
  ctx: AnnCompleteContext,
  line: number
): vscode.CompletionItem[] {
  const range = new vscode.Range(line, ctx.replaceStart, line, ctx.replaceEnd);
  return TAGS.map((tag, i) => {
    const meta = TAG_META[tag];
    const item = new vscode.CompletionItem(
      `@${tag}`,
      vscode.CompletionItemKind.Snippet
    );
    item.detail = meta.detail;
    item.documentation = md(meta.doc);
    item.insertText = new vscode.SnippetString(`@${meta.snippet}`);
    item.range = range;
    item.sortText = String(i);
    item.filterText = `@${tag}`;
    return item;
  });
}

function attrItems(
  ctx: AnnCompleteContext,
  line: number
): vscode.CompletionItem[] {
  if (!ctx.tag) {
    return [];
  }
  const names = ATTRS[ctx.tag];
  const used = ctx.usedAttrs ?? new Set<string>();
  const range = new vscode.Range(line, ctx.replaceStart, line, ctx.replaceEnd);
  const out: vscode.CompletionItem[] = [];
  for (const name of names) {
    if (used.has(name)) {
      continue;
    }
    const item = new vscode.CompletionItem(
      name,
      vscode.CompletionItemKind.Property
    );
    item.detail = `${name}=`;
    item.documentation = md(ATTR_DOCS[name] ?? '');
    item.insertText = `${name}=`;
    item.range = range;
    item.sortText = name;
    if (name === 'ui' || name === 'mode' || name === 'gate') {
      item.command = {
        command: 'editor.action.triggerSuggest',
        title: 'Suggest values',
      };
    }
    out.push(item);
  }
  return out;
}

function valueItems(
  ctx: AnnCompleteContext,
  line: number,
  source: string
): vscode.CompletionItem[] {
  const attr = ctx.attr;
  if (!attr) {
    return [];
  }
  const range = new vscode.Range(line, ctx.replaceStart, line, ctx.replaceEnd);
  const enums = VALUE_ENUMS[attr];
  if (enums) {
    return enums.map((e, i) => {
      const item = new vscode.CompletionItem(
        e.value,
        vscode.CompletionItemKind.EnumMember
      );
      item.documentation = md(e.doc);
      item.insertText = e.value;
      item.range = range;
      item.sortText = String(i);
      return item;
    });
  }
  if (attr !== 'gate') {
    return [];
  }
  return eventNamesInText(source).map((name) => {
    const item = new vscode.CompletionItem(
      name,
      vscode.CompletionItemKind.Variable
    );
    item.detail = 'global Event';
    item.documentation = md('Broadcast this Event when a gated step runs.');
    item.insertText = name;
    item.range = range;
    return item;
  });
}

function md(text: string): vscode.MarkdownString {
  const s = new vscode.MarkdownString(text);
  s.supportHtml = false;
  return s;
}
