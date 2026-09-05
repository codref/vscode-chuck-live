(function () {
  const vscode = acquireVsCodeApi();

  const MB_DEFAULT = [48, 51, 55, 58, 60, 55, 51, 48, 60, 63, 67, 70, 72, 67, 63, 60];
  const MB_GATES = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1];
  const DRUM_GATES = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0];

  // Pitch-class intervals from root (C=0 relative); applied modulo 12
  const SCALES = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    pentatonic_min: [0, 3, 5, 7, 10],
  };

  const saved = vscode.getState() || {};
  /** @type {Record<string, any>} */
  const patterns = saved.patterns || {};
  /** @type {string[]} */
  let trackOrder = Array.isArray(saved.trackOrder) ? saved.trackOrder.slice() : [];
  let scaleName = saved.scaleName || 'phrygian';
  let masterBpm = saved.masterBpm || 120;
  let syncClocks = saved.syncClocks !== undefined ? !!saved.syncClocks : true;
  /** Master kill-switch: when false, all swing delays are ignored. */
  let swingEnabled = saved.swingEnabled === true;
  /** Queue pattern OSC until next 16-step wrap (default on). */
  let applyAtBar = saved.applyAtBar !== undefined ? !!saved.applyAtBar : true;
  /** track → last selected preset name */
  if (!saved.presetSel) saved.presetSel = {};
  let sharedPlayhead = 0;
  /** @type {any} */
  let masterTimer = null;
  let patternPendingHint = false;

  /** @type {Array<any>} */
  let targets = [];
  /** @type {string[]} */
  let gateOptions = [];
  /** track → preset name list */
  let presetLists = {};
  /** @type {Record<string, any>} */
  const timers = {};
  /** @type {Record<string, any>} */
  const swingTimers = {};

  // --- Keyboard drawer state ---
  let keyboardTrack = null;
  let keyboardOctave = 3;
  let recArmed = false;
  let stepInputMode = false;
  let selectedStep = 0;
  let heldPadIndex = -1;
  let lastRecordStep = -1;
  let drawerSuggestStyle = 'walk';
  /** @type {Array<{midi:number,label:string}>} */
  let keyboardPads = [];
  let drawerBuiltFor = null;
  let suppressPadUntil = 0;

  const keyboardDrawerEl = document.getElementById('keyboardDrawer');

  const tracksEl = document.getElementById('tracks');
  const addSel = document.getElementById('addTarget');
  const btnAdd = document.getElementById('btnAdd');
  const btnRunAll = document.getElementById('btnRunAll');
  const btnStopAll = document.getElementById('btnStopAll');
  const btnSaveAs = document.getElementById('btnSaveAs');
  const btnLoad = document.getElementById('btnLoad');
  const hintEl = document.getElementById('hint');
  const scaleSel = document.getElementById('scale');
  const masterBpmIn = document.getElementById('masterBpm');
  const syncChk = document.getElementById('syncClocks');
  const swingEnableChk = document.getElementById('swingEnabled');
  const applyAtBarChk = document.getElementById('applyAtBar');

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function midiName(m) {
    const n = Math.round(m);
    return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  }

  function fmtRaw(v, quant) {
    if (quant >= 1) return String(Math.round(v));
    if (quant >= 0.1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function basename(file) {
    if (!file) return '';
    const parts = String(file).split(/[/\\]/);
    return parts[parts.length - 1].replace(/\.ck$/i, '');
  }

  function labelFor(t) {
    const base = basename(t.file);
    const tag = t.kind === 'gate' ? ' (gate)' : '';
    if (base) return base + ' · ' + t.name + tag;
    return t.name + tag;
  }

  function persist() {
    vscode.setState({
      patterns: patterns,
      trackOrder: trackOrder,
      scaleName: scaleName,
      masterBpm: masterBpm,
      syncClocks: syncClocks,
      swingEnabled: swingEnabled,
      applyAtBar: applyAtBar,
    });
  }

  /** Sync ON → ChucK transport owns musical time. */
  function useChuckClock() {
    return !!syncClocks;
  }

  function anyTrackRunning() {
    return trackOrder.some((n) => patterns[n] && patterns[n].running);
  }

  function publishTransport(extra) {
    const payload = Object.assign(
      {
        type: 'transport',
        bpm: masterBpm,
        step: sharedPlayhead,
        running: anyTrackRunning(),
        swingEnabled: swingEnabled,
      },
      extra || {}
    );
    vscode.postMessage(payload);
  }

  function liveValuesForDump(p) {
    ensureBanks(p);
    const live = liveBank(p);
    let values = live.values.slice(0, 16);
    if (p.kind !== 'gate' && p.mode === 'midi') {
      values = values.map((v) => snapMidi(v));
    }
    return values;
  }

  /** Full pattern snapshot for ChucK transport regeneration. */
  function dumpTransport(opts) {
    opts = opts || {};
    const running =
      opts.running !== undefined ? !!opts.running : anyTrackRunning();
    const step =
      opts.step !== undefined ? opts.step : sharedPlayhead;
    const pat = {};
    for (const n of trackOrder) {
      const p = patterns[n];
      if (!p) continue;
      ensureBanks(p);
      ensurePatternFlags(p);
      const live = liveBank(p);
      pat[n] = {
        kind: p.kind || 'float',
        mode: p.mode,
        swing: clampSwing(p.swing),
        muted: !!p.muted,
        solo: !!p.solo,
        running: !!p.running,
        gate: p.gate || '',
        values: liveValuesForDump(p),
        gates: live.gates.slice(0, 16),
        probs: normalizeProbs(live.probs),
      };
    }
    vscode.postMessage({
      type: 'transportDump',
      data: {
        masterBpm: masterBpm,
        syncClocks: syncClocks,
        swingEnabled: swingEnabled,
        sharedPlayhead: step,
        running: running,
        applyAtBar: applyAtBar && running,
        trackOrder: trackOrder.slice(),
        patterns: pat,
      },
    });
    if (applyAtBar && running && useChuckClock()) {
      patternPendingHint = true;
      updateHint();
    }
  }

  let dumpTimer = null;
  function dumpTransportSoon() {
    if (!useChuckClock()) return;
    if (dumpTimer) clearTimeout(dumpTimer);
    dumpTimer = setTimeout(() => {
      dumpTimer = null;
      dumpTransport();
    }, 50);
  }

  function clamp(v, min, max, quant) {
    let x = Math.max(min, Math.min(max, v));
    if (quant >= 1) x = Math.round(x);
    else if (quant > 0) x = Math.round(x / quant) * quant;
    return x;
  }

  function clampSwing(s) {
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function clampProb(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(1, n));
  }

  function snapMidi(m) {
    const degrees = SCALES[scaleName] || SCALES.chromatic;
    if (scaleName === 'chromatic') return Math.round(m);
    const n = Math.round(m);
    const oct = Math.floor(n / 12);
    const pc = ((n % 12) + 12) % 12;
    let best = degrees[0];
    let bestD = 99;
    for (const d of degrees) {
      const dist = Math.min(Math.abs(pc - d), 12 - Math.abs(pc - d));
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    // choose octave that stays closest to original
    let cand = oct * 12 + best;
    if (Math.abs(cand - n) > Math.abs(cand - 12 - n)) cand -= 12;
    if (Math.abs(cand - n) > Math.abs(cand + 12 - n)) cand += 12;
    return cand;
  }

  function defaultProbs() {
    return Array(16).fill(1);
  }

  function normalizeProbs(arr) {
    const out = Array.isArray(arr) ? arr.slice(0, 16) : [];
    while (out.length < 16) out.push(1);
    return out.map(clampProb);
  }

  function ensureBankProbs(bank) {
    bank.probs = normalizeProbs(bank.probs);
  }

  /** Ensure A/B banks; migrate legacy flat values/gates. */
  function ensureBanks(p) {
    if (p.banks && p.banks.A && p.banks.B) {
      if (p.activeBank !== 'A' && p.activeBank !== 'B') p.activeBank = 'A';
      if (p.editBank !== 'A' && p.editBank !== 'B') p.editBank = 'A';
      if (p.queued !== 'A' && p.queued !== 'B') p.queued = null;
    } else {
      const values = Array.isArray(p.values) ? p.values.slice() : Array(16).fill(0);
      const gates = Array.isArray(p.gates) ? p.gates.slice() : Array(16).fill(1);
      const probs = Array.isArray(p.probs) ? p.probs.slice() : defaultProbs();
      while (values.length < 16) values.push(values[values.length - 1] || 0);
      while (gates.length < 16) gates.push(1);
      while (probs.length < 16) probs.push(1);
      p.banks = {
        A: {
          values: values.slice(0, 16),
          gates: gates.slice(0, 16),
          probs: normalizeProbs(probs),
        },
        B: {
          values: values.slice(0, 16),
          gates: gates.slice(0, 16),
          probs: normalizeProbs(probs),
        },
      };
      p.activeBank = 'A';
      p.editBank = 'A';
      p.queued = null;
    }
    ensureBankProbs(p.banks.A);
    ensureBankProbs(p.banks.B);
    // Edit grid always aliases the selected bank arrays
    p.values = p.banks[p.editBank].values;
    p.gates = p.banks[p.editBank].gates;
    p.probs = p.banks[p.editBank].probs;
  }

  function liveBank(p) {
    ensureBanks(p);
    return p.banks[p.activeBank];
  }

  function standbyBankId(p) {
    return p.activeBank === 'A' ? 'B' : 'A';
  }

  function setEditBank(p, bank) {
    ensureBanks(p);
    p.editBank = bank;
    p.values = p.banks[bank].values;
    p.gates = p.banks[bank].gates;
    p.probs = p.banks[bank].probs;
  }

  /** Copy live (active) bank into standby; switch edit to standby. */
  function dupLiveToStandby(p) {
    ensureBanks(p);
    const src = p.banks[p.activeBank];
    const dstId = standbyBankId(p);
    p.banks[dstId] = {
      values: src.values.slice(),
      gates: src.gates.slice(),
      probs: normalizeProbs(src.probs),
    };
    setEditBank(p, dstId);
  }

  function queueStandby(p) {
    ensureBanks(p);
    p.queued = standbyBankId(p);
  }

  function clearQueue(p) {
    p.queued = null;
  }

  /** Immediate swap: standby becomes live. */
  function swapNow(p) {
    ensureBanks(p);
    p.activeBank = standbyBankId(p);
    p.queued = null;
    setEditBank(p, p.activeBank);
  }

  /** Apply queued bank when a 16-step cycle wraps. */
  function applyQueueOnWrap(p) {
    if (!p || !p.queued) return false;
    p.activeBank = p.queued;
    p.queued = null;
    setEditBank(p, p.activeBank);
    return true;
  }

  // --- Pattern transforms (edit bank) ---
  /** @type {any} */
  let laneClipboard = null;
  /** @type {Record<string, any>} */
  const undoStacks = {};
  let focusedTrackName = null;

  const GROOVE_PRESETS = {
    'four-on-floor': [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    breakbeat: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0],
    clave: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0],
    empty: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };

  function cloneBank(bank) {
    return {
      values: bank.values.slice(0, 16),
      gates: bank.gates.slice(0, 16),
      probs: normalizeProbs(bank.probs),
    };
  }

  function pushUndo(name) {
    const p = patterns[name];
    if (!p) return;
    ensureBanks(p);
    undoStacks[name] = cloneBank(p.banks[p.editBank]);
  }

  function undoLastTransform(name) {
    const snap = undoStacks[name];
    if (!snap) return;
    const p = patterns[name];
    if (!p) return;
    ensureBanks(p);
    applyEditBankTransform(
      name,
      (bank) => {
        bank.values = snap.values.slice();
        bank.gates = snap.gates.slice();
        bank.probs = snap.probs.slice();
      },
      { skipUndo: true }
    );
    delete undoStacks[name];
  }

  function applyEditBankTransform(name, mutator, opts) {
    const skipUndo = opts && opts.skipUndo;
    const p = patterns[name];
    if (!p) return;
    ensureBanks(p);
    if (!skipUndo) pushUndo(name);
    mutator(p.banks[p.editBank], p);
    ensureBankProbs(p.banks[p.editBank]);
    persist();
    render();
    if (!p.running || p.editBank === p.activeBank) dumpTransportSoon();
  }

  function rotateArray(arr, steps) {
    const n = arr.length;
    steps = ((steps % n) + n) % n;
    if (steps === 0) return arr.slice();
    return arr.slice(n - steps).concat(arr.slice(0, n - steps));
  }

  function reverseBank(bank) {
    bank.values.reverse();
    bank.gates.reverse();
    bank.probs.reverse();
  }

  function rotateBank(bank, steps) {
    bank.values = rotateArray(bank.values, steps);
    bank.gates = rotateArray(bank.gates, steps);
    bank.probs = rotateArray(bank.probs, steps);
  }

  function flipGatesBank(bank) {
    for (let i = 0; i < 16; i++) {
      bank.gates[i] = bank.gates[i] > 0.5 ? 0 : 1;
    }
  }

  function clearGatesBank(bank) {
    for (let i = 0; i < 16; i++) bank.gates[i] = 0;
  }

  function fillGatesBank(bank) {
    for (let i = 0; i < 16; i++) {
      bank.gates[i] = 1;
      bank.probs[i] = 1;
    }
  }

  function doubleBank(bank) {
    for (let i = 0; i < 8; i++) {
      const j = i + 8;
      bank.values[j] = bank.values[i];
      bank.gates[j] = bank.gates[i];
      bank.probs[j] = bank.probs[i];
    }
  }

  function halveBank(bank) {
    for (let i = 0; i < 8; i++) {
      const j = i + 8;
      bank.values[i] = bank.values[j];
      bank.gates[i] = bank.gates[j];
      bank.probs[i] = bank.probs[j];
    }
  }

  function stutterBank(bank, sliceLen) {
    sliceLen = Math.max(1, Math.min(16, sliceLen));
    for (let i = sliceLen; i < 16; i++) {
      const src = i % sliceLen;
      bank.values[i] = bank.values[src];
      bank.gates[i] = bank.gates[src];
      bank.probs[i] = bank.probs[src];
    }
  }

  function offbeatBank(bank, parity) {
    for (let i = 0; i < 16; i++) {
      const isOdd = i % 2 === 1;
      const keep = parity === 'odd' ? isOdd : !isOdd;
      if (!keep) bank.gates[i] = 0;
    }
  }

  function laneMinMax(p) {
    return {
      min: p.min ?? (p.mode === 'midi' ? 24 : 0),
      max: p.max ?? (p.mode === 'midi' ? 84 : 1),
    };
  }

  function applyPitchValue(bank, p, i, v) {
    const mm = laneMinMax(p);
    if (p.mode === 'midi') {
      bank.values[i] = snapMidi(clamp(v, mm.min, mm.max, 1));
    } else {
      bank.values[i] = clamp(v, mm.min, mm.max, p.quant ?? 0.01);
    }
  }

  function invertPitchBank(bank, p) {
    const mm = laneMinMax(p);
    const center = mm.min + mm.max;
    for (let i = 0; i < 16; i++) {
      applyPitchValue(bank, p, i, center - bank.values[i]);
    }
  }

  function transposeBank(bank, p, semitones) {
    for (let i = 0; i < 16; i++) {
      applyPitchValue(bank, p, i, bank.values[i] + semitones);
    }
  }

  function retrogradeInvBank(bank, p) {
    reverseBank(bank);
    invertPitchBank(bank, p);
  }

  function walkBank(bank, steps) {
    bank.values = rotateArray(bank.values, steps);
  }

  function spreadBank(bank, p, factor) {
    const mm = laneMinMax(p);
    const center = (mm.min + mm.max) / 2;
    const half = Math.max(1e-9, (mm.max - mm.min) / 2);
    for (let i = 0; i < 16; i++) {
      let t = (bank.values[i] - center) / half;
      t = Math.max(-1, Math.min(1, t * (1 + factor)));
      applyPitchValue(bank, p, i, center + t * half);
    }
  }

  function snapLaneBank(bank, p) {
    if (p.mode !== 'midi') return;
    for (let i = 0; i < 16; i++) {
      bank.values[i] = snapMidi(bank.values[i]);
    }
  }

  function scaleNotesInRange(min, max) {
    const degrees = SCALES[scaleName] || SCALES.chromatic;
    const notes = [];
    for (let oct = Math.floor(min / 12) - 1; oct <= Math.ceil(max / 12) + 1; oct++) {
      for (const d of degrees) {
        const n = oct * 12 + d;
        if (n >= min && n <= max) notes.push(n);
      }
    }
    notes.sort((a, b) => a - b);
    return notes;
  }

  function transposeScaleDegree(bank, p, delta) {
    const mm = laneMinMax(p);
    const notes = scaleNotesInRange(mm.min, mm.max);
    if (!notes.length) return;
    for (let i = 0; i < 16; i++) {
      const v = bank.values[i];
      let bestIdx = 0;
      let bestD = Math.abs(v - notes[0]);
      for (let j = 1; j < notes.length; j++) {
        const d = Math.abs(v - notes[j]);
        if (d < bestD) {
          bestD = d;
          bestIdx = j;
        }
      }
      const next = Math.max(0, Math.min(notes.length - 1, bestIdx + delta));
      bank.values[i] = notes[next];
    }
  }

  function densityBank(bank, delta) {
    if (delta > 0) {
      for (let i = 0; i < 16; i++) {
        if (bank.gates[i] <= 0.5) {
          bank.gates[i] = 1;
          bank.probs[i] = 1;
          return;
        }
      }
      return;
    }
    let pick = -1;
    let pickProb = 2;
    for (let i = 0; i < 16; i++) {
      if (bank.gates[i] > 0.5 && bank.probs[i] < pickProb) {
        pickProb = bank.probs[i];
        pick = i;
      }
    }
    if (pick < 0) {
      for (let i = 15; i >= 0; i--) {
        if (bank.gates[i] > 0.5) {
          pick = i;
          break;
        }
      }
    }
    if (pick >= 0) bank.gates[pick] = 0;
  }

  function accentBank(bank, p) {
    const accents = [0, 4, 8, 12];
    for (const i of accents) {
      bank.probs[i] = 1;
      if (p.kind !== 'gate' && p.mode === 'raw') {
        const mm = laneMinMax(p);
        bank.values[i] = clamp(bank.values[i] + (mm.max - mm.min) * 0.08, mm.min, mm.max, p.quant);
      }
    }
  }

  function humanizeBank(bank, p) {
    for (let i = 0; i < 16; i++) {
      bank.probs[i] = clampProb(bank.probs[i] + (Math.random() - 0.5) * 0.2);
      if (p.kind === 'gate') continue;
      const jitter = p.mode === 'midi' ? (Math.random() > 0.5 ? 1 : -1) : (p.quant || 0.01) * (Math.random() > 0.5 ? 1 : -1);
      applyPitchValue(bank, p, i, bank.values[i] + jitter);
    }
  }

  function syncProbFromGates(bank) {
    for (let i = 0; i < 16; i++) {
      bank.probs[i] = bank.gates[i] > 0.5 ? 1 : 0;
    }
  }

  function mutateProbBank(bank) {
    for (let i = 0; i < 16; i++) {
      bank.probs[i] = clampProb(0.3 + Math.random() * 0.7);
    }
  }

  function euclideanPattern(steps, hits) {
    if (hits <= 0) return Array(steps).fill(0);
    if (hits >= steps) return Array(steps).fill(1);
    const pattern = new Array(steps).fill(0);
    let bucket = 0;
    for (let i = 0; i < steps; i++) {
      bucket += hits;
      if (bucket >= steps) {
        bucket -= steps;
        pattern[i] = 1;
      }
    }
    return pattern;
  }

  function euclideanBank(bank, hits) {
    const pat = euclideanPattern(16, hits);
    for (let i = 0; i < 16; i++) {
      bank.gates[i] = pat[i];
      bank.probs[i] = pat[i] ? 1 : 0;
    }
  }

  function diceBank(bank, p) {
    const mm = laneMinMax(p);
    for (let i = 0; i < 16; i++) {
      bank.gates[i] = Math.random() < 0.4 ? 1 : 0;
      bank.probs[i] = bank.gates[i] ? clampProb(0.6 + Math.random() * 0.4) : 0;
      if (p.kind !== 'gate') {
        if (p.mode === 'midi') {
          const notes = scaleNotesInRange(mm.min, mm.max);
          bank.values[i] = notes.length ? notes[Math.floor(Math.random() * notes.length)] : mm.min;
        } else {
          bank.values[i] = mm.min + Math.random() * (mm.max - mm.min);
          bank.values[i] = clamp(bank.values[i], mm.min, mm.max, p.quant);
        }
      }
    }
  }

  function noteIndexInScale(notes, midi) {
    let bestIdx = 0;
    let bestD = Math.abs(midi - notes[0]);
    for (let j = 1; j < notes.length; j++) {
      const d = Math.abs(midi - notes[j]);
      if (d < bestD) {
        bestD = d;
        bestIdx = j;
      }
    }
    return bestIdx;
  }

  function suggestBank(bank, p, style) {
    if (p.kind === 'gate' || p.mode !== 'midi') return;
    const mm = laneMinMax(p);
    const notes = scaleNotesInRange(mm.min, mm.max);
    if (!notes.length) return;

    const mid = (mm.min + mm.max) / 2;
    let rootIdx = noteIndexInScale(notes, mid);

    for (let i = 0; i < 16; i++) {
      bank.gates[i] = 0;
      bank.probs[i] = 0;
      bank.values[i] = notes[rootIdx];
    }

    if (style === 'bass') {
      const fifthIdx = Math.min(notes.length - 1, rootIdx + Math.floor(notes.length / 2));
      const bassSteps = [0, 4, 8, 12, 7];
      for (let k = 0; k < bassSteps.length; k++) {
        const i = bassSteps[k];
        bank.gates[i] = 1;
        bank.probs[i] = 1;
        bank.values[i] = k % 2 === 0 ? notes[rootIdx] : notes[fifthIdx];
      }
      return;
    }

    if (style === 'arp') {
      for (let i = 0; i < 16; i++) {
        const deg = i % 4;
        bank.gates[i] = 1;
        bank.probs[i] = 1;
        bank.values[i] = notes[Math.min(notes.length - 1, rootIdx + deg)];
      }
      return;
    }

    if (style === 'motif') {
      let idx = rootIdx;
      const motif = [];
      for (let m = 0; m < 4; m++) {
        motif.push(notes[idx]);
        const step = Math.random() < 0.7 ? 0 : Math.random() < 0.5 ? -1 : 1;
        idx = Math.max(0, Math.min(notes.length - 1, idx + step));
      }
      for (let i = 0; i < 16; i++) {
        const mi = i % 4;
        let ni = noteIndexInScale(notes, motif[mi]);
        if (i >= 4 && Math.random() < 0.35) {
          ni = Math.max(0, Math.min(notes.length - 1, ni + (Math.random() < 0.5 ? -1 : 1)));
        }
        bank.gates[i] = i % 4 !== 3 || Math.random() < 0.6 ? 1 : 0;
        bank.probs[i] = bank.gates[i] ? 1 : 0;
        bank.values[i] = notes[ni];
      }
      return;
    }

    // walk (default)
    let idx = rootIdx;
    for (let i = 0; i < 16; i++) {
      if (Math.random() < 0.3) {
        bank.gates[i] = 0;
        bank.probs[i] = 0;
        bank.values[i] = notes[idx];
        continue;
      }
      bank.gates[i] = 1;
      bank.probs[i] = 1;
      bank.values[i] = notes[idx];
      if (Math.random() < 0.7) {
        const step = Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? -1 : 1;
        idx = Math.max(0, Math.min(notes.length - 1, idx + step));
      }
    }
  }

  function applySuggestToTrack(name, style) {
    applyEditBankTransform(name, (bank, pat) => suggestBank(bank, pat, style || 'walk'));
  }

  function evolveBank(bank, p) {
    const i = Math.floor(Math.random() * 16);
    if (Math.random() < 0.5) {
      bank.gates[i] = bank.gates[i] > 0.5 ? 0 : 1;
    } else if (p.kind !== 'gate') {
      const delta = p.mode === 'midi' ? (Math.random() > 0.5 ? 1 : -1) : (p.quant || 0.01) * (Math.random() > 0.5 ? 1 : -1);
      applyPitchValue(bank, p, i, bank.values[i] + delta);
    }
  }

  function applyGroovePreset(bank, presetId) {
    const pat = GROOVE_PRESETS[presetId];
    if (!pat) return;
    for (let i = 0; i < 16; i++) {
      bank.gates[i] = pat[i];
      bank.probs[i] = pat[i] ? 1 : 0;
    }
  }

  function copyLaneToClipboard(name) {
    const p = patterns[name];
    if (!p) return;
    ensureBanks(p);
    const bank = p.banks[p.editBank];
    laneClipboard = {
      kind: p.kind || 'float',
      mode: p.mode,
      values: bank.values.slice(),
      gates: bank.gates.slice(),
      probs: normalizeProbs(bank.probs),
    };
  }

  function copyGatesToClipboard(name) {
    const p = patterns[name];
    if (!p) return;
    ensureBanks(p);
    const bank = p.banks[p.editBank];
    laneClipboard = {
      gatesOnly: true,
      gates: bank.gates.slice(),
      probs: normalizeProbs(bank.probs),
    };
  }

  function copyValuesToClipboard(name) {
    const p = patterns[name];
    if (!p || p.kind === 'gate') return;
    ensureBanks(p);
    laneClipboard = {
      valuesOnly: true,
      values: p.banks[p.editBank].values.slice(),
    };
  }

  function pasteCompatible(name) {
    if (!laneClipboard) return false;
    const p = patterns[name];
    if (!p) return false;
    if (laneClipboard.gatesOnly || laneClipboard.valuesOnly) return true;
    if (laneClipboard.kind === 'gate' && p.kind !== 'gate') return false;
    return true;
  }

  function pasteLaneFromClipboard(name) {
    if (!laneClipboard || !pasteCompatible(name)) return;
    applyEditBankTransform(name, (bank, p) => {
      if (laneClipboard.valuesOnly) {
        if (p.kind === 'gate') return;
        for (let i = 0; i < 16; i++) bank.values[i] = laneClipboard.values[i];
        return;
      }
      if (laneClipboard.gatesOnly) {
        for (let i = 0; i < 16; i++) {
          bank.gates[i] = laneClipboard.gates[i];
          bank.probs[i] = laneClipboard.probs[i];
        }
        return;
      }
      for (let i = 0; i < 16; i++) {
        bank.values[i] = laneClipboard.values[i];
        bank.gates[i] = laneClipboard.gates[i];
        bank.probs[i] = laneClipboard.probs[i];
      }
    });
  }

  function duplicateEditToBank(name, targetId) {
    applyEditBankTransform(name, (bank, p) => {
      const src = cloneBank(bank);
      p.banks[targetId] = src;
      ensureBankProbs(p.banks[targetId]);
    });
  }

  function makeTransformBtn(label, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'transform-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function makeTransformSection(label, group) {
    const sec = document.createElement('div');
    sec.className = 'transform-section';
    sec.dataset.group = group;
    const lab = document.createElement('span');
    lab.className = 'transform-label';
    lab.textContent = label;
    sec.appendChild(lab);
    const btns = document.createElement('div');
    btns.className = 'transform-btns';
    sec.appendChild(btns);
    return { sec, btns };
  }

  function bindTrackKeyboard(trackEl, name, p) {
    trackEl.tabIndex = -1;
    trackEl.addEventListener('focusin', () => {
      focusedTrackName = name;
    });
    trackEl.addEventListener('keydown', (e) => {
      if (focusedTrackName !== name) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undoLastTransform(name);
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        applyEditBankTransform(name, reverseBank);
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        applyEditBankTransform(name, (bank) => rotateBank(bank, -1));
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        applyEditBankTransform(name, (bank) => rotateBank(bank, 1));
        return;
      }
      if (p.kind !== 'gate' && e.key === 'ArrowUp') {
        e.preventDefault();
        applyEditBankTransform(name, (bank, pat) => transposeBank(bank, pat, 1));
        return;
      }
      if (p.kind !== 'gate' && e.key === 'ArrowDown') {
        e.preventDefault();
        applyEditBankTransform(name, (bank, pat) => transposeBank(bank, pat, -1));
      }
    });
  }

  function makeTransformBar(name, p) {
    const bar = document.createElement('div');
    bar.className = 'transform-bar';
    bar.title = 'Edit bank only';

    const struct = makeTransformSection('Structure', 'structure');
    struct.btns.appendChild(
      makeTransformBtn('Rev', 'Reverse step order', () =>
        applyEditBankTransform(name, reverseBank)
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('◀', 'Rotate left', () =>
        applyEditBankTransform(name, (bank) => rotateBank(bank, -1))
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('▶', 'Rotate right', () =>
        applyEditBankTransform(name, (bank) => rotateBank(bank, 1))
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('Flip', 'Toggle all gates', () =>
        applyEditBankTransform(name, flipGatesBank)
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('Clear', 'All gates off', () =>
        applyEditBankTransform(name, clearGatesBank)
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('Fill', 'All gates on', () =>
        applyEditBankTransform(name, fillGatesBank)
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('×2', 'Copy steps 1–8 → 9–16', () =>
        applyEditBankTransform(name, doubleBank)
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('÷2', 'Copy steps 9–16 → 1–8', () =>
        applyEditBankTransform(name, halveBank)
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('Stut4', 'Stutter first 4 steps', () =>
        applyEditBankTransform(name, (bank) => stutterBank(bank, 4))
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('Odd', 'Keep odd steps only', () =>
        applyEditBankTransform(name, (bank) => offbeatBank(bank, 'odd'))
      )
    );
    struct.btns.appendChild(
      makeTransformBtn('Even', 'Keep even steps only', () =>
        applyEditBankTransform(name, (bank) => offbeatBank(bank, 'even'))
      )
    );
    bar.appendChild(struct.sec);

    if (p.kind !== 'gate') {
      const pitch = makeTransformSection('Pitch', 'pitch');
      pitch.btns.appendChild(
        makeTransformBtn('+1', 'Transpose up 1', () =>
          applyEditBankTransform(name, (bank, pat) => transposeBank(bank, pat, 1))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('-1', 'Transpose down 1', () =>
          applyEditBankTransform(name, (bank, pat) => transposeBank(bank, pat, -1))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('+12', 'Octave up', () =>
          applyEditBankTransform(name, (bank, pat) => transposeBank(bank, pat, 12))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('-12', 'Octave down', () =>
          applyEditBankTransform(name, (bank, pat) => transposeBank(bank, pat, -12))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Inv', 'Invert pitch (gates unchanged)', () =>
          applyEditBankTransform(name, invertPitchBank)
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Retro', 'Reverse + invert pitch', () =>
          applyEditBankTransform(name, retrogradeInvBank)
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Walk◀', 'Rotate pitch values left', () =>
          applyEditBankTransform(name, (bank) => walkBank(bank, -1))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Walk▶', 'Rotate pitch values right', () =>
          applyEditBankTransform(name, (bank) => walkBank(bank, 1))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Spread', 'Widen pitch range', () =>
          applyEditBankTransform(name, (bank, pat) => spreadBank(bank, pat, 0.15))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Compress', 'Narrow pitch range', () =>
          applyEditBankTransform(name, (bank, pat) => spreadBank(bank, pat, -0.15))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Snap', 'Snap all notes to scale', () =>
          applyEditBankTransform(name, snapLaneBank)
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Deg+', 'Up one scale degree', () =>
          applyEditBankTransform(name, (bank, pat) => transposeScaleDegree(bank, pat, 1))
        )
      );
      pitch.btns.appendChild(
        makeTransformBtn('Deg-', 'Down one scale degree', () =>
          applyEditBankTransform(name, (bank, pat) => transposeScaleDegree(bank, pat, -1))
        )
      );
      bar.appendChild(pitch.sec);
    }

    const rhythm = makeTransformSection('Rhythm', 'rhythm');
    rhythm.btns.appendChild(
      makeTransformBtn('D+', 'Add one hit', () =>
        applyEditBankTransform(name, (bank) => densityBank(bank, 1))
      )
    );
    rhythm.btns.appendChild(
      makeTransformBtn('D-', 'Remove sparsest hit', () =>
        applyEditBankTransform(name, (bank) => densityBank(bank, -1))
      )
    );
    rhythm.btns.appendChild(
      makeTransformBtn('Accent', 'Accent beats 1/5/9/13', () =>
        applyEditBankTransform(name, accentBank)
      )
    );
    rhythm.btns.appendChild(
      makeTransformBtn('Human', 'Humanize pitch + probability', () =>
        applyEditBankTransform(name, humanizeBank)
      )
    );
    rhythm.btns.appendChild(
      makeTransformBtn('Prob↔', 'Sync prob from gates', () =>
        applyEditBankTransform(name, syncProbFromGates)
      )
    );
    rhythm.btns.appendChild(
      makeTransformBtn('MutP', 'Randomize probabilities', () =>
        applyEditBankTransform(name, mutateProbBank)
      )
    );
    bar.appendChild(rhythm.sec);

    const gen = makeTransformSection('Gen', 'gen');
    const euclWrap = document.createElement('span');
    euclWrap.className = 'euclid-wrap';
    const euclK = document.createElement('input');
    euclK.type = 'number';
    euclK.className = 'euclid-k';
    euclK.min = '0';
    euclK.max = '16';
    euclK.value = '4';
    euclK.title = 'Euclidean hits (k)';
    euclWrap.appendChild(euclK);
    euclWrap.appendChild(
      makeTransformBtn('Eucl', 'Euclidean rhythm', () => {
        const k = Math.max(0, Math.min(16, Number(euclK.value) || 0));
        euclK.value = String(k);
        applyEditBankTransform(name, (bank) => euclideanBank(bank, k));
      })
    );
    gen.btns.appendChild(euclWrap);
    gen.btns.appendChild(
      makeTransformBtn('Dice', 'Random pattern', () =>
        applyEditBankTransform(name, diceBank)
      )
    );
    gen.btns.appendChild(
      makeTransformBtn('Evolve', 'Mutate one random step', () =>
        applyEditBankTransform(name, evolveBank)
      )
    );
    const suggestSel = document.createElement('select');
    suggestSel.className = 'groove-preset';
    suggestSel.title = 'Harmonic suggest style';
    for (const [val, lab] of [
      ['walk', 'Walk'],
      ['bass', 'Bass'],
      ['arp', 'Arp'],
      ['motif', 'Motif'],
    ]) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = lab;
      suggestSel.appendChild(o);
    }
    gen.btns.appendChild(suggestSel);
    gen.btns.appendChild(
      makeTransformBtn('Suggest', 'Seed harmonic melody', () =>
        applyEditBankTransform(name, (bank, pat) =>
          suggestBank(bank, pat, suggestSel.value || 'walk')
        )
      )
    );
    const presetSel = document.createElement('select');
    presetSel.className = 'groove-preset';
    presetSel.title = 'Apply groove preset to gates';
    const presetOpts = [
      ['', 'Preset…'],
      ['four-on-floor', 'Four on floor'],
      ['breakbeat', 'Breakbeat'],
      ['clave', 'Clave 3-3-2'],
      ['empty', 'Empty'],
    ];
    for (const [val, lab] of presetOpts) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = lab;
      presetSel.appendChild(o);
    }
    presetSel.addEventListener('change', () => {
      const id = presetSel.value;
      if (!id) return;
      applyEditBankTransform(name, (bank) => applyGroovePreset(bank, id));
      presetSel.value = '';
    });
    gen.btns.appendChild(presetSel);
    bar.appendChild(gen.sec);

    const flow = makeTransformSection('Workflow', 'workflow');
    flow.btns.appendChild(
      makeTransformBtn('Copy', 'Copy lane to clipboard', () => copyLaneToClipboard(name))
    );
    const pasteBtn = makeTransformBtn('Paste', 'Paste from clipboard', () =>
      pasteLaneFromClipboard(name)
    );
    flow.btns.appendChild(pasteBtn);
    flow.btns.appendChild(
      makeTransformBtn('CpGates', 'Copy gates only', () => copyGatesToClipboard(name))
    );
    if (p.kind !== 'gate') {
      flow.btns.appendChild(
        makeTransformBtn('CpVals', 'Copy values only', () => copyValuesToClipboard(name))
      );
    }
    flow.btns.appendChild(
      makeTransformBtn('To A', 'Copy edit bank → A', () => duplicateEditToBank(name, 'A'))
    );
    flow.btns.appendChild(
      makeTransformBtn('To B', 'Copy edit bank → B', () => duplicateEditToBank(name, 'B'))
    );
    flow.btns.appendChild(
      makeTransformBtn('Undo', 'Undo last transform', () => undoLastTransform(name))
    );
    bar.appendChild(flow.sec);

    function refreshPasteState() {
      pasteBtn.disabled = !pasteCompatible(name);
    }
    refreshPasteState();
    bar.addEventListener('focusin', refreshPasteState);

    return bar;
  }

  function ensurePatternFlags(p) {
    if (p.swing === undefined || p.swing === null) p.swing = 0;
    else p.swing = clampSwing(p.swing);
    if (p.muted === undefined) p.muted = false;
    if (p.solo === undefined) p.solo = false;
  }

  function ensurePattern(t) {
    if (patterns[t.name]) {
      const p = patterns[t.name];
      p.mode = t.mode;
      p.kind = t.kind || 'float';
      p.min = t.min;
      p.max = t.max;
      p.quant = t.step;
      if (p.playhead === undefined) p.playhead = 0;
      if (t.gate && !p.gate) p.gate = t.gate;
      ensurePatternFlags(p);
      ensureBanks(p);
      return p;
    }
    let values;
    let gates;
    if (t.kind === 'gate') {
      values = Array(16).fill(1);
      gates =
        /kick/i.test(t.name)
          ? DRUM_GATES.slice()
          : /hat/i.test(t.name)
            ? [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]
            : /snare/i.test(t.name)
              ? [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
              : DRUM_GATES.slice();
    } else if (t.mode === 'midi') {
      values = MB_DEFAULT.map(snapMidi);
      gates = MB_GATES.slice();
    } else {
      const base = t.default;
      const span = (t.max - t.min) * 0.35;
      values = [];
      for (let i = 0; i < 16; i++) {
        const v = base + Math.sin((i / 16) * Math.PI * 2) * span * 0.5;
        values.push(clamp(v, t.min, t.max, t.step));
      }
      gates = Array(16).fill(1);
    }
    patterns[t.name] = {
      values: values,
      gates: gates,
      probs: defaultProbs(),
      bpm: masterBpm,
      swing: 0,
      muted: false,
      solo: false,
      running: false,
      playhead: 0,
      gate: t.gate || '',
      mode: t.mode,
      kind: t.kind || 'float',
      min: t.min,
      max: t.max,
      quant: t.step,
    };
    ensureBanks(patterns[t.name]);
    return patterns[t.name];
  }

  function availableToAdd() {
    return targets.filter((t) => trackOrder.indexOf(t.name) < 0);
  }

  function fillAddSelect() {
    if (!addSel) return;
    addSel.innerHTML = '';
    const avail = availableToAdd();
    if (!avail.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = targets.length
        ? '(all targets already added)'
        : '(load shreds with @knob / @seq / @seqGate)';
      addSel.appendChild(o);
      if (btnAdd) btnAdd.disabled = true;
      return;
    }
    if (btnAdd) btnAdd.disabled = false;

    const preferred = avail.filter((t) => t.preferred);
    const rest = avail.filter((t) => !t.preferred);

    if (preferred.length && rest.length) {
      const g1 = document.createElement('optgroup');
      g1.label = '@seq / @seqGate';
      for (const t of preferred) {
        const o = document.createElement('option');
        o.value = t.name;
        o.textContent = labelFor(t) + ' ★';
        g1.appendChild(o);
      }
      addSel.appendChild(g1);
      const g2 = document.createElement('optgroup');
      g2.label = 'All knobs';
      for (const t of rest) {
        const o = document.createElement('option');
        o.value = t.name;
        o.textContent = labelFor(t);
        g2.appendChild(o);
      }
      addSel.appendChild(g2);
    } else {
      for (const t of avail) {
        const o = document.createElement('option');
        o.value = t.name;
        o.textContent = labelFor(t) + (t.preferred ? ' ★' : '');
        addSel.appendChild(o);
      }
    }
  }

  function addTrack(name) {
    const t = targets.find((x) => x.name === name);
    if (!t || trackOrder.indexOf(name) >= 0) return;
    ensurePattern(t);
    trackOrder.push(name);
    persist();
    dumpTransportSoon();
    render();
  }

  function removeTrack(name) {
    stopClock(name);
    if (patterns[name]) patterns[name].running = false;
    trackOrder = trackOrder.filter((n) => n !== name);
    if (keyboardTrack === name) {
      keyboardTrack = null;
      recArmed = false;
      heldPadIndex = -1;
    }
    maybeStopMaster();
    persist();
    dumpTransportSoon();
    render();
  }

  function syncPreferredTracks() {
    let changed = false;
    const clockRunning = useChuckClock() && anyTrackRunning();
    // While the sequence is playing, do not auto-add preferred tracks —
    // that forces a topology OTF and drops audio. New shreds stay in Add.
    if (!clockRunning) {
      for (const t of targets) {
        if (t.preferred && trackOrder.indexOf(t.name) < 0) {
          ensurePattern(t);
          trackOrder.push(t.name);
          changed = true;
        }
      }
    }
    const names = new Set(targets.map((t) => t.name));
    const next = trackOrder.filter((n) => names.has(n));
    if (next.length !== trackOrder.length) {
      for (const n of trackOrder) {
        if (!names.has(n)) {
          stopClock(n);
          if (patterns[n]) patterns[n].running = false;
        }
      }
      trackOrder = next;
      changed = true;
    }
    if (changed) persist();
    return changed;
  }

  function trackAudible(name) {
    const p = patterns[name];
    if (!p) return false;
    if (p.muted) return false;
    const anySolo = trackOrder.some((n) => patterns[n] && patterns[n].solo);
    if (anySolo && !p.solo) return false;
    return true;
  }

  function fireStep(targetName, idx) {
    const p = patterns[targetName];
    if (!p) return;
    if (!trackAudible(targetName)) return;
    const live = liveBank(p);
    let gateOn = live.gates[idx] > 0.5;
    const prob =
      live.probs && live.probs[idx] !== undefined ? clampProb(live.probs[idx]) : 1;
    if (gateOn && prob < 0.999 && Math.random() >= prob) {
      gateOn = false;
    }
    let value = live.values[idx];
    if (p.kind !== 'gate' && p.mode === 'midi') {
      value = snapMidi(value);
    }
    if (gateOn) {
      flashFiredStep(targetName, idx);
    }
    vscode.postMessage({
      type: 'fire',
      target: targetName,
      value: value,
      gateOn: gateOn,
      gate: p.kind === 'gate' ? undefined : p.gate || undefined,
      mode: p.mode,
      kind: p.kind || 'float',
    });
  }

  function flashFiredStep(name, idx) {
    if (!tracksEl) return;
    const track = tracksEl.querySelector('.track[data-target="' + name + '"]');
    if (!track) return;
    const el = track.querySelector('.step[data-index="' + idx + '"]');
    if (!el) return;
    el.classList.remove('fired');
    // force reflow so animation retriggers
    void el.offsetWidth;
    el.classList.add('fired');
    setTimeout(() => el.classList.remove('fired'), 120);
  }

  function safeBpm(bpm) {
    const n = Number(bpm);
    if (!Number.isFinite(n)) return masterBpm;
    return Math.max(40, Math.min(200, n));
  }

  function stepMsFor(bpm) {
    return (60 / safeBpm(bpm) / 4) * 1000;
  }

  function ensureTrackBpm(p) {
    if (!p) return;
    p.bpm = safeBpm(p.bpm);
  }

  function clearSwingFire(name) {
    if (swingTimers[name]) {
      clearTimeout(swingTimers[name]);
      swingTimers[name] = null;
    }
  }

  function clearAllSwingFires() {
    for (const name of Object.keys(swingTimers)) {
      clearSwingFire(name);
    }
  }

  /** Straight grid fire, or delayed odd step when Swing is enabled. */
  function emitStep(name, idx) {
    if (!swingEnabled) {
      fireStep(name, idx);
      return;
    }
    const p = patterns[name];
    if (!p) return;
    const swing = clampSwing(p.swing);
    if (idx % 2 === 1 && swing > 0) {
      clearSwingFire(name);
      const ms = stepMsFor(syncClocks ? masterBpm : p.bpm);
      const delay = ms * Math.min(swing, 0.85);
      swingTimers[name] = setTimeout(() => {
        swingTimers[name] = null;
        if (!patterns[name] || !patterns[name].running) return;
        fireStep(name, idx);
      }, delay);
    } else {
      fireStep(name, idx);
    }
  }

  function stopClock(name) {
    clearSwingFire(name);
    if (timers[name]) {
      clearInterval(timers[name]);
      timers[name] = null;
    }
  }

  function stopAllIndependent() {
    for (const name of Object.keys(timers)) {
      stopClock(name);
    }
  }

  function stopMasterTimer() {
    if (masterTimer) {
      clearInterval(masterTimer);
      masterTimer = null;
    }
  }

  function maybeStopMaster() {
    const any = trackOrder.some((n) => patterns[n] && patterns[n].running);
    if (!any) {
      stopMasterTimer();
      patternPendingHint = false;
      if (useChuckClock()) {
        publishTransport({ running: false });
        dumpTransport({ running: false });
      }
    } else if (useChuckClock()) {
      dumpTransportSoon();
    }
  }

  function startMasterTimer(fireNow) {
    stopMasterTimer();
    stopAllIndependent();
    if (useChuckClock()) {
      // ChucK transport owns 16ths — dump patterns and run flag.
      for (const name of trackOrder) {
        const p = patterns[name];
        if (p && p.running) {
          p.playhead = sharedPlayhead;
          updatePlayhead(name);
        }
      }
      dumpTransport({
        running: anyTrackRunning(),
        step: sharedPlayhead,
      });
      publishTransport({ tick: false });
      return;
    }
    const ms = stepMsFor(masterBpm);
    if (fireNow !== false) {
      for (const name of trackOrder) {
        const p = patterns[name];
        if (p && p.running) {
          p.playhead = sharedPlayhead;
          emitStep(name, sharedPlayhead);
          updatePlayhead(name);
        }
      }
      publishTransport({ tick: true, step: sharedPlayhead });
    } else {
      for (const name of trackOrder) {
        const p = patterns[name];
        if (p && p.running) {
          p.playhead = sharedPlayhead;
          updatePlayhead(name);
        }
      }
    }
    masterTimer = setInterval(() => {
      const prev = sharedPlayhead;
      sharedPlayhead = (sharedPlayhead + 1) % 16;
      const wrapped = prev === 15 && sharedPlayhead === 0;
      captureRecordAtStep(sharedPlayhead);
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p || !p.running) continue;
        if (wrapped) applyQueueOnWrap(p);
        p.playhead = sharedPlayhead;
        emitStep(name, sharedPlayhead);
        updatePlayhead(name);
      }
      if (wrapped) refreshBankChromeAll();
      publishTransport({ tick: true, step: sharedPlayhead });
    }, ms);
  }

  function startClock(name) {
    const p = patterns[name];
    if (!p) return;
    if (syncClocks) {
      stopClock(name);
      p.bpm = masterBpm;
      if (useChuckClock()) {
        // Join the shared playhead — never rewind the ChucK clock mid-session.
        p.playhead = sharedPlayhead;
        startMasterTimer(true);
        return;
      }
      if (!masterTimer) {
        sharedPlayhead = p.playhead || 0;
        startMasterTimer();
      } else {
        p.playhead = sharedPlayhead;
        emitStep(name, sharedPlayhead);
        updatePlayhead(name);
      }
      return;
    }
    stopClock(name);
    ensureTrackBpm(p);
    const ms = stepMsFor(p.bpm);
    emitStep(name, p.playhead);
    updatePlayhead(name);
    timers[name] = setInterval(() => {
      const prev = p.playhead;
      p.playhead = (p.playhead + 1) % 16;
      if (prev === 15 && p.playhead === 0) {
        applyQueueOnWrap(p);
        refreshBankChrome(name);
      }
      emitStep(name, p.playhead);
      updatePlayhead(name);
    }, ms);
  }

  function refreshBankChrome(name) {
    if (!tracksEl) return;
    const track = tracksEl.querySelector('.track[data-target="' + name + '"]');
    if (!track) return;
    const p = patterns[name];
    if (!p) return;
    ensureBanks(p);
    track.querySelectorAll('.bank-btn').forEach((btn) => {
      const id = btn.dataset.bank;
      btn.classList.toggle('active', p.editBank === id);
      btn.classList.toggle('live', p.activeBank === id);
      btn.classList.toggle('queued', p.queued === id);
      const liveMark = p.activeBank === id ? '●' : '';
      const queueMark = p.queued === id ? '…' : '';
      btn.textContent = id + liveMark + queueMark;
    });
    const queueBtn = track.querySelector('.btn-queue');
    if (queueBtn) {
      queueBtn.classList.toggle('active', !!p.queued);
      queueBtn.textContent = p.queued
        ? 'Queued → ' + p.queued
        : 'Queue ' + standbyBankId(p);
    }
  }

  function refreshBankChromeAll() {
    for (const name of trackOrder) refreshBankChrome(name);
  }

  function updatePlayhead(name) {
    if (!tracksEl) return;
    const track = tracksEl.querySelector('.track[data-target="' + name + '"]');
    if (!track) return;
    const p = patterns[name];
    const ph = p ? p.playhead : 0;
    track.classList.toggle('running', !!(p && p.running));
    track.classList.toggle('muted', !!(p && p.muted));
    track.classList.toggle('solo', !!(p && p.solo));
    track.classList.toggle('editing-standby', !!(p && p.editBank !== p.activeBank));
    const runBtn = track.querySelector('.btn-run');
    if (runBtn) runBtn.classList.toggle('active', !!(p && p.running));
    const muteBtn = track.querySelector('.btn-mute');
    if (muteBtn) muteBtn.classList.toggle('active', !!(p && p.muted));
    const soloBtn = track.querySelector('.btn-solo');
    if (soloBtn) soloBtn.classList.toggle('active', !!(p && p.solo));
    // Highlight by data-index (not DOM forEach order)
    const showPh = !!(p && p.running);
    track.querySelectorAll('.step').forEach((el) => {
      const idx = Number(el.dataset.index);
      el.classList.toggle('playhead', showPh && idx === ph);
    });
    refreshBankChrome(name);
    if (keyboardTrack === name) updateChaseRow();
  }

  function gateTitle(p, i) {
    ensureBanks(p);
    const on = p.gates[i] > 0.5;
    const pct = Math.round(clampProb(p.probs[i]) * 100);
    return (on ? 'Gate on' : 'Gate off') + ' · p=' + pct + '% (Shift+drag)';
  }

  function paintGateProb(gate, p, i) {
    ensureBanks(p);
    const prob = clampProb(p.probs[i]);
    gate.style.setProperty('--prob', String(prob));
    gate.classList.toggle('on', p.gates[i] > 0.5);
    gate.title = gateTitle(p, i);
  }

  function bindGateProb(gate, p, i) {
    let probDragging = false;
    let moved = false;
    let startY = 0;
    let startProb = 1;

    gate.addEventListener('pointerdown', (e) => {
      if (!e.shiftKey) return;
      ensureBanks(p);
      probDragging = true;
      moved = false;
      gate.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startProb = clampProb(p.probs[i]);
      e.preventDefault();
      e.stopPropagation();
    });
    gate.addEventListener('pointermove', (e) => {
      if (!probDragging) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 2) moved = true;
      p.probs[i] = clampProb(startProb + dy / 100);
      paintGateProb(gate, p, i);
    });
    gate.addEventListener('pointerup', (e) => {
      if (!probDragging) return;
      probDragging = false;
      persist();
      if (!p.running || p.editBank === p.activeBank) dumpTransportSoon();
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    gate.addEventListener('click', (e) => {
      if (e.shiftKey || moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
        return;
      }
      ensureBanks(p);
      p.gates[i] = p.gates[i] > 0.5 ? 0 : 1;
      paintGateProb(gate, p, i);
      persist();
      // Only reload transport when editing the live bank (what ChucK plays).
      if (!p.running || p.editBank === p.activeBank) dumpTransportSoon();
    });
  }

  function makeGateStep(i, p) {
    const el = document.createElement('div');
    el.className = 'step step-gate';
    el.dataset.index = String(i);
    const num = document.createElement('div');
    num.className = 'step-num';
    num.textContent = String(i + 1);
    const gate = document.createElement('button');
    gate.type = 'button';
    gate.className = 'gate big';
    paintGateProb(gate, p, i);
    bindGateProb(gate, p, i);
    el.appendChild(num);
    el.appendChild(gate);
    return el;
  }

  function makeStep(i, p, trackName) {
    if (p.kind === 'gate') return makeGateStep(i, p);

    const el = document.createElement('div');
    el.className = 'step';
    el.dataset.index = String(i);

    const num = document.createElement('div');
    num.className = 'step-num';
    num.textContent = String(i + 1);

    const pitch = document.createElement('div');
    pitch.className = 'pitch';
    const fill = document.createElement('div');
    fill.className = 'pitch-fill';
    pitch.appendChild(fill);

    const label = document.createElement('div');
    label.className = 'pitch-label';

    const gate = document.createElement('button');
    gate.type = 'button';
    gate.className = 'gate';
    paintGateProb(gate, p, i);
    bindGateProb(gate, p, i);

    function paint() {
      let v = p.values[i];
      if (p.mode === 'midi') v = snapMidi(v);
      const t = (v - p.min) / Math.max(1e-9, p.max - p.min);
      fill.style.height = Math.max(4, t * 100) + '%';
      label.textContent =
        p.mode === 'midi' ? midiName(v) : fmtRaw(p.values[i], p.quant);
    }
    paint();

    let dragging = false;
    let startY = 0;
    let startV = 0;
    pitch.addEventListener('pointerdown', (e) => {
      dragging = true;
      pitch.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startV = p.values[i];
      e.preventDefault();
    });
    pitch.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      const range = p.max - p.min;
      const sens = range / 120;
      let v = startV + dy * sens;
      v = clamp(v, p.min, p.max, p.quant);
      if (p.mode === 'midi') v = snapMidi(v);
      p.values[i] = v;
      paint();
    });
    pitch.addEventListener('pointerup', () => {
      dragging = false;
      persist();
      if (!p.running || p.editBank === p.activeBank) dumpTransportSoon();
    });

    el.appendChild(num);
    el.appendChild(pitch);
    el.appendChild(label);
    el.appendChild(gate);

    el.addEventListener('click', (e) => {
      if (keyboardTrack !== trackName || !stepInputMode) return;
      if (e.target.closest('.gate') || e.target.closest('.pitch')) return;
      selectedStep = i;
      updateStepSelection();
    });
    if (keyboardTrack === trackName && stepInputMode && i === selectedStep) {
      el.classList.add('step-input-selected');
    }
    if (keyboardTrack === trackName && anyTrackRunning() && i === sharedPlayhead) {
      el.classList.add('keyboard-chase');
    }

    return el;
  }

  function makeTrack(name) {
    const t = targets.find((x) => x.name === name);
    if (!t) return null;
    const p = ensurePattern(t);

    const track = document.createElement('section');
    track.className =
      'track' +
      (p.running ? ' running' : '') +
      (p.muted ? ' muted' : '') +
      (p.solo ? ' solo' : '') +
      (p.kind === 'gate' ? ' track-gate' : '') +
      (keyboardTrack === name ? ' keyboard-armed' : '');
    track.dataset.target = name;

    const bar = document.createElement('div');
    bar.className = 'track-bar';

    const nameEl = document.createElement('div');
    nameEl.className = 'track-name';
    nameEl.textContent = labelFor(t);
    if (t.preferred) {
      const star = document.createElement('span');
      star.className = 'star';
      star.textContent = '★';
      nameEl.appendChild(star);
    }

    bar.appendChild(nameEl);

    if (isMidiKeyboardTrack(name)) {
      const btnKb = document.createElement('button');
      btnKb.type = 'button';
      btnKb.className = 'btn-kb' + (keyboardTrack === name ? ' active' : '');
      btnKb.textContent = '⌨';
      btnKb.title = 'Open scale keyboard for this track';
      btnKb.addEventListener('click', () => armKeyboardTrack(name));
      bar.appendChild(btnKb);
    }

    if (p.kind !== 'gate') {
      const gatePick = document.createElement('label');
      gatePick.className = 'pick';
      gatePick.textContent = 'Gate ';
      const gateSel = document.createElement('select');
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '(none)';
      gateSel.appendChild(none);
      for (const g of gateOptions) {
        const o = document.createElement('option');
        o.value = g;
        o.textContent = g;
        gateSel.appendChild(o);
      }
      gateSel.value = p.gate && gateOptions.indexOf(p.gate) >= 0 ? p.gate : '';
      gateSel.addEventListener('change', () => {
        p.gate = gateSel.value || '';
        persist();
        dumpTransportSoon();
      });
      gatePick.appendChild(gateSel);
      bar.appendChild(gatePick);
    }

    const btnRun = document.createElement('button');
    btnRun.type = 'button';
    btnRun.className = 'btn-run' + (p.running ? ' active' : '');
    btnRun.textContent = 'Run';
    btnRun.addEventListener('click', () => {
      const othersRunning = trackOrder.some(
        (n) => n !== name && patterns[n] && patterns[n].running
      );
      p.running = true;
      setEditBank(p, p.activeBank);
      if (syncClocks) {
        if (!othersRunning) {
          sharedPlayhead = 0;
          p.playhead = 0;
        } else {
          // Join in place — Apply at bar queues the run flag until wrap.
          p.playhead = sharedPlayhead;
        }
      } else {
        p.playhead = 0;
      }
      startClock(name);
      updatePlayhead(name);
      persist();
      render();
    });

    const btnStop = document.createElement('button');
    btnStop.type = 'button';
    btnStop.textContent = 'Stop';
    btnStop.addEventListener('click', () => {
      p.running = false;
      stopClock(name);
      maybeStopMaster();
      updatePlayhead(name);
      persist();
    });

    const btnReset = document.createElement('button');
    btnReset.type = 'button';
    btnReset.textContent = 'Reset';
    btnReset.addEventListener('click', () => {
      p.playhead = 0;
      if (syncClocks) sharedPlayhead = 0;
      updatePlayhead(name);
      persist();
    });

    const btnMute = document.createElement('button');
    btnMute.type = 'button';
    btnMute.className = 'btn-mute' + (p.muted ? ' active' : '');
    btnMute.textContent = 'M';
    btnMute.title = 'Mute (clock keeps running)';
    btnMute.addEventListener('click', () => {
      p.muted = !p.muted;
      updatePlayhead(name);
      persist();
      dumpTransportSoon();
    });

    const btnSolo = document.createElement('button');
    btnSolo.type = 'button';
    btnSolo.className = 'btn-solo' + (p.solo ? ' active' : '');
    btnSolo.textContent = 'S';
    btnSolo.title = 'Solo (only soloed tracks fire)';
    btnSolo.addEventListener('click', () => {
      p.solo = !p.solo;
      for (const n of trackOrder) updatePlayhead(n);
      persist();
      dumpTransportSoon();
    });

    bar.appendChild(btnRun);
    bar.appendChild(btnStop);
    bar.appendChild(btnReset);
    bar.appendChild(btnMute);
    bar.appendChild(btnSolo);

    // A/B banks: edit one while the other plays; queue swap at end of 16
    const bankGroup = document.createElement('div');
    bankGroup.className = 'bank-group';
    for (const id of ['A', 'B']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bank-btn';
      b.dataset.bank = id;
      b.title =
        id === p.activeBank
          ? 'Bank ' + id + ' (live — playing)'
          : 'Bank ' + id + ' (edit)';
      b.addEventListener('click', () => {
        setEditBank(p, id);
        persist();
        render();
      });
      bankGroup.appendChild(b);
    }
    bar.appendChild(bankGroup);

    const btnDup = document.createElement('button');
    btnDup.type = 'button';
    btnDup.textContent = 'Dup→standby';
    btnDup.title = 'Copy live bank into standby and edit it';
    btnDup.addEventListener('click', () => {
      dupLiveToStandby(p);
      persist();
      render();
    });

    const btnQueue = document.createElement('button');
    btnQueue.type = 'button';
    btnQueue.className = 'btn-queue';
    btnQueue.title = 'After this 16-step cycle, switch to the standby bank';
    btnQueue.addEventListener('click', () => {
      if (p.queued) {
        clearQueue(p);
      } else {
        queueStandby(p);
      }
      persist();
      refreshBankChrome(name);
    });

    const btnSwap = document.createElement('button');
    btnSwap.type = 'button';
    btnSwap.textContent = 'Swap now';
    btnSwap.title = 'Immediately make standby the live bank';
    btnSwap.addEventListener('click', () => {
      swapNow(p);
      persist();
      refreshBankChrome(name);
      updatePlayhead(name);
      dumpTransportSoon();
    });

    bar.appendChild(btnDup);
    bar.appendChild(btnQueue);
    bar.appendChild(btnSwap);

    if (!syncClocks) {
      const bpmLab = document.createElement('label');
      bpmLab.className = 'bpm';
      bpmLab.textContent = 'BPM ';
      const bpmIn = document.createElement('input');
      bpmIn.type = 'number';
      bpmIn.min = '40';
      bpmIn.max = '200';
      bpmIn.value = String(p.bpm);
      bpmIn.addEventListener('change', () => {
        p.bpm = safeBpm(Number(bpmIn.value) || masterBpm);
        bpmIn.value = String(p.bpm);
        if (p.running) startClock(name);
        persist();
      });
      bpmLab.appendChild(bpmIn);
      bar.appendChild(bpmLab);
    }

    const swingLab = document.createElement('label');
    swingLab.className = 'bpm swing';
    swingLab.textContent = 'Swing ';
    const swingIn = document.createElement('input');
    swingIn.type = 'number';
    swingIn.min = '0';
    swingIn.max = '100';
    swingIn.value = String(Math.round(clampSwing(p.swing) * 100));
    swingIn.disabled = !swingEnabled;
    swingIn.title = swingEnabled
      ? 'Swing % (odd steps late)'
      : 'Enable Swing in the header to apply';
    swingIn.addEventListener('change', () => {
      p.swing = clampSwing((Number(swingIn.value) || 0) / 100);
      swingIn.value = String(Math.round(p.swing * 100));
      persist();
      dumpTransportSoon();
    });
    swingLab.appendChild(swingIn);
    bar.appendChild(swingLab);

    bar.appendChild(makeTrackPresetBar(name));

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'remove';
    btnRemove.textContent = 'Remove';
    btnRemove.addEventListener('click', () => removeTrack(name));
    bar.appendChild(btnRemove);

    const gridScroll = document.createElement('div');
    gridScroll.className = 'grid-scroll';

    const grid = document.createElement('div');
    grid.className = 'grid' + (p.kind === 'gate' ? ' grid-gate' : '');
    for (let i = 0; i < 16; i++) {
      grid.appendChild(makeStep(i, p, name));
    }

    gridScroll.appendChild(grid);
    track.appendChild(bar);
    track.appendChild(gridScroll);
    const transformBar = makeTransformBar(name, p);
    track.appendChild(transformBar);
    bindTrackKeyboard(track, name, p);
    return track;
  }

  function isMidiKeyboardTrack(name) {
    const p = patterns[name];
    return !!(p && p.kind !== 'gate' && p.mode === 'midi');
  }

  function recordingActive() {
    return recArmed && anyTrackRunning();
  }

  function defaultKeyboardOctave(p) {
    const mm = laneMinMax(p);
    const mid = Math.round((mm.min + mm.max) / 2);
    return Math.max(0, Math.min(10, Math.floor(mid / 12)));
  }

  function computeKeyboardPads() {
    if (!keyboardTrack) {
      keyboardPads = [];
      return;
    }
    const p = patterns[keyboardTrack];
    if (!p || !isMidiKeyboardTrack(keyboardTrack)) {
      keyboardPads = [];
      return;
    }
    const mm = laneMinMax(p);
    const degrees = SCALES[scaleName] || SCALES.chromatic;
    const pads = [];
    for (const d of degrees) {
      let midi = keyboardOctave * 12 + d;
      while (midi < mm.min) midi += 12;
      while (midi > mm.max) midi -= 12;
      if (midi >= mm.min && midi <= mm.max) {
        const snapped = snapMidi(midi);
        pads.push({ midi: snapped, label: midiName(snapped) });
      }
    }
    keyboardPads = pads;
  }

  function armKeyboardTrack(name) {
    if (keyboardTrack === name) {
      keyboardTrack = null;
      recArmed = false;
      heldPadIndex = -1;
      updateKeyboardDrawer();
      render();
      return;
    }
    if (!isMidiKeyboardTrack(name)) return;
    keyboardTrack = name;
    const p = patterns[name];
    keyboardOctave = defaultKeyboardOctave(p);
    computeKeyboardPads();
    updateKeyboardDrawer();
    render();
  }

  function previewPadMidi(midi) {
    if (!keyboardTrack) return;
    const p = patterns[keyboardTrack];
    if (!p) return;
    vscode.postMessage({
      type: 'fire',
      target: keyboardTrack,
      value: midi,
      gateOn: true,
      gate: p.gate || undefined,
      mode: 'midi',
      kind: p.kind || 'float',
    });
  }

  function writeStepNote(trackName, stepIdx, midi) {
    const p = patterns[trackName];
    if (!p || !isMidiKeyboardTrack(trackName)) return;
    ensureBanks(p);
    const bank = p.banks[p.editBank];
    bank.values[stepIdx] = snapMidi(midi);
    bank.gates[stepIdx] = 1;
    bank.probs[stepIdx] = 1;
    setEditBank(p, p.editBank);
    persist();
    if (!p.running || p.editBank === p.activeBank) dumpTransportSoon();
    refreshStepCell(trackName, stepIdx);
  }

  function refreshStepCell(trackName, stepIdx) {
    if (!tracksEl) return;
    const track = tracksEl.querySelector('.track[data-target="' + trackName + '"]');
    if (!track) return;
    const step = track.querySelector('.step[data-index="' + stepIdx + '"]');
    if (!step) return;
    const p = patterns[trackName];
    if (!p) return;
    const fill = step.querySelector('.pitch-fill');
    const label = step.querySelector('.pitch-label');
    const gate = step.querySelector('.gate');
    if (fill && label) {
      let v = p.values[stepIdx];
      if (p.mode === 'midi') v = snapMidi(v);
      const t = (v - p.min) / Math.max(1e-9, p.max - p.min);
      fill.style.height = Math.max(4, t * 100) + '%';
      label.textContent =
        p.mode === 'midi' ? midiName(v) : fmtRaw(p.values[stepIdx], p.quant);
    }
    if (gate) paintGateProb(gate, p, stepIdx);
  }

  function maybeStartRecordTransport() {
    if (!recArmed || anyTrackRunning() || !keyboardTrack) return;
    const p = patterns[keyboardTrack];
    if (!p) return;
    const already = anyTrackRunning();
    if (!already) sharedPlayhead = 0;
    p.running = true;
    p.playhead = already ? sharedPlayhead : 0;
    setEditBank(p, p.activeBank);
    resyncRunning(true);
    for (const name of trackOrder) updatePlayhead(name);
    persist();
    refreshKeyboardDrawerState();
  }

  function captureRecordAtStep(step) {
    if (!recArmed || !keyboardTrack || heldPadIndex < 0) return;
    if (!anyTrackRunning()) return;
    if (lastRecordStep === step) return;
    lastRecordStep = step;
    const pad = keyboardPads[heldPadIndex];
    if (!pad) return;
    writeStepNote(keyboardTrack, step, pad.midi);
  }

  function onPadPress(padIndex) {
    if (!keyboardTrack || padIndex < 0 || padIndex >= keyboardPads.length) return;
    if (Date.now() < suppressPadUntil) return;
    heldPadIndex = padIndex;
    const pad = keyboardPads[padIndex];
    previewPadMidi(pad.midi);

    if (stepInputMode) {
      writeStepNote(keyboardTrack, selectedStep, pad.midi);
      selectedStep = (selectedStep + 1) % 16;
      updateStepSelection();
      return;
    }

    if (recArmed) {
      if (!anyTrackRunning()) {
        maybeStartRecordTransport();
      }
      lastRecordStep = -1;
      captureRecordAtStep(sharedPlayhead);
    }
    updateKeyboardPadVisuals();
  }

  function onPadRelease() {
    heldPadIndex = -1;
    updateKeyboardPadVisuals();
  }


  function updateStepSelection() {
    if (!tracksEl || !keyboardTrack) return;
    const track = tracksEl.querySelector('.track[data-target="' + keyboardTrack + '"]');
    if (!track) return;
    track.querySelectorAll('.step').forEach((el) => {
      const idx = Number(el.dataset.index);
      el.classList.toggle('step-input-selected', stepInputMode && idx === selectedStep);
    });
    updateChaseRow();
  }

  function updateChaseRow() {
    if (!keyboardDrawerEl) return;
    keyboardDrawerEl.querySelectorAll('.kb-chase-dot').forEach((el) => {
      const idx = Number(el.dataset.step);
      const active = anyTrackRunning() && idx === sharedPlayhead;
      el.classList.toggle('active', active);
      el.classList.toggle('selected', stepInputMode && idx === selectedStep);
    });
    if (!tracksEl || !keyboardTrack) return;
    const track = tracksEl.querySelector('.track[data-target="' + keyboardTrack + '"]');
    if (!track) return;
    track.querySelectorAll('.step').forEach((el) => {
      const idx = Number(el.dataset.index);
      el.classList.toggle(
        'keyboard-chase',
        keyboardTrack && anyTrackRunning() && idx === sharedPlayhead
      );
    });
  }

  function updateKeyboardPadVisuals() {
    if (!keyboardDrawerEl) return;
    keyboardDrawerEl.querySelectorAll('.kb-pad').forEach((el, i) => {
      el.classList.toggle('pressed', i === heldPadIndex);
    });
  }

  function refreshKeyboardDrawerState() {
    if (!keyboardDrawerEl || keyboardDrawerEl.classList.contains('hidden')) return;

    const label = keyboardDrawerEl.querySelector('.kb-label');
    if (label && keyboardTrack) {
      const p = patterns[keyboardTrack];
      if (p) {
        const mm = laneMinMax(p);
        label.textContent =
          keyboardTrack + ' · ' + midiName(mm.min) + '–' + midiName(mm.max);
      }
    }

    const btnRec = keyboardDrawerEl.querySelector('.kb-rec');
    if (btnRec) {
      btnRec.classList.toggle('recording', recArmed && recordingActive());
      btnRec.classList.toggle('armed', recArmed && !recordingActive());
    }

    const btnStep = keyboardDrawerEl.querySelector('.kb-step');
    if (btnStep) btnStep.classList.toggle('active', stepInputMode);

    const hint = keyboardDrawerEl.querySelector('.kb-hint');
    if (hint) {
      let hintText = 'Rec → Run → play pads. Lower BPM to learn. Keys 1–7 = pads.';
      if (scaleName === 'phrygian') {
        hintText += ' Try pentatonic_min scale for simpler lines.';
      }
      if (recArmed && !useChuckClock()) {
        hintText = 'Sync ON required for loop record.';
      }
      hint.textContent = hintText;
    }

    const pads = keyboardDrawerEl.querySelectorAll('.kb-pad');
    keyboardPads.forEach((pad, i) => {
      if (pads[i]) pads[i].textContent = pad.label;
    });

    updateChaseRow();
    updateKeyboardPadVisuals();
  }

  function updateKeyboardDrawer() {
    if (!keyboardDrawerEl) return;
    const visible = !!keyboardTrack && isMidiKeyboardTrack(keyboardTrack);
    keyboardDrawerEl.classList.toggle('hidden', !visible);
    keyboardDrawerEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (!visible) {
      drawerBuiltFor = null;
      return;
    }

    const p = patterns[keyboardTrack];
    const mm = laneMinMax(p);
    computeKeyboardPads();

    const needsRebuild =
      drawerBuiltFor !== keyboardTrack ||
      keyboardOctave !== keyboardDrawerEl.dataset.octave ||
      scaleName !== keyboardDrawerEl.dataset.scale;

    if (!needsRebuild && keyboardDrawerEl.querySelector('.kb-main')) {
      refreshKeyboardDrawerState();
      return;
    }

    suppressPadUntil = Date.now() + 200;
    drawerBuiltFor = keyboardTrack;
    keyboardDrawerEl.dataset.octave = String(keyboardOctave);
    keyboardDrawerEl.dataset.scale = scaleName;

    keyboardDrawerEl.innerHTML = '';

    const chase = document.createElement('div');
    chase.className = 'kb-chase';
    for (let i = 0; i < 16; i++) {
      const dot = document.createElement('div');
      dot.className = 'kb-chase-dot';
      dot.dataset.step = String(i);
      dot.textContent = String(i + 1);
      dot.title = 'Step ' + (i + 1);
      dot.addEventListener('click', () => {
        if (!stepInputMode) return;
        selectedStep = i;
        updateStepSelection();
      });
      chase.appendChild(dot);
    }
    keyboardDrawerEl.appendChild(chase);

    const main = document.createElement('div');
    main.className = 'kb-main';

    const label = document.createElement('span');
    label.className = 'kb-label';
    label.textContent =
      keyboardTrack + ' · ' + midiName(mm.min) + '–' + midiName(mm.max);
    main.appendChild(label);

    const btnOctDn = document.createElement('button');
    btnOctDn.type = 'button';
    btnOctDn.textContent = 'Oct−';
    btnOctDn.title = 'Lower octave';
    btnOctDn.addEventListener('click', () => {
      keyboardOctave = Math.max(0, keyboardOctave - 1);
      computeKeyboardPads();
      updateKeyboardDrawer();
    });
    main.appendChild(btnOctDn);

    const btnOctUp = document.createElement('button');
    btnOctUp.type = 'button';
    btnOctUp.textContent = 'Oct+';
    btnOctUp.title = 'Raise octave';
    btnOctUp.addEventListener('click', () => {
      keyboardOctave = Math.min(10, keyboardOctave + 1);
      computeKeyboardPads();
      updateKeyboardDrawer();
    });
    main.appendChild(btnOctUp);

    const btnRec = document.createElement('button');
    btnRec.type = 'button';
    btnRec.className = 'kb-rec';
    btnRec.textContent = '● Rec';
    btnRec.title = 'Arm loop record (Volca-style)';
    if (recArmed && recordingActive()) btnRec.classList.add('recording');
    else if (recArmed) btnRec.classList.add('armed');
    btnRec.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      recArmed = !recArmed;
      lastRecordStep = -1;
      refreshKeyboardDrawerState();
    });
    main.appendChild(btnRec);

    const btnStep = document.createElement('button');
    btnStep.type = 'button';
    btnStep.className = 'kb-step';
    btnStep.textContent = 'Step';
    btnStep.title = 'Step input (S.rEc-style)';
    if (stepInputMode) btnStep.classList.add('active');
    btnStep.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      stepInputMode = !stepInputMode;
      updateStepSelection();
      refreshKeyboardDrawerState();
    });
    main.appendChild(btnStep);

    const pads = document.createElement('div');
    pads.className = 'kb-pads';
    keyboardPads.forEach((pad, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kb-pad';
      b.textContent = pad.label;
      b.title = 'Keys 1–' + keyboardPads.length + ' on keyboard';
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        onPadPress(i);
      });
      b.addEventListener('pointerup', onPadRelease);
      b.addEventListener('pointerleave', onPadRelease);
      pads.appendChild(b);
    });
    main.appendChild(pads);

    const suggestSel = document.createElement('select');
    suggestSel.className = 'groove-preset';
    suggestSel.title = 'Harmonic suggest style';
    for (const [val, lab] of [
      ['walk', 'Walk'],
      ['bass', 'Bass'],
      ['arp', 'Arp'],
      ['motif', 'Motif'],
    ]) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = lab;
      if (val === drawerSuggestStyle) o.selected = true;
      suggestSel.appendChild(o);
    }
    suggestSel.addEventListener('change', () => {
      drawerSuggestStyle = suggestSel.value || 'walk';
    });
    main.appendChild(suggestSel);

    const btnSuggest = document.createElement('button');
    btnSuggest.type = 'button';
    btnSuggest.textContent = 'Suggest';
    btnSuggest.title = 'Seed edit bank with harmonic pattern';
    btnSuggest.addEventListener('click', () => {
      if (!keyboardTrack) return;
      applySuggestToTrack(keyboardTrack, drawerSuggestStyle);
    });
    main.appendChild(btnSuggest);

    keyboardDrawerEl.appendChild(main);

    const hint = document.createElement('div');
    hint.className = 'kb-hint';
    let hintText = 'Rec → Run → play pads. Lower BPM to learn. Keys 1–7 = pads.';
    if (scaleName === 'phrygian') {
      hintText += ' Try pentatonic_min scale for simpler lines.';
    }
    if (recArmed && !useChuckClock()) {
      hintText = 'Sync ON required for loop record.';
    }
    hint.textContent = hintText;
    keyboardDrawerEl.appendChild(hint);

    refreshKeyboardDrawerState();
  }

  function handleKeyboardKeydown(e) {
    if (!keyboardTrack || keyboardPads.length === 0) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    const keyMap = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8 };
    const idx = keyMap[e.key];
    if (idx === undefined || idx >= keyboardPads.length) return;
    if (e.repeat) return;
    e.preventDefault();
    onPadPress(idx);
  }

  function handleKeyboardKeyup(e) {
    const keyMap = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8 };
    if (keyMap[e.key] !== undefined) onPadRelease();
  }

  document.addEventListener('keydown', handleKeyboardKeydown);
  document.addEventListener('keyup', handleKeyboardKeyup);

  function render() {
    if (!tracksEl) return;
    tracksEl.innerHTML = '';
    fillAddSelect();
    if (scaleSel) scaleSel.value = scaleName;
    if (masterBpmIn) masterBpmIn.value = String(masterBpm);
    if (syncChk) syncChk.checked = syncClocks;
    if (swingEnableChk) swingEnableChk.checked = swingEnabled;
    if (applyAtBarChk) applyAtBarChk.checked = applyAtBar;

    if (!trackOrder.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = targets.length
        ? 'Add a track — @seq / @seqGate appear automatically.'
        : 'Start VM → master → modules → dac-out or fx → Open Sequencer.';
      tracksEl.appendChild(empty);
    } else {
      for (const name of trackOrder) {
        const card = makeTrack(name);
        if (card) tracksEl.appendChild(card);
      }
    }

    updateHint();
    for (const name of trackOrder) {
      updatePlayhead(name);
    }
    if (keyboardTrack && !isMidiKeyboardTrack(keyboardTrack)) {
      keyboardTrack = null;
      recArmed = false;
    }
    updateKeyboardDrawer();
  }

  function updateHint() {
    if (!hintEl) return;
    let text =
      (syncClocks
        ? 'Sync ON · ChucK clock · ' + masterBpm + ' BPM · '
        : 'Independent host clocks · ') +
      'scale ' +
      scaleName +
      ' · ' +
      trackOrder.length +
      ' track(s) · M/S mute/solo · Shift+drag gate = probability · swing ' +
      (swingEnabled ? 'ON' : 'OFF') +
      (useChuckClock()
        ? ' · apply ' + (applyAtBar ? 'at bar' : 'realtime')
        : '') +
      ' · transforms below each grid · edit bank only · Undo per track · track presets · patterns in .chuck-live/patterns/';
    if (patternPendingHint && applyAtBar && anyTrackRunning()) {
      text = 'queued — applies at bar · ' + text;
    }
    hintEl.textContent = text;
    hintEl.classList.toggle('pending', !!patternPendingHint && applyAtBar);
  }

  function resyncRunning(fireNow) {
    stopMasterTimer();
    stopAllIndependent();
    const running = trackOrder.filter((n) => patterns[n] && patterns[n].running);
    if (!running.length) {
      dumpTransport({ running: false });
      publishTransport({ running: false });
      return;
    }
    if (syncClocks) {
      for (const n of running) {
        patterns[n].bpm = masterBpm;
        patterns[n].playhead = sharedPlayhead;
      }
      startMasterTimer(fireNow !== false);
    } else {
      // Leaving ChucK clock — hard-stop transport, use host intervals
      for (const n of running) {
        ensureTrackBpm(patterns[n]);
      }
      dumpTransport({ running: false });
      publishTransport({ running: false, bpm: masterBpm });
      for (const n of running) startClock(n);
    }
  }

  function exportBank(bank) {
    return {
      values: bank.values.slice(0, 16),
      gates: bank.gates.slice(0, 16),
      probs: normalizeProbs(bank.probs),
    };
  }

  /** Single-track snapshot for .chuck-live/seq-presets/ (not full pattern Save As). */
  function exportTrackPreset(name) {
    const p = patterns[name];
    if (!p) return null;
    ensureBanks(p);
    ensurePatternFlags(p);
    return {
      kind: p.kind || 'float',
      mode: p.mode,
      gate: p.gate || '',
      swing: clampSwing(p.swing),
      activeBank: p.activeBank === 'B' ? 'B' : 'A',
      editBank: p.editBank === 'B' ? 'B' : 'A',
      banks: {
        A: exportBank(p.banks.A),
        B: exportBank(p.banks.B),
      },
    };
  }

  function applyTrackPreset(name, src) {
    const p = patterns[name];
    if (!p || !src || typeof src !== 'object') return;
    ensureBanks(p);
    if (typeof src.swing === 'number') {
      p.swing = clampSwing(src.swing);
    }
    if (typeof src.gate === 'string') {
      if (!src.gate || gateOptions.indexOf(src.gate) >= 0) {
        p.gate = src.gate;
      }
    }
    if (src.banks && src.banks.A && src.banks.B) {
      p.banks = {
        A: {
          values: (src.banks.A.values || []).slice(0, 16),
          gates: (src.banks.A.gates || []).slice(0, 16),
          probs: normalizeProbs(src.banks.A.probs),
        },
        B: {
          values: (src.banks.B.values || []).slice(0, 16),
          gates: (src.banks.B.gates || []).slice(0, 16),
          probs: normalizeProbs(src.banks.B.probs),
        },
      };
      while (p.banks.A.values.length < 16) p.banks.A.values.push(0);
      while (p.banks.B.values.length < 16) p.banks.B.values.push(0);
      while (p.banks.A.gates.length < 16) p.banks.A.gates.push(0);
      while (p.banks.B.gates.length < 16) p.banks.B.gates.push(0);
      p.activeBank = src.activeBank === 'B' ? 'B' : 'A';
      p.editBank = src.editBank === 'B' ? 'B' : 'A';
      clearQueue(p);
      ensureBanks(p);
    }
    persist();
    dumpTransportSoon();
    render();
  }

  function populateSeqPresetOptions(sel, track, selected) {
    const names = presetLists[track] || [];
    sel.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— seq —';
    sel.appendChild(empty);
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      if (n === selected) o.selected = true;
      sel.appendChild(o);
    }
  }

  function syncSeqPresetButtons(wrap, selected) {
    const has = !!selected;
    for (const btn of wrap.querySelectorAll(
      '.seq-preset-btn-update, .seq-preset-btn-delete, .seq-preset-btn-restore'
    )) {
      btn.disabled = !has;
    }
  }

  function refreshSeqPresetDropdown(track, selected) {
    const card = tracksEl && tracksEl.querySelector('.track[data-target="' + track + '"]');
    const wrap = card && card.querySelector('.seq-presets');
    if (!wrap) return;
    const sel = wrap.querySelector('.seq-preset-select');
    if (!sel) return;
    const selName =
      selected !== undefined ? selected : saved.presetSel[track] || sel.value;
    populateSeqPresetOptions(sel, track, selName);
    syncSeqPresetButtons(wrap, sel.value);
  }

  function makeTrackPresetBar(name) {
    const wrap = document.createElement('div');
    wrap.className = 'seq-presets';
    wrap.title = 'Save / load this track only (.chuck-live/seq-presets/)';

    const sel = document.createElement('select');
    sel.className = 'seq-preset-select';
    sel.title = 'Load track sequence preset';
    populateSeqPresetOptions(sel, name, saved.presetSel[name] || '');

    sel.addEventListener('change', () => {
      const presetName = sel.value;
      if (!presetName) {
        delete saved.presetSel[name];
        vscode.setState(saved);
        syncSeqPresetButtons(wrap, '');
        return;
      }
      saved.presetSel[name] = presetName;
      vscode.setState(saved);
      syncSeqPresetButtons(wrap, presetName);
      vscode.postMessage({
        type: 'loadSeqPreset',
        track: name,
        name: presetName,
      });
    });

    const btns = document.createElement('div');
    btns.className = 'seq-preset-btns';

    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'seq-preset-btn';
    btnSave.textContent = 'Save';
    btnSave.title = 'Save this track as a new sequence preset';
    btnSave.addEventListener('click', () => {
      const preset = exportTrackPreset(name);
      if (!preset) return;
      vscode.postMessage({
        type: 'requestSaveSeqPreset',
        track: name,
        preset,
      });
    });

    const btnUpdate = document.createElement('button');
    btnUpdate.type = 'button';
    btnUpdate.className = 'seq-preset-btn seq-preset-btn-update';
    btnUpdate.textContent = 'Update';
    btnUpdate.title = 'Overwrite selected track preset';
    btnUpdate.addEventListener('click', () => {
      const presetName = sel.value;
      if (!presetName) return;
      const preset = exportTrackPreset(name);
      if (!preset) return;
      vscode.postMessage({
        type: 'updateSeqPreset',
        track: name,
        name: presetName,
        preset,
      });
    });

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'seq-preset-btn seq-preset-btn-delete';
    btnDelete.textContent = 'Delete';
    btnDelete.title = 'Delete selected track preset';
    btnDelete.addEventListener('click', () => {
      const presetName = sel.value;
      if (!presetName) return;
      vscode.postMessage({
        type: 'deleteSeqPreset',
        track: name,
        name: presetName,
      });
    });

    const btnRestore = document.createElement('button');
    btnRestore.type = 'button';
    btnRestore.className = 'seq-preset-btn seq-preset-btn-restore';
    btnRestore.textContent = 'Restore';
    btnRestore.title = 'Re-apply selected track preset from disk';
    btnRestore.addEventListener('click', () => {
      const presetName = sel.value;
      if (!presetName) return;
      vscode.postMessage({
        type: 'loadSeqPreset',
        track: name,
        name: presetName,
      });
    });

    btns.appendChild(btnSave);
    btns.appendChild(btnUpdate);
    btns.appendChild(btnDelete);
    btns.appendChild(btnRestore);

    wrap.appendChild(sel);
    wrap.appendChild(btns);
    syncSeqPresetButtons(wrap, sel.value);
    return wrap;
  }

  function exportPatternSnapshot(name) {
    const data = {
      version: 1,
      name: name,
      scaleName: scaleName,
      masterBpm: masterBpm,
      syncClocks: syncClocks,
      swingEnabled: swingEnabled,
      trackOrder: trackOrder.slice(),
      patterns: {},
    };
    for (const n of trackOrder) {
      const p = patterns[n];
      if (!p) continue;
      ensureBanks(p);
      ensurePatternFlags(p);
      data.patterns[n] = {
        kind: p.kind || 'float',
        mode: p.mode,
        bpm: p.bpm,
        swing: clampSwing(p.swing),
        muted: !!p.muted,
        solo: !!p.solo,
        gate: p.gate || '',
        activeBank: p.activeBank === 'B' ? 'B' : 'A',
        editBank: p.editBank === 'B' ? 'B' : 'A',
        banks: {
          A: exportBank(p.banks.A),
          B: exportBank(p.banks.B),
        },
      };
    }
    return data;
  }

  function stopEverything() {
    for (const name of trackOrder) {
      if (patterns[name]) patterns[name].running = false;
      stopClock(name);
    }
    stopMasterTimer();
    patternPendingHint = false;
    if (useChuckClock()) {
      publishTransport({ running: false });
      dumpTransport({ running: false });
    }
  }

  function applyPatternFile(data) {
    if (!data || typeof data !== 'object') return;
    stopEverything();

    if (typeof data.scaleName === 'string' && SCALES[data.scaleName]) {
      scaleName = data.scaleName;
    }
    if (typeof data.masterBpm === 'number') {
      masterBpm = Math.max(40, Math.min(200, data.masterBpm));
    }
    if (typeof data.syncClocks === 'boolean') {
      syncClocks = data.syncClocks;
    }
    if (typeof data.swingEnabled === 'boolean') {
      swingEnabled = data.swingEnabled;
    } else {
      swingEnabled = false;
    }

    const targetNames = new Set(targets.map((t) => t.name));
    const incomingOrder = Array.isArray(data.trackOrder) ? data.trackOrder : [];
    const incomingPatterns =
      data.patterns && typeof data.patterns === 'object' ? data.patterns : {};

    const nextOrder = [];
    for (const n of incomingOrder) {
      if (!targetNames.has(n)) continue;
      const t = targets.find((x) => x.name === n);
      if (!t) continue;
      const src = incomingPatterns[n];
      ensurePattern(t);
      const p = patterns[n];
      if (src && typeof src === 'object') {
        if (typeof src.bpm === 'number') {
          p.bpm = Math.max(40, Math.min(200, src.bpm));
        }
        p.swing = clampSwing(src.swing);
        p.muted = !!src.muted;
        p.solo = !!src.solo;
        if (typeof src.gate === 'string') p.gate = src.gate;
        if (src.banks && src.banks.A && src.banks.B) {
          p.banks = {
            A: {
              values: (src.banks.A.values || []).slice(0, 16),
              gates: (src.banks.A.gates || []).slice(0, 16),
              probs: normalizeProbs(src.banks.A.probs),
            },
            B: {
              values: (src.banks.B.values || []).slice(0, 16),
              gates: (src.banks.B.gates || []).slice(0, 16),
              probs: normalizeProbs(src.banks.B.probs),
            },
          };
          while (p.banks.A.values.length < 16) p.banks.A.values.push(0);
          while (p.banks.B.values.length < 16) p.banks.B.values.push(0);
          while (p.banks.A.gates.length < 16) p.banks.A.gates.push(0);
          while (p.banks.B.gates.length < 16) p.banks.B.gates.push(0);
          p.activeBank = src.activeBank === 'B' ? 'B' : 'A';
          p.editBank = src.editBank === 'B' ? 'B' : 'A';
          p.queued = null;
        }
        p.running = false;
        p.playhead = 0;
        ensureBanks(p);
      }
      nextOrder.push(n);
    }

    trackOrder = nextOrder;
    sharedPlayhead = 0;
    persist();
    render();
  }

  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      const name = addSel && addSel.value;
      if (name) addTrack(name);
    });
  }
  if (btnRunAll) {
    btnRunAll.addEventListener('click', () => {
      const already = anyTrackRunning();
      if (!already) sharedPlayhead = 0;
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p) continue;
        p.running = true;
        p.playhead = already ? sharedPlayhead : 0;
        setEditBank(p, p.activeBank);
      }
      resyncRunning(true);
      for (const name of trackOrder) updatePlayhead(name);
      persist();
      render();
    });
  }
  if (btnStopAll) {
    btnStopAll.addEventListener('click', () => {
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p) continue;
        p.running = false;
        stopClock(name);
      }
      stopMasterTimer();
      patternPendingHint = false;
      if (useChuckClock()) {
        publishTransport({ running: false });
        dumpTransport({ running: false });
      }
      for (const name of trackOrder) updatePlayhead(name);
      persist();
      refreshKeyboardDrawerState();
    });
  }
  if (btnSaveAs) {
    btnSaveAs.addEventListener('click', () => {
      vscode.postMessage({
        type: 'requestSavePattern',
        data: exportPatternSnapshot(''),
      });
    });
  }
  if (btnLoad) {
    btnLoad.addEventListener('click', () => {
      vscode.postMessage({ type: 'requestLoadPattern' });
    });
  }
  if (scaleSel) {
    scaleSel.addEventListener('change', () => {
      scaleName = scaleSel.value || 'phrygian';
      // re-snap midi patterns (both banks)
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p || p.mode !== 'midi' || p.kind === 'gate') continue;
        ensureBanks(p);
        for (const id of ['A', 'B']) {
          for (let i = 0; i < 16; i++) {
            p.banks[id].values[i] = snapMidi(p.banks[id].values[i]);
          }
        }
        setEditBank(p, p.editBank);
      }
      persist();
      render();
      if (keyboardTrack) updateKeyboardDrawer();
    });
  }
  if (masterBpmIn) {
    masterBpmIn.addEventListener('change', () => {
      masterBpm = Math.max(40, Math.min(200, Number(masterBpmIn.value) || 120));
      if (syncClocks) {
        for (const name of trackOrder) {
          if (patterns[name]) patterns[name].bpm = masterBpm;
        }
        publishTransport({ bpm: masterBpm });
        if (useChuckClock()) {
          if (anyTrackRunning()) dumpTransportSoon();
        } else if (masterTimer) {
          startMasterTimer();
        }
      }
      persist();
      render();
    });
  }
  if (syncChk) {
    syncChk.addEventListener('change', () => {
      syncClocks = !!syncChk.checked;
      resyncRunning();
      persist();
      render();
    });
  }
  if (swingEnableChk) {
    swingEnableChk.addEventListener('change', () => {
      swingEnabled = !!swingEnableChk.checked;
      clearAllSwingFires();
      publishTransport({ swingEnabled: swingEnabled });
      if (useChuckClock() && anyTrackRunning()) dumpTransportSoon();
      persist();
      render();
    });
  }
  if (applyAtBarChk) {
    applyAtBarChk.addEventListener('change', () => {
      applyAtBar = !!applyAtBarChk.checked;
      if (!applyAtBar) patternPendingHint = false;
      persist();
      updateHint();
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'targets') {
      const prevNames = targets
        .map((t) => t.name)
        .sort()
        .join('\0');
      targets = msg.targets || [];
      gateOptions = msg.gates || [];
      if (msg.presetLists && typeof msg.presetLists === 'object') {
        presetLists = msg.presetLists;
      }
      const nextNames = targets
        .map((t) => t.name)
        .sort()
        .join('\0');
      const targetsChanged = prevNames !== nextNames;
      const orderChanged = syncPreferredTracks();
      render();
      if (targetsChanged || orderChanged) {
        if (useChuckClock()) {
          // Soft update: OSC patch / queue topology — never resyncRunning (OTF bump).
          if (anyTrackRunning() || orderChanged) dumpTransportSoon();
        } else {
          resyncRunning(anyTrackRunning());
        }
      } else if (useChuckClock() && anyTrackRunning()) {
        publishTransport({ bpm: masterBpm, step: sharedPlayhead });
      }
      return;
    }
    if (msg.type === 'seqPresets' && msg.track) {
      presetLists[msg.track] = msg.names || [];
      refreshSeqPresetDropdown(msg.track);
      return;
    }
    if (msg.type === 'seqPresetSaved' && msg.track && msg.name) {
      saved.presetSel[msg.track] = msg.name;
      vscode.setState(saved);
      refreshSeqPresetDropdown(msg.track, msg.name);
      return;
    }
    if (msg.type === 'seqPresetDeleted' && msg.track) {
      if (saved.presetSel[msg.track] === msg.name) {
        delete saved.presetSel[msg.track];
        vscode.setState(saved);
      }
      refreshSeqPresetDropdown(msg.track, '');
      return;
    }
    if (msg.type === 'seqPresetLoaded' && msg.track && msg.preset) {
      if (msg.name) {
        saved.presetSel[msg.track] = msg.name;
        vscode.setState(saved);
      }
      applyTrackPreset(msg.track, msg.preset);
      return;
    }
    if (msg.type === 'topologyQueued') {
      patternPendingHint = true;
      updateHint();
      return;
    }
    if (msg.type === 'topologyApplied') {
      patternPendingHint = false;
      updateHint();
      return;
    }
    if (msg.type === 'patternLoaded' && msg.data) {
      applyPatternFile(msg.data);
      return;
    }
    if (msg.type === 'playhead') {
      // Sync OFF: each track owns its playhead via host setInterval — ignore ChucK.
      if (!useChuckClock()) return;
      const step = ((Math.round(msg.step) % 16) + 16) % 16;
      const prev = sharedPlayhead;
      sharedPlayhead = step;
      if (msg.wrapped || (prev === 15 && step === 0)) {
        patternPendingHint = false;
        updateHint();
        lastRecordStep = -1;
        let swapped = false;
        for (const name of trackOrder) {
          const p = patterns[name];
          if (!p || !p.running) continue;
          if (applyQueueOnWrap(p)) swapped = true;
        }
        if (swapped) {
          refreshBankChromeAll();
          dumpTransport({ step: 0, running: true });
        }
      }
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p) continue;
        if (p.running) p.playhead = step;
        updatePlayhead(name);
      }
      captureRecordAtStep(step);
      return;
    }
    if (msg.type === 'bridgeReady') {
      publishTransport({ bpm: masterBpm, step: sharedPlayhead });
      if (useChuckClock() && anyTrackRunning()) dumpTransport();
      return;
    }
    if (msg.type === 'bridgeReloaded') {
      // Bridge OTF-replace only — re-push live_* OSC; do not reload transport (resets clock).
      publishTransport({ bpm: masterBpm, step: sharedPlayhead });
      return;
    }
    if (msg.type === 'setMasterBpm' && typeof msg.bpm === 'number') {
      masterBpm = safeBpm(msg.bpm);
      if (masterBpmIn) masterBpmIn.value = String(masterBpm);
      if (syncClocks) {
        for (const name of trackOrder) {
          if (patterns[name]) patterns[name].bpm = masterBpm;
        }
        publishTransport({ bpm: masterBpm });
        if (useChuckClock() && anyTrackRunning()) dumpTransportSoon();
      }
      persist();
      return;
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
