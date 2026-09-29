// The song list's contents, worked out from the saved rotation (the only record of playlists,
// added songs, removed songs and weights) and the playlists read so far. No DOM, no storage.

// Which songs the list holds: every read playlist's songs in order (minus songs removed here),
// then songs added here that aren't in any of those playlists.
export function songSet(rotation, sourceSongs) {
  const playlistIds = new Set(rotation.sources.flatMap(id => sourceSongs.get(id) ?? []));
  const removed = new Set(rotation.removed);
  const extras = new Set(rotation.extras);
  const songs = [];
  for (const id of playlistIds) if (!removed.has(id)) songs.push({ id, extra: extras.has(id) });
  for (const id of rotation.extras) if (!playlistIds.has(id)) songs.push({ id, extra: true });
  return { songs, playlistIds };
}

export const withItem = (list, id) => (list.includes(id) ? list : [...list, id]);
export const withoutItem = (list, id) => list.filter(x => x !== id);
