import { describe, expect, it } from "vitest";
import { ruleText } from "../src/model.ts";
import type { Rule } from "../src/model.ts";

const base: Rule = {
  id: "r",
  symbol: "2330",
  metric: "price",
  direction: "below",
  threshold: 1000,
  channel: "strip",
  repeat: "daily",
  enabled: true,
  firedDay: null,
};

describe("rule wording", () => {
  it("says crossing for the threshold rules", () => {
    expect(ruleText(base)).toBe("2330 · 成交價降至 1,000 元");
  });
  it("says rise or drop within N minutes for rapid-move rules", () => {
    expect(
      ruleText({ ...base, metric: "move", threshold: 2, windowMinutes: 5 }),
    ).toBe("2330 · 5 分鐘內急跌 2%");
    expect(
      ruleText({
        ...base,
        metric: "move",
        direction: "above",
        threshold: 1.5,
        windowMinutes: 10,
      }),
    ).toBe("2330 · 10 分鐘內急漲 1.5%");
    expect(ruleText({ ...base, metric: "move", threshold: 3 })).toContain(
      "5 分鐘內",
    );
  });
});
