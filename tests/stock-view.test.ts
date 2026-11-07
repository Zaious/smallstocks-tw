import { it, expect } from "vitest";
import { stockDetail } from "../src/stock-view.ts";
import type { Snapshot } from "../src/model.ts";
const at = Date.parse("2026-11-06T10:00:00+08:00");
function state(): Snapshot {
  return {
    watchlist: ["2330", "0050"],
    quotes: {
      "2330": {
        name: "台積電",
        price: 100,
        changePercent: 1,
        sourceAt: at,
        date: "20261106",
        source: "TWSE MIS",
      },
    },
    dailySummaries: {},
    settings: { appearance: "small", paused: false, refreshSeconds: 15 },
    marketOpen: true,
    demo: false,
    now: at,
  } as unknown as Snapshot;
}
it("uses daily direction, flat, and unknown separately without relying on color", () => {
  const s = state();
  expect(stockDetail(s, "2330").mark).toBe("▲");
  s.quotes["2330"]!.changePercent = -2;
  expect(stockDetail(s, "2330").mark).toBe("▼");
  s.quotes["2330"]!.changePercent = 0;
  expect(stockDetail(s, "2330").mark).toBe("—");
  s.quotes["2330"]!.price = null;
  expect(stockDetail(s, "2330").mark).toBe("○");
});
it("does not show a stale live direction or a close older than the shared date as current", () => {
  const s = state();
  s.now = at + 61000;
  expect(stockDetail(s, "2330").mark).toBe("○");
  s.marketOpen = false;
  s.dailySummaries = {
    "2330": {
      days: [{ date: "2026-11-05", close: 100, changePercent: 1 }],
      sources: ["TWSE"],
    },
    "0050": {
      days: [{ date: "2026-11-06", close: 60, changePercent: -1 }],
      sources: ["TWSE"],
    },
  } as unknown as Snapshot["dailySummaries"];
  expect(stockDetail(s, "2330").mark).toBe("○");
  expect(stockDetail(s, "0050").mark).toBe("▼");
  expect(stockDetail(s, "2330").symbol).toBe("2330");
});
