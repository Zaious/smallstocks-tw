# 0.1.0 本機預覽版開發紀錄

最新 0.1.1 驗證結果附於文件末。

日期：2026-11-06（台灣）。執行環境：Windows x64、Node 24.14、Rust 1.97、WebView2。

## 已實作

- Tauri 2 外殼、置頂與拖曳、托盤、關閉時隱藏、隱私快捷鍵。架構沿用系列經驗，通知 CSS、品牌色彩與元件風格複用 SmalLoL／Basesmall。
- small 彩色／灰階、terminal 灰階與 txt 灰階。四種呈現共用自選、規則與歷史；通知與所選色彩一致。
- 本機直接批次取得 MIS，名稱／代號搜尋與批次自選，上限 30 檔；不是 30 檔已驗證的服務承諾。
- 單一 Rust 核心持續執行。來源時間、取得時間、成交與委託分開；不由每個 UI／agent 分別抓行情。
- 價格與漲跌幅跨越規則，每日一次／一次性、關閉／只記錄／細條／卡片，圖形介面可建立、修改、停用及刪除。
- 事件歷史、當日觸發鎖與設定本機保存；寫入失敗不改動現有設定。重啟重建觀測基準，保留已觸發記錄。
- MCP stdio bridge 與本機經 token 保護的 RPC。agent 與 UI 共用核心；支援查詢、管理自選／設定／規則與事件。未內建 LLM。
- 獨立合成示範模式、獨立測試資料夾、UI 預覽與可重跑的驗證腳本。

## 已取得的驗證結果

| 檢查 | 結果 |
| --- | --- |
| npm run build | 通過：TypeScript 與 Vite 生產建置 |
| npm test | 通過：3 個顯示真實性／跳脫／灰階方向文字測試 |
| cargo test --manifest-path src-tauri/Cargo.toml --lib | 通過：7 個 Rust 測試，含門檻跨越、重複／過期／亂序／缺值、換日／時段、持久化與寫入失敗 |
| cargo clippy --lib --manifest-path src-tauri/Cargo.toml -- -D warnings | 通過 |
| node scripts/ui-check.mjs | 通過：搜尋、批次自選、規則建立／修改／停用、四種外觀、水平溢位與頁面錯誤檢查 |
| node scripts/desktop-check.mjs | 第一輪通過：實際 Tauri/WebView2，驗證 RPC 身分檢查、MCP initialize／tools、stdio bridge、agent 寫入共用規則、合成行情跨越、獨立通知窗與事件落盤 |
| MIS 少量真實請求 | 成功：上市／上櫃／ETF／兩個指數與名稱搜尋；詳細限制見 DATA_PROBE.md |

實際視窗截圖位於 `.local-test/screenshots/desktop-*.png`；腳本每次使用不同測試資料夾，不使用使用者現有設定。完成通知排版與小窗高度修正後，最終封裝與實機複驗結果補記於下節。

## 發行與尚未驗證的部分

這是供本機試用的預覽版，沒有公開發布、上架、程式碼簽章或自動更新。尚未完成盤中整個交易時段的穩定性、來源延遲、官方休市日曆、安裝／解除安裝全流程與 macOS／Linux 驗證。MCP 驗證透過標準 JSON-RPC／stdio 完成，尚未宣稱已在每一種 agent host 實測。

價格缺值時保守略過判定，可能漏掉快照間變化；不支援逐筆、大單、量能、封板或公告事件。資料使用條件仍須另行確認。沒有動到 DesktopLOL／DesktopMLB 的任何來源檔案，沒有讀取或複用私鑰。

## 最終封裝複驗

最終 `npm run tauri build -- --bundles nsis` 成功，產出 Windows x64 執行檔與 NSIS 安裝檔（安裝檔約 2.40 MiB）。執行檔 8,842,752 bytes，隨後以同一產物複驗：

- `npm run check:desktop` 通過。四種實際 Tauri 視窗截圖、MCP 寫入的規則、標準 stdio bridge、合成行情跨門檻與右下獨立通知，以及事件落盤均驗證成功。長通知已能分兩行，小窗三檔自選與管理入口能完整顯示。
- `node scripts/live-check.mjs` 通過。一般模式由本體直接取得 2330、0050、t00，`demo=false`，無連線錯誤；本次收到的來源時間約比取得時間早 15,983 秒。這批資料不被當作新鮮行情，沒有觸發事件。這只驗證收盤後實際接入與保守處理，不能當作盤中延遲量測。
- 所有測試程序已結束，測試狀態與截圖留在工作區 `.local-test`，未帶入試用包。

免安裝包以 `scripts/package-portable.ps1` 製作，含執行檔、Demo.cmd、README、LICENSE 與 NOTICE；安裝檔亦另保留供試用。NSIS 安裝／解除安裝流程尚未在本輪實際操作。

## 0.1.1 — 正式收盤與每日歷史

新增日資料 adapter、休市首頁摘要、按月走勢與資料表、MCP get_daily_history、本機快取。以既有 core 統一管理歷史佇列與快取，不在每個視窗／agent 重複抓取。歷史取得不灌入即時 ingest，也不變更監看設定版本；避免歷史回應使進行中的即時請求被誤棄。

- npm run build 通過。
- npm test：5 個測試通過。
- cargo test --manifest-path src-tauri/Cargo.toml --lib：10 個測試通過。
- cargo clippy --lib --manifest-path src-tauri/Cargo.toml -- -D warnings 通過。
- scripts/ui-check.mjs 通過，新增月切換、每日資料表與走勢檢查。
- scripts/daily-check.mjs 在獨立資料夾使用實際 Windows 程式與官方來源通過：2330、0050 的 2026-11，以及 t00、6488、o00 的 2026-10。後三項各回傳 19 個交易日，上櫃量欄確認為張；指數不捏造成交量。月份重讀確認快取命中，歷史快取落盤且事件數保持為零。
- 實際 WebView2 休市摘要與月份走勢截圖留在 .local-test/screenshots/desktop-close.png 與 desktop-daily.png。

日資料價格未還原。15:00 是本程式排除未完成當日資料的保守門檻，不是官方保證所有資料已於此時完成發布；以實際來源日期及內容為準。初次背景下載可能逐檔出現「正在取得」；資料公布／快取更新以頁面顯示為準。

最終 0.1.1 執行檔複驗完成：daily-check 使用既有測試快取重啟成功、五類來源讀取與休市畫面通過；check:desktop 的 MCP、規則共用、合成跨門檻、右下通知與事件落盤亦通過。測試用桌面實例與開發伺服器已結束。

交付檔：releases/SmallStocks-TW-0.1.1-windows-x64.zip（3,363,715 bytes）及同版 x64 安裝檔（2,551,250 bytes）。免安裝包中的執行檔與已驗證建置檔 SHA256 一致：07E1DABC12E4C041E2EEF19ED96CF2EA02B36A7610A1D4AB651B5536A37EBB6A。

## 0.1.2 — 緊湊主窗

依使用者試用回饋，移除休市主窗的大卡片與走勢，盤中／休市皆單列清單。三檔預設 360 × 148，列高 22；休市顯示正式收盤與日期，點擊標的才開行情。標題、工具列、詳情頁字級及間距同步縮小，自選管理改為標題列「＋」。

驗證：npm run build、5 個前端測試、10 個 Rust 測試與 ui-check 通過。UI 檢查包含三檔與十檔完整可見、四種外觀、點擊股票開啟對應行情、自選及規則操作。daily-check 使用最終 Windows 執行檔通過；實測主窗邏輯尺寸不超過 360 × 150、三檔完整可見且主窗沒有走勢圖，月歷史及快取照常可用。截圖為 .local-test/screenshots/desktop-close.png。

測試期間偵測到另一個版本的實例正在執行，未關閉或操作該實例。獨立設定目錄改用獨立實例識別，避免 QA 被單一實例機制轉送到使用者視窗。

0.1.2 已產出免安裝 zip 與 NSIS 安裝檔。安裝／解除安裝流程仍未於本輪操作；發布狀態維持本機預覽。

## 0.1.3 — 移除重複日期

共同收盤日期移至底部狀態列，每個股票列不再重複顯示同一天日期；較舊的個別標的仍保留日期，完整日期保留於列提示。共同日期取自實際監看的行情，不預設為今天。

TypeScript／Vite 建置與 6 個前端測試通過，包括較舊的實際日期及排除非自選標的。最終 Windows 執行檔 daily-check 通過，確認三列沒有重複日期、底部有共同收盤日期、視窗仍維持 360 × 148，歷史與快取可用。0.1.3 免安裝與安裝包均已產出，免安裝執行檔雜湊與已驗證建置一致。

## 0.1.4 — 單行走勢切換

依使用者選擇實作「盤中看當天、休市看近日」。標題列可在數字與走勢間切換，預設維持數字；曲線取代中間價格欄，保留名稱／漲跌幅，價格仍可在列提示與詳情查看。純數字與曲線同為 22 px 列高，三檔仍維持 360 × 148。

新增 intraday.rs 與獨立來源佇列：按需讀取 Yahoo Finance 當天一分鐘序列，本機 MIS 有效成交快照另存局部紀錄，兩者不合併、不用來判定事件。跨日、未來點、缺價格與長時間空缺均有處理；無足夠資料不畫假線。櫃買來源不足時顯示局部或等待。

驗證結果：

- TypeScript／Vite 生產建置、9 個前端測試、14 個 Rust 測試、Clippy warnings-as-errors 通過。
- UI-check 通過，包含單行切換、三檔同高度、十檔密度、四種外觀及原有操作。
- intraday-check 在預檢與最終 release 均通過。2330、0050、6488、t00 各取得當天 271 個分鐘時間點；確認同日、來源一致、缺櫃買資料不捏造、MCP 一般狀態不包含整包點位。
- 實際 WebView2 切換前後主窗尺寸與 22 px 列高完全一致，休市使用日收盤線，數字模式選擇會保存。
- 最終 check:desktop 通過，包含 stdio MCP、規則共用、合成跨門檻、獨立通知窗及事件持久化。未干擾使用者現有 0.1.1 實例，測試程序與開發伺服器均已結束。

分鐘線可能延遲，這次是在收盤後驗證當天補線。盤中長時間連續更新、延遲與跨交易時段切換仍需實盤觀察，未聲稱已驗證。

交付 0.1.4 免安裝包（3,399,678 bytes）與安裝檔（2,575,124 bytes）。免安裝執行檔 SHA256 與已驗證建置相同：8133F02213CA663F93C2A79102968BB675A244772F54DF5E76CB36D2C9BE6143。

## 0.1.5 — Windows 式 Terminal／記事本

依使用者回饋，這兩種模式重做視窗外框與內容，而非沿用 small 共用標題、導覽與頁尾。記事本使用分頁、檔案／編輯／檢視、唯讀純文字區與狀態列；Terminal 使用 PowerShell 分頁外框、等寬輸出、數字欄對齊及模式內命令輸入。

外觀參考 Microsoft 官方：[Notepad](https://blogs.windows.com/windows-insider/2025/05/30/text-formatting-in-notepad-begin-rolling-out-to-windows-insiders/) 與 [Windows Terminal](https://devblogs.microsoft.com/commandline/windows-terminal-is-now-the-default-in-windows-11/)。本機記事本的控制未獲准，改以官方公開畫面核對，沒有讀取或修改使用者既有記事本文件內容。參考圖片僅留在忽略的測試資料夾，不打包進產品。

功能與驗證：

- 以 disguise.ts／disguise.css 管理兩種模式。輪詢僅更新內容，保留輸入、選取、捲動與開啟的選單；獨立 data-note-edit 命名修正與規則編輯的事件衝突。
- 記事本可全選／複製、縮放與切換狀態列；Terminal 可輸入模式內 help／pause／resume／settings 等，不會執行系統命令。
- 10 個前端測試、14 個 Rust 測試、TypeScript／Vite 建置及 Clippy warnings-as-errors 通過。
- disguise-check 通過：原生式外框、數字欄對齊、輸入／選取跨輪詢保留、選單／縮放／狀態列、返回 small、無頁面錯誤。測試未寫入系統剪貼簿。
- ui-check 通過，small 緊湊列、單行走勢、自選與規則操作保留。
- 最終 Windows 執行檔 check:desktop 通過，包括視窗標題權限、隱藏共用導覽、最大化／還原，以及原有 stdio MCP、規則共用、合成事件通知與持久化。

最終截圖：.local-test/screenshots/desktop-terminal.png、desktop-txt.png。測試實例與開發伺服器均已結束。

交付 0.1.5 免安裝包（3,404,568 bytes）與安裝檔（2,578,457 bytes）。免安裝執行檔 SHA256 與已驗證建置一致：3113079A8D4A4E0C582860BA474F90327BA60ECA16A8EFF3CD98DCD1ED48B285。

## 0.1.6 — 四種外觀極簡顯示與代號選項

顯示內容新增 minimal，與外觀獨立；預設仍 numbers。ShowCodes 預設 false，管理／搜尋與明細保留代號，名稱未取得時仍以代號辨識。

- small／灰階只留名稱、當日方向與小型操作，約 30 px 高細條；寬度由使用者控制，依實際換行調整高度。Native 外框保留，資料區簡化。
- 方向 ▲／▼／—／○ 分別表示上漲／下跌／平盤／資料未確認。缺價格、過期快照、較舊收盤不能被當成有效當日方向。
- Hover／鍵盤焦點使用獨立不取得焦點、滑鼠穿透的 detail 視窗，避免細條裁切資訊。離開、Escape、切換頁面與隱藏時清除浮窗。
- 自動高度在 Rust 端保留當前寬度，避免與使用者拖曳競爭；超出工作區時調整位置，最大化時不自動縮窗。極簡 Native 選單開啟時暫時展開、關閉後縮回。

驗證：

- TypeScript／Vite 建置、12 個前端測試、14 個 Rust 測試、Clippy warnings-as-errors 通過。
- minimal-check 通過四種外觀、名稱並排／換行、hover 明細、焦點跨輪詢保留、點擊行情與代號開關。
- ui-check 與 disguise-check 通過，原有數字／走勢、操作、原生式外框與選取／輸入保留。
- desktop-minimal-check 在預檢與最終 Windows release 均通過：small 三檔主窗不超過 40 px 高（實測約 30）、明細窗不取得焦點且不撐大主窗、滑出後隱藏；700／300 寬度切換改變換行與高度，不把寬度改回預設。四種外觀、Native 選單與設定持久化均驗證。
- 最終 check:desktop 通過原有 stdio MCP、規則共用、合成事件通知與持久化。測試實例與開發伺服器已結束，未關閉使用者原有程式。

最終截圖：.local-test/screenshots/desktop-minimal-small.png、desktop-minimal-gray.png、desktop-minimal-terminal.png、desktop-minimal-txt.png；細節為 desktop-minimal-detail.png。

交付 0.1.6 免安裝包（3,431,282 bytes）與安裝檔（2,596,408 bytes）。免安裝執行檔 SHA256 與已驗證建置相同：4E1B15F30FE494A0D8A6E9275C7298232BCC4B95E86C9C28EDE915A62A869C0D。

## 0.1.7 — 有厚度的正三角形

依使用者確認，small／灰階極簡方向標記採等邊正三角形正面與明暗側面，柱身比前一試稿減薄三分之一。SVG 僅在方向或外觀變更時替換，維持 22 px 列高；Terminal／記事本、平盤與未知狀態保留文字符號。

- 12 個前端測試、TypeScript／Vite 生產建置、四種外觀 minimal-check 通過。
- Windows x64 release 與 NSIS 安裝檔建置成功。
- 實際 WebView2 的診斷複驗通過四種外觀、獨立不搶焦點的明細窗、代號選配、使用者寬度／自動高度、Native 選單與設定保存。首次 desktop-minimal-check 曾在等待主窗縮高時逾時；同一產物加診斷複驗未重現，尚未確認首次逾時原因。
- 未修改使用者正在執行的 0.1.1 程式與設定，沒有公開發布 GitHub。

原始 desktop-minimal-check 再次執行亦通過，使用同一份最終 Windows 產物。

交付 0.1.7 免安裝包與安裝檔，封裝執行檔 SHA256 與已驗證建置相同：D8CAED618ACCF0669701B0559F2A35C75DA770332DA03338EEB7145B49B3DAB7。

## 0.1.8 — 專屬圖示與專案介紹

新增可編輯的 assets/brand/icon.svg：沿用 Basesmall／SmalLoL 的深色圓角底板，以台股紅漲綠跌的兩枚淺厚正三角形代表本作。透過 Tauri CLI 生成多尺寸 ICO／PNG；Windows 套件與 tray 使用共用應用程式圖示，瀏覽器使用 SVG favicon。已檢視 32px 縮圖及從最終 Windows 執行檔取出的內嵌圖示，確認為新圖樣。

README 依兩個系列專案的介紹結構重寫，主標為 Taiwan stocks, but small.，先介紹常駐監看、低調外觀及提醒，再介紹選配的 agent/MCP；完整繁體中文操作說明移至 docs/USAGE.zh-TW.md，免安裝包會攜帶。README 展示實際桌面驗證截圖並標示合成示範資料。GitHub 簡介保存於 .github/description.txt。

- 12 個前端測試、TypeScript／Vite 生產建置通過。
- Windows x64 release 與 NSIS 建置成功，已檢查新圖示嵌入產物。
- 初始化本機 Git main 分支；排除實際設定、測試資料、依賴與建置／下載產物。沒有建立遠端儲存庫或公開發布。

最終 0.1.8 的 desktop-minimal-check 通過四種實際視窗、獨立明細窗、代號選項、寬度／自動高度、Native 選單與設定保存。

交付 0.1.8 免安裝包與安裝檔；免安裝執行檔與已驗證建置 SHA256 相同：BD3D7AE7BE6BBE4927B66B403271CDCDEA041018962DFAF0825B4F005AB79D47。

## 0.1.9 — 主視窗置頂選項與 small 視覺介紹

新增共用 alwaysOnTop 設定，預設 true，舊設定未包含欄位時沿用原行為。介面及 MCP 都由核心驗證／保存；成功後 Rust 更新原生主視窗。啟動時直接從設定恢復，避免前端載入前先強制置頂。通知與暫時明細保留各自浮窗行為。

- 15 個 Rust 測試與 12 個前端測試通過；新增舊設定相容、型別驗證及置頂選擇保存測試。
- TypeScript／Vite 與 Windows x64 release／NSIS 建置通過。
- window-settings-check 以獨立測試設定驗證：預設置頂、UI 關閉、四種外觀沿用、隱藏時 MCP 開關且不自行顯示主窗，以及完整重開後原生置頂狀態恢復。檢查的是原生視窗狀態，非僅設定值。
- minimal-check 通過四種外觀、明細、焦點保存、點擊行情、代號及換行檢查。
- README 補齊 small 風格、一般數字列、同列高的單行走勢，以及極簡與 hover 明細。數字列及明細為最終 Windows 程式合成資料截圖；走勢圖透過實際瀏覽器預覽呈現明確標示的合成整場示意，沒有把清晨少量點位或 pending 畫面宣稱完整盤中資料。圖片可用 scripts/window-settings-check.mjs 與 scripts/readme-trend-image.mjs 重產。

使用者原有 0.1.1 執行檔與設定保持原樣；未新增公開 GitHub Releases。
交付 0.1.9 免安裝包與安裝檔；封裝執行檔 SHA256 與已驗證建置一致：502D7BDE1517EC26DE6B8CF1989623CD438BA4D0D8E0619983EDD72B73917540。
