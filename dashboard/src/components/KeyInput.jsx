import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Check } from 'lucide-react';

export default function KeyInput({ onKeySet, savedKey, localLlm }) {
    const [key, setKey] = useState(savedKey || '');
    const [isVisible, setIsVisible] = useState(false);
    const [isSaved, setIsSaved] = useState(!!savedKey);

    useEffect(() => {
        if (savedKey) setKey(savedKey);
    }, [savedKey]);

    const handleSave = () => {
        if (key.trim().length > 0) {
            onKeySet(key);
            setIsSaved(true);
        }
    };

  const llmReady = Boolean(localLlm?.model);

    return (
        <div className="card p-4 sm:p-6 mb-8 animate-fade">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-paper3 rounded-input text-brass">
                    <Key size={18} />
                </div>
                <h2 className="font-display lowercase text-lg text-ink">Gemini API Key</h2>
                {llmReady && !savedKey && (
                    <span className="badge-ok text-[10px]">optional — Ollama active</span>
                )}
            </div>

            {llmReady && (
                <p className="text-xs text-muted mb-4 leading-relaxed">
                    Server is using <span className="font-mono text-ink2">{localLlm.model}</span> at{' '}
                    <span className="font-mono text-ink2 break-all">{localLlm.baseUrl}</span> for viral moment picking.
                    You can clip and edit subtitles/hooks without a Gemini key. Add Gemini only if you want AI layouts and effects.
                </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative sm:flex-1">
                    <input
                        type={isVisible ? "text" : "password"}
                        value={key}
                        onChange={(e) => {
                            setKey(e.target.value);
                            setIsSaved(false);
                        }}
                        placeholder={llmReady ? 'Optional — AIzaSy...' : 'AIzaSy...'}
                        className="input-field pr-12 font-mono"
                    />
                    <button
                        onClick={() => setIsVisible(!isVisible)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
                    >
                        {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                </div>
                <button
                    onClick={handleSave}
                    disabled={!key || isSaved}
                    className={isSaved ? 'badge-ok px-4 cursor-default' : 'btn-primary'}
                >
                    {isSaved ? <><Check size={14} /> Ready</> : 'Set Key'}
                </button>
            </div>
            <p className="mt-3 text-xs text-muted">
                Your key is stored locally in your browser for convenience.
                <br />
                <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brass hover:underline mt-1 inline-block"
                >
                    Get a Gemini API Key (not available in all regions) →
                </a>
            </p>
        </div>
    );
}