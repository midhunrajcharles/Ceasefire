'use client';

import React from 'react';
import { Badge, Button, Eyebrow, PageHeader, Panel, Stat, StatRow, TierBadge } from '../ui';
import {
  ACTIVITY,
  NOTICES,
  NOTICE_STAGE_LABEL,
  PORTFOLIO,
  TREND,
  relativeTime,
} from '@/lib/workspace';
import type { ScanBudget } from '@/lib/types';
import type { ViewKey } from '../AppShell';

export default function OverviewView({
  budget,
  onNavigate,
}: {
  budget: ScanBudget;
  onNavigate: (v: ViewKey) => void;
}) {
  const hostile = PORTFOLIO.filter((d) => d.status === 'hostile');
  const criticalOpen = NOTICES.filter(
    (n) => n.tier === 'CRITICAL' && n.stage !== 'resolved',
  ).length;
  const inFlight = NOTICES.filter((n) => n.stage !== 'resolved').length;
  const protectedCount = PORTFOLIO.filter((d) => d.status === 'protected').length;

  const max = Math.max(...TREND.map((t) => t.critical + t.high + t.medium + t.low));

  return (
    <>
      <PageHeader
        title="Overview"
        lede="Exposure across every surface Ceasefire watches, and what is waiting on a decision."
        action={
          <Button variant="primary" onClick={() => onNavigate('sweep')} data-cursor="Sweep">
            Run a sweep
          </Button>
        }
      />

      <StatRow>
        <Stat label="Open criticals" value={criticalOpen} tone="alert" sub="Cited by Google's AI" />
        <Stat label="Hostile domains" value={hostile.length} sub="Live and mail-capable" />
        <Stat label="Notices in flight" value={inFlight} sub="Awaiting review or signature" />
        <Stat
          label="Searches used"
          value={
            <>
              {budget.spent}
              <span className="text-neutral-300 text-xl">/{budget.total}</span>
            </>
          }
          sub="This month, free tier"
        />
      </StatRow>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10 mt-14">
        {/* Trend */}
        <Panel
          title="Exposure by week"
          meta={<Eyebrow>Findings by tier</Eyebrow>}
          className="xl:col-span-2"
        >
          <div className="px-6 py-8">
            <div className="flex items-end justify-between gap-3 h-52">
              {TREND.map((t) => {
                const total = t.critical + t.high + t.medium + t.low;
                const h = (n: number) => `${(n / max) * 100}%`;
                return (
                  <div key={t.label} className="flex-1 flex flex-col items-center gap-3 h-full">
                    <div className="flex-1 w-full flex flex-col justify-end gap-px">
                      <div className="bg-red-600 w-full rounded-t-sm" style={{ height: h(t.critical) }} title={`${t.critical} critical`} />
                      <div className="bg-amber-500 w-full" style={{ height: h(t.high) }} title={`${t.high} high`} />
                      <div className="bg-yellow-400 w-full" style={{ height: h(t.medium) }} title={`${t.medium} medium`} />
                      <div className="bg-neutral-300 w-full rounded-b-sm" style={{ height: h(t.low) }} title={`${t.low} low`} />
                    </div>
                    <div className="text-center">
                      <div className="font-mono text-[11px] tabular-nums text-neutral-900">{total}</div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-400 mt-0.5">
                        {t.label}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 pt-5 border-t border-neutral-200 flex flex-wrap gap-5">
              {[
                ['Critical', 'bg-red-600'],
                ['High', 'bg-amber-500'],
                ['Medium', 'bg-yellow-400'],
                ['Low', 'bg-neutral-300'],
              ].map(([label, cls]) => (
                <span key={label} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-sm ${cls}`} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500">
                    {label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </Panel>

        {/* Needs attention */}
        <Panel title="Needs attention">
          <div className="divide-y divide-neutral-200">
            {NOTICES.filter((n) => n.stage === 'draft' || n.stage === 'awaiting_signature').map((n) => (
              <button
                key={n.id}
                onClick={() => onNavigate('notices')}
                className="w-full text-left px-5 py-4 hover:bg-neutral-50 transition-colors"
                data-cursor="Open"
              >
                <TierBadge tier={n.tier} />
                <div className="mt-2 font-mono text-[12px] text-neutral-900 break-all">
                  {n.domain}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={n.stage === 'draft' ? 'neutral' : 'ok'}>
                    {NOTICE_STAGE_LABEL[n.stage]}
                  </Badge>
                  <span className="font-mono text-[10px] text-neutral-400">
                    {relativeTime(n.updatedAt)}
                  </span>
                </div>
              </button>
            ))}
            {hostile.slice(0, 1).map((d) => (
              <div key={d.domain} className="px-5 py-4">
                <Badge tone="critical">Mail-capable</Badge>
                <div className="mt-2 font-mono text-[12px] text-neutral-900 break-all">
                  {d.domain}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
                  Registered at {d.registrar}, MX configured — able to send mail that looks like yours.
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Activity */}
      <Panel
        title="Activity"
        meta={
          <button
            onClick={() => onNavigate('findings')}
            className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400 hover:text-black transition-colors"
          >
            All findings
          </button>
        }
        className="mt-14"
      >
        <ul className="divide-y divide-neutral-200">
          {ACTIVITY.map((a) => (
            <li key={a.id} className="flex items-start gap-4 px-5 py-4">
              <span
                className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                  a.emphasis ? 'bg-red-600' : 'bg-neutral-300'
                }`}
              />
              <span className="flex-1 text-[13px] leading-relaxed text-neutral-700">{a.text}</span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                {relativeTime(a.at)}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <p className="mt-10 text-[11px] leading-relaxed text-neutral-400 max-w-2xl">
        {protectedCount} lookalike domains are registered defensively through name.com. Risk tiers
        are a documented heuristic, not a validated classifier — see Method.
      </p>
    </>
  );
}
