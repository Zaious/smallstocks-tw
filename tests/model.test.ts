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
import { closeDay } from "../src/model.ts";
describe("what a closed session shows", () => {
  const at = (time: string) => Date.parse(`2026-11-09T${time}+08:00`);
  const friday = { date: "2026-11-06", close: 2135, changePercent: -4.69 };
  const snapshot = (
    now: string,
    quote: Record<string, unknown>,
    days = [friday],
  ) =>
    ({
      now: at(now),
      watchlist: ["2330"],
      dailySummaries: { "2330": { days } },
      quotes: {
        "2330": {
          price: 2235,
          changePercent: 4.68,
          date: "20261109",
          ...quote,
        },
      },
    }) as unknown as Parameters<typeof closeDay>[0];
  it("shows today's closing trade once the session has ended, not last Friday", () => {
    const view = closeDay(
      snapshot("13:36:00", {
        tradeAt: at("13:30:00"),
        sourceAt: at("13:30:00"),
      }),
      "2330",
    );
    expect(view).toMatchObject({
      date: "2026-11-09",
      close: 2235,
      kind: "final",
    });
  });
  it("waits for a postponed close before treating a mid-session trade as the close", () => {
    const early = snapshot("13:32:00", {
      tradeAt: at("13:29:50"),
      sourceAt: at("13:31:00"),
    });
    expect(closeDay(early, "2330")?.kind).toBe("previous");
    const later = snapshot("13:36:00", {
      tradeAt: at("13:29:50"),
      sourceAt: at("13:35:00"),
    });
    expect(closeDay(later, "2330")?.kind).toBe("final");
  });
  it("prefers the official row for today, and falls back to the earlier day without today's data", () => {
    const official = snapshot(
      "15:30:00",
      { tradeAt: at("13:30:00"), sourceAt: at("13:30:00") },
      [friday, { date: "2026-11-09", close: 2236, changePercent: 4.7 }],
    );
    expect(closeDay(official, "2330")).toMatchObject({
      close: 2236,
      kind: "official",
    });
    const yesterdayQuote = snapshot("08:00:00", {
      date: "20261106",
      sourceAt: at("08:00:00"),
    });
    expect(closeDay(yesterdayQuote, "2330")).toMatchObject({
      date: "2026-11-06",
      kind: "previous",
    });
    expect(closeDay(snapshot("13:36:00", { price: null }), "2330")?.kind).toBe(
      "previous",
    );
  });
});
import { aging, ageSeconds, oldestDataAt } from "../src/model.ts";
describe("how old the data is", () => {
  const quote = (ageMs: number, now = 1_000_000) =>
    ({ sourceAt: now - ageMs }) as Quote;
  it("goes grey after a minute and expires after three", () => {
    expect(aging(quote(30_000), 1_000_000)).toBe(false);
    expect(aging(quote(70_000), 1_000_000)).toBe(true);
    expect(stale(quote(70_000), 1_000_000)).toBe(false);
    expect(aging(quote(200_000), 1_000_000)).toBe(false);
    expect(stale(quote(200_000), 1_000_000)).toBe(true);
    expect(ageSeconds(quote(70_000), 1_000_000)).toBe(70);
    expect(ageSeconds(undefined, 1_000_000)).toBeNull();
  });
  it("reports the oldest snapshot time among the watched symbols", () => {
    const s = {
      watchlist: ["a", "b", "c"],
      quotes: { a: { sourceAt: 500 }, b: { sourceAt: 300 } },
    } as unknown as Parameters<typeof oldestDataAt>[0];
    expect(oldestDataAt(s)).toBe(300);
    expect(oldestDataAt({ watchlist: ["x"], quotes: {} })).toBeNull();
  });
});
