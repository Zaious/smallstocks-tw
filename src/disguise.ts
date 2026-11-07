import { esc, number, change, time, latestCloseDate, stale } from "./model.ts";
import type { Snapshot } from "./model.ts";
import { minimalMarkup, bindMinimal, updateMinimal } from "./minimal.ts";
import { stockDetail } from "./stock-view.ts";
export type SkinAction =
  | "watch"
  | "daily"
  | "rules"
  | "history"
  | "settings"
  | "manage"
  | "small"
  | "hide"
  | "minimize"
  | "maximize"
  | "pause"
  | "resume";
export type SkinHandler = (action: SkinAction) => void;
let lastState: Snapshot,
  handler: SkinHandler,
  zoom = 100,
  showStatus = true;
let commandLog: string[] = [];
let relayout: () => void = () => {};
const pad = (text: string, cells: number) => {
  let out = "",
    used = 0;
  for (const c of text) {
    const n = c.charCodeAt(0) > 255 ? 2 : 1;
    if (used + n > cells) break;
    out += c;
    used += n;
  }
  return out + " ".repeat(cells - used);
};
function values(s: Snapshot, c: string) {
  const q = s.quotes[c],
    closed = !s.marketOpen && !s.demo,
    d = closed ? s.dailySummaries[c]?.days.at(-1) : undefined;
  return {
    code: c,
    name: q?.name || (c === "t00" ? "加權指數" : c === "o00" ? "櫃買指數" : ""),
    price: closed ? d?.close : q?.price,
    date: d?.date,
    pct: closed ? d?.changePercent : q?.changePercent,
    status: closed
      ? d
        ? d.date !== latestCloseDate(s)
          ? d.date.slice(5).replace("-", "/")
          : "CLOSED"
        : "WAITING"
      : stale(q, s.now)
        ? "STALE"
        : q?.price == null
          ? "NO TRADE"
          : "OK",
  };
}
function dateLabel(s: Snapshot) {
  const d = latestCloseDate(s);
  return !s.marketOpen && !s.demo
    ? d
      ? d.replaceAll("-", "/") + " 收盤"
      : "等待收盤資料"
    : time(s.lastFetch);
}
export function notepadText(s: Snapshot): string {
  const lines = [
    "資料紀錄",
    `${!s.marketOpen && !s.demo ? "資料日期" : "更新"}：${dateLabel(s)}`,
    ...(s.demo ? ["示範資料（非真實行情）"] : []),
    "",
    (s.settings.showCodes ? pad("代號", 7) : "") +
      pad("名稱", 14) +
      pad("數值", 12) +
      pad("變化", 10),
    ...s.watchlist.map((c) => {
      const v = values(s, c);
      return (
        (s.settings.showCodes ? pad(v.code, 7) : "") +
        pad(v.name || v.code, 14) +
        number(v.price).padStart(10) +
        "  " +
        change(v.pct).padStart(8) +
        (v.date && v.date !== latestCloseDate(s)
          ? `  (${v.date.slice(5).replace("-", "/")})`
          : "")
      );
    }),
    "",
    s.settings.paused
      ? "狀態：已暫停"
      : !s.marketOpen && !s.demo
        ? "狀態：已收盤"
        : "狀態：追蹤中",
  ];
  if (s.events.length)
    lines.push(
      "",
      "最近紀錄",
      ...s.events.slice(0, 4).map((e) => `${time(e.sourceAt)}  ${e.text}`),
    );
  return lines.join("\n");
}
function terminalText(s: Snapshot): string {
  const lines = [
    "PS C:\\Work> npm run sync -- --watch",
    "",
    `> sync-job  monitor`,
    `> refresh=${s.settings.refreshSeconds}s  streams=${s.watchlist.length}  rules=${s.rules.filter((r) => r.enabled).length}`,
    ...(s.demo ? ["[demo] synthetic data — not market quotes"] : []),
    "",
    `[${time(s.lastFetch)}] ${s.settings.paused ? "PAUSED" : !s.marketOpen && !s.demo ? "CLOSED" : "RUNNING"}${!s.marketOpen && !s.demo ? "  " + dateLabel(s) : ""}`,
    "",
    (s.settings.showCodes ? pad("ID", 7) : "") +
      pad("NAME", 14) +
      pad("LAST", 12) +
      pad("CHANGE", 11) +
      "STATE",
    ...s.watchlist.map((c) => {
      const v = values(s, c);
      return (
        (s.settings.showCodes ? pad(v.code, 7) : "") +
        pad(v.name || v.code, 14) +
        number(v.price).padStart(10) +
        "  " +
        change(v.pct).padStart(9) +
        "  " +
        v.status
      );
    }),
  ];
  if (s.events.length)
    lines.push(
      "",
      ...s.events.slice(0, 3).map((e) => `[${time(e.sourceAt)}] ${e.text}`),
    );
  if (s.error)
    lines.push("", "[warning] feed connection unavailable; retry scheduled");
  if (commandLog.length) lines.push("", ...commandLog);
  return lines.join("\n");
}
function terminalMarkup(s: Snapshot): string {
  const all = terminalText(s).split("\n");
  const index = all.findIndex((l) =>
    l.startsWith((s.settings.showCodes ? pad("ID", 7) : "") + pad("NAME", 14)),
  );
  const cell = (value: string, kind: string) =>
    `<span class="console-field ${kind}">${esc(value)}</span>`;
  const head =
    (s.settings.showCodes ? cell("ID", "id") : "") +
    cell("NAME", "name") +
    cell("LAST  ", "last") +
    cell("CHANGE  ", "change") +
    cell("STATE", "state");
  const rows = s.watchlist.map((c) => {
    const v = values(s, c);
    return (
      (s.settings.showCodes ? cell(pad(v.code, 7), "id") : "") +
      cell(pad(v.name || v.code, 14), "name") +
      cell(number(v.price) + "  ", "last") +
      cell(change(v.pct) + "  ", "change") +
      cell(v.status, "state")
    );
  });
  return (
    esc(all.slice(0, index).join("\n") + "\n") +
    head +
    "\n" +
    rows.join("\n") +
    esc("\n" + all.slice(index + 1 + s.watchlist.length).join("\n"))
  );
}
const controls = () =>
  `<div class="native-controls"><button data-skin-action="minimize" aria-label="最小化" title="最小化"><i class="cap-min"></i></button><button data-skin-action="maximize" aria-label="最大化或還原" title="最大化或還原"><i class="cap-max"></i></button><button data-skin-action="hide" class="cap-close" aria-label="關閉視窗" title="關閉視窗，繼續監看"><i></i></button></div>`;
const item = (label: string, action: SkinAction, shortcut = "") =>
  `<button data-skin-action="${action}" role="menuitem"><span>${label}</span><small>${shortcut}</small></button>`;
const menu = (label: string, body: string) =>
  `<details class="native-menu"><summary>${label}</summary><div class="native-popup" role="menu">${body}</div></details>`;
export function disguiseMarkup(s: Snapshot): string {
  const terminal = s.settings.appearance === "terminal";
  const minimal = s.settings.rowDisplay === "minimal";
  const mini = `<div class="minimal-native"><div class="minimal-native-demo" ${!s.demo && !s.settings.paused ? "hidden" : ""}>${s.demo ? "示範資料（非真實行情）" : ""}${s.settings.paused ? " 已暫停監看" : ""}</div>${minimalMarkup(s)}</div>`;
  if (terminal)
    return `<section class="native-frame windows-terminal" data-disguise="terminal" data-row-mode="${s.settings.rowDisplay ?? "numbers"}"><div class="native-title terminal-titlebar" data-tauri-drag-region><div class="terminal-tab"><span class="console-icon" aria-hidden="true">&gt;_</span><span>PowerShell</span><button data-skin-action="hide" aria-label="關閉分頁">×</button></div><button class="native-add" data-skin-action="manage" aria-label="新增監看項目" title="新增監看項目">＋</button>${menu("⌄", item("自選清單…", "manage") + item("提醒設定…", "rules") + item("事件紀錄", "history") + "<hr>" + item("設定", "settings", "Ctrl+,") + item("返回 small", "small") + item("隱藏視窗", "hide"))}<div class="native-drag" data-tauri-drag-region></div>${controls()}</div><div class="terminal-screen">${minimal ? mini : ""}<pre class="console-output${minimal ? " console-minimal-log" : ""}"></pre><form class="console-command" autocomplete="off"><span>PS C:\Work&gt;</span><input aria-label="終端機模式指令" spellcheck="false" autocomplete="off" autocapitalize="off"></form></div></section>`;
  return `<section class="native-frame windows-notepad" data-disguise="txt" data-row-mode="${s.settings.rowDisplay ?? "numbers"}"><div class="native-title notepad-titlebar" data-tauri-drag-region><span class="notepad-icon" aria-hidden="true"></span><div class="notepad-tab"><span>工作紀錄.txt</span><button data-skin-action="hide" aria-label="關閉分頁">×</button></div><button class="native-add" data-skin-action="manage" aria-label="新增監看項目" title="新增監看項目">＋</button><div class="native-drag" data-tauri-drag-region></div>${controls()}</div><div class="notepad-menubar">${menu("檔案", item("自選清單…", "manage") + item("提醒設定…", "rules") + "<hr>" + item("返回 small", "small") + item("關閉視窗", "hide"))}${menu("編輯", '<button data-note-edit="select-all" role="menuitem"><span>全選</span><small>Ctrl+A</small></button><button data-note-edit="copy" role="menuitem"><span>複製</span><small>Ctrl+C</small></button>')}${menu("檢視", '<button data-zoom="in" role="menuitem"><span>放大</span><small>Ctrl++</small></button><button data-zoom="out" role="menuitem"><span>縮小</span><small>Ctrl+-</small></button><button data-zoom="reset" role="menuitem"><span>還原預設縮放</span><small>Ctrl+0</small></button><hr><button data-note-edit="status" role="menuitemcheckbox" aria-checked="true"><span>狀態列</span></button>' + item("事件紀錄", "history"))}<div class="notepad-menu-space"></div><button class="native-settings" data-skin-action="settings" aria-label="設定" title="設定">⚙︎</button></div>${minimal ? mini : '<textarea class="notepad-editor" aria-label="工作紀錄文字內容" readonly spellcheck="false" wrap="off"></textarea>'}<div class="notepad-status"><span class="caret-status">第 1 行，第 1 欄</span><span class="character-status"></span><span class="zoom-status">100%</span><span>Windows (CRLF)</span><span>UTF-8</span></div></section>`;
}
function closeMenus(root: HTMLElement) {
  root
    .querySelectorAll<HTMLDetailsElement>("details[open]")
    .forEach((d) => (d.open = false));
}
function caret(root: HTMLElement) {
  const editor = root.querySelector<HTMLTextAreaElement>(".notepad-editor");
  if (!editor) return;
  const before = editor.value.slice(0, editor.selectionStart);
  const copy = root.querySelector<HTMLButtonElement>('[data-note-edit="copy"]');
  if (copy) copy.disabled = editor.selectionStart === editor.selectionEnd;
  root.querySelector(".caret-status")!.textContent =
    `第 ${before.split("\n").length} 行，第 ${before.length - (before.lastIndexOf("\n") + 1) + 1} 欄`;
}
function setZoom(root: HTMLElement) {
  const editor = root.querySelector<HTMLTextAreaElement>(".notepad-editor");
  if (editor) editor.style.fontSize = `${(13 * zoom) / 100}px`;
  const minimal = root.querySelector<HTMLElement>(
    ".windows-notepad .minimal-native",
  );
  if (minimal) minimal.style.fontSize = `${(13 * zoom) / 100}px`;
  const status = root.querySelector(".zoom-status");
  if (status) status.textContent = `${zoom}%`;
}
export function bindDisguise(
  root: HTMLElement,
  s: Snapshot,
  onAction: SkinHandler,
  onStock?: (code: string) => void,
  onLayout?: () => void,
) {
  handler = onAction;
  lastState = s;
  relayout = onLayout ?? (() => {});
  if (s.settings.rowDisplay === "minimal")
    bindMinimal(root, s, (c) => (onStock ? onStock(c) : onAction("daily")));
  root.querySelectorAll<HTMLButtonElement>("[data-skin-action]").forEach(
    (b) =>
      (b.onclick = () => {
        closeMenus(root);
        onAction(b.dataset.skinAction as SkinAction);
      }),
  );
  root.querySelectorAll<HTMLDetailsElement>("details").forEach((d) =>
    d.addEventListener("toggle", () => {
      if (d.open)
        root
          .querySelectorAll<HTMLDetailsElement>("details")
          .forEach((other) => {
            if (other !== d) other.open = false;
          });
      if (lastState.settings.rowDisplay === "minimal") relayout();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-note-edit]").forEach(
    (b) =>
      (b.onclick = async () => {
        closeMenus(root);
        const editor =
          root.querySelector<HTMLTextAreaElement>(".notepad-editor");
        if (b.dataset.noteEdit === "status") {
          showStatus = !showStatus;
          root.querySelector<HTMLElement>(".notepad-status")!.hidden =
            !showStatus;
          b.setAttribute("aria-checked", String(showStatus));
          relayout();
          return;
        }
        if (!editor) {
          const list = root.querySelector(".minimal-list");
          if (!list) return;
          if (b.dataset.noteEdit === "select-all") {
            const range = document.createRange();
            range.selectNodeContents(list);
            const selection = document.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          } else {
            const text =
              document.getSelection()?.toString() || list.textContent || "";
            try {
              await navigator.clipboard.writeText(text);
            } catch {
              document.execCommand("copy");
            }
          }
          return;
        }
        editor.focus();
        if (b.dataset.noteEdit === "select-all") editor.select();
        else {
          const text =
            editor.value.slice(editor.selectionStart, editor.selectionEnd) ||
            editor.value;
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            editor.select();
            document.execCommand("copy");
          }
        }
        caret(root);
      }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach(
    (b) =>
      (b.onclick = () => {
        zoom =
          b.dataset.zoom === "reset"
            ? 100
            : Math.max(
                50,
                Math.min(200, zoom + (b.dataset.zoom === "in" ? 10 : -10)),
              );
        closeMenus(root);
        setZoom(root);
        relayout();
      }),
  );
  const editor = root.querySelector<HTMLTextAreaElement>(".notepad-editor");
  editor?.addEventListener("click", () => caret(root));
  editor?.addEventListener("keyup", () => caret(root));
  editor?.addEventListener("select", () => caret(root));
  root
    .querySelector<HTMLFormElement>(".console-command")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = root.querySelector<HTMLInputElement>(
        ".console-command input",
      )!;
      const command = input.value.trim();
      input.value = "";
      if (!command) return;
      const actions: Record<string, SkinAction> = {
        watch: "watch",
        rules: "rules",
        history: "history",
        settings: "settings",
        small: "small",
        hide: "hide",
        pause: "pause",
        resume: "resume",
        list: "manage",
      };
      if (command === "clear" || command === "cls") commandLog = [];
      else if (command === "help")
        commandLog.push(
          "PS C:\\Work> help",
          "watch | list | rules | history | settings | small | pause | hide | clear",
        );
      else if (actions[command]) {
        onAction(actions[command]);
        return;
      } else
        commandLog.push(
          `PS C:\\Work> ${command}`,
          "Unknown view command. Type help.",
        );
      commandLog = commandLog.slice(-6);
      updateDisguise(root, lastState);
    });
  root.onkeydown = (event) => {
    if (event.ctrlKey && event.key === ",") {
      event.preventDefault();
      handler("settings");
    }
    if (event.key === "Escape") closeMenus(root);
    if (
      s.settings.appearance === "txt" &&
      event.ctrlKey &&
      ["+", "=", "-", "0"].includes(event.key)
    ) {
      event.preventDefault();
      zoom =
        event.key === "0"
          ? 100
          : Math.max(50, Math.min(200, zoom + (event.key === "-" ? -10 : 10)));
      setZoom(root);
      relayout();
    }
  };
  updateDisguise(root, s);
}
export function updateDisguise(root: HTMLElement, s: Snapshot) {
  lastState = s;
  if (s.settings.rowDisplay === "minimal") {
    const info = root.querySelector<HTMLElement>(".minimal-native-demo");
    if (info) {
      info.hidden = !s.demo && !s.settings.paused;
      info.textContent =
        (s.demo ? "示範資料（非真實行情）" : "") +
        (s.settings.paused ? " 已暫停監看" : "");
    }
    updateMinimal(root, s);
    const output = root.querySelector<HTMLElement>(".console-output");
    if (output) output.textContent = commandLog.join("\n");
    const counter = root.querySelector(".character-status");
    if (counter)
      counter.textContent = `${root.querySelector(".minimal-list")?.textContent?.length ?? 0} 個字元`;
    const status = root.querySelector<HTMLElement>(".notepad-status");
    if (status) status.hidden = !showStatus;
    setZoom(root);
    relayout();
    return;
  }
  const output = root.querySelector<HTMLElement>(".console-output");
  if (output) {
    const selection = document.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.containsNode(output, true)
    )
      return;
    const text = terminalText(s);
    if (output.dataset.snapshot !== text) {
      output.innerHTML = terminalMarkup(s);
      output.dataset.snapshot = text;
    }
    return;
  }
  const editor = root.querySelector<HTMLTextAreaElement>(".notepad-editor");
  if (!editor) return;
  const next = notepadText(s);
  const selecting =
    document.activeElement === editor &&
    editor.selectionStart !== editor.selectionEnd;
  if (editor.value !== next && !selecting) {
    const start = editor.selectionStart,
      end = editor.selectionEnd,
      top = editor.scrollTop,
      left = editor.scrollLeft;
    editor.value = next;
    editor.setSelectionRange(
      Math.min(start, next.length),
      Math.min(end, next.length),
    );
    editor.scrollTop = top;
    editor.scrollLeft = left;
  }
  root.querySelector(".character-status")!.textContent =
    `${editor.value.length} 個字元`;
  root.querySelector<HTMLElement>(".notepad-status")!.hidden = !showStatus;
  caret(root);
  setZoom(root);
}
