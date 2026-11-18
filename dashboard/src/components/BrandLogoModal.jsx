import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from './ui/Modal';
import BrandLogoPicker from './BrandLogoPicker';
import { apiFetch } from '../lib/api';
import { getApiUrl } from '../config';

/** Upload logo + position preview; applies to one clip via /api/brand-watermark/apply */
export default function BrandLogoModal({
  open, onClose, jobId, clipIndex, previewVideoUrl, onApplied,
}) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) setErr('');
  }, [open]);

  const apply = async () => {
    const position = settings?.position || 'bottom';
    if (!settings?.logo_filename) {
      setErr('Upload a PNG or JPG logo first.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await apiFetch('/api/brand-watermark/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          clip_index: clipIndex,
          position,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      onApplied?.(data);
      onClose();
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setBusy(false);
    }
  };

  const videoSrc = previewVideoUrl ? getApiUrl(previewVideoUrl) : null;

  return (
    <Modal isOpen={open} onClose={onClose} eyebrow="BRANDING" title="brand logo" size="md">
      <p className="text-muted text-sm mb-4 lowercase">
        PNG, JPG, or WebP. Centered horizontally — pick top, middle, or bottom.
      </p>

      {videoSrc && (
        <div className="relative mx-auto w-full max-w-[220px] aspect-[9/16] bg-paper3 rounded-card overflow-hidden border border-rule mb-4">
          <video src={videoSrc} className="w-full h-full object-cover" muted playsInline />
        </div>
      )}

      <BrandLogoPicker onSettingsChange={setSettings} />

      {err && <p className="text-danger text-sm mb-2">{err}</p>}

      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={onClose}>cancel</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={apply}>
          {busy ? <Loader2 size={16} className="animate-spin inline" /> : null}
          {' '}apply to clip
        </button>
      </div>
    </Modal>
  );
}