import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const url = "http://127.0.0.1:4175/";
await mkdir(".local-test/screenshots", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-Hant");
  assert.equal(await page.locator("#release-files").isVisible(), false);
  assert.ok(
    (await page.locator("#release-status").innerText()).includes("尚未發布"),
  );
  await page.locator("#tab-trend").click();
  assert.ok(
    (await page.locator("#display-image").getAttribute("src")).endsWith(
      "trend.png",
    ),
  );
  await page.locator("#tab-trend").press("ArrowRight");
  assert.equal(
    await page.locator("#tab-minimal").getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator("#hover-example").isVisible(), true);
  await page.locator("#tab-minimal").press("Home");
  assert.equal(
    await page.locator("#tab-numbers").getAttribute("aria-selected"),
    "true",
  );
  assert.ok(
    await page.evaluate(
      () =>
        document
          .querySelector("#looks")
          .compareDocumentPosition(document.querySelector("#display")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ),
    "low-key views come before small",
  );
  for (const id of ["terminal-image", "text-image"]) {
    assert.equal(await page.locator("#" + id).isVisible(), true);
  }
  for (const mode of ["numbers", "trend", "minimal"]) {
    await page.locator("#tab-" + mode).click();
    await page.locator("#display-image").evaluate((image) => image.decode());
    const quality = await page
      .locator("#display-image")
      .evaluate((image) => ({
        natural: image.naturalWidth,
        rendered: image.getBoundingClientRect().width,
      }));
    assert.ok(
      quality.natural / quality.rendered >= 2.5,
      mode + " provides enough pixels for high-density displays",
    );
    assert.ok(
      (await page.locator("#display-zoom").getAttribute("href")).endsWith(
        mode === "numbers" ? "numbers.png" : mode + ".png",
      ),
    );
  }
  await page.locator("#tab-numbers").click();
  await page.locator("[data-platform=mac]").click();
  assert.ok(
    (await page.locator("#terminal-image").getAttribute("src")).endsWith(
      "mac-terminal.png",
    ),
  );
  assert.ok(
    (await page.locator("#text-image").getAttribute("src")).endsWith(
      "mac-text.png",
    ),
  );
  assert.ok(
    (await page.locator("#text-caption").innerText()).includes("原生視窗截圖"),
  );
  await page.locator("[data-platform=windows]").click();
  assert.ok(
    (await page.locator("#text-image").getAttribute("src")).endsWith(
      "windows-text.png",
    ),
  );
  await page.locator("#agent details summary").click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copied = value;
        },
      },
    }),
  );
  await page.locator("#copy-config").click();
  assert.ok(
    JSON.parse(await page.evaluate(() => window.__copied)).mcpServers[
      "smallstocks-tw"
    ].args.includes("--mcp"),
  );
  assert.ok(
    (await page.locator("#copy-result").innerText()).includes("已複製"),
  );
  await page.locator("#agent details summary").click();

  const anchors = await page
    .locator('a[href^="#"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href) => href !== "#"),
    );
  for (const anchor of anchors)
    assert.equal(await page.locator(anchor).count(), 1, anchor);
  await page.evaluate(async () => {
    for (const image of document.images) image.loading = "eager";
    await Promise.all([...document.images].map((image) => image.decode()));
    window.scrollTo(0, 0);
  });
  for (const [width, height, name] of [
    [1440, 1000, "site-desktop"],
    [768, 900, "site-tablet"],
    [390, 844, "site-mobile"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${name}: no horizontal overflow`,
    );
    await page.screenshot({
      path: `.local-test/screenshots/${name}.png`,
      fullPage: true,
    });
  }
  console.log(
    "Mobile page height after compaction:",
    await page.evaluate(() => document.documentElement.scrollHeight),
  );
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".local-test/screenshots/site-dark.png",
    fullPage: true,
  });
  const releasePage = await browser.newPage();
  await releasePage.route("https://api.github.com/**", (route) =>
    route.fulfill({
      json: [
        {
          draft: false,
          tag_name: "v0.1.11",
          assets: [
            {
              name: "SmallStocks-TW-0.1.11-windows-x64.zip",
              size: 3589319,
              browser_download_url:
                "https://github.com/Zaious/smallstocks-tw/releases/download/v0.1.11/SmallStocks-TW-0.1.11-windows-x64.zip",
            },
            {
              name: "SmallStocks-TW-0.1.11-windows-x64-setup.exe",
              size: 2598055,
              browser_download_url:
                "https://github.com/Zaious/smallstocks-tw/releases/download/v0.1.11/SmallStocks-TW-0.1.11-windows-x64-setup.exe",
            },
          ],
        },
      ],
    }),
  );
  await releasePage.goto(url);
  await releasePage.locator("#portable-download").waitFor({ state: "visible" });
  assert.equal(
    await releasePage.locator("#installer-download").isVisible(),
    true,
  );
  assert.equal(await releasePage.locator("#version").innerText(), "v0.1.11");
  const failed = await browser.newPage();
  await failed.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await failed.goto(url);
  await failed.waitForFunction(() =>
    document.querySelector("#release-status").textContent.includes("暫時無法"),
  );
  assert.equal(await failed.locator("#release-files").isVisible(), false);
  const noJS = await browser.newPage({ javaScriptEnabled: false });
  await noJS.goto(url);
  assert.ok((await noJS.locator("h1").innerText()).includes("台股"));
  assert.equal(
    await noJS
      .locator('a[href="https://github.com/Zaious/smallstocks-tw/releases"]')
      .count(),
    3,
  );
  assert.deepEqual(errors, []);
  const embed = async (file) =>
    "data:image/png;base64," + (await readFile(file)).toString("base64");
  const share = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await share.setContent(
    `<style>*{box-sizing:border-box}body{margin:0;background:#15171c;color:#e8eaee;font-family:'Segoe UI','Microsoft JhengHei UI',sans-serif;padding:60px}header{display:flex;align-items:center;gap:15px;font-size:22px;color:#a0a6b1}header img{width:45px}h1{font-size:80px;line-height:1.18;letter-spacing:-3px;margin:40px 0 24px}p{color:#a0a6b1;font-size:23px;line-height:1.8;margin:0}.gold{color:#e8b04a}.widget{position:absolute;right:55px;top:190px;width:510px;box-shadow:0 20px 60px #0004;border-radius:10px}.bar{position:absolute;right:55px;top:475px;width:430px}.foot{position:absolute;bottom:45px;font-size:17px;color:#a0a6b1}</style><header><img src="${await embed("site/media/icon.png")}">SmallStocks TW</header><h1>台股，<br><span class="gold">縮小著看。</span></h1><p>做你的事。<br>重要變化，來找你。</p><img class="widget" src="${await embed("site/media/numbers.png")}"><img class="bar" src="${await embed("site/media/minimal.png")}"><div class="foot">桌面自選股 · 安靜提醒 · 免費開源　｜　畫面為合成示範行情</div>`,
  );
  await share.screenshot({ path: "site/media/share.png" });
  console.log(
    "PASS: Chinese content, keyboard tabs, platform/appearance previews, MCP copy, truthful empty/available/failed release states, no-JS fallback, responsive light/dark layouts and local assets; generated sharing image",
  );
} finally {
  await browser.close();
}
