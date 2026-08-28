(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const saved = vscode.getState() || { collapsed: {}, pendingSrc: null };

  let model = { vmUp: false, sources: [], modules: [] };
  let pendingSrc = saved.pendingSrc || null;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setMatrix') {
      model = msg.model || model;
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });

  function render() {
    if (!root) return;
    root.innerHTML = '';

    if (!model.vmUp) {
      root.appendChild(el('p', 'empty', 'Start the VM to use the mod matrix.'));
      return;
    }

    if (!model.modules.length) {
      root.appendChild(
        el(
          'p',
          'empty',
          'Add // @modSource and // @modTarget annotations to your .ck files, then load them as shreds.'
        )
      );
      return;
    }

    for (const mod of model.modules) {
      root.appendChild(makeModule(mod));
    }
  }

  function makeModule(mod) {
    const wrap = el('div', 'mod-block');
    const head = el('button', 'mod-head');
    const collapsed = !!saved.collapsed[mod.file];
    head.type = 'button';
    head.textContent = stripExt(mod.title);
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    head.addEventListener('click', () => {
      saved.collapsed[mod.file] = !saved.collapsed[mod.file];
      vscode.setState(saved);
      render();
    });
    wrap.appendChild(head);

    const body = el('div', 'mod-body' + (collapsed ? ' collapsed' : ''));
    const grid = el('div', 'matrix-grid');

    const srcCol = el('div', 'col sources');
    srcCol.appendChild(el('div', 'col-title', 'SOURCES'));
    const allSources = model.sources || [];
    for (const s of allSources) {
      const local = mod.sources.some((x) => x.name === s.name);
      const jack = el(
        'button',
        'jack source' +
          (pendingSrc === s.name ? ' active' : '') +
          (local ? '' : ' foreign')
      );
      jack.type = 'button';
      jack.textContent = s.label + (local ? '' : ' · ext');
      jack.title = s.name;
      jack.addEventListener('click', () => {
        pendingSrc = pendingSrc === s.name ? null : s.name;
        saved.pendingSrc = pendingSrc;
        vscode.setState(saved);
        render();
      });
      srcCol.appendChild(jack);
    }
    if (!allSources.length) {
      srcCol.appendChild(el('div', 'muted', '—'));
    }

    const cableCol = el('div', 'col cables');
    cableCol.appendChild(el('div', 'col-title', 'PATCH'));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cable-svg');
    cableCol.appendChild(svg);

    const dstCol = el('div', 'col destinations');
    dstCol.appendChild(el('div', 'col-title', 'DESTINATIONS'));
    for (const d of mod.targets) {
      const row = el('div', 'dst-row');
      const route = (mod.routes || []).find((r) => r.dst === d.modName);
      const defRoute = (mod.defaults || []).find(
        (r) => r.dstLabel.toLowerCase() === d.label.toLowerCase()
      );
      const jack = el(
        'button',
        'jack dest' + (route ? ' patched' : defRoute ? ' default' : '')
      );
      jack.type = 'button';
      jack.textContent = d.label;
      jack.title = d.modName;
      jack.addEventListener('click', () => {
        if (pendingSrc) {
          const idx = sourceIndex(pendingSrc);
          if (!idx) return;
          vscode.postMessage({
            type: 'connect',
            moduleFile: mod.file,
            dst: d.modName,
            src: pendingSrc,
            srcIndex: idx,
            depth: route ? route.depth : defRoute ? defRoute.depth : 0.5,
          });
          pendingSrc = null;
          saved.pendingSrc = null;
          vscode.setState(saved);
        } else if (route && !route.isDefault) {
          vscode.postMessage({ type: 'disconnect', dst: d.modName });
        }
      });
      row.appendChild(jack);

      const depth = el('input', 'depth');
      depth.type = 'range';
      depth.min = '0';
      depth.max = '1';
      depth.step = '0.01';
      depth.value = String(route ? route.depth : defRoute ? defRoute.depth : 0.5);
      depth.disabled = !(route || defRoute);
      depth.addEventListener('input', () => {
        vscode.postMessage({
          type: 'setDepth',
          moduleFile: mod.file,
          dst: d.modName,
          src: route ? route.src : defRoute ? labelToSrc(mod, defRoute.srcLabel) : '',
          depth: Number(depth.value),
        });
      });
      row.appendChild(depth);

      const label = el('span', 'depth-val', depth.value);
      depth.addEventListener('input', () => {
        label.textContent = Number(depth.value).toFixed(2);
      });
      row.appendChild(label);

      dstCol.appendChild(row);
    }

    grid.appendChild(srcCol);
    grid.appendChild(cableCol);
    grid.appendChild(dstCol);
    body.appendChild(grid);
    wrap.appendChild(body);

    requestAnimationFrame(() => drawCables(svg, mod, srcCol, dstCol));
    return wrap;
  }

  function sourceIndex(name) {
    const s = (model.sources || []).find((x) => x.name === name);
    return s && s.index ? s.index : 0;
  }

  function drawCables(svg, mod, srcCol, dstCol) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const sr = svg.getBoundingClientRect();
    if (!sr.width) return;

    const routes = mod.routes || [];
    const srcBtns = [...srcCol.querySelectorAll('.jack.source')];
    const dstRows = [...dstCol.querySelectorAll('.dst-row')];

    for (const route of routes) {
      const src = (model.sources || []).find((s) => s.name === route.src);
      const dst = mod.targets.find((t) => t.modName === route.dst);
      if (!src || !dst) continue;

      const srcBtn = srcBtns.find((b) => b.title === src.name);
      const dstRow = dstRows.find((r) => {
        const btn = r.querySelector('.jack.dest');
        return btn && btn.title === dst.modName;
      });
      if (!srcBtn || !dstRow) continue;

      const sBox = srcBtn.getBoundingClientRect();
      const dBox = dstRow.querySelector('.jack.dest').getBoundingClientRect();
      const x1 = sBox.right - sr.left;
      const y1 = sBox.top + sBox.height / 2 - sr.top;
      const x2 = dBox.left - sr.left;
      const y2 = dBox.top + dBox.height / 2 - sr.top;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const cx = (x1 + x2) / 2;
      path.setAttribute(
        'd',
        `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`
      );
      path.setAttribute('class', 'cable' + (route.isDefault ? ' default' : ''));
      svg.appendChild(path);
    }

    svg.setAttribute('width', String(sr.width));
    svg.setAttribute('height', String(sr.height));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function stripExt(name) {
    return String(name).replace(/\.ck$/i, '');
  }

  /** Resolve @modRoute srcLabel → global source name for depth tweaks on factory routes. */
  function labelToSrc(mod, label) {
    const key = String(label || '').toLowerCase();
    const local = (mod.sources || []).find(
      (s) => String(s.label || '').toLowerCase() === key
    );
    if (local) return local.name;
    const global = (model.sources || []).find(
      (s) => String(s.label || '').toLowerCase() === key
    );
    return global ? global.name : '';
  }
})();
