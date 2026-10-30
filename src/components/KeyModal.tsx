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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-[#11131a] border border-[#303544] p-5 shadow-2xl text-left">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#f5c518]/20 text-[#f5c518] flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">API Key Connection</h3>
              <p className="text-xs text-zinc-400">Gemini Nano Banana & Vision</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {hasServerKey ? (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-600/30 text-emerald-400 text-xs mb-4">
            <Server className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>
              <strong>Server API Key is active!</strong> You can generate without entering a key here.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-950/40 border border-amber-600/30 text-amber-300 text-xs mb-4">
            <ShieldCheck className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Enter your personal Gemini API key below to unlock image generation.</span>
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
            className="w-full bg-[#181b24] border border-[#303544] focus:border-[#f5c518] text-white px-3.5 py-2.5 rounded-xl text-sm outline-none transition font-mono"
            autoComplete="off"
          />
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Stored locally on your device and sent only to your backend service for Google GenAI calls.
          </p>
        </div>

        <div className="flex gap-2">
          {StorageService.getCustomApiKey() && (
            <button
              onClick={handleClear}
              className="flex-1 py-2.5 px-3 rounded-xl bg-[#181b24] hover:bg-[#202430] text-zinc-400 hover:text-white text-xs font-semibold transition"
            >
              Reset to Server Key
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-3 rounded-xl bg-[#202430] hover:bg-[#303544] text-zinc-300 text-xs font-semibold transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
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
