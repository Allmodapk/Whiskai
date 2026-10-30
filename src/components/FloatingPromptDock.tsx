import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TargetModelType } from '../types';
import {
  Sparkles,
  Copy,
  Check,
  Download,
  BookmarkPlus,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  AlertCircle,
  Sliders,
} from 'lucide-react';

interface FloatingPromptDockProps {
  toolLabel: string;
  activeCount: number;
  totalCount: number;
  editedCount: number;
  outputRatio: string;
  hasUnbuiltChanges: boolean;
  generatedPrompt: string | null;
  exportedPrompt: string;
  targetModel: TargetModelType;
  onSetTargetModel: (model: TargetModelType) => void;
  onGeneratePrompt: () => void;
  onCopyPrompt: () => void;
  onDownloadPrompt: () => void;
  onSaveProject: () => void;
  copyFeedback: boolean;
  negativePrompt?: string;
  showNegativePrompt?: boolean;
  onToggleNegativePrompt?: (show: boolean) => void;
  onChangeNegativePrompt?: (val: string) => void;
}

export const FloatingPromptDock: React.FC<FloatingPromptDockProps> = ({
  toolLabel,
  activeCount,
  totalCount,
  editedCount,
  outputRatio,
  hasUnbuiltChanges,
  generatedPrompt,
  exportedPrompt,
  targetModel,
  onSetTargetModel,
  onGeneratePrompt,
  onCopyPrompt,
  onDownloadPrompt,
  onSaveProject,
  copyFeedback,
  negativePrompt,
  showNegativePrompt,
  onToggleNegativePrompt,
  onChangeNegativePrompt,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const charCount = exportedPrompt ? exportedPrompt.length : 0;

  return (
    <div className="fixed bottom-3 left-0 right-0 z-30 px-3 sm:px-6 pointer-events-none">
      <div className="max-w-5xl mx-auto pointer-events-auto">
        <AnimatePresence>
          {isDrawerOpen && generatedPrompt && (
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="mb-2.5 glass-dock rounded-2xl p-4 sm:p-5 space-y-3.5 border border-white/15"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#f5c518]" />
                  <span className="font-display font-bold text-sm text-white">
                    Compiled Prompt Inspector
                  </span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-xs font-mono text-zinc-400 tabular-nums">
                    {charCount.toLocaleString()} chars · {outputRatio}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {onToggleNegativePrompt && (
                    <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(showNegativePrompt)}
                        onChange={(e) => onToggleNegativePrompt(e.target.checked)}
                        className="accent-[#f5c518]"
                      />
                      <span>Negative Prompt</span>
                    </label>
                  )}

                  <div className="flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-zinc-400" />
                    <select
                      value={targetModel}
                      onChange={(e) => onSetTargetModel(e.target.value as TargetModelType)}
                      className="bg-white/[0.06] text-white border border-white/15 rounded-xl px-2.5 py-1 text-xs font-semibold outline-none focus:border-[#f5c518]"
                    >
                      <option value="universal" className="bg-[#0e111a]">
                        Universal Format
                      </option>
                      <option value="flux" className="bg-[#0e111a]">
                        Flux / SDXL
                      </option>
                      <option value="gemini" className="bg-[#0e111a]">
                        Google Gemini
                      </option>
                      <option value="chatgpt" className="bg-[#0e111a]">
                        ChatGPT / DALL-E
                      </option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsDrawerOpen(false)}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-zinc-300 font-semibold transition cursor-pointer"
                  >
                    Minimize
                  </button>
                </div>
              </div>

              <textarea
                readOnly
                value={exportedPrompt}
                rows={7}
                className="w-full bg-[#06080d]/90 border border-white/10 text-zinc-100 p-3.5 rounded-xl text-xs font-mono leading-relaxed outline-none select-text selection:bg-[#f5c518] selection:text-black resize-y max-h-[36vh]"
              />

              {showNegativePrompt && negativePrompt && onChangeNegativePrompt && (
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-400">
                    Negative Prompt (Excludes cropped or unsupported anatomy):
                  </label>
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => onChangeNegativePrompt(e.target.value)}
                    rows={2}
                    className="w-full bg-[#06080d]/90 border border-white/10 text-zinc-300 p-2.5 rounded-xl text-xs font-mono outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={onCopyPrompt}
                  className="py-2.5 px-4 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  {copyFeedback ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Copied to Clipboard</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy Final Prompt</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onDownloadPrompt}
                  className="py-2.5 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white font-semibold text-xs border border-white/10 flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="w-4 h-4 text-sky-400" />
                  <span>Download (.txt)</span>
                </button>

                <button
                  type="button"
                  onClick={onSaveProject}
                  className="py-2.5 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 font-semibold text-xs border border-white/10 flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <BookmarkPlus className="w-4 h-4 text-[#f5c518]" />
                  <span>Save to Projects</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Compact Floating Compilation Bar */}
        <motion.div
          layout
          className={`glass-dock rounded-2xl px-3.5 py-2.5 sm:px-5 sm:py-3 flex flex-wrap items-center justify-between gap-3 transition-colors ${
            hasUnbuiltChanges
              ? 'border-amber-400/50 shadow-[0_12px_40px_-8px_rgba(245,197,24,0.25)]'
              : 'border-white/15'
          }`}
        >
          {/* Left Status & Diff Telemetry */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                hasUnbuiltChanges
                  ? 'bg-amber-500/20 border-amber-400/50 text-[#f5c518]'
                  : generatedPrompt
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                  : 'bg-white/[0.06] border-white/10 text-[#f5c518]'
              }`}
            >
              {hasUnbuiltChanges ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-display font-bold text-white whitespace-nowrap">
                  {toolLabel}
                </span>
                <span className="text-zinc-600">·</span>
                <span className="font-mono text-zinc-300 tabular-nums whitespace-nowrap">
                  {activeCount}/{totalCount} Active
                </span>
                {editedCount > 0 && (
                  <>
                    <span className="text-zinc-600 hidden sm:inline">·</span>
                    <span className="font-mono text-sky-400 tabular-nums hidden sm:inline whitespace-nowrap">
                      {editedCount} Customized
                    </span>
                  </>
                )}
                <span className="text-zinc-600 hidden md:inline">·</span>
                <span className="font-mono text-[#f5c518] tabular-nums hidden md:inline whitespace-nowrap">
                  {outputRatio}
                </span>
              </div>

              {/* Animated Diff Indicator Text */}
              <div className="text-[11px] truncate">
                {hasUnbuiltChanges ? (
                  <span className="text-amber-300 font-medium">
                    Unbuilt edits detected — click Rebuild Prompt to sync output
                  </span>
                ) : generatedPrompt ? (
                  <span className="text-emerald-300/90 font-mono tabular-nums">
                    Compiled & synced ({charCount.toLocaleString()} chars)
                  </span>
                ) : (
                  <span className="text-zinc-400">
                    Review accordion fields above, then compile your prompt
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-2 ml-auto">
            {generatedPrompt && (
              <button
                type="button"
                onClick={() => setIsDrawerOpen((o) => !o)}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-zinc-200 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                {isDrawerOpen ? (
                  <>
                    <ChevronDown className="w-3.5 h-3.5 text-[#f5c518]" />
                    <span className="hidden sm:inline">Hide Dock</span>
                  </>
                ) : (
                  <>
                    <ChevronUp className="w-3.5 h-3.5 text-[#f5c518]" />
                    <span className="hidden sm:inline">Inspect Prompt</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onGeneratePrompt}
              className={`min-h-[36px] px-4 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 ${
                !generatedPrompt || hasUnbuiltChanges
                  ? 'bg-gradient-to-r from-[#ffe169] via-[#f5c518] to-[#d49a00] text-black shadow-md shadow-amber-500/20 hover:brightness-105'
                  : 'bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/10'
              }`}
            >
              {hasUnbuiltChanges ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Rebuild Prompt</span>
                </>
              ) : generatedPrompt ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Recompile</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Compile Final Prompt</span>
                </>
              )}
            </button>

            {generatedPrompt && (
              <button
                type="button"
                onClick={onCopyPrompt}
                className="min-h-[36px] px-4 py-1.5 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-extrabold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 shadow-sm"
              >
                {copyFeedback ? (
                  <>
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Prompt</span>
                  </>
                )}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};
