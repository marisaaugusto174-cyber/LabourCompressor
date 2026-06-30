export function classifyVideoOrientation(videoWidth, videoHeight) {
  const ratio = safeRatio(videoWidth, videoHeight);
  if (ratio > 1.2) return 'landscape';
  if (ratio < 0.8) return 'portrait';
  return 'square';
}

export function fitVideoSize(input) {
  const availableWidth = Math.max(1, input.availableWidth);
  const availableHeight = Math.max(1, input.availableHeight);
  const videoWidth = input.videoWidth > 0 ? input.videoWidth : availableWidth;
  const videoHeight = input.videoHeight > 0 ? input.videoHeight : availableHeight;
  const scale = Math.min(availableWidth / videoWidth, availableHeight / videoHeight);

  return {
    width: Math.round(videoWidth * scale),
    height: Math.round(videoHeight * scale),
    ratio: `${videoWidth} / ${videoHeight}`
  };
}

function safeRatio(width, height) {
  return width > 0 && height > 0 ? width / height : 16 / 9;
}
