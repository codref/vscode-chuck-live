(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  /** Remember last values across refreshes. */
  const saved = vscode.getState() || { values: {} };

  // Travel angle: -135° … +135° (270° sweep)
  const ANGLE_MIN = -135;
  const ANGLE_MAX = 135;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setKnobs') {
      render(msg.groups || []);
    }
  });

  vscode.postMessage({ type: 'ready' });

  function render(groups) {
    if (!root) return;
    root.innerHTML = '';

    const total = groups.reduce((n, g) => n + (g.knobs || []).length, 0);
    if (!total) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No annotations in the current .ck file.';
      root.appendChild(p);
      return;
    }

    for (const g of groups) {
      if (!g.knobs || !g.knobs.length) continue;

      const grid = document.createElement('div');
      grid.className = 'grid';

      for (const k of g.knobs) {
        if (k.kind === 'button') {
          grid.appendChild(makeBang(k));
        } else if ((k.ui || 'dial') === 'slider') {
          grid.appendChild(makeSlider(k));
        } else {
          grid.appendChild(makeDial(k));
        }
      }

      root.appendChild(grid);
    }
  }

  function makeBang(k) {
    const cell = document.createElement('div');
    cell.className = 'cell cell-bang';

    const name = document.createElement('div');
    name.className = 'cell-name';
    name.textContent = k.name;

    const btn = document.createElement('button');
    btn.className = 'bang';
    btn.type = 'button';
    btn.textContent = buttonLabel(k.name);
    btn.title = k.name;
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'button', name: k.name });
    });

    const val = document.createElement('div');
    val.className = 'cell-value';
    val.textContent = '·';

    cell.appendChild(name);
    cell.appendChild(btn);
    cell.appendChild(val);
    return cell;
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

  function makeDial(k) {
    const min = k.min ?? 0;
    const max = k.max ?? 1;
    const step = k.step ?? 0.01;
    const state = bindValue(k, min, max, step);

    const cell = document.createElement('div');
    cell.className = 'cell';

    const name = document.createElement('div');
    name.className = 'cell-name';
    name.textContent = k.name;
    name.title = k.name;

    const dial = document.createElement('div');
    dial.className = 'dial';
    dial.tabIndex = 0;
    dial.setAttribute('role', 'slider');
    dial.setAttribute('aria-valuemin', String(min));
    dial.setAttribute('aria-valuemax', String(max));
    dial.setAttribute('aria-label', k.name);

    const pointer = document.createElement('div');
    pointer.className = 'dial-pointer';
    dial.appendChild(pointer);

    const val = document.createElement('div');
    val.className = 'cell-value';

    function paint(v) {
      pointer.style.transform = `rotate(${normToAngle(norm(v, min, max))}deg)`;
      val.textContent = fmt(v);
      dial.setAttribute('aria-valuenow', String(v));
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
      const dy = startY - e.clientY;
      const range = max - min;
      state.commit(startVal + (dy / 120) * range, true, paint);
    });
    dial.addEventListener('pointerup', () => {
      dragging = false;
      dial.classList.remove('active');
    });
    dial.addEventListener('pointercancel', () => {
      dragging = false;
      dial.classList.remove('active');
    });

    dial.addEventListener('keydown', (e) => {
      const big = e.shiftKey ? step * 10 : step;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        state.commit(state.current + big, true, paint);
        e.preventDefault();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        state.commit(state.current - big, true, paint);
        e.preventDefault();
      } else if (e.key === 'Home') {
        state.commit(min, true, paint);
        e.preventDefault();
      } else if (e.key === 'End') {
        state.commit(max, true, paint);
        e.preventDefault();
      }
    });
    dial.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        state.commit(state.current + dir * step, true, paint);
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
    name.textContent = k.name;
    const val = document.createElement('span');
    val.className = 'cell-value';
    head.appendChild(name);
    head.appendChild(val);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', k.name);

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

    cell.appendChild(head);
    cell.appendChild(input);
    return cell;
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

  /** Button caption = event name (not a generic "BANG"). */
  function buttonLabel(name) {
    const s = String(name || 'go');
    return s.length > 12 ? s.slice(0, 11) + '…' : s;
  }
})();
