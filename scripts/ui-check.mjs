import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const dir = new URL("../.local-test/screenshots/", import.meta.url);
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 360, height: 168 },
  deviceScaleFactor: 2,
});
async function openSettings() {
  if (await page.locator('[data-disguise="terminal"]').count()) {
    await page.locator(".terminal-titlebar .native-menu summary").click();
    await page.getByRole("menuitem", { name: /^設定/ }).click();
  } else if (await page.locator('[data-disguise="txt"]').count()) {
    await page.getByRole("button", { name: "設定", exact: true }).click();
  } else if (await page.locator("#minimal-settings").count())
    await page.getByRole("button", { name: "極簡顯示設定" }).click();
  else
    await page.getByRole("button", { name: "外觀與設定", exact: true }).click();
}
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:1432");
await page.getByText("合成行情 · 不代表真實市場").waitFor();
await page.getByRole("button", { name: "＋ 管理自選" }).click();
await page.locator("#search").fill("台積電");
await page.getByRole("button", { name: "＋ 台積電 2330" }).waitFor();
await page.locator("#symbols").fill("2330, 0050, t00");
await page.getByRole("button", { name: "儲存自選" }).click();
assert.equal(await page.locator(".quote").count(), 3);
await page.locator(".quote").first().waitFor({ state: "visible" });
const originalHeight = await page
  .locator(".quote")
  .first()
  .evaluate((el) => el.getBoundingClientRect().height);
await page.getByRole("button", { name: "切換顯示內容" }).click();
await page.locator(".row-trend").first().waitFor();
assert.equal(await page.locator(".row-trend").count(), 3);
assert.equal(
  (await page.locator(".quote").first().boundingBox()).height,
  originalHeight,
);
await page.screenshot({
  path: new URL("inline-trend.png", dir).pathname.replace(/^\/([A-Z]:)/, "$1"),
});
await page.getByRole("button", { name: "切換顯示內容" }).click();
await page.locator(".minimal-stock").first().waitFor();
assert.equal(await page.locator(".minimal-stock").count(), 3);
await page.getByRole("button", { name: "切換顯示內容" }).click();
assert.equal(await page.locator(".price").count(), 3);
assert.equal(await page.locator(".row-trend").count(), 0);
await page.getByRole("button", { name: /提醒/ }).click();
await page.locator("[name=threshold]").fill("1050");
await page.getByRole("button", { name: "建立提醒" }).click();
assert.equal(await page.locator(".rule").count(), 1);
await page.getByRole("button", { name: "停用", exact: true }).click();
await page.getByText("已停用", { exact: false }).waitFor();
await page.getByRole("button", { name: "修改", exact: true }).click();
await page.locator("[name=threshold]").fill("1060");
await page.getByRole("button", { name: "儲存修改" }).click();
assert.ok((await page.locator(".rule").innerText()).includes("1,060"));
await page.getByRole("button", { name: "行情", exact: true }).click();
await page.locator(".daily-table tbody tr").first().waitFor();
assert.ok(await page.locator(".daily-chart svg").count());
const previousMonth = new Date();
previousMonth.setDate(1);
previousMonth.setMonth(previousMonth.getMonth() - 1);
const month = previousMonth.toLocaleDateString("sv-SE").slice(0, 7);
await page.locator("#daily-month").fill(month);
await page.locator("#daily-month").dispatchEvent("change");
await page.waitForFunction(
  (m) =>
    document.querySelector(".daily-table tbody tr")?.textContent?.includes(m),
  month,
);
await page.setViewportSize({ width: 500, height: 500 });
await page.screenshot({
  path: new URL("daily.png", dir).pathname.replace(/^\/([A-Z]:)/, "$1"),
});
for (const look of ["small", "gray", "terminal", "txt"]) {
  await openSettings();
  await page.locator(`[data-look=${look}]`).click();
  await page.getByRole("button", { name: "自選", exact: true }).click();
  await page.setViewportSize({
    width: look === "terminal" ? 520 : look === "txt" ? 500 : 360,
    height:
      look === "small" || look === "gray"
        ? 168
        : look === "terminal"
          ? 300
          : 300,
  });
  await page.screenshot({
    path: new URL(`${look}.png`, dir).pathname.replace(/^\/([A-Z]:)/, "$1"),
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (look !== "small")
    assert.equal(
      await page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue("--accent").trim(),
      ),
      look === "txt" ? "#555" : "#c1c3c7",
    );
  if (look === "small" || look === "gray") {
    assert.equal(
      await page.locator(".sparkline").count(),
      0,
      "watchlist has no inline charts",
    );
    for (const row of await page.locator(".quote").all()) {
      const box = await row.boundingBox();
      assert.ok(box.height <= 24, "compact rows");
      const footer = await page.locator("footer").boundingBox();
      assert.ok(box.y + box.height <= footer.y, "all three rows visible");
    }
  }
}
await openSettings();
await page.locator("[data-look=small]").click();
await page.getByRole("button", { name: "自選", exact: true }).click();
await page.locator('[data-quote="2330"]').click();
await page.locator("#daily-symbol").waitFor();
assert.equal(await page.locator("#daily-symbol").inputValue(), "2330");
await page.getByRole("button", { name: "＋ 管理自選" }).click();
await page
  .locator("#symbols")
  .fill("2330,0050,2317,2454,2303,2881,2882,1301,2412,2603");
await page.getByRole("button", { name: "儲存自選" }).click();
await page.setViewportSize({ width: 360, height: 336 });
assert.equal(await page.locator(".quote").count(), 10);
const lastRow = await page.locator(".quote").last().boundingBox();
const bottom = await page.locator("footer").boundingBox();
assert.ok(
  lastRow.y + lastRow.height <= bottom.y,
  "ten rows fit compact watchlist",
);
await page.screenshot({
  path: new URL("compact-10.png", dir).pathname.replace(/^\/([A-Z]:)/, "$1"),
});
assert.deepEqual(errors, []);
console.log(
  "PASS: watchlist, rule CRUD, daily history/month switching, four appearances, overflow and console checks",
);
await browser.close();
