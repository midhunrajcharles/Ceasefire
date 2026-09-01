'use client';

import React from 'react';
import { Badge, Button, PageHeader, Panel } from '../ui';
import type { Integration } from '@/lib/workspace';
import { TIER_DEFINITION, TIER_ORDER, type ScanBudget } from '@/lib/types';
import type { Session } from '@/lib/session';

export default function SettingsView({
  session,
  integrations,
  budget,
  onSignOut,
}: {
  session: Session;
  integrations: Integration[];
  budget: ScanBudget;
  onSignOut: () => void;
}) {

  return (
    <>
      <PageHeader
        title="Settings"
        lede="Workspace configuration, search budget guardrails, and the integrations behind each stage of the pipeline."
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
        <div className="xl:col-span-2 space-y-10">
          <Panel title="Workspace">
            <dl className="divide-y divide-neutral-200">
              <Row k="Organisation" v={session.organisation} />
              <Row k="Account" v={session.email} />
              <Row k="Member since" v={new Date(session.createdAt).toLocaleDateString()} />
            </dl>
          </Panel>

          <Panel title="Search budget">
            <div className="px-5 py-6 space-y-6">
              <p className="text-[12px] leading-relaxed text-neutral-500">
                SerpApi&apos;s free tier allows a fixed number of searches a month. Ceasefire
                enforces the limit in code — a scan pauses and resumes rather than failing.
                These are server-side guardrails, set in the backend environment.
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-7">
                <Figure k="Monthly budget" v={budget.total} />
                <Figure k="Spent" v={budget.spent} />
                <Figure k="Served from cache" v={budget.cacheHits} />
              </dl>
              <p className="text-[11px] leading-relaxed text-neutral-400">
                A cache hit answers a repeat query without spending a search. Every figure here is
                counted from this workspace&apos;s own rows.
              </p>
            </div>
          </Panel>
        </div>

        <div className="space-y-10">
          <Panel title="Integrations">
            <div className="divide-y divide-neutral-200">
              {integrations.map((i) => (
                <div key={i.name} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[12px] text-neutral-900">{i.name}</span>
                    <Badge tone={i.status === 'connected' ? 'ok' : 'neutral'}>
                      {i.status === 'connected' ? 'Connected' : 'Not set'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">{i.role}</p>
                  <p className="mt-1 font-mono text-[10px] text-neutral-400">{i.detail}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Risk tiers">
            <dl className="divide-y divide-neutral-200">
              {TIER_ORDER.map((t) => (
                <div key={t} className="px-5 py-3.5">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-900">
                    {t}
                  </dt>
                  <dd className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                    {TIER_DEFINITION[t]}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Session">
            <div className="px-5 py-5">
              <p className="text-[12px] leading-relaxed text-neutral-500 mb-4">
                The session is an httpOnly cookie issued by the API. Signing out revokes it
                server-side, not just in this browser.
              </p>
              <Button onClick={onSignOut} data-cursor="Sign out">
                Sign out
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-1 text-[13px] text-neutral-900 break-all">{v}</dd>
    </div>
  );
}

function Figure({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-1 font-mono text-2xl tabular-nums text-neutral-900">{v}</dd>
    </div>
  );
}
