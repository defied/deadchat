import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Bot } from 'lucide-react';

interface StreamingTextProps {
  text: string;
}

export function StreamingText({ text }: StreamingTextProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-start',
        padding: '6px 0',
      }}
    >
      <div style={{ maxWidth: '75%', display: 'flex', gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            minWidth: 30,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-surface-light)',
            color: 'var(--color-text-secondary)',
            flexShrink: 0,
          }}
        >
          <Bot size={15} />
        </div>

        <div
          style={{
            background: 'var(--color-surface-light)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '10px 14px',
            fontSize: 14,
            lineHeight: 1.7,
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          <ReactMarkdown
            components={{
              code({ className, children }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeString = String(children).replace(/\n$/, '');
                if (match) {
                  return (
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{
                        margin: '8px 0',
                        padding: '12px',
                        borderRadius: 'var(--radius)',
                        fontSize: 13,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {codeString}
                    </SyntaxHighlighter>
                  );
                }
                return (
                  <code
                    style={{
                      background: 'var(--color-surface-hover)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 13,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-accent-light)',
                    }}
                  >
                    {children}
                  </code>
                );
              },
              p({ children }) {
                return <p style={{ margin: '6px 0' }}>{children}</p>;
              },
            }}
          >
            {text}
          </ReactMarkdown>
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: 16,
              background: 'var(--color-accent)',
              marginLeft: 2,
              animation: 'pulse 0.8s infinite',
              verticalAlign: 'text-bottom',
              borderRadius: 1,
            }}
          />
        </div>
      </div>
    </div>
  );
}