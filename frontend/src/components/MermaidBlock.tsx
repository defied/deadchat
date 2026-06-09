import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

let initialized = false;

function ensureInit() {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#1e1e2e',
        primaryColor: '#6366f1',
        primaryTextColor: '#e2e8f0',
        lineColor: '#4a5568',
        edgeLabelBackground: '#1e1e2e',
      },
    });
    initialized = true;
  }
}

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    ensureInit();
    const el = containerRef.current;
    if (!el) return;

    mermaid.render(idRef.current, code)
      .then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          // Make the SVG responsive
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        }
      })
      .catch(() => {
        if (containerRef.current) {
          containerRef.current.innerHTML =
            `<pre style="color:var(--color-text-dim);font-size:12px">${code}</pre>`;
        }
      });
  }, [code]);

  return (
    <div
      ref={containerRef}
      style={{
        margin: '10px 0',
        padding: '12px',
        background: '#1e1e2e',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--color-border)',
        overflowX: 'auto',
      }}
    />
  );
}
