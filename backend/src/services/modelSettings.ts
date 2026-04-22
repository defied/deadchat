import db from '../db/connection';

export interface ModelSettingsRow {
  model: string;
  options: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ModelSettings {
  model: string;
  options: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToSettings(row: ModelSettingsRow): ModelSettings {
  let options: Record<string, unknown> = {};
  try {
    options = JSON.parse(row.options);
  } catch {
    options = {};
  }
  return {
    model: row.model,
    options,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listModelSettings(): ModelSettings[] {
  const rows = db.prepare('SELECT * FROM model_settings ORDER BY model').all() as ModelSettingsRow[];
  return rows.map(rowToSettings);
}

export function getModelSettings(model: string): ModelSettings | null {
  const row = db.prepare('SELECT * FROM model_settings WHERE model = ?').get(model) as ModelSettingsRow | undefined;
  return row ? rowToSettings(row) : null;
}

export function upsertModelSettings(
  model: string,
  options: Record<string, unknown>,
  enabled: boolean
): ModelSettings {
  const json = JSON.stringify(options);
  const existing = db.prepare('SELECT model FROM model_settings WHERE model = ?').get(model);
  if (existing) {
    db.prepare(
      "UPDATE model_settings SET options = ?, enabled = ?, updated_at = datetime('now') WHERE model = ?"
    ).run(json, enabled ? 1 : 0, model);
  } else {
    db.prepare(
      'INSERT INTO model_settings (model, options, enabled) VALUES (?, ?, ?)'
    ).run(model, json, enabled ? 1 : 0);
  }
  return getModelSettings(model)!;
}

export function deleteModelSettings(model: string): boolean {
  const result = db.prepare('DELETE FROM model_settings WHERE model = ?').run(model);
  return result.changes > 0;
}

export function getEnabledModels(): string[] {
  const rows = db.prepare('SELECT model FROM model_settings WHERE enabled = 1 ORDER BY model').all() as { model: string }[];
  return rows.map((r) => r.model);
}

export function getOptionsForModel(model: string): Record<string, unknown> {
  const s = getModelSettings(model);
  return s?.enabled ? s.options : {};
}
