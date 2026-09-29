// Saves weights, extra videos and settings in the browser. Every access is guarded:
// if storage is blocked or full, the app keeps working for the session.
import { clampWeight } from './weights.js';

export const MINE = 'mine';
const SETTINGS_KEY = 'hr:settings';
const END_MODES = ['shuffle', 'stop'];
const ROTATION_KEY = 'hr:rotation';
const TITLES_KEY = 'hr:titles';
const TITLES_KEPT = 2000;
export const DAY_MS = 24 * 60 * 60 * 1000;

// Songs whose title isn't remembered, or was looked up more than a day ago.
export function titlesToLookUp(ids, cache, now = Date.now()) {
  return ids.filter(id => !cache[id] || now - cache[id].at > DAY_MS);
}
const strings = list => (Array.isArray(list) ? list.filter(x => typeof x === 'string') : []);

export const playlistKey = id => `hr:playlist:${id}`;

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createStore(backend) {
  let available = false;
  try {
    backend.setItem('hr:test', '1');
    backend.removeItem('hr:test');
    available = true;
  } catch {
    available = false;
  }

  function read(key) {
    if (!available) return {};
    try {
      const value = JSON.parse(backend.getItem(key) ?? '{}');
      return isObject(value) ? value : {};
    } catch {
      return {};
    }
  }

  function write(key, value) {
    if (!available) return false;
    try {
      backend.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
  // Before rotations, each playlist had its own entry and settings remembered the last one.
  function migrate() {
    const last = read(SETTINGS_KEY).lastSource;
    if (!isObject(last) || typeof last.id !== 'string') return {};
    const old = read(playlistKey(last.type === 'mine' ? MINE : last.id));
    return {
      sources: last.type === 'playlist' ? [last.id] : [],
      weights: old.weights,
      extras: old.extras,
      removed: old.removed,
      sourceInfo: {},
    };
  }


  return {
    get available() {
      return available;
    },

    loadPlaylist(id) {
      const data = read(playlistKey(id));
      const weights = {};
      if (isObject(data.weights)) {
        for (const [videoId, weight] of Object.entries(data.weights)) weights[videoId] = clampWeight(weight);
      }
      return { weights, extras: strings(data.extras), removed: strings(data.removed) };
    },

    savePlaylist(id, { weights, extras, removed = [] }) {
      const kept = {};
      for (const [videoId, weight] of Object.entries(weights)) if (weight !== 1) kept[videoId] = weight;
      return write(playlistKey(id), { weights: kept, extras, removed });
    },

    loadSettings() {
      const data = read(SETTINGS_KEY);
      const source = data.lastSource;
      const lastSource = isObject(source) && ['playlist', 'mine'].includes(source.type) && typeof source.id === 'string'
        ? { type: source.type, id: source.id }
        : null;
      return {
        lastSource,
        endMode: END_MODES.includes(data.endMode) ? data.endMode : 'shuffle',
        penCollapsed: data.penCollapsed === true,
      };
    },

    saveSettings(settings) {
      return write(SETTINGS_KEY, settings);
    },

    // One rotation: the playlists in the list, weights, songs added here, and songs removed here.
    loadRotation() {
      let data = read(ROTATION_KEY);
      if (!Object.keys(data).length) data = migrate();
      const weights = {};
      if (isObject(data.weights)) for (const [id, w] of Object.entries(data.weights)) weights[id] = clampWeight(w);
      const sourceInfo = {};
      if (isObject(data.sourceInfo)) {
        for (const [id, info] of Object.entries(data.sourceInfo)) {
          if (!isObject(info)) continue;
          const clean = {};
          if (typeof info.title === 'string') clean.title = info.title;
          if (typeof info.owner === 'string') clean.owner = info.owner;
          if (Number.isInteger(info.count)) clean.count = info.count;
          if (info.status === 'ok' || info.status === 'error') clean.status = info.status;
          sourceInfo[id] = clean;
        }
      }
      return {
        sources: [...new Set(strings(data.sources))],
        weights,
        extras: strings(data.extras),
        removed: strings(data.removed),
        sourceInfo,
      };
    },

    // Song titles, channels and thumbnails from earlier lookups, so the list shows names straight away.
    loadTitles() {
      const data = read(TITLES_KEY);
      const titles = {};
      for (const [id, t] of Object.entries(data)) {
        if (!isObject(t) || typeof t.title !== 'string') continue;
        titles[id] = {
          title: t.title,
          author: typeof t.author === 'string' ? t.author : '',
          thumbnail: typeof t.thumbnail === 'string' && t.thumbnail.startsWith('https://') ? t.thumbnail : '',
          at: Number.isFinite(t.at) ? t.at : 0,
        };
      }
      return titles;
    },

    saveTitles(titles) {
      const newest = Object.entries(titles).sort((a, b) => b[1].at - a[1].at).slice(0, TITLES_KEPT);
      return write(TITLES_KEY, Object.fromEntries(newest));
    },

    saveRotation(rotation) {
      const weights = {};
      for (const [id, w] of Object.entries(rotation.weights)) if (w !== 1) weights[id] = w;
      return write(ROTATION_KEY, { ...rotation, weights });
    },
  };
}
