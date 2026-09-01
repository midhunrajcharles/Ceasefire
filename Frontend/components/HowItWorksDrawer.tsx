'use client';

import React from 'react';
import Drawer from './Drawer';
import { ENGINES, PERMUTATION_TECHNIQUES, TIER_DEFINITION, TIER_ORDER } from '@/lib/types';

export default function HowItWorksDrawer({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer isOpen={isOpen} onClose={onClose} eyebrow="Method" title="How Ceasefire works">
      <div className="space-y-12">
        <Section n="01" title="Generate">
          <p className="text-[13px] leading-relaxed text-neutral-600 mb-4">
            Around 200 lookalike candidates are generated from the primary domain. Generation costs
            nothing — no API call is made at this stage.
          </p>
          <dl className="border border-neutral-200 rounded-lg divide-y divide-neutral-200">
            {PERMUTATION_TECHNIQUES.map((t) => (
              <div key={t.name} className="flex items-baseline justify-between gap-4 px-4 py-3">
                <div>
                  <dt className="font-mono text-[12px] text-neutral-900">{t.name}</dt>
                  <dd className="mt-0.5 text-[11px] text-neutral-500">{t.note}</dd>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-neutral-400">{t.example}</span>
              </div>
            ))}
          </dl>
        </Section>

        <Section n="02" title="Prefilter">
          <p className="text-[13px] leading-relaxed text-neutral-600 mb-4">
            Candidates are narrowed by checks that cost nothing: does DNS resolve, are MX records
            present, does an HTTP request return a live page. A search is spent only on what
            survives.
          </p>
          <div className="border border-neutral-200 rounded-lg px-4 py-4 font-mono text-[11px] text-neutral-600 leading-relaxed">
            200 generated<br />
            &nbsp;&nbsp;→ DNS resolves? <span className="text-neutral-400">~41 survive · free</span><br />
            &nbsp;&nbsp;→ MX records? <span className="text-neutral-400">flags mail-capable · free</span><br />
            &nbsp;&nbsp;→ HTTP 200? <span className="text-neutral-400">~18 survive · free</span><br />
            &nbsp;&nbsp;→ <span className="text-neutral-900">then spend searches</span>
          </div>
        </Section>

        <Section n="03" title="Sweep ten surfaces">
          <p className="text-[13px] leading-relaxed text-neutral-600 mb-4">
            Every surface below comes from SerpApi. Two of them — AI Overview and AI Mode — return
            the citations Google&apos;s own AI used to answer a question about the brand. If an
            impersonator appears there, the brand&apos;s official answer is being sourced from an
            attacker.
          </p>
          <ol className="border border-neutral-200 rounded-lg divide-y divide-neutral-200">
            {ENGINES.map((e, i) => (
              <li key={e.id} className="flex gap-4 px-4 py-3">
                <span className="shrink-0 font-mono text-[11px] text-neutral-300 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-neutral-900">{e.label}</span>
                    {e.headline && (
                      <span className="rounded-sm border border-neutral-900 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-900">
                        Novel
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">{e.purpose}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section n="04" title="Rank by harm">
          <p className="text-[13px] leading-relaxed text-neutral-600 mb-4">
            Tiers are a documented heuristic, not a validated classifier. There is no labelled
            evaluation set behind them — that is the first thing we would build next.
          </p>
          <dl className="border border-neutral-200 rounded-lg divide-y divide-neutral-200">
            {TIER_ORDER.map((t) => (
              <div key={t} className="px-4 py-3">
                <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-900">
                  {t}
                </dt>
                <dd className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                  {TIER_DEFINITION[t]}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section n="05" title="Draft — and stop">
          <p className="text-[13px] leading-relaxed text-neutral-600">
            The notice is generated from structured case facts through a conditional template, not
            as prose from a language model. It is then held at a review gate. A person reads it,
            redacts anything that should not leave the building, and approves it for signature.
            Ceasefire never sends.
          </p>
        </Section>

        <Section n="06" title="Constraints we built around">
          <dl className="border border-neutral-200 rounded-lg divide-y divide-neutral-200">
            <Row k="Search budget" v="250 / month on the free tier" />
            <Row k="Throughput" v="50 / hour — token bucket with jittered backoff" />
            <Row k="AI Overview token" v="page_token expires inside 60s — fetched inline, never batched" />
            <Row k="Cache" v="1h default is wrong for security scanning; verification paths set no_cache" />
            <Row k="Egress" v="Scheme allowlist, private and metadata ranges blocked, redirects re-checked" />
          </dl>
        </Section>

        <Section n="07" title="Scope">
          <p className="text-[13px] leading-relaxed text-neutral-600">
            Public search results, public DNS, and public registration state only. Nothing behind
            authentication, and nothing that requires bypassing a control.
          </p>
        </Section>
      </div>
    </Drawer>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="font-mono text-[11px] text-neutral-300 tabular-nums">{n}</span>
        <h3 className="text-[13px] uppercase tracking-[0.15em] font-mono text-neutral-900">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-1 text-[11px] leading-relaxed text-neutral-700">{v}</dd>
    </div>
  );
}
