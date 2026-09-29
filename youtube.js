// The only file that talks to YouTube: the IFrame Player API and oEmbed title lookups.
// Docs: https://developers.google.com/youtube/iframe_api_reference
export const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export const videoUrl = id => `https://www.youtube.com/watch?v=${id}`;
export const playlistUrl = id => `https://www.youtube.com/playlist?list=${id}`;

export async function fetchInfo(url, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.title !== 'string') return null;
    const thumbnail = typeof data.thumbnail_url === 'string' && data.thumbnail_url.startsWith('https://') ? data.thumbnail_url : '';
    return { title: data.title, author: typeof data.author_name === 'string' ? data.author_name : '', thumbnail };
  } catch {
    return null;
  }
}

export async function fetchVideoInfos(ids, { concurrency = 8, fetchImpl, onInfo } = {}) {
  const waiting = [...ids];
  const results = new Map();
  async function worker() {
    while (waiting.length) {
      const id = waiting.shift();
      const info = await fetchInfo(videoUrl(id), fetchImpl);
      results.set(id, info);
      onInfo?.(id, info);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return results;
}

let apiPromise = null;

export function loadYouTubeApi({ timeoutMs = 15000 } = {}) {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const timer = setTimeout(() => reject(new Error('youtube-api-timeout')), timeoutMs);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('youtube-api-failed'));
    };
    document.head.append(script);
  });
  apiPromise.catch(() => { apiPromise = null; });
  return apiPromise;
}

// `element` is an element or its ID; YouTube replaces it with the player's iframe.
export function createPlayer(YT, element, { onStateChange, onError, timeoutMs = 15000 } = {}) {
  let cuedAt = 0;
  return new Promise((resolve, reject) => {
    // Give up if YouTube never says the player is ready, so nothing waiting on it hangs forever.
    const timer = setTimeout(() => reject(new Error('player-not-ready')), timeoutMs);
    const yt = new YT.Player(element, {
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => {
          clearTimeout(timer);
          resolve(wrapPlayer(yt, () => cuedAt));
        },
        onStateChange: e => {
          if (e.data === STATE.CUED) cuedAt = Date.now();
          onStateChange?.(e.data);
        },
        onError: e => onError?.(e.data),
      },
    });
  });
}

function wrapPlayer(yt, lastCuedAt) {
  return {
    play: videoId => yt.loadVideoById(videoId),
    cue: videoId => yt.cueVideoById(videoId), // shows the thumbnail, paused, until resume()
    pause: () => yt.pauseVideo(),
    resume: () => yt.playVideo(),
    stop: () => yt.stopVideo(),
    destroy: () => yt.destroy(),

    // Cue the playlist, wait for YouTube to report it as cued, then read its video IDs.
    // Waiting for the CUED event avoids reading the previous playlist's IDs.
    listPlaylist(listId, { timeoutMs = 10000 } = {}) {
      const since = Date.now();
      yt.cuePlaylist({ listType: 'playlist', list: listId });
      return new Promise((resolve, reject) => {
        const poll = () => {
          const ids = lastCuedAt() >= since ? yt.getPlaylist() : null;
          if (Array.isArray(ids) && ids.length) return resolve(ids);
          if (Date.now() - since > timeoutMs) return reject(new Error('playlist-unavailable'));
          setTimeout(poll, 250);
        };
        poll();
      });
    },
  };
}

// A hidden player used only to read playlists (so reading never interrupts playback).
// YouTube may still answer a read that timed out; the player can't say which playlist an answer
// is for (the API has no playlist-ID getter), so after a timeout the player is destroyed and
// replaced, and a late answer can't be taken as the next read's.
export async function createReader(YT, container) {
  let player = null;
  async function fresh() {
    const slot = document.createElement('div');
    container.append(slot);
    player = await createPlayer(YT, slot);
  }
  await fresh();
  return {
    async listPlaylist(listId) {
      if (!player) await fresh(); // the last replacement didn't start; try again
      try {
        return await player.listPlaylist(listId);
      } catch (err) {
        player.destroy();
        player = null;
        await fresh().catch(() => {}); // if this fails too, the next read tries again
        throw err;
      }
    },
  };
}
