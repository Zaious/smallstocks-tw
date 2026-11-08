// The page remains readable without JavaScript. Only previews, copy and release links need it.
(() => {
  const displayData = {
    numbers: {
      title: "名稱、價格、漲跌。剛剛好。",
      text: "一檔一列，數字對齊。代號可以藏起來，滑鼠移上看資料時間，點一下再開完整行情。",
      measure: "一般列高 22 px",
      image: "numbers.png",
      alt: "純數字模式：自選股名稱、價格與漲跌幅。",
      caption: "程式實際畫面 · 合成示範行情",
    },
    trend: {
      title: "走勢，放進原本那一列。",
      text: "把價格欄換成小折線，名稱與漲跌幅留下來。盤中看當天，休市看近日，不多占一塊圖表空間。",
      measure: "同樣 22 px 列高，不增加視窗高度",
      image: "trend.png",
      alt: "單行走勢模式：三檔自選股的折線直接放在每一列。",
      caption: "實際介面 · 合成整日走勢示意，非真實市場資料",
    },
    minimal: {
      title: "再小一點，只留方向與名稱。",
      text: "有厚度的小三角形，告訴你今天的漲跌。橫向並排、依寬度換行；滑鼠移上去或用鍵盤聚焦，再顯示完整明細。",
      measure: "small 細條約 30 px 高",
      image: "minimal.png",
      alt: "極簡棋子模式：立體三角形加上自選股名稱。",
      caption: "程式實際畫面 · 明細浮窗不會把細條撐高",
    },
  };
  const tabs = [...document.querySelectorAll("[data-display]")];
  function setDisplay(button) {
    const mode = button.dataset.display,
      data = displayData[mode];
    if (!data) return;
    tabs.forEach((tab) => {
      const active = tab === button;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    document
      .querySelector("#display-panel")
      .setAttribute("aria-labelledby", button.id);
    document.querySelector("#display-copy h3").textContent = data.title;
    document.querySelector("#display-copy p").textContent = data.text;
    document.querySelector("#display-copy .measure").textContent = data.measure;
    const image = document.querySelector("#display-image");
    image.src = `media/${data.image}`;
    image.alt = data.alt;
    document.querySelector("#display-caption").textContent = data.caption;
    document.querySelector("#hover-example").hidden = mode !== "minimal";
  }
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => setDisplay(button));
    button.addEventListener("keydown", (event) => {
      const target =
        event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : null;
      if (target === null) return;
      event.preventDefault();
      tabs[target].focus();
      setDisplay(tabs[target]);
    });
  });
  let look = "gray",
    platform = "windows";
  const lookButtons = [...document.querySelectorAll("[data-look]")],
    platformButtons = [...document.querySelectorAll("[data-platform]")];
  function updateLook() {
    const captions = {
      gray: "small 灰階：同樣的排版與元件，收起紅綠配色。",
      terminal:
        platform === "mac"
          ? "Mac 終端機 UI 預覽：zsh 提示、左側交通燈與等寬文字，尚未原生實測。"
          : "Windows Terminal 外觀：PowerShell 提示、等寬表格，輸入與選取在更新時保留。",
      text:
        platform === "mac"
          ? "TextEdit 純文字 UI 預覽：簡單文件窗，沒有 Windows 分頁與狀態列。尚未原生實測。"
          : "Windows 記事本外觀：文件分頁、選單、純文字區與狀態列。",
    };
    lookButtons.forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.look === look)),
    );
    platformButtons.forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.platform === platform),
      ),
    );
    const image = document.querySelector("#look-image");
    image.src = `media/${look === "gray" ? "gray" : `${platform}-${look}`}.png`;
    image.alt = captions[look];
    document.querySelector("#look-caption").textContent = captions[look];
  }
  lookButtons.forEach((button) =>
    button.addEventListener("click", () => {
      look = button.dataset.look;
      updateLook();
    }),
  );
  platformButtons.forEach((button) =>
    button.addEventListener("click", () => {
      platform = button.dataset.platform;
      updateLook();
    }),
  );
  document.querySelector("#copy-config").addEventListener("click", async () => {
    const result = document.querySelector("#copy-result"),
      code = document.querySelector("#mcp-config");
    try {
      await navigator.clipboard.writeText(code.textContent);
      result.textContent = "已複製，記得修改程式路徑。";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      result.textContent = "請複製已選取的範例，並修改程式路徑。";
    }
  });
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 5000);
  const safeDownload = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "github.com"
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  fetch(
    "https://api.github.com/repos/Zaious/smallstocks-tw/releases?per_page=5",
    {
      headers: { accept: "application/vnd.github+json" },
      signal: controller.signal,
    },
  )
    .then((response) =>
      response.ok ? response.json() : Promise.reject(new Error("版本查詢失敗")),
    )
    .then((releases) => {
      if (!Array.isArray(releases)) throw new Error("版本資料格式不符");
      const release = releases.find(
        (item) =>
          !item.draft &&
          (item.assets ?? []).some(
            (asset) =>
              /windows.*x64.*\.zip$|x64.*setup\.exe$/i.test(asset.name) &&
              safeDownload(asset.browser_download_url),
          ),
      );
      if (!release) return;
      let count = 0;
      for (const [id, pattern] of [
        ["portable-download", /windows.*x64.*\.zip$/i],
        ["installer-download", /x64.*setup\.exe$/i],
      ]) {
        const asset = release.assets.find(
          (item) =>
            pattern.test(item.name) && safeDownload(item.browser_download_url),
        );
        if (!asset) continue;
        const link = document.getElementById(id);
        link.href = safeDownload(asset.browser_download_url);
        link.hidden = false;
        if (Number.isFinite(asset.size))
          link.querySelector(".size").textContent =
            `${(asset.size / 1048576).toFixed(1)} MB`;
        count++;
      }
      if (count) {
        document.querySelector("#release-files").hidden = false;
        document.querySelector("#version").textContent =
          release.tag_name ?? "最新版本";
        document.querySelector("#release-status").textContent =
          "Windows 試用檔已公開。選擇免安裝版，或安裝到目前使用者帳號。";
      }
    })
    .catch(() => {
      document.querySelector("#release-status").textContent =
        "暫時無法取得最新下載資訊。請到 GitHub 版本區查看是否已有公開試用檔。";
    })
    .finally(() => clearTimeout(timer));
})();
