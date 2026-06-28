export const WORKBENCH_MODE_STORAGE_KEY = 'labourCompressorWorkbenchMode';

export function initWorkbenchMode({ root, buttons, storage = globalThis.localStorage }) {
  let mode = normalizeMode(storage?.getItem(WORKBENCH_MODE_STORAGE_KEY));

  const apply = (nextMode, persist = true) => {
    mode = normalizeMode(nextMode);
    root.dataset.workbenchMode = mode;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.workbenchMode === mode));
    }
    if (persist) {
      storage?.setItem(WORKBENCH_MODE_STORAGE_KEY, mode);
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => apply(button.dataset.workbenchMode));
  }

  apply(mode, false);
  return {
    get mode() { return mode; },
    setMode: apply
  };
}

function normalizeMode(value) {
  return value === 'advanced' ? 'advanced' : 'mainline';
}
