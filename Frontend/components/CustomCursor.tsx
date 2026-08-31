'use client';

import React, { useEffect, useState, useRef } from 'react';

export default function CustomCursor() {
  const [position, setPosition] = useState({ x: -100, y: -100 });
  const [isHovered, setIsHovered] = useState(false);
  const [cursorText, setCursorText] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  const cursorRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: -100, y: -100, targetX: -100, targetY: -100 });

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      posRef.current.targetX = e.clientX;
      posRef.current.targetY = e.clientY;
      if (!isVisible) setIsVisible(true);

      // Check if hovering interactive element
      const target = e.target as HTMLElement;
      const interactiveEl = target.closest('a, button, [data-cursor], .projectBlock, .mediaBlock');
      if (interactiveEl) {
        setIsHovered(true);
        const label = interactiveEl.getAttribute('data-cursor') || '';
        setCursorText(label);
      } else {
        setIsHovered(false);
        setCursorText('');
      }
    };

    const onMouseLeave = () => setIsVisible(false);

    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);

    let rafId: number;
    const updatePosition = () => {
      posRef.current.x += (posRef.current.targetX - posRef.current.x) * 0.15;
      posRef.current.y += (posRef.current.targetY - posRef.current.y) * 0.15;

      setPosition({ x: posRef.current.x, y: posRef.current.y });
      rafId = requestAnimationFrame(updatePosition);
    };
    rafId = requestAnimationFrame(updatePosition);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
      cancelAnimationFrame(rafId);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div
      ref={cursorRef}
      className={`fixed pointer-events-none z-50 rounded-full transition-all duration-300 ease-out flex items-center justify-center font-sans uppercase tracking-widest text-[10px] font-medium ${
        isHovered
          ? 'w-20 h-20 bg-black text-white mix-blend-difference scale-100 shadow-lg'
          : 'w-3 h-3 bg-black rounded-full mix-blend-difference'
      }`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0) translate(-50%, -50%)`,
        opacity: isVisible ? 1 : 0
      }}
    >
      {isHovered && cursorText && (
        <span className="text-center px-1 animate-fadeIn">{cursorText}</span>
      )}
    </div>
  );
}
