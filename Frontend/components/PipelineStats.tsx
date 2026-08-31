'use client';

import React from 'react';
import type { PrefilterStats, ScanBudget } from '@/lib/types';

/**
 * The prefilter funnel. This is the technical-execution talking point:
 * a SerpApi search is spent only on candidates that already survived
 * free DNS and HTTP checks.
 */
export default function PipelineStats({
  prefilter,
  budget,
}: {
  prefilter: PrefilterStats;
  budget: ScanBudget;
}) {
  const steps = [
    { label: 'Permutations generated', value: prefilter.generated, note: 'free' },
    { label: 'DNS resolves', value: prefilter.survivedDns, note: 'free' },
    { label: 'Mail-capable (MX)', value: prefilter.mailCapable, note: 'free', danger: true },
    { label: 'Live page (HTTP 200)', value: prefilter.survivedHttp, note: 'free' },
    { label: 'Searches spent', value: budget.spent, note: 'metered', metered: true },
  ];

  return (
    <section className="w-full">
      <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono mb-5">
        Prefilter funnel
      </p>

      <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-200">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-neutral-600">{s.label}</span>
              <span
                className={`rounded-sm border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.15em] ${
                  s.metered
                    ? 'border-amber-400 text-amber-700'
                    : 'border-neutral-200 text-neutral-400'
                }`}
              >
                {s.note}
              </span>
            </div>
            <span
              className={`font-mono text-[15px] tabular-nums ${
                s.danger && s.value > 0 ? 'text-amber-700' : 'text-neutral-900'
              }`}
            >
              {s.value}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-neutral-400">
        Searches are the scarce resource — 250 per month on the free tier, 50 per hour. Generation,
        DNS and HTTP checks cost nothing, so the sweep only spends a search on a candidate that has
        already proven it exists.
        {budget.cacheHits > 0 && (
          <> {budget.cacheHits} result{budget.cacheHits === 1 ? '' : 's'} served from cache this run.</>
        )}
      </p>
    </section>
  );
}
