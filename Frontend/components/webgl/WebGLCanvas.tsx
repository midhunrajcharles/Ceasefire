'use client';

import React, { useEffect, useRef } from 'react';
import { WebGLSceneManager } from './WebGLScene';

interface WebGLCanvasProps {
  scrollVelocity?: number;
}

export default function WebGLCanvas({ scrollVelocity = 0 }: WebGLCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<WebGLSceneManager | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    managerRef.current = new WebGLSceneManager(containerRef.current);

    return () => {
      if (managerRef.current) {
        managerRef.current.destroy();
        managerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.setScrollVelocity(scrollVelocity);
    }
  }, [scrollVelocity]);

  return (
    <div
      ref={containerRef}
      className="webglApp fixed inset-0 pointer-events-none z-0 overflow-hidden"
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
