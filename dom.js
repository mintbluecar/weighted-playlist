// Small DOM helpers shared by the views. Text always goes in through textContent, never innerHTML.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function button(label, className, ariaLabel) {
  const b = el('button', className, label);
  b.type = 'button';
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  return b;
}

// A 16:9 thumbnail box; the image (if any) loads lazily.
export function thumb(src) {
  const box = el('span', 'thumb');
  if (src) {
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = src;
    box.append(img);
  }
  return box;
}

// A status box with a message, optional buttons and a × to dismiss.
// Success notes (kind 'ok') hide themselves after okMs; errors and questions stay until dismissed.
// actions: [{ label, primary?, onClick }] — clicking one hides the note, then runs onClick.
export function createNotice(box, { okMs = 4000 } = {}) {
  let timer = null;

  function hide() {
    clearTimeout(timer);
    box.hidden = true;
  }

  function show(message, kind = '', actions = []) {
    clearTimeout(timer);
    if (kind === 'ok') timer = setTimeout(hide, okMs);
    box.className = `status ${kind}`.trim();
    box.replaceChildren(el('span', null, message));
    if (actions.length) {
      const choice = el('span', 'choice');
      for (const action of actions) {
        const b = button(action.label, action.primary ? 'btn primary' : 'btn');
        b.addEventListener('click', () => {
          hide();
          action.onClick();
        });
        choice.append(b);
      }
      box.append(choice);
    }
    const close = button('×', 'close', 'Dismiss');
    close.addEventListener('click', hide);
    box.append(close);
    box.hidden = false;
  }

  return { show, hide };
}
