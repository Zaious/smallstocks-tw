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
  console.log(
    "PASS: default topmost, UI toggle, all skins, hidden MCP changes, persistence and native startup restoration; actual small numbers/trend/hover screenshots",
  );
} finally {
  await stop();
}
