// Prints one version's section of CHANGELOG.md, for the release notes:
//   node scripts/changelog-section.mjs 0.1.17
// The heading must read "## [0.1.17] - YYYY-MM-DD". A missing or empty section exits 1, so the
// release workflow stops instead of publishing empty notes.
import { readFile } from "node:fs/promises";

export function section(text, version) {
  const lines = text.split(/\r?\n/);
  const head = new RegExp(
    `^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`,
  );
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const body = lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
  return body || null;
}

if (process.argv[1]?.endsWith("changelog-section.mjs")) {
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("usage: node scripts/changelog-section.mjs x.y.z");
    process.exit(2);
  }
  const body = section(await readFile("CHANGELOG.md", "utf8"), version);
  if (!body) {
    console.error(
      `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section with text in it`,
    );
    process.exit(1);
  }
  console.log(body);
}
