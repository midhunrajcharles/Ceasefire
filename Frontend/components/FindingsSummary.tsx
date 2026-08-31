'use client';

import React from 'react';
import { TIER_ORDER, type Finding, type RiskTier } from '@/lib/types';

const TIER_TEXT: Record<RiskTier, string> = {
  CRITICAL: 'text-red-700',
  HIGH: 'text-amber-700',
  MEDIUM: 'text-yellow-700',
  LOW: 'text-neutral-500',
};

export default function FindingsSummary({
  findings,
  filter,
  onFilter,
}: {
  findings: Finding[];
  filter: RiskTier | 'ALL';
  onFilter: (t: RiskTier | 'ALL') => void;
}) {
  const counts = TIER_ORDER.map((t) => ({
    tier: t,
    n: findings.filter((f) => f.tier === t).length,
  }));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-neutral-200 border border-neutral-200 rounded-lg overflow-hidden mb-5">
      <button
        onClick={() => onFilter('ALL')}
        className={`px-5 py-4 text-left transition-colors ${
          filter === 'ALL' ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50'
        }`}
        data-cursor="All"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">All</div>
        <div className="mt-1 font-mono text-[20px] tabular-nums text-neutral-900">
          {findings.length}
        </div>
      </button>

      {counts.map(({ tier, n }) => (
        <button
          key={tier}
          onClick={() => onFilter(tier)}
          disabled={n === 0}
          className={`px-5 py-4 text-left transition-colors disabled:cursor-not-allowed ${
            filter === tier ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50'
          }`}
          data-cursor={n > 0 ? tier : undefined}
        >
          <div className={`font-mono text-[10px] uppercase tracking-[0.15em] ${n > 0 ? TIER_TEXT[tier] : 'text-neutral-300'}`}>
            {tier}
          </div>
          <div
            className={`mt-1 font-mono text-[20px] tabular-nums ${
              n > 0 ? 'text-neutral-900' : 'text-neutral-300'
            }`}
          >
            {n}
          </div>
        </button>
      ))}
    </div>
  );
}
