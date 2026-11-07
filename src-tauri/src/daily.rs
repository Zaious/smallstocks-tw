use crate::core::{local, now, symbol};
use chrono::{Datelike, NaiveDate, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub change: Option<f64>,
    pub change_percent: Option<f64>,
    pub volume: Option<f64>,
    pub volume_unit: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub symbol: String,
    pub month: String,
    pub source: String,
    pub fetched_at: i64,
    pub days: Vec<Day>,
}
pub fn months(at: i64) -> [String; 2] {
    let t = local(at);
    let prev = t.date_naive().with_day(1).unwrap().pred_opt().unwrap();
    [
        t.format("%Y-%m").to_string(),
        prev.format("%Y-%m").to_string(),
    ]
}
pub fn valid_month(m: &str) -> bool {
    m.len() == 7
        && NaiveDate::parse_from_str(&format!("{m}-01"), "%Y-%m-%d").is_ok()
        && m >= "2000-01"
        && m <= months(now())[0].as_str()
}
pub fn demo_series(code: &str, month: &str) -> Series {
    let first = NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d").unwrap();
    let at = local(now());
    let mut days = Vec::new();
    for i in 0..31 {
        let d = first + chrono::Duration::days(i);
        if d.month() != first.month() || d > at.date_naive() || d.weekday().number_from_monday() > 5
        {
            continue;
        }
        let base = if code == "t00" {
            24000.
        } else if code == "0050" {
            60.
        } else {
            1010.
        };
        let close = (base * (1. + (i as f64 / 4.).sin() * 0.025) * 100.).round() / 100.;
        let change = (base * 0.002 * 100.).round() / 100.;
        days.push(Day {
            date: d.format("%Y-%m-%d").to_string(),
            open: close - change,
            high: close + base * 0.005,
            low: close - base * 0.006,
            close,
            change: Some(change),
            change_percent: Some(change / (close - change) * 100.),
            volume: Some(1234000. + i as f64 * 1000.),
            volume_unit: "股".into(),
        });
    }
    Series {
        symbol: code.into(),
        month: month.into(),
        source: "合成示範資料".into(),
        fetched_at: now(),
        days,
    }
}
fn number(v: &Value) -> Option<f64> {
    let s = v.as_str()?;
    let v = s.replace(',', "").replace('＋', "+").replace('－', "-");
    v.parse::<f64>().ok().filter(|n| n.is_finite())
}
fn date(s: &str) -> Option<NaiveDate> {
    let p: Vec<_> = s
        .split('/')
        .map(|p| p.trim().parse::<i32>())
        .collect::<Result<_, _>>()
        .ok()?;
    if p.len() != 3 {
        return None;
    }
    NaiveDate::from_ymd_opt(
        if p[0] < 1911 { p[0] + 1911 } else { p[0] },
        p[1].try_into().ok()?,
        p[2].try_into().ok()?,
    )
}
/// Parse fields by name, never guess volume units or silently accept a changed layout.
pub fn parse(v: &Value, code: &str, month: &str, source: &str, at: i64) -> Result<Series, String> {
    let table = if v.get("tables").is_some() {
        v["tables"]
            .as_array()
            .and_then(|t| t.first())
            .ok_or("日行情沒有資料表")?
    } else {
        v
    };
    let fields: Vec<String> = table["fields"]
        .as_array()
        .ok_or("日行情欄位不存在")?
        .iter()
        .map(|v| v.as_str().unwrap_or("").split_whitespace().collect())
        .collect();
    let field = |names: &[&str]| fields.iter().position(|f| names.contains(&f.as_str()));
    let di = field(&["日期"]).ok_or("日行情缺日期")?;
    let oi = field(&["開盤價", "開盤", "開盤指數", "開市"]).ok_or("日行情缺開盤")?;
    let hi = field(&["最高價", "最高", "最高指數"]).ok_or("日行情缺最高")?;
    let li = field(&["最低價", "最低", "最低指數"]).ok_or("日行情缺最低")?;
    let ci = field(&["收盤價", "收盤", "收盤指數", "收市"]).ok_or("日行情缺收盤")?;
    let change_i = field(&["漲跌價差", "漲跌", "漲/跌"]);
    let vi = field(&["成交股數", "成交張數", "成交仟股"]);
    let volume_unit = vi
        .map(|i| match fields[i].as_str() {
            "成交張數" => "張",
            "成交仟股" => "仟股",
            _ => "股",
        })
        .unwrap_or("");
    let mut days = Vec::new();
    let today = local(at);
    let cutoff = today.hour() * 60 + today.minute() >= 900;
    for r in table["data"].as_array().ok_or("日行情資料不存在")? {
        let Some(d) = r[di].as_str().and_then(date) else {
            continue;
        };
        if d > today.date_naive()
            || d == today.date_naive() && !cutoff
            || d.format("%Y-%m").to_string() != month
        {
            continue;
        }
        let (Some(open), Some(high), Some(low), Some(close)) = (
            number(&r[oi]),
            number(&r[hi]),
            number(&r[li]),
            number(&r[ci]),
        ) else {
            continue;
        };
        if low <= 0. || low > high || close < low || close > high || open < low || open > high {
            continue;
        }
        let change = change_i.and_then(|i| number(&r[i]));
        let previous = change.map(|n| close - n).filter(|p| *p > 0.);
        days.push(Day {
            date: d.format("%Y-%m-%d").to_string(),
            open,
            high,
            low,
            close,
            change,
            change_percent: change.zip(previous).map(|(c, p)| c / p * 100.),
            volume: vi.and_then(|i| number(&r[i])),
            volume_unit: volume_unit.into(),
        });
    }
    days.sort_by(|a, b| a.date.cmp(&b.date));
    days.dedup_by(|a, b| a.date == b.date);
    if change_i.is_none() {
        for i in 1..days.len() {
            let previous = days[i - 1].close;
            let change = days[i].close - previous;
            days[i].change = Some(change);
            days[i].change_percent = Some(change / previous * 100.);
        }
    }
    Ok(Series {
        symbol: code.into(),
        month: month.into(),
        source: source.into(),
        fetched_at: at,
        days,
    })
}
pub fn fetch(
    client: &reqwest::blocking::Client,
    code: &str,
    month: &str,
) -> Result<Series, String> {
    if symbol(code).is_none() || !valid_month(month) {
        return Err("無效的標的或月份".into());
    }
    let read = |url: &str, params: &[(&str, String)]| -> Result<Value, String> {
        client
            .get(url)
            .query(params)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.json())
            .map_err(|e| format!("日行情來源無法讀取：{e}"))
    };
    let date = month.replace('-', "") + "01";
    if code == "o00" {
        let v = read(
            "https://www.tpex.org.tw/www/zh-tw/indexInfo/inx",
            &[
                ("date", month.replace('-', "/") + "/01"),
                ("response", "json".into()),
            ],
        )?;
        return parse(&v, code, month, "TPEx", now());
    }
    let url = if code == "t00" {
        "https://www.twse.com.tw/indicesReport/MI_5MINS_HIST"
    } else {
        "https://www.twse.com.tw/exchangeReport/STOCK_DAY"
    };
    let v = read(
        url,
        &[
            ("date", date),
            ("stockNo", code.into()),
            ("response", "json".into()),
        ],
    )?;
    if v["stat"].as_str() == Some("OK") {
        return parse(&v, code, month, "TWSE", now());
    }
    if code == "t00" {
        return Err("該月份尚無加權指數日資料".into());
    }
    std::thread::sleep(std::time::Duration::from_secs(2));
    let v = read(
        "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock",
        &[
            ("code", code.into()),
            ("date", month.replace('-', "/") + "/01"),
            ("response", "json".into()),
        ],
    )?;
    parse(&v, code, month, "TPEx", now())
}
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, TimeZone};
    use serde_json::json;
    fn at(h: u32) -> i64 {
        FixedOffset::east_opt(28800)
            .unwrap()
            .with_ymd_and_hms(2026, 11, 6, h, 0, 0)
            .unwrap()
            .timestamp_millis()
    }
    #[test]
    fn unit_and_signed_change() {
        let v = json!({"tables":[{"fields":["日 期","成交張數","開盤","最高","最低","收盤","漲跌"],"data":[["115/11/05","1,234","100","102","98","99","-1"]]}]});
        let s = parse(&v, "6488", "2026-11", "TPEx", at(17)).unwrap();
        assert_eq!(s.days[0].volume, Some(1234.));
        assert_eq!(s.days[0].volume_unit, "張");
        assert_eq!(s.days[0].change_percent, Some(-1.));
    }
    #[test]
    fn incomplete_today_and_future_excluded() {
        let v = json!({"fields":["日期","開盤指數","最高指數","最低指數","收盤指數"],"data":[["115/11/05","100","103","99","102"],["115/11/06","100","105","99","104"],["115/11/09","100","105","99","104"]]});
        assert_eq!(
            parse(&v, "t00", "2026-11", "TWSE", at(12))
                .unwrap()
                .days
                .len(),
            1
        );
        let s = parse(&v, "t00", "2026-11", "TWSE", at(17)).unwrap();
        assert_eq!(s.days.len(), 2);
        assert!(s.days[0].change.is_none());
        assert_eq!(s.days[1].change, Some(2.));
    }
    #[test]
    fn schema_and_month_checked() {
        assert!(parse(
            &json!({"fields":["日期"],"data":[]}),
            "2330",
            "2026-11",
            "TWSE",
            at(17)
        )
        .is_err());
        assert!(!valid_month("2026-13"));
        assert_eq!(months(at(17)), ["2026-11", "2026-10"]);
    }
}
