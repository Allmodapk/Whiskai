import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Camera,
  Upload,
  Sparkles,
  Check,
  Copy,
  BookmarkPlus,
  AlertTriangle,
  RefreshCw,
  Info,
  Sliders,
  X,
  Compass,
  Eye,
  Maximize2,
  FileText,
  Layers,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ImageDataItem,
  CameraAiTemplateAnalysis,
  CameraAiBaseAnalysis,
  TargetModelType,
  ReferenceBlueprint,
} from '../types';
import {
  assembleCameraAiPrompt,
  validateCameraAiConsistency,
  CameraAiVariant,
} from '../services/cameraAiPrompt';
import {
  getPersistedCameraAiWorkspace,
  savePersistedCameraAiWorkspace,
  computeImageHash,
  getCachedCameraScan,
  setCachedCameraScan,
} from '../services/cameraAiStorage';
import { postApiJson } from '../services/apiClient';
import { StorageService } from '../services/storage';

export interface CameraAIProps {
  optimizeImageFile?: (file: File) => Promise<ImageDataItem>;
  onOpenProjects?: () => void;
}

async function defaultOptimizeImageFile(file: File): Promise<ImageDataItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.onload = () => {
        const MAX_DIM = 1024;
        let width = img.width;
        let height = img.height;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const base64 = dataUrl.split(',')[1] || '';
        resolve({
          id: `cam_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          data: base64,
          mimeType: 'image/jpeg',
          previewUrl: dataUrl,
          name: file.name,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

async function createSmallThumbnailDataUrl(previewUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(previewUrl);
    img.onload = () => {
      const MAX_THUMB = 240;
      let width = img.width;
      let height = img.height;
      if (width > MAX_THUMB || height > MAX_THUMB) {
        if (width > height) {
          height = Math.round((height * MAX_THUMB) / width);
          width = MAX_THUMB;
        } else {
          width = Math.round((width * MAX_THUMB) / height);
          height = MAX_THUMB;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(previewUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.65));
    };
    img.src = previewUrl;
  });
}

export const CameraAI: React.FC<CameraAIProps> = ({
  optimizeImageFile = defaultOptimizeImageFile,
  onOpenProjects,
}) => {
  const persisted = useMemo(() => getPersistedCameraAiWorkspace(), []);

  // Analysis State
  const [templateAnalysis, setTemplateAnalysis] = useState<CameraAiTemplateAnalysis | null>(
    persisted.templateAnalysis
  );
  const [baseAnalysis, setBaseAnalysis] = useState<CameraAiBaseAnalysis | null>(
    persisted.baseAnalysis
  );

  // Variant & Target Model
  const [activeVariant, setActiveVariant] = useState<CameraAiVariant>(persisted.activeVariant);
  const [targetModel, setTargetModel] = useState<TargetModelType>(persisted.targetModel);

  // Image Upload Slots
  const [templateImage, setTemplateImage] = useState<ImageDataItem | null>(null);
  const [baseImage, setBaseImage] = useState<ImageDataItem | null>(null);

  // Loading & Error States
  const [isScanningTemplate, setIsScanningTemplate] = useState(false);
  const [isScanningBase, setIsScanningBase] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [baseError, setBaseError] = useState<string | null>(null);

  // UI state
  const [projectTitle, setProjectTitle] = useState(persisted.projectTitle || '');
  const [copySuccess, setCopySuccess] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [showEvidencePanel, setShowEvidencePanel] = useState(false);

  // File input refs
  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const baseInputRef = useRef<HTMLInputElement | null>(null);

  // Persist workspace on state changes
  useEffect(() => {
    savePersistedCameraAiWorkspace({
      schemaVersion: 1,
      templateAnalysis,
      baseAnalysis,
      activeVariant,
      targetModel,
      projectTitle,
    });
  }, [templateAnalysis, baseAnalysis, activeVariant, targetModel, projectTitle]);

  // Compute final assembled prompt
  const finalPrompt = useMemo(() => {
    if (!templateAnalysis) return '';
    return assembleCameraAiPrompt(templateAnalysis, baseAnalysis, activeVariant, targetModel);
  }, [templateAnalysis, baseAnalysis, activeVariant, targetModel]);

  // Compute consistency warnings
  const consistencyWarnings = useMemo(() => {
    if (!templateAnalysis) return [];
    return validateCameraAiConsistency(templateAnalysis, baseAnalysis);
  }, [templateAnalysis, baseAnalysis]);

  // Handle Template File Selection
  const handleTemplateFileUpload = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      setTemplateError(null);
      const optimized = await optimizeImageFile(file);
      setTemplateImage(optimized);

      // Check hash cache
      const hash = computeImageHash(optimized.data);
      const cached = getCachedCameraScan(hash);
      if (cached?.template) {
        setTemplateAnalysis(cached.template);
      }
    } catch (err: any) {
      setTemplateError(err?.message || 'Failed to process template image.');
    }
  };

  // Handle Base File Selection
  const handleBaseFileUpload = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      setBaseError(null);
      const optimized = await optimizeImageFile(file);
      setBaseImage(optimized);

      // Check hash cache
      const hash = computeImageHash(optimized.data);
      const cached = getCachedCameraScan(hash);
      if (cached?.base) {
        setBaseAnalysis(cached.base);
      }
    } catch (err: any) {
      setBaseError(err?.message || 'Failed to process base image.');
    }
  };

  // Scan Template Endpoint
  const handleScanTemplate = async () => {
    if (!templateImage || isScanningTemplate) return;
    setIsScanningTemplate(true);
    setTemplateError(null);

    try {
      const customKey = StorageService.getCustomApiKey();
      const res = await postApiJson<{
        success: boolean;
        analysis: CameraAiTemplateAnalysis;
        modelUsed?: string;
      }>(
        '/api/camera-ai/analyze-template',
        {
          image: {
            data: templateImage.data,
            mimeType: templateImage.mimeType,
          },
        },
        { customKey }
      );

      if (res.analysis) {
        setTemplateAnalysis(res.analysis);
        const hash = computeImageHash(templateImage.data);
        setCachedCameraScan(hash, { template: res.analysis });
      }
    } catch (err: any) {
      setTemplateError(err?.message || 'Failed to analyze template camera.');
    } finally {
      setIsScanningTemplate(false);
    }
  };

  // Scan Base Endpoint
  const handleScanBase = async () => {
    if (!baseImage || isScanningBase) return;
    setIsScanningBase(true);
    setBaseError(null);

    try {
      const customKey = StorageService.getCustomApiKey();
      const res = await postApiJson<{
        success: boolean;
        analysis: CameraAiBaseAnalysis;
        modelUsed?: string;
      }>(
        '/api/camera-ai/analyze-base',
        {
          image: {
            data: baseImage.data,
            mimeType: baseImage.mimeType,
          },
        },
        { customKey }
      );

      if (res.analysis) {
        setBaseAnalysis(res.analysis);
        const hash = computeImageHash(baseImage.data);
        setCachedCameraScan(hash, { base: res.analysis });
      }
    } catch (err: any) {
      setBaseError(err?.message || 'Failed to analyze base image.');
    } finally {
      setIsScanningBase(false);
    }
  };

  // Parallel Scan Both
  const handleScanBoth = async () => {
    if ((!templateImage && !baseImage) || isScanningTemplate || isScanningBase) return;
    await Promise.all([
      templateImage ? handleScanTemplate() : Promise.resolve(),
      baseImage ? handleScanBase() : Promise.resolve(),
    ]);
  };

  // Update Template Estimate Field
  const updateTemplateEstimate = <K extends keyof CameraAiTemplateAnalysis['estimates']>(
    key: K,
    value: CameraAiTemplateAnalysis['estimates'][K]
  ) => {
    if (!templateAnalysis) return;
    setTemplateAnalysis((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        estimates: {
          ...prev.estimates,
          [key]: value,
        },
      };
    });
  };

  // Copy Prompt
  const handleCopyPrompt = () => {
    if (!finalPrompt) return;
    navigator.clipboard.writeText(finalPrompt);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2200);
  };

  // Save as Project
  const handleSaveAsProject = async () => {
    if (!templateAnalysis) return;
    const title =
      projectTitle.trim() ||
      `Camera AI · ${templateImage?.name ? templateImage.name.replace(/\.[^.]+$/, '') : 'Camera Project'}`;

    const smallThumb = templateImage
      ? await createSmallThumbnailDataUrl(templateImage.previewUrl)
      : '';

    const blueprint: ReferenceBlueprint = {
      id: `cam_ai_proj_${Date.now()}`,
      schemaVersion: 1,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      toolType: 'camera_ai',
      referenceThumbnails: smallThumb ? [smallThumb] : [],
      referenceImageIds: [],
      masterSubject: `Camera AI Project (${templateAnalysis.estimates.pitch_label}, ${templateAnalysis.estimates.pitch_deg}°, ${templateAnalysis.estimates.shot_size})`,
      masterBody: `Summary: ${templateAnalysis.estimates.camera_position_summary}`,
      originalComponents: {} as any,
      components: {} as any,
      outputRatio: templateAnalysis.estimates.framing.aspect_ratio || '3:4',
      finalPrompt,
      targetModel,
    };

    StorageService.saveBlueprint(blueprint);
    setSavedNotice(`Saved "${title}" to Projects!`);
    setTimeout(() => setSavedNotice(null), 3500);
  };

  return (
    <div className="space-y-6">
      {/* Hidden File Inputs */}
      <input
        ref={templateInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleTemplateFileUpload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={baseInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleBaseFileUpload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* HEADER BAR */}
      <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-cyan-400/15 border border-cyan-400/35 flex items-center justify-center text-cyan-300 shrink-0">
                <Camera className="w-4 h-4" />
              </div>
              <h2 className="font-display text-base sm:text-lg font-bold text-white">
                Camera AI · Synchronized Dual-Camera Re-Shooter
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Extract any template image&apos;s camera position with maximum precision and re-shoot your base image from that exact second angle without moving the subject or gaze.
            </p>
          </div>

          {templateImage && baseImage && (
            <button
              type="button"
              disabled={isScanningTemplate || isScanningBase}
              onClick={handleScanBoth}
              className="min-h-[42px] px-4 py-2 rounded-xl studio-cta-primary font-bold text-xs shadow-md transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              {isScanningTemplate || isScanningBase ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 stroke-[2.2]" />
              )}
              <span>Scan Both Images</span>
            </button>
          )}
        </div>

        {/* SECTION 1: TWO UPLOAD SLOTS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* SLOT 1: CAMERA TEMPLATE (REQUIRED) */}
          <div className="p-4 rounded-xl studio-card flex flex-col justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs sm:text-sm font-bold text-white">
                  1. Camera Template
                </span>
                <span className="text-[11px] font-mono text-amber-300">Required · Optics</span>
              </div>
              <p className="text-xs text-zinc-400">
                Uploaded purely for its camera geometry, pitch, and optics. Subject content is ignored.
              </p>

              {templateImage ? (
                <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-black border border-white/15">
                  <img
                    src={templateImage.previewUrl}
                    alt="Camera Template"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateImage(null);
                      setTemplateAnalysis(null);
                    }}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/80 text-white hover:bg-red-600 flex items-center justify-center text-xs cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => templateInputRef.current?.click()}
                  className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-white/15 hover:border-cyan-400/60 flex flex-col items-center justify-center gap-2 text-zinc-400 hover:text-white transition cursor-pointer bg-black/20"
                >
                  <Upload className="w-6 h-6 text-cyan-300" />
                  <span className="text-xs font-bold">Upload Camera Template</span>
                  <span className="text-[10px] text-zinc-500">Resized to 1024px JPEG</span>
                </button>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-white/[0.08]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => templateInputRef.current?.click()}
                  className="flex-1 py-2 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-xs font-bold border border-white/10 transition cursor-pointer"
                >
                  {templateImage ? 'Replace Image' : 'Select File'}
                </button>
                <button
                  type="button"
                  disabled={!templateImage || isScanningTemplate}
                  onClick={handleScanTemplate}
                  className="flex-1 py-2 px-3 rounded-xl studio-cta-primary font-bold text-xs transition disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isScanningTemplate ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>Scan Camera</span>
                </button>
              </div>

              {templateError && <p className="text-xs text-red-400">{templateError}</p>}
            </div>
          </div>

          {/* SLOT 2: BASE IMAGE ("YOUR IMAGE", OPTIONAL) */}
          <div className="p-4 rounded-xl studio-card flex flex-col justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs sm:text-sm font-bold text-white">
                  2. Your Image
                </span>
                <span className="text-[11px] font-mono text-zinc-400">Optional · Base Scene</span>
              </div>
              <p className="text-xs text-zinc-400">
                The subject, pose, clothing, and environment to re-photograph from the new angle.
              </p>

              {baseImage ? (
                <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-black border border-white/15">
                  <img
                    src={baseImage.previewUrl}
                    alt="Your Base Image"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setBaseImage(null);
                      setBaseAnalysis(null);
                    }}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/80 text-white hover:bg-red-600 flex items-center justify-center text-xs cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => baseInputRef.current?.click()}
                  className="w-full aspect-[4/3] rounded-xl border-2 border-dashed border-white/15 hover:border-emerald-400/60 flex flex-col items-center justify-center gap-2 text-zinc-400 hover:text-white transition cursor-pointer bg-black/20"
                >
                  <Upload className="w-6 h-6 text-emerald-400" />
                  <span className="text-xs font-bold">Upload Your Image</span>
                  <span className="text-[10px] text-zinc-500">Resized to 1024px JPEG</span>
                </button>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-white/[0.08]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => baseInputRef.current?.click()}
                  className="flex-1 min-h-[40px] py-2 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-xs font-bold border border-white/10 transition cursor-pointer"
                >
                  {baseImage ? 'Replace Base' : 'Select Base'}
                </button>
                <button
                  type="button"
                  disabled={!baseImage || isScanningBase}
                  onClick={handleScanBase}
                  className="flex-1 min-h-[40px] py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  {isScanningBase ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>Scan Base</span>
                </button>
              </div>

              {baseError && <p className="text-xs text-red-400">{baseError}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: EDITABLE CAMERA PARAMETERS & SCHEMATIC */}
      {templateAnalysis && (
        <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-300" />
                <span>Extracted Camera Parameters (Editable)</span>
              </h3>
              <p className="text-xs text-zinc-400">
                {templateAnalysis.estimates.camera_position_summary}
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className="font-mono font-semibold text-emerald-300 tabular-nums">
                Confidence {Math.round(templateAnalysis.estimates.pitch_confidence * 100)}%
              </span>
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setShowEvidencePanel((prev) => !prev)}
                className="text-xs text-zinc-300 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <span>{showEvidencePanel ? 'Hide Evidence' : 'Show Evidence'}</span>
                {showEvidencePanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Warnings Box if any */}
          {consistencyWarnings.length > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Camera Geometry &amp; Consistency Warnings</span>
              </div>
              {consistencyWarnings.map((w, idx) => (
                <p key={idx} className="pl-5">
                  • {w}
                </p>
              ))}
            </div>
          )}

          {/* Evidence Panel (Collapsible) */}
          {showEvidencePanel && templateAnalysis.evidence && (
            <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 text-xs text-zinc-300 space-y-2">
              <div className="font-bold text-white">Observational Photogrammetry Evidence:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px]">
                <div>Horizon: <span className="text-zinc-200">{templateAnalysis.evidence.horizon_visible}</span></div>
                <div>Vanishing Points: <span className="text-zinc-200">{templateAnalysis.evidence.vanishing_points}</span></div>
                <div>Verticals: <span className="text-zinc-200">{templateAnalysis.evidence.vertical_lines_convergence}</span></div>
                <div>Floor Area: <span className="text-zinc-200">{templateAnalysis.evidence.ground_floor_visibility}</span></div>
                <div>Foreshortening: <span className="text-zinc-200">{templateAnalysis.evidence.foreshortening}</span></div>
                <div>Perspective Strength: <span className="text-zinc-200">{templateAnalysis.evidence.perspective_strength}</span></div>
              </div>
            </div>
          )}

          {/* Editable Parameters Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Pitch Deg & Label */}
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white">Pitch Angle (Degrees)</label>
                <span className="font-mono text-cyan-300 font-bold">
                  {templateAnalysis.estimates.pitch_deg}°
                </span>
              </div>
              <input
                type="range"
                min={-90}
                max={90}
                step={1}
                value={templateAnalysis.estimates.pitch_deg}
                onChange={(e) => updateTemplateEstimate('pitch_deg', parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400"
              />
              <select
                value={templateAnalysis.estimates.pitch_label}
                onChange={(e) => updateTemplateEstimate('pitch_label', e.target.value)}
                className="w-full bg-black/60 border border-white/15 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
              >
                <option value="top-down" className="bg-[#0e111a]">top-down (-90° to -75°)</option>
                <option value="bird's-eye" className="bg-[#0e111a]">bird&apos;s-eye (-75° to -45°)</option>
                <option value="high-angle" className="bg-[#0e111a]">high-angle (-45° to -15°)</option>
                <option value="level / eye-level" className="bg-[#0e111a]">level / eye-level (-15° to +15°)</option>
                <option value="low-angle" className="bg-[#0e111a]">low-angle (+15° to +45°)</option>
                <option value="worm's-eye" className="bg-[#0e111a]">worm&apos;s-eye (+45° to +90°)</option>
              </select>
            </div>

            {/* Height & Height Meters */}
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white">Camera Height</label>
                <span className="font-mono text-cyan-300 font-bold">
                  {templateAnalysis.estimates.camera_height_meters}m
                </span>
              </div>
              <input
                type="number"
                min={0.1}
                max={30}
                step={0.1}
                value={templateAnalysis.estimates.camera_height_meters}
                onChange={(e) =>
                  updateTemplateEstimate('camera_height_meters', parseFloat(e.target.value) || 1.6)
                }
                className="w-full bg-black/60 border border-white/15 focus:border-cyan-400 rounded-lg px-2.5 py-1 text-xs text-white outline-none"
              />
              <select
                value={templateAnalysis.estimates.camera_height}
                onChange={(e) => updateTemplateEstimate('camera_height', e.target.value)}
                className="w-full bg-black/60 border border-white/15 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
              >
                <option value="below ground level" className="bg-[#0e111a]">below ground level</option>
                <option value="floor level" className="bg-[#0e111a]">floor level</option>
                <option value="knee level" className="bg-[#0e111a]">knee level</option>
                <option value="waist level" className="bg-[#0e111a]">waist level</option>
                <option value="chest level" className="bg-[#0e111a]">chest level</option>
                <option value="eye level" className="bg-[#0e111a]">eye level</option>
                <option value="above head" className="bg-[#0e111a]">above head</option>
                <option value="elevated" className="bg-[#0e111a]">elevated</option>
                <option value="overhead" className="bg-[#0e111a]">overhead</option>
                <option value="drone-high" className="bg-[#0e111a]">drone-high</option>
              </select>
            </div>

            {/* Azimuth Deg & Axis */}
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white">Azimuth Orbit Angle</label>
                <span className="font-mono text-cyan-300 font-bold">
                  {templateAnalysis.estimates.azimuth_deg}°
                </span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={5}
                value={templateAnalysis.estimates.azimuth_deg}
                onChange={(e) =>
                  updateTemplateEstimate('azimuth_deg', parseInt(e.target.value, 10))
                }
                className="w-full accent-cyan-400"
              />
              <input
                type="text"
                value={templateAnalysis.estimates.azimuth_reference_axis}
                onChange={(e) =>
                  updateTemplateEstimate('azimuth_reference_axis', e.target.value)
                }
                placeholder="Reference axis (e.g. Subject facing)..."
                className="w-full bg-black/60 border border-white/15 focus:border-cyan-400 rounded-lg px-2.5 py-1 text-xs text-white outline-none"
              />
            </div>

            {/* Distance & Meters */}
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white">Distance</label>
                <span className="font-mono text-cyan-300 font-bold">
                  {templateAnalysis.estimates.distance_meters}m
                </span>
              </div>
              <select
                value={templateAnalysis.estimates.distance_label}
                onChange={(e) =>
                  updateTemplateEstimate(
                    'distance_label',
                    e.target.value as CameraAiTemplateAnalysis['estimates']['distance_label']
                  )
                }
                className="w-full bg-black/60 border border-white/15 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
              >
                <option value="extreme close" className="bg-[#0e111a]">extreme close</option>
                <option value="close" className="bg-[#0e111a]">close</option>
                <option value="medium" className="bg-[#0e111a]">medium</option>
                <option value="far" className="bg-[#0e111a]">far</option>
                <option value="very far" className="bg-[#0e111a]">very far</option>
              </select>
            </div>

            {/* Focal Length & Lens Equivalent */}
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white">Focal Length (35mm Eq)</label>
                <span className="font-mono text-cyan-300 font-bold">
                  {templateAnalysis.estimates.focal_length_mm}mm
                </span>
              </div>
              <input
                type="number"
                min={10}
                max={400}
                step={1}
                value={templateAnalysis.estimates.focal_length_mm}
                onChange={(e) =>
                  updateTemplateEstimate('focal_length_mm', parseInt(e.target.value, 10) || 50)
                }
                className="w-full bg-black/60 border border-white/15 focus:border-cyan-400 rounded-lg px-2.5 py-1 text-xs text-white outline-none"
              />
            </div>

            {/* Roll Deg (Dutch Tilt) */}
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white">Roll Angle (Dutch Tilt)</label>
                <span className="font-mono text-cyan-300 font-bold">
                  {templateAnalysis.estimates.roll_deg}°
                </span>
              </div>
              <input
                type="range"
                min={-45}
                max={45}
                step={1}
                value={templateAnalysis.estimates.roll_deg}
                onChange={(e) => updateTemplateEstimate('roll_deg', parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400"
              />
            </div>
          </div>

          {/* SVG Camera Schematic: Camera B (Original) vs Camera C (New) */}
          <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-cyan-300" />
                <span>Spatial Camera Setup Diagram (Camera B vs New Camera C)</span>
              </span>
              <span className="font-mono text-zinc-400 text-[11px]">
                Camera B = Original Eye-Level · Camera C = New Template Angle
              </span>
            </div>

            <div className="w-full h-40 bg-slate-950 rounded-xl overflow-hidden border border-white/10 flex items-center justify-center relative p-2">
              <svg className="w-full h-full" viewBox="-120 -80 240 160">
                {/* Ground Plane Grid */}
                <ellipse cx="0" cy="40" rx="100" ry="25" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="-100" y1="40" x2="100" y2="40" stroke="#475569" strokeWidth="1" />

                {/* Subject Marker in Center */}
                <circle cx="0" cy="35" r="7" fill="#22d3ee" />
                <text x="0" y="55" textAnchor="middle" fill="#22d3ee" fontSize="9" fontWeight="bold">
                  Subject (Facing ↓)
                </text>

                {/* Original Camera B (Front Eye-Level) */}
                <circle cx="0" cy="75" r="5" fill="#38bdf8" />
                <line x1="0" y1="70" x2="0" y2="42" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 2" />
                <text x="0" y="87" textAnchor="middle" fill="#38bdf8" fontSize="8" fontWeight="bold">
                  Camera B (Original)
                </text>

                {/* New Camera C Position derived from pitch & azimuth */}
                {(() => {
                  const azRad = (templateAnalysis.estimates.azimuth_deg * Math.PI) / 180;
                  const pitchRad = (templateAnalysis.estimates.pitch_deg * Math.PI) / 180;
                  const dist = 65;
                  const cx = Math.sin(azRad) * dist;
                  const cy = 35 + Math.cos(azRad) * (dist * 0.4) + Math.sin(pitchRad) * 20;

                  return (
                    <g>
                      <line x1="0" y1="35" x2={cx} y2={cy} stroke="#f43f5e" strokeWidth="2" />
                      <circle cx={cx} cy={cy} r="6" fill="#f43f5e" />
                      <text x={cx} y={cy - 9} textAnchor="middle" fill="#f43f5e" fontSize="8" fontWeight="bold">
                        New Camera C ({templateAnalysis.estimates.pitch_deg}°, {templateAnalysis.estimates.azimuth_deg}°)
                      </text>
                    </g>
                  );
                })()}
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: PROMPT OUTPUT, VARIANT SWITCHER, COPY & SAVE */}
      {templateAnalysis && (
        <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-300" />
                <span>Camera AI Generated Prompt</span>
              </h3>
              <p className="text-xs text-zinc-400">
                Deterministic output instructing an I2I model to re-photograph the scene from Camera C.
              </p>
            </div>

            {/* Variant Switcher + Model Selector */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-black/40 border border-white/10 rounded-xl">
                {(
                  [
                    { id: 'full', label: 'Full' },
                    { id: 'compact', label: 'Compact (~120w)' },
                    { id: 'no_base', label: 'No base image' },
                  ] as Array<{ id: CameraAiVariant; label: string }>
                ).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActiveVariant(v.id)}
                    className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      activeVariant === v.id
                        ? 'bg-cyan-400 text-slate-950 font-bold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <select
                value={targetModel}
                onChange={(e) => setTargetModel(e.target.value as TargetModelType)}
                className="min-h-[38px] bg-black/60 text-white border border-white/15 rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:border-cyan-400"
              >
                <option value="universal" className="bg-[#0e111a]">Universal / Standard</option>
                <option value="gemini" className="bg-[#0e111a]">Google Gemini</option>
                <option value="chatgpt" className="bg-[#0e111a]">ChatGPT / DALL-E</option>
                <option value="flux" className="bg-[#0e111a]">Flux</option>
              </select>
            </div>
          </div>

          {/* Prompt Textarea */}
          <textarea
            readOnly
            value={finalPrompt}
            rows={16}
            className="w-full bg-[#090b10] border border-white/10 text-white p-4 rounded-xl text-xs font-mono leading-relaxed outline-none select-text selection:bg-cyan-400 selection:text-slate-950 resize-y min-h-[260px]"
          />

          {/* Bottom Action Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="Project title..."
                className="min-h-[42px] bg-black/40 border border-white/15 focus:border-cyan-400 rounded-xl px-3 py-2 text-xs text-white outline-none flex-1 sm:w-48"
              />
              <button
                type="button"
                onClick={handleSaveAsProject}
                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white font-bold text-xs border border-white/15 flex items-center gap-1.5 transition cursor-pointer shrink-0"
              >
                <BookmarkPlus className="w-3.5 h-3.5 text-cyan-300" />
                <span>Save Project</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyPrompt}
              className="w-full sm:w-auto min-w-[200px] min-h-[44px] py-3 px-6 rounded-xl studio-cta-primary font-bold text-xs sm:text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {copySuccess ? (
                <>
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Copied Camera AI Prompt!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 stroke-[2.5]" />
                  <span>Copy Prompt</span>
                </>
              )}
            </button>
          </div>

          {savedNotice && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{savedNotice}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
