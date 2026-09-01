'use client';

import React from 'react';
import { Badge, Eyebrow, PageHeader, Panel, Stat, StatRow, Meter } from '../ui';
import type { SurfaceStat } from '@/lib/workspace';
import { ENGINES } from '@/lib/types';

const ZERO: Omit<SurfaceStat, 'id'> = {
  findingsAllTime: 0,
  searchesSpent: 0,
  avgMs: 0,
  cacheHitRate: 0,
};

export default function SurfacesView({ surfaces }: { surfaces: SurfaceStat[] }) {
  const byId = Object.fromEntries(surfaces.map((s) => [s.id, s]));
  const totalFindings = surfaces.reduce((n, s) => n + s.findingsAllTime, 0);
  const totalSearches = surfaces.reduce((n, s) => n + s.searchesSpent, 0);
  const avgCache = surfaces.length
    ? surfaces.reduce((n, s) => n + s.cacheHitRate, 0) / surfaces.length
    : 0;
  const maxFindings = Math.max(...surfaces.map((s) => s.findingsAllTime), 1);

  return (
    <>
      <PageHeader
        title="Surfaces"
        lede="Ten separate search surfaces, all through SerpApi. Two of them return the citations Google's own AI used to answer a question about your brand — no other API exposes that."
      />

      <StatRow>
        <Stat label="Surfaces" value={ENGINES.length} sub="Swept on every run" />
        <Stat label="Findings all-time" value={totalFindings} sub="Across every sweep" />
        <Stat label="Searches spent" value={totalSearches} sub="Metered against the free tier" />
        <Stat
          label="Cache hit rate"
          value={`${Math.round(avgCache * 100)}%`}
          sub="Served without spending a search"
        />
      </StatRow>

      <Panel title="Per-surface performance" className="mt-14">
        <div className="divide-y divide-neutral-200">
          {ENGINES.map((e, i) => {
            const s = byId[e.id] ?? { id: e.id, ...ZERO };
            return (
              <div key={e.id} className="px-5 py-5 hover:bg-neutral-50 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[11px] tabular-nums text-neutral-300">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-mono text-[13px] text-neutral-900">{e.label}</span>
                      {e.headline && <Badge tone="ok">Novel</Badge>}
                    </div>
                    <p className="mt-2 pl-8 text-[12px] leading-relaxed text-neutral-500 max-w-xl">
                      {e.purpose}
                    </p>
                    <div className="mt-3 pl-8 max-w-xs">
                      <Meter value={s.findingsAllTime} max={maxFindings} />
                    </div>
                  </div>

                  <dl className="grid grid-cols-3 gap-8 shrink-0">
                    <Metric k="Findings" v={s.findingsAllTime} />
                    <Metric k="Searches" v={s.searchesSpent} />
                    <Metric k="Avg" v={`${s.avgMs}ms`} />
                  </dl>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mt-14">
        <Panel title="Why SerpApi is load-bearing">
          <div className="px-5 py-5 space-y-4 text-[13px] leading-relaxed text-neutral-600">
            <p>
              Exa, Tavily and Firecrawl return page content. Ceasefire needs SERP structure — AI
              Overview citations, app-store listings, and local packs as structured references.
            </p>
            <p>
              Remove SerpApi and there is no product. No other API returns all ten of these surfaces
              under one schema.
            </p>
          </div>
        </Panel>

        <Panel title="Cost discipline">
          <dl className="divide-y divide-neutral-200">
            <Row k="Free tier" v="250 searches / month" />
            <Row k="Throughput" v="50 / hour — token bucket, jittered backoff" />
            <Row k="Prefilter" v="DNS, MX and HTTP checks run before any search is spent" />
            <Row k="Cache" v="Results stored server-side and replayed on repeat sweeps" />
            <Row k="no_cache" v="Set on verification paths — a stale result is a missed detection" />
          </dl>
        </Panel>
      </div>
    </>
  );
}

function Metric({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="text-right">
      <dt className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-1 font-mono text-[15px] tabular-nums text-neutral-900">{v}</dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="px-5 py-3.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-1 text-[12px] leading-relaxed text-neutral-700">{v}</dd>
    </div>
  );
}
