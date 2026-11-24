// README hero (docs/media/hero-desk.png): a composite of two real captures from the desktop app in
// --demo mode (the main watchlist window and the corner notice card) over an illustrated work
// document. The document is drawn here and labelled 示意 · Illustration; the two app windows are
// screenshots.
//
//   node scripts/readme-hero-image.mjs            capture, then compose (and the website's desk
//                                                 images: site/media/desk-*.png, hero-desk.png)
//   node scripts/readme-hero-image.mjs --compose  compose again from the last capture
//   node scripts/readme-hero-image.mjs --any-time capture outside trading hours (trial runs only)
//   --social   the social preview (docs/media/social-preview.png = site/media/share.png)
//   --strip    the grey strip of the website's alert section (site/media/notice.png)
//   --set, --trend, --minimal, --gray
//              the website's display-mode images (numbers, trend, minimal + hover, gray), each
//              from its own run at the same tick as the hero
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
const target = path.join(root, "docs", "media", "hero-desk.png");
const compose = process.argv.includes("--compose");
const anyTime = process.argv.includes("--any-time");
// What each capture sets up. hero: the README's first image (and the website's desk scene).
// strip: the grey strip the website's alert section shows. social: the social preview, with the
// index only, so that no company name appears on a card that travels without its caption.
const tsmc = /2330 台積電 · 成交價降至 ([\d.]+)元（門檻 1000\.00）/;
const PROFILES = {
  hero: {
    watchlist: ["t00", "2330", "0050"],
    appearance: "small",
    notice: "card",
    rule: {
      symbol: "2330",
      metric: "price",
      direction: "below",
      threshold: 1000,
      channel: "card",
      repeat: "daily",
    },
    text: tsmc,
    row: "台積電",
  },
  strip: {
    watchlist: ["t00", "2330", "0050"],
    appearance: "gray",
    notice: "strip",
    rule: {
      symbol: "2330",
      metric: "price",
      direction: "below",
      threshold: 1000,
      channel: "strip",
      repeat: "daily",
    },
    text: tsmc,
    row: "台積電",
    // The website shows the strip at up to 1.6 times its size, so it is captured at 4x.
    scale: 4,
  },
  social: {
    watchlist: ["t00"],
    appearance: "small",
    notice: "card",
    rule: {
      symbol: "t00",
      metric: "changePercent",
      direction: "below",
      threshold: -1.5,
      channel: "card",
      repeat: "daily",
    },
    text: /t00 加權指數 · 漲跌幅降至 (-?[\d.]+)%（門檻 -1\.50）/,
    row: "加權指數",
    percent: true,
  },
};
// The website's display-mode images, at 4x. Every run starts in its own view and is taken at the
// moment the hero's alert fires: changing a setting makes the app fetch again, which would move the
// demo quotes on, so nothing is changed during a run. The crossing tick is the same in every run.
// set: numbers. trend: the single-row trend. minimal: the minimal bar and the hover detail of
// 台積電. gray: the minimal bar in greyscale.
PROFILES.set = { ...PROFILES.hero, scale: 4 };
PROFILES.trend = {
  ...PROFILES.hero,
  scale: 4,
  rowDisplay: "trend",
  after: async ({ main, meta }) => {
    await main.locator(".trend-slot svg").nth(2).waitFor({ timeout: 30_000 });
    assert.ok(
      meta.rows.every((r) => r.includes("-1.51%")),
      "trend rows at the hero's tick",
    );
  },
};
PROFILES.minimal = {
  ...PROFILES.hero,
  scale: 4,
  rowDisplay: "minimal",
  after: async ({ main, pages, shoot, meta }) => {
    await main.locator('button.minimal-stock[data-mini-stock="2330"]').hover();
    const detail = await until(() =>
      pages().find((p) => p.url().includes("detail")),
    );
    await detail.locator(".detail-values").waitFor({ timeout: 15_000 });
    await wait(600);
    meta.detail = await detail.locator("body").innerText();
    assert.ok(
      meta.detail.includes("994.71") && meta.detail.includes("-1.51%"),
      meta.detail,
    );
    const bottom = await detail.evaluate(() =>
      Math.ceil(
        Math.max(
          ...[...document.body.querySelectorAll("*")].map(
            (e) => e.getBoundingClientRect().bottom,
          ),
        ),
      ),
    );
    await shoot(detail, "hover.png", bottom);
  },
};
PROFILES.gray = {
  ...PROFILES.hero,
  scale: 4,
  rowDisplay: "minimal",
  appearance: "gray",
};
const which =
  ["strip", "social", "set", "trend", "minimal", "gray"].find((p) =>
    process.argv.includes("--" + p),
  ) ?? "hero";
const profile = PROFILES[which];
const out = path.join(
  root,
  ".local-test",
  which === "hero" ? "hero" : "hero-" + which,
);
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
      appearance: profile.appearance,
      rowDisplay: profile.rowDisplay ?? "numbers",
      showCodes: false,
      updateCheck: false,
      refreshSeconds: 15,
    });
    await tool("set_watchlist", { symbols: profile.watchlist });
    // hero and strip: the README's own example alert, 台積電 跌破 1000, once each trading day.
    await tool("upsert_rule", profile.rule);
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
    await main
      .locator(
        profile.rowDisplay === "minimal" ? "button.minimal-stock" : ".quote",
      )
      .nth(profile.watchlist.length - 1)
      .waitFor();
    console.log(
      "Waiting for the demo quote to cross the threshold (up to about four minutes)…",
    );
    // Demo quotes swing ±2% around their base; each threshold is crossed once in a ~3-minute cycle.
    const notice = notify.locator(`#stack .item.${profile.notice}`);
    await notice.waitFor({ timeout: 300_000 });
    const bar = profile.rowDisplay === "minimal"; // no rows, no latest line, no header
    if (!bar) await main.locator(".latest").waitFor();
    await wait(400); // let the card's 0.22 s entrance finish
    const meta = {
      capturedAt: new Date().toISOString(),
      which,
      card: await notice.innerText(),
      rows: bar ? [] : await main.locator(".quote").allInnerTexts(),
      latest: bar ? "" : await main.locator(".latest").innerText(),
      ruleCount: await main.locator("#rule-count").innerText(),
      banner: await main.locator("#banner").innerText(),
      footer: await main.locator("footer").innerText(),
    };
    // Raw CDP rather than page.screenshot: Playwright keeps the monitor's scale (1.5x here) even
    // under a metrics override, and the composite needs a true 2x render on a transparent page.
    // `height` crops the capture to the content when a window is taller than what it shows.
    const shoot = async (page, file, height) => {
      const size = await page.evaluate(() => [innerWidth, innerHeight]);
      if (height) size[1] = height;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: size[0],
        height: size[1],
        deviceScaleFactor: profile.scale ?? SCALE,
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
    };
    await shoot(notify, "notify.png");
    await shoot(main, "main.png");
    if (profile.after) await profile.after({ tool, main, pages, shoot, meta });
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
  const p = PROFILES[meta.which ?? "hero"];
  const m = card.match(p.text);
  assert.ok(m, "notice text: " + card);
  // Rows carry a price only in the numbers view; the trend and minimal runs check their own view.
  if (!p.rowDisplay) {
    const row = meta.rows.find((r) => r.includes(p.row));
    assert.ok(row, p.row + " row");
    const shown = p.percent
      ? Number(row.match(/(-?[\d.]+)%/)[1])
      : Number(row.match(/([\d,]+\.?\d*)/)[1].replace(/,/g, ""));
    assert.equal(shown, Number(m[1]), `row ${row} vs notice ${m[1]}`);
    assert.ok(
      meta.latest.includes(m[1]),
      "latest-event line repeats the notice",
    );
    assert.equal(meta.ruleCount.trim(), "1", "one enabled rule");
    assert.ok(meta.banner.includes("示範資料"), "demo label in the window");
  }
  if (p.notice === "strip") return; // a strip has no time and no source line
  assert.ok(card.includes("合成示範"), "demo label on the card");
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

// A notice capture clipped to the notice's own 8 px corners (see above), as a transparent 2x PNG.
async function clipped(page, file, [w, h]) {
  const src =
    "data:image/png;base64," +
    (await readFile(path.join(out, file))).toString("base64");
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}</style><img src="${src}" style="display:block;width:${w}px;height:${h}px;border-radius:8px">`,
  );
  await page.waitForLoadState("load");
  return page.screenshot({ omitBackground: true });
}

// The website's copies: the desk scene uses the hero's two captures, the alert section the strip.
async function siteImages() {
  const meta = JSON.parse(await readFile(path.join(out, "meta.json"), "utf8"));
  check(meta);
  const media = path.join(root, "site", "media");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: profile.scale ?? SCALE,
    });
    if (which === "hero") {
      await writeFile(
        path.join(media, "desk-watchlist.png"),
        await readFile(path.join(out, "main.png")),
      );
      await writeFile(
        path.join(media, "desk-card.png"),
        await clipped(page, "notify.png", meta["notify.png"]),
      );
      await writeFile(
        path.join(media, "hero-desk.png"),
        await readFile(target),
      );
      console.log(
        "site/media: desk-watchlist.png, desk-card.png, hero-desk.png",
      );
    } else if (["set", "trend", "minimal", "gray"].includes(which)) {
      const name = {
        set: "numbers",
        trend: "trend",
        minimal: "minimal",
        gray: "gray",
      }[which];
      await writeFile(
        path.join(media, name + ".png"),
        await readFile(path.join(out, "main.png")),
      );
      if (which === "minimal")
        await writeFile(
          path.join(media, "hover.png"),
          await readFile(path.join(out, "hover.png")),
        );
      console.log(
        `site/media: ${name}.png${which === "minimal" ? ", hover.png" : ""}`,
      );
    } else if (which === "strip") {
      await writeFile(
        path.join(media, "notice.png"),
        await clipped(page, "notify.png", meta["notify.png"]),
      );
      console.log("site/media: notice.png");
    }
  } finally {
    await browser.close();
  }
}

// The social preview (GitHub repository setting, and the website's og:image): the name, large,
// with "Unofficial" beside it, over the index-only capture, so no company name travels with it.
async function socialImage() {
  const meta = JSON.parse(await readFile(path.join(out, "meta.json"), "utf8"));
  check(meta);
  const data = async (f) =>
    "data:image/png;base64," + (await readFile(f)).toString("base64");
  // The two windows at 0.85 of their real size, so the name has room beside them.
  const k = 0.85,
    gap = 10;
  const [mw, mh] = meta["main.png"].map((v) => v * k),
    [nw, nh] = meta["notify.png"].map((v) => v * k);
  // A label under the card, large enough to read in a shared thumbnail, where the in-app demo
  // labels are too small: the picture shows a market move, and it is synthetic.
  const label = 26;
  const top = (H - mh - gap - nh - 8 - label) / 2;
  const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
body{position:relative;background:linear-gradient(160deg,#eef0f4,#e1e4ea);font-family:"Segoe UI","Microsoft JhengHei UI",sans-serif;color:#1f232a}
.name{position:absolute;left:36px;top:58px}
.name img{width:54px;height:54px;display:block;margin-bottom:18px}
.name h1{margin:0;font-size:38px;line-height:1.05;font-weight:700;letter-spacing:-0.5px}
.name p{margin:16px 0 0;display:inline-block;font-size:17px;font-weight:600;color:#4a505a;border:1.5px solid #9aa0aa;border-radius:6px;padding:2px 9px}
.app{position:absolute;right:24px;display:block}
.demo{position:absolute;right:24px;height:${label}px;line-height:${label}px;font-size:18px;font-weight:600;color:#2b2f36}
</style>
<div class="name"><img src="${await data(path.join(root, "site", "media", "icon.png"))}" alt=""><h1>SmallStocks<br>TW</h1><p>Unofficial</p></div>
<img class="app" src="${await data(path.join(out, "main.png"))}" style="top:${top}px;width:${mw}px;height:${mh}px">
<img class="app" src="${await data(path.join(out, "notify.png"))}" style="top:${top + mh + gap}px;width:${nw}px;height:${nh}px;border-radius:${8 * k}px">
<div class="demo" style="top:${top + mh + gap + nh + 8}px">合成示範行情</div>`;
  await writeFile(path.join(out, "compose.html"), html);
  const file = path.join(root, "docs", "media", "social-preview.png");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: SCALE,
    });
    await page.setContent(html);
    await page.waitForLoadState("load");
    await page.screenshot({ path: file });
  } finally {
    await browser.close();
  }
  await writeFile(
    path.join(root, "site", "media", "share.png"),
    await readFile(file),
  );
  console.log(
    `${file} (and site/media/share.png): ${W * SCALE}×${H * SCALE}, ${(await stat(file)).size} bytes`,
  );
}

if (!compose) await capture();
if (which === "hero") await composeImage();
if (which === "social") await socialImage();
else await siteImages();
