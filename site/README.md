# SmallStocks TW 繁體中文網站

純靜態 HTML／CSS／JavaScript，沿用我們自己的 Basesmall／SmalLoL 網站配色、字體、按鈕及畫面展示方式。沒有分析追蹤、外部字體、登錄或資料庫。

```powershell
node site/build.mjs
npm exec vite -- site --host 127.0.0.1 --port 4175 --strictPort
```

部署目錄為 `site/dist`，亦可將此目錄上傳靜態託管服務。

來源截圖在 `media/`；數字、灰階、明細與通知為程式示範畫面，走勢為合成整日示意，Mac 圖片為 Intel Mac 原生視窗截圖（示範資料）。`site.js` 向 GitHub 查詢已發布版本，沒有可用安裝檔時顯示真實狀態；不放無效的 `/releases/latest/download` 連結。

正式網址為 https://smallstocks.chroniclecore.com ，以 Cloudflare Worker 提供靜態頁面；帳號與部署設定留在私人儲存庫，不放在這裡。

如更換網域，請一併更新 canonical、Open Graph、robots.txt 與 sitemap.xml 的網址。

Created by Zaious, ChronicleCore Studio. Apache-2.0；沿用父專案 LICENSE／NOTICE。

展示圖以 scripts/site-assets.mjs 從程式預覽重新渲染為 4 倍像素；先啟動 npm run dev（1432），再執行 node scripts/site-assets.mjs。終端機／文字文件並排常駐，平台按鈕同時切換兩圖。small 三種顯示方式另保留 tabs 和原圖入口。
