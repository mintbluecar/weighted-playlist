// Now playing, loop position, play/pause icon, up next, and the end-of-loop buttons.
const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z';

export function setupEndModeButtons(groupEl, onChange) {
  let tipTimer;
  for (const button of groupEl.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      onChange(button.dataset.mode);
      // Touch screens have no hover, so a tap shows the tooltip for a moment.
      groupEl.querySelectorAll('button.tip').forEach(b => b.classList.remove('tip'));
      button.classList.add('tip');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => button.classList.remove('tip'), 1500);
    });
  }
}

export function renderPlayer(els, view) {
  els.nowTitle.textContent = view.title;
  els.nowChan.textContent = view.author;
  els.loopPos.textContent = view.loopText;
  els.playBtn.setAttribute('aria-label', view.playing ? 'Pause' : 'Play');
  els.playIcon.setAttribute('d', view.playing ? ICON_PAUSE : ICON_PLAY);
  els.videoEmpty.hidden = !view.showEmpty;
  els.videoEmpty.textContent = view.emptyText;

  const label = document.createElement('span');
  label.className = 'lbl';
  label.textContent = 'Up next';
  const chips = view.upcoming.map(title => {
    const chip = document.createElement('span');
    chip.className = title === null ? 'chip sep' : 'chip';
    chip.textContent = title === null ? 'new loop' : title;
    return chip;
  });
  els.upNext.replaceChildren(label, ...chips);
  els.upNext.hidden = chips.length === 0;

  for (const button of els.endMode.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === view.endMode));
  }
}
