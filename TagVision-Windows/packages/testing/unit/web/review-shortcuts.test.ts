import test from 'node:test';
import assert from 'node:assert/strict';

import { handleReviewShortcut } from '../../../../apps/web/public/review-shortcuts.js';

test('review shortcut uses arrow keys for bounded previous and next navigation', () => {
  const openedIndexes: number[] = [];
  const previousEvent = createKeyboardEvent('ArrowLeft');
  const nextEvent = createKeyboardEvent('ArrowRight');

  assert.equal(handleReviewShortcut(buildInput(previousEvent, 1, 3, openedIndexes)), true);
  assert.equal(handleReviewShortcut(buildInput(nextEvent, 1, 3, openedIndexes)), true);
  assert.deepEqual(openedIndexes, [0, 2]);
  assert.equal(previousEvent.defaultPrevented, true);
  assert.equal(nextEvent.defaultPrevented, true);

  handleReviewShortcut(buildInput(createKeyboardEvent('ArrowLeft'), 0, 3, openedIndexes));
  handleReviewShortcut(buildInput(createKeyboardEvent('ArrowRight'), 2, 3, openedIndexes));
  assert.deepEqual(openedIndexes, [0, 2]);
});

test('review shortcut toggles video playback with space', () => {
  const video = createVideoState(true);
  const playEvent = createKeyboardEvent(' ');

  assert.equal(handleReviewShortcut(buildInput(playEvent, 0, 1, [], video)), true);
  assert.equal(video.playCalls, 1);
  assert.equal(playEvent.defaultPrevented, true);

  video.paused = false;
  const pauseEvent = createKeyboardEvent(' ');
  handleReviewShortcut(buildInput(pauseEvent, 0, 1, [], video));
  assert.equal(video.pauseCalls, 1);
});

test('review shortcut safely ignores playback blocked by the browser', async () => {
  const video = {
    paused: true,
    play: () => Promise.reject(new Error('playback blocked')),
    pause: () => {}
  };

  assert.equal(
    handleReviewShortcut(buildInput(createKeyboardEvent(' '), 0, 1, [], video)),
    true
  );
  await new Promise((resolve) => setImmediate(resolve));
});

test('review shortcut closes detail with Escape', () => {
  let closeCalls = 0;
  const input = buildInput(createKeyboardEvent('Escape'), 0, 1, []);
  input.closeDetail = () => { closeCalls += 1; };

  assert.equal(handleReviewShortcut(input), true);
  assert.equal(closeCalls, 1);
});

test('review shortcut ignores closed detail, repeated keys, and editable targets', () => {
  const openedIndexes: number[] = [];
  const closedInput = buildInput(createKeyboardEvent('ArrowRight'), 0, 2, openedIndexes);
  closedInput.detailOpen = false;
  assert.equal(handleReviewShortcut(closedInput), false);

  const repeatedEvent = createKeyboardEvent('ArrowRight');
  repeatedEvent.repeat = true;
  assert.equal(handleReviewShortcut(buildInput(repeatedEvent, 0, 2, openedIndexes)), false);

  for (const target of [
    { tagName: 'INPUT', isContentEditable: false },
    { tagName: 'SELECT', isContentEditable: false },
    { tagName: 'TEXTAREA', isContentEditable: false },
    { tagName: 'DIV', isContentEditable: true }
  ]) {
    const editableEvent = createKeyboardEvent(' ');
    editableEvent.target = target;
    assert.equal(handleReviewShortcut(buildInput(editableEvent, 0, 2, openedIndexes)), false);
  }

  assert.deepEqual(openedIndexes, []);
});

function buildInput(
  event: ReturnType<typeof createKeyboardEvent>,
  selectedIndex: number,
  itemCount: number,
  openedIndexes: number[],
  video = createVideoState(true)
) {
  return {
    event,
    detailOpen: true,
    selectedIndex,
    itemCount,
    video,
    openDetail: (index: number) => { openedIndexes.push(index); },
    closeDetail: () => {}
  };
}

function createKeyboardEvent(key: string) {
  return {
    key,
    repeat: false,
    target: null as null | { readonly tagName: string; readonly isContentEditable: boolean },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}

function createVideoState(paused: boolean) {
  return {
    paused,
    playCalls: 0,
    pauseCalls: 0,
    async play() {
      this.playCalls += 1;
    },
    pause() {
      this.pauseCalls += 1;
    }
  };
}
