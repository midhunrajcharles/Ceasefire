'use client';

import React from 'react';

/**
 * Wordmark. The glyph is a crosshair with a broken ring — reconnaissance,
 * interrupted. Replaces the source design's studio logo.
 */
export default function CeasefireMark({
  className = '',
  showWord = true,
}: {
  className?: string;
  showWord?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        {/* broken ring */}
        <path
          d="M9 1.5a7.5 7.5 0 1 1-5.3 12.8"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        {/* crosshair */}
        <path d="M9 5.2v7.6M5.2 9h7.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="9" cy="9" r="1.6" fill="currentColor" />
      </svg>
      {showWord && (
        <span className="text-[13px] font-medium tracking-[0.22em] uppercase">Ceasefire</span>
      )}
    </span>
  );
}
