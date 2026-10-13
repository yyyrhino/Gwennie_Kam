/* Homepage image strip: browser-driven motion with explicit user controls. */
(() => {
  'use strict';
  window.initializeCoverCarousel = (track, settings) => {
    if (track.replicaCoverCarousel) return;
    const doc = track.ownerDocument;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const slides = Array.from(track.children).filter(child => child.matches('a[href]'))
      .sort((a, b) => parseFloat(a.firstElementChild.style.left) - parseFloat(b.firstElementChild.style.left));
    if (slides.length < 2) return;
    const positions = slides.map(slide => parseFloat(slide.firstElementChild.style.left));
    track.append(...slides);
    const duration = settings?.duration || 7500;
    const frame = doc.createElement('section');
    frame.className = 'cover-carousel';
    frame.setAttribute('aria-label', '精选作品 / Featured projects');
    frame.setAttribute('aria-roledescription', 'carousel');
    frame.style.cssText = `left:${track.style.left};top:${track.style.top};width:${slides[0].firstElementChild.style.width};height:${track.style.height};z-index:${track.style.zIndex}`;
    track.before(frame);
    frame.appendChild(track);
    track.style.left = '0px';
    track.style.top = '0px';
    track.style.offsetPath = 'none';
    track.style.animation = 'none';
    track.style.transform = 'translateX(0px)';
    slides.forEach((slide, index) => {
      slide.setAttribute('aria-label', `精选作品 ${index + 1} / ${slides.length}`);
    });

    // Keep the original holds and alternating movement; transform replaces motion-path.
    const autoplay = track.animate([
      {transform: `translateX(${-positions[0]}px)`, offset: 0},
      {transform: `translateX(${-positions[0]}px)`, offset: 1 / 15, easing: 'ease-in-out'},
      {transform: `translateX(${-positions[1]}px)`, offset: 7 / 15},
      {transform: `translateX(${-positions[1]}px)`, offset: 8 / 15, easing: 'ease-in-out'},
      {transform: `translateX(${-positions[2]}px)`, offset: 14 / 15},
      {transform: `translateX(${-positions[2]}px)`, offset: 1}
    ], {duration, iterations: Infinity, direction: 'alternate', fill: 'both'});
    autoplay.pause();
    autoplay.currentTime = 0;
    let manual = null;
    let manualIndex = null;
    let hovering = false;
    let focused = false;
    let movingFocus = false;
    let controlRect = null;
    let controlBoundsDirty = true;
    let lastPointer = null;
    let controlRefresh = 0;
    let gesture = null;
    let suppressClickUntil = 0;
    let wheelTotal = 0;
    let lastWheel = 0;
    let wheelLockedUntil = 0;
    let manualHoldUntil = 0;
    let resumeTimer = null;

    const status = doc.createElement('span');
    status.className = 'visually-hidden';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    frame.appendChild(status);

    function button(className, label, svg, handler) {
      const control = doc.createElement('button');
      control.type = 'button';
      control.className = `cover-control ${className}`;
      control.setAttribute('aria-label', label);
      control.title = label;
      control.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
      control.addEventListener('click', handler);
      frame.appendChild(control);
      return control;
    }

    function position() {
      if (manualIndex !== null) return positions[manualIndex];
      return -new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
    }

    function currentIndex() {
      const offset = position();
      return positions.reduce((closest, value, index) =>
        Math.abs(value - offset) < Math.abs(positions[closest] - offset) ? index : closest, 0);
    }

    function syncAutoplay() {
      const holdRemaining = manualHoldUntil - performance.now();
      if (holdRemaining > 0) {
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(syncAutoplay, Math.ceil(holdRemaining));
      }
      const paused = hovering || focused || motion.matches || doc.hidden || !!gesture || holdRemaining > 0;
      frame.dataset.autoplay = paused ? 'paused' : 'playing';
      if (paused) { autoplay.pause(); return; }
      if (manual) {
        manual.cancel();
        manual = null;
        autoplay.currentTime = duration * [0, 7 / 15, 14 / 15][manualIndex];
        manualIndex = null;
      }
      autoplay.play();
    }

    function goTo(index) {
      const next = (index + slides.length) % slides.length;
      // Read once per user action, never on pointer movement or animation frames.
      const from = getComputedStyle(track).transform;
      autoplay.pause();
      if (manual) manual.cancel();
      manualIndex = next;
      manualHoldUntil = performance.now() + 3500;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(syncAutoplay, 3500);
      manual = track.animate([{transform: from}, {transform: `translateX(${-positions[next]}px)`}],
        {duration: motion.matches ? 0 : 420, easing: 'ease-in-out', fill: 'forwards'});
      frame.dataset.currentIndex = String(next);
      status.textContent = `精选作品 ${next + 1} / ${slides.length}`;
      manual.onfinish = syncAutoplay;
      syncAutoplay();
    }

    function nextIndex(direction, wrap = true) {
      const offset = position();
      const candidate = direction > 0
        ? positions.findIndex(value => value > offset + 2)
        : positions.findLastIndex(value => value < offset - 2);
      if (candidate >= 0) return candidate;
      return wrap ? (direction > 0 ? 0 : slides.length - 1) : -1;
    }

    button('cover-previous', '上一张图片 / Previous image', '<path d="m14 5-7 7 7 7"/>', () => goTo(nextIndex(-1)));
    button('cover-next', '下一张图片 / Next image', '<path d="m10 5 7 7-7 7"/>', () => goTo(nextIndex(1)));
    function revealControls(event) {
      if (event.pointerType === 'touch') return;
      lastPointer = {clientX: event.clientX, clientY: event.clientY};
      if (controlBoundsDirty || !controlRect) {
        controlRect = frame.getBoundingClientRect();
        controlBoundsDirty = false;
      }
      const edge = Math.min(112, Math.max(68, controlRect.width * .12), controlRect.width / 2);
      const inside = event.clientX >= controlRect.left && event.clientX <= controlRect.right
        && event.clientY >= controlRect.top && event.clientY <= controlRect.bottom;
      const side = !inside ? '' : event.clientX < controlRect.left + edge ? 'previous'
        : event.clientX > controlRect.right - edge ? 'next' : '';
      if (frame.dataset.activeSide !== side) frame.dataset.activeSide = side;
    }

    function refreshControlBounds() {
      controlBoundsDirty = true;
      if (lastPointer && !controlRefresh) controlRefresh = requestAnimationFrame(() => {
        controlRefresh = 0;
        if (lastPointer) revealControls(lastPointer);
      });
    }

    frame.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      hovering = true;
      controlBoundsDirty = true;
      revealControls(event);
      syncAutoplay();
    });
    frame.addEventListener('pointermove', revealControls, {passive: true});
    frame.addEventListener('pointerleave', () => {
      hovering = false;
      lastPointer = null;
      frame.dataset.activeSide = '';
      wheelTotal = 0;
      syncAutoplay();
    });
    frame.addEventListener('focusin', event => {
      focused = true;
      syncAutoplay();
      const index = slides.indexOf(event.target.closest('a'));
      if (index >= 0 && !movingFocus) goTo(index);
    });
    frame.addEventListener('focusout', event => {
      if (event.relatedTarget && frame.contains(event.relatedTarget)) return;
      focused = false;
      syncAutoplay();
    });
    frame.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      let target;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        target = nextIndex(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.key === 'Home' || event.key === 'End') {
        target = event.key === 'Home' ? 0 : slides.length - 1;
      }
      if (target === undefined) return;
      event.preventDefault();
      goTo(target);
      if (slides.includes(event.target.closest('a'))) {
        movingFocus = true;
        slides[target].focus({preventScroll: true});
        movingFocus = false;
      }
    });
    // Only the image strip intercepts wheel gestures; zoom and page scrolling elsewhere stay native.
    frame.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey) return;
      const amount = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!amount) return;
      const candidate = nextIndex(Math.sign(amount), false);
      if (candidate < 0) return;
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      if (now < wheelLockedUntil) return;
      if (now - lastWheel > 220 || Math.sign(wheelTotal) !== Math.sign(amount)) wheelTotal = 0;
      lastWheel = now;
      wheelTotal += amount * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1);
      if (Math.abs(wheelTotal) < 50) return;
      wheelTotal = 0;
      wheelLockedUntil = now + 500;
      goTo(candidate);
    }, {passive: false});
    frame.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.pointerType === 'mouse' || event.target.closest('button')) return;
      lastPointer = null;
      frame.dataset.activeSide = '';
      gesture = {id: event.pointerId, x: event.clientX, y: event.clientY};
      syncAutoplay();
    });
    doc.addEventListener('pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      gesture = null;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        suppressClickUntil = performance.now() + 500;
        goTo(nextIndex(dx < 0 ? 1 : -1));
      } else syncAutoplay();
    });
    doc.addEventListener('pointercancel', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      gesture = null;
      syncAutoplay();
    });
    frame.addEventListener('click', event => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    doc.addEventListener('visibilitychange', syncAutoplay);
    window.addEventListener('resize', refreshControlBounds, {passive: true});
    doc.addEventListener('scroll', refreshControlBounds, {capture: true, passive: true});
    motion.addEventListener('change', syncAutoplay);
    syncAutoplay();
    frame.dataset.currentIndex = '0';
    track.replicaCoverCarousel = {goTo, next: () => goTo(nextIndex(1)), previous: () => goTo(nextIndex(-1)),
      get currentIndex() { return currentIndex(); }, get count() { return slides.length; }};
  };
})();
