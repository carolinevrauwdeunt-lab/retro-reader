# Retro Reader

A retro, TV-themed RSS/Atom feed reader you run locally — aggregate news sites, Substack
newsletters, and any RSS/Atom feed into one dashboard. Built as a vanilla Node.js app
(built-in `http`/`https` modules only, zero npm dependencies) with no build step and no
database, running entirely locally as a single process serving a static page and a small
JSON-file-backed API.

## Features

- **Two views**: a classic article list, and a "TV Wall" view that renders posts as a grid
  of retro CRT-television screens
- Aggregates RSS and Atom feeds (including Reddit's RSS/Atom output)
- **Presets picker** — browse and one-click-add from ~80 curated feeds across many categories
- **Bulk "Add Your Own"** — paste multiple feed URLs at once, with automatic Substack
  resolution (point it at a `.substack.com` URL or post link and it resolves the feed)
- Automatic feed validation and discovery (tries `/feed` if a URL isn't itself a feed)
- **Drag-and-drop** feeds between categories to reorganize them
- Categories can exist empty — create a category before you've added any feeds to it
- Read/unread tracking
- Pulls Open Graph images for feeds that don't include their own
- Zero dependencies, zero build step, zero database — just flat JSON files

## Screenshots

> _Add screenshots of the article-list view and the TV Wall view here._

## Quick Start

```bash
git clone https://github.com/carolinevrauwdeunt-lab/retro-reader.git
cd retro-reader
./setup.sh
node server.js
```

Then open [http://localhost:3334](http://localhost:3334) in your browser.

On macOS you can skip the terminal entirely — double-click `Start RSS Reader.command` to
start the server and open the browser automatically. This is the easiest way to run Retro
Reader if you don't want to touch a command line.

See [CLAUDE.md](CLAUDE.md) for the full command/API/architecture reference.

## Requirements

- Node.js (no external dependencies — only built-in `http`, `https`, `fs`, `path`, `url` modules)

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

## Using with Claude Code

This project includes a [CLAUDE.md](CLAUDE.md) that gives Claude Code full context on the
architecture, API endpoints, and data files.

```bash
claude    # Start Claude Code — reads CLAUDE.md automatically
```

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
