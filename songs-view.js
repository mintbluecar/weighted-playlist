// Draws the song list. Rows are keyed by video ID and updated in place,
// so typing in a weight box keeps its focus while the list re-renders.
import { MAX_WEIGHT, MIN_WEIGHT } from './weights.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function setupSongList(listEl, { onPlayNow, onWeight, onRemove, onQueue }) {
  listEl.addEventListener('click', e => {
    const button = e.target.closest('button');
    const row = button?.closest('.song');
    if (!row) return;
    const id = row.dataset.id;
    const input = row.querySelector('input');
    const role = button.dataset.role;
    if (role === 'menu') return toggleMenu(listEl, row);
    if (role === 'queue' || role === 'remove') closeMenus(listEl);
    if (role === 'inc') onWeight(id, Number(input.value) + 1);
    else if (role === 'dec') onWeight(id, Number(input.value) - 1);
    else if (role === 'remove') onRemove(id);
    else if (role === 'queue') onQueue(id);
    else if (button.dataset.role === 'name' && !row.classList.contains('blocked')) onPlayNow(id);
  });
  listEl.addEventListener('change', e => {
    if (e.target.dataset.role !== 'weight') return;
    e.target.dataset.committed = '1'; // show the stored (clamped) value even while focused
    onWeight(e.target.closest('.song').dataset.id, e.target.value);
  });
  // Close the ⋯ menu when clicking elsewhere, or on Escape (focus goes back to its button).
  document.addEventListener('click', e => {
    if (!e.target.closest?.('.song .more-wrap')) closeMenus(listEl);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = listEl.querySelector('.menu:not([hidden])');
    if (!open) return;
    closeMenus(listEl);
    open.closest('.more-wrap').querySelector('[data-role="menu"]').focus();
  });
}

function closeMenus(listEl) {
  for (const menu of listEl.querySelectorAll('.menu:not([hidden])')) {
    menu.hidden = true;
    menu.closest('.more-wrap').querySelector('[data-role="menu"]').setAttribute('aria-expanded', 'false');
  }
}

function toggleMenu(listEl, row) {
  const menu = row.querySelector('.menu');
  const opening = menu.hidden;
  closeMenus(listEl);
  if (!opening) return;
  menu.hidden = false;
  row.querySelector('[data-role="menu"]').setAttribute('aria-expanded', 'true');
  menu.querySelector('button:not(:disabled)')?.focus();
}

function createRow(id) {
  const li = el('li', 'song');
  li.dataset.id = id;
  const name = el('button', 'name');
  name.type = 'button';
  name.dataset.role = 'name';
  const text = el('span', 'text');
  text.append(el('span', 't'), el('span', 'c'));
  name.append(el('span', 'thumb'), text);
  const stepper = el('div', 'stepper');
  const dec = el('button', null, '−');
  dec.type = 'button';
  dec.dataset.role = 'dec';
  dec.setAttribute('aria-label', 'Lower weight');
  const input = el('input');
  input.type = 'number';
  input.min = String(MIN_WEIGHT);
  input.max = String(MAX_WEIGHT);
  input.inputMode = 'numeric';
  input.id = `w-${id}`;
  input.dataset.role = 'weight';
  const inc = el('button', null, '+');
  inc.type = 'button';
  inc.dataset.role = 'inc';
  inc.setAttribute('aria-label', 'Raise weight');
  stepper.append(dec, input, inc);
  const wrap = el('div', 'more-wrap');
  const more = el('button', 'more', '⋯');
  more.type = 'button';
  more.dataset.role = 'menu';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  const menu = el('div', 'menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  for (const [role, label] of [['queue', 'Add to queue'], ['remove', 'Remove from playlist']]) {
    const item = el('button', null, label);
    item.type = 'button';
    item.dataset.role = role;
    item.setAttribute('role', 'menuitem');
    menu.append(item);
  }
  wrap.append(more, menu);
  li.append(name, stepper, wrap, el('div', 'stats'));
  return li;
}

// A grey 16:9 box until the thumbnail is known; the image loads only when scrolled near.
function setThumbnail(box, src) {
  const img = box.querySelector('img');
  if (!src) return img?.remove();
  if (img?.getAttribute('src') === src) return;
  const next = img ?? el('img');
  next.alt = '';
  next.loading = 'lazy';
  next.decoding = 'async';
  next.src = src;
  if (!img) box.append(next);
}

export function renderSongs(listEl, rows) {
  const existing = new Map([...listEl.children].map(li => [li.dataset.id, li]));
  rows.forEach((row, index) => {
    const li = existing.get(row.id) ?? createRow(row.id);
    existing.delete(row.id);
    li.classList.toggle('current', row.current);
    li.classList.toggle('blocked', row.blocked);
    li.querySelector('.name .t').textContent = row.title;
    li.querySelector('.name .c').textContent = row.author;
    setThumbnail(li.querySelector('.thumb'), row.thumbnail);
    li.querySelector('.name').setAttribute('aria-label', `Play ${row.title} now`);
    li.querySelector('.more').setAttribute('aria-label', `More options for ${row.title}`);
    li.querySelector('[data-role="queue"]').disabled = row.blocked;
    const input = li.querySelector('input');
    if (document.activeElement !== input || input.dataset.committed) {
      input.value = String(row.weight);
      delete input.dataset.committed;
    }
    input.setAttribute('aria-label', `Weight for ${row.title}`);
    li.querySelector('[data-role="dec"]').disabled = row.weight <= MIN_WEIGHT;
    li.querySelector('[data-role="inc"]').disabled = row.weight >= MAX_WEIGHT;

    const stats = li.querySelector('.stats');
    stats.replaceChildren();
    if (row.blocked) {
      stats.append(el('span', 'badge bad', "Can't play here"), el('span', null, "This video can't play here, so it's skipped."));
    } else {
      if (row.current) stats.append(el('span', 'badge now', 'Now'));
      const share = el('span', 'share');
      const bar = el('i');
      bar.style.width = `${(row.share * 100).toFixed(1)}%`;
      share.append(bar);
      stats.append(share, el('span', 'freq', row.freq));
    }

    // Only move rows that are out of place, so a focused weight box isn't disturbed.
    if (listEl.children[index] !== li) listEl.insertBefore(li, listEl.children[index] ?? null);
  });
  existing.forEach(li => li.remove());
}

export function flashRow(listEl, id) {
  const li = listEl.querySelector(`.song[data-id="${CSS.escape(id)}"]`);
  if (!li) return;
  li.classList.remove('moved');
  void li.offsetWidth;
  li.classList.add('moved');
}
