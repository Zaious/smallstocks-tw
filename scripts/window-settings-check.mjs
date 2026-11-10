import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const root = process.cwd(),
  dir = path.join(root, ".local-test", "window-settings-" + Date.now());
await mkdir(dir, { recursive: true });
await mkdir(path.join(root, "docs/media"), { recursive: true });
const exe =
  process.env.SMALLSTOCKS_EXE ??
  path.join(root, "src-tauri/target/release/smallstocks-tw.exe");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, check = Boolean) {
  for (let n = 0; n < 100; n++) {
    try {
      const value = await read();
      if (check(value)) return value;
    } catch {}
    await wait(300);
  }
  throw new Error("Timed out waiting for desktop state");
}
let app, browser, main, tip, connection;
async function start() {
  const started = Date.now();
  app = spawn(exe, ["--demo"], {
    env: {
      ...process.env,
      SMALLSTOCKS_CONFIG_DIR: dir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9345",
      WEBVIEW2_USER_DATA_FOLDER: path.join(dir, "webview"),
    },
    windowsHide: true,
    stdio: "ignore",
  });
  connection = await until(async () => {
    const file = path.join(dir, "mcp-connection.json");
    if ((await stat(file)).mtimeMs < started) return null;
    return JSON.parse(await readFile(file, "utf8"));
  });
  browser = await until(() => chromium.connectOverCDP("http://127.0.0.1:9345"));
  main = await until(async () =>
    browser
      .contexts()[0]
      .pages()
      .find(
        (p) =>
          p.url() !== "about:blank" &&
          !p.url().includes("detail") &&
          !p.url().includes("notify"),
      ),
  );
  await main.locator(".shell").waitFor();
  tip = await until(async () =>
    browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes("detail")),
  );
}
async function stop() {
  await browser?.close().catch(() => {});
  browser = null;
  if (app?.exitCode === null) {
    const exited = once(app, "exit");
    app.kill();
    await exited;
  }
  app = null;
}
async function tool(name, args = {}) {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const result = (await response.json()).result;
  assert.equal(result.isError, false, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}
const native = (cmd) =>
  main.evaluate(
    (cmd) =>
      window.__TAURI_INTERNALS__.invoke(`plugin:window|${cmd}`, {
        label: "main",
      }),
    cmd,
  );
try {
  await start();
  assert.equal((await tool("get_status")).settings.alwaysOnTop, true);
  assert.equal(await native("is_always_on_top"), true);
  // The pin button sits next to the hide button and must flip the real window state both ways.
  await main.locator("#pin").click();
  await until(
    () => native("is_always_on_top"),
    (v) => v === false,
  );
  assert.equal(
    await main.locator("#pin").getAttribute("aria-pressed"),
    "false",
    "pin button shows the unpinned state",
  );
  await main.locator("#pin").click();
  await until(
    () => native("is_always_on_top"),
    (v) => v === true,
  );
  assert.equal(await main.locator("#pin").getAttribute("aria-pressed"), "true");
  // The true-hide button hides everything like the shortcut; the shared toggle brings it back.
  await main.locator("#stealth").click();
  await until(
    () => native("is_visible"),
    (v) => v === false,
  );
  await main.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("privacy_toggle"),
  );
  await until(
    () => native("is_visible"),
    (v) => v === true,
  );
  // Other tabs grow downward only: the width, including one the user chose, is kept.
  const box = () => main.evaluate(() => [innerWidth, innerHeight]);
  await main.locator('[data-tab="watch"]').click();
  await until(
    async () => (await box())[1],
    (h) => h <= 180,
  );
  const [startWidth, startHeight] = await box();
  await main.locator('[data-tab="daily"]').click();
  await until(
    async () => (await box())[1],
    (h) => h >= 380,
  );
  assert.equal((await box())[0], startWidth, "width kept when a pane opens");
  await main.locator('[data-tab="watch"]').click();
  await until(
    async () => (await box())[1],
    (h) => h <= startHeight + 2,
  );
  assert.equal((await box())[0], startWidth, "width kept on the way back");
  // A width the user drags to survives the same round trip.
  await main.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("plugin:window|set_size", {
      label: "main",
      value: { Logical: { width: 430, height: 200 } },
    }),
  );
  await until(
    async () => (await box())[0],
    (w) => Math.abs(w - 430) <= 1,
  );
  await main.locator('[data-tab="rules"]').click();
  await until(
    async () => (await box())[1],
    (h) => h >= 380,
  );
  assert.ok(
    Math.abs((await box())[0] - 430) <= 1,
    "dragged width kept in a pane",
  );
  await main.locator('[data-tab="watch"]').click();
  await until(
    async () => (await box())[1],
    (h) => h <= 200,
  );
  assert.ok(
    Math.abs((await box())[0] - 430) <= 1,
    "dragged width kept on return",
  );
  await main.evaluate(
    (width) =>
      window.__TAURI_INTERNALS__.invoke("plugin:window|set_size", {
        label: "main",
        value: { Logical: { width, height: 200 } },
      }),
    startWidth,
  );

  await until(
    async () => (await box())[0],
    (w) => Math.abs(w - startWidth) <= 1,
  );
  await main.locator('[data-tab="settings"]').click();
  await main.locator("#always-on-top").uncheck();
  await until(
    () => native("is_always_on_top"),
    (v) => v === false,
  );
  assert.equal((await tool("get_status")).settings.alwaysOnTop, false);
  for (const appearance of ["gray", "terminal", "txt", "small"]) {
    await tool("set_settings", { appearance });
    assert.equal(
      await native("is_always_on_top"),
      false,
      "appearance keeps topmost choice",
    );
  }
  await main.locator('[data-tab="watch"]').click();
  await main.locator(".quote").first().waitFor();
  await until(() =>
    main.evaluate(() => innerWidth === 360 && innerHeight <= 180),
  );
  await main.screenshot({
    path: path.join(root, "docs/media/small-numbers.png"),
  });
  const rowHeight = await main
    .locator(".quote")
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(
    (await main.locator(".quote").first().getAttribute("title")).includes(
      "來源時間",
    ),
  );
  await main.locator("#row-display").click();
  await main.locator(".trend-slot svg").nth(2).waitFor();
  assert.equal(
    await main
      .locator(".quote")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
    rowHeight,
  );
  await main.screenshot({
    path: path.join(root, ".local-test/screenshots/small-trend-native.png"),
  });
  await main.locator("#row-display").click();
  await main.locator(".minimal-stock").first().hover();
  await tip.locator(".detail-heading").waitFor();
  await tip.screenshot({ path: path.join(root, "docs/media/small-hover.png") });
  await native("hide");
  await tool("set_settings", { alwaysOnTop: true });
  assert.equal(
    await native("is_always_on_top"),
    true,
    "MCP applies while window is hidden",
  );
  assert.equal(
    await native("is_visible"),
    false,
    "changing topmost does not show a hidden window",
  );
  await tool("set_settings", { alwaysOnTop: false });
  assert.equal(await native("is_always_on_top"), false);
  await stop();
  await start();
  assert.equal((await tool("get_status")).settings.alwaysOnTop, false);
  assert.equal(
    await native("is_always_on_top"),
    false,
    "topmost choice restored at startup",
  );
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "state.json"), "utf8")).settings
      .alwaysOnTop,
    false,
  );
  assert.equal(
    (await tool("get_status")).privacyShortcutError,
    null,
    "global three-key shortcut registered",
  );
  await native("show");
  await main.locator(".minimal-stock").first().hover();
  await tip.locator(".detail-heading").waitFor();
  await main.keyboard.press("Control+Alt+s");
  await until(
    () => native("is_visible"),
    (value) => value === false,
  );
  for (const label of ["detail", "notify"]) {
    assert.equal(
      await main.evaluate(
        (label) =>
          window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", {
            label,
          }),
        label,
      ),
      false,
    );
  }
  assert.equal(
    (await tool("get_status")).settings.paused,
    false,
    "privacy hide keeps monitoring enabled",
  );
  // Shared way back: the shortcut handler is `privacy_toggle`. Hidden -> shown, shown -> hidden,
  // and a minimized window is brought back rather than hidden.
  const toggle = () =>
    main.evaluate(() => window.__TAURI_INTERNALS__.invoke("privacy_toggle"));
  await toggle();
  await until(
    () => native("is_visible"),
    (value) => value === true,
  );
  await toggle();
  await until(
    () => native("is_visible"),
    (value) => value === false,
  );
  await toggle();
  await until(
    () => native("is_visible"),
    (value) => value === true,
  );
  await native("minimize");
  await until(
    () => native("is_minimized"),
    (value) => value === true,
  );
  await toggle();
  await until(
    () => native("is_minimized"),
    (value) => value === false,
  );
  assert.equal(await native("is_visible"), true, "back from minimized");
  console.log(
    "PASS: topmost UI/MCP/native persistence; three-key shortcut registered, key handling hides all windows without pausing and the same toggle brings them back (also from minimized); pin button flips the real topmost state; panes keep the width (also a dragged one) and grow downward only; actual small numbers/trend/hover screenshots",
  );
} finally {
  await stop();
}
