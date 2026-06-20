# Retro Reader

A vanilla Node.js (built-in `http`/`https` modules only, no dependencies) RSS/Atom feed
reader with a retro TV-themed UI. Runs entirely locally as a single process serving a
static page and a small JSON-file-backed API.

## Features

- Aggregates RSS and Atom feeds (including Reddit's RSS/Atom output)
- Retro TV-styled interface
- Feed and category management via a simple JSON-backed API
- Automatic feed validation and discovery (tries `/feed` if a URL isn't itself a feed)
- Read/unread tracking
- Pulls Open Graph images for feeds that don't include their own

## Requirements

- Node.js (no external dependencies — only built-in `http`, `https`, `fs`, `path`, `url` modules)

## Getting Started

```bash
node server.js
```

Then open [http://localhost:3334](http://localhost:3334) in your browser.

On macOS you can also double-click `Start RSS Reader.command` to start the server and
open the browser automatically.

## Configuration

This app does not currently use environment variables — see `.env.example` for details.
The port is a hardcoded constant (`PORT = 3334`) in `server.js`; change it there if you
need a different port.

## Data Files

- `feeds.json` — your subscribed feeds, grouped by category. Ships with a small set of
  example feeds (Hacker News, Ars Technica, BBC News, The Guardian) — edit freely to add
  your own.
- `categories.json` — the list of feed categories/groups.
- `presets.json` — a larger curated list of popular feeds across many categories, used to
  power a "quick add" feature in the UI.
- `seen.json` — tracks which article links you've already opened, so they can be marked
  as read. Starts empty.

## License

MIT — see [LICENSE](LICENSE).
