const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const STATE_PATH = path.join(__dirname, ".auth", "session.json");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log("[setup] Opening login page — please log in manually...");
  await page.goto("https://empower.intsof.com/Login.aspx");

  console.log("[setup] Waiting for you to log in... (up to 3 minutes)");
  await page.waitForSelector("text=Home", { timeout: 180000 });

  console.log("[setup] Login detected. Saving session...");
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STATE_PATH });

  console.log(`[setup] Saved to ${STATE_PATH}.`);
  await browser.close();
})();
