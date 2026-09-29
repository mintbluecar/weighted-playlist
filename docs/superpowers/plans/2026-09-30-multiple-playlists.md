# Multiple Playlists and Manage Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one Loopsided list combine several YouTube playlists (pasting a playlist adds it), and add a separate `manage.html` page to remove playlists, remove added songs and start over.

**Architecture:** Storage moves from one entry per playlist to one `hr:rotation` entry (sources, weights, extras, removed, sourceInfo), with automatic migration from the old keys. A second, hidden YouTube player reads playlists one at a time, so reading never interrupts playback. `app.js` rebuilds the song list from the rotation (`rebuildSongs`). The manage page (`manage.js`) edits only the rotation in storage; the player listens for `storage` events and re-reads.

**Tech Stack:** Same as before: plain ES modules, YouTube IFrame Player API, oEmbed, `localStorage`, `node --test`, the headless-Chrome harness in `tests/browser/`.

**Spec:** `docs/superpowers/specs/2026-09-29-heavy-rotation-design.md`, section *Multiple playlists and the manage page*, plus the updated *Links*, *Loading a playlist* and *Storage* sections.

## Global Constraints

- Nothing changes YouTube. Changes flow YouTube → Loopsided only.
- Commit after each task, locally only. **Do not push.** End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Weights of 1 are not stored; weights are never dropped from `hr:rotation.weights`.
- Never put titles into `innerHTML`; use `textContent`.
- Copy user-facing text exactly as written here.
- Run unit tests with `node --test`; browser scenarios with `tests/browser/run.sh [scenario ...]`.

## Review Focus

1. **Two playlists read at the same time** (startup load still running when the user pastes another) must not mix up which songs belong to which playlist. Reads are serialized through `readSource`; checked by the `load-race` scenario (Task 3).
2. **A playlist that fails to load at startup** must keep its removed-songs list and weights, and must not remove songs that are also in another playlist. Checked by the `startup-failed-source` scenario (Task 3).
3. **Old saved data** (`hr:playlist:<id>` + `hr:settings.lastSource`, or `hr:playlist:mine`) must become the rotation without losing weights, extras or removed songs. Unit tests in Task 1; the browser harness also starts from old data.
4. **Removing the playing song's playlist** (manage page in another tab) must let the song finish, with its title still showing. Checked by the `rotation-other-tab` scenario (Task 5).
5. **Corrupt or partial `hr:rotation`** (wrong types, duplicate sources) must load as a clean rotation. Unit test in Task 1.

---

### Task 1: Storage: one rotation, with migration

**Files:**
- Modify: `storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces: `store.loadRotation() → { sources: string[], weights: {[id]: number}, extras: string[], removed: string[], sourceInfo: {[listId]: { title?, owner?, count?, status? }} }`
- Produces: `store.saveRotation(rotation) → boolean`

- [ ] **Step 1: Write the failing tests** (append to `tests/storage.test.js`)

```js
test('rotation round-trips, dropping weights of 1', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  store.saveRotation({
    sources: ['PL1', 'PL2'], weights: { a: 4, b: 1 }, extras: ['x'], removed: ['r'],
    sourceInfo: { PL1: { title: 'Road Trip', owner: 'Me', count: 12, status: 'ok' } },
  });
  assert.deepEqual(JSON.parse(backend.getItem('hr:rotation')).weights, { a: 4 });
  assert.deepEqual(store.loadRotation(), {
    sources: ['PL1', 'PL2'], weights: { a: 4 }, extras: ['x'], removed: ['r'],
    sourceInfo: { PL1: { title: 'Road Trip', owner: 'Me', count: 12, status: 'ok' } },
  });
});

test('no saved data gives an empty rotation', () => {
  assert.deepEqual(createStore(memoryBackend()).loadRotation(),
    { sources: [], weights: {}, extras: [], removed: [], sourceInfo: {} });
});

test('an old saved playlist becomes the rotation', () => {
  const backend = memoryBackend();
  backend.setItem('hr:settings', JSON.stringify({ lastSource: { type: 'playlist', id: 'PL1' }, endMode: 'stop' }));
  backend.setItem(playlistKey('PL1'), JSON.stringify({ weights: { a: 5 }, extras: ['x'], removed: ['r'] }));
  assert.deepEqual(createStore(backend).loadRotation(),
    { sources: ['PL1'], weights: { a: 5 }, extras: ['x'], removed: ['r'], sourceInfo: {} });
});

test('an old list of single videos becomes the rotation', () => {
  const backend = memoryBackend();
  backend.setItem('hr:settings', JSON.stringify({ lastSource: { type: 'mine', id: 'mine' } }));
  backend.setItem(playlistKey(MINE), JSON.stringify({ weights: { x: 3 }, extras: ['x'] }));
  assert.deepEqual(createStore(backend).loadRotation(),
    { sources: [], weights: { x: 3 }, extras: ['x'], removed: [], sourceInfo: {} });
});

test('a corrupt rotation is cleaned up on load', () => {
  const backend = memoryBackend();
  backend.setItem('hr:rotation', JSON.stringify({
    sources: ['PL1', 'PL1', 7, 'PL2'], weights: { a: 'x', b: 150 }, extras: 'nope', removed: [null, 'r'],
    sourceInfo: { PL1: { title: 5, owner: 'Me', count: '12', status: 'weird' }, PL2: 'bad' },
  }));
  assert.deepEqual(createStore(backend).loadRotation(), {
    sources: ['PL1', 'PL2'], weights: { a: 1, b: 99 }, extras: [], removed: ['r'],
    sourceInfo: { PL1: { owner: 'Me' } },
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/storage.test.js`
Expected: FAIL: `store.saveRotation is not a function` / `store.loadRotation is not a function`.

- [ ] **Step 3: Implement** in `storage.js`

Add near the other constants:

```js
const ROTATION_KEY = 'hr:rotation';
const strings = list => (Array.isArray(list) ? list.filter(x => typeof x === 'string') : []);
```

Add these two methods to the object returned by `createStore` (after `saveSettings`):

```js
    // One rotation: the playlists in the list, weights, songs added here, and songs removed here.
    loadRotation() {
      let data = read(ROTATION_KEY);
      if (!Object.keys(data).length) data = migrate();
      const weights = {};
      if (isObject(data.weights)) for (const [id, w] of Object.entries(data.weights)) weights[id] = clampWeight(w);
      const sourceInfo = {};
      if (isObject(data.sourceInfo)) {
        for (const [id, info] of Object.entries(data.sourceInfo)) {
          if (!isObject(info)) continue;
          const clean = {};
          if (typeof info.title === 'string') clean.title = info.title;
          if (typeof info.owner === 'string') clean.owner = info.owner;
          if (Number.isInteger(info.count)) clean.count = info.count;
          if (info.status === 'ok' || info.status === 'error') clean.status = info.status;
          sourceInfo[id] = clean;
        }
      }
      return {
        sources: [...new Set(strings(data.sources))],
        weights,
        extras: strings(data.extras),
        removed: strings(data.removed),
        sourceInfo,
      };
    },

    saveRotation(rotation) {
      const weights = {};
      for (const [id, w] of Object.entries(rotation.weights)) if (w !== 1) weights[id] = w;
      return write(ROTATION_KEY, { ...rotation, weights });
    },
```

Add this helper inside `createStore` (after `write`), used by `loadRotation`:

```js
  // Before rotations, each playlist had its own entry and settings remembered the last one.
  function migrate() {
    const last = read(SETTINGS_KEY).lastSource;
    if (!isObject(last) || typeof last.id !== 'string') return {};
    const old = read(playlistKey(last.type === 'mine' ? MINE : last.id));
    return {
      sources: last.type === 'playlist' ? [last.id] : [],
      weights: old.weights,
      extras: old.extras,
      removed: old.removed,
      sourceInfo: {},
    };
  }
```

Also replace the now-duplicated local `strings` inside `loadPlaylist`:

```js
      const strings = list => (Array.isArray(list) ? list.filter(x => typeof x === 'string') : []);
      return { weights, extras: strings(data.extras), removed: strings(data.removed) };
```

with:

```js
      return { weights, extras: strings(data.extras), removed: strings(data.removed) };
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS, all tests (62).

- [ ] **Step 5: Commit**

```bash
git add storage.js tests/storage.test.js
git commit -m "feat: store one rotation, migrating old saved playlists"
```

---

### Task 2: List heading for several playlists

**Files:**
- Create: `sources.js`
- Test: `tests/sources.test.js`

**Interfaces:**
- Produces: `listHeading(infos: {title?, owner?}[], addedCount: number) → { title: string, owner: string }`

- [ ] **Step 1: Write the failing test** in `tests/sources.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listHeading } from '../sources.js';

test('no playlists', () => {
  assert.deepEqual(listHeading([], 0), { title: 'My rotation', owner: '' });
  assert.deepEqual(listHeading([], 2), { title: 'My rotation', owner: '+ 2 added here' });
});

test('one playlist shows its owner', () => {
  assert.deepEqual(listHeading([{ title: 'Road Trip', owner: 'Mara' }], 0), { title: 'Road Trip', owner: 'by Mara' });
  assert.deepEqual(listHeading([{ title: 'Road Trip', owner: 'Mara' }], 1), { title: 'Road Trip', owner: 'by Mara · + 1 added here' });
  assert.deepEqual(listHeading([{}], 0), { title: 'YouTube playlist', owner: '' });
});

test('two and more playlists', () => {
  assert.deepEqual(listHeading([{ title: 'A' }, { title: 'B' }], 0), { title: 'A + B', owner: '' });
  assert.deepEqual(listHeading([{ title: 'A' }, { title: 'B' }, { title: 'C' }, {}], 3), { title: 'A + 3 more', owner: '+ 3 added here' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/sources.test.js`
Expected: FAIL: `Cannot find module` for `sources.js`.

- [ ] **Step 3: Write `sources.js`**

```js
// How the song list's header names a rotation of several playlists.
export function listHeading(infos, addedCount) {
  const names = infos.map(info => info.title || 'YouTube playlist');
  let title = 'My rotation';
  if (names.length === 1) title = names[0];
  else if (names.length === 2) title = `${names[0]} + ${names[1]}`;
  else if (names.length > 2) title = `${names[0]} + ${names.length - 1} more`;
  const parts = [];
  if (infos.length === 1 && infos[0].owner) parts.push(`by ${infos[0].owner}`);
  if (addedCount) parts.push(`+ ${addedCount} added here`);
  return { title, owner: parts.join(' · ') };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS, all tests (65).

- [ ] **Step 5: Commit**

```bash
git add sources.js tests/sources.test.js
git commit -m "feat: list heading for several playlists"
```

---

### Task 3: Player page reads the rotation; pasting a playlist adds it

**Files:**
- Modify: `app.js`, `index.html`, `styles.css`, `songs-view.js`
- Modify: `tests/browser/app-harness.html`, `tests/browser/run.sh`

**Interfaces:**
- Consumes: `store.loadRotation/saveRotation` (Task 1), `listHeading` (Task 2), `createPlayer` (existing).
- Produces (in `app.js`, used by Task 5): `rotation` (module variable), `loadRotation({ refresh })`, `rebuildSongs()`.

- [ ] **Step 1: Update the browser harness to the new storage and behaviour**

In `tests/browser/app-harness.html`:

1. After `const $ = id => document.getElementById(id);` add:

```js
const saved = () => JSON.parse(localStorage.getItem('hr:rotation'));
```

2. In `'load-race'`, replace its `return { … }` block with:

```js
    const rot = saved();
    const ids = [...document.querySelectorAll('.song')].map(li => li.dataset.id).sort();
    return {
      pass: rot.weights[A1] === 5 && rot.sources.join() === [A, B].join()
        && ids.join() === [A1, A2, B1].join() && $('plName').textContent === `Title ${A} + Title ${B}`,
      rot, ids, shown: $('plName').textContent,
    };
```

and replace `const savedA = JSON.parse(localStorage.getItem(\`hr:playlist:${A}\`));` with nothing (delete the line). Also change the comment above it to `// A second playlist pasted while the first is still loading: both are read in turn and merged.`

3. Replace the whole `'failed-load'` scenario with:

```js
  // A playlist that can't be read while a song plays: error shown, song not interrupted, list unchanged.
  async 'failed-load'() {
    await import('/app.js');
    await wait(800);
    $('playBtn').click();
    await wait(300);
    const loadsBefore = calls.loadVideoById.length;
    const titleBefore = $('nowTitle').textContent;
    submitLink('https://www.youtube.com/playlist?list=PLXXXX');
    await wait(12000);                // listPlaylist gives up after 10 s
    return {
      pass: calls.loadVideoById.length === loadsBefore && $('nowTitle').textContent === titleBefore
        && $('status').classList.contains('err') && saved().sources.join() === A,
      loads: calls.loadVideoById, status: $('status').textContent, sources: saved().sources,
    };
  },
```

4. In `'typed-weight'`, replace `const saved = JSON.parse(localStorage.getItem(\`hr:playlist:${A}\`)).weights[A1];` with `const stored = saved().weights[A1];` and in its return use `stored` instead of `saved` (`pass: input.value === '99' && stored === 99, shown: input.value, stored`).

5. In `'remove-song'`, replace both `JSON.parse(localStorage.getItem(\`hr:playlist:${A}\`)).removed` with `saved().removed`, and change the note check to `note.startsWith(\`Removed Title ${A2}. Still on YouTube.\`)`.

6. In `'readd-removed'`, replace `const saved = JSON.parse(localStorage.getItem(\`hr:playlist:${A}\`));` with `const rot = saved();` and its return with `return { pass: back && rot.removed.length === 0 && !rot.extras.includes(A2), back, rot };`.

7. Add these scenarios before `// Any message can be closed with its × button.`:

```js
  // Pasting another playlist adds its songs without interrupting the song that's playing.
  async 'merge-playlist'() {
    await import('/app.js');
    await wait(800);
    $('playBtn').click();
    await wait(300);
    const loadsBefore = calls.loadVideoById.length;
    const cuesBefore = calls.cueVideoById.length;
    submitLink(`https://www.youtube.com/playlist?list=${B}`);
    await wait(1000);
    const ids = [...document.querySelectorAll('.song')].map(li => li.dataset.id).sort();
    return {
      pass: ids.join() === [A1, A2, B1].join() && saved().sources.join() === [A, B].join()
        && calls.loadVideoById.length === loadsBefore && calls.cueVideoById.length === cuesBefore
        && $('status').textContent.startsWith(`Added Title ${B} (1 new song).`)
        && $('plName').textContent === `Title ${A} + Title ${B}`,
      ids, status: $('status').textContent, heading: $('plName').textContent,
    };
  },

  // Pasting a playlist that's already in the list says so.
  async 'already-in-list'() {
    await import('/app.js');
    await wait(800);
    submitLink(`https://www.youtube.com/playlist?list=${A}`);
    await wait(200);
    return { pass: $('status').textContent.startsWith('That playlist is already in your list.'), status: $('status').textContent };
  },

  // A playlist that fails at startup keeps its songs' settings and doesn't remove songs shared with another playlist.
  async 'startup-failed-source'() {
    localStorage.setItem('hr:rotation', JSON.stringify({
      sources: [A, 'PLXXXX'], weights: { [A1]: 5 }, extras: [], removed: ['zzzzzzzzzz1'], sourceInfo: {},
    }));
    await import('/app.js');
    await wait(12500);
    const rot = saved();
    const ids = [...document.querySelectorAll('.song')].map(li => li.dataset.id).sort();
    return {
      pass: ids.join() === [A1, A2].join() && rot.sources.join() === [A, 'PLXXXX'].join()
        && rot.removed.includes('zzzzzzzzzz1') && rot.sourceInfo.PLXXXX?.status === 'error' && rot.weights[A1] === 5
        && $('status').classList.contains('err'),
      ids, rot, status: $('status').textContent,
    };
  },

  // The header's settings icon links to the manage page.
  async 'manage-link'() {
    await import('/app.js');
    await wait(300);
    const link = document.querySelector('.manage-link');
    return { pass: link?.getAttribute('href') === 'manage.html' && link.getAttribute('aria-label') === 'Manage playlists', href: link?.getAttribute('href') ?? null };
  },
```

8. In `tests/browser/run.sh`, append ` merge-playlist already-in-list startup-failed-source manage-link` to the default scenario list (inside `${*:-…}`).

- [ ] **Step 2: Run the scenarios to verify the new and changed ones fail**

Run: `tests/browser/run.sh load-race failed-load merge-playlist already-in-list startup-failed-source manage-link remove-song`
Expected: all seven report `"pass":false` (old storage key, playlist replaces instead of merging, no manage link, old wording).

- [ ] **Step 3: Add the hidden reader player, the settings icon and the new wording to `index.html`**

Replace:

```html
          <div id="ytPlayer"></div>
```

with:

```html
          <div id="ytPlayer"></div>
          <div id="ytReader" aria-hidden="true"></div>
```

Replace:

```html
        <div><h2 id="plName">No playlist loaded</h2><div class="owner" id="plOwner"></div></div>
```

with:

```html
        <div class="lhead-title">
          <div><h2 id="plName">No playlist loaded</h2><div class="owner" id="plOwner"></div></div>
          <a class="manage-link" href="manage.html" aria-label="Manage playlists" data-tip="Manage playlists"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M5.6 18.4l1.9-1.9M16.5 7.5l1.9-1.9"/></svg></a>
        </div>
```

Replace:

```html
        <input class="field" id="addLink" placeholder="Add a single YouTube video link" aria-label="Add a single YouTube video link" autocomplete="off">
```

with:

```html
        <input class="field" id="addLink" placeholder="Add a song to this list (your YouTube playlist won't change)" aria-label="Add a single YouTube video link to this list" autocomplete="off">
```

- [ ] **Step 4: Styles** (append to the `/* song list */` block in `styles.css`, after `.lhead .owner{…}`)

```css
.lhead-title{display:flex;align-items:flex-start;gap:8px;min-width:0}
#ytReader{position:absolute;left:-10000px;top:0;width:320px;height:180px}
.manage-link{position:relative;display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:var(--ink-3)}
.manage-link svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.manage-link:hover,.manage-link:focus-visible{color:var(--accent);background:var(--accent-soft)}
.manage-link::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);left:50%;transform:translate(-50%,-4px);background:var(--ink);color:var(--bg);font-size:12px;font-weight:500;padding:5px 8px;border-radius:7px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s,transform .15s;z-index:10}
.manage-link:hover::after,.manage-link:focus-visible::after{opacity:1;transform:translate(-50%,0)}
@media (hover:none){.manage-link:hover::after{opacity:0}}
```

- [ ] **Step 5: Menu wording in `songs-view.js`**

Replace `[['queue', 'Add to queue'], ['remove', 'Remove from playlist']]` with `[['queue', 'Add to queue'], ['remove', 'Remove from this list']]`.

- [ ] **Step 6: `app.js`: imports, state and the reader**

Replace:

```js
import { createStore, MINE } from './storage.js';
```

with:

```js
import { createStore } from './storage.js';
import { listHeading } from './sources.js';
```

Replace:

```js
const MY_ROTATION = 'My rotation';
```

with nothing (delete the line).

Replace:

```js
const settings = store.loadSettings();
```

with:

```js
const settings = store.loadSettings();
let rotation = store.loadRotation();
```

In `const state = {…}`, replace these lines:

```js
  sourceId: null,               // YouTube playlist ID, or MINE for a list started from single videos
  title: '',
  owner: '',
```

with:

```js
  sourceSongs: new Map(),       // playlist ID -> its video IDs, as read this session
```

and delete the line:

```js
  reloadCurrent: false,         // the player lost the current song (a failed playlist load)
```

and replace:

```js
  removed: new Set(),           // playlist songs removed here; kept out when the playlist is read again
```

with:

```js
  removed: new Set(),           // playlist songs removed here; kept out when playlists are read again
```

Replace:

```js
let player = null;
```

with:

```js
let player = null;
let reader = null;              // hidden second player, only for reading playlists
```

- [ ] **Step 7: `app.js`: saving and removing**

Replace the whole `function save() {…}` with:

```js
function save() {
  for (const s of state.songs.values()) rotation.weights[s.id] = s.weight; // weights are never dropped
  rotation.extras = [...state.songs.values()].filter(s => s.extra).map(s => s.id);
  rotation.removed = [...state.removed];
  store.saveRotation(rotation);
  store.saveSettings(settings);
}
```

In `removeSong`, replace:

```js
  showStatus(`Removed ${song.title ?? id}.`, 'ok', [{ label: 'Undo', onClick: () => restoreSong(id) }]);
```

with:

```js
  showStatus(`Removed ${song.title ?? id}. Still on YouTube.`, 'ok', [{ label: 'Undo', onClick: () => restoreSong(id) }]);
```

- [ ] **Step 8: `app.js`: replace the whole loading section**

Replace everything from the line `// ---------- loading ----------` up to, but not including, the line `// ---------- playback ----------` with:

```js
// ---------- loading ----------

// Read one playlist with the hidden reader. The reader can only cue one playlist at a time,
// so reads run one after another (two overlapping reads could swap their songs).
let readChain = Promise.resolve();
function readSource(listId) {
  const result = readChain.then(() => reader.listPlaylist(listId));
  readChain = result.catch(() => {});
  return result;
}

// Read a playlist and record what happened, for the header and the manage page.
async function loadSource(listId) {
  try {
    const ids = await readSource(listId);
    state.sourceSongs.set(listId, ids);
    rotation.sourceInfo[listId] = { ...rotation.sourceInfo[listId], count: ids.length, status: 'ok' };
    return true;
  } catch {
    state.sourceSongs.delete(listId);
    rotation.sourceInfo[listId] = { ...rotation.sourceInfo[listId], status: 'error' };
    return false;
  }
}

async function refreshSourceTitle(listId) {
  const info = await fetchInfo(playlistUrl(listId));
  if (!info || !rotation.sources.includes(listId)) return;
  rotation.sourceInfo[listId] = { ...rotation.sourceInfo[listId], title: info.title, owner: info.author };
  save();
  render();
}

// Work out the song list from the rotation: every playlist's songs (minus songs removed here),
// plus songs added here. Songs that leave keep their details, so a playing song keeps its title.
function rebuildSongs() {
  state.playlistIds = new Set(rotation.sources.flatMap(id => state.sourceSongs.get(id) ?? []));
  state.removed = new Set(rotation.removed);
  const extras = new Set(rotation.extras);
  const wanted = [];
  for (const id of state.playlistIds) if (!state.removed.has(id)) wanted.push(id);
  for (const id of rotation.extras) if (!state.playlistIds.has(id)) wanted.push(id);

  const songs = new Map();
  const newIds = [];
  for (const id of wanted) {
    const song = state.songs.get(id) ?? state.removedInfo.get(id);
    if (song) {
      song.extra = extras.has(id);
      songs.set(id, song);
      state.removedInfo.delete(id);
    } else {
      songs.set(id, { id, title: null, author: '', thumbnail: '', weight: rotation.weights[id] ?? 1, extra: extras.has(id), blocked: false });
      newIds.push(id);
    }
  }
  for (const [id, song] of state.songs) if (!songs.has(id)) state.removedInfo.set(id, song);
  state.songs = songs;
  updateCounts(); // a playing song that left finishes; the loop carries on without it
  if (!queue.current) cueFirstSong();
  resort();
  save();
  render();
  if (newIds.length) loadTitles(newIds);
}

function loadTitles(ids) {
  fetchVideoInfos(ids, {
    onInfo: (id, info) => {
      const song = state.songs.get(id);
      if (song && info) {
        song.title = info.title;
        song.author = info.author;
        song.thumbnail = info.thumbnail;
      }
      scheduleRender();
    },
  }).then(() => {
    resort();
    render();
  });
}

function failedMessage(listIds) {
  const names = listIds.map(id => rotation.sourceInfo[id]?.title ?? 'A playlist');
  const which = names.length === 1 ? `${names[0]} couldn't` : `${names.length} playlists couldn't`;
  return `${which} be loaded. It may be private or deleted. Its songs are hidden until it loads again.`;
}

// Read the rotation's playlists (all of them, or only ones not read yet) and rebuild the list.
async function loadRotation({ refresh = true } = {}) {
  const toRead = rotation.sources.filter(id => refresh || !state.sourceSongs.has(id));
  const results = await Promise.all(toRead.map(async id => [id, await loadSource(id)]));
  rebuildSongs();
  const failed = results.filter(([, ok]) => !ok).map(([id]) => id);
  if (failed.length) showStatus(failedMessage(failed), 'err');
  toRead.forEach(refreshSourceTitle);
}

// Pasting a playlist adds its songs to the list. Nothing that's playing is interrupted.
async function addPlaylist(listId) {
  if (!reader) return showStatus('The YouTube player is still loading. Try again in a moment.');
  if (rotation.sources.includes(listId)) return showStatus('That playlist is already in your list.');
  rotation.sources.push(listId);
  showStatus('Loading playlist…');
  const before = new Set(state.songs.keys());
  if (!(await loadSource(listId))) {
    rotation.sources = rotation.sources.filter(id => id !== listId);
    delete rotation.sourceInfo[listId];
    save();
    return showStatus(isMix(listId)
      ? "YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead."
      : "Couldn't load this playlist. It may be private or deleted.", 'err');
  }
  rebuildSongs();
  const added = [...state.songs.keys()].filter(id => !before.has(id)).length;
  await refreshSourceTitle(listId);
  const title = rotation.sourceInfo[listId]?.title ?? 'the playlist';
  showStatus(`Added ${title} (${added} new ${added === 1 ? 'song' : 'songs'}).`, 'ok');
}

async function addVideo(videoId) {
  if (state.songs.has(videoId)) return showStatus('That song is already in the list.');
  if (state.removedInfo.has(videoId) && state.removed.has(videoId)) {
    restoreSong(videoId);
    return showStatus(`Added ${titleOf(videoId)} back.`, 'ok');
  }
  state.removed.delete(videoId);
  const inPlaylist = state.playlistIds.has(videoId);
  if (!inPlaylist) rotation.extras = [...rotation.extras, videoId];
  addSong(videoId, rotation.weights[videoId] ?? 1, !inPlaylist);
  updateCounts();
  if (!queue.current) cueFirstSong();
  resort();
  save();
  render();
  showStatus('Added to your list, weight 1.', 'ok');
  const info = await fetchInfo(videoUrl(videoId));
  const song = state.songs.get(videoId);
  if (song && info) {
    song.title = info.title;
    song.author = info.author;
    song.thumbnail = info.thumbnail;
    resort();
    render();
  }
}

```

- [ ] **Step 9: `app.js`: remove the old failed-load recovery (the main player is never cued with a playlist now)**

Delete the whole `function restoreCurrentSong(wasPlaying) {…}` block and the two comment lines above it (`// Cueing a playlist replaces the video…` and `// current song has to be loaded again…`).

In `playSong`, delete the line `  state.reloadCurrent = false;`.

In `togglePlay`, delete the line `  if (state.reloadCurrent) return playSong(queue.current);`.

- [ ] **Step 10: `app.js`: header, link bar and boot**

Replace:

```js
  $('plName').textContent = state.sourceId ? state.title : 'No playlist loaded';
  $('plOwner').textContent = state.owner ? `by ${state.owner}` : '';
```

with:

```js
  const heading = listHeading(rotation.sources.map(id => rotation.sourceInfo[id] ?? {}), rotation.extras.length);
  const empty = !rotation.sources.length && !state.songs.size;
  $('plName').textContent = empty ? 'No playlist loaded' : heading.title;
  $('plOwner').textContent = empty ? '' : heading.owner;
```

Replace:

```js
  if (link.type === 'playlist') loadPlaylist(link.listId);
```

with:

```js
  if (link.type === 'playlist') addPlaylist(link.listId);
```

Replace:

```js
      { label: 'Load the whole playlist', primary: true, onClick: () => loadPlaylist(link.listId) },
```

with:

```js
      { label: 'Add the whole playlist', primary: true, onClick: () => addPlaylist(link.listId) },
```

Replace the end of `boot()`:

```js
    player = await createPlayer(YT, 'ytPlayer', { onStateChange, onError });
  } catch {
    showStatus("The YouTube player couldn't load. Check your connection or ad blocker.", 'err');
    return;
  }
  const last = settings.lastSource;
  if (last?.type === 'playlist') loadPlaylist(last.id);
  else if (last?.type === 'mine') {
    state.title = MY_ROTATION;
    setSource(MINE, []);
  }
}
```

with:

```js
    [player, reader] = await Promise.all([
      createPlayer(YT, 'ytPlayer', { onStateChange, onError }),
      createPlayer(YT, 'ytReader'),
    ]);
  } catch {
    showStatus("The YouTube player couldn't load. Check your connection or ad blocker.", 'err');
    return;
  }
  loadRotation();
}
```

- [ ] **Step 11: Check nothing still refers to removed names, then run everything**

Run: `grep -n -E "loadPlaylist|setSource|MINE|MY_ROTATION|reloadCurrent|restoreCurrentSong|state\.sourceId|state\.title|state\.owner" app.js`
Expected: no output.

Run: `node --check app.js && node --test && tests/browser/run.sh`
Expected: unit tests PASS (65); every browser scenario reports `"pass":true`.

- [ ] **Step 12: Commit**

```bash
git add app.js index.html styles.css songs-view.js tests/browser
git commit -m "feat: pasting a playlist adds it to the list; hidden reader player"
```

---

### Task 4: The manage page

**Files:**
- Create: `manage.html`, `manage.js`
- Modify: `styles.css`, `tests/browser/app-harness.html`, `tests/browser/run.sh`

**Interfaces:**
- Consumes: `createStore` (`loadRotation`, `saveRotation`), `parseLink`, `isMix`, `fetchInfo`, `fetchVideoInfos`, `playlistUrl`.

- [ ] **Step 1: Let the harness load the manage page, and add its scenarios**

In `tests/browser/app-harness.html`, replace:

```js
const html = await (await realFetch('/index.html')).text();
```

with:

```js
const page = scenario.startsWith('manage-') ? '/manage.html' : '/index.html';
const html = await (await realFetch(page)).text();
```

Add these scenarios before `// Any message can be closed with its × button.`:

```js
  // Manage page: one card per playlist; a failed one says so; Remove + Undo edit the saved rotation.
  async 'manage-remove-undo'() {
    localStorage.setItem('hr:rotation', JSON.stringify({
      sources: [A, B], weights: { [A1]: 5 }, extras: [], removed: [],
      sourceInfo: { [A]: { title: 'Road Trip', owner: 'Mara', count: 2, status: 'ok' }, [B]: { title: 'Chill', status: 'error' } },
    }));
    await import('/manage.js');
    await wait(200);
    const cards = [...document.querySelectorAll('#sources .source')];
    const texts = cards.map(c => c.textContent);
    cards[0].querySelector('button').click();
    await wait(100);
    const afterRemove = saved().sources;
    const note = $('status').textContent;
    [...$('status').querySelectorAll('button')].find(b => b.textContent === 'Undo').click();
    await wait(100);
    return {
      pass: cards.length === 2 && texts[0].includes('Road Trip') && texts[0].includes('2 songs')
        && texts[1].includes("Couldn't load last time") && afterRemove.join() === B
        && note.startsWith('Removed Road Trip.') && saved().sources.join() === [A, B].join() && saved().weights[A1] === 5,
      texts, afterRemove, note, final: saved().sources,
    };
  },

  // Manage page: adding a playlist fetches its title; Start over clears the list but keeps weights.
  async 'manage-add-start-over'() {
    localStorage.setItem('hr:rotation', JSON.stringify({
      sources: [A], weights: { [A1]: 5 }, extras: [B1], removed: [], sourceInfo: { [A]: { title: 'Road Trip' } },
    }));
    await import('/manage.js');
    await wait(200);
    const addedHere = document.querySelectorAll('#extras .source').length;
    $('addLink').value = `https://www.youtube.com/playlist?list=${C}`;
    $('addForm').requestSubmit();
    await wait(200);
    const afterAdd = saved();
    const newCard = [...document.querySelectorAll('#sources .source')].at(-1).textContent;
    $('startOver').click();
    $('confirmClear').click();
    await wait(100);
    const cleared = saved();
    return {
      pass: addedHere === 1 && afterAdd.sources.join() === [A, C].join() && afterAdd.sourceInfo[C].title === `Title ${C}`
        && newCard.includes('Songs load when you open the player')
        && cleared.sources.length === 0 && cleared.extras.length === 0 && cleared.weights[A1] === 5,
      addedHere, afterAdd, newCard, cleared,
    };
  },
```

In `tests/browser/run.sh`, append ` manage-remove-undo manage-add-start-over` to the default scenario list.

- [ ] **Step 2: Run them to verify they fail**

Run: `tests/browser/run.sh manage-remove-undo manage-add-start-over`
Expected: both `"pass":false` (manage.html does not exist).

- [ ] **Step 3: Write `manage.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Manage playlists · Loopsided</title>
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,600;12..96,800&family=Figtree:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap">
  <link rel="stylesheet" href="styles.css">
  <script type="module" src="manage.js"></script>
</head>
<body>
<div class="wrap manage">
  <a class="back" href="./">← Back to player</a>
  <header class="top">
    <div class="intro">
      <h1 class="brand" aria-label="Loopsided"><span class="loop">loop</span><span class="sided">sided</span></h1>
      <p class="tagline">Manage the playlists in your list. Changes here never change YouTube.</p>
    </div>
    <form class="load" id="addForm">
      <input class="field" id="addLink" placeholder="Paste a YouTube playlist link to add it" aria-label="YouTube playlist link to add" autocomplete="off">
      <button class="btn primary" type="submit">Add</button>
    </form>
  </header>
  <div class="status" id="status" role="status" hidden></div>

  <section class="list" aria-labelledby="playlistsHeading">
    <div class="lhead">
      <div><h2 id="playlistsHeading">Playlists</h2><div class="owner">Song counts are from your last visit to the player.</div></div>
    </div>
    <ol class="sources" id="sources"></ol>
    <p class="empty" id="sourcesEmpty" hidden>No playlists yet. Paste one above.</p>
  </section>

  <section class="list" aria-labelledby="extrasHeading">
    <div class="lhead">
      <div><h2 id="extrasHeading">Added here</h2><div class="owner">Single songs added in Loopsided.</div></div>
    </div>
    <ol class="sources" id="extras"></ol>
    <p class="empty" id="extrasEmpty" hidden>No songs added here.</p>
  </section>

  <section class="danger">
    <button class="btn" id="startOver" type="button">Start over</button>
    <div class="confirm" id="confirmStartOver" hidden>
      <span>Clear all playlists and added songs? Your weights are kept.</span>
      <button class="btn primary" id="confirmClear" type="button">Clear list</button>
      <button class="btn" id="cancelStartOver" type="button">Cancel</button>
    </div>
  </section>

  <footer class="site-footer">
    made with love by twitter user <a href="https://x.com/mintbluetoyota" target="_blank" rel="noopener">@mintbluetoyota</a>.<br>
    creatures by <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a>.
  </footer>
</div>
</body>
</html>
```

- [ ] **Step 4: Write `manage.js`**

```js
// Manage playlists: shows the rotation the player last saved, and edits which playlists
// and added songs are in it. It needs no YouTube player; the player re-reads on its next load.
import { createStore } from './storage.js';
import { parseLink, isMix } from './links.js';
import { fetchInfo, fetchVideoInfos, playlistUrl } from './youtube.js';

const $ = id => document.getElementById(id);

let backend = null;
try {
  backend = window.localStorage;
} catch {
  backend = null; // storage blocked by the browser
}
const store = createStore(backend);
let rotation = store.loadRotation();
const extraInfo = new Map(); // videoId -> { title, author, thumbnail }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function save() {
  store.saveRotation(rotation);
}

// ---------- notes (same behaviour as the player: success notes clear after 4 s) ----------

let noteTimer = null;
function note(message, kind = 'ok', action = null) {
  const box = $('status');
  clearTimeout(noteTimer);
  if (kind === 'ok') noteTimer = setTimeout(() => { box.hidden = true; }, 4000);
  box.className = `status ${kind}`;
  box.replaceChildren(el('span', null, message));
  if (action) {
    const button = el('button', 'btn', action.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      box.hidden = true;
      action.onClick();
    });
    const wrap = el('span', 'choice');
    wrap.append(button);
    box.append(wrap);
  }
  const close = el('button', 'close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => { box.hidden = true; });
  box.append(close);
  box.hidden = false;
}

// ---------- cards ----------

function sourceCard(id) {
  const info = rotation.sourceInfo[id] ?? {};
  const title = info.title ?? 'YouTube playlist';
  const li = el('li', 'source');
  const text = el('div', 'text');
  text.append(el('span', 't', title));
  if (info.owner) text.append(el('span', 'c', `by ${info.owner}`));
  let detail = 'Songs load when you open the player';
  if (info.status === 'error') detail = "Couldn't load last time (private, deleted or a Mix)";
  else if (Number.isInteger(info.count)) detail = `${info.count} ${info.count === 1 ? 'song' : 'songs'}`;
  text.append(el('span', info.status === 'error' ? 'detail err' : 'detail', detail));
  const remove = el('button', 'btn', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${title}`);
  remove.addEventListener('click', () => removeSource(id));
  li.append(text, remove);
  return li;
}

function extraRow(id) {
  const info = extraInfo.get(id);
  const title = info?.title ?? id;
  const li = el('li', 'source');
  const thumb = el('span', 'thumb');
  if (info?.thumbnail) {
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = info.thumbnail;
    thumb.append(img);
  }
  const text = el('div', 'text');
  text.append(el('span', 't', title));
  if (info?.author) text.append(el('span', 'c', info.author));
  const remove = el('button', 'btn', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${title}`);
  remove.addEventListener('click', () => removeExtra(id));
  li.append(thumb, text, remove);
  return li;
}

function render() {
  $('sources').replaceChildren(...rotation.sources.map(sourceCard));
  $('sourcesEmpty').hidden = rotation.sources.length > 0;
  $('extras').replaceChildren(...rotation.extras.map(extraRow));
  $('extrasEmpty').hidden = rotation.extras.length > 0;
}

// ---------- edits ----------

function removeSource(id) {
  const index = rotation.sources.indexOf(id);
  if (index < 0) return;
  rotation.sources.splice(index, 1);
  save();
  render();
  const title = rotation.sourceInfo[id]?.title ?? 'the playlist';
  note(`Removed ${title}.`, 'ok', {
    label: 'Undo',
    onClick: () => {
      if (!rotation.sources.includes(id)) rotation.sources.splice(index, 0, id);
      save();
      render();
    },
  });
}

function removeExtra(id) {
  const index = rotation.extras.indexOf(id);
  if (index < 0) return;
  rotation.extras.splice(index, 1);
  save();
  render();
  note(`Removed ${extraInfo.get(id)?.title ?? 'the song'}.`, 'ok', {
    label: 'Undo',
    onClick: () => {
      if (!rotation.extras.includes(id)) rotation.extras.splice(index, 0, id);
      save();
      render();
    },
  });
}

$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const link = parseLink($('addLink').value);
  if (link.type === 'empty') return;
  if (link.type !== 'playlist' && link.type !== 'both') {
    return note("That doesn't look like a YouTube playlist link. It should contain list=.", 'err');
  }
  if (isMix(link.listId)) {
    return note("YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead.", 'err');
  }
  if (rotation.sources.includes(link.listId)) return note('That playlist is already in your list.');
  $('addLink').value = '';
  rotation.sources.push(link.listId);
  rotation.sourceInfo[link.listId] = {};
  save();
  render();
  const info = await fetchInfo(playlistUrl(link.listId));
  if (info && rotation.sources.includes(link.listId)) {
    rotation.sourceInfo[link.listId] = { ...rotation.sourceInfo[link.listId], title: info.title, owner: info.author };
    save();
    render();
  }
  note(`Added ${info?.title ?? 'the playlist'}. Its songs load when you open the player.`);
});

$('startOver').addEventListener('click', () => {
  $('startOver').hidden = true;
  $('confirmStartOver').hidden = false;
});
$('cancelStartOver').addEventListener('click', () => {
  $('confirmStartOver').hidden = true;
  $('startOver').hidden = false;
});
$('confirmClear').addEventListener('click', () => {
  rotation = { ...rotation, sources: [], extras: [], removed: [], sourceInfo: {} }; // weights are kept
  save();
  render();
  $('confirmStartOver').hidden = true;
  $('startOver').hidden = false;
  note('Your list is empty. Weights come back if the same songs return.');
});

// Another tab (the player) saved a newer rotation.
window.addEventListener('storage', e => {
  if (e.key !== 'hr:rotation') return;
  rotation = store.loadRotation();
  render();
});

render();
fetchVideoInfos(rotation.extras, {
  onInfo: (id, info) => {
    if (info) extraInfo.set(id, info);
    render();
  },
});
```

- [ ] **Step 5: Styles for the manage page** (append to `styles.css` before the `@media (max-width:760px)` block)

```css
/* manage page */
.manage{max-width:760px}
.manage .back{justify-self:start;font-size:14px;color:var(--ink-2);text-decoration:none;padding:4px 0}
.manage .back:hover{color:var(--accent)}
ol.sources{list-style:none;margin:0;padding:0}
.source{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line)}
.source:last-child{border-bottom:0}
.source .text{flex:1;min-width:0;display:grid}
.source .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.source .c,.source .detail{font-size:12.5px;color:var(--ink-2)}
.source .detail.err{color:var(--warn)}
.source .thumb{flex:none;width:56px;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:var(--surface-2);border:1px solid var(--line)}
.source .thumb img{display:block;width:100%;height:100%;object-fit:cover}
.source .btn{height:36px;font-size:13.5px}
.manage .empty{margin:0;padding:14px;font-size:13.5px;color:var(--ink-3)}
.danger{display:flex;justify-content:center}
.confirm{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;font-size:14px}
```

- [ ] **Step 6: Run the scenarios and the unit tests**

Run: `node --check manage.js && node --test && tests/browser/run.sh`
Expected: unit tests PASS (65); every browser scenario reports `"pass":true`.

- [ ] **Step 7: Commit**

```bash
git add manage.html manage.js styles.css tests/browser
git commit -m "feat: manage playlists page"
```

---

### Task 5: The player follows changes made on the manage page

**Files:**
- Modify: `app.js`, `tests/browser/app-harness.html`, `tests/browser/run.sh`

**Interfaces:**
- Consumes: `rotation`, `loadRotation({ refresh })`, `rebuildSongs()` from Task 3.

- [ ] **Step 1: Write the failing scenario** (add before `// Any message can be closed with its × button.` in the harness)

```js
  // Another tab removes the playing song's playlist: the song keeps playing, and its playlist's songs leave the list.
  async 'rotation-other-tab'() {
    await import('/app.js');
    await wait(800);
    $('playBtn').click();
    await wait(300);
    const playing = $('nowTitle').textContent;
    const loadsBefore = calls.loadVideoById.length;
    const rot = saved();
    localStorage.setItem('hr:rotation', JSON.stringify({ ...rot, sources: [] }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'hr:rotation' }));
    await wait(300);
    return {
      pass: document.querySelectorAll('.song').length === 0 && $('nowTitle').textContent === playing
        && calls.loadVideoById.length === loadsBefore && $('plName').textContent === 'No playlist loaded',
      songs: document.querySelectorAll('.song').length, playing, now: $('nowTitle').textContent,
    };
  },
```

Append ` rotation-other-tab` to the default list in `tests/browser/run.sh`.

- [ ] **Step 2: Run it to verify it fails**

Run: `tests/browser/run.sh rotation-other-tab`
Expected: `"pass":false` (the player ignores storage events; songs stay).

- [ ] **Step 3: Implement** in `app.js`, just before `if (!store.available) $('storageNote').hidden = false;`

```js
// The manage page (another tab) changed the rotation: take its version and read any new playlists.
// Songs that leave finish if they're playing, like a removed song.
window.addEventListener('storage', e => {
  if (e.key !== 'hr:rotation' || !reader) return;
  rotation = store.loadRotation();
  loadRotation({ refresh: false });
});
```

- [ ] **Step 4: Run everything**

Run: `node --test && tests/browser/run.sh`
Expected: unit tests PASS (65); every browser scenario reports `"pass":true`.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/browser
git commit -m "feat: the player follows playlist changes made on the manage page"
```

---

### Task 6: Manual checks and README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — replace the first paragraph's sentence `Plays a YouTube playlist with weights, so your favourite songs come around more often.` with `Plays YouTube playlists with weights, so your favourite songs come around more often. Paste several playlists to play them together; manage them at /manage.html (the ⚙ icon).`

- [ ] **Step 2: Run the tests**

Run: `node --test && tests/browser/run.sh`
Expected: all pass.

- [ ] **Step 3: Manual checks** (ask the user, locally with `python3 -m http.server 8000`)

1. Your existing list and weights are still there after the update.
2. Pasting a second playlist while a song plays adds its songs; the song keeps playing; the header reads "A + B".
3. ⚙ opens the manage page; Remove + Undo work; Start over empties the list.
4. With the manage page in a second tab, removing a playlist there updates the player tab.
5. A private or deleted playlist shows "Couldn't load last time" on the manage page.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: multiple playlists in the README"
```
