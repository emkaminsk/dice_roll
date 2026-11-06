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
            if r.get("scope", "all") not in ("all", gi):
                continue
            if r["type"] == "count":
                c = sum(1 for v in vals if v.get(r["attrId"]) == r["value"])
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
        page.select_option("#gd-rule-scope", scope or "all")
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
    """Labels are count-rule targets with a dropdown of distinct values that follows the table; not offered elsewhere."""
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
    # Labels are not offered for sum / keep apart / keep together.
    for rtype in ("sum", "apart", "together"):
        page.select_option("#gd-rule-type", rtype)
        attrs = page.eval_on_selector_all("#gd-rule-attr option", "os => os.map(o => o.value)")
        assert "a-sur" not in attrs


def test_gd_label_count_rule_survives_export_import_and_autosave(page):
    """A label count rule round-trips through export/import and autosave; label keep-apart is still rejected."""
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
    # Keep apart on a label is out of scope: the import is refused and the setup kept.
    bad = dict(setup, rules=[{"id": "ra", "type": "apart", "scope": "all", "attrId": "a-sur", "k": 1}])
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
