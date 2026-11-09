import { it, expect } from "vitest";
import { notepadText } from "../src/disguise.ts";
import { terminalRows } from "../src/model.ts";
import type { Snapshot } from "../src/model.ts";
it("the Notepad report does not substitute an old live price for an unpublished close", () => {
  const s = {
    marketOpen: false,
    demo: false,
    watchlist: ["2330"],
    dailySummaries: {},
    quotes: { "2330": { name: "台積電", price: 999999 } },
    settings: { paused: false },
    events: [],
    lastFetch: 0,
  } as unknown as Snapshot;
  expect(notepadText(s)).toContain("等待收盤資料");
  expect(notepadText(s)).not.toContain("999,999");
  expect(notepadText(s)).toContain("—");
  s.dailySummaries = {
    "2330": {
      days: [{ date: "2026-11-06", close: 2135, changePercent: -4.69 }],
    },
  } as unknown as Snapshot["dailySummaries"];
  expect(notepadText(s)).toContain("2026/11/06 收盤");
  expect(notepadText(s)).toContain("2,135");
  s.dailySummaries["2330"]!.days[0]!.date = "2026-11-05";
  s.watchlist.push("0050");
  s.dailySummaries["0050"] = {
    days: [{ date: "2026-11-06", close: 92.5, changePercent: -4.79 }],
  } as Snapshot["dailySummaries"][string];
  expect(notepadText(s)).toContain("(11/05)");
});
it("plain-text skins mark an order-book price with ~ and never present it as a trade", () => {
  const at = Date.parse("2026-11-09T10:00:00+08:00");
  const s = {
    marketOpen: true,
    demo: false,
    now: at,
    watchlist: ["2330", "0050"],
    dailySummaries: {},
    quotes: {
      "2330": {
        name: "台積電",
        price: null,
        mid: 2237.5,
        midChangePercent: 4.8,
        changePercent: null,
        sourceAt: at,
      },
      "0050": {
        name: "元大台灣50",
        price: 92.5,
        changePercent: 1,
        sourceAt: at,
      },
    },
    settings: { paused: false },
    events: [],
    lastFetch: at,
  } as unknown as Snapshot;
  const text = notepadText(s);
  expect(text).toContain("~2,237.5");
  expect(text).not.toContain("~92.5");
  expect(terminalRows(s)).toContain("BOOK");
  expect(terminalRows(s)).toContain("OK");
});
