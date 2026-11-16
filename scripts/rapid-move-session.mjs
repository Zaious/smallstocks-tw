// One real trading session for the rapid-move rules, start to finish, in its own folder.
//
//   node scripts/rapid-move-session.mjs [--exe path] [--dir folder] [--start 08:55] [--until 13:40]
//
// Waits until --start (this computer's clock, Taipei time expected), starts the app with its own
// settings folder (your real settings are untouched) and raw capture on, adds 36 rapid-move rules
// (TAIEX, 2330, 0050 x 0.3/0.5/1% x 5/10 minutes x rise/drop) on the quiet "log" channel, and
// every minute records health and new events. At --until it stops the app and writes summary.md.
// Afterwards, compare what fired live with a replay of the same raw data:
//   $env:SMALLSTOCKS_REPLAY_LIVE = "<folder>"; cargo test --manifest-path src-tauri/Cargo.toml --lib replay_live -- --ignored --nocapture
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile, stat } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const today = new Date();
const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
const exe = path.resolve(
  opt("exe", "src-tauri/target/release/smallstocks-tw.exe"),
);
const dir = path.resolve(opt("dir", `.local-test/move-${stamp}`));
const start = opt("start", "08:55");
const until = opt("until", "13:40");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const clock = () => new Date().toTimeString().slice(0, 8);

await stat(exe).catch(() => {
  throw new Error(`no app at ${exe}; build it or pass --exe`);
});
await mkdir(path.join(dir, "raw"), { recursive: true });
if (Date.now() < at(start)) {
  console.log(
    `${clock()} waiting until ${start} (leave this window open; the computer must stay awake)`,
  );
  await wait(at(start) - Date.now());
}
if (Date.now() > at(until)) throw new Error(`already past ${until}`);

const app = spawn(exe, [], {
  env: {
    ...process.env,
    SMALLSTOCKS_CONFIG_DIR: dir,
    SMALLSTOCKS_CAPTURE_RAW: path.join(dir, "raw"),
    SMALLSTOCKS_NO_GLOBAL_SHORTCUT: "1",
  },
  stdio: "ignore",
});
console.log(`${clock()} app started (pid ${app.pid}), folder ${dir}`);
let connection;
for (let i = 0; i < 100 && !connection; i++) {
  try {
    connection = JSON.parse(
      await readFile(path.join(dir, "mcp-connection.json"), "utf8"),
    );
  } catch {
    await wait(500);
  }
}
if (!connection) throw new Error("the app did not start");
const call = async (name, a = {}) => {
  const r = await fetch(connection.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: a },
    }),
  });
  const j = await r.json();
  if (j.result?.isError)
    throw new Error(`${name}: ${j.result.content[0].text}`);
  return JSON.parse(j.result.content[0].text);
};

// Out of your way: not on top, no update check. Same 15-second polling as everyone else.
await call("set_settings", {
  alwaysOnTop: false,
  updateCheck: false,
  refreshSeconds: 15,
});
await call("set_watchlist", { symbols: ["t00", "2330", "0050"] });
const rules = [];
for (const symbol of ["t00", "2330", "0050"])
  for (const threshold of [0.3, 0.5, 1])
    for (const windowMinutes of [5, 10])
      for (const direction of ["below", "above"]) {
        const spec = {
          symbol,
          metric: "move",
          direction,
          threshold,
          windowMinutes,
          channel: "log",
          repeat: "daily",
        };
        await call("upsert_rule", spec);
        rules.push(spec);
      }
await writeFile(path.join(dir, "rules.json"), JSON.stringify(rules, null, 2));
console.log(`${clock()} ${rules.length} rapid-move rules set`);

const health = path.join(dir, "health.csv");
await writeFile(
  health,
  "time,lastFetch,error,t00_age_s,2330_age_s,0050_age_s,events\n",
);
const seen = new Set();
const events = path.join(dir, "events.jsonl");
while (Date.now() < at(until) && app.exitCode === null) {
  try {
    const s = await call("get_status");
    const age = (c) =>
      s.quotes[c] ? Math.round((s.now - s.quotes[c].sourceAt) / 1000) : "";
    for (const e of s.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      await appendFile(events, JSON.stringify(e) + "\n");
      console.log(`${clock()} ${e.text}`);
    }
    await appendFile(
      health,
      [
        clock(),
        s.lastFetch ?? "",
        JSON.stringify(s.error ?? ""),
        age("t00"),
        age("2330"),
        age("0050"),
        s.events.length,
      ].join(",") + "\n",
    );
  } catch (e) {
    await appendFile(health, `${clock()},,${JSON.stringify(String(e))},,,,\n`);
  }
  await wait(60_000);
}
const final = await call("get_status").catch(() => null);
app.kill();
const fired = final ? final.events : [];
const lines = [
  `# Rapid-move session ${stamp}`,
  "",
  `Folder: ${dir}`,
  `Rules: ${rules.length} (log channel, daily). Events: ${fired.length}.`,
  "",
  "| time | event |",
  "| --- | --- |",
  ...fired
    .slice()
    .reverse()
    .map(
      (e) =>
        `| ${new Date(e.sourceAt).toTimeString().slice(0, 8)} | ${e.text.replaceAll("|", "/")} |`,
    ),
  "",
  "Check against a replay of the same raw data:",
  "",
  "```",
  `$env:SMALLSTOCKS_REPLAY_LIVE = "${dir}"`,
  "cargo test --manifest-path src-tauri/Cargo.toml --lib replay_live -- --ignored --nocapture",
  "```",
];
await writeFile(path.join(dir, "summary.md"), lines.join("\n") + "\n");
console.log(
  `${clock()} done: ${fired.length} events, summary in ${path.join(dir, "summary.md")}`,
);
