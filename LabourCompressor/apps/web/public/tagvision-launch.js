const TAGVISION_REVIEW_URL = 'http://127.0.0.1:4312/review.html';

export function initTagVisionLaunch(input) {
  const { apiPost } = input;
  const launchButton = document.querySelector('#launch-tagvision');
  const statusBox = document.querySelector('#tagvision-launch-status');

  if (!launchButton || !statusBox) {
    return;
  }

  launchButton.addEventListener('click', async () => {
    renderStatus(statusBox, 'running', '正在启动 TagVision', 'LabourCompressor 正在调用本机 TagVision 启动器。');
    launchButton.disabled = true;
    launchButton.textContent = '启动中';

    try {
      const payload = await apiPost('/api/tagvision/launch', {});
      const url = readUrl(payload) || TAGVISION_REVIEW_URL;
      renderStatus(statusBox, 'success', 'TagVision 已启动', `如果浏览器没有自动打开，请访问 ${url}。`);
      launchButton.textContent = '重新启动 TagVision';
    } catch (error) {
      renderStatus(
        statusBox,
        'failure',
        'TagVision 启动失败',
        error instanceof Error ? error.message : String(error)
      );
      launchButton.textContent = '重试启动';
    } finally {
      launchButton.disabled = false;
    }
  });
}

function readUrl(payload) {
  return typeof payload?.url === 'string' ? payload.url : '';
}

function renderStatus(statusBox, status, title, message) {
  const titleNode = document.createElement('strong');
  const messageNode = document.createElement('span');

  titleNode.textContent = title;
  messageNode.textContent = message;
  statusBox.className = `tagvision-launch-status is-${status}`;
  statusBox.hidden = false;
  statusBox.replaceChildren(titleNode, messageNode);
}
