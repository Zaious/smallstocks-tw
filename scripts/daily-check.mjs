import { spawn } from "node:child_process";
import { readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const root = process.cwd(),
  dir =
    process.env.SMALLSTOCKS_TEST_CONFIG_DIR ??
    path.join(root, ".local-test", "daily-" + Date.now());
await mkdir(dir, { recursive: true });
const startedAt = Date.now();
const app = spawn(
  process.env.SMALLSTOCKS_EXE ??
    path.join(root, "src-tauri/target/release/smallstocks-tw.exe"),
  [],
  {
    env: {
      ...process.env,
      SMALLSTOCKS_CONFIG_DIR: dir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9339",
      WEBVIEW2_USER_DATA_FOLDER: path.join(dir, "webview"),
    },
    windowsHide: true,
    stdio: "ignore",
  },
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  let c;
  for (let i = 0; i < 60; i++) {
    try {
      if (
        (await stat(path.join(dir, "mcp-connection.json"))).mtimeMs < startedAt
      )
        throw new Error("Waiting for current desktop instance");
      c = JSON.parse(
        await readFile(path.join(dir, "mcp-connection.json"), "utf8"),
      );
      break;
    } catch {}
    await wait(500);
  }
  assert.ok(c);
  const call = async (name, args = {}) => {
    const r = await fetch(c.url, {
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
    return (await r.json()).result;
  };
  const tool = async (name, args = {}) => {
    const r = await call(name, args);
    assert.equal(r.isError, false, JSON.stringify(r));
    return JSON.parse(r.content[0].text);
  };
  const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Taipei",
    }),
    month = today.slice(0, 7);
  const d = new Date(today + "T12:00:00+08:00");
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const previous = d
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" })
    .slice(0, 7);
  assert.equal(
    (await call("get_daily_history", { symbol: "2330", month: "2026-99" }))
      .isError,
    true,
  );
  const cases = [
    ["2330", month, "TWSE"],
    ["0050", month, "TWSE"],
    ["t00", previous, "TWSE"],
    ["6488", previous, "TPEx"],
    ["o00", previous, "TPEx"],
  ];
  for (const [symbol, month] of cases)
    await tool("get_daily_history", { symbol, month });
  for (const [symbol, month, source] of cases) {
    let result;
    for (let i = 0; i < 180; i++) {
      result = await tool("get_daily_history", { symbol, month });
      if (!result.pending) break;
      await wait(500);
    }
    assert.equal(result.error, null, JSON.stringify(result));
    assert.ok(result.days.length > 0, `${symbol} ${month} returned days`);
    assert.ok(result.sources.includes(source));
    assert.ok(
      result.days.every((x) => x.date.startsWith(month) && x.date <= today),
    );
    const again = await tool("get_daily_history", { symbol, month });
    assert.equal(again.pending, false);
    console.log(
      `PASS: ${symbol} ${month} official ${source}, ${result.days.length} daily rows, cache hit; volume unit=${result.days.at(-1).volumeUnit || "none"}`,
    );
  }
  let status = await tool("get_status");
  for (
    let i = 0;
    i < 100 && Object.values(status.dailySummaries).some((s) => s.pending);
    i++
  ) {
    await wait(500);
    status = await tool("get_status");
  }
  assert.equal(
    status.events.length,
    0,
    "daily history does not create live events",
  );
  assert.equal(
    status.marketOpen,
    false,
    "run this check outside regular session",
  );
  browser = await chromium.connectOverCDP("http://127.0.0.1:9339");
  const pages = browser.contexts()[0].pages();
  const main = pages.find(
    (p) => !p.url().includes("notify") && !p.url().includes("detail"),
  );
  await main.locator(".quote").first().waitFor();
  assert.equal(await main.locator(".quote").count(), 3);
  assert.equal(await main.locator(".sparkline").count(), 0);
  assert.equal(
    await main.locator(".quote .as-of").count(),
    0,
    "shared date is not repeated on each row",
  );
  assert.match(
    await main.locator("#health").textContent(),
    /\d{2}\/\d{2} 收盤/,
    "footer identifies actual closing date",
  );
  assert.ok(
    (await main.locator(".quote").first().getAttribute("title")).includes(
      "正式收盤",
    ),
  );
  const size = await main.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  assert.ok(
    size.width <= 360 && size.height <= 150,
    "compact closed-market window",
  );
  await main.screenshot({
    path: path.join(root, ".local-test/screenshots/desktop-close.png"),
  });
  await main.getByRole("button", { name: "行情", exact: true }).click();
  await main.locator("#daily-symbol").selectOption("2330");
  await main.locator(".daily-table tbody tr").first().waitFor();
  await main.screenshot({
    path: path.join(root, ".local-test/screenshots/desktop-daily.png"),
  });
  const saved = JSON.parse(
    await readFile(path.join(dir, "state.json"), "utf8"),
  );
  assert.ok(Object.keys(saved.dailyCache).length >= 5);
  assert.equal(saved.events.length, 0);
  console.log(
    "PASS: native close summaries, monthly history UI, persistent cache, no historical notifications",
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  app.kill();
}
