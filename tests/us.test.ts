import { describe, expect, it } from "vitest";
import {
  allClosed,
  closeDay,
  closedFor,
  isUs,
  latestCloseDate,
  ruleText,
} from "../src/model.ts";
import type { Quote, Rule, Snapshot } from "../src/model.ts";

const quote = (symbol: string, date: string, price: number): Quote => ({
  symbol,
  name: symbol,
  price,
  previous: price - 1,
  bid: null,
  ask: null,
  changePercent: 1,
  sourceAt: 0,
  receivedAt: 0,
  date,
  source: "test",
  market: isUs(symbol) ? "us" : "tw",
});

// A Taipei evening: Taiwan closed, New York trading.
const evening = {
  watchlist: ["2330", "AAPL"],
  quotes: {
    "2330": quote("2330", "20261116", 1000),
    AAPL: quote("AAPL", "20261113", 200),
  },
  dailySummaries: {
    "2330": {
      symbol: "2330",
      days: [
        {
          date: "2026-11-16",
          open: 990,
          high: 1001,
          low: 989,
          close: 1000,
          change: 10,
          changePercent: 1,
          volume: 1,
          volumeUnit: "張",
        },
      ],
      sources: ["TWSE"],
      fetchedAt: 0,
      pending: false,
      error: null,
      demo: false,
    },
  },
  marketOpen: false,
  usMarketOpen: true,
  demo: false,
  now: Date.parse("2026-11-16T23:00:00+08:00"),
} as unknown as Snapshot;

describe("US symbols", () => {
  it("are told apart from Taiwan codes", () => {
    expect(["AAPL", "BRK-B", "QQQ"].every(isUs)).toBe(true);
    expect(["2330", "00878", "t00", "o00"].some(isUs)).toBe(false);
  });
  it("follow their own market's session, row by row", () => {
    expect(closedFor(evening, "2330")).toBe(true);
    expect(closedFor(evening, "AAPL")).toBe(false);
    expect(allClosed(evening)).toBe(false);
    expect(allClosed({ ...evening, usMarketOpen: false })).toBe(true);
    expect(closedFor({ ...evening, demo: true }, "2330")).toBe(false);
  });
  it("show their last US price when closed, dated in New York", () => {
    expect(closeDay(evening, "AAPL")).toEqual({
      date: "2026-11-13",
      close: 200,
      changePercent: 1,
      kind: "us",
    });
    // Each market's latest close is its own: a US date is not "older" than Taiwan's.
    expect(latestCloseDate(evening, "us")).toBe("2026-11-13");
    expect(latestCloseDate(evening, "tw")).toBe("2026-11-16");
  });
  it("say dollars in rules", () => {
    const r: Rule = {
      id: "r",
      symbol: "AAPL",
      metric: "price",
      direction: "above",
      threshold: 250,
      channel: "strip",
      repeat: "daily",
      enabled: true,
      firedDay: null,
    };
    expect(ruleText(r)).toBe("AAPL · 成交價升至 250 美元");
    expect(ruleText({ ...r, symbol: "2330", threshold: 1000 })).toBe(
      "2330 · 成交價升至 1,000 元",
    );
  });
});
