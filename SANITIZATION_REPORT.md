# Sanitization Report: retro-reader

**Date:** 2026-06-20
**Auditor:** opensource-sanitizer v1.0.0
**Verdict:** FAIL

## Summary

| Category | Status | Findings |
|----------|--------|----------|
| Secrets | PASS | 0 findings |
| PII | FAIL | 1 finding |
| Internal References | PASS | 0 findings |
| Dangerous Files | PASS | 0 findings |
| Config Completeness | PASS | 0 findings |
| Git History | FAIL | 2 findings |

## Critical Findings (Must Fix Before Release)

1. **[GIT HISTORY]** `git log --oneline` shows 2 commits (`c39e8d0`, `81d541b`), not a single
   clean initial commit. Per sanitization policy, history must be a single squashed commit
   before release. FORK_REPORT.md's own "Git History" section claims "a single clean initial
   commit" was made, but a second commit (`81d541b — Add FORK_REPORT.md...`) was added
   afterward. **Action:** squash both commits into one before publishing.

2. **[PII]** Both commits' author/committer metadata contain the real account holder's full
   name and personal Gmail address: `Caroline Vrauwdeunt <caro...@gmail.com>` (full address
   visible in `git log`, `git show`, and any GitHub commit view once pushed). This is
   personal PII that will be permanently and publicly attached to the repository history.
   **Action:** rewrite commit author/committer identity to a project-appropriate name/email
   (e.g. a GitHub noreply address or generic maintainer handle) before pushing publicly, or
   reset history with the correct identity configured first.

## Warnings (Review Before Release)

1. **[CONFIG/PII — borderline, judged acceptable]** `FORK_REPORT.md` describes, in prose,
   the *category* of personal data removed from `feeds.json`/`seen.json` (business names
   "Money Magician" / "Ask Seve", the domains `moneymagician.eu` and `blog.askseve.com`,
   generic Reddit search terms like "bookkeeping", "accounting software", "quickbooks
   alternative", "itinerary help", "trip planning tool", and two paraphrased seen-article
   titles). None of these are credentials, full URLs with query-string-level specificity
   tied to a real session, emails, or precise personal-browsing artifacts — they are
   summarized/generic terms describing *what kind* of data was removed, which is expected
   and intended practice for a fork report per the task brief. Recommend keeping as-is, but
   flagging for the project owner's final sign-off since the business names and domains are
   identifiable as belonging to the owner.
2. **[CONFIG]** `LICENSE` copyright line reads "Retro Reader Contributors, 2026" — confirm
   this is the desired attribution (already flagged as a TODO inside FORK_REPORT.md itself).
3. **[CONFIG]** `server.js` hardcodes `PORT = 3334`; `.env.example` documents this clearly
   as intentional (no env vars used by the app), so this is informational only, not a defect.

## Detailed Scan Results

### Step 1 — Secrets Scan
No matches for API keys, AWS keys/secrets, database connection strings with credentials,
JWTs, private key blocks, GitHub/Google/Slack/SendGrid/Mailgun tokens in any tracked file
(`feeds.json`, `categories.json`, `seen.json`, `presets.json`, `server.js`, `index.html`,
`README.md`, `LICENSE`, `.env.example`, `.gitignore`, `Start RSS Reader.command`,
`FORK_REPORT.md`). Result: **PASS**.

### Step 2 — PII Scan
- No personal email addresses (gmail/yahoo/hotmail/outlook/protonmail/icloud) found in any
  *file content*.
- No private IP addresses (192.168.x.x / 10.x.x.x / 172.16-31.x.x) found.
- No SSH connection strings found.
- **However**, git commit metadata (author/committer name + email) embeds the real account
  owner's personal Gmail address across both commits — see Critical Finding #2 above.
  Result: **FAIL** (metadata-level PII, not file-content PII).

### Step 3 — Internal References Scan
- No absolute paths to non-generic home directories (`/Users/<realname>/`, `/home/<user>/`,
  `C:\Users\<name>`) inside any *file content*. (`FORK_REPORT.md` does contain
  `/Users/carolinevrauwdeunt/Desktop/rss-reader` and
  `/Users/carolinevrauwdeunt/opensource-staging/retro-reader` in its "Source"/"Target"
  metadata header — these are audit-trail provenance notes about the sanitization process
  itself, not infrastructure references, and are low-sensitivity, but the project owner
  should decide whether to keep this header line before publishing since it does reveal a
  local username.)
- No `.secrets/` references found.
- No internal domain names, internal service URLs, or internal GitHub org names found.
- Result: **PASS** (with the `FORK_REPORT.md` provenance-header note above for awareness;
  not counted as a hard fail since it is a local directory name, not a secret or credential).

### Step 4 — Dangerous Files Check
Verified absent: `.env` and variants, `*.pem`/`*.key`/`*.p12`/`*.pfx`/`*.jks`,
`credentials.json`, `service-account*.json`, `.secrets/`/`secrets/`, `.claude/settings.json`,
`sessions/`, `*.map`, `node_modules/`, `__pycache__/`, `.venv/`, `venv/`. None present.
Result: **PASS**.

### Step 5 — Configuration Completeness
- `.env.example` exists and correctly documents that the app uses zero environment
  variables (hardcoded `PORT = 3334` in `server.js`, confirmed by source inspection).
- No environment variables are referenced anywhere in `server.js` or `index.html`, so there
  is nothing missing from `.env.example`.
- `docker-compose.yml` not present — not applicable.
- Result: **PASS**.

### Step 6 — Git History Audit
- `git log --oneline | wc -l` → **2** (expected: 1). FAIL per policy.
- `git log -p | grep -iE '(password|secret|api.?key|token)'` → only matches are
  FORK_REPORT.md prose describing the *absence* of secrets and the sanitization process
  (e.g. "## Secrets Found", "**None.**... no credentials of any kind") and the commit
  message phrase "All secrets stripped, internal references replaced..." — no actual
  secret values found in history.
- Searched all commits/blobs for original personal data (`Money Magician`, `Ask Seve`,
  `moneymagician`, `askseve`, `smallbusiness`, `r/travel`, `r/freelance`) restricted to
  `feeds.json`/`categories.json`/`seen.json` — **zero matches**. The original personal feed
  list, categories, and seen-articles list were never committed to this repo's git history;
  only the already-sanitized versions exist in any commit. Confirmed clean.
- Commit author/committer identity issue — see Critical Finding #2.
- Result: **FAIL** (multiple commits + PII in commit metadata).

## .env.example Audit

- Variables in code but NOT in `.env.example`: none (app reads no env vars).
- Variables in `.env.example` but NOT in code: none (file is an explanatory placeholder
  with no variable definitions, by design).

## Recommendation

Fix the 2 critical findings before release:
1. Squash git history to a single clean commit.
2. Rewrite git commit author/committer identity to remove the real personal name and Gmail
   address before the repository is made public.

Once both are corrected, re-run the sanitizer to confirm a clean PASS. The file-content
sanitization work (feeds.json, categories.json, seen.json, removed CLAUDE.md, excluded
lovable-handoff/) is verified correct and requires no further changes.
