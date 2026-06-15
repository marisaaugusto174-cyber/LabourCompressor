import { apiPost, uploadDroppedFile } from './api-client.js';
import { findNamedField, setField } from './form-state.js';

let outputNode = null;

export function initPathInputs(options) {
  outputNode = options.outputNode;
}

export function bindPickerButtons() {
  for (const button of document.querySelectorAll('.picker-button')) {
    if (button.dataset.bound === 'true') {
      continue;
    }
    button.dataset.bound = 'true';
    button.addEventListener('click', async () => {
      const targetName = button.dataset.target;
      const dialogKind = button.dataset.dialogKind;

      if (!targetName || !dialogKind) {
        return;
      }

      const field = findNamedField(targetName);
      const defaultPath =
        field instanceof HTMLInputElement && field.value.trim().length > 0
          ? field.value.trim()
          : undefined;
      const payload = await apiPost(
        dialogKind === 'folder' ? '/api/dialog/open-folder' : '/api/dialog/open-file',
        {
          prompt: button.dataset.prompt ?? '选择路径',
          defaultPath
        }
      );

      if (!payload.cancelled && typeof payload.path === 'string' && payload.path.length > 0) {
        setField(targetName, payload.path);
      }
    });
  }
}

export function bindDropTargets() {
  for (const target of document.querySelectorAll('.drop-target')) {
    target.addEventListener('dragover', (event) => {
      event.preventDefault();
      target.classList.add('is-dragover');
    });
    target.addEventListener('dragleave', () => {
      target.classList.remove('is-dragover');
    });
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      target.classList.remove('is-dragover');
      const targetName = target.dataset.target;
      if (targetName) {
        handleDropAssignment(event, targetName, target.dataset.kind ?? 'file').catch((error) => {
          outputNode.textContent = error instanceof Error ? error.message : String(error);
        });
      }
    });
  }
}

async function handleDropAssignment(event, targetName, kind) {
  const resolvedPath = resolveDroppedPath(event);

  if (resolvedPath) {
    setField(targetName, resolvedPath);
    return;
  }

  const droppedFiles = [...(event.dataTransfer?.files ?? [])];
  const firstFile = droppedFiles[0];

  if (kind === 'folder') {
    outputNode.textContent = '当前浏览器拖拽目录仍不能稳定拿到绝对路径。目录请改用“选择目录”。';
    return;
  }

  if (!firstFile) {
    outputNode.textContent = '未能从拖拽内容中解析出本地绝对路径。请改用“选择文件/目录”。';
    return;
  }

  outputNode.textContent = `正在接收拖拽文件：${firstFile.name}`;
  const storedPath = await uploadDroppedFile(firstFile);
  setField(targetName, storedPath);
  outputNode.textContent = `已接收拖拽文件并写入本地临时路径：${storedPath}`;
}

function resolveDroppedPath(event) {
  const droppedFiles = [...(event.dataTransfer?.files ?? [])];
  const firstFile = droppedFiles[0];

  if (firstFile && typeof firstFile.path === 'string' && firstFile.path.startsWith('/')) {
    return firstFile.path;
  }

  const uriList = event.dataTransfer?.getData('text/uri-list')?.trim();

  if (uriList) {
    const firstUri = uriList
      .split(/\r?\n/u)
      .find((line) => line.length > 0 && !line.startsWith('#'));

    if (firstUri?.startsWith('file://')) {
      return decodeFileUri(firstUri);
    }
  }

  const plainText = event.dataTransfer?.getData('text/plain')?.trim();

  if (plainText?.startsWith('file://')) {
    return decodeFileUri(plainText);
  }

  if (plainText?.startsWith('/')) {
    return plainText;
  }

  return null;
}

function decodeFileUri(value) {
  try {
    return decodeURIComponent(value.replace(/^file:\/\//u, ''));
  } catch {
    return null;
  }
}
