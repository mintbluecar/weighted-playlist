// Manage playlists: shows the rotation the player last saved, and edits which playlists
// and added songs are in it. It needs no YouTube player; the player re-reads on its next load.
import { createStore } from './storage.js';
import { parseLink, isMix } from './links.js';
import { fetchInfo, fetchVideoInfos, playlistUrl } from './youtube.js';

const $ = id => document.getElementById(id);

let backend = null;
try {
  backend = window.localStorage;
} catch {
  backend = null; // storage blocked by the browser
}
const store = createStore(backend);
let rotation = store.loadRotation();
const extraInfo = new Map(); // videoId -> { title, author, thumbnail }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function save() {
  store.saveRotation(rotation);
}

// ---------- notes (same behaviour as the player: success notes clear after 4 s) ----------

let noteTimer = null;
function note(message, kind = 'ok', action = null) {
  const box = $('status');
  clearTimeout(noteTimer);
  if (kind === 'ok') noteTimer = setTimeout(() => { box.hidden = true; }, 4000);
  box.className = `status ${kind}`;
  box.replaceChildren(el('span', null, message));
  if (action) {
    const button = el('button', 'btn', action.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      box.hidden = true;
      action.onClick();
    });
    const wrap = el('span', 'choice');
    wrap.append(button);
    box.append(wrap);
  }
  const close = el('button', 'close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => { box.hidden = true; });
  box.append(close);
  box.hidden = false;
}

// ---------- cards ----------

function sourceCard(id) {
  const info = rotation.sourceInfo[id] ?? {};
  const title = info.title ?? 'YouTube playlist';
  const li = el('li', 'source');
  const text = el('div', 'text');
  text.append(el('span', 't', title));
  if (info.owner) text.append(el('span', 'c', `by ${info.owner}`));
  let detail = 'Songs load when you open the player';
  if (info.status === 'error') detail = "Couldn't load last time (private, deleted or a Mix)";
  else if (Number.isInteger(info.count)) detail = `${info.count} ${info.count === 1 ? 'song' : 'songs'}`;
  text.append(el('span', info.status === 'error' ? 'detail err' : 'detail', detail));
  const remove = el('button', 'btn', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${title}`);
  remove.addEventListener('click', () => removeSource(id));
  li.append(text, remove);
  return li;
}

function extraRow(id) {
  const info = extraInfo.get(id);
  const title = info?.title ?? id;
  const li = el('li', 'source');
  const thumb = el('span', 'thumb');
  if (info?.thumbnail) {
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = info.thumbnail;
    thumb.append(img);
  }
  const text = el('div', 'text');
  text.append(el('span', 't', title));
  if (info?.author) text.append(el('span', 'c', info.author));
  const remove = el('button', 'btn', 'Remove');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${title}`);
  remove.addEventListener('click', () => removeExtra(id));
  li.append(thumb, text, remove);
  return li;
}

function render() {
  $('sources').replaceChildren(...rotation.sources.map(sourceCard));
  $('sourcesEmpty').hidden = rotation.sources.length > 0;
  $('extras').replaceChildren(...rotation.extras.map(extraRow));
  $('extrasEmpty').hidden = rotation.extras.length > 0;
}

// ---------- edits ----------

function removeSource(id) {
  const index = rotation.sources.indexOf(id);
  if (index < 0) return;
  rotation.sources.splice(index, 1);
  save();
  render();
  const title = rotation.sourceInfo[id]?.title ?? 'the playlist';
  note(`Removed ${title}.`, 'ok', {
    label: 'Undo',
    onClick: () => {
      if (!rotation.sources.includes(id)) rotation.sources.splice(index, 0, id);
      save();
      render();
    },
  });
}

function removeExtra(id) {
  const index = rotation.extras.indexOf(id);
  if (index < 0) return;
  rotation.extras.splice(index, 1);
  save();
  render();
  note(`Removed ${extraInfo.get(id)?.title ?? 'the song'}.`, 'ok', {
    label: 'Undo',
    onClick: () => {
      if (!rotation.extras.includes(id)) rotation.extras.splice(index, 0, id);
      save();
      render();
    },
  });
}

$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const link = parseLink($('addLink').value);
  if (link.type === 'empty') return;
  if (link.type !== 'playlist' && link.type !== 'both') {
    return note("That doesn't look like a YouTube playlist link. It should contain list=.", 'err');
  }
  if (isMix(link.listId)) {
    return note("YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead.", 'err');
  }
  if (rotation.sources.includes(link.listId)) return note('That playlist is already in your list.');
  $('addLink').value = '';
  rotation.sources.push(link.listId);
  rotation.sourceInfo[link.listId] = {};
  save();
  render();
  const info = await fetchInfo(playlistUrl(link.listId));
  if (info && rotation.sources.includes(link.listId)) {
    rotation.sourceInfo[link.listId] = { ...rotation.sourceInfo[link.listId], title: info.title, owner: info.author };
    save();
    render();
  }
  note(`Added ${info?.title ?? 'the playlist'}. Its songs load when you open the player.`);
});

$('startOver').addEventListener('click', () => {
  $('startOver').hidden = true;
  $('confirmStartOver').hidden = false;
});
$('cancelStartOver').addEventListener('click', () => {
  $('confirmStartOver').hidden = true;
  $('startOver').hidden = false;
});
$('confirmClear').addEventListener('click', () => {
  rotation = { ...rotation, sources: [], extras: [], removed: [], sourceInfo: {} }; // weights are kept
  save();
  render();
  $('confirmStartOver').hidden = true;
  $('startOver').hidden = false;
  note('Your list is empty. Weights come back if the same songs return.');
});

// Another tab (the player) saved a newer rotation.
window.addEventListener('storage', e => {
  if (e.key !== 'hr:rotation') return;
  rotation = store.loadRotation();
  render();
});

render();
fetchVideoInfos(rotation.extras, {
  onInfo: (id, info) => {
    if (info) extraInfo.set(id, info);
    render();
  },
});
