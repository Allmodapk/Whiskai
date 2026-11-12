import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ALL_COMPONENT_KEYS,
  BackgroundProfile,
  ComponentKey,
  ComponentState,
  DetectedComponent,
  ImageDataItem,
  SubjectData,
  TargetModelType,
  ToolType,
} from '../types';
import { ScanDebugReportData, formatPlainTextDebugReport } from '../services/scanNormalizer';
import { ComponentCard } from './ComponentCard';
import { ScanProgressPanel } from './ScanProgressPanel';
import { PromptCheckBanner } from './PromptCheckBanner';
import { ReferenceViewfinder } from './ReferenceViewfinder';
import { FloatingPromptDock } from './FloatingPromptDock';
import { SegmentedTabs, StatusBanner } from './ui/StudioPrimitives';
import {
  AlertTriangle,
  BookmarkPlus,
  Bug,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileSearch,
  ListChecks,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react';

export interface SceneAccordionGroup {
  id: string;
  title: string;
  subtitle: string;
  codes: string;
  keys: ComponentKey[];
}

export interface GeneralExtractorWorkspaceProps {
  activeTool: ToolType;
  referenceImage: ImageDataItem | null;
  isDragging: boolean;
  setIsDragging: (val: boolean) => void;
  onFileDrop: (e: React.DragEvent) => void;
  onOpenFilePicker: () => void;
  onClearReference: () => void;

  isScanning: boolean;
  scanStageIndex: number;
  scanError: string | null;
  fallbackNotice: string | null;
  onScanReference: () => void;

  isQuotaFallback: boolean;
  quotaFallbackAcknowledged: boolean;
  onAcknowledgeQuotaFallback: () => void;

  lowVisibilityError: { reason: string; visibleCount: number } | null;
  hasMultiSnapshotReady: boolean;
  onConsiderAllSubjects: () => void;
  onContinueManuallyAfterLowVis: () => void;

  isDebugEnabled: boolean;
  onToggleDebug: () => void;
  scanDebugReport: ScanDebugReportData | null;
  isDebugPanelOpen: boolean;
  onToggleDebugPanelOpen: () => void;
  debugCopyFeedback: boolean;
  onCopyDebugReport: () => void;

  soloRewriteWarning: string | null;
  isRewritingFields: boolean;
  onRewriteFieldsSolo: () => void;

  components: Record<ComponentKey, DetectedComponent> | null;
  componentCounts: { locked: number; edited: number; ignored: number; unavailable: number };
  scanSummary: string;
  detectedSubjects: SubjectData[];
  activeSubjectDecision: 'all' | 'solo';
  onOpenMultiSubjectModal: () => void;
  tickedComponentKeys: ComponentKey[];
  onOpenChecklistModal: () => void;
  onRestoreAllOriginal: () => void;

  projectTitleInput: string;
  onChangeProjectTitleInput: (val: string) => void;
  onSaveBlueprint: () => void;
  savedBlueprintNotice: string | null;

  outputRatio: string;
  ratioExplanation: string;
  onChangeOutputRatio: (ratio: string) => void;

  sceneFilter: 'all' | 'locked' | 'edited' | 'ignored';
  onChangeSceneFilter: (filter: 'all' | 'locked' | 'edited' | 'ignored') => void;
  sceneAccordionGroups: SceneAccordionGroup[];
  openSceneGroups: Record<string, boolean>;
  onToggleSceneGroup: (groupId: string) => void;
  onExpandAllGroups: () => void;
  onCollapseAllGroups: () => void;

  onUpdateComponentState: (key: ComponentKey, st: ComponentState) => void;
  onUpdateComponentText: (
    key: ComponentKey,
    txt: string,
    meta?: { id?: string; name?: string }
  ) => void;
  onApplyBackgroundBundle: (
    bgProfile: BackgroundProfile,
    parts: { background: boolean; environment: boolean; lighting: boolean }
  ) => void;

  generatedMasterPrompt: string | null;
  exportedPrompt: string;
  hasUnbuiltChanges: boolean;
  onGenerateFinalPrompt: () => void;

  targetModel: TargetModelType;
  onSetTargetModel: (model: TargetModelType) => void;
  showNegativePrompt: boolean;
  onSetShowNegativePrompt: (show: boolean) => void;
  generatedNegativePrompt: string;
  onSetGeneratedNegativePrompt: (val: string) => void;

  promptCheck: ReturnType<typeof import('../services/promptBuilder').checkPromptSafety> | null;
  onApplySafetyFix: (orig: string, replacement: string) => void;
  onCopyPrompt: () => void;
  onDownloadPrompt: () => void;
  copyFeedback: boolean;
}

export const GeneralExtractorWorkspace: React.FC<GeneralExtractorWorkspaceProps> = ({
  activeTool,
  referenceImage,
  isDragging,
  setIsDragging,
  onFileDrop,
  onOpenFilePicker,
  onClearReference,
  isScanning,
  scanStageIndex,
  scanError,
  fallbackNotice,
  onScanReference,
  isQuotaFallback,
  quotaFallbackAcknowledged,
  onAcknowledgeQuotaFallback,
  lowVisibilityError,
  hasMultiSnapshotReady,
  onConsiderAllSubjects,
  onContinueManuallyAfterLowVis,
  isDebugEnabled,
  onToggleDebug,
  scanDebugReport,
  isDebugPanelOpen,
  onToggleDebugPanelOpen,
  debugCopyFeedback,
  onCopyDebugReport,
  soloRewriteWarning,
  isRewritingFields,
  onRewriteFieldsSolo,
  components,
  componentCounts,
  scanSummary,
  detectedSubjects,
  activeSubjectDecision,
  onOpenMultiSubjectModal,
  tickedComponentKeys,
  onOpenChecklistModal,
  onRestoreAllOriginal,
  projectTitleInput,
  onChangeProjectTitleInput,
  onSaveBlueprint,
  savedBlueprintNotice,
  outputRatio,
  ratioExplanation,
  onChangeOutputRatio,
  sceneFilter,
  onChangeSceneFilter,
  sceneAccordionGroups,
  openSceneGroups,
  onToggleSceneGroup,
  onExpandAllGroups,
  onCollapseAllGroups,
  onUpdateComponentState,
  onUpdateComponentText,
  onApplyBackgroundBundle,
  generatedMasterPrompt,
  exportedPrompt,
  hasUnbuiltChanges,
  onGenerateFinalPrompt,
  targetModel,
  onSetTargetModel,
  showNegativePrompt,
  onSetShowNegativePrompt,
  generatedNegativePrompt,
  onSetGeneratedNegativePrompt,
  promptCheck,
  onApplySafetyFix,
  onCopyPrompt,
  onDownloadPrompt,
  copyFeedback,
}) => {
  return (
    <div className="space-y-5 pb-24">
      {/* Workspace Header Strip */}
      <div className="studio-panel rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-cyan-400/15 border border-cyan-400/35 flex items-center justify-center text-cyan-300 shrink-0">
            <FileSearch className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-white tracking-tight">
              General Prompt Extractor
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Upload one reference image to extract 13 grounded visual components, merge saved profiles, and compile your prompt.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleDebug}
          title="Toggle On-Screen Scan Debug Panel"
          className={`min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-mono font-semibold flex items-center gap-1.5 border transition cursor-pointer shrink-0 self-start sm:self-auto ${
            isDebugEnabled
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              : 'bg-white/[0.04] text-zinc-400 hover:text-white border-white/10'
          }`}
        >
          <Bug className="w-3.5 h-3.5" />
          <span>Scan Debug: {isDebugEnabled ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* Quota Fallback Persistent Amber Banner */}
      {isQuotaFallback && !quotaFallbackAcknowledged && (
        <StatusBanner
          tone="warning"
          title="Estimated blueprint, not an AI analysis"
          icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
          action={
            <button
              type="button"
              onClick={onAcknowledgeQuotaFallback}
              className="min-h-[40px] px-4 py-2 rounded-xl studio-cta-primary font-bold text-xs transition cursor-pointer whitespace-nowrap"
            >
              Acknowledge &amp; Continue
            </button>
          }
        >
          Your AI service quota has been reached. A template blueprint was initialized from reference image geometry. Edit any field or acknowledge to continue.
        </StatusBanner>
      )}

      {/* Reference Image Upload Zone */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="font-display text-xs sm:text-sm font-bold text-white">
            Reference Image to Analyze (1 Image)
          </label>
          {referenceImage && (
            <button
              type="button"
              onClick={onClearReference}
              className="min-h-[36px] px-2.5 text-xs text-zinc-400 hover:text-white cursor-pointer"
            >
              Remove image
            </button>
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onFileDrop}
          onClick={() => !referenceImage && onOpenFilePicker()}
          className={`relative rounded-2xl border-2 border-dashed p-5 sm:p-6 transition-all ${
            isDragging
              ? 'border-cyan-400 bg-cyan-400/5'
              : !referenceImage
              ? 'border-white/15 studio-panel hover:border-cyan-400/50 cursor-pointer text-center'
              : 'border-white/10 studio-panel'
          }`}
        >
          {!referenceImage ? (
            <div className="flex flex-col items-center gap-2.5 text-zinc-400 py-3">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-cyan-300">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <span className="font-display font-bold text-white text-sm sm:text-base block">
                  Upload or drop one reference image
                </span>
                <span className="text-zinc-400 text-xs block mt-0.5">
                  JPEG, PNG, WebP · Or paste directly with Ctrl + V
                </span>
              </div>
              <span className="text-xs font-semibold text-cyan-300 underline mt-0.5">
                Browse file from device
              </span>
            </div>
          ) : (
            <div
              className="flex flex-col sm:flex-row items-center gap-5 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-full sm:w-56 shrink-0">
                <ReferenceViewfinder
                  imageUrl={referenceImage.previewUrl}
                  imageName={referenceImage.name || 'Uploaded Reference'}
                  aspectRatioLabel={outputRatio}
                  toolBadgeLabel="13-Component Reference"
                  isScanning={isScanning}
                  compact
                />
              </div>

              <div className="flex-1 space-y-3 w-full">
                <div>
                  <div className="text-xs font-mono font-medium text-cyan-300">
                    Optical Source · 13-Component Extraction
                  </div>
                  <div className="font-display text-sm sm:text-base font-bold text-white truncate mt-0.5">
                    {referenceImage.name || 'Uploaded Reference Image'}
                  </div>
                  <div className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Tap the viewfinder preview for fullscreen lightbox or rule-of-thirds overlay.
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={onScanReference}
                    disabled={isScanning}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl studio-cta-primary font-bold text-xs shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer flex-1 sm:flex-initial"
                  >
                    <Sparkles className="w-4 h-4 stroke-[2.2]" />
                    <span>{components ? 'Re-Analyze Image' : 'Analyze Reference Image'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onOpenFilePicker}
                    disabled={isScanning}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-xs font-semibold border border-white/10 transition cursor-pointer"
                  >
                    Replace Image
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scanning Progress Panel */}
      {isScanning && (
        <div className="py-2">
          <ScanProgressPanel
            currentStageIndex={scanStageIndex}
            fallbackNotice={fallbackNotice}
          />
        </div>
      )}

      {/* Scan Error Notice */}
      {scanError && (
        <StatusBanner
          tone="error"
          title="Analysis Notice"
          icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          action={
            <button
              type="button"
              onClick={onScanReference}
              className="min-h-[40px] px-3.5 py-2 rounded-xl studio-cta-primary font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Analysis</span>
            </button>
          }
        >
          {scanError}
        </StatusBanner>
      )}

      {/* Incomplete Scan Result (< 3 visible components) */}
      {lowVisibilityError && !isScanning && (
        <div className="p-4 sm:p-5 rounded-2xl bg-red-950/45 border border-red-500/45 text-red-100 text-xs space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-red-200 text-sm">
                Incomplete Scan Result ({lowVisibilityError.visibleCount}/13 Visible Components)
              </div>
              <p className="text-zinc-300 leading-relaxed">{lowVisibilityError.reason}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onScanReference}
              className="min-h-[40px] px-3.5 py-2 rounded-xl studio-cta-primary font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
            {hasMultiSnapshotReady && (
              <button
                type="button"
                onClick={onConsiderAllSubjects}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-bold text-xs transition cursor-pointer"
              >
                Use multi-subject result
              </button>
            )}
            <button
              type="button"
              onClick={onContinueManuallyAfterLowVis}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white border border-white/15 font-semibold text-xs transition cursor-pointer"
            >
              Continue manually
            </button>
          </div>
        </div>
      )}

      {/* On-Screen Scan Debug Panel */}
      {isDebugEnabled && scanDebugReport && (
        <div className="rounded-2xl bg-[#0a0d14] border border-emerald-500/40 overflow-hidden text-xs font-mono">
          <div className="px-4 py-3 bg-emerald-950/35 border-b border-emerald-500/30 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={onToggleDebugPanelOpen}
              className="flex items-center gap-2 text-emerald-300 font-bold text-left cursor-pointer"
            >
              <Bug className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                On-Screen Scan Debug · HTTP {scanDebugReport.httpStatus} ·{' '}
                {scanDebugReport.modelUsed}
              </span>
              {isDebugPanelOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={onCopyDebugReport}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-sans font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              {debugCopyFeedback ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied Debug Report</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy debug report</span>
                </>
              )}
            </button>
          </div>

          {isDebugPanelOpen && (
            <div className="p-4 space-y-4 max-h-[65vh] overflow-y-auto text-[11px] text-zinc-300">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-lg bg-black/50 border border-white/10">
                  <div className="text-zinc-500">HTTP / Model</div>
                  <div className="text-white font-bold truncate">
                    {scanDebugReport.httpStatus} · {scanDebugReport.modelUsed}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-black/50 border border-white/10">
                  <div className="text-zinc-500">finishReason / Length</div>
                  <div className="text-white font-bold">
                    {scanDebugReport.finishReason} ({scanDebugReport.responseLength} chars)
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-black/50 border border-white/10">
                  <div className="text-zinc-500">JSON Parse / Repair</div>
                  <div className="text-white font-bold">
                    ok={String(scanDebugReport.jsonParseSucceeded)} · repaired=
                    {String(scanDebugReport.jsonRepaired)}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-black/50 border border-white/10">
                  <div className="text-zinc-500">Quota / Repair Call</div>
                  <div className="text-white font-bold">
                    quota={String(scanDebugReport.quotaFallback)} · repairPass=
                    {String(scanDebugReport.truncationRepairTriggered)}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 bg-black/40 p-3 rounded-xl border border-white/10">
                <div>
                  <span className="text-zinc-500">Top-Level Keys: </span>
                  <span className="text-emerald-300">
                    [{scanDebugReport.topLevelKeys.join(', ')}]
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Subjects ({scanDebugReport.subjects.length}): </span>
                  <span className="text-amber-300">
                    {scanDebugReport.subjects
                      .map((s) => `${s.id}: "${s.label}" (${s.prominence})`)
                      .join(' | ')}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Shared Bucket Keys: </span>
                  <span className="text-zinc-200">
                    [{scanDebugReport.bucketKeysFound.shared.join(', ')}]
                  </span>
                </div>
                {Object.entries(scanDebugReport.bucketKeysFound.perSubject).map(([sid, keys]) => (
                  <div key={sid}>
                    <span className="text-zinc-500">Person Bucket [{sid}] Keys: </span>
                    <span className="text-zinc-200">[{(keys as string[]).join(', ')}]</span>
                  </div>
                ))}
                <div>
                  <span className="text-zinc-500">Flat Components Keys: </span>
                  <span className="text-zinc-200">
                    [{scanDebugReport.bucketKeysFound.flatComponents.join(', ')}]
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-zinc-400 font-bold">
                  Component Visibility Decisions &amp; Reasons:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {scanDebugReport.decisions.map((d) => (
                    <div
                      key={d.key}
                      className={`p-2 rounded-lg border flex items-center justify-between gap-2 ${
                        d.visibility === 'unavailable'
                          ? 'bg-red-950/30 border-red-500/30 text-red-200'
                          : 'bg-emerald-950/20 border-emerald-500/20 text-emerald-200'
                      }`}
                    >
                      <span className="font-bold">
                        {d.key} <span className="text-zinc-400">({d.bucket})</span>
                      </span>
                      <span className="text-right">
                        {d.visibility} · <span className="underline">{d.reason}</span> (
                        {d.textLength}c)
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-zinc-400 font-bold">
                  Raw Model Response Preview (first 1500 chars):
                </div>
                <pre className="p-2.5 rounded-xl bg-black/70 border border-white/10 text-[10px] text-zinc-300 whitespace-pre-wrap break-all max-h-44 overflow-y-auto">
                  {scanDebugReport.rawModelTextPreview || formatPlainTextDebugReport(scanDebugReport).slice(0, 1500)}
                </pre>
              </div>

              {scanDebugReport.soloDebug && (
                <div className="space-y-1.5 pt-2 border-t border-white/10">
                  <div className="text-amber-300 font-bold">
                    /api/reanalyze-solo Debug · HTTP {scanDebugReport.soloDebug.httpStatus} ·{' '}
                    {scanDebugReport.soloDebug.modelUsed} · finishReason=
                    {scanDebugReport.soloDebug.finishReason} · visible=
                    {scanDebugReport.soloDebug.visibleCount}/13 · fallbackToStoredMulti=
                    {String(scanDebugReport.soloDebug.fallbackToStoredMultiUsed)}
                  </div>
                  <pre className="p-2.5 rounded-xl bg-black/70 border border-white/10 text-[10px] text-zinc-300 whitespace-pre-wrap break-all max-h-44 overflow-y-auto">
                    {scanDebugReport.soloDebug.rawModelTextPreview}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ANALYSIS RESULTS & 13-COMPONENT COLLAPSIBLE ACCORDION GROUPS */}
      {components && !isScanning && (
        <div className="space-y-5 pt-2 border-t border-white/[0.08]">
          {/* Solo Mode Leak Warning & One-Tap Rewrite Action */}
          {soloRewriteWarning && (
            <StatusBanner
              tone="warning"
              title="Solo Mode Field Alignment Notice"
              icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
              action={
                <button
                  type="button"
                  onClick={onRewriteFieldsSolo}
                  disabled={isRewritingFields}
                  className="min-h-[40px] px-4 py-2 rounded-xl studio-cta-primary font-bold text-xs transition flex items-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isRewritingFields ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-slate-950" />
                  )}
                  <span>Rewrite for Solo</span>
                </button>
              }
            >
              {soloRewriteWarning}
            </StatusBanner>
          )}

          {/* Results Summary & Save Bar */}
          <div className="studio-panel p-4 sm:p-5 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-display font-bold text-white text-sm sm:text-base">
                  13-Component Visual Analysis
                </span>
                <span className="text-zinc-600" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono text-zinc-300 tabular-nums">
                  {componentCounts.locked} Locked · {componentCounts.edited} Edited ·{' '}
                  {componentCounts.ignored} Ignored · {componentCounts.unavailable} Unavailable
                </span>
              </div>
              {scanSummary && <p className="text-xs text-zinc-400">{scanSummary}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {detectedSubjects.length >= 2 && (
                <button
                  type="button"
                  onClick={onOpenMultiSubjectModal}
                  className="min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold border border-amber-500/35 transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  <span>Decision ({activeSubjectDecision === 'solo' ? 'Solo' : 'All'})</span>
                </button>
              )}

              <button
                type="button"
                onClick={onOpenChecklistModal}
                className="min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs font-semibold border border-white/10 transition flex items-center gap-1.5 cursor-pointer"
              >
                <ListChecks className="w-3.5 h-3.5 text-cyan-300" />
                <span>Selection ({tickedComponentKeys.length}/13)</span>
              </button>

              <button
                type="button"
                onClick={onRestoreAllOriginal}
                className="min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 text-xs font-semibold border border-white/10 transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore Original</span>
              </button>

              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <input
                  type="text"
                  value={projectTitleInput}
                  onChange={(e) => onChangeProjectTitleInput(e.target.value)}
                  placeholder="Project title..."
                  className="min-h-[40px] sm:min-h-[36px] bg-black/45 border border-white/15 focus:border-cyan-400 rounded-xl px-3 py-1.5 text-xs text-white outline-none flex-1 sm:w-44"
                />
                <button
                  type="button"
                  onClick={onSaveBlueprint}
                  className="min-h-[40px] sm:min-h-[36px] flex items-center gap-1.5 px-3.5 py-1.5 studio-cta-primary font-bold text-xs rounded-xl transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Save Project</span>
                </button>
              </div>
            </div>
          </div>

          {savedBlueprintNotice && (
            <StatusBanner
              tone="success"
              icon={<Check className="w-4 h-4 text-emerald-400" />}
            >
              {savedBlueprintNotice}
            </StatusBanner>
          )}

          {/* Two-Column Desktop Layout: Left Viewfinder + Right 4 Accordion Groups */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start w-full">
            {/* Left Column: Reference Viewfinder & Aspect Ratio (4 cols) */}
            <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
              {referenceImage && (
                <ReferenceViewfinder
                  imageUrl={referenceImage.previewUrl}
                  imageName={referenceImage.name || 'Analyzed Reference'}
                  aspectRatioLabel={outputRatio}
                  toolBadgeLabel="13-Component Optical Source"
                  isScanning={isScanning}
                />
              )}

              {/* Aspect Ratio Selector */}
              <div className="studio-panel p-4 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-display text-xs font-bold text-white">
                    Output Aspect Ratio
                  </label>
                  <span className="text-xs font-mono font-semibold text-cyan-300 tabular-nums">
                    {outputRatio}
                  </span>
                </div>
                {ratioExplanation && (
                  <p className="text-[11px] text-zinc-400 leading-normal">{ratioExplanation}</p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'].map(
                    (ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => onChangeOutputRatio(ratio)}
                        className={`min-h-[36px] sm:min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-mono font-semibold tabular-nums transition cursor-pointer ${
                          outputRatio === ratio
                            ? 'bg-cyan-400 text-slate-950 font-bold'
                            : 'bg-white/[0.05] text-zinc-400 hover:text-white border border-white/10'
                        }`}
                      >
                        {ratio}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: 4 Collapsible Accordion Groups (8 cols) */}
            <div className="lg:col-span-8 space-y-4">
              {/* Filter & Accordion Group Toolbar */}
              <div className="studio-panel rounded-2xl p-3 sm:px-4 flex flex-wrap items-center justify-between gap-3">
                <div className="overflow-x-auto no-scrollbar max-w-full">
                  <SegmentedTabs
                    size="sm"
                    value={sceneFilter}
                    onChange={onChangeSceneFilter}
                    options={[
                      { id: 'all', label: 'All', count: ALL_COMPONENT_KEYS.length },
                      { id: 'locked', label: 'Locked', count: componentCounts.locked },
                      { id: 'edited', label: 'Edited', count: componentCounts.edited },
                      {
                        id: 'ignored',
                        label: 'Excluded',
                        count: componentCounts.ignored + componentCounts.unavailable,
                      },
                    ]}
                  />
                </div>

                <div className="flex items-center gap-1.5 text-xs ml-auto">
                  <button
                    type="button"
                    onClick={onExpandAllGroups}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-300 font-semibold transition cursor-pointer whitespace-nowrap"
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={onCollapseAllGroups}
                    className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-300 font-semibold transition cursor-pointer whitespace-nowrap"
                  >
                    Collapse All
                  </button>
                </div>
              </div>

              {sceneAccordionGroups.map((group) => {
                const filteredKeys = group.keys.filter((k) => {
                  const c = components[k];
                  if (!c) return false;
                  if (sceneFilter === 'all') return true;
                  if (sceneFilter === 'locked') return c.state === 'locked';
                  if (sceneFilter === 'edited') return c.state === 'edited';
                  if (sceneFilter === 'ignored')
                    return c.state === 'ignored' || c.state === 'unavailable';
                  return true;
                });

                if (filteredKeys.length === 0) return null;

                const isGroupOpen = openSceneGroups[group.id] !== false;
                const activeInGroup = group.keys.filter((k) => {
                  const st = components[k]?.state;
                  return st === 'locked' || st === 'edited';
                }).length;
                const editedInGroup = group.keys.filter(
                  (k) => components[k]?.state === 'edited'
                ).length;

                return (
                  <div key={group.id} className="studio-panel rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => onToggleSceneGroup(group.id)}
                      className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.025] transition cursor-pointer select-none"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-mono text-xs font-semibold text-cyan-300 tabular-nums">
                            {group.codes}
                          </span>
                          <span className="font-display font-bold text-sm sm:text-base text-white">
                            {group.title}
                          </span>
                          <span className="text-zinc-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-xs font-mono text-zinc-400 tabular-nums">
                            {activeInGroup}/{group.keys.length} Active
                            {editedInGroup > 0 ? ` · ${editedInGroup} Edited` : ''}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5 truncate">{group.subtitle}</p>
                      </div>

                      <div className="w-8 h-8 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-zinc-300 shrink-0">
                        {isGroupOpen ? (
                          <ChevronUp className="w-4 h-4 text-cyan-300" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {isGroupOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden border-t border-white/[0.07]"
                        >
                          <div className="p-3.5 sm:p-4 space-y-3">
                            {filteredKeys.map((key) => {
                              const comp = components[key];
                              if (!comp) return null;

                              return (
                                <ComponentCard
                                  key={key}
                                  componentKey={key}
                                  component={comp}
                                  isUserControlled={
                                    activeTool === 'subject_swapping' &&
                                    (key === 'subject' || key === 'body')
                                  }
                                  onUpdateState={(st) => onUpdateComponentState(key, st)}
                                  onUpdateText={(txt, meta) => onUpdateComponentText(key, txt, meta)}
                                  onApplyBackgroundBundle={
                                    key === 'background' ||
                                    key === 'environment' ||
                                    key === 'lighting'
                                      ? onApplyBackgroundBundle
                                      : undefined
                                  }
                                  defaultExpanded={
                                    key === 'subject' ||
                                    key === 'pose' ||
                                    key === 'facial_expression' ||
                                    key === 'clothing'
                                  }
                                />
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Primary Generate Final Prompt CTA */}
          <div className="studio-panel rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <h3 className="font-display text-base sm:text-lg font-bold text-white">
                {generatedMasterPrompt
                  ? 'Update Final Prompt from Current Fields'
                  : 'Generate Final Prompt'}
              </h3>
              <p className="text-xs text-zinc-400">
                Synthesizes a coherent prompt strictly from active component fields. Removed, ignored, and unavailable components are excluded.
              </p>
            </div>

            <button
              type="button"
              onClick={onGenerateFinalPrompt}
              className="min-h-[46px] px-6 py-3 rounded-xl studio-cta-primary font-bold text-xs sm:text-sm shadow-md transition inline-flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <Sparkles className="w-4 h-4 stroke-[2.2]" />
              <span>Generate Final Prompt</span>
            </button>
          </div>

          {/* Unbuilt Changes Banner */}
          {hasUnbuiltChanges && generatedMasterPrompt && (
            <StatusBanner
              tone="warning"
              title="Component fields were modified"
              action={
                <button
                  type="button"
                  onClick={onGenerateFinalPrompt}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl studio-cta-primary font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Rebuild Prompt</span>
                </button>
              }
            >
              Click Rebuild Prompt to refresh the final output with your latest edits.
            </StatusBanner>
          )}

          {/* Final Generated Prompt Output Section */}
          {generatedMasterPrompt && (
            <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-4 w-full">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
                <div>
                  <h3 className="font-display text-sm sm:text-base font-bold text-white">
                    Final Generated Prompt
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Constructed strictly from your current active components and edits.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer min-h-[36px]">
                    <input
                      type="checkbox"
                      checked={showNegativePrompt}
                      onChange={(e) => onSetShowNegativePrompt(e.target.checked)}
                      className="accent-cyan-400"
                    />
                    <span>Show Negative Prompt</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-zinc-400 font-semibold">Format:</label>
                    <select
                      value={targetModel}
                      onChange={(e) => onSetTargetModel(e.target.value as TargetModelType)}
                      className="min-h-[36px] bg-black/50 text-white border border-white/15 rounded-xl px-3 py-1.5 text-xs font-semibold outline-none focus:border-cyan-400"
                    >
                      <option value="universal" className="bg-[#0e1118]">
                        Universal / Standard
                      </option>
                      <option value="flux" className="bg-[#0e1118]">
                        Flux
                      </option>
                      <option value="gemini" className="bg-[#0e1118]">
                        Google Gemini
                      </option>
                      <option value="chatgpt" className="bg-[#0e1118]">
                        ChatGPT / DALL-E
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              {promptCheck && (
                <PromptCheckBanner check={promptCheck} onApplyFix={onApplySafetyFix} />
              )}

              <textarea
                readOnly
                value={exportedPrompt}
                rows={13}
                className="w-full bg-[#090b10] border border-white/10 text-white p-4 rounded-xl text-xs font-mono leading-relaxed outline-none select-text selection:bg-cyan-400 selection:text-slate-950 resize-y min-h-[220px]"
              />

              {showNegativePrompt && generatedNegativePrompt && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-400">
                    Optional Negative Prompt (Excludes unsupported or cropped anatomy)
                  </label>
                  <textarea
                    value={generatedNegativePrompt}
                    onChange={(e) => onSetGeneratedNegativePrompt(e.target.value)}
                    rows={2}
                    className="w-full bg-[#090b10] border border-white/10 text-zinc-300 p-3 rounded-xl text-xs font-mono leading-relaxed outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={onCopyPrompt}
                  className="min-h-[44px] py-2.5 px-4 rounded-xl studio-cta-primary font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
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
                  className="min-h-[44px] py-2.5 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white font-semibold text-xs transition flex items-center justify-center gap-2 border border-white/10 cursor-pointer"
                >
                  <Download className="w-4 h-4 text-sky-400" />
                  <span>Download (.txt)</span>
                </button>

                <button
                  type="button"
                  onClick={onSaveBlueprint}
                  className="min-h-[44px] py-2.5 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 font-semibold text-xs transition flex items-center justify-center gap-2 border border-white/10 cursor-pointer"
                >
                  <BookmarkPlus className="w-4 h-4 text-cyan-300" />
                  <span>Save to Projects</span>
                </button>
              </div>
            </div>
          )}

          {/* Floating Animated Prompt Compilation Dock */}
          <FloatingPromptDock
            toolLabel={
              activeTool === 'general_extractor' ? 'General Prompt Extractor' : 'Subject Swapping'
            }
            activeCount={componentCounts.locked + componentCounts.edited}
            totalCount={ALL_COMPONENT_KEYS.length}
            editedCount={componentCounts.edited}
            outputRatio={outputRatio}
            hasUnbuiltChanges={hasUnbuiltChanges}
            generatedPrompt={generatedMasterPrompt}
            exportedPrompt={exportedPrompt}
            targetModel={targetModel}
            onSetTargetModel={onSetTargetModel}
            onGeneratePrompt={onGenerateFinalPrompt}
            onCopyPrompt={onCopyPrompt}
            onDownloadPrompt={onDownloadPrompt}
            onSaveProject={onSaveBlueprint}
            copyFeedback={copyFeedback}
            negativePrompt={generatedNegativePrompt}
            showNegativePrompt={showNegativePrompt}
            onToggleNegativePrompt={onSetShowNegativePrompt}
            onChangeNegativePrompt={onSetGeneratedNegativePrompt}
          />
        </div>
      )}
    </div>
  );
};
