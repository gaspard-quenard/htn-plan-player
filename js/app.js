// Application wiring: state, file loading, and keeping the views in sync.
(function () {
  'use strict';
  const { el, clear } = HTNV.dom;
  const { status } = HTNV.schedule;
  const $ = id => document.getElementById(id);

  const S = {
    files: { plan: null, domain: null, problem: null }, // { name, text }
    model: null,
    step: 0,              // index into model.schedule.timePoints
    selected: null,       // plan node
    highlight: '',        // object name, or a text searched in node labels
    orientation: 'lr',
    methodsAsNodes: true,
    showTechnical: false,
    focus: false,
    follow: true,
    timeline: true,       // action timeline under the tree
    collapsed: new Set(), // collapsed by the user
    expanded: new Set(),  // expanded by the user while focus mode would collapse them
  };

  // ---------------------------------------------------------------- derived

  const time = () => S.model.schedule.timePoints[S.step];
  const stepCount = () => (S.model ? S.model.schedule.timePoints.length - 1 : 0);
  const currentActions = () => (S.model ? S.model.schedule.actionsAt(time()) : []);
  function stepOfTime(t) {
    const tp = S.model.schedule.timePoints;
    const k = tp.indexOf(t);
    return k >= 0 ? k : tp.findIndex(x => x > t) - 1;
  }

  function isCollapsed(node) {
    if (node === S.model.plan.root) return false;
    if (S.collapsed.has(node.id)) return true;
    return S.focus && !S.expanded.has(node.id) && status(node, time()) !== 'active';
  }

  function matcher() {
    const q = S.highlight;
    if (!q) return null;
    if (S.model.objects.includes(q)) return n => HTNV.plan.objectsOf(n).has(q);
    return n => (n.name + ' ' + n.args.join(' ')).includes(q);
  }

  // Nearest node of the drawn tree (the node itself or a collapsed ancestor).
  function visibleAncestor(node) {
    for (let n = node; n; n = n.parent) if (tree.byId && tree.byId.has(n.id)) return n;
    return null;
  }

  // ---------------------------------------------------------------- views

  const tree = new HTNV.TreeView($('tree'), {
    onSelect: node => select(node, false),
    onToggle: toggleNode,
    onObject: setHighlight,
  });
  const panelHandlers = {
    onSelect: (node, center) => select(node, center),
    onObject: setHighlight,
    onStep: k => { player.pause(); setStep(stepOfTime(k)); },
  };
  const crumbs = new HTNV.panels.Breadcrumb($('crumbs'), panelHandlers);
  const details = new HTNV.panels.DetailsPanel($('details'), panelHandlers);
  const statePanel = new HTNV.panels.StatePanel($('state'), panelHandlers);
  const player = new HTNV.Player({
    first: $('p-first'), prev: $('p-prev'), play: $('p-play'), next: $('p-next'), last: $('p-last'),
    slider: $('slider'), marks: $('marks'), label: $('step-label'), speed: $('speed'),
  }, { count: stepCount, step: () => S.step, setStep });
  const timeline = new HTNV.TimelineView($('timeline'), {
    onPick: action => { player.pause(); setStep(stepOfTime(action.start)); select(action, false); },
  });

  function relayout(animate = true) {
    const vroot = HTNV.layout.visibleTree(S.model.plan, {
      methodsAsNodes: S.methodsAsNodes, showTechnical: S.showTechnical, isCollapsed,
    });
    tree.render(HTNV.layout.layout(vroot, S.orientation));
    refreshClasses(animate);
  }

  function refreshClasses(animate = true) {
    const current = currentActions();
    const pathIds = new Set();
    current.forEach(a => HTNV.plan.ancestors(a).forEach(n => pathIds.add(n.id)));
    const ctx = {
      time: time(), currentIds: new Set(current.map(a => a.id)), pathIds,
      selectedId: S.selected && S.selected.id, matches: matcher(),
    };
    tree.updateClasses(ctx);
    timeline.update(Object.assign(ctx, { follow: S.follow, animate }));
  }

  function renderPanels() {
    const current = currentActions();
    crumbs.render(S.model, time(), current);
    details.render(S.model, S.selected, { time: time(), currentIds: new Set(current.map(a => a.id)), stepOfTime });
    statePanel.render(S.model, S.step, S.model.objects.includes(S.highlight) ? S.highlight : '', current);
    const n = stepCount();
    if (S.model.schedule.temporal) {
      const end = S.model.schedule.timePoints[n];
      player.sync(S.step >= n ? `End · t = ${end}` : `t = ${time()} / ${end}`);
    } else {
      player.sync(S.step >= n ? `End · ${n} steps` : `Step ${S.step + 1} / ${n}`);
    }
  }

  // ---------------------------------------------------------------- actions

  function setStep(k, animate = true) {
    if (!S.model) return;
    S.step = Math.max(0, Math.min(stepCount(), k));
    // A selected action follows the plan: the details show the action being
    // executed (a selected task or method stays, to be examined while playing).
    const current = currentActions();
    if (S.selected && S.selected.kind === 'action' && current.length && !current.includes(S.selected)) {
      S.selected = current[0];
    }
    if (S.focus) relayout(animate); else refreshClasses(animate);
    renderPanels();
    const cur = current[0];
    const target = cur && visibleAncestor(cur);
    if (S.follow && target) tree.focusNode(target.id, { onlyIfOutside: !S.focus, animate });
  }

  function select(node, center) {
    S.selected = node;
    if (node) {
      showTab('details');
      document.body.classList.remove('no-side');
      // Make sure the node is drawn: expand its collapsed ancestors.
      let changed = false;
      for (let n = node.parent; n; n = n.parent) {
        if (S.collapsed.delete(n.id)) changed = true;
        if (S.focus && !S.expanded.has(n.id) && status(n, time()) !== 'active') { S.expanded.add(n.id); changed = true; }
      }
      if (changed) relayout();
      if (center) tree.focusNode(visibleAncestor(node).id);
    }
    refreshClasses();
    renderPanels();
  }

  function toggleNode(node) {
    if (!node.children.length || node === S.model.plan.root) return;
    if (isCollapsed(node)) {
      S.collapsed.delete(node.id);
      if (S.focus) S.expanded.add(node.id);
    } else {
      S.expanded.delete(node.id);
      S.collapsed.add(node.id);
    }
    relayout();
  }

  function setHighlight(q) {
    S.highlight = (q || '').trim().toLowerCase();
    $('highlight').value = S.highlight;
    let count = 0;
    const m = matcher();
    if (m) S.model.plan.nodes.forEach(n => { if (m(n)) count++; });
    $('hl-count').textContent = m ? `${count} match${count === 1 ? '' : 'es'}` : '';
    $('hl-clear').hidden = !m;
    refreshClasses();
    renderPanels();
  }

  function setOrientation(o) {
    S.orientation = o;
    $('orient-lr').classList.toggle('on', o === 'lr');
    $('orient-td').classList.toggle('on', o === 'td');
    if (!S.model) return;
    relayout();
    const anchor = S.selected || currentActions()[0];
    if (anchor) tree.focusNode(visibleAncestor(anchor).id, { animate: false });
    else tree.fit(false);
  }

  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $('details').hidden = name !== 'details';
    $('state').hidden = name !== 'state';
  }

  // ---------------------------------------------------------------- loading

  function toast(msg, kind = 'error') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + kind;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  // Forgets every loaded file (also the copy kept for the next visit) and
  // goes back to the welcome screen.
  function closeFiles() {
    player.pause();
    S.files = { plan: null, domain: null, problem: null };
    S.model = null;
    S.selected = null;
    S.highlight = '';
    S.step = 0;
    try { localStorage.removeItem('htnv.files'); } catch (e) { /* storage blocked */ }
    if (location.search) history.replaceState(null, '', location.pathname); // no reload from URL parameters
    tree.render({ nodes: [], edges: [], orientation: S.orientation, bounds: { x0: 0, y0: 0, x1: 0, y1: 0 } });
    timeline.render(null, {});
    $('highlight').value = '';
    $('hl-count').textContent = '';
    $('hl-clear').hidden = true;
    clear($('objects'));
    document.body.classList.remove('loaded');
    renderFileChips();
  }

  function addFiles(list) {
    const unknown = [];
    list.forEach(({ name, text }) => {
      const kind = HTNV.hddl.classify(text);
      if (kind) S.files[kind] = { name, text };
      else unknown.push(name);
    });
    if (unknown.length) toast(`Not recognised as a plan, domain or problem: ${unknown.join(', ')}`);
    rebuild();
  }

  function rebuild() {
    renderFileChips();
    if (!S.files.plan) {
      if (S.files.domain || S.files.problem) toast('Now load the plan (planner output) to display the tree.', 'info');
      return;
    }
    let model;
    try {
      model = HTNV.model.build({
        planText: S.files.plan.text,
        domainText: S.files.domain && S.files.domain.text,
        problemText: S.files.problem && S.files.problem.text,
      });
    } catch (e) {
      toast(`Could not read the files: ${e.message}`);
      console.error(e);
      return;
    }
    if (S.files.problem && !S.files.domain) toast('The problem is only used together with the domain file.', 'info');
    S.model = model;
    S.step = 0;
    S.selected = null;
    S.collapsed.clear();
    S.expanded.clear();
    if (model.plan.nodes.size > 1500 && !S.focus) {
      setOption('focus', true);
      toast('Large plan: "Focus on the active part" was turned on (View menu).', 'info');
    }
    try { localStorage.setItem('htnv.files', JSON.stringify(S.files)); } catch (e) { /* storage full or blocked */ }

    document.body.classList.add('loaded');
    const dl = clear($('objects'));
    model.objects.forEach(o => dl.appendChild(el('option', { value: o })));
    timeline.render(model, { showTechnical: S.showTechnical });
    player.setMarks(model.plan.actions.filter(a => a.issues.length).map(a => stepOfTime(a.start)));
    relayout();
    setHighlight(S.highlight && (model.objects.includes(S.highlight) ? S.highlight : ''));
    const k = tree.fit(false);
    if (k < 0.7) tree.showStart(0.9);
  }

  function renderFileChips() {
    const box = clear($('files'));
    [['plan', 'Plan'], ['domain', 'Domain'], ['problem', 'Problem']].forEach(([kind, label]) => {
      const f = S.files[kind];
      box.appendChild(el('button', {
        class: 'file-chip' + (f ? ' set' : ''), title: f ? `${label}: ${f.name} (click to replace)` : `Load the ${label.toLowerCase()} file`,
        on: { click: () => $('file-input').click() },
      }, el('span', { class: 'fk', text: label }), el('span', { class: 'fn', text: f ? '✓' : '+' })));
    });
  }

  async function readFiles(fileList) {
    const files = await Promise.all([...fileList].map(async f => ({ name: f.name, text: await f.text() })));
    addFiles(files);
  }

  async function loadFromUrl(params) {
    const urls = ['plan', 'domain', 'problem'].filter(k => params.get(k));
    try {
      const files = await Promise.all(urls.map(async k => {
        const r = await fetch(params.get(k));
        if (!r.ok) throw new Error(`${params.get(k)}: HTTP ${r.status}`);
        return { name: params.get(k).split('/').pop(), text: await r.text() };
      }));
      addFiles(files);
    } catch (e) {
      toast(`Could not fetch the files given in the URL (${e.message}). Opened from disk? Use "Open files" instead.`);
    }
  }

  // ---------------------------------------------------------------- options

  const OPTION_BOXES = { methodsAsNodes: 'opt-methods', showTechnical: 'opt-technical', focus: 'opt-focus', follow: 'opt-follow', timeline: 'opt-timeline' };

  function setOption(name, value) {
    S[name] = value;
    $(OPTION_BOXES[name]).checked = value;
    if (name === 'timeline') { document.body.classList.toggle('no-timeline', !value); return; }
    if (!S.model) return;
    if (name === 'focus') S.expanded.clear();
    if (name === 'showTechnical') timeline.render(S.model, { showTechnical: value });
    if (name !== 'follow') relayout();
  }

  // ---------------------------------------------------------------- events

  $('file-input').addEventListener('change', e => { readFiles(e.target.files); e.target.value = ''; });
  $('btn-open').addEventListener('click', () => $('file-input').click());
  $('w-open').addEventListener('click', () => $('file-input').click());
  $('btn-paste').addEventListener('click', () => $('paste-dialog').showModal());
  $('btn-close').addEventListener('click', closeFiles);
  $('w-paste').addEventListener('click', () => $('paste-dialog').showModal());
  HTNV.examples.forEach(ex => $('w-examples').appendChild(el('button', {
    class: 'btn', text: ex.label,
    on: {
      click: () => {
        S.files = { plan: null, domain: null, problem: null };
        addFiles([{ name: `example plan (${ex.id})`, text: ex.plan }, { name: 'kitchen domain', text: ex.domain }, { name: 'morning problem', text: ex.problem }]);
      },
    },
  })));
  $('paste-load').addEventListener('click', () => {
    const text = $('paste-text').value;
    if (!text.trim()) return;
    const kind = HTNV.hddl.classify(text) || 'text';
    addFiles([{ name: 'pasted ' + kind, text }]);
    $('paste-text').value = '';
  });

  $('orient-lr').addEventListener('click', () => setOrientation('lr'));
  $('orient-td').addEventListener('click', () => setOrientation('td'));
  Object.entries(OPTION_BOXES).forEach(([key, id]) => {
    $(id).addEventListener('change', e => setOption(key, e.target.checked));
  });
  $('btn-expand').addEventListener('click', () => { S.collapsed.clear(); setOption('focus', false); });
  $('btn-fit').addEventListener('click', () => tree.fit());
  $('zoom-in').addEventListener('click', () => tree.zoomBy(1.25));
  $('zoom-out').addEventListener('click', () => tree.zoomBy(0.8));
  $('btn-panel').addEventListener('click', () => document.body.classList.toggle('no-side'));
  $('btn-help').addEventListener('click', () => $('help-dialog').showModal());
  document.querySelectorAll('[data-dialog]').forEach(b => b.addEventListener('click', () => $(b.dataset.dialog).showModal()));
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('highlight').addEventListener('change', e => setHighlight(e.target.value));
  $('highlight').addEventListener('input', e => { if (!e.target.value) setHighlight(''); });
  $('hl-clear').addEventListener('click', () => setHighlight(''));
  document.addEventListener('click', e => {
    const menu = document.querySelector('details.menu');
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });

  // Drag and drop anywhere in the window.
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
  });

  window.addEventListener('keydown', e => {
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, dialog');
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { $('help-dialog').showModal(); return; }
    if (!S.model) return;
    const big = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case ' ': e.preventDefault(); player.toggle(); break;
      case 'ArrowRight': e.preventDefault(); player.go(S.step + big); break;
      case 'ArrowLeft': e.preventDefault(); player.go(S.step - big); break;
      case 'Home': player.go(0); break;
      case 'End': player.go(stepCount()); break;
      case 'f': tree.fit(); break;
      case 'o': setOrientation(S.orientation === 'lr' ? 'td' : 'lr'); break;
      case 'm': setOption('methodsAsNodes', !S.methodsAsNodes); break;
      case 't': setOption('timeline', !S.timeline); break;
      case 'c': { const cur = currentActions()[0]; if (cur) tree.focusNode(visibleAncestor(cur).id); break; }
      case '/': e.preventDefault(); $('highlight').focus(); break;
      case 'Escape': select(null); setHighlight(''); break;
      default:
    }
  });

  // ---------------------------------------------------------------- start

  const params = new URLSearchParams(location.search);
  if (['light', 'dark'].includes(params.get('theme'))) document.documentElement.dataset.theme = params.get('theme');
  if (params.get('orient') === 'td') setOrientation('td');
  if (params.get('methods') === '0') setOption('methodsAsNodes', false);
  if (params.get('focus') === '1') setOption('focus', true);
  if (params.get('timeline') === '0') setOption('timeline', false);
  if (window.innerWidth < 860) document.body.classList.add('no-side');
  renderFileChips();
  showTab(params.get('tab') === 'state' ? 'state' : 'details');

  (async () => {
    if (params.get('plan')) await loadFromUrl(params);
    else {
      try {
        const saved = JSON.parse(localStorage.getItem('htnv.files') || 'null');
        if (saved && saved.plan) { S.files = saved; rebuild(); }
      } catch (e) { /* nothing saved */ }
    }
    if (!S.model) return;
    if (params.get('hl')) setHighlight(params.get('hl'));
    if (params.get('t')) setStep(Number(params.get('t')), false);
    if (params.get('sel') && S.model.plan.nodes.get(params.get('sel'))) select(S.model.plan.nodes.get(params.get('sel')), true);
  })();
})();
