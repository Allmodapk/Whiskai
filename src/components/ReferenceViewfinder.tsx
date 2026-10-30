import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Grid,
  Crosshair,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
  EyeOff,
  Sparkles,
} from 'lucide-react';

export type ViewfinderGridMode = 'thirds' | 'crosshair' | 'off';

interface ReferenceViewfinderProps {
  imageUrl: string;
  imageName?: string;
  aspectRatioLabel?: string;
  orientationLabel?: string;
  toolBadgeLabel?: string;
  isScanning?: boolean;
  compact?: boolean;
  className?: string;
}

export const ReferenceViewfinder: React.FC<ReferenceViewfinderProps> = ({
  imageUrl,
  imageName = 'Reference Image',
  aspectRatioLabel = '3:4',
  orientationLabel,
  toolBadgeLabel = 'Optical Reference',
  isScanning = false,
  compact = false,
  className = '',
}) => {
  const [gridMode, setGridMode] = useState<ViewfinderGridMode>('thirds');
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  const cycleGridMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    setGridMode((prev) =>
      prev === 'thirds' ? 'crosshair' : prev === 'crosshair' ? 'off' : 'thirds'
    );
  };

  useEffect(() => {
    if (!isLightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLightboxOpen(false);
        setIsZoomed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen]);

  const renderGridSvg = (mode: ViewfinderGridMode) => {
    if (mode === 'off') return null;

    return (
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {mode === 'thirds' && (
          <g stroke="rgba(255, 255, 255, 0.28)" strokeWidth="0.35" strokeDasharray="1.5 1.5">
            <line x1="33.33" y1="0" x2="33.33" y2="100" />
            <line x1="66.66" y1="0" x2="66.66" y2="100" />
            <line x1="0" y1="33.33" x2="100" y2="33.33" />
            <line x1="0" y1="66.66" x2="100" y2="66.66" />
            {/* Rule of thirds intersection power points */}
            <circle cx="33.33" cy="33.33" r="1" fill="rgba(245, 197, 24, 0.75)" stroke="none" />
            <circle cx="66.66" cy="33.33" r="1" fill="rgba(245, 197, 24, 0.75)" stroke="none" />
            <circle cx="33.33" cy="66.66" r="1" fill="rgba(245, 197, 24, 0.75)" stroke="none" />
            <circle cx="66.66" cy="66.66" r="1" fill="rgba(245, 197, 24, 0.75)" stroke="none" />
          </g>
        )}

        {mode === 'crosshair' && (
          <g stroke="rgba(245, 197, 24, 0.42)" strokeWidth="0.35">
            <line x1="50" y1="0" x2="50" y2="100" strokeDasharray="2 2" />
            <line x1="0" y1="50" x2="100" y2="50" strokeDasharray="2 2" />
            <line x1="0" y1="0" x2="100" y2="100" stroke="rgba(255,255,255,0.14)" />
            <line x1="100" y1="0" x2="0" y2="100" stroke="rgba(255,255,255,0.14)" />
            <circle
              cx="50"
              cy="50"
              r="6"
              fill="none"
              stroke="rgba(245, 197, 24, 0.65)"
              strokeWidth="0.4"
            />
            <circle cx="50" cy="50" r="0.9" fill="rgba(245, 197, 24, 0.9)" stroke="none" />
          </g>
        )}
      </svg>
    );
  };

  return (
    <>
      <div
        className={`group relative rounded-2xl overflow-hidden bg-[#050609]/90 border border-white/[0.1] shadow-2xl select-none ${className}`}
      >
        {/* Corner Optical Reticle Brackets */}
        <div className="pointer-events-none absolute inset-2.5 z-20">
          <div className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-[#f5c518]/70 rounded-tl-xs" />
          <div className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-[#f5c518]/70 rounded-tr-xs" />
          <div className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-[#f5c518]/70 rounded-bl-xs" />
          <div className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-[#f5c518]/70 rounded-br-xs" />
        </div>

        {/* Top HUD Telemetry Bar */}
        <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
          <div className="px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-[11px] font-mono text-zinc-200 tabular-nums flex items-center gap-1.5">
            <span className="text-[#f5c518] font-semibold">{aspectRatioLabel}</span>
            {orientationLabel && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-300">{orientationLabel}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            <button
              type="button"
              onClick={cycleGridMode}
              title="Toggle optical viewfinder grid (Rule of Thirds / Crosshair / Off)"
              className="px-2.5 py-1 rounded-lg bg-black/75 hover:bg-black/90 backdrop-blur-md border border-white/15 hover:border-[#f5c518]/50 text-[11px] font-mono text-zinc-200 flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              {gridMode === 'thirds' ? (
                <>
                  <Grid className="w-3 h-3 text-[#f5c518]" />
                  <span className="hidden sm:inline">3×3</span>
                </>
              ) : gridMode === 'crosshair' ? (
                <>
                  <Crosshair className="w-3 h-3 text-sky-400" />
                  <span className="hidden sm:inline">Center</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3 h-3 text-zinc-400" />
                  <span className="hidden sm:inline">Grid Off</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsLightboxOpen(true);
              }}
              title="Open fullscreen optical lightbox"
              className="p-1.5 rounded-lg bg-black/75 hover:bg-[#f5c518] text-zinc-200 hover:text-black backdrop-blur-md border border-white/15 hover:border-[#f5c518] transition cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main Image Container */}
        <div
          onClick={() => setIsLightboxOpen(true)}
          className={`relative w-full flex items-center justify-center overflow-hidden cursor-zoom-in ${
            compact ? 'h-48 sm:h-52' : 'aspect-3/4 max-h-[44vh]'
          }`}
        >
          {renderGridSvg(gridMode)}

          {/* Laser Scan Sweep during active extraction */}
          {isScanning && (
            <motion.div
              initial={{ top: '0%' }}
              animate={{ top: ['0%', '96%', '0%'] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#f5c518] to-transparent shadow-[0_0_20px_4px_rgba(245,197,24,0.65)] z-20 pointer-events-none"
            />
          )}

          <img
            src={imageUrl}
            alt={imageName}
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-[1.015]"
          />
        </div>

        {/* Bottom Scrim & Quick Lightbox Hint */}
        <div
          onClick={() => setIsLightboxOpen(true)}
          className="px-3 py-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent flex items-center justify-between gap-2 text-[11px] text-zinc-400 cursor-pointer"
        >
          <span className="truncate font-mono text-zinc-300">{imageName}</span>
          <span className="text-zinc-400 group-hover:text-[#f5c518] transition whitespace-nowrap shrink-0">
            Click to inspect
          </span>
        </div>
      </div>

      {/* Fullscreen High-Resolution Optical Lightbox Modal */}
      <AnimatePresence>
        {isLightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => {
              setIsLightboxOpen(false);
              setIsZoomed(false);
            }}
            className="fixed inset-0 z-50 bg-black/92 backdrop-blur-2xl flex flex-col justify-between p-4 sm:p-6"
          >
            {/* Top Lightbox Control Bar */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 glass-panel px-4 py-3 rounded-2xl"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Sparkles className="w-4 h-4 text-[#f5c518] shrink-0" />
                <span className="font-display font-bold text-sm text-white truncate">
                  {imageName}
                </span>
                <span className="text-zinc-600">·</span>
                <span className="text-xs font-mono text-[#f5c518] tabular-nums whitespace-nowrap">
                  {aspectRatioLabel}
                </span>
                <span className="text-zinc-600 hidden sm:inline">·</span>
                <span className="text-xs text-zinc-400 hidden sm:inline whitespace-nowrap">
                  {toolBadgeLabel}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cycleGridMode}
                  className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-mono text-zinc-200 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  {gridMode === 'thirds' ? (
                    <>
                      <Grid className="w-3.5 h-3.5 text-[#f5c518]" />
                      <span>Grid: Rule of Thirds</span>
                    </>
                  ) : gridMode === 'crosshair' ? (
                    <>
                      <Crosshair className="w-3.5 h-3.5 text-sky-400" />
                      <span>Grid: Center Crosshair</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Grid: Off</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setIsZoomed((z) => !z)}
                  className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-mono text-zinc-200 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isZoomed ? (
                    <>
                      <ZoomOut className="w-3.5 h-3.5 text-[#f5c518]" />
                      <span>1.0× Fit</span>
                    </>
                  ) : (
                    <>
                      <ZoomIn className="w-3.5 h-3.5 text-zinc-300" />
                      <span>1.75× Zoom</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsLightboxOpen(false);
                    setIsZoomed(false);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs flex items-center gap-1 transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Close (ESC)</span>
                </button>
              </div>
            </div>

            {/* Center High-Resolution Optical Stage */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex-1 my-4 flex items-center justify-center overflow-auto rounded-2xl border border-white/10 bg-[#040508]/80 relative max-w-6xl w-full mx-auto"
            >
              <div
                onClick={() => setIsZoomed((z) => !z)}
                className={`relative transition-transform duration-200 ${
                  isZoomed ? 'scale-150 cursor-zoom-out' : 'max-h-[76vh] max-w-full cursor-zoom-in'
                }`}
              >
                {renderGridSvg(gridMode)}
                <img
                  src={imageUrl}
                  alt={imageName}
                  referrerPolicy="no-referrer"
                  className="max-h-[76vh] w-auto object-contain rounded-lg select-none"
                />
              </div>
            </div>

            {/* Bottom Lightbox Footer */}
            <div className="max-w-6xl w-full mx-auto text-center text-xs text-zinc-400 font-mono">
              Click image to toggle optical zoom · Toggle 3×3 or Crosshair grid to inspect framing geometry · Press ESC to exit
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
