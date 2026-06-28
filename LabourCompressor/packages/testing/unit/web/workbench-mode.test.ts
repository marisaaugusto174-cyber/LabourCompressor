import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKBENCH_MODE_STORAGE_KEY,
  initWorkbenchMode
} from '../../../../apps/web/public/workbench-mode.js';

test('workbench mode defaults to mainline and persists user changes', () => {
  const root = { dataset: {} };
  const mainline = createButton('mainline');
  const advanced = createButton('advanced');
  const storage = createStorage();

  const controller = initWorkbenchMode({ root, buttons: [mainline, advanced], storage });

  assert.equal(root.dataset.workbenchMode, 'mainline');
  assert.equal(mainline.attributes['aria-pressed'], 'true');
  assert.equal(advanced.attributes['aria-pressed'], 'false');

  advanced.listeners.click();
  assert.equal(root.dataset.workbenchMode, 'advanced');
  assert.equal(storage.values[WORKBENCH_MODE_STORAGE_KEY], 'advanced');
  assert.equal(controller.mode, 'advanced');
});

test('workbench mode restores a valid saved preference and ignores invalid values', () => {
  const advancedStorage = createStorage({ [WORKBENCH_MODE_STORAGE_KEY]: 'advanced' });
  const advancedRoot = { dataset: {} };
  initWorkbenchMode({
    root: advancedRoot,
    buttons: [createButton('mainline'), createButton('advanced')],
    storage: advancedStorage
  });
  assert.equal(advancedRoot.dataset.workbenchMode, 'advanced');

  const invalidRoot = { dataset: {} };
  initWorkbenchMode({
    root: invalidRoot,
    buttons: [createButton('mainline'), createButton('advanced')],
    storage: createStorage({ [WORKBENCH_MODE_STORAGE_KEY]: 'unknown' })
  });
  assert.equal(invalidRoot.dataset.workbenchMode, 'mainline');
});

function createButton(mode) {
  return {
    dataset: { workbenchMode: mode },
    attributes: {},
    listeners: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, callback) { this.listeners[type] = callback; }
  };
}

function createStorage(initial = {}) {
  return {
    values: { ...initial },
    getItem(key) { return this.values[key] ?? null; },
    setItem(key, value) { this.values[key] = String(value); }
  };
}
