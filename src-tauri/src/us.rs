//! US quotes from Yahoo Finance's public spark endpoint: no key, no login, one request for every
//! US symbol on the watchlist. It is an unofficial endpoint (Yahoo offers no official API), so the
//! app labels it as such; it may change or stop without notice.
//!
//! The response also carries the exchange's current trading period (start and end of the regular
//! session, with the UTC offset), so New York daylight saving and US holidays come from the source
//! instead of a calendar kept here.
use crate::core::Quote;
use crate::intraday::{Point, Series};
use serde_json::Value;

pub const SOURCE: &str = "Yahoo Finance（非官方）";

/// The regular session the source reported: start and end (ms) and the exchange's UTC offset (s).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Session {
    pub start: i64,
    pub end: i64,
    pub offset: i32,
}

pub struct Spark {
    pub quotes: Vec<Quote>,
    pub session: Option<Session>,
    /// The latest session's five-minute closes per symbol, for the single-row trend.
    pub series: Vec<Series>,
}

pub fn spark_url(codes: &[String]) -> String {
    let mut url = reqwest::Url::parse("https://query1.finance.yahoo.com/v7/finance/spark").unwrap();
    url.query_pairs_mut()
        .append_pair("symbols", &codes.join(","))
        .append_pair("range", "1d")
        .append_pair("interval", "5m");
    url.into()
}

pub fn search_url(query: &str) -> String {
    let mut url =
        reqwest::Url::parse("https://query2.finance.yahoo.com/v1/finance/search").unwrap();
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("quotesCount", "8")
        .append_pair("newsCount", "0");
    url.into()
}

/// US listings in a search reply: stocks and ETFs on NYSE, Nasdaq and the other US venues.
pub fn parse_search(v: &Value) -> Vec<(String, String)> {
    const US: [&str; 9] = [
        "NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS", "NYS",
    ];
    v["quotes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|q| {
            matches!(q["quoteType"].as_str(), Some("EQUITY") | Some("ETF"))
                && q["exchange"].as_str().is_some_and(|e| US.contains(&e))
        })
        .filter_map(|q| {
            let code = crate::core::symbol(q["symbol"].as_str()?)?;
            crate::core::is_us(&code).then(|| {
                let name = q["shortname"]
                    .as_str()
                    .or(q["longname"].as_str())
                    .unwrap_or(&code)
                    .trim()
                    .to_string();
                (code, name)
            })
        })
        .collect()
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64().filter(|n| n.is_finite() && *n > 0.)
}

fn exchange_day(ms: i64, offset: i32) -> String {
    use chrono::TimeZone;
    chrono::FixedOffset::east_opt(offset)
        .unwrap_or_else(|| chrono::FixedOffset::west_opt(5 * 3600).unwrap())
        .timestamp_millis_opt(ms)
        .single()
        .map(|t| t.format("%Y%m%d").to_string())
        .unwrap_or_default()
}

pub fn parse_spark(v: &Value, received: i64) -> Result<Spark, String> {
    let results = v["spark"]["result"].as_array().ok_or("美股報價格式不符")?;
    let mut quotes = Vec::new();
    let mut series = Vec::new();
    let mut session = None;
    for r in results {
        let Some(code) = r["symbol"]
            .as_str()
            .and_then(crate::core::symbol)
            .filter(|c| crate::core::is_us(c))
        else {
            continue;
        };
        let resp = &r["response"][0];
        let meta = &resp["meta"];
        let regular = &meta["currentTradingPeriod"]["regular"];
        let offset = regular["gmtoffset"]
            .as_i64()
            .or(meta["gmtoffset"].as_i64())
            .unwrap_or(-5 * 3600) as i32;
        if session.is_none() {
            if let (Some(s), Some(e)) = (regular["start"].as_i64(), regular["end"].as_i64()) {
                session = Some(Session {
                    start: s * 1000,
                    end: e * 1000,
                    offset,
                });
            }
        }
        let (Some(price), Some(at)) = (
            num(&meta["regularMarketPrice"]),
            meta["regularMarketTime"].as_i64().map(|t| t * 1000),
        ) else {
            continue;
        };
        let previous = num(&meta["previousClose"]).or(num(&meta["chartPreviousClose"]));
        let name = meta["shortName"]
            .as_str()
            .or(meta["longName"].as_str())
            .unwrap_or(&code)
            .trim()
            .to_string();
        quotes.push(Quote {
            symbol: code.clone(),
            name,
            price: Some(price),
            bid: None,
            ask: None,
            previous,
            change_percent: previous.map(|p| (price / p - 1.) * 100.),
            mid: None,
            mid_change_percent: None,
            trade_at: Some(at),
            day_high: num(&meta["regularMarketDayHigh"]),
            day_low: num(&meta["regularMarketDayLow"]),
            source_at: at,
            received_at: received,
            date: exchange_day(at, offset),
            source: SOURCE.into(),
            market: "us".into(),
            utc_offset: offset,
        });
        let stamps = resp["timestamp"].as_array();
        let closes = resp["indicators"]["quote"][0]["close"].as_array();
        if let (Some(stamps), Some(closes)) = (stamps, closes) {
            let points: Vec<Point> = stamps
                .iter()
                .zip(closes)
                .filter_map(|(t, p)| {
                    Some(Point {
                        at: t.as_i64()?.checked_mul(1000)?,
                        price: num(p),
                    })
                })
                .filter(|p| p.at <= received + 5000)
                .collect();
            if points.iter().filter(|p| p.price.is_some()).count() >= 2 {
                series.push(Series {
                    symbol: code.clone(),
                    date: exchange_day(at, offset),
                    source: "Yahoo Finance · 5 分鐘取樣（非官方）".into(),
                    fetched_at: received,
                    partial: false,
                    points,
                });
            }
        }
    }
    Ok(Spark {
        quotes,
        session,
        series,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn meta(symbol: &str, price: f64, at_s: i64) -> Value {
        json!({"symbol":symbol,"currency":"USD","regularMarketPrice":price,"regularMarketTime":at_s,
            "previousClose":100.0,"chartPreviousClose":99.0,"regularMarketDayHigh":price+1.,
            "regularMarketDayLow":price-1.,"shortName":"Apple Inc.","gmtoffset":-18000,
            "currentTradingPeriod":{"regular":{"start":1794839400,"end":1794862800,"gmtoffset":-18000}}})
    }

    #[test]
    fn spark_gives_quotes_session_and_trend() {
        // 2026-11-13 16:00 New York = 2026-11-14 05:00 Taipei: the US date stays the 13th.
        let at = 1794603600;
        let v = json!({"spark":{"result":[
            {"symbol":"AAPL","response":[{"meta":meta("AAPL",102.,at),
                "timestamp":[at-600,at-300,at],"indicators":{"quote":[{"close":[101.,null,102.]}]}}]},
            {"symbol":"BRK-B","response":[{"meta":meta("BRK-B",590.,at),"timestamp":[],"indicators":{"quote":[{"close":[]}]}}]},
            {"symbol":"2330","response":[{"meta":meta("2330",1.,at)}]}
        ]}});
        let s = parse_spark(&v, at * 1000 + 1000).unwrap();
        let aapl = &s.quotes[0];
        assert_eq!(aapl.symbol, "AAPL");
        assert_eq!(aapl.market, "us");
        assert_eq!(aapl.date, "20261113");
        assert_eq!(aapl.source_at, at * 1000);
        assert!(
            (aapl.change_percent.unwrap() - 2.).abs() < 1e-9,
            "from previousClose"
        );
        assert!(
            aapl.mid.is_none() && aapl.bid.is_none(),
            "no book from this source"
        );
        assert_eq!(s.quotes[1].symbol, "BRK-B");
        assert_eq!(
            s.quotes.len(),
            2,
            "a Taiwan code in a US reply is not a US quote"
        );
        assert_eq!(
            s.session,
            Some(Session {
                start: 1794839400000,
                end: 1794862800000,
                offset: -18000
            })
        );
        assert_eq!(s.series.len(), 1, "two prices needed for a line");
        assert_eq!(s.series[0].points.len(), 3);
    }

    #[test]
    fn search_keeps_us_stocks_and_etfs_only() {
        let v = json!({"quotes":[
            {"symbol":"AAPL","quoteType":"EQUITY","exchange":"NMS","shortname":"Apple Inc."},
            {"symbol":"SAAPL=F","quoteType":"FUTURE","exchange":"CME","shortname":"Apple futures"},
            {"symbol":"APC.F","quoteType":"EQUITY","exchange":"FRA","shortname":"Apple Inc."},
            {"symbol":"QQQ","quoteType":"ETF","exchange":"NGM","shortname":"Invesco QQQ"},
            {"symbol":"BRK-B","quoteType":"EQUITY","exchange":"NYQ","shortname":"Berkshire"}
        ]});
        let got = parse_search(&v);
        let codes: Vec<&str> = got.iter().map(|(c, _)| c.as_str()).collect();
        assert_eq!(codes, ["AAPL", "QQQ", "BRK-B"]);
    }
}
