# Product Requirements Document (PRD) - Dice Roll & Random Picker

## 1. Product Overview

Dice Roll is a lightweight, browser-based collection of random-selection tools. The
application requires no login, no installation beyond a web browser, and produces an
instant random result for everyday decision-making (game play, picking volunteers,
choosing between options, running quick raffles).

The product is delivered as two Docker images orchestrated with Docker Compose:

- A static front-end (vanilla JavaScript, HTML, Bootstrap 4) served on port 8000.
- A Python back-end (standard-library `http.server`) exposing a small JSON API on
  port 8081.

The current release provides two tools on a single page: a configurable Dice Roller
and a single "Randomly choose an option!" picker. This PRD documents that existing
functionality and defines two additions for the next release:

1. A Wheel of Fortune: the user types a list of names, spins an animated wheel, and
   the segment the wheel stops on is the winner.
2. Support for multiple, independent "Randomly choose an option!" sections that the
   user can add or remove, each running its own draw.

The application stays single-page, anonymous, and free. No data is persisted between
page reloads in this MVP.

## 2. User Problem

People frequently need a quick, fair, and visible way to make a random choice but
lack a convenient tool:

- Tabletop and party games need dice with an arbitrary number of sides, not just six.
- Groups need to pick one option, person, or item from a short list without arguing
  about fairness.
- Picking a winner from a list of names is more engaging and feels fairer when it is
  animated and visible, rather than a number appearing instantly.
- A single decision tool is limiting: a user often needs several independent draws on
  the same screen (for example, one list of people and one list of tasks) without the
  draws interfering with each other.

Physical dice and slips of paper are not always available, and ad-hoc software is
either overloaded with features, requires accounts, or hides the randomness so users
do not trust it. This product solves the problem with simple, transparent,
single-purpose tools on one page.

## 3. Functional Requirements

### 3.1 Dice Roller (existing)

- FR-001: The user can enter the number of sides of the dice via a numeric input,
  with a minimum value of 1 and a default value of 6.
- FR-002: When the user clicks Roll, 
  - the front-end calls the back-end endpoint `GET /dice-roll?max=N`, where N is the entered number of sides.
  - the front-end presents an animation of rolling dice
- FR-003: The back-end returns a JSON payload containing the maximum value, the rolled
  value(s), and the total.
- FR-004: The result is displayed as a dice graphic plus a text message stating the
  total rolled.
- FR-005: The roll uses a uniform random integer between 1 and N inclusive.

### 3.2 Randomly choose an option! (existing, extended)

- FR-006: Each picker section starts with two text input fields for options.
- FR-007: The user can add additional option fields with an "Add another field"
  button; there is no fixed upper limit.
- FR-008: When the user clicks Draw, the front-end submits the non-empty field values
  to the back-end endpoint `POST /draw` as a JSON object.
- FR-009: The back-end selects one of the submitted values uniformly at random and
  returns it; the front-end displays the chosen value.
- FR-010: If no values have been entered, the section shows a message indicating no
  drawing has occurred.
- FR-011: User can use "clear result" button, this keeps options entered but clears the previous result from the screen
- FR-011 (new): The user can create multiple independent "Randomly choose an option!"
  sections via an "Add section" control, and remove any section via a "Remove section"
  control.
- FR-012 (new): Each section maintains its own option fields, its own Draw action, and
  its own result display. Drawing in one section must not affect the inputs or results
  of any other section.
- FR-013 (new): Each section's Draw request is independent; the back-end remains
  stateless and treats each `POST /draw` call in isolation.

### 3.3 Wheel of Fortune (new)

- FR-014: The user can enter a list of names into the Wheel of Fortune section, with
  the ability to add and remove name entries.
- FR-015: The application renders an animated circular wheel divided into one visually
  distinct segment per entered name.
- FR-016: The wheel updates to reflect the current list of names whenever names are
  added or removed.
- FR-017: The user starts the wheel with a Spin control. The wheel accelerates, spins,
  and then gradually slows to a stop.
- FR-018: The segment the wheel stops on is the selected name; the winner is announced
  in a clearly visible result message.
- FR-019: The spin animation and the winner selection are computed entirely in the
  browser (client-side); no back-end call is made for the wheel.
- FR-020: The winning name remains on the wheel after the spin; the same list can be
  spun repeatedly and any name can win again. (No elimination in this MVP.)
- FR-021: Spinning requires at least two names; with fewer names the Spin control is
  disabled or shows a guidance message.
- FR-022: The selection is uniformly random across the segments, independent of the
  visual starting position of the wheel.

### 3.4 General

- FR-023: All tools coexist on a single page and operate independently of one another.
- FR-024: No user data is stored on the server, and nothing persists across page
  reloads; reloading the page resets all inputs and results.
- FR-025: The back-end sets permissive CORS headers and handles `OPTIONS` preflight
  requests for its `GET` and `POST` endpoints.
- FR-026: The application is packaged and runnable via Docker Compose, exposing the
  front-end on port 8000 and the back-end on port 8081.

## 4. Product Boundaries

In scope for this release:

- A single-page web application with three independent tools: Dice Roller, Wheel of
  Fortune, and one-or-more "Randomly choose an option!" sections.
- Client-side wheel animation and selection.
- Dynamic add/remove of option-picker sections and of names/options within them.

Out of scope for this MVP:

- User accounts, authentication, and authorization. The application is fully anonymous
  and unrestricted; no login is required and no access control is implemented.
- Server-side or browser-side persistence of lists, names, or results. Nothing survives
  a page reload.
- Elimination/no-repeat modes for the wheel (winner removal).
- Server-side computation of the wheel result.
- Weighted probabilities, history/audit of past draws, or sharing of results.
- Multi-user/real-time shared sessions.
- Mobile native apps; the product is a responsive web page only.
- Internationalization beyond the existing English UI.

## 5. User Stories

### US-001 Roll a dice with a custom number of sides
Description: As a user, I want to roll a dice with a chosen number of sides so that I
can get a random number for my game or decision.
Acceptance Criteria:
- A numeric input accepts a number of sides with a minimum of 1 and a default of 6.
- Clicking Roll produces a random integer between 1 and the entered number inclusive.
- The result is shown both as a dice graphic and as a text total.

### US-002 Reject invalid dice input
Description: As a user, I want the dice input to prevent invalid values so that I
always get a meaningful roll.
Acceptance Criteria:
- The input cannot be set below 1.
- If the input is empty or invalid, the application either uses the default of 6 or
  prevents the roll without crashing.

### US-003 Enter options to choose from
Description: As a user, I want to type a set of options into a picker section so that
the application can choose one for me.
Acceptance Criteria:
- The section starts with two empty text fields.
- I can type any text into each field.

### US-004 Add more option fields
Description: As a user, I want to add more option fields so that I can choose from more
than two options.
Acceptance Criteria:
- Clicking "Add another field" appends a new labelled text field to that section.
- There is no fixed limit on the number of fields.

### US-005 Draw a random option
Description: As a user, I want to draw one option at random so that a fair choice is
made for me.
Acceptance Criteria:
- Clicking Draw selects one of the entered values uniformly at random.
- The chosen value is displayed clearly in that section.
- Empty fields are not returned as a result.

### US-006 Handle drawing with no options
Description: As a user, I want clear feedback when I draw without entering options so
that I understand why no result appeared.
Acceptance Criteria:
- Drawing with no entered values shows a message indicating no drawing has occurred.
- The application does not crash or show an error.

### US-007 Add an independent picker section
Description: As a user, I want to add additional "Randomly choose an option!" sections
so that I can run several independent draws on the same page.
Acceptance Criteria:
- An "Add section" control creates a new picker section with its own fields, Draw
  button, and result area.
- The new section starts empty and independent of existing sections.

### US-008 Remove a picker section
Description: As a user, I want to remove a picker section I no longer need so that the
page stays uncluttered.
Acceptance Criteria:
- Each added section has a "Remove section" control.
- Removing a section deletes its fields and results without affecting other sections.

### US-009 Run independent draws across sections
Description: As a user, I want each picker section to draw independently so that one
draw never changes another section's inputs or results.
Acceptance Criteria:
- Drawing in one section updates only that section's result.
- The inputs and results of all other sections remain unchanged.

### US-010 Enter names for the wheel
Description: As a user, I want to enter a list of names so that the wheel can pick one
of them.
Acceptance Criteria:
- I can add name entries to the Wheel of Fortune section.
- I can remove name entries.
- The wheel display updates to show one segment per current name.

### US-011 Spin the wheel
Description: As a user, I want to spin an animated wheel so that a winner is chosen in
a visible and engaging way.
Acceptance Criteria:
- Clicking Spin starts an animation in which the wheel accelerates, spins, and slows to
  a stop.
- The animation runs entirely in the browser with no server call.

### US-012 See the winning name
Description: As a user, I want the name the wheel stops on to be announced so that I
know who or what was picked.
Acceptance Criteria:
- When the wheel stops, the segment under the pointer is identified as the winner.
- The winning name is shown in a clearly visible result message.
- The result corresponds to a uniformly random selection across the segments.

### US-013 Spin repeatedly with the same list
Description: As a user, I want to spin again with the same names so that I can run
multiple draws.
Acceptance Criteria:
- The winning name remains on the wheel after a spin.
- Spinning again can select any name, including a previous winner.

### US-014 Prevent spinning an empty or single-name wheel
Description: As a user, I want clear handling when the wheel does not have enough
names so that I am not given a meaningless result.
Acceptance Criteria:
- With fewer than two names, the Spin control is disabled or shows a guidance message.
- No spin completes that selects from an empty or single-segment wheel.

### US-015 Use all tools on one page independently
Description: As a user, I want the dice, wheel, and pickers on one page so that I can
use whichever tool I need without switching screens.
Acceptance Criteria:
- All tools are visible on the same page.
- Using one tool does not alter the state or results of any other tool.

### US-016 Reset by reloading
Description: As a user, I want a page reload to clear all my inputs so that I can start
fresh.
Acceptance Criteria:
- After reload, dice input returns to its default, all picker sections and added fields
  are cleared, and the wheel name list is empty.
- No previous results remain displayed.

### US-017 Use the application without an account
Description: As a user, I want to use every feature without signing in so that the tool
is instantly usable.
Acceptance Criteria:
- No login, registration, or authentication step is required to access any tool.
- All functionality is available anonymously.

### US-018 Run the application via Docker
Description: As an operator, I want to run the application with Docker Compose so that
I can host it easily.
Acceptance Criteria:
- `docker-compose up -d` starts both the front-end (port 8000) and back-end (port 8081).
- The front-end is reachable at `http://localhost:8000/` and the tools function.

## 6. Success Metrics

- SM-001 Dice correctness: across a large sample of rolls for a given N, results are
  distributed approximately uniformly between 1 and N, with no value out of range.
- SM-002 Picker correctness: across a large sample of draws, each entered option is
  selected with approximately equal frequency, and empty fields are never returned.
- SM-003 Wheel fairness: across a large sample of spins, the winning segment is
  distributed approximately uniformly across the names.
- SM-004 Section independence: in automated checks, a draw or spin in one section/tool
  never changes the inputs or results of any other section/tool (0 cross-contamination
  incidents).
- SM-005 Wheel responsiveness: a spin animation starts within 200 ms of clicking Spin
  and completes its slow-down in a perceivable, smooth animation (target 3-6 seconds).
- SM-006 Usability: a first-time user can complete each of the three tasks (roll a
  dice, run a draw, spin the wheel) without instructions in under 30 seconds each.
- SM-007 Deployment reliability: a clean `docker-compose up -d` results in a fully
  functional page on the first attempt.
- SM-008 Stability: no unhandled errors in the browser console during normal use of any
  tool, including edge cases (empty inputs, single name, many sections).
