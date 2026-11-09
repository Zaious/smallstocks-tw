import {
  esc,
  number,
  change,
  time,
  latestCloseDate,
  stale,
  livePrice,
  BOOK_NOTE,
} from "./model.ts";
import type { Snapshot } from "./model.ts";
export interface StockDetail {
  symbol: string;
  name: string;
  price: number | null;
  pct: number | null;
  date: string;
  sourceTime: string;
  source: string;
  status: string;
  /** "book": an order price (bid/ask average), not a trade. */
  basis: "trade" | "book" | "none";
  direction: "up" | "down" | "flat" | "unknown";
  mark: string;
  appearance: string;
  demo: boolean;
}
export function stockDetail(s: Snapshot, c: string): StockDetail {
  const q = s.quotes[c],
    closed = !s.marketOpen && !s.demo,
    d = closed ? s.dailySummaries[c]?.days.at(-1) : undefined;
  const name =
      q?.name || (c === "t00" ? "加權指數" : c === "o00" ? "櫃買指數" : c),
    live = livePrice(q),
    price = (closed ? d?.close : live.price) ?? null,
    pct = (closed ? d?.changePercent : live.pct) ?? null;
  const old = closed
    ? Boolean(d && d.date !== latestCloseDate(s))
    : stale(q, s.now);
  const valid =
    price != null &&
    pct != null &&
    Number.isFinite(price) &&
    Number.isFinite(pct) &&
    !old;
  const direction = valid
    ? pct > 0
      ? "up"
      : pct < 0
        ? "down"
        : "flat"
    : "unknown";
  const date = closed
    ? (d?.date ?? "—")
    : q?.date?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") || "—";
  return {
    symbol: c,
    name,
    price,
    pct,
    date,
    sourceTime: closed ? "收盤" : time(q?.sourceAt),
    source: closed
      ? s.dailySummaries[c]?.sources.join(" / ") || "日資料"
      : q?.source || "TWSE MIS",
    status:
      (s.settings.paused ? "已暫停監看 · " : "") +
      (old
        ? "資料較舊"
        : !valid
          ? "資料未確認"
          : closed
            ? "最近收盤"
            : live.basis === "book"
              ? BOOK_NOTE
              : "盤中資料"),
    basis: closed ? "trade" : live.basis,
    direction,
    mark:
      direction === "up"
        ? "▲"
        : direction === "down"
          ? "▼"
          : direction === "flat"
            ? "—"
            : "○",
    appearance: s.settings.appearance,
    demo: s.demo,
  };
}
export function detailLabel(d: StockDetail) {
  return `${d.name}（${d.symbol}） · ${d.mark} · 價格 ${number(d.price)} · 漲跌 ${change(d.pct)} · ${d.date} ${d.sourceTime} · ${d.status}`;
}
export function detailMarkup(d: StockDetail): string {
  return `<div class="detail-heading"><strong>${esc(d.name)}</strong>${d.name !== d.symbol ? `<span>${esc(d.symbol)}</span>` : ""}</div><div class="detail-values"><b>${d.basis === "book" ? '<small class="book-tag">委</small>' : ""}${number(d.price)}</b><span class="${d.direction}">${change(d.pct)}</span></div><div class="detail-date">${esc(d.date)}　${esc(d.sourceTime)}</div><div class="detail-status">${esc(d.status)}</div><div class="detail-source">${d.demo ? "合成示範資料" : esc(d.source)}</div>`;
}
