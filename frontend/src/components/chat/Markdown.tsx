import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';
import { MermaidBlock } from '../MermaidBlock';
import { MediaImage } from '../MediaImage';

// Agents reference generated media as [media:123] or ![alt](media:123).
const MEDIA_REF_RE = /!\[[^\]]*\]\(media:(\d+)\)|\[media:(\d+)\]/g;

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-btn"
      title={copied ? 'Copied' : label || 'Copy'}
      aria-label={label || 'Copy'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable (http) */
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-([\w+-]+)/.exec(className || '');
          const code = String(children).replace(/\n$/, '');
          const isBlock = !!match || code.includes('\n');

          if (match?.[1] === 'mermaid') return <MermaidBlock code={code} />;
          if (!isBlock) return <code {...props}>{children}</code>;

          return (
            <div className="code-block">
              <div className="code-block-header">
                <span>{match?.[1] || 'text'}</span>
                <CopyButton text={code} label="Copy code" />
              </div>
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={match?.[1] || 'text'}
                PreTag="div"
                customStyle={{ margin: 0, padding: 12, fontSize: 13, background: '#1e1e2e', fontFamily: 'var(--font-mono)' }}
              >
                {code}
              </SyntaxHighlighter>
            </div>
          );
        },
        // Code blocks render their own container; avoid nesting inside <pre>.
        pre({ children }) {
          return <>{children}</>;
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/** Markdown with inline generated-media references. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const parts: Array<{ kind: 'md'; text: string } | { kind: 'media'; id: number }> = [];
  let last = 0;
  MEDIA_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MEDIA_REF_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: 'md', text: text.slice(last, m.index) });
    parts.push({ kind: 'media', id: Number(m[1] ?? m[2]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'md', text: text.slice(last) });

  return (
    <div className="md">
      {parts.map((p, i) =>
        p.kind === 'md' ? <MarkdownText key={i} text={p.text} /> : <MediaImage key={i} mediaId={p.id} />,
      )}
    </div>
  );
});
