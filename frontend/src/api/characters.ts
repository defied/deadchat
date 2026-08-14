import client from './client';
import type { CreativeAsset } from './assets';

export interface Character {
  id: number;
  user_id: number | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharacterDetail extends Character {
  portrait: CreativeAsset | null;
  voice: CreativeAsset | null;
}

export async function listCharacters(limit = 50): Promise<CharacterDetail[]> {
  const { data } = await client.get<CharacterDetail[]>('/api/characters', { params: { limit } });
  return data;
}

export async function getCharacter(id: number): Promise<CharacterDetail> {
  const { data } = await client.get<CharacterDetail>(`/api/characters/${id}`);
  return data;
}

export async function createCharacter(name: string, description?: string): Promise<Character> {
  const { data } = await client.post<Character>('/api/characters', { name, description });
  return data;
}

export async function deleteCharacter(id: number): Promise<void> {
  await client.delete(`/api/characters/${id}`);
}

export async function createCharacterPortrait(characterId: number, prompt: string): Promise<CreativeAsset> {
  const { data } = await client.post<CreativeAsset>(`/api/characters/${characterId}/portrait`, {
    input: { prompt },
  });
  return data;
}

export async function createCharacterVoice(
  characterId: number,
  referenceAudio: File,
  sampleText?: string,
  language?: string
): Promise<CreativeAsset> {
  const form = new FormData();
  form.append('reference_audio', referenceAudio);
  if (sampleText) form.append('sampleText', sampleText);
  if (language) form.append('language', language);
  const { data } = await client.post<CreativeAsset>(`/api/characters/${characterId}/voice`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function speak(characterId: number, text: string, language?: string): Promise<{ job_id: number; status: string }> {
  const { data } = await client.post<{ job_id: number; status: string }>(`/api/characters/${characterId}/speak`, {
    text,
    language,
  });
  return data;
}
