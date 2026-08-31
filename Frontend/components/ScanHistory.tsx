'use client';

import React from 'react';
import type { ScanSummary } from '@/lib/types';

export default function ScanHistory({
  scans,
  onOpen,
}: {
  scans: ScanSummary[];
  onOpen?: (id: string) => void;
}) {
  if (scans.length === 0) return null;

  return (
    <section className="w-full">
      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono mb-5">
        Recent scans
      </p>

      <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-200">
        {scans.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen?.(s.id)}
            className="w-full flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-left hover:bg-neutral-50 transition-colors"
            data-cursor="Open"
          >
            <div className="min-w-0">
              <div className="font-mono text-[13px] text-neutral-900 truncate">{s.domain}</div>
              <div className="mt-0.5 text-[11px] text-neutral-500">{s.brand}</div>
            </div>

            <div className="flex items-center gap-6 shrink-0">
              {s.criticalCount > 0 && (
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-red-700">
                  {s.criticalCount} critical
                </span>
              )}
              <span className="font-mono text-[11px] text-neutral-500 tabular-nums">
                {s.findingCount} findings
              </span>
              <span className="font-mono text-[11px] text-neutral-400 tabular-nums">
                {s.searchesSpent} searches
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-300">
                {relative(s.completedAt)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function relative(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
