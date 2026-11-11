// Text the settings page offers to copy so an agent host can connect to this program over stdio.
// The path is the real location of the running program; the host starts it with --mcp.

export type McpKind = "json" | "claude" | "codex";

const quote = (exe: string) => `"${exe.replaceAll('"', "")}"`;

export function mcpSetup(kind: McpKind, exe: string): string {
  if (kind === "claude")
    return `claude mcp add smallstocks-tw -- ${quote(exe)} --mcp`;
  if (kind === "codex")
    return `codex mcp add smallstocks-tw -- ${quote(exe)} --mcp`;
  return JSON.stringify(
    { mcpServers: { "smallstocks-tw": { command: exe, args: ["--mcp"] } } },
    null,
    2,
  );
}
