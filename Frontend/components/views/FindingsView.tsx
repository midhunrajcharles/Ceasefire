'use client';

import React, { useState } from 'react';
import { Badge, Button, EmptyState, PageHeader, Panel, Stat, StatRow, TierBadge } from '../ui';
import { relativeTime } from '@/lib/workspace';
import { ENGINES, TIER_ORDER, type Finding, type RiskTier } from '@/lib/types';
import type { ViewKey } from '../AppShell';

/**
 * Workspace-wide findings — every impersonating domain across every sweep,
 * as opposed to SweepView which shows only the run in progress.
 */
const ENGINE_LABEL = Object.fromEntries(ENGINES.map((e) => [e.id, e.label]));

/** Which surfaces actually produced evidence for this finding. */
function surfaces(f: Finding): string {
  const names = Array.from(new Set(f.evidence.map((e) => ENGINE_LABEL[e.engine] ?? e.engine)));
  return names.length ? names.join(' · ') : 'No indexed evidence';
}

/** Oldest evidence capture is when this domain was first seen. */
function firstSeen(f: Finding): string | null {
  const times = f.evidence.map((e) => e.fetchedAt).filter(Boolean).sort();
  return times[0] ?? null;
}

export default function FindingsView({
  findings,
  onNavigate,
}: {
  findings: Finding[];
  onNavigate: (v: ViewKey) => void;
}) {
  const [tier, setTier] = useState<RiskTier | 'ALL'>('ALL');
  const rows = tier === 'ALL' ? findings : findings.filter((r) => r.tier === tier);

  const counts = TIER_ORDER.map((t) => ({ t, n: findings.filter((r) => r.tier === t).length }));
  const mailCapable = findings.filter((r) => r.mailCapable).length;
  const citedByAi = findings.filter((r) => r.aiOverviewCited).length;
  const liveCount = findings.filter((r) => r.live).length;

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
        <Stat label="Total open" value={findings.length} sub="Across all sweeps" />
        <Stat
          label="Mail-capable"
          value={mailCapable}
          tone={mailCapable > 0 ? 'alert' : 'default'}
          sub="MX configured — phishing-ready"
        />
        <Stat
          label="Cited by AI"
          value={citedByAi}
          tone={citedByAi > 0 ? 'alert' : 'default'}
          sub="In Google's AI Overview"
        />
        <Stat label="Live sites" value={liveCount} sub="Responding over HTTP" />
      </StatRow>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-neutral-200 border border-neutral-200 rounded-lg overflow-hidden mt-10 mb-10">
        <button
          onClick={() => setTier('ALL')}
          className={`px-5 py-4 text-left transition-colors ${
            tier === 'ALL' ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50'
          }`}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">All</div>
          <div className="mt-1 font-mono text-[20px] tabular-nums text-neutral-900">
            {findings.length}
          </div>
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
          <EmptyState
            title={findings.length === 0 ? 'No findings yet' : 'Nothing at this tier'}
            body={
              findings.length === 0
                ? 'Run a sweep from the Sweep view and anything impersonating your brand lands here.'
                : 'Try clearing the filter.'
            }
          />
        ) : (
          <div className="divide-y divide-neutral-200">
            {rows.map((r) => {
              const seen = firstSeen(r);
              return (
                <div
                  key={r.id}
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
                      {r.technique && <Badge>{r.technique}</Badge>}
                      {r.mailCapable && <Badge tone="critical">Mail-capable</Badge>}
                      {r.aiOverviewCited && <Badge tone="critical">AI Overview</Badge>}
                      <span className="font-mono text-[10px] text-neutral-400">{surfaces(r)}</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{r.reason}</p>
                  </div>

                  <div className="flex items-center gap-5 shrink-0">
                    <div className="text-right">
                      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                        Evidence
                      </div>
                      <div className="mt-1 font-mono text-[12px] text-neutral-700 tabular-nums">
                        {r.evidence.length}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                        Found
                      </div>
                      <div className="mt-1 font-mono text-[12px] text-neutral-700">
                        {seen ? relativeTime(seen) : '—'}
                      </div>
                    </div>
                    <Button onClick={() => onNavigate('notices')} data-cursor="Notice">
                      Notice
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
