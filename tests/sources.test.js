import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listHeading } from '../sources.js';

test('no playlists', () => {
  assert.deepEqual(listHeading([], 0), { title: 'My rotation', owner: '' });
  assert.deepEqual(listHeading([], 2), { title: 'My rotation', owner: '+ 2 added here' });
});

test('one playlist shows its owner', () => {
  assert.deepEqual(listHeading([{ title: 'Road Trip', owner: 'Mara' }], 0), { title: 'Road Trip', owner: 'by Mara' });
  assert.deepEqual(listHeading([{ title: 'Road Trip', owner: 'Mara' }], 1), { title: 'Road Trip', owner: 'by Mara · + 1 added here' });
  assert.deepEqual(listHeading([{}], 0), { title: 'YouTube playlist', owner: '' });
});

test('two and more playlists', () => {
  assert.deepEqual(listHeading([{ title: 'A' }, { title: 'B' }], 0), { title: 'A + B', owner: '' });
  assert.deepEqual(listHeading([{ title: 'A' }, { title: 'B' }, { title: 'C' }, {}], 3), { title: 'A + 3 more', owner: '+ 3 added here' });
});
