import React, { useState, useEffect, useRef } from 'react';
import { Link2, Upload, FileVideo, FileAudio, X, Info, Loader2, ChevronDown } from 'lucide-react';
import { track } from '../lib/analytics';
import { getApiUrl } from '../config';
import SourceCost from './SourceCost';
import BrandLogoPicker from './BrandLogoPicker';

const SUPPORTED_PLATFORMS = [
    'YouTube', 'Vimeo', 'TikTok', 'X / Twitter', 'Twitch', 'Kick',
    'Facebook', 'Instagram', 'Dailymotion', 'Reddit', 'Streamable',
];

// Mirrors the server's MIN_SOURCE_SECONDS: shorter sources are rejected with a
// 400 after the whole file was uploaded. Checking the duration in the browser
// says so the moment the file is picked (a 27 s upload used to end in a bare
// "That run failed").
const MIN_SOURCE_SECONDS = 45;

function formatUploadLimitMb(mb) {
    if (mb == null) return '10GB';
    if (mb >= 1024) {
        const g = mb / 1024;
        return Number.isInteger(g) ? `${g}GB` : `${g.toFixed(1).replace(/\.0$/, '')}GB`;
    }
    return `${mb}MB`;
}

const VIDEO_NAME_RE = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const AUDIO_NAME_RE = /\.(mp3|m4a|wav|aac|flac|ogg)$/i;

function isVideoFile(f) {
    return Boolean(f && (f.type?.startsWith('video/') || VIDEO_NAME_RE.test(f.name || '')));
}

function isAudioFile(f) {
    return Boolean(f && (f.type?.startsWith('audio/') || AUDIO_NAME_RE.test(f.name || '')));
}

/** Local soundtrack: audio files or video containers we mux audio from (ffmpeg -vn). */
function isSoundtrackFile(f) {
    return Boolean(f && (isAudioFile(f) || /\.(mp4|mov|m4v)$/i.test(f.name || '')));
}

// Duration of a local video file in seconds, or null when the browser cannot
// read it (unsupported codec): then the server stays the judge.
/** Seconds offset from a YouTube ?t= / &t= param (self-host segment download). */
function youtubeTimestampSeconds(rawUrl) {
    try {
        const u = new URL(rawUrl.trim());
        const raw = u.searchParams.get('t') || u.searchParams.get('start');
        if (!raw) return null;
        if (/^\d+$/.test(raw)) return parseInt(raw, 10);
        const m = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/i);
        if (!m) return null;
        return (parseInt(m[1] || '0', 10) * 3600
            + parseInt(m[2] || '0', 10) * 60
            + parseInt(m[3] || '0', 10)) || null;
    } catch {
        return null;
    }
}

const readVideoDuration = (file) => new Promise((resolve) => {
    try {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        const done = (d) => { URL.revokeObjectURL(url); resolve(d); };
        v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
        v.onerror = () => done(null);
        setTimeout(() => done(null), 8000);
        v.src = url;
    } catch { resolve(null); }
});

export default function MediaInput({ onProcess, isProcessing }) {
    const [youtubeUrlEnabled, setYoutubeUrlEnabled] = useState(true);
    const [selfHostSegmentMin, setSelfHostSegmentMin] = useState(null);
    const [maxUploadMb, setMaxUploadMb] = useState(10240);
    // File upload is the primary path; the link is secondary.
    const [mode, setMode] = useState('file'); // 'file' | 'url' | 'multi'
    const [url, setUrl] = useState('');
    const [multiUrls, setMultiUrls] = useState('');
    const [musicUrl, setMusicUrl] = useState('');
    const [multiVideoFiles, setMultiVideoFiles] = useState([]);
    const [musicFile, setMusicFile] = useState(null);
    const [muteSource, setMuteSource] = useState(false);
    const [file, setFile] = useState(null);
    const [fileSeconds, setFileSeconds] = useState(null);
    const fileTooShort = fileSeconds != null && fileSeconds < MIN_SOURCE_SECONDS;
    const [acknowledged, setAcknowledged] = useState(false);
    // {start, end} in seconds when the user picked a stretch under the cost line.
    const [range, setRange] = useState(null);
    const [outputFormat, setOutputFormat] = useState('vertical'); // vertical | horizontal | square
    const [showInfo, setShowInfo] = useState(false);
    // Advanced generation controls — empty string means "let the AI decide",
    // which keeps the default pipeline behavior untouched.
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [targetClips, setTargetClips] = useState('');
    const [clipMinSeconds, setClipMinSeconds] = useState('');
    const [clipMaxSeconds, setClipMaxSeconds] = useState('');
    const [clipBrief, setClipBrief] = useState(() => {
        try { return localStorage.getItem('os_clip_brief') || ''; } catch { return ''; }
    });
    // Auto-hook: burn the AI hook text into every clip. On by default; the
    // choice persists so turning it off sticks across sessions.
    const [autoHook, setAutoHook] = useState(() => {
        try { return localStorage.getItem('os_auto_hook') !== '0'; } catch { return true; }
    });
    const [autoHookStyle, setAutoHookStyle] = useState(() => {
        // v2 key: the default became 'pill'; an old saved 'classic' was just the old default.
        try { return localStorage.getItem('os_auto_hook_style_v2') || 'pill'; } catch { return 'pill'; }
    });
    const [autoBrandLogo, setAutoBrandLogo] = useState(() => {
        try { return localStorage.getItem('os_auto_brand_logo') === '1'; } catch { return false; }
    });
    const [autoCaptions, setAutoCaptions] = useState(() => {
        try { return localStorage.getItem('os_auto_captions') === '1'; } catch { return false; }
    });
    const [englishCopy, setEnglishCopy] = useState(() => {
        try { return localStorage.getItem('os_english_copy') !== '0'; } catch { return true; }
    });
    const [brandLogoReady, setBrandLogoReady] = useState(false);
    // Layout: 'auto' lets the AI pick per video (server default); the others
    // force one on so a podcast host who knows what they uploaded doesn't
    // depend on the detector, and 'none' keeps the plain single crop.
    const [layout, setLayout] = useState(() => {
        try { return localStorage.getItem('os_layout') || 'auto'; } catch { return 'auto'; }
    });
    const infoRef = useRef(null);

    // Close the compatibility popover on any outside click.
    useEffect(() => {
        if (!showInfo) return;
        const onClick = (e) => {
            if (infoRef.current && !infoRef.current.contains(e.target)) setShowInfo(false);
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [showInfo]);

    useEffect(() => {
        let cancelled = false;
        setFileSeconds(null);
        if (!file) return undefined;
        readVideoDuration(file).then((d) => {
            if (cancelled) return;
            setFileSeconds(d);
            if (d != null && d < MIN_SOURCE_SECONDS) {
                track('SourceTooShort', { props: { seconds: String(Math.round(d)) } });
            }
        });
        return () => { cancelled = true; };
    }, [file]);

    useEffect(() => {
        fetch(getApiUrl('/api/config'))
            .then((r) => r.ok ? r.json() : null)
            .then((cfg) => {
                if (cfg && cfg.youtubeUrlEnabled === false) {
                    setYoutubeUrlEnabled(false);
                    setMode('file');
                }
                const seg = cfg?.selfHostYoutubeSegment?.minutes;
                if (seg != null) setSelfHostSegmentMin(seg);
                if (cfg?.maxUploadMb != null) setMaxUploadMb(cfg.maxUploadMb);
            })
            .catch(() => {});
    }, []);

    // A link pasted in the landing hero: preload it here so the user picks up
    // where they left off. Not auto-submitted — the rights attestation below
    // has to be ticked by the user.
    useEffect(() => {
        let pending = null;
        try {
            pending = localStorage.getItem('os_pending_url');
            if (pending) localStorage.removeItem('os_pending_url');
        } catch { /* ignore */ }
        if (pending) {
            setMode('url');
            setUrl(pending);
        }
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!acknowledged) return;
        const advanced = {
            targetClips: targetClips || null,
            clipMinSeconds: clipMinSeconds || null,
            clipMaxSeconds: clipMaxSeconds || null,
            autoHook,
            autoHookStyle,
            autoBrandLogo: brandLogoReady && autoBrandLogo,
            autoCaptions,
            englishCopy,
            layout,
            clipBrief: clipBrief.trim() || null,
            sourceStart: range ? Math.round(range.start) : null,
            sourceEnd: range ? Math.round(range.end) : null,
        };
        try {
            localStorage.setItem('os_auto_hook', autoHook ? '1' : '0');
            localStorage.setItem('os_auto_hook_style_v2', autoHookStyle);
            localStorage.setItem('os_auto_brand_logo', autoBrandLogo ? '1' : '0');
            localStorage.setItem('os_auto_captions', autoCaptions ? '1' : '0');
            localStorage.setItem('os_english_copy', englishCopy ? '1' : '0');
            localStorage.setItem('os_layout', layout);
            localStorage.setItem('os_clip_brief', clipBrief);
        } catch { /* ignore */ }
        if (mode === 'multi') {
            const videoUrls = multiUrls.split(/\n|,/).map((l) => l.trim()).filter(Boolean);
            if (videoUrls.length < 1 && multiVideoFiles.length < 1) return;
            onProcess({
                type: 'multi_compose',
                videoUrls,
                multiVideoFiles,
                musicFile,
                musicUrl: musicUrl.trim() || null,
                muteSource,
                acknowledged: true,
                outputFormat,
                ...advanced,
            });
        } else if (mode === 'url' && url) {
            onProcess({ type: 'url', payload: url, acknowledged: true, outputFormat, ...advanced });
        } else if (mode === 'file' && file && !fileTooShort) {
            onProcess({ type: 'file', payload: file, acknowledged: true, outputFormat, ...advanced });
        }
    };

    const multiUrlCount = multiUrls.split(/\n|,/).map((l) => l.trim()).filter(Boolean).length;
    const multiSourceCount = multiUrlCount + multiVideoFiles.length;
    const maxMultiVideos = 12;

    const addMultiVideoFiles = (incoming) => {
        const vids = [...incoming].filter(isVideoFile);
        if (!vids.length) return;
        setMultiVideoFiles((prev) => {
            const room = maxMultiVideos - multiUrlCount - prev.length;
            return [...prev, ...vids.slice(0, Math.max(0, room))];
        });
    };

    const handleMultiVideoDrop = (e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.length) addMultiVideoFiles(e.dataTransfer.files);
    };

    const handleMultiMusicDrop = (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (isSoundtrackFile(f)) setMusicFile(f);
    };

    const handleMultiPaneDrop = (e) => {
        e.preventDefault();
        const files = [...(e.dataTransfer.files || [])];
        const vids = files.filter(isVideoFile);
        const audios = files.filter(isAudioFile);
        if (vids.length) addMultiVideoFiles(vids);
        if (audios.length) setMusicFile(audios[0]);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        if (mode === 'multi') {
            handleMultiPaneDrop(e);
            return;
        }
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const f = e.dataTransfer.files[0];
            if (isVideoFile(f)) {
                setFile(f);
                setMode('file');
            }
        }
    };

    return (
        <div className="card p-4 sm:p-6 animate-fade">
            <div className="flex flex-nowrap gap-4 sm:gap-6 mb-6 border-b border-rule overflow-x-auto" data-tutorial="source-tabs">
                <button
                    onClick={() => setMode('file')}
                    className={`flex items-center gap-2 pb-3 px-1 -mb-px border-b-2 text-sm lowercase whitespace-nowrap transition-colors ${mode === 'file'
                        ? 'text-ink border-brass'
                        : 'text-muted border-transparent hover:text-ink2'
                        }`}
                >
                    <Upload size={16} className={`hidden sm:block ${mode === 'file' ? 'text-brass' : ''}`} />
                    Upload File
                </button>
                {youtubeUrlEnabled && (
                    <button
                        onClick={() => setMode('url')}
                        className={`flex items-center gap-2 pb-3 px-1 -mb-px border-b-2 text-sm lowercase whitespace-nowrap transition-colors ${mode === 'url'
                            ? 'text-ink border-brass'
                            : 'text-muted border-transparent hover:text-ink2'
                            }`}
                    >
                        <Link2 size={16} className={`hidden sm:block ${mode === 'url' ? 'text-brass' : ''}`} />
                        Video URL
                    </button>
                )}
                <button
                    onClick={() => setMode('multi')}
                    className={`flex items-center gap-2 pb-3 px-1 -mb-px border-b-2 text-sm lowercase whitespace-nowrap transition-colors ${mode === 'multi'
                        ? 'text-ink border-brass'
                        : 'text-muted border-transparent hover:text-ink2'
                        }`}
                >
                    <Upload size={16} className={`hidden sm:block ${mode === 'multi' ? 'text-brass' : ''}`} />
                    Multi-source
                </button>
            </div>

            <form
                onSubmit={handleSubmit}
                onDragOver={(e) => { if (mode === 'multi') e.preventDefault(); }}
                onDrop={(e) => {
                    if (mode !== 'multi') return;
                    e.preventDefault();
                    handleMultiPaneDrop(e);
                }}
            >
                {mode === 'multi' ? (
                    <div
                        className="space-y-4"
                        data-tutorial="drop-zone"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleMultiPaneDrop}
                    >
                        <div
                            className={`border-2 border-dashed rounded-card p-5 text-center transition-colors ${multiVideoFiles.length ? 'border-brass' : 'border-rule2 hover:border-brass'}`}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => { e.stopPropagation(); handleMultiVideoDrop(e); }}
                        >
                            <label className="cursor-pointer block">
                                <input
                                    type="file"
                                    accept="video/*,.mp4,.mov"
                                    multiple
                                    onChange={(e) => {
                                        if (e.target.files?.length) addMultiVideoFiles(e.target.files);
                                        e.target.value = '';
                                    }}
                                    className="hidden"
                                />
                                <Upload className="mx-auto mb-2 text-muted" size={18} />
                                <p className="text-ink2 lowercase text-sm">Drop MP4/MOV clips here or click to add</p>
                                <p className="readout mt-1">Local files are concatenated after any URLs below · up to {maxMultiVideos} total</p>
                            </label>
                            {multiVideoFiles.length > 0 && (
                                <ul className="mt-4 space-y-2 text-left">
                                    {multiVideoFiles.map((f, i) => (
                                        <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm min-w-0">
                                            <FileVideo size={16} className="shrink-0 text-ok" />
                                            <span className="truncate">{f.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => setMultiVideoFiles((prev) => prev.filter((_, j) => j !== i))}
                                                className="ml-auto p-1 text-muted hover:text-ink rounded-full"
                                                aria-label={`Remove ${f.name}`}
                                            >
                                                <X size={14} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div>
                            <p className="eyebrow mb-1.5">video URLs (optional, one per line)</p>
                            <textarea
                                value={multiUrls}
                                onChange={(e) => setMultiUrls(e.target.value)}
                                rows={4}
                                placeholder={youtubeUrlEnabled ? 'https://youtu.be/...\n(optional — mix with files above)' : '(optional — URLs disabled on this host)'}
                                className="input-field resize-y min-h-[5rem] text-sm font-mono"
                                disabled={!youtubeUrlEnabled}
                            />
                            <p className="text-xs text-muted mt-2 leading-relaxed">
                                URLs download first, then local files, in order. Short clips are fine — they are merged into
                                one timeline; viral moments are picked from the combined video (same rules as a long upload).
                                Use the clip brief below for hooks like &quot;shocking reveals&quot;.
                            </p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <p className="eyebrow mb-1.5">soundtrack — MP3 or MP4 (optional)</p>
                                <div
                                    className={`border-2 border-dashed rounded-card p-4 text-center transition-colors ${musicFile ? 'border-brass' : 'border-rule2 hover:border-brass'}`}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => { e.stopPropagation(); handleMultiMusicDrop(e); }}
                                >
                                    {musicFile ? (
                                        <div className="flex items-center justify-center gap-2 text-sm min-w-0">
                                            {isVideoFile(musicFile)
                                                ? <FileVideo size={16} className="shrink-0 text-ok" />
                                                : <FileAudio size={16} className="shrink-0 text-ok" />}
                                            <span className="truncate">{musicFile.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => setMusicFile(null)}
                                                className="p-1 text-muted hover:text-ink rounded-full"
                                                aria-label="Remove soundtrack"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ) : (
                                        <label className="cursor-pointer block">
                                            <input
                                                type="file"
                                                accept="audio/*,.mp3,.m4a,.wav,.mp4,.mov,.m4v"
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0];
                                                    setMusicFile(isSoundtrackFile(f) ? f : null);
                                                }}
                                                className="hidden"
                                            />
                                            <p className="text-ink2 lowercase text-sm">Drop an MP3 or MP4 here, or click to browse</p>
                                        </label>
                                    )}
                                </div>
                            </div>
                            <div>
                                <p className="eyebrow mb-1.5">soundtrack URL (optional)</p>
                                <input
                                    type="url"
                                    value={musicUrl}
                                    onChange={(e) => setMusicUrl(e.target.value)}
                                    placeholder="https://... (if no file)"
                                    className="input-field"
                                    disabled={!!musicFile}
                                />
                                {musicFile && (
                                    <p className="text-xs text-muted mt-1">Using uploaded audio; clear the file to use a URL instead.</p>
                                )}
                            </div>
                        </div>
                        <label className="flex items-start gap-2 text-sm text-ink2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={muteSource}
                                onChange={(e) => setMuteSource(e.target.checked)}
                                className="mt-1"
                            />
                            <span>
                                Mute original video audio before merge
                                <span className="block text-xs text-muted mt-0.5">
                                    When off, speech from the videos is transcribed; when on, rely on the soundtrack or
                                    visual analysis.
                                </span>
                            </span>
                        </label>
                        {multiSourceCount > 0 && (
                            <p className="text-xs text-brass">
                                {multiSourceCount} video source{multiSourceCount === 1 ? '' : 's'} queued
                                {(musicUrl.trim() || musicFile) ? ' · custom soundtrack' : ''}
                                {muteSource ? ' · video audio muted' : ''}.
                                Merged preview appears in the player once the combine step finishes.
                            </p>
                        )}
                    </div>
                ) : mode === 'url' ? (
                    <div className="space-y-4" data-tutorial="drop-zone">
                        <div className="relative">
                            <input
                                type="url"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://... paste a video link"
                                className="input-field pr-11"
                                required
                            />
                            <div className="absolute inset-y-0 right-2 flex items-center" ref={infoRef}>
                                <button
                                    type="button"
                                    onClick={() => setShowInfo((v) => !v)}
                                    aria-label="Supported platforms"
                                    className="p-1.5 text-muted hover:text-brass transition-colors"
                                >
                                    <Info size={16} />
                                </button>
                                {showInfo && (
                                    <div className="absolute right-0 top-full mt-2 w-64 z-20 card p-4 text-left animate-fade">
                                        <p className="eyebrow mb-2">Paste a link from</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {SUPPORTED_PLATFORMS.map((p) => (
                                                <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-paper3 text-ink2">
                                                    {p}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted mt-2.5 leading-relaxed">
                                            …and 1,000+ more sites. If a link has a public video, we can usually fetch it.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                        {selfHostSegmentMin != null && url.trim() && (() => {
                            const start = youtubeTimestampSeconds(url);
                            if (start == null) {
                                return (
                                    <p className="text-xs text-muted leading-relaxed">
                                        Self-host: plain links download at most{' '}
                                        <span className="text-ink2">{Math.round(selfHostSegmentMin)} min</span> from the
                                        start. For a live/VOD timestamp, add{' '}
                                        <span className="font-mono text-ink2">?t=</span> (e.g.{' '}
                                        <span className="font-mono text-ink2">?t=10589s</span>) — no pre-cut upload
                                        needed; Ollama picks clips from the transcript.
                                    </p>
                                );
                            }
                            const h = Math.floor(start / 3600);
                            const m = Math.floor((start % 3600) / 60);
                            const s = Math.floor(start % 60);
                            const at = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                                : `${m}:${String(s).padStart(2, '0')}`;
                            return (
                                <p className="text-xs text-brass leading-relaxed">
                                    Will download ~{Math.round(selfHostSegmentMin)} min starting at {at} on the video
                                    (from <span className="font-mono">?t=</span>). Submit once and edit clips here when
                                    they appear — no file upload or chat step.
                                </p>
                            );
                        })()}
                        <p className="text-xs text-muted pt-1">
                            Need several clips merged for one job?{' '}
                            <button
                                type="button"
                                onClick={() => {
                                    if (url.trim()) setMultiUrls(url.trim());
                                    setMode('multi');
                                }}
                                className="text-brass hover:underline lowercase"
                            >
                                open multi-source →
                            </button>
                        </p>
                    </div>
                ) : (
                    <div
                        data-tutorial="drop-zone"
                        className={`border-2 border-dashed rounded-card p-6 sm:p-8 text-center transition-colors ${file ? 'border-brass' : 'border-rule2 hover:border-brass'
                            }`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                    >
                        {file ? (
                            <div className="flex items-center justify-center gap-3 text-ok min-w-0">
                                <FileVideo size={18} className="shrink-0" />
                                <span className="font-medium truncate">{file.name}</span>
                                <button
                                    type="button"
                                    onClick={() => setFile(null)}
                                    className="p-1 text-muted hover:text-ink hover:bg-paper3 rounded-full transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        ) : null}
                        {file && fileTooShort ? (
                            <p className="text-danger text-sm mt-3" role="alert">
                                This video is {Math.round(fileSeconds)}s long. Clip generation needs at least {MIN_SOURCE_SECONDS}s
                                of footage to cut from: it already is a short. Pick a longer video.
                            </p>
                        ) : null}
                        {!file && (
                            <label className="cursor-pointer block">
                                <input
                                    type="file"
                                    accept="video/*"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    className="hidden"
                                />
                                <Upload className="mx-auto mb-3 text-muted" size={18} />
                                <p className="text-ink2 lowercase">Click to upload or drag and drop</p>
                                <p className="readout mt-2">
                                    MP4, MOV up to {formatUploadLimitMb(maxUploadMb)} · at least {MIN_SOURCE_SECONDS}s long
                                </p>
                            </label>
                        )}
                    </div>
                )}

                <SourceCost
                    mode={mode}
                    url={url}
                    fileSeconds={fileSeconds}
                    range={range}
                    onRangeChange={setRange}
                />

                {/* Output format selector */}
                <div className="mt-5" data-tutorial="output-format">
                    <p className="eyebrow mb-2">Output format</p>
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { value: 'vertical', label: '9:16', hint: 'Shorts · Reels · TikTok', w: 18, h: 32 },
                            { value: 'square', label: '1:1', hint: 'Feed posts', w: 28, h: 28 },
                            { value: 'horizontal', label: '16:9', hint: 'Keep landscape · YouTube', w: 36, h: 20 },
                        ].map((f) => {
                            const active = outputFormat === f.value;
                            return (
                                <button
                                    key={f.value}
                                    type="button"
                                    onClick={() => setOutputFormat(f.value)}
                                    className={`py-3 px-2 rounded-input border flex flex-col items-center gap-2 transition-colors
                                        ${active ? 'border-[color:var(--color-accent)] text-ink' : 'border-rule2 text-muted hover:border-[color:var(--color-accent)]'}`}
                                >
                                    {/* Aspect-ratio glyph */}
                                    <span
                                        className="rounded-[3px] border-2 transition-colors"
                                        style={{
                                            width: `${f.w}px`,
                                            height: `${f.h}px`,
                                            borderColor: active ? 'var(--color-accent)' : 'var(--color-rule-2)',
                                            backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 22%, transparent)' : 'transparent',
                                        }}
                                    />
                                    <span className="block font-mono text-sm leading-none">{f.label}</span>
                                    <span className="block text-[11px] sm:text-[10px] leading-tight text-center text-muted">{f.hint}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="mt-5 border border-rule rounded-card p-4 space-y-4">
                    <p className="eyebrow mb-2">Captions &amp; language</p>
                    <label className="flex items-start gap-2 text-sm text-ink2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={autoCaptions}
                            onChange={(e) => setAutoCaptions(e.target.checked)}
                            className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--color-accent)] cursor-pointer"
                        />
                        <span>
                            Auto-burn subtitles when clips finish
                            <span className="block text-xs text-muted mt-0.5">
                                Off by default. You can add or remove subtitles on each clip afterward.
                            </span>
                        </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-ink2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={englishCopy}
                            onChange={(e) => setEnglishCopy(e.target.checked)}
                            className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--color-accent)] cursor-pointer"
                        />
                        <span>
                            Hooks &amp; titles in English
                            <span className="block text-xs text-muted mt-0.5">
                                AI hooks stay English even when the video is another language.
                            </span>
                        </span>
                    </label>
                </div>

                <div
                    className="mt-5 border border-rule rounded-card p-4"
                    data-tutorial="brand-logo"
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => e.stopPropagation()}
                >
                    <p className="eyebrow mb-2">Brand logo (optional)</p>
                    <BrandLogoPicker
                        showAutoApply
                        autoApply={autoBrandLogo}
                        onAutoApplyChange={setAutoBrandLogo}
                        onSettingsChange={(s) => setBrandLogoReady(Boolean(s?.logo_filename))}
                    />
                </div>

                {/* Advanced generation controls — collapsed by default; blank = AI decides */}
                <div className="mt-4">
                    <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        className="flex items-center gap-1.5 text-xs text-muted hover:text-ink2 lowercase transition-colors"
                    >
                        <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                        advanced options
                        {(targetClips || clipMinSeconds || clipMaxSeconds || clipBrief.trim() || !autoHook
                            || !autoCaptions || !englishCopy) && (
                            <span className="text-brass">·</span>
                        )}
                    </button>
                    {showAdvanced && (
                        /* Stacked on a phone: three number fields side by side leaves
                           ~100px each, which crushes both label and value. */
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-2 animate-fade">
                            <div>
                                <p className="eyebrow mb-1.5">clips to aim for</p>
                                <input
                                    type="number" min="1" max="15" step="1"
                                    value={targetClips}
                                    onChange={(e) => setTargetClips(e.target.value)}
                                    placeholder="auto"
                                    className="input-field"
                                />
                            </div>
                            <div>
                                <p className="eyebrow mb-1.5">min length (s)</p>
                                <input
                                    type="number" min="5" max="175" step="1"
                                    value={clipMinSeconds}
                                    onChange={(e) => setClipMinSeconds(e.target.value)}
                                    placeholder="15"
                                    className="input-field"
                                />
                            </div>
                            <div>
                                <p className="eyebrow mb-1.5">max length (s)</p>
                                <input
                                    type="number" min="10" max="180" step="1"
                                    value={clipMaxSeconds}
                                    onChange={(e) => setClipMaxSeconds(e.target.value)}
                                    placeholder="60"
                                    className="input-field"
                                />
                            </div>
                            <p className="col-span-1 sm:col-span-3 text-[11px] leading-relaxed text-muted">
                                Targets, not guarantees: the AI returns fewer clips when the
                                material doesn't hold them. Leave blank to let it decide.
                            </p>
                            <div className="col-span-1 sm:col-span-3">
                                <p className="eyebrow mb-1.5">clip brief</p>
                                <textarea
                                    value={clipBrief}
                                    onChange={(e) => setClipBrief(e.target.value)}
                                    rows={4}
                                    maxLength={4000}
                                    placeholder="Steer moment picking: e.g. shocking reveals, fails, funny reactions, travel beats, topics to avoid. For multi-source jobs this applies to the merged timeline."
                                    className="input-field resize-y min-h-[5rem] text-sm leading-relaxed"
                                />
                                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                                    Ollama/Gemini uses this when choosing moments and writing hook titles.
                                    Stored in this browser only; up to 4000 characters.
                                </p>
                            </div>
                            <div className="col-span-1 sm:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-3 sm:pt-1 border-t border-rule">
                                <span className="text-xs text-ink2">vertical layout</span>
                                <select
                                    value={layout}
                                    onChange={(e) => setLayout(e.target.value)}
                                    className="input-field !w-auto text-xs py-1.5"
                                    aria-label="vertical layout"
                                >
                                    <option value="auto">Auto (AI picks per video)</option>
                                    <option value="split">Two speakers stacked</option>
                                    <option value="screencast">Screen over presenter</option>
                                    <option value="none">Single crop only</option>
                                </select>
                            </div>
                            <div className="col-span-1 sm:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-3 sm:pt-1 border-t border-rule">
                                <label className="flex items-center gap-2 text-xs text-ink2 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={autoHook}
                                        onChange={(e) => setAutoHook(e.target.checked)}
                                        className="w-4 h-4 shrink-0 accent-[var(--color-accent)] cursor-pointer"
                                    />
                                    auto hook titles on clips
                                </label>
                                {autoHook && (
                                    <select
                                        value={autoHookStyle}
                                        onChange={(e) => setAutoHookStyle(e.target.value)}
                                        className="input-field !w-auto text-xs py-1.5"
                                    >
                                        <option value="pill">Pills</option>
                                        <option value="classic">Classic</option>
                                        <option value="dark">Dark</option>
                                        <option value="yellow">Yellow</option>
                                        <option value="red">Red</option>
                                        <option value="outline">Outline</option>
                                        <option value="outline_yellow">Outline+</option>
                                    </select>
                                )}
                                {autoHook && (
                                    <p className="w-full text-[11px] leading-relaxed text-muted">
                                        You can change each clip&apos;s hook text, style, position and size
                                        afterwards with its hook button.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <label className="flex items-start gap-2.5 mt-5 text-left text-[13px] sm:text-xs leading-relaxed text-muted cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                        className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--color-accent)] cursor-pointer"
                    />
                    <span>
                        I confirm I own this content or have the rights to process it. I am responsible for any content I submit. See our <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-ink2 underline underline-offset-2 hover:text-brass transition-colors" onClick={(e) => e.stopPropagation()}>Terms</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-ink2 underline underline-offset-2 hover:text-brass transition-colors" onClick={(e) => e.stopPropagation()}>Privacy Policy</a>.
                    </span>
                </label>

                <button
                    type="submit"
                    data-tutorial="generate"
                    disabled={isProcessing || !acknowledged
                        || (mode === 'url' && !url)
                        || (mode === 'multi' && multiSourceCount < 1)
                        || (mode === 'file' && (!file || fileTooShort))}
                    className="w-full btn-primary mt-4"
                >
                    {isProcessing ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            Processing Video...
                        </>
                    ) : (
                        <>
                            Generate Clips
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}
