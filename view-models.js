// What each part of the screen shows, worked out from plain data (no DOM), so it can be unit-tested.
import { playsPerLoop, frequencyText } from './weights.js';

// Song list rows in display order. Blocked songs are left out of the loop and show no share.
export function songRows(songs, order, currentId) {
  const playable = [...songs.values()].filter(s => !s.blocked);
  const { counts, length } = playsPerLoop(playable);
  const total = playable.reduce((sum, s) => sum + s.weight, 0);
  const rows = order.map(id => {
    const s = songs.get(id);
    const plays = counts.get(id) ?? 0;
    return {
      id,
      title: s.title ?? id,
      author: s.author,
      thumbnail: s.thumbnail,
      weight: s.weight,
      blocked: s.blocked,
      current: id === currentId,
      share: total && !s.blocked ? s.weight / total : 0,
      freq: plays ? frequencyText(plays, length) : '',
    };
  });
  return { rows, loopLength: length };
}

export function listMetaText(songCount, loopLength) {
  return songCount ? `${songCount} songs · ${loopLength} plays per loop` : '';
}

// Up next rows: songs are numbered, and ▲▼ only move a song within its own loop.
// infoFor(id) → { title, author, thumbnail } or undefined.
export function queueRows(items, infoFor) {
  let number = 0;
  return items.map((item, i) => {
    if (item.type !== 'song') return item;
    const info = infoFor(item.id);
    const before = items[i - 1];
    const after = items[i + 1];
    return {
      ...item,
      number: ++number,
      title: info?.title ?? item.id,
      author: info?.author ?? '',
      thumbnail: info?.thumbnail ?? '',
      canUp: before?.type === 'song' && before.where === item.where,
      canDown: after?.type === 'song' && after.where === item.where,
    };
  });
}

// The manage modal's playlist cards and added songs. infoFor(id) → the song's details, if known.
export function manageData(rotation, syncing, infoFor) {
  return {
    sources: rotation.sources.map(id => ({ id, ...rotation.sourceInfo[id], syncing: syncing.has(id) })),
    extras: rotation.extras.map(id => ({ id, ...infoFor(id) })),
  };
}

export function failedMessage(listIds, sourceInfo) {
  const names = listIds.map(id => sourceInfo[id]?.title ?? 'A playlist');
  const which = names.length === 1 ? `${names[0]} couldn't` : `${names.length} playlists couldn't`;
  return `${which} be loaded. It may be private or deleted. Its songs are hidden until it loads again.`;
}
