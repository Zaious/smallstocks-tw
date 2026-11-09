// Run during the TWSE session (Mon-Fri 09:00-13:30 Taipei) to see how the source really behaves.
// Usage: node scripts/mis-time-probe.mjs [minutes=10] [codes=2330,6488,5483,3293] [raw-file=mis-probe-raw.ndjson]
//
// Every response is saved whole (raw-file, one JSON per line) so nothing has to be guessed later.
// Per symbol the summary counts, over all polls (one every 5 s):
//   tAdvanced      the snapshot time `t` moved
//   vChanged       cumulative volume `v` changed, i.e. trades happened
//   zPresent       the top-level trade price `z` was a number
//   tradePresent   the response carried a `trade` block with a price (what the official site falls
//                  back to when z is "-")
//   tradeTAdvanced the last-trade time `trade.t` moved
//   bookOnly       polls where neither z nor trade gave a price but bid/ask existed
// The official site polls every 5 s and uses `trade` when z is "-"; the table says whether that holds
// for the symbols watched.
import { appendFile, writeFile } from "node:fs/promises";

const minutes = Number(process.argv[2] ?? 10);
const codes = (process.argv[3] ?? "2330,6488,5483,3293").split(",");
const rawFile = process.argv[4] ?? "mis-probe-raw.ndjson";
const channels = codes.flatMap((c) => [`tse_${c}.tw`, `otc_${c}.tw`]).join("|");
const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels)}&json=1&delay=0`;
const isNumber = (value) =>
  value !== undefined &&
  value !== null &&
  value !== "-" &&
  value !== "" &&
  !Number.isNaN(Number(value));
const last = new Map();
const stats = new Map(
  codes.map((c) => [
    c,
    {
      polls: 0,
      tAdvanced: 0,
      vChanged: 0,
      zPresent: 0,
      tradePresent: 0,
      tradeTAdvanced: 0,
      bookOnly: 0,
    },
  ]),
);
await writeFile(rawFile, "");
const end = Date.now() + minutes * 60_000;
while (Date.now() < end) {
  const response = await fetch(`${url}&_=${Date.now()}`);
  const text = await response.text();
  await appendFile(
    rawFile,
    JSON.stringify({ receivedAt: Date.now(), body: text }) + "\n",
  );
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    console.log("not JSON:", text.slice(0, 120));
  }
  for (const r of body.msgArray ?? []) {
    const s = stats.get(r.c);
    if (!s) continue;
    const prev = last.get(r.c);
    s.polls++;
    const z = isNumber(r.z);
    const trade = isNumber(r.trade?.z);
    s.zPresent += z;
    s.tradePresent += trade;
    s.bookOnly += !z && !trade && Boolean(r.b || r.a);
    if (prev) {
      s.tAdvanced += r.tlong !== prev.tlong;
      s.vChanged += r.v !== prev.v;
      s.tradeTAdvanced += r.trade?.t !== prev.tradeT;
    }
    last.set(r.c, { tlong: r.tlong, v: r.v, tradeT: r.trade?.t });
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.table(Object.fromEntries(stats));
console.log(
  `raw responses: ${rawFile}\n` +
    "tradePresent close to polls  => a last trade is available on (almost) every poll through `trade`.\n" +
    "tradePresent 0 while vChanged > 0 => trades happen but this interface gives no price for them.\n" +
    "tAdvanced much smaller than polls => the snapshot itself refreshes slowly for that symbol.",
);
