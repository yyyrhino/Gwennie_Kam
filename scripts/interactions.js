/* Native interactions for the exported Readymag markup. No runtime dependency. */
(() => {
  'use strict';

  const initializedSlideshows = new WeakSet();
  const initializedAnimations = new WeakSet();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function matchingElements(root, selector) {
    const elements = Array.from(root.querySelectorAll(selector));
    if (root.matches && root.matches(selector)) elements.unshift(root);
    return elements;
  }

  function animationSettings(container, type) {
    const configuration = window.REPLICA_ANIMATION_CONFIG;
    if (!configuration) return null;
    for (const widget of container.querySelectorAll('.rmwidget[data-id]')) {
      const settings = (configuration.widgets[widget.dataset.id] || []).find(animation => animation.type === type);
      if (settings) return settings;
    }
    return null;
  }

  function makeButton(element, label, handler) {
    if (!element) return;
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', label);
    element.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      handler();
    });
    element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      handler();
    });
  }

  function addFullscreenStyles(doc) {
    if (doc.getElementById('replica-fullscreen-styles')) return;
    const style = doc.createElement('style');
    style.id = 'replica-fullscreen-styles';
    style.textContent = `
      .widget-slideshow:fullscreen { left:0!important; top:0!important; width:100vw!important; height:100vh!important; background:#000; zoom:1!important; transform:none!important; }
      .widget-slideshow:fullscreen .common-slideshow { width:100%; height:100%; }
      .widget-slideshow:fullscreen .images { height:100%!important; }
      .widget-slideshow:fullscreen .images-wrapper { width:100%!important; left:0!important; }
      .widget-slideshow:fullscreen .images-wrapper .image { width:100%!important; left:0!important; background-size:contain!important; }
      .widget-slideshow:fullscreen .fullscreen-off { visibility:hidden!important; }
      .widget-slideshow:fullscreen .fullscreen-on { visibility:visible!important; }
      .widget-slideshow:fullscreen .fullscreen { opacity:1!important; }
    `;
    doc.head.appendChild(style);
  }

  function initializeSlideshow(widget) {
    if (initializedSlideshows.has(widget)) return;
    const wrapper = widget.querySelector('.images-wrapper');
    if (!wrapper) return;
    const allSlides = Array.from(wrapper.children).filter(child => child.classList.contains('image'));
    const slides = allSlides.filter(slide => !slide.hasAttribute('data-faked'));
    if (!slides.length) return;
    initializedSlideshows.add(widget);

    // Runtime-only clones are excluded from both navigation and the slide count.
    allSlides.filter(slide => slide.hasAttribute('data-faked')).forEach(slide => {
      slide.style.display = 'none';
      slide.setAttribute('aria-hidden', 'true');
    });

    const doc = widget.ownerDocument;
    // A fresh page starts at the first real image; an export can catch a later autoplay frame.
    let index = 0;
    let gesture = null;
    let suppressClickUntil = 0;
    let autoplayTimer = null;
    const configuredSlideshow = window.REPLICA_ANIMATION_CONFIG && window.REPLICA_ANIMATION_CONFIG.slideshows[widget.dataset.id];
    const autoplay = configuredSlideshow && configuredSlideshow.method === 'autoplay' ? configuredSlideshow : null;
    let autoplayPaused = false;
    const dotsContainer = widget.querySelector('.counters-dots .items');
    let dots = [];

    function ensureImage(slide) {
      if (slide.dataset.src && (!slide.style.backgroundImage || slide.style.backgroundImage === 'none')) {
        slide.style.backgroundImage = `url(${JSON.stringify(slide.dataset.src)})`;
      }
    }

    function render(announce = false) {
      slides.forEach((slide, slideIndex) => {
        const active = slideIndex === index;
        slide.classList.remove('hidden', 'prev-image', 'next-image');
        slide.classList.add('neighbour');
        slide.classList.toggle('center-image', active);
        slide.style.display = 'block';
        slide.style.visibility = 'visible';
        slide.style.opacity = active ? '1' : '0';
        slide.style.pointerEvents = active ? 'auto' : 'none';
        slide.setAttribute('aria-hidden', String(!active));
        if (!slide.getAttribute('aria-label')) slide.setAttribute('aria-label', `Image ${slideIndex + 1} of ${slides.length}`);
      });
      ensureImage(slides[index]);
      ensureImage(slides[(index + 1) % slides.length]);
      ensureImage(slides[(index + slides.length - 1) % slides.length]);
      widget.querySelectorAll('.counters-text-current').forEach(counter => { counter.textContent = String(index + 1); });
      widget.querySelectorAll('.counters-text-total').forEach(counter => { counter.textContent = String(slides.length); });
      dots.forEach((dot, dotIndex) => {
        dot.classList.toggle('active', dotIndex === index);
        dot.setAttribute('aria-current', dotIndex === index ? 'true' : 'false');
      });
      widget.dataset.currentIndex = String(index);
      if (announce) widget.dispatchEvent(new CustomEvent('replica:slidechange', { detail: { index, count: slides.length } }));
    }

    function goTo(newIndex) {
      if (!Number.isFinite(newIndex)) return;
      const nextIndex = ((Math.trunc(newIndex) % slides.length) + slides.length) % slides.length;
      if (nextIndex === index) return;
      index = nextIndex;
      render(true);
      scheduleAutoplay();
    }

    function scheduleAutoplay() {
      clearTimeout(autoplayTimer);
      if (!autoplay || slides.length < 2 || reducedMotion.matches || autoplayPaused || doc.hidden || !widget.isConnected) return;
      autoplayTimer = setTimeout(() => goTo(index + 1), autoplay.delay + autoplay.transition);
    }

    function toggleFullscreen() {
      if (doc.fullscreenElement) {
        if (doc.exitFullscreen) Promise.resolve(doc.exitFullscreen()).catch(() => {});
      } else if (widget.requestFullscreen) {
        Promise.resolve(widget.requestFullscreen()).catch(() => {});
      }
    }

    // Keep every exported control's display state and its original SVG artwork.
    widget.querySelectorAll('.prev-picture-arrow-middle, .prev-picture-arrow-bottom').forEach(control => {
      makeButton(control, 'Previous slide', () => goTo(index - 1));
      control.setAttribute('aria-disabled', String(slides.length < 2));
    });
    widget.querySelectorAll('.next-picture-arrow-middle, .next-picture-arrow-bottom').forEach(control => {
      makeButton(control, 'Next slide', () => goTo(index + 1));
      control.setAttribute('aria-disabled', String(slides.length < 2));
    });
    const fullscreen = widget.querySelector('.fullscreen');
    makeButton(fullscreen, 'View slideshow fullscreen', toggleFullscreen);
    if (fullscreen) {
      addFullscreenStyles(doc);
      doc.addEventListener('fullscreenchange', () => {
        const isFullscreen = doc.fullscreenElement === widget;
        fullscreen.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'View slideshow fullscreen');
        fullscreen.setAttribute('aria-pressed', String(isFullscreen));
      });
    }

    if (dotsContainer) {
      // The source may contain an empty dots track. Use Readymag's existing counter styling.
      dotsContainer.replaceChildren();
      dotsContainer.style.width = `${slides.length * 14}px`;
      dots = slides.map((slide, dotIndex) => {
        const dot = doc.createElement('div');
        dot.className = 'counter';
        dot.style.left = `${dotIndex * 14}px`;
        makeButton(dot, `Go to slide ${dotIndex + 1}`, () => goTo(dotIndex));
        dotsContainer.appendChild(dot);
        return dot;
      });
    }

    widget.setAttribute('role', 'region');
    widget.setAttribute('aria-roledescription', 'carousel');
    if (!widget.getAttribute('aria-label')) widget.setAttribute('aria-label', 'Image slideshow');
    if (slides.length > 1) {
      widget.setAttribute('tabindex', '0');
      wrapper.style.touchAction = 'pan-y';
      widget.addEventListener('keydown', event => {
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          goTo(index + (event.key === 'ArrowRight' ? 1 : -1));
        } else if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          toggleFullscreen();
        }
      });
      wrapper.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.pointerType === 'mouse') return;
        gesture = { x: event.clientX, y: event.clientY, id: event.pointerId };
      });
      wrapper.addEventListener('pointerup', event => {
        if (!gesture || event.pointerId !== gesture.id) return;
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        gesture = null;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        suppressClickUntil = performance.now() + 400;
        goTo(index + (dx < 0 ? 1 : -1));
      });
      wrapper.addEventListener('pointercancel', () => { gesture = null; });
      wrapper.addEventListener('click', event => {
        if (performance.now() < suppressClickUntil) return;
        if (event.target.closest('a, button, [role="button"]')) return;
        const rect = wrapper.getBoundingClientRect();
        goTo(index + (event.clientX < rect.left + rect.width / 2 ? -1 : 1));
      });
    }
    render();
    // Enable the source's crossfade only after restoring its initial center slide.
    requestAnimationFrame(() => { if (!reducedMotion.matches) wrapper.classList.add('enable-transitions'); });
    if (autoplay) {
      widget.addEventListener('focusin', () => { autoplayPaused = true; clearTimeout(autoplayTimer); });
      widget.addEventListener('focusout', event => {
        if (event.relatedTarget && widget.contains(event.relatedTarget)) return;
        autoplayPaused = false;
        scheduleAutoplay();
      });
      doc.addEventListener('visibilitychange', scheduleAutoplay);
      if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', scheduleAutoplay);
      // The first frame has no preceding crossfade, so its initial hold is two seconds.
      if (!reducedMotion.matches && !doc.hidden) autoplayTimer = setTimeout(() => goTo(index + 1), autoplay.delay);
    }
    widget.replicaSlideshow = {
      next: () => goTo(index + 1),
      previous: () => goTo(index - 1),
      goTo,
      get currentIndex() { return index; },
      get count() { return slides.length; }
    };
  }

  function initializeHover(container, style, name, settings) {
    // Decorative text and masks must not intercept the cover's original link.
    // Linked children opt back into hit testing, including links inside text widgets.
    container.style.pointerEvents = 'none';
    container.querySelectorAll('.rmwidget').forEach(widget => {
      const linked = !!widget.closest('a[href]');
      widget.style.pointerEvents = linked ? 'auto' : 'none';
      // The exported text CSS sets pointer-events:all on paragraphs explicitly.
      // Override descendants as well, while retaining any real nested links.
      widget.querySelectorAll('*').forEach(child => {
        child.style.pointerEvents = linked || child.closest('a[href]') ? 'auto' : 'none';
      });
    });
    let rules;
    try {
      const keyframesRule = Array.from(style.sheet.cssRules).find(rule => rule.name === name);
      rules = keyframesRule && Array.from(keyframesRule.cssRules);
    } catch (_) { return; }
    if (!rules || !container.animate) return;
    const frames = rules.flatMap(rule => rule.keyText.split(',').map(key => {
      const frame = { offset: parseFloat(key) / 100 };
      ['transform', 'opacity', 'offset-distance'].forEach(property => {
        const value = rule.style.getPropertyValue(property);
        if (value) frame[property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      });
      return frame;
    })).sort((a, b) => a.offset - b.offset);
    if (!frames.length) return;
    const instagram = !!container.querySelector('.widget-picture.has-onhover-animation');
    const duration = settings && settings.duration || (instagram ? 200 : 500);
    let animation = null;
    const hovered = new Set();
    const focused = new Set();
    let active = false;
    function update() {
      const next = hovered.size > 0 || focused.size > 0;
      if (next === active) return;
      active = next;
      if (!animation) {
        animation = container.animate(frames, { duration, fill: 'both', easing: settings && settings.easing || 'ease-in-out' });
        animation.pause();
        animation.currentTime = 0;
      }
      if (reducedMotion.matches) {
        animation.currentTime = active ? duration : 0;
        animation.pause();
      } else {
        animation.playbackRate = active ? 1 : -1;
        animation.play();
      }
    }
    let triggers = [container];
    if (settings && settings.trigger.length) {
      const canvas = container.closest('.page-content-container') || container.ownerDocument;
      const configuredTriggers = settings.trigger.map(id => canvas.querySelector(`.rmwidget[data-id="${id}"]`)).filter(Boolean).map(widget => {
        return widget.closest('.animation-container') || widget.closest('a') || widget;
      });
      if (configuredTriggers.length) triggers = Array.from(new Set(configuredTriggers));
    }
    const line = container.querySelector('.widget-shape.has-onhover-animation svg path');
    if (line && parseFloat(container.style.top) < 80) {
      // The source's navigation line is a sibling of the buttons that trigger it.
      const center = parseFloat(container.style.left) + parseFloat(container.style.width) / 2;
      const canvas = container.closest('.page-content-container');
      if (canvas && !(settings && settings.trigger.length)) {
        triggers = Array.from(canvas.querySelectorAll('.widget-button')).filter(button => {
          const buttonCenter = parseFloat(button.style.left) + parseFloat(button.style.width) / 2;
          return parseFloat(button.style.top) < 80 && Math.abs(center - buttonCenter) < 12;
        }).map(button => button.closest('a') || button);
      }
      container.style.pointerEvents = 'none';
    }
    triggers.forEach(trigger => {
      trigger.addEventListener('pointerenter', () => { hovered.add(trigger); update(); });
      trigger.addEventListener('pointerleave', () => { hovered.delete(trigger); update(); });
      trigger.addEventListener('focusin', () => { focused.add(trigger); update(); });
      trigger.addEventListener('focusout', event => {
        if (event.relatedTarget && trigger.contains(event.relatedTarget)) return;
        focused.delete(trigger);
        update();
      });
    });
    if (!container.querySelector('a[href]')) {
      // Some exported masks have no link at all. Track their visible bounds from
      // the canvas so the mask still reacts while clicks reach the picture below.
      const canvas = container.closest('.page-content-container');
      if (canvas) {
        const isInside = (x, y) => {
          const rect = container.getBoundingClientRect();
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        };
        canvas.addEventListener('pointermove', event => {
          if (isInside(event.clientX, event.clientY)) hovered.add(canvas);
          else hovered.delete(canvas);
          update();
        });
        canvas.addEventListener('pointerleave', () => { hovered.delete(canvas); update(); });
        canvas.addEventListener('focusin', event => {
          const link = event.target.closest('a[href]');
          const widget = link && link.querySelector('.rmwidget');
          const rect = widget && widget.getBoundingClientRect();
          if (rect && isInside(rect.left + rect.width / 2, rect.top + rect.height / 2)) focused.add(canvas);
          else focused.delete(canvas);
          update();
        });
        canvas.addEventListener('focusout', () => { focused.delete(canvas); update(); });
      }
    }
  }

  function initializeAnimation(container) {
    if (initializedAnimations.has(container)) return;
    const style = Array.from(container.children).find(child => child.tagName === 'STYLE');
    const match = style && style.textContent.match(/@keyframes\s+([\w-]+)/);
    if (!match) return;
    initializedAnimations.add(container);
    const name = match[1];
    const hoverSettings = animationSettings(container, 'hover');
    const loadSettings = animationSettings(container, 'load');
    const isCoverCarousel = name === 'animation_7_1' && parseFloat(container.style.width) > 3000;
    const isHoverOnly = (hoverSettings || container.querySelector('.has-onhover-animation')) && !isCoverCarousel && !loadSettings;
    if (isHoverOnly) {
      initializeHover(container, style, name, hoverSettings);
      return;
    }
    if (isCoverCarousel) {
      const updateMotion = () => {
        const duration = loadSettings && loadSettings.duration / 1000 || 7.5;
        container.style.animation = reducedMotion.matches ? 'none' : `${name} ${duration}s infinite alternate`;
        if (reducedMotion.matches) container.style.offsetDistance = '0px';
      };
      updateMotion();
      if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', updateMotion);
      return;
    }
    // Snapshots taken while the source was still loading retain initial transforms.
    // Play their supplied keyframes, then retain the final position and opacity.
    const duration = loadSettings && loadSettings.duration / 1000 || 2;
    container.style.animation = `${name} ${reducedMotion.matches ? '0.001s' : `${duration}s`} 1 forwards`;
  }

  window.initializeReplicaInteractions = function initializeReplicaInteractions(root = document) {
    if (!root || !root.querySelectorAll) return;
    matchingElements(root, 'img.viewable').forEach(image => { image.style.opacity = '1'; });
    matchingElements(root, '.widget-slideshow').forEach(initializeSlideshow);
    matchingElements(root, '.animation-container').forEach(initializeAnimation);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.initializeReplicaInteractions(), { once: true });
  } else {
    window.initializeReplicaInteractions();
  }
})();
