'use client';

import React from 'react';
import { Badge, PageHeader, Panel } from '../ui';
import { ENGINES, PERMUTATION_TECHNIQUES, TIER_DEFINITION, TIER_ORDER } from '@/lib/types';

export default function MethodView() {
  return (
    <>
      <PageHeader
        title="Method"
        lede="How a brand name becomes a ranked list of impersonators and a signed notice — and every constraint the pipeline was built around."
      />

      <div className="space-y-14 max-w-4xl">
        <Step n="01" title="Generate" lede="Around 200 lookalike candidates, generated from the primary domain. Nothing is called yet — generation is free.">
          <Panel>
            <dl className="divide-y divide-neutral-200">
              {PERMUTATION_TECHNIQUES.map((t) => (
                <div key={t.name} className="flex items-baseline justify-between gap-6 px-5 py-3.5">
                  <div>
                    <dt className="font-mono text-[12px] text-neutral-900">{t.name}</dt>
                    <dd className="mt-0.5 text-[11px] text-neutral-500">{t.note}</dd>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-neutral-400">{t.example}</span>
                </div>
              ))}
            </dl>
          </Panel>
        </Step>

        <Step
          n="02"
          title="Prefilter"
          lede="Candidates are narrowed by checks that cost nothing. A metered search is spent only on what survives — this is the difference between a 200-search sweep and a 20-search one."
        >
          <Panel>
            <div className="px-5 py-6 font-mono text-[12px] leading-[2] text-neutral-700">
              <div>200 generated</div>
              <div className="pl-6">→ DNS resolves? <span className="text-neutral-400">~41 survive · free</span></div>
              <div className="pl-6">→ MX records present? <span className="text-neutral-400">flags mail-capable · free</span></div>
              <div className="pl-6">→ HTTP 200 + title? <span className="text-neutral-400">~18 survive · free</span></div>
              <div className="pl-6 text-neutral-900">→ then spend searches</div>
            </div>
          </Panel>
        </Step>

        <Step
          n="03"
          title="Sweep ten surfaces"
          lede="Every surface below comes from SerpApi. AI Overview and AI Mode return the citations Google's own AI used to answer a question about the brand — if an impersonator appears there, the brand's official answer is being sourced from an attacker."
        >
          <Panel>
            <ol className="divide-y divide-neutral-200">
              {ENGINES.map((e, i) => (
                <li key={e.id} className="flex gap-4 px-5 py-3.5">
                  <span className="shrink-0 font-mono text-[11px] text-neutral-300 tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-neutral-900">{e.label}</span>
                      {e.headline && <Badge tone="ok">Novel</Badge>}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">{e.purpose}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </Step>

        <Step
          n="04"
          title="Rank by harm"
          lede="Tiers are a documented heuristic, not a validated classifier. There is no labelled evaluation set behind them — that is the first thing we would build next, and we would rather say so than quote a false-positive rate we cannot defend."
        >
          <Panel>
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
        </Step>

        <Step
          n="05"
          title="Draft — and stop"
          lede="The notice is generated from structured case facts through a conditional template, not as prose from a language model. It is then held at a review gate: a person reads it, redacts anything that should not leave the building, and approves it for signature. Ceasefire never sends."
        />

        <Step n="06" title="Constraints the pipeline was built around">
          <Panel>
            <dl className="divide-y divide-neutral-200">
              <Row k="Search budget" v="250 per month on the SerpApi free tier, enforced in code with a visible counter." />
              <Row k="Throughput" v="50 per hour. Token bucket with exponential backoff and jitter; interrupted sweeps resume from stored partial state rather than re-spending." />
              <Row k="AI Overview token" v="ai_overview.page_token expires inside 60 seconds. It is consumed inline, per result — never batched for a later pass." />
              <Row k="Cache" v="SerpApi's 1-hour default is the wrong default for security scanning, where a stale result is a missed detection. Verification paths set no_cache; trend queries keep caching, where staleness is harmless." />
              <Row k="Egress" v="Search results contain attacker-controlled URLs. Scheme allowlist, private, loopback, link-local and cloud-metadata ranges blocked, redirects re-checked at every hop, hard timeouts and response size caps." />
              <Row k="Markdown output" v="output=md across all ten surfaces, measured before and after rather than quoting the vendor's figure." />
            </dl>
          </Panel>
        </Step>

        <Step n="07" title="Scope and boundaries">
          <Panel>
            <div className="px-5 py-6 space-y-4 text-[13px] leading-relaxed text-neutral-600">
              <p>
                Public search results, public DNS, and public registration state only. Nothing behind
                authentication, and nothing that requires bypassing a control.
              </p>
              <p>
                No notice is delivered automatically. The review gate is a product feature and a
                safety property, not a formality.
              </p>
              <p>
                Every number shown in this application is measured or clearly labelled as sample
                data. Where we do not have a figure, the interface says so.
              </p>
            </div>
          </Panel>
        </Step>
      </div>
    </>
  );
}

function Step({
  n,
  title,
  lede,
  children,
}: {
  n: string;
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-4 mb-3">
        <span className="font-mono text-[12px] tabular-nums text-neutral-300">{n}</span>
        <h2 className="text-xl font-light tracking-tight text-neutral-900">{title}</h2>
      </div>
      {lede && (
        <p className="pl-9 mb-5 max-w-2xl text-[13px] leading-relaxed text-neutral-600">{lede}</p>
      )}
      {children && <div className="pl-9">{children}</div>}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-1.5 text-[12px] leading-relaxed text-neutral-700">{v}</dd>
    </div>
  );
}
