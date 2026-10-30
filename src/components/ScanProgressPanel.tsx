import React from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';

interface ScanProgressPanelProps {
  currentStageIndex: number;
  fallbackNotice?: string | null;
}

const STAGES = [
  'Loading reference image',
  'Analyzing subject identity & facial features',
  'Analyzing body proportions & silhouette',
  'Analyzing spatial pose & joint articulation',
  'Analyzing facial expression & muscle configuration',
  'Analyzing arm, wrist, palm & finger gestures',
  'Analyzing leg, knee, ankle & foot configuration',
  'Analyzing camera viewpoint, elevation & distance',
  'Analyzing framing, crop boundaries & margins',
  'Analyzing clothing, lighting, background & environment',
];

export const ScanProgressPanel: React.FC<ScanProgressPanelProps> = ({ currentStageIndex, fallbackNotice }) => {
  return (
    <div className="w-full max-w-xl mx-auto rounded-2xl glass-panel p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center gap-3 mb-5 border-b border-white/[0.08] pb-4">
        <div className="w-9 h-9 rounded-xl bg-[#f5c518]/15 border border-[#f5c518]/30 flex items-center justify-center text-[#f5c518]">
          <Sparkles className="w-5 h-5 animate-pulse" />
        </div>
        <div>
          <h3 className="font-display text-sm font-bold text-white">
            Analyzing Reference Image
          </h3>
          <p className="text-xs text-zinc-400">
            {fallbackNotice || 'Extracting 13 grounded visual, anatomical, and optical components'}
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {STAGES.map((stage, idx) => {
          const isDone = idx < currentStageIndex;
          const isCurrent = idx === currentStageIndex;

          return (
            <div
              key={stage}
              className={`flex items-center gap-3 text-xs transition-all duration-200 ${
                isDone
                  ? 'text-emerald-400'
                  : isCurrent
                  ? 'text-white font-semibold'
                  : 'text-zinc-600'
              }`}
            >
              <div className="w-5 h-5 flex items-center justify-center">
                {isDone ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 text-[#f5c518] animate-spin" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-zinc-800" />
                )}
              </div>
              <span className={isCurrent ? 'text-white' : ''}>{stage}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-[#1f232d] flex items-center justify-between text-[11px] text-zinc-500">
        <span>My Whisk AI</span>
        <span>13-Component Grounded Analysis</span>
      </div>
    </div>
  );
};
