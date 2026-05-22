import { Bot } from 'lucide-react';

interface AgentChipProps {
  name: string;
}

export function AgentChip({ name }: AgentChipProps) {
  return (
    <span
      title={`Active agent: ${name}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 12,
        background: 'var(--color-accent-dim)',
        color: 'var(--color-accent-light)',
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <Bot size={11} />
      {name}
    </span>
  );
}
