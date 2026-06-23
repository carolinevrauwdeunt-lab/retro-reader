# Retro Reader

**Port:** 3334 | **Stack:** Vanilla Node.js (built-in `http`/`https` only) + plain HTML/CSS/JS, zero dependencies

## What
A retro, TV-themed RSS/Atom feed reader you run locally. Aggregates news sites, Substack
newsletters, and any RSS/Atom feed into one dashboard with a classic article-list view and a
"TV Wall" view that renders posts as a grid of retro CRT-television screens.

## Quick Start

```bash
./setup.sh              # Checks Node.js is installed
node server.js           # Start the server
```

Then open http://localhost:3334. On macOS, double-click `Start RSS Reader.command` instead of
using the terminal — it kills any old instance on port 3334, starts the server, and opens the
browser automatically.

There is no build step, no test suite, and no linter in this project — just `node server.js`.

## Architecture

```
server.js       # Entire backend: http server, feed fetch/parse, JSON file I/O, REST API
index.html      # Entire frontend: markup, CSS, and JS in one file (list view + TV Wall view)
feeds.json      # Subscribed feeds, each { group, name, url }
categories.json # List of category/group names (can include empty categories)
presets.json    # Curated feed list (category + name + url) powering "Browse Presets"
seen.json       # Array of article links already opened, for read/unread state
watchlist.json  # Stock ticker symbols shown in the watchlist bar
Start RSS Reader.command  # macOS double-click launcher (no terminal needed)
```

`index.html` is served as a static page by `server.js` and talks to it exclusively via the
`/api/*` JSON endpoints below. All state lives in the flat JSON files next to `server.js` —
there is no database. `server.js` reads/writes those files synchronously on each request.

## Key Files

```
server.js        # http.createServer router, RSS/Atom XML parsing (regex-based, no XML lib),
                  # Open Graph image scraping, Reddit rate-limit handling, feed validation
index.html        # UI: article list, TV Wall (CRT grid), preset picker modal, add-feed modal,
                  # category drag-and-drop reassignment
feeds.json        # User's feed subscriptions (ships with 4 example feeds)
categories.json   # User's category names (ships with "Tech", "News")
presets.json      # ~80 curated feeds across many categories for the "+ Browse Presets" picker
seen.json         # Read-tracking state (starts as an empty array)
watchlist.json    # User's stock ticker symbols (ships with AAPL, MSFT, GOOGL, SPY)
.env.example      # Documents that there are no required env vars; PORT is a constant in server.js
```

## API Endpoints (server.js)

```
GET  /                     index.html
GET  /api/feeds            list feeds
POST /api/feeds             add feeds  { feeds: [{group,name,url}] }
DEL  /api/feeds              remove a feed { url }
POST /api/feeds/move         reassign a feed's category { url, group }
GET  /api/categories         list categories
POST /api/categories          add a category { name }
DEL  /api/categories           remove an (empty) category { name }
GET  /api/presets             list curated presets
POST /api/validate-feed        check one URL is a feed (tries /feed fallback for Substack etc.)
POST /api/validate-feeds        batch-validate URLs (bulk "Add Your Own")
GET  /api/items?group=X         fetch + parse all feed items, optionally filtered by category
POST /api/mark-seen              mark an article link as read { link }
GET  /api/refresh                 clear the in-memory feed cache
GET  /api/watchlist                list watchlist tickers
POST /api/watchlist                 add a ticker { ticker } (resolves indices via a ^-prefix fallback)
PUT  /api/watchlist                  overwrite ticker order { tickers: [...] } (drag-and-drop reorder)
DEL  /api/watchlist                   remove a ticker { ticker }
GET  /api/stocks                       quotes + 1mo sparkline history for watchlist tickers (Yahoo Finance, 2min cache)
GET  /api/stock-search?q=                search Yahoo Finance by name/symbol (for the add-ticker dropdown)
GET  /api/stock-detail?ticker=&range=     quote + chart history for one ticker (range: 1mo/6mo/1y/5y)
```

## Configuration

No environment variables are required — see `.env.example`. The port is the hardcoded constant
`PORT = 3334` in `server.js`; edit it there to change it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
