// Wires the page together: link bar, playlist loading, weights, playback and saving.
import { parseLink, isMix } from './links.js';
import { clampWeight, playsPerLoop, frequencyText, compareSongs } from './weights.js';
import { Queue } from './rotation.js';
import { createStore, titlesToLookUp } from './storage.js';
import { listHeading } from './sources.js';
import { loadYouTubeApi, createPlayer, fetchInfo, fetchVideoInfos, playlistUrl, videoUrl, STATE } from './youtube.js';
import { setupSongList, renderSongs, flashRow } from './songs-view.js';
import { setupEndModeButtons, renderPlayer } from './player-view.js';
import { setupQueue, renderQueue } from './queue-view.js';
import { Crew } from './crew.js';
import { CrewView } from './crew-view.js';

const $ = id => document.getElementById(id);

let backend = null;
try {
  backend = window.localStorage;
} catch {
  backend = null; // storage blocked by the browser
}
const store = createStore(backend);
const settings = store.loadSettings();
let rotation = store.loadRotation();
const titleCache = store.loadTitles(); // videoId -> { title, author, thumbnail, at }

const state = {
  sourceSongs: new Map(),       // playlist ID -> its video IDs, as read this session
  failedSources: new Set(),     // playlists that couldn't be read this session
  songs: new Map(),             // videoId -> { id, title, author, weight, extra, blocked }
  order: [],                    // videoIds in display order
  playerState: STATE.UNSTARTED,
  playStarted: false,           // has the current queue item started playing yet
  playlistIds: new Set(),       // songs that came from the YouTube playlist itself
  removed: new Set(),           // playlist songs removed here; kept out when playlists are read again
  removedInfo: new Map(),       // videoId -> song removed this session (for Undo and the playing title)
};
let queue = newQueue();
let player = null;
let reader = null;              // hidden second player, only for reading playlists
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
  playIcon: $('playIcon'), videoEmpty: $('videoEmpty'), endMode: $('endMode'),
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
  for (const s of state.songs.values()) rotation.weights[s.id] = s.weight; // weights are never dropped
  rotation.extras = [...state.songs.values()].filter(s => s.extra).map(s => s.id);
  rotation.removed = [...state.removed];
  store.saveRotation(rotation);
  store.saveSettings(settings);
}

// A new song object, named from remembered titles when we have them.
function newSong(id, weight, extra) {
  const known = titleCache[id];
  return { id, title: known?.title ?? null, author: known?.author ?? '', thumbnail: known?.thumbnail ?? '', weight, extra, blocked: false };
}

// Store a looked-up title on the song and remember it for next time.
function rememberTitle(id, info) {
  titleCache[id] = { ...info, at: Date.now() };
  const song = state.songs.get(id) ?? state.removedInfo.get(id);
  if (song) {
    song.title = info.title;
    song.author = info.author;
    song.thumbnail = info.thumbnail;
  }
}

function addSong(id, weight, extra) {
  state.songs.set(id, newSong(id, weight, extra));
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
  showStatus(`Removed ${song.title ?? id}. Still on YouTube.`, 'ok', [{ label: 'Undo', onClick: () => restoreSong(id) }]);
}

function restoreSong(id) {
  const song = state.removedInfo.get(id);
  if (!song || state.songs.has(id)) return;
  state.removedInfo.delete(id);
  state.removed.delete(id);
  song.extra = !state.playlistIds.has(id);
  state.songs.set(id, song);
  updateCounts();
  resort();
  save();
  render();
}

// ---------- loading ----------

// Read one playlist with the hidden reader. The reader can only cue one playlist at a time,
// so reads run one after another (two overlapping reads could swap their songs).
let readChain = Promise.resolve();
function readSource(listId) {
  const result = readChain.then(() => reader.listPlaylist(listId));
  readChain = result.catch(() => {});
  return result;
}

// Read a playlist and record what happened, for the header and the manage page.
async function loadSource(listId) {
  try {
    const ids = await readSource(listId);
    state.sourceSongs.set(listId, ids);
    state.failedSources.delete(listId);
    rotation.sourceInfo[listId] = { ...rotation.sourceInfo[listId], count: ids.length, status: 'ok' };
    return true;
  } catch {
    state.sourceSongs.delete(listId);
    state.failedSources.add(listId);
    rotation.sourceInfo[listId] = { ...rotation.sourceInfo[listId], status: 'error' };
    return false;
  }
}

async function refreshSourceTitle(listId) {
  const info = await fetchInfo(playlistUrl(listId));
  if (!info || !rotation.sources.includes(listId)) return;
  rotation.sourceInfo[listId] = { ...rotation.sourceInfo[listId], title: info.title, owner: info.author };
  save();
  render();
}

// Work out the song list from the rotation: every playlist's songs (minus songs removed here),
// plus songs added here. Songs that leave keep their details, so a playing song keeps its title.
function rebuildSongs() {
  state.playlistIds = new Set(rotation.sources.flatMap(id => state.sourceSongs.get(id) ?? []));
  state.removed = new Set(rotation.removed);
  const extras = new Set(rotation.extras);
  const wanted = [];
  for (const id of state.playlistIds) if (!state.removed.has(id)) wanted.push(id);
  for (const id of rotation.extras) if (!state.playlistIds.has(id)) wanted.push(id);

  const songs = new Map();
  const newIds = [];
  for (const id of wanted) {
    const song = state.songs.get(id) ?? state.removedInfo.get(id);
    if (song) {
      song.extra = extras.has(id);
      songs.set(id, song);
      state.removedInfo.delete(id);
    } else {
      songs.set(id, newSong(id, rotation.weights[id] ?? 1, extras.has(id)));
      newIds.push(id);
    }
  }
  for (const [id, song] of state.songs) if (!songs.has(id)) state.removedInfo.set(id, song);
  state.songs = songs;
  updateCounts(); // a playing song that left finishes; the loop carries on without it
  if (!queue.current) cueFirstSong();
  resort();
  save();
  render();
  if (newIds.length) loadTitles(newIds);
}

// Look up titles that aren't remembered, or were looked up more than a day ago.
function loadTitles(ids) {
  const lookup = titlesToLookUp(ids, titleCache);
  if (!lookup.length) return;
  fetchVideoInfos(lookup, {
    onInfo: (id, info) => {
      if (info) rememberTitle(id, info);
      scheduleRender();
    },
  }).then(() => {
    store.saveTitles(titleCache);
    resort();
    render();
  });
}

function failedMessage(listIds) {
  const names = listIds.map(id => rotation.sourceInfo[id]?.title ?? 'A playlist');
  const which = names.length === 1 ? `${names[0]} couldn't` : `${names.length} playlists couldn't`;
  return `${which} be loaded. It may be private or deleted. Its songs are hidden until it loads again.`;
}

// Read the rotation's playlists (all of them, or only ones not read yet) and rebuild the list.
async function loadRotation({ refresh = true } = {}) {
  const toRead = rotation.sources.filter(id => refresh || (!state.sourceSongs.has(id) && !state.failedSources.has(id)));
  const results = await Promise.all(toRead.map(async id => [id, await loadSource(id)]));
  rebuildSongs();
  const failed = results.filter(([, ok]) => !ok).map(([id]) => id);
  if (failed.length) showStatus(failedMessage(failed), 'err');
  toRead.forEach(refreshSourceTitle);
}

// Pasting a playlist adds its songs to the list. Nothing that's playing is interrupted.
async function addPlaylist(listId) {
  if (!reader) return showStatus('The YouTube player is still loading. Try again in a moment.');
  if (rotation.sources.includes(listId)) return showStatus('That playlist is already in your list.');
  rotation.sources.push(listId);
  save();
  showStatus('Loading playlist…');
  const before = new Set(state.songs.keys());
  if (!(await loadSource(listId))) {
    rotation.sources = rotation.sources.filter(id => id !== listId);
    delete rotation.sourceInfo[listId];
    save();
    return showStatus(isMix(listId)
      ? "YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead."
      : "Couldn't load this playlist. It may be private or deleted.", 'err');
  }
  if (!rotation.sources.includes(listId)) rotation.sources.push(listId); // another tab saved meanwhile
  rebuildSongs();
  const added = [...state.songs.keys()].filter(id => !before.has(id)).length;
  await refreshSourceTitle(listId);
  const title = rotation.sourceInfo[listId]?.title ?? 'the playlist';
  showStatus(`Added ${title} (${added} new ${added === 1 ? 'song' : 'songs'}).`, 'ok');
}

async function addVideo(videoId) {
  if (state.songs.has(videoId)) return showStatus('That song is already in the list.');
  if (state.removedInfo.has(videoId) && state.removed.has(videoId)) {
    restoreSong(videoId);
    return showStatus(`Added ${titleOf(videoId)} back.`, 'ok');
  }
  state.removed.delete(videoId);
  const inPlaylist = state.playlistIds.has(videoId);
  if (!inPlaylist) rotation.extras = [...rotation.extras, videoId];
  addSong(videoId, rotation.weights[videoId] ?? 1, !inPlaylist);
  updateCounts();
  if (!queue.current) cueFirstSong();
  resort();
  save();
  render();
  showStatus('Added to your list, weight 1.', 'ok');
  if (!titlesToLookUp([videoId], titleCache).length) return;
  const info = await fetchInfo(videoUrl(videoId));
  if (!info) return;
  rememberTitle(videoId, info);
  store.saveTitles(titleCache);
  resort();
  render();
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
  player.play(id);
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
  if (state.playerState === STATE.PLAYING) player.pause();
  else player.resume();
}

// Queue box: tap a queued song to play it now. It moves to the top and plays;
// the songs it passed stay in the queue.
function playFromQueue(where, index) {
  if (player && queue.moveToTop(where, index)) next();
}

function moveInQueue(where, index, dir) {
  if (!queue.move(where, index, dir)) return;
  render();
  // keep keyboard focus on the moved song's button
  $('queueList').querySelector(`.qitem[data-where="${where}"][data-index="${index + dir}"] [data-dir="${dir}"]`)?.focus();
}

// "Add to queue": an extra play at the top of the queue.
function addToQueue(id) {
  if (!queue.playNext(id)) return;
  render();
  showStatus(`Added ${titleOf(id)} to the queue.`, 'ok');
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
  const heading = listHeading(rotation.sources.map(id => rotation.sourceInfo[id] ?? {}), rotation.extras.length);
  const empty = !rotation.sources.length && !state.songs.size;
  $('plName').textContent = empty ? 'No playlist loaded' : heading.title;
  $('plOwner').textContent = empty ? '' : heading.owner;
  $('listMeta').textContent = state.songs.size ? `${state.songs.size} songs · ${length} plays per loop` : '';

  const current = queue.current ? songInfo(queue.current) : null;
  renderPlayer(playerEls, {
    title: current ? (current.title ?? current.id) : 'Nothing playing',
    author: current?.author ?? '',
    loopText: current ? `Loop ${queue.loopNumber} · ${queue.position} of ${queue.loopLength}` : '',
    playing: state.playerState === STATE.PLAYING,
    endMode: queue.endMode,
    showEmpty: !current,
    emptyText: state.songs.size ? 'Press play to start.' : 'Paste a playlist link above, then press play.',
  });
  const items = state.songs.size ? queue.queueItems(10) : [];
  let number = 0;
  renderQueue($('queueList'), items.map((item, i) => {
    if (item.type !== 'song') return item;
    const song = songInfo(item.id);
    const before = items[i - 1];
    const after = items[i + 1];
    return {
      ...item,
      number: ++number,
      title: song?.title ?? item.id,
      author: song?.author ?? '',
      thumbnail: song?.thumbnail ?? '',
      canUp: before?.type === 'song' && before.where === item.where,
      canDown: after?.type === 'song' && after.where === item.where,
    };
  }));
  crewView.setCurrent(queue.current);
  crewView.setPaused(state.playerState !== STATE.PLAYING);
  crewView.refreshTitles();
}

// ---------- events ----------

setupSongList($('songs'), { onPlayNow: playNow, onWeight: setWeight, onRemove: removeSong, onQueue: addToQueue });
setupQueue($('queueList'), { onPlay: playFromQueue, onMove: moveInQueue });
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
  if (link.type === 'playlist') addPlaylist(link.listId);
  else if (link.type === 'video') addVideo(link.videoId);
  else {
    showStatus('This link is a video inside a playlist.', '', [
      { label: 'Add the whole playlist', primary: true, onClick: () => addPlaylist(link.listId) },
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

// The pen collapses from its header; the crew keeps counting while it's hidden.
function setPenCollapsed(collapsed) {
  $('yard').hidden = collapsed;
  $('penToggle').setAttribute('aria-expanded', String(!collapsed));
  $('yard').closest('.pen').classList.toggle('collapsed', collapsed);
}
setPenCollapsed(settings.penCollapsed);
$('penToggle').addEventListener('click', () => {
  settings.penCollapsed = !settings.penCollapsed;
  setPenCollapsed(settings.penCollapsed);
  store.saveSettings(settings);
});

// The manage page (another tab) changed the rotation: take its version and read any new playlists.
// Songs that leave finish if they're playing, like a removed song.
// A Sync on the manage page also re-reads every playlist and looks up every title again.
let handledSync = rotation.syncAt ?? 0;
window.addEventListener('storage', e => {
  if (e.key !== 'hr:rotation') return;
  rotation = store.loadRotation();
  const sync = (rotation.syncAt ?? 0) > handledSync;
  if (sync) {
    handledSync = rotation.syncAt;
    Object.assign(titleCache, store.loadTitles());
  }
  if (!reader) return rebuildSongs(); // boot reads the playlists once the reader is ready
  loadRotation({ refresh: sync }).then(() => {
    if (sync) loadTitles([...state.songs.keys()]);
  });
});

if (!store.available) $('storageNote').hidden = false;
// Build the list from the saved rotation straight away, so nothing saved before the playlists
// are read (like adding a video) can overwrite the saved added and removed songs.
rebuildSongs();
boot();

async function boot() {
  try {
    const YT = await loadYouTubeApi();
    [player, reader] = await Promise.all([
      createPlayer(YT, 'ytPlayer', { onStateChange, onError }),
      createPlayer(YT, 'ytReader'),
    ]);
  } catch {
    showStatus("The YouTube player couldn't load. Check your connection or ad blocker.", 'err');
    return;
  }
  loadRotation();
}
