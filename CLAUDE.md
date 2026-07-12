# Dice Roll & Random Picker — an entertainment hub in the making

## Mission

Grow this page from three random tools into an **engaging, feature-rich entertainment
page**: many ways of drawing lots (dice, wheel, straws, coin flip), plus playful
fortune-telling (horoscope, fortune cookie, magic 8-ball, tarot card of the day).
The prioritized backlog lives in [`ROADMAP.md`](ROADMAP.md). Product requirements are
in [`.ai/prd.md`](.ai/prd.md) and the stack rationale in [`.ai/tech-stack.md`](.ai/tech-stack.md).

**Look and feel is a first-class goal — how the page looks and feels is as important
as what it does.** This is an entertainment page: a tool that works but looks plain is
only half done. Every feature must land polished — cohesive visuals, satisfying
animation, a real "reveal" moment, and a delightful experience on a phone — not just
functionally correct. Treat a `ux-polisher` pass as part of shipping a feature, not an
optional extra, and hold new tools to the visual craft of the best existing ones.

## Hard constraints — never break these

- **No build step, no framework, no back-end.** Static files in `appFE/` served as-is
  (nginx on a VPS). HTML5 + Bootstrap 4 + vanilla JS (ES2015+) + `<canvas>` where needed.
- **Fair randomness only.** Every user-facing random outcome must go through
  `randomIndex()` / `randomInt()` in `appFE/random.js` (crypto.getRandomValues with
  rejection sampling). `Math.random()` is allowed only for cosmetic animation jitter,
  never for outcomes. Details: skill `fair-random`.
- **Anonymous & stateless.** No login, no server persistence; a page reload resets
  everything. (Optional `localStorage` conveniences are OK if the tool fully works
  without them.)
- **Every tool is independent.** Using one tool must never affect another's inputs
  or results.
- **No console errors.** The Playwright fixture fails any test on console/page errors.

## Layout

```
appFE/            static site (index.html, style.css, one JS file per tool, random.js)
tests/test_app.py Playwright e2e suite (serves appFE/ itself on port 8123)
.ai/              PRD + tech-stack docs
.github/workflows deploy.yml (push to master → rsync to VPS), semgrep.yml
```

## Commands

```bash
# Serve locally
cd appFE && python3 -m http.server 8000

# Tests (first time: uv run --with playwright playwright install chromium)
uv run --with playwright --with pytest pytest tests/
```

## Conventions

- One JS file per tool (`dice_roll.js`, `wheel.js`, `value_selector.js`, …), loaded
  after `random.js` at the bottom of `index.html`.
- New tools are a `<section class="tool-card">` inside the page grid; reuse existing
  CSS classes (`tool-card`, `result-line`, `btn-row`, …) before adding new ones.
- Pick the winner with the fair RNG **first**, then animate toward it (see `wheel.js`) —
  never derive the outcome from where an animation happens to stop.
- Every new tool ships with Playwright tests following the patterns in
  `tests/test_app.py`, plus README (project structure) and ROADMAP updates.
- Fortune-telling content is for entertainment: keep it positive/playful, add a light
  "for entertainment only" note, never give medical/financial/legal advice.
- **Ship it polished.** A feature isn't done when it works — it's done when it looks and
  feels good too. Run a `ux-polisher` pass before considering a tool complete: cohesive
  with the rest of the page, animated reveal, great at 375px, reduced-motion aware.

## Skills & agents

Skills: `add-tool` (recipe for a new tool card), `verify-app` (serve + run e2e suite),
`fair-random` (RNG rules), `deploy` (how releases reach the VPS).

Agents: `feature-designer` (opus — spec a roadmap item), `game-builder` (opus —
implement a tool end-to-end), `ux-polisher`, `test-engineer`, `fairness-auditor`,
`fortune-content-writer` (sonnet). Typical flow for a new feature:
feature-designer → game-builder (+ fortune-content-writer for content-driven tools)
→ test-engineer → fairness-auditor → ux-polisher.
