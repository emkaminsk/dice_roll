# Spec — Assign Options (randomly hand out actions / events / options to people, in rounds)

Status: **implemented (v1, see §11)** · Owner: Marcin · Related: `CLAUDE.md`, `ROADMAP.md`,
[`spec-group-draw.md`](spec-group-draw.md) (sibling feature; this spec only restates what differs).

## 1. Summary

A new **view** ("Assign Options") on the Dice Roll page. Group Draw puts people *into
groups*; Assign Options gives every person *something to do or get*. The user supplies a
list of *people* and a list of *labels* (actions, events, options, tasks, prizes, topics…),
chooses how many **rounds** to draw and how many labels each person receives per round,
and presses **Draw**. The result can be shown on screen or **presented full screen**, all
at once or person by person.

Examples: assigning chores (dishes ×2, trash ×1, cooking ×1) for the next 4 weeks;
giving each of 12 participants 2 workshop topics in each of 3 rounds with no topic ever
repeated for the same person; handing out presentation slots; "who plays which role in
each scene".

## 2. Constraints (inherited — see `CLAUDE.md`, same as `spec-group-draw.md` §2)

- Static files only, vanilla JS, no build step, framework, back-end or library.
- **Fair randomness:** all random decisions through `randomIndex()` / `randomInt()`
  (`appFE/random.js`); `Math.random()` only for cosmetic animation. The full result is
  computed **first**; reveal animations only show it. The presenter's optional
  "shuffle order" also uses `randomIndex` (it is a user-visible outcome).
- **Anonymous & stateless:** nothing leaves the browser. Optional `localStorage`
  autosave (key `assignOptions.setup.v1`, try/catch, "Clear saved data" link); JSON
  export/import is the durable way to keep a setup.
- **Independent — hard rule (see §6.1):** Assign Options and Group Draw share **no state
  and none of each other's code**. A change to Group Draw (JS, CSS, HTML, tests) must never
  alter Assign Options, and vice versa. Generic helpers are shared through a neutral
  platform file that belongs to neither view (`page_utils.js`, §6.1). The *only* data
  bridge is a JSON file the user imports (§4.1).
- No console errors; reduced-motion aware; works at 375 px; dark mode; a11y
  (labels, keyboard, `aria-live`). A `ux-polisher` pass is part of done.

## 3. Navigation: the third tab

The top-level tab bar becomes **Quick tools · Group Draw · Assign Options** — the new
tab sits **third, directly next to Group Draw**. It is a `<button role="tab"
data-hash="assign-options" aria-controls="assign-options-view">` in the existing
`.view-tabs` bar, with the panel `<section id="assign-options-view" role="tabpanel" hidden>`.
Behaviour comes from the existing generic `view_tabs.js` (it already discovers tabs from
the markup — **no change to its code should be needed**; if one is, it must stay generic):
`#assign-options` hash opens it directly, arrow keys move between the three tabs, default
tab stays Quick tools, switching never resets any view's state. Existing tests keep
working.

## 3a. Look & feel: same as Group Draw

The view must feel like a sibling of Group Draw — same overall layout, same visual
language, both themes:

- **Layout:** same page skeleton — view heading + short intro line, a **stepper**
  (1 People · 2 Labels · 3 Draw), then one `tool-card`-style section per step, a result
  area below the draw controls with the same action row (Copy / CSV / Present / history),
  and the footer notes (privacy line, "Reset all", "Clear saved data", Export / Import).
  Same card widths, spacing, button styles, chips, status/notice/warning panels, editable
  tables with their own scroll container at 375 px.
- **Theme:** works in **light and dark** through the global toggle (`theme.js`,
  `data-theme` on `<html>`). All colours come from the existing CSS custom properties
  (tokens); no hard-coded colours except the per-label palette, which needs a light and
  a dark variant. Native controls (`<select>`, inputs, checkboxes) are themed explicitly
  so there is no white-on-white in dark mode (the bug fixed in Group Draw's `60b446d`
  must not be reintroduced).
- **Polish parity:** staggered result reveal, reduced-motion fallbacks, focus rings,
  `aria-live` announcements, phone-first at 375 px — the same bar as Group Draw (§2).
- **How, without coupling:** the look is *copied* into new `ao-*` classes in
  `assign_options.css` (§6.1) — it does **not** reuse `gd-*` classes, so restyling Group
  Draw never changes this view (the new view can adopt a redesign later, deliberately).

## 4. User flow

Three steps on one scrolling page, shown as a stepper like Group Draw
(**1 People · 2 Labels · 3 Draw**); steps can be repeated freely. Editing steps 1–2 marks
the shown result *outdated* (still readable; Draw refreshes), exactly as in Group Draw §4.5.
**Reset all** (confirm) clears the view.

### 4.1 Step 1 — People

A person = `name` (required, duplicates allowed with a warning; stable internal `id`) and
an **attendance** flag (`absent`). Entry methods:

1. **Table editor** — one row per person: *Here* checkbox (ticked by default), name,
   delete. Add row, **Clear all**, **Everyone's here**. Away people stay in the list and
   in export/autosave but are left out of the draw and the counts ("12 people · 2 away").
   Same behaviour as Group Draw §4.2.
2. **Paste a list** — textarea, one name per line (also accepts CSV/TSV; only the first
   column is used, an obvious header line `name` is skipped). Preview + confirm before
   importing; blank lines and exact duplicates in the paste are reported.
3. **Import Group Draw JSON** — the file chosen in Group Draw via *Export setup*
   (`{ version: 1, attributes, people, groups, rules, options }`). Only `people[].name`
   and `people[].absent` are read; attributes, rules, groups and per-person values are
   **ignored** (the summary says so: "42 people loaded, 3 away; attributes and rules were
   not used"). The user chooses **Replace** or **Add to existing** people. Own-format
   files (§7) are accepted in the same box and restore the whole setup. Anything else
   → a readable error, never a console error.

Limits: soft 500 people, hard 2000 (as Group Draw).

### 4.2 Step 2 — Labels

A label = the thing being handed out. Fields:

| Field | Notes |
|---|---|
| Name | required, unique (case-insensitive), e.g. `Dishes`, `Present the demo`, `Room A` |
| Slots per round | integer ≥ 1 or **unlimited** (∞); default 1. How many times this label is handed out **in every round** (`Dishes` ×2 → two different people get it each round). |
| Once per person | checkbox, default **off**. On = no person gets this label more than once in the *whole draw* (all rounds). Off = it may come back in a later round. |

In every case a person never gets the same label twice **within one round**.

Entry: inline table (add / rename / delete / reorder is not needed), plus **Paste a list**
(one label per line; optional trailing `x3` / `×3` sets the slots, e.g. `Dishes x2`).
Global shortcut above the table: **"All labels: once per person"** toggles the checkbox
for every label (per-label values remain editable afterwards). Optional **label word**
setting (like Group Draw's group word): "Task", "Role", "Topic" — replaces "label" in
headings, hints and exports; purely cosmetic. Limit: 100 labels.

An optional **colour** per label is assigned automatically (palette cycling, as
`TEAM_PALETTE`) and used in chips, grid and presenter.

### 4.3 Step 3 — Draw settings

| Setting | Range / default | Meaning |
|---|---|---|
| **Rounds** | 1–20, default 1 | Number of independent assignment rounds drawn in one go. |
| **Per person per round** | 1–`labels count`, default 1 | How many *different* labels each present person receives in each round. **Independent of label slots** (below). |
| **Prefer variety** | checkbox, default on | Among valid results, avoid giving a person a label they already had in an earlier round of this draw (soft, never blocks). Irrelevant for "once per person" labels (a hard rule). |
| **Allow unfilled slots** | checkbox, default on | If a round offers more slots than the people need (supply > demand), the extra slots stay empty and *which* ones is random. Off = such a setup is rejected, forcing an exact fit ("every slot must be used"). |

**Both sides are configured independently** — how many times each label is handed out
per round (*Slots per round*, §4.2) **and** how many labels each person receives per round
(*Per person per round*, above). The draw must reconcile them: every person gets exactly
the per-person count, no label exceeds its slots. Example: 6 people, per person = 2;
`Dishes` ×3, `Trash` ×2, `Cooking` ×2, `Shopping` ×5 → demand 12, supply 12 per round, an
exact fit; with `Shopping` ×1 the supply is 8 and the hint says so.

Demand per round = present people × per-person count. Supply per round = Σ slots (∞ counts
as "enough"). **Live hints** (necessary conditions, run on every edit, solver is the
source of truth — as Group Draw §4.3):

- supply < demand: "6 people × 2 = 12 picks per round, but the labels offer only 9 slots";
- per-person count > number of labels (a person needs distinct labels each round);
- once-per-person capacity: over the whole draw a person needs `per person × rounds`
  picks; labels usable by them are Σ(once labels, 1 each) + repeatable labels' rounds…
  concretely `Σ_once min(slots·R, P) + Σ_repeat min(slots, P)·R ≥ P·A·R`
  (P people, A per person, R rounds) — message names the shortfall;
- "Allow unfilled slots" off and supply ≠ demand;
- label with 0 present people to give it to is impossible only when people = 0 (guidance
  message instead of drawing).

No best-effort mode in v1: a setup is either feasible (draw) or not (error with the
failed necessary condition, or "couldn't find a valid assignment in time (it may not
exist)" on timeout). Message wording follows Group Draw §5.4.

### 4.4 Draw and output

- Primary button **Draw**; **Draw again** (same setup, fresh randomness) is unlimited.
  Spinner + Cancel for long draws (same inline-Worker approach as Group Draw).
- **Result view** (toggle):
  - **By person** (default) — one row/card per present person with a column per round;
    each cell shows that person's label chips (colour-coded). Sticky first column, table
    scrolls inside its own container at 375 px.
  - **By label** — one block per label; per round the list of people who got it
    (`Dishes · Round 1: Anna, Piotr`). Unfilled slots are shown as "— free —".
  - Header line: "12 people · 3 rounds · 2 labels each" and, with *Prefer variety*,
    "Repeats: 2 (a person got a label again in a later round)".
- **Reveal moment** (polish): rows deal in with a stagger; chips pop in; optional brief
  "slot-machine" reel on the Draw button press landing on the already-computed result.
  Reduced motion → instant render.
- **Keep a round** — 🔒 checkbox per round; **Draw again** then redraws only the unkept
  rounds, still honouring "once per person" against the kept rounds. Disabled when
  nothing is kept. Only offered while the shown result matches the current setup.
- **Copy as text** — one line per person: `Anna: R1 Dishes, Trash · R2 Cooking, Dishes`
  (single round omits the `R1`); **Download CSV** — `person,round 1,round 2,…` with
  labels joined by `; ` (formula-injection-safe like Group Draw's `csvCell`). History of
  the last 10 draws (memory only, click to re-display), as Group Draw.
- `aria-live="polite"` announces "Drew 3 rounds for 12 people" / the error.

### 4.5 Presenting the result (full screen)

A **Present** button in the result actions opens a full-screen overlay (same shell as the
Group Draw presenter: Escape closes, focus returns to the button, optional browser full
screen, confetti finale, Space / Enter / → advance, ← back). Purely presentational —
nothing random happens there except the optional order shuffle. Two modes, chosen in a
small start dialog (remembered for the session):

1. **All at once** — the whole result on one big screen: a grid of person cards (name +
   label chips per round), font auto-scaled to fit; if it does not fit, it pages
   automatically ("Page 2 / 3", ←/→). Sub-option **Reveal round by round**: round columns
   start hidden and **Reveal next** (Space / →) uncovers one round at a time; *Reveal all*
   uncovers the rest. Also a "By label" toggle.
2. **Person by person** — a spotlight on one person: big name, then **Reveal next**
   uncovers that person's labels one by one (a brief reel/flip animation per label), round
   by round, with a "Round 2 of 3" caption; when done, **Next person** moves on. Progress
   bar ("5 / 12"), **Back**, **Skip to end**, and **Reveal all for this person**.
   Order: list order by default; **Shuffle order** checkbox (uses `randomIndex`, fresh
   order each presentation) — the *assignments* never change, only who is announced when.

Reduced motion → same flow, no animation or confetti. Works on a phone in portrait
(single column) and landscape. Absent people are never shown.

## 5. Drawing algorithm

### 5.1 Principles

Same as Group Draw §5.1: all randomness via `randomIndex`/`randomInt` (Fisher–Yates with
`randomIndex`); the complete assignment is computed before any animation; no hidden state.

### 5.2 Model

Present people `p ∈ P`, labels `l ∈ L` with `slots(l)` (∞ = `|P|`), rounds `R`, per-person
count `A`. A solution is, for each round `r`, a set of (person, label) pairs such that:

1. every person has exactly `A` distinct labels in round `r`;
2. each label appears at most `slots(l)` times in round `r`;
3. a *once-per-person* label appears at most once per person across all rounds;
4. with *Allow unfilled slots* off, each label appears exactly `slots(l)` times per round.

### 5.3 Method

Per round this is a **b-matching** (bipartite flow: people demand `A`, labels supply
`slots`, each person–label edge capacity 1). Randomisation that keeps it fair-ish:

1. **Fast path** — shuffle people, shuffle label *slot tokens* (a label with 2 slots is 2
   tokens; ∞ is `|P|` tokens), deal tokens to people in rotation, skipping tokens the
   person already holds this round or may not take (once-label already had). Accept if
   everyone reached `A`; retry up to 200 times. With no once-labels and a plain fit this
   is a uniform random assignment.
2. **Constructive path** — randomized augmenting-path matching (Ford–Fulkerson/Dinic with
   random edge order) fills what the fast path could not; the round is accepted only if a
   **look-ahead feasibility check** on the remaining rounds passes (remaining once-label
   capacity vs remaining demand, the aggregate condition of §4.3). A dead end restarts
   the whole draw (random restart); budget 50 000 nodes / ~1.5 s, in an inline Worker,
   Cancel supported. Exhausted without a solution → "may not exist" failure; the
   necessary-condition check names the shortfall when it can.
3. **Prefer variety** — after a round is valid, a short **polish** (≤ 300 ms per draw,
   stops when stale): random swaps of a label between two people in the same round,
   accepted only if validity is kept and the number of *repeats* (person gets a label
   they had in an earlier round) does not grow. Repeats are minimised, not forbidden.
4. **Keep a round** — kept rounds are fixed inputs (their pairs count towards the
   once-per-person history); the others are drawn as above.

### 5.4 Fairness statement (tooltip / README)

"Every draw uses cryptographically secure randomness. With plain settings (no once-per-person
labels, variety off) every valid assignment is equally likely within the dealing scheme.
When 'once per person' or 'prefer variety' forces a search or repair, assignments are
random but not exactly uniform among all valid ones." `fairness-auditor` checks that no
`Math.random()` decides an outcome and that token/slot/person ordering uses the fair RNG.

## 6. Code structure

### 6.1 Isolation rule (hard) and shared helpers

Assign Options owns its view code and **depends on no Group Draw file**:

- No Group Draw file is edited to build this feature, and no Assign Options file imports,
  reads, or calls anything from `group_draw*.js`, `data/group_draw_example.js`, `gd-*`
  CSS classes, `#gd-*` IDs, or `GroupDrawSolver` — and Group Draw likewise never touches
  `ao-*` / `AssignOptions*`.
- The view lives in its own IIFE and its own globals (`window.AssignOptionsSolver` only);
  all IDs are `ao-*`, all CSS classes `ao-*`, all storage keys `assignOptions.*`.
- The only data bridge is the user importing a Group Draw JSON **file** (§4.1).

**Shared, not duplicated.** Helpers both views could use are provided once by a neutral
platform layer that belongs to neither view:

- **New `appFE/page_utils.js` → `window.PageUtils`** (loaded after `random.js`, before any
  view script). It holds only generic, view-agnostic helpers, written fresh for this
  feature: `csvCell(value)` (formula-injection-safe), `download(name, text, mime)`,
  `copyText(text)`, `notice(target, message, kind)`, `confetti(root)` (canvas burst,
  reduced-motion aware; cosmetic `Math.random` only), and `createWorkerRunner(factory)`
  (inline Blob-Worker bootstrap with main-thread fallback). No view-specific names, IDs or
  classes inside; its styles (confetti canvas, notice base look) go in `page_utils.css`
  or the existing generic token section — never in a `gd-` / `ao-` block.
- Already-generic platform files used as-is, read-only: `random.js`, `theme.js`,
  `view_tabs.js`, `celebration.js`, `style.css` tokens and the generic `tool-card` /
  `btn-row` classes.
- **Group Draw is not required to change.** It keeps its current private copies of these
  helpers. Moving Group Draw onto `PageUtils` is an optional, separate follow-up (own
  commit, own review) — it is *not* part of this feature, so shipping Assign Options cannot
  regress Group Draw.
- **Change rule for the shared layer:** `PageUtils` and the other platform files are
  additive and backward compatible — existing function signatures and behaviour never
  change; a new need means a new function. Any edit to them must pass **both** test files
  (§8) before merging. This is what keeps "change Group Draw ⇒ no effect on Assign
  Options" true even though a helper layer is shared.
- Shared-layer helpers have their own small unit tests inside `tests/test_assign_options.py`
  (`test_ao_utils_*`: `csvCell` escaping and formula guard, `download` produces the file,
  `createWorkerRunner` falls back when Workers are unavailable).

### 6.2 Files

New files in `appFE/` (loaded after `random.js` and after `view_tabs.js`):

- `page_utils.js` — **new shared helper layer** (`window.PageUtils`, §6.1); owned by
  neither view, additive-only.
- `assign_options.js` — UI: stepper, people/labels editors, settings, hints, result
  rendering, history, copy/CSV, import/export, presenter; uses `PageUtils` for the
  generic helpers.
- `assign_options_solver.js` — pure, DOM-free: `validateHints(setup)`,
  `run(setup, { keep, ... })` → `window.AssignOptionsSolver` (testable via
  `page.evaluate`; loadable into an inline Worker via `createSolver(randomIndex).toString()`).
- `assign_options.css` — the whole look of the view (`ao-*`), linked from `index.html`
  next to `style.css`; keeps Group Draw's section of `style.css` untouched.
- `index.html` — the only existing file edited, additively: one tab button, one
  `<section id="assign-options-view">`, one `<link>`, three `<script>` tags
  (`page_utils.js`, solver, view). Existing markup is not modified.

State shape:

```js
{
  people: [{ id, name, absent?: true }],
  labels: [{ id, name, slots: number | null /* null = unlimited */, once: boolean }],
  settings: { rounds: 1, perPerson: 1, variety: true, allowUnfilled: true, word?: string },
  results: [ /* history, memory only */ ]
}
```

Result: `{ status, rounds: [{ assignments: { [personId]: labelId[] }, free: { [labelId]: n } }],
repeats, method }`; failures `infeasible` / `timeout` / `empty`, as Group Draw.

## 7. Persistence, export & import

- **Export JSON** — `{ kind: "assign-options", version: 1, people, labels, settings }`
  (no results). The `kind` field lets import tell it apart from a Group Draw export
  (which has `attributes`/`groups`, no `kind`). Import validates schema/version, shows a
  summary ("12 people, 6 labels, 3 rounds"), replaces the setup after confirmation.
- **Group Draw file import** — people only, see §4.1(3). Never modifies the Group Draw view.
- Optional `localStorage` autosave with the same privacy note as Group Draw
  ("Stays in this browser. Nothing is uploaded.").

## 8. Acceptance criteria / tests

**A separate test set:** all tests live in a new file **`tests/test_assign_options.py`**
(`test_ao_*`); `tests/test_app.py` is **not modified**. The new file carries its own
`server` / `page` fixtures (same pattern as `test_app.py`: serve `appFE/`, fail on any
console/page error) on its own port (**8124**, vs 8123), so the two files never share a
server or state, can run in parallel, and each can be run alone:

```bash
uv run --with playwright --with pytest pytest tests/test_assign_options.py   # this feature only
uv run --with playwright --with pytest pytest tests/test_app.py              # everything else
uv run --with playwright --with pytest pytest tests/                         # both (verify-app)
```

Solver tests via `page.evaluate(() => AssignOptionsSolver.run(...))`. Test data for the
Group Draw import is a literal JSON fixture inside the new test file (not read from
Group Draw code or tests).

1. Tabs: three tabs in the order Quick tools · Group Draw · Assign Options;
   `#assign-options` opens the view directly; arrow keys cycle all three; default is
   still Quick tools.
2. People: add/edit/delete, Here toggle, Everyone's here, Clear all; paste list with
   header and duplicates reported; away people skipped by draw and counts.
3. Group Draw import: a real Group Draw export loads names and `absent` flags, ignores
   attributes/rules, shows the summary; Replace vs Add; own-format round-trip
   (export → reset → import identical); invalid JSON and wrong shape → readable error.
4. Labels: add/rename/delete, duplicate name rejected, slots (number / ∞), once toggle,
   "All labels: once per person", paste with `x3` suffix.
5. Draw validity (50 draws): every present person has exactly `A` distinct labels per
   round; no label exceeds its slots; once-labels never repeat per person across rounds
   — verified independently by reading the DOM result.
6. Unfilled slots: supply > demand with the option on draws; off → hint + refusal.
7. Infeasible setups: supply < demand and once-capacity shortfall show the hint before
   Draw and an error panel after; no result cards.
8. Prefer variety: 6 people, 3 labels, 3 rounds, 1 each → zero repeats; with it off,
   repeats may occur (statistical) but validity always holds.
9. Fairness smoke (solver): 3 people, 3 single-slot labels, 1 round, 10 000 draws → each
   person gets each label within ±5 % of 1/3.
10. Draw again produces ≥ 2 distinct results in 20 draws for a non-trivial setup.
11. Keep a round: the kept round is unchanged after Draw again; once-per-person still
    holds against it.
12. Output: Copy-as-text and CSV contain every person and round exactly once; By person /
    By label views agree.
13. Presenter, all at once: opens, shows every present person, paging for large sets,
    round-by-round reveal, Escape closes, focus returns.
14. Presenter, person by person: reveal order, Back, Skip, progress, Shuffle order changes
    only the announcing order (assignments identical), absent people never shown.
15. Performance: 200 people, 20 labels (slots 10), 5 rounds, 2 each solves in < 2 s.
16. 375 px: no horizontal page scroll; result table scrolls in its container; presenter
    usable in portrait.
17. `prefers-reduced-motion`: instant render, no confetti, no console errors.
18. Independence: using Assign Options changes nothing in Group Draw or any quick tool,
    and importing a Group Draw file leaves Group Draw's own state untouched. Code
    isolation check: the page works with `group_draw*.js` blocked from loading (route
    abort) and Group Draw works with `assign_options*.js` blocked — no console errors
    either way. `PageUtils` helpers behave as specified (`test_ao_utils_*`, §6.1).
19. Theme: the view renders in light and dark (toggle), including themed `<select>`s and
    result chips — computed colours of text vs background differ in both themes.
20. Both knobs together: labels with different slots and per-person = 2 produce rounds
    where each person has exactly 2 distinct labels and each label's count equals its
    slots (exact fit) or stays below it (unfilled allowed).

Docs to update when shipping: `README.md` (project structure), `ROADMAP.md` (new entry),
`.ai/prd.md` if the page scope list changes, `CLAUDE.md` / skill `verify-app` (mention
the second test file); add §11-style
implementation map to this file once built.

## 9. Out of scope for v1 (parking lot)

- Person rules: "never gets label X" / "always gets label X" / pair "not the same label
  in the same round" (data model leaves room: `people[].forbid`, `people[].pin`).
- Label weights ("popular" labels count double), minimum picks per label (every label
  used at least once per draw), per-round overrides of slots.
- Best-effort mode for infeasible setups (v1 reports and stops).
- Manual adjust (tap two cells to swap labels) and undo history beyond the last 10.
- Per-person count that differs by person (e.g. experts get 2, others 1).
- Importing labels from files; shareable URLs; seeded/reproducible draws (would bypass
  the crypto-RNG-only rule).

## 10. Decisions & open questions

Adopted as defaults (change if wrong):

1. "Repeats per round" is read as **slots per round** — how many people get that label in
   each round. A person never gets the same label twice within a round.
2. "Only once per person" is **per label**, over the **whole draw** (all rounds), with a
   one-click "all labels" toggle.
3. Group Draw files are imported for **people only**; the sibling feature stays independent.
4. No best-effort mode in v1; unfilled slots are allowed by default.
5. Presenter reuses the Group Draw presenter's interaction model rather than inventing a
   new one.

Open — needs the product owner:

- **Q1.** Should "once per person" also be available as *once per person per round*
  (i.e. a person could get `Dishes` in round 1 and again in round 3)? Currently that is
  simply the default (off), so this is already covered — confirm no third policy
  (e.g. "at most twice") is wanted.
- **Q2.** Should a person be allowed to receive the **same label twice in one round**
  (for per-person count > 1 and an ∞ label)? Spec says no.
- **Q3.** Wanted: labels as free text only, or optional extra fields (description/emoji)
  for the presenter?
- **Q4.** Delivery flow as usual: feature-designer (this spec) → game-builder →
  test-engineer → fairness-auditor → ux-polisher?

Resolved for v1 with the recommended defaults: Q1 — no third policy ("once per person" on/off
only); Q2 — never the same label twice for one person in one round; Q3 — labels are free text only;
Q4 — the usual delivery flow.

## 11. Implementation map

| File | Role |
|---|---|
| `appFE/page_utils.js` | `window.PageUtils`: `csvCell`, `download`, `copyText` (→ `Promise<boolean>`), `notice`, `confetti` (canvas `.page-confetti`), `createWorkerRunner(factory, { method })` → `{ run, cancel, mode, busy }`, `reduceMotion`. |
| `appFE/assign_options_solver.js` | `createSolver(randomIndex)` → `{ validateHints, run }` = `window.AssignOptionsSolver`. `model` (index arrays; ∞ = cap at people count) · `hintsFor` (codes `distinct`, `supply`, `exact`, `exact-slots`, `exact-once`, `per-person`, `once`) · `fastRound` (token dealing, variety sweep first) · `flowRound` (randomised augmenting paths; exact fit = fixed-slot labels first, then ∞) · `lookAhead` · `polish` (swap / trade moves, ≤ 300 ms) · `run` (restarts until 1.5 s; `opts.keep` fixes rounds). |
| `appFE/assign_options.js` | UI IIFE; `els` map of `#ao-*` IDs. People: `renderPeople`, `parseNameList`, paste preview, `parseGroupDraw` + `showImportPanel`/`commitImport`. Labels: `renderLabels`/`labelRow`, `parseLabelList`, all-once, label word (`wordify`). Draw: `renderHints`, `draw`/`finish`/`renderFailure`, `makeEntry`, `display` → `byPerson`/`byLabel`, `renderKeep` (`#ao-keep-bar`), history, `resultText`/`resultCsv`. Presenter: `openPresenter` → `startScreen`/`allScreen` (paging, round reveal, by label)/`personScreen`. IO: `parseOwn`, `readImport`, autosave `assignOptions.setup.v1`. |
| `appFE/assign_options.css` | Whole look (`.ao-*`), own tokens `--ao-danger/warn/ok` and palette `--ao-c0…11` (light + dark). |
| `appFE/index.html` | Tab `#tab-assign-options`, panel `#assign-options-view`, `<link>`, scripts. |
| `appFE/style.css` | Only the generic "View tabs" block: ≤ 576 px the tabs share the width and wrap (three tabs overflowed 375 px). |
| `tests/test_assign_options.py` | `test_ao_*`, one or more per §8 item; own server on 8124. |

Notes: §8.15's "slots 10" makes 200 slots for 400 picks (infeasible), so the performance test uses
slots 20 (exact fit) and separately checks that the slots-10 setup is refused quickly. A "Load
example" (6 people, 4 chores, 4 rounds) was added for parity with Group Draw.
