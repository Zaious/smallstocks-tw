import { describe, expect, it } from "vitest";
import { describeBackup, readBackup } from "../src/backup.ts";

const good = {
  format: "smallstocks-tw-backup",
  version: 1,
  exportedAt: Date.UTC(2026, 10, 16, 6, 0),
  watchlist: ["t00", "2330"],
  rules: [
    { symbol: "2330", metric: "price", direction: "above", threshold: 1000 },
  ],
  events: [],
  settings: { appearance: "small" },
};

describe("backup file check", () => {
  it("summarises a backup without changing it", () => {
    const { data, summary } = readBackup(JSON.stringify(good));
    expect(data).toEqual(good);
    expect(summary).toEqual({
      watchlist: 2,
      rules: 1,
      events: 0,
      exportedAt: good.exportedAt,
    });
    expect(describeBackup(summary)).toContain(
      "2 檔自選、1 條提醒、0 筆事件紀錄",
    );
    expect(describeBackup(summary)).toContain("會取代目前的自選、提醒與設定");
  });
  it("refuses files that are not our backup", () => {
    expect(() => readBackup("not json")).toThrow("無法讀取");
    expect(() => readBackup("[]")).toThrow("不是備份檔");
    expect(() => readBackup(JSON.stringify({ ...good, format: "x" }))).toThrow(
      "不是 SmallStocks TW 的備份檔",
    );
    expect(() =>
      readBackup(JSON.stringify({ ...good, watchlist: undefined })),
    ).toThrow("缺少自選清單");
  });
});
