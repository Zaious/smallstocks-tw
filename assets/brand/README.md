# SmallStocks TW icon

`icon.svg` is the editable source. The dark rounded tile follows our Basesmall and SmalLoL icons; the two shallow triangular pieces use Taiwan's red-up, green-down convention and the geometry approved for the minimal view.

Generate platform assets with:

```powershell
npx tauri icon assets/brand/icon.svg
```

`src-tauri/icons/icon.ico` is embedded in the Windows executable, installer, window and tray. `icon.png` is the full-size raster export. The SVG is also the browser preview favicon.

Created by Zaious, ChronicleCore Studio. Apache-2.0, with the repository's LICENSE and NOTICE.
