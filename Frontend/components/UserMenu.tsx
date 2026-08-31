'use client';

import React, { useEffect, useRef, useState } from 'react';
import { initials, type Session } from '@/lib/session';

export default function UserMenu({
  session,
  onSignOut,
}: {
  session: Session;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-9 h-9 rounded-full border border-neutral-300 hover:border-black hover:bg-black hover:text-white transition-all duration-300 font-mono text-[10px] tracking-[0.05em] text-neutral-900 flex items-center justify-center"
        data-cursor="Account"
      >
        {initials(session.email)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-3 w-64 bg-white border border-neutral-200 rounded-lg overflow-hidden animate-fadeIn"
        >
          <div className="px-4 py-4 border-b border-neutral-200">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">
              Workspace
            </div>
            <div className="mt-1 text-[13px] text-neutral-900 truncate">{session.organisation}</div>
            <div className="mt-0.5 font-mono text-[11px] text-neutral-500 truncate">
              {session.email}
            </div>
          </div>

          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="w-full text-left px-4 py-3 font-mono text-[11px] uppercase tracking-[0.15em] text-neutral-900 hover:bg-neutral-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
