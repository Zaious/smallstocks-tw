mod core;
mod daily;
mod intraday;
mod mcp;
use core::{now, Core};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, PoisonError},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn demo() -> bool {
    std::env::args().any(|a| a == "--demo")
}
fn data_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("SMALLSTOCKS_CONFIG_DIR") {
        return PathBuf::from(p);
    }
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join(if demo() {
        "SmallStocks-TW-demo"
    } else {
        "SmallStocks-TW"
    })
}
/// Runs a background worker for the life of the app. A panic must not leave the monitor
/// silently dead: record it for the UI/MCP status and start the worker again.
fn supervise<F: FnMut() + Send + 'static>(state: mcp::Shared, name: &'static str, mut work: F) {
    std::thread::spawn(move || loop {
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(&mut work)).is_err() {
            state.lock().unwrap_or_else(PoisonError::into_inner).error =
                Some(format!("{name}發生內部錯誤，已自動重啟"));
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}
pub fn bridge() {
    mcp::bridge(&data_dir());
}
#[tauri::command]
fn privacy_hide(app: tauri::AppHandle) {
    app.state::<mcp::Shared>()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .notices_hidden = true;
    let _ = app.emit("privacy-hide", ());
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
}
fn privacy_shortcut() -> &'static str {
    if cfg!(target_os = "macos") {
        "Command+Alt+S"
    } else {
        "Ctrl+Alt+S"
    }
}
#[tauri::command]
fn hide_stock_detail(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("detail") {
        let _ = w.hide();
    }
}
#[tauri::command]
fn fit_minimal_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    if !height.is_finite() || !(28.0..=410.0).contains(&height) {
        return Err("無效的視窗高度".into());
    }
    let compact = {
        let state = app.state::<mcp::Shared>();
        let s = state.lock().unwrap_or_else(PoisonError::into_inner);
        if s.saved.settings.row_display != "minimal" {
            return Ok(());
        }
        matches!(s.saved.settings.appearance.as_str(), "small" | "gray")
    };
    let w = app
        .get_webview_window("main")
        .ok_or("main window unavailable")?;
    let size = w.inner_size().map_err(|e| e.to_string())?;
    let scale = w.scale_factor().map_err(|e| e.to_string())?;
    if w.is_maximized().map_err(|e| e.to_string())? {
        return Ok(());
    }
    w.set_min_size(Some(tauri::LogicalSize::new(
        300.,
        if compact { 28. } else { 100. },
    )))
    .map_err(|e| e.to_string())?;
    w.set_size(tauri::PhysicalSize::new(
        size.width,
        (height * scale).round() as u32,
    ))
    .map_err(|e| e.to_string())?;
    if let Some(m) = w.current_monitor().map_err(|e| e.to_string())? {
        let area = m.work_area();
        let p = w.outer_position().map_err(|e| e.to_string())?;
        let bottom = area.position.y as i64 + area.size.height as i64;
        let needed = (height * scale).round() as i64;
        if p.y as i64 + needed > bottom {
            w.set_position(tauri::PhysicalPosition::new(
                p.x,
                (bottom - needed).max(area.position.y as i64) as i32,
            ))
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
fn show_stock_detail(
    app: tauri::AppHandle,
    detail: Value,
    x: f64,
    y: f64,
    top: f64,
) -> Result<(), String> {
    if ![x, y, top]
        .iter()
        .all(|n| n.is_finite() && n.abs() < 20000.)
        || detail.to_string().len() > 8192
    {
        return Err("無效的詳細資料".into());
    }
    if app
        .state::<mcp::Shared>()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .notices_hidden
    {
        return Ok(());
    }
    let main = app
        .get_webview_window("main")
        .ok_or("main window unavailable")?;
    let w = app
        .get_webview_window("detail")
        .ok_or("detail window unavailable")?;
    let position = main.outer_position().map_err(|e| e.to_string())?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let width = 280.;
    let height = 186.;
    let mut px = position.x as f64 + x * scale;
    let mut py = position.y as f64 + (y + 5.) * scale;
    if let Some(m) = main.current_monitor().map_err(|e| e.to_string())? {
        let area = m.work_area();
        let left = area.position.x as f64;
        let right = left + area.size.width as f64;
        let above = area.position.y as f64;
        let below = above + area.size.height as f64;
        if py + height * scale > below {
            py = position.y as f64 + top * scale - height * scale - 5. * scale;
        }
        px = px.clamp(left + 4., (right - width * scale - 4.).max(left + 4.));
        py = py.clamp(above + 4., (below - height * scale - 4.).max(above + 4.));
    }
    w.set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    w.set_position(tauri::PhysicalPosition::new(px as i32, py as i32))
        .map_err(|e| e.to_string())?;
    app.emit_to("detail", "stock-detail", detail)
        .map_err(|e| e.to_string())?;
    w.show().map_err(|e| e.to_string())
}
#[tauri::command]
fn core_request(
    app: tauri::AppHandle,
    state: tauri::State<mcp::Shared>,
    tool: String,
    args: Value,
) -> Result<Value, String> {
    let result = state
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .execute(&tool, args)?;
    if tool == "set_settings" {
        sync_main_window(&app)?;
    }
    Ok(result)
}
fn sync_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let enabled = app
        .state::<mcp::Shared>()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .saved
        .settings
        .always_on_top;
    let window = app
        .get_webview_window("main")
        .ok_or("main window unavailable")?;
    window.set_always_on_top(enabled).map_err(|e| e.to_string())
}
#[tauri::command]
async fn search_stocks(query: String) -> Result<Value, String> {
    if query.trim().is_empty() || query.chars().count() > 40 {
        return Err("請輸入名稱或代號（最多 40 字）".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let v: Value = client
            .get("https://mis.twse.com.tw/stock/api/getStockNames.jsp")
            .query(&[("n", query.trim())])
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.json())
            .map_err(|e| e.to_string())?;
        let mut list: Vec<Value> = v["datas"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| {
                let c = r["c"].as_str().and_then(core::symbol)?;
                Some(json!({"symbol":c,"name":r["n"].as_str().unwrap_or("")}))
            })
            .collect();
        list.sort_by_key(|r| {
            if r["name"].as_str() == Some(query.trim())
                || r["symbol"].as_str() == Some(query.trim())
            {
                0
            } else if r["symbol"].as_str().is_some_and(|c| c.len() == 4) {
                1
            } else {
                2
            }
        });
        list.truncate(30);
        Ok(json!(list))
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn run() {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).expect("cannot create app data directory");
    let mut context = tauri::generate_context!();
    // Test profiles get their own instance lock, so QA cannot focus the user's running app.
    if std::env::var_os("SMALLSTOCKS_CONFIG_DIR").is_some() {
        use std::hash::{Hash, Hasher};
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        std::fs::canonicalize(&dir)
            .unwrap_or_else(|_| dir.clone())
            .to_string_lossy()
            .to_lowercase()
            .hash(&mut hash);
        context.config_mut().identifier =
            format!("{}.test.{:x}", context.config().identifier, hash.finish());
    }
    let state: mcp::Shared = Arc::new(Mutex::new(
        Core::load(dir.join("state.json"), demo())
            .expect("cannot read settings; original file preserved"),
    ));
    let setup_state = state.clone();
    if let Some(window) = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|w| w.label == "main")
    {
        window.always_on_top = state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .saved
            .settings
            .always_on_top;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            app.state::<mcp::Shared>().lock().unwrap_or_else(PoisonError::into_inner).notices_hidden = false;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filename(dir.join("windows.json").to_string_lossy().to_string())
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        privacy_hide(app.clone());
                    }
                })
                .build(),
        )
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            core_request,
            privacy_hide,
            search_stocks,
            show_stock_detail,
            hide_stock_detail,
            fit_minimal_height
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "detail",
                tauri::WebviewUrl::App("detail.html".into()),
            )
            .title("Stock details")
            .inner_size(280., 186.)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .focused(false)
            .focusable(false)
            .skip_taskbar(true)
            .visible(false)
            .build()?
            .set_ignore_cursor_events(true)?;
            tauri::WebviewWindowBuilder::new(
                app,
                "notify",
                tauri::WebviewUrl::App("notify.html".into()),
            )
            .title("SmallStocks TW notice")
            .inner_size(300., 56.)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .focused(false)
            .focusable(false)
            .skip_taskbar(true)
            .visible(false)
            .build()?;
            let show = MenuItem::with_id(app, "show", "顯示 SmallStocks TW", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "結束監看並離開", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("SmallStocks TW · 本機監看")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        app.state::<mcp::Shared>().lock().unwrap_or_else(PoisonError::into_inner).notices_hidden = false;
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone())
            }
            tray.build(app)?;
            if let Err(error) = app.global_shortcut().register(privacy_shortcut()) {
                setup_state.lock().unwrap_or_else(PoisonError::into_inner).privacy_shortcut_error = Some(format!("全域隱藏快捷鍵無法註冊（可能已被占用）：{error}。程式內仍可使用快捷鍵或隱藏按鈕。"));
            }
            if let Err(e) = mcp::serve(setup_state.clone(), &dir, app.handle().clone()) {
                setup_state.lock().unwrap_or_else(PoisonError::into_inner).error = Some(format!("MCP 啟動失敗：{e}"));
            }
            let handle = app.handle().clone();
            let poll_state = setup_state.clone();
            supervise(setup_state.clone(), "行情輪詢", move || {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(15))
                    .user_agent(concat!("SmallStocks-TW/", env!("CARGO_PKG_VERSION")))
                    .build()
                    .unwrap();
                let mut tick = 0;
                loop {
                    std::thread::sleep(Duration::from_millis(500));
                    let (codes, is_demo, revision) = {
                        let mut s = poll_state.lock().unwrap_or_else(PoisonError::into_inner);
                        let at = now();
                        if s.saved.settings.paused
                            || at < s.next_poll
                            || s.saved.watchlist.is_empty()
                        {
                            continue;
                        }
                        if !s.demo && !core::trading(at) && s.last_fetch.is_some() {
                            s.next_poll = at + 60_000;
                            continue;
                        }
                        s.next_poll = at + s.saved.settings.refresh_seconds as i64 * 1000;
                        (s.saved.watchlist.clone(), s.demo, s.config_revision)
                    };
                    let result = if is_demo {
                        tick += 1;
                        Ok(core::demo_quotes(&codes, tick))
                    } else {
                        client
                            .get(core::mis_url(&codes))
                            .send()
                            .and_then(|r| r.error_for_status())
                            .and_then(|r| r.json::<Value>())
                            .map_err(|e| e.to_string())
                            .and_then(|v| core::parse_mis(&v, now()))
                    };
                    let mut s = poll_state.lock().unwrap_or_else(PoisonError::into_inner);
                    if s.config_revision != revision || s.saved.settings.paused {
                        continue;
                    }
                    match result {
                        Ok(quotes) => {
                            let events = s.ingest(quotes, now());
                            if !s.notices_hidden {
                                for e in events {
                                    let _ = handle.emit("stock-notice", &e);
                                }
                            }
                        }
                        Err(e) => {
                            s.error = Some(format!("行情連線失敗：{e}"));
                            s.failures = (s.failures + 1).min(6);
                            s.next_poll = now()
                                + ((s.saved.settings.refresh_seconds * 2u64.pow(s.failures))
                                    .min(300) as i64)
                                    * 1000;
                            s.reset_baselines();
                        }
                    }
                }
            });
            let line_state = setup_state.clone();
            supervise(setup_state.clone(), "分鐘線佇列", move || {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(15))
                    .user_agent("Mozilla/5.0 SmallStocks-TW")
                    .build()
                    .unwrap();
                loop {
                    std::thread::sleep(Duration::from_secs(2));
                    let task = line_state.lock().unwrap_or_else(PoisonError::into_inner).intraday_queue.pop_front();
                    let Some(code) = task else { continue };
                    let (demo, otc) = {
                        let s = line_state.lock().unwrap_or_else(PoisonError::into_inner);
                        (
                            s.demo,
                            s.saved
                                .daily_cache
                                .values()
                                .any(|v| v.symbol == code && v.source == "TPEx"),
                        )
                    };
                    let result = if demo {
                        Ok(intraday::demo_series(&code))
                    } else {
                        intraday::fetch(&client, &code, otc)
                    };
                    let mut s = line_state.lock().unwrap_or_else(PoisonError::into_inner);
                    s.intraday_pending.remove(&code);
                    match result {
                        Ok(series) => {
                            if s.saved.watchlist.contains(&code) {
                                s.saved.intraday_cache.insert(code.clone(), series);
                                s.intraday_errors.remove(&code);
                                if let Err(e) = s.persist() {
                                    s.intraday_errors
                                        .insert(code, (format!("分鐘線快取無法儲存：{e}"), now()));
                                }
                            }
                        }
                        Err(e) => {
                            s.intraday_errors.insert(code, (e, now()));
                        }
                    }
                    s.revision += 1;
                }
            });
            let history_state = setup_state.clone();
            supervise(setup_state.clone(), "日資料佇列", move || {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(20))
                    .user_agent(concat!("SmallStocks-TW/", env!("CARGO_PKG_VERSION")))
                    .build()
                    .unwrap();
                loop {
                    std::thread::sleep(Duration::from_secs(2));
                    let task = history_state.lock().unwrap_or_else(PoisonError::into_inner).daily_queue.pop_front();
                    let Some((code, month)) = task else { continue };
                    let is_demo = history_state.lock().unwrap_or_else(PoisonError::into_inner).demo;
                    let result = if is_demo {
                        Ok(daily::demo_series(&code, &month))
                    } else {
                        daily::fetch(&client, &code, &month)
                    };
                    let mut s = history_state.lock().unwrap_or_else(PoisonError::into_inner);
                    let key = format!("{code}:{month}");
                    s.daily_pending.remove(&key);
                    match result {
                        Ok(series) => {
                            s.saved.daily_cache.insert(key.clone(), series);
                            s.daily_errors.remove(&key);
                            while s.saved.daily_cache.len() > 80 {
                                let oldest = s
                                    .saved
                                    .daily_cache
                                    .iter()
                                    .min_by_key(|(_, s)| s.fetched_at)
                                    .map(|(k, _)| k.clone())
                                    .unwrap();
                                s.saved.daily_cache.remove(&oldest);
                            }
                            if let Err(e) = s.persist() {
                                s.daily_errors
                                    .insert(key, (format!("歷史快取無法儲存：{e}"), now()));
                            }
                        }
                        Err(e) => {
                            s.daily_errors.insert(key, (e, now()));
                        }
                    }
                    s.revision += 1;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    hide_stock_detail(window.app_handle().clone());
                    let _ = window.hide();
                }
            }
        })
        .run(context)
        .expect("desktop runtime failed");
}
