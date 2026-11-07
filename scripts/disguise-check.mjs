import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 520, height: 300 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const output = path.join(process.cwd(), ".local-test/screenshots");
await mkdir(output, { recursive: true });
try {
  await page.goto("http://127.0.0.1:1432");
  await page.getByRole("button", { name: "外觀與設定" }).click();
  await page.locator("[data-look=terminal]").click();
  await page.getByRole("button", { name: "自選", exact: true }).click();
  await page.locator(".console-output").waitFor();
  assert.equal(await page.locator(".shell > header").isVisible(), false);
  assert.equal(await page.locator(".shell > nav").isVisible(), false);
  assert.equal(await page.locator(".shell > footer").isVisible(), false);
  const rights = await page
    .locator(".console-field.last")
    .evaluateAll((cells) => cells.map((c) => c.getBoundingClientRect().right));
  assert.ok(
    rights.every((x) => Math.abs(x - rights[0]) < 1),
    "terminal numeric columns aligned",
  );
  const input = page.getByRole("textbox", { name: "終端機模式指令" });
  await input.fill("hel");
  await page.waitForTimeout(2300);
  assert.equal(await input.inputValue(), "hel");
  await input.fill("help");
  await input.press("Enter");
  await page.waitForFunction(() =>
    document
      .querySelector(".console-output")
      .textContent.includes("watch | list"),
  );
  await input.fill("pause");
  await input.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector(".console-output").textContent.includes("PAUSED"),
  );
  await input.fill("resume");
  await input.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector(".console-output").textContent.includes("RUNNING"),
  );
  await input.fill("clear");
  await input.press("Enter");
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(output, "terminal-native.png") });
  await input.press("Control+,");
  await page.locator("[data-look=txt]").waitFor();
  await page.locator("[data-look=txt]").click();
  await page.getByRole("button", { name: "自選", exact: true }).click();
  await page.setViewportSize({ width: 500, height: 300 });
  const editor = page.getByRole("textbox", { name: "工作紀錄文字內容" });
  await editor.waitFor();
  assert.equal(await editor.getAttribute("readonly"), "");
  assert.equal(
    await page
      .locator(".notepad-menubar summary")
      .allTextContents()
      .then((x) => x.join("/")),
    "檔案/編輯/檢視",
  );
  assert.ok(
    (await page.locator(".notepad-status").textContent()).includes(
      "Windows (CRLF)",
    ),
  );
  const selected = await editor.evaluate((el) => {
    el.focus();
    el.dataset.identity = "original";
    el.setSelectionRange(0, 4);
    return el.value.slice(0, 4);
  });
  await page.waitForTimeout(2300);
  assert.deepEqual(
    await editor.evaluate((el) => ({
      text: el.value.slice(el.selectionStart, el.selectionEnd),
      identity: el.dataset.identity,
    })),
    { text: selected, identity: "original" },
  );
  await page
    .locator(".notepad-menubar summary")
    .filter({ hasText: "檢視" })
    .click();
  await page.getByRole("menuitem", { name: /^放大/ }).click();
  assert.equal(await page.locator(".zoom-status").textContent(), "110%");
  await page
    .locator(".notepad-menubar summary")
    .filter({ hasText: "檢視" })
    .click();
  await page.getByRole("menuitemcheckbox", { name: "狀態列" }).click();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator(".notepad-status").isVisible(), false);
  await page
    .locator(".notepad-menubar summary")
    .filter({ hasText: "檢視" })
    .click();
  await page.getByRole("menuitemcheckbox", { name: "狀態列" }).click();
  await page
    .locator(".notepad-menubar summary")
    .filter({ hasText: "檢視" })
    .click();
  await page.getByRole("menuitem", { name: /還原預設/ }).click();
  await editor.evaluate((el) => el.setSelectionRange(0, 0));
  await page.screenshot({ path: path.join(output, "notepad-native.png") });
  await page
    .locator(".notepad-menubar summary")
    .filter({ hasText: "檔案" })
    .click();
  await page.getByRole("menuitem", { name: "返回 small" }).click();
  await page.locator(".quote").first().waitFor();
  assert.equal(await page.locator(".shell > nav").isVisible(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: native chrome, aligned terminal cells, input and selection survive polling, view commands, Notepad menus/zoom/status, return to small, no page errors",
  );
} finally {
  await browser.close();
}
