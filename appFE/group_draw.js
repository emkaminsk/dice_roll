// Group Draw — define attributes and people, set per-group rules, then draw.
// The split is computed in full by GroupDrawSolver (fair RNG via randomIndex)
// before anything is revealed; the dealing/reveal animation is cosmetic only.
(function () {
  const view = document.querySelector('#group-draw-view');
  if (!view || !window.GroupDrawSolver) return;
  const Solver = window.GroupDrawSolver;

  const STORAGE_KEY = 'groupDraw.setup.v1';
  const SOFT_LIMIT = 500;
  const HARD_LIMIT = 2000;
  const HISTORY_MAX = 10;
  const PALETTE = [
    '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#14b8a6', '#84cc16', '#f97316', '#06b6d4', '#a855f7',
  ];
  const KIND_LABEL = { label: 'Label', integer: 'Number', category: 'Category' };
  const RULE_LABEL = { size: 'Size', count: 'Count', sum: 'Sum', apart: 'Apart', together: 'Together' };

  const $ = (sel) => view.querySelector(sel);
  const els = {
    loadExample: $('#gd-load-example'), importBtn: $('#gd-import'), importFile: $('#gd-import-file'),
    exportBtn: $('#gd-export'), resetBtn: $('#gd-reset'), clearSaved: $('#gd-clear-saved'),
    ioNotice: $('#gd-io-notice'),
    attrList: $('#gd-attr-list'), attrForm: $('#gd-attr-form'), attrName: $('#gd-attr-name'),
    attrKind: $('#gd-attr-kind'), attrOptions: $('#gd-attr-options'), attrOptionsField: $('#gd-attr-options-field'),
    attrError: $('#gd-attr-error'),
    peopleCount: $('#gd-people-count'), peopleSummary: $('#gd-people-summary'), peopleEmpty: $('#gd-people-empty'),
    tableWrap: $('#gd-table-wrap'), table: $('#gd-people-table'),
    addPerson: $('#gd-add-person'), pasteToggle: $('#gd-paste-toggle'), paste: $('#gd-paste'),
    pasteText: $('#gd-paste-text'), pastePreview: $('#gd-paste-preview'), pasteCancel: $('#gd-paste-cancel'),
    pasteResult: $('#gd-paste-result'),
    groupCount: $('#gd-group-count'), groupWord: $('#gd-group-word'), groupNames: $('#gd-group-names'), balance: $('#gd-balance'),
    balanceNote: $('#gd-balance-note'), bestEffort: $('#gd-best-effort'),
    ruleList: $('#gd-rule-list'), rulesEmpty: $('#gd-rules-empty'), rulesNotice: $('#gd-rules-notice'),
    ruleForm: $('#gd-rule-form'), ruleType: $('#gd-rule-type'), ruleAttr: $('#gd-rule-attr'),
    ruleAnd: $('#gd-rule-and'), ruleAndRows: $('#gd-rule-and-rows'), ruleAndAdd: $('#gd-rule-and-add'),
    ruleValue: $('#gd-rule-value'), ruleValueNum: $('#gd-rule-value-num'), ruleValues: $('#gd-rule-values'),
    ruleMin: $('#gd-rule-min'), ruleMax: $('#gd-rule-max'), ruleK: $('#gd-rule-k'), ruleScope: $('#gd-rule-scope'),
    ruleAdd: $('#gd-rule-add'), ruleHelp: $('#gd-rule-help'), ruleError: $('#gd-rule-error'), hints: $('#gd-hints'),
    partial: $('#gd-partial'), partialWrap: $('#gd-partial-wrap'), partialHint: $('#gd-partial-hint'),
    draw: $('#gd-draw'), drawLabel: $('#gd-draw-label'), cancel: $('#gd-cancel'), showAttrs: $('#gd-show-attrs'),
    status: $('#gd-status'), alert: $('#gd-alert'), resultsWrap: $('#gd-results-wrap'), outdated: $('#gd-outdated'),
    results: $('#gd-results'), actions: $('#gd-result-actions'), copy: $('#gd-copy'), csv: $('#gd-csv'),
    copyFallback: $('#gd-copy-fallback'), copyText: $('#gd-copy-text'),
    historyWrap: $('#gd-history-wrap'), history: $('#gd-history'),
    metaAttrs: $('#gd-meta-attrs'), metaPeople: $('#gd-meta-people'), metaRules: $('#gd-meta-rules'), metaDraw: $('#gd-meta-draw'),
  };

  let state = emptySetup();
  let version = 0; // bumps on every setup change; results remember theirs
  let history = []; // in-memory only
  let shown = null; // history entry on display
  let drawSeq = 0;
  let running = null;
  let worker = null;
  let workerBroken = false;
  let saveTimer = null;
  let pastePlan = null;
  let formScope = 'all'; // scope picked in the add-rule form
  let openScopeRule = null; // keeps a scope picker open while it re-renders
  let kept = new Set(); // group indexes frozen for a partial redraw
  let idCounter = 0;

  // ---- Small helpers ------------------------------------------------------

  function emptySetup() {
    return {
      attributes: [], people: [], groups: { count: 2, label: '', names: [] }, rules: [],
      options: { balance: true, bestEffort: false },
    };
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
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach((c) => { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
  function isEmptyValue(v) { return v === null || v === undefined || v === ''; }
  function attrById(id) { return state.attributes.find((a) => a.id === id); }
  function isInt(text) { return /^-?\d+$/.test(String(text).trim()); }
  function namedPeople() { return state.people.filter((p) => p.name.trim() !== ''); }
  function groupWord(groups) { return String((groups && groups.label) || '').trim() || 'Group'; }
  function groupLabel(g) { return (state.groups.names[g] || '').trim() || `${groupWord(state.groups)} ${g + 1}`; }
  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sameName(a, b) { return a.trim().toLowerCase() === b.trim().toLowerCase(); }

  function notice(target, message, kind) {
    target.textContent = message;
    target.hidden = !message;
    target.classList.toggle('is-error', kind === 'error');
  }

  // ---- Persistence (optional convenience) ---------------------------------

  function setupForExport() {
    return {
      version: 1, attributes: state.attributes, people: state.people,
      groups: state.groups, rules: state.rules, options: state.options,
    };
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
      const res = parseSetup(JSON.parse(raw));
      return res.ok ? res.setup : null;
    } catch (e) {
      return null;
    }
  }

  // Validate + clean an imported/saved setup. Structure problems are errors;
  // individual values that don't fit their attribute are dropped to empty.
  function parseSetup(obj) {
    const fail = (error) => ({ ok: false, error });
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('The file is not a Group Draw setup.');
    if (obj.version !== 1) return fail('Unsupported or missing version (expected version 1).');
    if (!Array.isArray(obj.attributes) || !Array.isArray(obj.people) || !Array.isArray(obj.rules)) {
      return fail('Missing attributes, people or rules.');
    }
    const attributes = [];
    for (const a of obj.attributes) {
      if (!a || typeof a.id !== 'string' || typeof a.name !== 'string' || !a.name.trim()) return fail('An attribute is missing its id or name.');
      if (!KIND_LABEL[a.kind]) return fail(`Attribute “${a.name}” has an unknown kind.`);
      if (attributes.some((b) => b.id === a.id || sameName(b.name, a.name)) || sameName(a.name, 'name')) {
        return fail(`Attribute “${a.name}” is duplicated.`);
      }
      const attr = { id: a.id, name: a.name.trim(), kind: a.kind };
      if (a.kind === 'category') {
        const opts = Array.isArray(a.options) ? a.options.map((o) => String(o).trim()).filter(Boolean) : [];
        const unique = opts.filter((o, i) => opts.findIndex((x) => sameName(x, o)) === i);
        if (!unique.length) return fail(`Category “${a.name}” needs at least one option.`);
        attr.options = unique;
      }
      attributes.push(attr);
    }
    if (obj.people.length > HARD_LIMIT) return fail(`Too many people (${obj.people.length}); the limit is ${HARD_LIMIT}.`);
    const seen = {};
    const people = [];
    for (const p of obj.people) {
      if (!p || typeof p.name !== 'string') return fail('A person is missing a name.');
      let id = typeof p.id === 'string' && p.id && !seen[p.id] ? p.id : uid('p');
      seen[id] = true;
      const values = {};
      attributes.forEach((a) => {
        const v = p.values ? p.values[a.id] : null;
        values[a.id] = cleanValue(a, v);
      });
      people.push({ id, name: p.name, values });
    }
    const groups = obj.groups && typeof obj.groups === 'object' ? obj.groups : {};
    const count = Math.min(50, Math.max(2, parseInt(groups.count, 10) || 2));
    const names = Array.isArray(groups.names) ? groups.names.slice(0, count).map((n) => (typeof n === 'string' ? n : '')) : [];
    const label = typeof groups.label === 'string' ? groups.label.trim().slice(0, 30) : '';
    const rules = [];
    for (const r of obj.rules) {
      if (!r || !RULE_LABEL[r.type]) return fail('A rule has an unknown type.');
      const rule = cleanRule(r, attributes, count);
      if (!rule) return fail(`A ${r.type} rule refers to a missing or unsuitable attribute.`);
      rules.push(rule);
    }
    const options = obj.options && typeof obj.options === 'object' ? obj.options : {};
    return {
      ok: true,
      setup: {
        attributes, people, groups: { count, label, names }, rules,
        options: { balance: options.balance !== false, bestEffort: !!options.bestEffort },
      },
    };
  }

  function cleanValue(attr, v) {
    if (isEmptyValue(v)) return null;
    if (attr.kind === 'integer') return isInt(v) ? parseInt(v, 10) : null;
    if (attr.kind === 'category') {
      const hit = attr.options.find((o) => sameName(o, String(v)));
      return hit === undefined ? null : hit;
    }
    return String(v);
  }

  function num(v) { return isEmptyValue(v) || !isInt(v) ? null : parseInt(v, 10); }

  // Scope is 'all', one group index, or a sorted array of 2+ group indexes
  // (a list covering every group is the same as 'all'). null = invalid.
  function cleanScope(raw, count) {
    if (raw === 'all' || raw === undefined || raw === null) return 'all';
    const list = (Array.isArray(raw) ? raw : [raw]).map((x) => (isInt(x) ? parseInt(x, 10) : NaN));
    if (!list.length || list.some((g) => !(g >= 0 && g < count))) return null;
    return normScope(list, count);
  }

  function normScope(list, count) {
    const u = Array.from(new Set(list)).sort((a, b) => a - b);
    if (u.length >= count) return 'all';
    return u.length === 1 ? u[0] : u;
  }

  function scopeGroups(scope) {
    return scope === 'all' || scope === undefined || scope === null ? null : (Array.isArray(scope) ? scope : [scope]);
  }

  const MAX_CONDITIONS = 4; // attribute = value conditions in one count rule

  // A count rule's conditions: the main attrId/value plus optional extras in rule.and.
  function ruleConds(rule) {
    return [{ attrId: rule.attrId, value: rule.value }].concat(rule.and || []);
  }
  function ruleUsesAttr(r, attrId) {
    return r.type === 'count' ? ruleConds(r).some((c) => c.attrId === attrId) : r.attrId === attrId;
  }
  function condsKey(rule) {
    return ruleConds(rule).map((c) => `${c.attrId}|${c.value}`).sort().join('&');
  }

  function cleanRule(r, attributes, count) {
    const scope = cleanScope(r.scope, count);
    if (scope === null) return null;
    const rule = { id: typeof r.id === 'string' && r.id ? r.id : uid('r'), type: r.type };
    if (r.type === 'size') return Object.assign(rule, { scope, min: num(r.min), max: num(r.max) });
    const attr = attributes.find((a) => a.id === r.attrId);
    if (!attr || (attr.kind === 'label' && r.type !== 'count')) return null;
    rule.attrId = attr.id;
    if (r.type === 'sum') return attr.kind === 'integer' ? Object.assign(rule, { scope, min: num(r.min), max: num(r.max) }) : null;
    if (r.type === 'count') {
      const value = cleanValue(attr, r.value);
      if (value === null || (attr.kind === 'label' && !value.trim())) return null;
      Object.assign(rule, { scope, value, min: num(r.min), max: num(r.max) });
      if (Array.isArray(r.and) && r.and.length) {
        const seen = { [attr.id]: true };
        const and = [];
        for (const c of r.and.slice(0, MAX_CONDITIONS - 1)) {
          const a2 = c && attributes.find((a) => a.id === c.attrId);
          const v2 = a2 ? cleanValue(a2, c.value) : null;
          // Drop a rule whose extra condition is invalid (it would silently broaden).
          if (!a2 || v2 === null || (a2.kind === 'label' && !v2.trim()) || seen[a2.id]) return null;
          seen[a2.id] = true;
          and.push({ attrId: a2.id, value: v2 });
        }
        rule.and = and;
      }
      return rule;
    }
    if (r.type === 'apart') return Object.assign(rule, { scope: 'all', k: Math.max(1, num(r.k) || 1) });
    const values = Array.isArray(r.values) ? r.values.map((v) => cleanValue(attr, v)).filter((v) => v !== null) : [];
    return Object.assign(rule, { scope: 'all', values });
  }

  // ---- Setup changes ------------------------------------------------------

  function changed(opts) {
    const o = opts || {};
    version += 1;
    scheduleSave();
    if (o.table) renderTable();
    if (o.attrs) renderAttributes();
    if (o.rules) { renderRuleForm(); renderRules(); } else renderValueField();
    if (o.groups) renderGroups();
    renderPeopleMeta();
    renderHints();
    renderMeta();
    markOutdated();
  }

  function replaceSetup(setup) {
    state = setup;
    renderAll();
    version += 1;
    scheduleSave();
    markOutdated();
  }

  function renderAll() {
    renderAttributes();
    renderTable();
    renderGroups();
    renderRuleForm();
    renderRules();
    renderPeopleMeta();
    renderHints();
    renderMeta();
  }

  function renderMeta() {
    const named = namedPeople().length;
    els.metaAttrs.textContent = state.attributes.length ? plural(state.attributes.length, 'attribute') : 'optional';
    els.metaPeople.textContent = plural(named, 'person', 'people');
    els.metaRules.textContent = `${plural(state.groups.count, 'group')} · ${plural(state.rules.length, 'rule')}`;
    els.metaDraw.textContent = history.length ? plural(history.length, 'draw') : 'ready';
    view.querySelector('[data-step="attrs"]').classList.toggle('is-done', state.attributes.length > 0);
    view.querySelector('[data-step="people"]').classList.toggle('is-done', named > 0);
    view.querySelector('[data-step="rules"]').classList.toggle('is-done', state.rules.length > 0);
    view.querySelector('[data-step="draw"]').classList.toggle('is-done', history.length > 0);
    els.drawLabel.textContent = history.length ? 'Draw again' : 'Draw';
  }

  function markOutdated() {
    const stale = !!shown && shown.version !== version;
    els.resultsWrap.classList.toggle('is-outdated', stale);
    els.outdated.hidden = !stale;
    renderPartial();
  }

  // ---- Step 1: attributes --------------------------------------------------

  function attrInUse(attr) {
    return state.people.some((p) => !isEmptyValue(p.values[attr.id])) || state.rules.some((r) => ruleUsesAttr(r, attr.id));
  }

  function validAttrName(name, exceptId) {
    const n = name.trim();
    if (!n) return 'Give the attribute a name.';
    if (sameName(n, 'name')) return '“name” is built in — pick another attribute name.';
    if (state.attributes.some((a) => a.id !== exceptId && sameName(a.name, n))) return `There is already an attribute called “${n}”.`;
    return '';
  }

  function splitList(text) {
    const out = [];
    String(text).split(',').map((s) => s.trim()).filter(Boolean).forEach((o) => {
      if (!out.some((x) => sameName(x, o))) out.push(o);
    });
    return out;
  }

  function renderAttributes() {
    els.attrList.innerHTML = '';
    state.attributes.forEach((attr) => {
      const nameInput = el('input', {
        type: 'text', class: 'form-control form-control-sm gd-attr-name-input', value: attr.name,
        'aria-label': `Name of attribute ${attr.name}`, autocomplete: 'off',
      });
      const err = el('p', { class: 'gd-field-error', role: 'alert' });
      nameInput.addEventListener('change', () => {
        const problem = validAttrName(nameInput.value, attr.id);
        if (problem) {
          err.textContent = problem;
          nameInput.classList.add('is-invalid');
          nameInput.value = attr.name;
          return;
        }
        err.textContent = '';
        nameInput.classList.remove('is-invalid');
        attr.name = nameInput.value.trim();
        changed({ table: true, rules: true });
      });
      const del = el('button', {
        type: 'button', class: 'btn btn-link btn-remove gd-attr-delete', 'aria-label': `Delete attribute ${attr.name}`, text: '×',
      });
      del.addEventListener('click', () => deleteAttribute(attr));
      const head = el('div', { class: 'gd-attr-head' }, [
        nameInput,
        el('span', { class: `gd-kind gd-kind-${attr.kind}`, text: KIND_LABEL[attr.kind] }),
        del,
      ]);
      const row = el('div', { class: 'gd-attr-row', dataset: { attrId: attr.id } }, [head]);
      if (attr.kind === 'category') row.appendChild(optionChips(attr, err));
      row.appendChild(err);
      els.attrList.appendChild(row);
    });
  }

  function optionChips(attr, err) {
    const wrap = el('div', { class: 'gd-chips' });
    attr.options.forEach((opt) => {
      const x = el('button', { type: 'button', class: 'gd-chip-x', 'aria-label': `Remove option ${opt}`, text: '×' });
      x.addEventListener('click', () => removeOption(attr, opt, err));
      wrap.appendChild(el('span', { class: 'gd-chip' }, [el('span', { text: opt }), x]));
    });
    const input = el('input', {
      type: 'text', class: 'gd-chip-input', placeholder: '+ option', autocomplete: 'off',
      'aria-label': `Add option to ${attr.name}`,
    });
    const commit = () => {
      const fresh = splitList(input.value).filter((o) => !attr.options.some((x) => sameName(x, o)));
      input.value = '';
      if (!fresh.length) return;
      attr.options = attr.options.concat(fresh);
      changed({ attrs: true, table: true, rules: true });
      const again = els.attrList.querySelector(`[data-attr-id="${CSS.escape(attr.id)}"] .gd-chip-input`);
      if (again) again.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    });
    input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
    wrap.appendChild(input);
    return wrap;
  }

  function removeOption(attr, opt, err) {
    if (attr.options.length === 1) {
      err.textContent = 'A category needs at least one option.';
      return;
    }
    const usedBy = state.people.filter((p) => p.values[attr.id] === opt).length;
    const countHit = (r) => r.type === 'count' && ruleConds(r).some((c) => c.attrId === attr.id && c.value === opt);
    const rulesHit = state.rules.filter((r) => countHit(r) ||
      (r.type === 'together' && r.attrId === attr.id && (r.values || []).indexOf(opt) !== -1));
    if ((usedBy || rulesHit.length) && !window.confirm(
      `Remove option “${opt}”? ${plural(usedBy, 'person', 'people')} will lose this value and ${plural(rulesHit.length, 'rule')} will change.`)) return;
    attr.options = attr.options.filter((o) => o !== opt);
    state.people.forEach((p) => { if (p.values[attr.id] === opt) p.values[attr.id] = null; });
    let removed = 0;
    state.rules = state.rules.filter((r) => {
      if (countHit(r)) { removed++; return false; }
      if (r.attrId !== attr.id) return true;
      if (r.type === 'together' && r.values && r.values.indexOf(opt) !== -1) {
        r.values = r.values.filter((v) => v !== opt);
        if (!r.values.length) { removed++; return false; }
      }
      return true;
    });
    if (removed) notice(els.rulesNotice, `Removed ${plural(removed, 'rule')} that used “${attr.name} = ${opt}”.`);
    changed({ attrs: true, table: true, rules: true });
  }

  function deleteAttribute(attr) {
    if (attrInUse(attr) && !window.confirm(`Delete attribute “${attr.name}”? Its values and any rules that use it will be removed.`)) return;
    const before = state.rules.length;
    state.attributes = state.attributes.filter((a) => a !== attr);
    state.people.forEach((p) => { delete p.values[attr.id]; });
    state.rules = state.rules.filter((r) => !ruleUsesAttr(r, attr.id));
    const removed = before - state.rules.length;
    if (removed) notice(els.rulesNotice, `Removed ${plural(removed, 'rule')} that used “${attr.name}”.`);
    changed({ attrs: true, table: true, rules: true });
  }

  function syncAttrKind() {
    els.attrOptionsField.hidden = els.attrKind.value !== 'category';
  }

  els.attrKind.addEventListener('change', syncAttrKind);
  els.attrForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = els.attrName.value.trim();
    const kind = els.attrKind.value;
    const nameProblem = validAttrName(name);
    const options = splitList(els.attrOptions.value);
    const optProblem = kind === 'category' && !options.length ? 'A category needs at least one option.' : '';
    els.attrError.textContent = nameProblem || optProblem;
    els.attrName.classList.toggle('is-invalid', !!nameProblem);
    els.attrOptions.classList.toggle('is-invalid', !nameProblem && !!optProblem);
    if (nameProblem || optProblem) return;
    const attr = { id: uid('a'), name, kind };
    if (kind === 'category') attr.options = options;
    state.attributes.push(attr);
    state.people.forEach((p) => { p.values[attr.id] = null; });
    els.attrName.value = '';
    els.attrOptions.value = '';
    els.attrName.focus();
    changed({ attrs: true, table: true, rules: true });
  });

  // ---- Step 2: people ------------------------------------------------------

  function renderTable() {
    const thead = els.table.tHead;
    const tbody = els.table.tBodies[0];
    thead.innerHTML = '';
    tbody.innerHTML = '';
    const head = el('tr', {}, [el('th', { scope: 'col', class: 'gd-col-num', text: '#' }), el('th', { scope: 'col', text: 'Name' })]);
    state.attributes.forEach((a) => head.appendChild(el('th', { scope: 'col', text: a.name })));
    head.appendChild(el('th', { scope: 'col', class: 'gd-col-del' }, [el('span', { class: 'sr-only', text: 'Delete' })]));
    thead.appendChild(head);
    const frag = document.createDocumentFragment();
    state.people.forEach((p, i) => frag.appendChild(personRow(p, i)));
    tbody.appendChild(frag);
    els.tableWrap.hidden = state.people.length === 0;
    els.peopleEmpty.hidden = state.people.length > 0;
    flagDuplicates();
  }

  function personRow(p, i) {
    const tr = el('tr', { dataset: { personId: p.id } });
    tr.appendChild(el('td', { class: 'gd-col-num', text: String(i + 1) }));
    tr.appendChild(el('td', {}, [el('input', {
      type: 'text', class: 'form-control form-control-sm gd-cell', value: p.name, autocomplete: 'off',
      'aria-label': `Name, row ${i + 1}`, dataset: { field: 'name' },
    })]));
    state.attributes.forEach((a) => {
      const v = p.values[a.id];
      let input;
      if (a.kind === 'category') {
        input = el('select', { class: 'form-control form-control-sm gd-cell', 'aria-label': `${a.name}, row ${i + 1}`, dataset: { field: a.id } },
          [el('option', { value: '', text: '—' })].concat(a.options.map((o) => el('option', { value: o, text: o, selected: v === o }))));
      } else {
        input = el('input', {
          type: 'text', class: 'form-control form-control-sm gd-cell', value: isEmptyValue(v) ? '' : String(v),
          inputmode: a.kind === 'integer' ? 'numeric' : null, autocomplete: 'off',
          'aria-label': `${a.name}, row ${i + 1}`, dataset: { field: a.id },
        });
      }
      tr.appendChild(el('td', { dataset: { kind: a.kind } }, [input]));
    });
    tr.appendChild(el('td', { class: 'gd-col-del' }, [el('button', {
      type: 'button', class: 'btn btn-link btn-remove gd-person-delete', 'aria-label': `Delete row ${i + 1}`, text: '×',
    })]));
    return tr;
  }

  function flagDuplicates() {
    const counts = {};
    state.people.forEach((p) => {
      const k = p.name.trim().toLowerCase();
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    els.table.querySelectorAll('tbody tr').forEach((tr) => {
      const p = state.people.find((x) => x.id === tr.dataset.personId);
      const td = tr.querySelector('[data-field="name"]').parentNode;
      const dup = p && counts[p.name.trim().toLowerCase()] > 1;
      td.classList.toggle('is-duplicate', !!dup);
      td.title = dup ? 'Duplicate name — allowed, but it may be confusing' : '';
    });
  }

  function cellMessage(td, message) {
    let msg = td.querySelector('.gd-cell-msg');
    if (!message) { if (msg) msg.remove(); td.classList.remove('is-invalid'); return; }
    if (!msg) { msg = el('span', { class: 'gd-cell-msg' }); td.appendChild(msg); }
    msg.textContent = message;
    td.classList.add('is-invalid');
  }

  function onCellEdit(e) {
    const input = e.target;
    const field = input.dataset && input.dataset.field;
    if (!field) return;
    const tr = input.closest('tr');
    const p = state.people.find((x) => x.id === tr.dataset.personId);
    if (!p) return;
    if (field === 'name') {
      p.name = input.value;
      flagDuplicates();
    } else {
      const a = attrById(field);
      const raw = input.value.trim();
      if (a.kind === 'integer') {
        const ok = raw === '' || isInt(raw);
        p.values[a.id] = ok && raw !== '' ? parseInt(raw, 10) : null;
        cellMessage(input.parentNode, ok ? '' : 'Whole number');
      } else {
        p.values[a.id] = raw === '' ? null : (a.kind === 'category' ? input.value : input.value);
      }
    }
    changed();
  }

  els.table.addEventListener('input', onCellEdit);
  els.table.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') onCellEdit(e); });
  els.table.addEventListener('click', (e) => {
    const btn = e.target.closest('.gd-person-delete');
    if (!btn) return;
    const id = btn.closest('tr').dataset.personId;
    state.people = state.people.filter((p) => p.id !== id);
    changed({ table: true });
  });

  els.addPerson.addEventListener('click', () => {
    if (state.people.length >= HARD_LIMIT) {
      notice(els.ioNotice, `That's the limit of ${HARD_LIMIT} people.`, 'error');
      return;
    }
    const p = { id: uid('p'), name: '', values: {} };
    state.attributes.forEach((a) => { p.values[a.id] = null; });
    state.people.push(p);
    changed({ table: true });
    const input = els.table.querySelector(`tr[data-person-id="${CSS.escape(p.id)}"] [data-field="name"]`);
    if (input) input.focus();
  });

  function renderPeopleMeta() {
    const people = namedPeople();
    const n = people.length;
    els.peopleCount.textContent = plural(n, 'person', 'people') +
      (n > SOFT_LIMIT ? ` — large lists (over ${SOFT_LIMIT}) may take a moment to draw` : '');
    const parts = [];
    state.attributes.filter((a) => a.kind === 'category').forEach((a) => {
      const bits = a.options.map((o) => {
        const c = people.filter((p) => p.values[a.id] === o).length;
        return c ? `${c} ${o}` : '';
      }).filter(Boolean);
      if (bits.length) parts.push(`${a.name}: ${bits.join(' · ')}`);
    });
    els.peopleSummary.textContent = parts.join('  |  ');
  }

  // Paste from spreadsheet / CSV ------------------------------------------

  function parseDelimited(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const first = lines.find((l) => l.trim() !== '') || '';
    let delim = ',';
    if (first.indexOf('\t') !== -1) delim = '\t';
    else if ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length) delim = ';';
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const src = lines.join('\n');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; }
      else if (ch === delim) { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell.trim());
    rows.push(row);
    return { delim, rows: rows.filter((r) => r.some((c) => c !== '')) };
  }

  function guessMapping(rows) {
    const header = rows[0] || [];
    const match = (cell) => {
      if (sameName(cell, 'name')) return 'name';
      const a = state.attributes.find((x) => sameName(x.name, cell));
      return a ? a.id : null;
    };
    const hits = header.map(match);
    if (hits.some((h) => h)) return { hasHeader: true, mapping: hits.map((h) => h || '') };
    const width = Math.max.apply(null, rows.map((r) => r.length));
    const mapping = [];
    for (let c = 0; c < width; c++) {
      mapping.push(c === 0 ? 'name' : (state.attributes[c - 1] ? state.attributes[c - 1].id : ''));
    }
    return { hasHeader: false, mapping };
  }

  // Turn parsed rows + a column mapping into people and a list of problems.
  function planImport(parsed, mapping, hasHeader, unknownChoice) {
    const body = hasHeader ? parsed.rows.slice(1) : parsed.rows;
    const nameCol = mapping.indexOf('name');
    const issues = [];
    const unknown = {}; // attrId -> [values]
    const people = [];
    body.forEach((cells, ri) => {
      const rowNo = ri + 1 + (hasHeader ? 1 : 0);
      const name = nameCol >= 0 ? (cells[nameCol] || '').trim() : '';
      if (!name) { issues.push(`Row ${rowNo}: no name — skipped.`); return; }
      const values = {};
      state.attributes.forEach((a) => { values[a.id] = null; });
      mapping.forEach((target, c) => {
        if (!target || target === 'name') return;
        const a = attrById(target);
        const raw = (cells[c] || '').trim();
        if (!a || !raw) return;
        if (a.kind === 'integer') {
          if (isInt(raw)) values[a.id] = parseInt(raw, 10);
          else issues.push(`Row ${rowNo}, ${a.name}: “${raw}” is not a whole number — left empty.`);
        } else if (a.kind === 'category') {
          const hit = a.options.find((o) => sameName(o, raw));
          if (hit !== undefined) values[a.id] = hit;
          else {
            unknown[a.id] = unknown[a.id] || [];
            if (!unknown[a.id].some((x) => sameName(x, raw))) unknown[a.id].push(raw);
            if ((unknownChoice[a.id] || 'add') === 'add') values[a.id] = unknown[a.id].find((x) => sameName(x, raw));
          }
        } else values[a.id] = raw;
      });
      people.push({ name, values });
    });
    return { people, issues, unknown };
  }

  function renderPastePreview() {
    const plan = pastePlan;
    const res = planImport(plan.parsed, plan.mapping, plan.hasHeader, plan.unknownChoice);
    plan.result = res;
    const box = els.pasteResult;
    box.innerHTML = '';
    const delimName = { '\t': 'tabs', ',': 'commas', ';': 'semicolons' }[plan.parsed.delim];
    box.appendChild(el('p', { class: 'gd-help muted', text: `Split by ${delimName}. ${plan.hasHeader ? 'First row read as a header.' : 'No header — columns mapped by position.'} Adjust the mapping if needed:` }));

    const width = plan.mapping.length;
    const sample = (plan.hasHeader ? plan.parsed.rows.slice(1) : plan.parsed.rows).slice(0, 4);
    const headRow = el('tr');
    for (let c = 0; c < width; c++) {
      const sel = el('select', { class: 'form-control form-control-sm gd-map-select', 'aria-label': `Column ${c + 1} maps to`, dataset: { col: String(c) } },
        [el('option', { value: '', text: 'Ignore' }), el('option', { value: 'name', text: 'name' })]
          .concat(state.attributes.map((a) => el('option', { value: a.id, text: a.name }))));
      sel.value = plan.mapping[c] || '';
      sel.addEventListener('change', () => {
        if (sel.value === 'name') plan.mapping = plan.mapping.map((m) => (m === 'name' ? '' : m));
        plan.mapping[c] = sel.value;
        renderPastePreview();
      });
      const title = plan.hasHeader ? (plan.parsed.rows[0][c] || `Column ${c + 1}`) : `Column ${c + 1}`;
      headRow.appendChild(el('th', {}, [el('span', { class: 'gd-map-title', text: title }), sel]));
    }
    const rows = sample.map((cells) => {
      const tr = el('tr');
      for (let c = 0; c < width; c++) tr.appendChild(el('td', { text: cells[c] || '' }));
      return tr;
    });
    box.appendChild(el('div', { class: 'gd-table-wrap gd-map-wrap' }, [el('table', { class: 'gd-table gd-map-table' }, [el('thead', {}, [headRow]), el('tbody', {}, rows)])]));

    if (plan.mapping.indexOf('name') === -1) {
      box.appendChild(el('p', { class: 'gd-field-error', text: 'Map one column to “name”.' }));
    }
    Object.keys(res.unknown).forEach((attrId) => {
      const a = attrById(attrId);
      const choice = plan.unknownChoice[attrId] || 'add';
      const radio = (value, text) => {
        const input = el('input', { type: 'radio', name: `gd-unknown-${attrId}`, value, checked: choice === value });
        input.addEventListener('change', () => { plan.unknownChoice[attrId] = value; renderPastePreview(); });
        return el('label', { class: 'gd-check' }, [input, ' ' + text]);
      };
      box.appendChild(el('div', { class: 'gd-unknown', dataset: { attrId } }, [
        el('p', { text: `Unknown ${a.name} values: ${res.unknown[attrId].map((v) => `“${v}”`).join(', ')}` }),
        radio('add', 'Add as new options'),
        radio('empty', 'Leave empty'),
      ]));
    });
    if (res.issues.length) {
      box.appendChild(el('ul', { class: 'gd-issues' }, res.issues.slice(0, 50).map((t) => el('li', { text: t }))));
    }
    const total = state.people.length + res.people.length;
    const replace = el('input', { type: 'checkbox', id: 'gd-paste-replace', checked: plan.replace });
    replace.addEventListener('change', () => { plan.replace = replace.checked; });
    const confirmBtn = el('button', {
      type: 'button', id: 'gd-paste-import', class: 'btn btn-primary btn-sm',
      text: `Import ${plural(res.people.length, 'person', 'people')}`,
      disabled: !res.people.length || plan.mapping.indexOf('name') === -1,
    });
    confirmBtn.addEventListener('click', commitPaste);
    box.appendChild(el('div', { class: 'btn-row gd-paste-actions' }, [
      confirmBtn,
      el('label', { class: 'gd-check' }, [replace, ' Replace current people']),
    ]));
    if (!plan.replace && total > HARD_LIMIT) {
      box.appendChild(el('p', { class: 'gd-field-error', text: `That would make ${total} people — the limit is ${HARD_LIMIT}.` }));
      confirmBtn.disabled = true;
    }
  }

  function commitPaste() {
    const plan = pastePlan;
    const res = planImport(plan.parsed, plan.mapping, plan.hasHeader, plan.unknownChoice);
    if (!plan.replace && state.people.length + res.people.length > HARD_LIMIT) return;
    Object.keys(res.unknown).forEach((attrId) => {
      if ((plan.unknownChoice[attrId] || 'add') !== 'add') return;
      const a = attrById(attrId);
      a.options = a.options.concat(res.unknown[attrId]);
    });
    const fresh = res.people.slice(0, HARD_LIMIT).map((p) => ({ id: uid('p'), name: p.name, values: p.values }));
    state.people = plan.replace ? fresh : state.people.concat(fresh);
    closePaste();
    els.pasteText.value = '';
    notice(els.ioNotice, `Imported ${plural(fresh.length, 'person', 'people')}.`);
    changed({ attrs: true, table: true, rules: true });
  }

  function closePaste() {
    pastePlan = null;
    els.paste.hidden = true;
    els.pasteResult.innerHTML = '';
    els.pasteToggle.setAttribute('aria-expanded', 'false');
  }

  els.pasteToggle.addEventListener('click', () => {
    const open = els.paste.hidden;
    if (!open) { closePaste(); return; }
    els.paste.hidden = false;
    els.pasteToggle.setAttribute('aria-expanded', 'true');
    els.pasteText.focus();
  });
  els.pasteCancel.addEventListener('click', closePaste);
  els.pastePreview.addEventListener('click', () => {
    const parsed = parseDelimited(els.pasteText.value);
    if (!parsed.rows.length) {
      els.pasteResult.innerHTML = '';
      els.pasteResult.appendChild(el('p', { class: 'gd-field-error', text: 'Paste at least one row first.' }));
      return;
    }
    const guess = guessMapping(parsed.rows);
    pastePlan = { parsed, mapping: guess.mapping, hasHeader: guess.hasHeader, unknownChoice: {}, replace: false };
    renderPastePreview();
  });

  // ---- Step 3: groups & rules ----------------------------------------------

  function renderGroups() {
    els.groupCount.value = state.groups.count;
    els.groupWord.value = state.groups.label || '';
    els.groupNames.innerHTML = '';
    for (let g = 0; g < state.groups.count; g++) {
      const input = el('input', {
        type: 'text', class: 'form-control form-control-sm gd-group-name', value: state.groups.names[g] || '',
        placeholder: `${groupWord(state.groups)} ${g + 1}`, 'aria-label': `Name of group ${g + 1}`, autocomplete: 'off',
      });
      input.style.setProperty('--team-color', PALETTE[g % PALETTE.length]);
      input.addEventListener('input', () => {
        state.groups.names[g] = input.value;
        renderScopeOptions();
        renderRules();
        changed();
      });
      els.groupNames.appendChild(input);
    }
    const hasSize = state.rules.some((r) => r.type === 'size');
    els.balance.checked = state.options.balance && !hasSize;
    els.balance.disabled = hasSize;
    els.balanceNote.hidden = !hasSize;
    els.bestEffort.checked = !!state.options.bestEffort;
  }

  els.groupCount.addEventListener('change', () => {
    const n = Math.min(50, Math.max(2, parseInt(els.groupCount.value, 10) || 2));
    state.groups.count = n;
    state.groups.names = state.groups.names.slice(0, n);
    const before = state.rules.length;
    state.rules = state.rules.filter((r) => {
      const list = scopeGroups(r.scope);
      if (!list) return true;
      const left = list.filter((g) => g < n);
      if (!left.length) return false;
      r.scope = normScope(left, n);
      return true;
    });
    const removed = before - state.rules.length;
    kept = new Set();
    if (removed) notice(els.rulesNotice, `Removed ${plural(removed, 'rule')} for groups that no longer exist.`);
    changed({ groups: true, rules: true });
  });
  els.groupWord.addEventListener('input', () => {
    state.groups.label = els.groupWord.value.slice(0, 30);
    Array.from(els.groupNames.children).forEach((input, g) => { input.placeholder = `${groupWord(state.groups)} ${g + 1}`; });
    renderScopeOptions();
    renderRules();
    changed();
  });
  els.balance.addEventListener('change', () => { state.options.balance = els.balance.checked; changed(); });
  els.bestEffort.addEventListener('change', () => { state.options.bestEffort = els.bestEffort.checked; changed(); });

  function ruleAttrs(type) {
    if (type === 'sum') return state.attributes.filter((a) => a.kind === 'integer');
    if (type === 'size') return [];
    if (type === 'count') return state.attributes;
    return state.attributes.filter((a) => a.kind !== 'label');
  }

  function scopeSummary(scope) {
    const list = scopeGroups(scope);
    if (!list) return 'All groups (each)';
    return list.map(groupLabel).join(', ');
  }

  // A compact multi-select: a <details> with one checkbox per group. "All groups"
  // and individual groups are mutually consistent (all ticked = All).
  function scopePicker(current, label, onChange) {
    const count = state.groups.count;
    let sel = scopeGroups(current) ? scopeGroups(current).slice() : null; // null = all
    const wrap = el('details', { class: 'gd-scope' });
    const summary = el('summary', { class: 'form-control form-control-sm gd-scope-summary', 'aria-label': `${label}: ${scopeSummary(current)}` });
    const list = el('div', { class: 'gd-scope-list' });
    const boxes = [];
    const allBox = el('input', { type: 'checkbox', class: 'gd-scope-all' });
    list.appendChild(el('label', { class: 'gd-check gd-scope-item' }, [allBox, el('span', { text: 'All groups (each)' })]));
    for (let g = 0; g < count; g++) {
      const box = el('input', { type: 'checkbox', dataset: { group: String(g) } });
      boxes.push(box);
      list.appendChild(el('label', { class: 'gd-check gd-scope-item' }, [box, el('span', { text: groupLabel(g) })]));
    }
    function paint() {
      allBox.checked = sel === null;
      boxes.forEach((b, g) => { b.checked = sel === null || sel.indexOf(g) !== -1; });
      const value = sel === null ? 'all' : normScope(sel, count);
      summary.textContent = scopeSummary(value);
      summary.setAttribute('aria-label', `${label}: ${scopeSummary(value)}`);
      return value;
    }
    allBox.addEventListener('change', () => {
      sel = allBox.checked ? null : [0];
      onChange(paint());
    });
    boxes.forEach((b, g) => b.addEventListener('change', () => {
      const cur = sel === null ? boxes.map((_, i) => i) : sel.slice();
      const next = b.checked ? cur.concat(g) : cur.filter((x) => x !== g);
      if (!next.length) { b.checked = true; return; } // at least one group
      sel = next.length >= count ? null : next;
      onChange(paint());
    }));
    wrap.appendChild(summary);
    wrap.appendChild(list);
    paint();
    return wrap;
  }

  function renderScopeOptions() {
    const count = state.groups.count;
    if (scopeGroups(formScope) && scopeGroups(formScope).some((g) => g >= count)) formScope = 'all';
    const open = els.ruleScope.querySelector('details') && els.ruleScope.querySelector('details').open;
    els.ruleScope.innerHTML = '';
    const picker = scopePicker(formScope, 'Rule applies to', (v) => { formScope = v; });
    if (open) picker.open = true;
    els.ruleScope.appendChild(picker);
  }

  function renderRuleForm() {
    const type = els.ruleType.value;
    els.ruleForm.querySelectorAll('[data-for]').forEach((f) => {
      f.hidden = f.dataset.for.split(' ').indexOf(type) === -1;
    });
    const attrs = ruleAttrs(type);
    const prev = els.ruleAttr.value;
    els.ruleAttr.innerHTML = '';
    attrs.forEach((a) => els.ruleAttr.appendChild(el('option', { value: a.id, text: `${a.name} (${KIND_LABEL[a.kind].toLowerCase()})` })));
    if (attrs.some((a) => a.id === prev)) els.ruleAttr.value = prev;
    renderScopeOptions();
    renderValueField();
  }

  const RULE_HELP = {
    count: 'How many people with this value each group may have. Add “and” conditions to count only people matching all of them.',
    size: 'How many people a group may have.',
    sum: 'Bounds on the total of a number within a group.',
    apart: 'No more than this many people sharing a value in one group (1 = all different).',
    together: 'Everyone sharing a value lands in the same group.',
  };

  // Distinct non-empty values of a label attribute, verbatim (rules match exact text).
  function labelValues(attr) {
    const seen = Object.create(null);
    namedPeople().forEach((p) => {
      const v = p.values[attr.id];
      if (!isEmptyValue(v)) seen[String(v)] = true;
    });
    return Object.keys(seen).sort((x, y) => x.localeCompare(y));
  }

  // Values that only differ by case or spacing look alike in the dropdown but never match.
  function lookAlikes(values) {
    const seen = Object.create(null);
    return values.some((v) => {
      const k = v.trim().toLowerCase();
      if (seen[k]) return true;
      seen[k] = true;
      return false;
    });
  }

  // Fills the value picker for the chosen attribute and sets Add/help accordingly.
  // Called on every change so label values track the people table.
  function renderValueField() {
    const type = els.ruleType.value;
    const a = type === 'size' ? null : attrById(els.ruleAttr.value);
    const isNum = !!a && a.kind === 'integer';
    const prev = els.ruleValue.value;
    els.ruleValue.hidden = isNum;
    els.ruleValueNum.hidden = !isNum;
    els.ruleValue.innerHTML = '';
    const values = !a || isNum ? [] : (a.kind === 'category' ? a.options : labelValues(a));
    values.forEach((o) => els.ruleValue.appendChild(el('option', { value: o, text: o })));
    if (values.indexOf(prev) !== -1) els.ruleValue.value = prev;
    const noLabels = type === 'count' && !!a && a.kind === 'label' && !values.length;
    const missing = type !== 'size' && !ruleAttrs(type).length;
    if (noLabels) els.ruleValue.appendChild(el('option', { value: '', text: 'No values yet' }));
    els.ruleValue.disabled = noLabels;
    els.ruleAdd.disabled = missing || noLabels;
    refreshAndRows();
    if (missing) {
      els.ruleHelp.textContent = type === 'sum' ? 'Add a number attribute first.'
        : type === 'count' ? 'Add an attribute first.'
          : 'Add a category or number attribute first (labels work in count rules only).';
    } else if (noLabels) {
      els.ruleHelp.textContent = `No ${a.name} values yet — add people first.`;
    } else if (type === 'count' && a && a.kind === 'label') {
      els.ruleHelp.textContent = `${RULE_HELP.count} Labels match exact text${lookAlikes(values) ? ' — some values differ only by case or spaces' : ''}.`;
    } else {
      els.ruleHelp.textContent = RULE_HELP[type];
    }
  }

  // ---- "and" conditions of a count rule ---------------------------------------

  function andRows() {
    return Array.from(els.ruleAndRows.querySelectorAll('.gd-and-row')).map((row) => ({
      row, attr: row.querySelector('.gd-and-attr'), val: row.querySelector('.gd-and-val'), num: row.querySelector('.gd-and-num'),
    }));
  }

  // Fills one row's attribute list and value picker, keeping the current picks when still valid.
  function fillAndRow(r) {
    const prevAttr = r.attr.value;
    r.attr.innerHTML = '';
    state.attributes.forEach((a) => r.attr.appendChild(el('option', { value: a.id, text: `${a.name} (${KIND_LABEL[a.kind].toLowerCase()})` })));
    if (state.attributes.some((a) => a.id === prevAttr)) r.attr.value = prevAttr;
    const a = attrById(r.attr.value);
    const isNum = !!a && a.kind === 'integer';
    const prev = r.val.value;
    r.val.hidden = isNum;
    r.num.hidden = !isNum;
    r.val.innerHTML = '';
    const values = !a || isNum ? [] : (a.kind === 'category' ? a.options : labelValues(a));
    values.forEach((o) => r.val.appendChild(el('option', { value: o, text: o })));
    if (values.indexOf(prev) !== -1) r.val.value = prev;
  }

  function refreshAndRows() {
    // Each attribute can appear once per rule: a row that clashes with the main
    // attribute (or an earlier row) moves to a free one, or goes if none is left.
    const used = { [els.ruleAttr.value]: true };
    andRows().forEach((r) => {
      fillAndRow(r);
      if (used[r.attr.value]) {
        const free = state.attributes.find((a) => !used[a.id]);
        if (!free) { r.row.remove(); return; }
        r.attr.value = free.id;
        fillAndRow(r);
      }
      used[r.attr.value] = true;
    });
    // Grey out attributes already taken by the main condition or another row.
    const rows = andRows();
    rows.forEach((r) => {
      const taken = { [els.ruleAttr.value]: true };
      rows.forEach((o) => { if (o !== r) taken[o.attr.value] = true; });
      Array.from(r.attr.options).forEach((opt) => { opt.disabled = !!taken[opt.value]; });
    });
    const total = andRows().length + 1;
    els.ruleAndAdd.disabled = state.attributes.length < 2 || total >= MAX_CONDITIONS || total >= state.attributes.length;
    els.ruleAndAdd.title = state.attributes.length < 2 ? 'Add a second attribute to combine conditions' : '';
  }

  function addAndRow() {
    const attr = el('select', { class: 'form-control form-control-sm gd-and-attr', 'aria-label': 'Also attribute' });
    const val = el('select', { class: 'form-control form-control-sm gd-and-val', 'aria-label': 'Also value' });
    const num = el('input', { type: 'text', inputmode: 'numeric', class: 'form-control form-control-sm gd-and-num', placeholder: 'e.g. 3', hidden: true, 'aria-label': 'Also value', autocomplete: 'off' });
    const del = el('button', { type: 'button', class: 'btn btn-link btn-remove gd-and-del', 'aria-label': 'Remove this condition', text: '×' });
    const row = el('div', { class: 'gd-and-row' }, [el('span', { class: 'gd-and-word', text: 'and' }), attr, el('span', { class: 'gd-and-eq', text: '=' }), val, num, del]);
    // Pick the first attribute not already used by the main condition or other rows.
    const used = {};
    used[els.ruleAttr.value] = true;
    andRows().forEach((r) => { used[r.attr.value] = true; });
    attr.addEventListener('change', () => { fillAndRow({ attr, val, num }); refreshAndRows(); });
    del.addEventListener('click', () => { row.remove(); refreshAndRows(); });
    els.ruleAndRows.appendChild(row);
    const free = state.attributes.find((a) => !used[a.id]);
    fillAndRow({ attr, val, num });
    if (free) { attr.value = free.id; fillAndRow({ attr, val, num }); }
    refreshAndRows();
    attr.focus();
  }
  els.ruleAndAdd.addEventListener('click', addAndRow);

  els.ruleType.addEventListener('change', () => { els.ruleError.textContent = ''; renderRuleForm(); });
  els.ruleAttr.addEventListener('change', renderValueField);

  els.ruleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = els.ruleType.value;
    const fail = (msg) => { els.ruleError.textContent = msg; };
    const rule = { id: uid('r'), type };
    const minRaw = els.ruleMin.value.trim();
    const maxRaw = els.ruleMax.value.trim();
    if (type !== 'size') {
      const a = attrById(els.ruleAttr.value);
      if (!a) return fail('Pick an attribute.');
      rule.attrId = a.id;
      if (type === 'count') {
        if (a.kind === 'integer') {
          if (!isInt(els.ruleValueNum.value)) return fail('Enter a whole-number value.');
          rule.value = parseInt(els.ruleValueNum.value, 10);
        } else {
          if (!els.ruleValue.value) return fail('Pick a value.');
          rule.value = els.ruleValue.value;
        }
        const and = [];
        const used = { [a.id]: true };
        for (const row of andRows()) {
          const a2 = attrById(row.attr.value);
          if (!a2) return fail('Pick an attribute for every “and” condition.');
          if (used[a2.id]) return fail(`Each attribute can be used once per rule (“${a2.name}” repeats).`);
          used[a2.id] = true;
          let v2;
          if (a2.kind === 'integer') {
            if (!isInt(row.num.value)) return fail(`Enter a whole-number value for ${a2.name}.`);
            v2 = parseInt(row.num.value, 10);
          } else {
            if (!row.val.value) return fail(`Pick a value for ${a2.name}.`);
            v2 = row.val.value;
          }
          and.push({ attrId: a2.id, value: v2 });
        }
        if (and.length) rule.and = and;
      }
      if (type === 'apart') {
        const k = els.ruleK.value.trim();
        if (!isInt(k) || parseInt(k, 10) < 1) return fail('“At most” must be a whole number of 1 or more.');
        rule.scope = 'all';
        rule.k = parseInt(k, 10);
      }
      if (type === 'together') {
        rule.scope = 'all';
        const vals = splitList(els.ruleValues.value);
        rule.values = [];
        for (const v of vals) {
          const clean = cleanValue(a, v);
          if (clean === null) return fail(`“${v}” is not a valid ${a.name} value.`);
          rule.values.push(clean);
        }
      }
    }
    if (type === 'size' || type === 'count' || type === 'sum') {
      if (minRaw === '' && maxRaw === '') return fail('Set a min, a max, or both.');
      if ((minRaw !== '' && !isInt(minRaw)) || (maxRaw !== '' && !isInt(maxRaw))) return fail('Min and max must be whole numbers.');
      rule.min = minRaw === '' ? null : parseInt(minRaw, 10);
      rule.max = maxRaw === '' ? null : parseInt(maxRaw, 10);
      if (type !== 'sum' && ((rule.min !== null && rule.min < 0) || (rule.max !== null && rule.max < 0))) return fail('Min and max can’t be negative.');
      if (rule.min !== null && rule.max !== null && rule.min > rule.max) return fail('Min is larger than max.');
      rule.scope = formScope;
    }
    fail('');
    state.rules.push(rule);
    els.ruleMin.value = '';
    els.ruleMax.value = '';
    els.ruleValues.value = '';
    els.ruleAndRows.innerHTML = '';
    refreshAndRows();
    notice(els.rulesNotice, '');
    changed({ rules: true, groups: type === 'size' });
  });

  function overrides(rule) {
    if (!scopeGroups(rule.scope) || rule.type === 'apart' || rule.type === 'together') return false;
    return state.rules.some((r) => r !== rule && r.type === rule.type && r.scope === 'all' &&
      (rule.type === 'size' || (rule.type === 'count' ? condsKey(r) === condsKey(rule)
        : r.attrId === rule.attrId)));
  }

  function ruleTarget(rule) {
    const a = attrById(rule.attrId);
    switch (rule.type) {
      case 'size': return 'Group size';
      case 'count': return ruleConds(rule).map((c) => `${attrById(c.attrId).name} = ${c.value}`).join(' and ');
      case 'sum': return `Sum of ${a.name}`;
      case 'apart': return `Keep apart by ${a.name}`;
      default: return `Keep together by ${a.name}${rule.values && rule.values.length ? ` (${rule.values.join(', ')})` : ''}`;
    }
  }

  function numInput(rule, field, label) {
    const input = el('input', {
      type: 'text', inputmode: 'numeric', class: 'form-control form-control-sm gd-rule-num', autocomplete: 'off',
      value: isEmptyValue(rule[field]) ? '' : String(rule[field]), placeholder: field === 'k' ? '1' : '—',
      'aria-label': `${label} for ${ruleTarget(rule)}`, dataset: { field },
    });
    input.addEventListener('change', () => {
      const raw = input.value.trim();
      if (field === 'k') {
        if (!isInt(raw) || parseInt(raw, 10) < 1) { input.value = String(rule.k); return; }
        rule.k = parseInt(raw, 10);
      } else {
        if (raw !== '' && !isInt(raw)) { input.value = isEmptyValue(rule[field]) ? '' : String(rule[field]); return; }
        rule[field] = raw === '' ? null : parseInt(raw, 10);
      }
      changed();
    });
    return el('label', { class: 'gd-rule-field' }, [el('span', { text: label }), input]);
  }

  function renderRules() {
    els.ruleList.innerHTML = '';
    els.rulesEmpty.hidden = state.rules.length > 0;
    state.rules.forEach((rule) => {
      const li = el('li', { class: 'gd-rule', dataset: { ruleId: rule.id, type: rule.type } });
      li.appendChild(el('span', { class: `gd-rule-type gd-rule-type-${rule.type}`, text: RULE_LABEL[rule.type] }));
      if (rule.type === 'count' && ruleConds(rule).length > 1) {
        // A compound condition reads as one highlighted block, one condition per line.
        const lines = ruleConds(rule).map((c, i) => el('span', { class: 'gd-cond' }, [
          i ? el('span', { class: 'gd-cond-and', text: 'and' }) : null,
          el('span', { class: 'gd-cond-text', text: `${attrById(c.attrId).name} = ${c.value}` }),
        ]));
        li.appendChild(el('span', { class: 'gd-rule-target gd-rule-compound', title: ruleTarget(rule) }, lines));
      } else {
        li.appendChild(el('span', { class: 'gd-rule-target', text: ruleTarget(rule) }));
      }
      const fields = el('span', { class: 'gd-rule-fields' });
      if (rule.type === 'apart') {
        fields.appendChild(numInput(rule, 'k', 'at most'));
      } else if (rule.type !== 'together') {
        fields.appendChild(numInput(rule, 'min', 'min'));
        fields.appendChild(numInput(rule, 'max', 'max'));
        const scope = scopePicker(rule.scope, `Scope of ${ruleTarget(rule)}`, (v) => { rule.scope = v; openScopeRule = rule.id; changed({ rules: true }); });
        scope.classList.add('gd-rule-scope');
        if (rule.id === openScopeRule) scope.open = true;
        fields.appendChild(scope);
        if (overrides(rule)) fields.appendChild(el('span', { class: 'gd-badge', text: 'overrides all-groups rule', title: 'This group uses this rule instead of the all-groups one' }));
      } else {
        fields.appendChild(el('span', { class: 'gd-rule-note muted', text: 'same group' }));
      }
      li.appendChild(fields);
      const del = el('button', { type: 'button', class: 'btn btn-link btn-remove gd-rule-delete', 'aria-label': `Delete rule ${ruleTarget(rule)}`, text: '×' });
      del.addEventListener('click', () => {
        state.rules = state.rules.filter((r) => r !== rule);
        changed({ rules: true, groups: true });
      });
      li.appendChild(del);
      els.ruleList.appendChild(li);
    });
  }

  function renderHints() {
    const hints = Solver.validateHints(state);
    els.hints.innerHTML = '';
    const bad = {};
    hints.forEach((h) => {
      els.hints.appendChild(el('li', { class: `gd-hint is-${h.level}` }, [
        el('span', { class: 'gd-hint-icon', 'aria-hidden': 'true', text: h.level === 'error' ? '⛔' : '⚠️' }),
        el('span', { text: h.message }),
      ]));
      if (h.level === 'error') h.ruleIds.forEach((id) => { bad[id] = true; });
    });
    els.ruleList.querySelectorAll('.gd-rule').forEach((li) => li.classList.toggle('is-error', !!bad[li.dataset.ruleId]));
  }

  // ---- Step 4: draw ---------------------------------------------------------

  function getWorker() {
    if (worker) return worker;
    if (workerBroken || typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL || !URL.createObjectURL) return null;
    try {
      const src = `${randomIndex.toString()}
const S = (${Solver.createSolver.toString()})(randomIndex);
self.onmessage = function (e) {
  var result;
  try { result = S.run(e.data.setup); } catch (err) { result = { status: 'error', message: String((err && err.message) || err) }; }
  self.postMessage({ seq: e.data.seq, result: result });
};`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (e) => {
        if (running && e.data.seq === running.seq) running.resolve(e.data.result);
      };
      worker.onerror = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        workerBroken = true;
        stopWorker();
        if (running && !running.done) running.resolve(Solver.run(running.setup));
      };
      return worker;
    } catch (e) {
      workerBroken = true;
      return null;
    }
  }

  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
  }

  function solveAsync(seq, setup) {
    return new Promise((resolve) => {
      running = { seq, setup, done: false, resolve: (r) => { if (!running || running.seq !== seq || running.done) return; running.done = true; resolve(r); } };
      const w = getWorker();
      if (w) w.postMessage({ seq, setup });
      else setTimeout(() => running && running.seq === seq && running.resolve(Solver.run(setup)), 30);
    });
  }

  // Partial redraw: the ticked groups stay exactly as they are; everyone else is
  // drawn again into the remaining groups. Rules are per group, so that is a
  // smaller draw of the same kind: fewer people, fewer groups, rules remapped.
  function partialActive() {
    return els.partial.checked && !els.partial.disabled && !!shown && shown.version === version;
  }

  function partialPlan() {
    const G = shown.groups.length;
    const keptList = Array.from(kept).filter((g) => g < G).sort((a, b) => a - b);
    const redraw = [];
    for (let g = 0; g < G; g++) if (keptList.indexOf(g) === -1) redraw.push(g);
    const toNew = {};
    redraw.forEach((g, i) => { toNew[g] = i; });
    const sub = clone(state);
    const ids = {};
    redraw.forEach((g) => shown.groups[g].members.forEach((p) => { ids[p.id] = true; }));
    sub.people = state.people.filter((p) => ids[p.id]);
    sub.groups = { count: redraw.length, names: redraw.map(groupLabel) };
    sub.rules = [];
    state.rules.forEach((r) => {
      const list = scopeGroups(r.scope);
      if (!list) { sub.rules.push(clone(r)); return; }
      const mapped = list.filter((g) => g in toNew).map((g) => toNew[g]);
      if (mapped.length) sub.rules.push(Object.assign(clone(r), { scope: normScope(mapped, redraw.length) }));
    });
    return { keptList, redraw, sub };
  }

  // Put the redrawn groups back among the kept ones and re-check everything
  // against the full setup, so any rule the partial draw can't honour is shown.
  function mergePartial(result, plan, setup) {
    if (result.status !== 'ok' && result.status !== 'best-effort') return result;
    const groups = [];
    for (let g = 0; g < shown.groups.length; g++) groups.push(shown.groups[g].members.map((p) => p.id));
    plan.redraw.forEach((g, i) => { groups[g] = result.groups[i]; });
    const violations = Solver.evaluate(setup, groups);
    return { status: violations.length ? 'best-effort' : 'ok', groups, violations, method: result.method };
  }

  function renderPartial() {
    const ok = !!shown && shown.version === version && shown.groups.length > 1;
    els.partial.disabled = !ok;
    els.partialWrap.classList.toggle('is-disabled', !ok);
    if (!ok) els.partial.checked = false;
    const on = els.partial.checked;
    els.results.classList.toggle('is-partial', on);
    els.results.querySelectorAll('.gd-card').forEach((card) => {
      const g = parseInt(card.dataset.group, 10);
      const box = card.querySelector('.gd-keep input');
      if (box) box.checked = kept.has(g);
      card.classList.toggle('is-kept', on && kept.has(g));
    });
    const redraw = ok ? shown.groups.length - Array.from(kept).filter((g) => g < shown.groups.length).length : 0;
    els.partialHint.hidden = !on;
    els.partialHint.textContent = on
      ? (redraw ? `Tick the groups to keep — “Draw again” redraws the other ${redraw}.` : 'All groups are kept — untick at least one to redraw.')
      : '';
    els.draw.disabled = !!running || (on && redraw === 0);
  }

  function draw() {
    if (running) return;
    const n = namedPeople().length;
    if (!n) {
      showStatus('Add at least one person (step 2) to draw groups.');
      return;
    }
    const partial = partialActive() ? partialPlan() : null;
    if (partial && !partial.redraw.length) {
      showStatus('Every group is kept — untick at least one group to redraw.');
      return;
    }
    const seq = ++drawSeq;
    const setup = clone(state);
    const setupVersion = version;
    const reduce = reduceMotion();
    const startedAt = Date.now();
    els.draw.disabled = true;
    els.draw.classList.toggle('is-dealing', !reduce);
    els.draw.setAttribute('aria-busy', 'true');
    els.drawLabel.textContent = 'Drawing…';
    els.copyFallback.hidden = true;
    const slowTimer = setTimeout(() => {
      els.cancel.hidden = false;
      showStatus('Searching for a split that meets every rule…');
    }, 450);
    solveAsync(seq, partial ? partial.sub : setup).then((result) => {
      clearTimeout(slowTimer);
      const wait = reduce ? 0 : Math.max(0, 600 - (Date.now() - startedAt));
      setTimeout(() => finish(partial ? mergePartial(result, partial, setup) : result, setup, setupVersion, partial), wait);
    });
  }

  function finish(result, setup, setupVersion, partial) {
    running = null;
    els.draw.disabled = false;
    els.draw.classList.remove('is-dealing');
    els.draw.removeAttribute('aria-busy');
    els.cancel.hidden = true;
    els.alert.hidden = true;
    els.alert.innerHTML = '';
    if (result.status === 'ok' || result.status === 'best-effort') {
      const entry = makeEntry(result, setup, setupVersion);
      if (partial) entry.kept = partial.keptList;
      history.unshift(entry);
      history = history.slice(0, HISTORY_MAX);
      display(entry, true);
      renderHistory();
      const G = entry.groups.length;
      const what = partial ? `Redrew ${plural(partial.redraw.length, 'group')}, kept ${partial.keptList.length}` : `Drew ${plural(G, 'group')}`;
      showStatus(result.status === 'ok'
        ? `${what}.`
        : `${what} — best effort, ${plural(result.violations.length, 'rule violation')}.`, true);
    } else {
      renderFailure(result);
    }
    renderMeta();
    markOutdated();
  }

  function renderFailure(result) {
    const box = els.alert;
    box.className = 'gd-alert is-error';
    if (result.status === 'cancelled') {
      showStatus('Draw cancelled.');
      return;
    }
    if (result.status === 'empty' || result.status === 'error') {
      showStatus(result.message || 'Something went wrong — please try again.');
      return;
    }
    const title = result.status === 'timeout'
      ? 'Couldn’t find a valid split in time (it may not exist).'
      : 'These rules can’t all be met — no valid split exists.';
    box.appendChild(el('p', { class: 'gd-alert-title', text: title }));
    if (result.reasons && result.reasons.length) {
      box.appendChild(el('ul', { class: 'gd-reasons' }, result.reasons.map((r) => el('li', { text: r }))));
    }
    if (result.blame && result.blame.length) {
      box.appendChild(el('p', { class: 'gd-alert-sub', text: 'Rules to look at:' }));
      box.appendChild(el('ul', { class: 'gd-blame' }, result.blame.map((b) => el('li', { text: b.message }))));
    } else if (result.status === 'infeasible' && !(result.reasons && result.reasons.length)) {
      box.appendChild(el('p', { class: 'gd-alert-sub', text: 'No single rule is to blame — several rules conflict.' }));
    }
    box.appendChild(el('p', { class: 'gd-alert-sub muted', text: 'Loosen a rule, or tick “Allow best effort” to get the closest split.' }));
    box.hidden = false;
    showStatus(result.status === 'timeout' ? 'Couldn’t find a valid split in time.' : 'Couldn’t draw: the rules can’t all be met.');
    if (shown) {
      els.resultsWrap.classList.add('is-outdated');
      els.outdated.hidden = false;
    }
  }

  function showStatus(text, highlight) {
    els.status.textContent = '';
    els.status.classList.remove('is-fresh');
    if (!reduceMotion()) { void els.status.offsetWidth; els.status.classList.add('is-fresh'); }
    if (highlight) {
      const m = text.match(/^(Drew )(\d+)( .*)$/);
      if (m) {
        els.status.appendChild(document.createTextNode(m[1]));
        els.status.appendChild(el('span', { class: 'highlight', text: m[2] }));
        els.status.appendChild(document.createTextNode(m[3]));
        return;
      }
    }
    els.status.textContent = text;
  }

  // Snapshot what is needed to re-display a draw later, even after edits.
  function makeEntry(result, setup, setupVersion) {
    const byId = {};
    setup.people.forEach((p) => { byId[p.id] = p; });
    const attrs = setup.attributes;
    const ruleAttrIds = {};
    setup.rules.forEach((r) => {
      if (r.type === 'count') ruleConds(r).forEach((c) => { ruleAttrIds[c.attrId] = true; });
      else if (r.attrId) ruleAttrIds[r.attrId] = true;
    });
    return {
      no: drawSeq,
      time: new Date(),
      version: setupVersion,
      status: result.status,
      violations: result.violations || [],
      attrs,
      ruleAttrIds,
      countTargets: setup.rules.filter((r) => r.type === 'count')
        .reduce((acc, r) => acc.concat(ruleConds(r).map((c) => ({ attrId: c.attrId, value: c.value }))), [])
        .filter((t, i, arr) => arr.findIndex((x) => x.attrId === t.attrId && String(x.value) === String(t.value)) === i),
      sumAttrs: setup.rules.filter((r) => r.type === 'sum').map((r) => r.attrId).filter((x, i, arr) => arr.indexOf(x) === i),
      groups: result.groups.map((ids, g) => ({
        name: (setup.groups.names[g] || '').trim() || `${groupWord(setup.groups)} ${g + 1}`,
        members: ids.map((id) => byId[id]).filter(Boolean),
      })),
    };
  }

  function keepBox(g, name) {
    const box = el('input', { type: 'checkbox', dataset: { group: String(g) }, 'aria-label': `Keep ${name} as it is` });
    box.addEventListener('change', () => {
      if (box.checked) kept.add(g); else kept.delete(g);
      renderPartial();
    });
    return el('label', { class: 'gd-keep' }, [box, el('span', { text: '🔒 Keep' })]);
  }

  function composition(entry, members) {
    const bits = [];
    const attrs = {};
    entry.attrs.forEach((a) => { attrs[a.id] = a; });
    // Rule-relevant categories: every option of category attributes used in rules.
    entry.attrs.filter((a) => a.kind === 'category' && entry.ruleAttrIds[a.id]).forEach((a) => {
      a.options.forEach((o) => {
        const c = members.filter((p) => p.values[a.id] === o).length;
        if (c) bits.push(`${c} ${o}`);
      });
    });
    entry.countTargets.filter((t) => attrs[t.attrId] && attrs[t.attrId].kind === 'integer').forEach((t) => {
      const c = members.filter((p) => String(p.values[t.attrId]) === String(t.value)).length;
      bits.push(`${c} × ${attrs[t.attrId].name} ${t.value}`);
    });
    entry.sumAttrs.forEach((id) => {
      if (!attrs[id]) return;
      const s = members.reduce((acc, p) => acc + (Number(p.values[id]) || 0), 0);
      bits.push(`Σ ${attrs[id].name} ${s}`);
    });
    return bits.join(' · ');
  }

  function display(entry, animate) {
    shown = entry;
    const reduce = reduceMotion() || !animate;
    els.results.innerHTML = '';
    const showAll = els.showAttrs.checked;
    const labels = entry.attrs.filter((a) => a.kind === 'label');
    const others = entry.attrs.filter((a) => a.kind !== 'label');
    const G = entry.groups.length;
    const cardStep = Math.min(140, 1100 / Math.max(1, G));
    const frozen = new Set(entry.kept || []);

    entry.groups.forEach((group, g) => {
      const color = PALETTE[g % PALETTE.length];
      const card = el('article', { class: 'team-card gd-card', dataset: { group: String(g) } });
      card.style.setProperty('--team-color', color);
      const head = el('div', { class: 'team-card-head' }, [
        el('h3', { class: 'team-name gd-card-name', text: group.name }),
        el('span', { class: 'team-size', text: plural(group.members.length, 'member') }),
        keepBox(g, group.name),
      ]);
      card.appendChild(head);
      const comp = composition(entry, group.members);
      if (comp) card.appendChild(el('p', { class: 'gd-comp', text: comp }));
      const ul = el('ul', { class: 'team-members gd-members' });
      const memberStep = Math.min(45, 500 / Math.max(1, group.members.length));
      group.members.forEach((p, mi) => {
        const li = el('li', { class: 'team-member gd-member', dataset: { personId: p.id } }, [el('span', { class: 'gd-member-name', text: p.name })]);
        const labelText = labels.map((a) => p.values[a.id]).filter((v) => !isEmptyValue(v)).join(' ');
        if (labelText) li.appendChild(el('span', { class: 'gd-member-label', text: ' ' + labelText }));
        if (showAll) {
          const chips = others.filter((a) => !isEmptyValue(p.values[a.id]))
            .map((a) => el('span', { class: 'gd-attr-chip', title: a.name, text: `${a.name}: ${p.values[a.id]}` }));
          if (chips.length) li.appendChild(el('span', { class: 'gd-member-chips' }, chips));
        }
        if (!reduce && !frozen.has(g)) {
          li.style.animationDelay = Math.round(g * cardStep + 180 + mi * memberStep) + 'ms';
          li.classList.add('is-popping');
        }
        ul.appendChild(li);
      });
      if (!group.members.length) ul.appendChild(el('li', { class: 'gd-member-empty muted', text: 'Nobody' }));
      card.appendChild(ul);
      if (!reduce && !frozen.has(g)) {
        card.style.animationDelay = Math.round(g * cardStep) + 'ms';
        card.classList.add('is-dealt');
      }
      els.results.appendChild(card);
    });

    els.results.dataset.drawNo = String(entry.no);
    els.actions.hidden = false;
    renderPartial();
    renderViolations(entry);
    markOutdated();
    renderHistoryCurrent();
  }

  function renderViolations(entry) {
    els.alert.innerHTML = '';
    if (entry.status !== 'best-effort') { els.alert.hidden = true; return; }
    els.alert.className = 'gd-alert is-warning';
    els.alert.appendChild(el('p', { class: 'gd-alert-title', text: `Best effort: ${plural(entry.violations.length, 'rule is', 'rules are')} not met.` }));
    els.alert.appendChild(el('ul', { class: 'gd-violations' }, entry.violations.map((v) => el('li', { text: v.message + (v.rule ? ` (${v.rule})` : '') }))));
    els.alert.hidden = false;
  }

  function renderHistory() {
    els.history.innerHTML = '';
    history.forEach((entry) => {
      const time = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const btn = el('button', { type: 'button', class: 'gd-history-btn', dataset: { drawNo: String(entry.no) } }, [
        el('span', { class: 'gd-history-no', text: `#${entry.no}` }),
        el('span', { text: `${plural(entry.groups.length, 'group')} · ${time}` }),
        entry.kept && entry.kept.length ? el('span', { class: 'gd-badge', text: `${entry.kept.length} kept` }) : null,
        entry.status === 'best-effort' ? el('span', { class: 'gd-badge is-warning', text: 'best effort' }) : null,
      ]);
      btn.addEventListener('click', () => {
        display(entry, false);
        showStatus(`Showing draw #${entry.no}.`);
      });
      els.history.appendChild(el('li', {}, [btn]));
    });
    els.historyWrap.hidden = history.length < 2;
    renderHistoryCurrent();
  }

  function renderHistoryCurrent() {
    els.history.querySelectorAll('.gd-history-btn').forEach((b) => {
      const on = shown && b.dataset.drawNo === String(shown.no);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  els.draw.addEventListener('click', draw);
  els.partial.addEventListener('change', () => { if (els.partial.checked) kept = new Set(); renderPartial(); });
  els.cancel.addEventListener('click', () => {
    if (!running) return;
    stopWorker();
    running.resolve({ status: 'cancelled' });
  });
  els.showAttrs.addEventListener('change', () => { if (shown) display(shown, false); });

  // ---- Result export ---------------------------------------------------------

  function resultText(entry) {
    return entry.groups.map((g) => `${g.name} (${g.members.length}): ${g.members.map((p) => p.name).join(', ')}`).join('\n') + '\n';
  }

  function csvCell(v) {
    let s = isEmptyValue(v) ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+$/.test(s)) s = "'" + s; // spreadsheet formula guard
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function resultCsv(entry) {
    const lines = [['group', 'name'].concat(entry.attrs.map((a) => a.name)).map(csvCell).join(',')];
    entry.groups.forEach((g) => g.members.forEach((p) => {
      lines.push([g.name, p.name].concat(entry.attrs.map((a) => p.values[a.id])).map(csvCell).join(','));
    }));
    return lines.join('\n') + '\n';
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  els.copy.addEventListener('click', () => {
    if (!shown) return;
    const text = resultText(shown);
    const fallback = () => {
      els.copyText.value = text;
      els.copyFallback.hidden = false;
      els.copyText.focus();
      els.copyText.select();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        els.copy.textContent = 'Copied ✓';
        setTimeout(() => { els.copy.textContent = 'Copy as text'; }, 1500);
      }, fallback);
    } else fallback();
  });
  els.csv.addEventListener('click', () => { if (shown) download('group-draw.csv', resultCsv(shown), 'text/csv'); });

  // ---- Setup import / export / reset ------------------------------------------

  els.exportBtn.addEventListener('click', () => {
    download('group-draw-setup.json', JSON.stringify(setupForExport(), null, 2), 'application/json');
    notice(els.ioNotice, 'Setup exported as group-draw-setup.json.');
  });
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => {
    const file = els.importFile.files && els.importFile.files[0];
    els.importFile.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (e) {
        notice(els.ioNotice, 'Couldn’t import: the file is not valid JSON.', 'error');
        return;
      }
      const res = parseSetup(data);
      if (!res.ok) { notice(els.ioNotice, `Couldn’t import: ${res.error}`, 'error'); return; }
      const s = res.setup;
      const summary = `${plural(s.attributes.length, 'attribute')}, ${plural(s.people.length, 'person', 'people')}, ${plural(s.rules.length, 'rule')}`;
      if (!window.confirm(`Replace the current setup with ${summary}?`)) return;
      replaceSetup(s);
      notice(els.ioNotice, `Imported ${summary}.`);
    };
    reader.onerror = () => notice(els.ioNotice, 'Couldn’t read that file.', 'error');
    reader.readAsText(file);
  });

  function hasContent() {
    return state.attributes.length || state.people.length || state.rules.length;
  }

  els.loadExample.addEventListener('click', () => {
    if (hasContent() && !window.confirm('Replace the current setup with the example?')) return;
    const res = parseSetup(clone(GROUP_DRAW_EXAMPLE));
    if (!res.ok) return;
    replaceSetup(res.setup);
    notice(els.ioNotice, 'Loaded the example: 30 people, 5 groups, 3 rules.');
  });

  els.resetBtn.addEventListener('click', () => {
    if (!window.confirm('Reset Group Draw? This clears attributes, people, rules and results.')) return;
    if (running) { stopWorker(); running.resolve({ status: 'cancelled' }); }
    history = [];
    shown = null;
    els.results.innerHTML = '';
    els.results.removeAttribute('data-draw-no');
    els.actions.hidden = true;
    els.alert.hidden = true;
    els.copyFallback.hidden = true;
    showStatus('');
    renderHistory();
    notice(els.rulesNotice, '');
    replaceSetup(emptySetup());
    notice(els.ioNotice, 'Everything cleared.');
  });

  els.clearSaved.addEventListener('click', () => {
    clearTimeout(saveTimer);
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }
    notice(els.ioNotice, 'Saved data cleared from this browser. The current setup stays until you reload.');
  });

  // ---- Init --------------------------------------------------------------------

  const saved = loadSaved();
  if (saved) state = saved;
  syncAttrKind();
  renderAll();
  renderHistory();
})();
