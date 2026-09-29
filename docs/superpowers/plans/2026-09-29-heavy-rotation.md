# Heavy Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Heavy Rotation, a local web page that plays a YouTube playlist with per-song weights, plus a pen of Kenney creatures that hatch and grow as songs play.

**Architecture:** Plain ES modules served by a static file server. Pure logic lives in small files with no browser dependencies (`links.js`, `weights.js`, `rotation.js`, `storage.js`, `crew.js`) and is covered by `node --test`. `youtube.js` is the only file that talks to YouTube. The screen is split into `songs-view.js` (song list), `player-view.js` (now playing, controls, up next) and `crew-view.js` (the pen), wired together by `app.js`. The two view files are a small split of the spec's `app.js` to keep files focused.

**Tech Stack:** HTML, CSS, JavaScript ES modules, YouTube IFrame Player API, YouTube oEmbed, `localStorage`, Node's built-in test runner (Node 26 is installed). No dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-09-29-heavy-rotation-design.md` (read it before starting; `docs/mockup.html` is the visual reference).

## Global Constraints

- No npm dependencies and no build step. `package.json` exists only to set `"type": "module"` and a `test` script.
- Run the app with `python3 -m http.server 8000` from `weighted-playlist/`, open `http://localhost:8000`.
- Weights are whole numbers from 1 to 99, default 1.
- A play counts after 30 seconds of actual playback. The pen holds 20 creatures. Creature size: 26 px at 1 play, +7 px per play, max 96 px.
- Storage keys: `hr:playlist:<listId>`, `hr:playlist:mine`, `hr:settings`. Weights of 1 are not stored.
- Never put song titles, channel names or playlist titles into `innerHTML`. Build DOM nodes and use `textContent`.
- Copy user-facing text exactly as written in this plan (it comes from the spec).
- Creature art: `assets/kenney/` (47 SVGs, CC0). Do not add or rename files there.
- Commit after every task. End each commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Songs shorter than 30 seconds are out of scope (owner's decision): they never count, like any play under 30 seconds.

1. **A song whose creature is still walking out of the pen gets played again** should hatch a fresh creature, not leave a stuck one behind. Handled in Task 9 (`#hatch` removes the old element); check it in the Task 9 manual steps.
2. **Links with tracking parameters or stray spaces** (`?si=…`, `&t=42s`, pasted with leading spaces) should parse like clean links. Test in Task 1.
3. **Odd weight input** (blank, 0, negative, decimal, letters, 150) should become a whole number from 1 to 99, never `NaN`. Test in Task 2.
4. **A playlist with one song, or one song that dominates the weights,** should still build a loop with exact counts and never hang. Test in Task 3.
5. **Storage that works at first but fails on save (quota full), or holds corrupt JSON,** should not break the app; defaults are used. Test in Task 4.

---

### Task 1: Project setup and link parsing

**Files:**
- Create: `package.json`
- Create: `links.js`
- Test: `tests/links.test.js`

**Interfaces:**
- Produces: `parseLink(text: string) → { type: 'empty' } | { type: 'invalid' } | { type: 'video', videoId } | { type: 'playlist', listId } | { type: 'both', videoId, listId }`
- Produces: `isMix(listId: string) → boolean` (true for YouTube Mix lists, which start with `RD`)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "weighted-playlist",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test** in `tests/links.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLink, isMix } from '../links.js';

const V = 'AbC-123_xYz';
const L = 'PLsampleList42';

test('playlist links, including host variants', () => {
  for (const link of [
    `https://www.youtube.com/playlist?list=${L}`,
    `https://m.youtube.com/playlist?list=${L}`,
    `https://music.youtube.com/playlist?list=${L}`,
    `https://www.youtube.com/embed/videoseries?list=${L}`,
  ]) assert.deepEqual(parseLink(link), { type: 'playlist', listId: L }, link);
});

test('video links in every shape', () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${V}`,
    `https://youtu.be/${V}`,
    `https://www.youtube.com/shorts/${V}`,
    `https://www.youtube.com/live/${V}`,
    `https://www.youtube.com/embed/${V}`,
    `https://m.youtube.com/watch?v=${V}`,
    `https://music.youtube.com/watch?v=${V}`,
    `https://www.youtube-nocookie.com/embed/${V}`,
  ]) assert.deepEqual(parseLink(link), { type: 'video', videoId: V }, link);
});

test('a video opened inside a playlist is both', () => {
  assert.deepEqual(
    parseLink(`https://www.youtube.com/watch?v=${V}&list=${L}&index=4`),
    { type: 'both', videoId: V, listId: L },
  );
});

test('links pasted without https://', () => {
  assert.deepEqual(parseLink(`youtube.com/watch?v=${V}`), { type: 'video', videoId: V });
  assert.deepEqual(parseLink(`youtu.be/${V}`), { type: 'video', videoId: V });
  assert.deepEqual(parseLink(`www.youtube.com/playlist?list=${L}`), { type: 'playlist', listId: L });
});

test('spaces and tracking parameters are ignored', () => {
  assert.deepEqual(parseLink(`   https://youtu.be/${V}?si=abc123&t=42  `), { type: 'video', videoId: V });
  assert.deepEqual(parseLink(`https://www.youtube.com/watch?v=${V}&t=42s&si=x`), { type: 'video', videoId: V });
  assert.deepEqual(parseLink(`https://www.youtube.com/playlist?list=${L}&si=zz`), { type: 'playlist', listId: L });
});

test('empty input', () => {
  assert.deepEqual(parseLink(''), { type: 'empty' });
  assert.deepEqual(parseLink('   '), { type: 'empty' });
  assert.deepEqual(parseLink(undefined), { type: 'empty' });
});

test('invalid input', () => {
  for (const text of [
    'hello',
    'not a url at all',
    `https://example.com/watch?v=${V}`,
    'https://www.youtube.com/',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@somechannel',
  ]) assert.deepEqual(parseLink(text), { type: 'invalid' }, text);
});

test('isMix spots YouTube Mix lists', () => {
  assert.equal(isMix('RDabc123'), true);
  assert.equal(isMix(L), false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/links.test.js`
Expected: FAIL with `Cannot find module` for `links.js`.

- [ ] **Step 4: Write `links.js`**

```js
// Works out what a pasted link points to, from its shape alone. No network calls.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com']);

export function parseLink(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { type: 'empty' };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { type: 'invalid' };
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let videoId = null;
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/')[1] || null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(shorts|live|embed|v)\/([^/]+)/);
      if (match && match[2] !== 'videoseries') videoId = match[2];
    }
  } else {
    return { type: 'invalid' };
  }

  if (videoId && !VIDEO_ID.test(videoId)) videoId = null;
  const list = url.searchParams.get('list');
  const listId = list && LIST_ID.test(list) ? list : null;

  if (videoId && listId) return { type: 'both', videoId, listId };
  if (videoId) return { type: 'video', videoId };
  if (listId) return { type: 'playlist', listId };
  return { type: 'invalid' };
}

export function isMix(listId) {
  return listId.startsWith('RD');
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/links.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json links.js tests/links.test.js
git commit -m "feat: parse YouTube playlist and video links"
```

---

### Task 2: Weights

**Files:**
- Create: `weights.js`
- Test: `tests/weights.test.js`

**Interfaces:**
- Produces: `MIN_WEIGHT = 1`, `MAX_WEIGHT = 99`
- Produces: `clampWeight(value: any) → number` (whole number 1–99)
- Produces: `playsPerLoop(songs: {id, weight}[]) → { counts: Map<id, number>, length: number }`
- Produces: `frequencyText(plays: number, loopLength: number) → string`
- Produces: `compareSongs(a, b) → number` for sorting `{ id, title|null, weight }` by weight (highest first), then title (falling back to id)

- [ ] **Step 1: Write the failing test** in `tests/weights.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampWeight, playsPerLoop, frequencyText, compareSongs } from '../weights.js';

test('clampWeight keeps whole numbers from 1 to 99', () => {
  assert.equal(clampWeight(7), 7);
  assert.equal(clampWeight('12'), 12);
  assert.equal(clampWeight('2.6'), 3);
  assert.equal(clampWeight(150), 99);
  assert.equal(clampWeight(99), 99);
});

test('clampWeight turns odd input into 1', () => {
  for (const value of ['', 'abc', 0, -5, NaN, undefined, null, '  ']) {
    assert.equal(clampWeight(value), 1, String(value));
  }
});

test('playsPerLoop divides by the greatest common divisor', () => {
  const { counts, length } = playsPerLoop([
    { id: 'a', weight: 4 }, { id: 'b', weight: 2 }, { id: 'c', weight: 2 }, { id: 'd', weight: 2 },
  ]);
  assert.deepEqual([...counts], [['a', 2], ['b', 1], ['c', 1], ['d', 1]]);
  assert.equal(length, 5);
});

test('playsPerLoop with no common divisor, equal weights, and no songs', () => {
  assert.equal(playsPerLoop([{ id: 'a', weight: 4 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }]).length, 6);
  assert.deepEqual([...playsPerLoop([{ id: 'a', weight: 3 }, { id: 'b', weight: 3 }]).counts], [['a', 1], ['b', 1]]);
  assert.equal(playsPerLoop([]).length, 0);
});

test('frequencyText follows the spec rules', () => {
  assert.equal(frequencyText(15, 15), 'Every song');
  assert.equal(frequencyText(1, 15), '1 in every 15 songs');
  assert.equal(frequencyText(2, 4), '1 in every 2 songs');
  assert.equal(frequencyText(4, 15), 'About 1 in every 4 songs');
  assert.equal(frequencyText(2, 15), 'About 1 in every 8 songs');
  assert.equal(frequencyText(2, 3), '2 in every 3 songs');
});

test('compareSongs sorts by weight, then title, then id', () => {
  const songs = [
    { id: 'z1', title: 'Beta', weight: 1 },
    { id: 'z2', title: 'Alpha', weight: 1 },
    { id: 'z3', title: 'Gamma', weight: 4 },
    { id: 'a0', title: null, weight: 1 },
  ];
  assert.deepEqual(songs.sort(compareSongs).map(s => s.id), ['z3', 'a0', 'z2', 'z1']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/weights.test.js`
Expected: FAIL with `Cannot find module` for `weights.js`.

- [ ] **Step 3: Write `weights.js`**

```js
// Weights → plays per loop, and how often a song comes around in plain words.
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 99;

export function clampWeight(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return MIN_WEIGHT;
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, n));
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function playsPerLoop(songs) {
  const divisor = songs.reduce((acc, s) => gcd(acc, s.weight), 0) || 1;
  const counts = new Map();
  let length = 0;
  for (const s of songs) {
    const plays = s.weight / divisor;
    counts.set(s.id, plays);
    length += plays;
  }
  return { counts, length };
}

export function frequencyText(plays, loopLength) {
  if (plays === loopLength) return 'Every song';
  const n = loopLength / plays;
  if (Number.isInteger(n)) return `1 in every ${n} songs`;
  if (n < 2.5) return `${plays} in every ${loopLength} songs`;
  return `About 1 in every ${Math.round(n)} songs`;
}

export function compareSongs(a, b) {
  return b.weight - a.weight || (a.title ?? a.id).localeCompare(b.title ?? b.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/weights.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add weights.js tests/weights.test.js
git commit -m "feat: weights, plays per loop and frequency wording"
```

---

### Task 3: Rotation (loop building and the play queue)

**Files:**
- Create: `rotation.js`
- Test: `tests/rotation.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (takes a `Map<id, plays>` such as `playsPerLoop(...).counts`).
- Produces: `buildLoop(counts: Map<id, number>, { avoidFirst?: id|null, random?: () => number }) → id[]`
- Produces: `class Queue` with:
  - `new Queue({ random? })`
  - `endMode`: `'shuffle' | 'same' | 'stop'` (default `'shuffle'`)
  - `current: id | null`, `loopNumber: number`, getters `position` (1-based, 0 before start) and `loopLength`
  - `setCounts(counts)`: replace the plays per loop; keeps the current song playing and rebuilds the rest of the loop
  - `start() → id | null`: first song (or the current one)
  - `next() → id | null`: `null` means stop (end of loop in stop mode, or nothing playable)
  - `previous() → id | null`: goes back through what actually played
  - `playNow(id) → id | null`: plays `id` and starts a new loop with it first
  - `upcoming(n) → (id | null)[]`: next `n` songs; `null` marks where a new loop starts

- [ ] **Step 1: Write the failing test** in `tests/rotation.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLoop, Queue } from '../rotation.js';

// Repeatable random numbers so failures can be reproduced.
function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const tally = loop => loop.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map());
const MIXED = new Map([['a', 4], ['b', 2], ['c', 2], ['d', 1], ['e', 1], ['f', 1], ['g', 1], ['h', 1], ['i', 1], ['j', 1]]);

test('each song appears exactly its number of plays', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const loop = buildLoop(MIXED, { random: seeded(seed) });
    assert.equal(loop.length, 15);
    assert.deepEqual(new Map([...tally(loop)].sort()), new Map([...MIXED].sort()));
  }
});

test('no back-to-back repeats when they can be avoided, including across the join', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const loop = buildLoop(MIXED, { avoidFirst: 'a', random: seeded(seed) });
    assert.notEqual(loop[0], 'a', `seed ${seed}`);
    for (let i = 1; i < loop.length; i++) assert.notEqual(loop[i], loop[i - 1], `seed ${seed} at ${i}`);
  }
});

test('one dominant song, a single song, and no songs', () => {
  const dominant = buildLoop(new Map([['a', 5], ['b', 1]]), { random: seeded(3) });
  assert.deepEqual(tally(dominant), new Map([['a', 5], ['b', 1]]));
  assert.deepEqual(buildLoop(new Map([['a', 3]]), { random: seeded(3) }), ['a', 'a', 'a']);
  assert.deepEqual(buildLoop(new Map()), []);
});

function queueWith(counts, seed = 7) {
  const q = new Queue({ random: seeded(seed) });
  q.setCounts(new Map(counts));
  return q;
}

test('start and next walk through a loop, then begin loop 2', () => {
  const q = queueWith([['a', 2], ['b', 1], ['c', 1]]);
  const played = [q.start()];
  assert.equal(q.position, 1);
  assert.equal(q.loopLength, 4);
  for (let i = 0; i < 3; i++) played.push(q.next());
  assert.deepEqual(tally(played), new Map([['a', 2], ['b', 1], ['c', 1]]));
  assert.equal(q.loopNumber, 1);
  q.next();
  assert.equal(q.loopNumber, 2);
  assert.equal(q.position, 1);
});

test('same order replays the identical loop', () => {
  const q = queueWith([['a', 2], ['b', 1], ['c', 1]]);
  q.endMode = 'same';
  const first = [q.start(), q.next(), q.next(), q.next()];
  const second = [q.next(), q.next(), q.next(), q.next()];
  assert.deepEqual(second, first);
});

test('stop mode returns null at the end, and start begins a new loop', () => {
  const q = queueWith([['a', 1], ['b', 1]]);
  q.endMode = 'stop';
  q.start();
  q.next();
  assert.equal(q.next(), null);
  assert.equal(q.current, null);
  assert.ok(['a', 'b'].includes(q.start()));
  assert.equal(q.loopNumber, 2);
});

test('upcoming marks the new loop, and the preview is the loop that actually plays', () => {
  const q = queueWith([['a', 2], ['b', 1], ['c', 1]]);
  q.start();
  q.next();
  q.next();
  const preview = q.upcoming(4);
  assert.equal(preview.length, 5);
  assert.equal(preview[1], null);
  const nextLoopStart = preview.slice(2);
  assert.deepEqual([q.next(), q.next(), q.next(), q.next()], [preview[0], ...nextLoopStart]);
});

test('previous goes back, and next carries on without skipping', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1], ['d', 1]]);
  const first = q.start();
  const second = q.next();
  assert.equal(q.previous(), first);
  assert.equal(q.next(), second);
  assert.equal(new Queue().previous(), null);
});

test('playNow starts a new loop with the chosen song first', () => {
  const q = queueWith([['a', 2], ['b', 1], ['c', 1]]);
  q.start();
  assert.equal(q.playNow('b'), 'b');
  assert.equal(q.position, 1);
  assert.equal(q.loopNumber, 2);
  const rest = [q.next(), q.next(), q.next()];
  assert.deepEqual(tally(['b', ...rest]), new Map([['a', 2], ['b', 1], ['c', 1]]));
  assert.equal(q.playNow('nope'), null);
});

test('setCounts keeps the current song and rebuilds the rest of the loop', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1]]);
  const current = q.start();
  q.setCounts(new Map([['a', 3], ['b', 1], ['c', 1]]));
  assert.equal(q.current, current);
  assert.equal(q.position, 1);
  assert.equal(q.loopLength, 5);
});

test('removing the current song (unplayable) moves on to another song', () => {
  const q = queueWith([['a', 1], ['b', 1]]);
  const current = q.start();
  const other = current === 'a' ? 'b' : 'a';
  q.setCounts(new Map([[other, 1]]));
  assert.equal(q.next(), other);
});

test('an empty queue returns null', () => {
  const q = queueWith([]);
  assert.equal(q.start(), null);
  assert.equal(q.next(), null);
  assert.deepEqual(q.upcoming(4), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/rotation.test.js`
Expected: FAIL with `Cannot find module` for `rotation.js`.

- [ ] **Step 3: Write `rotation.js`**

```js
// Builds each loop from plays per song, and tracks what plays next.

// Spread each song's plays evenly with a random offset, then break up back-to-back repeats.
export function buildLoop(counts, { avoidFirst = null, random = Math.random } = {}) {
  const slots = [];
  for (const [id, plays] of counts) {
    const offset = random();
    for (let k = 0; k < plays; k++) slots.push({ id, pos: (k + offset) / plays, tie: random() });
  }
  slots.sort((a, b) => a.pos - b.pos || a.tie - b.tie);
  const loop = slots.map(s => s.id);

  for (let i = 0; i < loop.length; i++) {
    const prev = i === 0 ? avoidFirst : loop[i - 1];
    if (loop[i] !== prev) continue;
    const j = findSwap(loop, i, prev);
    if (j !== -1) [loop[i], loop[j]] = [loop[j], loop[i]];
  }
  return loop;
}

// A later slot whose song can move to i, while the repeated song moves to j without touching another copy of itself.
function findSwap(loop, i, repeated) {
  for (let j = i + 1; j < loop.length; j++) {
    const candidate = loop[j];
    if (candidate === repeated) continue;
    if (j - 1 !== i && loop[j - 1] === repeated) continue;
    if (j + 1 < loop.length && loop[j + 1] === repeated) continue;
    if (i + 1 !== j && i + 1 < loop.length && loop[i + 1] === candidate) continue;
    return j;
  }
  return -1;
}

const HISTORY_LIMIT = 200;

export class Queue {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.counts = new Map();
    this.endMode = 'shuffle';
    this.loop = [];
    this.pos = -1;
    this.loopNumber = 1;
    this.current = null;
    this.history = [];
    this.nextLoopCache = null;
  }

  get position() {
    return Math.max(0, this.pos + 1);
  }

  get loopLength() {
    return this.loop.length;
  }

  setCounts(counts) {
    this.counts = new Map([...counts].filter(([, plays]) => plays > 0));
    this.nextLoopCache = null;
    if (this.current && this.counts.has(this.current)) {
      this.loop = this.#loopStartingWith(this.current);
      this.pos = 0;
    } else {
      this.loop = this.#build(this.counts, this.current);
      this.pos = -1;
    }
  }

  start() {
    if (this.current) return this.current;
    if (!this.loop.length) return null;
    if (this.pos < 0 || this.pos >= this.loop.length) this.pos = 0;
    this.current = this.loop[this.pos];
    return this.current;
  }

  next() {
    if (this.current) this.#remember(this.current);
    if (!this.loop.length) {
      this.current = null;
      return null;
    }
    this.pos++;
    if (this.pos >= this.loop.length) {
      this.loop = this.endMode === 'same' ? this.loop : this.#takeNextLoop();
      this.loopNumber++;
      if (this.endMode === 'stop') {
        this.pos = -1;
        this.current = null;
        return null;
      }
      this.pos = 0;
    }
    this.current = this.loop[this.pos];
    return this.current;
  }

  previous() {
    if (!this.history.length) return null;
    const back = this.history.pop();
    if (this.pos > 0 && this.loop[this.pos - 1] === back) this.pos--;
    this.current = back;
    return back;
  }

  playNow(id) {
    if (!this.counts.has(id)) return null;
    if (this.current) this.#remember(this.current);
    this.loop = this.#loopStartingWith(id);
    this.pos = 0;
    this.loopNumber++;
    this.nextLoopCache = null;
    this.current = id;
    return id;
  }

  upcoming(n) {
    const out = [];
    for (let i = this.pos + 1; i < this.loop.length && out.length < n; i++) out.push(this.loop[i]);
    if (out.length < n && this.endMode !== 'stop' && this.loop.length) {
      out.push(null);
      for (const id of this.#peekNextLoop()) {
        if (out.length > n) break;
        out.push(id);
      }
    }
    return out;
  }

  #build(counts, avoidFirst) {
    return buildLoop(counts, { avoidFirst, random: this.random });
  }

  // The given song first, then the rest of its plays and everyone else's.
  #loopStartingWith(id) {
    const rest = new Map(this.counts);
    const plays = rest.get(id) ?? 0;
    if (plays <= 1) rest.delete(id);
    else rest.set(id, plays - 1);
    return [id, ...this.#build(rest, id)];
  }

  #peekNextLoop() {
    if (this.endMode === 'same') return this.loop;
    this.nextLoopCache ??= this.#build(this.counts, this.loop.at(-1));
    return this.nextLoopCache;
  }

  #takeNextLoop() {
    const loop = this.nextLoopCache ?? this.#build(this.counts, this.loop.at(-1));
    this.nextLoopCache = null;
    return loop;
  }

  #remember(id) {
    this.history.push(id);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/rotation.test.js`
Expected: PASS, 12 tests. If "no back-to-back repeats" fails for a seed, print that loop, find why `findSwap` returned `-1`, and fix `findSwap` (do not loosen the test).

- [ ] **Step 5: Commit**

```bash
git add rotation.js tests/rotation.test.js
git commit -m "feat: weighted loop building and play queue"
```

---

### Task 4: Storage

**Files:**
- Create: `storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: `clampWeight` from `weights.js` (Task 2).
- Produces: `MINE = 'mine'`, `playlistKey(id) → string`
- Produces: `createStore(backend: Storage | null) →` object with:
  - `available: boolean`
  - `loadPlaylist(id) → { weights: {[videoId]: number}, extras: string[] }`
  - `savePlaylist(id, { weights, extras }) → boolean`
  - `loadSettings() → { lastSource: {type:'playlist'|'mine', id} | null, endMode: 'shuffle'|'same'|'stop' }`
  - `saveSettings(settings) → boolean`

- [ ] **Step 1: Write the failing test** in `tests/storage.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, playlistKey, MINE } from '../storage.js';

function memoryBackend() {
  const data = new Map();
  return {
    data,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: k => void data.delete(k),
  };
}

test('playlist weights and extras round-trip, and weights of 1 are not stored', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  assert.equal(store.available, true);
  store.savePlaylist('PL1', { weights: { a: 4, b: 1, c: 2 }, extras: ['c'] });
  assert.deepEqual(JSON.parse(backend.getItem(playlistKey('PL1'))), { weights: { a: 4, c: 2 }, extras: ['c'] });
  assert.deepEqual(store.loadPlaylist('PL1'), { weights: { a: 4, c: 2 }, extras: ['c'] });
  assert.equal(playlistKey(MINE), 'hr:playlist:mine');
});

test('settings round-trip, with defaults and a bad end mode', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  assert.deepEqual(store.loadSettings(), { lastSource: null, endMode: 'shuffle' });
  store.saveSettings({ lastSource: { type: 'playlist', id: 'PL1' }, endMode: 'stop' });
  assert.deepEqual(store.loadSettings(), { lastSource: { type: 'playlist', id: 'PL1' }, endMode: 'stop' });
  backend.setItem('hr:settings', JSON.stringify({ endMode: 'sideways' }));
  assert.equal(store.loadSettings().endMode, 'shuffle');
});

test('saved weights are cleaned up on load', () => {
  const backend = memoryBackend();
  backend.setItem(playlistKey('PL1'), JSON.stringify({ weights: { a: 150, b: 'x', c: 3 }, extras: ['c', 5, null] }));
  assert.deepEqual(createStore(backend).loadPlaylist('PL1'), { weights: { a: 99, b: 1, c: 3 }, extras: ['c'] });
});

test('corrupt JSON falls back to defaults', () => {
  const backend = memoryBackend();
  backend.setItem(playlistKey('PL1'), '{not json');
  backend.setItem('hr:settings', '[[[');
  const store = createStore(backend);
  assert.deepEqual(store.loadPlaylist('PL1'), { weights: {}, extras: [] });
  assert.deepEqual(store.loadSettings(), { lastSource: null, endMode: 'shuffle' });
});

test('no storage at all: nothing throws and defaults are used', () => {
  for (const backend of [null, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} }]) {
    const store = createStore(backend);
    assert.equal(store.available, false);
    assert.deepEqual(store.loadPlaylist('PL1'), { weights: {}, extras: [] });
    assert.equal(store.savePlaylist('PL1', { weights: { a: 2 }, extras: [] }), false);
    assert.equal(store.saveSettings({ lastSource: null, endMode: 'same' }), false);
  }
});

test('storage that fills up later: saving returns false instead of throwing', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  backend.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(store.savePlaylist('PL1', { weights: { a: 2 }, extras: [] }), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/storage.test.js`
Expected: FAIL with `Cannot find module` for `storage.js`.

- [ ] **Step 3: Write `storage.js`**

```js
// Saves weights, extra videos and settings in the browser. Every access is guarded:
// if storage is blocked or full, the app keeps working for the session.
import { clampWeight } from './weights.js';

export const MINE = 'mine';
const SETTINGS_KEY = 'hr:settings';
const END_MODES = ['shuffle', 'same', 'stop'];

export const playlistKey = id => `hr:playlist:${id}`;

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createStore(backend) {
  let available = false;
  try {
    backend.setItem('hr:test', '1');
    backend.removeItem('hr:test');
    available = true;
  } catch {
    available = false;
  }

  function read(key) {
    if (!available) return {};
    try {
      const value = JSON.parse(backend.getItem(key) ?? '{}');
      return isObject(value) ? value : {};
    } catch {
      return {};
    }
  }

  function write(key, value) {
    if (!available) return false;
    try {
      backend.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  return {
    get available() {
      return available;
    },

    loadPlaylist(id) {
      const data = read(playlistKey(id));
      const weights = {};
      if (isObject(data.weights)) {
        for (const [videoId, weight] of Object.entries(data.weights)) weights[videoId] = clampWeight(weight);
      }
      const extras = Array.isArray(data.extras) ? data.extras.filter(x => typeof x === 'string') : [];
      return { weights, extras };
    },

    savePlaylist(id, { weights, extras }) {
      const kept = {};
      for (const [videoId, weight] of Object.entries(weights)) if (weight !== 1) kept[videoId] = weight;
      return write(playlistKey(id), { weights: kept, extras });
    },

    loadSettings() {
      const data = read(SETTINGS_KEY);
      const source = data.lastSource;
      const lastSource = isObject(source) && ['playlist', 'mine'].includes(source.type) && typeof source.id === 'string'
        ? { type: source.type, id: source.id }
        : null;
      return { lastSource, endMode: END_MODES.includes(data.endMode) ? data.endMode : 'shuffle' };
    },

    saveSettings(settings) {
      return write(SETTINGS_KEY, settings);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/storage.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add storage.js tests/storage.test.js
git commit -m "feat: guarded browser storage for weights and settings"
```

---

### Task 5: Crew rules

**Files:**
- Create: `crew.js`
- Test: `tests/crew.test.js`

**Interfaces:**
- Produces: `PEN_LIMIT = 20`, `COUNT_AFTER_SECONDS = 30`
- Produces: `sizeFor(plays: number) → number` (px)
- Produces: `hashId(str) → number`
- Produces: `CREATURES`: array of `{ name, face: 'left'|'right', move: 'walk'|'hop'|'fly', variants: { hue: number, frames: { idle, a, b, rest } }[] }`, frame paths relative to `assets/kenney/`
- Produces: `creatureFor(videoId) → { model, variant }`
- Produces: `class Crew` with:
  - `startPlay(id) → event[]` (ends any unfinished play first)
  - `tick(seconds) → event[]` (call only while actually playing)
  - `endPlay() → event[]` (the play ended: it reverts unless it already counted)
  - `plays(id)` (counted plays), `displayPlays(id)` (includes the play in progress), `sizeOf(id)`, `isFull`
  - events: `{ type: 'hatch' | 'evolve' | 'count' | 'shrink' | 'poof' | 'leave', id }`

- [ ] **Step 1: Write the failing test** in `tests/crew.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Crew, CREATURES, creatureFor, sizeFor, PEN_LIMIT } from '../crew.js';

const types = events => events.map(e => `${e.type}:${e.id}`);

function countedPlay(crew, id) {
  crew.startPlay(id);
  crew.tick(30);
}

test('a new song hatches straight away and counts after 30 seconds of playback', () => {
  const crew = new Crew();
  assert.deepEqual(types(crew.startPlay('a')), ['hatch:a']);
  assert.equal(crew.plays('a'), 0);
  assert.equal(crew.displayPlays('a'), 1);
  assert.deepEqual(crew.tick(10), []);
  assert.deepEqual(crew.tick(19.9), []);
  assert.deepEqual(types(crew.tick(0.2)), ['count:a']);
  assert.equal(crew.plays('a'), 1);
  assert.deepEqual(crew.tick(60), [], 'counts at most once per play');
});

test('only playing time counts: ticks add up across pauses', () => {
  const crew = new Crew();
  crew.startPlay('a');
  crew.tick(20);
  // paused here: the app sends no ticks
  assert.deepEqual(crew.tick(9), []);
  assert.deepEqual(types(crew.tick(1)), ['count:a']);
});

test('skipping a new song before 30 seconds makes it poof', () => {
  const crew = new Crew();
  crew.startPlay('a');
  crew.tick(10);
  assert.deepEqual(types(crew.startPlay('b')), ['poof:a', 'hatch:b']);
  assert.equal(crew.members.has('a'), false);
});

test('skipping an existing song before 30 seconds shrinks it back', () => {
  const crew = new Crew();
  countedPlay(crew, 'a');
  assert.deepEqual(types(crew.startPlay('a')), ['evolve:a']);
  assert.equal(crew.displayPlays('a'), 2);
  assert.equal(crew.sizeOf('a'), 33);
  assert.deepEqual(types(crew.endPlay()), ['shrink:a']);
  assert.equal(crew.displayPlays('a'), 1);
  assert.equal(crew.sizeOf('a'), 26);
});

test('ending a play that already counted changes nothing', () => {
  const crew = new Crew();
  countedPlay(crew, 'a');
  assert.deepEqual(crew.endPlay(), []);
  assert.deepEqual(crew.endPlay(), [], 'nothing left to end');
  assert.equal(crew.plays('a'), 1);
});

test('the pen can briefly hold one extra; the smallest leaves when the play counts', () => {
  const crew = new Crew({ limit: 3 });
  for (const id of ['a', 'b', 'c']) countedPlay(crew, id);
  assert.equal(crew.isFull, true);
  assert.deepEqual(types(crew.startPlay('d')), ['hatch:d']);
  assert.equal(crew.members.size, 4);
  assert.deepEqual(types(crew.tick(30)), ['count:d', 'leave:a'], 'least recently counted of the smallest');
});

test('the current song is never the one that leaves', () => {
  const crew = new Crew({ limit: 2 });
  countedPlay(crew, 'a');
  countedPlay(crew, 'a');
  countedPlay(crew, 'b');
  countedPlay(crew, 'b');
  crew.startPlay('c');
  const events = types(crew.tick(30));
  assert.equal(events[0], 'count:c');
  assert.equal(events[1], 'leave:a');
  assert.equal(crew.members.has('c'), true);
});

test('sizes grow 7 px per play from 26 px, up to 96 px', () => {
  assert.equal(sizeFor(1), 26);
  assert.equal(sizeFor(2), 33);
  assert.equal(sizeFor(11), 96);
  assert.equal(sizeFor(40), 96);
  assert.equal(sizeFor(0), 26);
  assert.equal(PEN_LIMIT, 20);
});

test('a song always gets the same creature, and songs spread across models', () => {
  const a = creatureFor('AbC-123_xYz');
  const b = creatureFor('AbC-123_xYz');
  assert.equal(a.model, b.model);
  assert.equal(a.variant, b.variant);
  const models = new Set();
  for (let i = 0; i < 60; i++) models.add(creatureFor(`video${i}`).model.name);
  assert.ok(models.size >= 6, `only ${models.size} models used`);
});

test('there are 10 models and every frame file exists', () => {
  assert.equal(CREATURES.length, 10);
  for (const model of CREATURES) {
    for (const variant of model.variants) {
      for (const path of Object.values(variant.frames)) {
        assert.ok(existsSync(new URL(`../assets/kenney/${path}`, import.meta.url)), path);
      }
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/crew.test.js`
Expected: FAIL with `Cannot find module` for `crew.js`.

- [ ] **Step 3: Write `crew.js`**

```js
// Crew rules: which creature a song gets, and how plays hatch, grow, count and revert.
// A play counts only after 30 seconds of playback; shorter songs never count (out of scope).
// No DOM here; crew-view.js draws the pen from the events these methods return.
export const PEN_LIMIT = 20;
export const COUNT_AFTER_SECONDS = 30;

export function sizeFor(plays) {
  return Math.min(26 + (Math.max(1, plays) - 1) * 7, 96);
}

// FNV-1a: a small, stable hash so a video ID always maps to the same creature.
export function hashId(str) {
  let h = 2166136261;
  for (const ch of str) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ASTRONAUT_COLOURS = ['beige', 'green', 'pink', 'purple', 'yellow'];
const HUES = [0, 70, 150, 220, 300];

const enemy = (name, move, idle, a, b, rest) => ({
  name,
  face: 'left',
  move,
  variants: HUES.map(hue => ({
    hue,
    frames: { idle: `Enemies/${idle}.svg`, a: `Enemies/${a}.svg`, b: `Enemies/${b}.svg`, rest: `Enemies/${rest}.svg` },
  })),
});

export const CREATURES = [
  {
    name: 'Astronaut',
    face: 'right',
    move: 'walk',
    variants: ASTRONAUT_COLOURS.map(c => ({
      hue: 0,
      frames: {
        idle: `Characters/character_${c}_idle.svg`,
        a: `Characters/character_${c}_walk_a.svg`,
        b: `Characters/character_${c}_walk_b.svg`,
        rest: `Characters/character_${c}_duck.svg`,
      },
    })),
  },
  enemy('Slime', 'walk', 'slime_normal_walk_a', 'slime_normal_walk_a', 'slime_normal_walk_b', 'slime_normal_rest'),
  enemy('Spike slime', 'walk', 'slime_spike_walk_a', 'slime_spike_walk_a', 'slime_spike_walk_b', 'slime_spike_rest'),
  enemy('Block slime', 'walk', 'slime_block_walk_a', 'slime_block_walk_a', 'slime_block_walk_b', 'slime_block_rest'),
  enemy('Snail', 'walk', 'snail_walk_a', 'snail_walk_a', 'snail_walk_b', 'snail_rest'),
  enemy('Ladybug', 'walk', 'ladybug_walk_a', 'ladybug_walk_a', 'ladybug_walk_b', 'ladybug_rest'),
  enemy('Mouse', 'walk', 'mouse_walk_a', 'mouse_walk_a', 'mouse_walk_b', 'mouse_rest'),
  enemy('Worm', 'walk', 'worm_normal_move_a', 'worm_normal_move_a', 'worm_normal_move_b', 'worm_normal_rest'),
  enemy('Frog', 'hop', 'frog_idle', 'frog_idle', 'frog_jump', 'frog_rest'),
  enemy('Bee', 'fly', 'bee_a', 'bee_a', 'bee_b', 'bee_rest'),
];

export function creatureFor(videoId) {
  const h = hashId(videoId);
  const model = CREATURES[h % CREATURES.length];
  const variant = model.variants[(h >>> 8) % model.variants.length];
  return { model, variant };
}

export class Crew {
  constructor({ limit = PEN_LIMIT, countAfter = COUNT_AFTER_SECONDS } = {}) {
    this.limit = limit;
    this.countAfter = countAfter;
    this.members = new Map();   // videoId -> { provisional, lastCounted }
    this.points = new Map();    // videoId -> counted plays this session
    this.play = null;           // { id, heard, counted }
    this.seq = 0;
  }

  startPlay(id) {
    const events = this.endPlay();
    this.play = { id, heard: 0, counted: false };
    if (this.members.has(id)) {
      events.push({ type: 'evolve', id });
    } else {
      this.members.set(id, { provisional: true, lastCounted: 0 });
      events.push({ type: 'hatch', id });
    }
    return events;
  }

  tick(seconds) {
    const p = this.play;
    if (!p || p.counted) return [];
    p.heard += seconds;
    return p.heard >= this.countAfter ? this.#count(p) : [];
  }

  endPlay() {
    const p = this.play;
    this.play = null;
    if (!p || p.counted) return [];
    const member = this.members.get(p.id);
    if (member?.provisional) {
      this.members.delete(p.id);
      return [{ type: 'poof', id: p.id }];
    }
    return [{ type: 'shrink', id: p.id }];
  }

  plays(id) {
    return this.points.get(id) ?? 0;
  }

  displayPlays(id) {
    const inProgress = this.play?.id === id && !this.play.counted ? 1 : 0;
    return this.plays(id) + inProgress;
  }

  sizeOf(id) {
    return sizeFor(this.displayPlays(id));
  }

  get isFull() {
    return this.members.size >= this.limit;
  }

  #count(p) {
    p.counted = true;
    this.points.set(p.id, this.plays(p.id) + 1);
    const member = this.members.get(p.id);
    if (member) {
      member.provisional = false;
      member.lastCounted = ++this.seq;
    }
    const events = [{ type: 'count', id: p.id }];
    while (this.members.size > this.limit) {
      const out = this.#smallest(p.id);
      if (!out) break;
      this.members.delete(out);
      events.push({ type: 'leave', id: out });
    }
    return events;
  }

  // Fewest counted plays, then least recently counted. Never the current song.
  #smallest(except) {
    let best = null;
    for (const [id, member] of this.members) {
      if (id === except) continue;
      if (
        best === null ||
        this.plays(id) < this.plays(best) ||
        (this.plays(id) === this.plays(best) && member.lastCounted < this.members.get(best).lastCounted)
      ) best = id;
    }
    return best;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/crew.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add crew.js tests/crew.test.js
git commit -m "feat: crew rules for hatching, growing, counting and reverting"
```

---

### Task 6: YouTube wrapper

**Files:**
- Create: `youtube.js`
- Test: `tests/youtube.test.js`

**Interfaces:**
- Produces: `STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }`
- Produces: `videoUrl(id)`, `playlistUrl(id)`
- Produces: `fetchInfo(url, fetchImpl?) → Promise<{ title, author } | null>` (never throws)
- Produces: `fetchVideoInfos(ids, { concurrency = 4, fetchImpl?, onInfo?(id, info) }) → Promise<Map<id, info|null>>`
- Produces: `loadYouTubeApi({ timeoutMs = 15000 }) → Promise<YT>` (browser only)
- Produces: `createPlayer(YT, elementId, { onStateChange?(state), onError?(code) }) → Promise<player>` where `player` has `play(videoId)`, `pause()`, `resume()`, `stop()`, `listPlaylist(listId) → Promise<string[]>` (rejects if the playlist can't be loaded within 10 s)

- [ ] **Step 1: Write the failing test** in `tests/youtube.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchInfo, fetchVideoInfos, videoUrl, playlistUrl } from '../youtube.js';

const ok = body => ({ ok: true, json: async () => body });

test('fetchInfo asks oEmbed for the given URL and returns title and channel', async () => {
  let asked = '';
  const info = await fetchInfo(videoUrl('AbC-123_xYz'), async url => {
    asked = url;
    return ok({ title: 'Paper Lanterns', author_name: 'Mara Quell' });
  });
  assert.equal(asked, 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DAbC-123_xYz&format=json');
  assert.deepEqual(info, { title: 'Paper Lanterns', author: 'Mara Quell' });
  assert.equal(playlistUrl('PL1'), 'https://www.youtube.com/playlist?list=PL1');
});

test('fetchInfo returns null on errors instead of throwing', async () => {
  assert.equal(await fetchInfo('x', async () => ({ ok: false })), null);
  assert.equal(await fetchInfo('x', async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchInfo('x', async () => ok({ nope: true })), null);
  assert.equal(await fetchInfo('x', async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })), null);
});

test('fetchVideoInfos fetches every id, reports each, and limits requests in flight', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async url => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    const id = decodeURIComponent(url).split('v=')[1].split('&')[0];
    return id === 'bad' ? { ok: false } : ok({ title: `Title ${id}`, author_name: 'Someone' });
  };
  const seen = [];
  const ids = ['v1', 'v2', 'v3', 'bad', 'v5', 'v6', 'v7'];
  const infos = await fetchVideoInfos(ids, { concurrency: 3, fetchImpl, onInfo: id => seen.push(id) });
  assert.equal(infos.size, 7);
  assert.deepEqual(infos.get('v2'), { title: 'Title v2', author: 'Someone' });
  assert.equal(infos.get('bad'), null);
  assert.deepEqual([...seen].sort(), [...ids].sort());
  assert.ok(peak <= 3, `peak ${peak}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/youtube.test.js`
Expected: FAIL with `Cannot find module` for `youtube.js`.

- [ ] **Step 3: Write `youtube.js`**

```js
// The only file that talks to YouTube: the IFrame Player API and oEmbed title lookups.
// Docs: https://developers.google.com/youtube/iframe_api_reference
export const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export const videoUrl = id => `https://www.youtube.com/watch?v=${id}`;
export const playlistUrl = id => `https://www.youtube.com/playlist?list=${id}`;

export async function fetchInfo(url, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.title !== 'string') return null;
    return { title: data.title, author: typeof data.author_name === 'string' ? data.author_name : '' };
  } catch {
    return null;
  }
}

export async function fetchVideoInfos(ids, { concurrency = 4, fetchImpl, onInfo } = {}) {
  const waiting = [...ids];
  const results = new Map();
  async function worker() {
    while (waiting.length) {
      const id = waiting.shift();
      const info = await fetchInfo(videoUrl(id), fetchImpl);
      results.set(id, info);
      onInfo?.(id, info);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return results;
}

let apiPromise = null;

export function loadYouTubeApi({ timeoutMs = 15000 } = {}) {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const timer = setTimeout(() => reject(new Error('youtube-api-timeout')), timeoutMs);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('youtube-api-failed'));
    };
    document.head.append(script);
  });
  apiPromise.catch(() => { apiPromise = null; });
  return apiPromise;
}

export function createPlayer(YT, elementId, { onStateChange, onError } = {}) {
  let cuedAt = 0;
  return new Promise(resolve => {
    const yt = new YT.Player(elementId, {
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => resolve(wrapPlayer(yt, () => cuedAt)),
        onStateChange: e => {
          if (e.data === STATE.CUED) cuedAt = Date.now();
          onStateChange?.(e.data);
        },
        onError: e => onError?.(e.data),
      },
    });
  });
}

function wrapPlayer(yt, lastCuedAt) {
  return {
    play: videoId => yt.loadVideoById(videoId),
    pause: () => yt.pauseVideo(),
    resume: () => yt.playVideo(),
    stop: () => yt.stopVideo(),

    // Cue the playlist, wait for YouTube to report it as cued, then read its video IDs.
    // Waiting for the CUED event avoids reading the previous playlist's IDs.
    listPlaylist(listId, { timeoutMs = 10000 } = {}) {
      const since = Date.now();
      yt.cuePlaylist({ listType: 'playlist', list: listId });
      return new Promise((resolve, reject) => {
        const poll = () => {
          const ids = lastCuedAt() >= since ? yt.getPlaylist() : null;
          if (Array.isArray(ids) && ids.length) return resolve(ids);
          if (Date.now() - since > timeoutMs) return reject(new Error('playlist-unavailable'));
          setTimeout(poll, 250);
        };
        poll();
      });
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS, all test files (links, weights, rotation, storage, crew, youtube).

- [ ] **Step 5: Commit**

```bash
git add youtube.js tests/youtube.test.js
git commit -m "feat: YouTube player wrapper and oEmbed title lookups"
```

---

### Task 7: Page shell

**Files:**
- Create: `index.html`
- Create: `styles.css`

**Interfaces:**
- Produces element IDs used by later tasks: `loadForm`, `plLink`, `loadBtn`, `status`, `storageNote`, `ytPlayer`, `videoEmpty`, `nowTitle`, `nowChan`, `loopPos`, `prevBtn`, `playBtn`, `playIcon`, `nextBtn`, `endMode`, `upNext`, `yard`, `yardEmpty`, `penCount`, `plName`, `plOwner`, `listMeta`, `infoBtn`, `songs`, `addForm`, `addLink`.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Heavy Rotation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,600;12..96,800&family=Figtree:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap">
  <link rel="stylesheet" href="styles.css">
  <script type="module" src="app.js"></script>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="intro">
      <h1 class="brand"><span class="heavy">heavy</span> <span class="light">rotation</span></h1>
      <p class="tagline">Give your favourites more airtime. Turn up the songs you love, and they come around more often while the rest of the playlist stays in the mix.</p>
    </div>
    <form class="load" id="loadForm">
      <input class="field" id="plLink" placeholder="Paste a YouTube playlist or video link" aria-label="YouTube playlist or video link" autocomplete="off">
      <button class="btn primary" id="loadBtn" type="submit">Load</button>
    </form>
  </header>
  <div class="status" id="status" role="status" hidden></div>
  <p class="storage-note" id="storageNote" hidden>This browser isn't saving data for this page, so your weights won't be remembered next time.</p>

  <div class="layout">
    <div class="left">
      <section class="player" aria-label="Player">
        <div class="video">
          <div id="ytPlayer"></div>
          <div class="video-empty" id="videoEmpty">Paste a playlist link above, then press play.</div>
        </div>
        <div class="pbody">
          <div class="now">
            <div><div class="t" id="nowTitle">Nothing playing</div><div class="c" id="nowChan"></div></div>
            <div class="roundpos" id="loopPos"></div>
          </div>
          <div class="controls">
            <button class="ctl" id="prevBtn" type="button" aria-label="Previous"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
            <button class="ctl play" id="playBtn" type="button" aria-label="Play"><svg viewBox="0 0 24 24" aria-hidden="true"><path id="playIcon" d="M8 5v14l11-7z"/></svg></button>
            <button class="ctl" id="nextBtn" type="button" aria-label="Next"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg></button>
            <div class="endmode">
              <div class="seg" id="endMode" role="group" aria-label="When the loop ends">
                <button type="button" data-mode="shuffle" aria-pressed="true" aria-label="New shuffle" data-tip="New shuffle each loop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg></button>
                <button type="button" data-mode="same" aria-pressed="false" aria-label="Same order" data-tip="Repeat the same order"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></button>
                <button type="button" data-mode="stop" aria-pressed="false" aria-label="Stop" data-tip="Stop after this loop"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button>
              </div>
            </div>
          </div>
          <div class="upnext" id="upNext" hidden></div>
        </div>
      </section>

      <section class="pen" aria-label="The crew">
        <div class="penhead"><h3>The crew</h3><span class="count" id="penCount"></span></div>
        <div class="yard" id="yard"><div class="empty" id="yardEmpty">Press play and your songs show up here.</div></div>
      </section>
    </div>

    <section class="list" aria-label="Songs">
      <div class="lhead">
        <div><h2 id="plName">No playlist loaded</h2><div class="owner" id="plOwner"></div></div>
        <div class="meta"><span id="listMeta"></span>
          <span class="wlabel">Weight <button type="button" class="info" id="infoBtn" aria-label="What weight means" aria-describedby="infoTip" aria-expanded="false">i</button><span class="infotip" id="infoTip" role="tooltip">The heavier the weight, the more often a song comes around.</span></span>
        </div>
      </div>
      <ol class="songs" id="songs"></ol>
      <form class="add" id="addForm">
        <input class="field" id="addLink" placeholder="Add a single YouTube video link" aria-label="Add a single YouTube video link" autocomplete="off">
        <button class="btn" type="submit">Add</button>
      </form>
    </section>
  </div>

  <footer class="site-footer">
    made with love by twitter user <a href="https://x.com/mintbluetoyota" target="_blank" rel="noopener">@mintbluetoyota</a>.<br>
    creatures by <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a>.
  </footer>
</div>
</body>
</html>
```

- [ ] **Step 2: Write `styles.css`**

```css
:root{
  color-scheme:light;
  --bg:#eef1f4; --surface:#ffffff; --surface-2:#f5f7f9; --line:#d9dfe5;
  --ink:#16202a; --ink-2:#4f5d6b; --ink-3:#7c8995;
  --accent:#0e7c7b; --accent-ink:#ffffff; --accent-soft:#d5efee;
  --warn:#b4540f; --warn-soft:#fbe8d8;
  --bar:#0e7c7b; --bar-track:#e3e8ec; --floor:#e2e9e4;
  --shadow:0 1px 2px rgba(22,32,42,.06),0 8px 24px rgba(22,32,42,.06);
  --display:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;
  --body:"Figtree",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --bg:#0f1519; --surface:#172027; --surface-2:#1d2830; --line:#2a3741;
    --ink:#e7edf1; --ink-2:#a7b4be; --ink-3:#7a8893;
    --accent:#3cc1bd; --accent-ink:#06201f; --accent-soft:#163b3b;
    --warn:#f0a063; --warn-soft:#3a2617;
    --bar:#3cc1bd; --bar-track:#24313a; --floor:#1b2a27;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);
  }
}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 var(--body);padding-inline:16px;padding-block:14px 40px}
.wrap{max-width:1120px;margin:0 auto;display:grid;gap:14px}
button,input{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* header and link bar */
header.top{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;padding-block:10px 2px}
.intro{display:grid;gap:6px;justify-items:center}
.brand{font-family:var(--display);font-size:clamp(30px,6vw,40px);line-height:1.05;letter-spacing:-.02em;margin:0}
.brand .heavy{font-weight:800;color:var(--accent)}
.brand .light{font-weight:300}
.tagline{margin:0;font-size:14px;color:var(--ink-2);max-width:46ch;text-wrap:pretty}
form.load{display:flex;gap:8px;width:100%;max-width:640px}
.field{flex:1;min-width:0;height:42px;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:0 12px;font-size:14px}
.btn{height:42px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:var(--surface);font-weight:600;white-space:nowrap}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.status{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:14px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface)}
.status.ok{border-color:var(--accent);background:var(--accent-soft)}
.status.err{border-color:var(--warn);background:var(--warn-soft);color:var(--warn)}
.status .choice{display:flex;flex-wrap:wrap;gap:8px}
.status .btn{height:36px;font-size:13.5px}
.storage-note{margin:0;text-align:center;font-size:13px;color:var(--ink-2)}

/* layout */
.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:16px;align-items:start}
.left{position:sticky;top:calc(env(safe-area-inset-top,0px) + 12px);display:grid;gap:16px;min-width:0}

/* player */
.player{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
.video{aspect-ratio:16/9;max-width:100%;position:relative;overflow:hidden;background:#0b1114}
.video iframe,#ytPlayer{position:absolute;inset:0;width:100%;height:100%;border:0}
.video-empty{position:absolute;inset:0;display:grid;place-items:center;padding:0 24px;text-align:center;font-size:14px;color:#c6d0d8;background:linear-gradient(135deg,#1d2c35,#0f1519)}
.pbody{padding:12px 14px 14px;display:grid;gap:10px}
.now{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.now .t{font-weight:600;font-size:16px}
.now .c{color:var(--ink-2);font-size:13px}
.roundpos{font-family:var(--mono);font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ctl{width:46px;height:46px;border-radius:50%;border:1px solid var(--line);background:var(--surface-2);display:grid;place-items:center}
.ctl.play{width:54px;height:54px;background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.ctl svg{width:20px;height:20px;fill:currentColor}
.endmode{margin-left:auto;display:flex;align-items:center;gap:8px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;background:var(--surface-2)}
.seg button{position:relative;border:0;background:none;width:42px;height:40px;display:grid;place-items:center;color:var(--ink-2);border-radius:9px}
.seg button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.seg button[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink)}
.seg button::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translate(-50%,4px);background:var(--ink);color:var(--bg);font-size:12px;font-weight:500;line-height:1.3;padding:6px 9px;border-radius:7px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s,transform .15s;z-index:10}
.seg button:last-child::after{left:auto;right:0;transform:translate(0,4px)}
.seg button:hover::after,.seg button:focus-visible::after,.seg button.tip::after{opacity:1;transform:translate(-50%,0)}
.seg button:last-child:hover::after,.seg button:last-child:focus-visible::after,.seg button:last-child.tip::after{transform:translate(0,0)}
@media (hover:none){.seg button:hover::after{opacity:0}.seg button.tip::after{opacity:1}}
.upnext{font-size:13px;color:var(--ink-2);display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.upnext .lbl{text-transform:uppercase;letter-spacing:.06em;font-size:11px;color:var(--ink-3);font-weight:600}
.chip{background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:2px 9px;color:var(--ink)}
.chip.sep{border-style:dashed;color:var(--ink-3);background:none}

/* song list */
.list{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
.lhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.lhead h2{font-family:var(--display);font-size:17px;margin:0;font-weight:600}
.lhead .owner{font-size:13px;color:var(--ink-2)}
.lhead .meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.wlabel{position:relative;display:inline-flex;align-items:center;gap:5px;font-weight:600;color:var(--ink)}
.info{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--ink-3);background:none;color:var(--ink-2);font:italic 600 11px/1 Georgia,serif;display:grid;place-items:center;padding:0}
.info:hover,.info[aria-expanded="true"]{border-color:var(--accent);color:var(--accent)}
.infotip{position:absolute;right:0;top:calc(100% + 8px);width:max-content;max-width:220px;background:var(--ink);color:var(--bg);font-size:12.5px;font-weight:500;line-height:1.35;padding:7px 10px;border-radius:7px;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .15s,transform .15s;z-index:10}
.info:hover+.infotip,.info:focus-visible+.infotip,.info[aria-expanded="true"]+.infotip{opacity:1;transform:none}
ol.songs{list-style:none;margin:0;padding:0}
.song{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);transition:background .3s}
.song:last-child{border-bottom:0}
.song.current{background:var(--accent-soft)}
.song .name{border:0;background:none;padding:0;text-align:left;min-width:0}
.song .name .t{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.song .name .c{display:block;font-size:12.5px;color:var(--ink-2)}
.song .stats{grid-column:1/-1;display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.share{flex:1;height:5px;border-radius:3px;background:var(--bar-track);overflow:hidden;max-width:220px}
.share i{display:block;height:100%;background:var(--bar);border-radius:3px;transition:width .3s}
.stats .freq{color:var(--ink)}
.stepper{display:flex;align-items:center;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface-2)}
.stepper button{width:40px;height:40px;border:0;background:none;font-size:20px;line-height:1;color:var(--ink)}
.stepper button:disabled{color:var(--ink-3);cursor:default}
.stepper input{width:44px;height:40px;border:0;border-inline:1px solid var(--line);background:var(--surface);text-align:center;font-family:var(--mono);font-size:15px;font-variant-numeric:tabular-nums;-moz-appearance:textfield}
.stepper input::-webkit-inner-spin-button,.stepper input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.badge{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:2px 7px;border-radius:6px}
.badge.now{background:var(--accent);color:var(--accent-ink)}
.badge.bad{background:var(--warn-soft);color:var(--warn)}
.song.blocked .name .t{color:var(--ink-3)}
.song.blocked .stats{color:var(--warn)}
form.add{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--line);background:var(--surface-2)}
.moved{animation:flash .9s ease-out}
@keyframes flash{from{background:var(--accent-soft)}to{background:transparent}}

/* the crew */
.pen{background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
.penhead{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.penhead h3{margin:0;font-family:var(--display);font-size:15px;font-weight:600}
.penhead .count{font-size:12.5px;color:var(--ink-2);margin-right:auto}
.yard{position:relative;height:240px;overflow:hidden;background:linear-gradient(to top,var(--floor) 0,var(--floor) 58px,var(--surface-2) 58px)}
.yard .empty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:0 24px;font-size:13px;color:var(--ink-3)}
.cr{position:absolute;display:flex;flex-direction:column;align-items:center;gap:1px;transform:translateX(-50%);cursor:default}
.cr .body{position:relative;transition:width .6s cubic-bezier(.3,1.6,.5,1),height .6s cubic-bezier(.3,1.6,.5,1)}
.cr .flip{width:100%;height:100%}
.cr .flip.left{transform:scaleX(-1)}
.cr .tag{font-size:10.5px;line-height:1.3;max-width:96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--surface);border:1px solid var(--line);color:var(--ink-2);border-radius:999px;padding:0 6px}
.cr.current .tag{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.cr.current .flip{filter:drop-shadow(2px 0 0 var(--accent)) drop-shadow(-2px 0 0 var(--accent)) drop-shadow(0 2px 0 var(--accent)) drop-shadow(0 -2px 0 var(--accent)) drop-shadow(0 0 8px var(--accent))}
.cr .shadow{position:absolute;left:15%;right:15%;bottom:-2px;height:5px;border-radius:50%;background:rgba(0,0,0,.14)}
.cr.floaty .shadow{opacity:.6;transform:scaleX(.7)}
.kn{position:relative;width:100%;height:100%;transform-origin:50% 100%}
.kn .fr{position:absolute;inset:0;width:100%;height:100%;opacity:0;user-select:none;-webkit-user-drag:none}
.kn .f-idle{opacity:1}
.cr.walk .kn .f-idle,.kn.fly .f-idle{opacity:0}
.cr.walk .kn .f-a,.kn.fly .f-a{animation:frA .36s step-end infinite}
.cr.walk .kn .f-b,.kn.fly .f-b{animation:frB .36s step-end infinite}
.kn.fly .f-a,.kn.fly .f-b{animation-duration:.14s}
@keyframes frA{0%{opacity:1}50%{opacity:0}}
@keyframes frB{0%{opacity:0}50%{opacity:1}}
.cr.walk .kn.walk{animation:knbob .36s ease-in-out infinite}
@keyframes knbob{0%,100%{transform:translateY(0) scale(1.02,.98)}50%{transform:translateY(-4%) scale(.99,1.02)}}
.cr.walk .kn.hop{animation:knhop .72s cubic-bezier(.3,0,.7,1) infinite}
@keyframes knhop{0%,100%{transform:translateY(0) scale(1.06,.94)}45%{transform:translateY(-22%) scale(.95,1.06)}}
.cr.floaty .kn{animation:knfloat 2.2s ease-in-out infinite}
@keyframes knfloat{0%,100%{transform:translateY(-4%)}50%{transform:translateY(-14%)}}
.yard.paused .kn,.yard.paused .kn .fr,.yard.paused .note-fx{animation-play-state:paused!important}
.cr.hatching .body{animation:hatch .7s cubic-bezier(.3,1.7,.5,1)}
@keyframes hatch{from{transform:scale(.1) translateY(20px);opacity:0}to{transform:none;opacity:1}}
.cr.poof .body{animation:poof .45s ease-in forwards}
@keyframes poof{30%{transform:scale(1.15)}to{transform:scale(0);opacity:0}}
.cr.poof .tag{transition:opacity .3s;opacity:0}
.cr.shrink .body{animation:shrinkback .5s ease-out}
@keyframes shrinkback{0%{transform:scale(1.12)}40%{transform:scale(.9) rotate(-4deg)}70%{transform:scale(1.03) rotate(3deg)}100%{transform:none}}
.cr.evolving .flip{animation:evolve 1.1s ease-in-out}
@keyframes evolve{0%{filter:brightness(1)}20%{transform:translateY(-10px) rotate(-8deg) scale(.9)}40%{filter:brightness(3) saturate(0);transform:translateY(-14px) rotate(8deg) scale(1.15)}55%{filter:brightness(3) saturate(0);transform:translateY(-14px) scale(1.3)}80%{transform:translateY(-2px) scale(.95)}100%{filter:brightness(1);transform:none}}
.cr.evolving .body .flip.left{animation-name:evolve-l}
@keyframes evolve-l{0%{filter:brightness(1);transform:scaleX(-1)}40%{filter:brightness(3) saturate(0);transform:scaleX(-1) translateY(-14px) scale(1.15)}55%{filter:brightness(3) saturate(0);transform:scaleX(-1) translateY(-14px) scale(1.3)}100%{filter:brightness(1);transform:scaleX(-1)}}
.cr .spark{position:absolute;left:50%;top:45%;font-size:13px;color:#e0b100;pointer-events:none;animation:spark 1s ease-out forwards}
@keyframes spark{from{opacity:1;transform:translate(-50%,-50%) scale(.4)}to{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1.2)}}
.cr .note-fx{position:absolute;bottom:60%;font-size:15px;font-weight:700;color:var(--accent);pointer-events:none;animation:notefly 1.6s ease-out forwards;text-shadow:0 1px 0 var(--surface)}
@keyframes notefly{from{opacity:0;transform:translate(0,0) rotate(-10deg) scale(.7)}15%{opacity:1}to{opacity:0;transform:translate(var(--drift),-46px) rotate(12deg) scale(1.1)}}
.cr .tip{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translate(-50%,4px);background:var(--ink);color:var(--bg);font-size:12px;line-height:1.35;padding:6px 9px;border-radius:7px;white-space:nowrap;text-align:center;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;z-index:30}
.cr .tip b{font-weight:600;display:block}
.cr:hover,.cr.show{z-index:40!important}
.cr:hover .tip,.cr.show .tip{opacity:1;transform:translate(-50%,0)}
@media (hover:none){.cr:hover .tip{opacity:0}.cr.show .tip{opacity:1}}

/* footer, reused from 4benies-tracker */
footer.site-footer{margin-top:2rem;padding-top:1.25rem;border-top:1px solid var(--line);text-align:center;font-size:.75rem;color:var(--ink-3);line-height:1.6}
footer.site-footer a{color:var(--ink-2);text-decoration:none;border-bottom:1px solid transparent;transition:border-color .15s}
footer.site-footer a:hover{border-bottom-color:var(--ink-2)}

@media (max-width:760px){
  .layout{grid-template-columns:minmax(0,1fr)}
  .left{display:contents}
  .player{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;border-radius:12px}
  .yard{height:220px}
  .pbody{padding:10px 12px 12px;gap:8px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
```

- [ ] **Step 3: Check the page renders** (ask the user to do this in a browser)

Run: `python3 -m http.server 8000` from `weighted-playlist/`, then open `http://localhost:8000`.
Expected: the centred header, link bar, a dark video box saying "Paste a playlist link above, then press play.", the controls, the empty pen ("Press play and your songs show up here."), the empty song list ("No playlist loaded") and the footer. The browser console shows a 404 for `app.js`; that file comes in Task 8. At a narrow window width, the layout stacks.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat: page shell and styles"
```

---

### Task 8: The player app

**Files:**
- Create: `songs-view.js`
- Create: `player-view.js`
- Create: `app.js`

**Interfaces:**
- Consumes: everything from Tasks 1–4 and 6, and the element IDs from Task 7.
- Produces (`songs-view.js`): `setupSongList(listEl, { onPlayNow(id), onWeight(id, value) })`, `renderSongs(listEl, rows)`, `flashRow(listEl, id)`. `rows` items: `{ id, title, author, weight, blocked, current, share (0–1), freq }`.
- Produces (`player-view.js`): `setupEndModeButtons(groupEl, onChange(mode))`, `renderPlayer(els, view)`. `view`: `{ title, author, loopText, playing, upcoming: (string | null)[], endMode, showEmpty }`.
- Produces (`app.js`, used by Task 9): functions `playSong(id)`, `next()`, `onStateChange(s)`, `setSource(sourceId, playlistIds)`, `render()`, and `state.playerState`.

- [ ] **Step 1: Write `songs-view.js`**

```js
// Draws the song list. Rows are keyed by video ID and updated in place,
// so typing in a weight box keeps its focus while the list re-renders.
import { MAX_WEIGHT, MIN_WEIGHT } from './weights.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function setupSongList(listEl, { onPlayNow, onWeight }) {
  listEl.addEventListener('click', e => {
    const button = e.target.closest('button');
    const row = button?.closest('.song');
    if (!row) return;
    const id = row.dataset.id;
    const input = row.querySelector('input');
    if (button.dataset.role === 'inc') onWeight(id, Number(input.value) + 1);
    else if (button.dataset.role === 'dec') onWeight(id, Number(input.value) - 1);
    else if (button.dataset.role === 'name' && !row.classList.contains('blocked')) onPlayNow(id);
  });
  listEl.addEventListener('change', e => {
    if (e.target.dataset.role !== 'weight') return;
    onWeight(e.target.closest('.song').dataset.id, e.target.value);
  });
}

function createRow(id) {
  const li = el('li', 'song');
  li.dataset.id = id;
  const name = el('button', 'name');
  name.type = 'button';
  name.dataset.role = 'name';
  name.append(el('span', 't'), el('span', 'c'));
  const stepper = el('div', 'stepper');
  const dec = el('button', null, '−');
  dec.type = 'button';
  dec.dataset.role = 'dec';
  dec.setAttribute('aria-label', 'Lower weight');
  const input = el('input');
  input.type = 'number';
  input.min = String(MIN_WEIGHT);
  input.max = String(MAX_WEIGHT);
  input.inputMode = 'numeric';
  input.id = `w-${id}`;
  input.dataset.role = 'weight';
  const inc = el('button', null, '+');
  inc.type = 'button';
  inc.dataset.role = 'inc';
  inc.setAttribute('aria-label', 'Raise weight');
  stepper.append(dec, input, inc);
  li.append(name, stepper, el('div', 'stats'));
  return li;
}

export function renderSongs(listEl, rows) {
  const existing = new Map([...listEl.children].map(li => [li.dataset.id, li]));
  rows.forEach((row, index) => {
    const li = existing.get(row.id) ?? createRow(row.id);
    existing.delete(row.id);
    li.classList.toggle('current', row.current);
    li.classList.toggle('blocked', row.blocked);
    li.querySelector('.name .t').textContent = row.title;
    li.querySelector('.name .c').textContent = row.author;
    li.querySelector('.name').setAttribute('aria-label', `Play ${row.title} now`);
    const input = li.querySelector('input');
    if (document.activeElement !== input) input.value = String(row.weight);
    input.setAttribute('aria-label', `Weight for ${row.title}`);
    li.querySelector('[data-role="dec"]').disabled = row.weight <= MIN_WEIGHT;
    li.querySelector('[data-role="inc"]').disabled = row.weight >= MAX_WEIGHT;

    const stats = li.querySelector('.stats');
    stats.replaceChildren();
    if (row.blocked) {
      stats.append(el('span', 'badge bad', "Can't play here"), el('span', null, "This video can't play here, so it's skipped."));
    } else {
      if (row.current) stats.append(el('span', 'badge now', 'Now'));
      const share = el('span', 'share');
      const bar = el('i');
      bar.style.width = `${(row.share * 100).toFixed(1)}%`;
      share.append(bar);
      stats.append(share, el('span', 'freq', row.freq));
    }

    // Only move rows that are out of place, so a focused weight box isn't disturbed.
    if (listEl.children[index] !== li) listEl.insertBefore(li, listEl.children[index] ?? null);
  });
  existing.forEach(li => li.remove());
}

export function flashRow(listEl, id) {
  const li = listEl.querySelector(`.song[data-id="${CSS.escape(id)}"]`);
  if (!li) return;
  li.classList.remove('moved');
  void li.offsetWidth;
  li.classList.add('moved');
}
```

- [ ] **Step 2: Write `player-view.js`**

```js
// Now playing, loop position, play/pause icon, up next, and the end-of-loop buttons.
const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z';

export function setupEndModeButtons(groupEl, onChange) {
  let tipTimer;
  for (const button of groupEl.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      onChange(button.dataset.mode);
      // Touch screens have no hover, so a tap shows the tooltip for a moment.
      groupEl.querySelectorAll('button.tip').forEach(b => b.classList.remove('tip'));
      button.classList.add('tip');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => button.classList.remove('tip'), 1500);
    });
  }
}

export function renderPlayer(els, view) {
  els.nowTitle.textContent = view.title;
  els.nowChan.textContent = view.author;
  els.loopPos.textContent = view.loopText;
  els.playBtn.setAttribute('aria-label', view.playing ? 'Pause' : 'Play');
  els.playIcon.setAttribute('d', view.playing ? ICON_PAUSE : ICON_PLAY);
  els.videoEmpty.hidden = !view.showEmpty;

  const label = document.createElement('span');
  label.className = 'lbl';
  label.textContent = 'Up next';
  const chips = view.upcoming.map(title => {
    const chip = document.createElement('span');
    chip.className = title === null ? 'chip sep' : 'chip';
    chip.textContent = title === null ? 'new loop' : title;
    return chip;
  });
  els.upNext.replaceChildren(label, ...chips);
  els.upNext.hidden = chips.length === 0;

  for (const button of els.endMode.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === view.endMode));
  }
}
```

- [ ] **Step 3: Write `app.js`**

```js
// Wires the page together: link bar, playlist loading, weights, playback and saving.
import { parseLink, isMix } from './links.js';
import { clampWeight, playsPerLoop, frequencyText, compareSongs } from './weights.js';
import { Queue } from './rotation.js';
import { createStore, MINE } from './storage.js';
import { loadYouTubeApi, createPlayer, fetchInfo, fetchVideoInfos, playlistUrl, videoUrl, STATE } from './youtube.js';
import { setupSongList, renderSongs, flashRow } from './songs-view.js';
import { setupEndModeButtons, renderPlayer } from './player-view.js';

const $ = id => document.getElementById(id);
const MY_ROTATION = 'My rotation';

let backend = null;
try {
  backend = window.localStorage;
} catch {
  backend = null; // storage blocked by the browser
}
const store = createStore(backend);
const settings = store.loadSettings();

const state = {
  sourceId: null,               // YouTube playlist ID, or MINE for a list started from single videos
  title: '',
  owner: '',
  songs: new Map(),             // videoId -> { id, title, author, weight, extra, blocked }
  order: [],                    // videoIds in display order
  playerState: STATE.UNSTARTED,
  playStarted: false,           // has the current queue item started playing yet
};
let queue = newQueue();
let player = null;
let resortTimer = null;
let renderQueued = false;

const playerEls = {
  nowTitle: $('nowTitle'), nowChan: $('nowChan'), loopPos: $('loopPos'), playBtn: $('playBtn'),
  playIcon: $('playIcon'), videoEmpty: $('videoEmpty'), upNext: $('upNext'), endMode: $('endMode'),
};

function newQueue() {
  const q = new Queue();
  q.endMode = settings.endMode;
  return q;
}

// ---------- status line ----------

function showStatus(message, kind = '', actions = []) {
  const box = $('status');
  box.className = `status ${kind}`.trim();
  const text = document.createElement('span');
  text.textContent = message;
  box.replaceChildren(text);
  if (actions.length) {
    const choice = document.createElement('span');
    choice.className = 'choice';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.primary ? 'btn primary' : 'btn';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        hideStatus();
        action.onClick();
      });
      choice.append(button);
    }
    box.append(choice);
  }
  box.hidden = false;
}

function hideStatus() {
  $('status').hidden = true;
}

// ---------- songs, weights, saving ----------

const playable = () => [...state.songs.values()].filter(s => !s.blocked);
const titleOf = id => state.songs.get(id)?.title ?? id;

function updateCounts() {
  queue.setCounts(playsPerLoop(playable()).counts);
}

function resort() {
  state.order = [...state.songs.values()]
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || compareSongs(a, b))
    .map(s => s.id);
}

function save() {
  if (!state.sourceId) return;
  const weights = {};
  const extras = [];
  for (const s of state.songs.values()) {
    weights[s.id] = s.weight;
    if (s.extra) extras.push(s.id);
  }
  store.savePlaylist(state.sourceId, { weights, extras });
  store.saveSettings(settings);
}

function addSong(id, weight, extra) {
  state.songs.set(id, { id, title: null, author: '', weight, extra, blocked: false });
}

function setWeight(id, value) {
  const song = state.songs.get(id);
  if (!song) return;
  song.weight = clampWeight(value);
  updateCounts();
  save();
  render();
  // Re-sort about a second after the last change, so rows don't jump while tapping.
  clearTimeout(resortTimer);
  resortTimer = setTimeout(() => {
    const before = state.order.join();
    resort();
    render();
    if (state.order.join() !== before) flashRow($('songs'), id);
  }, 1000);
}

// ---------- loading ----------

function setSource(sourceId, playlistIds) {
  const saved = store.loadPlaylist(sourceId);
  state.sourceId = sourceId;
  state.songs = new Map();
  for (const id of playlistIds) if (!state.songs.has(id)) addSong(id, saved.weights[id] ?? 1, false);
  for (const id of saved.extras) if (!state.songs.has(id)) addSong(id, saved.weights[id] ?? 1, true);
  settings.lastSource = { type: sourceId === MINE ? 'mine' : 'playlist', id: sourceId };
  if (player) player.stop();
  state.playStarted = false;
  queue = newQueue();
  updateCounts();
  resort();
  save();
  render();
  loadTitles([...state.songs.keys()]);
}

function loadTitles(ids) {
  fetchVideoInfos(ids, {
    onInfo: (id, info) => {
      const song = state.songs.get(id);
      if (song && info) {
        song.title = info.title;
        song.author = info.author;
      }
      scheduleRender();
    },
  }).then(() => {
    resort();
    render();
  });
}

async function loadPlaylist(listId) {
  if (!player) return showStatus('The YouTube player is still loading. Try again in a moment.');
  showStatus('Loading playlist…');
  let ids;
  try {
    ids = await player.listPlaylist(listId);
  } catch {
    return showStatus(isMix(listId)
      ? "YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead."
      : "Couldn't load this playlist. It may be private or deleted.", 'err');
  }
  hideStatus();
  state.title = 'YouTube playlist';
  state.owner = '';
  setSource(listId, ids);
  const info = await fetchInfo(playlistUrl(listId));
  if (info && state.sourceId === listId) {
    state.title = info.title;
    state.owner = info.author;
    render();
  }
}

async function addVideo(videoId) {
  if (!state.sourceId) {
    state.title = MY_ROTATION;
    state.owner = '';
    setSource(MINE, []);
  }
  if (state.songs.has(videoId)) return showStatus('That song is already in the list.');
  addSong(videoId, 1, true);
  updateCounts();
  resort();
  save();
  render();
  showStatus(`Added to ${state.title}, weight 1.`, 'ok');
  const info = await fetchInfo(videoUrl(videoId));
  const song = state.songs.get(videoId);
  if (song && info) {
    song.title = info.title;
    song.author = info.author;
    resort();
    render();
  }
}

// ---------- playback ----------

function playSong(id) {
  if (!id) return;
  state.playStarted = false;
  player.play(id);
  render();
}

function next() {
  const id = queue.next();
  if (id) playSong(id);
  else {
    player.stop();
    render();
  }
}

function previous() {
  let id = queue.previous();
  while (id && state.songs.get(id)?.blocked) id = queue.previous();
  if (id) playSong(id);
}

function togglePlay() {
  if (!player) return;
  if (!queue.current) {
    const id = queue.start();
    if (id) playSong(id);
    return;
  }
  if (state.playerState === STATE.PLAYING) player.pause();
  else player.resume();
}

function playNow(id) {
  if (player && queue.playNow(id)) playSong(id);
}

function onStateChange(s) {
  state.playerState = s;
  if (s === STATE.PLAYING) state.playStarted = true;
  if (s === STATE.ENDED) next();
  render();
}

// Errors 2, 5, 100, 101, 150: the video can't play here. Mark it and move on.
function onError() {
  const song = state.songs.get(queue.current);
  if (!song) return;
  song.blocked = true;
  updateCounts();
  resort();
  next();
  if (!playable().length) {
    showStatus("None of these songs can play here. Their owners don't allow playing on other websites.", 'err');
  }
}

// ---------- rendering ----------

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const songs = playable();
  const { counts, length } = playsPerLoop(songs);
  const total = songs.reduce((sum, s) => sum + s.weight, 0);
  renderSongs($('songs'), state.order.map(id => {
    const s = state.songs.get(id);
    const plays = counts.get(id) ?? 0;
    return {
      id,
      title: s.title ?? id,
      author: s.author,
      weight: s.weight,
      blocked: s.blocked,
      current: id === queue.current,
      share: total && !s.blocked ? s.weight / total : 0,
      freq: plays ? frequencyText(plays, length) : '',
    };
  }));
  $('plName').textContent = state.sourceId ? state.title : 'No playlist loaded';
  $('plOwner').textContent = state.owner ? `by ${state.owner}` : '';
  $('listMeta').textContent = state.songs.size ? `${state.songs.size} songs · ${length} plays per loop` : '';

  const current = queue.current ? state.songs.get(queue.current) : null;
  renderPlayer(playerEls, {
    title: current ? (current.title ?? current.id) : 'Nothing playing',
    author: current?.author ?? '',
    loopText: current ? `Loop ${queue.loopNumber} · ${queue.position} of ${queue.loopLength}` : '',
    playing: state.playerState === STATE.PLAYING,
    upcoming: state.songs.size ? queue.upcoming(4).map(id => (id === null ? null : titleOf(id))) : [],
    endMode: queue.endMode,
    showEmpty: !current,
  });
}

// ---------- events ----------

setupSongList($('songs'), { onPlayNow: playNow, onWeight: setWeight });
setupEndModeButtons($('endMode'), mode => {
  queue.endMode = mode;
  settings.endMode = mode;
  store.saveSettings(settings);
  render();
});
$('playBtn').addEventListener('click', togglePlay);
$('nextBtn').addEventListener('click', () => { if (player && queue.current) next(); });
$('prevBtn').addEventListener('click', () => { if (player) previous(); });

$('plLink').addEventListener('input', () => {
  $('loadBtn').textContent = parseLink($('plLink').value).type === 'video' ? 'Add' : 'Load';
  hideStatus();
});
$('loadForm').addEventListener('submit', e => {
  e.preventDefault();
  const link = parseLink($('plLink').value);
  if (link.type === 'empty') return;
  if (link.type === 'invalid') {
    return showStatus("That doesn't look like a YouTube link. Paste a playlist link (it contains list=) or a video link.", 'err');
  }
  $('plLink').value = '';
  $('loadBtn').textContent = 'Load';
  if (link.type === 'playlist') loadPlaylist(link.listId);
  else if (link.type === 'video') addVideo(link.videoId);
  else {
    showStatus('This link is a video inside a playlist.', '', [
      { label: 'Load the whole playlist', primary: true, onClick: () => loadPlaylist(link.listId) },
      { label: 'Add just this video', onClick: () => addVideo(link.videoId) },
    ]);
  }
});
$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const link = parseLink($('addLink').value);
  if (link.type === 'empty') return;
  if (link.type === 'playlist') return showStatus("That's a playlist link. Paste it in the top bar to load it.", 'err');
  if (link.type === 'invalid') return showStatus("That doesn't look like a YouTube video link.", 'err');
  $('addLink').value = '';
  addVideo(link.videoId);
});

// The weight ⓘ tooltip: tap to open, tap anywhere else to close.
$('infoBtn').addEventListener('click', e => {
  e.stopPropagation();
  const button = $('infoBtn');
  button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
});
document.addEventListener('click', () => $('infoBtn').setAttribute('aria-expanded', 'false'));

if (!store.available) $('storageNote').hidden = false;
render();
boot();

async function boot() {
  try {
    const YT = await loadYouTubeApi();
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

- [ ] **Step 4: Run the automated tests** (nothing should have broken)

Run: `node --test`
Expected: PASS, all test files.

- [ ] **Step 5: Manual check in a browser** (ask the user; they need a real playlist link)

Run: `python3 -m http.server 8000`, open `http://localhost:8000`, and check:
1. Paste a playlist link and press Load: the list fills with titles and channels, the header shows the playlist title and "by <owner>", and "N songs · N plays per loop".
2. Press Play: the video plays, "Now" is on the right row, "Loop 1 · 1 of N" shows, Up next lists four songs.
3. Let a song end (or seek near its end): the next song from our loop plays, not YouTube's own next video.
4. Raise a weight with `+`: the frequency text and bars change straight away; about a second later the row moves up and flashes.
5. Type `0`, `abc` and `150` into a weight box: it becomes 1, 1 and 99.
6. Reload the page: the same playlist loads with the same weights.
7. Try the three end-of-loop icons: tooltips show; "Stop" ends playback after the last song of the loop.
8. Paste `https://example.com`: the error message shows. Paste a `watch?v=…&list=…` link: the two choice buttons show.

Report anything that doesn't match. If step 3 shows YouTube continuing its own playlist instead of ours, stop and tell the user before changing code.

- [ ] **Step 6: Commit**

```bash
git add songs-view.js player-view.js app.js
git commit -m "feat: playlist loading, weighted playback and song list"
```

---

### Task 9: The crew in the page

**Files:**
- Create: `crew-view.js`
- Modify: `app.js` (imports, crew setup, `playSong`, `next`, `setSource`, `onStateChange`, `render`)

**Interfaces:**
- Consumes: `Crew`, `creatureFor`, `PEN_LIMIT` from `crew.js` (Task 5); `app.js` functions from Task 8.
- Produces: `class CrewView` with `new CrewView({ yard, empty, count, crew, titleFor, assetBase? })`, `apply(events)`, `setCurrent(id | null)`, `setPaused(boolean)`, `refreshTitles()`.

- [ ] **Step 1: Write `crew-view.js`**

```js
// Draws the pen: creatures hatch, wander, grow, shrink back, poof or walk out,
// following the events from crew.js. Movement stops while playback is paused.
import { creatureFor, PEN_LIMIT } from './crew.js';

const LANES = [6, 20, 34];              // three depths, so creatures overlap less
const NOTES = ['♪', '♫', '♩', '♬'];
const WALK_SPEED = 26;                  // px per second for a 36 px creature; bigger ones walk slower
const SCALE = 1.15;                     // Kenney frames have some empty space around the creature

export class CrewView {
  constructor({ yard, empty, count, crew, titleFor, assetBase = 'assets/kenney/' }) {
    this.yard = yard;
    this.empty = empty;
    this.count = count;
    this.crew = crew;
    this.titleFor = titleFor;
    this.assetBase = assetBase;
    this.sprites = new Map();
    this.current = null;
    this.paused = true;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.lastFrame = performance.now();
    yard.classList.add('paused');
    // Phones have no hover: tap a creature to show its play count for a moment.
    yard.addEventListener('click', e => this.#showTip(e.target.closest('.cr')));
    requestAnimationFrame(now => this.#frame(now));
  }

  apply(events) {
    for (const { type, id } of events) {
      if (type === 'hatch') this.#hatch(id);
      else if (type === 'evolve') this.#evolve(id);
      else if (type === 'count') this.#updateTip(id);
      else if (type === 'shrink') this.#shrink(id);
      else if (type === 'poof') this.#poof(id);
      else if (type === 'leave') this.#leave(id);
    }
    this.#renderHead();
  }

  setCurrent(id) {
    this.current = id;
  }

  setPaused(paused) {
    this.paused = paused;
    this.yard.classList.toggle('paused', paused);
  }

  refreshTitles() {
    for (const [id, sprite] of this.sprites) {
      const title = this.titleFor(id);
      if (sprite.tag.textContent !== title) {
        sprite.tag.textContent = title;
        this.#updateTip(id);
      }
    }
  }

  #hatch(id) {
    this.sprites.get(id)?.el.remove(); // a creature still walking out gets replaced
    const { model, variant } = creatureFor(id);
    const el = document.createElement('div');
    el.className = model.move === 'fly' ? 'cr hatching floaty' : 'cr hatching';
    const body = document.createElement('div');
    body.className = 'body';
    const shadow = document.createElement('span');
    shadow.className = 'shadow';
    const flip = document.createElement('div');
    flip.className = 'flip';
    const frames = document.createElement('div');
    frames.className = `kn ${model.move}`;
    if (variant.hue) frames.style.filter = `hue-rotate(${variant.hue}deg)`;
    for (const frame of ['idle', 'a', 'b']) {
      const img = document.createElement('img');
      img.className = `fr f-${frame}`;
      img.src = this.assetBase + variant.frames[frame];
      img.alt = '';
      img.draggable = false;
      frames.append(img);
    }
    flip.append(frames);
    body.append(shadow, flip);
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = this.titleFor(id);
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    el.append(body, tag, tip);
    const lane = Math.floor(Math.random() * LANES.length);
    el.style.bottom = `${LANES[lane]}px`;
    el.style.zIndex = String(10 - lane);
    this.yard.append(el);

    const size = this.crew.sizeOf(id) * SCALE;
    this.sprites.set(id, {
      el, body, flip, tag, tip, size,
      x: Math.random() * Math.max(0, this.yard.clientWidth - size),
      dir: Math.random() < 0.5 ? -1 : 1,
      mode: 'idle',
      t: 0.8,
      leaving: false,
      face: model.face,
      noteAt: 0,
    });
    this.#size(id);
    this.#updateTip(id);
    setTimeout(() => el.classList.remove('hatching'), 700);
  }

  #evolve(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return this.#hatch(id);
    sprite.el.classList.remove('evolving');
    void sprite.el.offsetWidth;
    sprite.el.classList.add('evolving');
    for (let i = 0; i < 10; i++) {
      const spark = document.createElement('span');
      spark.className = 'spark';
      spark.textContent = i % 2 ? '✦' : '✧';
      const angle = (i / 10) * Math.PI * 2;
      spark.style.setProperty('--dx', `${Math.cos(angle) * 42}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * 34 - 10}px`);
      sprite.body.append(spark);
      setTimeout(() => spark.remove(), 1000);
    }
    setTimeout(() => this.#size(id), 450); // grow at the brightest point of the flash
    setTimeout(() => sprite.el.classList.remove('evolving'), 1100);
  }

  #shrink(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    this.#size(id);
    sprite.el.classList.add('shrink');
    setTimeout(() => sprite.el.classList.remove('shrink'), 500);
  }

  #poof(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    this.sprites.delete(id);
    sprite.el.classList.add('poof');
    setTimeout(() => sprite.el.remove(), 450);
  }

  #leave(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    if (this.reducedMotion) {
      sprite.el.remove();
      this.sprites.delete(id);
      return;
    }
    sprite.leaving = true;
    sprite.dir = sprite.x < this.yard.clientWidth / 2 ? -1 : 1;
  }

  #size(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    sprite.size = this.crew.sizeOf(id) * SCALE;
    sprite.body.style.width = `${sprite.size}px`;
    sprite.body.style.height = `${sprite.size}px`;
  }

  #updateTip(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    const n = this.crew.plays(id);
    const title = document.createElement('b');
    title.textContent = this.titleFor(id);
    sprite.tip.replaceChildren(title, `Played ${n} ${n === 1 ? 'time' : 'times'}`);
  }

  #showTip(el) {
    if (!el) return;
    this.yard.querySelectorAll('.cr.show').forEach(other => other !== el && other.classList.remove('show'));
    el.classList.add('show');
    clearTimeout(el.tipTimer);
    el.tipTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  #renderHead() {
    this.count.textContent = this.crew.isFull ? `Your top ${PEN_LIMIT} songs` : '';
    this.empty.hidden = this.sprites.size > 0;
  }

  #frame(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const width = this.yard.clientWidth;
    for (const [id, sprite] of this.sprites) {
      const isCurrent = id === this.current && !sprite.leaving;
      sprite.el.classList.toggle('current', isCurrent);
      if (!this.paused && !this.reducedMotion) {
        if (!sprite.leaving) {
          sprite.t -= dt;
          if (sprite.t <= 0) {
            if (sprite.mode === 'walk') {
              sprite.mode = 'idle';
              sprite.t = 1 + Math.random() * 2.5;
            } else {
              sprite.mode = 'walk';
              sprite.t = 2 + Math.random() * 4;
              if (Math.random() < 0.4) sprite.dir *= -1;
            }
          }
        }
        if (sprite.mode === 'walk' || sprite.leaving) {
          sprite.x += sprite.dir * (WALK_SPEED / Math.sqrt(sprite.size / 36)) * dt;
          if (sprite.leaving) {
            if (sprite.x < -sprite.size - 100 || sprite.x > width + 100) {
              sprite.el.remove();
              this.sprites.delete(id);
              this.#renderHead();
              continue;
            }
          } else if (sprite.x < 0) {
            sprite.x = 0;
            sprite.dir = 1;
          } else if (sprite.x > width - sprite.size) {
            sprite.x = Math.max(0, width - sprite.size);
            sprite.dir = -1;
          }
        }
        if (isCurrent && now - sprite.noteAt > 520) {
          sprite.noteAt = now;
          this.#note(sprite);
        }
      }
      sprite.el.classList.toggle('walk', sprite.mode === 'walk' || sprite.leaving);
      sprite.flip.classList.toggle('left', sprite.face === 'left' ? sprite.dir > 0 : sprite.dir < 0);
      sprite.el.style.left = `${sprite.x + sprite.size / 2}px`;
    }
    requestAnimationFrame(t => this.#frame(t));
  }

  #note(sprite) {
    const note = document.createElement('span');
    note.className = 'note-fx';
    note.textContent = NOTES[Math.floor(Math.random() * NOTES.length)];
    note.style.left = `${15 + Math.random() * 70}%`;
    note.style.setProperty('--drift', `${Math.random() * 30 - 15}px`);
    sprite.body.append(note);
    setTimeout(() => note.remove(), 1600);
  }
}
```

- [ ] **Step 2: Add the crew to `app.js`: imports**

Replace:
```js
import { setupEndModeButtons, renderPlayer } from './player-view.js';
```
with:
```js
import { setupEndModeButtons, renderPlayer } from './player-view.js';
import { Crew } from './crew.js';
import { CrewView } from './crew-view.js';
```

- [ ] **Step 3: Create the crew and its playback clock**

Replace:
```js
let renderQueued = false;
```
with:
```js
let renderQueued = false;

// The crew is session only. Plays count after 30 seconds of actual playback.
const crew = new Crew();
const crewView = new CrewView({
  yard: $('yard'), empty: $('yardEmpty'), count: $('penCount'), crew, titleFor: id => titleOf(id),
});
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const seconds = (now - lastTick) / 1000;
  lastTick = now;
  if (state.playerState === STATE.PLAYING) crewView.apply(crew.tick(seconds));
}, 250);
```

- [ ] **Step 4: End an unfinished play whenever another song starts or playback stops**

Replace:
```js
function playSong(id) {
  if (!id) return;
  state.playStarted = false;
```
with:
```js
function playSong(id) {
  if (!id) return;
  crewView.apply(crew.endPlay());
  state.playStarted = false;
```

Replace:
```js
  if (id) playSong(id);
  else {
    player.stop();
    render();
  }
}
```
with:
```js
  if (id) playSong(id);
  else {
    crewView.apply(crew.endPlay());
    player.stop();
    render();
  }
}
```

Replace:
```js
  if (player) player.stop();
  state.playStarted = false;
  queue = newQueue();
```
with:
```js
  crewView.apply(crew.endPlay());
  if (player) player.stop();
  state.playStarted = false;
  queue = newQueue();
```

- [ ] **Step 5: Hatch or evolve when a song actually starts playing; end the play when the song ends**

Replace:
```js
function onStateChange(s) {
  state.playerState = s;
  if (s === STATE.PLAYING) state.playStarted = true;
  if (s === STATE.ENDED) next();
  render();
}
```
with:
```js
function onStateChange(s) {
  state.playerState = s;
  if (s === STATE.PLAYING && !state.playStarted && queue.current) {
    state.playStarted = true;
    crewView.apply(crew.startPlay(queue.current));
  }
  if (s === STATE.ENDED) {
    crewView.apply(crew.endPlay());
    next();
  }
  render();
}
```

- [ ] **Step 6: Keep the pen in step with the player on every render**

Replace:
```js
    endMode: queue.endMode,
    showEmpty: !current,
  });
}
```
with:
```js
    endMode: queue.endMode,
    showEmpty: !current,
  });
  crewView.setCurrent(queue.current);
  crewView.setPaused(state.playerState !== STATE.PLAYING);
  crewView.refreshTitles();
}
```

- [ ] **Step 7: Run the automated tests**

Run: `node --test`
Expected: PASS, all test files.

- [ ] **Step 8: Manual check in a browser** (ask the user)

With a playlist loaded:
1. Press Play: the song's creature hatches in the pen straight away, with an accent outline and floating notes. It walks like the others; it does not dance.
2. Press Next within 30 seconds: that creature poofs away and the next song's creature hatches.
3. Let a song play past 30 seconds, then hover its creature: "Played 1 time". On a phone, tap it.
4. Play a song whose creature is already in the pen: it flashes, sparkles and grows. Skip it within 30 seconds: it shrinks back.
5. Pause: every creature freezes, including the frame animation and notes. Press Play: they carry on from where they were.
6. Creatures face the way they walk (the astronaut faces right by default; the others face left).

- [ ] **Step 9: Commit**

```bash
git add crew-view.js app.js
git commit -m "feat: the crew pen, driven by real playback"
```

---

### Task 10: Final checks and README

**Files:**
- Modify: `README.md` (add a "Run it" section above "Assets")
- Modify: `docs/superpowers/specs/2026-09-29-heavy-rotation-design.md` only if a manual check below changes a decision (for example Mix links)

- [ ] **Step 1: Add the "Run it" section to `README.md`**

Insert after the first paragraph (before `## Assets`):

```markdown
## Run it

From this folder:

    python3 -m http.server 8000

Then open http://localhost:8000. On a phone on the same Wi-Fi, open `http://<this computer's local IP>:8000` (on a Mac: System Settings → Wi-Fi → Details → IP address).

Tests: `node --test`
```

- [ ] **Step 2: Run the automated tests**

Run: `node --test`
Expected: PASS, all test files.

- [ ] **Step 3: Full manual checklist** (ask the user; record each result in the commit message or a reply)

1. A real playlist loads, with titles and the playlist name.
2. Songs advance automatically at the end.
3. A video with embedding turned off shows "Can't play here" and is skipped.
4. Weights survive a page reload.
5. The layout and controls work on a phone over Wi-Fi; the player stays pinned while the list scrolls.
6. Paste a YouTube Mix link (`list=RD…`): record whether it loads. If it doesn't, the message about Mix playlists must show.
7. The crew: hatch, grow, revert on early skip, freeze on pause, outline and notes on the current song.
8. Private browsing window (where storage may be blocked): the page still works, and the storage note shows if storage is unavailable.
9. Dark mode: switch the system to dark and check the page is readable.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: how to run Heavy Rotation"
```
