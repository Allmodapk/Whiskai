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
        <div className="flex items-center justify-between gap-3 p-3 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent border border-amber-500/30 rounded-xl mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-400 text-black flex items-center justify-center font-black">
              🍌
            </div>
            <div>
              <div className="text-xs font-bold text-white">Install My Whisk PWA</div>
              <div className="text-[11px] text-zinc-400">Launch from home screen, offline ready</div>
            </div>
          </div>
          <button
            onClick={install}
            className="flex items-center gap-1.5 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold px-3 py-1.5 rounded-lg transition active:scale-95 shadow-sm"
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
        className="flex items-center gap-1.5 rounded-full bg-[#f5c518]/15 hover:bg-[#f5c518]/25 text-[#f5c518] border border-[#f5c518]/40 px-3 py-1 text-xs font-semibold shadow-sm transition active:scale-95"
        title="Install My Whisk to Home Screen"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 border border-zinc-700 px-2.5 py-1 text-xs font-medium transition active:scale-95"
          title="Install on iPhone / iPad"
        >
          <Download className="w-3 h-3 text-amber-400" />
          <span>Install PWA</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-sm rounded-2xl bg-[#11131a] border border-[#303544] p-5 shadow-2xl text-left">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#f5c518] text-black flex items-center justify-center font-bold text-sm">
                    🍌
                  </div>
                  <h3 className="text-base font-bold text-white">Install on iPhone / iPad</h3>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                Add <b>My Whisk</b> to your Home Screen for a full-screen, native app experience with offline access:
              </p>

              <div className="space-y-3 mb-5">
                <div className="flex items-start gap-3 bg-[#181b24] p-3 rounded-xl border border-[#303544]">
                  <div className="w-6 h-6 rounded-md bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                    <Share2 className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xs text-zinc-200">
                    <span className="font-semibold text-white">1. Tap Share</span> in Safari bottom toolbar.
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-[#181b24] p-3 rounded-xl border border-[#303544]">
                  <div className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                    <PlusSquare className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xs text-zinc-200">
                    <span className="font-semibold text-white">2. Select &ldquo;Add to Home Screen&rdquo;</span> from the menu actions.
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-[#181b24] p-3 rounded-xl border border-[#303544]">
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
                className="w-full rounded-xl bg-[#202430] hover:bg-[#303544] py-2.5 text-xs font-bold text-white transition"
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
