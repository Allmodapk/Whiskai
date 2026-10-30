import React, { useState } from 'react';
import { StorageService } from '../services/storage';
import { Sparkles, Check, X, ShieldAlert, ArrowRight } from 'lucide-react';

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WaitlistModal: React.FC<WaitlistModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(() => StorageService.isWaitlistJoined());

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      StorageService.setWaitlistJoined(true);
      setIsSubmitted(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-[#11131a] border border-[#262a36] p-6 shadow-2xl text-left space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#f5c518]/20 text-[#f5c518] flex items-center justify-center font-bold">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Join Pro Beta</h3>
              <p className="text-xs text-zinc-400">Reference Control Studio V2</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-full text-zinc-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 text-xs text-zinc-300 leading-relaxed">
          <p>
            <strong>Reference Control Studio V1 is completely free.</strong> We are building commercial V2 capabilities including:
          </p>
          <ul className="space-y-1.5 pl-2 text-zinc-400">
            <li className="flex items-center gap-2">
              <span className="text-[#f5c518]">✓</span> Batch multi-pose reference pipelines
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[#f5c518]">✓</span> Multi-character reference harmonization
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[#f5c518]">✓</span> Integrated direct image generation in V2
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[#f5c518]">✓</span> Cloud team blueprint sync & version history
            </li>
          </ul>
        </div>

        {isSubmitted ? (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2.5">
            <Check className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>
              <strong>You're on the priority list!</strong> We will reach out when the Pro Beta opens.
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 pt-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full bg-[#181b24] border border-[#262a36] focus:border-[#f5c518] text-white px-3.5 py-2.5 rounded-xl text-xs outline-none"
            />
            <button
              type="submit"
              className="w-full py-2.5 bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-xs"
            >
              <span>Request Early Access</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
