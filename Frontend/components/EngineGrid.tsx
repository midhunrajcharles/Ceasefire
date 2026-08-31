'use client';

import React from 'react';
import type { EngineStatus } from '@/lib/types';

const STATE_DOT: Record<EngineStatus['state'], string> = {
  idle: 'bg-neutral-300',
  running: 'bg-neutral-900 animate-pulseDot',
  done: 'bg-neutral-900',
  cached: 'bg-amber-500',
  error: 'bg-red-600',
  skipped: 'bg-neutral-300',
};

const STATE_WORD: Record<EngineStatus['state'], string> = {
  idle: 'queued',
  running: 'sweeping',
  done: 'done',
  cached: 'cached',
  error: 'error',
  skipped: 'skipped',
};

export default function EngineGrid({ engines }: { engines: EngineStatus[] }) {
  const complete = engines.filter((e) => e.state === 'done' || e.state === 'cached').length;

  return (
    <section className="w-full">
      <div className="mb-5 flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono">
          Search surfaces
        </p>
        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono">
          {complete}/{engines.length} complete
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
        {engines.map((e) => (
          <div
            key={e.id}
            className="relative bg-white px-5 py-4 hover:bg-neutral-50 transition-colors"
            data-cursor={e.headline ? 'Nobody checks this' : undefined}
          >
            {e.state === 'running' && (
              <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
                <div className="h-full w-1/3 bg-neutral-900 animate-sweep" />
              </div>
            )}

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${STATE_DOT[e.state]}`} />
                  <span className="truncate font-mono text-[12px] text-neutral-900">{e.label}</span>
                  {e.headline && (
                    <span className="shrink-0 rounded-sm border border-neutral-900 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-900">
                      Novel
                    </span>
                  )}
                </div>
                <p className="mt-1.5 pl-3.5 text-[11px] leading-relaxed text-neutral-500">{e.purpose}</p>
              </div>

              <div className="shrink-0 text-right">
                <div className="font-mono text-[11px] tabular-nums">
                  {e.findings > 0 ? (
                    <span className="text-neutral-900 font-medium">
                      {e.findings} hit{e.findings === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-400">
                  {STATE_WORD[e.state]}
                  {e.cacheHit && ' · 0 spent'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
