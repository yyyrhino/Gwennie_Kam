(() => {
  'use strict';
  const config = window.REPLICA_PAGE;
  if (!config) return;
  function layout() {
    const article = document.querySelector('article.page');
    const content = article?.querySelector('.page-content-container');
    const bounds = article?.querySelector('.content-bounds');
    if (!content || !bounds) return;
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const zoom = width / config.designWidth;
    document.documentElement.style.setProperty('--replica-zoom', String(zoom));
    const scaledHeight = config.height * zoom;
    const offset = Math.max(0, (height - scaledHeight) / (2 * zoom));
    content.style.width = config.canvasWidth + 'px';
    content.style.height = config.height + 'px';
    content.style.zoom = String(zoom);
    content.style.left = (config.designWidth - config.canvasWidth) / 2 + 'px';
    content.style.top = offset + 'px';
    bounds.style.width = width + 'px';
    bounds.style.height = Math.max(height, scaledHeight) + 'px';
    article.querySelectorAll('.page-fixed-bg-container .widget-background').forEach(background => {
      background.style.width = width + 'px';
      background.style.height = height + 'px';
    });
  }
  function ready() {
    layout();
    document.querySelectorAll('a.back-to-top').forEach(link => {
      link.addEventListener('click', event => {
        const target = new URL(link.href, location.href);
        if (target.pathname === location.pathname) {
          event.preventDefault();
          document.querySelector('.content-scroll-wrapper')?.scrollTo({top:0, behavior:'smooth'});
        }
      });
    });
  }
  window.addEventListener('resize', layout);
  document.addEventListener('DOMContentLoaded', ready);
})();
