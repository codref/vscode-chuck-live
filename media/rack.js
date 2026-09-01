(function () {
  const vscode = acquireVsCodeApi();
  const caseEl = document.getElementById('case');
  const saved = vscode.getState() || { values: {} };

  const ANGLE_MIN = -135;
  const ANGLE_MAX = 135;

  const DB_MIN = -60;
  const LED_ON_DB = -48;
  const LED_HOT_DB = -6;
  const LED_CLIP_DB = -0.1;
  const LED_HOLD_MS = 450;

  const ledHoldUntil = {};

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setRack') {
      render(msg.modules || []);
    } else if (msg.type === 'setKnob' && msg.name !== undefined && msg.value !== undefined) {
      applyKnobValue(msg.name, Number(msg.value));
    } else if (msg.type === 'vu') {
      paintMasterVu(Number(msg.l) || 0, Number(msg.r) || 0);
    } else if (msg.type === 'peaks') {
      paintPeaks(msg.peaks || {});
    } else if (msg.type === 'resetMeter') {
      resetMeterUi();
    }
  });

  vscode.postMessage({ type: 'ready' });
  requestAnimationFrame(meterTick);

  function render(modules) {
    if (!caseEl) return;
    caseEl.innerHTML = '';

    if (!modules.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.innerHTML =
        'No modules loaded.<br/>Start the VM, then <code>Add</code> shreds ' +
        '(load <code>master.ck</code> first for bus oscillators).';
      caseEl.appendChild(empty);
      return;
    }

    for (const mod of modules) {
      caseEl.appendChild(makeModule(mod));
    }
  }

  function makeModule(mod) {
    const el = document.createElement('div');
    el.className =
      'module' +
      (mod.isMaster ? ' master' : '') +
      (mod.isTransport ? ' transport' : '');
    if (mod.isTransport) {
      el.dataset.shredId = 'transport';
    } else {
      el.dataset.shredId = String(mod.id);
    }

    const accent = document.createElement('div');
    accent.className = 'mod-accent';
    accent.style.background = hashColor(mod.title);

    const head = document.createElement('div');
    head.className = 'mod-head';
    const title = document.createElement('div');
    title.className = 'mod-title';
    title.textContent = stripExt(mod.title);
    title.title = mod.file || mod.title;
    const id = document.createElement('div');
    id.className = 'mod-id';
    id.textContent = mod.isTransport
      ? 'SEQ · tempo'
      : '#' + mod.id + (mod.isMaster ? ' · MASTER' : '');
    head.appendChild(title);
    head.appendChild(id);

    const controls = document.createElement('div');
    controls.className = 'controls';

    const groups =
      mod.groups ||
      (mod.knobs && mod.knobs.length ? [{ knobs: mod.knobs }] : []);
    if (!groups.length || !groups.some((g) => g.knobs && g.knobs.length)) {
      const none = document.createElement('div');
      none.className = 'cell-value';
      none.style.opacity = '0.5';
      none.textContent = 'no knobs';
      controls.appendChild(none);
    } else {
      for (const group of groups) {
        const knobs = group.knobs || [];
        if (!knobs.length) continue;

        let host = controls;
        if (group.pinned) {
          host = document.createElement('div');
          host.className = 'controls-main';
          controls.appendChild(host);
        } else if (group.label) {
          controls.appendChild(makeSectionDivider(group.label));
        }

        for (const k of knobs) {
          if (k.kind === 'button') {
            host.appendChild(makeBang(k));
          } else if ((k.ui || 'dial') === 'slider') {
            host.appendChild(makeSlider(k));
          } else {
            host.appendChild(makeDial(k));
          }
        }
      }
    }

    el.appendChild(accent);
    if (!mod.isMaster && !mod.isTransport) {
      const led = document.createElement('div');
      led.className = 'mod-peak-led';
      led.title = 'Peak';
      accent.appendChild(led);
      const peakFill = document.createElement('div');
      peakFill.className = 'mod-peak-fill';
      accent.appendChild(peakFill);
    }
    el.appendChild(head);
    el.appendChild(controls);
    if (mod.isMaster) {
      el.appendChild(makeMasterMeter());
    }
    return el;
  }

  function makeMasterMeter() {
    const wrap = document.createElement('div');
    wrap.className = 'mod-meter';
    wrap.innerHTML =
      '<div class="mod-meter-title">VU</div>' +
      channelHtml('L') +
      channelHtml('R');
    return wrap;
  }

  function channelHtml(ch) {
    const side = ch === 'L' ? 'L' : 'R';
    return (
      '<div class="mod-meter-ch">' +
      '<span class="mod-meter-label">' +
      side +
      '</span>' +
      '<div class="mod-meter-bar-wrap">' +
      '<div class="mod-meter-bar" data-bar="' +
      side +
      '"></div>' +
      '<div class="mod-meter-hold" data-hold="' +
      side +
      '"></div>' +
      '</div>' +
      '<div class="mod-meter-led" data-led="' +
      side +
      '" title="Peak"></div>' +
      '</div>'
    );
  }

  const masterHold = { L: DB_MIN, R: DB_MIN, atL: 0, atR: 0 };

  function paintMasterVu(linL, linR) {
    const meter = caseEl && caseEl.querySelector('.module.master .mod-meter');
    if (!meter) return;
    const now = performance.now();
    const lDb = linToDb(linL);
    const rDb = linToDb(linR);
    if (lDb >= masterHold.L) {
      masterHold.L = lDb;
      masterHold.atL = now;
    }
    if (rDb >= masterHold.R) {
      masterHold.R = rDb;
      masterHold.atR = now;
    }
    paintMasterCh(meter, 'L', lDb, decayHold(masterHold.L, masterHold.atL, now));
    paintMasterCh(meter, 'R', rDb, decayHold(masterHold.R, masterHold.atR, now));
  }

  function decayHold(hold, holdAt, now) {
    if (now - holdAt < 1200) return hold;
    return Math.max(DB_MIN, hold - 0.4);
  }

  function paintMasterCh(meter, side, level, hold) {
    const bar = meter.querySelector('[data-bar="' + side + '"]');
    const holdEl = meter.querySelector('[data-hold="' + side + '"]');
    const led = meter.querySelector('[data-led="' + side + '"]');
    if (!bar || !holdEl || !led) return;
    bar.style.width = dbToPct(level) + '%';
    holdEl.style.left = dbToPct(hold) + '%';
    holdEl.classList.toggle('on', hold > DB_MIN + 0.5);
    holdEl.classList.toggle('clip', hold >= LED_CLIP_DB);
    const clip = level >= LED_CLIP_DB || hold >= LED_CLIP_DB;
    led.classList.toggle('on', hold >= LED_HOT_DB && !clip);
    led.classList.toggle('clip', clip);
    bar.classList.toggle('clip', level >= LED_CLIP_DB);
  }

  function resetMeterUi() {
    for (const k of Object.keys(ledHoldUntil)) {
      delete ledHoldUntil[k];
    }
    masterHold.L = DB_MIN;
    masterHold.R = DB_MIN;
    paintMasterVu(0, 0);
    if (!caseEl) return;
    for (const el of caseEl.querySelectorAll('.module')) {
      el.classList.remove('peaking', 'clipping');
    }
    for (const led of caseEl.querySelectorAll('.mod-peak-led, .mod-meter-led')) {
      led.classList.remove('on', 'hot', 'clip');
      led.style.opacity = '';
    }
    for (const fill of caseEl.querySelectorAll('.mod-peak-fill')) {
      fill.style.width = '0%';
      fill.classList.remove('hot', 'clip');
    }
    for (const bar of caseEl.querySelectorAll('.mod-meter-bar')) {
      bar.style.width = '0%';
      bar.classList.remove('clip');
    }
    for (const hold of caseEl.querySelectorAll('.mod-meter-hold')) {
      hold.style.left = '0%';
      hold.classList.remove('on', 'clip');
    }
  }

  function meterTick(now) {
    if (caseEl) {
      for (const el of caseEl.querySelectorAll('.module:not(.master)')) {
        const id = el.dataset.shredId;
        const until = ledHoldUntil[id] || 0;
        if (until > 0 && until <= now) {
          ledHoldUntil[id] = 0;
          el.classList.remove('peaking');
          const led = el.querySelector('.mod-peak-led');
          if (led && !led.classList.contains('clip')) {
            led.classList.remove('on', 'hot');
            led.style.opacity = '';
          }
        }
      }
    }
    requestAnimationFrame(meterTick);
  }

  function paintPeaks(peaks) {
    if (!caseEl) return;
    const now = performance.now();
    const mods = caseEl.querySelectorAll('.module:not(.master)');
    for (const el of mods) {
      const id = el.dataset.shredId;
      const lin = Number(peaks[id]) || 0;
      const db = linToDb(lin);
      if (db >= LED_ON_DB) {
        ledHoldUntil[id] = now + LED_HOLD_MS;
      }
      const holding = (ledHoldUntil[id] || 0) > now;
      const clip = db >= LED_CLIP_DB;
      const on = holding || db >= LED_ON_DB;
      const hot = db >= LED_HOT_DB;
      el.classList.toggle('peaking', on && !clip);
      el.classList.toggle('clipping', clip);
      const led = el.querySelector('.mod-peak-led');
      const fill = el.querySelector('.mod-peak-fill');
      const pct = dbToPct(db);
      if (fill) {
        fill.style.width = on || clip ? pct + '%' : '0%';
        fill.classList.toggle('hot', hot && !clip);
        fill.classList.toggle('clip', clip);
      }
      if (!led) continue;
      led.classList.toggle('on', on && !hot && !clip);
      led.classList.toggle('hot', hot && !clip);
      led.classList.toggle('clip', clip);
      led.style.opacity = '';
    }
  }

  function linToDb(lin) {
    if (!(lin > 0)) return DB_MIN;
    const db = 20 * Math.log10(lin);
    return Math.max(DB_MIN, Math.min(6, db));
  }

  function dbToPct(db) {
    const t = (db - DB_MIN) / (0 - DB_MIN);
    return Math.max(0, Math.min(100, t * 100));
  }

  function stripExt(name) {
    return String(name).replace(/\.ck$/i, '');
  }

  function hashColor(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    const hue = h % 360;
    return 'hsl(' + hue + ' 42% 42%)';
  }

  function bindValue(k, min, max, step) {
    let current =
      saved.values[k.name] !== undefined
        ? Number(saved.values[k.name])
        : (k.default ?? min);
    current = clamp(snap(current, min, max, step), min, max);

    function commit(v, send, onView) {
      current = clamp(snap(v, min, max, step), min, max);
      saved.values[k.name] = current;
      vscode.setState(saved);
      if (onView) onView(current);
      if (send) {
        vscode.postMessage({ type: 'knob', name: k.name, value: current });
      }
      return current;
    }

    return {
      get current() {
        return current;
      },
      commit,
    };
  }

  function makeSectionDivider(label) {
    const el = document.createElement('div');
    el.className = 'ctrl-section';
    const head = document.createElement('div');
    head.className = 'ctrl-section-head';
    head.textContent = label;
    const rule = document.createElement('div');
    rule.className = 'ctrl-section-rule';
    el.appendChild(head);
    el.appendChild(rule);
    return el;
  }

  function makeBang(k) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const name = document.createElement('div');
    name.className = 'cell-name';
    name.textContent = shortName(k.name);
    const btn = document.createElement('button');
    btn.className = 'bang';
    btn.type = 'button';
    btn.textContent = shortName(k.name);
    btn.title = k.name;
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'button', name: k.name });
    });
    cell.appendChild(name);
    cell.appendChild(btn);
    return cell;
  }

  function makeDial(k) {
    const min = k.min ?? 0;
    const max = k.max ?? 1;
    const step = k.step ?? 0.01;
    const state = bindValue(k, min, max, step);

    const cell = document.createElement('div');
    cell.className = 'cell';
    const name = document.createElement('div');
    name.className = 'cell-name';
    name.textContent = shortName(k.name);
    name.title = k.name;

    const dial = document.createElement('div');
    dial.className = 'dial';
    dial.tabIndex = 0;
    const pointer = document.createElement('div');
    pointer.className = 'dial-pointer';
    dial.appendChild(pointer);

    const val = document.createElement('div');
    val.className = 'cell-value';

    function paint(v) {
      pointer.style.transform =
        'rotate(' + normToAngle(norm(v, min, max)) + 'deg)';
      val.textContent = fmt(v);
    }

    paint(state.commit(state.current, false, paint));

    let dragging = false;
    let startY = 0;
    let startVal = 0;
    dial.addEventListener('pointerdown', (e) => {
      dragging = true;
      dial.classList.add('active');
      dial.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startVal = state.current;
      e.preventDefault();
    });
    dial.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      state.commit(startVal + ((startY - e.clientY) / 120) * (max - min), true, paint);
    });
    dial.addEventListener('pointerup', () => {
      dragging = false;
      dial.classList.remove('active');
    });
    dial.addEventListener('pointercancel', () => {
      dragging = false;
      dial.classList.remove('active');
    });
    dial.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        state.commit(state.current + (e.deltaY < 0 ? 1 : -1) * step, true, paint);
      },
      { passive: false }
    );
    dial.addEventListener('dblclick', () => {
      state.commit(k.default ?? min, true, paint);
    });

    cell.appendChild(name);
    cell.appendChild(dial);
    cell.appendChild(val);
    return cell;
  }

  function makeSlider(k) {
    const min = k.min ?? 0;
    const max = k.max ?? 1;
    const step = k.step ?? 0.01;
    const state = bindValue(k, min, max, step);

    const cell = document.createElement('div');
    cell.className = 'cell cell-slider';
    const head = document.createElement('div');
    head.className = 'slider-head';
    const name = document.createElement('span');
    name.className = 'cell-name';
    name.textContent = shortName(k.name);
    name.title = k.name;
    const val = document.createElement('span');
    val.className = 'cell-value';
    head.appendChild(name);
    head.appendChild(val);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);

    function paint(v) {
      input.value = String(v);
      val.textContent = fmt(v);
    }

    paint(state.commit(state.current, false, paint));
    input.addEventListener('input', () => {
      state.commit(Number(input.value), true, paint);
    });
    input.addEventListener('dblclick', () => {
      state.commit(k.default ?? min, true, paint);
    });
    cell.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const mul = e.shiftKey ? 10 : 1;
        state.commit(
          state.current + (e.deltaY < 0 ? 1 : -1) * step * mul,
          true,
          paint
        );
      },
      { passive: false }
    );

    cell.appendChild(head);
    cell.appendChild(input);
    return cell;
  }

  function shortName(n) {
    if (n === 'live_bpm') return 'BPM';
    // saw_cutoff → cutoff; master_amp → amp
    const parts = String(n).split('_');
    return parts.length > 1 ? parts.slice(1).join('_') : n;
  }

  /** Update a dial/slider display without sending OSC (host mirror). */
  function applyKnobValue(name, value) {
    saved.values[name] = value;
    vscode.setState(saved);
    if (!caseEl) return;
    for (const cell of caseEl.querySelectorAll('.cell')) {
      const title = cell.querySelector('.cell-name');
      if (!title || title.title !== name) continue;
      const dial = cell.querySelector('.dial');
      const slider = cell.querySelector('input[type="range"]');
      const valEl = cell.querySelector('.cell-value');
      if (dial) {
        const min = 40;
        const max = 200;
        const pointer = dial.querySelector('.dial-pointer');
        if (pointer) {
          pointer.style.transform =
            'rotate(' + normToAngle(norm(value, min, max)) + 'deg)';
        }
        if (valEl) valEl.textContent = fmt(value);
      } else if (slider && valEl) {
        slider.value = String(value);
        valEl.textContent = fmt(value);
      }
      break;
    }
  }

  function norm(v, min, max) {
    if (max === min) return 0;
    return (v - min) / (max - min);
  }

  function normToAngle(t) {
    return ANGLE_MIN + t * (ANGLE_MAX - ANGLE_MIN);
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function snap(v, min, max, step) {
    if (!step || step <= 0) return v;
    const n = Math.round((v - min) / step) * step + min;
    const decimals = String(step).includes('.')
      ? String(step).split('.')[1].length
      : 0;
    return Number(n.toFixed(Math.min(6, decimals + 2)));
  }

  function fmt(n) {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(3).replace(/\.?0+$/, '') || '0';
  }
})();
