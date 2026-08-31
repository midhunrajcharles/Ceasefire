'use client';

import React from 'react';
import ScanInput from '../ScanInput';
import ScanProgress from '../ScanProgress';
import EngineGrid from '../EngineGrid';
import PipelineStats from '../PipelineStats';
import FindingsSummary from '../FindingsSummary';
import FindingCard from '../FindingCard';
import ScanHistory from '../ScanHistory';
import { Badge, EmptyState, Panel } from '../ui';
import { TIER_ORDER, type Finding, type RiskTier, type Scan, type ScanSummary } from '@/lib/types';

export default function SweepView({
  scan,
  history,
  busy,
  noticeBusy,
  isMock,
  organisation,
  filter,
  onFilter,
  onScan,
  onDraftNotice,
  onRegister,
}: {
  scan: Scan;
  history: ScanSummary[];
  busy: boolean;
  noticeBusy: boolean;
  isMock: boolean;
  organisation: string;
  filter: RiskTier | 'ALL';
  onFilter: (t: RiskTier | 'ALL') => void;
  onScan: (brand: string, domain: string) => void;
  onDraftNotice: (id: string) => void;
  onRegister: (domain: string) => void;
}) {
  const started = scan.state !== 'idle';
  const isComplete = scan.state === 'complete';

  const sorted: Finding[] = [...scan.findings].sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier),
  );
  const visible = filter === 'ALL' ? sorted : sorted.filter((f) => f.tier === filter);
  const criticalCount = scan.findings.filter((f) => f.tier === 'CRITICAL').length;

  return (
    <div className="space-y-14">
      <ScanInput onScan={onScan} busy={busy} isMock={isMock} organisation={organisation} />

      {started && (
        <div className="space-y-14 animate-fadeIn">
          {isComplete && criticalCount > 0 && (
            <div className="border border-red-300 bg-red-50 rounded-lg px-6 py-5">
              <Badge tone="critical">Critical</Badge>
              <p className="mt-3 text-lg font-light leading-snug text-neutral-900 max-w-2xl">
                Google&apos;s AI is citing{' '}
                {criticalCount === 1 ? 'a domain' : `${criticalCount} domains`} impersonating{' '}
                {scan.brand} as a source.
              </p>
            </div>
          )}

          {!isComplete && <ScanProgress scan={scan} />}

          <EngineGrid engines={scan.engines} />
          <PipelineStats prefilter={scan.prefilter} budget={scan.budget} />

          <section>
            <div className="mb-5 flex items-baseline justify-between">
              <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono">
                Findings
              </p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono">
                {isComplete ? `${scan.findings.length} ranked by harm` : 'Pending'}
              </p>
            </div>

            {!isComplete ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="border border-neutral-200 rounded-lg px-5 py-6 animate-pulseDot"
                    style={{ animationDelay: `${i * 180}ms` }}
                  >
                    <div className="h-2 w-32 rounded bg-neutral-100" />
                    <div className="mt-3 h-2 w-64 max-w-full rounded bg-neutral-100" />
                  </div>
                ))}
              </div>
            ) : scan.findings.length === 0 ? (
              <Panel>
                <EmptyState
                  title="No impersonation found on any of the ten surfaces."
                  body="That is a clean result for this brand today — not a guarantee. Registration and indexing change daily, so re-run periodically."
                />
              </Panel>
            ) : (
              <>
                <FindingsSummary findings={scan.findings} filter={filter} onFilter={onFilter} />
                <div className="space-y-3">
                  {visible.map((f) => (
                    <FindingCard
                      key={f.id}
                      finding={f}
                      onDraftNotice={onDraftNotice}
                      onRegister={onRegister}
                      busy={noticeBusy}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {history.length > 0 && <ScanHistory scans={history} />}
    </div>
  );
}
