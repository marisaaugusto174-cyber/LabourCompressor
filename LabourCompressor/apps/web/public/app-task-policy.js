export function isControllableTaskStatus(status) {
  return ['queued', 'running', 'pausing', 'paused', 'cancelling'].includes(status);
}
export function shouldPollTaskStatus(status) {
  return ['queued', 'running', 'pausing', 'cancelling'].includes(status);
}
