// README hero (docs/media/hero-desk.png): a composite of two real captures from the desktop app in
// --demo mode (the main watchlist window and the corner notice card) over an illustrated work
// document. The document is drawn here and labelled 示意 · Illustration; the two app windows are
// screenshots.
//
//   node scripts/readme-hero-image.mjs            capture, then compose
//   node scripts/readme-hero-image.mjs --compose  compose again from the last capture
//   node scripts/readme-hero-image.mjs --any-time capture outside trading hours (trial runs only)
//
// The capture refuses a notice time outside the TWSE continuous session (09:00 to 13:30, Taipei)
// unless --any-time is given: the demo stamps the notice with the real clock, and a price alert at
// 17:21 cannot happen. It also refuses when the notice price and the watchlist row disagree.
// Needs a release build (npx tauri build --no-bundle); nothing else may be using the exe.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const root = process.cwd();
const out = path.join(root, ".local-test", "hero");
const target = path.join(root, "docs", "media", "hero-desk.png");
const compose = process.argv.includes("--compose");
const anyTime = process.argv.includes("--any-time");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 640,
  H = 320,
  SCALE = 2;

async function until(fn, tries = 120, ms = 500) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await wait(ms);
  }
  throw new Error("timed out");
}

async function capture() {
  await mkdir(out, { recursive: true });
  const config = path.join(root, ".local-test", "hero-run-" + Date.now());
  await mkdir(config, { recursive: true });
  const exe =
    process.env.SMALLSTOCKS_EXE ??
    path.join(root, "src-tauri", "target", "release", "smallstocks-tw.exe");
  const port = 9341;
  const app = spawn(exe, ["--demo"], {
    env: {
      ...process.env,
      SMALLSTOCKS_CONFIG_DIR: config,
      SMALLSTOCKS_NO_GLOBAL_SHORTCUT: "1",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(config, "webview"),
    },
    windowsHide: true,
    stdio: "ignore",
  });
  let browser;
  try {
    const connection = await until(async () =>
      JSON.parse(
        await readFile(path.join(config, "mcp-connection.json"), "utf8"),
      ),
    );
    let id = 0;
    const tool = async (name, args = {}) => {
      const response = await fetch(connection.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${connection.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++id,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const result = (await response.json()).result;
      assert.equal(result.isError, false, JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
    await tool("set_settings", {
      appearance: "small",
      rowDisplay: "numbers",
      showCodes: false,
      updateCheck: false,
      refreshSeconds: 15,
    });
    await tool("set_watchlist", { symbols: ["t00", "2330", "0050"] });
    // The README's own example alert: 台積電 跌破 1000, shown as a card, once each trading day.
    await tool("upsert_rule", {
      symbol: "2330",
      metric: "price",
      direction: "below",
      threshold: 1000,
      channel: "card",
      repeat: "daily",
    });
    browser = await until(() =>
      chromium.connectOverCDP(`http://127.0.0.1:${port}`),
    );
    const pages = () => browser.contexts()[0].pages();
    const main = await until(() =>
      pages().find(
        (p) =>
          p.url() !== "about:blank" &&
          !p.url().includes("notify") &&
          !p.url().includes("detail") &&
          !p.url().includes("devtools"),
      ),
    );
    const notify = await until(() =>
      pages().find((p) => p.url().includes("notify")),
    );
    await main.locator(".quote").nth(2).waitFor();
    console.log(
      "Waiting for the demo price to cross 1000 (up to about four minutes)…",
    );
    // The demo price swings ±2% around 1010; it crosses 1000 once in each ~3-minute cycle.
    await notify.locator("#stack .item.card").waitFor({ timeout: 300_000 });
    await main.locator(".latest").waitFor();
    await wait(400); // let the card's 0.22 s entrance finish
    const meta = {
      capturedAt: new Date().toISOString(),
      card: await notify.locator("#stack .item.card").innerText(),
      rows: await main.locator(".quote").allInnerTexts(),
      latest: await main.locator(".latest").innerText(),
      ruleCount: await main.locator("#rule-count").innerText(),
      banner: await main.locator("#banner").innerText(),
      footer: await main.locator("footer").innerText(),
    };
    // Raw CDP rather than page.screenshot: Playwright keeps the monitor's scale (1.5x here) even
    // under a metrics override, and the composite needs a true 2x render on a transparent page.
    for (const [page, file] of [
      [notify, "notify.png"],
      [main, "main.png"],
    ]) {
      const size = await page.evaluate(() => [innerWidth, innerHeight]);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: size[0],
        height: size[1],
        deviceScaleFactor: SCALE,
        mobile: false,
      });
      await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
      await wait(250);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(out, file), Buffer.from(shot.data, "base64"));
      await cdp.send("Emulation.setDefaultBackgroundColorOverride", {});
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      meta[file] = size;
    }
    await writeFile(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
    console.log(JSON.stringify(meta, null, 2));
    check(meta);
  } finally {
    await browser?.close().catch(() => {});
    app.kill();
  }
}

function check(meta) {
  const card = meta.card.replace(/\s+/g, " ");
  const m = card.match(/2330 台積電 · 成交價降至 ([\d.]+)元（門檻 1000\.00）/);
  assert.ok(m, "notice text: " + card);
  const row = meta.rows.find((r) => r.includes("台積電"));
  assert.ok(row, "台積電 row");
  const shown = Number(row.match(/([\d,]+\.?\d*)/)[1].replace(/,/g, ""));
  assert.equal(shown, Number(m[1]), `row ${row} vs notice ${m[1]}`);
  assert.ok(meta.latest.includes(m[1]), "latest-event line repeats the notice");
  assert.equal(meta.ruleCount.trim(), "1", "one enabled rule");
  assert.ok(
    meta.banner.includes("示範資料") && card.includes("合成示範"),
    "demo labels",
  );
  const t = card.match(/(\d\d):(\d\d):(\d\d) · 合成示範/);
  assert.ok(t, "notice time");
  const minutes = Number(t[1]) * 60 + Number(t[2]);
  if (!anyTime)
    assert.ok(
      minutes >= 9 * 60 && minutes < 13 * 60 + 30,
      `notice time ${t[0]} is outside 09:00-13:30; capture during the session or pass --any-time for a trial`,
    );
}

async function composeImage() {
  const meta = JSON.parse(await readFile(path.join(out, "meta.json"), "utf8"));
  check(meta);
  const data = async (f) =>
    "data:image/png;base64," +
    (await readFile(path.join(out, f))).toString("base64");
  const [mw, mh] = meta["main.png"],
    [nw, nh] = meta["notify.png"];
  const margin = 12; // the notice sits 12 px from the work area's corner (src/notify.ts)
  const cardTop = H - margin - nh;
  const mainTop = cardTop - 10 - mh;
  // Work window (illustration): bleeds off the top and left so the picture reads as the corner of a
  // larger screen; it passes behind both app windows with its bottom edge 36 px above the card's,
  // its heading and task lines end clear of them, and its text is mid-grey so the two app windows
  // hold the first glance.
  const work = { right: 560, bottom: cardTop + nh - 36 };
  const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
body{position:relative;background:linear-gradient(160deg,#eef0f4,#e3e6eb);font-family:"Segoe UI","Microsoft JhengHei UI",sans-serif;color:#2b2f36}
.work{position:absolute;left:-40px;top:-40px;width:${work.right + 40}px;height:${work.bottom + 40}px;background:#fff;border:1px solid #d9dce2;border-radius:10px;box-shadow:0 8px 24px rgba(30,35,45,.10);overflow:hidden}
.doc{position:absolute;left:76px;top:62px;right:22px}
.doc small{font-size:11px;color:#8a909a}
.doc em{font-style:normal;font-size:10.5px;color:#7a808b;border:1px solid #d5d8de;border-radius:4px;padding:0 5px;margin-left:8px}
.doc h2{font-size:17px;font-weight:500;margin:8px 0 14px;color:#7d838d}
.doc hr{border:0;border-top:1px solid #e4e6ea;margin:0 0 14px}
.line{height:7px;border-radius:4px;background:#e9ebef;margin:0 0 13px}
.task{display:flex;align-items:center;gap:8px;margin:0 0 13px;color:#a3a8b1;font-size:11px}
.task .line{flex:1;margin:0}
.app{position:absolute;display:block}
</style>
<div class="work"><div class="doc"><small>本週工作</small><em>示意 · Illustration</em><h2>把注意力留給手上的事。</h2><hr>
<div class="line" style="width:92%"></div><div class="line" style="width:78%"></div><div class="line" style="width:85%"></div>
<div class="task">✓<div class="line" style="flex:0 0 180px"></div></div><div class="task">✓<div class="line" style="flex:0 0 140px"></div></div><div class="task">○<div class="line" style="flex:0 0 160px"></div></div>
</div></div>
<img class="app" src="${await data("main.png")}" style="right:${margin}px;top:${mainTop}px;width:${mw}px;height:${mh}px">
<img class="app" src="${await data("notify.png")}" style="right:${margin}px;top:${cardTop}px;width:${nw}px;height:${nh}px;border-radius:8px">`;
  // border-radius 8px is the card's own radius (src/notify-base.css .item): the notice window is
  // exactly card-sized, so the card's box-shadow is cut off square at the window edge; clipping to
  // the card's shape removes that leftover, as the transparent main window needs no clipping.
  await writeFile(path.join(out, "compose.html"), html);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: SCALE,
    });
    await page.setContent(html);
    await page.waitForLoadState("load");
    await page.screenshot({ path: target });
  } finally {
    await browser.close();
  }
  console.log(
    `${target}: ${W * SCALE}×${H * SCALE}, ${(await stat(target)).size} bytes`,
  );
}

if (!compose) await capture();
await composeImage();
