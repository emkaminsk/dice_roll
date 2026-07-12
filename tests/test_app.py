"""End-to-end tests for the Dice Roll & Random Picker static front-end.

These tests serve appFE/ over a local HTTP server and drive a headless browser
with Playwright, verifying the three in-browser tools (dice, picker, wheel) and
asserting there are no console/page errors.

Run from the repository root:

    uv run --with playwright --with pytest pytest tests/
    # first time only: install the browser binary
    uv run --with playwright playwright install chromium

See README.md ("Tests") for full instructions.
"""

import http.server
import socketserver
import threading
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

FE_DIR = Path(__file__).resolve().parent.parent / "appFE"
PORT = 8123
BASE_URL = f"http://localhost:{PORT}/"


@pytest.fixture(scope="session")
def server():
    """Serve appFE/ as static files for the duration of the test session."""
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(
        *a, directory=str(FE_DIR), **kw
    )
    # Reuse the address so a rapid re-run doesn't hit a TIME_WAIT socket from the
    # previous run (Errno 98) — common in local/CI back-to-back runs.
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield BASE_URL
    httpd.shutdown()


@pytest.fixture
def page(server):
    """A fresh browser page that fails the test on any console/page error."""
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        pg = browser.new_page()
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(server)
        pg.wait_for_load_state("networkidle")
        yield pg
        browser.close()
    assert not errors, f"Console/page errors: {errors}"


import re


def _rolled_value(page):
    """Wait for the roll animation to finish and return the rolled number."""
    page.wait_for_function(
        "() => document.querySelector('#result').textContent.includes('rolled')",
        timeout=4000,
    )
    text = page.text_content("#result")
    return int(re.search(r"rolled\s+(\d+)", text).group(1))


def test_dice_roll_in_range(page):
    """Rolling a 20-sided die yields a result in [1, 20] (FR-005, US-001)."""
    page.fill("#max", "20")
    page.click("form[name='Dice'] button[type=submit]")
    assert 1 <= _rolled_value(page) <= 20


def test_dice_invalid_input_falls_back_to_default(page):
    """A blank/invalid side count falls back to the default of 6 (US-002)."""
    page.fill("#max", "0")
    page.click("form[name='Dice'] button[type=submit]")
    value = _rolled_value(page)
    assert page.input_value("#max") == "6"
    assert 1 <= value <= 6


def test_dice_multiple_dice_shows_breakdown_and_total(page):
    """Rolling 3d6 shows a per-die breakdown and a total in [3, 18] (Multiple dice)."""
    page.fill("#max", "6")
    page.fill("#dice-count", "3")
    page.click("form[name='Dice'] button[type=submit]")
    page.wait_for_function(
        "() => document.querySelector('#result').textContent.includes('=')",
        timeout=4000,
    )
    text = page.text_content("#result")
    # "You rolled a + b + c = total on three 6-sided dice."
    breakdown, total_part = text.split("=")
    dice = [int(n) for n in re.findall(r"\d+", breakdown)]
    assert len(dice) == 3
    assert all(1 <= d <= 6 for d in dice)
    total = int(page.text_content("#result .highlight"))
    assert total == sum(dice)
    assert 3 <= total <= 18
    assert "three 6-sided dice" in text


def test_dice_count_invalid_falls_back_to_one(page):
    """A blank/invalid dice count falls back to a single die with original phrasing."""
    page.fill("#max", "6")
    page.fill("#dice-count", "0")
    page.click("form[name='Dice'] button[type=submit]")
    value = _rolled_value(page)
    assert page.input_value("#dice-count") == "1"
    # Single-die phrasing is preserved: no total/breakdown, reads "on a 6-sided die".
    text = page.text_content("#result")
    assert "6-sided die." in text
    assert "=" not in text
    assert 1 <= value <= 6


def test_picker_draws_only_entered_options(page):
    """Draw returns one of the non-empty options (FR-009, US-005)."""
    fields = page.locator(".picker-section .option-field")
    fields.nth(0).fill("Pizza")
    fields.nth(1).fill("Sushi")
    page.locator(".picker-section .btn-primary").first.click()
    result = page.text_content(".picker-section .result-line")
    assert "Pizza" in result or "Sushi" in result


def test_picker_clear_result(page):
    """Clear result removes the picked text without touching the options."""
    fields = page.locator(".picker-section .option-field")
    fields.nth(0).fill("Pizza")
    fields.nth(1).fill("Sushi")
    page.get_by_role("button", name="Draw").first.click()
    assert page.text_content(".picker-section .result-line").strip() != ""
    page.get_by_role("button", name="Clear result").first.click()
    assert page.text_content(".picker-section .result-line").strip() == ""
    # Options remain intact.
    assert fields.nth(0).input_value() == "Pizza"


def test_picker_empty_shows_guidance(page):
    """Drawing with no options shows guidance, not a crash (FR-010, US-006)."""
    page.locator(".picker-section .btn-primary").first.click()
    assert "no options" in page.text_content(".picker-section .result-line").lower()


def test_add_and_remove_picker_section(page):
    """Sections can be added and removed independently (US-007/008)."""
    assert page.locator(".picker-section").count() == 1
    page.click("#add-section")
    assert page.locator(".picker-section").count() == 2
    page.locator(".picker-section .btn-remove").last.click()
    assert page.locator(".picker-section").count() == 1


def test_wheel_spin_announces_winner(page):
    """Spinning with >= 2 names announces one of them as winner (FR-018, US-012)."""
    # Two default names (Alice, Bob) are pre-populated.
    page.click("#wheel-spin")
    page.wait_for_function(
        "() => document.querySelector('#wheel-result').textContent.includes('Winner')",
        timeout=8000,
    )
    result = page.text_content("#wheel-result")
    assert "Alice" in result or "Bob" in result


def test_wheel_requires_two_names(page):
    """With fewer than two names the Spin control is disabled (FR-021, US-014)."""
    # Reduce the textarea to a single name.
    page.fill("#wheel-names", "Alice")
    assert page.is_disabled("#wheel-spin")


def test_wheel_spin_shows_celebration_overlay(page):
    """Landing on a winner shows the full-screen celebration with the name."""
    page.click("#wheel-spin")
    page.wait_for_function(
        "() => { const o = document.querySelector('.celebration-overlay');"
        " return o && o.classList.contains('is-visible')"
        " && document.querySelector('.celebration-name').textContent.trim() !== ''; }",
        timeout=8000,
    )
    name = page.text_content(".celebration-name").strip()
    assert name in ("Alice", "Bob")


def test_wheel_names_persist_across_reload(page):
    """The roster is saved to localStorage and restored after a reload."""
    page.fill("#wheel-names", "Zoe\nYann\nXavier")
    page.reload()
    page.wait_for_load_state("networkidle")
    assert page.input_value("#wheel-names") == "Zoe\nYann\nXavier"


def _flip_coin(page):
    """Click Flip, wait for the settled result, and return 'Heads' or 'Tails'."""
    page.click("#coin-flip")
    page.wait_for_function(
        "() => { const t = document.querySelector('#coin-result').textContent;"
        " return t.includes('Heads') || t.includes('Tails'); }",
        timeout=4000,
    )
    text = page.text_content("#coin-result")
    return "Heads" if "Heads" in text else "Tails"


def test_coin_flip_produces_heads_or_tails(page):
    """A flip settles on exactly one of Heads or Tails (fair randomIndex(2))."""
    assert _flip_coin(page) in ("Heads", "Tails")


def test_coin_streak_counts_runs(page):
    """The streak line reports a sensible run length and total across flips."""
    counts = {"Heads": 0, "Tails": 0}
    run = 0
    prev = None
    for _ in range(6):
        face = _flip_coin(page)
        counts[face] += 1
        run = run + 1 if face == prev else 1
        prev = face
        streak = page.text_content("#coin-streak")
        # The streak line names the current face and its run length.
        assert f"{run} {face}" in streak
    total = counts["Heads"] + counts["Tails"]
    assert f"{total} flips this session" in page.text_content("#coin-streak")


def test_coin_flip_does_not_disturb_other_tools(page):
    """Flipping the coin leaves dice, wheel, and picker independent (US independence)."""
    page.fill("#max", "20")
    page.fill("#wheel-names", "Alice\nBob")
    fields = page.locator(".picker-section .option-field")
    fields.nth(0).fill("Pizza")
    fields.nth(1).fill("Sushi")

    _flip_coin(page)

    # Other tools' inputs are untouched...
    assert page.input_value("#max") == "20"
    assert page.input_value("#wheel-names") == "Alice\nBob"
    assert fields.nth(0).input_value() == "Pizza"
    # ...and they still work after a flip.
    page.click("form[name='Dice'] button[type=submit]")
    assert 1 <= _rolled_value(page) <= 20
    page.locator(".picker-section .btn-primary").first.click()
    assert page.text_content(".picker-section .result-line").strip() != ""


def _find_short_straw(page):
    """Pull straws in order until the short one turns up; return its index."""
    n = int(page.input_value("#straws-count"))
    for i in range(n):
        el = page.locator(f'#straws-bundle .straw[data-index="{i}"]')
        if el.is_disabled():  # already revealed (e.g. auto-revealed on the loss)
            continue
        el.click()
        if "You drew the short straw" in page.text_content("#straws-result"):
            return i
    return None


def test_draw_straws_reveals_exactly_one_short(page):
    """Pulling straws eventually reveals exactly one short straw and ends the round."""
    short_i = _find_short_straw(page)
    assert short_i is not None
    assert "You drew the short straw" in page.text_content("#straws-result")
    # Exactly one straw is marked short, and the whole bundle is now revealed.
    assert page.locator("#straws-bundle .is-short").count() == 1
    n = int(page.input_value("#straws-count"))
    assert page.locator("#straws-bundle .straw.is-pulled").count() == n


def test_draw_straws_count_rerenders(page):
    """Changing the straw count re-renders exactly that many straws."""
    page.fill("#straws-count", "7")
    page.wait_for_function(
        "() => document.querySelectorAll('#straws-bundle .straw').length === 7"
    )
    assert page.locator("#straws-bundle .straw").count() == 7


def test_draw_straws_invalid_count_clamps(page):
    """A below-minimum count clamps to 2 without crashing (guidance, not error)."""
    page.fill("#straws-count", "0")
    page.locator("#straws-count").press("Tab")  # blur -> change -> clamp
    page.wait_for_function(
        "() => document.querySelectorAll('#straws-bundle .straw').length === 2"
    )
    assert page.input_value("#straws-count") == "2"


def test_draw_straws_new_round_reshuffles(page):
    """A finished round resets to a fresh, unrevealed bundle on New round."""
    _find_short_straw(page)
    assert page.locator("#straws-bundle .is-short").count() == 1
    page.click("#straws-new")
    assert page.locator("#straws-bundle .straw.is-pulled").count() == 0
    assert "Tap a straw" in page.text_content("#straws-result")


def test_draw_straws_does_not_disturb_other_tools(page):
    """Drawing straws leaves dice, wheel, coin, 8-ball, and picker independent."""
    page.fill("#max", "20")
    page.fill("#wheel-names", "Alice\nBob")
    fields = page.locator(".picker-section .option-field")
    fields.nth(0).fill("Pizza")
    fields.nth(1).fill("Sushi")

    _find_short_straw(page)

    # Other tools' inputs are untouched...
    assert page.input_value("#max") == "20"
    assert page.input_value("#wheel-names") == "Alice\nBob"
    assert fields.nth(0).input_value() == "Pizza"
    # ...and they still work after a draw.
    page.click("form[name='Dice'] button[type=submit]")
    assert 1 <= _rolled_value(page) <= 20
    page.click("#coin-flip")
    page.wait_for_function(
        "() => { const t = document.querySelector('#coin-result').textContent;"
        " return t.includes('Heads') || t.includes('Tails'); }",
        timeout=4000,
    )
    page.locator(".picker-section .btn-primary").first.click()
    assert page.text_content(".picker-section .result-line").strip() != ""


def _split_teams(page):
    """Click Split and return the list of member-name lists, one per team card."""
    page.click("#team-split")
    page.wait_for_function(
        "() => document.querySelectorAll('#team-results .team-card').length > 0",
        timeout=4000,
    )
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#team-results .team-card'))"
        ".map(c => Array.from(c.querySelectorAll('.team-member')).map(m => m.textContent))"
    )


def test_team_splitter_even_split(page):
    """6 names into 2 teams gives two 3/3 teams covering all names, no duplicates."""
    page.fill("#team-names", "Ann\nBob\nCy\nDee\nEli\nFay")
    page.fill("#team-count", "2")
    teams = _split_teams(page)
    assert len(teams) == 2
    assert sorted(len(t) for t in teams) == [3, 3]
    members = [m for t in teams for m in t]
    assert sorted(members) == ["Ann", "Bob", "Cy", "Dee", "Eli", "Fay"]
    assert len(members) == len(set(members))  # no duplicates


def test_team_splitter_uneven_split(page):
    """5 names into 2 teams gives sizes 3 and 2 (differ by at most one)."""
    page.fill("#team-names", "Ann\nBob\nCy\nDee\nEli")
    page.fill("#team-count", "2")
    teams = _split_teams(page)
    assert sorted(len(t) for t in teams) == [2, 3]
    members = sorted(m for t in teams for m in t)
    assert members == ["Ann", "Bob", "Cy", "Dee", "Eli"]


def test_team_splitter_too_many_teams_shows_guidance(page):
    """More teams than names shows guidance, no crash and no team cards."""
    page.fill("#team-names", "Ann\nBob")
    page.fill("#team-count", "5")
    page.click("#team-split")
    assert page.locator("#team-results .team-card").count() == 0
    result = page.text_content("#team-result").lower()
    assert "add more names" in result or "lower the team count" in result


def test_team_splitter_too_few_names_disables_split(page):
    """With fewer than two names the Split control is disabled (guidance, not crash)."""
    page.fill("#team-names", "Ann")
    assert page.is_disabled("#team-split")


def test_team_splitter_does_not_disturb_other_tools(page):
    """Splitting teams leaves dice, wheel, and picker independent."""
    page.fill("#max", "20")
    page.fill("#wheel-names", "Alice\nBob")
    fields = page.locator(".picker-section .option-field")
    fields.nth(0).fill("Pizza")
    fields.nth(1).fill("Sushi")

    page.fill("#team-names", "Ann\nBob\nCy\nDee")
    _split_teams(page)

    # Other tools' inputs are untouched...
    assert page.input_value("#max") == "20"
    assert page.input_value("#wheel-names") == "Alice\nBob"
    assert fields.nth(0).input_value() == "Pizza"
    # ...and they still work after a split.
    page.click("form[name='Dice'] button[type=submit]")
    assert 1 <= _rolled_value(page) <= 20
    page.locator(".picker-section .btn-primary").first.click()
    assert page.text_content(".picker-section .result-line").strip() != ""


def _ask_eightball(page, question="Will this test pass?"):
    """Ask the 8-ball and return the revealed answer text from the result line."""
    page.fill("#eightball-question", question)
    page.click("#eightball-ask")
    page.wait_for_function(
        "() => document.querySelector('#eightball-result')"
        ".textContent.includes('The ball says')",
        timeout=4000,
    )
    text = page.text_content("#eightball-result")
    return text.split("The ball says:", 1)[1].strip()


def test_eightball_reveals_a_classic_answer(page):
    """Asking reveals one of the 20 canonical answers (fair randomIndex)."""
    answer = _ask_eightball(page)
    answers = page.evaluate("() => EIGHTBALL_ANSWERS")
    assert len(answers) == 20
    assert answer in answers
    # The same answer is mirrored in the ball's triangle window.
    assert page.text_content("#eightball-answer").strip() == answer


def test_eightball_empty_question_shows_nudge_not_crash(page):
    """Asking with a blank question still reveals an answer (with a gentle nudge)."""
    page.click("#eightball-ask")
    page.wait_for_function(
        "() => document.querySelector('#eightball-result')"
        ".textContent.includes('The ball says')",
        timeout=4000,
    )
    answers = page.evaluate("() => EIGHTBALL_ANSWERS")
    answer = page.text_content("#eightball-answer").strip()
    assert answer in answers


def test_eightball_does_not_disturb_other_tools(page):
    """Asking the 8-ball leaves dice, wheel, coin, and picker independent."""
    page.fill("#max", "20")
    page.fill("#wheel-names", "Alice\nBob")
    fields = page.locator(".picker-section .option-field")
    fields.nth(0).fill("Pizza")
    fields.nth(1).fill("Sushi")

    _ask_eightball(page)

    # Other tools' inputs are untouched...
    assert page.input_value("#max") == "20"
    assert page.input_value("#wheel-names") == "Alice\nBob"
    assert fields.nth(0).input_value() == "Pizza"
    # ...and they still work after an ask.
    page.click("form[name='Dice'] button[type=submit]")
    assert 1 <= _rolled_value(page) <= 20
    page.click("#coin-flip")
    page.wait_for_function(
        "() => { const t = document.querySelector('#coin-result').textContent;"
        " return t.includes('Heads') || t.includes('Tails'); }",
        timeout=4000,
    )
    page.locator(".picker-section .btn-primary").first.click()
    assert page.text_content(".picker-section .result-line").strip() != ""
