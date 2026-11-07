import "./notify-base.css";
import "./notify.css";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  currentMonitor,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { request } from "./client.ts";
import { esc, time } from "./model.ts";
import type { StockEvent } from "./model.ts";
const stack = document.querySelector<HTMLElement>("#stack")!;
const win = getCurrentWindow();
let queue: StockEvent[] = [];
let showing = false;
await listen("privacy-hide", () => {
  queue = [];
  void win.hide();
});
async function next() {
  if (showing || !queue.length) return;
  showing = true;
  try {
    const event = queue.shift()!;
    const s = await request("get_status");
    const gray = s.settings.appearance !== "small";
    document.documentElement.dataset.look = s.settings.appearance;
    document.documentElement.style.setProperty(
      "--accent",
      gray ? "#bfc1c5" : "#e8b04a",
    );
    const card = event.channel === "card";
    stack.innerHTML = `<div class="item ${card ? "card" : "strip"}"><div class="${card ? "head" : ""}"><span class="title">${esc(event.text)}</span></div>${card ? `<span class="sub">${time(event.sourceAt)} · ${s.demo ? "合成示範" : "TWSE MIS"}</span>` : ""}</div>`;
    const monitor = await currentMonitor();
    const scale = monitor?.scaleFactor ?? 1;
    const w = Math.round(300 * scale),
      h = Math.round((card ? 78 : 32) * scale);
    await win.setSize(new PhysicalSize(w, h));
    if (monitor) {
      const area = monitor.workArea;
      await win.setPosition(
        new PhysicalPosition(
          area.position.x + area.size.width - w - 12 * scale,
          area.position.y + area.size.height - h - 12 * scale,
        ),
      );
    }
    await win.show();
    await new Promise((r) => setTimeout(r, card ? 8000 : 4500));
    await win.hide();
    stack.innerHTML = "";
  } catch (e) {
    console.warn("notice", e);
  } finally {
    showing = false;
    void next();
  }
}
await listen<StockEvent>("stock-notice", (e) => {
  if (e.payload.channel === "log" || e.payload.channel === "off") return;
  queue.push(e.payload);
  queue = queue.slice(-5);
  void next();
});
