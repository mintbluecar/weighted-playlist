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

test('a video opened from a YouTube Mix is a single video, not a playlist', () => {
  assert.deepEqual(
    parseLink(`https://www.youtube.com/watch?v=${V}&list=RD${V}&start_radio=1`),
    { type: 'video', videoId: V },
  );
  assert.deepEqual(parseLink(`https://www.youtube.com/watch?v=${V}&list=RDMMabc123`), { type: 'video', videoId: V });
  assert.deepEqual(parseLink(`https://www.youtube.com/playlist?list=RD${V}`), { type: 'playlist', listId: `RD${V}` });
});
