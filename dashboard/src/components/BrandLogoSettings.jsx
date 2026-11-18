import React, { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import BrandLogoPicker from './BrandLogoPicker';

/** Default logo + position for brand-logo overlays (self-host / BYOK). */
export default function BrandLogoSettings() {
  const [hasLogo, setHasLogo] = useState(false);

  return (
    <div className="card p-4 sm:p-6 mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-input bg-paper3 flex items-center justify-center shrink-0">
            <ImagePlus size={16} className="text-brass" />
          </div>
          <h2 className="text-base font-medium text-ink lowercase">Brand logo</h2>
        </div>
        <span className="readout">{hasLogo ? 'logo set' : 'optional'}</span>
      </div>
      <p className="text-xs text-muted mb-4 leading-relaxed">
        Same logo as on the Clip Generator form. Per-clip tweaks live on each result card.
      </p>
      <BrandLogoPicker onSettingsChange={(s) => setHasLogo(Boolean(s?.logo_filename))} />
    </div>
  );
}