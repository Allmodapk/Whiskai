import React, { useState, useRef, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';

interface BeforeAfterSliderProps {
  beforeImage: string;
  afterImage: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export const BeforeAfterSlider: React.FC<BeforeAfterSliderProps> = ({
  beforeImage,
  afterImage,
  beforeLabel = 'Subject',
  afterLabel = 'Generated',
}) => {
  const [sliderPosition, setSliderPosition] = useState<number>(50); // percentage 0-100
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const clamped = Math.max(0, Math.min(rect.width, x));
    const percent = (clamped / rect.width) * 100;
    setSliderPosition(percent);
  }, []);

  const onTouchMove = (e: React.TouchEvent) => {
    handleMove(e.touches[0].clientX);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      handleMove(e.clientX);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-square sm:aspect-video max-h-[65vh] overflow-hidden rounded-2xl border border-[#303544] bg-black select-none cursor-ew-resize touch-none shadow-xl"
      onMouseDown={() => setIsDragging(true)}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
      onMouseMove={onMouseMove}
      onTouchMove={onTouchMove}
    >
      {/* Background Image (After / Generated) */}
      <img
        src={afterImage}
        alt="After result"
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
      />

      {/* Foreground Image (Before / Reference), clipped by width */}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ width: `${sliderPosition}%` }}
      >
        <img
          src={beforeImage}
          alt="Before reference"
          className="absolute inset-0 w-full h-full object-contain max-w-none pointer-events-none"
          style={{ width: containerRef.current ? `${containerRef.current.clientWidth}px` : '100%' }}
        />
      </div>

      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-[#f5c518] pointer-events-none z-10 shadow-[0_0_8px_rgba(245,197,24,0.8)]"
        style={{ left: `${sliderPosition}%` }}
      >
        {/* Handle circle */}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-[#f5c518] text-black shadow-lg flex items-center justify-center font-bold">
          <SlidersHorizontal className="w-4 h-4 rotate-90" />
        </div>
      </div>

      {/* Floating Badges */}
      <div className="absolute top-3 left-3 z-20 pointer-events-none">
        <span className="bg-black/75 backdrop-blur-md border border-white/10 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md">
          {beforeLabel}
        </span>
      </div>
      <div className="absolute top-3 right-3 z-20 pointer-events-none">
        <span className="bg-[#f5c518]/90 text-black text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md shadow-sm">
          {afterLabel}
        </span>
      </div>
      
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <span className="bg-black/60 backdrop-blur-sm text-zinc-300 text-[10px] px-2.5 py-0.5 rounded-full border border-white/5">
          Drag to compare
        </span>
      </div>
    </div>
  );
};
