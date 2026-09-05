(function () {
  const vscode = acquireVsCodeApi();
  const caseEl = document.getElementById('case');
  const saved = vscode.getState() || { values: {}, presetSel: {} };
  if (!saved.presetSel) saved.presetSel = {};

  /** moduleFile → preset name list (from extension). */
  let presetLists = {};

  const ANGLE_MIN = -135;
  const ANGLE_MAX = 135;

  const DB_MIN = -60;
  const LED_HOT_DB = -6;
  const LED_CLIP_DB = -0.1;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setRack') {
      presetLists = msg.presetLists || {};
      render(msg.modules || []);
    } else if (msg.type === 'setKnob' && msg.name !== undefined && msg.value !== undefined) {
      applyKnobValue(msg.name, Number(msg.value), false);
    } else if (msg.type === 'vu') {
      paintMasterVu(Number(msg.l) || 0, Number(msg.r) || 0);
    } else if (msg.type === 'resetMeter') {
      resetMeterUi();
    } else if (msg.type === 'knobPresets' && msg.moduleFile) {
      presetLists[msg.moduleFile] = msg.names || [];
      refreshPresetDropdown(msg.moduleFile);
    } else if (msg.type === 'knobPresetSaved' && msg.moduleFile && msg.name) {
      saved.presetSel[msg.moduleFile] = msg.name;
      vscode.setState(saved);
      refreshPresetDropdown(msg.moduleFile, msg.name);
    } else if (msg.type === 'knobPresetDeleted' && msg.moduleFile) {
      if (saved.presetSel[msg.moduleFile] === msg.name) {
        delete saved.presetSel[msg.moduleFile];
        vscode.setState(saved);
      }
      refreshPresetDropdown(msg.moduleFile, '');
    } else if (msg.type === 'applyKnobPreset' && msg.moduleFile && msg.values) {
      if (msg.name) {
        saved.presetSel[msg.moduleFile] = msg.name;
        vscode.setState(saved);
        refreshPresetDropdown(msg.moduleFile, msg.name);
      }
      applyModulePreset(msg.moduleFile, msg.values, false);
    }
  });

  vscode.postMessage({ type: 'ready' });

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

  function hasKnobControls(mod) {
    return (mod.knobs || []).some(
      (k) => k.kind === 'knob' && (k.type === 'float' || k.type === 'int')
    );
  }

  function makeModule(mod) {
    const el = document.createElement('div');
    el.className =
      'module' +
      (mod.isMaster ? ' master' : '') +
      (mod.isTransport ? ' transport' : '');
    el.dataset.moduleFile = mod.file || '';
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
    el.appendChild(head);
    if (!mod.isTransport && hasKnobControls(mod)) {
      el.appendChild(makePresetBar(mod));
    }
    el.appendChild(controls);
    if (mod.isMaster) {
      el.appendChild(makeMasterMeter());
    }
    return el;
  }

  function makePresetBar(mod) {
    const bar = document.createElement('div');
    bar.className = 'mod-presets';
    bar.dataset.moduleFile = mod.file;

    const sel = document.createElement('select');
    sel.className = 'preset-select';
    sel.title = 'Load knob preset';
    populatePresetOptions(sel, mod.file, saved.presetSel[mod.file] || '');

    sel.addEventListener('change', () => {
      const name = sel.value;
      if (!name) {
        delete saved.presetSel[mod.file];
        vscode.setState(saved);
        syncPresetButtons(bar, '');
        return;
      }
      saved.presetSel[mod.file] = name;
      vscode.setState(saved);
      syncPresetButtons(bar, name);
      vscode.postMessage({
        type: 'loadKnobPreset',
        moduleFile: mod.file,
        name,
      });
    });

    const btns = document.createElement('div');
    btns.className = 'preset-btns';

    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'preset-btn';
    btnSave.textContent = 'Save';
    btnSave.title = 'Save current knobs as new preset';
    btnSave.addEventListener('click', () => {
      vscode.postMessage({
        type: 'requestSaveKnobPreset',
        moduleFile: mod.file,
        values: collectModuleValues(mod),
      });
    });

    const btnUpdate = document.createElement('button');
    btnUpdate.type = 'button';
    btnUpdate.className = 'preset-btn preset-btn-update';
    btnUpdate.textContent = 'Update';
    btnUpdate.title = 'Overwrite selected preset with current knobs';
    btnUpdate.addEventListener('click', () => {
      const name = sel.value;
      if (!name) return;
      vscode.postMessage({
        type: 'updateKnobPreset',
        moduleFile: mod.file,
        name,
        values: collectModuleValues(mod),
      });
    });

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'preset-btn preset-btn-delete';
    btnDelete.textContent = 'Delete';
    btnDelete.title = 'Delete selected preset';
    btnDelete.addEventListener('click', () => {
      const name = sel.value;
      if (!name) return;
      vscode.postMessage({
        type: 'deleteKnobPreset',
        moduleFile: mod.file,
        name,
      });
    });

    const btnRestore = document.createElement('button');
    btnRestore.type = 'button';
    btnRestore.className = 'preset-btn preset-btn-restore';
    btnRestore.textContent = 'Restore';
    btnRestore.title = 'Re-apply selected preset from disk';
    btnRestore.addEventListener('click', () => {
      const name = sel.value;
      if (!name) return;
      vscode.postMessage({
        type: 'loadKnobPreset',
        moduleFile: mod.file,
        name,
      });
    });

    btns.appendChild(btnSave);
    btns.appendChild(btnUpdate);
    btns.appendChild(btnDelete);
    btns.appendChild(btnRestore);

    bar.appendChild(sel);
    bar.appendChild(btns);
    syncPresetButtons(bar, sel.value);
    return bar;
  }

  function populatePresetOptions(sel, moduleFile, selected) {
    const names = presetLists[moduleFile] || [];
    sel.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '— preset —';
    sel.appendChild(empty);
    for (const name of names) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      if (name === selected) o.selected = true;
      sel.appendChild(o);
    }
  }

  function findModuleEl(moduleFile) {
    if (!caseEl) return null;
    for (const el of caseEl.querySelectorAll('.module[data-module-file]')) {
      if (el.dataset.moduleFile === moduleFile) return el;
    }
    return null;
  }

  function refreshPresetDropdown(moduleFile, selected) {
    const modEl = findModuleEl(moduleFile);
    const bar = modEl && modEl.querySelector('.mod-presets');
    if (!bar) return;
    const sel = bar.querySelector('.preset-select');
    if (!sel) return;
    const selName =
      selected !== undefined ? selected : saved.presetSel[moduleFile] || sel.value;
    populatePresetOptions(sel, moduleFile, selName);
    syncPresetButtons(bar, sel.value);
  }

  function syncPresetButtons(bar, selected) {
    const has = !!selected;
    for (const btn of bar.querySelectorAll(
      '.preset-btn-update, .preset-btn-delete, .preset-btn-restore'
    )) {
      btn.disabled = !has;
    }
  }

  function collectModuleValues(mod) {
    const values = {};
    for (const k of mod.knobs || []) {
      if (k.kind !== 'knob' || (k.type !== 'float' && k.type !== 'int')) {
        continue;
      }
      const min = k.min ?? 0;
      values[k.name] =
        saved.values[k.name] !== undefined
          ? Number(saved.values[k.name])
          : (k.default ?? min);
    }
    return values;
  }

  function applyModulePreset(moduleFile, values, sendOsc) {
    for (const [name, value] of Object.entries(values)) {
      applyKnobValue(name, Number(value), sendOsc, moduleFile);
    }
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
    masterHold.L = DB_MIN;
    masterHold.R = DB_MIN;
    paintMasterVu(0, 0);
    if (!caseEl) return;
    for (const led of caseEl.querySelectorAll('.mod-meter-led')) {
      led.classList.remove('on', 'clip');
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
      min,
      max,
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
    cell.dataset.knobName = k.name;
    cell.dataset.min = String(min);
    cell.dataset.max = String(max);
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
    cell._knobApply = (v) => state.commit(v, false, paint);

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
    cell.dataset.knobName = k.name;
    cell.dataset.min = String(min);
    cell.dataset.max = String(max);
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
    cell._knobApply = (v) => state.commit(v, false, paint);
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
    const parts = String(n).split('_');
    return parts.length > 1 ? parts.slice(1).join('_') : n;
  }

  function paintKnobCell(cell, value) {
    if (typeof cell._knobApply === 'function') {
      cell._knobApply(value);
      return;
    }
    const min = Number(cell.dataset.min) || 0;
    const max = Number(cell.dataset.max) || 1;
    const dial = cell.querySelector('.dial');
    const slider = cell.querySelector('input[type="range"]');
    const valEl = cell.querySelector('.cell-value');
    if (dial) {
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
  }

  /** Update dial/slider display; optionally send OSC. */
  function applyKnobValue(name, value, sendOsc, moduleFile) {
    saved.values[name] = value;
    vscode.setState(saved);
    if (!caseEl) return;
    const scope = moduleFile ? findModuleEl(moduleFile) : caseEl;
    if (!scope) return;
    for (const cell of scope.querySelectorAll('.cell[data-knob-name]')) {
      if (cell.dataset.knobName !== name) continue;
      paintKnobCell(cell, value);
      break;
    }
    if (sendOsc) {
      vscode.postMessage({ type: 'knob', name, value });
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
