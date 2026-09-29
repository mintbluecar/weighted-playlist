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
