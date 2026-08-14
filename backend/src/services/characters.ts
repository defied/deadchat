import db from '../db/connection';
import type { Character, CharacterAsset, CharacterAssetRole } from '../types/models';

export function createCharacter(userId: number, name: string, description?: string): Character {
  const result = db.prepare(
    'INSERT INTO characters (user_id, name, description) VALUES (?, ?, ?)'
  ).run(userId, name, description ?? null);
  return getCharacter(result.lastInsertRowid as number)!;
}

export function getCharacter(id: number): Character | null {
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Character | null;
}

export function listCharacters(userId: number, limit = 50): Character[] {
  return db.prepare(
    'SELECT * FROM characters WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit) as Character[];
}

export function deleteCharacter(id: number): boolean {
  return db.prepare('DELETE FROM characters WHERE id = ?').run(id).changes > 0;
}

export function linkCharacterAsset(characterId: number, assetId: number, role: CharacterAssetRole): CharacterAsset {
  const result = db.prepare(
    'INSERT INTO character_assets (character_id, asset_id, role) VALUES (?, ?, ?)'
  ).run(characterId, assetId, role);
  return db.prepare('SELECT * FROM character_assets WHERE id = ?').get(result.lastInsertRowid) as CharacterAsset;
}

// A character can accumulate multiple assets per role over time (e.g. a
// re-uploaded voice reference) since revisions don't handle timbre changes -
// always take the most recent one per role, no "is_active" flag needed.
export function getLatestCharacterAsset(characterId: number, role: CharacterAssetRole): CharacterAsset | null {
  return db.prepare(
    'SELECT * FROM character_assets WHERE character_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1'
  ).get(characterId, role) as CharacterAsset | null;
}

export function listCharacterAssets(characterId: number): CharacterAsset[] {
  return db.prepare(
    'SELECT * FROM character_assets WHERE character_id = ? ORDER BY created_at DESC'
  ).all(characterId) as CharacterAsset[];
}
