const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// Screenshot folder + per-run filename
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const now = new Date();
const datePart = now.toISOString().slice(0, 10); // 2026-06-24
const timePart = now.toTimeString().slice(0, 8).replaceAll(":", ""); // 184530
const finalScreenshot = path.join(
  SCREENSHOTS_DIR,
  `${datePart}_${timePart}.png`,
);

const headless = process.env.HEADLESS === "true";

// Values applied to every row this week
const PROJECT = "Miscellaneous Task";
const TASK = "Random Development Work/Unassigned";
const PERCENT_FINISH = "100%";
const HOURS = "9";
const REMARKS = "Worked on Project UI";

// Compute Mon–Fri (mm/dd/yyyy) for the target work week.
// Default: the week containing today. Override: set WEEK_START=YYYY-MM-DD
// (must be a Monday) to backfill or fill a specific week.
function weekdayDates() {
  let monday;
  if (process.env.WEEK_START) {
    const [y, m, d] = process.env.WEEK_START.split("-").map(Number);
    monday = new Date(y, m - 1, d);
  } else {
    const today = new Date();
    const dow = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysBackToMonday = dow === 0 ? 6 : dow - 1;
    monday = new Date(today);
    monday.setDate(today.getDate() - daysBackToMonday);
  }
  const out = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push(`${mm}/${dd}/${d.getFullYear()}`);
  }
  return out;
}

(async () => {
  const dates = weekdayDates();
  console.log("Filling timesheet for:", dates.join(", "));

  // const browser = await chromium.launch({
  //   headless,
  //   slowMo: headless ? 0 : 200,
  // });
  // const page = await browser.newPage();
  const STATE_PATH = path.join(__dirname, ".auth", "session.json");
  if (!fs.existsSync(STATE_PATH)) {
    console.error("No saved session found. Run `node setup-login.js` first.");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 200,
  });
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();

  // Log every JS dialog Empower throws (alerts/confirms). Without this, Playwright
  // auto-dismisses them silently — and we never see why an Update failed.
  page.on("dialog", async (dialog) => {
    console.log(`   [dialog ${dialog.type()}] ${dialog.message()}`);
    await dialog.accept();
  });

  // // ===== Login =====
  // console.log("[1] Opening login page...");
  // await page.goto("https://empower.intsof.com/Login.aspx");
  // await page.fill("#txtUserID", process.env.EMPOWER_USER);
  // await page.fill("#txtPassword", process.env.EMPOWER_PASS);
  // await Promise.all([
  //   page.waitForNavigation(),
  //   page.click('input[type="submit"], #btnLogin'),
  // ]);

  // ===== Session check =====
  console.log("[1] Checking saved session...");
  await page.goto("https://empower.intsof.com/addnewtimesheetentry.aspx");
  const loginFormVisible = await page.locator("#txtUserID").count();
  if (loginFormVisible > 0) {
    console.error(
      "[1] Session expired — run `node setup-login.js` to log in again.",
    );
    await browser.close();
    process.exit(1);
  }
  console.log("[1] Session valid, continuing...");

  // ===== Timesheet page =====
  console.log("[2] Opening timesheet page...");
  await page.goto("https://empower.intsof.com/addnewtimesheetentry.aspx");
  await page.waitForLoadState("networkidle");

  // ===== Fill one row per weekday =====
  const results = { saved: [], skipped: [], failed: [] };

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    console.log(`[3.${i + 1}] Adding row for ${date}...`);

    // Before adding a new row, make sure no stale editable row is lingering
    // (would otherwise trigger "Please update Row no. X first").
    // Use evaluate(el.click()) — the visible click pipeline hangs on these
    // javascript:__doPostBack(...) links inside dynamic ASP.NET tables.
    const stale = page.locator("tr", {
      has: page.locator('a:has-text("Update")'),
    });
    if ((await stale.count()) > 0) {
      console.log("   (canceling a leftover editable row first)");
      await stale
        .locator('a:has-text("Cancel")')
        .first()
        .evaluate((el) => el.click());
      await page.waitForLoadState("networkidle");
    }

    // Spawn a new editable row
    await page.click('input[value="Add New Timesheet Entry"]');
    await page.waitForLoadState("networkidle");

    // Scope all selectors to the row currently in edit mode
    const row = page.locator("tr", {
      has: page.locator('a:has-text("Update")'),
    });

    // Wait until the Project options are actually in the DOM for this row
    await row
      .locator("option", { hasText: PROJECT })
      .first()
      .waitFor({ state: "attached", timeout: 20000 });

    // Project (triggers ASP.NET postback that populates Tasks/Phases)
    await row
      .locator(`select:has(option:has-text("${PROJECT}"))`)
      .first()
      .selectOption({ label: PROJECT });
    await page.waitForLoadState("networkidle");

    // Tasks/Phases
    await row
      .locator(`select:has(option:has-text("${TASK}"))`)
      .first()
      .selectOption({ label: TASK });

    // % Finish
    await row
      .locator(`select:has(option:has-text("${PERCENT_FINISH}"))`)
      .first()
      .selectOption({ label: PERCENT_FINISH });

    // Date / Start Time / Hours are the 3 text inputs in the row, in column order.
    // Important: changing the Date fires an onchange postback that re-renders the
    // row and resets Hours back to 0. We MUST wait for that postback to settle
    // before filling Hours, or our value gets clobbered by the postback response.
    const textInputs = row.locator('input[type="text"]');
    await textInputs.nth(0).fill(date); // Date — overrides today's default
    await textInputs.nth(0).press("Tab"); // commit + blur, fires onchange
    await page.waitForLoadState("networkidle"); // wait for the date postback
    // textInputs.nth(1) = Start Time — leave at form default 08:30
    await textInputs.nth(2).fill(HOURS); // Hours, now safe to set

    // Remarks
    await row.locator("textarea").first().fill(REMARKS);

    // Save this row (exits edit mode if successful)
    await row.locator('a:has-text("Update")').click();
    await page.waitForLoadState("networkidle");

    // If Update succeeded the row no longer has "Update | Cancel" links — it shows "Edit | Delete".
    // If it still has them, Empower rejected the row with a validation error.
    const stillEditing = await page
      .locator("tr", { has: page.locator('a:has-text("Update")') })
      .count();

    if (stillEditing === 0) {
      console.log(`   ✓ Saved ${date}`);
      results.saved.push(date);
      continue;
    }

    // Read the error text shown above the form and print a snippet.
    // Exclude bare "Please Select" placeholders so the real error isn't drowned out.
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const errSnippet = bodyText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== "please select")
      .filter((s) => /already|valid|invalid|error|please [a-z]{3,}/i.test(s))
      .join(" | ")
      .slice(0, 400);
    console.log(
      `   ↳ Empower error text: "${errSnippet || "(none captured)"}"`,
    );

    // Is this row's date in the future (later than today)?
    // If so, route the screenshot to a separate folder so we can track them apart.
    const [mm, dd, yyyy] = date.split("/").map(Number);
    const rowDate = new Date(yyyy, mm - 1, dd);
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const isFutureDate = rowDate > todayMidnight;

    const safeDate = date.replaceAll("/", "-");
    const errDir = isFutureDate
      ? path.join(SCREENSHOTS_DIR, "future-timesheet")
      : SCREENSHOTS_DIR;
    if (isFutureDate) fs.mkdirSync(errDir, { recursive: true });
    const errShotPath = path.join(errDir, `error_${safeDate}_${timePart}.png`);
    await page.screenshot({ path: errShotPath, fullPage: true });
    console.log(`   ↳ Error screenshot: ${errShotPath}`);

    const errLower = bodyText.toLowerCase();
    const isDuplicate =
      /already exists|already.*published|valid time slot/.test(errLower);
    const isUnsavedRow = /save one record at a time|please update row/.test(
      errLower,
    );

    if (isFutureDate) {
      console.log(`   ⏭ Skipping ${date}: future date, Empower rejected it`);
      results.skipped.push(date);
    } else if (isDuplicate) {
      console.log(`   ⏭ Skipping ${date}: already published in Empower`);
      results.skipped.push(date);
    } else if (isUnsavedRow) {
      console.log(
        `   ⚠ Empower flagged the row as unsaved — discarding and moving on`,
      );
      results.failed.push({ date, reason: "unsaved-row guard" });
    } else {
      console.log(`   ⚠ Unknown validation error for ${date}; discarding row`);
      results.failed.push({ date, reason: "unknown", text: errSnippet });
    }

    // Discard the rejected row so the next iteration starts clean
    const rejectedRow = page.locator("tr", {
      has: page.locator('a:has-text("Update")'),
    });
    if ((await rejectedRow.count()) > 0) {
      await rejectedRow
        .locator('a:has-text("Cancel")')
        .first()
        .evaluate((el) => el.click());
      await page.waitForLoadState("networkidle");
    }
  }

  console.log("Summary:", JSON.stringify(results, null, 2));

  // ===== Publish all 5 entries together =====
  console.log("[4] Publishing all timesheet entries...");
  // await page.click('input[value="Publish All Timesheet Entries"]');
  await page.waitForLoadState("networkidle");

  // Final screenshot for verification
  await page.waitForTimeout(5000);
  await page.screenshot({ path: finalScreenshot, fullPage: true });
  console.log(`Done. Screenshot saved to ${finalScreenshot}`);
  await browser.close();
})();
