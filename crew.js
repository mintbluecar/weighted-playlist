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
