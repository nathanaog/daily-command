/* Digest builder tests — run: node tests/digest.test.mjs
 * Uses recorded-format samples (tests/fixtures/*) and a fake fetch, so it
 * never touches the network. Covers parsing all feed formats, YouTube name/
 * handle resolution, the Shorts-free playlist fallback, Reddit blocking,
 * age/count limits, de-duplication and keyword scoring maths.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, channelFromPage, channelFromSearch, canonicalUrl, titleKey, scoreItem, normaliseKeywords, buildDigest, stripHtml, parseIsoDuration, lengthFromWatchPage, fmtLength, whyNoLength, addLengths, redditHtmlReason } from '../scripts/digest-lib.mjs';

const fx = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-13T06:00:00Z');
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); }
}
console.log('Digest builder tests');

// ---------------- parsing ----------------
await test('YouTube Atom: title, link, video id, thumbnail, views', () => {
  const f = parseFeed(fx('youtube.xml'));
  assert.equal(f.entries.length, 3);
  assert.equal(f.entries[0].videoId, 'AAAAAAAAAA1');
  assert.equal(f.entries[0].url, 'https://www.youtube.com/watch?v=AAAAAAAAAA1');
  assert.match(f.entries[0].thumb, /hqdefault/);
  assert.equal(f.entries[0].views, 48213);
  assert.equal(f.entries[0].summary, 'Fixture description & more.');
});
await test('Reddit Atom: HTML content stripped to text', () => {
  const f = parseFeed(fx('reddit.xml'));
  assert.equal(f.entries.length, 2);
  assert.equal(f.entries[0].url, 'https://www.reddit.com/r/ukpolitics/comments/abc123/fixture_thread_one/');
  assert.ok(!f.entries[0].summary.includes('<'));
});
await test('Google News RSS: source element read', () => {
  const f = parseFeed(fx('googlenews.xml'));
  assert.equal(f.entries[0].source, 'Example Times');
});
await test('Blog RSS 2.0 with CDATA HTML description', () => {
  const f = parseFeed(fx('blog.xml'));
  assert.equal(f.entries[0].summary, 'A fixture post about physics & cloud chambers.');
});
await test('HTML block page is rejected, not parsed as a feed', () => {
  assert.throws(() => parseFeed('<!doctype html><html><body>Blocked</body></html>'), /not a feed/);
});
await test('stripHtml decodes entities and numeric references', () => {
  assert.equal(stripHtml('<p>Fish &amp; chips &#8211; <b>tasty</b></p>'), 'Fish & chips – tasty');
});

// ---------------- YouTube resolution helpers ----------------
await test('channel id + title from a channel page', () => {
  assert.deepEqual(channelFromPage(fx('yt-channel-page.html')), { channelId: 'UCfixtureHandleChannel01', title: 'Fixture Handle Channel' });
});
await test('first channel from a search results page (escaped quotes in title)', () => {
  assert.deepEqual(channelFromSearch(fx('yt-search.html')), { channelId: 'UCfixtureSearchChannel01', title: 'Map "Fixture" Men' });
});

// ---------------- video lengths ----------------
await test('video length: lengthSeconds, ISO-8601 fallback, live = unknown, formatting', () => {
  assert.equal(lengthFromWatchPage(fx('yt-watch.html')), 1872);
  assert.equal(lengthFromWatchPage('<meta itemprop="duration" content="PT1H2M3S">'), 3723);
  assert.equal(lengthFromWatchPage('"lengthSeconds":"0"'), null);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(fmtLength(1872), '31:12'); assert.equal(fmtLength(4210), '1:10:10'); assert.equal(fmtLength(59), '0:59');
});

// ---------------- dedupe + scoring ----------------
await test('canonical URLs: YouTube id, tracking params, www/old, trailing slash', () => {
  assert.equal(canonicalUrl('https://www.youtube.com/watch?v=abc&t=10'), 'yt:abc');
  assert.equal(canonicalUrl('https://youtu.be/abc'), 'yt:abc');
  assert.equal(canonicalUrl('https://www.example.com/a/?utm_source=x&id=2#top'), canonicalUrl('https://example.com/a?id=2'));
  assert.equal(canonicalUrl('https://old.reddit.com/r/x/comments/1/'), canonicalUrl('https://www.reddit.com/r/x/comments/1'));
});
await test('headline key ignores " - Outlet" suffix and punctuation', () => {
  assert.equal(titleKey('Budget vote passes after late-night session - Example Times'), titleKey('Budget vote passes after late night session!'));
});
await test('keyword scoring shows the sum; whole words only (Bahn ≠ Bahnhof), case-insensitive, Unicode', () => {
  const kw = normaliseKeywords({ physics: 2, Bahn: 1, 'Gesundheitsämter': 1 });
  const a = scoreItem({ title: 'The PHYSICS of trains', summary: 'Die Bahn, again', published: '2026-10-13T01:00:00Z' }, { keywords: kw, now: NOW });
  assert.equal(a.score, 4); assert.deepEqual(a.matched, ['physics', 'Bahn']);
  assert.equal(a.why, 'physics +2 + Bahn +1 + fresh (<12 h) +1 = 4');
  const b = scoreItem({ title: 'Am Bahnhof', summary: 'Gesundheitsämter melden', published: '2026-10-11T01:00:00Z' }, { keywords: kw, boost: -1, now: NOW });
  assert.deepEqual(b.matched, ['Gesundheitsämter']); assert.equal(b.why, 'Gesundheitsämter +1 + feed boost -1 = 0');
});

// ---------------- the whole run with a fake network ----------------
function fakeNet(routes) {
  const calls = [];
  const fetchText = async url => {
    calls.push(url);
    for (const [pat, res] of routes) if (url.includes(pat)) return typeof res === 'function' ? res(url) : res;
    return { status: 404, text: 'not found' };
  };
  return { fetchText, calls };
}
const DOC = {
  updatedAt: '2026-10-13T00:00:00Z',
  defaults: { perFeed: 2, maxAgeHours: 72, hideShorts: true },
  keywords: { physics: 2 },
  feeds: [
    { id: 'yt-name', name: 'Map Men', type: 'youtube', tags: ['education', 'comedy'] },
    { id: 'yt-handle', name: 'Handle Channel', type: 'youtube', handle: '@FixtureHandle', tags: ['news'] },
    { id: 'yt-id', name: 'By Id', type: 'youtube', channelId: 'UCfixtureDirectChannel01', tags: ['gaming'], hideShorts: false },
    { id: 'rd', name: 'r/ukpolitics', type: 'reddit', tags: ['politics'] },
    { id: 'gn', name: 'Berlin news', type: 'googlenews', query: 'Berlin', tags: ['germany'] },
    { id: 'blog', name: 'Fixture blog', type: 'rss', url: 'https://blog.example.com/feed', tags: ['science'], boost: 1 },
    { id: 'blog2', name: 'Syndicated', type: 'rss', url: 'https://syndicated.example.com/rss', tags: ['news'] },
    { id: 'paused', name: 'Paused one', type: 'rss', url: 'https://x.example/rss', paused: true, tags: [] },
  ],
};
const YT = { status: 200, text: fx('youtube.xml') };
const routes = [
  ['results?search_query=Map%20Men', { status: 200, text: fx('yt-search.html') }],
  ['youtube.com/@FixtureHandle', { status: 200, text: fx('yt-channel-page.html') }],
  ['playlist_id=UULFfixtureSearchChannel01', YT],
  ['playlist_id=UULFfixtureHandleChannel01', { status: 404, text: '' }],      // no long-form playlist → fall back
  ['channel_id=UCfixtureHandleChannel01', { status: 200, text: fx('youtube2.xml') }],
  ['channel_id=UCfixtureDirectChannel01', { status: 200, text: fx('youtube3.xml') }],
  ['reddit.com/r/ukpolitics', { status: 403, text: '<html>blocked</html>' }],
  ['news.google.com/rss/search?q=Berlin&hl=en-GB', { status: 200, text: fx('googlenews.xml') }],
  ['blog.example.com/feed', { status: 200, text: fx('blog.xml') }],
  ['syndicated.example.com/rss', { status: 200, text: fx('syndicated.xml') }],
  ['watch?v=AAAAAAAAAA1', { status: 200, text: fx('yt-watch.html') }],
  ['watch?v=AAAAAAAAAA2', { status: 200, text: '<meta itemprop="duration" content="PT9M5S">' }],
  ['watch?v=', { status: 429, text: '' }],                                // other lookups fail → no length, retried next run
];

let first;
await test('full run: resolves, fetches, reports health per feed', async () => {
  const net = fakeNet(routes);
  first = await buildDigest(DOC, { fetchText: net.fetchText, now: NOW, sleep: async () => {} });
  const st = Object.fromEntries(first.digest.feeds.map(f => [f.id, f]));
  assert.equal(first.digest.feeds.length, 7, 'paused feed skipped');
  assert.equal(st['yt-name'].resolved.via, 'name search'); assert.equal(st['yt-name'].resolved.title, 'Map "Fixture" Men');
  assert.equal(st['yt-handle'].resolved.via, '@FixtureHandle');
  assert.match(st['yt-handle'].url, /channel_id=/, 'fell back from UULF playlist to channel feed');
  assert.match(st['yt-id'].url, /channel_id=UCfixtureDirectChannel01$/, 'hideShorts:false → channel feed directly');
  assert.equal(st.rd.status, 'error'); assert.equal(st.rd.http, 403); assert.match(st.rd.error, /blocked by Reddit/);
  assert.ok(net.calls.some(u => u.includes('old.reddit.com')), 'tried old.reddit fallback');
  assert.equal(st.gn.status, 'ok');
});
await test('age windows: videos up to 14 days, articles/news up to 72 h; newest 2 per feed', () => {
  const fromName = first.digest.items.filter(i => i.feedId === 'yt-name');
  assert.equal(fromName.length, 2);
  const age = i => NOW - new Date(i.published);
  assert.ok(first.digest.items.every(i => !i.published || age(i) <= (i.type === 'video' ? 336 : 72) * 3600e3));
  assert.ok(!first.digest.items.some(i => i.title === 'Telescope old post'), 'article >72 h dropped');
});
await test('a weekly channel (latest upload 4 days ago) still appears', async () => {
  const net = fakeNet([['channel_id=UCweekly', { status: 200, text: fx('youtube.xml').replace(/2026-10-1[23]T\d\d/g, '2026-10-09T10') }]]);
  const r = await buildDigest({ defaults: { hideShorts: false }, feeds: [{ id: 'w', name: 'Weekly', type: 'youtube', channelId: 'UCweeklyChannel000000001', tags: [] }] }, { fetchText: net.fetchText, now: NOW });
  assert.equal(r.digest.feeds[0].count, 3);
});
await test('dedupe: same link in two feeds merged, tags unioned, "alsoIn" kept', () => {
  const merged = first.digest.items.filter(i => i.title.startsWith('Cloud chambers'));
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].tags.sort(), ['news', 'science']);
  assert.deepEqual(merged[0].alsoIn, ['Syndicated']);
  assert.ok(first.digest.stats.duplicatesMerged >= 1);
});
await test('dedupe: same headline from Google News and a blog merged', () => {
  assert.equal(first.digest.items.filter(i => titleKey(i.title) === titleKey('Budget vote passes after late-night session')).length, 1);
});
await test('Google News: outlet becomes the source, headline cleaned', () => {
  const g = first.digest.items.find(i => i.feedId === 'gn');
  assert.equal(g.source, 'Example Times'); assert.ok(!g.title.endsWith('- Example Times'));
});
await test('scoring: keyword + feed boost + freshness, sorted by score', () => {
  const top = first.digest.items[0];
  assert.equal(top.title, 'Cloud chambers explained'); assert.equal(top.why, 'physics +2 + feed boost +1 + fresh (<12 h) +1 = 4');
  const scores = first.digest.items.map(i => i.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});
await test('second run uses the resolution cache (no YouTube search) and the same content hash', async () => {
  const net = fakeNet(routes);
  const again = await buildDigest(DOC, { fetchText: net.fetchText, now: new Date(NOW.getTime() + 60e3), cache: first.resolved, sleep: async () => {} });
  assert.ok(!net.calls.some(u => u.includes('results?search_query')));
  assert.ok(!net.calls.some(u => u.includes('youtube.com/@')));
  assert.equal(again.digest.contentHash, first.digest.contentHash);
});
await test('lengths: looked up once, cached by id, failures not cached', async () => {
  const one = first.digest.items.find(i => i.url.endsWith('AAAAAAAAAA1'));
  assert.equal(one.durationSec, 1872); assert.equal(one.duration, '31:12');
  assert.equal(first.digest.items.find(i => i.url.endsWith('AAAAAAAAAA2')).duration, '9:05');
  assert.ok(!first.digest.items.find(i => i.url.endsWith('BBBBBBBBBB1')).durationSec, 'failed lookup → no length');
  assert.deepEqual(first.videoMeta, { AAAAAAAAAA1: 1872, AAAAAAAAAA2: 545 });
  const net = fakeNet(routes);
  const again = await buildDigest(DOC, { fetchText: net.fetchText, now: NOW, cache: first.resolved, videoMeta: first.videoMeta, sleep: async () => {} });
  const watched = net.calls.filter(u => u.includes('watch?v='));
  assert.ok(!watched.some(u => u.includes('AAAAAAAAAA1') || u.includes('AAAAAAAAAA2')), 'cached ids not fetched again');
  assert.ok(watched.length >= 1, 'failed ids retried');
  assert.equal(again.digest.stats.lengthsKnown, 2);
});
await test('lengths via the YouTube Data API: 50 ids per call, key used, durations parsed', async () => {
  const items = Array.from({ length: 60 }, (_, k) => ({ type: 'video', url: `https://www.youtube.com/watch?v=${String(k).padStart(11, 'x')}` }));
  const calls = [];
  const fetchText = async url => {
    calls.push(url);
    const ids = new URL(url).searchParams.get('id').split(',');
    return { status: 200, text: JSON.stringify({ items: ids.filter((_, i) => i % 10).map(id => ({ id, contentDetails: { duration: 'PT12M30S' } })) }) };
  };
  const r = await addLengths(items, { fetchText, apiKey: 'K' });
  assert.equal(calls.length, 2, '60 ids → 2 requests'); assert.ok(calls[0].includes('key=K'));
  assert.equal(items[1].durationSec, 750); assert.equal(items[1].duration, '12:30');
  assert.equal(r.failed, 6); assert.equal(r.via, 'YouTube Data API');
});
await test('failed page lookups say why (bot check, consent, HTTP)', () => {
  assert.equal(whyNoLength({ status: 200, text: 'Sign in to confirm you’re not a bot' }), 'bot check (YouTube blocks cloud servers)');
  assert.equal(whyNoLength({ status: 200, text: '<form action="https://consent.youtube.com/save">' }), 'consent page');
  assert.equal(whyNoLength({ status: 429, text: '' }), 'HTTP 429');
});
await test('Reddit: one request at a time with a gap; rate-limit page explained', async () => {
  const log = [], sleeps = [];
  let inFlight = 0, maxInFlight = 0;
  const fetchText = async url => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); log.push(url);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    return url.includes('/r/blocked/') ? { status: 200, text: '<html><title>whoa there, pardner!</title></html>' } : { status: 200, text: fx('reddit.xml') };
  };
  const subs = ['a', 'b', 'c', 'blocked'].map(x => ({ id: 'rd-' + x, name: 'r/' + x, type: 'reddit', tags: [] }));
  const r = await buildDigest({ defaults: { redditPerRun: 10 }, feeds: subs }, { fetchText, now: NOW, sleep: async ms => { sleeps.push(ms); }, redditGapMs: 4000 });
  assert.equal(maxInFlight, 1, 'never two Reddit requests at once');
  assert.ok(sleeps.length >= 3 && sleeps.every(ms => ms === 4000), 'pauses between requests');
  assert.equal(r.digest.feeds.filter(f => f.status === 'ok').length, 3);
  assert.match(r.digest.feeds.find(f => f.id === 'rd-blocked').error, /rate-limited by Reddit/);
  assert.equal(redditHtmlReason('Your request has been blocked by network security.'), 'blocked by Reddit — common for cloud servers');
});
await test('Reddit rotation: 3 per run (oldest first), stop on rate-limit, others keep earlier posts', async () => {
  const subs = ['a', 'b', 'c', 'd', 'e'].map(x => ({ id: 'rd-' + x, name: 'r/' + x, type: 'reddit', tags: ['t'] }));
  const calls = [];
  const okNet = async url => { calls.push(url); return { status: 200, text: fx('reddit.xml').replace(/abc123|def456/g, m => m + url.split('/r/')[1].split('/')[0]) }; };
  const run1 = await buildDigest({ feeds: subs }, { fetchText: okNet, now: NOW, sleep: async () => {} });
  const st1 = Object.fromEntries(run1.digest.feeds.map(f => [f.id, f.status]));
  assert.deepEqual(st1, { 'rd-a': 'ok', 'rd-b': 'ok', 'rd-c': 'ok', 'rd-d': 'waiting', 'rd-e': 'waiting' });
  assert.equal(calls.length, 3, 'only 3 Reddit requests');
  // run 2, an hour later: d and e (never tried) plus a (oldest of the tied a–c) are this run's 3; e hits the limit; b, c carried over
  calls.length = 0;
  const limited = async url => { calls.push(url); return url.includes('/r/e/') ? { status: 200, text: '<html>whoa there, pardner!</html>' } : okNet(url); };
  const run2 = await buildDigest({ feeds: subs }, { fetchText: limited, now: new Date(NOW.getTime() + 3600e3), sleep: async () => {},
    cache: run1.resolved, previousItems: run1.digest.items });
  const f2 = Object.fromEntries(run2.digest.feeds.map(f => [f.id, f]));
  assert.equal(f2['rd-d'].status, 'ok'); assert.equal(f2['rd-e'].status, 'error');
  assert.match(f2['rd-e'].error, /rate-limited/);
  assert.equal(f2['rd-a'].status, 'ok'); assert.equal(f2['rd-b'].status, 'cached'); assert.equal(f2['rd-b'].count, 2);
  assert.ok(!calls.some(u => u.includes('old.reddit.com/r/e')), 'no second request after a rate-limit page');
  assert.equal(run2.digest.items.filter(i => i.feedId === 'rd-b').length, 2, 'carried-over posts are in the digest');
  assert.equal(run2.digest.stats.ok, 4, 'ok counts fetched (a, d) + cached (b, c)');
});
await test('unresolvable YouTube name is reported, not fatal', async () => {
  const net = fakeNet([['results?search_query', { status: 200, text: '<html>no results</html>' }]]);
  const r = await buildDigest({ feeds: [{ id: 'x', name: 'Nobody', type: 'youtube', tags: [] }] }, { fetchText: net.fetchText, now: NOW });
  assert.equal(r.digest.feeds[0].status, 'unresolved'); assert.equal(r.digest.items.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
