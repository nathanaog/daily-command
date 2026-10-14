#!/usr/bin/env node
/* Daily Command — builds digest.json from feeds.json.
 * Run by .github/workflows/digest.yml every 3 hours; also runnable locally:
 *    npm ci && node scripts/build-digest.mjs
 * Writes:
 *    digest.json          what the app reads (items + per-feed health)
 *    feeds.resolved.json  cache of YouTube name/handle → channel id lookups
 *    video-meta.json      cache of video lengths (seconds) by video id, for the Listen queue
 * Sets the step outputs `changed` (true/false) and `summary` for the workflow.
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { buildDigest, makeFetchText } from './digest-lib.mjs';

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };

const doc = await readJson('feeds.json', null);
if (!doc) { console.error('feeds.json missing or not valid JSON'); process.exit(1); }
const cache = await readJson('feeds.resolved.json', {});
const previous = await readJson('digest.json', {});
const videoMeta = await readJson('video-meta.json', {});

// Optional: a free YouTube Data API key (repo secret YT_API_KEY) makes video lengths reliable.
const ytApiKey = process.env.YT_API_KEY || '';
const previousItems = previous.sample ? [] : (previous.items || []);   // lets Reddit subs not fetched this run keep their posts
const { digest, resolved, videoMeta: newMeta } = await buildDigest(doc, { fetchText: makeFetchText(), cache, videoMeta, ytApiKey, previousItems });

// Never replace a good digest with an empty one because of a network blip.
if (!digest.items.length && previous.items?.length && !previous.sample) {
  console.warn('No items fetched — keeping the previous digest.json');
  digest.items = previous.items; digest.stale = true;
}
await writeFile('digest.json', JSON.stringify(digest, null, 1) + '\n');
await writeFile('feeds.resolved.json', JSON.stringify(resolved, null, 2) + '\n');
await writeFile('video-meta.json', JSON.stringify(newMeta) + '\n');

const changed = digest.contentHash !== previous.contentHash || JSON.stringify(resolved) !== JSON.stringify(cache);
const summary = `${digest.stats.items} items from ${digest.stats.ok}/${digest.stats.feeds} feeds, ${digest.stats.lengthsKnown} video lengths`;
console.log(summary + (changed ? '' : ' (no change)'));
for (const f of digest.feeds) if (f.status !== 'ok') console.log(`  ⚠ ${f.name}: ${f.status} — ${f.error || ''}`);
const lr = digest.stats.lengthFailReasons || {};
if (Object.keys(lr).length) console.log(`  Video lengths via ${digest.stats.lengthVia}: ${digest.stats.lengthFailures} failed — ${Object.entries(lr).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\nsummary=${summary}\n`);
