let form = null;
let onFieldChange = () => {};

export function initFormState(options) {
  form = options.form;
  onFieldChange = options.onFieldChange ?? (() => {});
}

export function collectFormData() {
  const payload = {};

  for (const field of form.querySelectorAll('[name]')) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
      continue;
    }

    payload[field.name] = field.value;
  }

  return payload;
}

export function setField(name, value) {
  const field = findNamedField(name);

  if (field) {
    field.value = value ?? '';
    updateFilledState();
    onFieldChange(name);
  }
}

export function fieldValue(name) {
  const field = findNamedField(name);
  return field?.value ?? '';
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function updateFilledState() {
  for (const field of document.querySelectorAll('.drop-target')) {
    const targetName = field.dataset.target;
    const input = targetName ? findNamedField(targetName) : null;
    const hasValue =
      input instanceof HTMLInputElement && input.value.trim().length > 0;
    field.classList.toggle('is-filled', hasValue);
  }
}

export function validateRequiredFields() {
  const requiredFieldNames = [
    'spreadsheet',
    'promptLibrary',
    'providerConfigPath',
    'downloadDir',
    'archiveRoot'
  ];

  for (const fieldName of requiredFieldNames) {
    const field = findNamedField(fieldName);

    if (field instanceof HTMLInputElement && field.value.trim().length === 0) {
      return {
        field,
        message: `请先填写必填项：${fieldName}`
      };
    }
  }

  return null;
}

export function findNamedField(name) {
  const field = form.querySelector(`[name="${CSS.escape(name)}"]`);

  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
    return field;
  }

  return null;
}
