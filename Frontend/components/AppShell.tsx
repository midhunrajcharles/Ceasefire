'use client';

import React, { useEffect, useState } from 'react';
import CeasefireMark from './CeasefireMark';
import UserMenu from './UserMenu';
import { Meter } from './ui';
import type { ScanBudget } from '@/lib/types';
import type { Session } from '@/lib/session';

export type ViewKey =
  | 'overview'
  | 'sweep'
  | 'findings'
  | 'notices'
  | 'domains'
  | 'surfaces'
  | 'method'
  | 'settings';

const NAV: { group: string; items: { key: ViewKey; label: string }[] }[] = [
  {
    group: 'Monitor',
    items: [
      { key: 'overview', label: 'Overview' },
      { key: 'sweep', label: 'New sweep' },
    ],
  },
  {
    group: 'Respond',
    items: [
      { key: 'findings', label: 'Findings' },
      { key: 'notices', label: 'Notices' },
      { key: 'domains', label: 'Domains' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { key: 'surfaces', label: 'Surfaces' },
      { key: 'method', label: 'Method' },
      { key: 'settings', label: 'Settings' },
    ],
  },
];

const VALID = new Set<string>(NAV.flatMap((g) => g.items.map((i) => i.key)));

export default function AppShell({
  view,
  onNavigate,
  session,
  budget,
  onSignOut,
  counts,
  children,
}: {
  view: ViewKey;
  onNavigate: (v: ViewKey) => void;
  session: Session;
  budget: ScanBudget;
  onSignOut: () => void;
  counts: { findings: number; notices: number; domains: number };
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Deep-link support via the URL hash — back button works between views
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace('#', '');
      if (VALID.has(h)) onNavigate(h as ViewKey);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [onNavigate]);

  function go(v: ViewKey) {
    if (window.location.hash !== `#${v}`) window.location.hash = v;
    onNavigate(v);
    setMobileOpen(false);
  }

  const badgeFor = (k: ViewKey) =>
    k === 'findings' ? counts.findings : k === 'notices' ? counts.notices : k === 'domains' ? counts.domains : 0;

  const nav = (
    <nav className="flex-1 overflow-y-auto px-4 py-2" data-lenis-prevent>
      {NAV.map((g) => (
        <div key={g.group} className="mb-8">
          <div className="px-3 mb-3 font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-300">
            {g.group}
          </div>
          <ul className="space-y-px">
            {g.items.map((item) => {
              const active = view === item.key;
              const n = badgeFor(item.key);
              return (
                <li key={item.key}>
                  <button
                    onClick={() => go(item.key)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-left transition-colors duration-200 ${
                      active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                    data-cursor={item.label}
                  >
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
                      {item.label}
                    </span>
                    {n > 0 && (
                      <span
                        className={`font-mono text-[10px] tabular-nums ${
                          active ? 'text-neutral-400' : 'text-neutral-400'
                        }`}
                      >
                        {n}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const quota = (
    <div className="px-7 py-5 border-t border-neutral-200">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-400">
          Search quota
        </span>
        <span className="font-mono text-[11px] tabular-nums text-neutral-900">
          {budget.spent}
          <span className="text-neutral-400">/{budget.total}</span>
        </span>
      </div>
      <Meter value={budget.spent} max={budget.total} tone={budget.spent > budget.total * 0.8 ? 'alert' : 'default'} />
      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-neutral-400">
        SerpApi free tier · resets monthly
      </p>
    </div>
  );

  return (
    <div className="relative z-10 min-h-screen">
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[260px] flex-col bg-white border-r border-neutral-200 z-30">
        <div className="px-7 py-8">
          <button onClick={() => go('overview')} className="text-black hover:opacity-70 transition-opacity" data-cursor="Home">
            <CeasefireMark />
          </button>
          <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400 truncate">
            {session.organisation}
          </div>
        </div>
        {nav}
        {quota}
      </aside>

      {/* Sidebar — mobile drawer */}
      {mobileOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/20" onClick={() => setMobileOpen(false)} />
          <aside className="lg:hidden fixed inset-y-0 left-0 w-[280px] flex flex-col bg-white border-r border-neutral-200 z-40 animate-fadeIn">
            <div className="px-7 py-8">
              <CeasefireMark className="text-black" />
              <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400 truncate">
                {session.organisation}
              </div>
            </div>
            {nav}
            {quota}
          </aside>
        </>
      )}

      {/* Main */}
      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 px-6 sm:px-10 py-5 bg-white/85 backdrop-blur-md border-b border-neutral-200">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden font-mono text-[11px] uppercase tracking-[0.15em] text-neutral-900 border border-neutral-300 rounded-full px-4 py-1.5"
              aria-label="Open navigation"
            >
              Menu
            </button>
            <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-neutral-400 truncate">
              {session.organisation}
              <span className="text-neutral-300"> / </span>
              <span className="text-neutral-900">
                {NAV.flatMap((g) => g.items).find((i) => i.key === view)?.label}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-5 shrink-0">
            <span className="hidden sm:inline font-mono text-[11px] text-neutral-400 tabular-nums">
              {budget.spent}/{budget.total} searches
            </span>
            <UserMenu session={session} onSignOut={onSignOut} />
          </div>
        </header>

        <main className="px-6 sm:px-10 py-10 sm:py-14 max-w-[1200px]">{children}</main>
      </div>
    </div>
  );
}
