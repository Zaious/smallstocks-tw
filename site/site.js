// The page remains readable without JavaScript. Only previews, copy and release links need it.
(() => {
  const displayData = {
    numbers: {
      title: "名稱、價格、漲跌。剛剛好。",
      text: "一檔一列，數字對齊。代號可以藏起來，滑鼠移上看資料時間，點一下再開完整行情。",
      measure: "實際列高 22 px · 畫面放大展示",
      image: "numbers.png",
      alt: "純數字模式：自選股名稱、價格與漲跌幅。",
      caption: "4 倍像素截圖 · 點圖片看原圖 · 合成示範行情",
    },
    trend: {
      title: "走勢，放進原本那一列。",
      text: "把價格欄換成小折線，名稱與漲跌幅留下來。盤中看當天，休市看近日，不多占一塊圖表空間。",
      measure: "同樣 22 px 列高，不增加視窗高度",
      image: "trend.png",
      alt: "單行走勢模式：三檔自選股的折線直接放在每一列。",
      caption: "4 倍像素截圖 · 點圖片看原圖 · 合成走勢示意",
    },
    minimal: {
      title: "再小一點，只留方向與名稱。",
      text: "有厚度的小三角形，告訴你今天的漲跌。橫向並排、依寬度換行；滑鼠移上去或用鍵盤聚焦，再顯示完整明細。",
      measure: "small 細條約 30 px 高",
      image: "minimal.png",
      alt: "極簡棋子模式：立體三角形加上自選股名稱。",
      caption: "4 倍像素截圖 · 點圖片看原圖 · 明細不撐高細條",
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
    document.querySelector("#display-zoom").href = image.src;
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
  const platformButtons = [...document.querySelectorAll("[data-platform]")];
  function updatePlatform(platform) {
    platformButtons.forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.platform === platform),
      ),
    );
    const mac = platform === "mac";
    const captions = {
      terminal: mac
        ? "Mac 終端機／zsh 外觀，Intel Mac 原生視窗截圖（示範資料）。"
        : "Windows Terminal／PowerShell 外觀，等寬表格清楚對齊。",
      text: mac
        ? "TextEdit 純文字外觀，Intel Mac 原生視窗截圖（示範資料）。"
        : "Windows 記事本外觀，像一份隨時更新的文字報表。",
    };
    for (const kind of ["terminal", "text"]) {
      const image = document.getElementById(kind + "-image"),
        src = "media/" + platform + "-" + kind + ".png";
      image.src = src;
      image.alt = captions[kind];
      document.getElementById(kind + "-zoom").href = src;
      document.getElementById(kind + "-caption").textContent = captions[kind];
    }
  }
  platformButtons.forEach((button) =>
    button.addEventListener("click", () =>
      updatePlatform(button.dataset.platform),
    ),
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
              /windows.*x64.*\.zip$|x64.*setup\.exe$|\.dmg$/i.test(
                asset.name,
              ) && safeDownload(asset.browser_download_url),
          ),
      );
      if (!release) {
        document.querySelector("#release-status").textContent =
          "公開安裝包尚未發布。可以先到 GitHub 查看原始碼與版本進度。";
        return;
      }
      let count = 0;
      for (const [id, pattern] of [
        ["portable-download", /windows.*x64.*\.zip$/i],
        ["installer-download", /x64.*setup\.exe$/i],
        ["mac-download", /\.dmg$/i],
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
          "試用檔已公開。Windows 可選免安裝版或安裝版，Mac 下載 DMG。";
      }
    })
    .catch(() => {
      document.querySelector("#release-status").textContent =
        "暫時無法取得最新下載資訊。請到 GitHub 版本區查看是否已有公開試用檔。";
    })
    .finally(() => clearTimeout(timer));
})();
