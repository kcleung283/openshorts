import React, { useEffect, useState } from 'react';
import { Loader2, Layers, Plus, Trash2, Sparkles } from 'lucide-react';
import { apiJson } from '../lib/api';

const emptyRow = () => ({ type: 'zoom_pulse', start: '0', end: '0.6', strength: '' });

/** Combine multiple finished clips into one reel (Ollama order + optional music URL). */
export default function SelfHostMashupTab() {
  const [jobA, setJobA] = useState('');
  const [clipA, setClipA] = useState('0');
  const [jobB, setJobB] = useState('');
  const [clipB, setClipB] = useState('1');
  const [jobC, setJobC] = useState('');
  const [clipC, setClipC] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [musicNote, setMusicNote] = useState('expedia hype, kick on transitions');
  const [effectTypes, setEffectTypes] = useState([]);
  const [timeline, setTimeline] = useState([emptyRow()]);
  const [autoBeats, setAutoBeats] = useState(false);
  const [beatsFrom, setBeatsFrom] = useState('music');
  const [beatEffect, setBeatEffect] = useState('zoom_pulse');
  const [effectsAtJoins, setEffectsAtJoins] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiJson('/api/self-host/mashup/effects')
      .then((d) => setEffectTypes(d.effects || []))
      .catch(() => {});
  }, []);

  const suggestBeats = async () => {
    if (!musicUrl.trim()) {
      setErr('Add a music URL to suggest beats (or enable auto beats on render).');
      return;
    }
    setErr('');
    try {
      const d = await apiJson('/api/self-host/mashup/suggest-beats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          music_url: musicUrl.trim(),
          effect_type: beatEffect,
          effect_duration: 0.55,
        }),
      });
      const rows = (d.suggestions || []).map((s) => ({
        type: s.type,
        start: String(s.start),
        end: String(s.end),
        strength: s.strength != null ? String(s.strength) : '',
      }));
      if (rows.length) setTimeline(rows);
    } catch (e) {
      setErr(String(e.message || e));
    }
  };

  const run = async () => {
    setBusy(true);
    setErr('');
    setResult(null);
    const sources = [
      { type: 'job_clip', job_id: jobA.trim(), clip_index: parseInt(clipA, 10) || 0 },
      { type: 'job_clip', job_id: jobB.trim(), clip_index: parseInt(clipB, 10) || 0 },
    ];
    if (jobC.trim()) {
      sources.push({
        type: 'job_clip',
        job_id: jobC.trim(),
        clip_index: parseInt(clipC, 10) || 0,
      });
    }
    const tl = timeline
      .map((row) => {
        const start = parseFloat(row.start);
        const end = parseFloat(row.end);
        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
        const out = { type: row.type, start, end };
        if (row.strength !== '') {
          const st = parseFloat(row.strength);
          if (!Number.isNaN(st)) out.strength = st;
        }
        return out;
      })
      .filter(Boolean);
    try {
      const data = await apiJson('/api/self-host/mashup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          music_url: musicUrl.trim() || null,
          music_note: musicNote,
          timeline: tl.length ? tl : null,
          auto_beats: autoBeats,
          beats_from: beatsFrom,
          beat_effect: beatEffect,
          effects_at_joins: effectsAtJoins,
          join_effect: beatEffect,
        }),
      });
      setResult(data);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 max-w-2xl mx-auto animate-fade">
      <p className="eyebrow mb-1.5">mashup</p>
      <h1 className="font-display lowercase text-2xl text-ink mb-2">Combine clips</h1>
      <p className="text-muted text-sm mb-6 leading-relaxed">
        Stitch 2–3 clips from History. You choose effect type and timing (zoom, flash, color pop, …).
        Optional music: suggest beats or check auto beats — nothing is hardcoded.
      </p>

      <div className="space-y-3 mb-4">
        <p className="eyebrow">clip A</p>
        <input className="input-field" placeholder="job id" value={jobA} onChange={(e) => setJobA(e.target.value)} />
        <input className="input-field !w-24" type="number" min={0} value={clipA} onChange={(e) => setClipA(e.target.value)} />
        <p className="eyebrow mt-2">clip B</p>
        <input className="input-field" placeholder="job id" value={jobB} onChange={(e) => setJobB(e.target.value)} />
        <input className="input-field !w-24" type="number" min={0} value={clipB} onChange={(e) => setClipB(e.target.value)} />
        <p className="eyebrow mt-2">clip C (optional)</p>
        <input className="input-field" placeholder="job id" value={jobC} onChange={(e) => setJobC(e.target.value)} />
        <input className="input-field !w-24" type="number" min={0} value={clipC} onChange={(e) => setClipC(e.target.value)} />
        <p className="eyebrow mt-4">music URL (mp3/m4a, optional)</p>
        <input className="input-field" value={musicUrl} onChange={(e) => setMusicUrl(e.target.value)} placeholder="https://..." />
        <textarea className="input-field min-h-[3rem]" value={musicNote} onChange={(e) => setMusicNote(e.target.value)} />
      </div>

      <section className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="eyebrow">effect timeline (seconds)</p>
          <button type="button" className="text-brass text-xs lowercase flex items-center gap-1" onClick={suggestBeats}>
            <Sparkles size={14} /> suggest beats
          </button>
        </div>
        {timeline.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr,4rem,4rem,4rem,auto] gap-2 mb-2 items-center">
            <select
              className="input-field"
              value={row.type}
              onChange={(e) => {
                const next = [...timeline];
                next[i] = { ...row, type: e.target.value };
                setTimeline(next);
              }}
            >
              {(effectTypes.length ? effectTypes : [{ type: 'zoom_pulse' }]).map((ef) => (
                <option key={ef.type} value={ef.type}>{ef.type}</option>
              ))}
            </select>
            <input
              className="input-field"
              placeholder="start"
              value={row.start}
              onChange={(e) => {
                const next = [...timeline];
                next[i] = { ...row, start: e.target.value };
                setTimeline(next);
              }}
            />
            <input
              className="input-field"
              placeholder="end"
              value={row.end}
              onChange={(e) => {
                const next = [...timeline];
                next[i] = { ...row, end: e.target.value };
                setTimeline(next);
              }}
            />
            <input
              className="input-field"
              placeholder="str"
              title="strength (optional)"
              value={row.strength}
              onChange={(e) => {
                const next = [...timeline];
                next[i] = { ...row, strength: e.target.value };
                setTimeline(next);
              }}
            />
            <button
              type="button"
              className="text-muted hover:text-danger"
              onClick={() => setTimeline(timeline.filter((_, j) => j !== i))}
              aria-label="Remove row"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button type="button" className="text-sm text-brass lowercase flex items-center gap-1 mt-2" onClick={() => setTimeline([...timeline, emptyRow()])}>
          <Plus size={14} /> add moment
        </button>

        <div className="block mt-4 space-y-2 text-sm text-ink2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoBeats} onChange={(e) => setAutoBeats(e.target.checked)} />
            auto beats (merge with your rows; music or dialogue)
          </label>
          {autoBeats && (
            <label className="flex items-center gap-2">
              beats from
              <select className="input-field !w-auto" value={beatsFrom} onChange={(e) => setBeatsFrom(e.target.value)}>
                <option value="music">music bed</option>
                <option value="dialogue">mixed audio</option>
              </select>
              default effect
              <select className="input-field !w-auto" value={beatEffect} onChange={(e) => setBeatEffect(e.target.value)}>
                {(effectTypes.length ? effectTypes : [{ type: 'zoom_pulse' }]).map((ef) => (
                  <option key={ef.type} value={ef.type}>{ef.type}</option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={effectsAtJoins} onChange={(e) => setEffectsAtJoins(e.target.checked)} />
            effect at each clip join (same type as beat default)
          </label>
        </div>
      </section>

      <button
        type="button"
        onClick={run}
        disabled={busy || !jobA.trim() || !jobB.trim()}
        className="btn-primary lowercase"
      >
        {busy ? <Loader2 className="animate-spin inline" size={16} /> : <Layers className="inline" size={16} />}
        {' '}build mashup
      </button>

      {err && <p className="text-danger text-sm mt-4">{err}</p>}
      {result?.video_url && (
        <div className="mt-6">
          <video className="w-full max-w-sm rounded-card" controls src={result.video_url} />
          <p className="text-xs text-muted mt-2">
            order: {JSON.stringify(result.meta?.order)}
            {result.meta?.timeline?.length ? ` · ${result.meta.timeline.length} effects` : ''}
          </p>
        </div>
      )}
    </div>
  );
}