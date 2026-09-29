// Works out what a pasted link points to, from its shape alone. No network calls.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com']);

export function parseLink(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { type: 'empty' };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { type: 'invalid' };
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let videoId = null;
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/')[1] || null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(shorts|live|embed|v)\/([^/]+)/);
      if (match && match[2] !== 'videoseries') videoId = match[2];
    }
  } else {
    return { type: 'invalid' };
  }

  if (videoId && !VIDEO_ID.test(videoId)) videoId = null;
  const list = url.searchParams.get('list');
  const listId = list && LIST_ID.test(list) ? list : null;

  // A video opened from a YouTube Mix (the automatic radio, list ID "RD…") is just that video.
  if (videoId && listId && isMix(listId)) return { type: 'video', videoId };
  if (videoId && listId) return { type: 'both', videoId, listId };
  if (videoId) return { type: 'video', videoId };
  if (listId) return { type: 'playlist', listId };
  return { type: 'invalid' };
}

export function isMix(listId) {
  return listId.startsWith('RD');
}
