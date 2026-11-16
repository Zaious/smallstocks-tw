// Reading a backup file before import: a quick check and a summary to show the user. The desktop
// core checks every field again and refuses the whole file if anything is wrong.

export const BACKUP_FORMAT = "smallstocks-tw-backup";

export interface BackupSummary {
  watchlist: number;
  rules: number;
  events: number;
  exportedAt: number | null;
}

export function readBackup(text: string): {
  data: Record<string, unknown>;
  summary: BackupSummary;
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("這個檔案不是備份檔（無法讀取）");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("這個檔案不是備份檔");
  const d = data as Record<string, unknown>;
  if (d.format !== BACKUP_FORMAT)
    throw new Error("這不是 SmallStocks TW 的備份檔");
  if (!Array.isArray(d.watchlist)) throw new Error("備份檔缺少自選清單");
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    data: d,
    summary: {
      watchlist: d.watchlist.length,
      rules: count(d.rules),
      events: count(d.events),
      exportedAt: typeof d.exportedAt === "number" ? d.exportedAt : null,
    },
  };
}

export function describeBackup(s: BackupSummary): string {
  const when = s.exportedAt
    ? `（${new Date(s.exportedAt).toLocaleString("zh-TW", { hour12: false })} 匯出）`
    : "";
  return `這個備份有 ${s.watchlist} 檔自選、${s.rules} 條提醒、${s.events} 筆事件紀錄${when}。匯入會取代目前的自選、提醒與設定。`;
}
