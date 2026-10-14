/* End-to-end: run the real builder over the real feeds.json with a simulated
 * network, and write the result to a file (used by the browser checks).
 *   node tests/e2e-build.mjs <out.json>
 * Simulated: every YouTube name resolves (one to a *different* channel, one not
 * at all), each channel has 3 uploads at varied ages, plus an extra blocked
 * subreddit and a Google News search added to a copy of the watchlist.
 * All titles are marked [test] — none of this is real content.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildDigest } from '../scripts/digest-lib.mjs';

const out = process.argv[2] || 'e2e-digest.json';
const doc = JSON.parse(readFileSync(new URL('../feeds.json', import.meta.url), 'utf8'));
doc.keywords = { physics: 2, Berlin: 1, election: 1 };
doc.feeds.push({ id: 'rd-ukpolitics', name: 'r/ukpolitics', type: 'reddit', tags: ['politics'], added: '2026-10-13' },
               { id: 'gn-berlin', name: 'Berlin news', type: 'googlenews', query: 'Berlin', tags: ['news', 'germany'], added: '2026-10-13' });
const NOW = new Date('2026-10-13T05:40:00Z');
const chId = name => 'UC' + createHash('md5').update(name).digest('base64url').slice(0, 22);
const words = ['physics of a dripping tap', 'why maps lie', 'the election explained', 'a week in Berlin', 'ranking every sequel', 'how prices work', 'a cheap train trip', 'the best worst idea'];
const atom = (name, id) => {
  const e = [0, 1, 2].map(k => {
    const vid = createHash('md5').update(name + k).digest('hex').slice(0, 11);
    const h = (name.length * 7 + k * 19) % 60 + k * 4;                   // 0–70 h old
    const pub = new Date(NOW - h * 3600e3).toISOString();
    return `<entry><id>yt:video:${vid}</id><yt:videoId>${vid}</yt:videoId><title>[test] ${name}: ${words[(name.length + k) % words.length]}</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=${vid}"/><published>${pub}</published>
      <media:group><media:description>Simulated upload for testing the digest.</media:description></media:group></entry>`;
  }).join('');
  return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>${name}</title>${e}</feed>`;
};
const byId = {};
const fetchText = async url => {
  const q = url.match(/search_query=([^&]+)/);
  if (q) {
    const name = decodeURIComponent(q[1]);
    if (name === 'The NK guys') return { status: 200, text: '<html>no channel results</html>' };
    const shown = name === 'Bluejay' ? 'Blue Jay Birding (wrong one?)' : name;      // a plausible mis-match
    const id = chId(name); byId[id] = name;
    return { status: 200, text: `"channelRenderer":{"channelId":"${id}","title":{"simpleText":"${shown}"}` };
  }
  const pl = url.match(/playlist_id=UULF([\w-]{22})/);
  if (pl) { const name = byId['UC' + pl[1]]; return name ? { status: 200, text: atom(name) } : { status: 404, text: '' }; }
  const w = url.match(/watch\?v=([\w-]{11})/);
  if (w) {                                                                  // simulated lengths: 4–70 min, a few unknown
    const n = parseInt(w[1].slice(0, 4), 16);
    return n % 9 === 0 ? { status: 429, text: '' } : { status: 200, text: `"lengthSeconds":"${240 + (n % 3960)}"` };
  }
  if (url.includes('reddit.com')) return { status: 403, text: '<html>Blocked</html>' };
  if (url.includes('news.google.com')) return { status: 200, text: `<?xml version="1.0"?><rss version="2.0"><channel><title>Berlin</title>
    <item><title>[test] Berlin council approves new tram line - Example Times</title><link>https://news.google.com/rss/articles/T1</link><pubDate>${new Date(NOW - 3 * 3600e3).toUTCString()}</pubDate><source url="https://x.test">Example Times</source></item>
    <item><title>[test] Election date set for spring - Other Paper</title><link>https://news.google.com/rss/articles/T2</link><pubDate>${new Date(NOW - 20 * 3600e3).toUTCString()}</pubDate><source url="https://y.test">Other Paper</source></item></channel></rss>` };
  return { status: 404, text: '' };
};
const { digest } = await buildDigest(doc, { fetchText, now: NOW });
writeFileSync(out, JSON.stringify(digest, null, 1));
const bad = digest.feeds.filter(f => f.status !== 'ok');
console.log(`${digest.stats.items} items from ${digest.stats.ok}/${digest.stats.feeds} feeds; ${digest.stats.duplicatesMerged} duplicates merged; ${digest.stats.lengthsKnown} lengths (${digest.stats.lengthFailures} failed)`);
console.log('listen items:', digest.items.filter(i => i.tags.includes('listen')).length);
bad.forEach(f => console.log(`  ⚠ ${f.name}: ${f.status} — ${f.error}`));
console.log('top 3:', digest.items.slice(0, 3).map(i => `${i.score} ${i.title} (${i.why})`).join('\n       '));
const tags = {}; digest.items.forEach(i => i.tags.forEach(t => { tags[t] = (tags[t] || 0) + 1; }));
console.log('items per tag:', JSON.stringify(tags));
