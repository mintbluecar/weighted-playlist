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
  assert.deepEqual(JSON.parse(backend.getItem(playlistKey('PL1'))), { weights: { a: 4, c: 2 }, extras: ['c'], removed: [] });
  assert.deepEqual(store.loadPlaylist('PL1'), { weights: { a: 4, c: 2 }, extras: ['c'], removed: [] });
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
  backend.setItem('hr:settings', JSON.stringify({ endMode: 'same' })); // option removed
  assert.equal(store.loadSettings().endMode, 'shuffle');
});

test('saved weights are cleaned up on load', () => {
  const backend = memoryBackend();
  backend.setItem(playlistKey('PL1'), JSON.stringify({ weights: { a: 150, b: 'x', c: 3 }, extras: ['c', 5, null] }));
  assert.deepEqual(createStore(backend).loadPlaylist('PL1'), { weights: { a: 99, b: 1, c: 3 }, extras: ['c'], removed: [] });
});

test('corrupt JSON falls back to defaults', () => {
  const backend = memoryBackend();
  backend.setItem(playlistKey('PL1'), '{not json');
  backend.setItem('hr:settings', '[[[');
  const store = createStore(backend);
  assert.deepEqual(store.loadPlaylist('PL1'), { weights: {}, extras: [], removed: [] });
  assert.deepEqual(store.loadSettings(), { lastSource: null, endMode: 'shuffle' });
});

test('no storage at all: nothing throws and defaults are used', () => {
  for (const backend of [null, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} }]) {
    const store = createStore(backend);
    assert.equal(store.available, false);
    assert.deepEqual(store.loadPlaylist('PL1'), { weights: {}, extras: [], removed: [] });
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

test('removed songs are remembered per playlist', () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  assert.deepEqual(store.loadPlaylist('PL1').removed, []);
  store.savePlaylist('PL1', { weights: {}, extras: [], removed: ['x1', 'x2'] });
  assert.deepEqual(store.loadPlaylist('PL1').removed, ['x1', 'x2']);
  backend.setItem(playlistKey('PL2'), JSON.stringify({ removed: ['ok', 7, null] }));
  assert.deepEqual(store.loadPlaylist('PL2').removed, ['ok']);
});
