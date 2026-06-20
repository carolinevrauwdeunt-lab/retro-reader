# Fork Report: retro-reader

**Source:** /Users/carolinevrauwdeunt/Desktop/rss-reader
**Target:** /Users/carolinevrauwdeunt/opensource-staging/retro-reader
**Date:** 2026-06-20
**License:** MIT

## Directories Excluded

- `lovable-handoff/` — entirely excluded per instructions. This was a separate, unrelated
  spec/handoff document set (`HANDOFF.md`, `schema.sql`, `seed-presets.json`, and Supabase
  edge functions) for a possible future hosted version on Lovable.dev. It is not part of the
  running application and was not ready for public release.
- `.git/`, `node_modules/`, `__pycache__/`, `.venv/`, `venv/` — standard excludes (none of
  these were actually present in the source, which had no existing VCS history).

## Files Removed

- `CLAUDE.md` — removed. This file did not contain real project documentation; it only
  contained `claude-mem` activity-log metadata referencing the project owner's personal
  work sessions and reading/browsing activity. Not appropriate for a public repo and not
  useful to other users of the app.

## Secrets Found

**None.** This app is unauthenticated, has no third-party API integrations, and does not
use credentials of any kind. The full source tree was scanned for API keys, tokens,
AWS/GitHub/Slack/SendGrid credentials, JWTs, private key blocks, and database connection
strings — no matches were found in `server.js`, `index.html`, `presets.json`,
`Start RSS Reader.command`, or any other file.

## Personal Data Found and Replaced

This was the primary sensitive-data risk in this project. Three files contained the
project owner's real personal data rather than generic sample data:

### feeds.json
**Found:** The owner's actual personal RSS/Reddit subscriptions, including two categories
of business-sensitive data:
- **"Money Magician"** — 23 feeds, mostly Reddit search-RSS URLs monitoring small-business/
  bookkeeping/accounting subreddits for competitor and lead-discovery purposes (e.g.
  `r/smallbusiness` searches for "bookkeeping", "accounting software", "quickbooks
  alternative"), plus a direct feed from `moneymagician.eu` (the owner's own product blog).
- **"Ask Seve"** — 14 feeds, similar Reddit search-RSS URLs monitoring travel-planning
  subreddits (e.g. `r/travel` searches for "itinerary help", "trip planning tool"), plus a
  feed from `blog.askseve.com` (the owner's own product blog).
- Plus the owner's personal Substack subscriptions (16 newsletters), tech/news/design/
  photography/travel feeds.

**Replaced with:** A small, generic, clearly-public example `feeds.json` containing four
well-known tech/news feeds: Hacker News, Ars Technica, BBC News, and The Guardian — none
of which reveal anything about the owner's business interests, competitor monitoring, or
personal reading habits.

### categories.json
**Found:** `["Financial"]` — the single remaining category tied to the "Money Magician"
business-monitoring feed group.

**Replaced with:** `["Tech", "News"]` — matching the new generic example feeds.

### seen.json
**Found:** A read-tracking JSON array of ~34 specific article/post URLs the owner had
personally opened, including specific Reddit thread URLs (e.g. a post titled "I want to
shut down my freelance business", "tired of working under agencies") that reveal the
owner's personal reading and business-research activity. Pure personal browsing history
with no value to other users of the app.

**Replaced with:** `[]` (empty array) — matches the existing schema exactly; the app will
simply treat all articles as unread/new on first run, which is the expected fresh-install
state.

## Internal References Replaced

**None needed.** A full scan of `server.js`, `index.html`, and the `.command` script for
internal domains, absolute home-directory paths (`/Users/<username>` or `/home/<username>`),
private IPs, internal service URLs, personal email addresses, and internal GitHub org names
found no matches. The app has no hardcoded paths outside `__dirname`-relative references,
no email addresses, and no internal infrastructure references.

## .env.example

This app does not use environment variables — `PORT` is a hardcoded constant (`3334`) in
`server.js`, and there are no other configurable secrets or settings read from the
environment. `.env.example` was generated as a minimal placeholder file explaining this,
rather than inventing fake environment variables that don't exist in the actual code.

## Files Added (standard OSS scaffolding)

- `LICENSE` — MIT license text, per the requested license.
- `README.md` — project description, setup instructions, and data-file documentation.
- `.gitignore` — standard ignores (`node_modules/`, `.env`, logs, `.DS_Store`).
- `.env.example` — see above.

## Git History

Source directory was not a git repository (no `.git/` present), so there was no history to
clean. A fresh repository was initialized in the target directory with a single clean
initial commit containing all sanitized files.

## Warnings / Items for Manual Review

- [ ] `presets.json` (the larger curated "quick add" feed list shipped with the app) was
      reviewed and found to already contain only generic, well-known public feeds (BBC,
      NYT, Forbes, NASA, etc.) — no personal data found, left unchanged.
- [ ] Confirm the new copyright year/holder line in `LICENSE` ("Retro Reader Contributors",
      2026) matches what the owner actually wants attributed before publishing.
- [ ] The product blog URLs `moneymagician.eu` and `askseve.com` (the owner's own
      businesses) were removed along with the rest of the "Money Magician"/"Ask Seve"
      feed groups as part of the personal-data sanitization above — confirm this is
      acceptable (vs. e.g. wanting to keep the public blog feeds while dropping only the
      Reddit lead-monitoring searches), since these two domains appear to belong to the
      owner and could optionally be kept as legitimate public blog subscriptions if desired.

## Next Step

Run opensource-sanitizer to verify sanitization is complete.
