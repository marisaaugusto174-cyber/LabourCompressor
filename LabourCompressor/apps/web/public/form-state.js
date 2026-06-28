let form = null;
let onFieldChange = () => {};

export function initFormState(options) {
  form = options.form;
  onFieldChange = options.onFieldChange ?? (() => {});
}

export function collectFormData() {
  const payload = {};
  const collectedRadioNames = new Set();

  for (const field of form.elements) {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
      continue;
    }

    if (field instanceof HTMLInputElement && field.type === 'radio') {
      if (!collectedRadioNames.has(field.name)) {
        payload[field.name] = fieldValue(field.name);
        collectedRadioNames.add(field.name);
      }
      continue;
    }

    payload[field.name] =
      field instanceof HTMLInputElement && field.type === 'checkbox'
        ? field.checked
        : field.value;
  }

  return payload;
}

export function setField(name, value) {
  const field = findNamedField(name);

  if (field instanceof RadioNodeList) {
    field.value = value ?? '';
    updateFilledState();
    onFieldChange(name);
    return;
  }

  if (field) {
    if (field instanceof HTMLInputElement && field.type === 'checkbox') {
      field.checked = value === true || value === 'true';
    } else {
      field.value = value ?? '';
    }
    updateFilledState();
    onFieldChange(name);
  }
}

export function fieldValue(name) {
  const field = findNamedField(name);
  if (field instanceof RadioNodeList) {
    return field.value ?? '';
  }
  if (field instanceof HTMLInputElement && field.type === 'checkbox') {
    return String(field.checked);
  }

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
  const field = form?.elements?.namedItem(name);

  if (field instanceof RadioNodeList) {
    return field;
  }

  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
    return field;
  }

  const elementById = document.getElementById(name);

  if (elementById instanceof HTMLInputElement || elementById instanceof HTMLSelectElement) {
    return elementById;
  }

  const [elementByName] = document.getElementsByName(name);

  if (elementByName instanceof HTMLInputElement || elementByName instanceof HTMLSelectElement) {
    return elementByName;
  }

  return null;
}
