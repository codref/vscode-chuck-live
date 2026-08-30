(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const saved = vscode.getState() || {};

  let model = { vmUp: false, sources: [], modules: [] };
  /** @type {{ dst: string, src: string } | null} */
  let selected = saved.selected || null;
  let scope = saved.scope || 'all';
  let bypassed = !!saved.bypassed;
  /** @type {string | null} */
  let flashKey = null;
  let flashTimer = null;

  if (!saved.userRoutes) saved.userRoutes = {};

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'setMatrix') {
      model = msg.model || model;
      hydrateUserRoutes(msg.persistedRoutes);
      syncUserRoutesFromModel();
      pruneSelection();
      render();
    }
    if (msg.type === 'routePatched' && msg.dst && msg.src) {
      rememberUserRoute(msg.dst, msg.src, msg.depth);
      selected = { dst: msg.dst, src: msg.src };
      saved.selected = selected;
      vscode.setState(saved);
      markFlash(msg.dst, msg.src);
      render();
    }
    if (msg.type === 'routeCleared' && msg.dst) {
      forgetUserRoute(msg.dst);
      if (selected && selected.dst === msg.dst) {
        selected = null;
        saved.selected = null;
        vscode.setState(saved);
      }
      render();
    }
  });

  window.addEventListener('keydown', onKeyDown);

  vscode.postMessage({ type: 'ready' });

  const depthPostTimers = {};
  function scheduleDepthPost(moduleFile, dst, src, depth) {
    if (bypassed) return;
    if (depthPostTimers[dst]) clearTimeout(depthPostTimers[dst]);
    depthPostTimers[dst] = setTimeout(() => {
      delete depthPostTimers[dst];
      vscode.postMessage({
        type: 'setDepth',
        moduleFile: moduleFile,
        dst: dst,
        src: src,
        depth: depth,
      });
    }, 16);
  }

  function postConnect(moduleFile, dst, src, srcIndex, depth) {
    if (bypassed) return;
    vscode.postMessage({
      type: 'connect',
      moduleFile: moduleFile,
      dst: dst,
      src: src,
      srcIndex: srcIndex,
      depth: depth,
    });
  }

  function postDisconnect(dst) {
    if (bypassed) return;
    vscode.postMessage({ type: 'disconnect', dst: dst });
  }

  function allDestinations() {
    const rows = [];
    for (const mod of model.modules || []) {
      for (const t of mod.targets || []) {
        rows.push({
          mod: mod,
          target: t,
          rowLabel: stripExt(mod.title) + ' · ' + t.label,
        });
      }
    }
    return rows;
  }

  function moduleOptions() {
    const opts = [];
    const seen = new Set();
    for (const mod of model.modules || []) {
      const key = normalizeModKey(mod.file);
      if (seen.has(key)) continue;
      seen.add(key);
      opts.push({ key: key, title: stripExt(mod.title), file: mod.file });
    }
    return opts;
  }

  function filterSources(allSrc, dests) {
    if (scope === 'all') return allSrc;
    if (scope === 'cross') {
      // Keep all sources; cross filter applies per-cell (dim same-module).
      return allSrc;
    }
    return allSrc.filter((s) => normalizeModKey(ownerFile(s)) === scope);
  }

  function filterDests(dests) {
    if (scope === 'all' || scope === 'cross') return dests;
    return dests.filter((d) => normalizeModKey(d.mod.file) === scope);
  }

  function render() {
    if (!root) return;
    root.innerHTML = '';

    if (!model.vmUp) {
      root.appendChild(
        el('p', 'empty', 'Start the VM to use the mod matrix.')
      );
      return;
    }

    const allSrc = model.sources || [];
    const allDests = allDestinations();

    if (!allSrc.length && !allDests.length) {
      root.appendChild(
        el(
          'p',
          'empty',
          'Add // @modSource and // @modTarget annotations to your .ck files, then load them as shreds.'
        )
      );
      return;
    }

    if (!allSrc.length) {
      root.appendChild(
        el(
          'p',
          'empty',
          'No modulation sources. Add // @modSource on a float global (e.g. LFO out).'
        )
      );
      return;
    }

    if (!allDests.length) {
      root.appendChild(
        el(
          'p',
          'empty',
          'No modulation destinations. Add // @modTarget on a float global (e.g. filter cutoff).'
        )
      );
      return;
    }

    const sources = filterSources(allSrc, allDests);
    const dests = filterDests(allDests);

    root.appendChild(makeToolbar(allSrc, allDests, sources, dests));

    const hint = el('div', 'hint-bar');
    hint.textContent = bypassed
      ? 'Bypassed — routes kept locally, OSC muted. Toggle Bypass to hear patches again.'
      : 'Click empty cell to patch · click lit cell to select · click selected again or Clear to remove · [ ] nudge depth · Esc deselect';
    if (bypassed) hint.classList.add('warn');
    root.appendChild(hint);

    if (!sources.length || !dests.length) {
      root.appendChild(
        el('p', 'empty', 'No cells match this filter. Switch Scope to All.')
      );
      root.appendChild(makeDepthFooter(allDests));
      root.appendChild(
        el(
          'div',
          'kbd-hint',
          'Keys: arrows move · Enter patch/select · Backspace/Delete clear · [ ] depth · Esc deselect'
        )
      );
      return;
    }

    const scroll = el('div', 'matrix-scroll');
    const table = el('div', 'matrix-table' + (bypassed ? ' bypassed' : ''));
    table.style.gridTemplateColumns =
      'minmax(120px, 170px) repeat(' + sources.length + ', 30px)';

    table.appendChild(el('div', 'corner'));

    let prevSrcOwner = '';
    for (const s of sources) {
      const owner = sourceOwnerTitle(s);
      const accent = moduleAccent(owner);
      const head = el('div', 'col-head', sourceColumnLabel(s));
      if (prevSrcOwner && owner !== prevSrcOwner) head.classList.add('mod-sep');
      head.style.setProperty('--mod-accent', accent);
      head.title = sourceTooltip(s);
      table.appendChild(head);
      prevSrcOwner = owner;
    }

    let prevRowOwner = '';
    for (const row of dests) {
      const rowOwner = stripExt(row.mod.title);
      const rowAccent = moduleAccent(rowOwner);
      const rh = el('div', 'row-head');
      if (prevRowOwner && rowOwner !== prevRowOwner) rh.classList.add('mod-sep');
      rh.style.setProperty('--mod-accent', rowAccent);
      rh.title =
        row.rowLabel +
        '\n' +
        row.target.modName +
        (row.target.unit ? ' · ' + row.target.unit : '') +
        '\nMatrix overrides this destination’s internal mod while patched.';
      const modSpan = document.createElement('span');
      modSpan.className = 'mod';
      modSpan.textContent = rowOwner + ' ·';
      rh.appendChild(modSpan);
      rh.appendChild(document.createTextNode(row.target.label));
      table.appendChild(rh);
      prevRowOwner = rowOwner;

      const route = effectiveRoute(row.mod, row.target);
      const defRoute = (row.mod.defaults || []).find(
        (r) => r.dstLabel.toLowerCase() === row.target.label.toLowerCase()
      );
      const defSrc = defRoute ? labelToSrc(row.mod, defRoute.srcLabel) : '';

      let prevCellOwner = '';
      for (const s of sources) {
        const srcOwner = sourceOwnerTitle(s);
        const isUser = route && !route.isDefault && route.src === s.name;
        const isDefault =
          (!route || route.isDefault) &&
          ((route && route.src === s.name) || (!route && defSrc === s.name));
        const isOn = !!(isUser || isDefault);
        const isSelected =
          selected &&
          selected.dst === row.target.modName &&
          selected.src === s.name;
        const crossDim =
          scope === 'cross' &&
          normalizeModKey(ownerFile(s)) === normalizeModKey(row.mod.file);

        let cls = 'cell';
        if (isUser) cls += ' on';
        if (isDefault) cls += ' default' + (isOn ? ' on' : '');
        if (isSelected) cls += ' selected';
        if (prevCellOwner && srcOwner !== prevCellOwner) cls += ' mod-sep-col';
        if (flashKey === row.target.modName + '|' + s.name) cls += ' flash';

        const depthVal = isUser
          ? route.depth
          : isDefault
            ? route
              ? route.depth
              : defRoute
                ? defRoute.depth
                : 0.5
            : 0;

        const btn = el('button', cls);
        btn.type = 'button';
        btn.dataset.src = s.name;
        btn.dataset.dst = row.target.modName;
        btn.style.setProperty('--mod-accent', moduleAccent(srcOwner));
        if (crossDim) btn.style.opacity = '0.28';
        btn.title = cellTooltip(s, row, isUser, isDefault, depthVal);
        const dot = el('span', 'dot');
        if (isOn) {
          const d = Number.isFinite(depthVal) ? Math.max(0, Math.min(1, depthVal)) : 0.5;
          dot.style.setProperty('--depth', String(d));
        }
        btn.appendChild(dot);
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (bypassed) {
            flashHint('Bypass is on — disable Bypass to edit routes.', true);
            return;
          }
          onCellClick(row, s, route, defRoute, isUser);
        });
        table.appendChild(btn);
        prevCellOwner = srcOwner;
      }
    }

    scroll.appendChild(table);
    root.appendChild(scroll);
    root.appendChild(makeDepthFooter(allDests));
    root.appendChild(
      el(
        'div',
        'kbd-hint',
        'Keys: arrows move · Enter patch/select · Backspace/Delete clear · [ ] depth · Esc deselect'
      )
    );
  }

  function makeToolbar(allSrc, allDests, sources, dests) {
    const bar = el('div', 'toolbar');
    const nRoutes = Object.keys(saved.userRoutes || {}).length;
    const status = el('div', 'status-strip');
    const bits = [];
    bits.push('<strong>' + nRoutes + '</strong> route' + (nRoutes === 1 ? '' : 's'));
    bits.push(sources.length + '×' + dests.length + ' cells');
    if (bypassed) bits.push('<strong>bypassed</strong>');
    else if (selected) bits.push('depth ready');
    else bits.push('select a lit cell for depth');
    status.innerHTML = bits.join(' · ');
    bar.appendChild(status);

    const actions = el('div', 'toolbar-actions');

    const scopeSel = document.createElement('select');
    scopeSel.title = 'Filter which sources/destinations are shown';
    const addOpt = (value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      if (scope === value) o.selected = true;
      scopeSel.appendChild(o);
    };
    addOpt('all', 'Scope: All');
    addOpt('cross', 'Scope: Cross-module');
    for (const m of moduleOptions()) {
      addOpt(m.key, 'Scope: ' + m.title);
    }
    scopeSel.addEventListener('change', () => {
      scope = scopeSel.value;
      saved.scope = scope;
      vscode.setState(saved);
      render();
    });
    actions.appendChild(scopeSel);

    const btnBypass = document.createElement('button');
    btnBypass.type = 'button';
    btnBypass.textContent = bypassed ? 'Bypass ON' : 'Bypass';
    btnBypass.className = bypassed ? 'active' : '';
    btnBypass.title =
      'Mute OSC while keeping local routes (A/B compare). Does not change saved patches.';
    btnBypass.addEventListener('click', () => toggleBypass());
    actions.appendChild(btnBypass);

    bar.appendChild(actions);
    return bar;
  }

  function toggleBypass() {
    if (!bypassed) {
      // Mute live routes in the VM; keep local userRoutes.
      const routes = { ...(saved.userRoutes || {}) };
      for (const dst of Object.keys(routes)) {
        vscode.postMessage({ type: 'disconnect', dst: dst });
      }
      bypassed = true;
      saved.bypassed = true;
      vscode.setState(saved);
      flashHint('Matrix bypassed — sound uses patch-internal mods.', false);
    } else {
      bypassed = false;
      saved.bypassed = false;
      vscode.setState(saved);
      // Re-apply local routes.
      for (const [dst, r] of Object.entries(saved.userRoutes || {})) {
        const idx = sourceIndex(r.src);
        if (!idx) continue;
        const row = allDestinations().find((d) => d.target.modName === dst);
        if (!row) continue;
        vscode.postMessage({
          type: 'connect',
          moduleFile: row.mod.file,
          dst: dst,
          src: r.src,
          srcIndex: idx,
          depth: r.depth,
        });
      }
      flashHint('Bypass off — routes restored.', false);
    }
    render();
  }

  function onCellClick(row, src, route, defRoute, isUser) {
    const dst = row.target;

    if (isUser) {
      const already =
        selected &&
        selected.dst === dst.modName &&
        selected.src === src.name;
      if (already) {
        clearRoute(dst.modName, dst.label);
        return;
      }
      selected = { dst: dst.modName, src: src.name };
      saved.selected = selected;
      vscode.setState(saved);
      render();
      return;
    }

    const idx = sourceIndex(src.name);
    if (!idx) {
      flashHint('Source not registered — reload shreds with @modSource.', true);
      return;
    }

    let depth = 0.5;
    if (route && route.isDefault && defRoute) {
      depth = defRoute.depth;
    } else if (route && !route.isDefault && Number.isFinite(route.depth)) {
      depth = route.depth;
    } else if (defRoute && Number.isFinite(defRoute.depth)) {
      depth = defRoute.depth;
    }
    if (!Number.isFinite(depth) || depth <= 0) depth = 0.5;

    rememberUserRoute(dst.modName, src.name, depth);
    selected = { dst: dst.modName, src: src.name };
    saved.selected = selected;
    vscode.setState(saved);
    postConnect(row.mod.file, dst.modName, src.name, idx, depth);
    markFlash(dst.modName, src.name);
    flashHint(
      'Patched ' + sourceColumnLabel(src) + ' → ' + dst.label + ' @ ' + depth.toFixed(2),
      false
    );
    render();
  }

  function clearRoute(dst, label) {
    forgetUserRoute(dst);
    if (selected && selected.dst === dst) {
      selected = null;
      saved.selected = null;
      vscode.setState(saved);
    }
    postDisconnect(dst);
    flashHint('Cleared ' + (label || dst), false);
    render();
  }

  function makeDepthFooter(dests) {
    const footer = el('div', 'depth-footer');
    const selRoute =
      selected && saved.userRoutes ? saved.userRoutes[selected.dst] : null;
    const active =
      selected &&
      selRoute &&
      selRoute.src === selected.src
        ? {
            dst: selected.dst,
            src: selected.src,
            depth: Number.isFinite(selRoute.depth) ? selRoute.depth : 0.5,
          }
        : null;

    if (!active) {
      footer.classList.add('disabled');
      footer.appendChild(
        el(
          'span',
          'depth-label',
          bypassed
            ? 'Bypassed — enable Bypass off to edit depth'
            : 'Select a patched cell to adjust depth'
        )
      );
      const depth = el('input', 'depth');
      depth.type = 'range';
      depth.min = '0';
      depth.max = '1';
      depth.step = '0.01';
      depth.value = '0.5';
      depth.disabled = true;
      footer.appendChild(depth);
      footer.appendChild(el('span', 'depth-val', '—'));
      return footer;
    }

    const row = dests.find((d) => d.target.modName === active.dst);
    const srcEntry = (model.sources || []).find((s) => s.name === active.src);
    const labelText =
      (srcEntry ? sourceColumnLabel(srcEntry) : sourceLabel(active.src)) +
      ' → ' +
      (row ? row.rowLabel : active.dst);
    footer.appendChild(el('span', 'depth-label', labelText));

    const depth = el('input', 'depth');
    depth.type = 'range';
    depth.min = '0';
    depth.max = '1';
    depth.step = '0.01';
    depth.value = String(active.depth);
    depth.disabled = bypassed;
    const depthVal = el('span', 'depth-val', Number(active.depth).toFixed(2));
    const moduleFile = row ? row.mod.file : '';

    if (active.depth < 0.05) {
      footer.classList.add('warn');
      depthVal.title = 'Depth near 0 — raise the slider to hear modulation';
    }

    depth.addEventListener('input', () => {
      const v = Number(depth.value);
      depthVal.textContent = v.toFixed(2);
      footer.classList.toggle('warn', v < 0.05);
      rememberUserRoute(active.dst, active.src, v);
      const cell = root.querySelector(
        '.cell.on[data-dst="' +
          cssEscape(active.dst) +
          '"][data-src="' +
          cssEscape(active.src) +
          '"] .dot'
      );
      if (cell) cell.style.setProperty('--depth', String(v));
      scheduleDepthPost(moduleFile, active.dst, active.src, v);
      updateStatusStrip();
    });

    const btnClear = document.createElement('button');
    btnClear.type = 'button';
    btnClear.className = 'btn-clear';
    btnClear.textContent = 'Clear';
    btnClear.disabled = bypassed;
    btnClear.title = 'Remove this route (restore patch-internal mod)';
    btnClear.addEventListener('click', () => {
      clearRoute(active.dst, row ? row.target.label : active.dst);
    });

    footer.appendChild(depth);
    footer.appendChild(depthVal);
    footer.appendChild(btnClear);
    footer.appendChild(
      el(
        'div',
        'depth-note',
        'While patched, this destination uses the matrix instead of the patch’s internal mod.'
      )
    );
    return footer;
  }

  function updateStatusStrip() {
    const strip = root && root.querySelector('.status-strip');
    if (!strip) return;
    const nRoutes = Object.keys(saved.userRoutes || {}).length;
    const bits = [];
    bits.push('<strong>' + nRoutes + '</strong> route' + (nRoutes === 1 ? '' : 's'));
    if (bypassed) bits.push('<strong>bypassed</strong>');
    else if (selected) bits.push('depth ready');
    else bits.push('select a lit cell for depth');
    strip.innerHTML = bits.join(' · ');
  }

  function onKeyDown(ev) {
    if (!model.vmUp || !root) return;
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (bypassed && ev.key !== 'Escape') return;

    const dests = filterDests(allDestinations());
    const sources = filterSources(model.sources || [], dests);
    if (!sources.length || !dests.length) return;

    if (ev.key === 'Escape') {
      selected = null;
      saved.selected = null;
      vscode.setState(saved);
      render();
      ev.preventDefault();
      return;
    }

    if (ev.key === '[' || ev.key === ']') {
      if (!selected || !saved.userRoutes[selected.dst]) return;
      const r = saved.userRoutes[selected.dst];
      if (r.src !== selected.src) return;
      const delta = ev.key === ']' ? 0.05 : -0.05;
      const v = Math.max(0, Math.min(1, (Number(r.depth) || 0) + delta));
      rememberUserRoute(selected.dst, selected.src, v);
      const row = dests.find((d) => d.target.modName === selected.dst);
      scheduleDepthPost(row ? row.mod.file : '', selected.dst, selected.src, v);
      render();
      ev.preventDefault();
      return;
    }

    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      if (!selected || !saved.userRoutes[selected.dst]) return;
      const row = dests.find((d) => d.target.modName === selected.dst);
      clearRoute(selected.dst, row ? row.target.label : selected.dst);
      ev.preventDefault();
      return;
    }

    let ri = selected
      ? dests.findIndex((d) => d.target.modName === selected.dst)
      : 0;
    let ci = selected
      ? sources.findIndex((s) => s.name === selected.src)
      : 0;
    if (ri < 0) ri = 0;
    if (ci < 0) ci = 0;

    if (ev.key === 'ArrowUp') {
      ri = Math.max(0, ri - 1);
      moveSelection(dests, sources, ri, ci);
      ev.preventDefault();
    } else if (ev.key === 'ArrowDown') {
      ri = Math.min(dests.length - 1, ri + 1);
      moveSelection(dests, sources, ri, ci);
      ev.preventDefault();
    } else if (ev.key === 'ArrowLeft') {
      ci = Math.max(0, ci - 1);
      moveSelection(dests, sources, ri, ci);
      ev.preventDefault();
    } else if (ev.key === 'ArrowRight') {
      ci = Math.min(sources.length - 1, ci + 1);
      moveSelection(dests, sources, ri, ci);
      ev.preventDefault();
    } else if (ev.key === 'Enter') {
      const row = dests[ri];
      const src = sources[ci];
      if (!row || !src) return;
      const route = effectiveRoute(row.mod, row.target);
      const defRoute = (row.mod.defaults || []).find(
        (r) => r.dstLabel.toLowerCase() === row.target.label.toLowerCase()
      );
      const isUser = route && !route.isDefault && route.src === src.name;
      onCellClick(row, src, route, defRoute, isUser);
      ev.preventDefault();
    }
  }

  function moveSelection(dests, sources, ri, ci) {
    const row = dests[ri];
    const src = sources[ci];
    if (!row || !src) return;
    selected = { dst: row.target.modName, src: src.name };
    saved.selected = selected;
    vscode.setState(saved);
    render();
    const btn = root.querySelector(
      '.cell[data-dst="' +
        cssEscape(selected.dst) +
        '"][data-src="' +
        cssEscape(selected.src) +
        '"]'
    );
    if (btn) btn.focus();
  }

  function markFlash(dst, src) {
    flashKey = dst + '|' + src;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashKey = null;
      flashTimer = null;
      const elFlash = root && root.querySelector('.cell.flash');
      if (elFlash) elFlash.classList.remove('flash');
    }, 450);
  }

  function hydrateUserRoutes(persistedRoutes) {
    if (!Array.isArray(persistedRoutes)) return;
    for (const r of persistedRoutes) {
      if (r && r.dst && r.src) {
        rememberUserRoute(r.dst, r.src, r.depth);
      }
    }
  }

  function syncUserRoutesFromModel() {
    for (const mod of model.modules || []) {
      for (const r of mod.routes || []) {
        if (!r || r.isDefault) continue;
        rememberUserRoute(r.dst, r.src, r.depth);
      }
    }
  }

  function pruneSelection() {
    if (!selected) return;
    const still =
      saved.userRoutes &&
      saved.userRoutes[selected.dst] &&
      saved.userRoutes[selected.dst].src === selected.src;
    if (!still) {
      // Keep selection for keyboard nav even on empty cells
      return;
    }
  }

  function effectiveRoute(mod, target) {
    const user = saved.userRoutes && saved.userRoutes[target.modName];
    if (user) {
      return {
        dst: target.modName,
        src: user.src,
        depth: user.depth,
        isDefault: false,
      };
    }
    const route = (mod.routes || []).find((r) => r.dst === target.modName);
    if (route) return route;
    const defRoute = (mod.defaults || []).find(
      (r) => r.dstLabel.toLowerCase() === target.label.toLowerCase()
    );
    if (!defRoute) return null;
    const srcName = labelToSrc(mod, defRoute.srcLabel);
    if (!srcName) return null;
    return {
      dst: target.modName,
      src: srcName,
      depth: defRoute.depth,
      isDefault: true,
    };
  }

  function rememberUserRoute(dst, src, depth) {
    if (!saved.userRoutes) saved.userRoutes = {};
    let d = Number(depth);
    if (!Number.isFinite(d)) d = 0.5;
    saved.userRoutes[dst] = { src: src, depth: d };
    vscode.setState(saved);
  }

  function forgetUserRoute(dst) {
    if (!saved.userRoutes) return;
    delete saved.userRoutes[dst];
    vscode.setState(saved);
  }

  function flashHint(text, isWarn) {
    const bar = root && root.querySelector('.hint-bar');
    if (!bar) return;
    const prev = bar.textContent;
    const hadPending = bar.classList.contains('pending');
    const hadWarn = bar.classList.contains('warn');
    bar.textContent = text;
    bar.classList.toggle('warn', !!isWarn);
    bar.classList.toggle('pending', !isWarn);
    setTimeout(() => {
      if (!bar.isConnected) return;
      bar.textContent = prev;
      bar.classList.toggle('warn', hadWarn);
      bar.classList.toggle('pending', hadPending);
    }, 2200);
  }

  function ownerFile(src) {
    if (src && src.file) return src.file;
    for (const mod of model.modules || []) {
      if ((mod.sources || []).some((s) => s.name === src.name)) {
        return mod.file;
      }
    }
    return '';
  }

  function sourceOwnerTitle(src) {
    if (!src) return '';
    const file = ownerFile(src);
    if (file) {
      const mod = (model.modules || []).find(
        (m) => m.file === file || basename(m.file) === basename(file)
      );
      if (mod) return stripExt(mod.title);
    }
    for (const mod of model.modules || []) {
      if ((mod.sources || []).some((s) => s.name === src.name)) {
        return stripExt(mod.title);
      }
    }
    return '';
  }

  function sourceColumnLabel(src) {
    const owner = sourceOwnerTitle(src);
    const label = src.label || sourceLabel(src.name);
    return owner ? owner + ' · ' + label : label;
  }

  function sourceTooltip(src) {
    const owner = sourceOwnerTitle(src);
    const parts = [];
    if (owner) parts.push(owner);
    parts.push(src.label || src.name);
    parts.push(src.name);
    parts.push(src.bipolar ? 'bipolar (−1…1)' : 'unipolar (0…1)');
    return parts.join('\n');
  }

  function cellTooltip(src, row, isUser, isDefault, depth) {
    const lines = [
      sourceColumnLabel(src) + ' → ' + row.rowLabel,
      src.name + ' → ' + row.target.modName,
    ];
    if (isUser) {
      lines.push(
        'depth ' +
          Number(depth).toFixed(2) +
          ' · click to select, again to clear'
      );
      lines.push('Overrides patch-internal mod for this destination');
    } else if (isDefault) {
      lines.push('factory default · click to claim');
    } else {
      lines.push('click to patch');
    }
    return lines.join('\n');
  }

  function moduleAccent(ownerTitle) {
    const s = String(ownerTitle || 'x');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    const hue = h % 360;
    return 'hsl(' + hue + ' 55% 48%)';
  }

  function normalizeModKey(file) {
    return basename(String(file || '')).toLowerCase();
  }

  function sourceIndex(name) {
    const s = (model.sources || []).find((x) => x.name === name);
    return s && typeof s.index === 'number' && s.index >= 1 ? s.index : 0;
  }

  function sourceLabel(name) {
    const s = (model.sources || []).find((x) => x.name === name);
    return s ? s.label : name;
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

  function basename(p) {
    const s = String(p || '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

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
