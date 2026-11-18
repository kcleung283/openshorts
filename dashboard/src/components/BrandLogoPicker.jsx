import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import SegmentedControl from './ui/SegmentedControl';
import { apiFetch, apiJson } from '../lib/api';
import { getApiUrl } from '../config';

const POSITIONS = [
  { value: 'top', label: 'top' },
  { value: 'middle', label: 'middle' },
  { value: 'bottom', label: 'bottom' },
];

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

function logoPreviewStyle(position) {
  const base = {
    left: '50%',
    maxWidth: '28%',
    position: 'absolute',
    pointerEvents: 'none',
    opacity: 0.9,
  };
  if (position === 'top') {
    return { ...base, top: '8%', transform: 'translateX(-50%)' };
  }
  if (position === 'middle') {
    return { ...base, top: '50%', transform: 'translate(-50%, -50%)' };
  }
  return { ...base, bottom: '10%', transform: 'translateX(-50%)' };
}

function isImageFile(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/') && type !== 'image/svg+xml') return true;
  return IMAGE_RE.test(file.name || '');
}

function pickImageFile(fileList) {
  if (!fileList?.length) return null;
  for (const f of fileList) {
    if (isImageFile(f)) return f;
  }
  return null;
}

/**
 * Upload brand logo + position preview. Persists to /api/brand-watermark.
 * Used on the generate form (before clips) and in Settings.
 */
export default function BrandLogoPicker({
  showAutoApply = false,
  autoApply = false,
  onAutoApplyChange,
  onSettingsChange,
}) {
  const [settings, setSettings] = useState(null);
  const [position, setPosition] = useState('bottom');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState('');
  const inputId = useId();
  const inputRef = useRef(null);
  const dragDepth = useRef(0);

  const applySettings = useCallback((s) => {
    setSettings(s);
    if (s?.position) setPosition(s.position);
    onSettingsChange?.(s);
  }, [onSettingsChange]);

  const load = () => {
    apiJson('/api/brand-watermark').then(applySettings).catch(() => setErr('Could not load logo settings.'));
  };

  useEffect(() => {
    load();
    const onClear = () => load();
    window.addEventListener('os-brand-logo-cleared', onClear);
    return () => window.removeEventListener('os-brand-logo-cleared', onClear);
  }, []);

  const uploadFile = useCallback(async (file) => {
    if (!file) return;
    if (!isImageFile(file)) {
      setErr('Use PNG, JPG, WebP, or GIF.');
      return;
    }
    setUploading(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch('/api/brand-watermark/logo', { method: 'POST', body: fd });
      if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
          const j = JSON.parse(text);
          if (typeof j.detail === 'string') msg = j.detail;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      const body = await res.json();
      applySettings(body);
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setUploading(false);
    }
  }, [applySettings]);

  const onUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  const stopDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDragEnter = (e) => {
    stopDrag(e);
    dragDepth.current += 1;
    setDragOver(true);
  };

  const onDragLeave = (e) => {
    stopDrag(e);
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const onDropFiles = (e) => {
    stopDrag(e);
    dragDepth.current = 0;
    setDragOver(false);
    const file = pickImageFile(e.dataTransfer?.files);
    if (!file) {
      setErr('Drop a PNG or JPG image file.');
      return;
    }
    uploadFile(file);
  };

  const savePosition = async (pos) => {
    setPosition(pos);
    try {
      const body = await apiJson('/api/brand-watermark', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: pos }),
      });
      applySettings(body);
    } catch {
      setErr('Could not save position.');
    }
  };

  const removeLogo = async () => {
    setUploading(true);
    setErr('');
    try {
      const res = await apiFetch('/api/brand-watermark/logo', { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      applySettings(body);
      onAutoApplyChange?.(false);
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setUploading(false);
    }
  };

  const hasLogo = Boolean(settings?.logo_filename);
  const previewRev = settings?.logo_revision ?? 0;

  return (
    <div
      className="brand-logo-picker"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => e.stopPropagation()}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragEnter}
        onDrop={onDropFiles}
        className={`border-2 border-dashed rounded-card p-4 text-center transition-colors mb-3 cursor-pointer
          ${dragOver ? 'border-brass bg-paper3' : 'border-rule2 hover:border-brass'}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
          className="sr-only"
          id={inputId}
          onChange={onUpload}
        />
        {uploading ? (
          <Loader2 size={22} className="animate-spin mx-auto mb-2 text-brass" />
        ) : (
          <Upload size={22} className="mx-auto mb-2 text-muted" />
        )}
        <p className="text-sm text-ink2 lowercase">
          {hasLogo ? `logo ready — drop or click to replace (${settings.logo_filename})` : 'drop logo here or click to upload'}
        </p>
        <p className="readout mt-1">PNG · JPG · WebP · GIF</p>
      </div>

      <p className="text-xs text-muted mb-2 lowercase">position on clip</p>
      <SegmentedControl options={POSITIONS} value={position} onChange={savePosition} className="mb-3" />

      <div className="relative mx-auto w-full max-w-[160px] aspect-[9/16] bg-paper3 rounded-card overflow-hidden border border-rule mb-2">
        <div className="absolute inset-0 bg-gradient-to-b from-paper2 to-paper3" />
        {hasLogo && (
          <img
            key={`${previewRev}-${position}`}
            src={getApiUrl(`/api/brand-watermark/preview-logo?rev=${previewRev}`)}
            alt=""
            style={logoPreviewStyle(position)}
          />
        )}
      </div>
      <p className="text-[11px] text-muted leading-relaxed mb-2">
        Preview updates when you change top, middle, or bottom.
      </p>

      {hasLogo && (
        <button
          type="button"
          className="btn-ghost text-xs lowercase mb-3 w-full"
          disabled={uploading}
          onClick={removeLogo}
        >
          remove logo
        </button>
      )}

      {showAutoApply && (
        <label
          className={`flex items-start gap-2 text-xs text-ink2 cursor-pointer select-none ${!hasLogo ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input
            type="checkbox"
            checked={autoApply && hasLogo}
            disabled={!hasLogo}
            onChange={(e) => onAutoApplyChange?.(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--color-accent)] cursor-pointer disabled:cursor-not-allowed"
          />
          <span>
            Burn this logo on every clip when rendering
            <span className="block text-[11px] text-muted mt-0.5">
              You can still tweak or remove it per clip after they appear.
            </span>
          </span>
        </label>
      )}

      {err && <p className="text-danger text-sm mt-2">{err}</p>}
    </div>
  );
}