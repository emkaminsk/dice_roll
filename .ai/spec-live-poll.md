# Spec — Live Poll (one-question poll shared by code / QR)

Status: draft · Owner: Marcin · Related: `CLAUDE.md`, `.ai/tech-stack.md`

## 0. Verdict (read this first)

**Do not build this inside the Dice Roll repo/stack. Build it as a separate small project
and (optionally) link to it from the Dice Roll page.**

Why, in one sentence: a poll is *multi-device shared state* — votes from many phones must
land in one place that the host can read — and this repo's identity is the exact opposite:
static files, no back-end, anonymous, stateless, page reload resets everything.

| Dice Roll hard constraint (`CLAUDE.md`) | What Live Poll needs | Conflict |
|---|---|---|
| No back-end, static files rsync'd to nginx | A server (or third-party service) that receives and stores votes | **Hard** |
| Stateless, reload resets everything | A poll must outlive the host's tab and be addressable by code | **Hard** |
| "Every tool is independent" | Poll is a different product: host/voter roles, sessions | Soft |
| Deploy = rsync `appFE/` with `--delete` | Needs a running process, DB, restart, ports | **Hard** |
| Fair-RNG rule, `randomIndex()` | Not relevant (no random outcomes) | None |

Breaking the first three would silently rewrite the project's contract (`tech-stack.md`
was written precisely to *remove* the old Python back-end and its CORS/Docker plumbing).
It would also put user-submitted free text (XSS, abuse, moderation) on a site that today
has zero attack surface.

What *is* reusable from this repo: the visual language (Bootstrap 4 + `style.css` tokens,
dark mode, 375 px polish, `celebration.js` reveal idea), the Playwright e2e pattern, the
VPS + GitHub Actions deploy approach, and the "no framework, vanilla JS" frontend
philosophy. Copy those; don't couple the codebases.

### Options considered

| # | Option | Static-only? | Verdict |
|---|---|---|---|
| A | **Separate project: tiny back-end + vanilla-JS frontend, same VPS, subdomain** (e.g. `poll.byst.re`) | No (by design) | **Recommended** |
| B | Add a back-end into this repo | No | Rejected — violates contract, mixes deploy models |
| C | Serverless P2P (WebRTC, e.g. PeerJS) — host's browser *is* the server | Yes + public signaling server | Rejected — host must keep tab open; corporate Wi-Fi/Teams networks often block WebRTC; phones sleep/drop; fragile for the main use case |
| D | BaaS (Firebase / Supabase Realtime) from static frontend | Yes + third-party | Viable fallback if you don't want to run a server; adds vendor, API keys/rules, data leaves your VPS, free-tier limits |
| E | Use Mentimeter / MS Forms / Teams Polls | n/a | Worth stating: Teams already has Polls (Forms). Build only if you want your own look, no accounts, free-text + word cloud, self-hosted |

### Recommended stack for option A

- **Back-end:** Python 3 + **FastAPI** + **SQLite** (WAL mode), run with `uvicorn` behind the
  existing nginx (reverse proxy `location /api/`). Managed with **uv** (per your global
  preference). Single process, no Docker required; one systemd unit.
  *Alternative:* Node + Fastify/better-sqlite3 — equivalent; Python chosen because uv/Python
  is already your tooling.
- **Live updates:** Server-Sent Events (SSE) for the host's live vote counter; polling every
  2–3 s is an acceptable v1 fallback. No WebSocket needed (traffic is one-directional).
- **Front-end:** static HTML + Bootstrap 4 + vanilla JS, no build step (same as Dice Roll).
  One page, three modes decided by URL: `/` (host: create), `/h/<hostToken>` (host: manage),
  `/p/<code>` (voter).
- **QR code:** vendored client-side library (e.g. `qrcode-generator`, MIT, ~20 KB) — no
  external calls, drawn to `<canvas>`/SVG.
- **Word cloud:** small custom canvas renderer (spiral placement, font size ∝ count) or
  vendored `wordcloud2.js`. Normalise server-side (lower-case, trim, strip punctuation,
  stop-words optional).
- **Tests:** Playwright e2e with two browser contexts (host + voter) + pytest for the API.
- **Deploy:** separate repo, own GitHub Action (ssh → `git pull` → `uv sync` →
  `systemctl restart`). nginx server block for the subdomain.

Effort estimate (solo + AI): ~1–1.5 weeks for the MVP below, including polish and tests.

## 1. Summary

A host creates a **single-question poll** in one tab, shares a short **code + link + QR**
through any channel (e.g. pastes it into Teams), and participants open the link on their
phones and answer. When the host **closes voting**, results are shown as statistics
(bar chart / percentages) for choice polls, or as a **word cloud** (plus list) for free-text.

Non-goals (v1): multiple questions per session, accounts/login, editing votes after
submit, images, presenter slideshow mode, CSV export, i18n, analytics.

## 2. Roles & flow

### 2.1 Host

1. Opens the site → **Create poll** form:
   - Question (required, ≤ 200 chars).
   - Answer type: **Choice** or **Free text**.
     - Choice: 2–10 options (≤ 80 chars each, unique, case-insensitive); toggle *single* /
       *multiple* answers (v1: single only; multiple = v1.1).
     - Free text: max length per answer (default 40 chars — word-cloud friendly),
       max answers per participant (default 1; v1.1 up to 3).
   - Optional: show live results to voters after they vote (default **off**, to avoid bias).
2. Clicks **Start** → server returns `code` (short, human-friendly, e.g. 6 chars from an
   unambiguous alphabet `ABCDEFGHJKMNPQRTUVWXYZ2346789`), a `voterUrl` (`/p/<code>`), and a
   secret `hostToken`.
3. **Share screen** shows: large code, full URL with **Copy link** and **Copy code**
   buttons, **QR code** (also "Download PNG"), and a live participant counter
   ("14 votes"). Large-type "projector" mode is a nice-to-have.
4. Host URL (`/h/<hostToken>`) is stored in `localStorage` so a refresh/closed tab can
   resume — convenience only; the URL itself is the bearer secret, shown with a
   "bookmark this" hint.
5. Host clicks **Close voting** (confirm) → results view. Host may also **Reopen**
   (v1.1) or **Delete poll** (immediate hard delete).
6. Results:
   - Choice → horizontal bars with count + %, sorted by option order (toggle: sort by
     votes), winner highlighted with a short reveal animation (reuse celebration idea;
     reduced-motion aware).
   - Free text → word cloud (default) with toggle to ranked list (word, count);
     raw-answers list collapsible. Host can **hide** individual answers (moderation) before
     showing the cloud (v1.1; in v1 the host can delete the whole poll).

### 2.2 Voter

1. Opens `/p/<code>` (QR scan or typed URL) — or opens the site root and types the code
   in an "Enter code" field.
2. Sees the question and either radio options or a text input; one **Send** button.
3. After sending: friendly "Thanks — your answer is in" screen (animated check). If the
   poll is closed: "Voting is closed". Unknown/expired code: clear error.
4. Voting twice: prevented best-effort (see §5.3) — it is a casual poll, not an election;
   this must be stated honestly in the UI/docs.

No login, no name, no personal data requested.

## 3. Functional requirements

| ID | Requirement |
|---|---|
| LP-01 | Host can create a poll with question + (choice options \| free-text config); validated client- and server-side. |
| LP-02 | Creation returns code, voter URL, host token; code is unique among live polls. |
| LP-03 | Share screen shows code, URL, QR; copy buttons work (Clipboard API with fallback). |
| LP-04 | Voter page loads by code, renders question and the correct input type, at 375 px first. |
| LP-05 | Submitting a vote is accepted only while the poll is open; server enforces it. |
| LP-06 | Host sees live vote count while open (SSE or ≤3 s polling) — **counts only**, not breakdown, unless host opts into live results. |
| LP-07 | Host can close voting; after close, votes are rejected (HTTP 409) and voters see "closed". |
| LP-08 | Results view: choice → bar chart + %; free-text → word cloud + ranked list. |
| LP-09 | Host can delete the poll; all data is removed. |
| LP-10 | Polls auto-expire and are purged (default: 24 h after creation; configurable). |
| LP-11 | Free-text answers are normalised for the cloud (trim, collapse spaces, case-fold for counting, original casing of most frequent variant for display). |
| LP-12 | All user text rendered via `textContent` (never `innerHTML`). |
| LP-13 | Dark mode, reduced-motion, keyboard operable, labelled inputs, `aria-live` for status changes. |
| LP-14 | Optional link from Dice Roll header/footer to the Poll site (plain `<a>`, no coupling). |

## 4. API sketch (JSON over HTTPS)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/polls` | none (rate-limited) | Create. Body: `{question, type, options[], maxLen}` → `{code, hostToken, voterUrl}` |
| `GET /api/polls/{code}` | none | Voter view: `{question, type, options[], status}` (no counts) |
| `POST /api/polls/{code}/votes` | none (rate-limited) | Body: `{choice: index}` or `{text}`; 201 / 409 closed / 409 already voted / 422 invalid |
| `GET /api/host/{hostToken}` | host token | Poll + vote count + status |
| `GET /api/host/{hostToken}/events` | host token | SSE stream of count/status |
| `POST /api/host/{hostToken}/close` | host token | Close voting |
| `GET /api/host/{hostToken}/results` | host token | Aggregated results (counts per option / per normalised word + raw answers) |
| `DELETE /api/host/{hostToken}` | host token | Delete poll |

Data model (SQLite): `poll(id, code UNIQUE, host_token_hash, question, type, options_json,
max_len, status, created_at, expires_at)`, `vote(id, poll_id FK, choice_idx NULL, text NULL,
voter_hash, created_at)`. Host token stored only as a hash.

## 5. Non-functional requirements

### 5.1 Fairness note
No random outcome is produced; `random.js` rules don't apply. Code and host token
generation **must** use a CSPRNG (`secrets` module): code ≥ ~30 bits of entropy with
rate-limited lookups; host token ≥ 128 bits.

### 5.2 Security & abuse (the part that makes a back-end non-trivial)
- Stored XSS from free text → escape on render (LP-12), strict CSP (`default-src 'self'`),
  length caps, strip control chars.
- Rate limiting per IP (nginx `limit_req` + app-level) on create and vote; max polls per
  IP/hour; max votes per poll (default 500) and max payload size.
- Profanity in public word clouds: host-only visibility of raw answers until close; host
  moderation (v1.1). Be explicit in docs that anything typed is visible to the host.
- No PII collected; IPs only used transiently for rate limiting (not stored in votes).
  Still: GDPR-lite statement ("answers deleted after 24 h").
- HTTPS only; `hostToken` never in logs (use POST bodies/headers or ensure nginx does not
  log the host path, or accept token-in-URL and scrub logs).

### 5.3 One-vote-per-person (best effort)
Layers, from cheapest: (1) `localStorage` flag after voting hides the form; (2) signed
cookie set on first vote, checked server-side (`voter_hash`); (3) per-IP soft limit is
**not** used by default because an office shares one NAT IP. Document that a determined
user can vote twice (private window). Strictly-once voting would require identity, which
contradicts the "anonymous, no login" principle.

### 5.4 Performance & capacity
Target: ≤ 200 concurrent voters, ≤ 500 votes/poll; a single uvicorn worker + SQLite WAL
handles this with large headroom. Voter page < 50 KB, no framework.

### 5.5 Quality
Playwright suite fails on console/page errors (same fixture idea as Dice Roll); API tested
with pytest + httpx. "Ship it polished": `ux-polisher`-style pass (reveal animation on
results, nice QR card, 375 px, dark mode) is part of done.

## 6. Open questions

1. Hosting: same VPS under a subdomain (recommended) — or prefer a BaaS (option D) to avoid
   running a server?
2. Is "multiple choice (select several)" needed in v1, or single-select only?
3. Retention: 24 h default OK? Should the host be able to keep results longer?
4. Should voters ever see results (live or after close)? Default in this spec: only the host.
5. Domain/name for the new site.
6. Teams-specific: would an iframe/Tab embed be wanted later? (Adds CSP/frame-ancestors work.)

## 7. Suggested milestones

1. **M1 – skeleton:** repo, FastAPI + SQLite, create/get/vote/close/results endpoints + pytest.
2. **M2 – host UI:** create form, share screen (code, link, QR), live count, close.
3. **M3 – voter UI:** code entry, choice + text voting, closed/error states.
4. **M4 – results:** bars + word cloud + list, reveal animation.
5. **M5 – hardening & deploy:** rate limits, CSP, expiry job, nginx + systemd + Actions, e2e.
