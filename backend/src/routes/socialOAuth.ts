// OAuth redirects from social platforms. Unauthenticated: the browser arrives
// straight from the platform, so the request is tied to the user and project
// by the signed `state` created in POST /api/influencers/:id/accounts/youtube/connect.

import { Router, Request, Response } from 'express';
import { config } from '../config';
import { decryptObject, encryptObject } from '../services/secrets';
import { testConnection, youtubeExchangeCode } from '../services/influencers/platforms';
import { verifyState } from '../services/influencers/publicMedia';
import * as store from '../services/influencers/store';

const router = Router();

function back(res: Response, influencerId: number | null, result: { connected?: string; error?: string }): void {
  const q = new URLSearchParams(result as Record<string, string>);
  const path = influencerId ? `/social/${influencerId}/accounts` : '/social';
  res.redirect(303, `${config.publicUrl}${path}?${q}`);
}

router.get('/youtube/callback', async (req: Request, res: Response): Promise<void> => {
  const state = verifyState(String(req.query.state ?? ''));
  if (!state || state.platform !== 'youtube') {
    back(res, null, { error: 'The Google sign-in link expired. Click "Connect with Google" again.' });
    return;
  }
  const inf = store.getInfluencer(state.influencerId);
  const row = store.getAccount(state.influencerId, 'youtube');
  if (!inf || inf.userId !== state.userId || !row?.credentials) {
    back(res, null, { error: 'That project or its YouTube settings no longer exist.' });
    return;
  }
  if (req.query.error) {
    const msg = req.query.error === 'access_denied' ? 'Google access was not granted.' : `Google sign-in failed: ${String(req.query.error)}`;
    store.upsertAccount(inf.id, 'youtube', { status: 'error', lastError: msg });
    back(res, inf.id, { error: msg });
    return;
  }
  try {
    const creds = decryptObject(row.credentials);
    creds.refreshToken = await youtubeExchangeCode(creds, String(req.query.code ?? ''));
    store.upsertAccount(inf.id, 'youtube', { credentials: encryptObject(creds) });
    const handle = await testConnection('youtube', creds);
    store.upsertAccount(inf.id, 'youtube', { status: 'connected', handle, lastError: null });
    back(res, inf.id, { connected: 'youtube' });
  } catch (e) {
    store.upsertAccount(inf.id, 'youtube', { status: 'error', lastError: (e as Error).message });
    back(res, inf.id, { error: (e as Error).message });
  }
});

export default router;
