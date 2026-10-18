import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from 'lucide-react';
import { uploadAttachment, isImageAttachment, type Attachment } from '../../api/chat';
import { errorMessage } from '../ui';

const ACCEPT =
  '.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.txt,.csv,.md,.html,.css,.js,.ts,.tsx,.jsx,.json,.pdf,.py,.yaml,.yml,.xml,.sql,.sh,.rb,.go,.rs,.java,.cpp,.c,.h,.toml,.ini,.log';

interface Upload {
  key: string;
  name: string;
  attachment?: Attachment;
  error?: string;
}

export function Composer({
  onSend,
  onStop,
  busy,
  placeholder = 'Message DeadChat…',
  autoFocus,
  visionHint,
}: {
  onSend: (content: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Shown when an image is attached but the model can't see images. */
  visionHint?: string | null;
}) {
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const resize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  };

  useEffect(resize, [text]);
  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name }]);
      try {
        const attachment = await uploadAttachment(file);
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, attachment } : x)));
      } catch (err) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: errorMessage(err, 'Upload failed') } : x)));
      }
    }
  }, []);

  const uploading = uploads.some((u) => !u.attachment && !u.error);
  const ready = uploads.filter((u) => u.attachment).map((u) => u.attachment!);
  const canSend = !busy && !uploading && (text.trim().length > 0 || ready.length > 0);
  const hasImage = ready.some(isImageAttachment);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), ready);
    setText('');
    setUploads([]);
  };

  return (
    <div className="composer-wrap">
      <div
        className={`composer${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
      >
        {uploads.length > 0 && (
          <div className="composer-attachments">
            {uploads.map((u) => (
              <span
                key={u.key}
                className="attachment-chip"
                style={u.error ? { borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' } : undefined}
                title={u.error || u.name}
              >
                {!u.attachment && !u.error ? <Loader2 size={12} className="spin" /> : <FileText size={12} />}
                <span>{u.error ? `${u.name} — ${u.error}` : u.name}</span>
                <button
                  className="icon-btn"
                  style={{ padding: 0 }}
                  aria-label={`Remove ${u.name}`}
                  onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {hasImage && visionHint && (
          <div className="composer-hint" style={{ padding: '0 8px 4px', color: 'var(--color-warning)' }}>
            {visionHint}
          </div>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          aria-label="Message"
        />
        <div className="composer-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="icon-btn" title="Attach files (or paste / drop them)" onClick={() => fileRef.current?.click()}>
              <Paperclip size={17} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <span className="composer-hint">
              <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
            </span>
          </div>
          {busy && onStop ? (
            <button className="btn send-btn" title="Stop generating" onClick={onStop} aria-label="Stop generating">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button className="btn btn-primary send-btn" disabled={!canSend} onClick={submit} title="Send" aria-label="Send">
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
