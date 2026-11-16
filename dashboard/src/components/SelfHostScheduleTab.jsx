import React, { useEffect, useState } from 'react';
import { Loader2, Clock } from 'lucide-react';
import { apiJson, apiFetch } from '../lib/api';

/** Self-host: queue clips to YouTube + Instagram every N hours (America/New_York). */
export default function SelfHostScheduleTab() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    apiJson('/api/self-host/schedule')
      .then(setCfg)
      .catch(() => setMsg('Could not load schedule settings.'));
  };

  useEffect(() => { load(); }, []);

  const save = async (patch) => {
    setSaving(true);
    setMsg('');
    try {
      const res = await apiFetch('/api/self-host/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      setCfg(body);
      setMsg('Saved.');
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brass" /></div>;
  }

  const platforms = cfg.platforms || [];
  const backend = cfg.posting_backend || 'manual';

  return (
    <div className="h-full overflow-y-auto p-8 max-w-2xl mx-auto animate-fade">
      <p className="eyebrow mb-1.5">schedule</p>
      <h1 className="font-display lowercase text-2xl text-ink mb-2">Auto posting</h1>
      <p className="text-muted text-sm mb-6 leading-relaxed">
        Posts one queued clip every <strong className="text-ink2">{cfg.interval_hours || 2} hours</strong>{' '}
        in <strong className="text-ink2">{cfg.timezone || 'America/New_York'}</strong>.
      </p>

      <div className="card p-4 mb-4 text-sm text-ink2 leading-relaxed">
        <p className="eyebrow mb-2">posting backend</p>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="radio"
            name="posting_backend"
            checked={backend === 'manual'}
            onChange={() => save({ posting_backend: 'manual' })}
          />
          <span>
            <strong className="text-ink">Manual</strong> — no API key. When a slot is due, OpenShorts copies the clip
            into <code className="text-xs">data/ready_to_post/&lt;id&gt;/</code> with a manifest (title, platforms, time).
            You upload in YouTube Studio and the Instagram app yourself.
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="posting_backend"
            checked={backend === 'upload_post'}
            onChange={() => save({ posting_backend: 'upload_post' })}
            disabled={!cfg.upload_post_configured}
          />
          <span>
            <strong className="text-ink">Upload-Post</strong> — needs{' '}
            <code className="text-xs">UPLOAD_POST_API_KEY</code> + profile; OAuth for YT/IG on upload-post.com.
          </span>
        </label>
        {backend === 'manual' && cfg.ready_to_post_dir && (
          <p className="text-xs text-muted mt-3">Folder: {cfg.ready_to_post_dir}</p>
        )}
      </div>

      {backend === 'upload_post' && !cfg.upload_post_configured && (
        <p className="text-danger text-sm mb-4">
          Add <code className="text-xs">UPLOAD_POST_API_KEY</code> and <code className="text-xs">UPLOAD_POST_PROFILE</code> to
          your <code className="text-xs">.env</code>, then connect YouTube + Instagram in the Upload-Post dashboard.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm text-ink2 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={!!cfg.enabled}
          onChange={(e) => save({ ...cfg, enabled: e.target.checked })}
          disabled={saving}
        />
        Enable scheduled queue
      </label>

      <div className="grid gap-4 mb-6">
        <label className="block">
          <span className="eyebrow">interval (hours)</span>
          <input
            type="number"
            min={1}
            max={24}
            className="input-field mt-1"
            value={cfg.interval_hours ?? 2}
            onChange={(e) => setCfg({ ...cfg, interval_hours: Number(e.target.value) })}
            onBlur={() => save({ interval_hours: cfg.interval_hours })}
          />
        </label>
        <div>
          <span className="eyebrow block mb-2">platforms (for manifest labels)</span>
          {['youtube', 'instagram'].map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm lowercase mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={platforms.includes(p)}
                onChange={() => {
                  const next = platforms.includes(p)
                    ? platforms.filter((x) => x !== p)
                    : [...platforms, p];
                  save({ platforms: next });
                }}
              />
              {p}
            </label>
          ))}
        </div>
      </div>

      {cfg.queue?.length > 0 && (
        <section className="card p-4">
          <div className="flex items-center gap-2 text-sm text-ink2 mb-3">
            <Clock size={16} />
            Queue ({cfg.queue.length})
          </div>
          <ul className="text-xs text-muted space-y-2 max-h-48 overflow-y-auto">
            {cfg.queue.map((q) => (
              <li key={q.id}>
                {q.status}: job {q.job_id?.slice(0, 8)} clip {q.clip_index + 1} → {q.post_at_local}
              </li>
            ))}
          </ul>
        </section>
      )}

      {msg && <p className="text-sm text-muted mt-4">{msg}</p>}
    </div>
  );
}