// The "Manage playlists" modal over the player. It shows the list's playlists and added songs,
// and changes them through the player's own actions, so the song that's playing keeps playing.
import { parseLink, isMix } from './links.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, className, ariaLabel) {
  const b = el('button', className, label);
  b.type = 'button';
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  return b;
}

// actions:
//   getData() → { sources: [{ id, title, owner, count, status, syncing }], extras: [{ id, title, author, thumbnail }] }
//   addPlaylist(listId) → Promise<{ ok, message }>
//   removeSource(listId) → index it was at (or -1);  restoreSource(listId, index) → Promise
//   syncSource(listId) → Promise<{ ok, message }>
//   removeExtra(videoId);  restoreExtra(videoId)
//   startOver()
export function setupManage(dialog, actions) {
  const $ = id => dialog.querySelector(`#${id}`);

  // ---------- notes inside the modal (success notes clear after 4 s, like the player's) ----------
  let noteTimer = null;
  function note(message, kind = 'ok', action = null) {
    const box = $('mStatus');
    clearTimeout(noteTimer);
    if (kind === 'ok') noteTimer = setTimeout(() => { box.hidden = true; }, 4000);
    box.className = `status ${kind}`.trim();
    box.replaceChildren(el('span', null, message));
    if (action) {
      const wrap = el('span', 'choice');
      const b = button(action.label, 'btn');
      b.addEventListener('click', () => {
        box.hidden = true;
        action.onClick();
      });
      wrap.append(b);
      box.append(wrap);
    }
    const close = button('×', 'close', 'Dismiss');
    close.addEventListener('click', () => { box.hidden = true; });
    box.append(close);
    box.hidden = false;
  }

  // ---------- cards ----------
  function sourceCard(source) {
    const title = source.title ?? 'YouTube playlist';
    const li = el('li', 'source');
    li.dataset.id = source.id;
    const text = el('div', 'text');
    text.append(el('span', 't', title));
    if (source.owner) text.append(el('span', 'c', `by ${source.owner}`));
    let detail = 'Loading…';
    if (source.syncing) detail = 'Syncing with YouTube…';
    else if (source.status === 'error') detail = "Couldn't load (private, deleted or a Mix)";
    else if (Number.isInteger(source.count)) detail = `${source.count} ${source.count === 1 ? 'song' : 'songs'}`;
    text.append(el('span', source.status === 'error' && !source.syncing ? 'detail err' : 'detail', detail));

    const sync = button('↻ Sync', 'btn', `Sync ${title} with YouTube`);
    sync.dataset.action = 'sync';
    sync.dataset.tip = 'Re-read from YouTube and bring back songs you removed from it';
    sync.disabled = !!source.syncing;
    sync.addEventListener('click', () => syncSource(source.id, title));
    const remove = button('Remove', 'btn', `Remove ${title}`);
    remove.dataset.action = 'remove';
    remove.addEventListener('click', () => removeSource(source.id, title));
    li.append(text, sync, remove);
    return li;
  }

  function extraRow(song) {
    const title = song.title ?? song.id;
    const li = el('li', 'source');
    li.dataset.id = song.id;
    const thumb = el('span', 'thumb');
    if (song.thumbnail) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = song.thumbnail;
      thumb.append(img);
    }
    const text = el('div', 'text');
    text.append(el('span', 't', title));
    if (song.author) text.append(el('span', 'c', song.author));
    const remove = button('Remove', 'btn', `Remove ${title}`);
    remove.dataset.action = 'remove';
    remove.addEventListener('click', () => removeExtra(song.id, title));
    li.append(thumb, text, remove);
    return li;
  }

  // Rebuild the cards only when what they show has changed, so focus and tooltips aren't lost
  // every time the player updates.
  let shown = '';
  function render({ force = false } = {}) {
    const data = actions.getData();
    const key = JSON.stringify(data);
    if (!force && key === shown) return;
    shown = key;
    const { sources, extras } = data;
    $('mSources').replaceChildren(...sources.map(sourceCard));
    $('mSourcesEmpty').hidden = sources.length > 0;
    $('mExtras').replaceChildren(...extras.map(extraRow));
    $('mExtrasEmpty').hidden = extras.length > 0;
  }

  // ---------- edits ----------
  function removeSource(listId, title) {
    const index = actions.removeSource(listId);
    if (index < 0) return;
    render();
    note(`Removed ${title}.`, 'ok', {
      label: 'Undo',
      onClick: async () => {
        await actions.restoreSource(listId, index);
        render();
      },
    });
  }

  async function syncSource(listId, title) {
    const done = actions.syncSource(listId);
    render(); // shows "Syncing…" on the card
    const result = await done;
    render();
    note(result.message, result.ok ? 'ok' : 'err');
  }

  function removeExtra(videoId, title) {
    actions.removeExtra(videoId);
    render();
    note(`Removed ${title}.`, 'ok', {
      label: 'Undo',
      onClick: () => {
        actions.restoreExtra(videoId);
        render();
      },
    });
  }

  $('mAddForm').addEventListener('submit', async e => {
    e.preventDefault();
    const link = parseLink($('mAddLink').value);
    if (link.type === 'empty') return;
    if (link.type !== 'playlist' && link.type !== 'both') {
      return note("That doesn't look like a YouTube playlist link. It should contain list=.", 'err');
    }
    if (isMix(link.listId)) {
      return note("YouTube Mix playlists can't be loaded here. Save the songs to a regular playlist and paste that link instead.", 'err');
    }
    $('mAddLink').value = '';
    note('Loading playlist…', '');
    const result = await actions.addPlaylist(link.listId);
    render();
    note(result.message, result.ok ? 'ok' : 'err');
  });

  $('mStartOver').addEventListener('click', () => {
    $('mStartOver').hidden = true;
    $('mConfirmStartOver').hidden = false;
  });
  $('mCancelStartOver').addEventListener('click', () => {
    $('mConfirmStartOver').hidden = true;
    $('mStartOver').hidden = false;
  });
  $('mConfirmClear').addEventListener('click', () => {
    actions.startOver();
    $('mConfirmStartOver').hidden = true;
    $('mStartOver').hidden = false;
    render();
    note('Your list is empty. Weights come back if the same songs return.');
  });

  // Close with ×, Escape (built into <dialog>), or a click on the dark area outside the window.
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.close();
  });

  return {
    open() {
      render({ force: true });
      dialog.showModal();
    },
    // Called by the player whenever its list changes, so an open modal stays current.
    render() {
      if (dialog.open) render();
    },
  };
}
