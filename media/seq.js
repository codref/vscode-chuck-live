(function () {
  const vscode = acquireVsCodeApi();

  const MB_DEFAULT = [48, 51, 55, 58, 60, 55, 51, 48, 60, 63, 67, 70, 72, 67, 63, 60];
  const MB_GATES = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1];

  const saved = vscode.getState() || { patterns: {}, trackOrder: [] };
  /** @type {Record<string, any>} */
  const patterns = saved.patterns || {};
  /** @type {string[]} */
  let trackOrder = Array.isArray(saved.trackOrder) ? saved.trackOrder.slice() : [];
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
    if (base) return base + ' · ' + t.name;
    return t.name;
  }

  function persist() {
    vscode.setState({ patterns: patterns, trackOrder: trackOrder });
  }

  function clamp(v, min, max, quant) {
    let x = Math.max(min, Math.min(max, v));
    if (quant >= 1) x = Math.round(x);
    else if (quant > 0) x = Math.round(x / quant) * quant;
    return x;
  }

  function ensurePattern(t) {
    if (patterns[t.name]) {
      const p = patterns[t.name];
      p.mode = t.mode;
      p.min = t.min;
      p.max = t.max;
      p.quant = t.step;
      if (p.playhead === undefined) p.playhead = 0;
      if (t.gate && !p.gate) p.gate = t.gate;
      return p;
    }
    let values;
    let gates;
    if (t.mode === 'midi') {
      values = MB_DEFAULT.slice();
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
      bpm: 120,
      running: false,
      playhead: 0,
      gate: t.gate || '',
      mode: t.mode,
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
        : '(load shreds with @knob / @seq)';
      addSel.appendChild(o);
      if (btnAdd) btnAdd.disabled = true;
      return;
    }
    if (btnAdd) btnAdd.disabled = false;

    const preferred = avail.filter((t) => t.preferred);
    const rest = avail.filter((t) => !t.preferred);

    if (preferred.length && rest.length) {
      const g1 = document.createElement('optgroup');
      g1.label = 'Sequenceable (@seq)';
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
    persist();
    render();
  }

  /** Auto-open @seq preferred targets that aren't tracks yet. */
  function syncPreferredTracks() {
    let changed = false;
    for (const t of targets) {
      if (t.preferred && trackOrder.indexOf(t.name) < 0) {
        ensurePattern(t);
        trackOrder.push(t.name);
        changed = true;
      }
    }
    // Drop tracks whose targets disappeared
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
    vscode.postMessage({
      type: 'fire',
      target: targetName,
      value: p.values[idx],
      gateOn: gateOn,
      gate: p.gate || undefined,
      mode: p.mode,
    });
  }

  function stopClock(name) {
    if (timers[name]) {
      clearInterval(timers[name]);
      timers[name] = null;
    }
  }

  function startClock(name) {
    stopClock(name);
    const p = patterns[name];
    if (!p) return;
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

  function makeStep(i, p) {
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
      const t = (p.values[i] - p.min) / Math.max(1e-9, p.max - p.min);
      fill.style.height = Math.max(4, t * 100) + '%';
      label.textContent =
        p.mode === 'midi'
          ? midiName(p.values[i])
          : fmtRaw(p.values[i], p.quant);
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
    track.className = 'track' + (p.running ? ' running' : '');
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

    const btnRun = document.createElement('button');
    btnRun.type = 'button';
    btnRun.className = 'btn-run' + (p.running ? ' active' : '');
    btnRun.textContent = 'Run';
    btnRun.addEventListener('click', () => {
      p.running = true;
      p.playhead = 0;
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
      updatePlayhead(name);
      persist();
    });

    const btnReset = document.createElement('button');
    btnReset.type = 'button';
    btnReset.textContent = 'Reset';
    btnReset.addEventListener('click', () => {
      p.playhead = 0;
      updatePlayhead(name);
      persist();
    });

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

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'remove';
    btnRemove.textContent = 'Remove';
    btnRemove.title = 'Remove this sequencer track';
    btnRemove.addEventListener('click', () => removeTrack(name));

    bar.appendChild(nameEl);
    bar.appendChild(gatePick);
    bar.appendChild(btnRun);
    bar.appendChild(btnStop);
    bar.appendChild(btnReset);
    bar.appendChild(bpmLab);
    bar.appendChild(btnRemove);

    const grid = document.createElement('div');
    grid.className = 'grid';
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

    if (!trackOrder.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = targets.length
        ? 'Add a track above — @seq targets appear automatically when you load shreds.'
        : 'Start VM, Add master + a module, then open Sequencer again (or Add track).';
      tracksEl.appendChild(empty);
    } else {
      for (const name of trackOrder) {
        const card = makeTrack(name);
        if (card) tracksEl.appendChild(card);
      }
    }

    if (hintEl) {
      const n = trackOrder.length;
      hintEl.textContent =
        n === 0
          ? 'Cascade: each track sequences one float independently (Run/Stop per track).'
          : n +
            ' track' +
            (n === 1 ? '' : 's') +
            ' · drag values · step pads = gate · Run each independently';
    }

    for (const name of trackOrder) {
      updatePlayhead(name);
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
      for (const name of trackOrder) {
        const p = patterns[name];
        if (!p) continue;
        p.running = true;
        p.playhead = 0;
        startClock(name);
        updatePlayhead(name);
      }
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
        updatePlayhead(name);
      }
      persist();
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'targets') return;
    targets = msg.targets || [];
    gateOptions = msg.gates || [];
    syncPreferredTracks();
    render();
    for (const name of trackOrder) {
      if (patterns[name] && patterns[name].running) {
        startClock(name);
      }
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
