import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const root = process.cwd(),
  dir = path.join(root, ".local-test", "minimal-native-" + Date.now());
await mkdir(dir, { recursive: true });
const exe =
  process.env.SMALLSTOCKS_EXE ??
  path.join(root, "src-tauri/target/release/smallstocks-tw.exe");
const app = spawn(exe, ["--demo"], {
  env: {
    ...process.env,
    SMALLSTOCKS_CONFIG_DIR: dir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9343",
    WEBVIEW2_USER_DATA_FOLDER: path.join(dir, "webview"),
  },
  windowsHide: true,
  stdio: "ignore",
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  let c;
  for (let i = 0; i < 60; i++) {
    try {
      c = JSON.parse(
        await readFile(path.join(dir, "mcp-connection.json"), "utf8"),
      );
      break;
    } catch {}
    await wait(500);
  }
  assert.ok(c);
  const tool = async (name, args = {}) => {
    const response = await fetch(c.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const r = (await response.json()).result;
    assert.equal(r.isError, false, JSON.stringify(r));
    return JSON.parse(r.content[0].text);
  };
  let s = await tool("get_status");
  assert.equal(s.settings.showCodes, false);
  for (let i = 0; i < 30 && !s.quotes["2330"]; i++) {
    await wait(300);
    s = await tool("get_status");
  }
  await tool("set_settings", { rowDisplay: "minimal" });
  for (let i = 0; i < 40; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9343");
      break;
    } catch {}
    await wait(300);
  }
  assert.ok(browser);
  let main, tip;
  for (let i = 0; i < 40; i++) {
    const pages = browser.contexts()[0].pages();
    main = pages.find(
      (p) =>
        p.url() !== "about:blank" &&
        !p.url().includes("notify") &&
        !p.url().includes("detail"),
    );
    tip = pages.find((p) => p.url().includes("detail"));
    if (main && tip) break;
    await wait(300);
  }
  assert.ok(main);
  assert.ok(tip);
  await main.locator(".minimal-stock").first().waitFor();
  await main.waitForFunction(() => innerHeight <= 40);
  const size = await main.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  assert.equal(size.w, 360);
  assert.equal(await main.locator(".minimal-code").count(), 0);
  await main.screenshot({
    path: path.join(root, ".local-test/screenshots/desktop-minimal-small.png"),
  });
  const focused = await main.evaluate(() => document.hasFocus());
  await main.locator('[data-mini-stock="2330"]').hover();
  await tip.locator(".detail-heading").waitFor();
  assert.ok((await tip.locator("#detail").textContent()).includes("2330"));
  assert.equal(
    await main.evaluate(() => document.hasFocus()),
    focused,
    "details do not steal focus",
  );
  assert.equal(
    await main.evaluate(() => innerHeight),
    size.h,
    "details do not expand the bar",
  );
  await tip.screenshot({
    path: path.join(root, ".local-test/screenshots/desktop-minimal-detail.png"),
  });
  await main.mouse.move(0, 0);
  await wait(400);
  assert.equal(
    await tip.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", {
        label: "detail",
      }),
    ),
    false,
  );
  await tool("set_settings", { showCodes: true });
  await main.locator(".minimal-code").first().waitFor();
  assert.equal(await main.locator(".minimal-code").count(), 3);
  await tool("set_settings", { showCodes: false });
  await tool("set_watchlist", {
    symbols: [
      "2330",
      "0050",
      "2317",
      "2454",
      "2303",
      "2881",
      "2882",
      "1301",
      "2412",
      "2603",
    ],
  });
  await main.waitForFunction(
    () => document.querySelectorAll(".minimal-stock").length === 10,
  );
  const setWidth = (width) =>
    main.evaluate(
      (width) =>
        window.__TAURI_INTERNALS__.invoke("plugin:window|set_size", {
          label: "main",
          value: { Logical: { width, height: 200 } },
        }),
      width,
    );
  await setWidth(700);
  await main.waitForFunction(() => innerWidth === 700);
  await wait(500);
  const wide = await main.evaluate(() => ({
    h: innerHeight,
    list: document.querySelector(".minimal-list").getBoundingClientRect()
      .height,
  }));
  await setWidth(300);
  await main.waitForFunction(() => innerWidth === 300);
  await wait(600);
  const narrow = await main.evaluate(() => ({
    w: innerWidth,
    h: innerHeight,
    list: document.querySelector(".minimal-list").getBoundingClientRect()
      .height,
  }));
  assert.equal(narrow.w, 300);
  assert.ok(narrow.list > wide.list);
  assert.ok(
    narrow.h > wide.h,
    "auto height follows wrapping without resetting chosen width",
  );
  await tool("set_watchlist", { symbols: ["2330", "0050", "t00"] });
  await setWidth(500);
  await main.waitForFunction(() => innerWidth === 500);
  for (const look of ["gray", "terminal", "txt"]) {
    await tool("set_settings", { appearance: look });
    await main.waitForFunction(
      (x) => document.body.dataset.appearance === x,
      look,
    );
    await wait(500);
    assert.equal(await main.locator(".minimal-stock").count(), 3);
    if (look === "terminal" || look === "txt") {
      assert.equal(await main.locator(".native-title").count(), 1);
      assert.equal(await main.locator(".shell>nav").isVisible(), false);
    }
    await main.screenshot({
      path: path.join(
        root,
        `.local-test/screenshots/desktop-minimal-${look}.png`,
      ),
    });
    if (look === "terminal") {
      await main.locator(".terminal-titlebar summary").click();
      await main
        .getByRole("menuitem", { name: /^設定/ })
        .waitFor({ state: "visible" });
      const menuBox = await main
        .locator(".native-menu[open] .native-popup")
        .boundingBox();
      await wait(500);
      assert.ok(
        menuBox.y + menuBox.height <= (await main.evaluate(() => innerHeight)),
        "native menus fit in minimal mode",
      );
      await main.locator(".terminal-titlebar summary").click();
    }
  }
  const saved = JSON.parse(
    await readFile(path.join(dir, "state.json"), "utf8"),
  );
  assert.equal(saved.settings.rowDisplay, "minimal");
  assert.equal(saved.settings.showCodes, false);
  console.log(
    "PASS: four desktop skins, separate unfocused hover window, optional codes, user-width wrapping/auto-height, native menus, saved settings",
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  app.kill();
}
