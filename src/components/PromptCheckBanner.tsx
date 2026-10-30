import React from 'react';
import { PromptSafetyCheck } from '../types';
import { ShieldAlert, CheckCircle2, ChevronRight, AlertCircle } from 'lucide-react';

interface PromptCheckBannerProps {
  check: PromptSafetyCheck;
  onApplyFix: (original: string, replacement: string) => void;
}

export const PromptCheckBanner: React.FC<PromptCheckBannerProps> = ({ check, onApplyFix }) => {
  if (!check.hasIssues) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/20 text-emerald-400 text-xs font-sans">
        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
        <span>
          <strong>Prompt Check: Clean.</strong> Photographic wording is clear, neutral, and formatted for optimal model fidelity.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-amber-950/20 border border-amber-500/30 p-3.5 space-y-2 text-xs">
      <div className="flex items-center gap-2 text-amber-300 font-bold">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <span>Prompt Clarity & Safety Advisory ({check.notices.length} notice{check.notices.length > 1 ? 's' : ''})</span>
      </div>
      <p className="text-[11px] text-zinc-400 leading-relaxed">
        Neutral photographic wording prevents external model moderation flags and avoids semantic confusion.
      </p>

      <div className="space-y-1.5 pt-1">
        {check.notices.map((n, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#14161f] border border-[#262a36] text-[11px]"
          >
            <div>
              <span className="text-amber-400 font-semibold">{n.category}: </span>
              <span className="text-zinc-300 line-through mr-1">"{n.originalPhrase}"</span>
              <span className="text-emerald-400 font-medium">→ "{n.suggestedPhrase}"</span>
            </div>
            <button
              type="button"
              onClick={() => onApplyFix(n.originalPhrase, n.suggestedPhrase)}
              className="px-2 py-0.5 rounded bg-[#f5c518]/15 text-[#f5c518] hover:bg-[#f5c518]/25 text-[10px] font-bold shrink-0 transition"
            >
              Apply Fix
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
