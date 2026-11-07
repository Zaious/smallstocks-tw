import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { stockDetail, detailLabel, detailMarkup } from "./stock-view.ts";
import { esc } from "./model.ts";
import type { Snapshot } from "./model.ts";
import { directionMark } from "./direction-mark.ts";
let activeRoot: HTMLElement | null = null,
  snapshot: Snapshot,
  onOpen: (code: string) => void,
  anchor: HTMLButtonElement | null = null,
  timer: ReturnType<typeof setTimeout> | undefined,
  sequence = 0;
let browserTip: HTMLElement | null = null;
export function minimalMarkup(s: Snapshot): string {
  return `<div class="minimal-list" data-codes="${Boolean(s.settings.showCodes)}" aria-label="極簡自選清單">${
    s.watchlist
      .map((c) => {
        const d = stockDetail(s, c);
        return `<button type="button" class="minimal-stock ${d.direction}" data-mini-stock="${esc(c)}" aria-label="${esc(detailLabel(d))}"><span class="minimal-mark" data-piece="${s.settings.appearance}:${d.direction}" aria-hidden="true">${directionMark(d.direction, d.mark, s.settings.appearance)}</span><span class="minimal-name">${esc(d.name)}</span>${s.settings.showCodes && d.name !== c ? `<span class="minimal-code">${esc(c)}</span>` : ""}</button>`;
      })
      .join(" ") || '<span class="minimal-empty">尚無自選</span>'
  }</div>`;
}
export function hideDetail() {
  sequence++;
  if (timer) clearTimeout(timer);
  timer = undefined;
  anchor = null;
  if (browserTip) browserTip.hidden = true;
  if (isTauri()) void invoke("hide_stock_detail").catch(() => {});
}
async function showDetail(button: HTMLButtonElement) {
  const token = ++sequence;
  anchor = button;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (token !== sequence || !button.isConnected) return;
    const d = stockDetail(snapshot, button.dataset.miniStock!);
    const r = button.getBoundingClientRect();
    if (isTauri()) {
      try {
        await invoke("show_stock_detail", {
          detail: d,
          x: r.left,
          y: r.bottom,
          top: r.top,
        });
      } catch {}
      if (token !== sequence) void invoke("hide_stock_detail").catch(() => {});
    } else {
      if (!browserTip) {
        browserTip = document.createElement("div");
        browserTip.className = "stock-detail browser-detail";
        browserTip.setAttribute("role", "tooltip");
        document.body.append(browserTip);
      }
      browserTip.dataset.mode = d.appearance;
      browserTip.innerHTML = detailMarkup(d);
      browserTip.hidden = false;
      browserTip.style.left = `${Math.max(4, Math.min(innerWidth - 284, r.left))}px`;
      browserTip.style.top = `${Math.max(4, Math.min(innerHeight - 190, r.bottom + 5))}px`;
    }
  }, 220);
}
export function bindMinimal(
  root: HTMLElement,
  s: Snapshot,
  open: (code: string) => void,
) {
  hideDetail();
  activeRoot = root;
  snapshot = s;
  onOpen = open;
  const list = root.querySelector<HTMLElement>(".minimal-list");
  if (!list) return;
  list.onpointerover = (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>(
      "[data-mini-stock]",
    );
    if (button && button !== anchor) void showDetail(button);
  };
  list.onpointerout = (e) => {
    const b = (e.target as Element).closest("[data-mini-stock]");
    if (
      b === anchor &&
      !b?.contains(e.relatedTarget as Node) &&
      document.activeElement !== b
    )
      hideDetail();
  };
  list.addEventListener("focusin", (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>(
      "[data-mini-stock]",
    );
    if (button) void showDetail(button);
  });
  list.addEventListener("focusout", () => hideDetail());
  list.onkeydown = (e) => {
    if (e.key === "Escape") hideDetail();
  };
  list.onclick = (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>(
      "[data-mini-stock]",
    );
    if (b) {
      hideDetail();
      onOpen(b.dataset.miniStock!);
    }
  };
}
export function updateMinimal(root: HTMLElement, s: Snapshot) {
  snapshot = s;
  const list = root.querySelector<HTMLElement>(".minimal-list");
  if (!list) return;
  const buttons = [
    ...list.querySelectorAll<HTMLButtonElement>("[data-mini-stock]"),
  ];
  const structure =
    buttons.map((b) => b.dataset.miniStock).join("|") ===
      s.watchlist.join("|") &&
    list.dataset.codes === String(Boolean(s.settings.showCodes));
  if (!structure) {
    hideDetail();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = minimalMarkup(s);
    list.innerHTML = wrapper.firstElementChild!.innerHTML;
    list.dataset.codes = String(Boolean(s.settings.showCodes));
  }
  for (const b of list.querySelectorAll<HTMLButtonElement>(
    "[data-mini-stock]",
  )) {
    const d = stockDetail(s, b.dataset.miniStock!);
    b.className = `minimal-stock ${d.direction}`;
    b.setAttribute("aria-label", detailLabel(d));
    const mark = b.querySelector<HTMLElement>(".minimal-mark")!;
    const key = `${s.settings.appearance}:${d.direction}`;
    if (mark.dataset.piece !== key) {
      mark.innerHTML = directionMark(
        d.direction,
        d.mark,
        s.settings.appearance,
      );
      mark.dataset.piece = key;
    }
    b.querySelector(".minimal-name")!.textContent = d.name;
    const code = b.querySelector(".minimal-code");
    if (code) code.textContent = d.symbol;
  }
  if (anchor && anchor.isConnected && activeRoot === root)
    void showDetail(anchor);
}
if (isTauri()) {
  void listen("privacy-hide", hideDetail);
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) =>
      getCurrentWindow().onFocusChanged((e) => {
        if (!e.payload) hideDetail();
      }),
    )
    .catch(() => {});
}
