// Now playing, loop position, play/pause icon, and the end-of-loop buttons.
const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z';

export function setupEndModeButtons(groupEl, onChange) {
  let tipTimer;
  for (const button of groupEl.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      onChange(button.dataset.mode);
      // Touch screens have no hover, so a tap shows the tooltip for a moment.
      groupEl.querySelectorAll('button.is-tip').forEach(b => b.classList.remove('is-tip'));
      button.classList.add('is-tip');
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => button.classList.remove('is-tip'), 1500);
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


  for (const button of els.endMode.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === view.endMode));
  }
}
