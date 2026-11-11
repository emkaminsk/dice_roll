// Assign Options — give every person labels (tasks, roles, topics…) in rounds.
// The whole draw is computed by AssignOptionsSolver (fair RNG via randomIndex)
// before anything is revealed; reel, dealing and presenter are cosmetic only.
// Independent of every other view: own IDs (ao-*), classes, storage key, state.
(function () {
  const view = document.querySelector('#assign-options-view');
  if (!view || !window.AssignOptionsSolver || !window.PageUtils) return;
  const Solver = window.AssignOptionsSolver;
  const U = window.PageUtils;

  const STORAGE_KEY = 'assignOptions.setup.v1';
  const SOFT_LIMIT = 500;
  const HARD_LIMIT = 2000;
  const LABEL_LIMIT = 100;
  const MAX_SLOTS = 1000;
  const MAX_ROUNDS = 20;
  const HISTORY_MAX = 10;
  const PALETTE_SIZE = 12;
  const EXAMPLE = {
    people: ['Anna', 'Ben', 'Chloé', 'Dev', 'Emma', 'Felix'],
    labels: [['Dishes', 2], ['Trash', 1], ['Cooking', 1], ['Shopping', 2]],
    settings: { rounds: 4, perPerson: 1, variety: true, allowUnfilled: true, word: 'Chore' },
  };

  const $ = (sel) => view.querySelector(sel);
  const els = {
    loadExample: $('#ao-load-example'), importBtn: $('#ao-import'), importFile: $('#ao-import-file'),
    exportBtn: $('#ao-export'), resetBtn: $('#ao-reset'), clearSaved: $('#ao-clear-saved'), ioNotice: $('#ao-io-notice'),
    metaPeople: $('#ao-meta-people'), metaLabels: $('#ao-meta-labels'), metaDraw: $('#ao-meta-draw'), stepLabelsText: $('#ao-stepper-labels'),
    peopleCount: $('#ao-people-count'), peopleEmpty: $('#ao-people-empty'), peopleWrap: $('#ao-people-wrap'),
    peopleTable: $('#ao-people-table'), peoplePresent: $('#ao-people-present'), peopleClear: $('#ao-people-clear'),
    addPerson: $('#ao-add-person'), pasteToggle: $('#ao-paste-toggle'), peopleImport: $('#ao-people-import'),
    paste: $('#ao-paste'), pasteText: $('#ao-paste-text'), pastePreview: $('#ao-paste-preview'), pasteCancel: $('#ao-paste-cancel'),
    pasteResult: $('#ao-paste-result'), importPanel: $('#ao-import-panel'), peopleNotice: $('#ao-people-notice'),
    labelsTitle: $('#ao-labels-title-text'), word: $('#ao-word'), allOnce: $('#ao-all-once'),
    labelsCount: $('#ao-labels-count'), labelsEmpty: $('#ao-labels-empty'), labelsWrap: $('#ao-labels-wrap'), labelsTable: $('#ao-labels-table'),
    labelForm: $('#ao-label-form'), labelName: $('#ao-label-name'), labelSlots: $('#ao-label-slots'),
    labelUnlimited: $('#ao-label-unlimited'), labelOnce: $('#ao-label-once'), labelError: $('#ao-label-error'),
    labelsPasteToggle: $('#ao-labels-paste-toggle'), labelsPaste: $('#ao-labels-paste'), labelsPasteText: $('#ao-labels-paste-text'),
    labelsPasteAdd: $('#ao-labels-paste-add'), labelsPasteCancel: $('#ao-labels-paste-cancel'), labelsNotice: $('#ao-labels-notice'),
    rounds: $('#ao-rounds'), perPerson: $('#ao-per-person'), variety: $('#ao-variety'), unfilled: $('#ao-unfilled'),
    balance: $('#ao-balance'), hints: $('#ao-hints'),
    draw: $('#ao-draw'), drawLabel: $('#ao-draw-label'), cancel: $('#ao-cancel'), keepBar: $('#ao-keep-bar'), keepHint: $('#ao-keep-hint'),
    status: $('#ao-status'), alert: $('#ao-alert'), resultsWrap: $('#ao-results-wrap'), outdated: $('#ao-outdated'),
    resultHead: $('#ao-result-head'), summary: $('#ao-summary'), viewPerson: $('#ao-view-person'), viewLabel: $('#ao-view-label'),
    results: $('#ao-results'), actions: $('#ao-result-actions'), copy: $('#ao-copy'), csv: $('#ao-csv'), present: $('#ao-present'),
    copyFallback: $('#ao-copy-fallback'), copyText: $('#ao-copy-text'), historyWrap: $('#ao-history-wrap'), history: $('#ao-history'),
  };

  let state = emptySetup();
  let version = 0; // bumps on every setup change; results remember theirs
  let history = []; // memory only
  let shown = null;
  let viewMode = 'person';
  let kept = new Set(); // round indexes frozen for "Draw again"
  let drawSeq = 0;
  let running = null;
  let saveTimer = null;
  let pastePlan = null;
  let importPlan = null;
  let idCounter = 0;
  const runner = U.createWorkerRunner(Solver.createSolver, { method: 'run' });

  // ---- Small helpers ------------------------------------------------------

  function emptySetup() {
    return { people: [], labels: [], settings: { rounds: 1, perPerson: 1, variety: true, allowUnfilled: true, word: '' } };
  }
  function uid(prefix) {
    idCounter += 1;
    return prefix + Date.now().toString(36) + idCounter.toString(36);
  }
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.keys(v).forEach((d) => { node.dataset[d] = v[d]; });
      else if (k === 'style') node.setAttribute('style', v);
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach((c) => { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sameName(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
  function reduceMotion() { return U.reduceMotion(); }
  function namedPeople() { return state.people.filter((p) => p.name.trim() !== ''); }
  function activePeople() { return namedPeople().filter((p) => !p.absent); }
  function intIn(v, lo, hi, dflt) {
    const n = parseInt(v, 10);
    return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  }
  // The label word ("Task", "Role", …) is purely cosmetic.
  function word() { return String(state.settings.word || '').trim() || 'Label'; }
  function wordLower(n) { const w = word().toLowerCase(); return n === 1 ? w : w + 's'; }
  function wordify(text) {
    if (!String(state.settings.word || '').trim()) return text;
    return text.replace(/\b([Ll])abel(s?)\b/g, (m, l, s) => {
      const w = l === 'L' ? word() : word().toLowerCase();
      return w + s;
    });
  }
  function colorVar(label) { return `--ao-chip: var(--ao-c${(label.color || 0) % PALETTE_SIZE})`; }
  function nextColor() {
    const used = state.labels.map((l) => l.color || 0);
    for (let i = 0; i < PALETTE_SIZE; i++) if (used.indexOf((state.labels.length + i) % PALETTE_SIZE) === -1) return (state.labels.length + i) % PALETTE_SIZE;
    return state.labels.length % PALETTE_SIZE;
  }
  function slotsText(label) { return label.slots === null ? '∞' : String(label.slots); }

  // ---- Persistence (optional convenience) ---------------------------------

  function setupForExport() {
    return { kind: 'assign-options', version: 1, people: state.people, labels: state.labels, settings: state.settings };
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(setupForExport())); } catch (e) { /* storage unavailable */ }
    }, 250);
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const res = parseOwn(JSON.parse(raw));
      return res.ok ? res.setup : null;
    } catch (e) {
      return null;
    }
  }

  function cleanPeople(list) {
    const seen = {};
    const out = [];
    list.slice(0, HARD_LIMIT).forEach((p) => {
      if (!p || typeof p !== 'object' || typeof p.name !== 'string') return;
      let id = typeof p.id === 'string' && p.id && !seen[p.id] ? p.id : uid('p');
      while (seen[id]) id = uid('p');
      seen[id] = true;
      const person = { id, name: p.name.slice(0, 200) };
      if (p.absent === true) person.absent = true;
      out.push(person);
    });
    return out;
  }

  // Validate + clean an own-format setup (import or autosave).
  function parseOwn(obj) {
    const fail = (error) => ({ ok: false, error });
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.kind !== 'assign-options') return fail('The file is not an Assign Options setup.');
    if (obj.version !== 1) return fail('Unsupported or missing version (expected version 1).');
    if (!Array.isArray(obj.people) || !Array.isArray(obj.labels)) return fail('Missing people or labels.');
    const labels = [];
    const ids = {};
    obj.labels.forEach((l) => {
      if (!l || typeof l !== 'object' || typeof l.name !== 'string' || !l.name.trim()) return;
      if (labels.length >= LABEL_LIMIT || labels.some((x) => sameName(x.name, l.name))) return;
      let id = typeof l.id === 'string' && l.id && !ids[l.id] ? l.id : uid('l');
      while (ids[id]) id = uid('l');
      ids[id] = true;
      const slots = l.slots === null ? null : intIn(l.slots, 1, MAX_SLOTS, 1);
      labels.push({ id, name: l.name.trim().slice(0, 100), slots, once: l.once === true, color: intIn(l.color, 0, PALETTE_SIZE - 1, labels.length % PALETTE_SIZE) });
    });
    const s = obj.settings && typeof obj.settings === 'object' ? obj.settings : {};
    const settings = {
      rounds: intIn(s.rounds, 1, MAX_ROUNDS, 1),
      perPerson: intIn(s.perPerson, 1, LABEL_LIMIT, 1),
      variety: s.variety !== false,
      allowUnfilled: s.allowUnfilled !== false,
      word: typeof s.word === 'string' ? s.word.slice(0, 30) : '',
    };
    return { ok: true, setup: { people: cleanPeople(obj.people), labels, settings } };
  }

  // A Group Draw export: only people[].name and people[].absent are read.
  function parseGroupDraw(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.kind !== undefined) return null;
    if (!Array.isArray(obj.people) || !(Array.isArray(obj.attributes) || (obj.groups && typeof obj.groups === 'object'))) return null;
    if (obj.version !== 1) return { error: 'Unsupported Group Draw file version (expected version 1).' };
    const people = obj.people
      .filter((p) => p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim())
      .map((p) => (p.absent === true ? { name: p.name.trim(), absent: true } : { name: p.name.trim() }));
    const ignored = (Array.isArray(obj.attributes) && obj.attributes.length) || (Array.isArray(obj.rules) && obj.rules.length);
    return { people, ignored: !!ignored };
  }

  // ---- Setup changes ------------------------------------------------------

  function changed(opts) {
    const o = opts || {};
    version += 1;
    scheduleSave();
    if (o.people) renderPeople();
    if (o.labels) renderLabels();
    if (o.settings) renderSettings();
    renderPeopleMeta();
    renderLabelsMeta();
    renderPerPerson();
    renderHints();
    renderMeta();
    markOutdated();
  }

  function replaceSetup(setup) {
    state = setup;
    kept = new Set();
    renderAll();
    version += 1;
    scheduleSave();
    markOutdated();
  }

  function renderAll() {
    renderPeople();
    renderLabels();
    renderSettings();
    renderPeopleMeta();
    renderLabelsMeta();
    renderPerPerson();
    renderHints();
    renderMeta();
  }

  function renderMeta() {
    const n = activePeople().length;
    els.metaPeople.textContent = plural(n, 'person', 'people');
    els.metaLabels.textContent = plural(state.labels.length, wordLower(1), wordLower(2));
    els.stepLabelsText.textContent = word() + 's';
    els.labelsTitle.textContent = word() + 's';
    els.metaDraw.textContent = history.length ? plural(history.length, 'draw') : 'ready';
    view.querySelector('[data-step="people"]').classList.toggle('is-done', n > 0);
    view.querySelector('[data-step="labels"]').classList.toggle('is-done', state.labels.length > 0);
    view.querySelector('[data-step="draw"]').classList.toggle('is-done', history.length > 0);
    els.drawLabel.textContent = running ? 'Drawing…' : (history.length ? 'Draw again' : 'Draw');
    els.labelName.placeholder = `e.g. ${word() === 'Label' ? 'Dishes' : word()}`;
  }

  function markOutdated() {
    const stale = !!shown && shown.version !== version;
    els.resultsWrap.classList.toggle('is-outdated', stale);
    els.outdated.hidden = !stale;
    renderKeep();
  }

  // ---- Step 1: people -----------------------------------------------------

  function renderPeople() {
    const tbody = els.peopleTable.tBodies[0];
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.people.forEach((p, i) => frag.appendChild(personRow(p, i)));
    tbody.appendChild(frag);
    els.peopleWrap.hidden = !state.people.length;
    els.peopleEmpty.hidden = state.people.length > 0;
    els.peopleClear.hidden = !state.people.length;
    els.peoplePresent.hidden = !state.people.some((p) => p.absent);
    flagDuplicates();
  }

  function personRow(p, i) {
    const label = p.name.trim() || `Row ${i + 1}`;
    return el('tr', { class: p.absent ? 'is-absent' : '', dataset: { personId: p.id } }, [
      el('td', { class: 'ao-col-num', text: String(i + 1) }),
      el('td', { class: 'ao-col-here' }, [el('input', {
        type: 'checkbox', class: 'ao-here', checked: !p.absent, 'aria-label': `${label} is here`, dataset: { field: 'present' },
      })]),
      el('td', {}, [el('input', {
        type: 'text', class: 'form-control form-control-sm ao-cell', value: p.name, autocomplete: 'off', maxlength: '200',
        'aria-label': `Name, row ${i + 1}`, dataset: { field: 'name' },
      })]),
      el('td', { class: 'ao-col-del' }, [el('button', {
        type: 'button', class: 'btn btn-link ao-row-delete ao-person-delete', 'aria-label': `Delete ${label}`, text: '×',
      })]),
    ]);
  }

  function flagDuplicates() {
    const counts = {};
    state.people.forEach((p) => {
      const k = p.name.trim().toLowerCase();
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    els.peopleTable.querySelectorAll('tbody tr').forEach((tr) => {
      const p = state.people.find((x) => x.id === tr.dataset.personId);
      const td = tr.querySelector('[data-field="name"]').parentNode;
      const dup = !!p && counts[p.name.trim().toLowerCase()] > 1;
      td.classList.toggle('is-duplicate', dup);
      td.title = dup ? 'Duplicate name — allowed, but it may be confusing' : '';
    });
  }

  function renderPeopleMeta() {
    const n = activePeople().length;
    const away = namedPeople().length - n;
    els.peopleCount.textContent = plural(n, 'person', 'people') + (away ? ` · ${away} away` : '') +
      (n > SOFT_LIMIT ? ` — large lists (over ${SOFT_LIMIT}) may take a moment to draw` : '');
  }

  els.peopleTable.addEventListener('input', (e) => {
    const input = e.target;
    const tr = input.closest('tr');
    const p = tr && state.people.find((x) => x.id === tr.dataset.personId);
    if (!p) return;
    if (input.dataset.field === 'present') {
      if (input.checked) delete p.absent; else p.absent = true;
      tr.classList.toggle('is-absent', !!p.absent);
      els.peoplePresent.hidden = !state.people.some((x) => x.absent);
    } else if (input.dataset.field === 'name') {
      p.name = input.value;
      flagDuplicates();
    } else return;
    changed();
  });
  els.peopleTable.addEventListener('click', (e) => {
    const btn = e.target.closest('.ao-person-delete');
    if (!btn) return;
    const id = btn.closest('tr').dataset.personId;
    state.people = state.people.filter((p) => p.id !== id);
    changed({ people: true });
  });
  els.peoplePresent.addEventListener('click', () => {
    state.people.forEach((p) => { delete p.absent; });
    changed({ people: true });
  });
  els.peopleClear.addEventListener('click', () => {
    if (!window.confirm(`Remove all ${plural(state.people.length, 'person', 'people')}? ${word()}s and settings are kept.`)) return;
    state.people = [];
    changed({ people: true });
  });
  els.addPerson.addEventListener('click', () => {
    if (state.people.length >= HARD_LIMIT) { U.notice(els.peopleNotice, `That’s the limit of ${HARD_LIMIT} people.`, 'error'); return; }
    const p = { id: uid('p'), name: '' };
    state.people.push(p);
    changed({ people: true });
    const input = els.peopleTable.querySelector(`tr[data-person-id="${CSS.escape(p.id)}"] [data-field="name"]`);
    if (input) input.focus();
  });

  // Paste a list: one name per line; CSV/TSV → first column; a "name" header is skipped.
  function parseNameList(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const filled = lines.filter((l) => l.trim() !== '');
    let delim = null;
    if (filled.some((l) => l.indexOf('\t') !== -1)) delim = '\t';
    else if (filled.length && filled.every((l) => l.indexOf(';') !== -1)) delim = ';';
    else if (filled.length && filled.every((l) => l.indexOf(',') !== -1)) delim = ',';
    const res = { names: [], blank: 0, header: false, duplicates: [] };
    const seen = {};
    lines.forEach((line, i) => {
      let cell = delim ? line.split(delim)[0] : line;
      cell = cell.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"').trim();
      if (!cell) { if (i < lines.length - 1 || line.trim()) res.blank += 1; return; }
      if (!res.names.length && !res.header && /^(names?|person|people)$/i.test(cell)) { res.header = true; return; }
      if (seen[cell]) { if (res.duplicates.indexOf(cell) === -1) res.duplicates.push(cell); return; }
      seen[cell] = true;
      res.names.push(cell.slice(0, 200));
    });
    return res;
  }

  function closePaste() {
    pastePlan = null;
    els.paste.hidden = true;
    els.pasteResult.innerHTML = '';
    els.pasteToggle.setAttribute('aria-expanded', 'false');
  }

  function renderPastePreview() {
    const plan = pastePlan;
    const box = els.pasteResult;
    box.innerHTML = '';
    const r = plan.parsed;
    const bits = [];
    if (r.header) bits.push('header line skipped');
    if (r.blank) bits.push(`${plural(r.blank, 'blank line')} skipped`);
    if (r.duplicates.length) bits.push(`${plural(r.duplicates.length, 'duplicate')} skipped (${r.duplicates.map((d) => `“${d}”`).join(', ')})`);
    box.appendChild(el('p', { class: 'ao-paste-summary', text: `${plural(r.names.length, 'name')} ready to import.` }));
    if (bits.length) box.appendChild(el('p', { class: 'ao-help muted ao-paste-report', text: bits.join(' · ') + '.' }));
    if (r.names.length) {
      box.appendChild(el('p', { class: 'ao-paste-names' }, r.names.slice(0, 40).map((n) => el('span', { class: 'ao-name-chip', text: n }))
        .concat(r.names.length > 40 ? [el('span', { class: 'muted', text: ` +${r.names.length - 40} more` })] : [])));
    }
    const replace = el('input', { type: 'checkbox', id: 'ao-paste-replace', checked: plan.replace });
    replace.addEventListener('change', () => { plan.replace = replace.checked; renderPastePreview(); });
    const total = (plan.replace ? 0 : state.people.length) + r.names.length;
    const btn = el('button', {
      type: 'button', id: 'ao-paste-import', class: 'btn btn-primary btn-sm',
      text: `Import ${plural(r.names.length, 'person', 'people')}`, disabled: !r.names.length || total > HARD_LIMIT,
    });
    btn.addEventListener('click', () => {
      const fresh = r.names.map((name) => ({ id: uid('p'), name }));
      state.people = plan.replace ? fresh : state.people.concat(fresh);
      closePaste();
      els.pasteText.value = '';
      U.notice(els.peopleNotice, `Imported ${plural(fresh.length, 'person', 'people')}.`);
      changed({ people: true });
    });
    box.appendChild(el('div', { class: 'btn-row ao-paste-actions' }, [btn, el('label', { class: 'ao-check' }, [replace, ' Replace current people'])]));
    if (total > HARD_LIMIT) box.appendChild(el('p', { class: 'ao-field-error', text: `That would make ${total} people — the limit is ${HARD_LIMIT}.` }));
  }

  els.pasteToggle.addEventListener('click', () => {
    if (!els.paste.hidden) { closePaste(); return; }
    els.paste.hidden = false;
    els.pasteToggle.setAttribute('aria-expanded', 'true');
    els.pasteText.focus();
  });
  els.pasteCancel.addEventListener('click', closePaste);
  els.pastePreview.addEventListener('click', () => {
    const parsed = parseNameList(els.pasteText.value);
    if (!parsed.names.length && !parsed.duplicates.length) {
      els.pasteResult.innerHTML = '';
      els.pasteResult.appendChild(el('p', { class: 'ao-field-error', text: 'Paste at least one name first.' }));
      return;
    }
    pastePlan = { parsed, replace: false };
    renderPastePreview();
  });

  // Group Draw file → people only. The user picks Replace or Add.
  function closeImportPanel() {
    importPlan = null;
    els.importPanel.hidden = true;
    els.importPanel.innerHTML = '';
  }

  function showImportPanel(plan) {
    importPlan = plan;
    const box = els.importPanel;
    box.innerHTML = '';
    const away = plan.people.filter((p) => p.absent).length;
    box.appendChild(el('p', { class: 'ao-panel-title', text: `Group Draw file: ${plural(plan.people.length, 'person', 'people')}${away ? `, ${away} away` : ''}.` }));
    box.appendChild(el('p', { class: 'ao-help muted', text: 'Only names and who is away are used — attributes, rules and groups are ignored. Group Draw itself is not changed.' }));
    const replace = el('button', { type: 'button', id: 'ao-import-replace', class: 'btn btn-primary btn-sm', text: 'Replace people' });
    const add = el('button', { type: 'button', id: 'ao-import-add', class: 'btn btn-outline-secondary btn-sm', text: 'Add to existing' });
    const cancel = el('button', { type: 'button', id: 'ao-import-cancel', class: 'btn btn-link btn-sm', text: 'Cancel' });
    replace.addEventListener('click', () => commitImport(true));
    add.addEventListener('click', () => commitImport(false));
    cancel.addEventListener('click', closeImportPanel);
    if (!state.people.length) add.hidden = true;
    box.appendChild(el('div', { class: 'btn-row' }, [replace, add, cancel]));
    box.hidden = false;
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
    replace.focus({ preventScroll: true });
  }

  function commitImport(replace) {
    const plan = importPlan;
    if (!plan) return;
    const base = replace ? [] : state.people;
    const room = Math.max(0, HARD_LIMIT - base.length);
    const fresh = plan.people.slice(0, room).map((p) => Object.assign({ id: uid('p') }, p));
    state.people = base.concat(fresh);
    closeImportPanel();
    const away = fresh.filter((p) => p.absent).length;
    let msg = `${plural(fresh.length, 'person', 'people')} loaded${away ? `, ${away} away` : ''}${plan.ignored ? '; attributes and rules were not used' : ''}.`;
    if (fresh.length < plan.people.length) msg += ` ${plan.people.length - fresh.length} skipped (limit ${HARD_LIMIT}).`;
    U.notice(els.peopleNotice, msg);
    changed({ people: true });
  }

  // ---- Step 2: labels -----------------------------------------------------

  function validLabelName(name, exceptId) {
    const n = name.trim();
    if (!n) return `Give the ${wordLower(1)} a name.`;
    if (state.labels.some((l) => l.id !== exceptId && sameName(l.name, n))) return `There is already a ${wordLower(1)} called “${n}”.`;
    return '';
  }

  function renderLabels() {
    const tbody = els.labelsTable.tBodies[0];
    tbody.innerHTML = '';
    state.labels.forEach((l, i) => tbody.appendChild(labelRow(l, i)));
    els.labelsWrap.hidden = !state.labels.length;
    els.labelsEmpty.hidden = state.labels.length > 0;
    renderAllOnce();
  }

  function labelRow(l, i) {
    const name = el('input', {
      type: 'text', class: 'form-control form-control-sm ao-cell ao-label-name-input', value: l.name, maxlength: '100',
      autocomplete: 'off', 'aria-label': `Name of ${wordLower(1)} ${i + 1}`, dataset: { field: 'name' },
    });
    const slots = el('input', {
      type: 'number', class: 'form-control form-control-sm ao-slots-input', min: '1', max: String(MAX_SLOTS), inputmode: 'numeric',
      value: l.slots === null ? '' : String(l.slots), disabled: l.slots === null, 'aria-label': `Slots per round for ${l.name}`, dataset: { field: 'slots' },
    });
    const unlimited = el('input', { type: 'checkbox', class: 'ao-unlimited', checked: l.slots === null, dataset: { field: 'unlimited' }, 'aria-label': `Unlimited slots for ${l.name}` });
    const once = el('input', { type: 'checkbox', class: 'ao-once', checked: !!l.once, dataset: { field: 'once' }, 'aria-label': `${l.name}: once per person` });
    return el('tr', { dataset: { labelId: l.id } }, [
      el('td', { class: 'ao-col-num' }, [el('span', { class: 'ao-swatch', style: colorVar(l), 'aria-hidden': 'true' }), String(i + 1)]),
      el('td', { class: 'ao-col-name' }, [name]),
      el('td', { class: 'ao-col-slots' }, [el('div', { class: 'ao-slots' }, [slots, el('label', { class: 'ao-check ao-inf', title: 'Unlimited' }, [unlimited, el('span', { text: '∞' })])])]),
      el('td', { class: 'ao-col-once' }, [once]),
      el('td', { class: 'ao-col-del' }, [el('button', { type: 'button', class: 'btn btn-link ao-row-delete ao-label-delete', 'aria-label': `Delete ${l.name}`, text: '×' })]),
    ]);
  }

  function cellMessage(td, message) {
    let msg = td.querySelector('.ao-cell-msg');
    if (!message) { if (msg) msg.remove(); td.classList.remove('is-invalid'); return; }
    if (!msg) { msg = el('span', { class: 'ao-cell-msg', role: 'alert' }); td.appendChild(msg); }
    msg.textContent = message;
    td.classList.add('is-invalid');
  }

  function renderAllOnce() {
    const n = state.labels.length;
    const on = state.labels.filter((l) => l.once).length;
    els.allOnce.checked = n > 0 && on === n;
    els.allOnce.indeterminate = on > 0 && on < n;
    els.allOnce.disabled = !n;
  }

  function renderLabelsMeta() {
    const n = state.labels.length;
    const finite = state.labels.filter((l) => l.slots !== null).reduce((s, l) => s + l.slots, 0);
    const inf = state.labels.some((l) => l.slots === null);
    els.labelsCount.textContent = n
      ? `${plural(n, wordLower(1), wordLower(2))} · ${inf ? (finite ? `${finite} + unlimited` : 'unlimited') : plural(finite, 'slot')} per round`
      : '';
  }

  els.labelsTable.addEventListener('input', (e) => {
    const input = e.target;
    const tr = input.closest('tr');
    const l = tr && state.labels.find((x) => x.id === tr.dataset.labelId);
    if (!l) return;
    const td = input.closest('td');
    const field = input.dataset.field;
    if (field === 'name') {
      const err = validLabelName(input.value, l.id);
      cellMessage(td, err);
      if (err) return;
      l.name = input.value.trim();
      changed();
      return;
    }
    if (field === 'slots') {
      const raw = input.value.trim();
      const ok = /^\d+$/.test(raw) && parseInt(raw, 10) >= 1 && parseInt(raw, 10) <= MAX_SLOTS;
      cellMessage(td, ok ? '' : `1–${MAX_SLOTS}`);
      if (!ok) return;
      l.slots = parseInt(raw, 10);
      changed();
      renderLabelsMeta();
      return;
    }
    if (field === 'unlimited') {
      const slots = tr.querySelector('[data-field="slots"]');
      cellMessage(td, '');
      if (input.checked) { l.slots = null; slots.value = ''; slots.disabled = true; } else {
        l.slots = intIn(slots.value, 1, MAX_SLOTS, 1);
        slots.value = String(l.slots);
        slots.disabled = false;
      }
      changed();
      return;
    }
    if (field === 'once') {
      l.once = input.checked;
      renderAllOnce();
      changed();
    }
  });
  // Leaving a name/slots cell with an invalid value puts the saved value back.
  els.labelsTable.addEventListener('change', (e) => {
    const input = e.target;
    const tr = input.closest('tr');
    const l = tr && state.labels.find((x) => x.id === tr.dataset.labelId);
    if (!l) return;
    if (input.dataset.field === 'name' && validLabelName(input.value, l.id)) {
      input.value = l.name;
      cellMessage(input.closest('td'), '');
    } else if (input.dataset.field === 'slots' && l.slots !== null && String(l.slots) !== input.value.trim()) {
      input.value = String(l.slots);
      cellMessage(input.closest('td'), '');
    }
  });
  els.labelsTable.addEventListener('click', (e) => {
    const btn = e.target.closest('.ao-label-delete');
    if (!btn) return;
    const id = btn.closest('tr').dataset.labelId;
    state.labels = state.labels.filter((l) => l.id !== id);
    changed({ labels: true });
  });

  els.allOnce.addEventListener('change', () => {
    const on = els.allOnce.checked;
    state.labels.forEach((l) => { l.once = on; });
    changed({ labels: true });
  });

  els.word.addEventListener('input', () => {
    state.settings.word = els.word.value.slice(0, 30);
    scheduleSave();
    renderMeta();
    renderLabelsMeta();
    renderHints();
    if (shown) renderSummary(shown);
  });

  function syncFormUnlimited() {
    els.labelSlots.disabled = els.labelUnlimited.checked;
  }
  els.labelUnlimited.addEventListener('change', syncFormUnlimited);

  els.labelForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = els.labelName.value.trim();
    const err = validLabelName(name);
    if (err) { els.labelError.textContent = err; els.labelName.focus(); return; }
    if (state.labels.length >= LABEL_LIMIT) { els.labelError.textContent = `That’s the limit of ${LABEL_LIMIT} ${wordLower(2)}.`; return; }
    let slots = null;
    if (!els.labelUnlimited.checked) {
      const raw = els.labelSlots.value.trim();
      if (!/^\d+$/.test(raw) || parseInt(raw, 10) < 1 || parseInt(raw, 10) > MAX_SLOTS) {
        els.labelError.textContent = `Slots per round must be a whole number from 1 to ${MAX_SLOTS} (or tick ∞).`;
        els.labelSlots.focus();
        return;
      }
      slots = parseInt(raw, 10);
    }
    els.labelError.textContent = '';
    state.labels.push({ id: uid('l'), name, slots, once: els.labelOnce.checked, color: nextColor() });
    els.labelName.value = '';
    changed({ labels: true });
    els.labelName.focus();
  });

  // Paste labels: one per line, optional "x3" / "×3" suffix for the slots.
  function parseLabelList(text) {
    const out = { labels: [], skipped: [] };
    String(text).replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      const raw = line.trim();
      if (!raw) return;
      const m = raw.match(/^(.*?)\s*[x×*]\s*(\d+|∞)$/i);
      let name = raw;
      let slots = 1;
      if (m && m[1].trim()) {
        name = m[1].trim();
        slots = m[2] === '∞' ? null : intIn(m[2], 1, MAX_SLOTS, 1);
      }
      if (state.labels.concat(out.labels).some((l) => sameName(l.name, name))) { out.skipped.push(name); return; }
      out.labels.push({ name: name.slice(0, 100), slots });
    });
    return out;
  }

  function closeLabelsPaste() {
    els.labelsPaste.hidden = true;
    els.labelsPasteToggle.setAttribute('aria-expanded', 'false');
  }
  els.labelsPasteToggle.addEventListener('click', () => {
    if (!els.labelsPaste.hidden) { closeLabelsPaste(); return; }
    els.labelsPaste.hidden = false;
    els.labelsPasteToggle.setAttribute('aria-expanded', 'true');
    els.labelsPasteText.focus();
  });
  els.labelsPasteCancel.addEventListener('click', closeLabelsPaste);
  els.labelsPasteAdd.addEventListener('click', () => {
    const res = parseLabelList(els.labelsPasteText.value);
    const room = LABEL_LIMIT - state.labels.length;
    const fresh = res.labels.slice(0, Math.max(0, room));
    if (!fresh.length && !res.skipped.length) { U.notice(els.labelsNotice, `Paste at least one ${wordLower(1)} first.`, 'error'); return; }
    fresh.forEach((l) => state.labels.push({ id: uid('l'), name: l.name, slots: l.slots, once: false, color: nextColor() }));
    let msg = `Added ${plural(fresh.length, wordLower(1), wordLower(2))}.`;
    if (res.skipped.length) msg += ` Skipped ${plural(res.skipped.length, 'duplicate')}: ${res.skipped.map((n) => `“${n}”`).join(', ')}.`;
    if (res.labels.length > fresh.length) msg += ` ${res.labels.length - fresh.length} over the limit of ${LABEL_LIMIT}.`;
    U.notice(els.labelsNotice, msg, res.skipped.length ? 'warning' : '');
    if (fresh.length) { els.labelsPasteText.value = ''; closeLabelsPaste(); }
    changed({ labels: true });
  });

  // ---- Step 3: settings + hints ---------------------------------------------

  function renderSettings() {
    const s = state.settings;
    els.rounds.value = String(s.rounds);
    els.variety.checked = s.variety !== false;
    els.unfilled.checked = s.allowUnfilled !== false;
    els.word.value = s.word || '';
  }

  function renderPerPerson() {
    const max = Math.max(1, Math.min(LABEL_LIMIT, Math.max(state.labels.length, state.settings.perPerson)));
    const cur = state.settings.perPerson;
    if (els.perPerson.options.length !== max) {
      els.perPerson.innerHTML = '';
      for (let i = 1; i <= max; i++) els.perPerson.appendChild(el('option', { value: String(i), text: String(i) }));
    }
    els.perPerson.value = String(cur);
  }

  els.rounds.addEventListener('input', () => {
    const raw = els.rounds.value.trim();
    if (!/^\d+$/.test(raw)) return;
    state.settings.rounds = intIn(raw, 1, MAX_ROUNDS, 1);
    kept = new Set();
    changed();
  });
  els.rounds.addEventListener('change', () => { els.rounds.value = String(state.settings.rounds); });
  els.perPerson.addEventListener('change', () => {
    state.settings.perPerson = intIn(els.perPerson.value, 1, LABEL_LIMIT, 1);
    changed();
  });
  els.variety.addEventListener('change', () => { state.settings.variety = els.variety.checked; changed(); });
  els.unfilled.addEventListener('change', () => { state.settings.allowUnfilled = els.unfilled.checked; changed(); });

  function renderHints() {
    const P = activePeople().length;
    const L = state.labels.length;
    const A = state.settings.perPerson;
    const box = els.balance;
    box.innerHTML = '';
    box.className = 'ao-balance';
    if (!P || !L) {
      box.textContent = !P ? 'Add people in step 1 — then the picks per round show up here.' : `Add ${wordLower(2)} in step 2 to hand out.`;
    } else {
      const finite = state.labels.filter((l) => l.slots !== null).reduce((s, l) => s + l.slots, 0);
      const inf = state.labels.some((l) => l.slots === null);
      const demand = P * A;
      const supply = inf ? (finite ? `${finite} + unlimited slots` : 'unlimited slots') : plural(finite, 'slot');
      box.appendChild(el('span', { class: 'ao-balance-num', text: `${plural(P, 'person', 'people')} × ${A} = ${plural(demand, 'pick')}` }));
      box.appendChild(document.createTextNode(' per round · '));
      box.appendChild(el('span', { class: 'ao-balance-num', text: `${wordLower(2)} offer ${supply}` }));
      const ok = inf || finite >= demand;
      box.classList.add(ok ? (finite === demand && !inf ? 'is-exact' : 'is-ok') : 'is-short');
    }
    els.hints.innerHTML = '';
    Solver.validateHints(state).forEach((h) => {
      els.hints.appendChild(el('li', { class: `ao-hint is-${h.level}`, dataset: { code: h.code } }, [
        el('span', { 'aria-hidden': 'true', text: h.level === 'error' ? '⛔' : '⚠️' }), el('span', { text: wordify(h.message) }),
      ]));
    });
  }

  // ---- Draw ---------------------------------------------------------------

  function keepActive() {
    return !!shown && shown.version === version && shown.rounds.length > 1 && kept.size > 0;
  }

  function renderKeep() {
    const bar = els.keepBar;
    bar.innerHTML = '';
    const ok = !!shown && shown.version === version && shown.rounds.length > 1;
    bar.hidden = !ok;
    if (!ok) {
      els.keepHint.hidden = true;
      els.draw.disabled = !!running;
      return;
    }
    bar.appendChild(el('span', { class: 'ao-keep-title', text: 'Keep:' }));
    shown.rounds.forEach((r, i) => {
      const box = el('input', { type: 'checkbox', class: 'ao-keep-box', checked: kept.has(i), dataset: { round: String(i + 1) }, 'aria-label': `Keep round ${i + 1} as it is` });
      box.addEventListener('change', () => {
        if (box.checked) kept.add(i); else kept.delete(i);
        renderKeep();
      });
      bar.appendChild(el('label', { class: 'ao-keep' + (kept.has(i) ? ' is-kept' : '') }, [box, el('span', { text: `🔒 Round ${i + 1}` })]));
    });
    const all = kept.size >= shown.rounds.length;
    els.keepHint.hidden = !kept.size;
    els.keepHint.textContent = all
      ? 'Every round is kept — untick one to redraw.'
      : (kept.size ? `“Draw again” redraws the other ${plural(shown.rounds.length - kept.size, 'round')} and keeps ${plural(kept.size, 'round')} as they are.` : '');
    els.draw.disabled = !!running || all;
    els.results.querySelectorAll('[data-round]').forEach((node) => {
      node.classList.toggle('is-kept', kept.has(parseInt(node.dataset.round, 10) - 1));
    });
  }

  function setBusy(on) {
    const reduce = reduceMotion();
    els.draw.classList.toggle('is-spinning', on && !reduce);
    if (on) els.draw.setAttribute('aria-busy', 'true'); else els.draw.removeAttribute('aria-busy');
    els.draw.disabled = on;
    if (!on) els.cancel.hidden = true;
    renderMeta();
  }

  function draw() {
    if (running) return;
    const P = activePeople().length;
    if (!P) {
      showStatus(namedPeople().length ? 'Everyone is marked away — tick who is here (step 1).' : 'Add at least one person (step 1) to hand out labels.');
      return;
    }
    if (!state.labels.length) { showStatus(`Add at least one ${wordLower(1)} (step 2) to hand out.`); return; }
    const keepOn = keepActive();
    if (keepOn && kept.size >= shown.rounds.length) { showStatus('Every round is kept — untick one to redraw.'); return; }
    const opts = {};
    if (keepOn) {
      opts.keep = {};
      kept.forEach((r) => { opts.keep[r] = shown.rounds[r].assignments; });
    }
    const seq = ++drawSeq;
    const setup = clone(state);
    const setupVersion = version;
    const startedAt = Date.now();
    const keptList = keepOn ? Array.from(kept).sort((a, b) => a - b) : [];
    running = { seq };
    setBusy(true);
    els.copyFallback.hidden = true;
    const slowTimer = setTimeout(() => {
      if (!running || running.seq !== seq) return;
      els.cancel.hidden = false;
      showStatus('Searching for an assignment that fits every rule…');
    }, 450);
    runner.run(setup, opts).then((result) => result, (err) => ({ status: 'error', message: `Something went wrong — please try again. (${err && err.message ? err.message : err})` }))
      .then((result) => {
        clearTimeout(slowTimer);
        if (!running || running.seq !== seq) return;
        const wait = reduceMotion() || (result && result.status === 'cancelled') ? 0 : Math.max(0, 650 - (Date.now() - startedAt));
        setTimeout(() => finish(result || { status: 'error' }, setup, setupVersion, keptList), wait);
      });
  }

  function finish(result, setup, setupVersion, keptList) {
    running = null;
    setBusy(false);
    els.alert.hidden = true;
    els.alert.innerHTML = '';
    if (result.status === 'ok') {
      const entry = makeEntry(result, setup, setupVersion, keptList);
      history.unshift(entry);
      history = history.slice(0, HISTORY_MAX);
      if (!keptList.length) kept = new Set();
      display(entry, true);
      renderHistory();
      const R = entry.rounds.length;
      const people = plural(entry.people.length, 'person', 'people');
      showStatus(keptList.length
        ? `Redrew ${plural(R - keptList.length, 'round')} for ${people}, kept ${keptList.length}.`
        : `Drew ${plural(R, 'round')} for ${people}.`, true);
    } else renderFailure(result);
    renderMeta();
    markOutdated();
  }

  function renderFailure(result) {
    const box = els.alert;
    box.className = 'ao-alert is-error';
    if (result.status === 'cancelled') { showStatus('Draw cancelled.'); return; }
    if (result.status === 'empty' || result.status === 'error') { showStatus(wordify(result.message || 'Something went wrong — please try again.')); return; }
    const title = result.status === 'timeout'
      ? 'Couldn’t find a valid assignment in time (it may not exist).'
      : 'These settings can’t all be met — no valid assignment exists.';
    box.appendChild(el('p', { class: 'ao-alert-title', text: title }));
    if (result.reasons && result.reasons.length) {
      box.appendChild(el('ul', { class: 'ao-reasons' }, result.reasons.map((r) => el('li', { text: wordify(r) }))));
    }
    box.appendChild(el('p', { class: 'ao-alert-sub muted', text: wordify('Add slots or labels, lower “per person per round” or the rounds, or untick “once per person” on some labels.') }));
    box.hidden = false;
    showStatus(result.status === 'timeout' ? 'Couldn’t find a valid assignment in time.' : 'Couldn’t draw: the settings can’t all be met.');
    if (shown) { els.resultsWrap.classList.add('is-outdated'); els.outdated.hidden = false; }
  }

  function showStatus(text, highlight) {
    els.status.textContent = '';
    els.status.classList.remove('is-fresh');
    if (!reduceMotion()) { void els.status.offsetWidth; els.status.classList.add('is-fresh'); }
    const m = highlight && text.match(/^(\D*?)(\d+)( .*)$/);
    if (m) {
      els.status.appendChild(document.createTextNode(m[1]));
      els.status.appendChild(el('span', { class: 'highlight', text: m[2] }));
      els.status.appendChild(document.createTextNode(m[3]));
      return;
    }
    els.status.textContent = text;
  }

  // Snapshot everything needed to show this draw later, even after edits.
  function makeEntry(result, setup, setupVersion, keptList) {
    const people = setup.people.filter((p) => p.name.trim() && !p.absent).map((p) => ({ id: p.id, name: p.name.trim() }));
    const labels = setup.labels.map((l) => ({ id: l.id, name: l.name, slots: l.slots, once: l.once, color: l.color || 0 }));
    return {
      no: drawSeq, time: new Date(), version: setupVersion,
      rounds: result.rounds, repeats: result.repeats || 0, method: result.method,
      people, labels, perPerson: setup.settings.perPerson, variety: setup.settings.variety !== false,
      word: setup.settings.word || '', kept: keptList || [],
    };
  }

  function labelMap(entry) {
    const map = {};
    entry.labels.forEach((l) => { map[l.id] = l; });
    return map;
  }

  function chip(label, extra) {
    return el('span', { class: 'ao-chip' + (extra ? ' ' + extra : ''), style: colorVar(label), dataset: { labelId: label.id } }, [
      el('span', { class: 'ao-chip-dot', 'aria-hidden': 'true' }), el('span', { class: 'ao-chip-text', text: label.name }),
    ]);
  }

  function renderSummary(entry) {
    const R = entry.rounds.length;
    const w = String(entry.word || '').trim().toLowerCase() || 'label';
    let text = `${plural(entry.people.length, 'person', 'people')} · ${plural(R, 'round')} · ${plural(entry.perPerson, w)} each`;
    if (entry.variety && R > 1) {
      text += entry.repeats
        ? ` · Repeats: ${entry.repeats} (a person got a ${w} again in a later round)`
        : ' · Repeats: 0 — nobody got the same thing twice 🎉';
    }
    els.summary.textContent = text;
    els.summary.dataset.repeats = String(entry.repeats);
  }

  function display(entry, animate) {
    shown = entry;
    const reduce = reduceMotion() || !animate;
    els.results.innerHTML = '';
    els.results.dataset.drawNo = String(entry.no);
    els.results.dataset.view = viewMode;
    els.results.appendChild(viewMode === 'label' ? byLabel(entry, reduce) : byPerson(entry, reduce));
    renderSummary(entry);
    els.viewPerson.setAttribute('aria-pressed', String(viewMode === 'person'));
    els.viewLabel.setAttribute('aria-pressed', String(viewMode === 'label'));
    els.resultHead.hidden = false;
    els.actions.hidden = false;
    markOutdated();
    renderHistoryCurrent();
  }

  function byPerson(entry, reduce) {
    const labels = labelMap(entry);
    const R = entry.rounds.length;
    const frozen = new Set(entry.kept);
    const head = el('tr', {}, [el('th', { scope: 'col', class: 'ao-col-person', text: 'Person' })]);
    for (let r = 0; r < R; r++) head.appendChild(el('th', { scope: 'col', dataset: { round: String(r + 1) }, text: `Round ${r + 1}` }));
    const tbody = el('tbody');
    const n = entry.people.length;
    const rowStep = Math.min(60, 900 / Math.max(1, n));
    entry.people.forEach((p, i) => {
      const tr = el('tr', { dataset: { personId: p.id } }, [el('th', { scope: 'row', class: 'ao-col-person', text: p.name })]);
      for (let r = 0; r < R; r++) {
        const ids = entry.rounds[r].assignments[p.id] || [];
        const td = el('td', { dataset: { round: String(r + 1) } });
        ids.forEach((id, j) => {
          const c = chip(labels[id]);
          if (!reduce && !frozen.has(r)) {
            c.style.animationDelay = Math.round(i * rowStep + 160 + (r * ids.length + j) * 45) + 'ms';
            c.classList.add('is-popping');
          }
          td.appendChild(c);
        });
        tr.appendChild(td);
      }
      if (!reduce) {
        tr.style.animationDelay = Math.round(i * rowStep) + 'ms';
        tr.classList.add('is-dealt');
      }
      tbody.appendChild(tr);
    });
    return el('div', { class: 'ao-table-wrap ao-result-wrap' }, [
      el('table', { class: 'ao-table ao-result-table' }, [el('thead', {}, [head]), tbody]),
    ]);
  }

  function byLabel(entry, reduce) {
    const R = entry.rounds.length;
    const names = {};
    entry.people.forEach((p) => { names[p.id] = p.name; });
    const wrap = el('div', { class: 'ao-label-blocks' });
    entry.labels.forEach((l, li) => {
      const block = el('section', { class: 'ao-label-block', style: colorVar(l), dataset: { labelId: l.id } }, [
        el('h3', { class: 'ao-label-block-name' }, [chip(l), el('span', { class: 'ao-label-block-meta muted', text: `${l.slots === null ? '∞' : '×' + l.slots} per round${l.once ? ' · once per person' : ''}` })]),
      ]);
      for (let r = 0; r < R; r++) {
        const rd = entry.rounds[r];
        const who = entry.people.filter((p) => (rd.assignments[p.id] || []).indexOf(l.id) !== -1);
        const line = el('p', { class: 'ao-label-round', dataset: { round: String(r + 1) } }, [el('span', { class: 'ao-round-tag', text: R > 1 ? `Round ${r + 1}` : 'Round 1' })]);
        who.forEach((p) => line.appendChild(el('span', { class: 'ao-person-chip', dataset: { personId: p.id }, text: names[p.id] })));
        for (let k = 0; k < (rd.free[l.id] || 0); k++) line.appendChild(el('span', { class: 'ao-free', text: '— free —' }));
        if (!who.length && !(rd.free[l.id] || 0)) line.appendChild(el('span', { class: 'ao-free', text: 'nobody' }));
        block.appendChild(line);
      }
      if (!reduce) {
        block.style.animationDelay = Math.round(li * Math.min(90, 900 / Math.max(1, entry.labels.length))) + 'ms';
        block.classList.add('is-dealt');
      }
      wrap.appendChild(block);
    });
    return wrap;
  }

  function setView(mode) {
    if (viewMode === mode) return;
    viewMode = mode;
    if (shown) display(shown, false);
  }
  els.viewPerson.addEventListener('click', () => setView('person'));
  els.viewLabel.addEventListener('click', () => setView('label'));

  function renderHistory() {
    els.history.innerHTML = '';
    history.forEach((entry) => {
      const time = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const btn = el('button', { type: 'button', class: 'ao-history-btn', dataset: { drawNo: String(entry.no) } }, [
        el('span', { class: 'ao-history-no', text: `#${entry.no}` }),
        el('span', { text: `${plural(entry.rounds.length, 'round')} · ${time}` }),
        entry.kept.length ? el('span', { class: 'ao-badge', text: `${entry.kept.length} kept` }) : null,
      ]);
      btn.addEventListener('click', () => {
        kept = new Set();
        display(entry, false);
        showStatus(`Showing draw #${entry.no}.`);
      });
      els.history.appendChild(el('li', {}, [btn]));
    });
    els.historyWrap.hidden = history.length < 2;
    renderHistoryCurrent();
  }

  function renderHistoryCurrent() {
    els.history.querySelectorAll('.ao-history-btn').forEach((b) => {
      b.setAttribute('aria-current', shown && String(shown.no) === b.dataset.drawNo ? 'true' : 'false');
    });
  }

  els.draw.addEventListener('click', draw);
  els.cancel.addEventListener('click', () => runner.cancel({ status: 'cancelled' }));

  // ---- Result export ----------------------------------------------------------

  function resultText(entry) {
    const labels = labelMap(entry);
    const R = entry.rounds.length;
    return entry.people.map((p) => {
      const parts = entry.rounds.map((rd, r) => {
        const names = (rd.assignments[p.id] || []).map((id) => labels[id].name).join(', ');
        return R > 1 ? `R${r + 1} ${names}` : names;
      });
      return `${p.name}: ${parts.join(' · ')}`;
    }).join('\n') + '\n';
  }

  function resultCsv(entry) {
    const labels = labelMap(entry);
    const head = ['person'].concat(entry.rounds.map((rd, r) => `round ${r + 1}`));
    const lines = [head.map(U.csvCell).join(',')];
    entry.people.forEach((p) => {
      const row = [p.name].concat(entry.rounds.map((rd) => (rd.assignments[p.id] || []).map((id) => labels[id].name).join('; ')));
      lines.push(row.map(U.csvCell).join(','));
    });
    return lines.join('\n') + '\n';
  }

  els.copy.addEventListener('click', () => {
    if (!shown) return;
    const text = resultText(shown);
    U.copyText(text).then((ok) => {
      if (ok) {
        els.copy.textContent = 'Copied ✓';
        setTimeout(() => { els.copy.textContent = 'Copy as text'; }, 1500);
        return;
      }
      els.copyText.value = text;
      els.copyFallback.hidden = false;
      els.copyText.focus();
      els.copyText.select();
    });
  });
  els.csv.addEventListener('click', () => { if (shown) U.download('assign-options.csv', resultCsv(shown), 'text/csv'); });

  // ---- Presenter: full screen, all at once or person by person ------------------
  // Only shows a finished draw. The one random thing here is the optional
  // "Shuffle order" (who is announced when), drawn with randomIndex.

  const prefs = { mode: 'all', byRound: false, shuffle: false }; // remembered for this page session
  let present = null;

  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function closePresenter() {
    if (!present) return;
    const p = present;
    present = null;
    document.removeEventListener('keydown', p.onKey, true);
    window.removeEventListener('resize', p.onResizeHandler);
    if (document.fullscreenElement && document.exitFullscreen) {
      try { const r = document.exitFullscreen(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not in fullscreen */ }
    }
    p.root.remove();
    document.body.classList.remove('ao-presenting');
    if (p.lastFocus && p.lastFocus.focus) p.lastFocus.focus();
  }

  function btn(cls, text, attrs) {
    return el('button', Object.assign({ type: 'button', class: cls, text }, attrs || {}));
  }

  function openPresenter() {
    if (!shown || present) return;
    const entry = shown;
    const labels = labelMap(entry);
    const R = entry.rounds.length;
    const live = el('p', { class: 'ao-present-live', 'aria-live': 'polite' });
    const body = el('div', { class: 'ao-present-body' });
    const close = btn('btn btn-outline-secondary btn-sm ao-present-close', '✕ Close', { 'aria-label': 'Close presenter' });
    const full = btn('btn btn-outline-secondary btn-sm ao-present-full', 'Full screen');
    const title = el('h2', { class: 'ao-present-title', text: 'Present the draw' });
    const info = el('span', { class: 'ao-present-info' });
    const controls = el('div', { class: 'ao-present-controls' });
    const root = el('div', { class: 'ao-present', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Present the draw' }, [
      el('div', { class: 'ao-present-bar' }, [title, info, controls, el('div', { class: 'ao-present-corner' }, [full, close])]),
      body, live,
    ]);
    const p = { root, lastFocus: document.activeElement, onResize: () => {}, step: () => {}, back: () => {} };

    function setControls(list) {
      controls.innerHTML = '';
      list.forEach((c) => { if (c) controls.appendChild(c); });
    }
    function say(text) { live.textContent = text; }
    function cellChips(ids, hidden) {
      const wrap = el('span', { class: 'ao-present-chips' });
      if (hidden) { wrap.appendChild(el('span', { class: 'ao-present-q', text: '?' })); return wrap; }
      ids.forEach((id) => wrap.appendChild(chip(labels[id])));
      return wrap;
    }

    // Start dialog: pick a mode (remembered for this session).
    function startScreen() {
      title.textContent = 'Present the draw';
      info.textContent = `${plural(entry.people.length, 'person', 'people')} · ${plural(R, 'round')}`;
      body.innerHTML = '';
      setControls([]);
      p.step = () => {};
      p.back = () => {};
      const choice = (mode, head, sub) => {
        const b = el('button', { type: 'button', class: 'ao-present-choice', 'aria-pressed': String(prefs.mode === mode), dataset: { mode } }, [
          el('span', { class: 'ao-present-choice-title', text: head }), el('span', { class: 'ao-present-choice-sub', text: sub }),
        ]);
        b.addEventListener('click', () => { prefs.mode = mode; sync(); });
        return b;
      };
      const all = choice('all', '🗂️ All at once', 'Everyone on one screen — optionally round by round.');
      const one = choice('person', '🔦 Person by person', 'A spotlight on each person, labels revealed one by one.');
      const byRound = el('input', { type: 'checkbox', class: 'ao-present-byround', checked: prefs.byRound });
      const shuffle = el('input', { type: 'checkbox', class: 'ao-present-shuffle', checked: prefs.shuffle });
      byRound.addEventListener('change', () => { prefs.byRound = byRound.checked; });
      shuffle.addEventListener('change', () => { prefs.shuffle = shuffle.checked; });
      const byRoundWrap = el('label', { class: 'ao-check' }, [byRound, ' Reveal round by round']);
      const shuffleWrap = el('label', { class: 'ao-check' }, [shuffle, ' Shuffle order']);
      const go = btn('btn btn-primary ao-present-go', 'Start ▶');
      function sync() {
        all.setAttribute('aria-pressed', String(prefs.mode === 'all'));
        one.setAttribute('aria-pressed', String(prefs.mode === 'person'));
        byRoundWrap.hidden = prefs.mode !== 'all' || R < 2;
        shuffleWrap.hidden = prefs.mode !== 'person';
      }
      go.addEventListener('click', () => (prefs.mode === 'person' ? personScreen() : allScreen()));
      body.appendChild(el('div', { class: 'ao-present-start' }, [
        el('div', { class: 'ao-present-choices', role: 'group', 'aria-label': 'How to present' }, [all, one]),
        el('div', { class: 'ao-present-options' }, [byRoundWrap, shuffleWrap]),
        go,
      ]));
      sync();
      go.focus();
    }

    // All at once: a grid of cards, paged to fit; optionally round by round.
    function allScreen() {
      const s = { revealed: prefs.byRound && R > 1 ? 0 : R, page: 0, pages: 1, byLabel: false, finished: false };
      const grid = el('div', { class: 'ao-present-grid' });
      const pageInfo = el('span', { class: 'ao-present-page' });
      const prev = btn('btn btn-outline-secondary btn-sm ao-present-prev', '◀', { 'aria-label': 'Previous page' });
      const nextPage = btn('btn btn-outline-secondary btn-sm ao-present-nextpage', '▶', { 'aria-label': 'Next page' });
      const next = btn('btn btn-primary ao-present-next', 'Reveal next');
      const revealAll = btn('btn btn-outline-secondary btn-sm ao-present-all', 'Reveal all');
      const toggle = btn('btn btn-outline-secondary btn-sm ao-present-bylabel', 'By label', { 'aria-pressed': 'false' });
      title.textContent = 'The draw';
      body.innerHTML = '';
      body.appendChild(grid);
      setControls([toggle, prev, pageInfo, nextPage, next, revealAll]);
      const n = entry.people.length;
      root.style.setProperty('--ao-scale', String(n <= 6 ? 1.35 : n <= 12 ? 1.15 : n <= 30 ? 1 : 0.9));

      function cards(fresh) {
        grid.innerHTML = '';
        const rowClass = (r, hidden) => 'ao-present-row' + (hidden ? ' is-hidden' : '') + (fresh === r + 1 && !reduceMotion() ? ' is-popping' : '');
        if (s.byLabel) {
          entry.labels.forEach((l) => {
            const card = el('section', { class: 'ao-present-card', style: colorVar(l), dataset: { labelId: l.id } }, [el('h3', {}, [chip(l)])]);
            entry.rounds.forEach((rd, r) => {
              const who = entry.people.filter((x) => (rd.assignments[x.id] || []).indexOf(l.id) !== -1).map((x) => x.name);
              const hidden = r >= s.revealed;
              card.appendChild(el('p', { class: rowClass(r, hidden), dataset: { round: String(r + 1) } }, [
                el('span', { class: 'ao-round-tag', text: R > 1 ? `R${r + 1}` : '' }),
                el('span', { class: 'ao-present-names', text: hidden ? '?' : (who.join(', ') || '—') }),
              ]));
            });
            grid.appendChild(card);
          });
        } else {
          entry.people.forEach((x) => {
            const card = el('section', { class: 'ao-present-card', dataset: { personId: x.id } }, [el('h3', { text: x.name })]);
            entry.rounds.forEach((rd, r) => {
              const hidden = r >= s.revealed;
              card.appendChild(el('p', { class: rowClass(r, hidden), dataset: { round: String(r + 1) } }, [
                el('span', { class: 'ao-round-tag', text: R > 1 ? `R${r + 1}` : '' }), cellChips(rd.assignments[x.id] || [], hidden),
              ]));
            });
            grid.appendChild(card);
          });
        }
        paginate();
      }
      // Cards that don't fit the visible area move to the next page.
      function paginate() {
        const list = Array.from(grid.children);
        list.forEach((c) => { c.hidden = false; });
        const H = grid.clientHeight;
        let page = 0;
        let start = list.length ? list[0].offsetTop : 0;
        list.forEach((c) => {
          if (c.offsetTop + c.offsetHeight - start > H + 1 && c.offsetTop > start) { page += 1; start = c.offsetTop; }
          c.dataset.page = String(page);
        });
        s.pages = page + 1;
        s.page = Math.min(s.page, page);
        showPage();
      }
      function showPage() {
        Array.from(grid.children).forEach((c) => { c.hidden = c.dataset.page !== String(s.page); });
        pageInfo.textContent = `Page ${s.page + 1} / ${s.pages}`;
        pageInfo.hidden = prev.hidden = nextPage.hidden = s.pages < 2;
        prev.disabled = s.page === 0;
        nextPage.disabled = s.page >= s.pages - 1;
        paint();
      }
      function paint() {
        const moreRounds = s.revealed < R;
        const morePages = s.page < s.pages - 1;
        next.textContent = moreRounds ? (s.revealed ? `Reveal round ${s.revealed + 1}` : 'Reveal round 1') : (morePages ? 'Next page' : 'All revealed');
        next.disabled = !moreRounds && !morePages;
        revealAll.hidden = !moreRounds;
        info.textContent = moreRounds ? `${s.revealed} / ${R} rounds revealed` : `${plural(entry.people.length, 'person', 'people')} · ${plural(R, 'round')}`;
        if (!moreRounds && !s.finished) {
          s.finished = true;
          U.confetti(root);
          say('Everything is revealed.');
        }
      }
      function goPage(d) {
        const to = Math.max(0, Math.min(s.pages - 1, s.page + d));
        if (to === s.page) return;
        s.page = to;
        showPage();
        say(`Page ${s.page + 1} of ${s.pages}.`);
      }
      p.step = () => {
        if (s.revealed < R) {
          s.revealed += 1;
          cards(s.revealed);
          say(`Round ${s.revealed} revealed.`);
        } else goPage(1);
      };
      p.back = () => goPage(-1);
      next.addEventListener('click', () => p.step());
      prev.addEventListener('click', () => goPage(-1));
      nextPage.addEventListener('click', () => goPage(1));
      revealAll.addEventListener('click', () => { s.revealed = R; cards(); });
      toggle.addEventListener('click', () => {
        s.byLabel = !s.byLabel;
        toggle.setAttribute('aria-pressed', String(s.byLabel));
        toggle.textContent = s.byLabel ? 'By person' : 'By label';
        s.page = 0;
        cards();
      });
      p.onResize = () => paginate();
      cards();
      next.focus();
    }

    // Person by person: spotlight, then each label revealed one by one.
    function personScreen() {
      const order = prefs.shuffle ? shuffled(entry.people) : entry.people.slice();
      const s = { idx: 0, revealed: 0, done: false };
      const bar = el('div', { class: 'ao-present-progressbar', 'aria-hidden': 'true' }, [el('span', { class: 'ao-present-progressfill' })]);
      const progress = el('span', { class: 'ao-present-progress' });
      const back = btn('btn btn-outline-secondary btn-sm ao-present-back', '◀ Back');
      const next = btn('btn btn-primary ao-present-next', 'Reveal next');
      const mine = btn('btn btn-outline-secondary btn-sm ao-present-person-all', 'Reveal all for this person');
      const skip = btn('btn btn-outline-secondary btn-sm ao-present-skip', 'Skip to end ⏭');
      const spot = el('div', { class: 'ao-present-spot' });
      title.textContent = 'Person by person';
      body.innerHTML = '';
      body.appendChild(bar);
      body.appendChild(spot);
      setControls([progress, back, next, mine, skip]);
      root.dataset.order = order.map((x) => x.id).join(',');

      function picks(x) {
        const out = [];
        entry.rounds.forEach((rd, r) => (rd.assignments[x.id] || []).forEach((id) => out.push({ r, id })));
        return out;
      }
      function render(animate) {
        spot.innerHTML = '';
        if (s.done) {
          spot.removeAttribute('data-person-id');
          spot.appendChild(el('span', { class: 'ao-present-spot-name', text: 'That’s everyone! 🎉' }));
          spot.appendChild(el('span', { class: 'ao-present-caption', text: `${plural(order.length, 'person', 'people')} · ${plural(R, 'round')}` }));
          progress.textContent = `${order.length} / ${order.length}`;
          bar.firstChild.style.width = '100%';
          next.disabled = mine.disabled = skip.disabled = true;
          next.textContent = 'All revealed';
          back.disabled = !order.length;
          return;
        }
        const x = order[s.idx];
        const list = picks(x);
        spot.dataset.personId = x.id;
        progress.textContent = `${s.idx + 1} / ${order.length}`;
        bar.firstChild.style.width = `${Math.round(((s.idx + (list.length ? s.revealed / list.length : 1)) / order.length) * 100)}%`;
        const current = s.revealed < list.length ? list[s.revealed].r : R - 1;
        spot.appendChild(el('span', { class: 'ao-present-spot-name' + (animate && !reduceMotion() && !s.revealed ? ' is-fresh' : ''), text: x.name }));
        spot.appendChild(el('span', { class: 'ao-present-caption', text: R > 1 ? `Round ${current + 1} of ${R}` : `${plural(list.length, wordLower(1), wordLower(2))}` }));
        const rounds = el('div', { class: 'ao-present-rounds' });
        let k = 0;
        entry.rounds.forEach((rd, r) => {
          const ids = rd.assignments[x.id] || [];
          const group = el('div', { class: 'ao-present-round' + (r === current && s.revealed < list.length ? ' is-current' : ''), dataset: { round: String(r + 1) } },
            R > 1 ? [el('span', { class: 'ao-round-tag', text: `Round ${r + 1}` })] : []);
          const slots = el('div', { class: 'ao-present-slots' });
          ids.forEach((id) => {
            const shownNow = k < s.revealed;
            const slot = el('span', { class: 'ao-present-slot' + (shownNow ? ' is-shown' : ''), dataset: { labelId: shownNow ? id : '' } });
            if (shownNow) {
              slot.appendChild(chip(labels[id]));
              if (animate && k === s.revealed - 1 && !reduceMotion()) slot.classList.add('is-flipping');
            } else slot.appendChild(el('span', { class: 'ao-present-q', text: '?' }));
            slots.appendChild(slot);
            k += 1;
          });
          group.appendChild(slots);
          rounds.appendChild(group);
        });
        spot.appendChild(rounds);
        const complete = s.revealed >= list.length;
        next.disabled = false;
        mine.disabled = complete;
        skip.disabled = false;
        back.disabled = s.idx === 0 && s.revealed === 0;
        next.textContent = complete ? (s.idx < order.length - 1 ? 'Next person ▶' : 'Finish 🎉') : 'Reveal next';
      }
      function finale() {
        s.done = true;
        render(false);
        U.confetti(root);
        say('That’s everyone.');
      }
      p.step = () => {
        if (s.done) return;
        const x = order[s.idx];
        const list = picks(x);
        if (s.revealed < list.length) {
          s.revealed += 1;
          const pick = list[s.revealed - 1];
          render(true);
          say(`${x.name}${R > 1 ? `, round ${pick.r + 1}` : ''}: ${labels[pick.id].name}.`);
        } else if (s.idx < order.length - 1) {
          s.idx += 1;
          s.revealed = 0;
          render(true);
          say(`Next: ${order[s.idx].name}.`);
        } else finale();
      };
      p.back = () => {
        if (s.done) { s.done = false; s.idx = order.length - 1; s.revealed = picks(order[s.idx]).length; render(false); return; }
        if (s.idx > 0) { s.idx -= 1; s.revealed = picks(order[s.idx]).length; } else s.revealed = 0;
        render(false);
        say(`Back to ${order[s.idx].name}.`);
      };
      next.addEventListener('click', () => p.step());
      back.addEventListener('click', () => p.back());
      mine.addEventListener('click', () => { s.revealed = picks(order[s.idx]).length; render(false); say(`All of ${order[s.idx].name}’s picks revealed.`); });
      skip.addEventListener('click', finale);
      if (!order.length) finale(); else render(true);
      next.focus();
    }

    p.onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePresenter(); return; }
      if (e.key === 'Tab') {
        const items = Array.from(root.querySelectorAll('button, input')).filter((x) => !x.disabled && x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); p.step(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); p.back(); }
      else if ((e.key === ' ' || e.key === 'Enter') && tag !== 'BUTTON') { e.preventDefault(); p.step(); }
    };
    close.addEventListener('click', closePresenter);
    if (root.requestFullscreen) {
      full.addEventListener('click', () => {
        try {
          const r = document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen();
          if (r && r.catch) r.catch(() => {});
        } catch (e) { /* fullscreen not allowed here */ }
      });
    } else full.hidden = true;
    p.onResizeHandler = () => p.onResize();
    present = p;
    document.body.appendChild(root);
    document.body.classList.add('ao-presenting');
    document.addEventListener('keydown', p.onKey, true);
    window.addEventListener('resize', p.onResizeHandler);
    startScreen();
  }

  els.present.addEventListener('click', openPresenter);

  // ---- Setup import / export / reset --------------------------------------------

  function readImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) {
      U.notice(els.ioNotice, 'Couldn’t import: the file is not valid JSON.', 'error');
      return;
    }
    if (data && typeof data === 'object' && data.kind === 'assign-options') {
      const res = parseOwn(data);
      if (!res.ok) { U.notice(els.ioNotice, `Couldn’t import: ${res.error}`, 'error'); return; }
      const s = res.setup;
      const summary = `${plural(s.people.length, 'person', 'people')}, ${plural(s.labels.length, 'label')}, ${plural(s.settings.rounds, 'round')}`;
      if (hasContent() && !window.confirm(`Replace the current setup with ${summary}?`)) return;
      closeImportPanel();
      replaceSetup(s);
      U.notice(els.ioNotice, `Imported ${summary}.`);
      return;
    }
    const gd = parseGroupDraw(data);
    if (gd && gd.error) { U.notice(els.ioNotice, `Couldn’t import: ${gd.error}`, 'error'); return; }
    if (!gd) { U.notice(els.ioNotice, 'Couldn’t import: this is neither an Assign Options setup nor a Group Draw export.', 'error'); return; }
    if (!gd.people.length) { U.notice(els.ioNotice, 'Couldn’t import: the Group Draw file has no people with a name.', 'error'); return; }
    U.notice(els.ioNotice, '');
    showImportPanel(gd);
  }

  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.peopleImport.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => {
    const file = els.importFile.files && els.importFile.files[0];
    els.importFile.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => readImport(String(reader.result));
    reader.onerror = () => U.notice(els.ioNotice, 'Couldn’t read that file.', 'error');
    reader.readAsText(file);
  });
  els.exportBtn.addEventListener('click', () => {
    U.download('assign-options-setup.json', JSON.stringify(setupForExport(), null, 2), 'application/json');
    U.notice(els.ioNotice, 'Setup exported as assign-options-setup.json.');
  });

  function hasContent() { return state.people.length > 0 || state.labels.length > 0; }

  els.loadExample.addEventListener('click', () => {
    if (hasContent() && !window.confirm('Replace the current setup with the example?')) return;
    const setup = emptySetup();
    setup.people = EXAMPLE.people.map((name) => ({ id: uid('p'), name }));
    setup.labels = EXAMPLE.labels.map((l, i) => ({ id: uid('l'), name: l[0], slots: l[1], once: false, color: i }));
    setup.settings = Object.assign({}, EXAMPLE.settings);
    replaceSetup(setup);
    U.notice(els.ioNotice, 'Loaded the example: 6 people share 4 chores over 4 weeks.');
  });

  els.resetBtn.addEventListener('click', () => {
    if (!window.confirm('Reset Assign Options? This clears people, labels, settings and results.')) return;
    if (running) runner.cancel({ status: 'cancelled' });
    running = null;
    setBusy(false);
    closePresenter();
    closePaste();
    closeImportPanel();
    closeLabelsPaste();
    history = [];
    shown = null;
    kept = new Set();
    viewMode = 'person';
    els.results.innerHTML = '';
    els.results.removeAttribute('data-draw-no');
    els.resultHead.hidden = true;
    els.actions.hidden = true;
    els.alert.hidden = true;
    els.copyFallback.hidden = true;
    U.notice(els.peopleNotice, '');
    U.notice(els.labelsNotice, '');
    els.labelError.textContent = '';
    showStatus('');
    renderHistory();
    replaceSetup(emptySetup());
    U.notice(els.ioNotice, 'Everything cleared.');
  });

  els.clearSaved.addEventListener('click', () => {
    clearTimeout(saveTimer);
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }
    U.notice(els.ioNotice, 'Saved data cleared from this browser. The current setup stays until you reload.');
  });

  // ---- Init -------------------------------------------------------------------

  const saved = loadSaved();
  if (saved) state = saved;
  syncFormUnlimited();
  renderAll();
  renderHistory();
})();
