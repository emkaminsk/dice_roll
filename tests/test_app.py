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


def _draw_lotto(page, k):
    """Click Draw and wait until all k balls have dropped; return their numbers."""
    page.click("#lotto-draw")
    page.wait_for_function(
        f"() => document.querySelectorAll('#lotto-balls .lotto-ball').length === {k}",
        timeout=6000,
    )
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#lotto-balls .lotto-ball'))"
        ".map(b => parseInt(b.textContent, 10))"
    )


def test_lotto_draws_six_unique_sorted(page):
    """6 from 49 yields exactly 6 unique numbers in [1, 49], shown ascending."""
    numbers = _draw_lotto(page, 6)
    assert len(numbers) == 6
    assert len(set(numbers)) == 6  # unique
    assert all(1 <= n <= 49 for n in numbers)
    assert numbers == sorted(numbers)  # displayed ascending


def test_lotto_preset_sets_k_and_n(page):
    """Selecting a preset fills the How-many and range inputs."""
    page.select_option("#lotto-preset", "5:50")
    assert page.input_value("#lotto-k") == "5"
    assert page.input_value("#lotto-n") == "50"
    numbers = _draw_lotto(page, 5)
    assert len(numbers) == 5
    assert all(1 <= n <= 50 for n in numbers)


def test_lotto_k_greater_than_n_shows_guidance(page):
    """Asking for more numbers than the range holds guides and draws nothing."""
    page.fill("#lotto-k", "10")
    page.fill("#lotto-n", "5")
    page.click("#lotto-draw")
    assert page.locator("#lotto-balls .lotto-ball").count() == 0
    assert "Can't draw" in page.text_content("#lotto-result")


def test_lotto_does_not_disturb_other_tools(page):
    """Drawing lucky numbers leaves dice, wheel, coin, and picker independent."""
    page.fill("#max", "20")
    page.fill("#wheel-names", "Alice\nBob")
    fields = page.locator(".picker-section .option-field")
    fields.nth(0).fill("Pizza")
    fields.nth(1).fill("Sushi")

    _draw_lotto(page, 6)

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


def _crack_cookie(page):
    """Click Crack open, wait for the slip to reveal, and return (fortune, numbers)."""
    page.click("#cookie-crack")
    page.wait_for_function(
        "() => { const s = document.querySelector('#cookie-slip');"
        " return s && !s.hidden"
        " && document.querySelector('#cookie-result').textContent.trim() !== ''"
        " && document.querySelectorAll('#cookie-numbers .cookie-num').length === 6; }",
        timeout=4000,
    )
    fortune = page.text_content("#cookie-result").strip()
    numbers = page.evaluate(
        "() => Array.from(document.querySelectorAll('#cookie-numbers .cookie-num'))"
        ".map(el => parseInt(el.textContent, 10))"
    )
    return fortune, numbers


def test_fortune_cookie_reveals_fortune_and_lucky_numbers(page):
    """Cracking reveals a real FORTUNES entry and 6 unique numbers in [1,69] sorted."""
    fortune, numbers = _crack_cookie(page)
    fortunes = page.evaluate("() => FORTUNES")
    assert fortune in fortunes
    assert len(numbers) == 6
    assert len(set(numbers)) == 6  # unique
    assert all(1 <= n <= 69 for n in numbers)
    assert numbers == sorted(numbers)  # displayed ascending
    # Cracking again yields a fresh (still valid) draw.
    fortune2, numbers2 = _crack_cookie(page)
    assert fortune2 in fortunes
    assert len(set(numbers2)) == 6
    assert all(1 <= n <= 69 for n in numbers2)


def test_fortune_cookie_does_not_disturb_other_tools(page):
    """Cracking a cookie leaves dice, wheel, coin, and picker independent."""
    page.fill("#max", "20")
    page.fill("#wheel-names", "Alice\nBob")
    fields = page.locator(".picker-section .option-field")
    fields.nth(0).fill("Pizza")
    fields.nth(1).fill("Sushi")

    _crack_cookie(page)

    # Other tools' inputs are untouched...
    assert page.input_value("#max") == "20"
    assert page.input_value("#wheel-names") == "Alice\nBob"
    assert fields.nth(0).input_value() == "Pizza"
    # ...and they still work after a crack.
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


# --- Group Draw (spec: .ai/spec-group-draw.md §8) ---------------------------

import json
import time


def _gd_people(n, teams=6, types=("consultant", "developer", "manager")):
    """n people with a team number and a type (half consultants, a quarter managers)."""
    people = []
    for i in range(n):
        kind = types[2] if i % 4 == 3 else types[i % 2]
        people.append({
            "id": f"p{i}", "name": f"Person {i}",
            "values": {"a-team": (i % teams) + 1, "a-type": kind},
        })
    return people


def _gd_setup(n=30, groups=5, rules=None, best_effort=False, teams=6, people=None):
    return {
        "version": 1,
        "attributes": [
            {"id": "a-sur", "name": "surname", "kind": "label"},
            {"id": "a-team", "name": "team", "kind": "integer"},
            {"id": "a-type", "name": "type", "kind": "category",
             "options": ["consultant", "developer", "manager"]},
        ],
        "people": people if people is not None else _gd_people(n, teams),
        "groups": {"count": groups, "names": []},
        "rules": rules or [],
        "options": {"balance": True, "bestEffort": best_effort},
    }


GD_RULES = [
    {"id": "r1", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager", "min": 1, "max": 2},
    {"id": "r2", "type": "count", "scope": "all", "attrId": "a-type", "value": "consultant", "min": 2, "max": None},
    {"id": "r3", "type": "apart", "scope": "all", "attrId": "a-team", "k": 2},
]


def _gd_open(page, auto_accept=True):
    if auto_accept:
        page.on("dialog", lambda d: d.accept())
    page.click("#tab-group-draw")
    page.wait_for_selector("#group-draw-view:not([hidden])")


def _gd_import(page, setup):
    page.set_input_files("#gd-import-file", files=[{
        "name": "setup.json", "mimeType": "application/json",
        "buffer": json.dumps(setup).encode(),
    }])
    page.wait_for_function(
        "() => document.querySelector('#gd-io-notice').textContent.includes('mported')",
        timeout=4000,
    )


def _gd_draw(page, timeout=15000):
    """Click Draw and wait for a new result or a failure panel; return groups of person ids."""
    before = page.get_attribute("#gd-results", "data-draw-no")
    page.click("#gd-draw")
    page.wait_for_function(
        """(before) => { const r = document.querySelector('#gd-results');
             const btn = document.querySelector('#gd-draw');
             return !btn.disabled && (r.dataset.drawNo !== (before || undefined)
               || !document.querySelector('#gd-alert').hidden); }""",
        arg=before, timeout=timeout,
    )
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#gd-results .gd-card'))"
        ".map(c => Array.from(c.querySelectorAll('.gd-member')).map(li => li.dataset.personId))"
    )


def _gd_check(setup, groups):
    """Independently recompute every rule from a result; return a list of problems."""
    people = {p["id"]: p for p in setup["people"]}
    problems = []
    seen = [pid for g in groups for pid in g]
    if sorted(seen) != sorted(people):
        problems.append("not every person exactly once")
    n, G = len(people), setup["groups"]["count"]
    for gi, ids in enumerate(groups):
        vals = [people[i]["values"] for i in ids]
        if not any(r["type"] == "size" for r in setup["rules"]):
            if not (n // G <= len(ids) <= -(-n // G)):
                problems.append(f"group {gi} unbalanced: {len(ids)}")
        for r in setup["rules"]:
            sc = r.get("scope", "all")
            if sc != "all" and gi not in (sc if isinstance(sc, list) else [sc]):
                continue
            if r["type"] == "count":
                conds = [{"attrId": r["attrId"], "value": r["value"]}] + r.get("and", [])
                c = sum(1 for v in vals if all(v.get(x["attrId"]) == x["value"] for x in conds))
            elif r["type"] == "size":
                c = len(ids)
            elif r["type"] == "sum":
                c = sum(v.get(r["attrId"]) or 0 for v in vals)
            else:
                c = None
            if c is not None:
                if r.get("min") is not None and c < r["min"]:
                    problems.append(f"group {gi}: {r['id']} below min ({c})")
                if r.get("max") is not None and c > r["max"]:
                    problems.append(f"group {gi}: {r['id']} above max ({c})")
            if r["type"] == "apart":
                from collections import Counter
                cnt = Counter(v.get(r["attrId"]) for v in vals if v.get(r["attrId"]) is not None)
                if cnt and max(cnt.values()) > r["k"]:
                    problems.append(f"group {gi}: apart violated {cnt}")
    for r in setup["rules"]:
        if r["type"] == "together":
            where = {}
            for gi, ids in enumerate(groups):
                for i in ids:
                    v = people[i]["values"].get(r["attrId"])
                    if v is not None and (not r.get("values") or v in r["values"]):
                        where.setdefault(v, set()).add(gi)
            if any(len(s) > 1 for s in where.values()):
                problems.append(f"together split: {where}")
    return problems


def test_gd_tabs_default_switch_and_hash(page, server):
    """Quick tools show by default; the Group Draw tab swaps views; #group-draw links directly."""
    assert page.is_visible("#quick-tools-view")
    assert page.is_hidden("#group-draw-view")
    page.click("#tab-group-draw")
    assert page.is_hidden("#quick-tools-view")
    assert page.is_visible("#group-draw-view")
    assert page.evaluate("location.hash") == "#group-draw"
    assert page.get_attribute("#tab-group-draw", "aria-selected") == "true"
    # Keyboard: arrow key moves back to Quick tools.
    page.focus("#tab-group-draw")
    page.keyboard.press("ArrowLeft")
    assert page.is_visible("#quick-tools-view")
    assert page.get_attribute("#tab-quick-tools", "aria-selected") == "true"
    # Direct link opens the view.
    page.goto(server + "#group-draw")
    page.wait_for_load_state("networkidle")
    assert page.is_visible("#group-draw-view")
    assert page.is_hidden("#quick-tools-view")


def test_gd_tab_switch_keeps_state(page):
    """Switching tabs never resets either view."""
    page.fill("#max", "12")
    _gd_open(page)
    page.click("#gd-load-example")
    page.click("#tab-quick-tools")
    assert page.input_value("#max") == "12"
    page.click("#tab-group-draw")
    assert page.locator("#gd-people-table tbody tr").count() == 30


def test_gd_attributes_add_validate_delete(page):
    """Label/integer/category attributes; category needs options; duplicates rejected; delete-in-use confirms."""
    answers = []  # True = accept the next confirm, False = dismiss
    asked = []
    page.on("dialog", lambda d: (asked.append(d.message), d.accept() if answers.pop(0) else d.dismiss()))
    _gd_open(page, auto_accept=False)
    for name, kind, opts in [("surname", "label", ""), ("team", "integer", ""), ("type", "category", "dev, ops")]:
        page.fill("#gd-attr-name", name)
        page.select_option("#gd-attr-kind", kind)
        if kind == "category":
            page.fill("#gd-attr-options", opts)
        page.click("#gd-attr-add")
    assert page.locator(".gd-attr-row").count() == 3
    assert page.locator(".gd-attr-row .gd-chip").count() == 2

    page.fill("#gd-attr-name", "role")
    page.select_option("#gd-attr-kind", "category")
    page.fill("#gd-attr-options", "")
    page.click("#gd-attr-add")
    assert "at least one option" in page.text_content("#gd-attr-error")
    assert page.locator(".gd-attr-row").count() == 3

    page.fill("#gd-attr-name", "TEAM")
    page.select_option("#gd-attr-kind", "integer")
    page.click("#gd-attr-add")
    assert "already an attribute" in page.text_content("#gd-attr-error")
    assert page.locator(".gd-attr-row").count() == 3

    # Give someone a team, then deleting "team" asks first.
    page.click("#gd-add-person")
    row = page.locator("#gd-people-table tbody tr").first
    row.locator("input[data-field='name']").fill("Ann")
    row.locator("td[data-kind='integer'] input").fill("3")
    answers.append(False)
    page.locator(".gd-attr-row").nth(1).locator(".gd-attr-delete").click()
    assert asked and "team" in asked[0]
    assert page.locator(".gd-attr-row").count() == 3  # dismissed → kept
    answers.append(True)
    page.locator(".gd-attr-row").nth(1).locator(".gd-attr-delete").click()
    assert page.locator(".gd-attr-row").count() == 2
    headers = page.eval_on_selector_all("#gd-people-table thead th", "ths => ths.map(t => t.textContent)")
    assert "team" not in headers and "type" in headers


def test_gd_people_table_add_edit_delete(page):
    """Rows can be added, edited (with inline integer validation) and deleted; duplicates are flagged."""
    _gd_open(page)
    _gd_import(page, _gd_setup(people=[]))
    for name in ["Ann", "Bob", "Ann"]:
        page.click("#gd-add-person")
        page.locator("#gd-people-table tbody tr").last.locator("input[data-field='name']").fill(name)
    assert "3 people" in page.text_content("#gd-people-count")
    assert page.locator("#gd-people-table td.is-duplicate").count() == 2
    team = page.locator("#gd-people-table tbody tr").nth(1).locator("input[data-field='a-team']")
    team.fill("abc")
    assert page.locator("#gd-people-table td.is-invalid").count() == 1
    team.fill("4")
    assert page.locator("#gd-people-table td.is-invalid").count() == 0
    page.locator("#gd-people-table tbody tr").nth(2).locator(".gd-person-delete").click()
    assert "2 people" in page.text_content("#gd-people-count")
    assert page.locator("#gd-people-table td.is-duplicate").count() == 0


def test_gd_paste_with_header_reports_problems(page):
    """TSV with a header maps by name; bad integers and unknown categories are reported before import."""
    _gd_open(page)
    _gd_import(page, _gd_setup(people=[]))
    page.click("#gd-paste-toggle")
    page.fill("#gd-paste-text", "type\tname\tteam\nmanager\tAnn\t1\nintern\tBob\tx7\ndeveloper\tCy\t2")
    page.click("#gd-paste-preview")
    issues = page.text_content("#gd-paste-result")
    assert "not a whole number" in issues and "x7" in issues
    assert "intern" in issues
    assert page.locator("#gd-people-table tbody tr").count() == 0  # nothing imported yet
    page.check(".gd-unknown input[value='empty']")
    page.click("#gd-paste-import")
    rows = page.locator("#gd-people-table tbody tr")
    assert rows.count() == 3
    bob = rows.nth(1)
    assert bob.locator("input[data-field='name']").input_value() == "Bob"
    assert bob.locator("input[data-field='a-team']").input_value() == ""
    assert bob.locator("select[data-field='a-type']").input_value() == ""
    assert rows.nth(0).locator("select[data-field='a-type']").input_value() == "manager"


def test_gd_paste_without_header_by_position(page):
    """CSV without a header maps columns by position (name, then attributes in order)."""
    _gd_open(page)
    _gd_import(page, _gd_setup(people=[]))
    page.click("#gd-paste-toggle")
    page.fill("#gd-paste-text", "Ann,Smith,3,manager\nBob,Jones,4,lead")
    page.click("#gd-paste-preview")
    assert "lead" in page.text_content("#gd-paste-result")
    page.click("#gd-paste-import")  # default: add unknown values as new options
    rows = page.locator("#gd-people-table tbody tr")
    assert rows.count() == 2
    assert rows.nth(0).locator("input[data-field='a-team']").input_value() == "3"
    assert rows.nth(1).locator("select[data-field='a-type']").input_value() == "lead"
    assert page.locator(".gd-attr-row .gd-chip", has_text="lead").count() == 1


def _gd_set_scope(page, scope):
    """Drive the multi-select 'Applies to' picker: None/'all', a group index (str/int) or a list of them."""
    if scope in (None, "all"):
        return
    wanted = [int(g) for g in (scope if isinstance(scope, list) else [scope])]
    picker = page.locator("#gd-rule-scope details")
    picker.locator("summary").click()
    picker.locator(".gd-scope-all").uncheck()  # leaves group 1 ticked
    for g in wanted:
        picker.locator(f"input[data-group='{g}']").check()
    if 0 not in wanted:
        picker.locator("input[data-group='0']").uncheck()
    picker.locator("summary").click()


def _gd_add_rule(page, rtype, attr=None, value=None, vmin=None, vmax=None, k=None, scope=None, values=None):
    page.select_option("#gd-rule-type", rtype)
    if attr:
        page.select_option("#gd-rule-attr", attr)
    if value is not None:
        if page.is_visible("#gd-rule-value-num"):
            page.fill("#gd-rule-value-num", str(value))
        else:
            page.select_option("#gd-rule-value", value)
    if rtype in ("size", "count", "sum"):
        page.fill("#gd-rule-min", "" if vmin is None else str(vmin))
        page.fill("#gd-rule-max", "" if vmax is None else str(vmax))
        _gd_set_scope(page, scope)
    if k is not None:
        page.fill("#gd-rule-k", str(k))
    if values is not None:
        page.fill("#gd-rule-values", values)
    page.click("#gd-rule-add")


def test_gd_rules_created_scoped_and_hinted(page):
    """All rule types can be added; a group-specific rule is marked as an override; impossible mins are hinted."""
    _gd_open(page)
    people = _gd_people(20)
    # Exactly 7 consultants.
    for i, p in enumerate(people):
        p["values"]["a-type"] = "consultant" if i < 7 else "developer"
    _gd_import(page, _gd_setup(people=people, groups=5))
    _gd_add_rule(page, "count", "a-type", "consultant", vmin=2)
    hints = page.text_content("#gd-hints")
    assert "5 groups × min 2" in hints and "only 7" in hints
    assert page.locator(".gd-rule.is-error").count() == 1
    _gd_add_rule(page, "count", "a-type", "consultant", vmin=1, scope="0")
    assert page.locator(".gd-rule").nth(1).locator(".gd-badge").count() == 1
    _gd_add_rule(page, "size", vmin=3, vmax=5)
    assert page.is_disabled("#gd-balance")
    _gd_add_rule(page, "sum", "a-team", vmax=40)
    _gd_add_rule(page, "apart", "a-team", k=2)
    _gd_add_rule(page, "together", "a-team", values="1")
    types = page.eval_on_selector_all(".gd-rule", "els => els.map(e => e.dataset.type)")
    assert types == ["count", "count", "size", "sum", "apart", "together"]


def test_gd_override_rule_wins_for_its_group(page):
    """A specific-group rule overrides the all-groups rule for the same target."""
    setup = _gd_setup(n=12, groups=3, rules=[
        {"id": "a", "type": "count", "scope": "all", "attrId": "a-type", "value": "consultant", "min": None, "max": 0},
        {"id": "b", "type": "count", "scope": 1, "attrId": "a-type", "value": "consultant", "min": 0, "max": None},
    ])
    for i, p in enumerate(setup["people"]):
        p["values"]["a-type"] = "consultant" if i < 3 else "developer"
    groups = page.evaluate("s => GroupDrawSolver.solve(s).groups", setup)
    consultants = {p["id"] for p in setup["people"] if p["values"]["a-type"] == "consultant"}
    assert consultants <= set(groups[1])


def test_gd_strict_draw_50_times_never_violates(page):
    """Every person exactly once and all rules hold, over 50 UI draws (checked independently)."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    setup = _gd_setup(n=30, groups=5, rules=GD_RULES)
    _gd_import(page, setup)
    for _ in range(50):
        groups = _gd_draw(page)
        assert len(groups) == 5
        assert _gd_check(setup, groups) == []
    assert "Drew 5 groups" in page.text_content("#gd-status")


def test_gd_draw_again_varies(page):
    """Repeated draws produce different splits (≥ 2 distinct in 20)."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3, rules=GD_RULES[:1]))
    seen = {tuple(tuple(sorted(g)) for g in _gd_draw(page)) for _ in range(20)}
    assert len(seen) >= 2


def test_gd_infeasible_strict_shows_error_and_blame(page):
    """An impossible setup in strict mode shows an error panel naming rules to blame, and no cards."""
    _gd_open(page)
    people = _gd_people(10)
    for i, p in enumerate(people):
        p["values"]["a-type"] = "manager" if i < 2 else "developer"
    _gd_import(page, _gd_setup(people=people, groups=2, rules=[
        {"id": "x", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager", "min": 2, "max": None},
    ]))
    _gd_draw(page)
    assert page.is_visible("#gd-alert.is-error")
    text = page.text_content("#gd-alert")
    assert "can’t all be met" in text
    assert "Dropping" in text and "manager" in text
    assert page.locator("#gd-results .gd-card").count() == 0


def test_gd_infeasible_hidden_conflict_is_explained(page):
    """Infeasibility the hints can't see is proven by search and blamed on a rule."""
    people = [{"id": f"p{i}", "name": f"P{i}", "values": {"a-type": "manager" if i < 2 else "developer"}} for i in range(4)]
    setup = _gd_setup(people=people, groups=2, rules=[
        {"id": "t", "type": "together", "scope": "all", "attrId": "a-type", "values": ["manager"]},
        {"id": "c", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager", "min": 1, "max": None},
    ])
    res = page.evaluate("s => GroupDrawSolver.run(s)", setup)
    assert res["status"] == "infeasible"
    assert {b["ruleId"] for b in res["blame"]} == {"t", "c"}


def test_gd_best_effort_shows_cards_and_violations(page):
    """Best effort on an impossible setup still deals cards and lists violated rules."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    people = _gd_people(10)
    for i, p in enumerate(people):
        p["values"]["a-type"] = "manager" if i < 2 else "developer"
    _gd_import(page, _gd_setup(people=people, groups=2, best_effort=True, rules=[
        {"id": "x", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager", "min": 2, "max": None},
    ]))
    groups = _gd_draw(page)
    assert len(groups) == 2 and sorted(sum(groups, [])) == sorted(p["id"] for p in people)
    assert page.is_visible("#gd-alert.is-warning")
    assert page.locator("#gd-alert li").count() >= 1
    assert "best effort" in page.text_content("#gd-status")


def test_gd_keep_together_and_apart(page):
    """Keep-together blocks stay in one group; keep-apart k=1 separates same-value people."""
    together = _gd_setup(n=24, groups=4, teams=6, rules=[
        {"id": "t", "type": "together", "scope": "all", "attrId": "a-team", "values": [1, 2]},
    ])
    apart = _gd_setup(n=20, groups=5, teams=4, rules=[
        {"id": "a", "type": "apart", "scope": "all", "attrId": "a-team", "k": 1},
    ])
    for setup in (together, apart):
        for _ in range(10):
            res = page.evaluate("s => GroupDrawSolver.run(s)", setup)
            assert res["status"] == "ok"
            assert _gd_check(setup, res["groups"]) == []


def test_gd_solver_uniformity_smoke(page):
    """No rules, 3 people into 3 groups: each person lands in each group ~1/3 of the time."""
    counts = page.evaluate("""() => {
        const s = { attributes: [], groups: { count: 3, names: [] }, rules: [], options: { balance: true },
                    people: [0, 1, 2].map(i => ({ id: 'p' + i, name: 'P' + i, values: {} })) };
        const c = {};
        for (let t = 0; t < 10000; t++) {
            GroupDrawSolver.solve(s).groups.forEach((ids, g) => ids.forEach(id => { c[id + ':' + g] = (c[id + ':' + g] || 0) + 1; }));
        }
        return c;
    }""")
    assert len(counts) == 9
    for v in counts.values():
        assert abs(v / 10000 - 1 / 3) < 0.05


def test_gd_export_reset_import_roundtrip(page):
    """Export → reset → import restores the identical setup; invalid JSON shows an error."""
    _gd_open(page)
    page.click("#gd-load-example")
    with page.expect_download() as dl:
        page.click("#gd-export")
    exported = json.loads(Path(dl.value.path()).read_text())
    page.click("#gd-reset")
    assert page.locator("#gd-people-table tbody tr").count() == 0
    _gd_import(page, exported)
    with page.expect_download() as dl2:
        page.click("#gd-export")
    assert json.loads(Path(dl2.value.path()).read_text()) == exported
    assert page.locator("#gd-people-table tbody tr").count() == 30

    page.set_input_files("#gd-import-file", files=[{"name": "bad.json", "mimeType": "application/json", "buffer": b"{not json"}])
    page.wait_for_selector("#gd-io-notice.is-error")
    assert "not valid JSON" in page.text_content("#gd-io-notice")
    assert page.locator("#gd-people-table tbody tr").count() == 30


def test_gd_performance_200_people(page):
    """200 people, 10 groups, 4 rules solves in under 2 seconds."""
    people = _gd_people(200, teams=25)
    for i, p in enumerate(people):
        p["values"]["a-type"] = "manager" if i % 13 == 0 else ("consultant" if i % 10 < 3 else "developer")
    setup = _gd_setup(people=people, groups=10, rules=GD_RULES[:2] + [
        {"id": "r3", "type": "apart", "scope": "all", "attrId": "a-team", "k": 1},
        {"id": "r4", "type": "sum", "scope": "all", "attrId": "a-team", "min": 200, "max": 320},
    ])
    out = page.evaluate("""s => { const t = performance.now(); const r = GroupDrawSolver.run(s);
                                   return { r, ms: performance.now() - t }; }""", setup)
    assert out["r"]["status"] == "ok"
    assert out["ms"] < 2000
    assert _gd_check(setup, out["r"]["groups"]) == []


def test_gd_copy_text_and_csv_contain_everyone_once(page):
    """Copy-as-text and CSV list every person exactly once."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    page.click("#gd-load-example")
    _gd_draw(page)
    page.evaluate("() => { navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; }")
    page.click("#gd-copy")
    text = page.evaluate("() => window.__copied")
    names = [n for line in text.splitlines() for n in line.split(": ", 1)[1].split(", ")]
    example = page.evaluate("() => GROUP_DRAW_EXAMPLE.people.map(p => p.name)")
    assert sorted(names) == sorted(example)
    with page.expect_download() as dl:
        page.click("#gd-csv")
    lines = Path(dl.value.path()).read_text().strip().splitlines()
    assert lines[0] == "group,name,surname,team,type"
    assert sorted(l.split(",")[1] for l in lines[1:]) == sorted(example)


def test_gd_mobile_no_horizontal_scroll(page):
    """At 375px the page doesn't scroll sideways; the people table scrolls inside its own box."""
    page.set_viewport_size({"width": 375, "height": 800})
    _gd_open(page)
    page.click("#gd-load-example")
    _gd_draw(page)
    assert page.evaluate("document.documentElement.scrollWidth") <= 375
    wrap = page.eval_on_selector("#gd-table-wrap", "e => [getComputedStyle(e).overflowX, e.clientWidth]")
    assert wrap[0] == "auto" and wrap[1] <= 375
    page.fill("#gd-people-table tbody tr:first-child input[data-field='name']", "Ada B.")
    assert page.input_value("#gd-people-table tbody tr:first-child input[data-field='name']") == "Ada B."


def test_gd_reduced_motion_renders_instantly(page):
    """With reduced motion, results appear without reveal animations."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    page.click("#gd-load-example")
    start = time.time()
    _gd_draw(page)
    assert time.time() - start < 3
    assert page.locator("#gd-results .gd-card").count() == 5
    assert page.locator("#gd-results .is-dealt, #gd-results .is-popping").count() == 0
    assert not page.evaluate("document.querySelector('#gd-draw').classList.contains('is-dealing')")


def test_gd_does_not_disturb_other_tools(page):
    """Running Group Draw leaves the quick tools' inputs and results alone."""
    page.fill("#max", "20")
    page.fill("#team-names", "Ann\nBob\nCy")
    page.fill("#wheel-names", "Alice\nBob")
    _gd_open(page)
    page.click("#gd-load-example")
    _gd_draw(page)
    page.click("#tab-quick-tools")
    assert page.input_value("#max") == "20"
    assert page.input_value("#team-names") == "Ann\nBob\nCy"
    assert page.input_value("#wheel-names") == "Alice\nBob"
    assert page.locator("#team-results .team-card").count() == 0
    page.click("form[name='Dice'] button[type=submit]")
    assert 1 <= _rolled_value(page) <= 20


# --- Group Draw: hardening (edge cases, history, reset, interplay) ------------

def _gd_run(page, setup):
    return page.evaluate("s => GroupDrawSolver.run(s)", setup)


def _gd_ppl(values_list, attr="a-team"):
    return [{"id": f"p{i}", "name": f"P{i}", "values": {attr: v}} for i, v in enumerate(values_list)]


def test_gd_zero_attributes_is_a_plain_splitter(page):
    """Spec 4.1: zero attributes is allowed; people are split evenly (and size rules still work)."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    people = [{"id": f"p{i}", "name": f"P{i}", "values": {}} for i in range(11)]
    setup = _gd_setup(people=people, groups=3)
    setup["attributes"] = []
    _gd_import(page, setup)
    groups = _gd_draw(page)
    assert sorted(len(g) for g in groups) == [3, 4, 4]
    assert _gd_check(setup, groups) == []
    # Size rule with no attributes.
    setup["rules"] = [{"id": "s", "type": "size", "scope": "all", "min": 2, "max": 6}]
    res = _gd_run(page, setup)
    assert res["status"] == "ok" and all(2 <= len(g) <= 6 for g in res["groups"])
    assert sorted(sum(res["groups"], [])) == sorted(p["id"] for p in people)


def test_gd_draw_with_no_people_shows_guidance(page):
    """Spec 4.4: drawing an empty setup explains itself instead of crashing."""
    _gd_open(page)
    page.click("#gd-draw")
    page.wait_for_function("() => document.querySelector('#gd-status').textContent.trim() !== ''", timeout=4000)
    assert page.locator("#gd-results .gd-card").count() == 0


def test_gd_fewer_people_than_groups(page):
    """More groups than people: does not crash; either empty groups are dealt or guidance is shown."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    setup = _gd_setup(people=_gd_people(3), groups=5)
    _gd_import(page, setup)
    groups = _gd_draw(page)
    if groups:
        assert sorted(sum(groups, [])) == ["p0", "p1", "p2"]
    else:
        assert page.text_content("#gd-status").strip() != "" or page.is_visible("#gd-alert")


def test_gd_keep_together_vs_size_interplay(page):
    """Spec 4.3/5.2: a keep-together block larger than the max group size is infeasible; equal to it is fine."""
    together = {"id": "t", "type": "together", "scope": "all", "attrId": "a-team", "values": [1]}
    people = _gd_ppl([1, 1, 1, 1] + [2, 3, 4, 5, 6, 7, 8, 9])  # block of 4, 12 people
    too_big = _gd_setup(people=people, groups=3, rules=[
        together, {"id": "s", "type": "size", "scope": "all", "min": None, "max": 3}])
    res = _gd_run(page, too_big)
    assert res["status"] == "infeasible"
    fits = _gd_setup(people=people, groups=3, rules=[
        together, {"id": "s", "type": "size", "scope": "all", "min": 4, "max": 4}])
    for _ in range(10):
        res = _gd_run(page, fits)
        assert res["status"] == "ok"
        assert _gd_check(fits, res["groups"]) == []
        assert any({"p0", "p1", "p2", "p3"} <= set(g) for g in res["groups"])
    # Without size rules, balance (sizes 4/4/4) still has to keep the block whole.
    bal = _gd_setup(people=people, groups=3, rules=[together])
    for _ in range(10):
        res = _gd_run(page, bal)
        assert res["status"] == "ok" and sorted(len(g) for g in res["groups"]) == [4, 4, 4]
        assert _gd_check(bal, res["groups"]) == []


def test_gd_keep_together_block_too_big_for_balance_is_infeasible(page):
    """A block of 5 with 3 balanced groups of 4 cannot be placed."""
    people = _gd_ppl([1] * 5 + [2, 3, 4, 5, 6, 7, 8])
    setup = _gd_setup(people=people, groups=3, rules=[
        {"id": "t", "type": "together", "scope": "all", "attrId": "a-team", "values": [1]}])
    assert _gd_run(page, setup)["status"] == "infeasible"


def test_gd_keep_together_hint_when_block_exceeds_group_size(page):
    """Spec 4.3: live hint when a keep-together set cannot fit the largest group."""
    _gd_open(page)
    people = _gd_ppl([1] * 5 + [2, 3, 4, 5, 6, 7, 8])
    _gd_import(page, _gd_setup(people=people, groups=3))
    _gd_add_rule(page, "together", "a-team", values="1")
    page.wait_for_function("() => document.querySelector('#gd-hints').textContent.trim() !== ''", timeout=4000)
    assert page.locator(".gd-rule.is-error, #gd-hints li").count() >= 1


def test_gd_together_and_apart_combine(page):
    """Keep-together on some teams and keep-apart on type hold simultaneously."""
    people = []
    for i in range(18):
        people.append({"id": f"p{i}", "name": f"P{i}", "values": {"a-team": (i % 6) + 1,
                       "a-type": ["consultant", "developer", "manager"][i % 3]}})
    setup = _gd_setup(people=people, groups=3, rules=[
        {"id": "t", "type": "together", "scope": "all", "attrId": "a-team", "values": [1, 2]},
        {"id": "a", "type": "apart", "scope": "all", "attrId": "a-type", "k": 3},
    ])
    for _ in range(15):
        res = _gd_run(page, setup)
        if res["status"] != "ok":
            raise AssertionError(res)
        assert _gd_check(setup, res["groups"]) == []


def test_gd_integer_sum_rules_with_negatives(page):
    """Spec 4.1/4.3: integer sums honour negative values and min/max bounds in every group."""
    vals = [-3, -2, -1, 0, 1, 2, 3, 4, -4, 5, -5, 6]
    setup = _gd_setup(people=_gd_ppl(vals), groups=3, rules=[
        {"id": "s", "type": "sum", "scope": "all", "attrId": "a-team", "min": -2, "max": 4}])
    seen = set()
    for _ in range(20):
        res = _gd_run(page, setup)
        assert res["status"] == "ok"
        assert _gd_check(setup, res["groups"]) == []
        seen.add(tuple(sorted(tuple(sorted(g)) for g in res["groups"])))
    assert len(seen) >= 2


def test_gd_integer_sum_rule_infeasible_and_blamed(page):
    """Total sum 20 over 2 groups cannot satisfy max 5 per group; the sum rule is blamed."""
    setup = _gd_setup(people=_gd_ppl([5, 5, 5, 5]), groups=2, rules=[
        {"id": "s", "type": "sum", "scope": "all", "attrId": "a-team", "min": None, "max": 5}])
    res = _gd_run(page, setup)
    assert res["status"] == "infeasible"
    assert "s" in {b["ruleId"] for b in res.get("blame", [])} or res.get("reasons")


def test_gd_sum_rule_ignores_empty_values(page):
    """Empty integers are never counted by sum rules."""
    people = _gd_ppl([4, 4, None, None, 4, 4])
    setup = _gd_setup(people=people, groups=2, rules=[
        {"id": "s", "type": "sum", "scope": "all", "attrId": "a-team", "min": 8, "max": 8}])
    res = _gd_run(page, setup)
    assert res["status"] == "ok"
    assert _gd_check(setup, res["groups"]) == []


def test_gd_scope_override_for_size_and_sum(page):
    """A group-specific size rule overrides the all-groups size rule for that group only."""
    people = _gd_ppl([1] * 12)
    setup = _gd_setup(people=people, groups=3, rules=[
        {"id": "a", "type": "size", "scope": "all", "min": 3, "max": 5},
        {"id": "b", "type": "size", "scope": 2, "min": 6, "max": 6},
    ])
    for _ in range(10):
        res = _gd_run(page, setup)
        assert res["status"] == "ok"
        assert len(res["groups"][2]) == 6
        assert all(3 <= len(g) <= 5 for g in res["groups"][:2])
        assert sorted(sum(res["groups"], [])) == sorted(p["id"] for p in people)


def test_gd_scope_specific_group_only_rule(page):
    """A rule scoped to one group does not constrain the others."""
    people = [{"id": f"p{i}", "name": f"P{i}", "values": {"a-type": "manager" if i < 3 else "developer"}} for i in range(9)]
    setup = _gd_setup(people=people, groups=3, rules=[
        {"id": "m", "type": "count", "scope": 0, "attrId": "a-type", "value": "manager", "min": 3, "max": 3}])
    res = _gd_run(page, setup)
    assert res["status"] == "ok"
    assert set(res["groups"][0]) >= {"p0", "p1", "p2"}


def test_gd_best_effort_on_feasible_setup_is_clean(page):
    """Best effort enabled but the setup is satisfiable: normal valid result, no warning panel."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    setup = _gd_setup(n=30, groups=5, rules=GD_RULES, best_effort=True)
    _gd_import(page, setup)
    groups = _gd_draw(page)
    assert _gd_check(setup, groups) == []
    assert page.is_hidden("#gd-alert")
    assert "best effort" not in page.text_content("#gd-status")


def test_gd_best_effort_sum_and_size_conflict_still_deals_everyone(page):
    """Best effort with contradictory size rules still assigns every person exactly once."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    setup = _gd_setup(people=_gd_people(10), groups=2, best_effort=True, rules=[
        {"id": "s", "type": "size", "scope": "all", "min": 8, "max": None}])
    _gd_import(page, setup)
    groups = _gd_draw(page)
    assert sorted(sum(groups, [])) == sorted(p["id"] for p in setup["people"])
    assert page.is_visible("#gd-alert.is-warning")


def test_gd_history_lists_redisplays_and_caps_at_ten(page):
    """Spec 4.4: history keeps the last 10 draws; clicking one re-displays it."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3))
    assert page.is_hidden("#gd-history-wrap")
    first = _gd_draw(page)
    second = _gd_draw(page)
    assert page.is_visible("#gd-history-wrap")
    assert page.locator("#gd-history .gd-history-btn").count() == 2
    # Click the oldest entry (listed last).
    page.locator("#gd-history .gd-history-btn").last.click()
    shown = page.evaluate(
        "() => Array.from(document.querySelectorAll('#gd-results .gd-card'))"
        ".map(c => Array.from(c.querySelectorAll('.gd-member')).map(li => li.dataset.personId))")
    assert shown == first
    page.locator("#gd-history .gd-history-btn").first.click()
    shown = page.evaluate(
        "() => Array.from(document.querySelectorAll('#gd-results .gd-card'))"
        ".map(c => Array.from(c.querySelectorAll('.gd-member')).map(li => li.dataset.personId))")
    assert shown == second
    for _ in range(12):
        _gd_draw(page)
    assert page.locator("#gd-history .gd-history-btn").count() == 10


def test_gd_reset_clears_everything(page):
    """Spec 4.5: Reset all clears setup, results, and history (after confirm); declining keeps it."""
    page.emulate_media(reduced_motion="reduce")
    decisions = [False, True]
    page.on("dialog", lambda d: d.accept() if decisions.pop(0) else d.dismiss())
    page.click("#tab-group-draw")
    page.click("#gd-load-example")  # empty -> no confirm needed
    _gd_draw(page)
    _gd_draw(page)
    page.click("#gd-reset")  # dismissed
    assert page.locator("#gd-people-table tbody tr").count() == 30
    assert page.locator("#gd-results .gd-card").count() == 5
    page.click("#gd-reset")  # accepted
    assert page.locator("#gd-people-table tbody tr").count() == 0
    assert page.locator(".gd-attr-row").count() == 0
    assert page.locator(".gd-rule").count() == 0
    assert page.locator("#gd-results .gd-card").count() == 0
    assert page.is_hidden("#gd-history-wrap")
    assert page.is_hidden("#gd-result-actions")


def test_gd_people_clear_all(page):
    """People section has a Clear all button: confirm required, removes people, keeps attributes."""
    decisions = [False, True]
    page.on("dialog", lambda d: d.accept() if decisions.pop(0) else d.dismiss())
    page.click("#tab-group-draw")
    assert page.is_hidden("#gd-people-clear")
    page.click("#gd-load-example")
    assert page.is_visible("#gd-people-clear")
    page.click("#gd-people-clear")  # dismissed
    assert page.locator("#gd-people-table tbody tr").count() == 30
    page.click("#gd-people-clear")  # accepted
    assert page.locator("#gd-people-table tbody tr").count() == 0
    assert page.locator(".gd-attr-row").count() > 0
    assert page.is_hidden("#gd-people-clear")


def test_gd_editing_setup_marks_results_outdated(page):
    """Spec 4.5: after a draw, editing the people marks the results outdated; drawing again clears it."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3))
    _gd_draw(page)
    assert page.is_hidden("#gd-outdated")
    page.click("#gd-add-person")
    assert page.is_visible("#gd-outdated")
    _gd_draw(page)
    assert page.is_hidden("#gd-outdated")


def test_gd_deleting_attribute_removes_its_rules(page):
    """Spec 4.1: deleting an attribute (confirmed) removes dependent rules and values."""
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3, rules=GD_RULES))
    assert page.locator(".gd-rule").count() == 3
    team_row = page.locator(".gd-attr-row[data-attr-id='a-team']")
    team_row.locator(".gd-attr-delete").click()
    assert page.locator(".gd-rule").count() == 2  # the keep-apart-on-team rule is gone
    assert page.locator(".gd-rule[data-type='apart']").count() == 0


def test_gd_import_rejects_bad_files_and_keeps_setup(page):
    """Spec 7: wrong version / wrong shape give a readable error and leave the setup untouched."""
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3))
    for payload, fragment in [
        ({"version": 2, "attributes": [], "people": [], "rules": []}, "version"),
        ({"version": 1, "attributes": []}, "Missing"),
        ([1, 2, 3], "not a Group Draw setup"),
    ]:
        page.set_input_files("#gd-import-file", files=[{
            "name": "bad.json", "mimeType": "application/json", "buffer": json.dumps(payload).encode()}])
        page.wait_for_function(
            "(f) => { const n = document.querySelector('#gd-io-notice');"
            " return n.classList.contains('is-error') && n.textContent.includes(f); }",
            arg=fragment, timeout=4000)
        assert page.locator("#gd-people-table tbody tr").count() == 12


def test_gd_import_declined_keeps_current_setup(page):
    """Spec 7: import replaces the setup only after confirmation."""
    page.on("dialog", lambda d: d.dismiss())
    page.click("#tab-group-draw")
    page.evaluate("() => document.querySelector('#gd-load-example').click()")  # empty -> no confirm
    assert page.locator("#gd-people-table tbody tr").count() == 30
    page.set_input_files("#gd-import-file", files=[{
        "name": "s.json", "mimeType": "application/json",
        "buffer": json.dumps(_gd_setup(n=5, groups=2)).encode()}])
    page.wait_for_timeout(300)  # no DOM change to wait on when the confirm is dismissed
    assert page.locator("#gd-people-table tbody tr").count() == 30


def test_gd_export_roundtrip_preserves_rules_scopes_and_options(page):
    """Export -> reset -> import keeps every rule type, group scope, and option exactly."""
    _gd_open(page)
    setup = _gd_setup(n=24, groups=4, best_effort=True, rules=[
        {"id": "r1", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager", "min": 1, "max": 2},
        {"id": "r2", "type": "count", "scope": 2, "attrId": "a-type", "value": "manager", "min": 0, "max": 0},
        {"id": "r3", "type": "sum", "scope": "all", "attrId": "a-team", "min": 5, "max": 40},
        {"id": "r4", "type": "apart", "scope": "all", "attrId": "a-type", "k": 3},
        {"id": "r5", "type": "together", "scope": "all", "attrId": "a-team", "values": [1]},
        {"id": "r6", "type": "size", "scope": "all", "min": 3, "max": 9},
    ])
    setup["groups"]["names"] = ["Red", "Blue", "Green", "Gold"]
    setup["options"]["balance"] = False
    _gd_import(page, setup)
    with page.expect_download() as dl:
        page.click("#gd-export")
    exported = json.loads(Path(dl.value.path()).read_text())
    assert exported["rules"] == setup["rules"]
    assert exported["groups"]["names"] == ["Red", "Blue", "Green", "Gold"]
    assert exported["options"] == {"balance": False, "bestEffort": True}
    page.click("#gd-reset")
    _gd_import(page, exported)
    with page.expect_download() as dl2:
        page.click("#gd-export")
    assert json.loads(Path(dl2.value.path()).read_text()) == exported


def test_gd_setup_autosaved_and_restored_after_reload(page):
    """Spec 7: the setup is autosaved to localStorage and restored on reload; Clear saved data wipes it."""
    _gd_open(page)
    _gd_import(page, _gd_setup(n=8, groups=2))
    page.wait_for_function("() => localStorage.getItem('groupDraw.setup.v1') !== null", timeout=4000)
    page.reload()
    page.click("#tab-group-draw")
    assert page.locator("#gd-people-table tbody tr").count() == 8
    page.click("#gd-clear-saved")
    assert page.evaluate("() => localStorage.getItem('groupDraw.setup.v1')") is None


def test_gd_corrupt_saved_data_is_ignored(page):
    """Corrupt localStorage never breaks the view (and never logs a console error)."""
    page.evaluate("() => localStorage.setItem('groupDraw.setup.v1', '{broken')")
    page.reload()
    page.click("#tab-group-draw")
    assert page.locator("#gd-people-table tbody tr").count() == 0
    page.evaluate("() => localStorage.removeItem('groupDraw.setup.v1')")


def test_gd_keyboard_can_trigger_draw(page):
    """The Draw button is a real focusable button operable with the keyboard."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3))
    page.focus("#gd-draw")
    page.keyboard.press("Enter")
    page.wait_for_selector("#gd-results .gd-card")
    assert page.locator("#gd-results .gd-card").count() == 3


def test_gd_csv_escapes_formula_and_commas(page):
    """CSV cells that start with a formula character are neutralised and commas are quoted."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    people = [{"id": "p0", "name": "=SUM(A1)", "values": {}}, {"id": "p1", "name": "Doe, Jane", "values": {}}]
    setup = _gd_setup(people=people, groups=2)
    setup["attributes"] = []
    _gd_import(page, setup)
    _gd_draw(page)
    with page.expect_download() as dl:
        page.click("#gd-csv")
    text = Path(dl.value.path()).read_text()
    assert "'=SUM(A1)" in text
    assert '"Doe, Jane"' in text


# --- Group Draw: label attributes in count rules (spec §4.1, §4.3) -------------

def _gd_sur(surnames):
    return [{"id": f"p{i}", "name": f"P{i}", "values": {"a-sur": s}} for i, s in enumerate(surnames)]


SMITH_MAX1 = {"id": "rs", "type": "count", "scope": "all", "attrId": "a-sur", "value": "Smith", "min": None, "max": 1}


def test_gd_label_count_rule_honoured_by_solver(page):
    """A max-1 count rule on a label value is never violated over many draws, and draws still vary."""
    people = _gd_sur(["Smith", "Smith", "Smith", "Jones", "Jones", None, "Lee", "", "Kim", "Ng", "Oh", "Wu"])
    setup = _gd_setup(people=people, groups=3, rules=[SMITH_MAX1])
    seen = set()
    for _ in range(30):
        res = _gd_run(page, setup)
        assert res["status"] == "ok"
        assert _gd_check(setup, res["groups"]) == []
        seen.add(tuple(sorted(tuple(sorted(g)) for g in res["groups"])))
    assert len(seen) >= 2


def test_gd_label_count_rule_infeasible_is_hinted_and_blamed(page):
    """3 Smiths, 2 groups, max 1 Smith each: live hint names the rule, strict draw fails and blames it."""
    setup = _gd_setup(people=_gd_sur(["Smith", "Smith", "Smith", "Jones"]), groups=2, rules=[SMITH_MAX1])
    hints = page.evaluate("s => GroupDrawSolver.validateHints(s)", setup)
    assert any(h["level"] == "error" and "surname = Smith" in h["message"] and "rs" in h["ruleIds"] for h in hints)
    res = _gd_run(page, setup)
    assert res["status"] == "infeasible"
    assert "rs" in {b["ruleId"] for b in res.get("blame", [])} or res.get("reasons")


def test_gd_label_count_rule_exact_text_and_empty_ignored(page):
    """Labels match exact text ("smith" is not "Smith"); empty labels never count; an empty rule value is ignored."""
    two_each = _gd_sur(["Smith", "Smith", "smith", "smith", None, ""])
    need_two = dict(SMITH_MAX1, min=2, max=None)
    hints = page.evaluate("s => GroupDrawSolver.validateHints(s)", _gd_setup(people=two_each, groups=2, rules=[need_two]))
    assert any("only 2 people have it" in h["message"] for h in hints)  # 4 if case-folded
    # Nobody with "Smith" -> rule is a no-op warning, empties never match.
    nobody = _gd_setup(people=_gd_sur([None, "", "Jones", "Lee"]), groups=2, rules=[dict(SMITH_MAX1, max=0)])
    hints = page.evaluate("s => GroupDrawSolver.validateHints(s)", nobody)
    assert [h["level"] for h in hints] == ["warning"] and "Nobody has" in hints[0]["message"]
    assert _gd_run(page, nobody)["status"] == "ok"
    # A rule whose value is empty is not usable and is ignored by the solver.
    empty_rule = _gd_setup(people=_gd_sur(["Smith", "Smith"]), groups=2, rules=[dict(SMITH_MAX1, value="", max=0)])
    assert _gd_run(page, empty_rule)["status"] == "ok"
    assert page.evaluate("s => GroupDrawSolver.validateHints(s)", empty_rule) == []


def test_gd_label_count_rule_in_ui(page):
    """Labels are count-rule targets with a dropdown of distinct values that follows the table; never offered for sums."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(people=[], groups=2))
    page.select_option("#gd-rule-type", "count")
    page.select_option("#gd-rule-attr", "a-sur")
    assert page.is_disabled("#gd-rule-add")
    assert "add people first" in page.text_content("#gd-rule-help")
    for name, sur in [("Ann", "Smith"), ("Bob", "Jones"), ("Cy", "Smith"), ("Di", ""), ("Ed", "Lee"), ("Flo", "Kim")]:
        page.click("#gd-add-person")
        row = page.locator("#gd-people-table tbody tr").last
        row.locator("input[data-field='name']").fill(name)
        row.locator("input[data-field='a-sur']").fill(sur)
    opts = page.eval_on_selector_all("#gd-rule-value option", "os => os.map(o => o.value)")
    assert opts == ["Jones", "Kim", "Lee", "Smith"]
    assert page.is_enabled("#gd-rule-add")
    _gd_add_rule(page, "count", "a-sur", "Smith", vmax=1)
    assert page.text_content(".gd-rule .gd-rule-target") == "surname = Smith"
    # The dropdown follows the table without losing the current selection.
    page.select_option("#gd-rule-value", "Lee")
    page.click("#gd-add-person")
    row = page.locator("#gd-people-table tbody tr").last
    row.locator("input[data-field='name']").fill("Gus")
    row.locator("input[data-field='a-sur']").fill("Abe")
    assert page.eval_on_selector_all("#gd-rule-value option", "os => os.map(o => o.value)")[0] == "Abe"
    assert page.input_value("#gd-rule-value") == "Lee"
    # Draw honours the rule.
    smiths = page.evaluate("() => Array.from(document.querySelectorAll('#gd-people-table tbody tr'))"
                           ".filter(tr => tr.querySelector(\"[data-field='a-sur']\").value === 'Smith')"
                           ".map(tr => tr.dataset.personId)")
    assert len(smiths) == 2
    for _ in range(5):
        groups = _gd_draw(page)
        assert len(groups) == 2 and sum(len(g) for g in groups) == 7
        assert all(sum(1 for pid in g if pid in smiths) <= 1 for g in groups)
    # Labels are offered for keep apart / keep together / spread evenly, but never for sums.
    for rtype, offered in (("sum", False), ("apart", True), ("together", True), ("even", True)):
        page.select_option("#gd-rule-type", rtype)
        attrs = page.eval_on_selector_all("#gd-rule-attr option", "os => os.map(o => o.value)")
        assert ("a-sur" in attrs) == offered


def test_gd_label_count_rule_survives_export_import_and_autosave(page):
    """A label count rule round-trips through export/import and autosave; a sum rule on a label is rejected."""
    _gd_open(page)
    setup = _gd_setup(people=_gd_sur(["Smith", "Jones", "Smith", "Lee"]), groups=2, rules=[SMITH_MAX1])
    _gd_import(page, setup)
    assert page.text_content(".gd-rule .gd-rule-target") == "surname = Smith"
    with page.expect_download() as dl:
        page.click("#gd-export")
    exported = json.loads(Path(dl.value.path()).read_text())
    assert exported["rules"] == [SMITH_MAX1]
    page.wait_for_function(
        "() => (JSON.parse(localStorage.getItem('groupDraw.setup.v1') || '{}').rules || []).length === 1", timeout=4000)
    page.reload()
    page.click("#tab-group-draw")
    assert page.locator(".gd-rule[data-type='count']").count() == 1
    assert page.text_content(".gd-rule .gd-rule-target") == "surname = Smith"
    # A sum over a label makes no sense: the import is refused and the setup kept.
    bad = dict(setup, rules=[{"id": "ra", "type": "sum", "scope": "all", "attrId": "a-sur", "min": 1, "max": 2}])
    page.set_input_files("#gd-import-file", files=[{
        "name": "bad.json", "mimeType": "application/json", "buffer": json.dumps(bad).encode()}])
    page.wait_for_function(
        "() => document.querySelector('#gd-io-notice').classList.contains('is-error')", timeout=4000)
    assert page.locator(".gd-rule[data-type='count']").count() == 1
    # Blank label value in an imported count rule is refused too.
    blank = dict(setup, rules=[dict(SMITH_MAX1, value="  ")])
    page.evaluate("() => { document.querySelector('#gd-io-notice').classList.remove('is-error'); }")
    page.set_input_files("#gd-import-file", files=[{
        "name": "blank.json", "mimeType": "application/json", "buffer": json.dumps(blank).encode()}])
    page.wait_for_function(
        "() => document.querySelector('#gd-io-notice').classList.contains('is-error')", timeout=4000)
    assert page.locator(".gd-rule[data-type='count']").count() == 1


def test_gd_rule_scope_multi_select_in_form_and_list(page):
    """A rule can apply to several groups (1,2,3 of 6); the list shows and edits them; all ticked = All."""
    _gd_open(page)
    _gd_import(page, _gd_setup(n=30, groups=6))
    _gd_add_rule(page, "size", vmin=4, vmax=6, scope=[0, 1, 2])
    summary = page.locator(".gd-rule .gd-scope-summary")
    assert summary.text_content().strip() == "Group 1, Group 2, Group 3"
    # Tick group 4 in the list: still a subset, and the picker stays open.
    summary.click()
    page.locator(".gd-rule .gd-scope input[data-group='3']").check()
    assert summary.text_content().strip() == "Group 1, Group 2, Group 3, Group 4"
    page.wait_for_function(
        "() => { const s = localStorage.getItem('groupDraw.setup.v1'); "
        "return s && JSON.stringify(JSON.parse(s).rules[0].scope) === '[0,1,2,3]'; }", timeout=4000)
    # Ticking everything collapses to All groups; the last group can't be unticked to nothing.
    page.locator(".gd-rule .gd-scope input[data-group='4']").check()
    page.locator(".gd-rule .gd-scope input[data-group='5']").check()
    assert summary.text_content().strip() == "All groups (each)"
    assert page.locator(".gd-rule .gd-scope-all").is_checked()


def test_gd_multi_group_scope_applies_to_each_listed_group(page):
    """Solver: a rule scoped to groups [0,1] constrains those two and leaves the rest free."""
    people = [{"id": f"p{i}", "name": f"P{i}", "values": {"a-type": "manager" if i < 4 else "developer"}} for i in range(12)]
    setup = _gd_setup(people=people, groups=4, rules=[
        {"id": "m", "type": "count", "scope": [0, 1], "attrId": "a-type", "value": "manager", "min": 2, "max": 2}])
    for _ in range(5):
        res = _gd_run(page, setup)
        assert res["status"] == "ok"
        assert _gd_check(setup, res["groups"]) == []
        for g in (0, 1):
            assert sum(1 for i in res["groups"][g] if i in {"p0", "p1", "p2", "p3"}) == 2
    # Invalid scopes are ignored by the solver (out of range / empty).
    bad = _gd_setup(people=people, groups=4, rules=[
        {"id": "m", "type": "count", "scope": [0, 9], "attrId": "a-type", "value": "manager", "min": 5, "max": None}])
    assert _gd_run(page, bad)["status"] == "ok"


def test_gd_multi_group_scope_survives_export_import_and_group_shrink(page):
    """Array scopes round-trip through import; shrinking the group count trims or drops them."""
    _gd_open(page)
    setup = _gd_setup(n=30, groups=6, rules=[
        {"id": "a", "type": "size", "scope": [1, 2, 5], "min": 3, "max": 6},
        {"id": "b", "type": "size", "scope": [4, 5], "min": 3, "max": 6}])
    _gd_import(page, setup)
    assert [t.strip() for t in page.locator(".gd-scope-summary").all_text_contents() if "Group 2" in t] \
        == ["Group 2, Group 3, Group 6"]
    page.fill("#gd-group-count", "4")
    page.press("#gd-group-count", "Tab")
    texts = [t.strip() for t in page.locator(".gd-rule .gd-scope-summary").all_text_contents()]
    assert texts == ["Group 2, Group 3"]  # rule b only covered removed groups


def _gd_card_ids(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#gd-results .gd-card'))"
        ".map(c => Array.from(c.querySelectorAll('.gd-member')).map(m => m.dataset.personId))")


def test_gd_partial_redraw_keeps_ticked_groups_and_redraws_the_rest(page):
    """Partial redraw: kept groups are untouched, everyone else is redrawn among the other groups, rules still hold."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    setup = _gd_setup(n=30, groups=5, rules=GD_RULES)
    _gd_import(page, setup)
    assert page.is_disabled("#gd-partial")  # nothing drawn yet
    first = _gd_draw(page)
    assert page.is_enabled("#gd-partial")
    page.check("#gd-partial")
    page.check("#gd-results .gd-card[data-group='1'] .gd-keep input")
    page.check("#gd-results .gd-card[data-group='3'] .gd-keep input")
    again = _gd_draw(page)
    assert sorted(again[1]) == sorted(first[1]) and sorted(again[3]) == sorted(first[3])
    assert sorted(sum(again, [])) == sorted(sum(first, []))
    assert sorted(sum((again[g] for g in (0, 2, 4)), [])) == sorted(sum((first[g] for g in (0, 2, 4)), []))
    assert _gd_check(setup, again) == []
    assert "Redrew 3 groups, kept 2" in page.text_content("#gd-status")
    # Over many draws the unticked groups actually change.
    changed = False
    for _ in range(6):
        nxt = _gd_draw(page)
        assert sorted(nxt[1]) == sorted(first[1]) and sorted(nxt[3]) == sorted(first[3])
        changed = changed or any(sorted(nxt[g]) != sorted(first[g]) for g in (0, 2, 4))
    assert changed


def test_gd_partial_redraw_guards(page):
    """All groups kept blocks the draw; unticking Partial redraw does a full draw; editing the setup disables it."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3))
    _gd_draw(page)
    page.check("#gd-partial")
    for g in range(3):
        page.check(f"#gd-results .gd-card[data-group='{g}'] .gd-keep input")
    assert page.is_disabled("#gd-draw")
    assert "untick" in page.text_content("#gd-partial-hint").lower()
    page.uncheck("#gd-results .gd-card[data-group='0'] .gd-keep input")
    assert page.is_enabled("#gd-draw")
    page.uncheck("#gd-partial")
    assert page.is_enabled("#gd-draw")
    # Changing the setup makes the shown draw stale: partial redraw is no longer offered.
    page.fill("#gd-group-count", "4")
    page.press("#gd-group-count", "Tab")
    assert page.is_disabled("#gd-partial") and not page.is_checked("#gd-partial")


def test_gd_group_word_used_in_results_copy_csv_and_rules(page):
    """A custom group word ('Pokój') replaces 'Group' in results, copied text, CSV, scope picker; it persists via export/import."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3))
    page.fill("#gd-group-word", "Pokój")
    assert page.get_attribute("#gd-group-names input", "placeholder") == "Pokój 1"
    _gd_draw(page)
    names = page.eval_on_selector_all("#gd-results .gd-card-name", "els => els.map(e => e.textContent)")
    assert names == ["Pokój 1", "Pokój 2", "Pokój 3"]
    page.evaluate("() => { navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; }")
    page.click("#gd-copy")
    assert page.evaluate("() => window.__copied").startswith("Pokój 1 (4): ")
    with page.expect_download() as dl:
        page.click("#gd-csv")
    assert Path(dl.value.path()).read_text().splitlines()[1].startswith("Pokój 1,")
    _gd_add_rule(page, "size", vmin=2, scope=[0, 1])
    assert page.locator(".gd-rule .gd-scope-summary").text_content().strip() == "Pokój 1, Pokój 2"
    assert page.evaluate("() => GroupDrawSolver.describeRule({type:'size',scope:[0,1],min:2}, {groups:{count:3,label:'Pokój',names:[]}})") \
        == "Group size at least 2 (Pokój 1, Pokój 2)"


# ---- Theme toggle ----

def _theme(page):
    return page.get_attribute("html", "data-theme")


def test_theme_toggle_is_top_right_and_flips_theme(page):
    page.set_viewport_size({"width": 1280, "height": 800})
    box = page.locator("#theme-toggle").bounding_box()
    assert box["x"] + box["width"] > 1280 - 100 and box["y"] < 100
    before = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
    start = _theme(page)
    page.click("#theme-toggle")
    assert _theme(page) != start
    assert page.get_attribute("#theme-toggle", "aria-pressed") == str(_theme(page) == "dark").lower()
    # body colour transitions, so wait for it to settle on the new theme
    page.wait_for_function(
        "b => getComputedStyle(document.body).backgroundColor !== b", arg=before, timeout=2000
    )
    page.click("#theme-toggle")
    assert _theme(page) == start


def test_theme_choice_persists_across_reload(page):
    start = _theme(page)
    page.click("#theme-toggle")
    chosen = _theme(page)
    page.reload()
    assert _theme(page) == chosen != start


def test_theme_defaults_to_system_preference(server):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for scheme in ("dark", "light"):
            pg = browser.new_page(color_scheme=scheme)
            pg.goto(server)
            assert _theme(pg) == scheme
            pg.close()
        browser.close()


def test_theme_toggle_does_not_disturb_tools(page):
    page.fill("#max", "20")
    page.click("#theme-toggle")
    assert page.input_value("#max") == "20"


# --- Group Draw: compound count rules (attr = value AND attr = value) ---------

def _gd_compound_people(n=54):
    """Team 1-3 (integer) x type (category); 'department' is stored in the label attribute a-sur."""
    types = ["consultant", "developer", "manager"]
    return [{"id": f"p{i}", "name": f"P{i}",
             "values": {"a-team": (i % 3) + 1, "a-type": types[(i // 3) % 3], "a-sur": f"dep{i % 2}"}}
            for i in range(n)]


def test_gd_compound_count_rules_honoured_by_solver(page):
    """Two overlapping compound rules (the 'team=1 and manager' / 'dep0 and manager' pattern) hold in every group."""
    setup = _gd_setup(people=_gd_compound_people(), groups=3, rules=[
        {"id": "c1", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager",
         "and": [{"attrId": "a-team", "value": 1}], "min": 1, "max": 2},
        {"id": "c2", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager",
         "and": [{"attrId": "a-sur", "value": "dep0"}], "min": 1, "max": 3},
    ])
    for _ in range(8):
        res = _gd_run(page, setup)
        assert res["status"] == "ok"
        assert _gd_check(setup, res["groups"]) == []


def test_gd_compound_count_rule_hint_and_infeasible(page):
    """Only 2 people match both conditions, so min 1 in each of 3 groups is hinted with the combined label."""
    people = _gd_compound_people()
    for p in people:
        p["values"]["a-type"] = "developer"
    people[0]["values"]["a-type"] = "manager"; people[0]["values"]["a-team"] = 1
    people[1]["values"]["a-type"] = "manager"; people[1]["values"]["a-team"] = 1
    for p in people[2:]:
        if p["values"]["a-team"] == 1:
            p["values"]["a-team"] = 2
    setup = _gd_setup(people=people, groups=3, rules=[
        {"id": "c1", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager",
         "and": [{"attrId": "a-team", "value": 1}], "min": 1, "max": None}])
    hints = page.evaluate("s => GroupDrawSolver.validateHints(s)", setup)
    assert any(h["level"] == "error" and "type = manager and team = 1" in h["message"] and "c1" in h["ruleIds"] for h in hints)
    assert _gd_run(page, setup)["status"] == "infeasible"


def test_gd_compound_rule_with_contradicting_conditions_is_ignored(page):
    """Two values of one attribute can never both hold; the solver skips the rule instead of failing."""
    setup = _gd_setup(people=_gd_compound_people(), groups=3, rules=[
        {"id": "c1", "type": "count", "scope": "all", "attrId": "a-team", "value": 1,
         "and": [{"attrId": "a-team", "value": 2}], "min": 5, "max": None}])
    assert _gd_run(page, setup)["status"] == "ok"


def test_gd_compound_count_rule_in_ui(page):
    """Build 'type = manager and team = 1' in the form, draw, then removing the used option drops the rule."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(people=_gd_compound_people(), groups=3))
    page.select_option("#gd-rule-type", "count")
    page.select_option("#gd-rule-attr", "a-type")
    page.select_option("#gd-rule-value", "manager")
    page.click("#gd-rule-and-add")
    assert page.locator(".gd-and-row").count() == 1
    page.select_option(".gd-and-attr", "a-team")
    page.fill(".gd-and-num", "1")
    page.fill("#gd-rule-min", "1")
    page.fill("#gd-rule-max", "2")
    page.click("#gd-rule-add")
    assert page.eval_on_selector_all(".gd-rule .gd-cond-text", "els => els.map(e => e.textContent)") == ["type = manager", "team = 1"]
    assert page.eval_on_selector_all(".gd-rule .gd-cond-and", "els => els.map(e => e.textContent)") == ["and"]
    assert page.locator(".gd-and-row").count() == 0  # form reset
    for _ in range(3):
        groups = _gd_draw(page)
        assert len(groups) == 3
    # A clashing attribute is impossible: changing the main attribute moves the row on.
    page.select_option("#gd-rule-attr", "a-type")
    page.click("#gd-rule-and-add")
    first = page.input_value(".gd-and-attr")
    assert first != "a-type"
    page.select_option("#gd-rule-attr", first)
    assert page.input_value(".gd-and-attr") != first
    assert page.eval_on_selector(".gd-and-attr option[value='%s']" % page.input_value("#gd-rule-attr"), "o => o.disabled")
    page.click(".gd-and-del")
    assert page.locator(".gd-rule").count() == 1
    # Round-trips through autosave and drops when its option is removed.
    page.reload()
    _gd_open(page)
    assert page.get_attribute(".gd-rule .gd-rule-target", "title") == "type = manager and team = 1"
    page.locator(".gd-attr-row").nth(2).locator(".gd-chip", has_text="manager").locator("button").click()
    assert page.locator(".gd-rule").count() == 0


# ---- Group Draw: attendance, spread evenly, person rules, nice-to-have, rounds, adjust, presenter ----


def _gd_run_opts(page, setup, opts):
    return page.evaluate("([s, o]) => GroupDrawSolver.run(s, o)", [setup, opts])


def _gd_where(groups):
    return {pid: gi for gi, ids in enumerate(groups) for pid in ids}


def test_gd_absent_people_skip_the_draw(page):
    """Attendance: unticking "Here" keeps the person in the list but out of the draw, hints and counts."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    setup = _gd_setup(n=10, groups=2)
    _gd_import(page, setup)
    assert page.is_hidden("#gd-people-present")
    for pid in ("p0", "p3"):
        page.uncheck(f"#gd-people-table tr[data-person-id='{pid}'] .gd-here")
    assert page.text_content("#gd-people-count").startswith("8 people · 2 away")
    assert "8 people" in page.text_content("#gd-meta-people")
    assert page.locator("#gd-people-table tr.is-absent").count() == 2
    groups = _gd_draw(page)
    ids = sorted(sum(groups, []))
    assert ids == sorted(f"p{i}" for i in range(10) if i not in (0, 3))
    assert sorted(len(g) for g in groups) == [4, 4]
    # Absence is part of the setup: exported, autosaved and restored.
    with page.expect_download() as dl:
        page.click("#gd-export")
    exported = json.loads(Path(dl.value.path()).read_text())
    assert [p["id"] for p in exported["people"] if p.get("absent")] == ["p0", "p3"]
    assert len(exported["people"]) == 10
    page.wait_for_function(
        "() => (JSON.parse(localStorage.getItem('groupDraw.setup.v1') || '{}').people || []).filter(p => p.absent).length === 2",
        timeout=4000)
    page.reload()
    page.click("#tab-group-draw")
    assert page.locator("#gd-people-table tr.is-absent").count() == 2
    # One click brings everyone back.
    page.click("#gd-people-present")
    assert page.text_content("#gd-people-count").startswith("10 people")
    assert page.is_hidden("#gd-people-present")
    assert len(sum(_gd_draw(page), [])) == 10


def test_gd_everyone_absent_explains_itself(page):
    """With every person away the draw gives guidance instead of an empty result."""
    _gd_open(page)
    people = [dict(p, absent=True) for p in _gd_people(4)]
    _gd_import(page, _gd_setup(people=people, groups=2))
    page.click("#gd-draw")
    page.wait_for_function("() => document.querySelector('#gd-status').textContent.includes('away')", timeout=4000)
    assert page.locator("#gd-results .gd-card").count() == 0
    res = _gd_run(page, _gd_setup(people=people, groups=2))
    assert res["status"] == "empty"


def test_gd_spread_evenly_by_value(page):
    """"Spread evenly" gives every group floor/ceil of each value's share — without the user doing the arithmetic."""
    setup = _gd_setup(n=30, groups=4, rules=[{"id": "e", "type": "even", "attrId": "a-type"}])
    people = {p["id"]: p for p in setup["people"]}
    totals = {}
    for p in setup["people"]:
        totals[p["values"]["a-type"]] = totals.get(p["values"]["a-type"], 0) + 1
    for _ in range(25):
        res = _gd_run(page, setup)
        assert res["status"] == "ok" and res["violations"] == [] and res["notes"] == []
        for g in res["groups"]:
            for value, total in totals.items():
                c = sum(1 for pid in g if people[pid]["values"]["a-type"] == value)
                assert total // 4 <= c <= -(-total // 4), (value, c)
    # The limits follow the people: with 3 managers away the share shrinks, still feasible.
    away = [p["id"] for p in setup["people"] if p["values"]["a-type"] == "manager"][:3]
    setup2 = dict(setup, people=[dict(p, absent=True) if p["id"] in away else p for p in setup["people"]])
    res = _gd_run(page, setup2)
    assert res["status"] == "ok" and len(sum(res["groups"], [])) == 27


def test_gd_spread_evenly_by_total_is_nice_to_have(page):
    """Balancing a total never blocks a draw and brings the group sums close together."""
    skills = [1, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 8, 8, 9, 10, 12]
    setup = _gd_setup(people=_gd_ppl(skills), groups=4,
                      rules=[{"id": "es", "type": "even", "attrId": "a-team", "by": "sum"}])
    by_id = {p["id"]: p["values"]["a-team"] for p in setup["people"]}
    spreads = []
    for _ in range(15):
        res = _gd_run(page, setup)
        assert res["status"] == "ok" and res["violations"] == []
        assert sorted(len(g) for g in res["groups"]) == [4, 4, 4, 4]
        sums = [sum(by_id[i] for i in g) for g in res["groups"]]
        spreads.append(max(sums) - min(sums))
    plain = []
    for _ in range(15):
        res = _gd_run(page, dict(setup, rules=[]))
        sums = [sum(by_id[i] for i in g) for g in res["groups"]]
        plain.append(max(sums) - min(sums))
    assert max(spreads) <= 4, spreads
    assert sum(spreads) / len(spreads) < sum(plain) / len(plain)
    # A total can only be balanced for numbers; cleanly ignored otherwise.
    bad = _gd_setup(n=8, groups=2, rules=[{"id": "es", "type": "even", "attrId": "a-type", "by": "sum"}])
    assert _gd_run(page, bad)["status"] == "ok"


def test_gd_label_keep_apart_and_together(page):
    """Keep apart / keep together now work on label attributes (exact text, empty ignored)."""
    people = _gd_sur(["Smith", "Smith", "Smith", "Jones", "Jones", None, "Lee", "", "Kim", "Ng", "Oh", "Wu"])
    apart = _gd_setup(people=people, groups=3, rules=[{"id": "a", "type": "apart", "scope": "all", "attrId": "a-sur", "k": 1}])
    together = _gd_setup(people=people, groups=3,
                         rules=[{"id": "t", "type": "together", "scope": "all", "attrId": "a-sur", "values": ["Smith"]}])
    for _ in range(20):
        res = _gd_run(page, apart)
        assert res["status"] == "ok" and _gd_check(apart, res["groups"]) == []
        for g in res["groups"]:
            assert sum(1 for i in g if i in ("p0", "p1", "p2")) == 1
            assert sum(1 for i in g if i in ("p3", "p4")) <= 1
        res = _gd_run(page, together)
        assert res["status"] == "ok" and _gd_check(together, res["groups"]) == []
        w = _gd_where(res["groups"])
        assert w["p0"] == w["p1"] == w["p2"]
    # Four Smiths cannot be kept apart in three groups: hinted before drawing.
    four = dict(apart, people=_gd_sur(["Smith"] * 4 + ["Lee", "Kim"]))
    hints = page.evaluate("s => GroupDrawSolver.validateHints(s)", four)
    assert any(h["level"] == "error" and "surname = Smith" in h["message"] for h in hints)
    assert _gd_run(page, four)["status"] == "infeasible"


PIN = {"id": "pin", "type": "pin", "personId": "p0", "group": 2}
WITH = {"id": "with", "type": "pair", "mode": "together", "people": ["p1", "p2"]}
WITHOUT = {"id": "without", "type": "pair", "mode": "apart", "people": ["p3", "p4"]}


def test_gd_person_rules_honoured_by_solver(page):
    """Pin, "A with B" and "A not with B" hold on every draw and combine with attribute rules."""
    setup = _gd_setup(n=24, groups=4, rules=[PIN, WITH, WITHOUT] + GD_RULES[:1])
    seen = set()
    for _ in range(30):
        res = _gd_run(page, setup)
        assert res["status"] == "ok", res
        assert _gd_check(setup, res["groups"]) == []
        w = _gd_where(res["groups"])
        assert w["p0"] == 2 and w["p1"] == w["p2"] and w["p3"] != w["p4"]
        seen.add(tuple(sorted(tuple(sorted(g)) for g in res["groups"])))
    assert len(seen) >= 2
    # Rules about people who are away (or gone) are simply skipped.
    away = dict(setup, people=[dict(p, absent=True) if p["id"] in ("p0", "p3") else p for p in setup["people"]])
    res = _gd_run(page, away)
    assert res["status"] == "ok" and len(sum(res["groups"], [])) == 22


def test_gd_person_rule_conflicts_are_explained(page):
    """Contradicting person rules give a live hint and a blamed strict failure."""
    both = _gd_setup(n=8, groups=2, rules=[
        {"id": "t", "type": "pair", "mode": "together", "people": ["p1", "p2"]},
        {"id": "a", "type": "pair", "mode": "apart", "people": ["p1", "p2"]}])
    hints = page.evaluate("s => GroupDrawSolver.validateHints(s)", both)
    assert any(h["level"] == "error" and "both together and apart" in h["message"] for h in hints)
    res = _gd_run(page, both)
    assert res["status"] == "infeasible" and len(res["blame"]) == 2
    twice = _gd_setup(n=8, groups=2, rules=[PIN | {"group": 0}, PIN | {"id": "pin2", "group": 1}])
    hints = page.evaluate("s => GroupDrawSolver.validateHints(s)", twice)
    assert any("pinned to more than one group" in h["message"] for h in hints)
    # Two pinned people who must also stay together, in different groups: no hint, but still explained.
    clash = _gd_setup(n=8, groups=2, rules=[
        PIN | {"group": 0}, {"id": "pin2", "type": "pin", "personId": "p1", "group": 1},
        {"id": "t", "type": "pair", "mode": "together", "people": ["p0", "p1"]}])
    res = _gd_run(page, clash)
    assert res["status"] == "infeasible" and res["blame"]


def test_gd_person_rules_in_ui(page):
    """Pin and pair rules are created from the form, drawn, pruned with their people, and round-trip."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    setup = _gd_setup(n=12, groups=3)
    _gd_import(page, setup)
    page.select_option("#gd-rule-type", "pin")
    page.select_option("#gd-rule-person", "p5")
    page.select_option("#gd-rule-group", "1")
    page.click("#gd-rule-add")
    assert page.text_content(".gd-rule[data-type='pin'] .gd-rule-target") == "Person 5 → Group 2"
    # One pin per person.
    page.click("#gd-rule-add")
    assert "already pinned" in page.text_content("#gd-rule-error")
    page.select_option("#gd-rule-type", "pair")
    page.select_option("#gd-rule-person", "p0")
    page.select_option("#gd-rule-person2", "p0")
    page.click("#gd-rule-add")
    assert "two different people" in page.text_content("#gd-rule-error")
    page.select_option("#gd-rule-person2", "p1")
    assert page.is_disabled("#gd-rule-soft")  # "together" is always a must
    page.click("#gd-rule-add")
    page.select_option("#gd-rule-mode", "apart")
    page.select_option("#gd-rule-person", "p2")
    page.select_option("#gd-rule-person2", "p3")
    assert page.is_enabled("#gd-rule-soft")
    page.click("#gd-rule-add")
    targets = page.eval_on_selector_all(".gd-rule[data-type='pair'] .gd-rule-target", "els => els.map(e => e.textContent)")
    assert targets == ["Person 0 with Person 1", "Person 2 not with Person 3"]
    for _ in range(5):
        w = _gd_where(_gd_draw(page))
        assert w["p5"] == 1 and w["p0"] == w["p1"] and w["p2"] != w["p3"]
    # Partial redraw keeps honouring them.
    page.check("#gd-partial")
    page.check("#gd-results .gd-card[data-group='0'] .gd-keep input")
    w = _gd_where(_gd_draw(page))
    assert w["p5"] == 1 and w["p0"] == w["p1"] and w["p2"] != w["p3"]
    # Renaming a person renames the rule; export keeps the rules.
    page.fill("#gd-people-table tr[data-person-id='p5'] input[data-field='name']", "Zed")
    assert page.text_content(".gd-rule[data-type='pin'] .gd-rule-target") == "Zed → Group 2"
    with page.expect_download() as dl:
        page.click("#gd-export")
    exported = json.loads(Path(dl.value.path()).read_text())
    assert [(r["type"], r.get("mode")) for r in exported["rules"]] == [("pin", None), ("pair", "together"), ("pair", "apart")]
    assert exported["rules"][0]["personId"] == "p5" and exported["rules"][0]["group"] == 1
    # Deleting the people removes their rules, with a notice.
    page.click("#gd-people-table tr[data-person-id='p5'] .gd-person-delete")
    assert page.locator(".gd-rule[data-type='pin']").count() == 0
    assert "no longer in the list" in page.text_content("#gd-rules-notice")
    page.click("#gd-people-table tr[data-person-id='p0'] .gd-person-delete")
    assert page.locator(".gd-rule[data-type='pair']").count() == 1
    # Shrinking the groups drops pins that point at a removed group.
    _gd_import(page, dict(setup, rules=[PIN]))
    assert page.locator(".gd-rule[data-type='pin']").count() == 1
    page.fill("#gd-group-count", "2")
    page.dispatch_event("#gd-group-count", "change")
    assert page.locator(".gd-rule[data-type='pin']").count() == 0
    # An imported rule about an unknown person is refused.
    page.evaluate("() => { document.querySelector('#gd-io-notice').classList.remove('is-error'); }")
    page.set_input_files("#gd-import-file", files=[{
        "name": "bad.json", "mimeType": "application/json",
        "buffer": json.dumps(dict(setup, rules=[PIN | {"personId": "nobody"}])).encode()}])
    page.wait_for_function(
        "() => document.querySelector('#gd-io-notice').classList.contains('is-error')", timeout=4000)


MANAGERS_MIN3 = {"id": "m3", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager", "min": 3, "max": None}


def test_gd_nice_to_have_rule_never_blocks_a_draw(page):
    """A must rule that cannot be met fails the draw; the same rule as nice-to-have is met as closely as possible."""
    hard = _gd_setup(n=20, groups=4, rules=[MANAGERS_MIN3])  # only 5 managers for 4 × 3
    assert _gd_run(page, hard)["status"] == "infeasible"
    soft = _gd_setup(n=20, groups=4, rules=[MANAGERS_MIN3 | {"soft": True}])
    hints = page.evaluate("s => GroupDrawSolver.validateHints(s)", soft)
    assert hints and all(h["level"] == "warning" for h in hints)
    people = {p["id"]: p for p in soft["people"]}
    for _ in range(10):
        res = _gd_run(page, soft)
        assert res["status"] == "ok" and res["violations"] == []
        assert res["notes"] and all(n["soft"] for n in res["notes"])
        assert sorted(len(g) for g in res["groups"]) == [5, 5, 5, 5]
        short = sum(max(0, 3 - sum(1 for i in g if people[i]["values"]["a-type"] == "manager")) for g in res["groups"])
        assert short == 7  # 12 wanted, 5 exist: nothing is wasted
    # Must rules still win: the nice-to-have rule gives way, never the must rule.
    both = _gd_setup(n=20, groups=4, rules=[
        MANAGERS_MIN3 | {"soft": True, "scope": 0},
        {"id": "m1", "type": "count", "scope": 0, "attrId": "a-type", "value": "manager", "min": None, "max": 1}])
    for _ in range(10):
        res = _gd_run(page, both)
        assert res["status"] == "ok"
        assert sum(1 for i in res["groups"][0] if people[i]["values"]["a-type"] == "manager") == 1
    # A feasible nice-to-have rule is fully met and leaves no notes.
    easy = _gd_setup(n=20, groups=4, rules=[MANAGERS_MIN3 | {"min": 1, "soft": True}])
    for _ in range(10):
        res = _gd_run(page, easy)
        assert res["status"] == "ok" and res["notes"] == [] and _gd_check(easy, res["groups"]) == []


def test_gd_nice_to_have_in_ui(page):
    """The priority is set in the form, toggled in the rule list, shown as a note after drawing, and exported."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=20, groups=4))
    page.select_option("#gd-rule-type", "size")
    assert page.is_hidden("#gd-rule-soft")  # size rules are always a must
    page.select_option("#gd-rule-type", "count")
    page.select_option("#gd-rule-soft", "soft")
    _gd_add_rule(page, "count", "a-type", "manager", vmin=3)
    assert page.locator(".gd-rule.is-soft").count() == 1
    assert page.locator(".gd-hint.is-error").count() == 0
    assert page.locator(".gd-hint.is-warning").count() == 1
    groups = _gd_draw(page)
    assert len(sum(groups, [])) == 20 and page.is_hidden("#gd-alert")
    assert page.is_visible("#gd-notes")
    assert "Nice to have" in page.text_content("#gd-notes")
    assert "Drew 4 groups." in page.text_content("#gd-status")
    with page.expect_download() as dl:
        page.click("#gd-export")
    assert json.loads(Path(dl.value.path()).read_text())["rules"][0]["soft"] is True
    # Untick "nice to have": it is a must again, so the draw fails with an explanation.
    page.uncheck(".gd-rule .gd-rule-soft input")
    assert page.locator(".gd-rule.is-soft").count() == 0
    assert page.locator(".gd-hint.is-error").count() == 1
    _gd_draw(page)
    assert page.is_visible("#gd-alert") and "can’t all be met" in page.text_content("#gd-alert")
    # Spread evenly from the form.
    page.click(".gd-rule .gd-rule-delete")
    page.select_option("#gd-rule-type", "even")
    page.select_option("#gd-rule-attr", "a-type")
    assert page.is_disabled("#gd-rule-by option[value='sum']")
    page.click("#gd-rule-add")
    assert page.text_content(".gd-rule[data-type='even'] .gd-rule-target") == "Spread type evenly"
    page.select_option("#gd-rule-attr", "a-team")
    page.select_option("#gd-rule-by", "sum")
    assert page.is_disabled("#gd-rule-soft") and page.input_value("#gd-rule-soft") == "soft"
    page.click("#gd-rule-add")
    assert page.text_content(".gd-rule[data-type='even'].is-soft .gd-rule-target") == "Balance the total of team"
    groups = _gd_draw(page)
    assert len(sum(groups, [])) == 20
    assert "Σ team" in page.text_content("#gd-results .gd-card .gd-comp")


def test_gd_best_effort_weighs_sums_in_people_not_points(page):
    """A sum that is off by a few points no longer outweighs a head-count rule in best effort."""
    # 8 people worth 100 each; sum max 150 per group is hopeless, "max 1 manager" is easy.
    people = [{"id": f"p{i}", "name": f"P{i}", "values": {"a-team": 100, "a-type": "manager" if i < 2 else "developer"}}
              for i in range(8)]
    setup = _gd_setup(people=people, groups=2, best_effort=True, rules=[
        {"id": "s", "type": "sum", "scope": "all", "attrId": "a-team", "min": None, "max": 150},
        {"id": "c", "type": "count", "scope": "all", "attrId": "a-type", "value": "manager", "min": None, "max": 1}])
    for _ in range(10):
        res = _gd_run(page, setup)
        assert res["status"] == "best-effort"
        assert sorted(len(g) for g in res["groups"]) == [4, 4]
        assert all(sum(1 for i in g if i in ("p0", "p1")) == 1 for g in res["groups"])
        assert {v["kind"] for v in res["violations"]} == {"sum"}


def test_gd_rounds_avoid_repeat_pairings(page):
    """Several rounds in one go: every round is a full valid split and pairs meet again as rarely as possible."""
    people = [{"id": f"p{i}", "name": f"P{i}", "values": {}} for i in range(16)]
    setup = dict(_gd_setup(people=people, groups=4), attributes=[])
    for _ in range(5):
        res = _gd_run_opts(page, setup, {"rounds": 3})
        assert res["status"] == "ok" and len(res["rounds"]) == 3
        met = set()
        for rnd in res["rounds"]:
            assert sorted(sum(rnd["groups"], [])) == sorted(p["id"] for p in people)
            assert sorted(len(g) for g in rnd["groups"]) == [4, 4, 4, 4]
            pairs = {(a, b) for g in rnd["groups"] for a in g for b in g if a < b}
            assert len(pairs & met) == rnd["repeats"] == 0  # 16 into 4×4 can avoid every repeat for 3 rounds
            met |= pairs
    # Rules hold in every round, and "avoid" works against splits handed in from earlier draws.
    ruled = _gd_setup(n=24, groups=4, rules=GD_RULES[:2] + [WITH])
    res = _gd_run_opts(page, ruled, {"rounds": 4})
    assert len(res["rounds"]) == 4
    for rnd in res["rounds"]:
        assert rnd["status"] == "ok" and _gd_check(ruled, rnd["groups"]) == []
        w = _gd_where(rnd["groups"])
        assert w["p1"] == w["p2"]
    first = _gd_run(page, setup)["groups"]
    again = _gd_run_opts(page, setup, {"avoid": [first]})
    old = {(a, b) for g in first for a in g for b in g if a < b}
    new = {(a, b) for g in again["groups"] for a in g for b in g if a < b}
    assert again["repeats"] == len(old & new) == 0
    # The rounds option is clamped; one round keeps the plain result shape.
    assert "rounds" not in _gd_run_opts(page, setup, {"rounds": 1})
    assert len(_gd_run_opts(page, setup, {"rounds": 99})["rounds"]) == 10


def test_gd_rounds_in_ui(page):
    """Rounds are switched with a round bar; copy and CSV carry every round; "avoid repeats" reports back."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    people = [{"id": f"p{i}", "name": f"P{i}", "values": {}} for i in range(16)]
    _gd_import(page, dict(_gd_setup(people=people, groups=4), attributes=[]))
    assert page.is_hidden("#gd-rounds-nav") and page.is_hidden("#gd-rounds-hint")
    page.fill("#gd-rounds", "3")
    page.dispatch_event("#gd-rounds", "change")
    assert page.is_visible("#gd-rounds-hint")
    round1 = _gd_draw(page)
    assert "Drew 3 rounds of 4 groups." in page.text_content("#gd-status")
    assert page.locator("#gd-rounds-nav .gd-round-btn").count() == 3
    assert page.get_attribute("#gd-rounds-nav .gd-round-btn[data-round='1']", "aria-pressed") == "true"
    assert page.locator("#gd-history .gd-history-btn").count() == 1  # one draw, three rounds
    page.click("#gd-rounds-nav .gd-round-btn[data-round='2']")
    round2 = _gd_card_ids(page)
    assert page.get_attribute("#gd-results", "data-round") == "2"
    assert sorted(sum(round2, [])) == sorted(sum(round1, [])) and round2 != round1
    assert "met before" in page.text_content("#gd-rounds-nav .gd-round-info")
    page.evaluate("() => { navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; }")
    page.click("#gd-copy")
    text = page.evaluate("() => window.__copied")
    assert [l for l in text.splitlines() if l.startswith("Round ")] == ["Round 1", "Round 2", "Round 3"]
    with page.expect_download() as dl:
        page.click("#gd-csv")
    lines = Path(dl.value.path()).read_text().strip().splitlines()
    assert lines[0] == "round,group,name" and len(lines) == 1 + 3 * 16
    assert sorted(l.split(",")[0] for l in lines[1:]) == ["1"] * 16 + ["2"] * 16 + ["3"] * 16
    # A bad value is clamped; one round with "avoid repeat pairings" checks against this session's draws.
    page.fill("#gd-rounds", "0")
    page.dispatch_event("#gd-rounds", "change")
    assert page.input_value("#gd-rounds") == "1"
    page.check("#gd-fresh")
    _gd_draw(page)
    assert page.locator("#gd-rounds-nav .gd-round-btn").count() == 0
    assert page.is_visible("#gd-rounds-nav .gd-round-info")
    assert page.locator("#gd-history .gd-history-btn").count() == 2


def test_gd_manual_adjust_swap_and_move(page):
    """Tap a name then another to swap, or "Move here" to move; the result is re-checked against the rules."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3))
    before = _gd_draw(page)
    assert page.is_visible("#gd-adjust-hint")
    a, b = before[0][0], before[1][0]
    page.click(f"#gd-results .gd-member[data-person-id='{a}']")
    assert page.get_attribute(f"#gd-results .gd-member[data-person-id='{a}']", "aria-pressed") == "true"
    assert page.locator("#gd-results .gd-move-here:visible").count() == 2
    # Tapping the same name again cancels.
    page.click(f"#gd-results .gd-member[data-person-id='{a}']")
    assert page.locator("#gd-results .is-picked").count() == 0
    page.click(f"#gd-results .gd-member[data-person-id='{a}']")
    page.click(f"#gd-results .gd-member[data-person-id='{b}']")
    after = _gd_card_ids(page)
    assert b in after[0] and a in after[1]
    assert sorted(sum(after, [])) == sorted(sum(before, []))
    assert "Swapped" in page.text_content("#gd-status") and page.is_hidden("#gd-alert")
    assert page.locator("#gd-history .gd-history-btn").count() == 2
    assert "edited" in page.locator("#gd-history .gd-history-btn").first.text_content()
    # Moving breaks the balance: allowed, but flagged.
    page.click(f"#gd-results .gd-member[data-person-id='{a}']")
    page.click("#gd-results .gd-card[data-group='2'] .gd-move-here")
    moved = _gd_card_ids(page)
    assert a in moved[2] and sorted(len(g) for g in moved) == [3, 4, 5]
    assert page.is_visible("#gd-alert") and "After your changes" in page.text_content("#gd-alert")
    assert "now broken" in page.text_content("#gd-status")
    # Keyboard: Enter picks, Escape cancels.
    page.focus(f"#gd-results .gd-member[data-person-id='{b}']")
    page.keyboard.press("Enter")
    assert page.locator("#gd-results .is-picked").count() == 1
    page.keyboard.press("Escape")
    assert page.locator("#gd-results .is-picked").count() == 0
    # The undo is the history: the untouched draw is still there.
    page.locator("#gd-history .gd-history-btn").last.click()
    assert _gd_card_ids(page) == before
    # Editing the setup switches adjusting off until the next draw.
    page.fill("#gd-people-table tbody tr:first-child input[data-field='name']", "Renamed")
    assert page.is_hidden("#gd-adjust-hint")
    page.click(f"#gd-results .gd-member[data-person-id='{a}']", force=True)
    assert page.locator("#gd-results .is-picked").count() == 0


def test_gd_presenter_reveals_step_by_step(page):
    """Presenter mode shows the finished draw full-screen and reveals it click by click."""
    page.emulate_media(reduced_motion="reduce")
    _gd_open(page)
    _gd_import(page, _gd_setup(n=12, groups=3))
    groups = _gd_draw(page)
    page.click("#gd-present")
    page.wait_for_selector(".gd-present")
    assert page.locator(".gd-present-card").count() == 3
    assert page.locator(".gd-present-slot.is-shown").count() == 0
    assert set(page.eval_on_selector_all(".gd-present-name", "els => els.map(e => e.textContent)")) == {"?"}
    assert page.evaluate("document.activeElement.classList.contains('gd-present-next')")
    page.click(".gd-present-next")
    assert page.locator(".gd-present-slot.is-shown").count() == 1
    first = page.get_attribute(".gd-present-slot.is-shown", "data-person-id")
    assert first == groups[0][0]
    assert "1 / 12 revealed" in page.text_content(".gd-present-progress")
    assert "Person" in page.text_content(".gd-present-spot")
    page.keyboard.press("ArrowRight")
    assert page.locator(".gd-present-slot.is-shown").count() == 2
    # Group by group starts over and reveals a whole group per step.
    page.select_option(".gd-present-mode", "group")
    assert page.locator(".gd-present-slot.is-shown").count() == 0
    page.click(".gd-present-next")
    assert page.locator(".gd-present-slot.is-shown").count() == 4
    assert page.locator(".gd-present-card.is-complete").count() == 1
    page.click(".gd-present-all")
    assert page.locator(".gd-present-slot.is-shown").count() == 12
    assert page.is_disabled(".gd-present-next")
    shown = page.evaluate(
        "() => Array.from(document.querySelectorAll('.gd-present-card'))"
        ".map(c => Array.from(c.querySelectorAll('.gd-present-slot')).map(li => li.dataset.personId))")
    assert shown == groups
    assert "everyone" in page.text_content(".gd-present-spot").lower()
    page.keyboard.press("Escape")
    assert page.locator(".gd-present").count() == 0
    assert page.evaluate("document.activeElement.id") == "gd-present"
    # The draw itself is untouched by presenting it.
    assert _gd_card_ids(page) == groups


def test_gd_presenter_with_motion_and_mobile(page):
    """With animations on and at 375px the presenter still fits the screen and finishes cleanly."""
    page.set_viewport_size({"width": 375, "height": 700})
    _gd_open(page)
    page.click("#gd-load-example")
    _gd_draw(page)
    page.click("#gd-present")
    page.wait_for_selector(".gd-present")
    assert page.evaluate("document.querySelector('.gd-present').scrollWidth") <= 375
    for _ in range(3):
        page.click(".gd-present-next")
    assert page.locator(".gd-present-slot.is-shown").count() == 3
    page.click(".gd-present-all")
    assert page.locator(".gd-confetti-bit").count() > 0
    page.click(".gd-present-close")
    assert page.locator(".gd-present").count() == 0
    assert page.evaluate("document.documentElement.scrollWidth") <= 375


def test_gd_new_rules_survive_export_import_roundtrip(page):
    """Every new rule type, the nice-to-have flag and absences round-trip through export/import unchanged."""
    _gd_open(page)
    rules = [
        {"id": "e1", "type": "even", "attrId": "a-type", "by": "value", "soft": True},
        {"id": "e2", "type": "even", "attrId": "a-team", "by": "sum"},
        {"id": "la", "type": "apart", "scope": "all", "attrId": "a-sur", "k": 1, "soft": True},
        PIN | {"soft": True}, WITH, WITHOUT | {"soft": True},
    ]
    people = _gd_people(12)
    people[4]["absent"] = True
    setup = _gd_setup(people=people, groups=3, rules=rules)
    _gd_import(page, setup)
    assert page.locator(".gd-rule").count() == 6 and page.locator(".gd-rule.is-soft").count() == 5
    with page.expect_download() as dl:
        page.click("#gd-export")
    exported = json.loads(Path(dl.value.path()).read_text())
    assert exported["rules"] == rules
    assert [p.get("absent", False) for p in exported["people"]] == [i == 4 for i in range(12)]
    # "together" pairs and size rules can never be nice-to-have: the flag is dropped on import.
    _gd_import(page, dict(setup, rules=[WITH | {"soft": True}, {"id": "s", "type": "size", "scope": "all", "min": 1, "max": 9, "soft": True}]))
    assert page.locator(".gd-rule").count() == 2 and page.locator(".gd-rule.is-soft").count() == 0
