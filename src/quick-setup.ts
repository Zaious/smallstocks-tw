// Quick setup: a pasted list (names or codes, mixed, even copied from a broker app with prices in
// it) plus optional one-line alerts such as "台積電 跌破 1000". The text is only parsed here; every
// name is looked up against the real source before anything is saved, and core.rs validates again.
import { esc, isUs, ruleText } from "./model.ts";
import type { Rule } from "./model.ts";
export type SetupRule = {
  metric: "price" | "changePercent" | "move";
  direction: "above" | "below";
  threshold: number;
  windowMinutes?: number;
  repeat: "daily" | "once";
};
/** One thing to look up: a code or a name, with the alert lines written for it. */
export type SetupTarget = {
  query: string;
  kind: "code" | "name";
  rules: SetupRule[];
  /** Marked "不確定" (by an AI, say): shown for checking even when found. */
  uncertain?: boolean;
};
export type SetupParse = {
  targets: SetupTarget[];
  /** Lines that looked like an alert but could not be read. */
  unread: string[];
};

const RULE_WORD =
  /跌破|跌到|跌至|低於|漲到|漲至|漲破|突破|高於|站上|急跌|急漲|跌|漲|[<>]/;
const normalize = (text: string) =>
  text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 0xfee0),
    )
    .replace(/％/g, "%")
    .replace(/＜/g, "<")
    .replace(/＞/g, ">")
    .replace(/．/g, ".")
    .replace(/[（(）)「」【】\[\]]/g, " ");
const INDEX: Record<string, string> = {
  大盤: "t00",
  加權: "t00",
  加權指數: "t00",
  t00: "t00",
  櫃買: "o00",
  櫃買指數: "o00",
  o00: "o00",
};
/** A code as typed: Taiwan digits (optionally .TW/.TWO), an index, or an upper-case US ticker. */
function code(token: string): string | null {
  const t = token.trim();
  if (INDEX[t] || INDEX[t.toLowerCase()])
    return INDEX[t] ?? INDEX[t.toLowerCase()]!;
  const tw = /^(\d{4,6}[A-Za-z]?)(\.TWO?)?$/i.exec(t);
  if (tw) return tw[1]!.toUpperCase();
  if (/^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(t)) return t.replace(".", "-");
  return null;
}
const hasName = (t: string) => /[㐀-鿿]/.test(t) || /^[A-Za-z][a-z]+$/.test(t);
/** Number-only scraps from a copied quote table (1,040  -0.5%  62.60  +12) are dropped. */
const scrap = (t: string) => /^[+\-−]?[\d,]*\.?\d+%?$/.test(t) && !code(t);

function rule(text: string): SetupRule | null {
  const t = text.replace(/,/g, "").replace(/−/g, "-");
  const repeat: SetupRule["repeat"] =
    /每天|每日/.test(t) || !/一次/.test(t) ? "daily" : "once";
  const move =
    /(\d+)\s*分鐘\s*(?:內|以內)?\s*(?:急)?(跌|漲)\s*(?:超過|達|了)?\s*([\d.]+)\s*%/.exec(
      t,
    );
  if (move)
    return {
      metric: "move",
      direction: move[2] === "跌" ? "below" : "above",
      threshold: Number(move[3]),
      windowMinutes: Number(move[1]),
      repeat,
    };
  const pct =
    /(跌|漲)\s*(?:破|到|至|幅|超過|達)?\s*(?:超過|達)?\s*[-+]?\s*([\d.]+)\s*%/.exec(
      t,
    );
  if (pct) {
    const n = Number(pct[2]);
    return pct[1] === "跌"
      ? { metric: "changePercent", direction: "below", threshold: -n, repeat }
      : { metric: "changePercent", direction: "above", threshold: n, repeat };
  }
  const below = /(?:跌破|跌到|跌至|低於|<)\s*([\d.]+)/.exec(t);
  if (below)
    return {
      metric: "price",
      direction: "below",
      threshold: Number(below[1]),
      repeat,
    };
  const above = /(?:漲到|漲至|漲破|突破|高於|站上|>)\s*([\d.]+)/.exec(t);
  if (above)
    return {
      metric: "price",
      direction: "above",
      threshold: Number(above[1]),
      repeat,
    };
  return null;
}

export function parseSetup(text: string): SetupParse {
  const targets: SetupTarget[] = [];
  const unread: string[] = [];
  let uncertain = false;
  const add = (query: string, r?: SetupRule) => {
    const c = code(query);
    const key = c ?? query;
    let target = targets.find((t) => t.query === key);
    if (!target) {
      target = { query: key, kind: c ? "code" : "name", rules: [] };
      targets.push(target);
    }
    if (r) target.rules.push(r);
    if (uncertain) target.uncertain = true;
  };
  for (const original of text.split(/\r?\n/)) {
    // Bullets and numbering an AI or a note app puts in front of each line.
    let line = normalize(original)
      .replace(/^\s*(?:[-*•・·]|\d{1,2}[.)、]\s)\s*/, "")
      .trim();
    uncertain = /不確定/.test(line);
    line = line.replace(/不確定/g, " ").trim();
    if (!line) continue;
    const m = RULE_WORD.exec(line);
    // An alert line: the stock comes first, the alert after it. Digits right before the rule
    // word belong to the stock ("2330跌破1000"); a window ("5分鐘內急跌") starts the rule.
    if (m) {
      const windowAt = /\d+\s*分鐘/.exec(line);
      const cut =
        windowAt && windowAt.index < m.index ? windowAt.index : m.index;
      const head = line.slice(0, cut).trim();
      const tokens = head.split(/[\s,，、;；|/:：]+/).filter(Boolean);
      const target = tokens.find((t) => code(t)) ?? tokens.find(hasName);
      const r = rule(line.slice(cut));
      if (target && r) add(target, r);
      else unread.push(original.trim());
      continue;
    }
    for (const token of line.split(/[\s,，、;；|/:：]+/).filter(Boolean)) {
      if (scrap(token)) continue;
      if (code(token) || hasName(token)) add(token);
    }
  }
  return { targets, unread };
}

export type Found = { symbol: string; name: string; market?: "tw" | "us" };
export type Resolved = SetupTarget & {
  /** ok: found exactly; check: a guess the user should look at; missing: nothing found. */
  status: "ok" | "check" | "missing";
  symbol?: string;
  name?: string;
  options: Found[];
};
const INDEX_NAME: Record<string, string> = { t00: "加權指數", o00: "櫃買指數" };

/** Looks each target up with `search` (the same lookup as the manage page's search box). */
export async function resolveSetup(
  targets: SetupTarget[],
  search: (q: string) => Promise<Found[]>,
): Promise<Resolved[]> {
  const one = async (t: SetupTarget): Promise<Resolved> => {
    if (INDEX_NAME[t.query])
      return {
        ...t,
        status: "ok",
        symbol: t.query,
        name: INDEX_NAME[t.query],
        options: [],
      };
    let found: Found[] = [];
    try {
      found = await search(t.query);
    } catch {
      found = [];
    }
    if (t.kind === "code") {
      const hit = found.find((f) => f.symbol === t.query);
      return hit
        ? {
            ...t,
            status: t.uncertain ? "check" : "ok",
            symbol: hit.symbol,
            name: hit.name,
            options: t.uncertain ? [hit] : [],
          }
        : { ...t, status: "missing", options: [] };
    }
    const exact = found.find((f) => f.name === t.query);
    if (exact)
      return {
        ...t,
        status: t.uncertain ? "check" : "ok",
        symbol: exact.symbol,
        name: exact.name,
        options: t.uncertain ? found.slice(0, 5) : [],
      };
    // Warrants (台積電凱基67售14) crowd out the stock someone meant; they are left out of guesses.
    const options = found
      .filter((f) => !/[0-9A-Z][購售][0-9A-Z]{2}$/.test(f.name))
      .slice(0, 5);
    return options[0]
      ? {
          ...t,
          status: "check",
          symbol: options[0].symbol,
          name: options[0].name,
          options,
        }
      : { ...t, status: "missing", options: [] };
  };
  const out: Resolved[] = new Array(targets.length);
  let next = 0;
  // A few lookups at a time: quick for 20 names without hammering the source.
  await Promise.all(
    Array.from({ length: Math.min(4, targets.length) }, async () => {
      while (next < targets.length) {
        const i = next++;
        out[i] = await one(targets[i]!);
      }
    }),
  );
  return out;
}

/** "台積電" and "2330" in one paste are the same stock: one row, all their alerts. */
export function mergeResolved(list: Resolved[]): Resolved[] {
  const out: Resolved[] = [];
  for (const r of list) {
    const same =
      r.status === "ok" &&
      out.find((o) => o.status === "ok" && o.symbol === r.symbol);
    if (same) same.rules.push(...r.rules);
    else out.push({ ...r, rules: [...r.rules] });
  }
  return out;
}

const ruleLine = (symbol: string, r: SetupRule) =>
  ruleText({ symbol, ...r } as Rule).replace(/^.*? · /, "") +
  (r.repeat === "once" ? " · 只提醒一次" : "");

/** A row starts checked when it is sure, or when the guess plainly extends what was typed (台積 →
 * 台積電). A typo's guess (台機電 → 昶瑞機電) or an AI's 不確定 waits for the user to tick it. */
export const preselected = (r: Resolved) =>
  r.status === "ok" ||
  (r.status === "check" && !r.uncertain && (r.name ?? "").includes(r.query));

/** The rows to check before saving. Each found stock has a box and, for a guess, a choice. */
export function setupPreview(
  list: Resolved[],
  unread: string[],
  watchlist: string[],
): string {
  const rows = list.map((r, i) => {
    const rules = r.rules
      .map(
        (x) =>
          `<small class="setup-rule">提醒：${esc(ruleLine(r.symbol ?? "", x))}</small>`,
      )
      .join("");
    if (r.status === "missing")
      return `<div class="setup-row missing"><span class="setup-mark">✗</span><span>「${esc(r.query)}」找不到${r.rules.length ? "，這一行的提醒也不會建立" : ""}</span></div>`;
    const choice =
      r.status === "check"
        ? `<select data-setup-pick="${i}" aria-label="「${esc(r.query)}」是哪一檔">${r.options
            .map(
              (o) =>
                `<option value="${esc(o.symbol)}" ${o.symbol === r.symbol ? "selected" : ""}>${esc(o.name)} ${esc(o.symbol)}</option>`,
            )
            .join("")}</select>`
        : `<strong>${esc(r.name ?? "")}</strong><small>${esc(r.symbol ?? "")}${isUs(r.symbol ?? "") ? " · 美股" : ""}</small>`;
    const asked =
      r.status === "check"
        ? `<small class="setup-ask">「${esc(r.query)}」${r.uncertain ? "標了不確定，請確認" : "是哪一檔？"}</small>`
        : "";
    const already = watchlist.includes(r.symbol ?? "")
      ? '<small class="setup-ask">已在自選</small>'
      : "";
    return `<div class="setup-row ${r.status}"><label class="setup-pick"><input type="checkbox" data-setup-on="${i}" ${preselected(r) ? "checked" : ""}><span class="setup-mark">${r.status === "ok" ? "✓" : "?"}</span>${asked}${choice}${already}</label>${rules}</div>`;
  });
  const bad = unread.map(
    (l) =>
      `<div class="setup-row missing"><span class="setup-mark">✗</span><span>看不懂這條提醒：${esc(l)}</span></div>`,
  );
  return rows.concat(bad).join("");
}

/** The add_setup request for the rows still checked, with the stock each guess was set to. */
export function setupRequest(
  list: Resolved[],
  chosen: (i: number) => { on: boolean; symbol?: string },
) {
  const symbols: string[] = [];
  const rules: Record<string, unknown>[] = [];
  list.forEach((r, i) => {
    if (r.status === "missing") return;
    const c = chosen(i);
    const symbol = c.symbol ?? r.symbol;
    if (!c.on || !symbol) return;
    if (!symbols.includes(symbol)) symbols.push(symbol);
    for (const x of r.rules) rules.push({ symbol, ...x, channel: "strip" });
  });
  return { symbols, rules };
}

/** What a chat AI is asked for: plain lines this box reads, never the program's own files. */
export const AI_PROMPT = `請幫我把下面的股票整理成 SmallStocks TW（台股桌面看盤小工具）可以貼上的格式。

規則：
1. 一行一檔，寫股票代號：台股寫數字代號（例如 2330），美股寫英文代號（例如 AAPL），加權指數寫 t00，櫃買指數寫 o00。
2. 如果我有提到提醒條件，寫在同一行代號後面，只能用這幾種寫法：
   - 成交價：「跌破 1000」或「漲到 1200」
   - 當日漲跌幅：「跌 3%」或「漲 5%」
   - 急漲急跌：「5分鐘內急跌 1%」或「10分鐘內急漲 2%」（1 到 60 分鐘）
   - 句尾可加「只提醒一次」，沒寫就是每天最多一次
3. 同一檔有多個提醒就分成多行，每行都寫代號。
4. 只輸出這些行，不要加說明、編號或其他文字。代號不確定的，在那一行最後寫「（不確定）」。

例子：
2330
2330 跌破 1000
0050 5分鐘內急跌 1%
AAPL 漲到 250

我的股票：
`;
