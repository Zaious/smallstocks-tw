import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

// Render the actual app UI at 4× density rather than enlarging older screenshots.
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const mac of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 360, height: 168 },
      deviceScaleFactor: 4,
    });
    if (mac)
      await context.addInitScript(() =>
        Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }),
      );
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:1432");
    await page.locator(".quote").first().waitFor();
    if (!mac) {
      await page.screenshot({ path: "site/media/numbers.png" });
      await page.locator("#row-display").click();
      await page.locator(".trend-slot svg").nth(2).waitFor();
      await page.screenshot({ path: "site/media/trend.png" });
      await page.locator("#row-display").click();
      await page.setViewportSize({ width: 360, height: 30 });
      await page.locator(".direction-piece").first().waitFor();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: "site/media/minimal.png" });
      await page.locator(".minimal-stock").first().hover();
      await page.locator(".browser-detail").waitFor({ state: "visible" });
      await page
        .locator(".browser-detail")
        .screenshot({ path: "site/media/hover.png" });
      await page.mouse.move(0, 0);
      await page.setViewportSize({ width: 520, height: 420 });
      await page.locator("#minimal-settings").click();
      await page.locator("[data-look=gray]").click();
      await page.getByRole("button", { name: "自選", exact: true }).click();
      await page.setViewportSize({ width: 360, height: 30 });
      await page.screenshot({ path: "site/media/gray.png" });
    }
    await page.setViewportSize({ width: 520, height: 420 });
    if (await page.locator("#minimal-settings").count())
      await page.locator("#minimal-settings").click();
    else await page.getByRole("button", { name: "外觀與設定" }).click();
    await page.locator("#display-mode").selectOption("numbers");
    await page.locator("[data-look=terminal]").click();
    await page.getByRole("button", { name: "自選", exact: true }).click();
    await page.setViewportSize({ width: 520, height: 300 });
    await page.locator(".console-output").waitFor();
    assert.ok(
      (await page.locator(".console-output").innerText()).includes("[demo]"),
    );
    await page.screenshot({
      path: `site/media/${mac ? "mac" : "windows"}-terminal.png`,
    });
    await page
      .getByRole("textbox", { name: "終端機模式指令" })
      .press(`${mac ? "Meta" : "Control"}+,`);
    await page.locator("[data-look=txt]").click();
    await page.getByRole("button", { name: "自選", exact: true }).click();
    await page.getByRole("textbox", { name: "工作紀錄文字內容" }).waitFor();
    await page.screenshot({
      path: `site/media/${mac ? "mac" : "windows"}-text.png`,
    });
    await context.close();
  }
  console.log(
    "Rendered small numbers/trend/minimal/hover/gray and both platform disguise pairs at 4× density using synthetic app preview",
  );
} finally {
  await browser.close();
}
