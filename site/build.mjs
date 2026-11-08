import { cp, mkdir } from "node:fs/promises";
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
console.log("Built static Chinese product site in site/dist");
