use crate::core::{local, now, symbol};
use chrono::{Datelike, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub at: i64,
    pub price: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub symbol: String,
    pub date: String,
    pub source: String,
    pub fetched_at: i64,
    pub partial: bool,
    pub points: Vec<Point>,
}
pub fn day(at: i64) -> String {
    local(at).format("%Y%m%d").to_string()
}
pub fn session(at: i64) -> bool {
    let t = local(at);
    let m = t.hour() * 60 + t.minute();
    t.weekday().number_from_monday() <= 5 && (540..=810).contains(&m)
}
pub fn parse(v: &Value, code: &str, yahoo_code: &str, at: i64) -> Result<Series, String> {
    let r = &v["chart"]["result"][0];
    if r["meta"]["symbol"].as_str() != Some(yahoo_code)
        || r["meta"]["dataGranularity"].as_str() != Some("1m")
    {
        return Err("分鐘線標的或取樣格式不符".into());
    }
    let stamps = r["timestamp"].as_array().ok_or("分鐘線沒有時間")?;
    let prices = r["indicators"]["quote"][0]["close"]
        .as_array()
        .ok_or("分鐘線沒有價格")?;
    if stamps.len() != prices.len() {
        return Err("分鐘線時間與價格長度不符".into());
    }
    let date = day(at);
    let mut points = Vec::new();
    for (stamp, price) in stamps.iter().zip(prices) {
        let Some(t) = stamp.as_i64().and_then(|t| t.checked_mul(1000)) else {
            continue;
        };
        if t < 0 || t > at.saturating_add(5000) || day(t) != date || !session(t) {
            continue;
        }
        points.push(Point {
            at: t,
            price: price.as_f64().filter(|n| n.is_finite() && *n > 0.),
        });
    }
    points.sort_by_key(|p| p.at);
    points.dedup_by_key(|p| p.at);
    if points.iter().filter(|p| p.price.is_some()).count() < 2 {
        return Err("尚無今天的可用分鐘線".into());
    }
    let first = points.iter().find(|p| p.price.is_some()).unwrap();
    let t = local(first.at);
    Ok(Series {
        symbol: code.into(),
        date,
        source: "Yahoo Finance · 1 分鐘取樣".into(),
        fetched_at: at,
        partial: t.hour() * 60 + t.minute() > 541,
        points,
    })
}
pub fn fetch(client: &reqwest::blocking::Client, code: &str, otc: bool) -> Result<Series, String> {
    if symbol(code).is_none() {
        return Err("無效的台股代號".into());
    }
    if code == "o00" {
        return Err("櫃買指數尚無可補齊的分鐘線，僅記錄本機觀測".into());
    }
    let codes = if code == "t00" {
        vec!["^TWII".into()]
    } else if otc {
        vec![format!("{code}.TWO"), format!("{code}.TW")]
    } else {
        vec![format!("{code}.TW"), format!("{code}.TWO")]
    };
    for (i, c) in codes.iter().enumerate() {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_secs(2))
        }
        let mut url =
            reqwest::Url::parse("https://query1.finance.yahoo.com/v8/finance/chart/").unwrap();
        url.path_segments_mut().unwrap().pop_if_empty().push(c);
        url.query_pairs_mut()
            .append_pair("range", "1d")
            .append_pair("interval", "1m")
            .append_pair("_", &now().to_string());
        let response = client
            .get(url)
            .send()
            .map_err(|e| format!("分鐘線連線失敗：{e}"))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            continue;
        }
        let v: Value = response
            .error_for_status()
            .and_then(|r| r.json())
            .map_err(|e| format!("分鐘線來源錯誤：{e}"))?;
        return parse(&v, code, c, now());
    }
    Err("該標的尚無可用分鐘線".into())
}
pub fn demo_series(code: &str) -> Series {
    let at = now();
    let start = local(at)
        .date_naive()
        .and_hms_opt(9, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis()
        - 28800000;
    let n = ((at - start) / 60000).clamp(2, 270);
    let base = if code == "t00" {
        24000.
    } else if code == "0050" {
        60.
    } else {
        1010.
    };
    Series {
        symbol: code.into(),
        date: day(at),
        source: "合成示範分鐘線".into(),
        fetched_at: at,
        partial: false,
        points: (0..=n)
            .map(|i| Point {
                at: start + i * 60000,
                price: Some(base * (1. + (i as f64 / 22.).sin() * 0.008 + i as f64 * 0.00002)),
            })
            .collect(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, TimeZone};
    use serde_json::json;
    #[test]
    fn gaps_dates_and_symbol_are_not_fabricated() {
        let t = FixedOffset::east_opt(28800)
            .unwrap()
            .with_ymd_and_hms(2026, 11, 6, 10, 0, 0)
            .unwrap()
            .timestamp_millis();
        let start = t - 3600000;
        let v = json!({"chart":{"result":[{"meta":{"symbol":"2330.TW","dataGranularity":"1m"},"timestamp":[start/1000,(start+60000)/1000,(start+120000)/1000],"indicators":{"quote":[{"close":[100,null,101]}]}}]}});
        let s = parse(&v, "2330", "2330.TW", t).unwrap();
        assert!(!s.partial);
        assert_eq!(s.points[1].price, None);
        assert!(parse(&v, "2330", "2330.TWO", t).is_err());
        assert!(parse(&v, "2330", "2330.TW", t + 86400000).is_err());
    }
}
