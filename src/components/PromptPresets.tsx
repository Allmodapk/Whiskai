import React from 'react';
import { Sparkles } from 'lucide-react';

interface PromptPresetsProps {
  onSelect: (presetText: string) => void;
}

const PRESETS = [
  {
    label: '35mm Leica Film',
    text: 'Shot on Leica M11 with 35mm Summicron f/2 lens, natural film grain, authentic 35mm photojournalism aesthetic, subtle vignettes and rich organic tones.',
  },
  {
    label: 'Golden Hour Bokeh',
    text: 'Basked in warm golden-hour late afternoon sun, rim light glowing around hair and silhouette, creamy bokeh background, 85mm portrait compression f/1.4.',
  },
  {
    label: 'Neo-Noir Cinematic',
    text: 'Cinematic neo-noir mood, dramatic chiaroscuro high-contrast shadows, subtle neon teal and amber color grade, moody volumetric atmosphere.',
  },
  {
    label: 'Vogue Editorial',
    text: 'High-end fashion editorial, Paris fashion week style, balanced soft studio strobe lighting, razor sharp micro-contrast on clothing textures and tailored fabric.',
  },
  {
    label: 'Tokyo Street Wet',
    text: 'Candid night street photography in rain-slicked city streets, reflective puddles, ambient signage illumination, vivid authentic street-level texture.',
  },
  {
    label: 'Clean Studio Softbox',
    text: 'Commercial studio beauty lighting with large octabox, clean neutral backdrop, lifelike skin pores and natural highlights without over-smoothing.',
  },
];

export const PromptPresets: React.FC<PromptPresetsProps> = ({ onSelect }) => {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
        <Sparkles className="w-3.5 h-3.5 text-[#f5c518]" />
        <span>Photographic Style Accelerators</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1.5 pt-0.5 no-scrollbar scroll-smooth">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onSelect(preset.text)}
            className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg bg-[#181b24] hover:bg-[#202430] active:scale-95 text-zinc-300 hover:text-white border border-[#303544] hover:border-[#f5c518]/50 transition-all font-medium flex items-center gap-1"
          >
            <span>+</span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
