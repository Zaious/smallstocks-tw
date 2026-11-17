import { describe, expect, it } from "vitest";
import {
  AI_PROMPT,
  mergeResolved,
  parseSetup,
  preselected,
  resolveSetup,
  setupPreview,
  setupRequest,
} from "../src/quick-setup.ts";
import type { Found } from "../src/quick-setup.ts";

const queries = (text: string) => parseSetup(text).targets.map((t) => t.query);

describe("pasting a list", () => {
  it("takes names and codes mixed, in any separator, without duplicates", () => {
    expect(
      queries("台積電 聯發科、0050，AAPL\n2330.TW  BRK.B 大盤 台積電"),
    ).toEqual(["台積電", "聯發科", "0050", "AAPL", "2330", "BRK-B", "t00"]);
  });
  it("drops the prices and percentages of a list copied from a quote table", () => {
    expect(
      queries("2330 台積電 1,040 +0.48%\n0050 元大台灣50 62.60 -0.32%"),
    ).toEqual(["2330", "台積電", "0050", "元大台灣50"]);
  });
  it("ignores bullets and numbering, and full-width digits", () => {
    expect(queries("1. 台積電\n- ２３３０\n• 0050")).toEqual([
      "台積電",
      "2330",
      "0050",
    ]);
  });
});

describe("one-line alerts", () => {
  const rules = (text: string) =>
    parseSetup(text).targets.map((t) => [t.query, t.rules]);
  it("reads price, day change and rapid moves", () => {
    expect(
      rules(
        "台積電 跌破 1,000\n2330漲到1200\n0050 跌 3%\nAAPL 漲5%\n0050 5分鐘內急跌 1%\nt00 10 分鐘急漲 0.5% 只提醒一次",
      ),
    ).toEqual([
      [
        "台積電",
        [
          {
            metric: "price",
            direction: "below",
            threshold: 1000,
            repeat: "daily",
          },
        ],
      ],
      [
        "2330",
        [
          {
            metric: "price",
            direction: "above",
            threshold: 1200,
            repeat: "daily",
          },
        ],
      ],
      [
        "0050",
        [
          {
            metric: "changePercent",
            direction: "below",
            threshold: -3,
            repeat: "daily",
          },
          {
            metric: "move",
            direction: "below",
            threshold: 1,
            windowMinutes: 5,
            repeat: "daily",
          },
        ],
      ],
      [
        "AAPL",
        [
          {
            metric: "changePercent",
            direction: "above",
            threshold: 5,
            repeat: "daily",
          },
        ],
      ],
      [
        "t00",
        [
          {
            metric: "move",
            direction: "above",
            threshold: 0.5,
            windowMinutes: 10,
            repeat: "once",
          },
        ],
      ],
    ]);
  });
  it("reads the example lines the AI prompt itself shows", () => {
    const example = AI_PROMPT.split("例子：")[1]!.split("我的股票")[0]!;
    const p = parseSetup(example);
    expect(p.unread).toEqual([]);
    expect(p.targets.map((t) => [t.query, t.rules.length])).toEqual([
      ["2330", 1],
      ["0050", 1],
      ["AAPL", 1],
    ]);
  });
  it("lists the alert lines it cannot read instead of guessing", () => {
    const p = parseSetup("台積電 跌一點就叫我\n0050");
    expect(p.unread).toEqual(["台積電 跌一點就叫我"]);
    expect(p.targets.map((t) => t.query)).toEqual(["0050"]);
  });
  it("keeps an AI's 不確定 mark for checking", () => {
    const p = parseSetup("2454\n6488 （不確定）");
    expect(p.targets.map((t) => [t.query, Boolean(t.uncertain)])).toEqual([
      ["2454", false],
      ["6488", true],
    ]);
  });
});

describe("looking the list up", () => {
  const source: Found[] = [
    { symbol: "2330", name: "台積電" },
    { symbol: "2454", name: "聯發科" },
    { symbol: "3711", name: "日月光投控" },
    { symbol: "2311", name: "日月光" },
    { symbol: "AAPL", name: "Apple Inc.", market: "us" },
  ];
  const search = async (q: string) =>
    source.filter((f) => f.name.includes(q) || f.symbol === q);
  it("is sure only of exact names and real codes", async () => {
    const r = await resolveSetup(
      parseSetup("台積電 2454 日月 台機電 9999 AAPL 大盤").targets,
      search,
    );
    expect(r.map((x) => [x.query, x.status, x.symbol ?? null])).toEqual([
      ["台積電", "ok", "2330"],
      ["2454", "ok", "2454"],
      ["日月", "check", "3711"],
      ["台機電", "missing", null],
      ["9999", "missing", null],
      ["AAPL", "ok", "AAPL"],
      ["t00", "ok", "t00"],
    ]);
    expect(r[2]!.options.map((o) => o.symbol)).toEqual(["3711", "2311"]);
  });
  it("asks for a look at an AI's uncertain code even when it exists", async () => {
    const [r] = await resolveSetup(parseSetup("2454 不確定").targets, search);
    expect(r).toMatchObject({
      status: "check",
      symbol: "2454",
      name: "聯發科",
    });
  });
  it("merges a name and its code into one row and sends only the rows left checked", async () => {
    const r = mergeResolved(
      await resolveSetup(
        parseSetup("台積電 跌破 1000\n2330 漲到 1200\n日月 跌 3%\n台機電")
          .targets,
        search,
      ),
    );
    expect(r.map((x) => [x.query, x.rules.length])).toEqual([
      ["台積電", 2],
      ["日月", 1],
      ["台機電", 0],
    ]);
    // The guess is switched to the other candidate; nothing for the missing name.
    const req = setupRequest(r, (i) =>
      i === 1 ? { on: true, symbol: "2311" } : { on: true },
    );
    expect(req.symbols).toEqual(["2330", "2311"]);
    expect(req.rules.map((x) => [x.symbol, x.metric, x.threshold])).toEqual([
      ["2330", "price", 1000],
      ["2330", "price", 1200],
      ["2311", "changePercent", -3],
    ]);
    expect(setupRequest(r, () => ({ on: false })).symbols).toEqual([]);
    const html = setupPreview(r, [], ["2330"]);
    expect(html).toContain("已在自選");
    expect(html).toContain("成交價降至 1,000 元");
    expect(html).toContain("「台機電」找不到");
  });
  it("leaves a typo's guess and an AI's 不確定 unticked", async () => {
    const r = await resolveSetup(
      parseSetup("日月 台機電\n2454 不確定").targets,
      async (q) =>
        q === "台機電" ? [{ symbol: "7642", name: "昶瑞機電" }] : search(q),
    );
    expect(r.map((x) => [x.query, x.status, preselected(x)])).toEqual([
      ["日月", "check", true],
      ["台機電", "check", false],
      ["2454", "check", false],
    ]);
  });
  it("leaves warrants out of the guesses", async () => {
    const withWarrants = async () => [
      { symbol: "03011T", name: "台積電凱基67售14" },
      { symbol: "030156", name: "台積電永豐64購15" },
      { symbol: "2330", name: "台積電" },
    ];
    const [r] = await resolveSetup(parseSetup("台積").targets, withWarrants);
    expect(r!.options.map((o) => o.symbol)).toEqual(["2330"]);
  });
  it("treats a failed lookup as not found", async () => {
    const [r] = await resolveSetup(parseSetup("台積電").targets, async () => {
      throw new Error("offline");
    });
    expect(r!.status).toBe("missing");
  });
});
