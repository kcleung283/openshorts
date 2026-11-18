import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Move } from 'lucide-react';
import Modal from './ui/Modal';
import SegmentedControl from './ui/SegmentedControl';
import { apiFetch, apiJson } from '../lib/api';
import { getApiUrl } from '../config';

const TRACK_MODES = [
  { value: 'hook', label: 'text / hook' },
  { value: 'logo', label: 'logo' },
];

const DEFAULT_BOX = { w: 0.85, h: 0.09 };

function slotKey(mode, faceId) {
  return `${mode}-${faceId}`;
}

function defaultPrompt(mode, face) {
  const who = face?.label || 'this person';
  return mode === 'hook' ? `text above ${who}` : `logo above ${who}`;
}

function emptySlot(mode, face, hookSeed = '') {
  return {
    prompt: defaultPrompt(mode, face),
    hookText: hookSeed,
    center: null,
    box: { ...DEFAULT_BOX },
    deliverable: null,
    ready: false,
  };
}

function clamp01(n) {
  return Math.min(0.98, Math.max(0.02, n));
}

function ResizableFaceBracket({ face, selected, onSelect, onChange, stageRef }) {
  const drag = useRef(null);

  const rectFromEvent = (ev) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const r = stage.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width,
      y: (ev.clientY - r.top) / r.height,
    };
  };

  const onPointerDown = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const start = rectFromEvent(e);
    if (!start) return;
    const origin = { x0: face.x0, y0: face.y0, x1: face.x1, y1: face.y1 };
    drag.current = { mode, start, origin };
    const move = (ev) => {
      if (!drag.current) return;
      const p = rectFromEvent(ev);
      if (!p) return;
      const { mode: m, start: s, origin: o } = drag.current;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      let { x0, y0, x1, y1 } = o;
      if (m === 'move') {
        const w = x1 - x0;
        const h = y1 - y0;
        x0 = clamp01(x0 + dx);
        y0 = clamp01(y0 + dy);
        x1 = clamp01(x0 + w);
        y1 = clamp01(y0 + h);
        if (x1 > 1) { x0 -= x1 - 1; x1 = 1; }
        if (y1 > 1) { y0 -= y1 - 1; y1 = 1; }
      } else {
        x1 = clamp01(o.x1 + dx);
        y1 = clamp01(o.y1 + dy);
        if (x1 < x0 + 0.04) x1 = x0 + 0.04;
        if (y1 < y0 + 0.04) y1 = y0 + 0.04;
      }
      onChange(face.id, { x0, y0, x1, y1 });
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const border = selected ? 'border-brass' : 'border-white/50';
  return (
    <div
      className={`absolute border-2 border-dashed ${border} bg-brass/5 touch-none`}
      style={{
        left: `${face.x0 * 100}%`,
        top: `${face.y0 * 100}%`,
        width: `${(face.x1 - face.x0) * 100}%`,
        height: `${(face.y1 - face.y0) * 100}%`,
      }}
      onPointerDown={(e) => { onSelect(face.id); onPointerDown(e, 'move'); }}
      role="button"
      tabIndex={0}
    >
      <span className="absolute -top-4 left-0 text-[9px] lowercase text-paper bg-ink/80 px-1 rounded pointer-events-none">
        {face.label}{selected ? ' · editing' : ''}
      </span>
      <div
        className="absolute right-0 bottom-0 w-3 h-3 bg-brass rounded-tl cursor-se-resize"
        onPointerDown={(e) => { e.stopPropagation(); onSelect(face.id); onPointerDown(e, 'resize'); }}
        title="Drag to enlarge focus area"
      />
    </div>
  );
}

function OverlayMarker({ center, box, border, label, onMove, stageRef }) {
  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const move = (ev) => {
      const rect = stage.getBoundingClientRect();
      onMove(clamp01((ev.clientX - rect.left) / rect.width), clamp01((ev.clientY - rect.top) / rect.height));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e);
  };

  if (!center) return null;
  return (
    <button
      type="button"
      className={`absolute rounded touch-none cursor-grab border-2 ${border} bg-paper/50 text-[10px] lowercase px-1 py-0.5 z-20`}
      style={{
        left: `${(center.x - box.w / 2) * 100}%`,
        top: `${(center.y - box.h / 2) * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
      }}
      onPointerDown={onPointerDown}
    >
      <Move size={12} className="inline" />
      {' '}{label}
    </button>
  );
}

export default function OverlayPlacementModal({
  open,
  onClose,
  jobId,
  clipIndex,
  videoUrl,
  serverVideoFile,
  hookText: initialHookText,
  onAppliedVideo,
}) {
  const [trackMode, setTrackMode] = useState('hook');
  const [focusByMode, setFocusByMode] = useState({ hook: 0, logo: 0 });
  const [slots, setSlots] = useState({});
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const [prompt, setPrompt] = useState('text above this person');
  const [hookText, setHookText] = useState(initialHookText || '');
  const [faces, setFaces] = useState([]);
  const [overlayCenter, setOverlayCenter] = useState(null);
  const [overlayBox, setOverlayBox] = useState({ ...DEFAULT_BOX });
  const [deliverable, setDeliverable] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [hasLogo, setHasLogo] = useState(false);
  const [analysisVideoUrl, setAnalysisVideoUrl] = useState(null);
  const [analysisWide, setAnalysisWide] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const suggestTimer = useRef(null);
  const stageRef = useRef(null);
  const facesRef = useRef(faces);
  facesRef.current = faces;
  const hookSeedRef = useRef(initialHookText || '');

  const activeFaceId = focusByMode[trackMode];

  const persistCurrentSlot = useCallback((patch = {}) => {
    const mode = patch.mode ?? trackMode;
    const faceId = patch.faceId ?? focusByMode[mode];
    const key = slotKey(mode, faceId);
    setSlots((prev) => ({
      ...prev,
      [key]: {
        prompt: patch.prompt ?? prompt,
        hookText: patch.hookText ?? hookText,
        center: patch.center !== undefined ? patch.center : overlayCenter,
        box: patch.box ?? overlayBox,
        deliverable: patch.deliverable !== undefined ? patch.deliverable : deliverable,
        ready: patch.ready ?? Boolean(patch.center !== undefined ? patch.center : overlayCenter),
      },
    }));
  }, [deliverable, focusByMode, hookText, overlayBox, overlayCenter, prompt, trackMode]);

  const applySlotToUi = useCallback((slot) => {
    if (!slot) return false;
    setPrompt(slot.prompt);
    setHookText(slot.hookText);
    setOverlayCenter(slot.center);
    setOverlayBox(slot.box || { ...DEFAULT_BOX });
    setDeliverable(slot.deliverable);
    return slot.ready;
  }, []);

  const ensureSlotsForFaces = useCallback((faceList, mode) => {
    if (!faceList?.length) return;
    setSlots((prev) => {
      const next = { ...prev };
      faceList.forEach((f, i) => {
        const hKey = slotKey('hook', f.id);
        const lKey = slotKey('logo', f.id);
        if (!next[hKey]) {
          next[hKey] = emptySlot('hook', f, i === 0 ? hookSeedRef.current : '');
        }
        if (!next[lKey]) {
          next[lKey] = emptySlot('logo', f);
        }
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setErr('');
    hookSeedRef.current = initialHookText || '';
    setSlots({});
    setFocusByMode({ hook: 0, logo: 0 });
    setPrompt(defaultPrompt('hook', null));
    setHookText(initialHookText || '');
    setOverlayCenter(null);
    setDeliverable(null);
    apiJson('/api/brand-watermark').then((s) => {
      const ok = Boolean(s?.logo_filename);
      setHasLogo(ok);
      if (ok) {
        setLogoUrl(getApiUrl(`/api/brand-watermark/preview-logo?r=${s.logo_revision || 0}`));
      }
    }).catch(() => {});
  }, [open, initialHookText]);

  const suggest = useCallback(async (opts = {}) => {
    const mode = opts.mode ?? trackMode;
    const faceId = opts.faceId ?? focusByMode[mode];
    const overrides = opts.faces ?? facesRef.current;
    const key = slotKey(mode, faceId);
    const saved = slotsRef.current[key];
    const center = opts.center ?? saved?.center ?? overlayCenter;
    const usePrompt = opts.prompt ?? saved?.prompt ?? prompt;
    const useHookText = opts.hookText ?? saved?.hookText ?? hookText;
    setBusy('suggest');
    setErr('');
    const body = {
      job_id: jobId,
      clip_index: clipIndex,
      input_filename: serverVideoFile,
      target: mode,
      hook_face_id: faceId,
      logo_face_id: faceId,
      face_overrides: overrides.map((f) => ({
        id: f.id, x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1,
      })),
      hook_text: mode === 'hook' ? (useHookText || 'Hook') : undefined,
    };
    if (mode === 'hook') {
      body.hook_prompt = usePrompt;
      if (center) {
        body.hook_center_x = center.x;
        body.hook_center_y = center.y;
      }
    } else {
      body.logo_prompt = usePrompt;
      if (center) {
        body.logo_center_x = center.x;
        body.logo_center_y = center.y;
      }
    }
    try {
      const res = await apiFetch('/api/overlay-placement/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.analysis_video_url) {
        setAnalysisVideoUrl(data.analysis_video_url);
        setAnalysisWide(data.analysis_video_url.includes('temp_preview_'));
      }
      if (Array.isArray(data.faces)) {
        setFaces(data.faces);
        ensureSlotsForFaces(data.faces, mode);
      }
      const placement = mode === 'hook' ? data.hook : data.logo;
      const del = mode === 'hook' ? data.deliverable_hook : data.deliverable_logo;
      const nextCenter = placement
        ? { x: placement.center_x, y: placement.center_y }
        : center;
      const nextBox = placement
        ? { w: placement.w_frac, h: placement.h_frac }
        : overlayBox;
      const face = data.faces?.find((f) => f.id === faceId);
      const slot = {
        prompt: usePrompt || defaultPrompt(mode, face),
        hookText: useHookText,
        center: nextCenter,
        box: nextBox,
        deliverable: del || placement || null,
        ready: Boolean(nextCenter),
      };
      setSlots((prev) => ({ ...prev, [key]: slot }));
      if (faceId === focusByMode[mode] && mode === trackMode) {
        applySlotToUi(slot);
      }
      if (!data.faces?.length) {
        setErr('No faces detected — enlarge a bracket or try reframing first.');
      }
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setBusy('');
    }
  }, [
    applySlotToUi,
    clipIndex,
    ensureSlotsForFaces,
    focusByMode,
    hookText,
    jobId,
    overlayBox,
    overlayCenter,
    prompt,
    serverVideoFile,
    trackMode,
  ]);

  const scheduleSuggest = useCallback((opts) => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(() => suggest(opts), 400);
  }, [suggest]);

  useEffect(() => {
    if (!open) return;
    suggest({ mode: 'hook', faceId: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const switchToFace = useCallback((id) => {
    persistCurrentSlot({ faceId: activeFaceId, mode: trackMode });
    setFocusByMode((prev) => ({ ...prev, [trackMode]: id }));
    const key = slotKey(trackMode, id);
    const saved = slotsRef.current[key];
    const face = facesRef.current.find((f) => f.id === id);
    if (saved?.ready) {
      applySlotToUi(saved);
    } else if (saved) {
      applySlotToUi(saved);
      suggest({ faceId: id, prompt: saved.prompt, hookText: saved.hookText });
    } else {
      const fresh = emptySlot(trackMode, face, trackMode === 'hook' && id === 0 ? hookSeedRef.current : '');
      setSlots((prev) => ({ ...prev, [key]: fresh }));
      applySlotToUi(fresh);
      suggest({ faceId: id, prompt: fresh.prompt, hookText: fresh.hookText });
    }
  }, [activeFaceId, applySlotToUi, persistCurrentSlot, suggest, trackMode]);

  const switchTrackMode = useCallback((mode) => {
    persistCurrentSlot({ mode: trackMode, faceId: activeFaceId });
    setTrackMode(mode);
    const faceId = focusByMode[mode];
    const key = slotKey(mode, faceId);
    const saved = slotsRef.current[key];
    const face = facesRef.current.find((f) => f.id === faceId);
    if (saved?.ready) {
      applySlotToUi(saved);
    } else if (saved) {
      applySlotToUi(saved);
      suggest({ mode, faceId, prompt: saved.prompt, hookText: saved.hookText });
    } else if (face) {
      const fresh = emptySlot(mode, face, mode === 'hook' && faceId === 0 ? hookSeedRef.current : '');
      setSlots((prev) => ({ ...prev, [key]: fresh }));
      applySlotToUi(fresh);
      suggest({ mode, faceId, prompt: fresh.prompt, hookText: fresh.hookText });
    } else {
      suggest({ mode, faceId: 0 });
    }
  }, [activeFaceId, applySlotToUi, focusByMode, persistCurrentSlot, suggest, trackMode]);

  const onFaceChange = (id, box) => {
    const next = faces.map((f) => (f.id === id ? {
      ...f,
      ...box,
      center_x: (box.x0 + box.x1) / 2,
      center_y: (box.y0 + box.y1) / 2,
    } : f));
    setFaces(next);
    if (id !== activeFaceId) switchToFace(id);
    scheduleSuggest({ faceId: id, faces: next });
  };

  const updatePrompt = (value) => {
    setPrompt(value);
    persistCurrentSlot({ prompt: value, ready: Boolean(overlayCenter) });
    scheduleSuggest({ prompt: value, faceId: activeFaceId });
  };

  const updateHookText = (value) => {
    setHookText(value);
    persistCurrentSlot({ hookText: value, ready: Boolean(overlayCenter) });
    if (trackMode === 'hook') {
      scheduleSuggest({ hookText: value, faceId: activeFaceId });
    }
  };

  const apply = async () => {
    persistCurrentSlot();
    const key = slotKey(trackMode, activeFaceId);
    const slot = slotsRef.current[key];
    const center = slot?.center ?? overlayCenter;
    const del = slot?.deliverable ?? deliverable;
    const usePrompt = slot?.prompt ?? prompt;
    const useHookText = slot?.hookText ?? hookText;

    if (!center) {
      setErr('Run suggest or drag the overlay marker first.');
      return;
    }
    if (trackMode === 'hook' && !(useHookText || '').trim()) {
      setErr('Enter the hook text for this person.');
      return;
    }
    if (trackMode === 'logo' && !hasLogo) {
      setErr('Upload a logo in brand logo or settings first.');
      return;
    }
    setBusy('apply');
    setErr('');
    const cx = del?.center_x ?? center.x;
    const cy = del?.center_y ?? center.y;
    try {
      const res = await apiFetch(
        trackMode === 'hook' ? '/api/hook' : '/api/brand-watermark/apply',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trackMode === 'hook' ? {
            job_id: jobId,
            clip_index: clipIndex,
            text: useHookText,
            position: 'custom',
            center_x: cx,
            center_y: cy,
            placement_prompt: usePrompt,
            input_filename: serverVideoFile,
          } : {
            job_id: jobId,
            clip_index: clipIndex,
            center_x: cx,
            center_y: cy,
            placement_prompt: usePrompt,
            input_filename: serverVideoFile,
          }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      onAppliedVideo?.(data);
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setBusy('');
    }
  };

  const videoSrc = getApiUrl(analysisVideoUrl || videoUrl || '');
  const isHook = trackMode === 'hook';
  const activeFace = faces.find((f) => f.id === activeFaceId);

  return (
    <Modal isOpen={open} onClose={onClose} eyebrow="EDITOR" title="face track & place" size="lg">
      <p className="text-muted text-sm mb-3 lowercase">
        Text and logo are saved <strong>per person</strong> — pick someone, set their placement, then switch to another person for a different position.
      </p>

      <SegmentedControl
        options={TRACK_MODES}
        value={trackMode}
        onChange={switchTrackMode}
        className="mb-4"
      />

      {activeFace && (
        <p className="text-xs text-brass mb-2 lowercase">
          editing {isHook ? 'text' : 'logo'} for <strong>{activeFace.label}</strong>
          {focusByMode.hook !== focusByMode.logo && (
            <span className="text-muted">
              {' '}(text tracks {faces.find((f) => f.id === focusByMode.hook)?.label || '—'};
              logo tracks {faces.find((f) => f.id === focusByMode.logo)?.label || '—'})
            </span>
          )}
        </p>
      )}

      {isHook ? (
        <label className="text-xs text-muted lowercase block mb-1">
          hook text (this person only)
          <input
            type="text"
            className="block w-full mt-1 text-sm bg-paper2 border border-rule rounded-input p-2"
            value={hookText}
            onChange={(e) => updateHookText(e.target.value)}
            placeholder="What to burn near this face"
          />
        </label>
      ) : (
        <p className="text-xs text-muted mb-2 lowercase">
          {hasLogo ? 'Logo from your brand settings — position is per person.' : 'Upload a logo under brand logo first.'}
        </p>
      )}

      <label className="text-xs text-muted lowercase block mb-1 mt-2">placement prompt (this person only)</label>
      <textarea
        className="w-full text-sm bg-paper2 border border-rule rounded-input p-2 mb-2 lowercase"
        rows={2}
        value={prompt}
        onChange={(e) => updatePrompt(e.target.value)}
        placeholder={isHook ? 'e.g. above their head' : 'e.g. on their shoulder'}
      />

      {faces.length > 1 && (
        <label className="text-xs lowercase block mb-2">
          focus person (for {isHook ? 'text' : 'logo'})
          <select
            className="block w-full mt-1 text-sm bg-paper2 border border-rule rounded-input p-2"
            value={activeFaceId}
            onChange={(e) => switchToFace(Number(e.target.value))}
          >
            {faces.map((f) => {
              const sk = slots[slotKey(trackMode, f.id)];
              const tag = sk?.ready ? ' · placed' : '';
              return (
                <option key={f.id} value={f.id}>{f.label}{tag}</option>
              );
            })}
          </select>
        </label>
      )}

      <button
        type="button"
        className="btn-ghost text-sm mb-3"
        disabled={!!busy}
        onClick={() => suggest({ faceId: activeFaceId, prompt, hookText })}
      >
        {busy === 'suggest' ? <Loader2 size={14} className="animate-spin inline" /> : null}
        {' '}suggest for {activeFace?.label || 'person'}
      </button>

      {videoSrc && (
        <div
          ref={stageRef}
          className={`relative mx-auto w-full bg-paper3 rounded-card overflow-hidden border border-rule mb-3 ${
            analysisWide ? 'max-w-[360px] aspect-video' : 'max-w-[280px] aspect-[9/16]'
          }`}
        >
          <video src={videoSrc} className="w-full h-full object-contain bg-black" muted playsInline />
          {faces.map((f) => (
            <ResizableFaceBracket
              key={f.id}
              face={f}
              selected={f.id === activeFaceId}
              onSelect={switchToFace}
              onChange={onFaceChange}
              stageRef={stageRef}
            />
          ))}
          <OverlayMarker
            center={overlayCenter}
            box={overlayBox}
            border={isHook ? 'border-yellow-400' : 'border-sky-400'}
            label={isHook ? 'text' : 'logo'}
            stageRef={stageRef}
            onMove={(x, y) => {
              const c = { x, y };
              setOverlayCenter(c);
              persistCurrentSlot({ center: c, ready: true });
              scheduleSuggest({ center: c, faceId: activeFaceId });
            }}
          />
          {!isHook && logoUrl && overlayCenter && (
            <img
              src={logoUrl}
              alt=""
              className="absolute pointer-events-none opacity-90 z-10"
              style={{
                left: `${(overlayCenter.x - overlayBox.w / 2) * 100}%`,
                top: `${(overlayCenter.y - overlayBox.h / 2) * 100}%`,
                width: `${overlayBox.w * 100}%`,
              }}
            />
          )}
        </div>
      )}

      <p className="text-muted text-xs mb-2 lowercase">
        each person keeps their own bracket, prompt, and overlay — switch people without losing the other
      </p>

      {err && <p className="text-danger text-sm mb-2">{err}</p>}

      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={onClose}>close</button>
        <button type="button" className="btn-primary text-sm" disabled={!!busy} onClick={apply}>
          {busy === 'apply' ? <Loader2 size={14} className="animate-spin inline" /> : null}
          {' '}burn {isHook ? 'text' : 'logo'} on {activeFace?.label || 'person'}
        </button>
      </div>
    </Modal>
  );
}