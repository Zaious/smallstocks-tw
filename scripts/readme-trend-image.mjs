import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

// The built-in browser preview provides an explicitly synthetic full session,
// so this illustration remains useful before the real market opens.
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 360, height: 168 },
    deviceScaleFactor: 1.5,
  });
  await page.goto("http://127.0.0.1:1432");
  await page.locator(".quote").first().waitFor();
  await page.locator("#row-display").click();
  await page.locator(".trend-slot svg").nth(2).waitFor();
  assert.ok((await page.locator("#banner").innerText()).includes("合成行情"));
  assert.equal(
    await page
      .locator(".quote")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
    22,
  );
  await page.screenshot({ path: "docs/media/small-trend.png" });
  console.log(
    "Saved labelled synthetic full-session trend illustration using the actual preview UI",
  );
} finally {
  await browser.close();
}
