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
