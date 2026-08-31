'use client';

import React from 'react';
import { SCAN_STAGES, type Scan, type ScanState } from '@/lib/types';

const ORDER: ScanState[] = ['generating', 'prefiltering', 'sweeping', 'scoring', 'complete'];

export default function ScanProgress({ scan }: { scan: Scan }) {
  const current = ORDER.indexOf(scan.state);

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono">
          {scan.brand} · {scan.domain}
        </p>
        {typeof scan.elapsedMs === 'number' && (
          <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono tabular-nums">
            {(scan.elapsedMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <ol className="border border-neutral-200 rounded-lg divide-y divide-neutral-200">
        {SCAN_STAGES.map((stage, i) => {
          const done = current > i;
          const active = current === i;
          return (
            <li key={stage.key} className="flex items-start gap-4 px-5 py-4">
              <span className="mt-1 shrink-0">
                {done ? (
                  <span className="block w-2 h-2 rounded-full bg-neutral-900" />
                ) : active ? (
                  <span className="block w-2 h-2 rounded-full bg-neutral-900 animate-pulseDot" />
                ) : (
                  <span className="block w-2 h-2 rounded-full border border-neutral-300" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`font-mono text-[12px] uppercase tracking-[0.15em] ${
                      done || active ? 'text-neutral-900' : 'text-neutral-300'
                    }`}
                  >
                    {stage.label}
                  </span>
                  {active && (
                    <span className="relative h-px w-24 overflow-hidden bg-neutral-200">
                      <span className="absolute inset-y-0 left-0 w-1/3 bg-neutral-900 animate-sweep" />
                    </span>
                  )}
                </div>
                <p
                  className={`mt-1 text-[11px] leading-relaxed ${
                    done || active ? 'text-neutral-500' : 'text-neutral-300'
                  }`}
                >
                  {stage.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
