// Small helpers that make the camera UI feel smooth instead of twitchy:
// a face box that glides and fades, and hints that don't flicker.

const lerp = (a, b, t) => a + (b - a) * t;

// Face box that eases toward the detected position each frame and fades in
// and out, instead of jumping around with every detection.
export function createSmoothBox(overlay) {
  let box = null; // { x, y, w, h }
  let alpha = 0;
  let progress = 0;

  return {
    // target: a MediaPipe bounding box or null. hold: 0–1 fill of the outline.
    // ready: whether the face passes all checks.
    draw(target, { hold = 0, ready = false, before } = {}) {
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      before?.(ctx);

      if (target) {
        const t = { x: target.originX, y: target.originY, w: target.width, h: target.height };
        box = box
          ? { x: lerp(box.x, t.x, 0.3), y: lerp(box.y, t.y, 0.3), w: lerp(box.w, t.w, 0.3), h: lerp(box.h, t.h, 0.3) }
          : t;
      }
      alpha = lerp(alpha, target ? 1 : 0, 0.2);
      progress = lerp(progress, hold, 0.35);
      if (!box || alpha < 0.02) return;

      const lineWidth = Math.max(2, overlay.width / 240);
      const radius = Math.min(box.w, box.h) * 0.24;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';

      // Faint full outline…
      ctx.strokeStyle = ready ? 'rgba(127, 191, 127, 0.35)' : 'rgba(255, 255, 255, 0.25)';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, radius);
      ctx.stroke();

      // …that fills in with color as the person holds still.
      if (progress > 0.01) {
        const perimeter = 2 * (box.w + box.h);
        ctx.strokeStyle = '#7fbf7f';
        ctx.lineWidth = lineWidth * 1.6;
        ctx.setLineDash([perimeter * progress, perimeter]);
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, radius);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    },

    reset() {
      box = null;
      alpha = 0;
      progress = 0;
    }
  };
}

// Hint pill that only changes once a new message has been true for a moment,
// and fades between messages.
export function createHint(el, { settleMs = 300 } = {}) {
  let shown = '';
  let pending = '';
  let pendingSince = 0;
  let fadeTimer = null;

  function show(text, ready) {
    shown = text;
    clearTimeout(fadeTimer);
    if (!text) {
      el.classList.add('fading');
      fadeTimer = setTimeout(() => (el.hidden = true), 200);
      return;
    }
    el.hidden = false;
    el.classList.add('fading');
    fadeTimer = setTimeout(() => {
      el.textContent = text;
      el.classList.toggle('ready', ready);
      el.classList.remove('fading');
    }, el.textContent ? 150 : 0);
  }

  return {
    // Call every frame with the current message; changes are debounced.
    set(text, ready = false, now = performance.now()) {
      if (text === shown) {
        el.classList.toggle('ready', ready);
        pending = text;
        return;
      }
      if (text !== pending) {
        pending = text;
        pendingSince = now;
      }
      // Show the first message immediately; later ones once they've settled.
      if (!shown || now - pendingSince >= settleMs) show(text, ready);
    },

    // Change right away (e.g. "Starting camera…").
    now(text, ready = false) {
      pending = text;
      show(text, ready);
    }
  };
}

// Quick white flash over the camera, like a shutter.
export function flash(scanner) {
  scanner.classList.remove('flash');
  void scanner.offsetWidth; // restart the animation
  scanner.classList.add('flash');
}
