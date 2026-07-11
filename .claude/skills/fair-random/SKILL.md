---
name: fair-random
description: Rules for randomness and fairness in this project. Use when writing or reviewing any code that produces a random outcome (draws, rolls, spins, shuffles, card picks, daily horoscopes).
---

# Fair randomness rules

Fairness is this product's core promise (PRD SM-001/002/003). These rules are
non-negotiable.

## The rules

1. **Every user-facing outcome** goes through `randomIndex(n)` or
   `randomInt(min, max)` from `appFE/random.js`. They use
   `crypto.getRandomValues()` with rejection sampling — no modulo bias.
2. **Never `Math.random()` for outcomes.** It is acceptable only for cosmetic
   animation jitter (particle offsets, wobble) that cannot influence the result.
3. **Outcome first, animation second.** Choose the result with the fair RNG, then
   drive the animation to land on it (`wheel.js` is the reference implementation).
   Never read the outcome off an animation's stopping point, elapsed time, or frame
   count.
4. **Shuffles** use Fisher–Yates driven by `randomIndex` (e.g. team splitter,
   card decks). Never `array.sort(() => Math.random() - 0.5)`.
5. **Unique draws** (lottery numbers, dealing cards without replacement) come from
   shuffling the pool or rejection-drawing via `randomIndex` — no ad-hoc loops with
   bias.
6. **"Daily" deterministic results** (horoscope of the day) are the one exception to
   crypto RNG: seed a small deterministic PRNG (e.g. mulberry32) from
   `sign + YYYY-MM-DD` so everyone sees the same reading that day. Label such tools
   clearly as daily readings; never use this pattern where fairness matters.

## Verifying fairness

For a new outcome path, sanity-check the distribution in the browser console or a
quick Playwright eval, e.g. 10,000 draws over n options should give each option
roughly 1/n ± a few percent:

```js
const counts = {}; for (let i = 0; i < 10000; i++) { const k = randomIndex(5); counts[k] = (counts[k]||0)+1; } counts
```

Route audit requests to the `fairness-auditor` agent.
