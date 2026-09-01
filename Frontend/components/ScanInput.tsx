'use client';

import React, { useState } from 'react';

interface ScanInputProps {
  onScan: (brand: string, domain: string) => void;
  busy?: boolean;
  isMock?: boolean;
  organisation?: string;
}

export default function ScanInput({ onScan, busy, isMock, organisation }: ScanInputProps) {
  const [brand, setBrand] = useState('');
  const [domain, setDomain] = useState('');

  const canSubmit = brand.trim().length > 0 && domain.trim().length > 0 && !busy;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onScan(
      brand.trim(),
      domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    );
  }

  return (
    <section className="w-full max-w-3xl">
      <div className="mb-14">
        <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono mb-6">
          {organisation ? `${organisation} · New sweep` : 'Brand impersonation reconnaissance'}
        </p>
        <h1 className="text-4xl md:text-6xl font-light leading-[1.05] tracking-tight text-neutral-900">
          Someone is pretending
          <br />
          to be you.
          <span className="block mt-3 text-neutral-400">Find out where.</span>
        </h1>
        <p className="mt-8 max-w-xl text-sm leading-relaxed text-neutral-600">
          Ceasefire sweeps ten separate search surfaces for lookalike domains, fake apps, counterfeit
          listings, impersonation channels — and whether Google&apos;s own AI is citing an attacker as a
          source for your brand. Then it drafts the takedown notice for you to review.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <div>
          <label htmlFor="brand" className="block text-[11px] uppercase tracking-[0.15em] text-neutral-400 font-mono mb-2">
            Brand name
          </label>
          <input
            id="brand"
            className="w-full bg-transparent border-b border-neutral-200 px-0 py-4 text-lg text-neutral-900 placeholder:text-neutral-300 focus:border-black focus:outline-none transition-colors duration-300"
            placeholder="Example Corp"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div>
          <label htmlFor="domain" className="block text-[11px] uppercase tracking-[0.15em] text-neutral-400 font-mono mb-2">
            Primary domain
          </label>
          <input
            id="domain"
            className="w-full bg-transparent border-b border-neutral-200 px-0 py-4 text-lg text-neutral-900 placeholder:text-neutral-300 focus:border-black focus:outline-none transition-colors duration-300"
            placeholder="example-corp.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-wrap items-center gap-5 pt-4">
          <button
            type="submit"
            disabled={!canSubmit}
            data-cursor="Scan"
            className="text-[11px] uppercase tracking-[0.15em] font-mono font-medium px-6 py-3 rounded-full border border-neutral-900 bg-black text-white hover:bg-white hover:text-black transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? 'Scanning' : 'Run sweep'}
          </button>
          <span className="text-[11px] uppercase tracking-[0.15em] text-neutral-400 font-mono">
            Ten surfaces · up to 25 searches
          </span>
        </div>
      </form>

      {isMock && (
        <div className="mt-10 flex items-center gap-3 border border-amber-300 bg-amber-50 px-4 py-3 rounded-md">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-[11px] uppercase tracking-[0.15em] font-mono text-amber-700">
            Demo data — not a live scan
          </span>
        </div>
      )}
    </section>
  );
}
