import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cloud, Cpu, KeyRound } from 'lucide-react';
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
