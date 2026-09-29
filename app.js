// Wires the page together: link bar, playlist loading, weights, playback and saving.
import { parseLink, isMix } from './links.js';
import { clampWeight, playsPerLoop, frequencyText, compareSongs } from './weights.js';
import { Queue } from './rotation.js';
import { createStore, MINE } from './storage.js';
import { loadYouTubeApi, createPlayer, fetchInfo, fetchVideoInfos, playlistUrl, videoUrl, STATE } from './youtube.js';
import { setupSongList, renderSongs, flashRow } from './songs-view.js';
import { setupEndModeButtons, renderPlayer } from './player-view.js';
import { Crew } from './crew.js';
import { CrewView } from './crew-view.js';

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
  reloadCurrent: false,         // the player lost the current song (a failed playlist load)
  playlistIds: new Set(),       // songs that came from the YouTube playlist itself
  removed: new Set(),           // playlist songs removed here; kept out when the playlist is read again
  removedInfo: new Map(),       // videoId -> song removed this session (for Undo and the playing title)
};
let queue = newQueue();
let player = null;
let resortTimer = null;
let renderQueued = false;

// The crew is session only. Plays count after 30 seconds of actual playback.
const crew = new Crew();
const crewView = new CrewView({
  yard: $('yard'), empty: $('yardEmpty'), count: $('penCount'), crew, titleFor: id => titleOf(id),
});
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const seconds = (now - lastTick) / 1000;
  lastTick = now;
  if (state.playerState === STATE.PLAYING) crewView.apply(crew.tick(seconds));
}, 250);

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

// Success notes clear themselves; errors and questions stay until the next action.
const OK_NOTE_MS = 4000;
let statusTimer = null;

function showStatus(message, kind = '', actions = []) {
  const box = $('status');
  clearTimeout(statusTimer);
  if (kind === 'ok') statusTimer = setTimeout(hideStatus, OK_NOTE_MS);
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
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', hideStatus);
  box.append(close);
  box.hidden = false;
}

function hideStatus() {
  clearTimeout(statusTimer);
  $('status').hidden = true;
}

// ---------- songs, weights, saving ----------

const playable = () => [...state.songs.values()].filter(s => !s.blocked);
const songInfo = id => state.songs.get(id) ?? state.removedInfo.get(id);
const titleOf = id => songInfo(id)?.title ?? id;

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
  store.savePlaylist(state.sourceId, { weights, extras, removed: [...state.removed] });
  store.saveSettings(settings);
}

function addSong(id, weight, extra) {
  state.songs.set(id, { id, title: null, author: '', thumbnail: '', weight, extra, blocked: false });
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

function removeSong(id) {
  const song = state.songs.get(id);
  if (!song) return;
  state.songs.delete(id);
  state.removedInfo.set(id, song);
  if (state.playlistIds.has(id)) state.removed.add(id);
  updateCounts(); // a playing song finishes; the loop carries on without it
  resort();
  save();
  render();
  showStatus(`Removed ${song.title ?? id}.`, 'ok', [{ label: 'Undo', onClick: () => restoreSong(id) }]);
}

function restoreSong(id) {
  const song = state.removedInfo.get(id);
  if (!song || state.songs.has(id)) return;
  state.removedInfo.delete(id);
  state.removed.delete(id);
  state.songs.set(id, song);
  updateCounts();
  resort();
  save();
  render();
}

// ---------- loading ----------

function setSource(sourceId, playlistIds) {
  const saved = store.loadPlaylist(sourceId);
  state.sourceId = sourceId;
  state.songs = new Map();
  state.playlistIds = new Set(playlistIds);
  state.removed = new Set(saved.removed.filter(id => state.playlistIds.has(id)));
  state.removedInfo = new Map();
  for (const id of playlistIds) if (!state.songs.has(id) && !state.removed.has(id)) addSong(id, saved.weights[id] ?? 1, false);
  for (const id of saved.extras) if (!state.songs.has(id)) addSong(id, saved.weights[id] ?? 1, true);
  settings.lastSource = { type: sourceId === MINE ? 'mine' : 'playlist', id: sourceId };
  crewView.apply(crew.endPlay());
  if (player) player.stop();
  state.playStarted = false;
  queue = newQueue();
  updateCounts();
  cueFirstSong();
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
        song.thumbnail = info.thumbnail;
      }
      scheduleRender();
    },
  }).then(() => {
    resort();
    render();
  });
}

// Only the latest load may apply: an older load that finishes late could read the
// newer playlist's songs and save them under the older playlist's key.
let loadToken = 0;

async function loadPlaylist(listId) {
  if (!player) return showStatus('The YouTube player is still loading. Try again in a moment.');
  const token = ++loadToken;
  const wasPlaying = state.playerState === STATE.PLAYING;
  showStatus('Loading playlist…');
  let ids;
  try {
    ids = await player.listPlaylist(listId);
  } catch {
    if (token !== loadToken) return;
    restoreCurrentSong(wasPlaying);
    return showStatus(isMix(listId)
      ? "YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead."
      : "Couldn't load this playlist. It may be private or deleted.", 'err');
  }
  if (token !== loadToken) return;
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
  if (state.removedInfo.has(videoId)) {
    restoreSong(videoId);
    return showStatus(`Added ${titleOf(videoId)} back.`, 'ok');
  }
  state.removed.delete(videoId);
  addSong(videoId, 1, !state.playlistIds.has(videoId));
  updateCounts();
  if (!queue.current) cueFirstSong();
  resort();
  save();
  render();
  showStatus(`Added to ${state.title}, weight 1.`, 'ok');
  const info = await fetchInfo(videoUrl(videoId));
  const song = state.songs.get(videoId);
  if (song && info) {
    song.title = info.title;
    song.author = info.author;
    song.thumbnail = info.thumbnail;
    resort();
    render();
  }
}

// ---------- playback ----------

// Wait paused on the first song of the loop (a weighted random pick), so Play starts it.
function cueFirstSong() {
  const id = player && queue.start();
  if (id) player.cue(id);
}

function playSong(id) {
  if (!id) return;
  crewView.apply(crew.endPlay());
  state.playStarted = false;
  state.reloadCurrent = false;
  player.play(id);
  render();
}

// Cueing a playlist replaces the video in the player, so after a failed load the
// current song has to be loaded again: now if it was playing, or on the next Play.
function restoreCurrentSong(wasPlaying) {
  if (!queue.current) return;
  if (wasPlaying) return playSong(queue.current);
  crewView.apply(crew.endPlay());
  state.playStarted = false;
  state.reloadCurrent = true;
  render();
}

function next() {
  const id = queue.next();
  if (id) playSong(id);
  else {
    crewView.apply(crew.endPlay());
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
  if (state.reloadCurrent) return playSong(queue.current);
  if (state.playerState === STATE.PLAYING) player.pause();
  else player.resume();
}

function playNow(id) {
  if (player && queue.playNow(id)) playSong(id);
}

function onStateChange(s) {
  state.playerState = s;
  if (s === STATE.PLAYING && !state.playStarted && queue.current) {
    state.playStarted = true;
    crewView.apply(crew.startPlay(queue.current));
  }
  if (s === STATE.ENDED) {
    crewView.apply(crew.endPlay());
    next();
  }
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
      thumbnail: s.thumbnail,
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

  const current = queue.current ? songInfo(queue.current) : null;
  renderPlayer(playerEls, {
    title: current ? (current.title ?? current.id) : 'Nothing playing',
    author: current?.author ?? '',
    loopText: current ? `Loop ${queue.loopNumber} · ${queue.position} of ${queue.loopLength}` : '',
    playing: state.playerState === STATE.PLAYING,
    upcoming: state.songs.size ? queue.upcoming(4).map(id => (id === null ? null : titleOf(id))) : [],
    endMode: queue.endMode,
    showEmpty: !current,
    emptyText: state.songs.size ? 'Press play to start.' : 'Paste a playlist link above, then press play.',
  });
  crewView.setCurrent(queue.current);
  crewView.setPaused(state.playerState !== STATE.PLAYING);
  crewView.refreshTitles();
}

// ---------- events ----------

setupSongList($('songs'), { onPlayNow: playNow, onWeight: setWeight, onRemove: removeSong });
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
