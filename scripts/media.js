(() => {
  'use strict';
  function initializeVideos() {
    for (const [id, config] of Object.entries(window.REPLICA_MEDIA_CONFIG || {})) {
      const widget = document.querySelector(`.rmwidget[data-id="${id}"]`);
      if (!widget || widget.dataset.videoInitialized) continue;
      widget.dataset.videoInitialized = 'true';
      widget.tabIndex = 0;
      widget.setAttribute('role', 'button');
      widget.setAttribute('aria-label', 'Play video');
      widget.style.cursor = 'pointer';
      const preview = widget.querySelector('.react-player__preview');
      if (preview) {
        // This exported preview was below the source page's lazy-rendering boundary.
        preview.style.backgroundImage = `url("${config.poster}")`;
        preview.tabIndex = -1;
        widget.querySelector('img[alt="video thumbnail"]')?.parentElement.remove();
        const playIcon = document.querySelector('.video [aria-label="Play video"] svg');
        const playHolder = preview.querySelector('.react-player__shadow');
        if (playIcon && playHolder) {
          playHolder.replaceChildren(playIcon.cloneNode(true));
          Object.assign(playHolder.style, {width:'56px',height:'56px',background:'none'});
        }
      }
      let video;
      const play = () => {
        if (video) return;
        video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.poster = config.poster;
        video.preload = 'metadata';
        video.setAttribute('aria-label', 'Video');
        Object.assign(video.style, {width:'100%',height:'100%',display:'block',objectFit:'contain',backgroundColor:'#000'});
        widget.replaceChildren(video);
        widget.removeAttribute('role');
        widget.removeAttribute('tabindex');
        if (window.Hls?.isSupported()) {
          const hls = new window.Hls({ enableWorker: true });
          hls.loadSource(config.path);
          hls.attachMedia(video);
          hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
          hls.on(window.Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) widget.dataset.playbackError = data.details;
          });
          widget.replicaHls = hls;
          window.addEventListener('pagehide', () => hls.destroy(), {once:true});
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = config.path;
          video.play().catch(() => {});
        }
      };
      widget.addEventListener('click', play);
      widget.addEventListener('keydown', event => {
        if (!video && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          play();
        }
      });
    }
  }
  document.addEventListener('DOMContentLoaded', initializeVideos);
})();
