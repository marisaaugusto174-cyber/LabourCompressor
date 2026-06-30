const EDITABLE_TAG_NAMES = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

export function handleReviewShortcut(input) {
  const { event } = input;

  if (!input.detailOpen || event.repeat || isEditableTarget(event.target)) {
    return false;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (input.selectedIndex > 0) {
      input.openDetail(input.selectedIndex - 1);
    }
    return true;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (input.selectedIndex < input.itemCount - 1) {
      input.openDetail(input.selectedIndex + 1);
    }
    return true;
  }

  if (event.key === ' ') {
    event.preventDefault();
    if (input.video.paused) {
      void input.video.play().catch(() => {});
    } else {
      input.video.pause();
    }
    return true;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    input.closeDetail();
    return true;
  }

  return false;
}

function isEditableTarget(target) {
  return target !== null &&
    typeof target === 'object' &&
    (EDITABLE_TAG_NAMES.has(target.tagName) || target.isContentEditable === true);
}
