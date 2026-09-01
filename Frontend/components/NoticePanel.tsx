'use client';

import React, { useEffect, useState } from 'react';
import type { Notice } from '@/lib/types';

/**
 * The human review gate.
 *
 * Nutrient's own framing: "built so agents can act on the output and people can
 * verify it." The agent drafts; a person reads, redacts, and only then signs.
 * Nothing is ever sent automatically.
 */
export default function NoticePanel({
  notice,
  onApprove,
  onSign,
  onClose,
  busy,
}: {
  notice: Notice | null;
  onApprove: (id: string) => void;
  onSign: (id: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (notice?.state === 'draft') setConfirmed(false);
  }, [notice?.id, notice?.state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (notice) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notice, onClose]);

  if (!notice) return null;

  const steps: { key: Notice['state']; label: string }[] = [
    { key: 'draft', label: 'Drafted' },
    { key: 'reviewed', label: 'Reviewed' },
    { key: 'signed', label: 'Signed' },
  ];
  const currentStep = steps.findIndex((s) => s.key === notice.state);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notice review"
        /* data-lenis-prevent: scroll the modal natively, not the page behind it */
        data-lenis-prevent
        className="bg-white border border-neutral-200 rounded-lg max-h-[90vh] w-full max-w-2xl overflow-y-auto sm:mx-6"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono mb-2">
              Review gate
            </p>
            <h2 className="text-xl font-light text-neutral-900">
              {notice.state === 'signed' ? 'Notice signed' : 'Notice drafted — not sent'}
            </h2>
            <p className="mt-1 font-mono text-[12px] text-neutral-500">{notice.domain}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400 hover:text-black transition-colors"
          >
            Close
          </button>
        </div>

        {/* Stepper */}
        <div className="border-t border-neutral-200 px-6 py-4">
          <ol className="flex items-center gap-3">
            {steps.map((s, i) => (
              <React.Fragment key={s.key}>
                <li className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      i <= currentStep ? 'bg-neutral-900' : 'border border-neutral-300'
                    }`}
                  />
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.15em] ${
                      i <= currentStep ? 'text-neutral-900' : 'text-neutral-300'
                    }`}
                  >
                    {s.label}
                  </span>
                </li>
                {i < steps.length - 1 && (
                  <span className="flex-1 h-px bg-neutral-200" aria-hidden="true" />
                )}
              </React.Fragment>
            ))}
          </ol>
        </div>

        {/* Case facts — structured in, conditional template out. Not model prose. */}
        <div className="border-t border-neutral-200 px-6 py-5">
          <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono mb-3">
            Case facts
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-neutral-200 border border-neutral-200 rounded-md overflow-hidden">
            {Object.entries(notice.caseFacts).map(([k, v]) => (
              <div key={k} className="bg-white px-4 py-3">
                <dt className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-400">
                  {k.replace(/_/g, ' ')}
                </dt>
                <dd className="mt-1 break-words font-mono text-[12px] text-neutral-900">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
            Generated from structured case facts through a conditional template — not prose from a
            language model.
          </p>
        </div>

        {/* Draft body */}
        <div className="border-t border-neutral-200 px-6 py-5">
          <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono mb-3">
            Draft
          </p>
          <div className="max-h-72 overflow-y-auto border border-neutral-200 bg-neutral-50 rounded-md p-4">
            <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-neutral-700">
              {notice.bodyMarkdown}
            </pre>
          </div>
        </div>

        {/* Gate */}
        <div className="border-t border-neutral-200 px-6 py-5">
          {notice.state === 'draft' && (
            <>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-black"
                />
                <span className="text-[13px] leading-relaxed text-neutral-600">
                  I have read this notice, verified the evidence, and redacted anything that should
                  not leave the building.
                </span>
              </label>

              <div className="mt-5 flex flex-wrap items-center gap-4">
                <button
                  className="text-[11px] uppercase tracking-[0.15em] font-mono font-medium px-6 py-3 rounded-full bg-black text-white border border-neutral-900 hover:bg-white hover:text-black transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
                  disabled={!confirmed || busy}
                  onClick={() => onApprove(notice.id)}
                  data-cursor="Approve"
                >
                  Approve for signature
                </button>
                <span className="text-[11px] uppercase tracking-[0.15em] text-neutral-400 font-mono">
                  Ceasefire never sends. A person does.
                </span>
              </div>
            </>
          )}

          {notice.state === 'reviewed' && (
            <div className="flex flex-wrap items-center gap-4">
              <button
                className="text-[11px] uppercase tracking-[0.15em] font-mono font-medium px-6 py-3 rounded-full bg-black text-white border border-neutral-900 hover:bg-white hover:text-black transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={busy}
                onClick={() => onSign(notice.id)}
                data-cursor="Sign"
              >
                {busy ? 'Routing…' : 'Route to Foxit eSign'}
              </button>
              <span className="text-[11px] uppercase tracking-[0.15em] text-neutral-400 font-mono">
                Approved — awaiting signature
              </span>
            </div>
          )}

          {notice.state === 'signed' && (
            <div className="space-y-4">
              <div className="border border-neutral-900 rounded-lg px-5 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-900 mb-2">
                  Signed
                </p>
                <p className="text-[13px] leading-relaxed text-neutral-600">
                  The notice has been signed and is ready to deliver. Delivery is a deliberate,
                  separate action taken by a person.
                </p>
                <dl className="mt-4 space-y-1">
                  {notice.envelopeId && (
                    <div className="flex gap-3">
                      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                        Envelope
                      </dt>
                      <dd className="font-mono text-[11px] text-neutral-700">{notice.envelopeId}</dd>
                    </div>
                  )}
                  {notice.signedAt && (
                    <div className="flex gap-3">
                      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
                        At
                      </dt>
                      <dd className="font-mono text-[11px] text-neutral-700">
                        {new Date(notice.signedAt).toLocaleString()}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <button
                onClick={onClose}
                className="text-[11px] uppercase tracking-[0.15em] font-mono px-5 py-2 rounded-full border border-neutral-300 text-neutral-900 hover:border-black hover:bg-black hover:text-white transition-all duration-300"
              >
                Back to findings
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
