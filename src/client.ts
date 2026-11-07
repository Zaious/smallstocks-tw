import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Snapshot, DailyView } from "./model.ts";
export const desktop = isTauri();
let preview: Snapshot = {
  watchlist: ["t00", "2330", "0050"],
  dailySummaries: {},
  intraday: {},
  settings: {
    appearance: "small",
    paused: false,
    refreshSeconds: 15,
    alwaysOnTop: true,
  },
  quotes: {},
  rules: [],
  events: [],
  demo: true,
  error: null,
  lastFetch: null,
  nextPoll: 0,
  marketOpen: true,
  now: Date.now(),
  revision: 0,
};
const old = localStorage.getItem("smallstocks-preview");
if (!desktop && old) {
  try {
    preview = JSON.parse(old);
  } catch {
    /* Preview settings may be discarded. */
  }
}
export async function request(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<Snapshot> {
  if (desktop) return invoke<Snapshot>("core_request", { tool, args });
  if (tool === "set_settings") Object.assign(preview.settings, args);
  if (tool === "set_watchlist") preview.watchlist = args.symbols as string[];
  if (tool === "upsert_rule") {
    const id = (args.id as string) ?? crypto.randomUUID();
    preview.rules = preview.rules.filter((r) => r.id !== id);
    preview.rules.push({
      id,
      ...args,
      firedDay: null,
    } as unknown as Snapshot["rules"][number]);
  }
  if (tool === "delete_rule")
    preview.rules = preview.rules.filter((r) => r.id !== args.id);
  preview.now = Date.now();
  if (tool !== "get_status") preview.revision++;
  for (const [i, c] of preview.watchlist.entries()) {
    const base = c === "t00" ? 24180 : c === "0050" ? 62.4 : 1040;
    const p = base + (i - 1) * 0.2;
    preview.quotes[c] = {
      symbol: c,
      name:
        c === "t00"
          ? "加權指數"
          : c === "2330"
            ? "台積電"
            : c === "0050"
              ? "元大台灣50"
              : "示範標的",
      price: p,
      previous: base - 3,
      bid: p - 0.5,
      ask: p + 0.5,
      changePercent: (p / (base - 3) - 1) * 100,
      sourceAt: preview.now,
      receivedAt: preview.now,
      date: "",
      source: "合成示範資料",
    };
  }
  preview.lastFetch = preview.now;
  preview.dailySummaries ??= {};
  preview.intraday ??= {};
  for (const c of preview.watchlist) {
    preview.dailySummaries[c] = await daily(
      c,
      new Date().toISOString().slice(0, 7),
    );
    const start = new Date(preview.now);
    start.setHours(9, 0, 0, 0);
    const base = preview.quotes[c]!.price!;
    preview.intraday[c] = {
      series: {
        symbol: c,
        date: preview.now.toString(),
        source: "合成示範分鐘線",
        fetchedAt: preview.now,
        partial: false,
        points: Array.from({ length: 271 }, (_, i) => ({
          at: start.getTime() + i * 60000,
          price: base * (1 + Math.sin(i / 24) * 0.008),
        })),
      },
      pending: false,
      error: null,
      demo: true,
    };
  }
  localStorage.setItem("smallstocks-preview", JSON.stringify(preview));
  return structuredClone(preview);
}
export async function daily(symbol: string, month: string): Promise<DailyView> {
  if (desktop)
    return invoke("core_request", {
      tool: "get_daily_history",
      args: { symbol, month },
    });
  const days = [];
  const [y, m] = month.split("-").map(Number);
  const today = new Date().toISOString().slice(0, 10);
  for (let d = 1; d <= 31; d++) {
    const date = new Date(Date.UTC(y!, m! - 1, d));
    const key = date.toISOString().slice(0, 10);
    if (
      date.getUTCMonth() !== m! - 1 ||
      [0, 6].includes(date.getUTCDay()) ||
      key > today
    )
      continue;
    const close = Number((1000 + Math.sin(d / 4) * 25).toFixed(2));
    days.push({
      date: key,
      open: close - 2,
      high: close + 5,
      low: close - 8,
      close,
      change: 2,
      changePercent: (2 / (close - 2)) * 100,
      volume: 1000000 + d * 10000,
      volumeUnit: "股",
    });
  }
  return {
    symbol,
    days,
    sources: ["合成示範資料"],
    fetchedAt: Date.now(),
    pending: false,
    error: null,
    demo: true,
  };
}
export async function search(
  query: string,
): Promise<{ symbol: string; name: string }[]> {
  if (desktop) return invoke("search_stocks", { query });
  return [
    { symbol: "2330", name: "台積電" },
    { symbol: "0050", name: "元大台灣50" },
    { symbol: "6488", name: "環球晶" },
  ].filter((r) => r.name.includes(query) || r.symbol.includes(query));
}
