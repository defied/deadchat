import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cloud, Cpu, Gift, Images, KeyRound } from 'lucide-react';
import { getCatalog, getMediaSettings, updateMediaSettings, type MediaSettings } from '../../api/generate';
import { Alert, Field, Loading, Section, errorMessage } from '../ui';

export function MediaPanel() {
  const qc = useQueryClient();
  const catalogQ = useQuery({ queryKey: ['media-catalog'], queryFn: getCatalog });
  const [settings, setSettings] = useState<MediaSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    getMediaSettings().then(setSettings).catch((e) => setError(errorMessage(e)));
  }, []);

  const save = async (patch: Parameters<typeof updateMediaSettings>[0], msg: string) => {
    setSaving(true);
    setError('');
    try {
      setSettings(await updateMediaSettings(patch));
      setNotice(msg);
      qc.invalidateQueries({ queryKey: ['media-catalog'] });
    } catch (e) {
      setError(errorMessage(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  if (!settings || catalogQ.isLoading) return <Loading />;
  const models = catalogQ.data?.models ?? [];

  return (
    <div style={{ maxWidth: 1000 }}>
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert kind="info" onClose={() => setNotice('')}>{notice}</Alert>}

      <Section
        title={<><KeyRound size={14} /> Hosted models</>}
        hint={
          <>
            Local models need nothing. Closed-weight models (Seedance 2.5, Wan 3.0, Kling, Nano Banana, GPT Image…) run on the
            vendors’ servers via ComfyUI’s partner nodes and are billed to a <a href="https://platform.comfy.org" target="_blank" rel="noreferrer">comfy.org</a> API key.
            The key is stored encrypted and never sent to the browser.
          </>
        }
      >
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Field label={settings.apiKeySet ? `API key (set, ends ${settings.apiKeyHint})` : 'API key (not set)'}>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.apiKeySet ? 'Paste a new key to replace it' : 'comfyui-…'}
              />
            </Field>
          </div>
          <button className="btn btn-primary" disabled={saving || apiKey.trim().length < 10} onClick={() => save({ apiKey: apiKey.trim() }, 'API key saved — hosted models are now available.').then(() => setApiKey(''))}>
            Save key
          </button>
          {settings.apiKeySet && (
            <button className="btn btn-danger" disabled={saving} onClick={() => save({ apiKey: null }, 'API key removed — hosted models are disabled.')}>
              Remove
            </button>
          )}
        </div>
      </Section>

      <CloudflareSection settings={settings} saving={saving} onSave={save} />
      <PhotoLibrariesSection settings={settings} saving={saving} onSave={save} />

      <Section title="Defaults" hint="Used by agents, Studio portraits and older API clients that don't name a model.">
        <div className="card opt-row">
          {(['image', 'video'] as const).map((k) => (
            <Field key={k} label={`Default ${k} model`}>
              <select
                value={k === 'image' ? settings.defaultImageModel : settings.defaultVideoModel}
                disabled={saving}
                onChange={(e) =>
                  save(k === 'image' ? { defaultImageModel: e.target.value } : { defaultVideoModel: e.target.value }, `Default ${k} model updated.`)
                }
              >
                {models
                  .filter((m) => m.kind === k && !m.needsImage)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} {m.backend === 'api' ? '(hosted)' : '(local)'} {m.available ? '' : '— unavailable'}
                    </option>
                  ))}
              </select>
            </Field>
          ))}
          <label className="toggle" style={{ gridColumn: '1 / -1' }}>
            <input
              type="checkbox"
              checked={settings.enhanceByDefault}
              disabled={saving}
              onChange={(e) => save({ enhanceByDefault: e.target.checked }, 'Saved.')}
            />
            <span>Refine prompts with the local LLM by default</span>
          </label>
        </div>
      </Section>

      <Section title="Models" hint="Local weights live in C:\Users\defie\ComfyUI-Shared\models on the GPU box.">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Type</th>
                <th>Runs</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td className="strong">
                    {m.label}
                    <div className="field-hint" style={{ marginTop: 2 }}>{m.vendor}</div>
                  </td>
                  <td>{m.kind}{m.needsImage ? ' · from image' : ''}</td>
                  <td>
                    <span className="badge">{m.backend === 'api' ? <><Cloud size={10} /> hosted</> : <><Cpu size={10} /> local</>}</span>
                  </td>
                  <td>
                    {m.available ? (
                      <span className="badge badge-success"><Check size={10} /> ready</span>
                    ) : (
                      <>
                        <span className="badge badge-warn">{m.reason}</span>
                        {m.missingFiles?.length ? (
                          <div className="field-hint mono" style={{ marginTop: 4 }}>{m.missingFiles.join(', ')}</div>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function CloudflareSection({
  settings,
  saving,
  onSave,
}: {
  settings: MediaSettings;
  saving: boolean;
  onSave: (patch: Parameters<typeof updateMediaSettings>[0], msg: string) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(settings.cloudflareAccountId ?? '');
  const [token, setToken] = useState('');
  const u = settings.cloudflareUsage;
  const pct = Math.round((u.remaining / 10_000) * 100);

  return (
    <Section
      title={<><Gift size={14} /> Free daily images · Cloudflare Workers AI</>}
      hint={
        <>
          A free Cloudflare account includes 10,000 “neurons” a day (resets 00:00 UTC) — about 100–170 FLUX.1 schnell
          images or ~7 FLUX.2 [klein] images, without using your GPU. Create a token at{' '}
          <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">dash.cloudflare.com → API Tokens</a>{' '}
          with the <b>Workers AI</b> template; the account ID is on the dashboard home page. On the free Workers plan
          Cloudflare never bills — requests simply stop when the day’s allowance is used.
        </>
      }
    >
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {settings.cloudflareSet && (
          <div style={{ fontSize: 13 }}>
            Connected · today: ~{u.neurons.toLocaleString()} of 10,000 neurons used ({pct}% left, estimated by DeadChat)
            <div className="progress" style={{ marginTop: 6, maxWidth: 360 }}>
              <div style={{ width: `${100 - pct}%` }} />
            </div>
          </div>
        )}
        <div className="opt-row">
          <Field label="Account ID">
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="32-character account ID" autoComplete="off" />
          </Field>
          <Field label={settings.cloudflareSet ? 'API token (set — paste to replace)' : 'API token'}>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Workers AI token" autoComplete="off" />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            disabled={saving || !accountId.trim() || (!settings.cloudflareSet && token.trim().length < 20)}
            onClick={() =>
              onSave(
                { cloudflareAccountId: accountId.trim(), ...(token.trim() ? { cloudflareToken: token.trim() } : {}) },
                'Cloudflare connected — the “Free daily · Cloudflare” models are now available in Generate.',
              ).then(() => setToken(''))
            }
          >
            Save
          </button>
          {settings.cloudflareSet && (
            <button
              className="btn btn-danger"
              disabled={saving}
              onClick={() => onSave({ cloudflareAccountId: null, cloudflareToken: null }, 'Cloudflare disconnected.')}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}

/** Optional free keys that add Pexels and Unsplash to the screenplay shot finder (Openverse needs none). */
function PhotoLibrariesSection({
  settings,
  saving,
  onSave,
}: {
  settings: MediaSettings;
  saving: boolean;
  onSave: (patch: Parameters<typeof updateMediaSettings>[0], msg: string) => Promise<void>;
}) {
  const [pexels, setPexels] = useState('');
  const [shotModel, setShotModel] = useState(settings.shotCheckModel ?? '');
  const [spModel, setSpModel] = useState(settings.screenplayModel ?? '');
  const [unsplash, setUnsplash] = useState('');
  const row = (
    label: string,
    set: boolean | undefined,
    value: string,
    onChange: (v: string) => void,
    field: 'pexelsKey' | 'unsplashKey',
    name: string,
  ) => (
    <div className="opt-row" style={{ alignItems: 'flex-end' }}>
      <Field label={set ? `${label} (set — paste to replace)` : `${label} (not set)`}>
        <input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" placeholder={set ? '••••••••' : 'Paste the key'} />
      </Field>
      <div style={{ display: 'flex', gap: 8, paddingBottom: 2 }}>
        <button className="btn btn-primary" disabled={saving || value.trim().length < 10} onClick={() => onSave({ [field]: value.trim() }, `${name} added to the shot finder.`).then(() => onChange(''))}>
          Save
        </button>
        {set && (
          <button className="btn btn-danger" disabled={saving} onClick={() => onSave({ [field]: null }, `${name} removed from the shot finder.`)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
  return (
    <Section
      title={<><Images size={14} /> Photo libraries for the shot finder</>}
      hint={
        <>
          The screenplay shot finder always searches Openverse (openly licensed photos from Flickr, Wikimedia Commons and others; no key
          needed). Free keys add Pexels and Unsplash, which have more polished, cinematic photos: get one at{' '}
          <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">pexels.com/api</a> and an Access Key at{' '}
          <a href="https://unsplash.com/developers" target="_blank" rel="noreferrer">unsplash.com/developers</a>. Keys are stored encrypted.
        </>
      }
    >
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {row('Pexels API key', settings.pexelsSet, pexels, setPexels, 'pexelsKey', 'Pexels')}
        {row('Unsplash Access Key', settings.unsplashSet, unsplash, setUnsplash, 'unsplashKey', 'Unsplash')}
        <div className="opt-row" style={{ alignItems: 'flex-end' }}>
          <Field label="Screenplay model (Ollama)" hint="Runs the screenplay tools: shot summaries, the shot mentor, photo searches and photo checks. Needs vision. Empty = the active chat model.">
            <input value={spModel} onChange={(e) => setSpModel(e.target.value)} placeholder="e.g. qwen3.8:27b" autoComplete="off" />
          </Field>
          <div style={{ display: 'flex', gap: 8, paddingBottom: 2 }}>
            <button className="btn btn-primary" disabled={saving || spModel.trim() === (settings.screenplayModel ?? '')} onClick={() => onSave({ screenplayModel: spModel.trim() || null }, spModel.trim() ? `Screenplay tools now use ${spModel.trim()}.` : 'Screenplay tools use the active chat model.')}>
              Save
            </button>
          </div>
        </div>
        <div className="opt-row" style={{ alignItems: 'flex-end' }}>
          <Field label="Cinematography model (Ollama)" hint="Checks each found photo's shot size, framing and camera angle against the shot type, e.g. ShotVL. Leave empty to skip.">
            <input value={shotModel} onChange={(e) => setShotModel(e.target.value)} placeholder="e.g. shotvl:7b" autoComplete="off" />
          </Field>
          <div style={{ display: 'flex', gap: 8, paddingBottom: 2 }}>
            <button className="btn btn-primary" disabled={saving || shotModel.trim() === (settings.shotCheckModel ?? '')} onClick={() => onSave({ shotCheckModel: shotModel.trim() || null }, shotModel.trim() ? `Found photos will be checked for framing with ${shotModel.trim()}.` : 'Framing check off.')}>
              Save
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}
