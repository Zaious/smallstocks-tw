//! Official TWSE market open/closed calendar. It only decides whether the session is open today;
//! it never feeds quotes or events. When a year is missing or cannot be read, the caller falls
//! back to the plain weekday 09:00-13:30 rule and says so.
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Closure {
    /// `YYYY-MM-DD`, Taipei date.
    pub date: String,
    pub name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub year: i32,
    pub fetched_at: i64,
    pub closures: Vec<Closure>,
}

/// The list also names the first and last trading days around a long break. Those are open days.
fn is_trading_day_marker(name: &str) -> bool {
    name.contains("開始交易") || name.contains("最後交易")
}

/// Reads fields by name. A different layout, another year's table or an empty year is an error,
/// never a guess: a wrong "closed" day would silence real alerts.
pub fn parse(v: &Value, year: i32, at: i64) -> Result<Calendar, String> {
    if !v["stat"]
        .as_str()
        .is_some_and(|s| s.eq_ignore_ascii_case("ok"))
    {
        return Err("休市日曆來源未回傳成功狀態".into());
    }
    if !v["title"]
        .as_str()
        .is_some_and(|t| t.contains(&format!("{} 年", year - 1911)))
    {
        return Err(format!("{year} 年的休市日曆尚未公布"));
    }
    let fields: Vec<String> = v["fields"]
        .as_array()
        .ok_or("休市日曆欄位不存在")?
        .iter()
        .map(|f| f.as_str().unwrap_or("").split_whitespace().collect())
        .collect();
    let date_index = fields
        .iter()
        .position(|f| f == "日期")
        .ok_or("休市日曆缺日期")?;
    let name_index = fields
        .iter()
        .position(|f| f == "名稱")
        .ok_or("休市日曆缺名稱")?;
    let mut closures: Vec<Closure> = Vec::new();
    for row in v["data"].as_array().ok_or("休市日曆資料不存在")? {
        let Some(date) = row[date_index]
            .as_str()
            .and_then(|d| NaiveDate::parse_from_str(d.trim(), "%Y-%m-%d").ok())
        else {
            continue;
        };
        let name = row[name_index].as_str().unwrap_or("").trim();
        if date.year() != year || is_trading_day_marker(name) {
            continue;
        }
        let date = date.format("%Y-%m-%d").to_string();
        if !closures.iter().any(|c| c.date == date) {
            closures.push(Closure {
                date,
                name: name.to_owned(),
            });
        }
    }
    if closures.is_empty() {
        return Err("休市日曆沒有任何休市日，視為格式異常".into());
    }
    closures.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(Calendar {
        year,
        fetched_at: at,
        closures,
    })
}

pub fn fetch(client: &reqwest::blocking::Client, year: i32) -> Result<Calendar, String> {
    let v: Value = client
        .get("https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule")
        .query(&[
            ("response", "json".to_string()),
            ("queryYear", year.to_string()),
        ])
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| format!("休市日曆來源無法讀取：{e}"))?;
    parse(&v, year, crate::core::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn table(title: &str, rows: Value) -> Value {
        json!({"stat":"ok","title":title,"fields":["日期","名稱","說明"],"data":rows})
    }
    #[test]
    fn closures_exclude_first_and_last_trading_day_markers() {
        let v = table(
            "115 年市場開休市日期",
            json!([
                ["2026-01-01", "中華民國開國紀念日", "依規定放假1日。"],
                ["2026-01-02", "國曆新年開始交易日", "國曆新年開始交易。"],
                [
                    "2026-02-11",
                    "農曆春節前最後交易日",
                    "農曆春節前最後交易。\r\n"
                ],
                ["2026-02-12", "市場無交易，僅辦理結算交割作業", ""],
                ["2026-02-12", "市場無交易，僅辦理結算交割作業", ""],
                ["2026-10-26", "臺灣光復暨金門古寧頭大捷紀念日", "補假"],
                ["2025-12-25", "行憲紀念日", "去年的列不算"]
            ]),
        );
        let c = parse(&v, 2026, 0).unwrap();
        let dates: Vec<&str> = c.closures.iter().map(|c| c.date.as_str()).collect();
        assert_eq!(dates, ["2026-01-01", "2026-02-12", "2026-10-26"]);
    }
    #[test]
    fn unpublished_wrong_or_empty_years_are_errors_not_guesses() {
        let rows = json!([["2026-01-01", "中華民國開國紀念日", ""]]);
        // The source answers a request for next year with this year's table.
        assert!(parse(&table("115 年市場開休市日期", rows.clone()), 2027, 0).is_err());
        assert!(parse(&table("115 年市場開休市日期", json!([])), 2026, 0).is_err());
        assert!(parse(&json!({"stat":"error"}), 2026, 0).is_err());
        let mut renamed = table("115 年市場開休市日期", rows);
        renamed["fields"] = json!(["Date", "Name"]);
        assert!(parse(&renamed, 2026, 0).is_err());
    }
}
