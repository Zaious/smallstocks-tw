import { esc, number, change } from "./model.ts";
import type { Day, DailyView } from "./model.ts";
export function sparkline(days: Day[], large = false): string {
  if (days.length < 2)
    return '<div class="chart-empty">至少兩個交易日才有走勢</div>';
  const w = large ? 460 : 270,
    h = large ? 120 : 30,
    pad = 5;
  const values = days.map((d) => d.close);
  const min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || Math.max(max * 0.01, 1);
  const xy = (d: Day, i: number) => [
    pad + (i * (w - pad * 2)) / (days.length - 1),
    h - pad - ((d.close - min) / span) * (h - pad * 2),
  ];
  const points = days.map((d, i) => xy(d, i).join(",")).join(" ");
  const sign = days.at(-1)!.close >= days[0]!.close ? "up" : "down";
  return `<svg class="sparkline ${sign}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(days[0]!.date)} 至 ${esc(days.at(-1)!.date)} 的每日收盤價走勢"><polyline points="${points}"/>${
    large
      ? days
          .map((d, i) => {
            const [x, y] = xy(d, i);
            return `<circle cx="${x}" cy="${y}" r="3"><title>${d.date} · ${number(d.close)}</title></circle>`;
          })
          .join("")
      : ""
  }</svg>`;
}
export function summary(v: DailyView | undefined, name: string): string {
  const d = v?.days.at(-1);
  if (!d)
    return `<div class="close-card"><strong>${esc(name)}</strong><small>${v?.pending ? "正在取得正式日行情…" : v?.error ? esc(v.error) : "尚無已公布的收盤資料"}</small></div>`;
  return `<div class="close-card"><div class="close-heading"><strong>${esc(name)}</strong><span>${d.date} 收盤</span></div><div class="close-price">${number(d.close)} <span class="${(d.change ?? 0) >= 0 ? "up" : "down"}">${change(d.changePercent)}</span></div>${sparkline(v!.days)}<div class="close-range">低 ${number(d.low)}　高 ${number(d.high)}${d.volume != null ? `　量 ${number(d.volume)} ${esc(d.volumeUnit)}` : ""}</div>${v?.pending ? "<small>正在更新日資料…</small>" : ""}${v?.error ? "<small>更新失敗，顯示快取</small>" : ""}</div>`;
}
export function historyBody(v: DailyView): string {
  if (!v.days.length)
    return `<div class="empty">${v.pending ? "正在取得每日行情…" : v.error ? esc(v.error) : "這個月份沒有可用的每日行情。"}</div>`;
  const last = v.days.at(-1)!;
  return `<div class="daily-summary"><span>${last.date} 收盤</span><strong>${number(last.close)}</strong><span class="${(last.change ?? 0) >= 0 ? "up" : "down"}">${change(last.changePercent)}</span></div><div class="daily-chart">${sparkline(v.days, true)}<div class="chart-dates"><span>${v.days[0]!.date}</span><span>${last.date}</span></div></div><div class="ohlc"><span>開盤 <b>${number(last.open)}</b></span><span>最高 <b>${number(last.high)}</b></span><span>最低 <b>${number(last.low)}</b></span></div><p class="note">每日一個點，代表當天收盤價，並非當天盤中路徑。<br>原始價格未還原；除權息、分割等可能造成價格跳動。<br>來源 ${esc(v.sources.join(" / "))}${v.demo ? " · 合成示範" : ""}。本日資料在 15:00 前不列入。${v.pending ? " 正在更新…" : ""}${v.error ? " 更新失敗，以下為快取。" : ""}</p><div class="daily-table-wrap"><table class="daily-table"><thead><tr><th>日期</th><th>收盤</th><th>漲跌幅</th><th>成交量</th></tr></thead><tbody>${[
    ...v.days,
  ]
    .reverse()
    .map(
      (d) =>
        `<tr><td>${d.date}</td><td title="開 ${number(d.open)}／高 ${number(d.high)}／低 ${number(d.low)}">${number(d.close)}</td><td>${change(d.changePercent)}</td><td>${d.volume == null ? "—" : number(d.volume) + " " + esc(d.volumeUnit)}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}
