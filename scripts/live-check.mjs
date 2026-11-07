import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const dir = path.join(process.cwd(), ".local-test", "live-" + Date.now());
await mkdir(dir, { recursive: true });
const app = spawn(
  path.join(process.cwd(), "src-tauri/target/release/smallstocks-tw.exe"),
  [],
  {
    env: { ...process.env, SMALLSTOCKS_CONFIG_DIR: dir },
    windowsHide: true,
    stdio: "ignore",
  },
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let connection;
  for (let i = 0; i < 40; i++) {
    try {
      connection = JSON.parse(
        await readFile(path.join(dir, "mcp-connection.json"), "utf8"),
      );
      break;
    } catch {}
    await wait(500);
  }
  assert.ok(connection);
  let state;
  for (let i = 0; i < 45; i++) {
    const r = await fetch(connection.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_status", arguments: {} },
      }),
    });
    const v = await r.json();
    state = JSON.parse(v.result.content[0].text);
    if (state.lastFetch) break;
    await wait(500);
  }
  assert.equal(state.demo, false);
  assert.ok(state.lastFetch, "real MIS fetch completed");
  assert.ok(Object.keys(state.quotes).length > 0);
  assert.equal(state.events.length, 0);
  assert.equal(state.error, null);
  console.log(
    "PASS: native live mode directly fetched MIS; symbols=" +
      Object.keys(state.quotes).join(",") +
      "; source ages seconds=" +
      Object.values(state.quotes)
        .map((q) => Math.round((Date.now() - q.sourceAt) / 1000))
        .join(",") +
      "; no events from initial/stale data",
  );
} finally {
  app.kill();
}
