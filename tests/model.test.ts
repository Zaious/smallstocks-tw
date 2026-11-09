import { describe, it, expect } from "vitest";
import {
  esc,
  stale,
  change,
  ruleText,
  latestCloseDate,
  livePrice,
} from "../src/model.ts";
import type { Quote, Rule, Snapshot } from "../src/model.ts";
describe("display truthfulness", () => {
  it("uses the actual newest watched close date, even when it is not today", () => {
    const state = {
      watchlist: ["2330", "0050"],
      dailySummaries: {
        "2330": { days: [{ date: "2026-11-05" }] },
        "0050": { days: [{ date: "2026-11-04" }] },
        "not-watched": { days: [{ date: "2026-11-06" }] },
      },
    } as unknown as Snapshot;
    expect(latestCloseDate(state)).toBe("2026-11-05");
    expect(
      latestCloseDate({ watchlist: ["2330"], dailySummaries: {} }),
    ).toBeNull();
  });
  it("marks missing, old and future source timestamps as stale", () => {
    expect(stale(undefined, 100000)).toBe(true);
    expect(stale({ sourceAt: 1000 } as Quote, 500000)).toBe(true);
    expect(stale({ sourceAt: 1000 } as Quote, 100000)).toBe(false);
    expect(stale({ sourceAt: 100000 } as Quote, 100000)).toBe(false);
    expect(stale({ sourceAt: 106000 } as Quote, 100000)).toBe(true);
  });
  it("shows the last trade first, then the bid/ask average marked as a book price, never a trade", () => {
    const quote = (o: Partial<Quote>) =>
      ({ price: null, changePercent: null, ...o }) as Quote;
    expect(livePrice(quote({ price: 100, changePercent: 1, mid: 99 }))).toEqual(
      {
        price: 100,
        pct: 1,
        basis: "trade",
      },
    );
    expect(livePrice(quote({ mid: 99, midChangePercent: -1 }))).toEqual({
      price: 99,
      pct: -1,
      basis: "book",
    });
    expect(livePrice(quote({}))).toEqual({
      price: null,
      pct: null,
      basis: "none",
    });
    expect(livePrice(undefined).basis).toBe("none");
  });
  it("keeps signs without color and escapes untrusted source names", () => {
    expect(change(-1)).toBe("-1.00%");
    expect(change(1)).toBe("+1.00%");
    expect(esc('<img src=x onerror="x">')).not.toContain("<img");
  });
  it("describes the actual metric and direction", () => {
    expect(
      ruleText({
        symbol: "2330",
        metric: "price",
        direction: "below",
        threshold: 1000,
      } as Rule),
    ).toContain("成交價降至 1,000 元");
  });
});
