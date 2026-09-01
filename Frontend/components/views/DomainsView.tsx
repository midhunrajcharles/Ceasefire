'use client';

import React, { useState } from 'react';
import { Badge, Button, EmptyState, PageHeader, Panel } from '../ui';
import {
  DOMAIN_STATUS_LABEL,
  relativeTime,
  type DomainStatus,
  type PortfolioDomain,
} from '@/lib/workspace';

const GROUPS: { status: DomainStatus; lede: string }[] = [
  { status: 'hostile',   lede: 'Registered by someone else, live, and actively impersonating. These are notice candidates.' },
  { status: 'available', lede: 'Unregistered lookalikes. Registering them yourself removes them from the attack surface permanently.' },
  { status: 'protected', lede: 'Registered defensively through name.com and parked under your control.' },
  { status: 'watchlist', lede: 'Registered by others but not currently impersonating. Monitored on every sweep.' },
];

const TONE: Record<DomainStatus, 'critical' | 'ok' | 'neutral' | 'dark'> = {
  hostile: 'critical',
  protected: 'ok',
  available: 'dark',
  watchlist: 'neutral',
};

export default function DomainsView({
  domains,
  onRegister,
}: {
  domains: PortfolioDomain[];
  onRegister: (domain: string) => void;
}) {
  const [filter, setFilter] = useState<DomainStatus | 'ALL'>('ALL');
  const groups = filter === 'ALL' ? GROUPS : GROUPS.filter((g) => g.status === filter);

  return (
    <>
      <PageHeader
        title="Domains"
        lede="The lookalike portfolio for this workspace — what you own, what someone else owns, and what is still unclaimed."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-neutral-200 border border-neutral-200 rounded-lg overflow-hidden mb-10">
        {GROUPS.map((g) => {
          const n = domains.filter((d) => d.status === g.status).length;
          const active = filter === g.status;
          return (
            <button
              key={g.status}
              onClick={() => setFilter(active ? 'ALL' : g.status)}
              className={`px-5 py-5 text-left transition-colors ${
                active ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50'
              }`}
              data-cursor={DOMAIN_STATUS_LABEL[g.status]}
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-400">
                {DOMAIN_STATUS_LABEL[g.status]}
              </div>
              <div className="mt-2 font-mono text-2xl tabular-nums text-neutral-900">{n}</div>
            </button>
          );
        })}
      </div>

      <div className="space-y-12">
        {groups.map((g) => {
          const rows = domains.filter((d) => d.status === g.status);
          return (
            <Panel
              key={g.status}
              title={DOMAIN_STATUS_LABEL[g.status]}
              meta={
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                  {rows.length}
                </span>
              }
            >
              <p className="px-5 pt-4 pb-3 text-[12px] leading-relaxed text-neutral-500 border-b border-neutral-200">
                {g.lede}
              </p>

              {rows.length === 0 ? (
                <EmptyState title="Nothing here" body="Run a sweep to populate this group." />
              ) : (
                <div className="divide-y divide-neutral-200">
                  {rows.map((d) => (
                    <div
                      key={d.domain}
                      className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-neutral-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] text-neutral-900 break-all">
                          {d.domain}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge tone={TONE[d.status]}>{DOMAIN_STATUS_LABEL[d.status]}</Badge>
                          {d.technique && <Badge>{d.technique}</Badge>}
                          {d.mailCapable && <Badge tone="critical">Mail-capable</Badge>}
                          {d.registrar && (
                            <span className="font-mono text-[10px] text-neutral-400">
                              {d.registrar}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-5 shrink-0">
                        <div className="text-right">
                          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                            {d.status === 'available' ? 'First year' : 'First seen'}
                          </div>
                          <div className="mt-1 font-mono text-[12px] text-neutral-700 tabular-nums">
                            {d.status === 'available'
                              ? d.priceUsd != null
                                ? `$${d.priceUsd.toFixed(2)}`
                                : 'No quote'
                              : relativeTime(d.firstSeen)}
                          </div>
                        </div>

                        {d.status === 'available' && (
                          <Button onClick={() => onRegister(d.domain)} data-cursor="Register">
                            Register
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
