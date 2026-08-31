'use client';

import React, { useState } from 'react';
import type { Finding, RiskTier } from '@/lib/types';

const TIER_STYLE: Record<RiskTier, { text: string; border: string; dot: string }> = {
  CRITICAL: { text: 'text-red-700',     border: 'border-red-300',     dot: 'bg-red-600' },
  HIGH:     { text: 'text-amber-700',   border: 'border-amber-300',   dot: 'bg-amber-500' },
  MEDIUM:   { text: 'text-yellow-700',  border: 'border-yellow-300',  dot: 'bg-yellow-500' },
  LOW:      { text: 'text-neutral-500', border: 'border-neutral-200', dot: 'bg-neutral-400' },
};

interface FindingCardProps {
  finding: Finding;
  onDraftNotice: (findingId: string) => void;
  onRegister?: (domain: string) => void;
  busy?: boolean;
}

export default function FindingCard({ finding, onDraftNotice, onRegister, busy }: FindingCardProps) {
  const [open, setOpen] = useState(finding.tier === 'CRITICAL');
  const s = TIER_STYLE[finding.tier];

  return (
    <article className={`bg-white border ${s.border} rounded-lg transition-colors`}>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
            <span className={`font-mono text-[10px] uppercase tracking-[0.15em] ${s.text}`}>
              {finding.tier}
            </span>
            <span className="font-mono text-[14px] text-neutral-900 break-all">{finding.domain}</span>
          </div>

          <p className="mt-2 pl-4 text-[13px] leading-relaxed text-neutral-600">{finding.reason}</p>

          <div className="mt-3 flex flex-wrap gap-2 pl-4">
            {finding.aiOverviewCited && <Tag tone="critical">Cited in AI Overview</Tag>}
            {finding.mailCapable && <Tag tone="high">Mail-capable</Tag>}
            {finding.live && <Tag>Live page</Tag>}
            {!finding.registered && <Tag tone="dark">Unregistered</Tag>}
            {finding.technique && <Tag>{finding.technique}</Tag>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            className="text-[11px] uppercase tracking-[0.15em] font-mono px-5 py-2 rounded-full border border-neutral-300 text-neutral-900 hover:border-black hover:bg-black hover:text-white transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={() =>
              finding.registered ? onDraftNotice(finding.id) : onRegister?.(finding.domain)
            }
            disabled={busy}
            data-cursor={finding.registered ? 'Draft' : 'Register'}
          >
            {finding.registered ? 'Draft notice' : 'Register defensively'}
          </button>

          {finding.evidence.length > 0 && (
            <button
              className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400 hover:text-black transition-colors"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Hide' : 'Show'} evidence ({finding.evidence.length})
            </button>
          )}
        </div>
      </div>

      {open && finding.evidence.length > 0 && (
        <div className="border-t border-neutral-200 space-y-3 px-5 py-4">
          {finding.evidence.map((ev, i) => (
            <div key={i} className="animate-fadeIn">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-900">
                  {ev.engine}
                </span>
                <span className="font-mono text-[10px] text-neutral-400">
                  {new Date(ev.fetchedAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-neutral-600">{ev.snippet}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-neutral-400">{ev.url}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function Tag({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'critical' | 'high' | 'dark';
}) {
  const tones = {
    neutral: 'border-neutral-200 text-neutral-400',
    critical: 'border-red-300 text-red-700',
    high: 'border-amber-300 text-amber-700',
    dark: 'border-neutral-900 text-neutral-900',
  };
  return (
    <span className={`rounded-sm border px-2 py-px font-mono text-[9px] uppercase tracking-[0.15em] ${tones[tone]}`}>
      {children}
    </span>
  );
}
