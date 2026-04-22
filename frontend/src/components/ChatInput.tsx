import { useState, useRef, useCallback } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import { FileUpload } from './FileUpload';

interface Attachment {
  id: string;
  filename: string;
  url: string;
  type: string;
}

interface ChatInputProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
  }, [text, attachments, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = '44px';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleFileUploaded = (attachment: Attachment) => {
    setAttachments((prev) => [...prev, attachment]);
    setShowUpload(false);
  };

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-border)',
        padding: '14px 24px',
        background: 'var(--color-surface)',
      }}
    >
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {attachments.map((att) => (
            <div
              key={att.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: 'var(--color-surface-light)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                fontSize: 12,
                color: 'var(--color-text-secondary)',
              }}
            >
              <Paperclip size={12} />
              {att.filename}
              <button
                onClick={() => removeAttachment(att.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: 'var(--color-text-dim)',
                  cursor: 'pointer',
                  display: 'flex',
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <div style={{ marginBottom: 12 }}>
          <FileUpload
            onUploaded={handleFileUploaded}
            onClose={() => setShowUpload(false)}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <button
          onClick={() => setShowUpload(!showUpload)}
          disabled={disabled}
          style={{
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: '10px',
            color: 'var(--color-text-dim)',
            cursor: 'pointer',
            display: 'flex',
            flexShrink: 0,
          }}
        >
          <Paperclip size={18} />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
          placeholder="Type a message..."
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            height: 44,
            maxHeight: 200,
            padding: '10px 14px',
            background: 'var(--color-surface-light)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            color: 'var(--color-text)',
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            outline: 'none',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={disabled || (!text.trim() && attachments.length === 0)}
          style={{
            background: 'var(--color-accent)',
            border: 'none',
            borderRadius: 'var(--radius)',
            padding: '10px',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            flexShrink: 0,
            transition: 'opacity 0.15s',
          }}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}