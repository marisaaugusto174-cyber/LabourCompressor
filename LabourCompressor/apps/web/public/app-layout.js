import { initWorkbenchMode } from './workbench-mode.js';

export function initWorkbenchLayout(workbench, workbenchModeButtons) {
  const readinessCore = document.querySelector('#readiness-core');
  for (const id of ['configuration-actions', 'model-config', 'taxonomy-config', 'primary-run-action']) {
    const node = document.querySelector(`#${id}`);
    if (node) readinessCore.append(node);
  }
  moveInto('#advanced-execution-content', ['#stage-controls', '#diagnostic-controls']);
  moveInto('#advanced-tagging-content', ['#more-settings']);
  moveInto('#advanced-authorization-content', ['#archive-paths-panel']);
  moveInto('#advanced-diagnostics-content', ['#runtime-details-panel', '#debug-recovery-panel']);
  const advancedTools = document.querySelector('.advanced-tools');
  if (advancedTools) workbench.append(advancedTools);
  initWorkbenchMode({ root: workbench, buttons: workbenchModeButtons });
}

function moveInto(targetSelector, sourceSelectors) {
  const target = document.querySelector(targetSelector);
  for (const selector of sourceSelectors) {
    const node = document.querySelector(selector);
    if (target && node) target.append(node);
  }
}
