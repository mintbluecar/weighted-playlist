// Draws the pen: creatures hatch, wander, grow, shrink back, poof or walk out,
// following the events from crew.js. Movement stops while playback is paused.
import { creatureFor, CREATURES, PEN_LIMIT } from './crew.js';

const LANES = [4, 12, 20];              // three depths, so creatures overlap less
const NOTES = ['♪', '♫', '♩', '♬'];
const WALK_SPEED = 26;                  // px per second for a 36 px creature; bigger ones walk slower
const SCALE = 1.15;
const VISITOR_SIZE = 22;                // visitors are a little smaller than a first-play creature (26)
const VISITOR_TIP = 'Play a song to build your own crew';                     // Kenney frames have some empty space around the creature

export class CrewView {
  // Sprite files are found relative to this script, so any page that uses the crew can show them.
  constructor({ yard, empty, count, crew, titleFor, assetBase = new URL('./assets/kenney/', import.meta.url).href }) {
    this.yard = yard;
    this.empty = empty;
    this.count = count;
    this.crew = crew;
    this.titleFor = titleFor;
    this.assetBase = assetBase;
    this.sprites = new Map();
    this.current = null;
    this.paused = true;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.lastFrame = performance.now();
    yard.classList.add('paused');
    // Phones have no hover: tap a creature to show its play count for a moment.
    yard.addEventListener('click', e => this.#showTip(e.target.closest('.cr')));
    requestAnimationFrame(now => this.#frame(now));
  }

  // An empty pen gets 4–6 visitors: different creature types in random colours,
  // with no song attached. They walk out when the first real creature hatches.
  showVisitors(songIds) {
    if (this.visitorsShown || !songIds.length || this.sprites.size) return;
    this.visitorsShown = true;
    // Different creature types, in random colours.
    const models = [...CREATURES].sort(() => Math.random() - 0.5).slice(0, 4 + Math.floor(Math.random() * 3));
    models.forEach((model, i) => {
      const variant = model.variants[Math.floor(Math.random() * model.variants.length)];
      this.#spawn(`visitor:${i}`, { model, variant }, true);
    });
    this.#renderHead();
  }

  apply(events) {
    for (const { type, id } of events) {
      if (type === 'hatch') {
        this.#dismissVisitors();
        this.#hatch(id);
      }
      else if (type === 'evolve') this.#evolve(id);
      else if (type === 'count') this.#updateTip(id);
      else if (type === 'shrink') this.#shrink(id);
      else if (type === 'poof') this.#poof(id);
      else if (type === 'leave') this.#leave(id);
    }
    this.#renderHead();
  }

  setCurrent(id) {
    this.current = id;
  }

  setPaused(paused) {
    this.paused = paused;
    this.yard.classList.toggle('paused', paused);
  }

  refreshTitles() {
    for (const [id, sprite] of this.sprites) {
      if (sprite.visitor) continue;
      const title = this.titleFor(id);
      if (sprite.tag.textContent !== title) {
        sprite.tag.textContent = title;
        this.#updateTip(id);
      }
    }
  }

  #hatch(id) {
    this.sprites.get(id)?.el.remove(); // a creature still walking out gets replaced
    this.#spawn(id, creatureFor(id), false);
  }

  #dismissVisitors() {
    for (const [key, sprite] of this.sprites) {
      if (!sprite.visitor || sprite.leaving) continue;
      sprite.el.classList.add('leaving');
      this.#leave(key);
    }
  }

  // Build a creature: a real one (song tag, play-count tooltip) or a visitor (no tag, fixed tooltip).
  #spawn(key, { model, variant }, visitor) {
    const el = document.createElement('div');
    el.className = ['cr', 'hatching', model.move === 'fly' && 'floaty', visitor && 'visitor'].filter(Boolean).join(' ');
    el.dataset.model = model.name;
    const body = document.createElement('div');
    body.className = 'body';
    const shadow = document.createElement('span');
    shadow.className = 'shadow';
    const flip = document.createElement('div');
    flip.className = 'flip';
    const frames = document.createElement('div');
    frames.className = `kn ${model.move}`;
    if (variant.hue) frames.style.filter = `hue-rotate(${variant.hue}deg)`;
    for (const frame of ['idle', 'a', 'b']) {
      const img = document.createElement('img');
      img.className = `fr f-${frame}`;
      img.src = this.assetBase + variant.frames[frame];
      img.alt = '';
      img.draggable = false;
      frames.append(img);
    }
    flip.append(frames);
    body.append(shadow, flip);
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    let tag = null;
    if (visitor) {
      tip.textContent = VISITOR_TIP;
      el.append(body, tip);
    } else {
      tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = this.titleFor(key);
      el.append(body, tag, tip);
    }
    const lane = Math.floor(Math.random() * LANES.length);
    el.style.bottom = `${LANES[lane]}px`;
    el.style.zIndex = String(10 - lane);
    this.yard.append(el);

    const size = (visitor ? VISITOR_SIZE : this.crew.sizeOf(key)) * SCALE;
    this.sprites.set(key, {
      el, body, flip, tag, tip, size, visitor,
      x: this.yard.clientWidth ? Math.random() * Math.max(0, this.yard.clientWidth - size) : null, // placed when the pen is visible
      dir: Math.random() < 0.5 ? -1 : 1,
      mode: 'idle',
      t: 0.8,
      leaving: false,
      face: model.face,
      noteAt: 0,
    });
    this.#size(key);
    this.#updateTip(key);
    setTimeout(() => el.classList.remove('hatching'), 700);
  }

  #evolve(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return this.#hatch(id);
    sprite.el.classList.remove('evolving');
    void sprite.el.offsetWidth;
    sprite.el.classList.add('evolving');
    for (let i = 0; i < 10; i++) {
      const spark = document.createElement('span');
      spark.className = 'spark';
      spark.textContent = i % 2 ? '✦' : '✧';
      const angle = (i / 10) * Math.PI * 2;
      spark.style.setProperty('--dx', `${Math.cos(angle) * 42}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * 34 - 10}px`);
      sprite.body.append(spark);
      setTimeout(() => spark.remove(), 1000);
    }
    setTimeout(() => this.#size(id), 450); // grow at the brightest point of the flash
    setTimeout(() => sprite.el.classList.remove('evolving'), 1100);
  }

  #shrink(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    this.#size(id);
    sprite.el.classList.add('shrink');
    setTimeout(() => sprite.el.classList.remove('shrink'), 500);
  }

  #poof(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    this.sprites.delete(id);
    sprite.el.classList.add('poof');
    setTimeout(() => sprite.el.remove(), 450);
  }

  #leave(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    if (this.reducedMotion) {
      sprite.el.remove();
      this.sprites.delete(id);
      return;
    }
    sprite.leaving = true;
    sprite.dir = sprite.x < this.yard.clientWidth / 2 ? -1 : 1;
  }

  #size(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    sprite.size = (sprite.visitor ? VISITOR_SIZE : this.crew.sizeOf(id)) * SCALE;
    sprite.body.style.width = `${sprite.size}px`;
    sprite.body.style.height = `${sprite.size}px`;
  }

  #updateTip(id) {
    const sprite = this.sprites.get(id);
    if (!sprite || sprite.visitor) return;
    const n = this.crew.plays(id);
    const title = document.createElement('b');
    title.textContent = this.titleFor(id);
    sprite.tip.replaceChildren(title, `Played ${n} ${n === 1 ? 'time' : 'times'}`);
  }

  #showTip(el) {
    if (!el) return;
    this.yard.querySelectorAll('.cr.show').forEach(other => other !== el && other.classList.remove('show'));
    el.classList.add('show');
    clearTimeout(el.tipTimer);
    el.tipTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  #renderHead() {
    this.count.textContent = this.crew.isFull ? `Your top ${PEN_LIMIT} songs` : '';
    this.empty.hidden = this.sprites.size > 0;
  }

  #frame(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const width = this.yard.clientWidth;
    for (const [id, sprite] of this.sprites) {
      if (!width) continue; // pen collapsed: nothing to lay out
      if (sprite.x === null) sprite.x = Math.random() * Math.max(0, width - sprite.size);
      const isCurrent = id === this.current && !sprite.leaving;
      sprite.el.classList.toggle('current', isCurrent);
      if ((!this.paused || sprite.visitor) && !this.reducedMotion) { // visitors aren't crew: they wander even when paused
        if (!sprite.leaving) {
          sprite.t -= dt;
          if (sprite.t <= 0) {
            if (sprite.mode === 'walk') {
              sprite.mode = 'idle';
              sprite.t = 1 + Math.random() * 2.5;
            } else {
              sprite.mode = 'walk';
              sprite.t = 2 + Math.random() * 4;
              if (Math.random() < 0.4) sprite.dir *= -1;
            }
          }
        }
        if (sprite.mode === 'walk' || sprite.leaving) {
          sprite.x += sprite.dir * (WALK_SPEED / Math.sqrt(sprite.size / 36)) * dt;
          if (sprite.leaving) {
            if (sprite.x < -sprite.size - 100 || sprite.x > width + 100) {
              sprite.el.remove();
              this.sprites.delete(id);
              this.#renderHead();
              continue;
            }
          } else if (sprite.x < 0) {
            sprite.x = 0;
            sprite.dir = 1;
          } else if (sprite.x > width - sprite.size) {
            sprite.x = Math.max(0, width - sprite.size);
            sprite.dir = -1;
          }
        }
        if (isCurrent && now - sprite.noteAt > 520) {
          sprite.noteAt = now;
          this.#note(sprite);
        }
      }
      sprite.el.classList.toggle('walk', sprite.mode === 'walk' || sprite.leaving);
      sprite.flip.classList.toggle('left', sprite.face === 'left' ? sprite.dir > 0 : sprite.dir < 0);
      sprite.el.style.left = `${sprite.x + sprite.size / 2}px`;
    }
    requestAnimationFrame(t => this.#frame(t));
  }

  #note(sprite) {
    const note = document.createElement('span');
    note.className = 'note-fx';
    note.textContent = NOTES[Math.floor(Math.random() * NOTES.length)];
    note.style.left = `${15 + Math.random() * 70}%`;
    note.style.setProperty('--drift', `${Math.random() * 30 - 15}px`);
    sprite.body.append(note);
    setTimeout(() => note.remove(), 1600);
  }
}
