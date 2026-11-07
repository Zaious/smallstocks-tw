import "./style.css";
import "./disguise.css";
import "./minimal.css";
import {
  isMac,
  primaryPressed,
  privacyPressed,
  privacyShortcutLabel,
} from "./platform.ts";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { desktop, request, search, daily } from "./client.ts";
import {
  esc,
  number,
  change,
  time,
  stale,
  ruleText,
  latestCloseDate,
} from "./model.ts";
import { historyBody } from "./daily-view.ts";
import { trendCell } from "./inline-trend.ts";
import { disguiseMarkup, bindDisguise, updateDisguise } from "./disguise.ts";
import {
  minimalMarkup,
  bindMinimal,
  updateMinimal,
  hideDetail,
} from "./minimal.ts";
import type { SkinAction } from "./disguise.ts";
import type { DailyView, Snapshot, Appearance, Rule } from "./model.ts";

document.body.dataset.platform = isMac ? "macos" : "windows";
const app = document.querySelector<HTMLDivElement>("#app")!;
let state: Snapshot;
let tab = "watch";
let editing: Rule | undefined;
let busy = false;
let searchVersion = 0;
let dailySymbol = "";
let dailyMonth = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
}).format(new Date());
let dailyVersion = 0;
let dailyData: DailyView | undefined;
let dailyBusy = false;
let lastWindowTitle = "";
async function loadDaily() {
  if (dailyBusy) return;
  const version = ++dailyVersion;
  const requestedSymbol = dailySymbol,
    requestedMonth = dailyMonth;
  dailyBusy = true;
  try {
    const data = await daily(requestedSymbol, requestedMonth);
    if (
      version !== dailyVersion ||
      tab !== "daily" ||
      requestedSymbol !== dailySymbol ||
      requestedMonth !== dailyMonth
    )
      return;
    dailyData = data;
    const el = document.querySelector("#daily-body");
    if (el) el.innerHTML = historyBody(data);
  } catch (e) {
    showError(e);
  } finally {
    dailyBusy = false;
    if (
      tab === "daily" &&
      dailySymbol &&
      (requestedSymbol !== dailySymbol || requestedMonth !== dailyMonth)
    )
      void loadDaily();
  }
}
function dailyPage() {
  if (!state.watchlist.includes(dailySymbol))
    dailySymbol = state.watchlist[0] ?? "";
  content.innerHTML = `<div class="pane"><h1>一天一點，回看走勢</h1><p class="intro">正式日行情與收盤摘要，不會觸發即時通知。</p><div class="daily-controls"><label>自選標的<select id="daily-symbol">${state.watchlist.map((c) => `<option value="${esc(c)}" ${c === dailySymbol ? "selected" : ""}>${esc(state.quotes[c]?.name ?? c)} · ${esc(c)}</option>`).join("")}</select></label><label>月份<input id="daily-month" type="month" min="2000-01" max="${new Date(state.now).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }).slice(0, 7)}" value="${dailyMonth}"></label></div><div id="daily-body">${dailyData && dailyData.symbol === dailySymbol ? historyBody(dailyData) : '<div class="empty">正在取得每日行情…</div>'}</div></div>`;
  document.querySelector("#daily-symbol")!.addEventListener("change", (e) => {
    dailySymbol = (e.target as HTMLSelectElement).value;
    dailyData = undefined;
    dailyVersion++;
    dailyBusy = false;
    void loadDaily();
  });
  document.querySelector("#daily-month")!.addEventListener("change", (e) => {
    dailyMonth = (e.target as HTMLInputElement).value;
    dailyData = undefined;
    dailyVersion++;
    dailyBusy = false;
    void loadDaily();
  });
  if (dailySymbol) void loadDaily();
  else document.querySelector("#daily-body")!.textContent = "請先加入自選股。";
}
app.innerHTML = `<main class="shell"><header data-tauri-drag-region><span class="brand" data-tauri-drag-region><i></i><b>small</b><span>stocks / TW</span></span><div class="window-actions"><button id="row-display" title="切換數字、走勢與極簡" aria-label="切換顯示內容">數字</button><button id="manage" aria-label="＋ 管理自選" title="管理自選">＋</button><button id="hide" title="隱藏到系統匣；持續監看">−</button></div></header><nav aria-label="主選單"><button data-tab="watch" class="active">自選</button><button data-tab="daily">行情</button><button data-tab="rules">提醒 <span id="rule-count"></span></button><button data-tab="history">紀錄</button><button data-tab="settings" class="gear">外觀與設定</button></nav><div id="banner"></div><section id="content"></section><footer><span id="health"></span><span id="source">TWSE MIS</span></footer><div id="message" role="status" aria-live="polite"></div></main>`;
const content = app.querySelector<HTMLElement>("#content")!;
const showError = (e: unknown) => {
  const el = document.querySelector<HTMLElement>("#message")!;
  el.textContent = String(e);
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 6000);
};
async function mutate(tool: string, args: Record<string, unknown>) {
  try {
    state = await request(tool, args);
    apply();
    render();
  } catch (e) {
    showError(e);
  }
}
function skinAction(action: SkinAction) {
  if (["hide", "minimize", "maximize"].includes(action)) {
    hideDetail();
    if (!desktop) {
      showError("此操作由桌面視窗提供");
      return;
    }
    const win = getCurrentWindow();
    void (
      action === "hide"
        ? win.hide()
        : action === "minimize"
          ? win.minimize()
          : win.toggleMaximize()
    ).catch(showError);
    return;
  }
  if (action === "small") {
    tab = "watch";
    void mutate("set_settings", { appearance: "small" });
    return;
  }
  if (action === "pause" || action === "resume") {
    void mutate("set_settings", { paused: action === "pause" });
    return;
  }
  tab = action;
  editing = undefined;
  if (action === "manage") manage();
  else render();
}
async function resize() {
  if (!desktop) return;
  const wide = tab !== "watch";
  const a = state.settings.appearance;
  const compact = a === "small" || a === "gray";
  if (!wide && state.settings.rowDisplay === "minimal") {
    await fitMinimal();
    return;
  }
  await getCurrentWindow().setMinSize(new LogicalSize(300, 100));
  await getCurrentWindow()
    .setSize(
      new LogicalSize(
        wide ? 500 : a === "terminal" ? 520 : a === "txt" ? 500 : 360,
        wide
          ? 500
          : compact
            ? Math.min(
                410,
                Math.max(
                  100,
                  76 +
                    state.watchlist.length * 24 +
                    (state.demo ? 20 : 0) +
                    (state.events.length ? 18 : 0),
                ),
              )
            : a === "terminal"
              ? Math.min(
                  480,
                  Math.max(
                    280,
                    210 +
                      state.watchlist.length * 18 +
                      (state.demo ? 18 : 0) +
                      Math.min(state.events.length, 3) * 18,
                  ),
                )
              : Math.min(
                  480,
                  Math.max(
                    300,
                    210 + state.watchlist.length * 19 + (state.demo ? 19 : 0),
                  ),
                ),
      ),
    )
    .catch(showError);
}
let fittingMinimal = false,
  fitAgain = false;
async function fitMinimal() {
  if (!desktop || tab !== "watch" || state.settings.rowDisplay !== "minimal")
    return;
  if (fittingMinimal) {
    fitAgain = true;
    return;
  }
  const list = content.querySelector<HTMLElement>(".minimal-list");
  if (!list) return;
  fittingMinimal = true;
  try {
    const win = getCurrentWindow(),
      scale = await win.scaleFactor(),
      size = await win.innerSize();
    const px = (el: Element | null) =>
      el ? el.getBoundingClientRect().height : 0;
    const padding = (el: Element | null) => {
      if (!el) return 0;
      const css = getComputedStyle(el);
      return parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
    };
    let height = px(list) + 2;
    const native = content.querySelector(".native-frame");
    if (native) {
      height +=
        px(native.querySelector(".native-title")) +
        px(native.querySelector(".notepad-menubar")) +
        px(native.querySelector(".notepad-status:not([hidden])")) +
        px(native.querySelector(".console-command")) +
        padding(native.querySelector(".terminal-screen")) +
        padding(native.querySelector(".minimal-native")) +
        px(native.querySelector(".minimal-native-demo")) +
        px(native.querySelector(".console-minimal-log"));
    } else {
      height +=
        px(app.querySelector(".shell>header")) +
        px(app.querySelector(".shell>nav")) +
        px(app.querySelector("#banner")) +
        px(app.querySelector(".shell>footer"));
    }
    const popup = content.querySelector(".native-menu[open] .native-popup");
    if (popup)
      height = Math.max(height, popup.getBoundingClientRect().bottom + 6);
    height = Math.max(native ? 100 : 28, Math.min(410, Math.ceil(height)));
    if (
      tab === "watch" &&
      state.settings.rowDisplay === "minimal" &&
      Math.abs(size.height / scale - height) > 1
    )
      await invoke("fit_minimal_height", { height });
  } catch (e) {
    showError(e);
  } finally {
    fittingMinimal = false;
    if (fitAgain) {
      fitAgain = false;
      queueMicrotask(() => void fitMinimal());
    }
  }
}
let minimalObserver: ResizeObserver | null = null;
function observeMinimal() {
  minimalObserver?.disconnect();
  const list = content.querySelector(".minimal-list");
  if (!list) return;
  minimalObserver = new ResizeObserver(() => void fitMinimal());
  minimalObserver.observe(list);
}
function openStock(code: string) {
  dailySymbol = code;
  dailyData = undefined;
  tab = "daily";
  render();
}
function apply() {
  document.body.dataset.skin =
    tab === "watch" && ["terminal", "txt"].includes(state.settings.appearance)
      ? "native"
      : "small";
  const windowTitle =
    document.body.dataset.skin === "native"
      ? state.settings.appearance === "txt"
        ? isMac
          ? "工作紀錄.txt"
          : "工作紀錄.txt - 記事本"
        : isMac
          ? "work — sync — zsh"
          : "PowerShell"
      : "SmallStocks TW";
  if (desktop && windowTitle !== lastWindowTitle) {
    lastWindowTitle = windowTitle;
    void getCurrentWindow().setTitle(windowTitle).catch(showError);
  }
  const toggle = document.querySelector<HTMLButtonElement>("#row-display")!;
  toggle.hidden =
    tab !== "watch" || !["small", "gray"].includes(state.settings.appearance);
  toggle.textContent =
    state.settings.rowDisplay === "trend"
      ? !state.marketOpen && !state.demo
        ? "近日線"
        : "當日線"
      : state.settings.rowDisplay === "minimal"
        ? "極簡"
        : "數字";
  toggle.setAttribute("aria-description", "目前：" + toggle.textContent);
  document.body.dataset.page = tab;
  document.body.dataset.appearance = state.settings.appearance;
  document.body.dataset.density = state.settings.rowDisplay ?? "numbers";
  document.querySelector("#rule-count")!.textContent = String(
    state.rules.filter((r) => r.enabled).length,
  );
  document.querySelector("#banner")!.innerHTML = state.demo
    ? '<span class="demo-label">示範資料</span><span>合成行情 · 不代表真實市場</span>'
    : "";
  const missing = state.watchlist.filter((c) => !state.quotes[c]).length;
  const old = state.watchlist.some((c) => stale(state.quotes[c], state.now));
  document.querySelector("#health")!.textContent = state.settings.paused
    ? "Ⅱ 已暫停監看"
    : state.error
      ? "○ 連線異常 · 正在退避重試"
      : missing
        ? "○ 部分行情尚未取得"
        : state.demo
          ? "● 示範模式"
          : !state.marketOpen
            ? "○ 非一般交易時段 · 僅供查看"
            : old
              ? "○ 來源資料已過期"
              : "● 本機監看中";
  document.querySelector<HTMLElement>("#health")!.title =
    state.error ?? "通知僅依新鮮成交資料判定，首次觀測只建立基準";
  document.querySelector("#source")!.textContent = state.demo
    ? "DEMO"
    : `TWSE MIS · 取得 ${time(state.lastFetch)}`;
  if (!state.demo && !state.marketOpen) {
    const date = latestCloseDate(state);
    const label = date
      ? (date.startsWith(
          new Date(state.now)
            .toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" })
            .slice(0, 4),
        )
          ? date.slice(5).replace("-", "/")
          : date.replaceAll("-", "/")) + " 收盤"
      : "取得收盤資料中";
    document.querySelector("#health")!.textContent =
      `${state.settings.paused ? "Ⅱ 已暫停" : "○ 休市"} · ${label}`;
    document.querySelector("#source")!.textContent = "TWSE / TPEx · 日資料";
  }
  if (
    state.settings.rowDisplay === "trend" &&
    ["small", "gray"].includes(state.settings.appearance)
  )
    document.querySelector("#source")!.textContent = state.demo
      ? "DEMO · 分時示意"
      : !state.marketOpen
        ? "近日收盤走勢"
        : "分鐘線 · 可能延遲";
}
function rows() {
  const commonDate = latestCloseDate(state);
  return (
    state.watchlist
      .map((c) => {
        const q = state.quotes[c];
        const closed = !state.marketOpen && !state.demo;
        const d = closed ? state.dailySummaries[c]?.days.at(-1) : undefined;
        const pct = closed ? d?.changePercent : q?.changePercent;
        const stamp = closed
          ? (d?.date ?? "尚未取得正式收盤")
          : time(q?.sourceAt);
        const name =
          q?.name || (c === "t00" ? "加權指數" : c === "o00" ? "櫃買指數" : "");
        const sign = (pct ?? 0) > 0 ? "up" : (pct ?? 0) < 0 ? "down" : "flat";
        const trend =
          state.settings.rowDisplay === "trend" ? trendCell(state, c) : null;
        return `<button class="quote ${sign}${!closed && stale(q, state.now) ? " stale" : ""}" data-quote="${esc(c)}" title="${esc(name && name !== c ? `${name}（${c}）` : c)} · ${closed ? "正式收盤" : "來源時間"} ${esc(stamp)} · 價格 ${number(closed ? d?.close : q?.price)}${trend ? " · " + esc(trend.title) : ""} · 點擊查看行情"><span class="stock-name">${state.settings.showCodes || !name ? `<span class="stock-code">${esc(c)}</span>` : ""}<strong>${esc(name)}</strong></span>${trend ? `<span class="trend-slot">${trend.html}</span>` : `<span class="price">${number(closed ? d?.close : q?.price)}</span>`}<span class="change">${change(pct)}</span>${closed && d && d.date !== commonDate ? `<span class="as-of">${d.date.slice(5).replace("-", "/")}</span>` : ""}</button>`;
      })
      .join("") || '<div class="empty">加入第一檔自選，讓重要變化來找你。</div>'
  );
}
function watch() {
  const a = state.settings.appearance;
  const last = state.events[0];
  const closed = !state.marketOpen && !state.demo;
  if (a === "terminal" || a === "txt") return disguiseMarkup(state);
  if (state.settings.rowDisplay === "minimal")
    return `<div class="minimal-bar"><span class="minimal-grip" data-tauri-drag-region><i data-tauri-drag-region></i></span>${state.demo ? '<span class="minimal-demo-tag">示範</span>' : ""}${minimalMarkup(state)}<span class="minimal-bar-actions"><button id="minimal-cycle" aria-label="切換顯示內容" title="回到數字">≡</button><button id="minimal-settings" aria-label="極簡顯示設定" title="顯示設定">⋯</button></span></div>`;
  return `<div class="quotes">${rows()}</div>${last ? `<div class="latest"><span class="latest-dot"></span><span>${esc(last.text)}</span></div>` : ""}`;
}
function render() {
  hideDetail();
  minimalObserver?.disconnect();
  document.body.dataset.page = tab;
  apply();
  content.onkeydown = null;
  content.scrollTop = 0;
  document
    .querySelectorAll("[data-tab]")
    .forEach((e) =>
      e.classList.toggle("active", (e as HTMLElement).dataset.tab === tab),
    );
  if (tab === "watch") content.innerHTML = watch();
  if (tab === "daily") dailyPage();
  if (tab === "settings")
    content.innerHTML = `<div class="pane"><h1>讓它融入你的桌面</h1><p class="intro">同一份自選與提醒，換一種工作時的樣子。</p><div class="appearance-grid">${[
      ["small", "small", "品牌配色 · 紅漲綠跌"],
      ["gray", "small 灰階", "熟悉的元件，更安靜"],
      [
        "terminal",
        "terminal",
        isMac ? "Mac 終端機 · zsh 外觀" : "Windows Terminal · 工程工作",
      ],
      [
        "txt",
        "txt",
        isMac ? "文字編輯 TextEdit · 純文字" : "Windows 記事本 · 日常工作",
      ],
    ]
      .map(
        ([id, name, sub]) =>
          `<button class="appearance ${id === state.settings.appearance ? "selected" : ""}" data-look="${id}"><span class="look-sample ${id}">${id === "terminal" ? "&gt; monitor --local" : id === "txt" ? "追蹤筆記.txt" : "●　2330　+0.8%"}</span><strong>${name}</strong><small>${sub}</small></button>`,
      )
      .join(
        "",
      )}</div><div class="setting-row"><label>顯示內容<select id="display-mode"><option value="numbers" ${state.settings.rowDisplay === "numbers" || !state.settings.rowDisplay ? "selected" : ""}>純數字</option><option value="trend" ${state.settings.rowDisplay === "trend" ? "selected" : ""}>單行走勢</option><option value="minimal" ${state.settings.rowDisplay === "minimal" ? "selected" : ""}>極簡：方向與名稱</option></select></label><label class="setting-check"><input id="show-codes" type="checkbox" ${state.settings.showCodes ? "checked" : ""}> 顯示代號</label></div><div class="note density-note">極簡方向為當日漲跌；— 平盤，○ 資料未確認。名稱尚未取得時會使用代號。</div><div class="setting-row"><label class="setting-check"><input id="always-on-top" type="checkbox" ${state.settings.alwaysOnTop !== false ? "checked" : ""}> 視窗保持置頂</label></div><div class="setting-row"><div><strong>監看狀態</strong><small>隱藏視窗仍會監看，暫停則停止判定。</small></div><button id="pause" class="secondary">${state.settings.paused ? "繼續監看" : "暫停監看"}</button></div><label class="setting-row">更新間隔（秒）<input id="refresh" type="number" min="5" max="300" value="${state.settings.refreshSeconds}"></label><button id="save-refresh" class="secondary">儲存更新間隔</button><div class="note">所有外觀預設無聲。灰階通知跟隨外觀。<br>${privacyShortcutLabel} 隱藏全部視窗，從系統匣恢復。<br>${state.privacyShortcutError ? esc(state.privacyShortcutError) + "<br>" : ""}資料：TWSE MIS；來源時間與取得時間分開顯示。<br>首次觀測只建立基準；過期或缺少成交價時不觸發。<br>${desktop ? "agent：以程式加上 --mcp 啟動連接，詳見 README。" : "瀏覽器僅顯示合成預覽；桌面版才會實際監看與提供 MCP。"}</div></div>`;
  if (tab === "rules")
    content.innerHTML = `<div class="pane"><h1>只在你在意的時候</h1><p class="intro">首次觀測建立基準，之後跨過門檻才提醒。</p><form id="rule-form"><div class="form-grid"><label>股票代號<input name="symbol" required placeholder="2330" value="${esc(editing?.symbol ?? state.watchlist.find((c) => c !== "t00") ?? "2330")}"></label><label>觀測項目<select name="metric"><option value="price">成交價（元）</option><option value="changePercent" ${editing?.metric === "changePercent" ? "selected" : ""}>漲跌幅（%）</option></select></label><label>方向<select name="direction"><option value="above">由下往上跨過</option><option value="below" ${editing?.direction === "below" ? "selected" : ""}>由上往下跨過</option></select></label><label>門檻<input name="threshold" type="number" step="any" required placeholder="例如 1000" value="${editing?.threshold ?? ""}"></label><label>通知<select name="channel">${[
      ["strip", "細條"],
      ["card", "卡片"],
      ["log", "只記錄"],
      ["off", "關閉"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${editing?.channel === v ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></label><label>頻率<select name="repeat"><option value="daily">每交易日一次</option><option value="once" ${editing?.repeat === "once" ? "selected" : ""}>只通知一次</option></select></label></div><button class="primary" type="submit">${editing ? "儲存修改" : "建立提醒"}</button>${editing ? '<button type="button" id="cancel-edit">取消</button>' : ""}</form><div class="rule-list">${state.rules.map((r) => `<div class="rule"><div><strong>${esc(ruleText(r))}</strong><small>${r.enabled ? "監看中" : "已停用"} · ${r.repeat === "daily" ? "每日一次" : "一次性"} · ${r.channel}${r.firedDay ? " · 最近觸發 " + esc(r.firedDay) : ""}</small></div><div><button data-edit="${r.id}" title="修改">修改</button><button data-toggle="${r.id}">${r.enabled ? "停用" : "啟用"}</button><button data-delete="${r.id}" title="刪除">×</button></div></div>`).join("") || '<p class="empty">尚未建立提醒，也可以請 agent 幫你設定。</p>'}</div></div>`;
  if (tab === "history")
    content.innerHTML = `<div class="pane"><h1>發生過的事</h1><p class="intro">最多保留 500 則，時間為資料來源的台灣時間。</p>${state.events.map((e) => `<div class="event"><time>${time(e.sourceAt)}</time><div><strong>${esc(e.text)}</strong><small>偵測於 ${time(e.detectedAt)} · 規則 ${esc(e.ruleId.slice(0, 8))}</small></div></div>`).join("") || '<div class="empty">目前還沒有符合規則的事件。<br>不必一直盯著，有事會告訴你。</div>'}</div>`;

  if (
    tab === "watch" &&
    ["terminal", "txt"].includes(state.settings.appearance)
  )
    bindDisguise(
      content,
      state,
      skinAction,
      openStock,
      () => void fitMinimal(),
    );
  bind();
  if (tab === "watch" && state.settings.rowDisplay === "minimal")
    observeMinimal();
  void resize();
}
function manage() {
  document.body.dataset.page = "manage";
  apply();
  content.innerHTML = `<div class="pane"><h1>你的自選清單</h1><p class="intro">貼上多檔代號，以空白、逗號或換行分隔。最多 30 檔。</p><label>搜尋名稱或代號<input id="search" placeholder="例如：台積電、0050" autocomplete="off"></label><div id="results"></div><label>目前自選<textarea id="symbols" rows="5">${esc(state.watchlist.join(", "))}</textarea></label><button id="save-symbols" class="primary">儲存自選</button><button id="back-watch">返回</button><p class="note">有啟用中規則的標的，請先停用規則再移除。<br>加權：t00　櫃買：o00</p></div>`;
  if (desktop) void getCurrentWindow().setSize(new LogicalSize(500, 460));
  document.querySelector("#save-symbols")!.addEventListener("click", () => {
    tab = "watch";
    const symbols = document
      .querySelector<HTMLTextAreaElement>("#symbols")!
      .value.split(/[\s,，;；]+/)
      .filter(Boolean);
    void mutate("set_watchlist", { symbols });
  });
  document.querySelector("#back-watch")!.addEventListener("click", () => {
    tab = "watch";
    render();
  });
  document.querySelector("#search")!.addEventListener("input", async (e) => {
    const version = ++searchVersion;
    const query = (e.target as HTMLInputElement).value;
    await new Promise((r) => setTimeout(r, 350));
    if (version !== searchVersion) return;
    try {
      const results = await search(query);
      if (version !== searchVersion) return;
      document.querySelector("#results")!.innerHTML = results
        .map(
          (r) =>
            `<button type="button" data-add="${esc(r.symbol)}">＋ ${esc(r.name)} <small>${esc(r.symbol)}</small></button>`,
        )
        .join("");
      document.querySelectorAll<HTMLButtonElement>("[data-add]").forEach(
        (b) =>
          (b.onclick = () => {
            const field =
              document.querySelector<HTMLTextAreaElement>("#symbols")!;
            const list = field.value.split(/[\s,，;；]+/).filter(Boolean);
            if (!list.includes(b.dataset.add!)) list.push(b.dataset.add!);
            field.value = list.join(", ");
          }),
      );
    } catch (e) {
      showError(e);
    }
  });
}
function bind() {
  document
    .querySelector(".minimal-grip")
    ?.addEventListener("pointerdown", hideDetail);
  document
    .querySelector("#minimal-cycle")
    ?.addEventListener(
      "click",
      () => void mutate("set_settings", { rowDisplay: "numbers" }),
    );
  document.querySelector("#minimal-settings")?.addEventListener("click", () => {
    tab = "settings";
    render();
  });
  document.querySelector("#display-mode")?.addEventListener(
    "change",
    (e) =>
      void mutate("set_settings", {
        rowDisplay: (e.target as HTMLSelectElement).value,
      }),
  );
  document.querySelector("#always-on-top")?.addEventListener(
    "change",
    (e) =>
      void mutate("set_settings", {
        alwaysOnTop: (e.target as HTMLInputElement).checked,
      }),
  );
  document.querySelector("#show-codes")?.addEventListener(
    "change",
    (e) =>
      void mutate("set_settings", {
        showCodes: (e.target as HTMLInputElement).checked,
      }),
  );
  if (
    tab === "watch" &&
    state.settings.rowDisplay === "minimal" &&
    !content.querySelector("[data-disguise]")
  ) {
    bindMinimal(content, state, openStock);
  }
  document.querySelectorAll<HTMLButtonElement>("[data-quote]").forEach(
    (b) =>
      (b.onclick = () => {
        openStock(b.dataset.quote!);
      }),
  );
  document.querySelector<HTMLButtonElement>("#manage")!.onclick = () => {
    tab = "manage";
    manage();
  };
  document.querySelectorAll<HTMLButtonElement>("[data-look]").forEach(
    (b) =>
      (b.onclick = () =>
        void mutate("set_settings", {
          appearance: b.dataset.look as Appearance,
        })),
  );
  document
    .querySelector("#pause")
    ?.addEventListener(
      "click",
      () => void mutate("set_settings", { paused: !state.settings.paused }),
    );
  document.querySelector("#save-refresh")?.addEventListener(
    "click",
    () =>
      void mutate("set_settings", {
        refreshSeconds: Number(
          document.querySelector<HTMLInputElement>("#refresh")!.value,
        ),
      }),
  );
  document.querySelector("#cancel-edit")?.addEventListener("click", () => {
    editing = undefined;
    render();
  });
  document.querySelector("#rule-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(
      new FormData(e.target as HTMLFormElement).entries(),
    );
    void mutate("upsert_rule", {
      ...data,
      threshold: Number(data.threshold),
      enabled: editing?.enabled ?? true,
      ...(editing ? { id: editing.id } : {}),
    });
    editing = undefined;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        editing = state.rules.find((r) => r.id === b.dataset.edit);
        render();
      }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-delete]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          void mutate("delete_rule", { id: b.dataset.delete })),
    );
  document.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach(
    (b) =>
      (b.onclick = () => {
        const r = state.rules.find((r) => r.id === b.dataset.toggle)!;
        void mutate("upsert_rule", { ...r, enabled: !r.enabled });
      }),
  );
}
document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab!;
      editing = undefined;
      render();
    }),
);
document.querySelector("#row-display")!.addEventListener(
  "click",
  () =>
    void mutate("set_settings", {
      rowDisplay:
        state.settings.rowDisplay === "minimal"
          ? "numbers"
          : state.settings.rowDisplay === "trend"
            ? "minimal"
            : "trend",
    }),
);
document.querySelector("#hide")!.addEventListener("click", () => {
  hideDetail();
  if (desktop) void getCurrentWindow().hide();
  else showError("桌面版可隱藏到系統匣，監看會持續。");
});
document.addEventListener("keydown", (e) => {
  if (privacyPressed(e)) {
    e.preventDefault();
    hideDetail();
    if (desktop) void invoke("privacy_hide").catch(showError);
    else showError("桌面版可隱藏所有視窗，監看仍會持續。");
    return;
  }
  if (
    tab === "watch" &&
    state?.settings.rowDisplay === "minimal" &&
    document.body.dataset.skin === "small" &&
    primaryPressed(e) &&
    e.key === ","
  ) {
    e.preventDefault();
    tab = "settings";
    render();
  }
});
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const next = await request("get_status");
    const previous = state;
    state = next;
    apply();
    if (tab === "daily" && dailyData?.pending) void loadDaily();
    if (!previous) render();
    else if (tab === "watch") {
      if (["terminal", "txt"].includes(state.settings.appearance)) {
        if (
          content
            .querySelector("[data-disguise]")
            ?.getAttribute("data-disguise") !== state.settings.appearance ||
          content
            .querySelector("[data-disguise]")
            ?.getAttribute("data-row-mode") !==
            (state.settings.rowDisplay ?? "numbers")
        )
          render();
        else updateDisguise(content, state);
      } else {
        content.onkeydown = null;
        if (
          state.settings.rowDisplay === "minimal" &&
          content.querySelector(".minimal-list")
        ) {
          updateMinimal(content, state);
        } else {
          if (content.querySelector(".minimal-list")) hideDetail();
          content.innerHTML = watch();
          bind();
          if (state.settings.rowDisplay === "minimal") observeMinimal();
        }
      }
      if (
        previous.settings.appearance !== state.settings.appearance ||
        previous.watchlist.length !== state.watchlist.length ||
        Boolean(previous.events.length) !== Boolean(state.events.length)
      )
        void resize();
    } else if (
      previous.revision !== state.revision &&
      !content.contains(document.activeElement)
    )
      render();
  } catch (e) {
    showError(e);
  } finally {
    busy = false;
  }
}
void poll();
setInterval(() => void poll(), 1000);
