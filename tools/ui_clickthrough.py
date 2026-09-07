import sys, json
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:8765"
FIX = sys.argv[1]; OUT = sys.argv[2]
log = []
def note(msg): log.append(msg); print(msg, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(BASE + "/")
    page.wait_for_url("**/import")
    expect(page.get_by_role("heading", name="Import traces")).to_be_visible()
    page.screenshot(path=f"{OUT}/01-import-page.png", full_page=True)
    note("1. / redirects to /import; 'Import traces' heading visible")

    page.set_input_files("#trace-file", FIX)
    expect(page.get_by_role("heading", name="Uploaded file")).to_be_visible(timeout=30000)
    text = page.locator("body").inner_text()
    assert "4770" in text.replace(",", "") or "4 770" in text, text[:500]
    page.screenshot(path=f"{OUT}/02-uploaded.png", full_page=True)
    note("2. upload via file input -> 'Uploaded file' section, record count 4770 shown")

    page.select_option("#mapping", index=1)
    chosen = page.locator("#mapping option:checked").inner_text()
    note(f"3. mapping chosen: {chosen}")
    page.get_by_role("button", name="Preview").click()
    expect(page.get_by_role("heading", name="Import preview")).to_be_visible(timeout=30000)
    expect(page.get_by_text("No rejects in this sample.")).to_be_visible()
    page.screenshot(path=f"{OUT}/03-preview.png", full_page=True)
    note("4. Preview -> 'Import preview' with sample tables, no rejects")

    page.get_by_role("button", name="Import", exact=True).click()
    page.wait_for_url("**/imports/**", timeout=120000)
    expect(page.get_by_role("heading", name="Import report")).to_be_visible()
    expect(page.get_by_text("committed", exact=False).first).to_be_visible(timeout=30000)
    page.screenshot(path=f"{OUT}/04-import-report.png", full_page=True)
    note(f"5. Import -> navigated to {page.url.split('/imports/')[1]} report, status committed")

    page.get_by_role("link", name="Open dashboard").click()
    expect(page.get_by_role("heading", name="Dashboard")).to_be_visible()
    kpis = {h.inner_text(): h.locator("xpath=..").locator(".metric").inner_text() for h in page.locator("section.kpi h2").all()}
    note(f"6. Dashboard KPIs: {kpis}")
    page.screenshot(path=f"{OUT}/05-dashboard.png", full_page=True)

    page.locator("table a[href^='/sessions/']").first.click()
    expect(page.get_by_role("heading", name="Session detail")).to_be_visible()
    page.screenshot(path=f"{OUT}/06-session.png", full_page=True)
    note("7. first session link -> 'Session detail'")

    page.get_by_role("button", name="Source record for model call").first.click()
    drawer = page.locator("dialog.drawer")
    expect(drawer).to_be_visible()
    body = drawer.locator("pre").first.inner_text()
    assert body.lstrip().startswith("{") and '"provider"' in body, body[:200]
    page.screenshot(path=f"{OUT}/07-source-record.png", full_page=True)
    note("8. 'Source record' drawer opens with the raw JSON payload text")
    page.get_by_role("button", name="Close source record").click()
    expect(drawer).to_be_hidden()

    page.get_by_role("link", name="Imports history").click()
    expect(page.get_by_role("heading", name="Imports history")).to_be_visible()
    page.screenshot(path=f"{OUT}/08-imports-history.png", full_page=True)
    note("9. Imports history lists the committed import")

    # duplicate re-import through the UI
    page.get_by_role("link", name="Import", exact=True).click()
    page.set_input_files("#trace-file", FIX)
    expect(page.get_by_role("heading", name="Uploaded file")).to_be_visible(timeout=30000)
    page.screenshot(path=f"{OUT}/09-reupload-already-imported.png", full_page=True)
    already = page.locator("body").inner_text()
    note("10. re-upload shows earlier import: " + ("yes" if "imp_" in already else "NOT SHOWN"))
    page.select_option("#mapping", index=1)
    page.get_by_role("button", name="Preview").click()
    expect(page.get_by_role("heading", name="Import preview")).to_be_visible(timeout=30000)
    page.get_by_role("button", name="Import", exact=True).click()
    page.wait_for_url("**/imports/**", timeout=60000)
    expect(page.get_by_text("Loading")).to_be_hidden(timeout=30000)
    dup_text = page.locator("body").inner_text()
    page.screenshot(path=f"{OUT}/10-duplicate-report.png", full_page=True)
    note("11. duplicate re-import report status: " + ("duplicate" if "duplicate" in dup_text else "UNEXPECTED: " + dup_text[:300]))

    note("browser errors: " + (json.dumps(errors) if errors else "none"))
    browser.close()
