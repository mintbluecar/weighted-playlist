// Wires the page together: link bar, playlist loading, weights, playback and saving.
import { parseLink, isMix } from './links.js';
import { clampWeight, playsPerLoop, frequencyText, compareSongs } from './weights.js';
import { Queue } from './rotation.js';
import { createStore, MINE } from './storage.js';
import { loadYouTubeApi, createPlayer, fetchInfo, fetchVideoInfos, playlistUrl, videoUrl, STATE } from './youtube.js';
import { setupSongList, renderSongs, flashRow } from './songs-view.js';
import { setupEndModeButtons, renderPlayer } from './player-view.js';

const $ = id => document.getElementById(id);
const MY_ROTATION = 'My rotation';

let backend = null;
try {
  backend = window.localStorage;
} catch {
  backend = null; // storage blocked by the browser
}
const store = createStore(backend);
const settings = store.loadSettings();

const state = {
  sourceId: null,               // YouTube playlist ID, or MINE for a list started from single videos
  title: '',
  owner: '',
  songs: new Map(),             // videoId -> { id, title, author, weight, extra, blocked }
  order: [],                    // videoIds in display order
  playerState: STATE.UNSTARTED,
  playStarted: false,           // has the current queue item started playing yet
};
let queue = newQueue();
let player = null;
let resortTimer = null;
let renderQueued = false;

const playerEls = {
  nowTitle: $('nowTitle'), nowChan: $('nowChan'), loopPos: $('loopPos'), playBtn: $('playBtn'),
  playIcon: $('playIcon'), videoEmpty: $('videoEmpty'), upNext: $('upNext'), endMode: $('endMode'),
};

function newQueue() {
  const q = new Queue();
  q.endMode = settings.endMode;
  return q;
}

// ---------- status line ----------

function showStatus(message, kind = '', actions = []) {
  const box = $('status');
  box.className = `status ${kind}`.trim();
  const text = document.createElement('span');
  text.textContent = message;
  box.replaceChildren(text);
  if (actions.length) {
    const choice = document.createElement('span');
    choice.className = 'choice';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.primary ? 'btn primary' : 'btn';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        hideStatus();
        action.onClick();
      });
      choice.append(button);
    }
    box.append(choice);
  }
  box.hidden = false;
}

function hideStatus() {
  $('status').hidden = true;
}

// ---------- songs, weights, saving ----------

const playable = () => [...state.songs.values()].filter(s => !s.blocked);
const titleOf = id => state.songs.get(id)?.title ?? id;

function updateCounts() {
  queue.setCounts(playsPerLoop(playable()).counts);
}

function resort() {
  state.order = [...state.songs.values()]
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || compareSongs(a, b))
    .map(s => s.id);
}

function save() {
  if (!state.sourceId) return;
  const weights = {};
  const extras = [];
  for (const s of state.songs.values()) {
    weights[s.id] = s.weight;
    if (s.extra) extras.push(s.id);
  }
  store.savePlaylist(state.sourceId, { weights, extras });
  store.saveSettings(settings);
}

function addSong(id, weight, extra) {
  state.songs.set(id, { id, title: null, author: '', weight, extra, blocked: false });
}

function setWeight(id, value) {
  const song = state.songs.get(id);
  if (!song) return;
  song.weight = clampWeight(value);
  updateCounts();
  save();
  render();
  // Re-sort about a second after the last change, so rows don't jump while tapping.
  clearTimeout(resortTimer);
  resortTimer = setTimeout(() => {
    const before = state.order.join();
    resort();
    render();
    if (state.order.join() !== before) flashRow($('songs'), id);
  }, 1000);
}

// ---------- loading ----------

function setSource(sourceId, playlistIds) {
  const saved = store.loadPlaylist(sourceId);
  state.sourceId = sourceId;
  state.songs = new Map();
  for (const id of playlistIds) if (!state.songs.has(id)) addSong(id, saved.weights[id] ?? 1, false);
  for (const id of saved.extras) if (!state.songs.has(id)) addSong(id, saved.weights[id] ?? 1, true);
  settings.lastSource = { type: sourceId === MINE ? 'mine' : 'playlist', id: sourceId };
  if (player) player.stop();
  state.playStarted = false;
  queue = newQueue();
  updateCounts();
  resort();
  save();
  render();
  loadTitles([...state.songs.keys()]);
}

function loadTitles(ids) {
  fetchVideoInfos(ids, {
    onInfo: (id, info) => {
      const song = state.songs.get(id);
      if (song && info) {
        song.title = info.title;
        song.author = info.author;
      }
      scheduleRender();
    },
  }).then(() => {
    resort();
    render();
  });
}

async function loadPlaylist(listId) {
  if (!player) return showStatus('The YouTube player is still loading. Try again in a moment.');
  showStatus('Loading playlist…');
  let ids;
  try {
    ids = await player.listPlaylist(listId);
  } catch {
    return showStatus(isMix(listId)
      ? "YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead."
      : "Couldn't load this playlist. It may be private or deleted.", 'err');
  }
  hideStatus();
  state.title = 'YouTube playlist';
  state.owner = '';
  setSource(listId, ids);
  const info = await fetchInfo(playlistUrl(listId));
  if (info && state.sourceId === listId) {
    state.title = info.title;
    state.owner = info.author;
    render();
  }
}

async function addVideo(videoId) {
  if (!state.sourceId) {
    state.title = MY_ROTATION;
    state.owner = '';
    setSource(MINE, []);
  }
  if (state.songs.has(videoId)) return showStatus('That song is already in the list.');
  addSong(videoId, 1, true);
  updateCounts();
  resort();
  save();
  render();
  showStatus(`Added to ${state.title}, weight 1.`, 'ok');
  const info = await fetchInfo(videoUrl(videoId));
  const song = state.songs.get(videoId);
  if (song && info) {
    song.title = info.title;
    song.author = info.author;
    resort();
    render();
  }
}

// ---------- playback ----------

function playSong(id) {
  if (!id) return;
  state.playStarted = false;
  player.play(id);
  render();
}

function next() {
  const id = queue.next();
  if (id) playSong(id);
  else {
    player.stop();
    render();
  }
}

function previous() {
  let id = queue.previous();
  while (id && state.songs.get(id)?.blocked) id = queue.previous();
  if (id) playSong(id);
}

function togglePlay() {
  if (!player) return;
  if (!queue.current) {
    const id = queue.start();
    if (id) playSong(id);
    return;
  }
  if (state.playerState === STATE.PLAYING) player.pause();
  else player.resume();
}

function playNow(id) {
  if (player && queue.playNow(id)) playSong(id);
}

function onStateChange(s) {
  state.playerState = s;
  if (s === STATE.PLAYING) state.playStarted = true;
  if (s === STATE.ENDED) next();
  render();
}

// Errors 2, 5, 100, 101, 150: the video can't play here. Mark it and move on.
function onError() {
  const song = state.songs.get(queue.current);
  if (!song) return;
  song.blocked = true;
  updateCounts();
  resort();
  next();
  if (!playable().length) {
    showStatus("None of these songs can play here. Their owners don't allow playing on other websites.", 'err');
  }
}

// ---------- rendering ----------

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const songs = playable();
  const { counts, length } = playsPerLoop(songs);
  const total = songs.reduce((sum, s) => sum + s.weight, 0);
  renderSongs($('songs'), state.order.map(id => {
    const s = state.songs.get(id);
    const plays = counts.get(id) ?? 0;
    return {
      id,
      title: s.title ?? id,
      author: s.author,
      weight: s.weight,
      blocked: s.blocked,
      current: id === queue.current,
      share: total && !s.blocked ? s.weight / total : 0,
      freq: plays ? frequencyText(plays, length) : '',
    };
  }));
  $('plName').textContent = state.sourceId ? state.title : 'No playlist loaded';
  $('plOwner').textContent = state.owner ? `by ${state.owner}` : '';
  $('listMeta').textContent = state.songs.size ? `${state.songs.size} songs · ${length} plays per loop` : '';

  const current = queue.current ? state.songs.get(queue.current) : null;
  renderPlayer(playerEls, {
    title: current ? (current.title ?? current.id) : 'Nothing playing',
    author: current?.author ?? '',
    loopText: current ? `Loop ${queue.loopNumber} · ${queue.position} of ${queue.loopLength}` : '',
    playing: state.playerState === STATE.PLAYING,
    upcoming: state.songs.size ? queue.upcoming(4).map(id => (id === null ? null : titleOf(id))) : [],
    endMode: queue.endMode,
    showEmpty: !current,
  });
}

// ---------- events ----------

setupSongList($('songs'), { onPlayNow: playNow, onWeight: setWeight });
setupEndModeButtons($('endMode'), mode => {
  queue.endMode = mode;
  settings.endMode = mode;
  store.saveSettings(settings);
  render();
});
$('playBtn').addEventListener('click', togglePlay);
$('nextBtn').addEventListener('click', () => { if (player && queue.current) next(); });
$('prevBtn').addEventListener('click', () => { if (player) previous(); });

$('plLink').addEventListener('input', () => {
  $('loadBtn').textContent = parseLink($('plLink').value).type === 'video' ? 'Add' : 'Load';
  hideStatus();
});
$('loadForm').addEventListener('submit', e => {
  e.preventDefault();
  const link = parseLink($('plLink').value);
  if (link.type === 'empty') return;
  if (link.type === 'invalid') {
    return showStatus("That doesn't look like a YouTube link. Paste a playlist link (it contains list=) or a video link.", 'err');
  }
  $('plLink').value = '';
  $('loadBtn').textContent = 'Load';
  if (link.type === 'playlist') loadPlaylist(link.listId);
  else if (link.type === 'video') addVideo(link.videoId);
  else {
    showStatus('This link is a video inside a playlist.', '', [
      { label: 'Load the whole playlist', primary: true, onClick: () => loadPlaylist(link.listId) },
      { label: 'Add just this video', onClick: () => addVideo(link.videoId) },
    ]);
  }
});
$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const link = parseLink($('addLink').value);
  if (link.type === 'empty') return;
  if (link.type === 'playlist') return showStatus("That's a playlist link. Paste it in the top bar to load it.", 'err');
  if (link.type === 'invalid') return showStatus("That doesn't look like a YouTube video link.", 'err');
  $('addLink').value = '';
  addVideo(link.videoId);
});

// The weight ⓘ tooltip: tap to open, tap anywhere else to close.
$('infoBtn').addEventListener('click', e => {
  e.stopPropagation();
  const button = $('infoBtn');
  button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
});
document.addEventListener('click', () => $('infoBtn').setAttribute('aria-expanded', 'false'));

if (!store.available) $('storageNote').hidden = false;
render();
boot();

async function boot() {
  try {
    const YT = await loadYouTubeApi();
    player = await createPlayer(YT, 'ytPlayer', { onStateChange, onError });
  } catch {
    showStatus("The YouTube player couldn't load. Check your connection or ad blocker.", 'err');
    return;
  }
  const last = settings.lastSource;
  if (last?.type === 'playlist') loadPlaylist(last.id);
  else if (last?.type === 'mine') {
    state.title = MY_ROTATION;
    setSource(MINE, []);
  }
}
