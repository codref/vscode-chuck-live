#!/usr/bin/env node
/**
 * Generate bundled pattern JSON + .ck files under examples/sequences/.
 * Run: node scripts/gen-bundled-patterns.js
 */
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'examples', 'sequences');
const meterPort = 9001;

function midiToHz(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

function pad16(arr, fill = 0) {
  const out = arr.slice(0, 16);
  while (out.length < 16) out.push(fill);
  return out;
}

function gateTrack(name, gates, probs) {
  return {
    kind: 'gate',
    mode: 'raw',
    bpm: 118,
    swing: 0,
    muted: false,
    solo: false,
    gate: '',
    activeBank: 'A',
    editBank: 'A',
    banks: {
      A: { values: pad16(gates.map(() => 0)), gates: pad16(gates), probs: pad16(probs ?? gates.map(() => 1)) },
      B: { values: pad16(gates.map(() => 0)), gates: pad16(gates), probs: pad16(probs ?? gates.map(() => 1)) },
    },
  };
}

function floatTrack(name, values, gates, gate, mode, probs) {
  return {
    kind: 'float',
    mode,
    bpm: 118,
    swing: 0,
    muted: false,
    solo: false,
    gate,
    activeBank: 'A',
    editBank: 'A',
    banks: {
      A: { values: pad16(values), gates: pad16(gates), probs: pad16(probs ?? gates.map(() => 1)) },
      B: { values: pad16(values), gates: pad16(gates), probs: pad16(probs ?? gates.map(() => 1)) },
    },
  };
}

const cy_kick_g = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0];
const cy_hat_g = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0];
const cy_snare_g = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
const cy_glitch_g = [0,0,1,0, 0,0,0,1, 0,0,1,0, 0,1,0,0];
const cy_glitch_p = [1,1,0.7,1, 1,1,0.7,1, 1,1,0.7,1, 1,0.7,1,1];
const dk_bass_g = [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0];

const ab_notes = [40, 43, 40, 0, 45, 43, 40, 0, 47, 45, 43, 40, 48, 47, 43, 40];
const ab_gates = [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1];
const ab_accent = [1, 0, 0.7, 0, 1, 0, 0.5, 0, 1, 0, 0.6, 0, 1, 0, 0.8, 0.5];

const md_gate_g = [1,0,0,1, 0,1,0,0, 1,1,0,1, 0,0,1,0];
const md_digit_v = [0,0,0,1, 0,2,0,0, 3,4,0,5, 0,0,6,0];

const nm_gates = [1,1,1,1, 1,1,1,0, 1,1,1,1, 1,1,1,1];
const nm_notes = [40,40,40,28, 40,43,40,0, 35,40,43,40, 47,40,36,40];
const nm_accent = [1,0,0.6,1, 0,0.7,0,0, 1,0,0.5,0, 1,0,0.8,0.4];
const nm_plockCut = [0.3,0.2,0.4,0.8, 0.2,0.5,0.3,0, 0.6,0.3,0.4,0.2, 0.9,0.3,0.7,0.4];
const nm_plockFold = [0.4,0.2,0.3,0.7, 0.2,0.4,0.3,0, 0.5,0.2,0.4,0.2, 0.8,0.3,0.5,0.4];
const nm_plockCrush = [0.2,0.1,0.2,0.6, 0.1,0.3,0.2,0, 0.4,0.1,0.2,0.1, 0.7,0.2,0.5,0.3];
const nm_slide = [0,1,0,0, 0,1,0,0, 0,1,1,0, 0,0,0,0];
const nm_ratchet = [1,1,1,4, 1,1,1,1, 1,1,1,1, 8,1,2,1];

const darkwavePatterns = {
  cy_kick: gateTrack('cy_kick', cy_kick_g),
  cy_hat: gateTrack('cy_hat', cy_hat_g),
  cy_snare: gateTrack('cy_snare', cy_snare_g),
  cy_glitch: gateTrack('cy_glitch', cy_glitch_g, cy_glitch_p),
  dk_bass: gateTrack('dk_bass', dk_bass_g),
  ab_noteHz: floatTrack('ab_noteHz', ab_notes, ab_gates, 'ab_gate', 'midi'),
  ab_accent: floatTrack('ab_accent', ab_accent, ab_gates, 'ab_gate', 'raw'),
};

const modemPatterns = {
  md_gate: gateTrack('md_gate', md_gate_g),
  md_digit: floatTrack('md_digit', md_digit_v, md_gate_g, 'md_gate', 'raw'),
};

const fullPatterns = { ...darkwavePatterns, ...modemPatterns };

const neuralPatterns = {
  nm_noteHz: floatTrack('nm_noteHz', nm_notes, nm_gates, 'nm_gate', 'midi'),
  nm_accent: floatTrack('nm_accent', nm_accent, nm_gates, 'nm_gate', 'raw'),
  nm_plockCut: floatTrack('nm_plockCut', nm_plockCut, nm_gates, 'nm_gate', 'raw'),
  nm_plockFold: floatTrack('nm_plockFold', nm_plockFold, nm_gates, 'nm_gate', 'raw'),
  nm_plockCrush: floatTrack('nm_plockCrush', nm_plockCrush, nm_gates, 'nm_gate', 'raw'),
  nm_slide: floatTrack('nm_slide', nm_slide, nm_gates, 'nm_gate', 'raw'),
  nm_ratchet: floatTrack('nm_ratchet', nm_ratchet, nm_gates, 'nm_gate', 'raw'),
};

// Sparse doom vocal — low density, phrygian roots, chop automation
const dv_gates = [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0];
const dv_notes = [40,40,40,40, 35,35,43,43, 40,40,28,28, 47,40,35,40];
const dv_accent = [1,0,0,0, 0,0,0.7,0, 0,0,0,0, 0.85,0,0,0];
const dv_chop = [0,0,0,0, 0.2,0.2,0.35,0.35, 0,0,0.5,0.5, 0.15,0.15,0.4,0.4];

const doomVoxPatterns = {
  dv_noteHz: floatTrack('dv_noteHz', dv_notes, dv_gates, 'dv_gate', 'midi'),
  dv_accent: floatTrack('dv_accent', dv_accent, dv_gates, 'dv_gate', 'raw'),
  dv_chop: floatTrack('dv_chop', dv_chop, dv_gates, 'dv_gate', 'raw'),
};

// Dual slot voices — independent gates on alternating steps
const rm_gates = [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0];
const cy_gates = [0,0,1,0, 1,0,0,0, 0,1,0,0, 0,0,1,0];
const rm_accent = [1,0,0,0, 0,0,0.8,0, 0,0,0,0, 0.9,0,0,0];
const cy_accent = [0,0,0.7,0, 1,0,0,0, 0,0.6,0,0, 0,0,0.75,0];

const doomVoxDualPatterns = {
  rm_gate: gateTrack('rm_gate', rm_gates),
  rm_accent: floatTrack('rm_accent', rm_accent, rm_gates, 'rm_gate', 'raw'),
  cy_gate: gateTrack('cy_gate', cy_gates),
  cy_accent: floatTrack('cy_accent', cy_accent, cy_gates, 'cy_gate', 'raw'),
};

function buildJson(name, trackOrder, patterns) {
  return {
    version: 1,
    name,
    scaleName: 'phrygian',
    masterBpm: 118,
    syncClocks: true,
    swingEnabled: false,
    trackOrder,
    patterns,
  };
}

function buildTransportSpec(name, trackOrder, patterns) {
  const tracks = [];
  for (const n of trackOrder) {
    const p = patterns[n];
    const bank = p.banks.A;
    const kind = p.kind;
    let values = bank.values.slice();
    if (kind === 'float' && p.mode === 'midi') {
      values = values.map((v) => (v > 0 ? midiToHz(v) : 0));
    }
    tracks.push({
      name: n,
      kind,
      gate: p.gate || undefined,
      muted: false,
      solo: false,
      swing: 0,
      running: true,
      gates: bank.gates,
      values,
      probs: bank.probs,
    });
  }
  return { bpm: 118, step: 0, running: false, swingEnabled: false, meterPort, tracks };
}

// Load compiled transportGen + patternCk from out/ if available, else inline minimal ck gen
function fmtF(n) {
  const s = Number(n).toFixed(6);
  return s.includes('.') ? s : s + '.0';
}

function generateTransportSource(spec) {
  const LIVE = {
    bpm: 'live_bpm', step: 'live_step', stepDur: 'live_stepDur',
    tick: 'live_tick', running: 'live_running', cmd: 'live_cmd', swing: 'live_swing',
  };
  const lines = [
    `// @chuckLivePattern version=1 name=${spec.name || 'pattern'} bpm=${spec.bpm} scale=phrygian`,
    '// ChucK Live pattern — editable step arrays below',
    '',
    `global float ${LIVE.bpm};`,
    `global int ${LIVE.step};`,
    `global float ${LIVE.stepDur};`,
    `global Event ${LIVE.tick};`,
    `global int ${LIVE.running};`,
    `global int ${LIVE.cmd};`,
    `global int ${LIVE.swing};`,
    '',
  ];
  const declared = new Set(Object.values(LIVE));
  for (const t of spec.tracks) {
    if (!declared.has(t.name)) {
      lines.push(t.kind === 'gate' ? `global Event ${t.name};` : `global float ${t.name};`);
      declared.add(t.name);
    }
    if (t.gate && !declared.has(t.gate)) {
      lines.push(`global Event ${t.gate};`);
      declared.add(t.gate);
    }
  }
  lines.push('', `${spec.bpm} => ${LIVE.bpm};`, `0 => ${LIVE.step};`,
    `(60.0 / Math.max(40.0, ${LIVE.bpm}) / 4.0) => ${LIVE.stepDur};`,
    `1 => ${LIVE.running};`, `0 => ${LIVE.swing};`, `${spec.tracks.length} => int nTracks;`, '');

  spec.tracks.forEach((t, i) => {
    const gates = pad16(t.gates, 0).map((g) => (g > 0.5 ? 1 : 0));
    const vals = pad16(t.values, 0);
    const probs = pad16(t.probs, 1);
    lines.push(`// track ${i}: ${t.name} (${t.kind})${t.gate ? ' gate=' + t.gate : ''}`);
    lines.push(`[${gates.join(',')}] @=> int t${i}_g[];`);
    lines.push(`[${vals.map(fmtF).join(',')}] @=> float t${i}_v[];`);
    lines.push(`[${probs.map(fmtF).join(',')}] @=> float t${i}_p[];`);
    lines.push(`${fmtF(t.swing || 0)} => float t${i}_swing;`);
    lines.push(`0 => int t${i}_muted;`, `0 => int t${i}_solo;`, `1 => int t${i}_run;`, '');
  });

  // Minimal clock loop (same logic as transportGen.ts)
  lines.push(
    'fun void updateDur() { (60.0 / Math.max(40.0, live_bpm) / 4.0) => live_stepDur; }',
    'fun int anySolo() { return 0; }',
    'fun int trackAudible(int i) { if (!t0_run) return 0; return 1; }'.replace(/t0_run/g, 't' + '0_run'),
  );
  // Fix trackAudible - generate properly
  lines.pop();
  lines.push('fun int trackAudible(int i) {');
  for (let i = 0; i < spec.tracks.length; i++) {
    lines.push(`  if (i == ${i}) { if (!t${i}_run) return 0; if (t${i}_muted) return 0; if (anySolo() && !t${i}_solo) return 0; return 1; }`);
  }
  lines.push('  return 0;', '}');
  lines.push('fun void fireTrack(int i, int s) { if (!trackAudible(i)) return;');
  for (let i = 0; i < spec.tracks.length; i++) {
    const t = spec.tracks[i];
    lines.push(`  if (i == ${i}) { if (t${i}_g[s] < 1) return; if (t${i}_p[s] < 0.999 && Math.random2f(0.0, 1.0) >= t${i}_p[s]) return;`);
    if (t.kind === 'gate') lines.push(`    ${t.name}.broadcast();`);
    else {
      lines.push(`    t${i}_v[s] => ${t.name};`);
      if (t.gate) lines.push(`    ${t.gate}.broadcast();`);
    }
    lines.push('    return; }');
  }
  lines.push('}');
  lines.push('fun void fireStep(int s) { s => live_step; live_tick.broadcast();');
  for (let i = 0; i < spec.tracks.length; i++) {
    lines.push(`  fireTrack(${i}, s);`);
  }
  lines.push('}');
  lines.push('fun void clockLoop() { while (true) { updateDur(); if (live_running) { fireStep(live_step); live_stepDur::second => now; (live_step + 1) % 16 => live_step; } else { 20::ms => now; } } }');
  lines.push('spork ~ clockLoop();', 'while (true) 1::second => now;', '');
  return lines.join('\n');
}

fs.mkdirSync(outDir, { recursive: true });

const presets = [
  { name: 'darkwave-acid', trackOrder: Object.keys(darkwavePatterns), patterns: darkwavePatterns },
  { name: 'modem-pulse', trackOrder: Object.keys(modemPatterns), patterns: modemPatterns },
  { name: 'cyberpunk-full', trackOrder: Object.keys(fullPatterns), patterns: fullPatterns },
  { name: 'neural-matrix', trackOrder: Object.keys(neuralPatterns), patterns: neuralPatterns },
  { name: 'doom-vox', trackOrder: Object.keys(doomVoxPatterns), patterns: doomVoxPatterns },
  { name: 'doom-vox-dual', trackOrder: Object.keys(doomVoxDualPatterns), patterns: doomVoxDualPatterns },
];

for (const p of presets) {
  const json = buildJson(p.name, p.trackOrder, p.patterns);
  fs.writeFileSync(path.join(outDir, `${p.name}.json`), JSON.stringify(json, null, 2));
  const spec = buildTransportSpec(p.name, p.trackOrder, p.patterns);
  spec.name = p.name;
  fs.writeFileSync(path.join(outDir, `${p.name}.ck`), generateTransportSource(spec));
  console.log('wrote', p.name);
}

console.log('Done →', outDir);
