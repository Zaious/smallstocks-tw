export type Appearance = "small" | "gray" | "terminal" | "txt";
export interface Day {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  volumeUnit: string;
}
export interface DailyView {
  symbol: string;
  days: Day[];
  sources: string[];
  fetchedAt: number;
  pending: boolean;
  error: string | null;
  demo: boolean;
}
export interface Quote {
  symbol: string;
  name: string;
  price: number | null;
  previous: number | null;
  bid: number | null;
  ask: number | null;
  changePercent: number | null;
  /** Average of the best bid and ask: an order-book value, never a trade. */
  mid?: number | null;
  midChangePercent?: number | null;
  sourceAt: number;
  receivedAt: number;
  /** When the last trade happened, when the source said. */
  tradeAt?: number | null;
  date: string;
  source: string;
}
export interface Rule {
  id: string;
  symbol: string;
  metric: "price" | "changePercent" | "mid" | "midChangePercent";
  direction: "above" | "below";
  threshold: number;
  channel: "off" | "log" | "strip" | "card";
  repeat: "once" | "daily";
  enabled: boolean;
  firedDay: string | null;
}
export interface StockEvent {
  id: string;
  ruleId: string;
  symbol: string;
  text: string;
  sourceAt: number;
  detectedAt: number;
  channel: Rule["channel"];
  value: number;
  threshold: number;
}
export interface Snapshot {
  intraday: Record<string, IntradayView>;
  dailySummaries: Record<string, DailyView>;
  watchlist: string[];
  settings: {
    alwaysOnTop?: boolean;
    appearance: Appearance;
    paused: boolean;
    refreshSeconds: number;
    rowDisplay?: "numbers" | "trend" | "minimal";
    showCodes?: boolean;
    updateCheck?: boolean;
  };
  quotes: Record<string, Quote>;
  rules: Rule[];
  events: StockEvent[];
  demo: boolean;
  error: string | null;
  privacyShortcutError?: string | null;
  lastFetch: number | null;
  nextPoll: number;
  marketOpen: boolean;
  /** Holiday name when the official calendar closes a weekday session. */
  marketClosedReason?: string | null;
  now: number;
  revision: number;
}
export interface IntradayPoint {
  at: number;
  price: number | null;
}
export interface IntradayView {
  series: {
    symbol: string;
    date: string;
    source: string;
    fetchedAt: number;
    partial: boolean;
    points: IntradayPoint[];
  } | null;
  pending: boolean;
  error: string | null;
  demo: boolean;
}
export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const number = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
export const change = (n: number | null | undefined) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
export const time = (n: number | null | undefined) =>
  n
    ? new Date(n).toLocaleTimeString("zh-TW", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Taipei",
      })
    : "尚未取得";
// Stock snapshots arrive about every one to two minutes; the core uses the same three minutes.
export const FRESH_MS = 180_000;
export const stale = (q: Quote | undefined, now: number) =>
  !q || now - q.sourceAt > FRESH_MS || q.sourceAt > now + 5000;
/**
 * The number a live quote shows. The last trade when the source gave one; otherwise the average of
 * the best bid and ask, which is marked as an order price wherever it is drawn and is never called
 * a trade. "none" when neither exists.
 */
// Data is "aging" (drawn grey) after a minute and "stale" (expired) after three.
export const AGING_MS = 60_000;
export const aging = (q: Quote | undefined, now: number) =>
  !stale(q, now) && now - q!.sourceAt > AGING_MS;
/** Seconds since the source's own snapshot time, 0 when it is not older than now. */
export const ageSeconds = (q: Quote | undefined, now: number) =>
  q ? Math.max(0, Math.round((now - q.sourceAt) / 1000)) : null;
/** The oldest snapshot time among the watched symbols: the data is at least this fresh. */
export function oldestDataAt(
  s: Pick<Snapshot, "watchlist" | "quotes">,
): number | null {
  const times = s.watchlist
    .map((c) => s.quotes[c]?.sourceAt)
    .filter((t): t is number => typeof t === "number");
  return times.length ? Math.min(...times) : null;
}
export type PriceBasis = "trade" | "book" | "none";
export function livePrice(q: Quote | undefined): {
  price: number | null;
  pct: number | null;
  basis: PriceBasis;
} {
  if (q?.price != null)
    return { price: q.price, pct: q.changePercent ?? null, basis: "trade" };
  if (q?.mid != null)
    return { price: q.mid, pct: q.midChangePercent ?? null, basis: "book" };
  return { price: null, pct: null, basis: "none" };
}
export const BOOK_NOTE = "委託價（買賣中間價），非成交價";
/**
 * The close a closed-session view shows for one symbol.
 *  - "official": the official daily row for today (published after 15:00).
 *  - "final": today's last trade from the live source, once the session has ended (the closing
 *    auction trade at 13:30, or from 13:34 for a postponed close). It is labelled as awaiting the
 *    official daily data and is replaced by it when that arrives.
 *  - "previous": the latest earlier trading day, used before today's close is known.
 */
export interface CloseDay {
  date: string;
  close: number;
  changePercent: number | null;
  kind: "official" | "final" | "previous";
}
const taipeiDay = (ms: number) =>
  new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
export function closeDay(
  s: Pick<Snapshot, "dailySummaries"> &
    Partial<Pick<Snapshot, "quotes" | "now">>,
  c: string,
): CloseDay | undefined {
  const d = s.dailySummaries[c]?.days.at(-1);
  const q = s.quotes?.[c];
  if (s.now && q && q.price != null) {
    const today = taipeiDay(s.now),
      closeAt = Date.parse(`${today}T13:30:00+08:00`),
      traded = q.tradeAt ?? 0;
    const sameDay = q.date === today.replaceAll("-", "");
    const settled =
      traded >= closeAt ||
      (s.now >= closeAt + 4 * 60_000 && q.sourceAt >= closeAt);
    if (d?.date === today)
      return {
        date: d.date,
        close: d.close,
        changePercent: d.changePercent,
        kind: "official",
      };
    if (sameDay && settled && s.now >= closeAt)
      return {
        date: today,
        close: q.price,
        changePercent: q.changePercent,
        kind: "final",
      };
  }
  return d
    ? {
        date: d.date,
        close: d.close,
        changePercent: d.changePercent,
        kind: s.now && d.date === taipeiDay(s.now) ? "official" : "previous",
      }
    : undefined;
}
export function latestCloseDate(
  s: Pick<Snapshot, "watchlist" | "dailySummaries"> &
    Partial<Pick<Snapshot, "quotes" | "now">>,
): string | null {
  const dates = s.watchlist
    .map((c) => closeDay(s, c)?.date)
    .filter((d): d is string => Boolean(d));
  return dates.sort().at(-1) ?? null;
}
export const ruleText = (r: Rule) =>
  `${r.symbol} · ${METRIC_LABEL[r.metric] ?? r.metric}${r.direction === "above" ? "升至" : "降至"} ${number(r.threshold)}${r.metric === "price" || r.metric === "mid" ? " 元" : "%"}`;
const METRIC_LABEL: Record<string, string> = {
  price: "成交價",
  changePercent: "漲跌幅",
  mid: "買賣中間價（委託價）",
  midChangePercent: "漲跌幅（買賣中間價）",
};
// Adapted from Terminalol's escaped fixed-width rows; stock-specific data stays separate.
export function terminalRows(s: Snapshot): string {
  return s.watchlist
    .map((c) => {
      const q = s.quotes[c];
      const d = !s.marketOpen && !s.demo ? closeDay(s, c) : undefined;
      const name = [...(q?.name ?? "等待資料")].slice(0, 8).join("");
      const cells = [...name].reduce(
        (n, c) => n + (/[^\u0000-\u00ff]/.test(c) ? 2 : 1),
        0,
      );
      return `${c.padEnd(8)}${name}${" ".repeat(Math.max(0, 16 - cells))} ${number(d?.close ?? livePrice(q).price).padStart(10)} ${change(d ? d.changePercent : livePrice(q).pct).padStart(9)}  ${d ? "CLOSE " + d.date : stale(q, s.now) ? "STALE" : livePrice(q).basis === "book" ? "BOOK" : livePrice(q).basis === "none" ? "NO PRICE" : "OK"}`;
    })
    .join("\n");
}
