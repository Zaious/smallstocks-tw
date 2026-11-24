# Security policy

## Supported versions

Only the latest release gets security fixes. An installed copy can update itself from **外觀與設定**; the portable zip does not update itself, so download the new one from the [latest release](https://github.com/Zaious/smallstocks-tw/releases/latest).

## Reporting a vulnerability

Use GitHub's private reporting: the **Security** tab of this repository, then **Report a vulnerability**. It needs a GitHub account. Please do not open a public issue.

I am the only maintainer. I aim to acknowledge a report within 7 calendar days and do not promise a fix date. A confirmed issue is fixed in a new release and published as a GitHub security advisory.

## In scope

- Update signature checking and the update path (the start-up check against GitHub, the download and the install).
- The local MCP endpoint on `127.0.0.1` and its token in `mcp-connection.json`.
- The Windows installer and the portable zip as published on the release page.

## Out of scope

- Errors, delays or outages of the market data sources (TWSE, TPEx, Yahoo Finance).
- The Windows SmartScreen warning for an unsigned build (documented in the README).
- The project website, which is a static page; report problems with it as an ordinary issue.
