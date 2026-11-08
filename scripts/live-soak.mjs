// Long-running health log for a real-market session. It only talks to the app's own local RPC
// (the same bearer-token endpoint the MCP bridge uses) and writes a CSV; it never fetches quotes.
//
//   node scripts/live-soak.mjs <config-dir> [--pid N] [--every 30] [--until HH:MM] [--rules] [--out file.csv]
//
// Start the app first, e.g. with its own folder so your real settings stay untouched:
//   $env:SMALLSTOCKS_CONFIG_DIR = ".local-test\soak"; .\smallstocks-tw.exe
// --rules adds two daily crossing rules on the TAIEX (t00) a little above and below the first live
// reading, so a real crossing is observed during the session. Rules use the "strip" channel.
import { readFile, stat, writeFile, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const dir = args[0] && !args[0].startsWith("--") ? args[0] : null;
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!dir)
  throw new Error(
    "usage: node scripts/live-soak.mjs <config-dir> [--pid N] [--every 30] [--until HH:MM] [--rules] [--out file.csv]",
  );
const every = Number(opt("every", 30)) * 1000;
const pid = opt("pid", null);
const until = opt("until", "13:35");
const withRules = args.includes("--rules");
const out = opt("out", path.join(dir, "soak.csv"));

const connection = JSON.parse(
  await readFile(path.join(dir, "mcp-connection.json"), "utf8"),
);
let id = 0;
const call = async (name, argumentsObject = {}) => {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: argumentsObject },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (body.result?.isError) throw new Error(body.result.content[0].text);
  return JSON.parse(body.result.content[0].text);
};
const memoryMb = () => {
  if (!pid || process.platform !== "win32") return "";
  try {
    const bytes = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-Process -Id ${Number(pid)}).WorkingSet64`,
      ],
      { encoding: "utf8" },
    ).trim();
    return (Number(bytes) / 1048576).toFixed(1);
  } catch {
    return "gone";
  }
};
const stopAt = () => {
  const [h, m] = until.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

await writeFile(
  out,
  "time,marketOpen,lastFetchAgeS,error,quotes,maxQuoteAgeS,events,revision,rssMb,stateKb\n",
);
let rulesAdded = !withRules;
let longestFetchGap = 0;
let errorsSeen = 0;
let samples = 0;
while (Date.now() < stopAt()) {
  let row;
  try {
    const s = await call("get_status");
    const now = s.now;
    const quotes = Object.values(s.quotes);
    const ages = quotes.map((q) => (now - q.sourceAt) / 1000);
    const fetchAge = s.lastFetch ? (now - s.lastFetch) / 1000 : "";
    if (s.marketOpen && typeof fetchAge === "number")
      longestFetchGap = Math.max(longestFetchGap, fetchAge);
    if (s.error) errorsSeen++;
    if (!rulesAdded && s.quotes.t00?.changePercent != null && s.marketOpen) {
      const current = s.quotes.t00.changePercent;
      for (const [direction, threshold] of [
        ["above", current + 0.03],
        ["below", current - 0.03],
      ])
        await call("upsert_rule", {
          symbol: "t00",
          metric: "changePercent",
          direction,
          threshold: Number(threshold.toFixed(3)),
          channel: "strip",
          repeat: "daily",
        });
      rulesAdded = true;
      await appendFile(
        out,
        `# rules added on t00 around ${current.toFixed(3)}%\n`,
      );
    }
    const stateKb = (
      (await stat(path.join(dir, "state.json"))).size / 1024
    ).toFixed(0);
    row = [
      new Date(now).toISOString(),
      s.marketOpen,
      fetchAge === "" ? "" : fetchAge.toFixed(0),
      JSON.stringify(s.error ?? ""),
      quotes.length,
      ages.length ? Math.max(...ages).toFixed(0) : "",
      s.events.length,
      s.revision,
      memoryMb(),
      stateKb,
    ];
  } catch (error) {
    errorsSeen++;
    row = [
      new Date().toISOString(),
      "",
      "",
      JSON.stringify(`rpc: ${error.message}`),
      "",
      "",
      "",
      "",
      memoryMb(),
      "",
    ];
  }
  samples++;
  await appendFile(out, row.join(",") + "\n");
  await new Promise((resolve) => setTimeout(resolve, every));
}
const final = await call("get_status").catch(() => null);
const events = final?.events ?? [];
console.log(
  `samples=${samples} errorSamples=${errorsSeen} longestFetchGapWhileOpenS=${longestFetchGap.toFixed(0)} events=${events.length}`,
);
for (const e of events.slice(0, 10))
  console.log(`event ${new Date(e.sourceAt).toISOString()} ${e.text}`);
