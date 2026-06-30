import test from 'node:test';
import assert from 'node:assert/strict';

import { createReviewPlayer } from '../../../../apps/web/public/review-player.js';

test('review player initializes Plyr with local assets and application-owned keyboard shortcuts', () => {
  const video = createVideo();
  let receivedOptions;
  let fakeInstance;
  class FakePlyr {
    paused = true;
    source = null;
    media = { videoWidth: 640, videoHeight: 360 };
    constructor(_video, options) { receivedOptions = options; fakeInstance = this; }
    on(eventName, listener) { this.eventName = eventName; this.listener = listener; }
    play() { return Promise.resolve(); }
    pause() {}
    stop() {}
    destroy() {}
  }

  const player = createReviewPlayer(video, FakePlyr);

  assert.equal(player.kind, 'plyr');
  assert.deepEqual(receivedOptions.keyboard, { focused: false, global: false });
  assert.equal(receivedOptions.iconUrl, '/vendor/plyr.svg');
  assert.equal(receivedOptions.ratio, null);
  assert.deepEqual(player.media, { videoWidth: 640, videoHeight: 360 });
  const replacementMedia = { videoWidth: 1080, videoHeight: 1920 };
  fakeInstance.media = replacementMedia;
  assert.equal(player.media, replacementMedia);
  player.onLoadedMetadata(() => {});
  assert.equal(fakeInstance.eventName, 'loadedmetadata');
});

test('review player updates Plyr source and delegates playback', async () => {
  const video = createVideo();
  let instance;
  class FakePlyr {
    paused = true;
    source = null;
    playCalls = 0;
    pauseCalls = 0;
    constructor() { instance = this; }
    play() { this.playCalls += 1; return Promise.resolve(); }
    pause() { this.pauseCalls += 1; }
    stop() {}
    destroy() {}
  }

  const player = createReviewPlayer(video, FakePlyr);
  player.setSource({ src: '/clip.mp4', type: 'video/mp4', title: 'clip.mp4' });
  await player.play();
  player.pause();

  assert.deepEqual(instance.source, {
    type: 'video',
    title: 'clip.mp4',
    sources: [{ src: '/clip.mp4', type: 'video/mp4' }]
  });
  assert.equal(instance.playCalls, 1);
  assert.equal(instance.pauseCalls, 1);
});

test('review player falls back to native video when Plyr initialization fails', () => {
  const video = createVideo();
  class BrokenPlyr { constructor() { throw new Error('Plyr unavailable'); } }

  const player = createReviewPlayer(video, BrokenPlyr);
  player.setSource({ src: '/native.mp4', type: 'video/mp4', title: 'native.mp4' });

  assert.equal(player.kind, 'native');
  assert.equal(video.src, '/native.mp4');
  assert.equal(video.loadCalls, 1);
});

function createVideo() {
  return {
    paused: true,
    src: '',
    loadCalls: 0,
    play: () => Promise.resolve(),
    pause: () => {},
    load() { this.loadCalls += 1; },
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  };
}
