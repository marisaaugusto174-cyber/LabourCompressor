import { type buildLabelStudioImportPackage } from '../tag-review.ts';

export async function importLabelStudioTasks(input: {
  readonly labelStudioUrl: string;
  readonly token: string;
  readonly projectId?: string | undefined;
  readonly projectTitle: string;
  readonly importPackage: ReturnType<typeof buildLabelStudioImportPackage>;
}): Promise<Readonly<Record<string, unknown>>> {
  const baseUrl = normalizeLabelStudioUrl(input.labelStudioUrl);
  const projectId = input.projectId ??
    await createLabelStudioProject({
      baseUrl,
      token: input.token,
      projectTitle: input.projectTitle,
      labelConfig: input.importPackage.labelConfig
    });

  if (input.projectId !== undefined) {
    await updateLabelStudioProject({
      baseUrl,
      token: input.token,
      projectId,
      projectTitle: input.projectTitle,
      labelConfig: input.importPackage.labelConfig
    });
  }

  const importResult = await fetchJson(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/import`, {
    method: 'POST',
    headers: buildLabelStudioHeaders(input.token),
    body: JSON.stringify(input.importPackage.tasks)
  });

  return Object.freeze({
    labelStudioUrl: baseUrl,
    projectId,
    projectUrl: `${baseUrl}/projects/${projectId}/data`,
    taskCount: input.importPackage.taskCount,
    importResult
  });
}

export async function fetchLabelStudioExport(input: {
  readonly labelStudioUrl: string;
  readonly token: string;
  readonly projectId: string;
}): Promise<unknown> {
  const baseUrl = normalizeLabelStudioUrl(input.labelStudioUrl);
  return fetchJson(
    `${baseUrl}/api/projects/${encodeURIComponent(input.projectId)}/export?exportType=JSON&download_all_tasks=true`,
    {
      method: 'GET',
      headers: {
        Authorization: `Token ${input.token}`
      }
    }
  );
}

async function createLabelStudioProject(input: {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectTitle: string;
  readonly labelConfig: string;
}): Promise<string> {
  const payload = await fetchJson(`${input.baseUrl}/api/projects`, {
    method: 'POST',
    headers: buildLabelStudioHeaders(input.token),
    body: JSON.stringify({
      title: input.projectTitle,
      label_config: input.labelConfig
    })
  });

  if (!isRecord(payload) || (typeof payload.id !== 'number' && typeof payload.id !== 'string')) {
    throw new Error('Label Studio did not return a project id.');
  }

  return String(payload.id);
}

async function updateLabelStudioProject(input: {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly labelConfig: string;
}): Promise<void> {
  await fetchJson(`${input.baseUrl}/api/projects/${encodeURIComponent(input.projectId)}`, {
    method: 'PATCH',
    headers: buildLabelStudioHeaders(input.token),
    body: JSON.stringify({
      title: input.projectTitle,
      label_config: input.labelConfig
    })
  });
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`Label Studio request failed (${response.status}): ${await response.text()}`);
  }

  return response.json() as Promise<unknown>;
}

function buildLabelStudioHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Token ${token}`,
    'Content-Type': 'application/json'
  };
}

function normalizeLabelStudioUrl(value: string): string {
  return value.replace(/\/+$/u, '');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
