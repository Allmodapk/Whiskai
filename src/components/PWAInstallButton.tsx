import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Share2, PlusSquare, X, Check } from 'lucide-react';

interface PWAInstallButtonProps {
  variant?: 'header' | 'banner' | 'chip';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    if (variant === 'banner') {
      return (
        <div className="flex items-center justify-between gap-3 p-3 bg-gradient-to-r from-cyan-500/15 via-violet-500/10 to-transparent border border-cyan-400/30 rounded-xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 text-slate-950 flex items-center justify-center font-display font-black text-sm">
              W
            </div>
            <div>
              <div className="text-xs font-bold text-white">Install Whiskai PWA</div>
              <div className="text-[11px] text-zinc-400">Launch from home screen, offline ready</div>
            </div>
          </div>
          <button
            onClick={install}
            className="flex items-center gap-1.5 studio-cta-primary text-xs font-bold px-3 py-1.5 rounded-lg transition active:scale-95 shadow-sm cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Install
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={install}
        className="w-full min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-cyan-400/12 hover:bg-cyan-400/20 text-cyan-200 border border-cyan-400/35 px-3 py-1.5 text-xs font-semibold transition active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
        title="Install Whiskai to Home Screen"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install Whiskai App</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="w-full min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200 border border-white/10 px-3 py-1.5 text-xs font-medium transition active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
          title="Install on iPhone / iPad"
        >
          <Download className="w-3.5 h-3.5 text-cyan-400" />
          <span>Install PWA</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-sm rounded-2xl bg-[#0d111a] border border-white/15 p-5 shadow-2xl text-left">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 text-slate-950 flex items-center justify-center font-display font-black text-sm">
                    W
                  </div>
                  <h3 className="text-base font-bold text-white">Install on iPhone / iPad</h3>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                Add <b>Whiskai</b> to your Home Screen for a full-screen app experience with offline access:
              </p>

              <div className="space-y-3 mb-5">
                <div className="flex items-start gap-3 bg-[#121826] p-3 rounded-xl border border-white/[0.08]">
                  <div className="w-6 h-6 rounded-md bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0">
                    <Share2 className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xs text-zinc-200">
                    <span className="font-semibold text-white">1. Tap Share</span> in Safari bottom toolbar.
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-[#121826] p-3 rounded-xl border border-white/[0.08]">
                  <div className="w-6 h-6 rounded-md bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0">
                    <PlusSquare className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xs text-zinc-200">
                    <span className="font-semibold text-white">2. Select &ldquo;Add to Home Screen&rdquo;</span> from the menu actions.
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-[#121826] p-3 rounded-xl border border-white/[0.08]">
                  <div className="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xs text-zinc-200">
                    <span className="font-semibold text-white">3. Tap &ldquo;Add&rdquo;</span> at the top right to complete install.
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-xl bg-white/[0.08] hover:bg-white/[0.14] py-2.5 text-xs font-bold text-white transition cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
