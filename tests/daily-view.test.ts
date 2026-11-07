import { it, expect } from "vitest";
import { sparkline, historyBody, summary } from "../src/daily-view.ts";
import type { Day, DailyView } from "../src/model.ts";
const day: Day = {
  date: "2026-11-05",
  open: 100,
  high: 102,
  low: 98,
  close: 99,
  change: -1,
  changePercent: -1,
  volume: 1234,
  volumeUnit: "張",
};
const view: DailyView = {
  symbol: "6488",
  days: [day, { ...day, date: "2026-11-06", close: 101 }],
  sources: ["TPEx"],
  pending: false,
  error: null,
  demo: false,
  fetchedAt: 0,
};
it("flat histories produce finite chart coordinates and expose source dates", () => {
  const svg = sparkline([day, { ...day, date: "2026-11-06" }], true);
  expect(svg).not.toMatch(/NaN|Infinity/);
  expect(svg).toContain("2026-11-05");
  expect(svg).toContain('role="img"');
});
it("shows original volume units and daily, unadjusted semantics", () => {
  const html = historyBody(view);
  expect(html).toContain("張");
  expect(html).toContain("原始價格未還原");
  expect(html).toContain("每日一個點");
  expect(summary(view, "<script>")).not.toContain("<script>");
});
