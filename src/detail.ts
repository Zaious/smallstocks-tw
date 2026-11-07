import "./minimal.css";
import { listen } from "@tauri-apps/api/event";
import { detailMarkup } from "./stock-view.ts";
import type { StockDetail } from "./stock-view.ts";
const root = document.querySelector<HTMLElement>("#detail")!;
await listen<StockDetail>("stock-detail", (e) => {
  root.dataset.mode = e.payload.appearance;
  root.innerHTML = detailMarkup(e.payload);
});
