use crate::daily;
use crate::intraday;
use chrono::{Datelike, FixedOffset, NaiveDateTime, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf};

pub fn now() -> i64 {
    Utc::now().timestamp_millis()
}
pub fn local(ms: i64) -> chrono::DateTime<FixedOffset> {
    FixedOffset::east_opt(8 * 3600)
        .unwrap()
        .timestamp_millis_opt(ms)
        .single()
        .unwrap()
}
pub fn trading(ms: i64) -> bool {
    let t = local(ms);
    let m = t.hour() * 60 + t.minute();
    t.weekday().number_from_monday() <= 5 && (540..810).contains(&m)
}
fn num(v: &Value) -> Option<f64> {
    let n = v.as_f64().or_else(|| v.as_str()?.parse().ok())?;
    (n.is_finite() && n > 0.).then_some(n)
}
pub fn symbol(s: &str) -> Option<String> {
    let s = s.trim().to_uppercase();
    if matches!(s.as_str(), "大盤" | "加權" | "加權指數" | "T00") {
        return Some("t00".into());
    }
    if matches!(s.as_str(), "櫃買" | "櫃買指數" | "O00") {
        return Some("o00".into());
    }
    let s = s.trim_end_matches(".TWO").trim_end_matches(".TW");
    let digits = s.chars().take_while(|c| c.is_ascii_digit()).count();
    ((4..=6).contains(&digits)
        && (s.len() == digits
            || s.len() == digits + 1 && s.as_bytes()[digits].is_ascii_uppercase()))
    .then(|| s.to_owned())
}
pub fn mis_url(codes: &[String]) -> String {
    let channels: Vec<String> = codes
        .iter()
        .flat_map(|c| match c.as_str() {
            "t00" => vec!["tse_t00.tw".into()],
            "o00" => vec!["otc_o00.tw".into()],
            _ => vec![format!("tse_{c}.tw"), format!("otc_{c}.tw")],
        })
        .collect();
    let mut url =
        reqwest::Url::parse("https://mis.twse.com.tw/stock/api/getStockInfo.jsp").unwrap();
    url.query_pairs_mut()
        .append_pair("ex_ch", &channels.join("|"))
        .append_pair("json", "1")
        .append_pair("delay", "0")
        .append_pair("_", &now().to_string());
    url.into()
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub symbol: String,
    pub name: String,
    pub price: Option<f64>,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub previous: Option<f64>,
    pub change_percent: Option<f64>,
    pub source_at: i64,
    pub received_at: i64,
    pub date: String,
    pub source: String,
}
pub fn parse_mis(v: &Value, received: i64) -> Result<Vec<Quote>, String> {
    if v["rtcode"].as_str() != Some("0000") {
        return Err("行情來源未回傳成功狀態".into());
    }
    let rows = v["msgArray"].as_array().ok_or("行情格式不符")?;
    let mut out = Vec::new();
    for r in rows {
        let Some(code) = r["c"].as_str().and_then(symbol) else {
            continue;
        };
        let date = r["d"].as_str().unwrap_or("");
        let time = r["t"].as_str().unwrap_or("");
        let stamp = NaiveDateTime::parse_from_str(&format!("{date} {time}"), "%Y%m%d %H:%M:%S")
            .ok()
            .and_then(|t| {
                FixedOffset::east_opt(28800)?
                    .from_local_datetime(&t)
                    .single()
            })
            .map(|t| t.timestamp_millis());
        let Some(stamp) = stamp else { continue };
        // Missing trade stays missing: order book and previous close never become a trade.
        let price = num(&r["z"]);
        let previous = num(&r["y"]);
        let level = |k: &str| {
            r[k].as_str()
                .and_then(|s| s.split('_').next())
                .and_then(|s| s.parse::<f64>().ok())
                .filter(|n| n.is_finite() && *n > 0.)
        };
        out.push(Quote {
            symbol: code,
            name: r["n"].as_str().unwrap_or("").into(),
            price,
            bid: level("b"),
            ask: level("a"),
            previous,
            change_percent: price.zip(previous).map(|(p, y)| (p / y - 1.) * 100.),
            source_at: stamp,
            received_at: received,
            date: date.into(),
            source: "TWSE MIS".into(),
        });
    }
    Ok(out)
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    #[serde(default)]
    pub show_codes: bool,
    #[serde(default = "default_row_display")]
    pub row_display: String,
    pub appearance: String,
    pub paused: bool,
    pub refresh_seconds: u64,
}
fn default_row_display() -> String {
    "numbers".into()
}
fn default_always_on_top() -> bool {
    true
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top: true,
            show_codes: false,
            row_display: default_row_display(),
            appearance: "small".into(),
            paused: false,
            refresh_seconds: 15,
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub symbol: String,
    pub metric: String,
    pub direction: String,
    pub threshold: f64,
    pub channel: String,
    pub repeat: String,
    pub enabled: bool,
    #[serde(default)]
    pub last_value: Option<f64>,
    #[serde(default)]
    pub last_at: Option<i64>,
    #[serde(default)]
    pub last_day: Option<String>,
    #[serde(default)]
    pub fired_day: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub rule_id: String,
    pub symbol: String,
    pub text: String,
    pub source_at: i64,
    pub detected_at: i64,
    pub channel: String,
    pub value: f64,
    pub threshold: f64,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    #[serde(default)]
    pub intraday_cache: HashMap<String, intraday::Series>,
    #[serde(default)]
    pub local_intraday: HashMap<String, intraday::Series>,
    #[serde(default)]
    pub daily_cache: HashMap<String, daily::Series>,
    #[serde(default)]
    pub watchlist: Vec<String>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub events: Vec<Event>,
}
#[derive(Clone)]
pub struct Core {
    pub intraday_queue: std::collections::VecDeque<String>,
    pub intraday_pending: std::collections::HashSet<String>,
    pub intraday_errors: HashMap<String, (String, i64)>,
    pub last_intraday_save: i64,
    pub daily_queue: std::collections::VecDeque<(String, String)>,
    pub daily_pending: std::collections::HashSet<String>,
    pub daily_errors: HashMap<String, (String, i64)>,
    pub saved: Saved,
    pub quotes: HashMap<String, Quote>,
    pub path: PathBuf,
    pub demo: bool,
    pub error: Option<String>,
    pub last_fetch: Option<i64>,
    pub failures: u32,
    pub next_poll: i64,
    pub revision: u64,
    pub config_revision: u64,
    pub notices_hidden: bool,
    pub privacy_shortcut_error: Option<String>,
}
impl Core {
    pub fn load(path: PathBuf, demo: bool) -> Result<Self, String> {
        let mut saved: Saved = if path.exists() {
            serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("設定檔無法讀取，已保留原檔：{e}"))?
        } else {
            Saved {
                watchlist: vec!["t00".into(), "2330".into(), "0050".into()],
                ..Default::default()
            }
        };
        for r in &mut saved.rules {
            r.last_value = None;
            r.last_at = None;
            r.last_day = None;
        }
        Ok(Self {
            intraday_queue: Default::default(),
            intraday_pending: Default::default(),
            intraday_errors: Default::default(),
            last_intraday_save: 0,
            daily_queue: Default::default(),
            daily_pending: Default::default(),
            daily_errors: Default::default(),
            saved,
            quotes: HashMap::new(),
            path,
            demo,
            error: None,
            last_fetch: None,
            failures: 0,
            next_poll: 0,
            revision: 0,
            config_revision: 0,
            notices_hidden: false,
            privacy_shortcut_error: None,
        })
    }
    pub fn persist(&self) -> Result<(), String> {
        let temp = self.path.with_extension("tmp");
        std::fs::write(
            &temp,
            serde_json::to_vec_pretty(&self.saved).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(temp, &self.path).map_err(|e| e.to_string())
    }
    pub fn snapshot(&self) -> Value {
        let months = daily::months(now());
        let summaries: HashMap<String, Value> = self
            .saved
            .watchlist
            .iter()
            .map(|c| (c.clone(), self.daily_view(c, &months)))
            .collect();
        let intraday: HashMap<String, Value> = self
            .saved
            .watchlist
            .iter()
            .map(|c| (c.clone(), self.intraday_view(c)))
            .collect();
        json!({"watchlist":self.saved.watchlist,"settings":self.saved.settings,"privacyShortcutError":self.privacy_shortcut_error,"rules":self.saved.rules,"events":self.saved.events,"quotes":self.quotes,"demo":self.demo,"error":self.error,"lastFetch":self.last_fetch,"nextPoll":self.next_poll,"marketOpen":trading(now()),"revision":self.revision,"now":now(),"dailySummaries":summaries,"intraday":intraday})
    }
    pub fn queue_intraday(&mut self, code: &str) {
        let at = now();
        let fresh = self
            .saved
            .intraday_cache
            .get(code)
            .is_some_and(|s| s.date == intraday::day(at) && at - s.fetched_at < 60_000);
        let cooldown = self
            .intraday_errors
            .get(code)
            .is_some_and(|(_, t)| at - t < 300_000);
        if !fresh
            && !cooldown
            && !self.intraday_pending.contains(code)
            && self.intraday_queue.len() < 32
        {
            self.intraday_pending.insert(code.into());
            self.intraday_queue.push_back(code.into());
        }
    }
    pub fn intraday_view(&self, code: &str) -> Value {
        let date = intraday::day(now());
        let external = self
            .saved
            .intraday_cache
            .get(code)
            .filter(|s| s.date == date);
        let series = external.or_else(|| {
            self.saved
                .local_intraday
                .get(code)
                .filter(|s| s.date == date)
        });
        json!({"series":series,"pending":self.intraday_pending.contains(code),"error":self.intraday_errors.get(code).map(|(e,_)|e),"demo":self.demo})
    }
    fn record_intraday(&mut self, q: &Quote, at: i64) {
        if !self.demo
            && (!intraday::session(q.source_at)
                || q.date != intraday::day(at)
                || at - q.source_at > 60_000
                || q.source_at > at + 5000)
        {
            return;
        }
        let Some(price) = q.price else { return };
        let series = self
            .saved
            .local_intraday
            .entry(q.symbol.clone())
            .or_insert_with(|| intraday::Series {
                symbol: q.symbol.clone(),
                date: q.date.clone(),
                source: "本機 MIS 觀測（局部）".into(),
                fetched_at: at,
                partial: true,
                points: Vec::new(),
            });
        if series.date != q.date {
            series.date = q.date.clone();
            series.points.clear();
        }
        let point = intraday::Point {
            at: q.source_at,
            price: Some(price),
        };
        match series.points.last_mut() {
            Some(last) if last.at > point.at => return,
            Some(last) if last.at / 60000 == point.at / 60000 => *last = point,
            _ => series.points.push(point),
        }
        series.fetched_at = at;
        series.points.truncate(300);
    }
    pub fn queue_daily(&mut self, code: &str, month: &str) {
        let key = format!("{code}:{month}");
        let at = now();
        let ttl = if month == daily::months(at)[0] {
            3_600_000
        } else {
            86_400_000
        };
        let fresh = self.saved.daily_cache.get(&key).is_some_and(|s| {
            at - s.fetched_at < ttl
                && !(local(at).hour() >= 15
                    && local(s.fetched_at).date_naive() == local(at).date_naive()
                    && local(s.fetched_at).hour() < 15)
        });
        let cooldown = self
            .daily_errors
            .get(&key)
            .is_some_and(|(_, t)| at - t < 300_000);
        if !fresh && !cooldown && !self.daily_pending.contains(&key) && self.daily_queue.len() < 64
        {
            self.daily_pending.insert(key);
            self.daily_queue.push_back((code.into(), month.into()));
        }
    }
    pub fn daily_view(&self, code: &str, months: &[String]) -> Value {
        let mut days = Vec::new();
        let mut sources = Vec::new();
        let mut fetched_at = 0;
        let mut pending = false;
        let mut errors = Vec::new();
        for m in months {
            let key = format!("{code}:{m}");
            pending |= self.daily_pending.contains(&key);
            if let Some(s) = self.saved.daily_cache.get(&key) {
                days.extend(s.days.clone());
                fetched_at = fetched_at.max(s.fetched_at);
                if !sources.contains(&s.source) {
                    sources.push(s.source.clone())
                }
            }
            if let Some((e, _)) = self.daily_errors.get(&key) {
                errors.push(e.clone())
            }
        }
        days.sort_by(|a, b| a.date.cmp(&b.date));
        days.dedup_by(|a, b| a.date == b.date);
        // Cached current-day data must not leak into a new day's pre-close view after clock changes.
        let today = local(now());
        days.retain(|d| {
            d.date < today.format("%Y-%m-%d").to_string()
                || d.date == today.format("%Y-%m-%d").to_string() && today.hour() >= 15
                || self.demo
        });
        if months.len() > 1 && days.len() > 20 {
            days.drain(..days.len() - 20);
        }
        json!({"symbol":code,"days":days,"sources":sources,"fetchedAt":fetched_at,"pending":pending,"error":errors.first(),"demo":self.demo})
    }
    pub fn execute(&mut self, tool: &str, args: Value) -> Result<Value, String> {
        if tool == "get_status" {
            if self.saved.settings.row_display == "trend" && (trading(now()) || self.demo) {
                for c in self.saved.watchlist.clone() {
                    self.queue_intraday(&c)
                }
            }
            if !trading(now()) || self.demo {
                let months = daily::months(now());
                for c in self.saved.watchlist.clone() {
                    for m in &months {
                        self.queue_daily(&c, m)
                    }
                }
            }
            return Ok(self.snapshot());
        }
        if tool == "get_intraday_history" {
            let code = args["symbol"]
                .as_str()
                .and_then(symbol)
                .ok_or("需要台股代號")?;
            if !self.saved.watchlist.contains(&code) {
                return Err("請先將標的加入自選，再讀取分鐘線".into());
            }
            self.queue_intraday(&code);
            return Ok(self.intraday_view(&code));
        }
        if tool == "get_daily_history" {
            let code = args["symbol"]
                .as_str()
                .and_then(symbol)
                .ok_or("需要台股代號")?;
            let month = args["month"].as_str().ok_or("需要 YYYY-MM 月份")?;
            if !daily::valid_month(month) {
                return Err("月份需介於 2000-01 與本月之間".into());
            }
            self.queue_daily(&code, month);
            return Ok(self.daily_view(&code, &[month.into()]));
        }
        if tool == "list_events" {
            return Ok(json!(self.saved.events));
        }
        if tool == "list_rules" {
            return Ok(json!(self.saved.rules));
        }
        let mut next = self.clone();
        match tool {
            "set_watchlist" => {
                let raw = args["symbols"].as_array().ok_or("需要 symbols 陣列")?;
                if raw.len() > 30 {
                    return Err("首版最多監看 30 檔".into());
                }
                let mut codes = Vec::new();
                for s in raw {
                    let c = s.as_str().and_then(symbol).ok_or("請使用有效台股代號")?;
                    if !codes.contains(&c) {
                        codes.push(c)
                    }
                }
                if next
                    .saved
                    .rules
                    .iter()
                    .any(|r| r.enabled && !codes.contains(&r.symbol))
                {
                    return Err("請先停用或刪除該股票的規則，再移除自選".into());
                }
                next.saved.watchlist = codes;
                let watched = next.saved.watchlist.clone();
                next.saved.intraday_cache.retain(|c, _| watched.contains(c));
                next.saved.local_intraday.retain(|c, _| watched.contains(c));
                next.last_fetch = None;
                let watched = next.saved.watchlist.clone();
                next.quotes.retain(|c, _| watched.contains(c));
                next.next_poll = 0;
            }
            "set_settings" => {
                if let Some(v) = args.get("alwaysOnTop") {
                    next.saved.settings.always_on_top = v.as_bool().ok_or("置頂格式錯誤")?;
                }
                if let Some(v) = args.get("rowDisplay") {
                    let v = v.as_str().ok_or("列顯示格式錯誤")?;
                    if !["numbers", "trend", "minimal"].contains(&v) {
                        return Err("列顯示需為 numbers、trend 或 minimal".into());
                    }
                    next.saved.settings.row_display = v.into();
                }
                if let Some(v) = args.get("showCodes") {
                    next.saved.settings.show_codes = v.as_bool().ok_or("代號顯示需為布林值")?;
                }
                if let Some(a) = args.get("appearance") {
                    let a = a.as_str().ok_or("外觀格式錯誤")?;
                    if !["small", "gray", "terminal", "txt"].contains(&a) {
                        return Err("未知外觀".into());
                    };
                    next.saved.settings.appearance = a.into();
                }
                if let Some(p) = args.get("paused") {
                    next.saved.settings.paused = p.as_bool().ok_or("暫停格式錯誤")?;
                    next.reset_baselines();
                }
                if let Some(s) = args.get("refreshSeconds") {
                    let s = s.as_u64().ok_or("更新秒數錯誤")?;
                    if !(5..=300).contains(&s) {
                        return Err("更新間隔為 5–300 秒".into());
                    };
                    next.saved.settings.refresh_seconds = s;
                }
                next.next_poll = 0;
            }
            "upsert_rule" => {
                let code = args["symbol"]
                    .as_str()
                    .and_then(symbol)
                    .ok_or("請指定股票代號")?;
                let metric = args["metric"].as_str().ok_or("需要 metric")?;
                let dir = args["direction"].as_str().ok_or("需要 direction")?;
                let threshold = args["threshold"]
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .ok_or("門檻必須是有限數字")?;
                let channel = args["channel"].as_str().unwrap_or("strip");
                let repeat = args["repeat"].as_str().unwrap_or("daily");
                if !["price", "changePercent"].contains(&metric)
                    || !["above", "below"].contains(&dir)
                    || !["off", "log", "strip", "card"].contains(&channel)
                    || !["once", "daily"].contains(&repeat)
                {
                    return Err("不支援的規則欄位".into());
                }
                if metric == "price" && threshold <= 0. {
                    return Err("價格門檻必須大於零".into());
                }
                if next.saved.rules.len() >= 100 && args.get("id").is_none() {
                    return Err("規則上限為 100".into());
                }
                let supplied = args
                    .get("id")
                    .map(|v| v.as_str().ok_or("規則 ID 格式錯誤"))
                    .transpose()?;
                if let Some(id) = supplied {
                    if !next.saved.rules.iter().any(|r| r.id == id) {
                        return Err("找不到規則".into());
                    }
                }
                if !next.saved.watchlist.contains(&code) {
                    if next.saved.watchlist.len() >= 30 {
                        return Err("自選清單已滿".into());
                    };
                    next.saved.watchlist.push(code.clone());
                    next.last_fetch = None;
                }
                let id = supplied
                    .map(str::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let enabled = args
                    .get("enabled")
                    .map(|v| v.as_bool().ok_or("enabled 格式錯誤"))
                    .transpose()?
                    .unwrap_or(true);
                // Editing preserves today's fire latch: no duplicate alert through edits/restarts.
                let fired = next
                    .saved
                    .rules
                    .iter()
                    .find(|r| r.id == id)
                    .and_then(|r| r.fired_day.clone());
                let rule = Rule {
                    id: id.clone(),
                    symbol: code,
                    metric: metric.into(),
                    direction: dir.into(),
                    threshold,
                    channel: channel.into(),
                    repeat: repeat.into(),
                    enabled,
                    last_value: None,
                    last_at: None,
                    last_day: None,
                    fired_day: fired,
                };
                next.saved.rules.retain(|r| r.id != id);
                next.saved.rules.push(rule);
                next.next_poll = 0;
            }
            "delete_rule" => {
                let id = args["id"].as_str().ok_or("需要規則 ID")?;
                if !next.saved.rules.iter().any(|r| r.id == id) {
                    return Err("找不到規則".into());
                };
                next.saved.rules.retain(|r| r.id != id);
            }
            _ => return Err("未知操作".into()),
        }
        next.revision += 1;
        next.config_revision += 1;
        next.persist()?;
        *self = next;
        Ok(self.snapshot())
    }
    pub fn reset_baselines(&mut self) {
        for r in &mut self.saved.rules {
            r.last_value = None;
            r.last_at = None;
            r.last_day = None;
        }
    }
    pub fn ingest(&mut self, quotes: Vec<Quote>, at: i64) -> Result<Vec<Event>, String> {
        let mut next = self.clone();
        let mut emitted = Vec::new();
        for q in quotes {
            if !next.saved.watchlist.contains(&q.symbol) {
                continue;
            }
            if next
                .quotes
                .get(&q.symbol)
                .is_some_and(|old| old.source_at > q.source_at)
            {
                continue;
            }
            next.record_intraday(&q, at);
            for rule in next
                .saved
                .rules
                .iter_mut()
                .filter(|r| r.symbol == q.symbol && r.enabled)
            {
                if let Some(e) = evaluate(rule, &q, at, self.demo) {
                    next.saved.events.insert(0, e.clone());
                    emitted.push(e)
                }
            }
            next.quotes.insert(q.symbol.clone(), q);
        }
        next.saved.events.truncate(500);
        next.last_fetch = Some(at);
        next.error = None;
        next.failures = 0;
        if !emitted.is_empty() || at - next.last_intraday_save >= 60_000 {
            next.revision += 1;
            next.last_intraday_save = at;
            next.persist()?;
        }
        *self = next;
        Ok(emitted)
    }
}

pub fn evaluate(r: &mut Rule, q: &Quote, at: i64, demo: bool) -> Option<Event> {
    let fresh = q.source_at <= at + 5000
        && at - q.source_at <= 60_000
        && q.date == local(at).format("%Y%m%d").to_string();
    if !fresh || (!demo && !trading(at)) || r.channel == "off" {
        r.last_value = None;
        r.last_at = None;
        return None;
    }
    let Some(value) = (if r.metric == "price" {
        q.price
    } else {
        q.change_percent
    }) else {
        r.last_value = None;
        r.last_at = None;
        return None;
    };
    if r.last_at.is_some_and(|t| q.source_at <= t) {
        return None;
    }
    let continuous = r.last_day.as_deref() == Some(&q.date)
        && r.last_at.is_some_and(|t| q.source_at - t <= 60_000);
    let crossed = continuous
        && r.last_value.is_some_and(|v| {
            if r.direction == "above" {
                v < r.threshold && value >= r.threshold
            } else {
                v > r.threshold && value <= r.threshold
            }
        });
    r.last_value = Some(value);
    r.last_at = Some(q.source_at);
    r.last_day = Some(q.date.clone());
    if !crossed
        || r.fired_day.as_deref() == Some(&q.date)
        || r.repeat == "once" && r.fired_day.is_some()
    {
        return None;
    }
    r.fired_day = Some(q.date.clone());
    if r.repeat == "once" {
        r.enabled = false;
    }
    let metric = if r.metric == "price" {
        "成交價"
    } else {
        "漲跌幅"
    };
    let direction = if r.direction == "above" {
        "升至"
    } else {
        "降至"
    };
    let unit = if r.metric == "price" { "元" } else { "%" };
    Some(Event {
        id: uuid::Uuid::new_v4().to_string(),
        rule_id: r.id.clone(),
        symbol: q.symbol.clone(),
        text: format!(
            "{} {} · {}{} {:.2}{}（門檻 {:.2}）",
            q.symbol, q.name, metric, direction, value, unit, r.threshold
        ),
        source_at: q.source_at,
        detected_at: at,
        channel: r.channel.clone(),
        value,
        threshold: r.threshold,
    })
}

pub fn demo_quotes(codes: &[String], tick: u64) -> Vec<Quote> {
    let at = now();
    codes
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let base = if c == "t00" {
                24000.
            } else if c == "0050" {
                60.
            } else {
                1000. + i as f64 * 10.
            };
            let p = base + (tick as f64 / 2.).sin() * base * 0.02;
            Quote {
                symbol: c.clone(),
                name: match c.as_str() {
                    "2330" => "台積電",
                    "0050" => "元大台灣50",
                    "t00" => "加權指數",
                    _ => "模擬標的",
                }
                .into(),
                price: Some((p * 100.).round() / 100.),
                previous: Some(base),
                bid: Some(p - 0.5),
                ask: Some(p + 0.5),
                change_percent: Some((p / base - 1.) * 100.),
                source_at: at,
                received_at: at,
                date: local(at).format("%Y%m%d").to_string(),
                source: "合成示範資料".into(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn q(p: Option<f64>, t: i64) -> Quote {
        Quote {
            symbol: "2330".into(),
            name: "台積電".into(),
            price: p,
            bid: Some(9999.),
            ask: None,
            previous: Some(100.),
            change_percent: p.map(|v| v - 100.),
            source_at: t,
            received_at: t,
            date: local(t).format("%Y%m%d").to_string(),
            source: "test".into(),
        }
    }
    fn rule() -> Rule {
        Rule {
            id: "r1".into(),
            symbol: "2330".into(),
            metric: "price".into(),
            direction: "above".into(),
            threshold: 105.,
            channel: "strip".into(),
            repeat: "daily".into(),
            enabled: true,
            last_value: None,
            last_at: None,
            last_day: None,
            fired_day: None,
        }
    }
    fn ts() -> i64 {
        FixedOffset::east_opt(28800)
            .unwrap()
            .with_ymd_and_hms(2026, 11, 6, 10, 0, 0)
            .unwrap()
            .timestamp_millis()
    }
    #[test]
    fn crossing_and_restart_latch() {
        let t = ts();
        let mut r = rule();
        assert!(evaluate(&mut r, &q(Some(106.), t), t, false).is_none());
        assert!(evaluate(&mut r, &q(Some(100.), t + 5000), t + 5000, false).is_none());
        assert!(evaluate(&mut r, &q(Some(106.), t + 10000), t + 10000, false).is_some());
        let saved = serde_json::to_string(&r).unwrap();
        let mut restored: Rule = serde_json::from_str(&saved).unwrap();
        evaluate(&mut restored, &q(Some(100.), t + 15000), t + 15000, false);
        assert!(evaluate(&mut restored, &q(Some(106.), t + 20000), t + 20000, false).is_none());
    }
    #[test]
    fn stale_missing_and_out_of_order_never_cross() {
        let t = ts();
        let mut r = rule();
        evaluate(&mut r, &q(Some(100.), t), t, false);
        assert!(evaluate(&mut r, &q(Some(106.), t - 5000), t, false).is_none());
        assert!(evaluate(&mut r, &q(Some(106.), t + 5000), t + 120000, false).is_none());
        assert!(evaluate(&mut r, &q(Some(106.), t + 125000), t + 125000, false).is_none());
        evaluate(&mut r, &q(None, t + 130000), t + 130000, false);
        assert!(evaluate(&mut r, &q(Some(106.), t + 135000), t + 135000, false).is_none());
    }
    #[test]
    fn day_reset_and_off_session() {
        let t = ts();
        let mut r = rule();
        evaluate(&mut r, &q(Some(100.), t), t, false);
        let tomorrow = t + 86400000;
        assert!(evaluate(&mut r, &q(Some(106.), tomorrow), tomorrow, false).is_none());
        let close = t + 4 * 3600000;
        assert!(evaluate(&mut r, &q(Some(110.), close), close, false).is_none());
    }
    #[test]
    fn missing_trade_not_book() {
        let t = ts();
        let v = json!({"rtcode":"0000","msgArray":[{"c":"2330","n":"台積電","d":"20261106","t":"10:00:00","z":"-","y":"100","b":"110_109_","a":"111_"}]});
        let parsed = parse_mis(&v, t).unwrap();
        assert_eq!(parsed[0].price, None);
        assert_eq!(parsed[0].bid, Some(110.));
        assert_eq!(parsed[0].change_percent, None);
    }
    #[test]
    fn symbols_and_sessions() {
        assert_eq!(symbol("0050.TW"), Some("0050".into()));
        assert!(symbol("2330&x=y").is_none());
        assert_eq!(symbol("大盤"), Some("t00".into()));
        assert!(trading(ts()));
        assert!(!trading(ts() + 86400000));
    }
    #[test]
    fn persistence_validation_and_pause_are_shared() {
        let dir = std::env::temp_dir().join(format!("smallstocks-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut c = Core::load(dir.join("state.json"), true).unwrap();
        let bad = c.execute(
            "upsert_rule",
            json!({"symbol":"2330","metric":"volume","direction":"above","threshold":5}),
        );
        assert!(bad.is_err());
        assert!(c.saved.rules.is_empty());
        c.execute("upsert_rule",json!({"symbol":"2330","metric":"price","direction":"above","threshold":105,"repeat":"daily","channel":"strip"})).unwrap();
        assert!(c
            .execute("set_watchlist", json!({"symbols":["0050"]}))
            .is_err());
        let t = ts();
        c.ingest(vec![q(Some(100.), t)], t).unwrap();
        let events = c.ingest(vec![q(Some(106.), t + 5000)], t + 5000).unwrap();
        assert_eq!(events.len(), 1);
        let mut restored = Core::load(dir.join("state.json"), true).unwrap();
        assert_eq!(restored.saved.events.len(), 1);
        assert_eq!(
            restored.saved.rules[0].fired_day.as_deref(),
            Some("20261106")
        );
        assert!(restored.saved.rules[0].last_value.is_none());
        restored
            .execute("set_settings", json!({"paused":true}))
            .unwrap();
        assert!(restored.saved.settings.paused);
        assert!(restored
            .execute("set_settings", json!({"refreshSeconds":1}))
            .is_err());
        std::fs::remove_file(dir.join("state.json")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn failed_save_does_not_change_live_rules() {
        let path = std::env::temp_dir()
            .join(format!("missing-{}", uuid::Uuid::new_v4()))
            .join("state.json");
        let mut c = Core::load(path, true).unwrap();
        assert!(c
            .execute("set_watchlist", json!({"symbols":["6488"]}))
            .is_err());
        assert_eq!(c.saved.watchlist, vec!["t00", "2330", "0050"]);
    }
    #[test]
    fn topmost_defaults_migrate_and_changes_persist() {
        let old: Settings = serde_json::from_value(json!({
            "appearance":"small", "paused":false, "refreshSeconds":15
        }))
        .unwrap();
        assert!(old.always_on_top);
        let dir =
            std::env::temp_dir().join(format!("smallstocks-topmost-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        let mut core = Core::load(path.clone(), true).unwrap();
        core.execute("set_settings", json!({"alwaysOnTop":false}))
            .unwrap();
        assert!(
            !Core::load(path.clone(), true)
                .unwrap()
                .saved
                .settings
                .always_on_top
        );
        assert!(core
            .execute("set_settings", json!({"alwaysOnTop":"false"}))
            .is_err());
        assert!(!core.saved.settings.always_on_top);
        core.execute("set_settings", json!({"appearance":"terminal"}))
            .unwrap();
        assert!(!core.saved.settings.always_on_top);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn old_settings_keep_numbers_by_default() {
        let cfg: Settings =
            serde_json::from_value(json!({"appearance":"gray","paused":false,"refreshSeconds":15}))
                .unwrap();
        assert_eq!(cfg.row_display, "numbers");
        assert!(!cfg.show_codes);
        assert_eq!(cfg.appearance, "gray");
    }
    #[test]
    fn local_minutes_are_partial_and_ignore_missing_stale_future_trades() {
        let mut c = Core::load(
            std::env::temp_dir()
                .join(format!("line-test-{}", uuid::Uuid::new_v4()))
                .join("state.json"),
            false,
        )
        .unwrap();
        let t = ts();
        c.record_intraday(&q(None, t), t);
        assert!(c.saved.local_intraday.is_empty());
        c.record_intraday(&q(Some(100.), t), t);
        c.record_intraday(&q(Some(101.), t + 5000), t + 5000);
        assert_eq!(c.saved.local_intraday["2330"].points.len(), 1);
        assert_eq!(c.saved.local_intraday["2330"].points[0].price, Some(101.));
        c.record_intraday(&q(Some(102.), t + 60000), t + 60000);
        assert_eq!(c.saved.local_intraday["2330"].points.len(), 2);
        assert!(c.saved.local_intraday["2330"].partial);
        c.record_intraday(&q(Some(103.), t + 120000), t + 240000);
        c.record_intraday(&q(Some(103.), t + 600000), t);
        assert_eq!(c.saved.local_intraday["2330"].points.len(), 2);
        let monday = t + 3 * 86400000;
        c.record_intraday(&q(Some(110.), monday), monday);
        assert_eq!(c.saved.local_intraday["2330"].points.len(), 1);
    }
}
