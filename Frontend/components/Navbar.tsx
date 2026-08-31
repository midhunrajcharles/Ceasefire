'use client';

import React from 'react';
import Link from 'next/link';
import CeasefireMark from './CeasefireMark';
import UserMenu from './UserMenu';
import type { ScanBudget } from '@/lib/types';
import type { Session } from '@/lib/session';

interface NavbarProps {
  budget?: ScanBudget;
  session?: Session | null;
  onOpenAbout?: () => void;
  onSignOut?: () => void;
}

export default function Navbar({ budget, session, onOpenAbout, onSignOut }: NavbarProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-30 flex justify-between items-center px-6 sm:px-12 md:px-20 py-8 pointer-events-none">
      {/* Brand */}
      <div className="pointer-events-auto">
        <Link
          href="/"
          className="inline-block text-black hover:opacity-75 transition-opacity"
          data-cursor="Home"
        >
          <CeasefireMark />
        </Link>
      </div>

      <div className="flex items-center gap-6 sm:gap-8 pointer-events-auto">
        {/* Search budget — SerpApi free tier is 250/month, 50/hour */}
        {budget && (
          <div
            className="hidden sm:flex items-center gap-2 font-mono"
            title="SerpApi free tier: 250 searches / month"
          >
            <span className="text-[11px] uppercase tracking-[0.15em] text-neutral-600">
              Searches
            </span>
            <span className="text-[11px] text-neutral-900 tabular-nums">
              {budget.spent}
              <span className="text-neutral-400">/{budget.total}</span>
            </span>
            {budget.cacheHits > 0 && (
              <span className="text-[10px] text-neutral-400">+{budget.cacheHits} cached</span>
            )}
          </div>
        )}

        <button
          onClick={onOpenAbout}
          className="text-[11px] uppercase tracking-[0.15em] text-neutral-900 font-medium px-5 py-2 rounded-full border border-neutral-300 hover:border-black hover:bg-black hover:text-white transition-all duration-300 font-mono"
          data-cursor="How"
        >
          HOW IT WORKS
        </button>

        {session && onSignOut && <UserMenu session={session} onSignOut={onSignOut} />}
      </div>
    </header>
  );
}
