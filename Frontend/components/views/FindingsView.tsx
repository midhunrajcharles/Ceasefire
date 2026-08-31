'use client';

import React, { useState } from 'react';
import { Badge, Button, EmptyState, PageHeader, Panel, Stat, StatRow, TierBadge } from '../ui';
import { PORTFOLIO, relativeTime } from '@/lib/workspace';
import { TIER_ORDER, type RiskTier } from '@/lib/types';
import type { ViewKey } from '../AppShell';

/**
 * Workspace-wide findings — every impersonating domain across every sweep,
 * as opposed to SweepView which shows only the run in progress.
 */
const ALL = PORTFOLIO.filter((d) => d.status === 'hostile' || d.status === 'watchlist').map(
  (d, i) => ({
    ...d,
    tier: (d.mailCapable ? (i === 0 ? 'CRITICAL' : 'HIGH') : 'MEDIUM') as RiskTier,
    surface: d.mailCapable ? 'AI Overview · Google Search' : 'Google Search',
    brand: 'Northwind Supply',
  }),
);

export default function FindingsView({ onNavigate }: { onNavigate: (v: ViewKey) => void }) {
  const [tier, setTier] = useState<RiskTier | 'ALL'>('ALL');
  const rows = tier === 'ALL' ? ALL : ALL.filter((r) => r.tier === tier);

  const counts = TIER_ORDER.map((t) => ({ t, n: ALL.filter((r) => r.tier === t).length }));
  const mailCapable = ALL.filter((r) => r.mailCapable).length;

  return (
    <>
      <PageHeader
        title="Findings"
        lede="Every impersonating asset found across all sweeps in this workspace, ranked by harm rather than by when it was discovered."
        action={
          <Button onClick={() => onNavigate('sweep')} data-cursor="Sweep">
            New sweep
          </Button>
        }
      />

      <StatRow>
        <Stat label="Total open" value={ALL.length} sub="Across all sweeps" />
        <Stat
          label="Mail-capable"
          value={mailCapable}
          tone={mailCapable > 0 ? 'alert' : 'default'}
          sub="MX configured — phishing-ready"
        />
        <Stat label="Cited by AI" value={1} sub="In Google's AI Overview" />
        <Stat label="Brands watched" value={3} sub="Sweeps run this month" />
      </StatRow>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-neutral-200 border border-neutral-200 rounded-lg overflow-hidden mt-10 mb-10">
        <button
          onClick={() => setTier('ALL')}
          className={`px-5 py-4 text-left transition-colors ${
            tier === 'ALL' ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50'
          }`}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">All</div>
          <div className="mt-1 font-mono text-[20px] tabular-nums text-neutral-900">{ALL.length}</div>
        </button>
        {counts.map(({ t, n }) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            disabled={n === 0}
            className={`px-5 py-4 text-left transition-colors disabled:cursor-not-allowed ${
              tier === t ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50'
            }`}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
              {t}
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

      <Panel title={tier === 'ALL' ? 'All findings' : `${tier} findings`}>
        {rows.length === 0 ? (
          <EmptyState title="Nothing at this tier" body="Try clearing the filter." />
        ) : (
          <div className="divide-y divide-neutral-200">
            {rows.map((r) => (
              <div
                key={r.domain}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-neutral-50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <TierBadge tier={r.tier} />
                    <span className="font-mono text-[13px] text-neutral-900 break-all">
                      {r.domain}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge>{r.technique}</Badge>
                    {r.mailCapable && <Badge tone="critical">Mail-capable</Badge>}
                    <span className="font-mono text-[10px] text-neutral-400">{r.surface}</span>
                  </div>
                </div>

                <div className="flex items-center gap-5 shrink-0">
                  <div className="text-right">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                      Brand
                    </div>
                    <div className="mt-1 text-[12px] text-neutral-700">{r.brand}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                      Found
                    </div>
                    <div className="mt-1 font-mono text-[12px] text-neutral-700">
                      {relativeTime(r.firstSeen)}
                    </div>
                  </div>
                  <Button onClick={() => onNavigate('notices')} data-cursor="Notice">
                    Notice
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
