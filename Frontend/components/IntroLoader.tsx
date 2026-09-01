'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import CeasefireMark from './CeasefireMark';

const FILL_MS = 1500; // continuous hold required to reach 100%
const DECAY_MS = 600; // release drains back to 0 over this long

interface IntroLoaderProps {
  onComplete?: () => void;
}

export default function IntroLoader({ onComplete }: IntroLoaderProps) {
  const [progress, setProgress] = useState(0); // 0..1
  const [holding, setHolding] = useState(false);
  const [touched, setTouched] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const holdingRef = useRef(false);
  const progressRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    holdingRef.current = false;
    setHolding(false);
    setProgress(1);
    progressRef.current = 1;
    cancelAnimationFrame(rafRef.current);
    setTimeout(() => {
      setIsLoaded(true);
      setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, 700);
    }, 300);
  }, [onComplete]);

  // Single rAF loop: fills while held, drains while released
  useEffect(() => {
    const tick = (t: number) => {
      const dt = lastRef.current ? t - lastRef.current : 16;
      lastRef.current = t;

      if (!doneRef.current) {
        const delta = holdingRef.current ? dt / FILL_MS : -dt / DECAY_MS;
        const next = Math.max(0, Math.min(1, progressRef.current + delta));
        if (next !== progressRef.current) {
          progressRef.current = next;
          setProgress(next);
        }
        if (next >= 1) finish();
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [finish]);

  // Release anywhere, not just on the button
  useEffect(() => {
    const release = () => {
      holdingRef.current = false;
      setHolding(false);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, []);

  // Lock the page behind the overlay
  useEffect(() => {
    if (!isVisible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isVisible]);

  function press() {
    if (doneRef.current) return;
    setTouched(true);
    holdingRef.current = true;
    setHolding(true);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.repeat) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      press();
    }
  }

  function onKeyUp(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      holdingRef.current = false;
      setHolding(false);
    }
  }

  if (!isVisible) return null;

  const pct = Math.round(progress * 100);
  const R = 30;
  const C = 2 * Math.PI * R;

  return (
    <div
      className={`fixed inset-0 z-50 bg-white flex flex-col justify-between p-8 md:p-16 transition-opacity duration-700 ${
        isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{ touchAction: 'none' }}
    >
      {/* Top */}
      <div className="w-full flex justify-between items-start">
        <CeasefireMark className="text-black" />
        <div className="text-xs font-mono tracking-widest text-neutral-400 tabular-nums">
          {pct}%
        </div>
      </div>

      {/* Centre — headline fills as you hold */}
      <div
        className="drag-reveal max-w-4xl text-2xl md:text-4xl font-light tracking-tight select-none"
        style={{ ['--reveal' as string]: `${pct}%` }}
      >
        Ten search surfaces. One input.
        <br />
        Everyone pretending to be you.
      </div>

      {/* Bottom — hold target */}
      <div className="w-full flex items-end justify-between gap-8">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onPointerDown={press}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="Press and hold to enter"
            className={`relative w-[72px] h-[72px] rounded-full outline-none select-none
                        focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-black
                        transition-transform duration-300 ${holding ? 'scale-95' : 'scale-100'}`}
          >
            {/* progress ring */}
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 72 72" aria-hidden="true">
              <circle cx="36" cy="36" r={R} fill="none" stroke="#e5e5e5" strokeWidth="1.5" />
              <circle
                cx="36"
                cy="36"
                r={R}
                fill="none"
                stroke="#030303"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - progress)}
              />
            </svg>

            {/* filled core */}
            <span
              className={`absolute inset-[10px] rounded-full flex items-center justify-center
                          transition-colors duration-300 ${
                            holding || progress > 0 ? 'bg-black text-white' : 'bg-white text-black border border-neutral-200'
                          }`}
            >
              <CeasefireMark showWord={false} />
            </span>

            {/* idle pulse ring, until first press */}
            {!touched && (
              <span className="absolute inset-0 rounded-full border border-neutral-300 animate-pulseDot pointer-events-none" />
            )}
          </button>

          <div>
            <div className="text-[11px] tracking-[0.2em] uppercase text-neutral-900 font-mono">
              {progress >= 1 ? 'Entering' : holding ? 'Hold…' : 'Press and hold'}
            </div>
            <div className="mt-1 text-[11px] tracking-[0.1em] text-neutral-400 font-mono">
              {progress >= 1
                ? 'Ceasefire'
                : holding
                  ? 'Keep holding to continue'
                  : 'Release resets'}
            </div>
          </div>
        </div>

        <div className="text-[11px] tracking-[0.2em] uppercase text-neutral-400 font-mono text-right">
          Impersonation reconnaissance
        </div>
      </div>
    </div>
  );
}
