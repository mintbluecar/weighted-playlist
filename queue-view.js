// The "Up next" box: the next plays, a divider where the next loop starts,
// ▲▼ to reorder within a loop, and tap a song to play it now (the songs it passed stay queued).
import { el, thumb } from './dom.js';

export function setupQueue(listEl, { onPlay, onMove }) {
  listEl.addEventListener('click', e => {
    const button = e.target.closest('button');
    const item = button?.closest('.qitem');
    if (!item) return;
    const where = item.dataset.where;
    const index = Number(item.dataset.index);
    if (button.dataset.dir) onMove(where, index, Number(button.dataset.dir));
    else if (button.classList.contains('qplay')) onPlay(where, index);
  });
}

// items: { type: 'song', id, where, index, number, title, author, thumbnail, canUp, canDown }
//      | { type: 'divider' } | { type: 'stop' }
export function renderQueue(listEl, items) {
  if (!items.length) {
    listEl.replaceChildren(el('li', 'qempty', 'Nothing queued yet.'));
    return;
  }
  listEl.replaceChildren(...items.map(item => {
    if (item.type === 'divider') return el('li', 'qdivider', 'New loop');
    if (item.type === 'stop') return el('li', 'qstop', 'Playback stops here.');

    const li = el('li', 'qitem');
    li.dataset.id = item.id;
    li.dataset.where = item.where;
    li.dataset.index = String(item.index);

    const play = el('button', 'qplay');
    play.type = 'button';
    play.setAttribute('aria-label', `Play ${item.title} now`);
    const text = el('span', 'text');
    text.append(el('span', 't', item.title), el('span', 'c', item.author));
    play.append(el('span', 'qnum', String(item.number)), thumb(item.thumbnail), text);

    const move = el('span', 'qmove');
    for (const [dir, label, glyph, enabled] of [[-1, 'Move up', '▲', item.canUp], [1, 'Move down', '▼', item.canDown]]) {
      const b = el('button', null, glyph);
      b.type = 'button';
      b.dataset.dir = String(dir);
      b.disabled = !enabled;
      b.setAttribute('aria-label', `${label}: ${item.title}`);
      move.append(b);
    }
    li.append(play, move);
    return li;
  }));
}
