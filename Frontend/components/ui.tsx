'use client';

import React from 'react';
import type { RiskTier } from '@/lib/types';

export const TIER_TEXT: Record<RiskTier, string> = {
  CRITICAL: 'text-red-700',
  HIGH: 'text-amber-700',
  MEDIUM: 'text-yellow-700',
  LOW: 'text-neutral-500',
};

export const TIER_DOT: Record<RiskTier, string> = {
  CRITICAL: 'bg-red-600',
  HIGH: 'bg-amber-500',
  MEDIUM: 'bg-yellow-500',
  LOW: 'bg-neutral-400',
};

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono">{children}</p>
  );
}

export function PageHeader({
  title,
  lede,
  action,
}: {
  title: string;
  lede?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-6 mb-10">
      <div className="max-w-2xl">
        <h1 className="text-3xl md:text-4xl font-light tracking-tight text-neutral-900">{title}</h1>
        {lede && <p className="mt-3 text-[13px] leading-relaxed text-neutral-600">{lede}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  title,
  meta,
  children,
  className = '',
}: {
  title?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {(title || meta) && (
        <div className="flex items-baseline justify-between gap-4 mb-4">
          {title && <Eyebrow>{title}</Eyebrow>}
          {meta}
        </div>
      )}
      <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white/70 backdrop-blur-[2px]">
        {children}
      </div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'default' | 'alert';
}) {
  return (
    <div className="bg-white px-5 py-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
        {label}
      </div>
      <div
        className={`mt-2 font-mono text-3xl tabular-nums ${
          tone === 'alert' ? 'text-red-700' : 'text-neutral-900'
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">{sub}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'critical' | 'high' | 'ok' | 'dark';
}) {
  const tones = {
    neutral: 'border-neutral-200 text-neutral-500',
    critical: 'border-red-300 text-red-700',
    high: 'border-amber-300 text-amber-700',
    ok: 'border-neutral-900 text-neutral-900',
    dark: 'border-neutral-900 bg-neutral-900 text-white',
  };
  return (
    <span
      className={`inline-block rounded-sm border px-2 py-px font-mono text-[9px] uppercase tracking-[0.15em] whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function TierBadge({ tier }: { tier: RiskTier }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full ${TIER_DOT[tier]}`} />
      <span className={`font-mono text-[10px] uppercase tracking-[0.15em] ${TIER_TEXT[tier]}`}>
        {tier}
      </span>
    </span>
  );
}

export function Button({
  children,
  variant = 'ghost',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  const base =
    'inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] font-mono transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed rounded-full';
  const styles =
    variant === 'primary'
      ? 'px-6 py-3 bg-black text-white border border-neutral-900 hover:bg-white hover:text-black font-medium'
      : 'px-5 py-2 border border-neutral-300 text-neutral-900 hover:border-black hover:bg-black hover:text-white';
  return (
    <button className={`${base} ${styles}`} {...rest}>
      {children}
    </button>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-[15px] font-light text-neutral-900">{title}</p>
      <p className="mt-2 max-w-md mx-auto text-[12px] leading-relaxed text-neutral-500">{body}</p>
    </div>
  );
}

/** Meter used for search quota and cache-hit rates. */
export function Meter({ value, max, tone = 'default' }: { value: number; max: number; tone?: 'default' | 'alert' }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="h-[3px] w-full bg-neutral-100 overflow-hidden rounded-full">
      <div
        className={`h-full transition-all duration-700 ${tone === 'alert' ? 'bg-red-600' : 'bg-black'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
