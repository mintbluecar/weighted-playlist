// Saves weights, extra videos and settings in the browser. Every access is guarded:
// if storage is blocked or full, the app keeps working for the session.
import { clampWeight } from './weights.js';

export const MINE = 'mine';
const SETTINGS_KEY = 'hr:settings';
const END_MODES = ['shuffle', 'stop'];

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
      const strings = list => (Array.isArray(list) ? list.filter(x => typeof x === 'string') : []);
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
      return { lastSource, endMode: END_MODES.includes(data.endMode) ? data.endMode : 'shuffle' };
    },

    saveSettings(settings) {
      return write(SETTINGS_KEY, settings);
    },
  };
}
