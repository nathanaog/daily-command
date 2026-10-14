/* Lens tests — run: node tests/lens.test.cjs
 * Extracts the Lens engine from index.html (between ==LENS START/END==).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const Lens = new Function(html.split('// ==LENS START==')[1].split('// ==LENS END==')[0] + '; return Lens;')();
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } }
console.log('Lens tests');

const groups = { genre: ['debates', 'standup', 'documentary', 'lo-fi'], activity: ['chill', 'focus'] };
const debateVideo = { type: 'video', tags: ['debates', 'politics'] };            // Modern-Day Debate
const lboVideo = { type: 'video', tags: ['comedy', 'politics'] };                 // Last Week Tonight
const lbcTalk = { type: 'video', tags: ['politics', 'listen'] };                  // LBC (fine to just listen to)
const podcast = { type: 'episode', tags: ['politics', 'debates'] };               // a Spotify debate podcast
const article = { type: 'news', tags: ['politics', 'news'] };

test('groupOf: unlisted → topic, listed → genre/activity, "listen" is a hint', () => {
  assert.strictEqual(Lens.groupOf('politics', groups), 'topic');
  assert.strictEqual(Lens.groupOf('Debates', groups), 'genre');
  assert.strictEqual(Lens.groupOf('focus', groups), 'activity');
  assert.strictEqual(Lens.groupOf('listen', groups), 'hint');
});
test('howOf: videos watch (+listen if marked), episodes listen only, the rest read', () => {
  assert.deepStrictEqual(Lens.howOf(debateVideo), ['watch']);
  assert.deepStrictEqual(Lens.howOf(lbcTalk), ['watch', 'listen']);
  assert.deepStrictEqual(Lens.howOf(podcast), ['listen']);
  assert.deepStrictEqual(Lens.howOf(article), ['read']);
  assert.deepStrictEqual(Lens.howOf({ type: 'post', tags: [] }), ['read']);
});
test('Nathan’s example: politics × debates × watch → the debate video, never the podcast', () => {
  const lens = { topic: ['politics'], genre: ['debates'], how: ['watch'] };
  assert.strictEqual(Lens.matches(debateVideo, lens, groups), true);
  assert.strictEqual(Lens.matches(podcast, lens, groups), false, 'listen-only podcast excluded');
  assert.strictEqual(Lens.matches(lboVideo, lens, groups), false, 'not a debate');
  assert.strictEqual(Lens.matches(article, lens, groups), false);
});
test('within a group = any of; across groups = and', () => {
  const lens = { topic: ['politics', 'gaming'], genre: ['standup', 'debates'] };
  assert.ok(Lens.matches(debateVideo, lens, groups));
  assert.ok(!Lens.matches({ type: 'video', tags: ['gaming'] }, lens, groups));
  assert.ok(Lens.matches({ type: 'video', tags: ['gaming', 'standup'] }, lens, groups));
});
test('legacy lens (plain list) keeps "any of these tags"', () => {
  const laugh = ['comedy', 'standup', 'cartoon', 'entertainment'];
  assert.ok(Lens.matches(lboVideo, laugh, groups));
  assert.ok(Lens.matches({ type: 'video', tags: ['standup'] }, laugh, groups));
  assert.ok(!Lens.matches(debateVideo, laugh, groups));
});
test('extra How filter (digest chips) narrows any lens; empty lens = everything', () => {
  assert.ok(Lens.matches(podcast, null, groups, ['listen']));
  assert.ok(!Lens.matches(debateVideo, null, groups, ['listen']));
  assert.ok(Lens.matches(lbcTalk, ['politics'], groups, ['listen']), 'a listenable video counts for Listen');
  assert.ok(Lens.matches(article, {}, groups));
  assert.ok(Lens.isEmpty({}) && Lens.isEmpty(null) && !Lens.isEmpty(['x']));
});
test('case-insensitive throughout', () => {
  assert.ok(Lens.matches({ type: 'video', tags: ['Politics', 'DEBATES'] }, { topic: ['politics'], genre: ['Debates'] }, groups));
});
test('describe() reads naturally', () => {
  assert.strictEqual(Lens.describe({ topic: ['politics'], genre: ['debates'], how: ['watch'] }), 'politics · debates · watch');
  assert.strictEqual(Lens.describe(['comedy', 'standup']), 'comedy or standup');
  assert.strictEqual(Lens.describe(null), 'everything');
});
test('tagsByGroup: sorts used tags into groups, includes listed-but-unused as suggestions, hides "listen"', () => {
  const feeds = [{ tags: ['politics', 'debates', 'listen'] }, { tags: ['gaming', 'chill'] }];
  const t = Lens.tagsByGroup(feeds, groups);
  assert.deepStrictEqual(t.topic, ['gaming', 'politics']);
  assert.deepStrictEqual(t.genre, ['debates', 'documentary', 'lo-fi', 'standup']);
  assert.deepStrictEqual(t.activity, ['chill', 'focus']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
