'use client';

import React, { useEffect } from 'react';

/**
 * Slide-in panel. Replaces the source design's StudioDrawer with the same motion,
 * used for "How it works" and the defensive-registration flow.
 */
export default function Drawer({
  isOpen,
  onClose,
  title,
  eyebrow,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-500 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!isOpen}
        /* data-lenis-prevent: let this panel scroll natively instead of Lenis
           hijacking the wheel for the page behind it */
        data-lenis-prevent
        className={`fixed top-0 right-0 bottom-0 z-40 w-full sm:max-w-xl bg-white border-l border-neutral-200 overflow-y-auto transition-transform duration-500 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full invisible pointer-events-none'
        }`}
      >
        <div className="flex items-start justify-between gap-4 px-8 pt-10 pb-6">
          <div>
            {eyebrow && (
              <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono mb-3">
                {eyebrow}
              </p>
            )}
            <h2 className="text-2xl font-light tracking-tight text-neutral-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400 hover:text-black transition-colors"
          >
            Close
          </button>
        </div>

        <div className="px-8 pb-16">{children}</div>
      </aside>
    </>
  );
}
