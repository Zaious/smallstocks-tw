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
  sourceAt: number;
  receivedAt: number;
  date: string;
  source: string;
}
export interface Rule {
  id: string;
  symbol: string;
  metric: "price" | "changePercent";
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
export const stale = (q: Quote | undefined, now: number) =>
  !q || now - q.sourceAt > 60_000 || q.sourceAt > now + 5000;
export function latestCloseDate(
  s: Pick<Snapshot, "watchlist" | "dailySummaries">,
): string | null {
  const dates = s.watchlist
    .map((c) => s.dailySummaries[c]?.days.at(-1)?.date)
    .filter((d): d is string => Boolean(d));
  return dates.sort().at(-1) ?? null;
}
export const ruleText = (r: Rule) =>
  `${r.symbol} · ${r.metric === "price" ? "成交價" : "漲跌幅"}${r.direction === "above" ? "升至" : "降至"} ${number(r.threshold)}${r.metric === "price" ? " 元" : "%"}`;
// Adapted from Terminalol's escaped fixed-width rows; stock-specific data stays separate.
export function terminalRows(s: Snapshot): string {
  return s.watchlist
    .map((c) => {
      const q = s.quotes[c];
      const d =
        !s.marketOpen && !s.demo ? s.dailySummaries[c]?.days.at(-1) : undefined;
      const name = [...(q?.name ?? "等待資料")].slice(0, 8).join("");
      const cells = [...name].reduce(
        (n, c) => n + (/[^\u0000-\u00ff]/.test(c) ? 2 : 1),
        0,
      );
      return `${c.padEnd(8)}${name}${" ".repeat(Math.max(0, 16 - cells))} ${number(d?.close ?? q?.price).padStart(10)} ${change(d ? d.changePercent : q?.changePercent).padStart(9)}  ${d ? "CLOSE " + d.date : stale(q, s.now) ? "STALE" : q?.price == null ? "NO TRADE" : "OK"}`;
    })
    .join("\n");
}
