import { spawn } from "node:child_process";
import { readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const root = process.cwd(),
  dir =
    process.env.SMALLSTOCKS_TEST_CONFIG_DIR ??
    path.join(root, ".local-test", "intraday-" + Date.now());
await mkdir(dir, { recursive: true });
const exe =
  process.env.SMALLSTOCKS_EXE ??
  path.join(root, "src-tauri/target/release/smallstocks-tw.exe");
const startedAt = Date.now();
const app = spawn(exe, [], {
  env: {
    ...process.env,
    SMALLSTOCKS_CONFIG_DIR: dir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9341",
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
      if (
        (await stat(path.join(dir, "mcp-connection.json"))).mtimeMs < startedAt
      )
        throw new Error("Starting current instance");
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
  await tool("set_watchlist", {
    symbols: ["2330", "0050", "t00", "6488", "o00"],
  });
  await tool("set_settings", { rowDisplay: "numbers" });
  for (const symbol of ["2330", "0050", "t00", "6488", "o00"])
    await tool("get_intraday_history", { symbol });
  for (const symbol of ["2330", "0050", "t00", "6488"]) {
    let v;
    for (let i = 0; i < 120; i++) {
      v = await tool("get_intraday_history", { symbol });
      if (!v.pending) break;
      await wait(500);
    }
    assert.equal(v.error, null, JSON.stringify(v));
    assert.ok(
      v.series.points.filter((p) => p.price != null).length > 2,
      symbol + " has real minute prices",
    );
    assert.ok(v.series.source.startsWith("Yahoo"));
    const today = new Date()
      .toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" })
      .replaceAll("-", "");
    assert.equal(v.series.date, today);
    assert.ok(
      v.series.points.every(
        (p) =>
          new Date(p.at)
            .toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" })
            .replaceAll("-", "") === today,
      ),
    );
    console.log(
      "PASS real minute backfill: " +
        symbol +
        ", points=" +
        v.series.points.length +
        ", partial=" +
        v.series.partial,
    );
  }
  let missing;
  for (let i = 0; i < 30; i++) {
    missing = await tool("get_intraday_history", { symbol: "o00" });
    if (!missing.pending) break;
    await wait(500);
  }
  assert.equal(missing.series, null);
  assert.ok(missing.error.includes("局部") || missing.error.includes("本機"));
  let status = await tool("get_status");
  assert.equal(status.events.length, 0);
  assert.ok(Object.values(status.quotes).every((q) => q.source === "TWSE MIS"));
  assert.equal(
    status.intraday["2330"].series.points,
    undefined,
    "MCP status omits raw chart points",
  );
  await tool("set_watchlist", { symbols: ["2330", "0050", "t00"] });
  for (let i = 0; i < 80; i++) {
    status = await tool("get_status");
    if (
      Object.values(status.dailySummaries).every(
        (v) => v.days.length > 1 && !v.pending,
      )
    )
      break;
    await wait(500);
  }
  browser = await chromium.connectOverCDP("http://127.0.0.1:9341");
  let main;
  for (let i = 0; i < 40; i++) {
    main = browser
      .contexts()[0]
      .pages()
      .find(
        (p) =>
          p.url() !== "about:blank" &&
          !p.url().includes("notify") &&
          !p.url().includes("detail"),
      );
    if (main) break;
    await wait(500);
  }
  assert.ok(main);
  await main.locator(".quote").first().waitFor();
  await main.waitForFunction(
    () =>
      document.querySelectorAll(".quote").length === 3 && innerHeight <= 150,
  );
  const initial = await main.evaluate(() => ({
    h: innerHeight,
    w: innerWidth,
    row: document.querySelector(".quote").getBoundingClientRect().height,
  }));
  await main.getByRole("button", { name: "切換顯示內容" }).click();
  await main.locator(".row-trend").first().waitFor();
  await wait(1000);
  assert.equal(await main.locator(".row-trend").count(), 3);
  assert.match(await main.locator("#row-display").textContent(), /近日線/);
  const after = await main.evaluate(() => ({
    h: innerHeight,
    w: innerWidth,
    row: document.querySelector(".quote").getBoundingClientRect().height,
  }));
  assert.deepEqual(after, initial);
  await main.screenshot({
    path: path.join(root, ".local-test/screenshots/desktop-inline-trend.png"),
  });
  await main.getByRole("button", { name: "切換顯示內容" }).click();
  await main.locator(".price").first().waitFor();
  assert.equal(await main.locator(".price").count(), 3);
  const saved = JSON.parse(
    await readFile(path.join(dir, "state.json"), "utf8"),
  );
  assert.equal(saved.settings.rowDisplay, "numbers");
  console.log(
    "PASS: source separation, missing-index fallback, unchanged 22px rows/window, closed daily charts, toggle persistence",
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  app.kill();
}
