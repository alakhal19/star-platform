'use client';

import { useEffect, useRef } from 'react';

export default function StarField() {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    // Don't add stars twice
    if (ref.current.children.length > 0) return;

    for (let i = 0; i < 80; i++) {
      const dot = document.createElement('div');
      const size = Math.random() * 2 + 0.5;
      dot.style.position = 'absolute';
      dot.style.width = size + 'px';
      dot.style.height = size + 'px';
      dot.style.borderRadius = '50%';
      dot.style.background = 'white';
      dot.style.left = Math.random() * 100 + '%';
      dot.style.top = Math.random() * 100 + '%';
      dot.style.animation = `twinkle ${2 + Math.random() * 4}s infinite ease-in-out`;
      dot.style.animationDelay = Math.random() * 3 + 's';
      ref.current.appendChild(dot);
    }
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-0 pointer-events-none overflow-hidden z-0"
    />
  );
}