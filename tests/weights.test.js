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
