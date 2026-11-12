import React, { useState, useEffect } from 'react';
import { StorageService } from '../services/storage';
import { KeyRound, Check, X, ShieldCheck, Server } from 'lucide-react';

interface KeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  hasServerKey: boolean;
}

export const KeyModal: React.FC<KeyModalProps> = ({ isOpen, onClose, onSaved, hasServerKey }) => {
  const [apiKey, setApiKey] = useState('');
  const [copiedStatus, setCopiedStatus] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKey(StorageService.getCustomApiKey());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    StorageService.setCustomApiKey(apiKey.trim());
    setCopiedStatus(true);
    setTimeout(() => {
      setCopiedStatus(false);
      onSaved();
      onClose();
    }, 400);
  };

  const handleClear = () => {
    StorageService.setCustomApiKey('');
    setApiKey('');
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-[#0e1118] border border-white/15 p-5 shadow-2xl text-left">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#f5c518]/15 border border-[#f5c518]/35 text-[#f5c518] flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-white">API Key Connection</h3>
              <p className="text-xs text-zinc-400">Gemini Vision &amp; Studio Analysis</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition cursor-pointer"
            aria-label="Close API Key Connection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {hasServerKey ? (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/35 text-emerald-300 text-xs mb-4">
            <Server className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>
              <strong>Server API Key is active.</strong> You can run analysis without entering a custom key.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-950/40 border border-amber-500/35 text-amber-200 text-xs mb-4">
            <ShieldCheck className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Enter your personal Gemini API key below to enable server calls.</span>
          </div>
        )}

        <div className="space-y-2 mb-4">
          <label className="text-xs font-semibold text-zinc-300">
            Custom Gemini API Key <span className="text-zinc-500 font-normal">(Optional override)</span>
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIzaSy..."
            className="w-full min-h-[42px] bg-[#080a0f] border border-white/15 focus:border-[#f5c518] text-white px-3.5 py-2.5 rounded-xl text-sm outline-none transition font-mono"
            autoComplete="off"
          />
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Stored locally on your device and sent only to your backend service for Google GenAI calls.
          </p>
        </div>

        <div className="flex gap-2">
          {StorageService.getCustomApiKey() && (
            <button
              type="button"
              onClick={handleClear}
              className="flex-1 min-h-[42px] py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 hover:text-white text-xs font-semibold transition cursor-pointer"
            >
              Reset Key
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[42px] py-2.5 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-xs font-semibold transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 min-h-[42px] py-2.5 px-4 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {copiedStatus ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Saved
              </>
            ) : (
              'Save & Connect'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
