// How the song list's header names a rotation of several playlists.
export function listHeading(infos, addedCount) {
  const names = infos.map(info => info.title || 'YouTube playlist');
  let title = 'My rotation';
  if (names.length === 1) title = names[0];
  else if (names.length === 2) title = `${names[0]} + ${names[1]}`;
  else if (names.length > 2) title = `${names[0]} + ${names.length - 1} more`;
  const parts = [];
  if (infos.length === 1 && infos[0].owner) parts.push(`by ${infos[0].owner}`);
  if (addedCount) parts.push(`+ ${addedCount} added here`);
  return { title, owner: parts.join(' · ') };
}
