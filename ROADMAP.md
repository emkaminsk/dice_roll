# Roadmap — from three tools to an entertainment page

Goal: an engaging, feature-rich single page offering many ways of drawing lots and
playful fortune-telling. Everything stays static, client-side, and fair
(see `CLAUDE.md` for the hard constraints).

Order within a tier is the suggested build order. Check items off as they ship.

## Tier 1 — quick wins (small, reuse existing patterns)

- [ ] **Coin flip** — animated heads/tails flip (CSS 3D or canvas), streak counter for
  the current session. The simplest possible draw; great mobile entry point.
- [ ] **Magic 8-ball** — ask a question, shake the ball (animation), get one of the 20
  classic answers. First content-driven tool; establishes the pattern of a JS data file
  (`appFE/data/eightball.js`).
- [ ] **Multiple dice** — extend the dice roller: roll N dice at once (e.g. 3d6), show
  each die plus the total. Keep the existing single-die UX as the default.

## Tier 2 — drawing lots, richer interactions

- [ ] **Draw straws** — a bundle of straws, everyone taps to pull one, exactly one is
  short. Configurable number of straws; reveal animation.
- [ ] **Fortune cookie** — crack open an animated cookie to reveal a fortune (plus
  "lucky numbers"). Needs a fortunes dataset (~100+ entries, positive/playful).
- [ ] **Team splitter** — paste a list of names, split fairly into N random teams
  (uniform shuffle via Fisher–Yates on `randomIndex`).
- [ ] **Lottery numbers** — draw k unique numbers from 1..N (presets for common
  lotteries), with a ball-machine style reveal.

## Tier 3 — fortune telling (content-heavy, high engagement)

- [ ] **Horoscope** — pick your zodiac sign (or birth date), get today's playful
  horoscope. Deterministic per sign+date (seeded from the date) so everyone sees the
  same "daily" reading, composed from a client-side phrase dataset. Entertainment-only
  disclaimer.
- [ ] **Tarot card of the day** — draw 1 card (or a 3-card past/present/future spread)
  from the 22 major arcana with an upright/reversed flip and a short playful meaning.
  Card faces can be simple CSS/canvas art — no copyrighted deck images.
- [ ] **Wheel elimination mode** — optional "remove winner after spin" toggle for
  running raffles down to a final winner.

## Tier 4 — engagement & polish (cross-cutting)

- [ ] **Page navigation** — as tools multiply, add a sticky tool switcher / cards
  overview so the page stays scannable on mobile.
- [ ] **Sound effects** — optional (default off) dice clatter, wheel ticks, drumroll;
  a single mute toggle, WebAudio, no external assets.
- [ ] **Share a result** — copy a result as text/emoji ("🎲 rolled 17 on d20") via the
  clipboard API. No server, no URLs with state.
- [ ] **Dark mode** — `prefers-color-scheme` support in `style.css`.
- [ ] **PWA offline** — service worker + existing manifest so the page works offline.

## Non-goals (unchanged from the PRD)

Accounts, server-side anything, real gambling/money, tracking, multi-user live
sessions, native apps. Fortune-telling features are explicitly for entertainment.
