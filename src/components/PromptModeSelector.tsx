import React from 'react';
import { PromptMode } from '../types';
import { UserCheck, Sparkles, Sliders } from 'lucide-react';

interface PromptModeSelectorProps {
  currentMode: PromptMode;
  onSelectMode: (mode: PromptMode) => void;
  disabled?: boolean;
}

export const PromptModeSelector: React.FC<PromptModeSelectorProps> = ({
  currentMode,
  onSelectMode,
  disabled = false,
}) => {
  const modes: {
    id: PromptMode;
    title: string;
    badge: string;
    icon: React.ReactNode;
    description: string;
    details: string;
    authoritySummary: string;
  }[] = [
    {
      id: 'replace_subject',
      title: 'Replace Subject',
      badge: 'Mode 1',
      icon: <UserCheck className="w-4 h-4 text-[#f5c518]" />,
      description:
        'Keep the reference scene, pose, camera, clothing, lighting and environment. Replace the subject with my saved Master Persona.',
      details:
        'Subject & Body from Master Persona • Reference Scene, Pose, Camera, Framing, Clothing, Lighting & Background preserved.',
      authoritySummary: 'Subject + Body: Master Persona • Outfit: Reference',
    },
    {
      id: 'replace_subject_outfit',
      title: 'Replace Subject + Outfit',
      badge: 'Mode 2',
      icon: <Sparkles className="w-4 h-4 text-amber-400" />,
      description:
        'Use my saved Master Subject, Master Body and Master Outfit. Keep the pose, camera, framing, lighting, environment and composition from the reference.',
      details:
        'Subject, Body & Clothing replaced by user presets • Zero reference outfit leakage • Reference spatial setup intact.',
      authoritySummary: 'Subject + Body: Master Persona • Outfit: Master Outfit',
    },
    {
      id: 'reference_control',
      title: 'Reference Control',
      badge: 'Mode 3',
      icon: <Sliders className="w-4 h-4 text-emerald-400" />,
      description: 'Choose individually what to keep, replace, edit or ignore.',
      details:
        'Granular control per component. Lock reference details, customize with user text, or ignore components completely.',
      authoritySummary: 'Granular Lock / Edit / Ignore controls',
    },
  ];

  return (
    <div className="space-y-3 w-full text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-wider text-white">
            Select Prompt Mode
          </span>
          <span className="text-[10px] font-bold text-zinc-400 bg-[#161922] border border-[#262a36] rounded-md px-1.5 py-0.5">
            Component Authority
          </span>
        </div>
        <span className="text-[11px] text-zinc-500">
          One scan • Multiple prompt modes • Switch anytime
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {modes.map((m) => {
          const isSelected = currentMode === m.id;
          return (
            <div
              key={m.id}
              onClick={() => !disabled && onSelectMode(m.id)}
              className={`relative rounded-2xl p-4 transition-all flex flex-col justify-between cursor-pointer border ${
                isSelected
                  ? 'bg-gradient-to-b from-[#181c28] to-[#12151e] border-[#f5c518] shadow-lg shadow-amber-500/10 ring-1 ring-[#f5c518]/30'
                  : 'bg-[#11131a] border-[#262a36] hover:border-[#383e50] hover:bg-[#141722]'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        isSelected
                          ? 'bg-[#f5c518]/20 border border-[#f5c518]/40'
                          : 'bg-[#181b24] border border-[#262a36]'
                      }`}
                    >
                      {m.icon}
                    </div>
                    <span className="font-extrabold text-sm text-white">{m.title}</span>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      isSelected
                        ? 'bg-[#f5c518] text-black border-[#f5c518]'
                        : 'bg-[#181b24] text-zinc-400 border-[#262a36]'
                    }`}
                  >
                    {m.badge}
                  </span>
                </div>

                <p className="text-xs text-zinc-300 leading-relaxed min-h-[48px]">
                  "{m.description}"
                </p>

                <div className="text-[11px] text-zinc-500 pt-2 border-t border-[#1f232d] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#f5c518]/70 shrink-0" />
                  <span className="truncate">{m.authoritySummary}</span>
                </div>
              </div>

              <div className="mt-4 pt-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!disabled) onSelectMode(m.id);
                  }}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#f5c518] text-black font-black shadow-xs'
                      : 'bg-[#181b24] hover:bg-[#202534] text-zinc-300 border border-[#262a36]'
                  }`}
                >
                  {isSelected ? '✓ Selected Mode' : 'Select Mode'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
