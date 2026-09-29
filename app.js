// Wires the page together: link bar, playlist loading, weights, playback and saving.
import { parseLink, isMix } from './links.js';
import { clampWeight, playsPerLoop, frequencyText, compareSongs } from './weights.js';
import { Queue } from './rotation.js';
import { createStore, titlesToLookUp } from './storage.js';
import { listHeading } from './sources.js';
import { loadYouTubeApi, createPlayer, createReader, fetchInfo, fetchVideoInfos, playlistUrl, videoUrl, STATE } from './youtube.js';
import { setupSongList, renderSongs, flashRow } from './songs-view.js';
import { setupEndModeButtons, renderPlayer } from './player-view.js';
import { setupQueue, renderQueue } from './queue-view.js';
import { setupManage } from './manage-view.js';
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
  syncing: new Set(),           // playlists being re-read by a Sync in the manage modal
  removedSourceInfo: new Map(), // playlist ID -> its details, kept for Undo after Remove
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

function removeSong(id, { quiet = false } = {}) {
  const song = state.songs.get(id);
  if (!song) return;
  state.songs.delete(id);
  state.removedInfo.set(id, song);
  if (state.playlistIds.has(id)) state.removed.add(id);
  updateCounts(); // a playing song finishes; the loop carries on without it
  resort();
  save();
  render();
  if (!quiet) showStatus(`Removed ${song.title ?? id}. Still on YouTube.`, 'ok', [{ label: 'Undo', onClick: () => restoreSong(id) }]);
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
  if (!reader) return Promise.reject(new Error('reader-not-ready'));
  const result = readChain.then(() => reader.listPlaylist(listId));
  readChain = result.catch(() => {});
  return result;
}

// Read a playlist and record what happened, for the header and the manage page.
// Returns 'ok', 'error' (couldn't be read), or 'gone' (removed from the list while it was being read).
async function loadSource(listId) {
  let ids = null;
  try {
    ids = await readSource(listId);
  } catch {
    ids = null;
  }
  if (!rotation.sources.includes(listId)) return 'gone'; // Remove or Start over meanwhile: leave nothing behind
  if (!ids) {
    // Keep the songs from an earlier good read (if any), so the list and its playlists stay in step.
    rotation.sourceInfo[listId] = { ...rotation.sourceInfo[listId], status: 'error' };
    return 'error';
  }
  state.sourceSongs.set(listId, ids);
  rotation.sourceInfo[listId] = { ...rotation.sourceInfo[listId], count: ids.length, status: 'ok' };
  return 'ok';
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
  if (!crew.members.size) crewView.showVisitors([...state.songs.keys()]); // an empty pen gets visitors
  return newIds;
}

// Look up titles that aren't remembered, or were looked up more than a day ago (all of them with force).
function loadTitles(ids, { force = false } = {}) {
  const lookup = force ? ids : titlesToLookUp(ids, titleCache);
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
  }).catch(() => {}); // lookups never throw (fetchInfo returns null); this guards the saving and drawing
}

function failedMessage(listIds) {
  const names = listIds.map(id => rotation.sourceInfo[id]?.title ?? 'A playlist');
  const which = names.length === 1 ? `${names[0]} couldn't` : `${names.length} playlists couldn't`;
  return `${which} be loaded. It may be private or deleted. Its songs are hidden until it loads again.`;
}

// "Loading your playlists" shows while any read of the rotation's playlists is running.
let loadingReads = 0;
function setLoading(delta) {
  loadingReads = Math.max(0, loadingReads + delta);
  $('listLoading').hidden = loadingReads === 0;
}

// Read all of the rotation's playlists and rebuild the list.
async function loadRotation() {
  const toRead = [...rotation.sources];
  if (toRead.length) setLoading(+1);
  const results = await Promise.all(toRead.map(async id => [id, await loadSource(id)]));
  if (toRead.length) setLoading(-1);
  rebuildSongs();
  const failed = results.filter(([, result]) => result === 'error').map(([id]) => id);
  if (failed.length) showStatus(failedMessage(failed), 'err');
  toRead.forEach(refreshSourceTitle);
}

// Adding a playlist (pasted in the top bar or in the modal) adds its songs to the list.
// Nothing that's playing is interrupted. Returns { ok, message } for the caller to show.
async function addPlaylist(listId) {
  if (!reader) return { ok: false, message: 'The YouTube player is still loading. Try again in a moment.' };
  if (rotation.sources.includes(listId)) return { ok: true, message: 'That playlist is already in your list.' };
  rotation.sources.push(listId);
  save();
  render(); // its card shows "Loading…" in the manage modal straight away (and can be removed)
  const before = new Set(state.songs.keys());
  const read = await loadSource(listId);
  if (read === 'gone') return { ok: false, message: 'That playlist was removed before it finished loading.' };
  if (read === 'error') {
    rotation.sources = rotation.sources.filter(id => id !== listId);
    delete rotation.sourceInfo[listId];
    save();
    return {
      ok: false,
      message: isMix(listId)
        ? "YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead."
        : "Couldn't load this playlist. It may be private or deleted.",
    };
  }
  // The old version saved each playlist on its own: bring back its weights, added and removed songs, once.
  const old = store.takeOldPlaylist(listId);
  if (old) {
    for (const [id, weight] of Object.entries(old.weights)) if (!(id in rotation.weights)) rotation.weights[id] = weight;
    rotation.removed = [...new Set([...rotation.removed, ...old.removed])];
    rotation.extras = [...new Set([...rotation.extras, ...old.extras])];
  }
  rebuildSongs();
  const added = [...state.songs.keys()].filter(id => !before.has(id)).length;
  await refreshSourceTitle(listId);
  const title = rotation.sourceInfo[listId]?.title ?? 'the playlist';
  return { ok: true, message: `Added ${title} (${added} new ${added === 1 ? 'song' : 'songs'}).` };
}

async function addPlaylistFromTopBar(listId) {
  if (reader && !rotation.sources.includes(listId)) showStatus('Loading playlist…');
  const result = await addPlaylist(listId);
  showStatus(result.message, result.ok ? 'ok' : 'err');
}

// ---------- manage playlists (the modal) ----------

function removeSource(listId) {
  const index = rotation.sources.indexOf(listId);
  if (index < 0) return -1;
  rotation.sources.splice(index, 1);
  state.removedSourceInfo.set(listId, rotation.sourceInfo[listId]);
  delete rotation.sourceInfo[listId];
  rebuildSongs(); // its songs leave; a playing one finishes
  return index;
}

async function restoreSource(listId, index) {
  if (rotation.sources.includes(listId)) return;
  rotation.sources.splice(Math.min(index, rotation.sources.length), 0, listId);
  rotation.sourceInfo[listId] = state.removedSourceInfo.get(listId) ?? {};
  // Not read yet: read it now, or leave it to boot if YouTube's player isn't ready.
  if (!state.sourceSongs.has(listId) && reader) await loadSource(listId);
  rebuildSongs();
}

// Re-read one playlist from YouTube, bring back its songs removed here, and refresh their titles.
async function syncSource(listId) {
  const title = () => rotation.sourceInfo[listId]?.title ?? 'the playlist';
  if (!reader) return { ok: false, message: 'The YouTube player is still loading. Try again in a moment.' };
  state.syncing.add(listId);
  setLoading(+1);
  const read = await loadSource(listId);
  state.syncing.delete(listId);
  setLoading(-1);
  if (read === 'gone') return { ok: false, message: 'That playlist was removed while it was syncing.' };
  if (read === 'error') {
    save();
    render();
    return { ok: false, message: `Couldn't read ${title()} from YouTube. It may be private or deleted.` };
  }
  const ids = new Set(state.sourceSongs.get(listId));
  rotation.removed = rotation.removed.filter(id => !ids.has(id));
  const fresh = new Set(rebuildSongs()); // songs new to the list are looked up by the rebuild
  loadTitles([...ids].filter(id => !fresh.has(id)), { force: true });
  await refreshSourceTitle(listId);
  return { ok: true, message: `Synced ${title()}.` };
}

// Empty the list: no playlists, no added songs, nothing removed. Weights stay remembered.
function startOver() {
  rotation = { ...rotation, sources: [], extras: [], removed: [], sourceInfo: {} };
  rebuildSongs();
}

function manageData() {
  return {
    sources: rotation.sources.map(id => ({ id, ...rotation.sourceInfo[id], syncing: state.syncing.has(id) })),
    extras: rotation.extras.map(id => ({ id, ...titleCache[id], ...songInfo(id) })),
  };
}

const manage = setupManage($('manageDialog'), {
  getData: manageData,
  addPlaylist,
  removeSource,
  restoreSource,
  syncSource,
  removeExtra: id => removeSong(id, { quiet: true }),
  restoreExtra: id => restoreSong(id),
  startOver,
});

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
  manage.render();
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
  if (link.type === 'playlist') addPlaylistFromTopBar(link.listId);
  else if (link.type === 'video') addVideo(link.videoId);
  else {
    showStatus('This link is a video inside a playlist.', '', [
      { label: 'Add the whole playlist', primary: true, onClick: () => addPlaylistFromTopBar(link.listId) },
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

$('manageBtn').addEventListener('click', () => manage.open());

// Loopsided open in another tab saved a change: take its version, read any playlists this tab
// hasn't read, and rebuild. Songs that leave finish if they're playing, like a removed song.
window.addEventListener('storage', async e => {
  if (e.key !== 'hr:rotation') return;
  rotation = store.loadRotation();
  const unread = rotation.sources.filter(id => !state.sourceSongs.has(id) && rotation.sourceInfo[id]?.status !== 'error');
  if (reader && unread.length) {
    setLoading(+1);
    await Promise.all(unread.map(loadSource));
    setLoading(-1);
  }
  rebuildSongs();
});

if (!store.available) $('storageNote').hidden = false;
// Build the list from the saved rotation straight away, so nothing saved before the playlists
// are read (like adding a video) can overwrite the saved added and removed songs.
rebuildSongs();
// Waiting for YouTube's player counts as loading when there are playlists to read.
const waitingForPlayer = rotation.sources.length > 0;
if (waitingForPlayer) setLoading(+1);
boot();

async function boot() {
  try {
    const YT = await loadYouTubeApi();
    [player, reader] = await Promise.all([
      createPlayer(YT, 'ytPlayer', { onStateChange, onError }),
      createReader(YT, $('ytReader')),
    ]);
  } catch {
    if (waitingForPlayer) setLoading(-1);
    showStatus("The YouTube player couldn't load. Check your connection or ad blocker.", 'err');
    return;
  }
  loadRotation().catch(() => showStatus("Your playlists couldn't be loaded. Try reloading the page.", 'err'));
  if (waitingForPlayer) setLoading(-1);
}
