# Spec — Group Draw (constrained assignment of people to groups)

Status: implemented (v1 + follow-ups + v2 feature set of §12, see §11) · Owner: Marcin · Related: `CLAUDE.md`, `ROADMAP.md`,
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

- **label** — free text. Usable in count, keep-apart, keep-together and spread-evenly rules (exact-text match, empty ignored; a count rule's value is picked from the values present in the data). Not usable in sum rules. Not required to be unique.
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

**Attendance.** Every row has a **Here** checkbox (first column, ticked by default). Unticking it
marks the person *away* (`absent: true`): they stay in the list — and in export/autosave — but are
left out of the draw, the live hints, the counts ("28 people · 2 away") and the category summary.
Rules that name an away person (pin / pair) are skipped for that draw. **Everyone's here** (visible
while someone is away) ticks everybody again. If everyone is away, Draw explains instead of drawing.

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

6. **Spread evenly** (`even`) — pick an attribute and every group gets its fair share of **each
   value**: the bounds are derived at draw time as floor/ceil of (people with that value ÷ groups),
   so they stay right when people are added, removed or marked away. For integer attributes the
   alternative **"the total (sum)"** balances the group totals instead (target band floor/ceil of
   total ÷ groups); that variant is an objective, so it is *always* nice-to-have.
7. **Pin** (`pin`) — one person always lands in one chosen group. One pin per person.
8. **Pair** (`pair`) — two people **together with** each other (same group, joins the keep-together
   blocks) or **apart from** each other (never the same group).

Person rules (7, 8) are removed with a notice when a person they name is deleted; pins also go when
their group is removed by lowering the group count.

**Priority: must / nice to have.** Count, sum, keep-apart, spread-evenly (by value), pin and
pair-apart rules carry a priority (`rule.soft`). *Must* (default) behaves as before. *Nice to have*
never blocks a draw: must rules are satisfied first, then nice-to-have rules are met as closely as
possible; what is left unmet is listed in a calm "Nice to have" note under the status line (not the
warning panel). Group-size, keep-together and pair-together rules are always must. The priority is
chosen in the add-rule form and toggled per rule in the list (dashed border = nice to have). The
global "Allow best effort" toggle is unchanged and still governs what happens when the *must* rules
cannot all be met.

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
- a person pinned to more than one group; a pair asked to be both together and apart; more people
  to keep mutually apart than there are groups.
Problems caused only by nice-to-have rules are shown as warnings, never errors.
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
- **Rounds** (number input, 1–10, next to Draw): draws several splits in one go. Every round is a
  full valid split; each later round is optimised so that as few pairs as possible share a group
  again. The result shows a round bar ("Round 1 · Round 2 · …") that switches the cards, plus a
  line saying how many pairs in the shown round had already met. A multi-round draw is one history
  entry; Copy/CSV contain every round (`Round n` headings / a leading `round` column). Disabled
  while Partial redraw is on.
- **Avoid repeat pairings** (checkbox): the same optimisation against every split in this
  session's history, for a single draw ("mix it up compared with last time").
- **Manual adjust**: while the shown result matches the current setup, tap a name and then another
  name to **swap** them, or tap **Move here** on another group to **move** them (keyboard: focus a
  name, Enter/Space; Escape cancels). The edited split is re-checked against every rule
  (`Solver.evaluate`): broken must rules appear in the warning panel ("After your changes: …"),
  unmet nice-to-have rules in the note. An edit of a single draw is a new history entry tagged
  *edited* (so the untouched draw is the undo); an edit of a round replaces that round in place.
- **Present** (button in the result actions): a full-screen presenter overlay for the shown round.
  All names start hidden; each click on **Reveal next** (or Space / Enter / →) reveals the next
  name — or the next whole group in "Group by group" mode — with a big spotlight line, per-group
  progress, **Reveal all**, optional browser full screen, a confetti finale, Escape to close and
  focus returned to the button. Purely presentational: nothing random happens there. Reduced motion
  → same flow without animation or confetti.
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

6. **Nice-to-have rules.** Two models are built from one setup: the *must* model (nice-to-have
   rules left out) and the *full* model (all rules). A draw first tries the full model briefly
   (300 ms: fast path + bounded search); success means every rule is met. Otherwise it solves the
   must model exactly as in steps 2–5 and then runs **polish**: random block moves/swaps accepted
   only if the tiers *(must-rule cost, nice-to-have cost, repeated pairings)* do not get
   lexicographically worse (≤ 400 ms, stops early when stale). A must rule is therefore never
   traded for a nice-to-have one.
7. **Repeat pairings.** A pair-count matrix is built from the splits to avoid (earlier rounds, or
   the session history) and is the last tier of the same polish. For `rounds = R` the pipeline runs
   R times, adding each round's pairs to the matrix.
8. **Derived rules.** Spread evenly (by value) expands to one count constraint per value present;
   spread evenly (by sum) to a nice-to-have sum band; a pin to a count constraint on one person
   (min 1 in the pinned group); pair-apart to a keep-apart set of those people; pair-together to a
   union in the keep-together blocks. So fast path, pruning, best effort, hints and blame cover
   them without special cases.
9. **Comparable costs.** Sum violations are divided by the average absolute value of that
   attribute ("one typical person"), so a sum that is a few points off no longer outweighs a
   head-count rule when rules must be traded off. Reported violation amounts stay in raw units.

### 5.3 Fairness statement (to show in a tooltip / README)

"Every draw uses cryptographically secure randomness. With no rules, or only rules a random shuffle can satisfy, every split is equally likely. When rules need searching (keep together, tight limits), splits are random but not uniform among all valid ones; the repair and best-effort fallbacks, nice-to-have rules, balancing a total and avoiding repeat pairings are random searches too, so not uniform either." — we are honest about this limitation. The polish step only runs when there is something to optimise (an unmet nice-to-have rule or pairings to avoid), so plain draws keep their exact uniformity. Manual adjustment and the presenter involve no randomness at all.
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
  people:     [{ id, name, absent?: true, values: { [attrId]: string|number|null } }],
  groups:     { count, names: string[], label?: string /* group name word */ },
  rules:      [{ id, type: 'size'|'count'|'sum'|'apart'|'together'|'even'|'pin'|'pair',
                 scope: 'all'|groupIndex|groupIndex[], attrId?, value?, and?: [{attrId, value}] /* count */, min?, max?, k?,
                 by?: 'value'|'sum' /* even */, personId?, group? /* pin */,
                 mode?: 'together'|'apart', people?: [personId, personId] /* pair */,
                 soft?: true /* nice to have */ }],
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

17. Attendance: away people are skipped by draw/hints/counts, survive export + autosave, and
    "Everyone's here" restores them; everyone away → guidance.
18. Spread evenly: per-value counts stay within floor/ceil of the share over many draws; the sum
    variant never blocks and narrows the gap between group totals versus plain draws.
19. Label keep apart / keep together hold over many draws; impossible label setups are hinted.
20. Pin / pair rules hold over many draws, combine with attribute rules and partial redraw,
    conflicts are hinted and blamed, and they are pruned with their people / groups.
21. Nice to have: an impossible must rule fails, the same rule as nice-to-have draws with notes and
    is met as closely as possible; a must rule is never sacrificed for it.
22. Rounds: every round is a full valid split; 16 people in 4×4 for 3 rounds has zero repeats;
    UI round bar, copy and CSV cover all rounds.
23. Manual adjust: swap, move (flags broken rules), keyboard pick/cancel, history as undo, switched
    off when the setup changed.
24. Presenter: step reveal by name and by group, reveal all, Escape, focus return, 375 px.

Docs to update when shipping: `README.md` (project structure), `ROADMAP.md`
(new entry, checked), `tests/test_app.py`, and skill `add-tool` notes if the tab
mechanism changes the recipe.

## 9. Out of scope for v1 (parking lot)

- Numeric weights per rule (only two priorities exist: must / nice to have), average-based rules.
- Multiple saved setups, shareable URLs with embedded data.
- Drag-and-drop (manual adjustment is tap-to-swap / move, which also works on phones).
- Pair rules with more than two people in the form (the data model and solver already accept a list).
- Persisting results or the pairing history across reloads (history is memory-only by design).
- Seeded / reproducible draws (would bypass the crypto-RNG-only rule).
- Per-attribute columns reorder, sorting/filtering in the table (nice later).

Shipped since v1 and no longer parked: pinning, pair rules, rule priorities, manual adjustment,
keep apart/together on labels (see §12).

## 10. Decisions

Confirmed by the product owner:

1. `name` is a fixed built-in field, not a custom attribute.
2. Label attributes are usable in every rule type except sum (keep apart/together on labels shipped in v2).
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

| v2 (§12) | Attendance, spread evenly, label apart/together, pin + pair, must / nice to have, rounds + avoid repeats, manual adjust, presenter | see §12 |

### 11.5 Test lookup (`tests/test_app.py`)

Tabs `test_gd_tabs_*` · attributes/people/paste `test_gd_attributes_*`, `*_people_*`, `*_paste_*` · rules/scope `test_gd_rules_*`, `*_scope_*`, `*_multi_group_*` · label rules `test_gd_label_count_rule_*` · compound `test_gd_compound_*` · partial `test_gd_partial_*` · group word `test_gd_group_word_*` · draw/fairness `test_gd_strict_*`, `*_uniformity_*`, `*_performance_*` · IO `*_export_*`, `*_import_*`, `*_autosaved_*`, `*_csv_*` · theme `test_theme_*` · clear all `test_gd_people_clear_all`. · v2: `test_gd_absent_*`, `*_everyone_absent_*`, `*_spread_evenly_*`, `*_label_keep_apart_and_together`, `*_person_rule*`, `*_nice_to_have_*`, `*_best_effort_weighs_*`, `*_rounds_*`, `*_manual_adjust_*`, `*_presenter_*`, `*_new_rules_survive_*`.

## 12. v2 feature set (branch `feature/group-draw-next`)

Eight features that came out of a critical review of v1. Behaviour is specified in the sections
referenced; this table says where each lives.

| # | Feature | Spec | UI (`group_draw.js`, IDs in `index.html`) | Solver (`group_draw_solver.js`) |
|---|---|---|---|---|
| 1 | Attendance ("Here" checkbox) | §4.2 | `activePeople`, `personRow` (`.gd-here`), `onCellEdit` (`present` field), `#gd-people-present` | `activePeople` filter in `normalizeRules` |
| 2 | Spread evenly (`even`, by value / by sum) | §4.3-6 | `#gd-rule-by`, `syncSoftField`, `ruleTarget` | derived count / sum rules in `normalizeRules` |
| 3 | Keep apart / together on labels | §4.1 | `ruleAttrs`, `cleanRule` | `usable` |
| 4 | Pin + pair rules | §4.3-7/8 | `#gd-rule-person`, `#gd-rule-person2`, `#gd-rule-group`, `#gd-rule-mode`, `renderPersonOptions`, `prunePersonRules`, pin remap in `partialPlan` | pins as count constraints (`con.pin`), pair-apart as `aparts` entries (`a.pair`), pair-together in the union-find |
| 5 | Manual adjust | §4.4 | `canAdjust`, `renderPick`, `onMemberPick`, `onMoveHere`, `applyAdjust`, `checked`, `#gd-adjust-hint`, `.gd-move-here` | `evaluate` (violations carry `soft`) |
| 6 | Rounds + avoid repeat pairings | §4.4, §5.2-7 | `#gd-rounds`, `#gd-fresh`, `roundsWanted`, `avoidList`, `renderRoundsNav`, series entries (`entry.series` / `entry.round`), `resultText` / `resultCsv` | `run(setup, { rounds, avoid })`, `buildMet`, `addMet`, `countRepeats`, `polish` |
| 7 | Presenter mode | §4.4 | `openPresenter`, `closePresenter`, `presenterUnits`, `confetti`, `#gd-present`, `.gd-present*` CSS | — |
| 8 | Must / nice to have | §4.3, §5.2-6/9 | `canBeSoft`, `withSoft`, `#gd-rule-soft`, `.gd-rule-soft` toggle, `renderNotes` (`#gd-notes`) | `isSoft`, `normalizeRules(setup, { hardOnly })`, `drawOnce`, `polish`, `hintsFor` + `validateHints` (soft problems → warnings), `con.unit` for sums |

Result shape of `Solver.run`: `{ status, groups, violations, notes, repeats, method }` — `violations`
are broken must rules, `notes` unmet nice-to-have rules — plus `rounds: [same shape…]` when more
than one round was asked for. Failures are unchanged (`infeasible` / `timeout` / `empty`).

Deliberate deviations from the review's proposal: the global "Allow best effort" toggle was kept
(it composes with per-rule priorities instead of being replaced by them), and the pair form takes
exactly two people.

