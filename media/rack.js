(function () {
  const vscode = acquireVsCodeApi();
  const caseEl = document.getElementById('case');
  const saved = vscode.getState() || { values: {} };

  const ANGLE_MIN = -135;
  const ANGLE_MAX = 135;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setRack') {
      render(msg.modules || []);
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

  function makeModule(mod) {
    const el = document.createElement('div');
    el.className = 'module' + (mod.isMaster ? ' master' : '');

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
    id.textContent = '#' + mod.id + (mod.isMaster ? ' · MASTER' : '');
    head.appendChild(title);
    head.appendChild(id);

    const controls = document.createElement('div');
    controls.className = 'controls';

    const knobs = mod.knobs || [];
    if (!knobs.length) {
      const none = document.createElement('div');
      none.className = 'cell-value';
      none.style.opacity = '0.5';
      none.textContent = 'no knobs';
      controls.appendChild(none);
    } else {
      for (const k of knobs) {
        if (k.kind === 'button') {
          controls.appendChild(makeBang(k));
        } else if ((k.ui || 'dial') === 'slider') {
          controls.appendChild(makeSlider(k));
        } else {
          controls.appendChild(makeDial(k));
        }
      }
    }

    el.appendChild(accent);
    el.appendChild(head);
    el.appendChild(controls);
    return el;
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

  function makeBang(k) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const name = document.createElement('div');
    name.className = 'cell-name';
    name.textContent = shortName(k.name);
    const btn = document.createElement('button');
    btn.className = 'bang';
    btn.type = 'button';
    btn.textContent = 'BANG';
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

    cell.appendChild(head);
    cell.appendChild(input);
    return cell;
  }

  function shortName(n) {
    // saw_cutoff → cutoff; master_amp → amp
    const parts = String(n).split('_');
    return parts.length > 1 ? parts.slice(1).join('_') : n;
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
