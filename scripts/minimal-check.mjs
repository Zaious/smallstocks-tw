import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 360, height: 160 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function settings() {
  await page.setViewportSize({ width: 520, height: 340 });
  if (await page.locator("[data-disguise=terminal]").count()) {
    await page.locator(".terminal-titlebar summary").click();
    await page.getByRole("menuitem", { name: /^設定/ }).click();
  } else if (await page.locator("[data-disguise=txt]").count())
    await page.getByRole("button", { name: "設定", exact: true }).click();
  else if (await page.locator("#minimal-settings").count())
    await page.getByRole("button", { name: "極簡顯示設定" }).click();
  else await page.getByRole("button", { name: "外觀與設定" }).click();
}
try {
  await page.goto("http://127.0.0.1:1432");
  await settings();
  assert.equal(await page.locator("#show-codes").isChecked(), false);
  await page.locator("#display-mode").selectOption("minimal");
  await page.getByRole("button", { name: "自選", exact: true }).click();
  await page.setViewportSize({ width: 360, height: 124 });
  await page.locator(".minimal-stock").first().waitFor();
  assert.equal(await page.locator(".minimal-stock").count(), 3);
  assert.equal(await page.locator(".price").count(), 0);
  assert.equal(await page.locator(".minimal-code").count(), 0);
  const first = page.locator('[data-mini-stock="2330"]');
  await first.hover();
  await page.locator(".browser-detail").waitFor({ state: "visible" });
  assert.ok(
    (await page.locator(".browser-detail").textContent()).includes("2330"),
  );
  await first.focus();
  await first.evaluate((el) => (el.dataset.identity = "stable"));
  await page.waitForTimeout(1300);
  assert.equal(await first.getAttribute("data-identity"), "stable");
  assert.ok(await first.evaluate((el) => document.activeElement === el));
  await first.press("Escape");
  assert.equal(await page.locator(".browser-detail").isVisible(), false);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(process.cwd(), ".local-test/screenshots/minimal-small.png"),
  });
  await first.click();
  await page.locator("#daily-symbol").waitFor();
  assert.equal(await page.locator("#daily-symbol").inputValue(), "2330");
  await settings();
  await page.locator("#show-codes").check();
  await page.getByRole("button", { name: "自選", exact: true }).click();
  assert.equal(await page.locator(".minimal-code").count(), 3);
  await settings();
  await page.locator("#show-codes").uncheck();
  await page.locator("#display-mode").selectOption("numbers");
  await page.getByRole("button", { name: "自選", exact: true }).click();
  assert.equal(await page.locator(".stock-code").count(), 0);
  await settings();
  await page.locator("#display-mode").selectOption("minimal");
  for (const look of ["small", "gray", "terminal", "txt"]) {
    if (!(await page.locator("[data-look]").count())) await settings();
    await page.locator(`[data-look=${look}]`).click();
    await page.getByRole("button", { name: "自選", exact: true }).click();
    await page.setViewportSize({
      width: look === "terminal" ? 520 : look === "txt" ? 500 : 360,
      height: look === "terminal" ? 170 : look === "txt" ? 190 : 124,
    });
    assert.equal(await page.locator(".minimal-stock").count(), 3);
    if (look === "terminal" || look === "txt") {
      assert.equal(await page.locator(".native-title").count(), 1);
      assert.equal(await page.locator(".shell>nav").isVisible(), false);
    }
    await page.screenshot({
      path: path.join(
        process.cwd(),
        `.local-test/screenshots/minimal-${look}.png`,
      ),
    });
    await settings();
  }
  await page.locator("[data-look=small]").click();
  await page.getByRole("button", { name: "自選", exact: true }).click();
  await settings();
  await page.getByRole("button", { name: "＋ 管理自選" }).click();
  await page
    .locator("#symbols")
    .fill("2330,0050,2317,2454,2303,2881,2882,1301,2412,2603");
  await page.getByRole("button", { name: "儲存自選" }).click();
  await page.setViewportSize({ width: 700, height: 260 });
  const wide = await page
    .locator(".minimal-list")
    .evaluate((el) => el.getBoundingClientRect().height);
  await page.setViewportSize({ width: 300, height: 300 });
  const narrow = await page
    .locator(".minimal-list")
    .evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(narrow > wide, "width determines wrapping");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: four skins, compact wrapping, details with hidden codes, focus survives updates, click-through, optional codes",
  );
} finally {
  await browser.close();
}
