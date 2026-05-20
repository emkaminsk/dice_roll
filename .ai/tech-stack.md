# Tech Stack - Dice Roll & Random Picker

## Recommended approach: browser-only static front-end

The application is anonymous, stateless, and persists nothing across reloads. Every
piece of logic it needs — uniform random selection for the dice and the picker, and
the animated wheel — runs entirely in the browser. No server-side computation is
required. The recommendation is therefore a **single static front-end with no
back-end**, deployed as static files behind the existing nginx VPS.

This is the "light" option: it fits the PRD exactly, ships faster, has minimal
maintenance cost, and removes the API/CORS/Docker plumbing that currently exists only
for historical reasons.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Markup | HTML5 | Single page, three tools. |
| Styling | Bootstrap 4 (existing) + small custom `style.css` | Already in place; tiny UI, no need to change. |
| Logic | Vanilla JavaScript (ES2015+) | No build step, no framework needed for this scope. |
| Randomness | `crypto.getRandomValues()` | Uniform, in-browser; improves fairness metrics SM-001/002/003. No server RNG needed. |
| Wheel rendering & animation | HTML `<canvas>` + `requestAnimationFrame` | Full control over the accelerate/spin/slow-down animation; easily meets SM-005 (start < 200 ms, smooth 3-6 s stop). Zero dependencies. |
| Build tooling | None | Files are served as-is. |

## Randomness logic (replaces the back-end)

- **Dice roll:** uniform integer in `[1, N]` computed in the browser, replacing
  `GET /dice-roll?max=N`.
- **Draw a random option:** uniform pick from the non-empty field values in the
  browser, replacing `POST /draw`.
- **Wheel:** uniform segment selection client-side (already specified, FR-019).

## Deployment

- **Unchanged:** static files served by **nginx on a VPS**.
- No application server, no Docker, no API ports, no CORS configuration.
- Deploy = copy the static front-end files to the nginx web root.

## What this removes from the current setup

- The Python `http.server` back-end (`appBE/`).
- `docker-compose.yaml`, the two Docker images, and `build.sh`.
- The JSON API endpoints, CORS headers, and `OPTIONS` preflight handling (FR-025).
- The dual-port (8000/8081) and front-end/back-end communication concerns — the
  source of recent connectivity/HTTPS-URL bugs.

## PRD requirements affected

The following become obsolete and should be revised when the migration happens:
FR-002, FR-003, FR-008, FR-009, FR-013 (server endpoints), FR-025 (CORS),
FR-026 and US-018 (Docker Compose deployment).

## Security

No server means no API to attack, no CORS to misconfigure, and no exposed application
ports. All data stays in the browser, matching the anonymous, no-persistence model.
nginx serves static assets only.
