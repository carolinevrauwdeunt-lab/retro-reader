# Contributing to Retro Reader

Thanks for considering a contribution. Retro Reader is intentionally tiny and dependency-free —
please keep that spirit in mind when proposing changes.

## Development Setup

```bash
git clone https://github.com/carolinevrauwdeunt-lab/retro-reader.git
cd retro-reader
./setup.sh
node server.js
```

Open http://localhost:3334 and edit `server.js` or `index.html` directly — there is no build
step or watch process. Just save and refresh the browser (and restart `node server.js` if you
change backend code).

## Code Style

- **Zero dependencies.** This project deliberately uses only Node's built-in `http`, `https`,
  `fs`, `path`, and `url` modules. Pull requests that add an `npm install` step or a `package.json`
  dependency will not be merged — that's a feature, not an oversight.
- **No build step.** `index.html` is plain HTML/CSS/JS in a single file. Keep it that way; don't
  introduce a bundler, transpiler, or framework.
- **No database.** State lives in flat JSON files (`feeds.json`, `categories.json`, `seen.json`).
  Keep new persistent state in the same pattern unless there's a strong reason not to.
- Match the existing code style in the file you're editing (2-space indentation, semicolons,
  `const`/`let`, regex-based parsing rather than pulling in an XML/HTML library).

## Branch & PR Workflow

1. Fork the repository and create a feature branch off `main`.
2. Make your changes, keeping commits focused and descriptive.
3. Test manually by running `node server.js` and exercising the affected feature in the browser
   (there is no automated test suite — see below).
4. Open a pull request describing what changed and why, and how you tested it.

## Testing

There is currently no automated test suite, linter, or CI pipeline for this project. Please test
changes manually:

- Start the server (`node server.js`) and confirm the app loads at http://localhost:3334.
- Exercise the specific feature you changed (e.g. add/remove a feed, switch views, drag a feed
  between categories, add a Substack URL) and confirm the corresponding JSON file
  (`feeds.json`, `categories.json`, `seen.json`) updates as expected.
- Check the browser console and the terminal running `node server.js` for errors.

Contributions that add lightweight tests (without adding a dependency, if possible) are welcome.

## Reporting Issues

Please use the issue templates under `.github/ISSUE_TEMPLATE/` when filing a bug report or
feature request. Include your Node.js version (`node --version`), OS, and steps to reproduce.

## Using Claude Code

This repo includes a [CLAUDE.md](CLAUDE.md) with an up-to-date architecture and API reference.
If you're using [Claude Code](https://claude.com/claude-code), just run `claude` from the
project root — it will pick up `CLAUDE.md` automatically and have full context on the codebase.
