'use client';

import React, { useState } from 'react';
import { Badge, EmptyState, PageHeader, Panel, TierBadge } from '../ui';
import {
  NOTICE_STAGE_LABEL,
  relativeTime,
  type NoticeRecord,
  type NoticeStage,
} from '@/lib/workspace';

const STAGES: NoticeStage[] = ['draft', 'awaiting_signature', 'signed', 'delivered', 'resolved'];

export default function NoticesView({ notices }: { notices: NoticeRecord[] }) {
  const [stage, setStage] = useState<NoticeStage | 'ALL'>('ALL');
  const rows = stage === 'ALL' ? notices : notices.filter((n) => n.stage === stage);

  return (
    <>
      <PageHeader
        title="Notices"
        lede="Every takedown notice Ceasefire has drafted. Nothing here is delivered automatically — a person reviews, approves, and signs each one."
      />

      {/* Pipeline */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-neutral-200 border border-neutral-200 rounded-lg overflow-hidden mb-10">
        {STAGES.map((s) => {
          const n = notices.filter((x) => x.stage === s).length;
          const active = stage === s;
          return (
            <button
              key={s}
              onClick={() => setStage(active ? 'ALL' : s)}
              className={`px-5 py-5 text-left transition-colors ${
                active ? 'bg-neutral-50' : 'bg-white hover:bg-neutral-50'
              }`}
              data-cursor={NOTICE_STAGE_LABEL[s]}
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-400 leading-tight">
                {NOTICE_STAGE_LABEL[s]}
              </div>
              <div className="mt-2 font-mono text-2xl tabular-nums text-neutral-900">{n}</div>
            </button>
          );
        })}
      </div>

      <Panel
        title={stage === 'ALL' ? 'All notices' : NOTICE_STAGE_LABEL[stage]}
        meta={
          stage !== 'ALL' ? (
            <button
              onClick={() => setStage('ALL')}
              className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400 hover:text-black transition-colors"
            >
              Clear filter
            </button>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
              {notices.length} total
            </span>
          )
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title={notices.length === 0 ? 'No notices yet' : 'Nothing at this stage'}
            body={
              notices.length === 0
                ? 'Draft one from a finding in the Sweep view. Notices move from draft to signed only when a person approves them.'
                : 'Notices move from draft to signed only when a person approves them.'
            }
          />
        ) : (
          <div className="divide-y divide-neutral-200">
            {rows.map((n) => (
              <div
                key={n.id}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-neutral-50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <TierBadge tier={n.tier} />
                    <span className="font-mono text-[13px] text-neutral-900 break-all">
                      {n.domain}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Badge tone={n.stage === 'resolved' ? 'ok' : 'neutral'}>
                      {NOTICE_STAGE_LABEL[n.stage]}
                    </Badge>
                    {n.registrar && (
                      <span className="font-mono text-[10px] text-neutral-400">
                        Registrar · {n.registrar}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                    Updated
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-neutral-700">
                    {relativeTime(n.updatedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <p className="mt-8 text-[11px] leading-relaxed text-neutral-400 max-w-2xl">
        Notices are generated from structured case facts through a conditional template, rendered
        by Foxit and routed for eIDAS-aligned signature. Delivery to the registrant is always a
        separate, deliberate action.
      </p>
    </>
  );
}
