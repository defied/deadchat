import { useEffect, useState } from 'react';
import { Brain, Eye, Wrench } from 'lucide-react';
import type { ChatModel } from '../../api/chat';
import { getModelStatus, type ModelStatus } from '../../api/ollama';

export function CapabilityIcons({ model }: { model?: ChatModel }) {
  if (!model) return null;
  const caps = model.capabilities;
  return (
    <span style={{ display: 'inline-flex', gap: 6, color: 'var(--color-text-dim)' }}>
      {caps.includes('vision') && (
        <span title="Can see images">
          <Eye size={13} />
        </span>
      )}
      {caps.includes('tools') && (
        <span title="Supports tool calling">
          <Wrench size={13} />
        </span>
      )}
      {caps.includes('thinking') && (
        <span title="Shows its reasoning">
          <Brain size={13} />
        </span>
      )}
    </span>
  );
}

export function ModelSelect({
  models,
  value,
  defaultModel,
  onChange,
  disabled,
}: {
  models: ChatModel[];
  /** null = follow the server default */
  value: string | null;
  defaultModel: string;
  onChange: (model: string | null) => void;
  disabled?: boolean;
}) {
  const known = new Set(models.map((m) => m.name));
  return (
    <select
      className="model-select"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Model"
      title="Model used for this chat"
    >
      <option value="">Default · {defaultModel}</option>
      {models
        .filter((m) => m.name !== defaultModel)
        .map((m) => (
          <option key={m.name} value={m.name}>
            {m.name}
            {m.parameterSize ? ` · ${m.parameterSize}` : ''}
          </option>
        ))}
      {value && !known.has(value) && <option value={value}>{value} (unavailable)</option>}
    </select>
  );
}

const POLL_MS = 5000;

/** GPU/CPU residency of a model — warns when Ollama spilled to CPU. */
export function ModelStatusChip({ model }: { model: string }) {
  const [status, setStatus] = useState<ModelStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      getModelStatus(model)
        .then((s) => !cancelled && setStatus(s))
        .catch(() => !cancelled && setStatus(null));
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [model]);

  if (!status) return null;
  let cls = 'badge';
  let label = '';
  let title = '';
  switch (status.status) {
    case 'gpu':
      cls += ' badge-success';
      label = 'GPU';
      title = 'Fully loaded in VRAM';
      break;
    case 'partial': {
      const pct = Math.round((status.vramPct ?? 0) * 100);
      cls += ' badge-warn';
      label = `GPU ${pct}% · CPU`;
      title = `${pct}% of the model is in VRAM; the rest runs on CPU, so replies are slower`;
      break;
    }
    case 'cpu':
      cls += ' badge-danger';
      label = 'CPU only';
      title = 'Model is running entirely on CPU — replies will be slow';
      break;
    case 'cold':
      label = 'Not loaded';
      title = 'The first reply will take longer while the model loads';
      break;
    case 'unreachable':
      cls += ' badge-danger';
      label = 'Ollama offline';
      title = 'The Ollama server is not reachable';
      break;
  }
  return (
    <span className={cls} title={title}>
      {label}
    </span>
  );
}
