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
  let sharedPlayhead = 0;
  /** @type {any} */
  let masterTimer = null;

  /** @type {Array<any>} */
  let targets = [];
  /** @type {string[]} */
  let gateOptions = [];
  /** @type {Record<string, any>} */
  const timers = {};

  const tracksEl = document.getElementById('tracks');
  const addSel = document.getElementById('addTarget');
  const btnAdd = document.getElementById('btnAdd');
  const btnRunAll = document.getElementById('btnRunAll');
  const btnStopAll = document.getElementById('btnStopAll');
  const hintEl = document.getElementById('hint');
  const scaleSel = document.getElementById('scale');
  const masterBpmIn = document.getElementById('masterBpm');
  const syncChk = document.getElementById('syncClocks');

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
    });
  }

  function clamp(v, min, max, quant) {
    let x = Math.max(min, Math.min(max, v));
    if (quant >= 1) x = Math.round(x);
    else if (quant > 0) x = Math.round(x / quant) * quant;
    return x;
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
      bpm: masterBpm,
      running: false,
      playhead: 0,
      gate: t.gate || '',
      mode: t.mode,
      kind: t.kind || 'float',
      min: t.min,
      max: t.max,
      quant: t.step,
    };
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
    render();
  }

  function removeTrack(name) {
    stopClock(name);
    if (patterns[name]) patterns[name].running = false;
    trackOrder = trackOrder.filter((n) => n !== name);
    maybeStopMaster();
    persist();
    render();
  }

  function syncPreferredTracks() {
    let changed = false;
    for (const t of targets) {
      if (t.preferred && trackOrder.indexOf(t.name) < 0) {
        ensurePattern(t);
        trackOrder.push(t.name);
        changed = true;
      }
    }
    const names = new Set(targets.map((t) => t.name));
    const next = trackOrder.filter((n) => names.has(n));
    if (next.length !== trackOrder.length) {
      for (const n of trackOrder) {
        if (!names.has(n)) stopClock(n);
      }
      trackOrder = next;
      changed = true;
    }
    if (changed) persist();
  }

  function fireStep(targetName, idx) {
    const p = patterns[targetName];
    if (!p) return;
    const gateOn = p.gates[idx] > 0.5;
    let value = p.values[idx];
    if (p.kind !== 'gate' && p.mode === 'midi') {
      value = snapMidi(value);
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

  function stopClock(name) {
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
    if (!any) stopMasterTimer();
  }

  function startMasterTimer() {
    stopMasterTimer();
    stopAllIndependent();
    const ms = (60 / Math.max(40, masterBpm) / 4) * 1000;
    // fire current shared step for all running
    for (const name of trackOrder) {
      const p = patterns[name];
      if (p && p.running) {
        p.playhead = sharedPlayhead;
        fireStep(name, sharedPlayhead);
        updatePlayhead(name);
      }
    }
    masterTimer = setInterval(() => {
      sharedPlayhead = (sharedPlayhead + 1) % 16;
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p || !p.running) continue;
        p.playhead = sharedPlayhead;
        fireStep(name, sharedPlayhead);
        updatePlayhead(name);
      }
    }, ms);
  }

  function startClock(name) {
    const p = patterns[name];
    if (!p) return;
    if (syncClocks) {
      stopClock(name);
      p.bpm = masterBpm;
      if (!masterTimer) {
        sharedPlayhead = p.playhead || 0;
        startMasterTimer();
      } else {
        p.playhead = sharedPlayhead;
        fireStep(name, sharedPlayhead);
        updatePlayhead(name);
      }
      return;
    }
    stopClock(name);
    const ms = (60 / Math.max(40, p.bpm) / 4) * 1000;
    fireStep(name, p.playhead);
    timers[name] = setInterval(() => {
      p.playhead = (p.playhead + 1) % 16;
      fireStep(name, p.playhead);
      updatePlayhead(name);
    }, ms);
  }

  function updatePlayhead(name) {
    if (!tracksEl) return;
    const track = tracksEl.querySelector('.track[data-target="' + name + '"]');
    if (!track) return;
    const p = patterns[name];
    const ph = p ? p.playhead : 0;
    track.classList.toggle('running', !!(p && p.running));
    const runBtn = track.querySelector('.btn-run');
    if (runBtn) runBtn.classList.toggle('active', !!(p && p.running));
    track.querySelectorAll('.step').forEach((el, idx) => {
      el.classList.toggle('playhead', !!(p && p.running && idx === ph));
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
    gate.className = 'gate big' + (p.gates[i] > 0.5 ? ' on' : '');
    gate.title = 'Trigger';
    gate.addEventListener('click', () => {
      p.gates[i] = p.gates[i] > 0.5 ? 0 : 1;
      gate.classList.toggle('on', p.gates[i] > 0.5);
      persist();
    });
    el.appendChild(num);
    el.appendChild(gate);
    return el;
  }

  function makeStep(i, p) {
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
    gate.className = 'gate' + (p.gates[i] > 0.5 ? ' on' : '');
    gate.title = 'Step gate';
    gate.addEventListener('click', () => {
      p.gates[i] = p.gates[i] > 0.5 ? 0 : 1;
      gate.classList.toggle('on', p.gates[i] > 0.5);
      persist();
    });

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
    });

    el.appendChild(num);
    el.appendChild(pitch);
    el.appendChild(label);
    el.appendChild(gate);
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
      (p.kind === 'gate' ? ' track-gate' : '');
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
      });
      gatePick.appendChild(gateSel);
      bar.appendChild(gatePick);
    }

    const btnRun = document.createElement('button');
    btnRun.type = 'button';
    btnRun.className = 'btn-run' + (p.running ? ' active' : '');
    btnRun.textContent = 'Run';
    btnRun.addEventListener('click', () => {
      p.running = true;
      if (syncClocks) {
        sharedPlayhead = 0;
        p.playhead = 0;
      } else {
        p.playhead = 0;
      }
      startClock(name);
      updatePlayhead(name);
      persist();
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

    bar.appendChild(btnRun);
    bar.appendChild(btnStop);
    bar.appendChild(btnReset);

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
        p.bpm = Math.max(40, Math.min(200, Number(bpmIn.value) || 120));
        if (p.running) startClock(name);
        persist();
      });
      bpmLab.appendChild(bpmIn);
      bar.appendChild(bpmLab);
    }

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'remove';
    btnRemove.textContent = 'Remove';
    btnRemove.addEventListener('click', () => removeTrack(name));
    bar.appendChild(btnRemove);

    const grid = document.createElement('div');
    grid.className = 'grid' + (p.kind === 'gate' ? ' grid-gate' : '');
    for (let i = 0; i < 16; i++) {
      grid.appendChild(makeStep(i, p));
    }

    track.appendChild(bar);
    track.appendChild(grid);
    return track;
  }

  function render() {
    if (!tracksEl) return;
    tracksEl.innerHTML = '';
    fillAddSelect();
    if (scaleSel) scaleSel.value = scaleName;
    if (masterBpmIn) masterBpmIn.value = String(masterBpm);
    if (syncChk) syncChk.checked = syncClocks;

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

    if (hintEl) {
      hintEl.textContent =
        (syncClocks ? 'Sync ON · master ' + masterBpm + ' BPM · ' : 'Independent clocks · ') +
        'scale ' +
        scaleName +
        ' · ' +
        trackOrder.length +
        ' track(s)';
    }

    for (const name of trackOrder) {
      updatePlayhead(name);
    }
  }

  function resyncRunning() {
    stopMasterTimer();
    stopAllIndependent();
    const running = trackOrder.filter((n) => patterns[n] && patterns[n].running);
    if (!running.length) return;
    if (syncClocks) {
      sharedPlayhead = 0;
      for (const n of running) {
        patterns[n].playhead = 0;
        patterns[n].bpm = masterBpm;
      }
      startMasterTimer();
    } else {
      for (const n of running) startClock(n);
    }
  }

  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      const name = addSel && addSel.value;
      if (name) addTrack(name);
    });
  }
  if (btnRunAll) {
    btnRunAll.addEventListener('click', () => {
      sharedPlayhead = 0;
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p) continue;
        p.running = true;
        p.playhead = 0;
      }
      resyncRunning();
      for (const name of trackOrder) updatePlayhead(name);
      persist();
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
      for (const name of trackOrder) updatePlayhead(name);
      persist();
    });
  }
  if (scaleSel) {
    scaleSel.addEventListener('change', () => {
      scaleName = scaleSel.value || 'phrygian';
      // re-snap midi patterns
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p || p.mode !== 'midi' || p.kind === 'gate') continue;
        for (let i = 0; i < 16; i++) p.values[i] = snapMidi(p.values[i]);
      }
      persist();
      render();
    });
  }
  if (masterBpmIn) {
    masterBpmIn.addEventListener('change', () => {
      masterBpm = Math.max(40, Math.min(200, Number(masterBpmIn.value) || 120));
      if (syncClocks) {
        for (const name of trackOrder) {
          if (patterns[name]) patterns[name].bpm = masterBpm;
        }
        if (masterTimer) startMasterTimer();
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

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'targets') return;
    targets = msg.targets || [];
    gateOptions = msg.gates || [];
    syncPreferredTracks();
    render();
    resyncRunning();
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
