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
    if (this.pos < 0) {
      this.loop = this.#build(this.counts, this.current);
      return;
    }
    // Keep what already played this loop; rebuild only the rest from the new counts.
    const played = this.loop.slice(0, this.pos + 1);
    const rest = new Map(this.counts);
    for (const id of played) {
      const plays = rest.get(id) ?? 0;
      if (plays > 1) rest.set(id, plays - 1);
      else rest.delete(id);
    }
    this.loop = [...played, ...this.#build(rest, this.loop[this.pos])];
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
      this.loop = this.#takeNextLoop();
      this.loopNumber++;
      if (this.endMode === 'stop' || !this.loop.length) {
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

  // What the queue box shows: songs with where they live ('this' or 'next' loop) and their index there,
  // a divider where the next loop starts, or a stop marker when playback stops after this loop.
  queueItems(n) {
    const items = [];
    let songs = 0;
    for (let i = this.pos + 1; i < this.loop.length && songs < n; i++, songs++) {
      items.push({ type: 'song', id: this.loop[i], where: 'this', index: i });
    }
    if (songs < n && this.loop.length) {
      if (this.endMode === 'stop') {
        items.push({ type: 'stop' });
      } else {
        items.push({ type: 'divider' });
        const next = this.#peekNextLoop();
        for (let j = 0; j < next.length && songs < n; j++, songs++) {
          items.push({ type: 'song', id: next[j], where: 'next', index: j });
        }
      }
    }
    return items;
  }

  // Swap a queued song with its neighbour (dir -1 up, +1 down), within its own loop only.
  move(where, index, dir) {
    const loop = where === 'this' ? this.loop : this.#peekNextLoop();
    const first = where === 'this' ? this.pos + 1 : 0;
    const other = index + dir;
    if (Math.min(index, other) < first || Math.max(index, other) >= loop.length) return false;
    [loop[index], loop[other]] = [loop[other], loop[index]];
    return true;
  }

  // Move a queued song to the top of the queue without playing it. A song from the next loop
  // moves into this loop, so the next loop plays it one time fewer.
  moveToTop(where, index) {
    const top = this.pos + 1;
    if (where === 'next') {
      if (this.endMode === 'stop') return false;
      const next = this.#peekNextLoop();
      if (index < 0 || index >= next.length) return false;
      const [id] = next.splice(index, 1);
      this.loop.splice(top, 0, id);
      return true;
    }
    if (index < top || index >= this.loop.length) return false;
    const [id] = this.loop.splice(index, 1);
    this.loop.splice(top, 0, id);
    return true;
  }

  // Put a song at the top of the queue as an extra play; the weighted loop is otherwise unchanged.
  playNext(id) {
    if (!this.counts.has(id)) return false;
    this.loop.splice(this.pos + 1, 0, id);
    return true;
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
