# Daily Command

A personal "what should I be doing right now?" app. Static site, installable PWA, works offline. No backend, no paid services. Your data stays in your browser (localStorage) with JSON export/import.

**Status: Stage 3 (core loop, morning sequence, your own feeds).** Stages 4–5 (Google Calendar/Gmail/Drive sync; leisure, German, life admin) are added to the same files.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app: HTML, CSS and JS inlined and commented, in numbered PARTs. PART 1 is the Now/Next engine. |
| `sw.js` | Service worker: offline cache, update prompt, notification clicks. Bump `VERSION` when you change files. |
| `manifest.json`, `icons/` | Make it installable: name, icons, and "Capture" and "Focus" shortcuts. |
| `feeds.json` | **Your watchlist:** feeds, their tags, lenses and keyword boosts. Edit it in the app. |
| `digest.json` | What the digest shows. It ships as a labelled **sample**; the workflow replaces it with real items. |
| `feeds.resolved.json`, `video-meta.json` | Caches maintained by the workflow: YouTube name and handle lookups, and video lengths for the Listen queue. |
| `.github/workflows/digest.yml` | Every 3 hours: tests, builds the digest, commits it if it changed, then deploys the site. |
| `scripts/` | The digest builder: `digest-lib.mjs` (logic) and `build-digest.mjs` (runner). |
| `tests/` | `engine.test.cjs` (36 Now/Next edge cases), `digest.test.mjs` (24 builder tests on recorded feed samples) and `e2e-build.mjs` (a full builder run over your real watchlist with a simulated network). Run all with `npm test`. |
| `package.json`, `package-lock.json` | One dependency (`fast-xml-parser`), used only by the workflow and not by the app. |

## Set it up on GitHub (one-off, about 10 minutes)

1. **Create a repository** on github.com, e.g. `daily-command`.
   - It can be public or private, but free accounts only get Pages on public repos.
   - The site URL is public either way. Your tasks and data never leave your browser; only `feeds.json` and the digest are in the repo.
2. **Upload everything** from the zip, keeping the folders. The web uploader sometimes skips the hidden `.github` folder. If it does, use **Add file → Create new file**, type `.github/workflows/digest.yml` as the name, and paste the file's contents.
3. **Pages:** go to **Settings → Pages → Build and deployment** and set **Source: GitHub Actions**. This is not "Deploy from a branch".
4. **Actions:** go to **Settings → Actions → General**, allow actions, and under **Workflow permissions** choose **Read and write**.
5. **First run:** open the **Actions** tab, choose **Digest + deploy**, then **Run workflow**. After about 2 minutes the site is live at `https://<you>.github.io/<repo>/` with a real digest. From then on it runs every 3 hours, and again whenever you push a change.
6. **Check your channels:** in the app, open **More → Watchlist & lenses**.
   - Each feed shows its health.
   - YouTube channels given only by name are found by search, and the line says what it found, e.g. *found "Map Men"*.
   - If a match is wrong, edit the feed and paste the channel's `@handle` or link.
   - **To check** lists the names that voice transcription garbled.

## Editing the watchlist

In **More → Watchlist & lenses** you can:

- **Add feeds:** a YouTube channel (name, @handle or link), a subreddit, a Google News search, or any RSS URL.
- **Tag feeds:** a feed can have several tags, e.g. Last Week Tonight is `comedy` + `politics`.
- **Build lenses** from tags. A lens is a mix for a mood, e.g. **Laugh** = comedy, standup, cartoon, entertainment.
- **Set keyword boosts** ("physics = 2"), which push matching items to the top. Each item shows how its score adds up.
- **Choose default lenses:** one for the morning sequence, and one per mode for evening or ad-hoc digest sessions.

Edits stay on your device until you publish them, because the workflow reads the repo's `feeds.json`:

- **Simple:** tap **Download feeds.json**, then replace the file in the repo. The push rebuilds the digest.
- **One tap (optional):** create a **fine-grained personal access token**.
  - Where: GitHub → Settings → Developer settings → Fine-grained tokens.
  - Access: **this repository only**.
  - Permissions: **Contents: Read and write** and **Actions: Read and write**.
  - Give it an expiry date.
  - Paste it under **Publish to GitHub**. Then **Publish** saves `feeds.json` to the repo, and **Refresh digest now** starts a rebuild.
  - The token is stored only in that browser and is never exported or synced. Anyone using that browser profile could still read it, which is why the scope should stay this narrow.

**Something new:** if nothing has been added to the watchlist for 30 days (adjustable, or 0 for off), the app shows a gentle "Time for something new?" card. It shows the subtraction, e.g. `13 Oct − 9 Sep = 34 days ≥ 30`, and can be snoozed for 2 weeks.

**Morning briefing slot:** the repo can optionally contain `briefing.json` (`{"generated", "title", "markdown"}`) or `briefing.md`, for example written by an AI step you add to the workflow later (there's a commented example in `digest.yml`). While it's under 24 hours old, it appears at the top of the morning sequence. Without it, nothing is shown.

## Listening while working

Feeds tagged **listen**, such as podcasts and talking-head channels, form a **Listen queue**. While you're in a block, the Now screen shows one pick under the Now card:

- **What it picks:** it chooses something that fits the time left and fills at least half of it, and shows the maths, e.g. `Admin ends 12:30 → 38 min left · 31:12 ≤ 38:00 ✓ fits, fills 82%`. Listen-tagged items you saved to the shelf come first.
- **Play:** on Android it opens the video **in the YouTube app**. With YouTube Premium, playback continues with the screen off. On desktop it opens in a new tab.
- **After pressing Play:** the card shows "Playing on YouTube · ends ~12:21", then "Probably finished — Done / next". **Skip** hides an item for today.
- **What each block gets:** in **More → Listening while working**, choose talk, focus audio or off per kind of block.
  - Defaults: **talk** for Admin and Lunch, **focus audio** for Deep work.
  - Focus audio is a link you set once, e.g. an instrumental YouTube playlist.
  - Reason for the defaults: speech competes with reading and writing (the "irrelevant speech effect"). Change them freely.
- **Full queue:** the Inbox tab lists everything, with the total listening time added up.

**Video lengths:** YouTube's feeds don't include lengths, and YouTube usually blocks GitHub's servers from reading video pages. For reliable lengths, add a free **YouTube Data API key** as a repo secret named `YT_API_KEY` (**Settings → Secrets and variables → Actions → New repository secret**). It comes from the same Google Cloud project as Stage 4's sign-in. It uses about 3 units per run out of a free 10,000 a day. Without a key, the workflow still tries the video pages, and the digest's stats say why any lookup failed. Items without a length are picked in queue order. Until phone–desktop sync (Stage 4), marking something done on one device doesn't hide it on the other.

## Install on Android

Open the URL in Chrome, then **⋮ → Add to home screen / Install app**. It opens full-screen and works offline. Long-press the icon for the **Capture** shortcut.

## How the Now card decides

1. A **timed calendar event** happening now wins. If events overlap, the one that started most recently wins, the others show as "Also now". All-day events never override.
2. Otherwise the **current routine block**, with separate weekday and weekend templates. A block whose end time is earlier than its start runs past midnight, so Sunday 00:15 is still Saturday's wind-down.
3. In **Deep work / Admin** blocks it shows a task: today's top 3, then a project's next action, then the oldest open task. "Not now" skips one for today.

**Next** is whatever the card will show next. If an event ends mid-block, Next is that block ("resume").

**Overrun nudge:** press **Start** on the card. If you're still on it 20 minutes after it should have ended, you get "Next: X. Start?". Both the threshold and the "day ends at 04:00" rollover are in Settings.

## Morning sequence (Stage 2)

The first time you open the app each day, if that's before 12:00 (configurable), it walks you through four steps:

1. **Today**: weather (Open-Meteo, free, no key), today's events and the plan for the day.
2. **Top 3**: carry over yesterday's unfinished ones, or pick new ones.
3. **Digest**: a fixed list with a 15-minute countdown. Keyword matches come first. ✓ marks an item read, the bookmark saves it to the **watch-later shelf** (shown in Leisure mode and the Inbox tab), and tapping a title opens it in a new tab. When the list is empty you see **"You're caught up"**, and nothing more loads.
4. **Start work**: switches to Work mode and starts the first focus session on your top task. Before your first work block, Work mode is set manually until that block begins.

You can close it with ✕ at any time, or rerun it from the Now card (during the wake/morning blocks) or **More → Morning sequence & weather**. Set your weather location there too: either GPS once, or search for a city.

Weather and the digest are cached separately from your data, so they aren't exported or synced. Offline, the app shows the last copy with its age, e.g. "Updated 3 h ago" or "Digest built 5 h ago (last known copy)".

## Honest limits

- **Nothing can wake a closed web app.** Pomodoro chimes and notifications only fire while the app is open or briefly backgrounded. The timer is timestamp-based, so it's always correct when you return. Reliable alarms come in Stage 4 via Google Calendar events, which Android fires natively.
- **The morning sequence can't open itself** at 07:30. It starts the first time *you* open the app that morning.
- **Voice capture** uses Chrome's speech recognition. It sends audio to Google and needs a connection.
- **Data is per browser** until Drive sync (Stage 4). Use **More → Data → Export** as a backup.
- **Reddit often blocks cloud servers.** GitHub's machines frequently get "403 blocked" from Reddit, even for public RSS. The builder tries reddit.com, then old.reddit.com, and reports the result for each subreddit. If both are blocked, there's no free, reliable workaround from GitHub.
- **YouTube by name is a guess.** Name search takes the top channel result, which can be wrong; pin it with an @handle.
- **Shorts are skipped** using YouTube's long-form uploads playlist. This is an unofficial trick; if it stops working, the builder falls back to the normal feed, which includes Shorts.
- **Some sites block scraping or have no feed.** They show ⚠ with the HTTP code. A Google News search is a good substitute for news sites without RSS.
- **"Every 3 hours" is approximate.** GitHub may delay scheduled runs at busy times.
- **Public repos pause after 60 days.** Scheduled runs stop after 60 days with no repository activity. Re-enable them in the Actions tab; publishing a watchlist edit counts as activity.
