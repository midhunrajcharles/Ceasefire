'use client';

import React, { useEffect, useState } from 'react';
import Drawer from './Drawer';
import { checkAvailability, registerDomain } from '@/lib/api';
import type { DomainOffer } from '@/lib/types';

type Step = 'checking' | 'offer' | 'unavailable' | 'registering' | 'done' | 'error';

export default function RegisterDrawer({
  domain,
  onClose,
}: {
  domain: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('checking');
  const [offer, setOffer] = useState<DomainOffer | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!domain) return;
    let cancelled = false;
    setStep('checking');
    setOffer(null);
    setOrderId(null);
    setMessage(null);

    checkAvailability(domain)
      .then((o) => {
        if (cancelled) return;
        setOffer(o);
        setStep(o.available ? 'offer' : 'unavailable');
      })
      .catch((e) => {
        if (cancelled) return;
        setMessage(e instanceof Error ? e.message : 'Availability check failed');
        setStep('error');
      });

    return () => {
      cancelled = true;
    };
  }, [domain]);

  async function submit() {
    if (!domain) return;
    setStep('registering');
    try {
      const r = await registerDomain(domain);
      if (r.ok) {
        setOrderId(r.orderId ?? null);
        setStep('done');
      } else {
        setMessage('Registration was declined.');
        setStep('error');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Registration failed');
      setStep('error');
    }
  }

  return (
    <Drawer
      isOpen={Boolean(domain)}
      onClose={onClose}
      eyebrow="Defensive registration"
      title={domain ?? ''}
    >
      <p className="text-[13px] leading-relaxed text-neutral-600 mb-8">
        This lookalike is unregistered. Registering it yourself removes the candidate from the
        attack surface before anyone else takes it — cheaper than a takedown, and permanent.
      </p>

      {step === 'checking' && (
        <div className="border border-neutral-200 rounded-lg px-5 py-6">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-900 animate-pulseDot" />
            <span className="font-mono text-[12px] text-neutral-600">
              Checking availability with name.com…
            </span>
          </div>
        </div>
      )}

      {step === 'offer' && offer && (
        <div className="space-y-6">
          <dl className="border border-neutral-200 rounded-lg divide-y divide-neutral-200">
            <div className="flex items-center justify-between px-5 py-4">
              <dt className="text-[13px] text-neutral-600">Domain</dt>
              <dd className="font-mono text-[13px] text-neutral-900">{offer.domain}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-4">
              <dt className="text-[13px] text-neutral-600">Status</dt>
              <dd className="font-mono text-[12px] uppercase tracking-[0.15em] text-neutral-900">
                Available
              </dd>
            </div>
            <div className="flex items-center justify-between px-5 py-4">
              <dt className="text-[13px] text-neutral-600">First year</dt>
              <dd className="font-mono text-[15px] text-neutral-900 tabular-nums">
                ${offer.priceUsd?.toFixed(2) ?? '—'}
              </dd>
            </div>
          </dl>

          <button
            onClick={submit}
            className="text-[11px] uppercase tracking-[0.15em] font-mono font-medium px-6 py-3 rounded-full bg-black text-white border border-neutral-900 hover:bg-white hover:text-black transition-all duration-300"
          >
            Register through name.com
          </button>

          <p className="text-[11px] leading-relaxed text-neutral-400">
            Registration is performed through the name.com API against the account configured for
            this workspace.
          </p>
        </div>
      )}

      {step === 'unavailable' && (
        <div className="border border-neutral-200 rounded-lg px-5 py-6">
          <p className="text-[13px] text-neutral-600">
            {domain} is already registered. It will stay in the findings list for monitoring.
          </p>
        </div>
      )}

      {step === 'registering' && (
        <div className="border border-neutral-200 rounded-lg px-5 py-6">
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-900 animate-pulseDot" />
            <span className="font-mono text-[12px] text-neutral-600">Placing the order…</span>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-5">
          <div className="border border-neutral-900 rounded-lg px-5 py-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-900 mb-2">
              Registered
            </p>
            <p className="text-[13px] leading-relaxed text-neutral-600">
              {domain} is now yours and has been removed from the open attack surface.
            </p>
            {orderId && (
              <p className="mt-3 font-mono text-[11px] text-neutral-400">Order {orderId}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[11px] uppercase tracking-[0.15em] font-mono px-5 py-2 rounded-full border border-neutral-300 text-neutral-900 hover:border-black hover:bg-black hover:text-white transition-all duration-300"
          >
            Back to findings
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="border border-red-300 bg-red-50 rounded-lg px-5 py-4">
          <p className="font-mono text-[12px] leading-relaxed text-red-700">{message}</p>
        </div>
      )}
    </Drawer>
  );
}
