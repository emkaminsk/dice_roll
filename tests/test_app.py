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
