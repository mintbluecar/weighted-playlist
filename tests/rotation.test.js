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

test('a weight change mid-loop keeps what already played and rebuilds only the rest', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1], ['d', 1]]);
  const first = q.start();
  const second = q.next();
  q.setCounts(new Map([['a', 1], ['b', 1], ['c', 1], ['d', 2]]));
  assert.equal(q.current, second);
  assert.equal(q.position, 2);
  assert.equal(q.loopLength, 5);
  const rest = [q.next(), q.next(), q.next()];
  assert.ok(!rest.includes(first) && !rest.includes(second), `replayed a song already heard: ${rest}`);
  assert.deepEqual(tally([first, second, ...rest]), new Map([['a', 1], ['b', 1], ['c', 1], ['d', 2]]));
});

test('if every song is removed mid-loop, next returns null', () => {
  const q = queueWith([['a', 1], ['b', 1]]);
  q.start();
  q.setCounts(new Map());
  assert.equal(q.next(), null);
  assert.equal(q.current, null);
});

// Queue box: items carry where they live ('this' loop or 'next' loop) and their index in that loop.
const songsOf = items => items.filter(i => i.type === 'song');

test('queueItems lists upcoming plays, marks the new loop, and ends with stop in stop mode', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1]]);
  q.start();
  const items = q.queueItems(4);
  assert.deepEqual(items.map(i => i.type), ['song', 'song', 'divider', 'song', 'song']);
  assert.deepEqual(items[0], { type: 'song', id: q.loop[1], where: 'this', index: 1 });
  assert.equal(items[3].where, 'next');
  assert.equal(items[3].index, 0);
  q.endMode = 'stop';
  assert.deepEqual(q.queueItems(4).map(i => i.type), ['song', 'song', 'stop']);
});

test('move swaps a song with its neighbour, and the new order is what plays', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1], ['d', 1]]);
  q.start();
  const [x, y] = [q.loop[1], q.loop[2]];
  assert.equal(q.move('this', 1, 1), true);
  assert.equal(q.next(), y);
  assert.equal(q.next(), x);
});

test('move never crosses into another loop or above the playing song', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1]]);
  q.start();
  const before = [...q.loop];
  assert.equal(q.move('this', 1, -1), false, 'cannot move above the playing song');
  assert.equal(q.move('this', 2, 1), false, 'cannot move past the end of this loop');
  assert.equal(q.move('next', 0, -1), false, 'cannot move before the start of the next loop');
  assert.deepEqual(q.loop, before);
});

test('reordering the next loop carries into the loop that actually plays', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1]]);
  q.start();
  const next = songsOf(q.queueItems(10)).filter(i => i.where === 'next').map(i => i.id);
  assert.equal(q.move('next', 0, 1), true);
  q.next();
  q.next();
  assert.deepEqual([q.next(), q.next()], [next[1], next[0]]);
});

test('jumpTo plays a later song in this loop and carries on from there', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1], ['d', 1]]);
  const first = q.start();
  const target = q.loop[3];
  assert.equal(q.jumpTo('this', 3), target);
  assert.equal(q.current, target);
  assert.equal(q.position, 4);
  assert.equal(q.previous(), first);
});

test('jumpTo into the next loop starts that loop at the chosen song', () => {
  const q = queueWith([['a', 1], ['b', 1]]);
  q.start();
  const target = songsOf(q.queueItems(10)).find(i => i.where === 'next' && i.index === 1).id;
  assert.equal(q.jumpTo('next', 1), target);
  assert.equal(q.loopNumber, 2);
  assert.equal(q.position, 2);
});

test('playNext puts a song at the top of the queue as an extra play', () => {
  const q = queueWith([['a', 1], ['b', 1], ['c', 1]]);
  const first = q.start();
  const rest = q.loop.slice(1);
  q.playNext('c');
  assert.equal(q.queueItems(1)[0].id, 'c');
  assert.equal(q.loopLength, 4);
  assert.deepEqual([q.next(), q.next(), q.next()], ['c', ...rest]);
  assert.equal(q.playNext('nope'), false);
  void first;
});

test('playNext before anything has played makes that song play first', () => {
  const q = queueWith([['a', 1], ['b', 1]]);
  q.playNext('b');
  assert.equal(q.start(), 'b');
});
