import { useState, useRef, useCallback } from 'react';
import { Upload, X, FileText } from 'lucide-react';
import client from '../api/client';

interface Attachment {
  id: string;
  filename: string;
  url: string;
  type: string;
}

interface FileUploadProps {
  onUploaded: (attachment: Attachment) => void;
  onClose: () => void;
}

const ACCEPTED_EXTENSIONS = '.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.tiff,.heic,.heif,.txt,.csv,.html,.css,.js,.ts,.json,.pdf,.py,.md,.yaml,.yml,.xml,.sql,.sh,.rb,.go,.rs,.java,.cpp,.c,.h';

export function FileUpload({ onUploaded, onClose }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      setError('');
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const { data } = await client.post<Attachment>('/api/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        onUploaded(data);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Upload failed';
        setError(message);
      } finally {
        setUploading(false);
      }
    },
    [onUploaded]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  return (
    <div
      style={{
        position: 'relative',
        border: `1px dashed ${isDragging ? 'var(--color-accent)' : 'var(--color-border-light)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: 24,
        textAlign: 'center',
        background: isDragging
          ? 'var(--color-accent-dim)'
          : 'var(--color-surface-light)',
        transition: 'all 0.15s',
        cursor: 'pointer',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'none',
          border: 'none',
          color: 'var(--color-text-dim)',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
        }}
      >
        <X size={16} />
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        onChange={handleChange}
        style={{ display: 'none' }}
      />

      {uploading ? (
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
          <div
            style={{
              width: 36,
              height: 36,
              border: '2px solid var(--color-border)',
              borderTopColor: 'var(--color-accent)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          Uploading...
        </div>
      ) : (
        <>
          <div style={{ color: 'var(--color-text-dim)', marginBottom: 8 }}>
            {isDragging ? (
              <FileText size={28} style={{ color: 'var(--color-accent)' }} />
            ) : (
              <Upload size={28} />
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {isDragging
              ? 'Drop file here'
              : 'Drag & drop or click to browse'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 4 }}>
            Images, text, PDF, code files
          </div>
        </>
      )}

      {error && (
        <div style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}