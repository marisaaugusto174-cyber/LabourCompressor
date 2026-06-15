export async function apiGet(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function uploadDroppedFile(file) {
  const response = await fetch(`/api/upload-file?fileName=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: await file.arrayBuffer()
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  return payload.storedPath;
}

export function buildDebugJson(payload) {
  return JSON.stringify(payload, null, 2);
}
