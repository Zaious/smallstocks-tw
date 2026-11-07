import { it, expect } from "vitest";
import { line, trendCell } from "../src/inline-trend.ts";
import type { Snapshot } from "../src/model.ts";
it("does not invent a line for missing or one-point histories", () => {
  expect(line([], "test")).not.toContain("<svg");
  expect(line([{ at: 1, price: 100 }], "test")).toContain("待資料");
  expect(
    line(
      [
        { at: 1, price: 100 },
        { at: 2, price: 100 },
      ],
      "test",
    ),
  ).not.toMatch(/NaN|Infinity/);
});
it("breaks the path at null values and missing minutes", () => {
  const svg = line(
    [
      { at: 0, price: 100 },
      { at: 60000, price: null },
      { at: 120000, price: 101 },
      { at: 300000, price: 102 },
    ],
    "test",
    [0, 300000],
    90000,
  );
  expect(svg.match(/M\d/g)?.length).toBe(3);
  expect(svg).not.toContain("L");
});
it("uses daily history when closed, never presenting a minute cache as daily data", () => {
  const state = {
    marketOpen: false,
    demo: false,
    dailySummaries: {
      "2330": {
        days: [
          { date: "2026-11-05", close: 100 },
          { date: "2026-11-06", close: 101 },
        ],
      },
    },
    intraday: {},
  } as unknown as Snapshot;
  const v = trendCell(state, "2330");
  expect(v.title).toContain("交易日收盤");
  expect(v.html).toContain('viewBox="0 0 104 16"');
});
