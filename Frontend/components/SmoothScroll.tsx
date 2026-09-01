'use client';

import React, { useEffect, useState, createContext, useContext } from 'react';
import Lenis from 'lenis';

interface ScrollContextType {
  lenis: Lenis | null;
  velocity: number;
}

const ScrollContext = createContext<ScrollContextType>({ lenis: null, velocity: 0 });

export const useSmoothScroll = () => useContext(ScrollContext);

export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const [velocity, setVelocity] = useState<number>(0);

  useEffect(() => {
    const lenisInstance = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 2,
    });

    setLenis(lenisInstance);

    let rafId: number;
    function raf(time: number) {
      lenisInstance.raf(time);
      setVelocity(lenisInstance.velocity);
      rafId = requestAnimationFrame(raf);
    }

    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenisInstance.destroy();
    };
  }, []);

  return (
    <ScrollContext.Provider value={{ lenis, velocity }}>
      {children}
    </ScrollContext.Provider>
  );
}
