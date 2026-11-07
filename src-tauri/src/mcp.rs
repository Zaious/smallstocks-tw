use crate::core::Core;
use serde_json::{json, Value};
use std::{
    io::{BufRead, Write},
    path::Path,
    sync::{Arc, Mutex},
};

pub type Shared = Arc<Mutex<Core>>;
fn compact_charts(mut v: Value) -> Value {
    if let Some(charts) = v.get_mut("intraday").and_then(Value::as_object_mut) {
        for chart in charts.values_mut() {
            if let Some(s) = chart.get_mut("series").and_then(Value::as_object_mut) {
                if let Some(points) = s.remove("points").and_then(|v| v.as_array().cloned()) {
                    s.insert("pointCount".into(), json!(points.len()));
                    s.insert(
                        "lastAt".into(),
                        points
                            .last()
                            .map(|p| p["at"].clone())
                            .unwrap_or(Value::Null),
                    );
                }
            }
        }
    }
    v
}
pub fn tools() -> Value {
    json!([
    {"name":"get_intraday_history","description":"Read current-day one-minute chart for a watched Taiwan symbol. First response may be pending. Yahoo Finance minutes may be delayed; missing coverage can fall back to explicitly partial local MIS samples. Never use chart data to claim real-time execution or trigger rules. Do not treat an older session as today.","inputSchema":{"type":"object","properties":{"symbol":{"type":"string"}},"required":["symbol"],"additionalProperties":false}},
    {"name":"get_daily_history","description":"Read official daily OHLC, close change and volume for a Taiwan stock or index by month (YYYY-MM). First call queues the fetch and returns pending=true; poll until complete. Historical data never triggers live alerts. Each row preserves its volume unit. Current-day data excluded before 15:00 Taipei. Raw prices are unadjusted.","inputSchema":{"type":"object","properties":{"symbol":{"type":"string"},"month":{"type":"string"}},"required":["symbol","month"],"additionalProperties":false}},
        {"name":"get_status","description":"Read local watchlist, quotes with source times, health and settings. Check demo and freshness before reporting. Does not fetch separately.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"name":"list_events","description":"Read up to 500 recent locally detected events, newest first.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"name":"list_rules","description":"Read persistent monitoring rules. Rules run without the agent.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"name":"set_watchlist","description":"Replace the watchlist (up to 30 Taiwan symbols). Enabled rules must be disabled or deleted before removing their symbol.","inputSchema":{"type":"object","properties":{"symbols":{"type":"array","items":{"type":"string"},"maxItems":30}},"required":["symbols"],"additionalProperties":false}},
        {"name":"set_settings","description":"Change appearance, pause monitoring or set refresh interval. Hidden windows continue monitoring. Pausing resets crossing baselines.","inputSchema":{"type":"object","properties":{"appearance":{"enum":["small","gray","terminal","txt"]},"rowDisplay":{"enum":["numbers","trend","minimal"]},"showCodes":{"type":"boolean"},"paused":{"type":"boolean"},"refreshSeconds":{"type":"integer","minimum":5,"maximum":300}},"additionalProperties":false}},
        {"name":"upsert_rule","description":"Create or replace a persistent crossing rule. First valid fresh observation establishes a baseline without alerting; subsequent crossing triggers once daily or once ever. Editing preserves today's fired latch. No volume/big-order rules. Returns current state including rule ID. Omit id to create, supply existing id to replace. Symbol automatically added to watchlist.","inputSchema":{"type":"object","properties":{"id":{"type":"string"},"symbol":{"type":"string"},"metric":{"enum":["price","changePercent"]},"direction":{"enum":["above","below"]},"threshold":{"type":"number"},"channel":{"enum":["off","log","strip","card"]},"repeat":{"enum":["once","daily"]},"enabled":{"type":"boolean"}},"required":["symbol","metric","direction","threshold"],"additionalProperties":false}},
        {"name":"delete_rule","description":"Delete an existing monitoring rule by ID.","inputSchema":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"],"additionalProperties":false}}
    ])
}
pub fn rpc(state: &Shared, req: Value) -> Option<Value> {
    let id = req.get("id")?.clone();
    let error = |code: i32, message: &str| json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}});
    let result = match req["method"].as_str().unwrap_or("") {
        "initialize" => {
            json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"smallstocks-tw","version":"0.1.6"},"instructions":"Local desktop monitor. Quotes can be stale or synthetic; always check sourceAt, demo and error. Monitoring is performed by the desktop core. Never imply an agent schedule exists merely because a rule was created."})
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools":tools()}),
        "tools/call" => {
            let tool = req["params"]["name"].as_str().unwrap_or("");
            let args = req["params"].get("arguments").cloned().unwrap_or(json!({}));
            let result = state
                .lock()
                .unwrap()
                .execute(tool, args)
                .map(compact_charts);
            match result {
                Ok(v) => json!({"content":[{"type":"text","text":v.to_string()}],"isError":false}),
                Err(e) => json!({"content":[{"type":"text","text":e}],"isError":true}),
            }
        }
        _ => return Some(error(-32601, "Method not found")),
    };
    Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
}
pub fn serve(state: Shared, dir: &Path) -> Result<(), String> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().ok_or("no local port")?.port();
    let token = uuid::Uuid::new_v4().to_string();
    std::fs::write(
        dir.join("mcp-connection.json"),
        json!({"url":format!("http://127.0.0.1:{port}/rpc"),"token":token}).to_string(),
    )
    .map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let authorized = req.headers().iter().any(|h| {
                h.field.equiv("Authorization") && h.value.as_str() == format!("Bearer {token}")
            });
            if !authorized {
                let _ = req.respond(
                    tiny_http::Response::from_string("Unauthorized").with_status_code(401),
                );
                continue;
            }
            if req.url() != "/rpc" || req.method() != &tiny_http::Method::Post {
                let _ = req.respond(tiny_http::Response::empty(404));
                continue;
            }
            if req.body_length().is_none_or(|n| n > 65536) {
                let _ = req.respond(tiny_http::Response::empty(413));
                continue;
            }
            let mut body = String::new();
            if req.as_reader().read_to_string(&mut body).is_err() {
                let _ = req.respond(tiny_http::Response::empty(400));
                continue;
            }
            let response = match serde_json::from_str(&body) {
                Ok(v) => rpc(&state, v).unwrap_or(json!({})),
                Err(_) => {
                    json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Invalid JSON"}})
                }
            };
            let _ = req.respond(
                tiny_http::Response::from_string(response.to_string()).with_header(
                    tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap(),
                ),
            );
        }
    });
    Ok(())
}
pub fn bridge(dir: &Path) {
    let connection = std::fs::read(dir.join("mcp-connection.json"))
        .ok()
        .and_then(|v| serde_json::from_slice::<Value>(&v).ok());
    let Some(c) = connection else {
        eprintln!("Open SmallStocks TW first. Connection file missing.");
        return;
    };
    let Some(url) = c["url"].as_str() else { return };
    let Some(token) = c["token"].as_str() else {
        return;
    };
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return;
    };
    if parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.path() != "/rpc"
    {
        eprintln!("Invalid local connection");
        return;
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .no_proxy()
        .build()
        .unwrap();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.len() > 65536 {
            continue;
        }
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Invalid JSON"}})
                );
                let _ = stdout.flush();
                continue;
            }
        };
        if req.get("id").is_none() {
            continue;
        }
        let result = client
            .post(url)
            .bearer_auth(token)
            .json(&req)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.json::<Value>());
        let response=result.unwrap_or_else(|e|json!({"jsonrpc":"2.0","id":req["id"],"error":{"code":-32603,"message":format!("Desktop unavailable: {e}")}}));
        if writeln!(stdout, "{response}").is_err() {
            break;
        }
        let _ = stdout.flush();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_charts_do_not_flood_agent_context() {
        let v = compact_charts(
            json!({"intraday":{"2330":{"series":{"source":"test","points":[{"at":1,"price":100},{"at":2,"price":101}]}}}}),
        );
        assert!(v["intraday"]["2330"]["series"].get("points").is_none());
        assert_eq!(v["intraday"]["2330"]["series"]["pointCount"], 2);
        assert_eq!(v["intraday"]["2330"]["series"]["source"], "test");
    }
}
