export function createReviewPlayer(video, PlyrConstructor) {
  try {
    if (typeof PlyrConstructor !== 'function') throw new Error('Plyr unavailable');
    const plyr = new PlyrConstructor(video, {
      ratio: null,
      iconUrl: '/vendor/plyr.svg',
      keyboard: { focused: false, global: false },
      controls: [
        'play-large', 'play', 'progress', 'current-time', 'duration',
        'mute', 'volume', 'settings', 'pip', 'fullscreen'
      ],
      settings: ['speed'],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] }
    });

    return {
      kind: 'plyr',
      get media() { return plyr.media ?? video; },
      get paused() { return plyr.paused; },
      onLoadedMetadata: (listener) => plyr.on('loadedmetadata', listener),
      play: () => plyr.play(),
      pause: () => plyr.pause(),
      setSource(source) {
        plyr.source = {
          type: 'video',
          title: source.title,
          sources: [{ src: source.src, type: source.type }]
        };
      },
      clearSource() {
        plyr.stop();
        clearNativeSource(video);
      },
      destroy: () => plyr.destroy()
    };
  } catch {
    return createNativePlayer(video);
  }
}

function createNativePlayer(video) {
  return {
    kind: 'native',
    media: video,
    get paused() { return video.paused; },
    onLoadedMetadata: (listener) => video.addEventListener('loadedmetadata', listener),
    play: () => video.play(),
    pause: () => video.pause(),
    setSource(source) {
      video.src = source.src;
      video.load();
    },
    clearSource: () => clearNativeSource(video),
    destroy: () => {}
  };
}

function clearNativeSource(video) {
  video.removeAttribute('src');
  video.load();
}
