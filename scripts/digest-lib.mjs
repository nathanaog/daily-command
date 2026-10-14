/* Daily Command — digest builder library (runs in GitHub Actions, Node 22).
 *
 * buildDigest() takes the watchlist (feeds.json), a fetch function and the
 * current time, and returns { digest, resolved, report }. Everything that
 * touches the network goes through the injected fetchText(), so the whole
 * pipeline is unit-tested offline with recorded feed samples
 * (tests/digest.test.mjs).
 *
 * Pipeline per run:
 *   1. RESOLVE  each feed to a fetchable URL
 *      - youtube: channel_id / channel URL / @handle / plain name
 *        (name → YouTube channel search; the result's title is reported back
 *        so you can check it picked the right channel, then pin it with a handle)
 *      - reddit: r/name → top-of-day RSS (old.reddit fallback)
 *      - googlenews: a search query → Google News RSS
 *      - rss: any RSS/Atom URL (blogs, science sites)
 *   2. FETCH    all feeds, 6 at a time, 15 s timeout, one retry
 *   3. PARSE    RSS 2.0 / Atom / RSS 1.0 into one item shape
 *   4. FILTER   newest N per feed (default 5), younger than maxAgeHours (default 72)
 *   5. DEDUPE   by canonical URL (YouTube video id) and by normalised headline
 *   6. SCORE    keyword weights + feed boost + freshness, with the sum written out
 *   7. REPORT   per-feed health (ok / empty / error + HTTP code / unresolved)
 */
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';

export const UA_BOT = 'DailyCommandDigest/1.0 (personal feed reader; GitHub Actions)';
export const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, trimValues: true });
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
/** Text content of a parsed node, whatever shape the parser gave it. */
const txt = x => (x == null ? '' : typeof x === 'object' ? String(x['#text'] ?? '') : String(x)).trim();
const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Strip tags and decode the common entities (feed summaries often contain HTML). */
export function stripHtml(s) {
  return String(s || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\s+/g, ' ').trim();
}
const clip = (s, n = 280) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

function atomLink(link) {
  const links = arr(link);
  const alt = links.find(l => !l['@_rel'] || l['@_rel'] === 'alternate') || links[0];
  return alt ? (alt['@_href'] || txt(alt)) : '';
}

/** Parse RSS 2.0 / Atom / RSS 1.0 into raw entries. Throws on non-feeds (e.g. an HTML block page). */
export function parseFeed(xml) {
  if (!/^\s*(<\?xml|<rss|<feed|<rdf)/i.test(xml)) throw new Error('not a feed (got HTML or text)');
  const doc = parser.parse(xml);
  if (doc.feed) {                                                    // Atom (YouTube, Reddit, many blogs)
    return { title: txt(doc.feed.title), entries: arr(doc.feed.entry).map(e => ({
      id: txt(e.id), title: stripHtml(txt(e.title)), url: atomLink(e.link),
      published: txt(e.published) || txt(e.updated),
      summary: stripHtml(txt(e.summary) || txt(e.group?.description) || txt(e.content)),
      videoId: txt(e.videoId), thumb: e.group?.thumbnail?.['@_url'] || '',
      views: Number(e.group?.community?.statistics?.['@_views']) || undefined,
    })) };
  }
  if (doc.rss) {                                                     // RSS 2.0 (Google News, most blogs)
    const ch = doc.rss.channel || {};
    return { title: txt(ch.title), entries: arr(ch.item).map(i => ({
      id: txt(i.guid) || txt(i.link), title: stripHtml(txt(i.title)), url: txt(i.link),
      published: txt(i.pubDate) || txt(i.date), summary: stripHtml(txt(i.description) || txt(i.encoded)),
      source: txt(i.source), thumb: i.thumbnail?.['@_url'] || i.content?.['@_url'] || '',
    })) };
  }
  if (doc.RDF) {                                                     // RSS 1.0
    return { title: txt(doc.RDF.channel?.title), entries: arr(doc.RDF.item).map(i => ({
      id: txt(i.link), title: stripHtml(txt(i.title)), url: txt(i.link), published: txt(i.date), summary: stripHtml(txt(i.description)),
    })) };
  }
  throw new Error('unrecognised feed format');
}

/* ---------------- resolving feeds to URLs ---------------- */
const CH_ID = /(UC[\w-]{22})/;
/** Channel id + title from a channel page (/@handle, /c/x, /channel/UC…). */
export function channelFromPage(html) {
  const id = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
              html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/) || [])[1];
  const title = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
  return id ? { channelId: id, title: title ? stripHtml(title) : '' } : null;
}
/** First channel in a YouTube search results page (filtered to channels). */
export function channelFromSearch(html) {
  const m = html.match(/"channelRenderer":\{"channelId":"(UC[\w-]{22})","title":\{"simpleText":"((?:[^"\\]|\\.)*)"/);
  return m ? { channelId: m[1], title: JSON.parse('"' + m[2] + '"') } : null;
}
const NEWS_LOCALES = { 'en-GB': 'hl=en-GB&gl=GB&ceid=GB:en', 'en-US': 'hl=en-US&gl=US&ceid=US:en', 'de-DE': 'hl=de&gl=DE&ceid=DE:de' };
export const resolveKey = f => `${f.type}:${(f.channelId || f.handle || f.url || f.name || '').toLowerCase()}`;

/** Work out the URL(s) to fetch for one feed. Returns {urls:[…], resolved?} or throws. */
export async function resolveFeed(f, { fetchText, cache, defaults }) {
  if (f.type === 'youtube') {
    let r = null;
    const key = resolveKey(f);
    const idIn = (f.channelId || f.url || f.handle || '').match(CH_ID);
    if (idIn) r = { channelId: idIn[1], title: f.name, via: 'channel id' };
    else if (cache[key]) r = cache[key];
    else {
      const handle = (f.handle || '').replace(/^@/, '') || ((f.url || '').match(/youtube\.com\/@([\w.-]+)/) || [])[1];
      const pageUrl = handle ? `https://www.youtube.com/@${handle}` : (f.url && /youtube\.com\//.test(f.url) ? f.url : null);
      if (pageUrl) {
        const res = await fetchText(pageUrl, { browser: true });
        if (res.status !== 200) throw Object.assign(new Error(`channel page HTTP ${res.status}`), { http: res.status, unresolved: true });
        const c = channelFromPage(res.text); if (!c) throw Object.assign(new Error('no channel id on page'), { unresolved: true });
        r = { ...c, via: handle ? '@' + handle : 'channel URL' };
      } else {
        const q = encodeURIComponent(f.name);
        const res = await fetchText(`https://www.youtube.com/results?search_query=${q}&sp=EgIQAg%253D%253D`, { browser: true });
        if (res.status !== 200) throw Object.assign(new Error(`search HTTP ${res.status}`), { http: res.status, unresolved: true });
        const c = channelFromSearch(res.text); if (!c) throw Object.assign(new Error('no channel found by name'), { unresolved: true });
        r = { ...c, via: 'name search' };
      }
      r.at = new Date().toISOString();
    }
    const tail = r.channelId.slice(2);
    // "UULF" + id = the channel's long-form uploads playlist (no Shorts). Unofficial but long-standing;
    // if it ever stops working we fall back to the normal channel feed (which includes Shorts).
    const urls = (f.hideShorts ?? defaults.hideShorts)
      ? [`https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${tail}`, `https://www.youtube.com/feeds/videos.xml?channel_id=${r.channelId}`]
      : [`https://www.youtube.com/feeds/videos.xml?channel_id=${r.channelId}`];
    return { urls, resolved: r, cacheKey: key };
  }
  if (f.type === 'reddit') {
    const sub = (f.sub || f.name || '').replace(/^\/?r\//i, '').trim();
    const sort = f.sort || 'top/.rss?t=day';
    return { urls: [`https://www.reddit.com/r/${sub}/${sort}`, `https://old.reddit.com/r/${sub}/${sort}`] };
  }
  if (f.type === 'googlenews') {
    const loc = NEWS_LOCALES[f.lang || defaults.newsLang] || NEWS_LOCALES['en-GB'];
    return { urls: [`https://news.google.com/rss/search?q=${encodeURIComponent(f.query || f.name)}&${loc}`] };
  }
  if (!f.url) throw Object.assign(new Error('no URL'), { unresolved: true });
  return { urls: [f.url] };
}

/* ---------------- dedupe + scoring ---------------- */
/** Canonical form of a link: YouTube → video id; strip tracking params, fragments, trailing slashes. */
export function canonicalUrl(u, videoId) {
  if (videoId) return 'yt:' + videoId;
  try {
    const x = new URL(u);
    const v = (x.hostname.includes('youtube.com') && x.searchParams.get('v')) || (x.hostname === 'youtu.be' && x.pathname.slice(1));
    if (v) return 'yt:' + v;
    [...x.searchParams.keys()].forEach(k => { if (/^(utm_|fbclid|gclid|ref$|oc$)/.test(k)) x.searchParams.delete(k); });
    x.hash = ''; x.hostname = x.hostname.replace(/^www\.|^old\./, '');
    x.pathname = x.pathname.replace(/\/+$/, '') || '/';           // "/a/" and "/a" are the same page
    return x.toString().replace(/\/+$/, '').toLowerCase();
  } catch { return String(u).toLowerCase(); }
}
/** Headline key for catching the same story syndicated under different URLs. */
export const titleKey = t => t.toLowerCase().replace(/\s+[-–|]\s+[^-–|]{2,40}$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Keyword weights: {"physics": 2, "climate": 1}; a plain array means weight 1 each. */
export function normaliseKeywords(k) {
  if (Array.isArray(k)) return k.map(w => [w, 1]);
  return Object.entries(k || {}).map(([w, n]) => [w, Number(n) || 1]);
}
/** Score one item and write the sum out ("physics +2 + fresh +1 = 3"). */
export function scoreItem(it, { keywords, boost = 0, now }) {
  const hay = (it.title + ' ' + (it.summary || '')).toLowerCase();
  const parts = [], matched = [];
  let score = 0;
  for (const [w, n] of keywords) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(hay)) { matched.push(w); score += n; parts.push(`${w} +${n}`); }
  }
  if (boost) { score += boost; parts.push(`feed boost ${boost > 0 ? '+' : ''}${boost}`); }
  if (it.published && now - new Date(it.published) < 12 * 3600e3) { score += 1; parts.push('fresh (<12 h) +1'); }
  return { score, matched, why: parts.length ? `${parts.join(' + ')} = ${score}` : '0' };
}

/* ---------------- fetching with retry + a small concurrency pool ---------------- */
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** Real network fetch used in Actions (the tests inject a fake one). */
export function makeFetchText({ timeoutMs = 15000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  return async (url, { browser = false } = {}) => {
    const headers = browser
      ? { 'User-Agent': UA_BROWSER, 'Accept-Language': 'en-GB,en;q=0.8', Cookie: 'SOCS=CAI; CONSENT=YES+1' }  // skip YouTube's EU consent page
      : { 'User-Agent': UA_BOT, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        if ((r.status >= 500 || r.status === 429) && attempt === 0) { await sleep(2000); continue; }
        return { status: r.status, text: await r.text() };
      } catch (e) {
        if (attempt === 0) { await sleep(2000); continue; }
        return { status: 0, text: '', error: e.name === 'TimeoutError' ? 'timed out' : e.message };
      }
    }
  };
}

const typeOf = f => (f.type === 'youtube' ? 'video' : f.type === 'reddit' ? 'post' : f.type === 'googlenews' ? 'news' : 'article');

/* ---------------- video lengths (for the Listen queue) ----------------
   YouTube's RSS has no durations, so we read each NEW video's watch page once
   ("lengthSeconds" in the player data, or the itemprop="duration" meta tag) and
   cache the result by video id in video-meta.json. Unofficial: if YouTube changes
   the page, items simply show no length — nothing else breaks. */
export function parseIsoDuration(s) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s || ''));
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : NaN;
}
export function lengthFromWatchPage(html) {
  const a = html.match(/"lengthSeconds":"(\d+)"/);
  if (a && +a[1] > 0) return +a[1];
  const b = html.match(/itemprop="duration" content="(P[^"]+)"/);
  const n = b ? parseIsoDuration(b[1]) : NaN;
  return n > 0 ? n : null;                         // 0 = live stream / premiere: unknown
}
/** 1872 → "31:12", 4210 → "1:10:10" */
export function fmtLength(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
/** Why a watch-page lookup gave no length (shown in the digest stats so problems are visible). */
export function whyNoLength(r) {
  if (r.status !== 200) return r.status ? `HTTP ${r.status}` : (r.error || 'no response');
  if (/consent\.youtube\.com|before you continue to youtube/i.test(r.text)) return 'consent page';
  if (/confirm you.{0,3}re not a bot|unusual traffic/i.test(r.text)) return 'bot check (YouTube blocks cloud servers)';
  return 'no length on page';
}
/** Fill durationSec/duration on video items, fetching only ids not already cached.
    With a YouTube Data API key (free; repo secret YT_API_KEY) it uses the official videos.list
    endpoint — 50 ids per request, 1 quota unit each, of a free 10,000/day. Otherwise it reads
    each video's page, which YouTube often blocks from cloud servers. */
export async function addLengths(items, { fetchText, meta = {}, concurrency = 6, maxLookups = 300, apiKey = '' }) {
  const out = {};
  const vids = items.map(it => [it, (it.url.match(/[?&]v=([\w-]{11})/) || [])[1]]).filter(([it, id]) => it.type === 'video' && id);
  const todo = [...new Set(vids.map(([, id]) => id).filter(id => !(id in meta)))].slice(0, maxLookups);
  let looked = 0, failed = 0; const reasons = {};
  const fail = why => { failed++; reasons[why] = (reasons[why] || 0) + 1; };
  if (apiKey) {
    for (let i = 0; i < todo.length; i += 50) {
      const ids = todo.slice(i, i + 50);
      const r = await fetchText(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&maxResults=50&id=${ids.join(',')}&key=${encodeURIComponent(apiKey)}`);
      looked += ids.length;
      let got = {};
      try { if (r.status === 200) for (const v of JSON.parse(r.text).items || []) { const n = parseIsoDuration(v.contentDetails?.duration); if (n > 0) got[v.id] = n; } } catch (e) {}
      for (const id of ids) got[id] ? (meta[id] = got[id]) : fail(r.status === 200 ? 'not returned by API (live/private?)' : `API HTTP ${r.status}`);
    }
  } else {
    await pool(todo, concurrency, async id => {
      const r = await fetchText(`https://www.youtube.com/watch?v=${id}`, { browser: true });
      looked++;
      const sec = r.status === 200 ? lengthFromWatchPage(r.text) : null;
      if (sec) meta[id] = sec; else fail(whyNoLength(r));   // failures aren't cached → retried next run
    });
  }
  for (const [it, id] of vids) {
    const sec = meta[id];
    if (sec) { it.durationSec = sec; it.duration = fmtLength(sec); out[id] = sec; }
  }
  return { meta: out, looked, failed, reasons, via: apiKey ? 'YouTube Data API' : 'video pages' };   // only ids still in the digest → cache stays small
}

/* ---------------- the whole run ---------------- */
export async function buildDigest(doc, { fetchText, now = new Date(), cache = {}, videoMeta = {}, concurrency = 6, ytApiKey = '',
  redditGapMs = 4000, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  // Serialise Reddit: each request waits for the previous one, then `redditGapMs` (default 4 s).
  let chain = Promise.resolve(), first = true;
  const redditGate = job => {
    const run = chain.then(async () => { if (!first) await sleep(redditGapMs); first = false; return job(); });
    chain = run.catch(() => {});
    return run;
  };
  // Age windows: news/Reddit go stale fast (72 h); YouTube channels often post weekly, so videos get 14 days.
  const defaults = { perFeed: 5, maxAgeHours: 72, maxAgeHoursVideo: 336, newsLang: 'en-GB', hideShorts: true, maxItems: 400, ...(doc.defaults || {}) };
  const keywords = normaliseKeywords(doc.keywords);
  const resolvedOut = { ...cache };
  const feeds = (doc.feeds || []).filter(f => f && f.name && !f.paused);
  const report = [];

  const perFeed = await pool(feeds, concurrency, async f => {
    const rep = { id: f.id, name: f.name, type: f.type, status: 'ok', count: 0 };
    report.push(rep);
    let plan;
    try { plan = await resolveFeed(f, { fetchText, cache, defaults }); }
    catch (e) { Object.assign(rep, { status: 'unresolved', error: e.message, http: e.http }); return []; }
    if (plan.resolved) { rep.resolved = { channelId: plan.resolved.channelId, title: plan.resolved.title, via: plan.resolved.via }; resolvedOut[plan.cacheKey] = plan.resolved; }

    let parsed = null, lastErr = '', lastHttp;
    // Reddit rate-limits bursts, so its requests go through a one-at-a-time gate with a pause between them.
    const get = f.type === 'reddit' ? url => redditGate(() => fetchText(url)) : fetchText;
    for (const url of plan.urls) {                         // try primary, then fallback URL
      const res = await get(url);
      if (res.status !== 200) { lastHttp = res.status; lastErr = res.error || httpReason(res.status, f.type); continue; }
      try { parsed = parseFeed(res.text); rep.url = url; break; }
      catch (e) { lastErr = f.type === 'reddit' ? redditHtmlReason(res.text) : e.message; }
    }
    if (!parsed) { Object.assign(rep, { status: 'error', error: lastErr, http: lastHttp }); return []; }

    const maxAge = (f.maxAgeHours || (f.type === 'youtube' ? defaults.maxAgeHoursVideo : defaults.maxAgeHours)) * 3600e3;
    const fresh = parsed.entries
      .filter(e => e.title && e.url)
      .map(e => ({ ...e, publishedD: e.published ? new Date(e.published) : null }))
      .filter(e => !e.publishedD || (!isNaN(e.publishedD) && now - e.publishedD <= maxAge && e.publishedD - now < 3600e3))
      .sort((a, b) => (b.publishedD || 0) - (a.publishedD || 0))
      .slice(0, f.max || defaults.perFeed);
    rep.count = fresh.length;
    if (!fresh.length) rep.status = parsed.entries.length ? 'ok' : 'empty';

    return fresh.map(e => {
      // Google News titles end with " - Source"; keep the headline clean and the outlet as the source
      let title = e.title, source = f.name;
      if (f.type === 'googlenews' && e.source) { source = e.source; title = title.replace(new RegExp(`\\s+-\\s+${e.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ''); }
      const it = { title, url: e.url, source, feedId: f.id, type: typeOf(f), tags: [...(f.tags || [])],
        published: e.publishedD ? e.publishedD.toISOString() : null, summary: clip(e.summary || ''),
        thumb: e.thumb || undefined };
      it.canon = canonicalUrl(e.url, e.videoId);
      it.id = sha(it.canon);
      return Object.assign(it, scoreItem(it, { keywords, boost: Number(f.boost) || 0, now }));
    });
  });

  // ---- dedupe: same link, or the same headline from two outlets ----
  const byCanon = new Map(), byTitle = new Map(), items = [];
  for (const it of perFeed.flat()) {
    const tk = titleKey(it.title);
    const dup = byCanon.get(it.canon) || (tk.length >= 25 ? byTitle.get(tk) : null);
    if (dup) {
      dup.tags = [...new Set([...dup.tags, ...it.tags])];
      if (it.source !== dup.source) dup.alsoIn = [...new Set([...(dup.alsoIn || []), it.source])];
      if (it.score > dup.score) Object.assign(dup, { score: it.score, matched: it.matched, why: it.why });
      continue;
    }
    byCanon.set(it.canon, it); if (tk.length >= 25) byTitle.set(tk, it); items.push(it);
  }
  items.forEach(it => { delete it.canon; if (!it.thumb) delete it.thumb; });
  items.sort((a, b) => (b.score - a.score) || (new Date(b.published || 0) - new Date(a.published || 0)));
  const kept = items.slice(0, defaults.maxItems);
  const lengths = await addLengths(kept, { fetchText, meta: { ...videoMeta }, concurrency, apiKey: ytApiKey });

  report.sort((a, b) => feeds.findIndex(f => f.id === a.id) - feeds.findIndex(f => f.id === b.id));
  const ok = report.filter(r => r.status === 'ok').length;
  const digest = {
    generated: now.toISOString(),
    watchlistUpdatedAt: doc.updatedAt || null,
    stats: { feeds: report.length, ok, items: kept.length, duplicatesMerged: perFeed.flat().length - items.length,
      lengthsKnown: kept.filter(i => i.durationSec).length, lengthLookups: lengths.looked, lengthFailures: lengths.failed,
      lengthVia: lengths.via, lengthFailReasons: lengths.reasons },
    feeds: report,
    items: kept,
  };
  // contentHash ignores the timestamp, so the workflow only commits when something actually changed
  digest.contentHash = sha(JSON.stringify([kept.map(i => [i.id, i.score, i.tags.join(), i.durationSec || 0]), report.map(r => [r.id, r.status, r.count])]));
  return { digest, resolved: resolvedOut, videoMeta: lengths.meta };
}

/** What Reddit's HTML (instead of a feed) means, so the health line is specific. */
export function redditHtmlReason(html) {
  if (/whoa there|too many requests|rate.?limit/i.test(html)) return 'rate-limited by Reddit (sent a web page, not a feed)';
  if (/network (security|policy)|blocked/i.test(html)) return 'blocked by Reddit — common for cloud servers';
  return 'Reddit sent a web page instead of a feed (probably rate-limiting)';
}
function httpReason(status, type) {
  if (status === 403 && type === 'reddit') return 'blocked by Reddit (403) — common for cloud servers';
  if (status === 403) return 'blocked (403)';
  if (status === 404) return 'not found (404)';
  if (status === 429) return 'rate-limited (429)';
  if (status === 0) return 'no response';
  return `HTTP ${status}`;
}
