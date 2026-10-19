import { Cloud, Cpu, Gift, Music, Image as ImageIcon, Zap } from 'lucide-react';
import type { CatalogModel, MediaKind } from '../../api/generate';

export function ModelPicker({
  models,
  kind,
  value,
  onChange,
  hostedEnabled,
  cloudflare,
}: {
  models: CatalogModel[];
  kind: MediaKind;
  value: string;
  onChange: (id: string) => void;
  hostedEnabled: boolean;
  cloudflare?: { remainingNeurons: number; freeNeurons: number } | null;
}) {
  const ofKind = models.filter((m) => m.kind === kind);
  const groups: Array<{ label: string; icon: React.ReactNode; items: CatalogModel[]; note?: string }> = [
    { label: 'On this machine', icon: <Cpu size={12} />, items: ofKind.filter((m) => m.backend === 'local'), note: 'free · private' },
    {
      label: 'Free daily · Cloudflare',
      icon: <Gift size={12} />,
      items: ofKind.filter((m) => m.backend === 'cloudflare'),
      note: cloudflare
        ? `${Math.round((cloudflare.remainingNeurons / cloudflare.freeNeurons) * 100)}% left today`
        : 'needs a free Cloudflare account',
    },
    {
      label: 'Hosted',
      icon: <Cloud size={12} />,
      items: ofKind.filter((m) => m.backend === 'api'),
      note: hostedEnabled ? 'billed to comfy.org' : 'needs a comfy.org key',
    },
  ];

  return (
    <div className="model-list" role="listbox" aria-label="Model">
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="model-group-label">
              <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                {g.icon} {g.label}
              </span>
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{g.note}</span>
            </div>
            {g.items.map((m) => (
              <button
                key={m.id}
                role="option"
                aria-selected={m.id === value}
                className={`model-opt${m.id === value ? ' on' : ''}`}
                disabled={!m.available}
                onClick={() => onChange(m.id)}
                title={m.available ? m.summary : m.reason}
              >
                <div className="model-opt-top">
                  <span className="model-opt-name">{m.label}</span>
                  <span className="badge">{m.vendor}</span>
                  {m.needsImage && (
                    <span className="badge" title="Animates a start image">
                      <ImageIcon size={10} /> start image
                    </span>
                  )}
                  {m.hasAudio && (
                    <span className="badge" title="Generates sound">
                      <Music size={10} /> audio
                    </span>
                  )}
                  {m.hasFastMode && (
                    <span className="badge" title="Has a fast draft mode">
                      <Zap size={10} /> draft
                    </span>
                  )}
                </div>
                <div className="model-opt-sub">
                  {m.available ? m.summary : <span style={{ color: 'var(--color-warning)' }}>{m.reason}</span>}
                </div>
                <div className="model-opt-sub">
                  {m.speed}
                  {m.cost ? ` · ${m.cost}` : ''}
                </div>
              </button>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
