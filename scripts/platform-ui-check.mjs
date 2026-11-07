import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

await mkdir("docs/media", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const mac of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 520, height: 300 },
      deviceScaleFactor: 1.5,
    });
    if (mac)
      await context.addInitScript(() =>
        Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }),
      );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const primary = mac ? "Meta" : "Control";
    await page.goto("http://127.0.0.1:1432");
    await page.getByRole("button", { name: "外觀與設定" }).click();
    assert.ok(
      (await page.locator(".pane").innerText()).includes(
        mac ? "⌘ + ⌥ + S" : "Ctrl + Alt + S",
      ),
    );
    await page.locator("[data-look=terminal]").click();
    await page.getByRole("button", { name: "自選", exact: true }).click();
    await page.locator(mac ? ".mac-terminal" : ".windows-terminal").waitFor();
    const input = page.getByRole("textbox", { name: "終端機模式指令" });
    await input.fill("hel");
    await page.waitForTimeout(1300);
    assert.equal(await input.inputValue(), "hel");
    await input.fill("help");
    await input.press("Enter");
    await page.waitForFunction(() =>
      document
        .querySelector(".console-output")
        .textContent.includes("watch | list"),
    );
    const output = await page.locator(".console-output").innerText();
    assert.ok(output.includes(mac ? "work@Mac ~ %" : "PS C:\\Work>"));
    if (mac) {
      assert.equal(
        await page.locator(".native-controls,.terminal-tab").count(),
        0,
      );
      assert.equal(await page.locator(".mac-controls button").count(), 3);
      assert.ok((await page.locator(".mac-controls").boundingBox()).x < 30);
      await page.screenshot({ path: "docs/media/mac-terminal-preview.png" });
    }
    await input.press(`${primary}+,`);
    await page.locator("[data-look=txt]").click();
    await page.getByRole("button", { name: "自選", exact: true }).click();
    await page.locator(mac ? ".mac-textedit" : ".windows-notepad").waitFor();
    const editor = page.getByRole("textbox", { name: "工作紀錄文字內容" });
    await editor.evaluate((el) => {
      el.focus();
      el.setSelectionRange(0, 4);
      el.dataset.identity = "preserved";
    });
    await page.waitForTimeout(1300);
    assert.equal(
      await editor.evaluate((el) => el.dataset.identity),
      "preserved",
    );
    assert.equal(
      await editor.evaluate((el) => el.selectionEnd - el.selectionStart),
      4,
    );
    await editor.press(`${primary}+=`);
    assert.equal(await page.locator(".zoom-status").textContent(), "110%");
    if (mac) {
      assert.equal(
        await page
          .locator(".notepad-menubar,.notepad-tab,.native-controls")
          .count(),
        0,
      );
      assert.equal(await page.locator(".notepad-status").isVisible(), false);
      assert.ok(
        !(await page.locator(".mac-textedit").innerText()).includes("CRLF"),
      );
      await editor.press(`${primary}+0`);
      await editor.evaluate((el) => el.setSelectionRange(0, 0));
      await page.screenshot({ path: "docs/media/mac-textedit-preview.png" });
    } else
      assert.ok(
        (await page.locator(".notepad-status").innerText()).includes(
          "Windows (CRLF)",
        ),
      );
    await editor.press(`${primary}+,`);
    await page.locator("#display-mode").selectOption("minimal");
    await page.getByRole("button", { name: "自選", exact: true }).click();
    assert.equal(await page.locator(".minimal-stock").count(), 3);
    await page.locator(".minimal-stock").first().hover();
    await page.locator(".browser-detail").waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: Windows/Mac UI branches, prompts, primary shortcuts, text/input preservation, zoom, minimal hover and platform-specific settings hints. Mac tested as browser UI preview only.",
  );
} finally {
  await browser.close();
}
