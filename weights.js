// Weights → plays per loop, and how often a song comes around in plain words.
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 99;

export function clampWeight(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return MIN_WEIGHT;
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, n));
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

export function playsPerLoop(songs) {
  const divisor = songs.reduce((acc, s) => gcd(acc, s.weight), 0) || 1;
  const counts = new Map();
  let length = 0;
  for (const s of songs) {
    const plays = s.weight / divisor;
    counts.set(s.id, plays);
    length += plays;
  }
  return { counts, length };
}

export function frequencyText(plays, loopLength) {
  if (plays === loopLength) return 'Every song';
  const n = loopLength / plays;
  if (Number.isInteger(n)) return `1 in every ${n} songs`;
  if (n < 2.5) return `${plays} in every ${loopLength} songs`;
  return `About 1 in every ${Math.round(n)} songs`;
}

export function compareSongs(a, b) {
  return b.weight - a.weight || (a.title ?? a.id).localeCompare(b.title ?? b.id);
}
