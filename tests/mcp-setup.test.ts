import { describe, expect, it } from "vitest";
import { mcpSetup } from "../src/mcp-setup.ts";

const win =
  "C:\\Users\\Ann Lee\\AppData\\Local\\SmallStocks TW\\smallstocks-tw.exe";
const mac = "/Applications/SmallStocks TW.app/Contents/MacOS/smallstocks-tw";

describe("MCP setup text", () => {
  it("makes JSON that a host can parse, with the real path and --mcp", () => {
    for (const exe of [win, mac]) {
      const parsed = JSON.parse(mcpSetup("json", exe));
      expect(parsed.mcpServers["smallstocks-tw"]).toEqual({
        command: exe,
        args: ["--mcp"],
      });
    }
  });
  it("quotes paths with spaces in the one-line commands", () => {
    expect(mcpSetup("claude", mac)).toBe(
      `claude mcp add smallstocks-tw -- "${mac}" --mcp`,
    );
    expect(mcpSetup("codex", win)).toBe(
      `codex mcp add smallstocks-tw -- "${win}" --mcp`,
    );
  });
  it("never puts a token or connection file in the text", () => {
    for (const kind of ["json", "claude", "codex"] as const)
      expect(mcpSetup(kind, mac)).not.toMatch(/token|mcp-connection/i);
  });
});
