import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const root = process.cwd();
const config = path.join(root, ".local-test", "native-" + Date.now());
await mkdir(config, { recursive: true });
const exe =
  process.env.SMALLSTOCKS_EXE ??
  path.join(root, "src-tauri", "target", "release", "smallstocks-tw.exe");
const env = {
  ...process.env,
  SMALLSTOCKS_CONFIG_DIR: config,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9338",
  WEBVIEW2_USER_DATA_FOLDER: path.join(config, "webview"),
};
const app = spawn(exe, ["--demo"], { env, windowsHide: true, stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  let connection;
  for (let i = 0; i < 60; i++) {
    try {
      connection = JSON.parse(
        await readFile(path.join(config, "mcp-connection.json"), "utf8"),
      );
      break;
    } catch {}
    await wait(500);
  }
  assert.ok(connection, "desktop started and published local connection");
  assert.equal(
    (await fetch(connection.url, { method: "POST", body: "{}" })).status,
    401,
  );
  let id = 0;
  const rpc = async (method, params = {}) => {
    const response = await fetch(connection.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const tool = async (name, args = {}) => {
    const result = (await rpc("tools/call", { name, arguments: args })).result;
    assert.equal(result.isError, false, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  assert.equal(
    (
      await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      })
    ).result.serverInfo.name,
    "smallstocks-tw",
  );
  assert.equal((await rpc("tools/list")).result.tools.length, 9);
  await tool("set_settings", { refreshSeconds: 5, appearance: "gray" });
  let state = await tool("upsert_rule", {
    symbol: "2330",
    metric: "price",
    direction: "below",
    threshold: 1005,
    channel: "card",
    repeat: "daily",
  });
  assert.equal(state.rules.length, 1);
  const ruleId = state.rules[0].id;
  const bridge = spawn(exe, ["--mcp", "--demo"], {
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  bridge.stdout.on("data", (b) => (stdout += b));
  bridge.stdin.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "list_rules", arguments: {} },
    }) + "\n",
  );
  await new Promise((resolve, reject) => {
    bridge.on("error", reject);
    bridge.on("exit", resolve);
  });
  const reply = JSON.parse(stdout.trim());
  assert.equal(reply.id, 42);
  assert.equal(JSON.parse(reply.result.content[0].text)[0].id, ruleId);
  console.log(
    "PASS: desktop core, authenticated localhost RPC, MCP initialize/tools, stdio bridge, shared persistent rule",
  );
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9338");
      break;
    } catch {}
    await wait(500);
  }
  assert.ok(browser, "WebView2 CDP available");
  let pages = browser.contexts()[0].pages();
  let main;
  for (let attempt = 0; attempt < 60; attempt++) {
    pages = browser.contexts()[0].pages();
    main = pages.find(
      (p) =>
        p.url() !== "about:blank" &&
        !p.url().includes("notify") &&
        !p.url().includes("detail") &&
        !p.url().includes("devtools"),
    );
    if (main) break;
    await wait(500);
  }
  console.log(
    "Webviews:",
    pages.map((p) => p.url()),
  );
  assert.ok(main, "main webview");
  await main.locator("nav").waitFor();
  await main.getByRole("button", { name: /提醒/ }).click();
  assert.ok((await main.locator(".rule").innerText()).includes("1,005"));
  await main.getByRole("button", { name: "自選", exact: true }).click();
  const screenDir = path.join(root, ".local-test", "screenshots");
  await mkdir(screenDir, { recursive: true });
  for (const look of ["small", "gray", "terminal", "txt"]) {
    await tool("set_settings", { appearance: look });
    await wait(1600);
    await main.screenshot({
      path: path.join(screenDir, `desktop-${look}.png`),
    });
    assert.equal(
      await main.evaluate(() => document.body.dataset.appearance),
      look,
    );
    if (look === "terminal" || look === "txt") {
      assert.equal(await main.locator(".shell > header").isVisible(), false);
      assert.equal(await main.locator(".shell > nav").isVisible(), false);
      assert.equal(await main.locator(".native-controls").count(), 1);
      assert.equal(
        await main.locator("#message").isVisible(),
        false,
        "native title and chrome commands permitted",
      );
      if (look === "terminal") {
        const before = await main.evaluate(() => innerHeight);
        await main.getByRole("button", { name: "最大化或還原" }).click();
        await main.waitForFunction((h) => innerHeight > h, before);
        await main.getByRole("button", { name: "最大化或還原" }).click();
        await main.waitForFunction((h) => innerHeight === h, before);
      }
    }
  }
  let event;
  for (let i = 0; i < 45; i++) {
    state = await tool("get_status");
    event = state.events.find((e) => e.ruleId === ruleId);
    if (event) break;
    await wait(1000);
  }
  assert.ok(
    event,
    "synthetic quote crossed threshold and produced persistent event",
  );
  const notify = pages.find((p) => p.url().includes("notify"));
  assert.ok(notify);
  await notify.locator(".item").waitFor({ timeout: 10000 });
  await notify.screenshot({ path: path.join(screenDir, "desktop-notice.png") });
  const persisted = JSON.parse(
    await readFile(path.join(config, "state.json"), "utf8"),
  );
  assert.equal(persisted.events[0].ruleId, ruleId);
  console.log(
    "PASS: real Tauri views, agent-created rule visible in UI, live synthetic crossing, separate notification window, event saved to disk",
  );
  await tool("set_settings", { paused: true });
  state = await tool("get_status");
  assert.equal(state.settings.paused, true);
} finally {
  if (browser) await browser.close().catch(() => {});
  app.kill();
}
