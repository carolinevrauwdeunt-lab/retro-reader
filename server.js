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
const CACHE_TTL_MS = 5 * 60 * 1000;
const REDDIT_CACHE_TTL_MS = 20 * 60 * 1000;

let feedCache = new Map(); // url -> { items, fetchedAt }
let ogImageCache = new Map(); // article link -> image url ('' if none found)
const OG_IMAGE_TIMEOUT_MS = 4000;
const OG_IMAGE_CONCURRENCY = 6;

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
      headers: { 'User-Agent': 'retro-reader/1.0 (+https://github.com/carolinevrauwdeunt-lab/retro-reader)' },
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
      link: link.trim(),
      published,
      author: stripTags(author),
      summary: stripTags(summaryRaw).slice(0, 280),
      image: image.trim(),
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
        headers: { 'User-Agent': 'retro-reader/1.0 (+https://github.com/carolinevrauwdeunt-lab/retro-reader)' },
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
    const image = m ? attr(m[0], 'content') : '';
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
      isNew: !seen.has(it.link),
    }));
    if (feed.group === 'Tech' || feed.group === 'News' || feed.group === 'Design' || feed.group === 'Substack') {
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

async function getAllItems(groupFilter) {
  const feeds = loadFeeds().filter((f) => !groupFilter || f.group === groupFilter);
  const redditFeeds = feeds.filter((f) => f.url.includes('reddit.com'));
  const otherFeeds = feeds.filter((f) => !f.url.includes('reddit.com'));
  const results = [];
  const FETCH_CONCURRENCY = 4;
  for (let i = 0; i < otherFeeds.length; i += FETCH_CONCURRENCY) {
    const batch = otherFeeds.slice(i, i + FETCH_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(getFeedItems))));
  }
  // Reddit rate-limits aggressively (429s) when hit with several requests at once,
  // so its feeds are fetched one at a time with a gap instead of in concurrent batches.
  for (let i = 0; i < redditFeeds.length; i++) {
    results.push(await getFeedItems(redditFeeds[i]));
    if (i < redditFeeds.length - 1) await new Promise((r) => setTimeout(r, REDDIT_FETCH_GAP_MS));
  }
  const all = results.flat();
  all.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  return all;
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
    const items = await getAllItems(query.group);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(items));
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
