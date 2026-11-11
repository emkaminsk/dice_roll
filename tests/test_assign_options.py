"""End-to-end tests for the Assign Options view (spec: .ai/spec-assign-options.md §8).

A separate test set from tests/test_app.py: own server on its own port (8124) and own
fixtures, so the two files never share a server or state and each can run alone:

    uv run --with playwright --with pytest pytest tests/test_assign_options.py
"""

import csv as csv_mod
import http.server
import io
import json
import socketserver
import threading
import time
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

FE_DIR = Path(__file__).resolve().parent.parent / "appFE"
PORT = 8124
BASE_URL = f"http://localhost:{PORT}/"


@pytest.fixture(scope="module")
def server():
    """Serve appFE/ as static files for this module."""
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=str(FE_DIR), **kw)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield BASE_URL
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        yield b
        b.close()


@pytest.fixture
def page(server, browser):
    """A fresh page that fails the test on any console/page error."""
    errors = []
    pg = browser.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(server)
    pg.wait_for_load_state("networkidle")
    yield pg
    pg.close()
    assert not errors, f"Console/page errors: {errors}"


# ---- Helpers -----------------------------------------------------------------------

def _people(n, away=()):
    out = []
    for i in range(n):
        p = {"id": f"p{i}", "name": f"Person {i}"}
        if i in away:
            p["absent"] = True
        out.append(p)
    return out


def _label(i, name=None, slots=1, once=False):
    return {"id": f"l{i}", "name": name or f"Label {i}", "slots": slots, "once": once, "color": i % 12}


def _setup(people, labels, rounds=1, per=1, variety=True, unfilled=True, word=""):
    return {
        "kind": "assign-options", "version": 1, "people": people, "labels": labels,
        "settings": {"rounds": rounds, "perPerson": per, "variety": variety, "allowUnfilled": unfilled, "word": word},
    }


def _open(page, auto_accept=True):
    if auto_accept:
        page.on("dialog", lambda d: d.accept())
    page.click("#tab-assign-options")
    page.wait_for_selector("#assign-options-view:not([hidden])")


def _upload(page, data, name="setup.json"):
    payload = data if isinstance(data, bytes) else json.dumps(data).encode()
    page.set_input_files("#ao-import-file", files=[{"name": name, "mimeType": "application/json", "buffer": payload}])


def _import(page, setup):
    _upload(page, setup)
    page.wait_for_function("() => document.querySelector('#ao-io-notice').textContent.includes('Imported')", timeout=4000)


def _draw(page, timeout=15000):
    """Click Draw; wait for a new result or a failure. Returns the result read from the DOM."""
    before = page.get_attribute("#ao-results", "data-draw-no")
    page.evaluate("document.querySelector('#ao-status').textContent = ''")
    page.click("#ao-draw")
    page.wait_for_function(
        """(before) => {
            const r = document.querySelector('#ao-results');
            if (r.dataset.drawNo && r.dataset.drawNo !== before) return true;
            if (!document.querySelector('#ao-alert').hidden) return true;
            return !document.querySelector('#ao-draw').hasAttribute('aria-busy') && document.querySelector('#ao-status').textContent !== '';
        }""",
        arg=before, timeout=timeout,
    )
    return _read_result(page)


def _read_result(page):
    """By-person table → list of rounds, each {personId: [labelId, …]}."""
    return page.evaluate(
        """() => {
            const rows = Array.from(document.querySelectorAll('#ao-results .ao-result-table tbody tr'));
            if (!rows.length) return [];
            const R = rows[0].querySelectorAll('td[data-round]').length;
            const out = [];
            for (let r = 1; r <= R; r++) {
                const round = {};
                rows.forEach((tr) => {
                    round[tr.dataset.personId] = Array.from(tr.querySelectorAll(`td[data-round="${r}"] .ao-chip`)).map((c) => c.dataset.labelId);
                });
                out.push(round);
            }
            return out;
        }"""
    )


def _problems(setup, rounds):
    """Independent validity check of a drawn result against the setup."""
    s = setup["settings"]
    present = [p["id"] for p in setup["people"] if not p.get("absent")]
    labels = {l["id"]: l for l in setup["labels"]}
    problems = []
    if len(rounds) != s["rounds"]:
        problems.append(f"rounds {len(rounds)} != {s['rounds']}")
    had = {}
    for r, rd in enumerate(rounds):
        if sorted(rd) != sorted(present):
            problems.append(f"round {r}: people {sorted(rd)}")
        load = {}
        for pid, ids in rd.items():
            if len(ids) != s["perPerson"] or len(set(ids)) != len(ids):
                problems.append(f"round {r}: {pid} got {ids}")
            for lid in ids:
                load[lid] = load.get(lid, 0) + 1
                if labels[lid]["once"]:
                    if (pid, lid) in had:
                        problems.append(f"once label {lid} repeated for {pid}")
                    had[(pid, lid)] = True
        for lid, l in labels.items():
            n = load.get(lid, 0)
            if l["slots"] is not None and n > l["slots"]:
                problems.append(f"round {r}: {lid} used {n} > {l['slots']}")
            if not s["allowUnfilled"] and l["slots"] is not None and n != l["slots"]:
                problems.append(f"round {r}: {lid} used {n} != {l['slots']} (exact)")
    return problems


def _solver_run(page, setup, opts=None):
    return page.evaluate("([s, o]) => AssignOptionsSolver.run(s, o)", [setup, opts or {}])


# ---- 1. Tabs -----------------------------------------------------------------------

def test_ao_tabs_order_hash_and_keyboard(page, server):
    tabs = page.eval_on_selector_all(".view-tabs [role=tab]", "els => els.map(e => e.id)")
    assert tabs == ["tab-quick-tools", "tab-group-draw", "tab-assign-options"]
    assert page.is_visible("#quick-tools-view") and page.is_hidden("#assign-options-view")
    page.click("#tab-assign-options")
    assert page.is_visible("#assign-options-view") and page.is_hidden("#group-draw-view")
    assert page.evaluate("location.hash") == "#assign-options"
    page.focus("#tab-assign-options")
    page.keyboard.press("ArrowRight")  # wraps to the first tab
    assert page.get_attribute("#tab-quick-tools", "aria-selected") == "true"
    page.keyboard.press("ArrowLeft")
    assert page.get_attribute("#tab-assign-options", "aria-selected") == "true"
    page.keyboard.press("ArrowLeft")
    assert page.get_attribute("#tab-group-draw", "aria-selected") == "true"
    page.goto(server + "#assign-options")
    page.wait_for_load_state("networkidle")
    assert page.is_visible("#assign-options-view") and page.is_hidden("#quick-tools-view")


# ---- 2. People ---------------------------------------------------------------------

def test_ao_people_table_attendance_and_clear(page):
    _open(page)
    for name in ("Ada", "Ben", "Cleo"):
        page.click("#ao-add-person")
        page.locator("#ao-people-table tbody tr").last.locator("[data-field=name]").fill(name)
    assert page.locator("#ao-people-table tbody tr").count() == 3
    assert page.text_content("#ao-people-count") == "3 people"
    # Edit + delete.
    page.locator("#ao-people-table tbody tr").nth(1).locator("[data-field=name]").fill("Bea")
    page.locator("#ao-people-table tbody tr").nth(2).locator(".ao-person-delete").click()
    assert page.locator("#ao-people-table tbody tr").count() == 2
    # Away: still listed, not counted, skipped by the draw.
    page.locator("#ao-people-table tbody tr").nth(1).locator(".ao-here").uncheck()
    assert page.text_content("#ao-people-count") == "1 person · 1 away"
    assert page.is_visible("#ao-people-present")
    page.fill("#ao-label-name", "Dishes")
    page.click("#ao-label-add")
    page.emulate_media(reduced_motion="reduce")
    result = _draw(page)
    assert len(result) == 1 and len(result[0]) == 1
    page.click("#ao-people-present")
    assert page.text_content("#ao-people-count") == "2 people"
    assert page.is_hidden("#ao-people-present")
    page.click("#ao-people-clear")
    assert page.locator("#ao-people-table tbody tr").count() == 0
    assert page.is_visible("#ao-people-empty")


def test_ao_people_paste_header_duplicates(page):
    _open(page)
    page.click("#ao-paste-toggle")
    page.fill("#ao-paste-text", "name,team\nAnna,1\n\nBen,2\nAnna,3\nCleo,1\n")
    page.click("#ao-paste-preview")
    summary = page.text_content("#ao-paste-result")
    assert "3 names ready" in summary
    assert "header line skipped" in summary and "1 blank line" in summary and "“Anna”" in summary
    page.click("#ao-paste-import")
    names = page.eval_on_selector_all("#ao-people-table [data-field=name]", "els => els.map(e => e.value)")
    assert names == ["Anna", "Ben", "Cleo"]
    assert "Imported 3 people" in page.text_content("#ao-people-notice")
    # Replace via a plain list.
    page.click("#ao-paste-toggle")
    page.fill("#ao-paste-text", "Zed\nYan")
    page.click("#ao-paste-preview")
    page.check("#ao-paste-replace")
    page.click("#ao-paste-import")
    assert page.eval_on_selector_all("#ao-people-table [data-field=name]", "els => els.map(e => e.value)") == ["Zed", "Yan"]


# ---- 3. Group Draw import, own round-trip, errors ------------------------------------

GROUP_DRAW_EXPORT = {
    "version": 1,
    "attributes": [{"id": "a-team", "name": "team", "kind": "integer"},
                   {"id": "a-type", "name": "type", "kind": "category", "options": ["dev", "pm"]}],
    "people": [
        {"id": "g1", "name": "Ola", "values": {"a-team": 1, "a-type": "dev"}},
        {"id": "g2", "name": "Piotr", "absent": True, "values": {"a-team": 2, "a-type": "pm"}},
        {"id": "g3", "name": "Kasia", "values": {"a-team": 1, "a-type": "pm"}},
        {"id": "g4", "name": "  ", "values": {}},
    ],
    "groups": {"count": 2, "label": "", "names": []},
    "rules": [{"id": "r1", "type": "apart", "scope": "all", "attrId": "a-team", "k": 1}],
    "options": {"balance": True, "bestEffort": False},
}


def test_ao_group_draw_import_replace_and_add(page):
    _open(page)
    _import(page, _setup(_people(2), [_label(0)]))
    _upload(page, GROUP_DRAW_EXPORT, "group-draw-setup.json")
    page.wait_for_selector("#ao-import-panel:not([hidden])")
    assert "3 people, 1 away" in page.text_content("#ao-import-panel")
    page.click("#ao-import-add")
    names = page.eval_on_selector_all("#ao-people-table [data-field=name]", "els => els.map(e => e.value)")
    assert names == ["Person 0", "Person 1", "Ola", "Piotr", "Kasia"]
    notice = page.text_content("#ao-people-notice")
    assert "3 people loaded, 1 away; attributes and rules were not used" in notice
    assert page.text_content("#ao-people-count") == "4 people · 1 away"
    _upload(page, GROUP_DRAW_EXPORT, "group-draw-setup.json")
    page.click("#ao-import-replace")
    names = page.eval_on_selector_all("#ao-people-table [data-field=name]", "els => els.map(e => e.value)")
    assert names == ["Ola", "Piotr", "Kasia"]
    absent = page.eval_on_selector_all("#ao-people-table .ao-here", "els => els.map(e => !e.checked)")
    assert absent == [False, True, False]
    assert page.locator("#ao-labels-table tbody tr").count() == 1  # labels untouched


def test_ao_export_import_roundtrip_and_errors(page):
    _open(page)
    setup = _setup(_people(5, away=(2,)), [_label(0, "Dishes", 2, True), _label(1, "Trash", None)], rounds=3, per=1,
                   variety=False, unfilled=True, word="Task")
    _import(page, setup)
    assert "5 people, 2 labels, 3 rounds" in page.text_content("#ao-io-notice")
    with page.expect_download() as dl:
        page.click("#ao-export")
    exported = json.loads(Path(dl.value.path()).read_text())
    assert exported == setup
    page.click("#ao-reset")
    assert page.locator("#ao-people-table tbody tr").count() == 0
    _import(page, exported)
    with page.expect_download() as dl2:
        page.click("#ao-export")
    assert json.loads(Path(dl2.value.path()).read_text()) == setup
    assert page.text_content("#ao-labels-title-text") == "Tasks"
    _upload(page, b"{not json")
    page.wait_for_function("() => document.querySelector('#ao-io-notice').classList.contains('is-error')")
    assert "not valid JSON" in page.text_content("#ao-io-notice")
    _upload(page, {"hello": "world"})
    page.wait_for_function("() => document.querySelector('#ao-io-notice').textContent.includes('neither')")
    _upload(page, {"kind": "assign-options", "version": 2, "people": [], "labels": []})
    page.wait_for_function("() => document.querySelector('#ao-io-notice').textContent.includes('version')")
    assert page.locator("#ao-people-table tbody tr").count() == 5  # nothing replaced


# ---- 4. Labels ---------------------------------------------------------------------

def test_ao_labels_add_rename_delete_slots_once_paste(page):
    _open(page)
    page.fill("#ao-label-name", "Dishes")
    page.fill("#ao-label-slots", "2")
    page.click("#ao-label-add")
    page.fill("#ao-label-name", "dishes")
    page.click("#ao-label-add")
    assert "already" in page.text_content("#ao-label-error")
    page.fill("#ao-label-name", "Trash")
    page.check("#ao-label-unlimited")
    page.check("#ao-label-once")
    page.click("#ao-label-add")
    rows = page.locator("#ao-labels-table tbody tr")
    assert rows.count() == 2
    assert rows.nth(1).locator(".ao-unlimited").is_checked() and rows.nth(1).locator(".ao-once").is_checked()
    # Rename to a duplicate is refused (and reverted on leave); a fresh name sticks.
    name = rows.nth(1).locator("[data-field=name]")
    name.fill("DISHES")
    assert rows.nth(1).locator(".ao-cell-msg").count() == 1
    name.press("Tab")
    assert name.input_value() == "Trash"
    name.fill("Rubbish")
    # Slots: number and unlimited toggles.
    rows.nth(1).locator(".ao-unlimited").uncheck()
    rows.nth(1).locator("[data-field=slots]").fill("3")
    rows.nth(0).locator(".ao-unlimited").check()
    # All labels: once per person.
    assert page.evaluate("document.querySelector('#ao-all-once').indeterminate")
    page.check("#ao-all-once")
    assert page.eval_on_selector_all("#ao-labels-table .ao-once", "els => els.every(e => e.checked)")
    rows.nth(0).locator(".ao-once").uncheck()
    assert page.evaluate("document.querySelector('#ao-all-once').indeterminate")
    # Paste with x3 / ×2 suffixes; duplicates reported.
    page.click("#ao-labels-paste-toggle")
    page.fill("#ao-labels-paste-text", "Cooking x3\nShopping ×2\nrubbish\nWalk dog")
    page.click("#ao-labels-paste-add")
    assert "Skipped 1 duplicate" in page.text_content("#ao-labels-notice")
    with page.expect_download() as dl:
        page.click("#ao-export")
    labels = json.loads(Path(dl.value.path()).read_text())["labels"]
    assert [(l["name"], l["slots"], l["once"]) for l in labels] == [
        ("Dishes", None, False), ("Rubbish", 3, True), ("Cooking", 3, False), ("Shopping", 2, False), ("Walk dog", 1, False)]
    rows.nth(0).locator(".ao-label-delete").click()
    assert page.locator("#ao-labels-table tbody tr").count() == 4


# ---- 5. Validity over many draws (read from the DOM) ---------------------------------

def test_ao_draw_validity_50_draws(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    labels = [_label(0, "A", 2, True), _label(1, "B", 3), _label(2, "C", None), _label(3, "D", 1, True), _label(4, "E", 2, True)]
    setup = _setup(_people(8, away=(3,)), labels, rounds=3, per=2)
    _import(page, setup)
    for _ in range(50):
        result = _draw(page)
        assert _problems(setup, result) == []


# ---- 6. Unfilled slots ---------------------------------------------------------------

def test_ao_unfilled_slots_allowed_or_refused(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    setup = _setup(_people(4), [_label(0, "A", 3), _label(1, "B", 3)], rounds=2, per=1)
    _import(page, setup)
    assert page.locator("#ao-hints li").count() == 0
    result = _draw(page)
    assert _problems(setup, result) == []
    page.click("#ao-view-label")
    assert page.locator("#ao-results .ao-free").count() == 4  # 6 slots - 4 picks, per round × 2
    page.click("#ao-view-person")
    page.uncheck("#ao-unfilled")
    assert page.locator("#ao-hints li[data-code=exact]").count() == 1
    _draw(page)
    assert page.is_visible("#ao-alert")
    assert "every slot must be used" in page.text_content("#ao-alert")


# ---- 7. Infeasible setups ------------------------------------------------------------

def test_ao_infeasible_supply_and_once_capacity(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    _import(page, _setup(_people(6), [_label(0, "Dishes", 3), _label(1, "Trash", 2), _label(2, "Cooking", 2), _label(3, "Shopping", 1)], per=2))
    assert "6 people × 2 = 12 picks per round, but the labels offer only 8 slots" in page.text_content("#ao-hints")
    assert "is-short" in page.get_attribute("#ao-balance", "class")
    assert _draw(page) == []
    assert page.is_visible("#ao-alert") and "only 8 slots" in page.text_content("#ao-alert")
    assert page.locator("#ao-results .ao-chip").count() == 0
    page.click("#ao-reset")
    _import(page, _setup(_people(4), [_label(0, "A", 2, True), _label(1, "B", 2, True), _label(2, "C", 4)], rounds=3, per=2))
    hints = page.text_content("#ao-hints")
    assert "once per person" in hints.lower() or "possible for them" in hints
    assert _draw(page) == []
    assert page.is_visible("#ao-alert")
    assert page.locator("#ao-results .ao-chip").count() == 0


# ---- 8. Prefer variety ---------------------------------------------------------------

def test_ao_prefer_variety_zero_repeats(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    setup = _setup(_people(6), [_label(0, "A", 2), _label(1, "B", 2), _label(2, "C", 2)], rounds=3, per=1)
    _import(page, setup)
    for _ in range(10):
        result = _draw(page)
        assert _problems(setup, result) == []
        assert page.get_attribute("#ao-summary", "data-repeats") == "0"
        for pid in result[0]:
            assert len({result[r][pid][0] for r in range(3)}) == 3
    plain = dict(setup, settings=dict(setup["settings"], variety=False))
    repeats = 0
    for _ in range(50):
        res = _solver_run(page, plain)
        assert res["status"] == "ok"
        rounds = [r["assignments"] for r in res["rounds"]]
        assert _problems(plain, rounds) == []
        repeats += res["repeats"]
    assert repeats > 0  # statistically certain without variety


# ---- 9. Fairness smoke ---------------------------------------------------------------

def test_ao_fairness_uniform_single_round(page):
    counts = page.evaluate(
        """() => {
            const setup = { people: [{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],
              labels: [{id:'x',name:'X',slots:1},{id:'y',name:'Y',slots:1},{id:'z',name:'Z',slots:1}],
              settings: { rounds: 1, perPerson: 1 } };
            const c = {};
            for (let i = 0; i < 10000; i++) {
              const r = AssignOptionsSolver.run(setup).rounds[0].assignments;
              Object.keys(r).forEach((p) => { const k = p + r[p][0]; c[k] = (c[k] || 0) + 1; });
            }
            return c;
        }"""
    )
    assert len(counts) == 9
    for k, v in counts.items():
        assert abs(v / 10000 - 1 / 3) < 0.05, (k, v)


# ---- 10. Draw again varies -------------------------------------------------------------

def test_ao_draw_again_differs(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    _import(page, _setup(_people(6), [_label(i, None, 2) for i in range(4)], rounds=2, per=1))
    seen = {json.dumps(_draw(page), sort_keys=True) for _ in range(20)}
    assert len(seen) >= 2
    assert page.is_visible("#ao-history-wrap")
    assert page.locator(".ao-history-btn").count() == 10


# ---- 11. Keep a round ---------------------------------------------------------------

def test_ao_keep_round_redraws_others_honouring_once(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    setup = _setup(_people(6), [_label(i, None, 1, True) for i in range(6)], rounds=3, per=1, unfilled=False)
    _import(page, setup)
    assert page.is_hidden("#ao-keep-bar")
    first = _draw(page)
    assert page.is_visible("#ao-keep-bar")
    page.check(".ao-keep-box[data-round='2']")
    assert "redraws the other 2 rounds" in page.text_content("#ao-keep-hint")
    changed_other = False
    for _ in range(8):
        again = _draw(page)
        assert again[1] == first[1]
        assert _problems(setup, again) == []
        changed_other = changed_other or again[0] != first[0] or again[2] != first[2]
    assert changed_other
    assert "kept 1" in page.text_content("#ao-status")
    # Keeping every round disables Draw; editing the setup drops the keep option.
    page.check(".ao-keep-box[data-round='1']")
    page.check(".ao-keep-box[data-round='3']")
    assert page.is_disabled("#ao-draw")
    page.uncheck(".ao-keep-box[data-round='3']")
    page.locator("#ao-people-table tbody tr").first.locator("[data-field=name]").fill("Renamed")
    assert page.is_hidden("#ao-keep-bar") and page.is_visible("#ao-outdated")


# ---- 12. Output ------------------------------------------------------------------------

def test_ao_copy_csv_and_views_agree(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    labels = [_label(0, "Dishes", 2), _label(1, "Trash", 2), _label(2, "Cook, eat", 2), _label(3, "=SUM", 2)]
    setup = _setup(_people(4), labels, rounds=2, per=2)
    _import(page, setup)
    result = _draw(page)
    page.evaluate("Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } })")
    page.click("#ao-copy")
    page.wait_for_function("() => typeof window.__copied === 'string'")
    text = page.evaluate("window.__copied").strip().split("\n")
    names = {l["id"]: l["name"] for l in labels}
    assert len(text) == 4
    for i, line in enumerate(text):
        pid = f"p{i}"
        assert line == f"Person {i}: R1 " + ", ".join(names[x] for x in result[0][pid]) + " · R2 " + ", ".join(names[x] for x in result[1][pid])
    with page.expect_download() as dl:
        page.click("#ao-csv")
    rows = list(csv_mod.reader(io.StringIO(Path(dl.value.path()).read_text())))
    assert rows[0] == ["person", "round 1", "round 2"]
    assert [r[0] for r in rows[1:]] == [f"Person {i}" for i in range(4)]
    for i, r in enumerate(rows[1:]):
        for k in range(2):
            assert r[k + 1] == "; ".join(names[x] for x in result[k][f"p{i}"])
    # By label shows the same assignment.
    page.click("#ao-view-label")
    by_label = page.evaluate(
        """() => Array.from(document.querySelectorAll('.ao-label-block')).map((b) => [b.dataset.labelId,
            Array.from(b.querySelectorAll('.ao-label-round')).map((r) => Array.from(r.querySelectorAll('.ao-person-chip')).map((c) => c.dataset.personId))])"""
    )
    for lid, rounds in by_label:
        for r, pids in enumerate(rounds):
            assert sorted(pids) == sorted(p for p, ids in result[r].items() if lid in ids)


# ---- 13. Presenter: all at once --------------------------------------------------------

def test_ao_presenter_all_at_once_paging_and_round_reveal(page):
    page.emulate_media(reduced_motion="reduce")
    page.set_viewport_size({"width": 1280, "height": 720})
    _open(page)
    setup = _setup(_people(60, away=(5,)), [_label(i, None, None) for i in range(4)], rounds=3, per=1)
    _import(page, setup)
    _draw(page)
    page.click("#ao-present")
    page.wait_for_selector(".ao-present")
    page.click(".ao-present-choice[data-mode=all]")
    page.check(".ao-present-byround")
    page.click(".ao-present-go")
    assert page.locator(".ao-present-card").count() == 59
    assert "p5" not in page.eval_on_selector_all(".ao-present-card", "els => els.map(e => e.dataset.personId)")
    page_info = page.text_content(".ao-present-page")
    assert page_info.startswith("Page 1 / ") and not page_info.endswith("/ 1")
    visible = page.locator(".ao-present-card:not([hidden])").count()
    assert 0 < visible < 59
    assert page.locator(".ao-present-card:not([hidden]) .ao-present-row.is-hidden").count() == visible * 3
    page.click(".ao-present-next")
    assert page.locator(".ao-present-row[data-round='1'].is-hidden").count() == 0
    assert page.locator(".ao-present-row[data-round='2'].is-hidden").count() == 59
    page.keyboard.press("ArrowRight")
    page.click(".ao-present-all")
    assert page.locator(".ao-present-row.is-hidden").count() == 0
    page.click(".ao-present-next")  # now pages
    assert page.text_content(".ao-present-page").startswith("Page 2 / ")
    page.keyboard.press("ArrowLeft")
    assert page.text_content(".ao-present-page").startswith("Page 1 / ")
    page.click(".ao-present-bylabel")
    assert page.locator(".ao-present-card[data-label-id]").count() == 4
    page.keyboard.press("Escape")
    assert page.locator(".ao-present").count() == 0
    assert page.evaluate("document.activeElement.id") == "ao-present"


# ---- 14. Presenter: person by person ----------------------------------------------------

def _spot_run(page):
    """Walk the whole person-by-person presentation; return [(personId, [labelIds])]."""
    seen = []
    while True:
        if "everyone" in page.text_content(".ao-present-spot").lower():
            break
        page.click(".ao-present-person-all")
        pid = page.get_attribute(".ao-present-spot", "data-person-id")
        ids = page.eval_on_selector_all(".ao-present-slot", "els => els.map(e => e.dataset.labelId)")
        seen.append((pid, ids))
        page.click(".ao-present-next")
    return seen


def test_ao_presenter_person_by_person(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    setup = _setup(_people(8, away=(2,)), [_label(i, None, None) for i in range(4)], rounds=2, per=2)
    _import(page, setup)
    result = _draw(page)
    expected = {pid: result[0][pid] + result[1][pid] for pid in result[0]}
    page.click("#ao-present")
    page.click(".ao-present-choice[data-mode=person]")
    page.click(".ao-present-go")
    assert page.text_content(".ao-present-progress") == "1 / 7"
    assert page.locator(".ao-present-slot.is-shown").count() == 0
    page.click(".ao-present-next")
    assert page.locator(".ao-present-slot.is-shown").count() == 1
    assert "Round 1 of 2" in page.text_content(".ao-present-caption")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    assert "Round 2 of 2" in page.text_content(".ao-present-caption")
    page.click(".ao-present-person-all")
    page.click(".ao-present-next")  # next person
    assert page.text_content(".ao-present-progress") == "2 / 7"
    page.click(".ao-present-back")
    assert page.text_content(".ao-present-progress") == "1 / 7"
    assert page.locator(".ao-present-slot.is-shown").count() == 4
    page.click(".ao-present-skip")
    assert "everyone" in page.text_content(".ao-present-spot").lower()
    page.keyboard.press("Escape")
    # List order, then shuffled orders: same assignments, only the announcing order changes.
    page.click("#ao-present")
    page.uncheck(".ao-present-shuffle") if page.is_checked(".ao-present-shuffle") else None
    page.click(".ao-present-go")
    ordered = _spot_run(page)
    assert [pid for pid, _ in ordered] == [f"p{i}" for i in range(8) if i != 2]
    assert all(ids == expected[pid] for pid, ids in ordered)
    page.keyboard.press("Escape")
    orders = set()
    for _ in range(4):
        page.click("#ao-present")
        page.check(".ao-present-shuffle")
        page.click(".ao-present-go")
        run = _spot_run(page)
        assert sorted(pid for pid, _ in run) == sorted(expected)
        assert all(ids == expected[pid] for pid, ids in run)
        orders.add(tuple(pid for pid, _ in run))
        page.keyboard.press("Escape")
    assert len(orders) >= 2
    assert _read_result(page) == result


# ---- 15. Performance -------------------------------------------------------------------

def test_ao_performance_200_people(page):
    # Spec §8.15 says slots 10, which gives 200 slots for 400 picks (infeasible);
    # slots 20 is the intended exact fit (20 × 20 = 200 × 2).
    setup = _setup(_people(200), [_label(i, None, 20) for i in range(20)], rounds=5, per=2)
    for unfilled in (True, False):
        s = dict(setup, settings=dict(setup["settings"], allowUnfilled=unfilled))
        t = time.time()
        res = _solver_run(page, s)
        assert time.time() - t < 2
        assert res["status"] == "ok"
        assert _problems(s, [r["assignments"] for r in res["rounds"]]) == []
    # The infeasible variant is refused fast with a reason.
    bad = _setup(_people(200), [_label(i, None, 10) for i in range(20)], rounds=5, per=2)
    t = time.time()
    res = _solver_run(page, bad)
    assert res["status"] == "infeasible" and time.time() - t < 2
    # Through the UI (Worker) as well.
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    _import(page, setup)
    t = time.time()
    result = _draw(page)
    assert time.time() - t < 3
    assert _problems(setup, result) == []


# ---- 16. 375 px --------------------------------------------------------------------------

def test_ao_mobile_375(page):
    page.set_viewport_size({"width": 375, "height": 760})
    _open(page)
    _import(page, _setup(_people(12), [_label(i, f"A long label name {i}", None) for i in range(5)], rounds=5, per=2))
    assert page.evaluate("document.documentElement.scrollWidth") <= 375
    _draw(page)
    page.wait_for_timeout(300)
    assert page.evaluate("document.documentElement.scrollWidth") <= 375
    wrap = page.evaluate("(() => { const w = document.querySelector('.ao-result-wrap'); return [getComputedStyle(w).overflowX, w.clientWidth, w.scrollWidth]; })()")
    assert wrap[0] == "auto" and wrap[1] <= 375 and wrap[2] > wrap[1]
    page.click("#ao-present")
    page.click(".ao-present-go")
    assert page.evaluate("document.querySelector('.ao-present').scrollWidth") <= 375
    page.click(".ao-present-close")
    page.click("#ao-present")
    page.click(".ao-present-choice[data-mode=person]")
    page.click(".ao-present-go")
    page.click(".ao-present-next")
    assert page.evaluate("document.querySelector('.ao-present').scrollWidth") <= 375
    assert page.is_visible(".ao-present-next")
    page.click(".ao-present-close")
    assert page.evaluate("document.documentElement.scrollWidth") <= 375


# ---- 17. Reduced motion --------------------------------------------------------------------

def test_ao_reduced_motion_instant(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    page.click("#ao-load-example")
    t = time.time()
    _draw(page)
    assert time.time() - t < 2
    assert page.locator("#ao-results .is-dealt, #ao-results .is-popping").count() == 0
    page.click("#ao-present")
    page.click(".ao-present-go")
    page.click(".ao-present-all") if page.is_visible(".ao-present-all") else None
    assert page.locator(".page-confetti").count() == 0
    page.keyboard.press("Escape")


def test_ao_motion_reveal_and_confetti(page):
    _open(page)
    page.click("#ao-load-example")
    _draw(page)
    assert page.locator("#ao-results tr.is-dealt").count() == 6
    page.click("#ao-present")
    page.click(".ao-present-choice[data-mode=person]")
    page.click(".ao-present-go")
    page.click(".ao-present-skip")
    assert page.locator(".page-confetti").count() == 1
    page.keyboard.press("Escape")


# ---- 18. Independence + shared helpers ------------------------------------------------------

def test_ao_independent_of_group_draw_and_quick_tools(page):
    page.fill("#max", "12")
    page.click("#tab-group-draw")
    page.on("dialog", lambda d: d.accept())
    page.click("#gd-load-example")
    page.wait_for_timeout(500)  # Group Draw autosave is debounced
    gd_before = page.evaluate("localStorage.getItem('groupDraw.setup.v1')")
    gd_rows = page.locator("#gd-people-table tbody tr").count()
    page.emulate_media(reduced_motion="reduce")
    _open(page, auto_accept=False)
    _upload(page, GROUP_DRAW_EXPORT)
    page.click("#ao-import-replace")
    page.fill("#ao-label-name", "Dishes")
    page.click("#ao-label-add")
    _draw(page)
    page.click("#ao-reset")
    page.wait_for_timeout(400)
    assert page.evaluate("localStorage.getItem('groupDraw.setup.v1')") == gd_before
    page.click("#tab-group-draw")
    assert page.locator("#gd-people-table tbody tr").count() == gd_rows
    page.click("#tab-quick-tools")
    assert page.input_value("#max") == "12"
    keys = page.evaluate("Object.keys(localStorage)")
    assert all(k in ("groupDraw.setup.v1", "assignOptions.setup.v1", "theme") or not k.startswith("assign") for k in keys)


def _blocked_page(browser, server, pattern):
    errors = []
    pg = browser.new_page()
    pg.route(pattern, lambda route: route.abort())
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("dialog", lambda d: d.accept())
    pg.goto(server)
    pg.wait_for_load_state("networkidle")
    return pg, errors


def test_ao_works_with_group_draw_blocked(server, browser):
    pg, errors = _blocked_page(browser, server, "**/group_draw*.js")
    assert pg.evaluate("typeof window.GroupDrawSolver") == "undefined"
    pg.emulate_media(reduced_motion="reduce")
    pg.click("#tab-assign-options")
    pg.click("#ao-load-example")
    result = _draw(pg)
    assert len(result) == 4 and len(result[0]) == 6
    assert errors == []
    pg.close()


def test_ao_group_draw_works_with_assign_options_blocked(server, browser):
    pg, errors = _blocked_page(browser, server, "**/assign_options*.js")
    assert pg.evaluate("typeof window.AssignOptionsSolver") == "undefined"
    pg.click("#tab-group-draw")
    pg.click("#gd-load-example")
    pg.click("#gd-draw")
    pg.wait_for_function("() => document.querySelectorAll('#gd-results .gd-card').length === 5", timeout=15000)
    assert errors == []
    pg.close()


def test_ao_code_isolation_no_cross_references():
    for name in ("assign_options.js", "assign_options_solver.js", "assign_options.css", "page_utils.js"):
        src = (FE_DIR / name).read_text()
        for bad in ("gd-", "GroupDrawSolver", "group_draw", "groupDraw."):
            assert bad not in src, (name, bad)
    for name in ("group_draw.js", "group_draw_solver.js"):
        src = (FE_DIR / name).read_text()
        for bad in ("ao-", "AssignOptions", "assignOptions", "PageUtils"):
            assert bad not in src, (name, bad)


def test_ao_utils_csv_cell(page):
    out = page.evaluate("""() => ['plain', 'a,b', 'say "hi"', '=1+2', '+x', '-5', '-x', '@me', 'a;b', '', null, 7]
        .map((v) => PageUtils.csvCell(v))""")
    assert out == ["plain", '"a,b"', '"say ""hi"""', "'=1+2", "'+x", "-5", "'-x", "'@me", '"a;b"', "", "", "7"]


def test_ao_utils_download_and_notice(page):
    with page.expect_download() as dl:
        page.evaluate("PageUtils.download('x.txt', 'hello', 'text/plain')")
    assert dl.value.suggested_filename == "x.txt"
    assert Path(dl.value.path()).read_text() == "hello"
    state = page.evaluate("""() => { const p = document.createElement('p'); PageUtils.notice(p, 'Oops', 'error');
        const a = [p.hidden, p.textContent, p.classList.contains('is-error')]; PageUtils.notice(p, ''); return a.concat([p.hidden]); }""")
    assert state == [False, "Oops", True, True]


def test_ao_utils_worker_runner_and_fallback(page):
    res = page.evaluate("""async () => {
        const f = function (rnd) { return { add: function (a, b) { return a + b + rnd(1); } }; };
        const w = PageUtils.createWorkerRunner(f, { method: 'add' });
        const a = await w.run(2, 3);
        const modeA = w.mode();
        const saved = window.Worker;
        window.Worker = undefined;
        const m = PageUtils.createWorkerRunner(f, { method: 'add' });
        const b = await m.run(4, 5);
        const modeB = m.mode();
        window.Worker = saved;
        return [a, modeA, b, modeB];
    }""")
    assert res == [5, "worker", 9, "main"]
    cancelled = page.evaluate("""async () => {
        const f = function () { return { spin: function () { const t = Date.now(); while (Date.now() - t < 3000) {} return 'done'; } }; };
        const w = PageUtils.createWorkerRunner(f, { method: 'spin' });
        const p = w.run();
        setTimeout(() => w.cancel('stopped'), 50);
        return await p;
    }""")
    assert cancelled == "stopped"


# ---- 19. Theme -------------------------------------------------------------------------------

def test_ao_theme_light_and_dark(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    page.click("#ao-load-example")
    _draw(page)
    js = """() => {
        const c = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
        return { selColor: c('#ao-per-person', 'color'), selBg: c('#ao-per-person', 'backgroundColor'),
                 chipColor: c('#ao-results .ao-chip', 'color'), chipBg: c('#ao-results .ao-chip', 'backgroundColor'),
                 card: c('#ao-step-draw', 'backgroundColor'), theme: document.documentElement.dataset.theme };
    }"""
    page.evaluate("document.documentElement.setAttribute('data-theme', 'light')")
    page.wait_for_timeout(500)  # colours transition between themes
    light = page.evaluate(js)
    page.click("#theme-toggle")
    page.wait_for_timeout(500)
    dark = page.evaluate(js)
    assert light["theme"] == "light" and dark["theme"] == "dark"
    for t in (light, dark):
        assert t["selColor"] != t["selBg"] and t["chipColor"] != t["chipBg"]
    assert light["card"] != dark["card"] and light["chipBg"] != dark["chipBg"] and light["selBg"] != dark["selBg"]


# ---- 20. Both knobs together ----------------------------------------------------------------

def test_ao_slots_and_per_person_together(page):
    page.emulate_media(reduced_motion="reduce")
    _open(page)
    labels = [_label(0, "Dishes", 3), _label(1, "Trash", 2), _label(2, "Cooking", 2), _label(3, "Shopping", 5)]
    setup = _setup(_people(6), labels, rounds=2, per=2, unfilled=False)
    _import(page, setup)
    assert page.locator("#ao-hints li").count() == 0
    assert "is-exact" in page.get_attribute("#ao-balance", "class")
    for _ in range(15):
        result = _draw(page)
        assert _problems(setup, result) == []
        for rd in result:
            counts = {}
            for ids in rd.values():
                for i in ids:
                    counts[i] = counts.get(i, 0) + 1
            assert counts == {"l0": 3, "l1": 2, "l2": 2, "l3": 5}
    # Unfilled allowed: Shopping ×7 leaves 2 free slots, counts stay at or below slots.
    page.locator("#ao-labels-table tbody tr").nth(3).locator("[data-field=slots]").fill("7")
    page.check("#ao-unfilled")
    loose = _setup(_people(6), labels[:3] + [_label(3, "Shopping", 7)], rounds=2, per=2, unfilled=True)
    for _ in range(10):
        assert _problems(loose, _draw(page)) == []
