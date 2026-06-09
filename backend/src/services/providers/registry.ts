// Provider registry: loads enabled providers from DB, resolves local-first.
// selectProvider(capability) walks priority-ordered providers, returning the
// first that is reachable. Cloud fallback happens automatically when local is down.

import db from '../../db/connection';
import type { Provider, MediaCapability } from '../../types/models';
import type { MediaProvider } from './types';
import { LocalComfyuiProvider } from './localComfyui';
import { GenericHttpProvider } from './genericHttp';

function buildProvider(row: Provider): MediaProvider {
  const cfg = row.config ? JSON.parse(row.config) as Record<string, unknown> : {};
  if (row.kind === 'local_comfyui') {
    if (row.base_url) cfg.baseUrl = row.base_url;
    return new LocalComfyuiProvider(row.capability, cfg);
  }
  return new GenericHttpProvider(row.capability, cfg, row.secrets ?? null);
}

export async function selectProvider(
  capability: MediaCapability
): Promise<MediaProvider> {
  const rows = db.prepare(`
    SELECT * FROM providers
    WHERE capability = ? AND enabled = 1
    ORDER BY priority DESC, id ASC
  `).all(capability) as Provider[];

  for (const row of rows) {
    const provider = buildProvider(row);
    try {
      if (await provider.isReachable()) return provider;
    } catch {
      // try next
    }
  }

  throw new Error(
    `No reachable ${capability} provider found. ` +
    `Check that ComfyUI is running at the configured URL or add a cloud provider.`
  );
}

export function getProviderById(id: number): Provider | null {
  return db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Provider | null;
}

export function listProviders(): Provider[] {
  return db.prepare('SELECT * FROM providers ORDER BY capability, priority DESC').all() as Provider[];
}

export function upsertProvider(data: Omit<Provider, 'id' | 'created_at' | 'updated_at'> & { id?: number }): Provider {
  if (data.id) {
    db.prepare(`
      UPDATE providers SET name=?, kind=?, capability=?, enabled=?, is_default=?,
        priority=?, base_url=?, config=?, secrets=?, updated_at=datetime('now')
      WHERE id=?
    `).run(data.name, data.kind, data.capability, data.enabled, data.is_default,
           data.priority, data.base_url ?? null, data.config, data.secrets ?? null, data.id);
    return db.prepare('SELECT * FROM providers WHERE id=?').get(data.id) as Provider;
  }
  const result = db.prepare(`
    INSERT INTO providers (name, kind, capability, enabled, is_default, priority, base_url, config, secrets)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.name, data.kind, data.capability, data.enabled, data.is_default,
         data.priority, data.base_url ?? null, data.config, data.secrets ?? null);
  return db.prepare('SELECT * FROM providers WHERE id=?').get(result.lastInsertRowid) as Provider;
}

export function deleteProvider(id: number): boolean {
  return db.prepare('DELETE FROM providers WHERE id=?').run(id).changes > 0;
}
