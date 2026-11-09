# Spec — Group Draw (constrained assignment of people to groups)

Status: implemented (v1 + follow-ups, see §11) · Owner: Marcin · Related: `CLAUDE.md`, `ROADMAP.md`,
existing `team_splitter.js` (the simple, unconstrained cousin of this feature).

## 1. Summary

A new **view** ("Group Draw") on the Dice Roll page. The user defines a custom data
set of *people* with *custom attributes*, then repeatedly draws a random split of
those people into *output groups*, subject to per-group rules. It is a power-user
version of "Split into teams": same fairness guarantees, but with structure.

Example: attributes `surname` (label), `team` (integer), `type` (category:
consultant / developer / manager). 30 people. Draw 5 groups where every group has
1–2 managers, at least 2 consultants, and never two people from the same `team`.

## 2. Constraints (inherited — see `CLAUDE.md`)

- Static files only: HTML5 + Bootstrap 4 + vanilla JS (ES2015+). No build step,
  framework, back-end, or external library.
- **Fair randomness:** every random decision goes through `randomIndex()` /
  `randomInt()` in `appFE/random.js`. `Math.random()` only for cosmetic animation.
  Pick the result first, then animate toward it.
- **Anonymous & stateless:** nothing sent anywhere. `localStorage` only as an
  optional convenience; the feature must fully work without it. Export/import
  (JSON file) is the user-controlled way to keep a setup.
- **Independent:** this view shares no state with other tools.
- **No console errors**; reduced-motion aware; works at 375 px; dark mode; a11y
  (labels, keyboard operation, `aria-live` results). "Ship it polished" applies —
  `ux-polisher` pass is part of done.

## 3. Navigation: a separate view

The page currently is a single grid of tool cards. Introduce a minimal top-level
view switcher (Bootstrap 4 `nav-pills`/tabs, no framework):

- Tab 1 **"Quick tools"** — everything that exists today, unchanged.
- Tab 2 **"Group Draw"** — the new view.
- Switching is client-side show/hide (`hidden` attr / class), keyboard accessible
  (`role="tablist"`, arrow keys), selected tab reflected in the URL hash
  (`#group-draw`) so it is linkable; default is Quick tools.
- Existing tests/IDs for current tools must keep working (they live in the default
  tab, which is visible on load).
- Switching tabs never resets either view's state.

## 4. User flow

The Group Draw view is a 4-step flow shown as a stepper (steps 1–2 = *Setup*,
3–4 = *Draw*). Steps 3–4 can be repeated any number of times for one setup;
changing the setup (steps 1–2) invalidates old rules/results as described in §4.5.

### 4.1 Step 1 — Define attributes

User adds any number of attributes. Each has:

| Field | Notes |
|---|---|
| Name | required, unique (case-insensitive), e.g. `surname`, `team`, `type` |
| Kind | `label` · `integer` · `category` |
| Options | only for `category`: ordered list of allowed values (≥ 1, unique, e.g. consultant, developer, manager) |

Kinds:

- **label** — free text, display-only. Usable in **count rules only** (exact-text match, empty ignored; the rule's value is picked from the values present in the data). Not usable in sum, keep-apart or keep-together rules. Not required to be unique.
- **integer** — whole number (negative allowed). Usable in count rules (treated as
  a category by value), spread rules, and optional sum rules (§4.3).
- **category** — value must be one of the options. Usable in count and spread rules.

Rules: ≥ 1 attribute required to proceed? **No** — zero attributes is allowed
(then it behaves as a plain team splitter and only group-size rules exist). Deleting
an attribute or a category option that is in use asks for confirmation and removes
dependent values/rules. Renaming is free. A value of an attribute may be left empty
(`—`); empty values are never counted by any rule.

### 4.2 Step 2 — Add people

A person = `name` (required, built-in, not a custom attribute) + one value per
defined attribute. Entry methods (all three):

1. **Table editor** — one row per person, a column per attribute; inputs match kind
   (text, number, dropdown for category). Add/delete row, inline validation
   (red cell + message), duplicate names get a warning (allowed, internally each
   person has a stable `id`).
2. **Paste from spreadsheet/CSV** — textarea accepting tab- or comma-/semicolon-
   separated rows; first line may be a header. Columns map to `name` + attributes by
   header name, otherwise by position (a mapping preview is shown before
   importing). Unknown category values: offer "add as new option" or "leave
   empty". Invalid integers listed per row; nothing is imported until the user
   confirms.
3. **Import JSON** (see §7).

A **Clear all** button (visible when people exist) removes every person. Shows a live count ("42 people") and a per-category summary line.
Soft limit: 500 people; hard limit 2000 (message beyond that). Limits keep the
solver responsive.

### 4.3 Step 3 — Define drawing criteria

**Groups.** Number of groups `G` (2–50). Group names default to "Group 1…G", each
renameable; the **group name word** (`groups.label`, e.g. "Pokój" → "Pokój 1, Pokój 2…")
replaces "Group" in results, copy/CSV and rule text. The draw always assigns **every person to exactly one group**.

**Rules** are *per group* (decision from the product owner). UI model: a rules
table with a **scope** column — `All groups` (default; applies to every group
individually), one specific group, or several groups picked with checkboxes
(e.g. 1, 2, 3 of 6). A specific-group rule *overrides* an all-groups rule for the
same (attribute, value) target in each group it names.

**Partial redraw** (step 4): with "Partial redraw" ticked, each result card gets a
🔒 Keep checkbox. "Draw again" then leaves the kept groups untouched and redraws
only the people in the other groups among those groups (rules remapped to them).
The merged result is re-checked against the full setup. Only offered while the
shown draw matches the current setup.

Rule types:

1. **Group size** — `min` and `max` people in the group. Default (no rule):
   sizes as equal as possible (differ by at most 1) — see "Balance" option below.
2. **Count rule** — for `attribute = value` (category option, integer value, or a
   label value picked from the values present in the data — exact-text match,
   empty labels never count): `min` and `max` number of such people in the group.
   Either bound may be blank. Examples: `type = manager`: min 1, max 2, scope All
   groups; `surname = Smith`: max 1.
   **Compound conditions:** a count rule may add up to 3 extra `and attribute = value`
   conditions (max 4, each attribute at most once); it then counts only people
   matching *all* of them, e.g. `team = red and gender = male`: min 1, max 2. Rules
   with the same condition set intersect; different sets are independent counters
   (a person can count towards several). Deleting an attribute or option used by
   any condition removes the whole rule (dropping a condition would broaden it).
3. **Sum rule (integer attributes only)** — min/max of the *sum* of the attribute
   within a group. (Average is deliberately not offered in v1: it is awkward with
   varying group sizes.)
4. **Spread rule — "keep apart"** — for an attribute (category or integer): at
   most `k` people sharing the same value in one group (default `k = 1`, i.e. no
   two with the same `team`). Applies to every value of the attribute. Scope is
   all groups.
5. **Spread rule — "keep together"** — all people sharing a value of the
   attribute land in the same group (e.g. everyone on `team 3`). Optionally
   restricted to chosen values. Two different keep-together rules combine
   transitively (union of the sets).

Other settings:

- **Balance** (checkbox, default on): when no group-size rule exists, group sizes
  differ by at most 1. If size rules exist, they win and balance is off.
- **Mode when criteria cannot be met** (decision: *user chooses*):
  - **Strict** (default) — no draw if impossible; an error explains why.
  - **Best effort** — toggle "Allow best effort"; always produces a split,
    minimizing the number/size of violated rules and listing every violation.

**Live validation (before pressing Draw).** Cheap necessary-condition checks run
on every edit and show inline messages, e.g.:
- sum of group-size mins > people, or sum of maxes < people;
- Σ count-rule mins for a value > number of people with that value (and Σ maxes <
  that number) — "5 groups × min 2 consultants = 10, but only 7 consultants";
- `min > max`; keep-apart `k` too small (value with 8 people, 5 groups, k=1);
- keep-together set larger than the max group size;
- rule on a value with no people (warning only).
These are *hints*; the solver is the source of truth (§5). Infeasibility not
caught by the hints is reported after Draw with the most likely culprit rule(s)
(§5.4).

### 4.4 Step 4 — Draw and output

- Primary button **Draw**. Also **Draw again** (new random result, same setup and
  rules), usable indefinitely. Optional **Lock** toggle on each person is out of
  scope for v1 (see §9).
- Output: one **card per group**: group name, member count, list of person names
  (with label attributes and optionally other attribute values as small chips —
  toggle "Show attributes"). Header of each card shows a compact composition
  summary per rule-relevant category (e.g. `2 consultants · 1 manager`).
  Colour per group (reuse the `TEAM_PALETTE` idea from `team_splitter.js`).
- **Reveal moment** (polish requirement): groups appear card by card with a short
  stagger animation, names pop in; a brief shuffle/"dealing" animation on the
  button press. All of it cosmetic and after the result is already computed.
  `prefers-reduced-motion` → instant render.
- Result actions: **Copy as text** (one line per group: `Name (n): A, B, C` — comma-separated names), **Download
  CSV** (`group,name,<attrs…>`), and a small **history** of the last 10 draws in
  this session (read-only, click to re-display). History is in memory only.
- Best-effort result shows a prominent warning panel listing violated rules and by
  how much; strict-mode failure shows an error panel instead of cards (previous
  result stays visible but is dimmed/marked as outdated).
- `aria-live="polite"` announces "Drew 5 groups" / the error.

### 4.5 Repeating and editing

- Steps 3–4 can be repeated freely. Rules are kept between draws.
- Editing attributes/people after a draw: results panel is marked "outdated"
  (still readable, Draw again refreshes). Rules referencing removed
  attributes/values are removed with a visible notice.
- "Reset all" button (with confirm) clears the entire view.

## 5. Drawing algorithm

### 5.1 Principles

- All randomness via `randomIndex`/`randomInt` (shuffles = Fisher–Yates with
  `randomIndex`, same as `team_splitter.js`). Never `sort(() => Math.random()-.5)`.
- The solver computes the complete assignment *first*; animation only reveals it.
- Deterministic input → no hidden state: nothing but fresh randomness differs
  between two draws.

### 5.2 Method (hybrid)

1. **Normalize** rules into per-group constraints (expand "All groups", apply
   overrides). Merge keep-together sets into *blocks* (a block is placed as a
   unit; ordinary people are blocks of size 1).
2. **Fast path — rejection sampling.** Shuffle people, deal into groups with
   target sizes, check all constraints; repeat up to `N = 200` times. A result
   accepted this way is an *exactly uniform* sample over valid assignments of the
   dealing scheme (with fixed size vector) — best fairness when constraints are
   loose.
3. **Constructive path — randomized backtracking.** If the fast path fails:
   process blocks in a random order, most-constrained first (tie-break random),
   try groups in a random order, prune with the necessary-condition checks of
   §4.3 recomputed on remaining capacity, backtrack on dead ends. Limits: 50 000
   nodes or ~1.5 s wall-clock per draw (whichever first), executed in a Web Worker
   — **or** chunked with `setTimeout` if a Worker is awkward without a build step
   (inline Worker via `Blob` URL is allowed; no extra files required). The UI
   shows a spinner and a Cancel button for long draws.
4. **Proof of infeasibility (best effort).** If the search space is exhausted
   (not timed out), the setup is truly infeasible → §5.4. If timed out, say
   "couldn't find a valid split in time (it may not exist)".
5. **Best-effort mode.** Run the constructive path with soft constraints: the
   cost is the sum of violation amounts (size, count, sum, spread) weighted
   equally; random-restart hill climbing (swap two people between groups, accept
   if cost does not increase, random tie-breaks) for up to 1.5 s, return the
   cheapest of the runs (ties broken randomly). Cost 0 ⇒ it is a normal valid
   result.

### 5.3 Fairness statement (to show in a tooltip / README)

"Every draw uses cryptographically secure randomness. With no rules, or only rules a random shuffle can satisfy, every split is equally likely. When rules need searching (keep together, tight limits), splits are random but not uniform among all valid ones; the repair and best-effort fallbacks are not uniform either." — we are honest about this limitation.
`fairness-auditor` must review that no `Math.random()` is used for outcomes and
that candidate/group ordering uses the fair RNG.

### 5.4 Explaining infeasibility

On proven infeasibility, report: (a) the failed necessary-condition checks, if
any, else (b) a short minimal-ish blame list: re-solve while dropping one rule at
a time (≤ 30 rules, each with a 200 ms budget) and list rules whose removal makes
it solvable ("Dropping *type=manager max 1* makes this feasible").

## 6. Code structure (follows project conventions)

New files in `appFE/` (one JS file per concern; all loaded after `random.js`):

- `group_draw.js` — UI: tabs-view wiring, stepper, attribute/person/rule editors,
  rendering, history, copy/CSV, import/export.
- `group_draw_solver.js` — pure, DOM-free functions: `normalizeRules`,
  `validateHints`, `solve(people, groups, rules, opts)`, `bestEffort(...)`.
  Exposed as `window.GroupDrawSolver` (so it can be unit-tested in Playwright via
  `page.evaluate`, and loaded into an inline Worker via `Function.prototype.toString`
  if the Worker option is used).
- `style.css` — new section "Group Draw", reuse `tool-card`, `result-line`,
  `btn-row`, `team-results` look; add only what's missing (tabs, stepper, editable
  table, rule rows, group cards).
- `index.html` — tab nav + new `<section id="group-draw-view">` + two script tags.
- Tab switcher: small `view_tabs.js` (or inside `group_draw.js` if tiny).

State shape (in-memory single object):

```js
{
  attributes: [{ id, name, kind: 'label'|'integer'|'category', options?: string[] }],
  people:     [{ id, name, values: { [attrId]: string|number|null } }],
  groups:     { count, names: string[], label?: string /* group name word */ },
  rules:      [{ id, type: 'size'|'count'|'sum'|'apart'|'together',
                 scope: 'all'|groupIndex|groupIndex[], attrId?, value?, and?: [{attrId, value}] /* count */, min?, max?, k? }],
  options:    { balance: true, bestEffort: false },
  results:    [/* history */]
}
```

## 7. Persistence, export & import

- **Export JSON** — downloads `{ version: 1, attributes, people, groups, rules,
  options }` (no results). **Import JSON** — validates schema/version, shows a
  summary ("3 attributes, 42 people, 4 rules"), replaces current setup after
  confirmation; malformed files give a readable error, never a console error.
- **Optional `localStorage` autosave** of the same object under key
  `groupDraw.setup.v1`, restored on load; all access wrapped in try/catch; a
  "Clear saved data" link. The view works identically when storage is unavailable.
  (Contains personal names — hence a one-line privacy note: "Stays in this
  browser. Nothing is uploaded.")
- No server storage, ever.

## 8. Acceptance criteria / tests

Playwright tests (add to `tests/test_app.py` following existing patterns; the
fixture already fails on console errors). Pure-solver tests via
`page.evaluate(() => GroupDrawSolver.solve(...))`.

1. Tab switch: Quick tools visible by default; clicking "Group Draw" hides tools and
   shows the view; hash `#group-draw` opens it directly; existing tool tests
   still pass.
2. Attributes: add label/integer/category; category requires ≥ 1 option; duplicate
   name rejected; delete-in-use asks for confirmation.
3. People: table add/edit/delete; CSV/TSV paste with header and without; bad
   integer and unknown category are reported and not silently imported.
4. Rules: count/size/sum/apart/together can be created; scope all vs one group;
   override works; live hints appear for impossible setups (the 5×2-vs-7
   consultants example).
   A count rule can combine conditions with "+ and condition" (AND; repeated
   attribute refused; counts only people matching all conditions).
   Label attributes appear as count-rule targets (value dropdown of distinct
   values present) but not for sum/apart/together.
5. Draw (strict): every person appears in exactly one group; all rules satisfied
   (verified independently in the test by recomputing from the DOM output);
   running Draw 50× on a solvable setup never violates a rule.
6. Draw again yields different splits across repeated runs (statistical:
   ≥ 2 distinct results in 20 draws for a non-trivial setup).
7. Infeasible setup, strict: error panel shown, names to blame listed, no cards.
8. Infeasible setup, best effort: cards shown + violation list non-empty.
9. Keep-together keeps blocks together; keep-apart (`k=1`) separates all same-value
   people when feasible.
10. Uniformity smoke test (solver): with no rules, 3 people into 3 groups of 1,
    10 000 draws → each person lands in each group within ±5 % of 1/3.
11. Export → reset → import round-trips to an identical setup; invalid JSON shows
    an error message.
12. Performance: 200 people, 10 groups, 4 rules solves in < 2 s.
13. Copy-as-text and CSV contain all people exactly once.
14. 375 px viewport: no horizontal page scroll; editors usable (table scrolls
    inside its own container).
15. `prefers-reduced-motion`: results appear immediately; no console errors.
16. Independence: running Group Draw does not change any other tool's inputs/results.

Docs to update when shipping: `README.md` (project structure), `ROADMAP.md`
(new entry, checked), `tests/test_app.py`, and skill `add-tool` notes if the tab
mechanism changes the recipe.

## 9. Out of scope for v1 (parking lot)

- Locking/pinning a person to a group, or "must/must-not be with person X".
- Weighted objectives (soft rule priorities), average-based rules.
- Multiple saved setups, shareable URLs with embedded data.
- Drag-and-drop manual adjustment of the result.
- **True keep apart / keep together on label attributes** (next phase; e.g. no two people with the same surname in a group). Label attributes already support count rules (§4.3).
- Per-attribute columns reorder, sorting/filtering in the table (nice later).

## 10. Decisions

Confirmed by the product owner:

1. `name` is a fixed built-in field, not a custom attribute.
2. Label attributes are usable in count rules only; keep apart/together on labels is parked for the next phase (see §9).
3. Sum rules exist for integer attributes only; no average rules (not wanted).
4. Keep-apart/together scopes are global (not per-group).

Defaults adopted (not objected to): "Balance" on by default and disabled by
group-size rules; best effort weighs all violations equally; tab switching via
URL hash; delivery flow game-builder → test-engineer → fairness-auditor → ux-polisher.

## 11. Implementation map (where things live)

Orientation for future work. Line numbers drift — grep the function/ID names. UI element
IDs are all `gd-*` in `appFE/index.html` (view root `#group-draw-view`, ~l.233; cached in the
`els` object at the top of `group_draw.js`).

### 11.1 Files

| File | Role |
|---|---|
| `appFE/view_tabs.js` | Quick tools / Group Draw tab switcher (`role=tablist`, arrows, `#group-draw` hash). |
| `appFE/group_draw.js` (IIFE, ~1750 l.) | All UI + state (`state`, `version`, `history`, `shown`, `kept`). |
| `appFE/group_draw_solver.js` | Pure solver `createSolver(randomIndex)` → `window.GroupDrawSolver`. |
| `appFE/data/group_draw_example.js` | `GROUP_DRAW_EXAMPLE` for "Load example". |
| `appFE/theme.js` | Light/dark toggle (`data-theme` on `<html>`, `localStorage` key `theme`); not Group Draw-specific but all `.gd-*` CSS uses its tokens. |
| `appFE/style.css` | "Group Draw" section from ~l.1108 (`.gd-*`); dark-mode select fix ~l.1668; compound-condition styles ~l.1793–1833. |
| `tests/test_app.py` | `test_gd_*` (l.~727–1900) + `test_theme_*`; see §11.5. |

### 11.2 `group_draw.js` by area (grep the function name)

- **Helpers / setup**: `emptySetup`, `groupWord`/`groupLabel` (group name word), `setupForExport`, `scheduleSave`/`loadSaved` (autosave `groupDraw.setup.v1`), `parseSetup` (import validation), `cleanValue`, `cleanRule`, `cleanScope`/`normScope`/`scopeGroups`, `changed` (bumps `version`, marks results outdated), `replaceSetup`, `renderAll`.
- **Step 1 attributes**: `renderAttributes`, `optionChips`/`removeOption`, `deleteAttribute` (confirm + cascade; removes whole rules using it — `ruleUsesAttr`), `syncAttrKind`, `validAttrName`.
- **Step 2 people**: `renderTable`/`personRow`/`onCellEdit`, `flagDuplicates`; **Clear all** = `els.peopleClear` handler (~l.588; button `#gd-people-clear`, hidden when empty); paste import = `parseDelimited` → `guessMapping` → `planImport` → `renderPastePreview` → `commitPaste`.
- **Step 3 groups & rules**: `renderGroups` (count, group name word `#gd-group-word`, per-group names, balance/best-effort), `ruleAttrs(type)` (which attrs each rule type may target; labels only for `count`), `scopePicker`/`scopeSummary` (all / one / multi-group scope), `renderRuleForm`, `labelValues` (distinct label values present in data → count-rule dropdown, kept in sync) , `renderValueField`, **compound conditions**: `andRows`/`fillAndRow`/`refreshAndRows`/`addAndRow` (extra `+ and condition` rows; `MAX_CONDITIONS`=4, each attribute once — attribute options already used are disabled in the other rows so clashes are impossible), rule submit handler (~l.1091, `fail()` messages), `overrides`/`ruleTarget`/`renderRules` (rule list; compound rules render as one tinted block with `AND` badges, `.gd-cond*`), `renderHints` (calls `Solver.validateHints`).
- **Rule shape helpers**: `ruleConds(rule)` = main condition + `rule.and[]`; `condsKey` identifies a condition set; `cleanRule` sanitises on import.
- **Step 4 draw**: `getWorker`/`solveAsync`/`stopWorker` (inline Blob Worker built from `Solver.createSolver.toString()`; falls back to main thread if `workerBroken`), `draw`, `finish`, `renderFailure`, `showStatus`, `makeEntry`, `display` (card-by-card reveal; instant under reduced motion), `composition`, `renderViolations`.
- **Partial redraw**: `partialActive`, `partialPlan` (builds a sub-setup of the unkept groups, scope-remapped), `mergePartial` (merges + re-evaluates against full setup), `renderPartial`, `keepBox` (🔒 Keep checkbox per card; only offered when shown draw matches current `version`).
- **Output**: `renderHistory`/`renderHistoryCurrent` (last 10, memory only), `resultText` (copy format), `resultCsv`/`csvCell` (formula-injection-safe), `download`.
- **Wiring**: bottom of file — Load example, Reset all, Clear saved data, import/export handlers; `hasContent` gates confirmations.

### 11.3 `group_draw_solver.js` (public API: `normalizeRules, validateHints, scopeHas, solve, bestEffort, evaluate, run, blame, describeRule`)

- Limits (top): `NODE_LIMIT` 50000, `TIME_MS` 1500, `FAST_TRIES` 200, `BLAME_RULES` 30.
- `conditionsOf`/`condText`/`usable`: compound count rules; a rule with contradicting conditions (same attr, different values) is *unusable* → ignored.
- `normalizeRules` builds the model `m`: size bounds (balance or rules), `counts` keyed by sorted condition set (same set ⇒ intersect; `matches` = all conds), `sums`, `aparts`, `together` blocks. Label values compare as exact text; empty never matches.
- `fastPath` (rejection sampling) → `backtrack` (randomized, with `prune`/`canPlace`/`countOk`/`sumOk`/`apartOk`) → repair/`bestEffortModel` (hill climbing); `solveModel` chains them; `run` = strict/best-effort entry used by the UI; `validateHints` = live hints; `blame` = drop-one-rule culprit search; `evaluate` recomputes violations for any assignment (used by partial-redraw merge).
- All shuffles use `shuffle()` → `randomIndex` (never `Math.random`).

### 11.4 Changelog since `9b7b0e3` (feature → where)

| Commit | Feature | Touches |
|---|---|---|
| 9b7b0e3 | Label attributes allowed in count rules | `ruleAttrs`, `labelValues`, solver `usable`/counts |
| 57dc60d | Copy-as-text = comma-separated names per group | `resultText` |
| add9b39 | Partial redraw (🔒 Keep) + multi-group rule scope | `partial*`, `keepBox`, `scopePicker`; solver `scopeHas`/`scoped` |
| eb2408c | Configurable group name word (`groups.label`) | `groupWord`, `#gd-group-word`; solver `groupName` |
| 864c814 | Global light/dark toggle | `theme.js`, CSS tokens |
| dfe3361, 553cd2b, 2439b77 | Compound count rules, block highlight, clash-proof form | `andRows` family, `ruleConds`; solver `conditionsOf`; CSS `.gd-and*`/`.gd-cond*` |
| 60b446d | Themed `<select>` (dark-mode white-on-white fix) | CSS `.gd-view select` |
| 8eb9283 | People "Clear all" | `#gd-people-clear` |

### 11.5 Test lookup (`tests/test_app.py`)

Tabs `test_gd_tabs_*` · attributes/people/paste `test_gd_attributes_*`, `*_people_*`, `*_paste_*` · rules/scope `test_gd_rules_*`, `*_scope_*`, `*_multi_group_*` · label rules `test_gd_label_count_rule_*` · compound `test_gd_compound_*` · partial `test_gd_partial_*` · group word `test_gd_group_word_*` · draw/fairness `test_gd_strict_*`, `*_uniformity_*`, `*_performance_*` · IO `*_export_*`, `*_import_*`, `*_autosaved_*`, `*_csv_*` · theme `test_theme_*` · clear all `test_gd_people_clear_all`.
