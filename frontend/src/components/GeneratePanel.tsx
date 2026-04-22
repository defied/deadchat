import { Image, Film, Construction } from 'lucide-react';

export function GeneratePanel() {
  return (
    <div style={{ padding: 32, maxWidth: 600, margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 16,
          background: 'var(--color-surface-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-dim)',
          marginBottom: 20,
        }}
      >
        <Construction size={32} />
      </div>

      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: 'var(--color-text)',
          marginBottom: 8,
        }}
      >
        Generation Coming Soon
      </h2>

      <p
        style={{
          fontSize: 14,
          color: 'var(--color-text-secondary)',
          textAlign: 'center',
          lineHeight: 1.6,
          marginBottom: 28,
          maxWidth: 400,
        }}
      >
        Image and video generation will be available once compatible models are configured in Ollama.
      </p>

      <div style={{ display: 'flex', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            background: 'var(--color-surface-light)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            color: 'var(--color-text-dim)',
            fontSize: 13,
          }}
        >
          <Image size={16} />
          Image Generation
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            background: 'var(--color-surface-light)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            color: 'var(--color-text-dim)',
            fontSize: 13,
          }}
        >
          <Film size={16} />
          Video Generation
        </div>
      </div>
    </div>
  );
}