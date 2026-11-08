// Run during the TWSE session (Mon-Fri 09:00-13:30 Taipei) to settle what MIS field `t` means.
// Usage: node scripts/mis-time-probe.mjs [minutes=10] [codes=2330,6488,5483,3293]
// Question answered: does `t` advance with every snapshot (quote refresh time), or only when that
// symbol trades (last-trade time)? If the latter, thin symbols would be judged stale by the 60 s
// freshness rule in core.rs `evaluate` and their rules would rarely fire.
const minutes = Number(process.argv[2] ?? 10);
const codes = (process.argv[3] ?? "2330,6488,5483,3293").split(",");
const channels = codes.flatMap((c) => [`tse_${c}.tw`, `otc_${c}.tw`]).join("|");
const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels)}&json=1&delay=0`;
const last = new Map();
const stats = new Map(
  codes.map((c) => [
    c,
    { polls: 0, tAdvanced: 0, tvChanged: 0, tAdvancedWithoutTrade: 0 },
  ]),
);
const end = Date.now() + minutes * 60_000;
while (Date.now() < end) {
  const res = await fetch(`${url}&_=${Date.now()}`);
  const { msgArray = [] } = await res.json();
  for (const r of msgArray) {
    const s = stats.get(r.c);
    if (!s) continue;
    const prev = last.get(r.c);
    s.polls++;
    if (prev) {
      const tAdv = r.tlong !== prev.tlong;
      const traded = r.tv !== prev.tv || r.z !== prev.z;
      s.tAdvanced += tAdv;
      s.tvChanged += traded;
      s.tAdvancedWithoutTrade += tAdv && !traded;
    }
    last.set(r.c, { tlong: r.tlong, tv: r.tv, z: r.z });
  }
  await new Promise((r) => setTimeout(r, 5000));
}
console.table(Object.fromEntries(stats));
console.log(
  "tAdvancedWithoutTrade > 0 for a thin symbol => `t` is snapshot time (freshness rule is safe).\n" +
    "tAdvanced ~= tvChanged for every symbol => `t` is last-trade time (thin symbols need a different freshness basis).",
);
