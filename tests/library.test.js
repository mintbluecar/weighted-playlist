import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songSet, withItem, withoutItem } from '../library.js';

const rot = over => ({ sources: [], extras: [], removed: [], weights: {}, sourceInfo: {}, ...over });

test('songSet: playlist songs in playlist order, then songs added here', () => {
  const sourceSongs = new Map([['P1', ['a', 'b']], ['P2', ['b', 'c']]]);
  const { songs, playlistIds } = songSet(rot({ sources: ['P1', 'P2'], extras: ['x'] }), sourceSongs);
  assert.deepEqual(songs, [
    { id: 'a', extra: false }, { id: 'b', extra: false }, { id: 'c', extra: false }, { id: 'x', extra: true },
  ]);
  assert.deepEqual([...playlistIds], ['a', 'b', 'c']);
});

test('songSet: removed playlist songs stay out; an added song also in a playlist is listed once, as added', () => {
  const sourceSongs = new Map([['P1', ['a', 'b']]]);
  const { songs } = songSet(rot({ sources: ['P1'], removed: ['b'], extras: ['a'] }), sourceSongs);
  assert.deepEqual(songs, [{ id: 'a', extra: true }]);
});

test('songSet: playlists not read yet contribute nothing; a removed playlist\'s songs leave', () => {
  const sourceSongs = new Map([['P1', ['a']], ['GONE', ['z']]]);
  const { songs } = songSet(rot({ sources: ['P1', 'UNREAD'] }), sourceSongs);
  assert.deepEqual(songs, [{ id: 'a', extra: false }]);
});

test('withItem / withoutItem keep lists free of duplicates without changing the original', () => {
  const list = ['a'];
  assert.deepEqual(withItem(list, 'b'), ['a', 'b']);
  assert.deepEqual(withItem(list, 'a'), ['a']);
  assert.deepEqual(withoutItem(['a', 'b', 'a'], 'a'), ['b']);
  assert.deepEqual(list, ['a']);
});
