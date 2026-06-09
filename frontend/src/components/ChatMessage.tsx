import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage as ChatMessageType } from '../api/chat';
import { User, Bot, Paperclip } from 'lucide-react';
import { MermaidBlock } from './MermaidBlock';
import { MediaImage } from './MediaImage';

// Match media links injected by the agent: [media:123] or ![image](media:123)
const MEDIA_REF_RE = /\[media:(\d+)\]|!\[.*?\]\(media:(\d+)\)/g;

function renderContentWithMedia(content: string) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MEDIA_REF_RE.lastIndex = 0;

  while ((match = MEDIA_REF_RE.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before) parts.push(before);

    const mediaId = Number(match[1] ?? match[2]);
    parts.push(<MediaImage key={`media-${mediaId}-${match.index}`} mediaId={mediaId} />);
    lastIndex = match.index + match[0].length;
  }

  const remaining = content.slice(lastIndex);
  if (remaining) parts.push(remaining);

  // If no media refs, return the plain string for ReactMarkdown
  if (parts.length === 1 && typeof parts[0] === 'string') return parts[0];
  return parts;
}

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const processedContent = renderContentWithMedia(message.content);

  return (
    <div
      className="animate-fade-in"
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '6px 0',
      }}
    >
      <div
        style={{
          maxWidth: '75%',
          display: 'flex',
          gap: 10,
          flexDirection: isUser ? 'row-reverse' : 'row',
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            minWidth: 30,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isUser ? 'var(--color-accent-dim)' : 'var(--color-surface-light)',
            color: isUser ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
            flexShrink: 0,
          }}
        >
          {isUser ? <User size={15} /> : <Bot size={15} />}
        </div>

        <div
          style={{
            background: isUser ? 'var(--color-accent-dim)' : 'var(--color-surface-light)',
            border: `1px solid ${isUser ? 'rgba(99, 102, 241, 0.15)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-lg)',
            padding: '10px 14px',
            fontSize: 14,
            lineHeight: 1.7,
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          {typeof processedContent === 'string' ? (
            <ReactMarkdown
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const codeString = String(children).replace(/\n$/, '');

                  if (match?.[1] === 'mermaid') {
                    return <MermaidBlock code={codeString} />;
                  }

                  if (match) {
                    return (
                      <div style={{ margin: '8px 0', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                        <div
                          style={{
                            background: '#1e1e2e',
                            padding: '6px 12px',
                            fontSize: 11,
                            color: 'var(--color-text-dim)',
                            borderBottom: '1px solid var(--color-border)',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 500,
                          }}
                        >
                          {match[1]}
                        </div>
                        <SyntaxHighlighter
                          style={vscDarkPlus}
                          language={match[1]}
                          PreTag="div"
                          customStyle={{
                            margin: 0,
                            padding: '12px',
                            fontSize: 13,
                            background: '#1e1e2e',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {codeString}
                        </SyntaxHighlighter>
                      </div>
                    );
                  }

                  return (
                    <code
                      {...props}
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
                ul({ children }) {
                  return <ul style={{ margin: '6px 0', paddingLeft: 20 }}>{children}</ul>;
                },
                ol({ children }) {
                  return <ol style={{ margin: '6px 0', paddingLeft: 20 }}>{children}</ol>;
                },
                blockquote({ children }) {
                  return (
                    <blockquote
                      style={{
                        borderLeft: '3px solid var(--color-accent)',
                        paddingLeft: 12,
                        margin: '8px 0',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {children}
                    </blockquote>
                  );
                },
              }}
            >
              {processedContent}
            </ReactMarkdown>
          ) : (
            <div>{processedContent}</div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {message.attachments.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    background: 'var(--color-surface-hover)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                    color: 'var(--color-accent-light)',
                    textDecoration: 'none',
                  }}
                >
                  <Paperclip size={12} />
                  {att.filename}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
