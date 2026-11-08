# SmallStocks TW 繁體中文網站

純靜態 HTML／CSS／JavaScript，沿用我們自己的 Basesmall／SmalLoL 網站配色、字體、按鈕及畫面展示方式。沒有分析追蹤、外部字體、登錄或資料庫。

```powershell
node site/build.mjs
npm exec vite -- site --host 127.0.0.1 --port 4175 --strictPort
```

部署目錄為 `site/dist`，亦可將此目錄上傳靜態託管服務。

來源截圖在 `media/`；數字、灰階、明細與通知為程式示範畫面，走勢為合成整日示意，Mac 圖片為平台 UI 預覽。`site.js` 向 GitHub 查詢已發布版本，沒有可用安裝檔時顯示真實狀態；不放無效的 `/releases/latest/download` 連結。

Sites 的專案身分保存於 `.openai/hosting.json`；發布來源從本目錄複製到獨立、忽略的工作目錄，避免改動應用程式 Git 遠端。Sites 檢閱站維持建立時的私人可見性；不是已公開的自訂網域官網。

如改用自訂網域，請一併更新 canonical、Open Graph、robots.txt 與 sitemap.xml 的網址。

Created by Zaious, ChronicleCore Studio. Apache-2.0；沿用父專案 LICENSE／NOTICE。
