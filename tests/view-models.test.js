import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songRows, queueRows, manageData, failedMessage, listMetaText } from '../view-models.js';

const song = (id, weight, extra = {}) => ({ id, title: `T ${id}`, author: 'A', thumbnail: '', weight, blocked: false, ...extra });

test('songRows: share, frequency text, current and blocked songs', () => {
  const songs = new Map([['a', song('a', 3)], ['b', song('b', 1)], ['x', song('x', 5, { blocked: true, title: null })]]);
  const { rows, loopLength } = songRows(songs, ['a', 'b', 'x'], 'b');
  assert.equal(loopLength, 4);
  assert.deepEqual(rows.map(r => [r.id, r.share, r.freq, r.current]), [
    ['a', 0.75, '3 in every 4 songs', false],
    ['b', 0.25, '1 in every 4 songs', true],
    ['x', 0, '', false],
  ]);
  assert.equal(rows[2].title, 'x', 'a song without a title shows its ID');
});

test('listMetaText', () => {
  assert.equal(listMetaText(0, 0), '');
  assert.equal(listMetaText(12, 15), '12 songs · 15 plays per loop');
});

test('queueRows: numbering, titles and which way each song can move', () => {
  const items = [
    { type: 'song', id: 'a', where: 'this', index: 1 },
    { type: 'song', id: 'b', where: 'this', index: 2 },
    { type: 'divider' },
    { type: 'song', id: 'c', where: 'next', index: 0 },
  ];
  const info = id => (id === 'c' ? undefined : { title: `T ${id}`, author: 'A', thumbnail: 'https://i/x.jpg' });
  const rows = queueRows(items, info);
  assert.deepEqual(rows.map(r => r.type === 'song' ? [r.id, r.number, r.canUp, r.canDown] : r.type), [
    ['a', 1, false, true], ['b', 2, true, false], 'divider', ['c', 3, false, false],
  ]);
  assert.equal(rows[3].title, 'c', 'unknown title falls back to the ID');
  assert.equal(rows[0].thumbnail, 'https://i/x.jpg');
});

test('manageData: playlist cards and added songs', () => {
  const rotation = { sources: ['P1', 'P2'], extras: ['x'], sourceInfo: { P1: { title: 'Road Trip', count: 3, status: 'ok' } } };
  const data = manageData(rotation, new Set(['P2']), id => ({ title: `T ${id}` }));
  assert.deepEqual(data.sources, [
    { id: 'P1', title: 'Road Trip', count: 3, status: 'ok', syncing: false },
    { id: 'P2', syncing: true },
  ]);
  assert.deepEqual(data.extras, [{ id: 'x', title: 'T x' }]);
});

test('failedMessage names one playlist, or counts several', () => {
  const info = { P1: { title: 'Road Trip' } };
  assert.equal(failedMessage(['P1'], info), "Road Trip couldn't be loaded. It may be private or deleted. Its songs are hidden until it loads again.");
  assert.equal(failedMessage(['P1', 'P2'], info), "2 playlists couldn't be loaded. It may be private or deleted. Its songs are hidden until it loads again.");
  assert.equal(failedMessage(['P9'], info).startsWith("A playlist couldn't"), true);
});
