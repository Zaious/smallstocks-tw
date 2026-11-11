import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
await mkdir(path.join(root, "dist"), { recursive: true });
for (const file of [
  "index.html",
  "style.css",
  "site.js",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "404.html",
  "media",
]) {
  await cp(path.join(root, file), path.join(root, "dist", file), {
    recursive: true,
  });
}
// The sitemap says when the site last changed: the date of the last commit that touched site/.
try {
  const day = execFileSync("git", ["log", "-1", "--format=%cs", "--", "."], {
    cwd: root,
  })
    .toString()
    .trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const file = path.join(root, "dist", "sitemap.xml");
    const xml = (await readFile(file, "utf8")).replace(
      /<lastmod>[^<]*<\/lastmod>/,
      `<lastmod>${day}</lastmod>`,
    );
    await writeFile(file, xml);
  }
} catch {
  // no git here: keep the date written in sitemap.xml
}
console.log("Built static Chinese product site in site/dist");
