import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  ComponentKey,
  DetectedComponent,
  ComponentState,
  SubjectProfile,
  MasterOutfit,
  BackgroundProfile,
  SavedComponentItem,
} from '../types';
import { StorageService } from '../services/storage';
import {
  Lock,
  Edit3,
  Ban,
  ChevronDown,
  ChevronUp,
  Check,
  RotateCcw,
  Trash2,
  Bookmark,
  FolderOpen,
  EyeOff,
  AlertCircle,
} from 'lucide-react';

interface ComponentCardProps {
  componentKey: ComponentKey;
  component: DetectedComponent;
  isUserControlled?: boolean;
  onUpdateState: (newState: ComponentState) => void;
  onUpdateText: (newText: string, profileMeta?: { id?: string; name?: string }) => void;
  onApplyBackgroundBundle?: (
    bgProfile: BackgroundProfile,
    parts: { background: boolean; environment: boolean; lighting: boolean }
  ) => void;
  defaultExpanded?: boolean;
}

export const ComponentCard: React.FC<ComponentCardProps> = ({
  componentKey,
  component,
  isUserControlled = false,
  onUpdateState,
  onUpdateText,
  onApplyBackgroundBundle,
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(component.userText || component.detectedText);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false);
  const [saveItemName, setSaveItemName] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Background bundle checkboxes when selecting a Background Profile
  const [bgApplyParts, setBgApplyParts] = useState({
    background: componentKey === 'background',
    environment: componentKey === 'environment',
    lighting: componentKey === 'lighting',
  });

  useEffect(() => {
    if (!isEditing) {
      const currentVal =
        component.state === 'edited'
          ? component.userText
          : component.userText || component.detectedText;
      setEditText(currentVal);
    }
  }, [component.userText, component.detectedText, component.state, isEditing]);

  const activeText =
    component.state === 'edited'
      ? component.userText
      : component.userText || component.detectedText;

  const isUnavailable =
    component.state === 'unavailable' ||
    (component.visibility === 'unavailable' && !activeText.trim());
  const isEmpty = !isUnavailable && !activeText.trim();
  const state = component.state;

  const handleSaveEdit = () => {
    onUpdateText(editText);
    onUpdateState('edited');
    setIsEditing(false);
  };

  const handleClearField = () => {
    setEditText('');
    onUpdateText('', { id: undefined, name: undefined });
    onUpdateState('edited');
    setIsEditing(false);
  };

  const handleRestoreOriginal = () => {
    setEditText(component.detectedText);
    onUpdateText('', { id: undefined, name: undefined });
    onUpdateState(component.visibility === 'unavailable' ? 'unavailable' : 'locked');
    setIsEditing(false);
  };

  const handleSaveCurrentToLibrary = () => {
    if (!activeText.trim() || !saveItemName.trim()) return;
    StorageService.saveComponentItem({
      id: `comp_${componentKey}_${Date.now()}`,
      componentKey,
      name: saveItemName.trim(),
      description: activeText.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setSaveItemName('');
    setIsSavingToLibrary(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  // Load saved items matching this componentKey
  const subjectProfiles: SubjectProfile[] =
    componentKey === 'subject' || componentKey === 'body' ? StorageService.getProfiles() : [];
  const outfitProfiles: MasterOutfit[] =
    componentKey === 'clothing' ? StorageService.getOutfits() : [];
  const backgroundProfiles: BackgroundProfile[] =
    componentKey === 'background' || componentKey === 'environment' || componentKey === 'lighting'
      ? StorageService.getBackgrounds()
      : [];
  const libraryItems: SavedComponentItem[] = StorageService.getComponentLibrary(componentKey);

  const hasSavedOptions =
    subjectProfiles.length > 0 ||
    outfitProfiles.length > 0 ||
    backgroundProfiles.length > 0 ||
    libraryItems.length > 0;

  // Determine human-readable status label
  const getStatusText = () => {
    if (state === 'unavailable' || isUnavailable) return 'Unavailable in Frame';
    if (state === 'ignored') return 'Ignored · Excluded';
    if (isEmpty) return 'Removed · Empty';
    if (component.selectedProfileName) return `Profile: ${component.selectedProfileName}`;
    if (state === 'edited') return 'Edited by User';
    if (component.visibility === 'partial') return 'Partially Visible · Locked';
    if (isUserControlled) return 'User Profile Authority';
    return 'Original Extracted · Locked';
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-2xl transition-all duration-150 overflow-hidden ${
        state === 'ignored' || state === 'unavailable'
          ? 'bg-black/35 border border-white/[0.04] opacity-65'
          : state === 'edited'
          ? 'glass-card border-sky-400/40 shadow-[0_8px_28px_-12px_rgba(56,189,248,0.2)]'
          : 'glass-card hover:border-white/20'
      }`}
    >
      {/* Header Row */}
      <div
        className="p-3.5 sm:px-4 flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-xs sm:text-sm font-bold tracking-tight text-white">
              {component.label}
            </span>
            <span className="text-zinc-600" aria-hidden="true">
              ·
            </span>
            <span
              className={`text-[11px] font-medium ${
                state === 'unavailable' || isUnavailable
                  ? 'text-amber-400/90'
                  : state === 'ignored' || isEmpty
                  ? 'text-red-400/90'
                  : state === 'edited' || component.selectedProfileName
                  ? 'text-sky-400'
                  : 'text-zinc-400'
              }`}
            >
              {getStatusText()}
            </span>
          </div>

          {component.explanation && (
            <p className="text-[11px] text-zinc-500 truncate max-w-md mt-0.5">
              {component.explanation}
            </p>
          )}
        </div>

        {/* Interactive State Controls */}
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {hasSavedOptions && (
            <button
              type="button"
              title="Replace or restore from Saved Profiles"
              onClick={() => {
                setIsPickerOpen(!isPickerOpen);
                setIsExpanded(true);
              }}
              className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap shrink-0 ${
                component.selectedProfileName || isPickerOpen
                  ? 'bg-[#f5c518]/15 text-[#f5c518] border border-[#f5c518]/40'
                  : 'bg-[#181b24] text-zinc-300 hover:text-white border border-[#262a36]'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Use Saved</span>
            </button>
          )}

          <button
            type="button"
            title="Lock / Include this component in the final prompt"
            onClick={() => onUpdateState('locked')}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition whitespace-nowrap shrink-0 ${
              state === 'locked' && !isUnavailable
                ? 'bg-[#f5c518] text-black font-bold'
                : 'bg-[#181b24] text-zinc-400 hover:text-white border border-[#262a36]'
            }`}
          >
            <Lock className="w-3 h-3" />
            <span className="hidden md:inline">Keep</span>
          </button>

          <button
            type="button"
            title="Edit component description manually"
            onClick={() => {
              setIsEditing(true);
              setIsExpanded(true);
            }}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition whitespace-nowrap shrink-0 ${
              state === 'edited'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'bg-[#181b24] text-zinc-400 hover:text-white border border-[#262a36]'
            }`}
          >
            <Edit3 className="w-3 h-3" />
            <span className="hidden md:inline">Edit</span>
          </button>

          <button
            type="button"
            title="Ignore: Exclude this component from final prompt"
            onClick={() => onUpdateState(state === 'ignored' ? 'locked' : 'ignored')}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition whitespace-nowrap shrink-0 ${
              state === 'ignored'
                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                : 'bg-[#181b24] text-zinc-400 hover:text-zinc-200 border border-[#262a36]'
            }`}
          >
            <Ban className="w-3 h-3" />
            <span className="hidden md:inline">Ignore</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white transition"
            aria-label={isExpanded ? 'Collapse component' : 'Expand component'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsed Preview Line */}
      {!isExpanded && (
        <div
          onClick={() => setIsExpanded(true)}
          className="px-4 pb-3 pt-0 text-xs text-zinc-400 line-clamp-2 cursor-pointer leading-relaxed"
        >
          {isUnavailable ? (
            <span className="italic text-zinc-500 flex items-center gap-1.5">
              <EyeOff className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
              <span>
                Not observable in the uploaded frame — automatically excluded unless you provide a custom description.
              </span>
            </span>
          ) : isEmpty ? (
            <span className="italic text-zinc-500">
              Description removed. Click Edit or Use Saved to provide a description.
            </span>
          ) : (
            activeText
          )}
        </div>
      )}

      {/* Expanded Body */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-[#1f232d] space-y-3">
          {/* Saved Profile Picker Drawer */}
          {isPickerOpen && (
            <div className="p-3.5 rounded-xl bg-[#161924] border border-[#2e3446] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">
                  Select Saved {component.label} Profile
                </span>
                <button
                  type="button"
                  onClick={() => setIsPickerOpen(false)}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Close
                </button>
              </div>

              {/* Subject / Body Profiles */}
              {subjectProfiles.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-zinc-400">
                    Subject Profiles ({componentKey === 'subject' ? 'Identity' : 'Body Geometry'})
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
                    {subjectProfiles.map((sp) => {
                      const textToApply =
                        componentKey === 'subject' ? sp.masterSubject : sp.masterBody;
                      return (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => {
                            onUpdateText(textToApply, { id: sp.id, name: sp.name });
                            onUpdateState('edited');
                            setIsPickerOpen(false);
                          }}
                          className="text-left p-2.5 rounded-lg bg-[#11131a] hover:bg-[#1c202e] border border-[#262a36] transition flex items-start justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white">{sp.name}</div>
                            <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                              {textToApply}
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-[#f5c518] shrink-0">
                            Apply
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Outfit Profiles */}
              {outfitProfiles.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-zinc-400">Saved Outfit Profiles</div>
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
                    {outfitProfiles.map((op) => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => {
                          onUpdateText(op.description, { id: op.id, name: op.name });
                          onUpdateState('edited');
                          setIsPickerOpen(false);
                        }}
                        className="text-left p-2.5 rounded-lg bg-[#11131a] hover:bg-[#1c202e] border border-[#262a36] transition flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white">{op.name}</div>
                          <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                            {op.description}
                          </div>
                        </div>
                        <span className="text-[11px] font-bold text-[#f5c518] shrink-0">
                          Apply
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Background Profiles with Independent Component Checkboxes */}
              {backgroundProfiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-zinc-400">
                      Saved Background Profiles
                    </span>
                    {onApplyBackgroundBundle && (
                      <div className="flex items-center gap-3 text-[11px] text-zinc-300">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={bgApplyParts.background}
                            onChange={(e) =>
                              setBgApplyParts((p) => ({ ...p, background: e.target.checked }))
                            }
                            className="accent-[#f5c518]"
                          />
                          <span>Background</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={bgApplyParts.environment}
                            onChange={(e) =>
                              setBgApplyParts((p) => ({ ...p, environment: e.target.checked }))
                            }
                            className="accent-[#f5c518]"
                          />
                          <span>Environment</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={bgApplyParts.lighting}
                            onChange={(e) =>
                              setBgApplyParts((p) => ({ ...p, lighting: e.target.checked }))
                            }
                            className="accent-[#f5c518]"
                          />
                          <span>Lighting</span>
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto">
                    {backgroundProfiles.map((bp) => {
                      const singleFieldText =
                        componentKey === 'background'
                          ? bp.background
                          : componentKey === 'environment'
                          ? bp.environment
                          : bp.lighting;
                      return (
                        <button
                          key={bp.id}
                          type="button"
                          onClick={() => {
                            if (
                              onApplyBackgroundBundle &&
                              (bgApplyParts.background ||
                                bgApplyParts.environment ||
                                bgApplyParts.lighting)
                            ) {
                              onApplyBackgroundBundle(bp, bgApplyParts);
                            } else {
                              onUpdateText(singleFieldText, { id: bp.id, name: bp.name });
                              onUpdateState('edited');
                            }
                            setIsPickerOpen(false);
                          }}
                          className="text-left p-2.5 rounded-lg bg-[#11131a] hover:bg-[#1c202e] border border-[#262a36] transition flex items-start justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white">{bp.name}</div>
                            <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                              {singleFieldText}
                            </div>
                          </div>
                          <span className="text-[11px] font-bold text-[#f5c518] shrink-0">
                            Apply Selected
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Saved Component Library Items */}
              {libraryItems.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-zinc-400">
                    Saved {component.label} Presets
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 max-h-44 overflow-y-auto">
                    {libraryItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onUpdateText(item.description, { id: item.id, name: item.name });
                          onUpdateState('edited');
                          setIsPickerOpen(false);
                        }}
                        className="text-left p-2.5 rounded-lg bg-[#11131a] hover:bg-[#1c202e] border border-[#262a36] transition flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white">{item.name}</div>
                          <div className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                            {item.description}
                          </div>
                        </div>
                        <span className="text-[11px] font-bold text-[#f5c518] shrink-0">
                          Apply
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Editing Mode vs Read Mode */}
          {isEditing ? (
            <div className="space-y-2.5 pt-1">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={4}
                className="w-full bg-[#161922] border border-[#3b4256] focus:border-[#f5c518] text-white p-3 rounded-xl text-xs leading-relaxed outline-none"
                placeholder={`Enter or edit ${component.label.toLowerCase()} description...`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  {component.detectedText && (
                    <button
                      type="button"
                      onClick={handleRestoreOriginal}
                      className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore Scanned</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClearField}
                    className="text-xs text-red-400/80 hover:text-red-300 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove Description</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setEditText(activeText);
                      setIsEditing(false);
                    }}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="px-3.5 py-1.5 bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold rounded-lg flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Apply Edit</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 pt-1">
              {isUnavailable ? (
                <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/25 text-amber-200/90 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Not visible in the uploaded image.</span>{' '}
                    <span className="text-zinc-400">
                      Automatically excluded so no unsupported details are invented. Click{' '}
                      <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="text-[#f5c518] underline font-medium"
                      >
                        Edit
                      </button>{' '}
                      if you want to add a custom specification.
                    </span>
                  </div>
                </div>
              ) : isEmpty ? (
                <div className="p-3 rounded-xl bg-[#161922] border border-[#262a36] text-zinc-400 text-xs flex items-center justify-between">
                  <span>Description removed by user and excluded from the final prompt.</span>
                  {component.detectedText && (
                    <button
                      type="button"
                      onClick={handleRestoreOriginal}
                      className="text-[#f5c518] hover:underline font-semibold flex items-center gap-1 shrink-0"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restore Original</span>
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-200 leading-relaxed font-sans select-text whitespace-pre-wrap">
                  {activeText}
                </p>
              )}

              {/* Bottom Action Bar */}
              <div className="pt-2 border-t border-[#1b1f2a] flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                <div className="flex flex-wrap items-center gap-3">
                  {component.detectedText &&
                    (state === 'edited' || component.userText) &&
                    activeText !== component.detectedText && (
                      <button
                        type="button"
                        onClick={handleRestoreOriginal}
                        className="text-zinc-400 hover:text-white flex items-center gap-1 transition"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Restore Original Scanned Description</span>
                      </button>
                    )}

                  {activeText && (
                    <button
                      type="button"
                      onClick={handleClearField}
                      className="text-zinc-500 hover:text-red-400 flex items-center gap-1 transition"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>

                {/* Save current description to Component Library */}
                {activeText.trim() && (
                  <div className="flex items-center gap-2 ml-auto">
                    {saveSuccess ? (
                      <span className="text-emerald-400 font-medium flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Saved to Profiles Library
                      </span>
                    ) : isSavingToLibrary ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={saveItemName}
                          onChange={(e) => setSaveItemName(e.target.value)}
                          placeholder={`Preset name for ${component.label}...`}
                          className="bg-[#181b24] border border-[#343b4f] rounded-lg px-2.5 py-1 text-xs text-white outline-none focus:border-[#f5c518]"
                        />
                        <button
                          type="button"
                          onClick={handleSaveCurrentToLibrary}
                          className="px-2.5 py-1 bg-[#f5c518] text-black font-bold rounded-lg text-xs"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsSavingToLibrary(false)}
                          className="text-zinc-400 hover:text-white px-1"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setSaveItemName(`${component.label} Preset`);
                          setIsSavingToLibrary(true);
                        }}
                        className="text-zinc-400 hover:text-[#f5c518] flex items-center gap-1 transition"
                      >
                        <Bookmark className="w-3 h-3" />
                        <span>Save to Library</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};
