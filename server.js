const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3334;
const FEEDS_PATH = path.join(__dirname, 'feeds.json');
const SEEN_PATH = path.join(__dirname, 'seen.json');
const PRESETS_PATH = path.join(__dirname, 'presets.json');
const CATEGORIES_PATH = path.join(__dirname, 'categories.json');
const WATCHLIST_PATH = path.join(__dirname, 'watchlist.json');
const CACHE_TTL_MS = 5 * 60 * 1000;
const REDDIT_CACHE_TTL_MS = 20 * 60 * 1000;
const STOCK_CACHE_TTL_MS = 2 * 60 * 1000;

let feedCache = new Map(); // url -> { items, fetchedAt }
let ogImageCache = new Map(); // article link -> image url ('' if none found)
let stockCache = new Map(); // ticker -> { data, fetchedAt }
const OG_IMAGE_TIMEOUT_MS = 4000;
const OG_IMAGE_CONCURRENCY = 6;

function loadWatchlist() {
  if (!fs.existsSync(WATCHLIST_PATH)) return ['AAPL', 'MSFT', 'GOOGL', 'SPY'];
  try {
    const list = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list) {
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(list, null, 2) + '\n');
}

async function fetchChartData(ticker, range = '1mo') {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
  const raw = await fetchUrl(target);
  const json = JSON.parse(raw);
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result) return null;
  const meta = result.meta;
  if (typeof meta.regularMarketPrice !== 'number' || typeof meta.chartPreviousClose !== 'number') return null;

  const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  const timestamps = result.timestamp || [];
  const history = [];
  const historyTimestamps = [];
  closes.forEach((c, i) => {
    if (typeof c === 'number') {
      history.push(c);
      historyTimestamps.push(timestamps[i]);
    }
  });

  return {
    ticker,
    name: meta.shortName || meta.longName || ticker,
    currency: meta.currency,
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose,
    change: meta.regularMarketPrice - meta.chartPreviousClose,
    changePct: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    history,
    timestamps: historyTimestamps,
  };
}

// Indices (e.g. AEX, FTSE, DAX) are listed on Yahoo with a leading caret (^AEX),
// so a plain symbol lookup can silently match an unrelated/defunct instrument instead.
async function fetchStockData(ticker, range = '1mo') {
  const cached = stockCache.get(ticker + ':' + range);
  if (cached && Date.now() - cached.fetchedAt < STOCK_CACHE_TTL_MS) return cached.data;

  let data = await fetchChartData(ticker, range);
  if (!data && !ticker.startsWith('^')) {
    data = await fetchChartData('^' + ticker, range);
  }
  if (!data) throw new Error('No data for ' + ticker);

  stockCache.set(ticker + ':' + range, { data, fetchedAt: Date.now() });
  return data;
}

function loadFeeds() {
  return JSON.parse(fs.readFileSync(FEEDS_PATH, 'utf8'));
}

function loadPresets() {
  if (!fs.existsSync(PRESETS_PATH)) return [];
  return JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
}

function addFeeds(newFeeds) {
  const feeds = loadFeeds();
  const existingUrls = new Set(feeds.map((f) => f.url));
  const added = [];
  for (const f of newFeeds) {
    if (!f || !f.group || !f.name || !f.url) continue;
    if (existingUrls.has(f.url)) continue;
    feeds.push({ group: f.group, name: f.name, url: f.url });
    existingUrls.add(f.url);
    added.push(f);
  }
  if (added.length) {
    fs.writeFileSync(FEEDS_PATH, JSON.stringify(feeds, null, 2) + '\n');
  }
  return { feeds, added };
}

function loadCategories() {
  if (!fs.existsSync(CATEGORIES_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf8')); } catch { return []; }
}

function addCategory(name) {
  const categories = loadCategories();
  if (!categories.includes(name)) {
    categories.push(name);
    fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(categories, null, 2) + '\n');
  }
  return categories;
}

function removeFeed(feedUrl) {
  const feeds = loadFeeds();
  const next = feeds.filter((f) => f.url !== feedUrl);
  const removed = next.length !== feeds.length;
  if (removed) {
    fs.writeFileSync(FEEDS_PATH, JSON.stringify(next, null, 2) + '\n');
  }
  return { ok: removed, feeds: next };
}

function removeCategory(name) {
  const feeds = loadFeeds();
  if (feeds.some((f) => f.group === name)) {
    return { ok: false, error: 'Category still has feeds in it' };
  }
  const categories = loadCategories();
  const next = categories.filter((c) => c !== name);
  const removed = next.length !== categories.length;
  if (removed) {
    fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(next, null, 2) + '\n');
  }
  return { ok: removed, categories: next };
}

function moveFeed(feedUrl, newGroup) {
  const feeds = loadFeeds();
  const feed = feeds.find((f) => f.url === feedUrl);
  if (!feed) return { ok: false, error: 'Feed not found' };
  feed.group = newGroup;
  fs.writeFileSync(FEEDS_PATH, JSON.stringify(feeds, null, 2) + '\n');
  return { ok: true, feeds };
}

function loadSeen() {
  if (fs.existsSync(SEEN_PATH)) {
    try { return new Set(JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'))); } catch { return new Set(); }
  }
  return new Set();
}

function saveSeen(seenSet) {
  const arr = Array.from(seenSet).slice(-3000);
  fs.writeFileSync(SEEN_PATH, JSON.stringify(arr));
}

let seen = loadSeen();

function fetchUrl(target) {
  return new Promise((resolve, reject) => {
    const client = target.startsWith('http://') ? http : https;
    const req = client.get(target, {
      headers: { 'User-Agent': 'retro-reader/1.0 (+https://github.com/ANDRS-Projects/retro-reader)' },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const resolved = new URL(res.headers.location, target).toString();
        fetchUrl(resolved).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function unwrapCdata(str) {
  const m = str.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : str;
}

function stripTags(str) {
  return decodeEntities(unwrapCdata(str)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '=["\']([^"\']*)["\']'));
  return m ? decodeEntities(m[1]) : '';
}

// Allowlist HTML sanitizer for rendering third-party feed content in the
// in-app article reader. Rebuilds every surviving tag from scratch with only
// known-safe attributes rather than trying to blacklist dangerous ones, so
// nothing we didn't explicitly handle (event handlers, javascript: URLs,
// style-based attacks, etc.) can pass through.
const READER_ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'a', 'img', 'figure', 'figcaption', 'pre', 'code', 'span', 'div', 'hr',
]);

function sanitizeHtml(rawHtml) {
  let html = decodeEntities(unwrapCdata(rawHtml));

  // Remove dangerous elements entirely, including their content.
  html = html.replace(
    /<(script|style|iframe|object|embed|noscript|form|applet|audio|video|link|meta|base)[^>]*>[\s\S]*?<\/\1>/gi,
    ''
  );
  html = html.replace(/<(meta|base|embed|link|source|track)[^>]*\/?>/gi, '');

  // Defense in depth in case any slipped past the element strip above.
  html = html.replace(/\son\w+\s*=\s*"[^"]*"/gi, '').replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  html = html.replace(/javascript:/gi, '');

  // Rebuild every remaining tag from an allowlist with only safe attributes —
  // anything not explicitly handled here is dropped, not merely "cleaned".
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (full, tagName) => {
    const tag = tagName.toLowerCase();
    if (!READER_ALLOWED_TAGS.has(tag)) return '';
    if (full.startsWith('</')) return `</${tag}>`;
    if (tag === 'a') {
      const href = attr(full, 'href');
      if (href && /^https?:\/\//i.test(href)) {
        return `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer nofollow">`;
      }
      return '<a>';
    }
    if (tag === 'img') {
      const src = attr(full, 'src');
      const alt = attr(full, 'alt');
      if (src && /^https?:\/\//i.test(src)) {
        return `<img src="${src.replace(/"/g, '&quot;')}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy">`;
      }
      return '';
    }
    return `<${tag}>`;
  });

  return html.trim();
}

function extractImage(block, summaryRaw) {
  const mediaContents = block.match(/<media:content[^>]*\/?>/g) || [];
  for (const tag of mediaContents) {
    const url = attr(tag, 'url');
    const medium = attr(tag, 'medium');
    if (url && (medium === 'image' || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url))) return url;
  }
  const thumb = block.match(/<media:thumbnail[^>]*\/?>/);
  if (thumb) {
    const url = attr(thumb[0], 'url');
    if (url) return url;
  }
  const enclosures = block.match(/<enclosure[^>]*\/?>/g) || [];
  for (const tag of enclosures) {
    const url = attr(tag, 'url');
    const type = attr(tag, 'type');
    if (url && type.startsWith('image/')) return url;
  }
  const body = decodeEntities(unwrapCdata(summaryRaw));
  const imgInBody = body.match(/<img[^>]*src=["']([^"']+)["']/);
  if (imgInBody) return imgInBody[1];
  return '';
}

function parseFeed(xml) {
  const items = [];
  // Atom <entry> (Reddit's format) or RSS <item>
  const blocks = xml.match(/<entry[^>]*>[\s\S]*?<\/entry>/g) || xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
    let link = (block.match(/<link[^>]*href="([^"]*)"/) || [])[1]
      || (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const published = (block.match(/<published>([\s\S]*?)<\/published>/) || [])[1]
      || (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]
      || (block.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || '';
    const author = (block.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '';
    const summaryRaw = (block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || [])[1]
      || (block.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1]
      || (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1]
      || (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';

    const image = extractImage(block, summaryRaw);

    items.push({
      title: stripTags(title).slice(0, 200),
      // Some feeds (e.g. ESPN) wrap <link> in CDATA, same as other text
      // fields — unwrap it the same way, or it ends up as the literal
      // string "<![CDATA[https://...]]>" instead of a usable URL, silently
      // breaking og:image backfill, "Open original", and mark-seen.
      link: decodeEntities(unwrapCdata(link)).trim(),
      published,
      author: stripTags(author),
      summary: stripTags(summaryRaw).slice(0, 280),
      image: image.trim(),
      // Full sanitized content for the in-app reader panel — not truncated
      // like `summary`, since feeds that publish full-text content (many
      // Substack/blog feeds) should be readable in-app without leaving the
      // app. Feeds that only ever provide a short teaser (BBC, NYT, etc.)
      // will simply have content no longer than summary — that's the real
      // length the publisher provides, not a limitation of this app.
      content: sanitizeHtml(summaryRaw.slice(0, 200000)),
    });
  }
  return items;
}

async function fetchOgImage(link) {
  if (ogImageCache.has(link)) return ogImageCache.get(link);
  try {
    const client = link.startsWith('http://') ? http : https;
    const html = await new Promise((resolve, reject) => {
      const req = client.get(link, {
        headers: { 'User-Agent': 'retro-reader/1.0 (+https://github.com/ANDRS-Projects/retro-reader)' },
        timeout: OG_IMAGE_TIMEOUT_MS,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const resolved = new URL(res.headers.location, link).toString();
          fetchUrl(resolved).then(resolve, reject);
          return;
        }
        let data = '';
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          data += chunk;
          if (bytes > 200000) {
            res.destroy();
            resolve(data);
          }
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
    });
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i) || html.match(/<meta[^>]+name=["']og:image["'][^>]*>/i);
    const raw = m ? attr(m[0], 'content') : '';
    // Some pages publish a relative og:image URL (e.g. "/images/x.png").
    // Resolve it against the article's own URL so the frontend always gets
    // an absolute URL — otherwise it would try to load it relative to the
    // reader app's own origin instead of the source site's.
    let image = '';
    if (raw) {
      try {
        image = new URL(raw, link).toString();
      } catch {
        image = '';
      }
    }
    ogImageCache.set(link, image);
    return image;
  } catch (e) {
    ogImageCache.set(link, '');
    return '';
  }
}

async function fillMissingImages(items) {
  const missing = items.filter((it) => !it.image && it.link);
  for (let i = 0; i < missing.length; i += OG_IMAGE_CONCURRENCY) {
    const batch = missing.slice(i, i + OG_IMAGE_CONCURRENCY);
    await Promise.all(batch.map(async (it) => {
      it.image = await fetchOgImage(it.link);
    }));
  }
  return items;
}

async function getFeedItems(feed) {
  const cached = feedCache.get(feed.url);
  // Reddit's unauthenticated RSS rate limit is shared across the whole domain (not per
  // subreddit), so with many reddit feeds in one category a short TTL forces refetches
  // that just get 429'd. Keep reddit results around much longer once fetched.
  const ttl = feed.url.includes('reddit.com') ? REDDIT_CACHE_TTL_MS : CACHE_TTL_MS;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.items;
  }
  try {
    const xml = await fetchUrl(feed.url);
    const items = parseFeed(xml).map((it) => ({
      ...it,
      feedName: feed.name,
      feedGroup: feed.group,
      feedUrl: feed.url,
      isNew: !seen.has(it.link),
    }));
    // Skip og:image backfill only for Reddit — its linked pages rarely have a
    // usable og:image and scraping dozens of them would add load on top of
    // Reddit's already-tight rate limit. Every other feed gets backfill
    // regardless of category, so a blog/Substack-style feed in any group
    // (not just a fixed allowlist) still gets its images.
    if (!feed.url.includes('reddit.com')) {
      await fillMissingImages(items);
    }
    feedCache.set(feed.url, { items, fetchedAt: Date.now() });
    return items;
  } catch (e) {
    return cached ? cached.items : [];
  }
}

function extractFeedTitle(xml) {
  const channelTitle = (xml.match(/<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
  const feedTitle = (xml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/) || [])[1];
  let title = stripTags(channelTitle || feedTitle || '');
  // Some feeds (e.g. Design Milk) literally repeat their title twice in the source XML.
  const half = title.slice(0, title.length / 2);
  if (title.length % 2 === 0 && half + half === title) {
    title = half;
  }
  return title;
}

async function tryParseFeed(feedUrl) {
  const xml = await fetchUrl(feedUrl);
  const items = parseFeed(xml);
  if (!items.length) return null;
  return { xml, items };
}

async function validateFeedUrl(feedUrl) {
  let parsed;
  try {
    parsed = new URL(feedUrl);
  } catch {
    return { ok: false, error: 'Not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'URL must be http or https' };
  }
  try {
    const direct = await tryParseFeed(feedUrl);
    if (direct) {
      return { ok: true, resolvedUrl: feedUrl, title: extractFeedTitle(direct.xml) || parsed.hostname, itemCount: direct.items.length };
    }
    // Not a feed itself (e.g. a Substack post/publication link) — try the conventional /feed path.
    if (parsed.pathname.replace(/\/+$/, '') !== '/feed') {
      const feedGuess = `${parsed.protocol}//${parsed.host}/feed`;
      try {
        const guessed = await tryParseFeed(feedGuess);
        if (guessed) {
          return { ok: true, resolvedUrl: feedGuess, title: extractFeedTitle(guessed.xml) || parsed.hostname, itemCount: guessed.items.length };
        }
      } catch {}
    }
    return { ok: false, error: 'No items found — this may not be a valid RSS/Atom feed' };
  } catch (e) {
    return { ok: false, error: 'Could not fetch that URL' };
  }
}

const REDDIT_FETCH_GAP_MS = 3000;

// Surfaces how stale a response could be: the oldest fetchedAt among the
// given feeds. A feed with no cache entry yet (first-ever fetch, or a hard
// failure with nothing cached) doesn't count as "stale" — there's simply no
// prior fetch time to report for it.
function oldestFetchedAtForFeeds(feeds) {
  let oldest = null;
  for (const feed of feeds) {
    const cached = feedCache.get(feed.url);
    if (cached && (oldest === null || cached.fetchedAt < oldest)) {
      oldest = cached.fetchedAt;
    }
  }
  return oldest;
}

async function fetchFeedsConcurrently(feeds) {
  const results = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < feeds.length; i += CONCURRENCY) {
    const batch = feeds.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map(getFeedItems))));
  }
  return results.flat();
}

// Non-Reddit feeds only — fast, fetched concurrently. Kept separate from
// Reddit so the UI can render this immediately instead of blocking on
// Reddit's slow, rate-limited sequential fetch below.
async function getFastItems(groupFilter) {
  const feeds = loadFeeds().filter((f) => !groupFilter || f.group === groupFilter);
  const otherFeeds = feeds.filter((f) => !f.url.includes('reddit.com'));
  const hasRedditFeeds = feeds.some((f) => f.url.includes('reddit.com'));
  const items = await fetchFeedsConcurrently(otherFeeds);
  items.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  return { items, oldestFetchedAt: oldestFetchedAtForFeeds(otherFeeds), hasRedditFeeds };
}

// Reddit rate-limits aggressively (429s) when hit with several requests at
// once, so its feeds are fetched one at a time with a gap instead of in
// concurrent batches — this is what makes Reddit slow, hence the split above.
async function getRedditItems(groupFilter) {
  const feeds = loadFeeds().filter((f) => !groupFilter || f.group === groupFilter);
  const redditFeeds = feeds.filter((f) => f.url.includes('reddit.com'));
  const results = [];
  for (let i = 0; i < redditFeeds.length; i++) {
    results.push(await getFeedItems(redditFeeds[i]));
    if (i < redditFeeds.length - 1) await new Promise((r) => setTimeout(r, REDDIT_FETCH_GAP_MS));
  }
  const items = results.flat();
  items.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  return { items, oldestFetchedAt: oldestFetchedAtForFeeds(redditFeeds) };
}

const HTML_PATH = path.join(__dirname, 'index.html');

const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(fs.readFileSync(HTML_PATH, 'utf8'));
    return;
  }

  if (pathname === '/api/feeds' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(loadFeeds()));
    return;
  }

  if (pathname === '/api/feeds' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { feeds } = JSON.parse(body);
        const { feeds: allFeeds, added } = addFeeds(Array.isArray(feeds) ? feeds : []);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, added: added.length, feeds: allFeeds }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  if (pathname === '/api/feeds' && req.method === 'DELETE') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { url: feedUrl } = JSON.parse(body);
        if (!feedUrl) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'Missing url' }));
          return;
        }
        const result = removeFeed(String(feedUrl));
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = result.ok ? 200 : 404;
        res.end(JSON.stringify(result));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/categories' && req.method === 'DELETE') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!name) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'Missing name' }));
          return;
        }
        const result = removeCategory(String(name));
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = result.ok ? 200 : 409;
        res.end(JSON.stringify(result));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/feeds/move' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { url: feedUrl, group } = JSON.parse(body);
        if (!feedUrl || !group) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'Missing url or group' }));
          return;
        }
        const result = moveFeed(String(feedUrl), String(group));
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = result.ok ? 200 : 404;
        res.end(JSON.stringify(result));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/categories' && req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(loadCategories()));
    return;
  }

  if (pathname === '/api/categories' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        const trimmed = String(name || '').trim();
        if (!trimmed) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'Missing name' }));
          return;
        }
        const categories = addCategory(trimmed);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, categories }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/presets') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(loadPresets()));
    return;
  }

  if (pathname === '/api/watchlist' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(loadWatchlist()));
    return;
  }

  if (pathname === '/api/watchlist' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { ticker } = JSON.parse(body);
        const t = String(ticker || '').trim().toUpperCase();
        if (!t) throw new Error('Missing ticker');

        let resolved;
        try {
          resolved = await fetchStockData(t);
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: `Could not find a quote for "${t}" on Yahoo Finance.` }));
          return;
        }

        const list = loadWatchlist();
        if (!list.includes(resolved.ticker)) list.push(resolved.ticker);
        saveWatchlist(list);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, watchlist: list }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/watchlist' && req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { tickers } = JSON.parse(body);
        if (!Array.isArray(tickers)) throw new Error('Missing tickers');
        const current = new Set(loadWatchlist());
        const next = tickers.filter((t) => current.has(t));
        saveWatchlist(next);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, watchlist: next }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/watchlist' && req.method === 'DELETE') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { ticker } = JSON.parse(body);
        const t = String(ticker || '').trim().toUpperCase();
        const list = loadWatchlist().filter((x) => x !== t);
        saveWatchlist(list);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, watchlist: list }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/stocks' && req.method === 'GET') {
    try {
      const tickers = query.tickers ? String(query.tickers).split(',').filter(Boolean) : loadWatchlist();
      const results = await Promise.all(
        tickers.map(async (t) => {
          try {
            return await fetchStockData(t);
          } catch (e) {
            return { ticker: t, error: e.message };
          }
        })
      );
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } catch {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: 'Failed to fetch stocks' }));
    }
    return;
  }

  if (pathname === '/api/stock-search' && req.method === 'GET') {
    try {
      const q = String(query.q || '').trim();
      if (!q) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([]));
        return;
      }
      const target = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
      const raw = await fetchUrl(target);
      const json = JSON.parse(raw);
      const results = (json.quotes || [])
        .filter((qt) => qt.symbol && (qt.quoteType === 'EQUITY' || qt.quoteType === 'ETF' || qt.quoteType === 'INDEX' || qt.quoteType === 'CRYPTOCURRENCY' || qt.quoteType === 'MUTUALFUND'))
        .map((qt) => ({
          symbol: qt.symbol,
          name: qt.shortname || qt.longname || qt.symbol,
          exchange: qt.exchDisp || qt.exchange || '',
          type: qt.typeDisp || qt.quoteType || '',
        }));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(results));
    } catch {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([]));
    }
    return;
  }

  if (pathname === '/api/stock-detail' && req.method === 'GET') {
    try {
      const ticker = String(query.ticker || '').trim();
      const range = String(query.range || '6mo');
      if (!ticker) throw new Error('Missing ticker');
      const data = await fetchStockData(ticker, range);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    } catch (e) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/validate-feed' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { url: feedUrl } = JSON.parse(body);
        const result = await validateFeedUrl(String(feedUrl || ''));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/validate-feeds' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { urls } = JSON.parse(body);
        const list = (Array.isArray(urls) ? urls : []).map((u) => String(u || '').trim()).filter(Boolean);
        const results = await Promise.all(
          list.map(async (u) => ({ url: u, ...(await validateFeedUrl(u)) }))
        );
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, results }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/items') {
    const { items, oldestFetchedAt, hasRedditFeeds } = await getFastItems(query.group);
    // Strip the full sanitized `content` field from the listing response —
    // it can be tens of KB per item (full-text blog/Substack feeds), which
    // would bloat "All feeds" payloads for content nobody's opened yet. The
    // in-app reader fetches it on demand via /api/article-content instead.
    const trimmed = items.map(({ content, ...rest }) => rest);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ items: trimmed, oldestFetchedAt, hasRedditFeeds }));
    return;
  }

  if (pathname === '/api/items/reddit') {
    const { items, oldestFetchedAt } = await getRedditItems(query.group);
    const trimmed = items.map(({ content, ...rest }) => rest);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ items: trimmed, oldestFetchedAt }));
    return;
  }

  if (pathname === '/api/article-content') {
    const feedUrl = query.feedUrl;
    const link = query.link;
    if (!feedUrl || !link) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Missing feedUrl or link' }));
      return;
    }
    const feed = loadFeeds().find((f) => f.url === feedUrl);
    if (!feed) {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: 'Feed not found' }));
      return;
    }
    const items = await getFeedItems(feed);
    const item = items.find((it) => it.link === link);
    if (!item) {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: 'Article not found' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, title: item.title, content: item.content, image: item.image, link: item.link }));
    return;
  }

  if (pathname === '/api/mark-seen' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { link } = JSON.parse(body);
        if (link) {
          seen.add(link);
          saveSeen(seen);
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  if (pathname === '/api/refresh') {
    feedCache.clear();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, 'localhost', () => {
  console.log(`\n  Retro RSS Reader\n`);
  console.log(`  -> http://localhost:${PORT}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
