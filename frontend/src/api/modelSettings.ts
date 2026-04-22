import client from './client';

export interface ModelSettings {
  model: string;
  options: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listModelSettings(): Promise<ModelSettings[]> {
  const { data } = await client.get<{ settings: ModelSettings[] }>('/api/admin/model-settings');
  return data.settings;
}

export async function getModelSettings(model: string): Promise<ModelSettings | null> {
  try {
    const { data } = await client.get<{ settings: ModelSettings }>(
      `/api/admin/model-settings/${encodeURIComponent(model)}`
    );
    return data.settings;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}

export async function upsertModelSettings(
  model: string,
  options: Record<string, unknown>,
  enabled: boolean
): Promise<ModelSettings> {
  const { data } = await client.put<{ settings: ModelSettings }>(
    `/api/admin/model-settings/${encodeURIComponent(model)}`,
    { options, enabled }
  );
  return data.settings;
}

export async function deleteModelSettings(model: string): Promise<void> {
  await client.delete(`/api/admin/model-settings/${encodeURIComponent(model)}`);
}
