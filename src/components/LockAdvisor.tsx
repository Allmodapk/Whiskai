import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Film,
  HelpCircle,
  Image as ImageIcon,
  Lock,
  Pin,
  PinOff,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import type { ImageDataItem } from '../types';
import { postApiJson, extractApiErrorMessage } from '../services/apiClient';
import { StorageService } from '../services/storage';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  CATS,
  ADDS,
  LOCK_CATALOG,
} from '../services/lockCatalog';
import {
  assembleLockPrompt,
  buildLocalDraftDecision,
  defaultPartialKeepIndexes,
  detectTouchedCategories,
  evaluateLocalConflicts,
  mergeAndDedupeConflicts,
  sanitizeDecision,
  type Conflict,
  type ConflictFixAction,
  type LockCategoryDecision,
  type LockDecision,
  type LockMediaType,
  type LockStatus,
} from '../services/lockAdvisor';
import {
  LockAdvisorStorage,
  type LockAdvisorHistoryItem,
  type LockAdvisorPinPreset,
} from '../services/lockAdvisorStorage';
import {
  CollapsibleSection,
  SegmentedTabs,
  StatusBanner,
} from './ui/StudioPrimitives';

interface LockAdvisorProps {
  optimizeImageFile: (file: File, label?: string) => Promise<ImageDataItem>;
}

const EXAMPLE_TASKS: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: 'outfit to full sleeves and trousers',
    text: 'I want to modify current outfit to full sleeve and trousers while keeping rest everything untouched.',
  },
  {
    label: 'change background only',
    text: 'Change only the background to a sunlit outdoor café terrace, keep everything else untouched.',
  },
  {
    label: 'change hairstyle',
    text: 'Change hairstyle to a neat low bun while keeping face, outfit, and scene untouched.',
  },
  {
    label: 'make her smile',
    text: 'Make her smile warmly while keeping identity, pose, outfit, and lighting untouched.',
  },
];

async function copyTextWithFallback(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore fallback errors
    }
    ta.remove();
  }
}

export const LockAdvisor: React.FC<LockAdvisorProps> = ({ optimizeImageFile }) => {
  const isOnline = useOnlineStatus();
  const img1InputRef = useRef<HTMLInputElement | null>(null);
  const img2InputRef = useRef<HTMLInputElement | null>(null);
  const taskInputRef = useRef<HTMLTextAreaElement | null>(null);

  const [task, setTask] = useState<string>('');
  const [debouncedTask, setDebouncedTask] = useState<string>('');
  const [media, setMedia] = useState<LockMediaType>('image');
  const [image1, setImage1] = useState<ImageDataItem | null>(null);
  const [image2, setImage2] = useState<ImageDataItem | null>(null);

  const [pinnedLocks, setPinnedLocks] = useState<number[]>([]);
  const [presets, setPresets] = useState<LockAdvisorPinPreset[]>(() =>
    LockAdvisorStorage.getPresets()
  );
  const [presetNameInput, setPresetNameInput] = useState<string>('');
  const [isPinsOpen, setIsPinsOpen] = useState<boolean>(false);

  const [aiDecision, setAiDecision] = useState<LockDecision | null>(null);
  const [overrides, setOverrides] = useState<Record<number, LockCategoryDecision>>({});
  const [addonOverrides, setAddonOverrides] = useState<('A' | 'B')[] | null>(null);
  const [dismissedConflictIds, setDismissedConflictIds] = useState<Set<string>>(new Set());

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [clarifyingAnswer, setClarifyingAnswer] = useState<string>('');
  const [expandedCatIds, setExpandedCatIds] = useState<Set<number>>(new Set());

  const [outputMode, setOutputMode] = useState<'full' | 'short'>('full');
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const [history, setHistory] = useState<LockAdvisorHistoryItem[]>(() =>
    LockAdvisorStorage.getHistory()
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);

  // Debounce task typing for instant local conflict checks
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTask(task), 220);
    return () => clearTimeout(t);
  }, [task]);

  const showToast = (msg: string) => {
    setCopyToast(msg);
    setTimeout(() => {
      setCopyToast((prev) => (prev === msg ? null : prev));
    }, 1800);
  };

  // Instant local category detection from typed task
  const localDetection = useMemo(
    () => detectTouchedCategories(debouncedTask),
    [debouncedTask]
  );

  // Base decision: AI decision when available, otherwise instant deterministic local draft
  const baseDecision = useMemo<LockDecision>(() => {
    if (aiDecision) {
      return sanitizeDecision(aiDecision, {
        media,
        task: task.trim() || aiDecision.change_block,
        pinnedLocks,
        hasImage2: Boolean(image2),
        overrides,
      });
    }
    const draft = buildLocalDraftDecision({
      task: debouncedTask,
      media,
      pinnedLocks,
      hasImage2: Boolean(image2),
    });
    return sanitizeDecision(draft, {
      media,
      task: debouncedTask,
      pinnedLocks,
      hasImage2: Boolean(image2),
      overrides,
    });
  }, [aiDecision, debouncedTask, task, media, pinnedLocks, image2, overrides]);

  // Final working decision with any manual add-on toggles applied
  const workingDecision = useMemo<LockDecision>(() => {
    const addons = addonOverrides !== null ? addonOverrides : baseDecision.addon_ids;
    return {
      ...baseDecision,
      addon_ids: addons,
    };
  }, [baseDecision, addonOverrides]);

  // Merge debounced local conflicts with AI conflicts, deduped by id
  const activeConflicts = useMemo<Conflict[]>(() => {
    const localConflicts = evaluateLocalConflicts({
      task: debouncedTask,
      media,
      categories: workingDecision.categories,
      pinnedLocks,
    });
    const aiConflicts = aiDecision?.conflicts || [];
    const merged = mergeAndDedupeConflicts(localConflicts, aiConflicts);
    return merged.filter((c) => !dismissedConflictIds.has(c.id));
  }, [debouncedTask, media, workingDecision.categories, pinnedLocks, aiDecision, dismissedConflictIds]);

  const hasUserOverrides = Object.keys(overrides).length > 0 || addonOverrides !== null;

  // Check whether user overrides introduced conflicts not present in original AI result
  const overrideCreatedConflicts = useMemo(() => {
    if (!aiDecision || !hasUserOverrides) return false;
    const aiIds = new Set((aiDecision.conflicts || []).map((c) => c.id));
    return activeConflicts.some((c) => !aiIds.has(c.id));
  }, [aiDecision, hasUserOverrides, activeConflicts]);

  // Assembled prompt (pure deterministic output from verbatim catalog)
  const assembledPrompt = useMemo(() => {
    if (!task.trim() && !aiDecision && !image2) return '';
    return assembleLockPrompt(workingDecision, LOCK_CATALOG, {
      short: outputMode === 'short',
    });
  }, [task, aiDecision, image2, workingDecision, outputMode]);

  const lockedCount = useMemo(
    () =>
      workingDecision.categories.filter(
        (c) => !(c.id === 13 && media === 'image') && c.status !== 'released'
      ).length,
    [workingDecision.categories, media]
  );

  const handleImageUpload = async (slot: 1 | 2, file: File | null | undefined) => {
    if (!file) return;
    setAnalyzeError(null);
    try {
      const item = await optimizeImageFile(
        file,
        slot === 1 ? 'Image 1 (Photo to Edit)' : 'Image 2 (Reference)'
      );
      if (slot === 1) setImage1(item);
      else setImage2(item);
    } catch (err) {
      setAnalyzeError(extractApiErrorMessage(err, 'Could not read image file.'));
    }
  };

  const togglePin = (catId: number) => {
    setPinnedLocks((prev) => {
      const next = prev.includes(catId)
        ? prev.filter((id) => id !== catId)
        : [...prev, catId].sort((a, b) => a - b);
      return next;
    });
    setDismissedConflictIds(new Set());
  };

  const handleSavePinPreset = () => {
    if (!presetNameInput.trim() || pinnedLocks.length === 0) return;
    const updated = LockAdvisorStorage.savePreset(presetNameInput, pinnedLocks);
    setPresets(updated);
    setPresetNameInput('');
    showToast('Pin preset saved');
  };

  const handleDeletePinPreset = (id: string) => {
    setPresets(LockAdvisorStorage.deletePreset(id));
  };

  const setCategoryOverride = (
    catId: number,
    updater: (current: LockCategoryDecision) => LockCategoryDecision
  ) => {
    const current =
      overrides[catId] ||
      workingDecision.categories.find((c) => c.id === catId) || {
        id: catId,
        status: 'locked' as LockStatus,
        reason: 'Manual adjustment.',
      };
    const next = updater(current);
    setOverrides((prev) => ({ ...prev, [catId]: next }));
    setDismissedConflictIds((prev) => {
      const copy = new Set(prev);
      copy.delete(`local_locked_${catId}`);
      return copy;
    });
  };

  const handleStatusChange = (catId: number, status: LockStatus) => {
    setCategoryOverride(catId, (cur) => {
      if (status === 'partial') {
        const keepIndexes =
          cur.keep_item_indexes && cur.keep_item_indexes.length > 0
            ? cur.keep_item_indexes
            : defaultPartialKeepIndexes(catId);
        return {
          id: catId,
          status: 'partial',
          keep_item_indexes: keepIndexes,
          note: cur.note || '',
          reason: cur.reason || 'Adjusted to partial by you.',
        };
      }
      return {
        id: catId,
        status,
        reason:
          status === 'locked'
            ? 'Locked by you.'
            : 'Released by you.',
      };
    });
  };

  const handleTogglePartialItem = (catId: number, itemIndex: number) => {
    setCategoryOverride(catId, (cur) => {
      const existing = cur.keep_item_indexes || [];
      const nextIndexes = existing.includes(itemIndex)
        ? existing.filter((i) => i !== itemIndex)
        : [...existing, itemIndex].sort((a, b) => a - b);
      return {
        ...cur,
        status: 'partial',
        keep_item_indexes: nextIndexes,
      };
    });
  };

  const handlePartialNoteChange = (catId: number, note: string) => {
    setCategoryOverride(catId, (cur) => ({
      ...cur,
      status: 'partial',
      keep_item_indexes: cur.keep_item_indexes || [],
      note,
    }));
  };

  const handleToggleAddon = (addonId: 'A' | 'B') => {
    const current = workingDecision.addon_ids;
    const next = current.includes(addonId)
      ? current.filter((id) => id !== addonId)
      : (['A', 'B'] as const).filter((id) => current.includes(id) || id === addonId);
    setAddonOverrides(next);
  };

  const applyConflictFix = (conflict: Conflict, action: ConflictFixAction) => {
    if (action.type === 'release' && action.category_id) {
      const cid = action.category_id;
      setPinnedLocks((prev) => prev.filter((id) => id !== cid));
      handleStatusChange(cid, 'released');
      setDismissedConflictIds((prev) => new Set(prev).add(conflict.id));
      return;
    }

    if (action.type === 'partial' && action.category_id) {
      const cid = action.category_id;
      setPinnedLocks((prev) => prev.filter((id) => id !== cid));
      setCategoryOverride(cid, (cur) => ({
        id: cid,
        status: 'partial',
        keep_item_indexes:
          action.keep_item_indexes && action.keep_item_indexes.length > 0
            ? action.keep_item_indexes
            : defaultPartialKeepIndexes(cid),
        note: cur.note || 'Adjusted to partial to resolve conflict.',
        reason: 'Made partial to resolve conflict.',
      }));
      setDismissedConflictIds((prev) => new Set(prev).add(conflict.id));
      return;
    }

    if (action.type === 'lock' && action.category_id) {
      handleStatusChange(action.category_id, 'locked');
      setDismissedConflictIds((prev) => new Set(prev).add(conflict.id));
      return;
    }

    if (action.type === 'set_media') {
      const nextMedia: LockMediaType = action.value === 'video' ? 'video' : 'image';
      setMedia(nextMedia);
      setDismissedConflictIds((prev) => new Set(prev).add(conflict.id));
      return;
    }

    if (action.type === 'edit_task') {
      if (action.value) {
        setTask(action.value);
      }
      taskInputRef.current?.focus();
      setDismissedConflictIds((prev) => new Set(prev).add(conflict.id));
    }
  };

  const runAnalyze = async (opts?: { overrideTask?: string; includeOverrides?: boolean }) => {
    const effectiveTask = (opts?.overrideTask ?? task).trim();
    if (!effectiveTask || isAnalyzing) return;
    if (!isOnline) {
      setAnalyzeError(
        'You are offline. Local lock rules and prompt assembly remain available; connect to the internet for AI analysis.'
      );
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const customKey = StorageService.getCustomApiKey();
      const payload: Record<string, unknown> = {
        task: effectiveTask,
        media,
        pinnedLocks,
      };
      if (image1) {
        payload.image1 = { data: image1.data, mimeType: image1.mimeType };
      }
      if (image2) {
        payload.image2 = { data: image2.data, mimeType: image2.mimeType };
      }
      if (opts?.includeOverrides && Object.keys(overrides).length > 0) {
        payload.overrides = Object.values(overrides);
      }

      const res = await postApiJson<{ success: boolean; decision: LockDecision }>(
        '/api/lock-advisor/analyze',
        payload,
        { customKey, timeoutMs: 48000, maxRetries: 0 }
      );

      if (!res?.decision) {
        throw new Error('Lock Advisor did not return a valid decision.');
      }

      const cleanDecision = sanitizeDecision(res.decision, {
        media,
        task: effectiveTask,
        pinnedLocks,
        hasImage2: Boolean(image2),
      });

      setAiDecision(cleanDecision);
      setOverrides({});
      setAddonOverrides(null);
      setDismissedConflictIds(new Set());
      setClarifyingAnswer('');

      const updatedHistory = LockAdvisorStorage.saveHistoryItem({
        task: effectiveTask,
        media,
        pinnedLocks,
        decision: cleanDecision,
      });
      setHistory(updatedHistory);
    } catch (err) {
      setAnalyzeError(
        extractApiErrorMessage(
          err,
          'Could not complete AI analysis. Local lock rules remain active below.'
        )
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmitClarifyingAnswer = () => {
    const answer = clarifyingAnswer.trim();
    if (!answer) return;
    const combinedTask = `${task.trim()}\nClarification: ${answer}`;
    setTask(combinedTask);
    setDebouncedTask(combinedTask);
    runAnalyze({ overrideTask: combinedTask });
  };

  const handleClearAll = () => {
    setTask('');
    setDebouncedTask('');
    setImage1(null);
    setImage2(null);
    setAiDecision(null);
    setOverrides({});
    setAddonOverrides(null);
    setDismissedConflictIds(new Set());
    setAnalyzeError(null);
    setClarifyingAnswer('');
    showToast('Cleared');
  };

  const handleCopyPrompt = async () => {
    if (!task.trim() || !assembledPrompt) return;
    await copyTextWithFallback(assembledPrompt);
    showToast('Copied prompt');
  };

  const handleReloadHistoryItem = (item: LockAdvisorHistoryItem) => {
    setTask(item.task);
    setDebouncedTask(item.task);
    setMedia(item.media);
    setPinnedLocks(item.pinnedLocks);
    setAiDecision(item.decision);
    setOverrides({});
    setAddonOverrides(null);
    setDismissedConflictIds(new Set());
    setAnalyzeError(null);
    setIsHistoryOpen(false);
    showToast('Loaded from history');
  };

  const visibleCategories = useMemo(
    () =>
      workingDecision.categories.filter((c) => !(c.id === 13 && media === 'image')),
    [workingDecision.categories, media]
  );

  const isCopyDisabled = !task.trim();

  return (
    <div className="space-y-4 pb-28">
      {/* Hidden image inputs */}
      <input
        ref={img1InputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleImageUpload(1, e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={img2InputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleImageUpload(2, e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-400/40 text-violet-300 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-xl font-bold text-white tracking-tight">
              Lock Advisor
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5 max-w-2xl">
              Describe an edit in plain words; check task conflicts against all 13 lock categories and assemble one copy-ready prompt.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-xs text-zinc-400 font-mono tabular-nums">
          <span>
            <strong className="text-cyan-300">{lockedCount}</strong>/
            {media === 'video' ? 13 : 12} active
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="text-violet-300">{workingDecision.addon_ids.length}</strong> add-ons
          </span>
        </div>
      </div>

      {/* Offline notice (respects existing offline status while allowing local rules) */}
      {!isOnline && (
        <StatusBanner
          tone="warning"
          icon={<WifiOff className="w-4 h-4 text-amber-400" />}
          title="Offline Mode"
        >
          Local keyword rules, manual overrides, and prompt assembly still work offline. Reconnect to run Gemini analysis.
        </StatusBanner>
      )}

      {/* Main Responsive Layout: Task + Results (Left/Top) & Lock Grid + Output (Right/Bottom) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN (Task Card, Results, Conflicts, History) */}
        <div className="lg:col-span-5 space-y-4">
          {/* 1. TASK CARD */}
          <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-sm font-bold text-white">
                Describe your edit
              </h2>
              <SegmentedTabs
                size="sm"
                value={media}
                onChange={(val) => {
                  setMedia(val);
                  setDismissedConflictIds(new Set());
                }}
                options={[
                  { id: 'image', label: 'Image', icon: ImageIcon },
                  { id: 'video', label: 'Video', icon: Film },
                ]}
              />
            </div>

            <textarea
              ref={taskInputRef}
              rows={3}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Change the current outfit to full sleeves and trousers, keep everything else untouched."
              className="w-full bg-[#090d16] border border-white/[0.12] focus:border-cyan-400 rounded-xl p-3 text-sm text-white placeholder:text-zinc-500 outline-none resize-y min-h-[92px] leading-relaxed"
            />

            {/* 4 Example Chips */}
            <div className="space-y-1.5">
              <div className="text-[11px] text-zinc-400">Quick examples</div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_TASKS.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => {
                      setTask(ex.text);
                      setDebouncedTask(ex.text);
                      setAiDecision(null);
                      setOverrides({});
                      setAddonOverrides(null);
                      setDismissedConflictIds(new Set());
                    }}
                    className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#111622] hover:bg-violet-500/15 border border-white/[0.09] hover:border-violet-400/45 text-xs text-zinc-200 hover:text-white transition cursor-pointer"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Detected categories before AI answers */}
            {!aiDecision && localDetection.categoryIds.length > 0 && (
              <div className="pt-1 border-t border-white/[0.07] space-y-1.5">
                <div className="text-[11px] text-zinc-400">
                  Detected categories (local rules)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {localDetection.categoryIds.map((cid) => {
                    const cat = CATS.find((c) => c.id === cid);
                    if (!cat) return null;
                    const isPinned = pinnedLocks.includes(cid);
                    return (
                      <button
                        key={cid}
                        type="button"
                        onClick={() => togglePin(cid)}
                        title={isPinned ? 'Unpin category' : 'Pin as always locked'}
                        className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1.5 transition cursor-pointer ${
                          isPinned
                            ? 'bg-amber-500/15 border-amber-400/45 text-amber-200'
                            : 'bg-cyan-400/10 border-cyan-400/35 text-cyan-200 hover:bg-cyan-400/20'
                        }`}
                      >
                        <span className="font-mono">[{cat.id}]</span>
                        <span>{cat.name}</span>
                        {isPinned && <Pin className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Optional Image 1 & Image 2 slots */}
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              {/* Image 1 */}
              <div className="rounded-xl bg-[#090d16] border border-white/[0.09] p-2.5">
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="text-[11px] font-semibold text-zinc-200 truncate">
                    Image 1 <span className="text-zinc-500 font-normal">(edit)</span>
                  </span>
                  {image1 && (
                    <button
                      type="button"
                      onClick={() => setImage1(null)}
                      aria-label="Remove Image 1"
                      className="w-6 h-6 rounded-md bg-white/[0.06] hover:bg-red-500/25 text-zinc-400 hover:text-red-300 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {image1 ? (
                  <img
                    src={image1.previewUrl}
                    alt="Image 1 photo to edit"
                    className="w-full h-24 object-cover rounded-lg border border-white/10"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => img1InputRef.current?.click()}
                    className="w-full h-24 rounded-lg border border-dashed border-white/15 hover:border-cyan-400/50 bg-[#0d121e] flex flex-col items-center justify-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-cyan-400" />
                    <span>Photo to edit</span>
                    <span className="text-[10px] text-zinc-500">Optional</span>
                  </button>
                )}
              </div>

              {/* Image 2 */}
              <div className="rounded-xl bg-[#090d16] border border-white/[0.09] p-2.5">
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="text-[11px] font-semibold text-zinc-200 truncate">
                    Image 2 <span className="text-zinc-500 font-normal">(ref)</span>
                  </span>
                  {image2 && (
                    <button
                      type="button"
                      onClick={() => setImage2(null)}
                      aria-label="Remove Image 2"
                      className="w-6 h-6 rounded-md bg-white/[0.06] hover:bg-red-500/25 text-zinc-400 hover:text-red-300 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {image2 ? (
                  <img
                    src={image2.previewUrl}
                    alt="Image 2 reference"
                    className="w-full h-24 object-cover rounded-lg border border-white/10"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => img2InputRef.current?.click()}
                    className="w-full h-24 rounded-lg border border-dashed border-white/15 hover:border-violet-400/50 bg-[#0d121e] flex flex-col items-center justify-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-violet-400" />
                    <span>Reference</span>
                    <span className="text-[10px] text-zinc-500">Uses Image Rules</span>
                  </button>
                )}
              </div>
            </div>

            {/* Always-Lock Pins & Presets */}
            <div className="rounded-xl bg-[#090d16] border border-white/[0.08] overflow-hidden">
              <button
                type="button"
                onClick={() => setIsPinsOpen((v) => !v)}
                aria-expanded={isPinsOpen}
                className="w-full min-h-[42px] px-3 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.03] cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Pin className="w-3.5 h-3.5 text-violet-400" />
                  <span>Always-lock pins &amp; presets</span>
                  {pinnedLocks.length > 0 && (
                    <span className="font-mono text-[11px] text-violet-300">
                      ({pinnedLocks.length} pinned)
                    </span>
                  )}
                </span>
                {isPinsOpen ? (
                  <ChevronUp className="w-4 h-4 text-zinc-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-zinc-400" />
                )}
              </button>

              {isPinsOpen && (
                <div className="p-3 border-t border-white/[0.07] space-y-3">
                  {/* Saved Presets */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-zinc-400">Saved pin presets</div>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.map((preset) => (
                        <div
                          key={preset.id}
                          className="inline-flex items-center rounded-lg bg-[#111622] border border-white/[0.09] overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPinnedLocks(preset.pinnedLocks);
                              setDismissedConflictIds(new Set());
                              showToast(`Applied "${preset.name}"`);
                            }}
                            className="min-h-[32px] px-2.5 py-1 text-[11px] text-zinc-200 hover:text-white hover:bg-violet-500/20 flex items-center gap-1.5 cursor-pointer"
                          >
                            <Bookmark className="w-3 h-3 text-violet-400" />
                            <span>{preset.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePinPreset(preset.id)}
                            aria-label={`Delete preset ${preset.name}`}
                            className="min-h-[32px] px-1.5 text-zinc-500 hover:text-red-300 hover:bg-red-500/15 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {pinnedLocks.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPinnedLocks([])}
                          className="min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:text-red-300 border border-white/[0.08] cursor-pointer"
                        >
                          Clear pins
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Per-category pin toggles */}
                  <div className="flex flex-wrap gap-1.5">
                    {CATS.filter((c) => !(c.id === 13 && media === 'image')).map((cat) => {
                      const active = pinnedLocks.includes(cat.id);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => togglePin(cat.id)}
                          className={`min-h-[32px] px-2 py-1 rounded-lg text-[11px] font-medium border transition cursor-pointer ${
                            active
                              ? 'bg-violet-500/25 border-violet-400/60 text-violet-100'
                              : 'bg-[#111622] border-white/[0.08] text-zinc-400 hover:text-white'
                          }`}
                        >
                          <span className="font-mono">[{cat.id}]</span> {cat.name}
                        </button>
                      );
                    })}
                  </div>

                  {/* Save current pins as preset */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={presetNameInput}
                      onChange={(e) => setPresetNameInput(e.target.value)}
                      placeholder="Save current pins as preset..."
                      className="flex-1 min-h-[36px] bg-[#111622] border border-white/10 focus:border-violet-400 rounded-lg px-2.5 text-xs text-white outline-none min-w-0"
                    />
                    <button
                      type="button"
                      disabled={!presetNameInput.trim() || pinnedLocks.length === 0}
                      onClick={handleSavePinPreset}
                      className="min-h-[36px] px-3 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/45 text-violet-200 text-xs font-semibold disabled:opacity-40 cursor-pointer shrink-0"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Primary Analyze CTA */}
            <button
              type="button"
              disabled={!task.trim() || isAnalyzing || !isOnline}
              onClick={() => runAnalyze()}
              className="w-full min-h-[46px] px-4 rounded-xl studio-cta-primary font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-45 cursor-pointer transition"
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Analyzing task vs locks...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Analyze with AI</span>
                </>
              )}
            </button>

            {analyzeError && (
              <StatusBanner
                tone="error"
                title="AI Analysis Notice"
                icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
              >
                {analyzeError}
              </StatusBanner>
            )}
          </div>

          {/* 2. RESULT: UNDERSTOOD AS + CLARIFYING QUESTION + CONFLICTS */}
          {aiDecision && (
            <div className="studio-panel rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-cyan-300">Understood as</span>
                <span className="text-[11px] font-mono text-zinc-400">
                  {workingDecision.uses_image_roles
                    ? 'Image 1 + Image 2 rules'
                    : workingDecision.uses_body_rules
                    ? 'Body rules active'
                    : media === 'video'
                    ? 'Video mode'
                    : 'Image mode'}
                </span>
              </div>
              <p className="text-sm text-white leading-relaxed">
                {workingDecision.understood_task}
              </p>

              {workingDecision.changes.length > 0 && (
                <div className="pt-2 border-t border-white/[0.07] space-y-1.5">
                  <div className="text-[11px] text-zinc-400">Planned changes</div>
                  <ul className="space-y-1.5">
                    {workingDecision.changes.map((ch, idx) => (
                      <li
                        key={`${ch.what}_${idx}`}
                        className="text-xs text-zinc-200 flex items-start justify-between gap-2"
                      >
                        <span className="leading-snug">{ch.what}</span>
                        {ch.category_ids.length > 0 && (
                          <span className="font-mono text-[11px] text-violet-300 shrink-0">
                            {ch.category_ids.map((id) => `[${id}]`).join(' ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Clarifying question card */}
          {aiDecision?.clarifying_question && (
            <div className="studio-panel rounded-2xl p-4 border-violet-400/35 space-y-3">
              <div className="flex items-start gap-2.5">
                <HelpCircle className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <div className="text-xs font-bold text-white">Clarifying question</div>
                  <p className="text-xs text-zinc-200 leading-relaxed">
                    {aiDecision.clarifying_question}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={clarifyingAnswer}
                  onChange={(e) => setClarifyingAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitClarifyingAnswer();
                  }}
                  placeholder="Type your answer to refine..."
                  className="flex-1 min-h-[40px] bg-[#090d16] border border-white/15 focus:border-violet-400 rounded-xl px-3 text-xs text-white outline-none min-w-0"
                />
                <button
                  type="button"
                  disabled={!clarifyingAnswer.trim() || isAnalyzing || !isOnline}
                  onClick={handleSubmitClarifyingAnswer}
                  className="min-h-[40px] px-3.5 rounded-xl bg-violet-500/25 hover:bg-violet-500/35 border border-violet-400/50 text-violet-100 text-xs font-semibold disabled:opacity-40 cursor-pointer shrink-0"
                >
                  Re-analyze
                </button>
              </div>
            </div>
          )}

          {/* Conflict cards (merged local + AI, deduped, one-tap local fixes, never blocks Copy) */}
          {activeConflicts.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs px-1">
                <span className="font-semibold text-amber-300">
                  Conflicts &amp; warnings ({activeConflicts.length})
                </span>
                <span className="text-[11px] text-zinc-400">
                  Warnings never block Copy
                </span>
              </div>
              {activeConflicts.map((conflict) => (
                <StatusBanner
                  key={conflict.id}
                  tone="warning"
                  icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
                  action={
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => applyConflictFix(conflict, conflict.fix.action)}
                        className="min-h-[34px] px-3 py-1 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/50 text-amber-100 text-xs font-semibold cursor-pointer whitespace-nowrap"
                      >
                        {conflict.fix.label}
                      </button>
                      {conflict.secondary_fix && (
                        <button
                          type="button"
                          onClick={() =>
                            applyConflictFix(conflict, conflict.secondary_fix!.action)
                          }
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-zinc-100 text-xs font-semibold cursor-pointer whitespace-nowrap"
                        >
                          {conflict.secondary_fix.label}
                        </button>
                      )}
                    </div>
                  }
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {conflict.category_ids.length > 0 && (
                      <span className="font-mono text-[11px] text-amber-300">
                        {conflict.category_ids.map((id) => `[${id}]`).join(' ')}
                      </span>
                    )}
                    <span>{conflict.message}</span>
                  </div>
                </StatusBanner>
              ))}
            </div>
          )}

          {/* 5. HISTORY (last 10 tasks, no images stored) */}
          <CollapsibleSection
            title="Recent history"
            subtitle="Last 10 tasks and decisions (no images stored)"
            isOpen={isHistoryOpen}
            onToggle={() => setIsHistoryOpen((v) => !v)}
            rightMeta={
              <span className="text-xs font-mono text-zinc-400 tabular-nums">
                {history.length}/10
              </span>
            }
          >
            {history.length === 0 ? (
              <p className="text-xs text-zinc-400">
                No analyzed tasks yet. Run Analyze with AI to save tasks here.
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl bg-[#090d16] border border-white/[0.08] hover:border-cyan-400/40 p-3 flex items-start justify-between gap-2 transition"
                  >
                    <button
                      type="button"
                      onClick={() => handleReloadHistoryItem(item)}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div className="text-xs font-semibold text-white line-clamp-2">
                        {item.task}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-1 flex items-center gap-2 font-mono">
                        <span>{item.media}</span>
                        <span aria-hidden="true">·</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(item.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistory(LockAdvisorStorage.deleteHistoryItem(item.id))}
                      aria-label="Delete history entry"
                      className="min-h-[34px] min-w-[34px] rounded-lg text-zinc-500 hover:text-red-300 hover:bg-red-500/15 flex items-center justify-center cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>

        {/* RIGHT COLUMN (Lock Grid + Output Block) */}
        <div className="lg:col-span-7 space-y-4">
          {/* 3. LOCK GRID (13 categories + 2 add-ons) */}
          <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold text-white">
                  Lock controls
                </h2>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Tap Locked, Partial, or Released to override any category.
                </p>
              </div>

              {(overrideCreatedConflicts || (aiDecision && hasUserOverrides)) && (
                <button
                  type="button"
                  disabled={isAnalyzing || !isOnline || !task.trim()}
                  onClick={() => runAnalyze({ includeOverrides: true })}
                  className="min-h-[36px] px-3 py-1.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/50 text-violet-100 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-45 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  <span>Re-check with AI</span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              {visibleCategories.map((catDecision) => {
                const catDef = CATS.find((c) => c.id === catDecision.id);
                if (!catDef) return null;
                const isOverridden = Boolean(overrides[catDef.id]);
                const isPinned = pinnedLocks.includes(catDef.id);
                const isExpanded = expandedCatIds.has(catDef.id);

                return (
                  <div
                    key={catDef.id}
                    className={`rounded-xl border p-3 space-y-2.5 transition-colors ${
                      catDecision.status === 'locked'
                        ? 'bg-[#111622] border-cyan-400/25'
                        : catDecision.status === 'partial'
                        ? 'bg-[#141428] border-violet-400/40'
                        : 'bg-[#0a0e16] border-white/[0.06] opacity-80'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs text-cyan-300 shrink-0">
                          [{catDef.id}]
                        </span>
                        <span className="text-sm font-semibold text-white truncate">
                          {catDef.name}
                        </span>
                        {isOverridden && (
                          <span className="text-[10px] font-mono font-semibold text-violet-300 bg-violet-500/20 border border-violet-400/40 rounded px-1.5 py-0.5 shrink-0">
                            you
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => togglePin(catDef.id)}
                          aria-label={isPinned ? `Unpin ${catDef.name}` : `Pin ${catDef.name} always locked`}
                          title={isPinned ? 'Pinned always locked' : 'Pin always locked'}
                          className={`min-h-[30px] min-w-[30px] rounded-lg flex items-center justify-center transition cursor-pointer shrink-0 ${
                            isPinned
                              ? 'text-amber-300 bg-amber-500/15'
                              : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05]'
                          }`}
                        >
                          {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                        </button>
                        {catDecision.status === 'locked' && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedCatIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(catDef.id)) next.delete(catDef.id);
                                else next.add(catDef.id);
                                return next;
                              })
                            }
                            aria-label={`Toggle items for ${catDef.name}`}
                            className="min-h-[30px] px-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-white flex items-center gap-0.5 cursor-pointer shrink-0"
                          >
                            <span>{catDef.items.length}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>

                      {/* Tri-state Locked / Partial / Released */}
                      <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-[#070a11] border border-white/[0.08] shrink-0">
                        {(
                          [
                            { id: 'locked', label: 'Locked', Icon: Lock },
                            { id: 'partial', label: 'Partial', Icon: Sparkles },
                            { id: 'released', label: 'Released', Icon: Unlock },
                          ] as const
                        ).map(({ id, label }) => {
                          const active = catDecision.status === id;
                          const activeClass =
                            id === 'locked'
                              ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/50'
                              : id === 'partial'
                              ? 'bg-violet-500/25 text-violet-200 border border-violet-400/50'
                              : 'bg-zinc-700/40 text-zinc-100 border border-zinc-500/50';
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => handleStatusChange(catDef.id, id)}
                              className={`min-h-[34px] px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer whitespace-nowrap ${
                                active
                                  ? activeClass
                                  : 'text-zinc-400 hover:text-white border border-transparent'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* One-line muted reason */}
                    <p className="text-xs text-zinc-400 leading-snug">
                      {catDecision.reason}
                    </p>

                    {/* Locked items preview on expand */}
                    {catDecision.status === 'locked' && isExpanded && (
                      <ul className="text-[11px] text-zinc-400 space-y-1 pl-3 border-t border-white/[0.06] pt-2 list-disc">
                        {catDef.items.map((itemText) => (
                          <li key={itemText}>{itemText}</li>
                        ))}
                      </ul>
                    )}

                    {/* Partial kept items + Exception note */}
                    {catDecision.status === 'partial' && (
                      <div className="pt-2 border-t border-violet-400/20 space-y-2.5">
                        <div className="text-[11px] font-medium text-violet-200">
                          Kept items (tick what stays locked):
                        </div>
                        <div className="space-y-1.5">
                          {catDef.items.map((itemText, idx) => {
                            const kept = (catDecision.keep_item_indexes || []).includes(idx);
                            return (
                              <label
                                key={itemText}
                                className="flex items-start gap-2.5 text-xs text-zinc-200 cursor-pointer min-h-[28px]"
                              >
                                <input
                                  type="checkbox"
                                  checked={kept}
                                  onChange={() => handleTogglePartialItem(catDef.id, idx)}
                                  className="mt-0.5 accent-violet-400"
                                />
                                <span className={kept ? 'text-white' : 'text-zinc-500 line-through'}>
                                  {itemText}
                                </span>
                              </label>
                            );
                          })}
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] text-violet-200 block">
                            Exception note
                          </label>
                          <input
                            type="text"
                            value={catDecision.note || ''}
                            onChange={(e) => handlePartialNoteChange(catDef.id, e.target.value)}
                            placeholder="e.g. Color, fabric, and pattern carry over; only sleeve length changes."
                            className="w-full min-h-[38px] bg-[#080b13] border border-violet-400/30 focus:border-violet-400 rounded-lg px-2.5 text-xs text-white outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 2 Add-ons */}
            <div className="pt-3 border-t border-white/[0.08] space-y-2">
              <div className="text-xs font-semibold text-zinc-300">
                Add-ons for edits that reveal new areas
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ADDS.map((addon) => {
                  const active = workingDecision.addon_ids.includes(addon.id);
                  return (
                    <button
                      key={addon.id}
                      type="button"
                      onClick={() => handleToggleAddon(addon.id)}
                      className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-start gap-2.5 ${
                        active
                          ? 'bg-cyan-400/12 border-cyan-400/50 text-white'
                          : 'bg-[#0b101b] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
                          active
                            ? 'bg-cyan-400 border-cyan-400 text-slate-950'
                            : 'border-zinc-500 bg-[#090d16]'
                        }`}
                      >
                        {active && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white">
                          {addon.name}{' '}
                          <span className="font-mono text-cyan-300">[{addon.id}]</span>
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                          {addon.items.join(', ')}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. OUTPUT BLOCK (Dark mono block + Full | Short toggle) */}
          <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold text-white">
                  Copy-ready prompt
                </h2>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Assembled verbatim from the lock catalog — never paraphrased by AI.
                </p>
              </div>
              <SegmentedTabs
                size="sm"
                value={outputMode}
                onChange={setOutputMode}
                options={[
                  { id: 'full', label: 'Full' },
                  { id: 'short', label: 'Short' },
                ]}
              />
            </div>

            <div
              className={`rounded-xl bg-[#070a11] border border-white/[0.1] p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words select-text min-h-[140px] max-h-[460px] overflow-y-auto ${
                assembledPrompt ? 'text-zinc-100' : 'text-zinc-500 font-sans text-sm'
              }`}
            >
              {assembledPrompt || 'Describe an edit above to assemble your locked i2i prompt.'}
            </div>
          </div>
        </div>
      </div>

      {/* Toast notification */}
      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 bottom-20 z-50 px-4 py-2 rounded-full bg-cyan-400 text-slate-950 font-semibold text-xs shadow-xl"
        >
          {copyToast}
        </div>
      )}

      {/* FIXED BOTTOM ACTION BAR (Clear + Copy prompt) */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 xl:left-68 z-30 bg-[#080b13]/95 backdrop-blur-md border-t border-white/[0.1] px-4 py-2.5 pb-safe-nav">
        <div className="max-w-7xl mx-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleClearAll}
            className="min-h-[46px] px-4 rounded-xl bg-transparent hover:bg-red-500/15 border border-red-400/50 text-red-300 font-bold text-xs sm:text-sm cursor-pointer shrink-0 transition"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={isCopyDisabled}
            onClick={handleCopyPrompt}
            className="flex-1 min-h-[46px] px-5 rounded-xl studio-cta-primary font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition"
          >
            <Copy className="w-4 h-4" />
            <span>Copy prompt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
