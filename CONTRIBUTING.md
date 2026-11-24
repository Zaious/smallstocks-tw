# Contributing

Thank you for looking. Bug reports, questions and pull requests in English or Chinese are all fine.

## What is welcome

- Bug reports with the version (**外觀與設定** shows it), your operating system and the steps that lead to the problem.
- Fixes, tests, and corrections to the documentation.
- Small features that fit what the app already is: a quiet watchlist in a corner of the screen with alerts you set. For anything larger, open an issue first, so that you and I agree on it before you spend time.

## What is not accepted, and why

- **Placing orders or reading brokerage accounts.** The app watches and tells you; it does not trade, and it holds no brokerage credentials.
- **A server that relays or stores market data.** Every copy fetches data from the sources itself; redistributing that data is not something this project has rights to.
- **Alerts that depend on an agent or a language model.** Monitoring runs in the desktop app on its own; the MCP connection is optional.
- **Alerts on a price that is not what it says.** A bid/ask average must never be shown or treated as a trade price, and missing, stale or out-of-order quotes must never fire an alert. A new kind of alert needs its fields and their meaning checked against the source first.

## Before you open a pull request

These are the checks CI runs on every push:

```powershell
npm ci
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build -- --no-bundle
```

If you run the desktop app for testing, set `SMALLSTOCKS_CONFIG_DIR` to a separate folder so your own settings are left alone, and `SMALLSTOCKS_NO_GLOBAL_SHORTCUT=1` so a long test does not hold your hide-all shortcut. Interface changes have browser checks too; see [Build from source](README.md#build-from-source).

## AI-assisted contributions

- You may use AI tools. If a substantial part of a change was generated, say so in the pull request description; a commit may carry an `Assisted-by: {tool}` trailer.
- You must be able to explain every line you submit, and you answer for it.
- Only you may add a `Signed-off-by` line; do not let an AI tool add it for you.
- You are responsible for the rights to what you submit, including AI-assisted content.

There is no contributor licence agreement. Contributions are accepted under the repository's [Apache License 2.0](LICENSE).
