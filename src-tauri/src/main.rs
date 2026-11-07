#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if std::env::args().any(|a| a == "--mcp") {
        smallstocks_lib::bridge();
    } else {
        smallstocks_lib::run();
    }
}
