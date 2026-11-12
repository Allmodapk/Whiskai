import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookmarkPlus,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Info,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Sparkles,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import type { ImageDataItem, ReferenceBlueprint, TargetModelType } from '../../types';
import { StorageService } from '../../services/storage';
import { extractApiErrorMessage } from '../../services/apiClient';
import {
  COORDINATE_SYSTEM_DOCS,
  type AspectRatioOption,
  type CameraStateSnapshot,
  type CompiledPerspectivePrompt,
  type LockedCameraFrame,
  type PreservationPreferences,
  type SourceImageAnalysis,
} from '../../services/perspectivePlayboard/types';
import {
  CAMERA_LIMITS,
  CAMERA_PRESETS,
  DEFAULT_CAMERA_CONFIG,
} from '../../services/perspectivePlayboard/cameraController';
import { analyzePrimarySourceImage } from '../../services/perspectivePlayboard/sourceImageAnalysis';
import { validateTransformationConsistency } from '../../services/perspectivePlayboard/comparisonAndValidation';
import { compilePerspectivePrompt } from '../../services/perspectivePlayboard/promptCompiler';
import {
  PlayboardViewport,
  type PlayboardViewportHandle,
} from './PlayboardViewport';
import { BottomSheet, SegmentedTabs, StatusBanner } from '../ui/StudioPrimitives';

interface PerspectivePlayboardProps {
  optimizeImageFile: (file: File, label?: string) => Promise<ImageDataItem>;
  onOpenProjects?: () => void;
}

type PlayboardInspectorTab = 'camera' | 'source' | 'prompt';
type OutputTrayTab = 'generated' | 'comparison' | 'analysis';

const ASPECT_OPTIONS: AspectRatioOption[] = ['3:4', '4:5', '2:3', '1:1', '4:3', '16:9', '9:16'];

const DEFAULT_PRESERVATION: PreservationPreferences = {
  preserveIdentityAndFace: true,
  preserveHairAndFeatures: true,
  preserveClothingAndAccessories: true,
  preserveBodyProportions: true,
  preservePoseAndOrientation: true,
  preserveExpression: true,
  preserveEnvironmentAndLighting: true,
  preserveColorsAndTextures: true,
  requirePixelIdenticalComposition: false,
  requireFullBodyVisibleInOutput: false,
  requireFrontDetailsDirectlyVisible: false,
  additionalUserNotes: '',
};

async function createCompactThumb(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      const MAX = 220;
      let w = img.width;
      let h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) {
          h = Math.round((h * MAX) / w);
          w = MAX;
        } else {
          w = Math.round((w * MAX) / h);
          h = MAX;
        }
      }
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.65));
    };
    img.src = dataUrl;
  });
}

export const PerspectivePlayboard: React.FC<PerspectivePlayboardProps> = ({
  optimizeImageFile,
  onOpenProjects,
}) => {
  const viewportRef = useRef<PlayboardViewportHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const outputTrayRef = useRef<HTMLDivElement | null>(null);

  const [inspectorTab, setInspectorTab] = useState<PlayboardInspectorTab>('camera');
  const [outputTrayTab, setOutputTrayTab] = useState<OutputTrayTab>('generated');

  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>(
    DEFAULT_CAMERA_CONFIG.aspectRatio
  );
  const [liveCameraState, setLiveCameraState] = useState<CameraStateSnapshot | null>(null);
  const [lockedFrame, setLockedFrame] = useState<LockedCameraFrame | null>(null);
  const [selectedPresetLabel, setSelectedPresetLabel] = useState<string>('Front Eye-Level');
  const [isPresetSheetOpen, setIsPresetSheetOpen] = useState(false);

  const [primaryImage, setPrimaryImage] = useState<ImageDataItem | null>(null);
  const [sourceAnalysis, setSourceAnalysis] = useState<SourceImageAnalysis | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);

  const [preservation, setPreservation] = useState<PreservationPreferences>(DEFAULT_PRESERVATION);
  const [targetModel, setTargetModel] = useState<TargetModelType>('universal');
  const [compiledPrompt, setCompiledPrompt] = useState<CompiledPerspectivePrompt | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [showDocsModal, setShowDocsModal] = useState(false);
  const [showAdvancedFraming, setShowAdvancedFraming] = useState(false);

  const isLocked = Boolean(lockedFrame?.isLocked);

  const handleToggleLock = () => {
    if (isLocked) {
      setLockedFrame(null);
      setCompiledPrompt(null);
      return;
    }

    const exactSnapshot = viewportRef.current?.getLiveSnapshot() || liveCameraState;
    if (!exactSnapshot) return;

    setLockedFrame({
      isLocked: true,
      lockedAt: Date.now(),
      cameraState: exactSnapshot,
    });
  };

  const pushCameraSliderUpdate = (partial: {
    azimuthDeg?: number;
    elevationDeg?: number;
    distanceMeters?: number;
    focalLengthMm?: number;
    targetX?: number;
    targetY?: number;
    rollDeg?: number;
  }) => {
    if (isLocked || !liveCameraState) return;
    viewportRef.current?.applyCameraParams({
      azimuthDeg: partial.azimuthDeg ?? liveCameraState.azimuthDeg,
      elevationDeg: partial.elevationDeg ?? liveCameraState.elevationDeg,
      distanceMeters: partial.distanceMeters ?? liveCameraState.distanceMeters,
      focalLengthMm: partial.focalLengthMm ?? liveCameraState.focalLengthMm,
      targetOffset: {
        x: partial.targetX ?? liveCameraState.targetPosition.x,
        y: partial.targetY ?? liveCameraState.targetPosition.y,
        z: liveCameraState.targetPosition.z,
      },
      rollDeg: partial.rollDeg ?? liveCameraState.rollDeg,
    });
  };

  const handleUploadPrimaryImage = async (file: File | null | undefined) => {
    if (!file) return;
    setAnalysisError(null);
    try {
      const optimized = await optimizeImageFile(file, 'Primary Source Image');
      setPrimaryImage(optimized);
      setSourceAnalysis(null);
      setCompiledPrompt(null);
    } catch (err: any) {
      setAnalysisError(extractApiErrorMessage(err, 'Could not load the selected image.'));
    }
  };

  const handleAnalyzePrimaryImage = async () => {
    if (!primaryImage || isAnalyzingImage) return;
    setIsAnalyzingImage(true);
    setAnalysisError(null);
    try {
      const analyzed = await analyzePrimarySourceImage(primaryImage);
      setSourceAnalysis(analyzed);
      setCompiledPrompt(null);
    } catch (err: any) {
      setAnalysisError(
        extractApiErrorMessage(
          err,
          'Visual analysis could not be completed. You can retry or continue in Camera-First mode.'
        )
      );
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const handleClearPrimaryImage = () => {
    setPrimaryImage(null);
    setSourceAnalysis(null);
    setAnalysisError(null);
    setCompiledPrompt(null);
  };

  const updateInferredField = (
    field: 'azimuth' | 'elevation' | 'focalLength' | 'shotSize' | 'placement',
    rawValue: string
  ) => {
    if (!sourceAnalysis) return;
    setCompiledPrompt(null);
    setSourceAnalysis((prev) => {
      if (!prev) return null;
      const next = {
        ...prev,
        userConfirmedEdits: true,
        inferredCamera: { ...prev.inferredCamera },
      };
      if (field === 'azimuth') {
        const num = rawValue === '' ? null : Number(rawValue);
        next.inferredCamera.azimuthDeg = {
          ...next.inferredCamera.azimuthDeg,
          value: num !== null && !Number.isNaN(num) ? num : null,
          confidence: num !== null ? 'high' : 'unknown',
        };
      } else if (field === 'elevation') {
        const num = rawValue === '' ? null : Number(rawValue);
        next.inferredCamera.elevationDeg = {
          ...next.inferredCamera.elevationDeg,
          value: num !== null && !Number.isNaN(num) ? num : null,
          confidence: num !== null ? 'high' : 'unknown',
        };
      } else if (field === 'focalLength') {
        const num = rawValue === '' ? null : Number(rawValue);
        next.inferredCamera.focalLengthMm = {
          ...next.inferredCamera.focalLengthMm,
          value: num !== null && !Number.isNaN(num) ? num : null,
          confidence: num !== null ? 'high' : 'unknown',
        };
      } else if (field === 'shotSize') {
        next.inferredCamera.shotSize = rawValue;
      } else if (field === 'placement') {
        next.inferredCamera.subjectPlacement = rawValue;
      }
      return next;
    });
  };

  const activeCameraForValidation = lockedFrame?.cameraState || liveCameraState;
  const validationResult = useMemo(() => {
    if (!activeCameraForValidation) {
      return { hasErrors: false, hasWarnings: false, issues: [] };
    }
    return validateTransformationConsistency(
      activeCameraForValidation,
      preservation,
      sourceAnalysis
    );
  }, [activeCameraForValidation, preservation, sourceAnalysis]);

  const handleResolveContradiction = (
    actionId?:
      | 'disable_pixel_identical'
      | 'disable_full_body_lock'
      | 'disable_front_visibility_lock'
      | 'unlock_to_adjust'
  ) => {
    if (!actionId) return;
    if (actionId === 'disable_pixel_identical') {
      setPreservation((p) => ({ ...p, requirePixelIdenticalComposition: false }));
    } else if (actionId === 'disable_full_body_lock') {
      setPreservation((p) => ({ ...p, requireFullBodyVisibleInOutput: false }));
    } else if (actionId === 'disable_front_visibility_lock') {
      setPreservation((p) => ({ ...p, requireFrontDetailsDirectlyVisible: false }));
    } else if (actionId === 'unlock_to_adjust') {
      setLockedFrame(null);
      setCompiledPrompt(null);
    }
  };

  const handleGeneratePrompt = (autoLockIfUnlocked = false) => {
    let targetLock = lockedFrame;
    if (!targetLock) {
      if (!autoLockIfUnlocked) return;
      const snap = viewportRef.current?.getLiveSnapshot() || liveCameraState;
      if (!snap) return;
      targetLock = {
        isLocked: true,
        lockedAt: Date.now(),
        cameraState: snap,
      };
      setLockedFrame(targetLock);
    }

    const check = validateTransformationConsistency(
      targetLock.cameraState,
      preservation,
      sourceAnalysis
    );
    if (check.hasErrors) {
      setInspectorTab('prompt');
      return;
    }

    const result = compilePerspectivePrompt({
      lockedFrame: targetLock,
      sourceAnalysis,
      preservation,
      targetModel,
    });
    setCompiledPrompt(result);
    setOutputTrayTab('generated');
    requestAnimationFrame(() => {
      outputTrayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const compiledFull = useMemo(() => {
    if (!compiledPrompt || !lockedFrame) return null;
    return compilePerspectivePrompt({
      lockedFrame,
      sourceAnalysis,
      preservation,
      targetModel,
    });
  }, [compiledPrompt, lockedFrame, sourceAnalysis, preservation, targetModel]);

  const displayedPromptText = compiledFull?.exportedText || '';

  const handleCopyPrompt = () => {
    if (!displayedPromptText) return;
    navigator.clipboard.writeText(displayedPromptText);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2200);
  };

  const handleDownloadPrompt = () => {
    if (!displayedPromptText || !lockedFrame) return;
    const blob = new Blob([displayedPromptText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiskai_perspective_${lockedFrame.cameraState.azimuthDeg}az_${lockedFrame.cameraState.elevationDeg}el.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveAsProject = async () => {
    if (!lockedFrame || !displayedPromptText) return;
    const cam = lockedFrame.cameraState;
    const title =
      projectTitle.trim() ||
      `3D Perspective · ${cam.azimuthLabel} (${cam.azimuthDeg}°, ${cam.elevationDeg}°)`;
    const thumb = primaryImage
      ? await createCompactThumb(primaryImage.previewUrl)
      : '';

    const blueprint: ReferenceBlueprint = {
      id: `persp_playboard_${Date.now()}`,
      schemaVersion: 1,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      toolType: 'perspective_playboard',
      referenceThumbnails: thumb ? [thumb] : [],
      referenceImageIds: [],
      masterSubject: `${cam.azimuthLabel} · ${cam.elevationLabel} · ${cam.shotSize}`,
      masterBody: `Az ${cam.azimuthDeg}° · El ${cam.elevationDeg}° · ${cam.distanceMeters}m · ${cam.focalLengthMm}mm · Roll ${cam.rollDeg}°`,
      originalComponents: {} as any,
      components: {} as any,
      outputRatio: cam.aspectRatio,
      finalPrompt: displayedPromptText,
      targetModel,
    };

    StorageService.saveBlueprint(blueprint);
    setSavedNotice(`Saved "${title}" to Projects.`);
    setTimeout(() => setSavedNotice(null), 3500);
  };

  const currentValues = lockedFrame?.cameraState || liveCameraState;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleUploadPrimaryImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* Compact Top Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/25 to-cyan-400/20 border border-violet-400/35 text-violet-300 flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-xl font-bold text-white tracking-tight">
              3D Perspective Playboard
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5 max-w-2xl">
              Visual camera rig for exact image-to-image angle, distance, and optical perspective prompts.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowDocsModal(true)}
            className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.09] text-xs font-medium text-zinc-300 flex items-center gap-1.5 cursor-pointer"
            title="Coordinate convention guide"
          >
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden xs:inline">Coords</span>
          </button>

          <div className="inline-flex items-center p-0.5 rounded-xl bg-[#090d16] border border-white/[0.09]">
            <button
              type="button"
              onClick={() => setInspectorTab('camera')}
              className={`min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                !sourceAnalysis
                  ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                  : 'text-zinc-400 hover:text-white border border-transparent'
              }`}
            >
              <Camera className="w-3 h-3" />
              <span>Camera-First</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('source')}
              className={`min-h-[32px] px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                sourceAnalysis
                  ? 'bg-violet-500/25 text-violet-200 border border-violet-400/45'
                  : 'text-zinc-400 hover:text-white border border-transparent'
              }`}
            >
              <ImageIcon className="w-3 h-3" />
              <span>Image-Aware</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Split Workspace: Dominant 3D Stage (Left) + Tabbed Inspector (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN: 3D Stage + Mobile Quick Action Row + Desktop Source Quick Strip */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-3">
          <PlayboardViewport
            ref={viewportRef}
            aspectRatio={aspectRatio}
            isLocked={isLocked}
            onToggleLock={handleToggleLock}
            onCameraStateChange={(snap) => setLiveCameraState(snap)}
          />

          {/* Quick Action Strip matching Image 3: Preset Selector | Reset | Lock Frame */}
          <div className="grid grid-cols-12 gap-2">
            <button
              type="button"
              disabled={isLocked}
              onClick={() => setIsPresetSheetOpen(true)}
              className="col-span-5 sm:col-span-6 min-h-[42px] px-3 rounded-xl bg-[#0e131e] hover:bg-[#141b2a] border border-white/[0.1] text-xs font-semibold text-white flex items-center justify-between gap-2 disabled:opacity-45 cursor-pointer"
            >
              <span className="truncate">{selectedPresetLabel}</span>
              <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            </button>

            <button
              type="button"
              disabled={isLocked}
              onClick={() => {
                setSelectedPresetLabel('Front Eye-Level');
                viewportRef.current?.resetToDefault();
              }}
              className="col-span-3 sm:col-span-3 min-h-[42px] px-3 rounded-xl bg-[#0e131e] hover:bg-[#141b2a] border border-white/[0.1] text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={handleToggleLock}
              className={`col-span-4 sm:col-span-3 min-h-[42px] px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                isLocked
                  ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                  : 'studio-cta-primary'
              }`}
            >
              {isLocked ? (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Unlock</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock Frame</span>
                </>
              )}
            </button>
          </div>

          {/* Desktop Quick Source Image Strip directly beneath 3D Viewport (mirrors Image 1) */}
          <div className="hidden lg:flex items-center justify-between gap-3 studio-panel rounded-2xl p-3">
            {!primaryImage ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 min-h-[54px] rounded-xl border border-dashed border-white/15 hover:border-cyan-400/50 bg-[#0b101b] px-4 py-2.5 flex items-center justify-center gap-2.5 text-xs text-zinc-300 hover:text-white transition cursor-pointer"
              >
                <Upload className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold">+ Upload Primary Image</span>
                <span className="text-zinc-500">(Optional for Image-Aware deltas)</span>
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 w-full">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={primaryImage.previewUrl}
                    alt={primaryImage.name || 'Primary source'}
                    className="w-12 h-12 rounded-xl object-cover border border-white/15 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      {sourceAnalysis ? (
                        <span className="text-cyan-300">Source Image Analyzed</span>
                      ) : (
                        <span>Source Image Loaded</span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400 truncate tabular-nums">
                      {sourceAnalysis
                        ? `Az ${sourceAnalysis.inferredCamera.azimuthDeg.value ?? '?'}° · El ${sourceAnalysis.inferredCamera.elevationDeg.value ?? '?'}° · ${sourceAnalysis.inferredCamera.shotSize}`
                        : primaryImage.name || 'Ready to inspect starting camera angle'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isAnalyzingImage}
                    onClick={handleAnalyzePrimaryImage}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-cyan-400/15 hover:bg-cyan-400/25 border border-cyan-400/40 text-cyan-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {isAnalyzingImage ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>{sourceAnalysis ? 'Re-Analyze' : 'Analyze Angle'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInspectorTab('source')}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-200 text-xs font-semibold cursor-pointer"
                  >
                    Inspect
                  </button>
                  <button
                    type="button"
                    onClick={handleClearPrimaryImage}
                    aria-label="Remove source image"
                    className="min-h-[36px] w-9 rounded-xl bg-white/[0.04] hover:bg-red-500/20 text-zinc-400 hover:text-red-300 flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Tabbed Studio Inspector (Camera | Image | Prompt) */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-3">
          <div className="studio-panel rounded-2xl overflow-hidden">
            <div className="px-3 pt-1">
              <SegmentedTabs
                variant="underline"
                fullWidth
                value={inspectorTab}
                onChange={setInspectorTab}
                options={[
                  { id: 'camera', label: 'Camera', icon: Sliders },
                  { id: 'source', label: 'Image', icon: ImageIcon },
                  { id: 'prompt', label: 'Prompt', icon: FileText },
                ]}
              />
            </div>

            {/* TAB 1: CAMERA RIG SLIDERS & ASPECT RATIO */}
            {inspectorTab === 'camera' && (
              <div className="p-4 space-y-4">
                {isLocked && (
                  <StatusBanner
                    tone="success"
                    icon={<Lock className="w-4 h-4 text-emerald-400" />}
                    action={
                      <button
                        type="button"
                        onClick={handleToggleLock}
                        className="text-xs text-emerald-300 hover:text-white underline font-semibold cursor-pointer"
                      >
                        Unlock
                      </button>
                    }
                  >
                    Target frame locked for prompt compilation.
                  </StatusBanner>
                )}

                {currentValues && (
                  <div className="space-y-3.5">
                    {/* Azimuth Slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-zinc-200 font-medium">Azimuth (Horizontal)</span>
                        <span className="px-2 py-0.5 rounded-md bg-[#090d16] border border-white/[0.1] font-mono text-cyan-300 tabular-nums">
                          {currentValues.azimuthDeg > 0
                            ? `+${currentValues.azimuthDeg}`
                            : currentValues.azimuthDeg}
                          °
                        </span>
                      </div>
                      <input
                        type="range"
                        min={CAMERA_LIMITS.minAzimuthDeg}
                        max={CAMERA_LIMITS.maxAzimuthDeg}
                        step={1}
                        disabled={isLocked}
                        value={currentValues.azimuthDeg}
                        onChange={(e) =>
                          pushCameraSliderUpdate({ azimuthDeg: Number(e.target.value) })
                        }
                        className="w-full cursor-pointer disabled:opacity-45"
                      />
                    </div>

                    {/* Elevation Slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-zinc-200 font-medium">Elevation (Vertical)</span>
                        <span className="px-2 py-0.5 rounded-md bg-[#090d16] border border-white/[0.1] font-mono text-cyan-300 tabular-nums">
                          {currentValues.elevationDeg > 0
                            ? `+${currentValues.elevationDeg}`
                            : currentValues.elevationDeg}
                          °
                        </span>
                      </div>
                      <input
                        type="range"
                        min={CAMERA_LIMITS.minElevationDeg}
                        max={CAMERA_LIMITS.maxElevationDeg}
                        step={1}
                        disabled={isLocked}
                        value={currentValues.elevationDeg}
                        onChange={(e) =>
                          pushCameraSliderUpdate({ elevationDeg: Number(e.target.value) })
                        }
                        className="w-full cursor-pointer disabled:opacity-45"
                      />
                    </div>

                    {/* Distance Slider */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-zinc-200 font-medium">Distance (Camera)</span>
                        <span className="px-2 py-0.5 rounded-md bg-[#090d16] border border-white/[0.1] font-mono text-violet-300 tabular-nums">
                          {currentValues.distanceMeters} m
                        </span>
                      </div>
                      <input
                        type="range"
                        min={CAMERA_LIMITS.minDistanceMeters}
                        max={CAMERA_LIMITS.maxDistanceMeters}
                        step={0.05}
                        disabled={isLocked}
                        value={currentValues.distanceMeters}
                        onChange={(e) =>
                          pushCameraSliderUpdate({ distanceMeters: Number(e.target.value) })
                        }
                        className="w-full slider-violet cursor-pointer disabled:opacity-45"
                      />
                    </div>

                    {/* Lens Focal Length / FOV */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="text-zinc-200 font-medium">Lens / Field of View</span>
                        <span className="px-2 py-0.5 rounded-md bg-[#090d16] border border-white/[0.1] font-mono text-zinc-200 tabular-nums">
                          {currentValues.focalLengthMm}mm · {currentValues.fovDeg}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={CAMERA_LIMITS.minFocalLengthMm}
                        max={CAMERA_LIMITS.maxFocalLengthMm}
                        step={1}
                        disabled={isLocked}
                        value={currentValues.focalLengthMm}
                        onChange={(e) =>
                          pushCameraSliderUpdate({ focalLengthMm: Number(e.target.value) })
                        }
                        className="w-full cursor-pointer disabled:opacity-45"
                      />
                    </div>

                    {/* Aspect Ratio Chips */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300 font-medium">Aspect Ratio</span>
                        <span className="font-mono text-cyan-300 text-[11px]">{aspectRatio}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {ASPECT_OPTIONS.map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            disabled={isLocked}
                            onClick={() => setAspectRatio(ratio)}
                            className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-45 ${
                              aspectRatio === ratio
                                ? 'bg-cyan-400/20 border border-cyan-400/60 text-cyan-200'
                                : 'bg-[#0b101b] border border-white/[0.08] text-zinc-400 hover:text-white'
                            }`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Expandable Advanced Settings (Target X/Y, Roll, Coordinates) */}
                    <button
                      type="button"
                      onClick={() => setShowAdvancedFraming((v) => !v)}
                      className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-[#0a0e18] hover:bg-white/[0.05] border border-white/[0.08] text-xs font-medium text-zinc-200 flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Advanced Settings</span>
                      </span>
                      {showAdvancedFraming ? (
                        <ChevronUp className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-zinc-400" />
                      )}
                    </button>

                    {showAdvancedFraming && (
                      <div className="space-y-3 pt-2 border-t border-white/[0.07]">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300">Vertical Look Height (Target Y)</span>
                            <span className="font-mono text-zinc-200 tabular-nums">
                              {currentValues.targetPosition.y}m
                            </span>
                          </div>
                          <input
                            type="range"
                            min={CAMERA_LIMITS.minTargetY}
                            max={CAMERA_LIMITS.maxTargetY}
                            step={0.02}
                            disabled={isLocked}
                            value={currentValues.targetPosition.y}
                            onChange={(e) =>
                              pushCameraSliderUpdate({ targetY: Number(e.target.value) })
                            }
                            className="w-full cursor-pointer disabled:opacity-45"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300">Horizontal Subject Shift (Target X)</span>
                            <span className="font-mono text-zinc-200 tabular-nums">
                              {currentValues.targetPosition.x}m
                            </span>
                          </div>
                          <input
                            type="range"
                            min={CAMERA_LIMITS.minTargetX}
                            max={CAMERA_LIMITS.maxTargetX}
                            step={0.02}
                            disabled={isLocked}
                            value={currentValues.targetPosition.x}
                            onChange={(e) =>
                              pushCameraSliderUpdate({ targetX: Number(e.target.value) })
                            }
                            className="w-full cursor-pointer disabled:opacity-45"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300">Camera Roll (Dutch Tilt)</span>
                            <span className="font-mono text-zinc-200 tabular-nums">
                              {currentValues.rollDeg}°
                            </span>
                          </div>
                          <input
                            type="range"
                            min={CAMERA_LIMITS.minRollDeg}
                            max={CAMERA_LIMITS.maxRollDeg}
                            step={1}
                            disabled={isLocked}
                            value={currentValues.rollDeg}
                            onChange={(e) =>
                              pushCameraSliderUpdate({ rollDeg: Number(e.target.value) })
                            }
                            className="w-full slider-violet cursor-pointer disabled:opacity-45"
                          />
                        </div>

                        {/* Live world coordinates */}
                        <div className="p-2.5 rounded-xl bg-[#090d16] border border-white/[0.07] grid grid-cols-2 gap-1.5 text-[11px] font-mono tabular-nums">
                          <div className="text-zinc-400">Shot Size</div>
                          <div className="text-cyan-300 text-right font-semibold">
                            {currentValues.shotSize}
                          </div>
                          <div className="text-zinc-400">Placement</div>
                          <div className="text-zinc-200 text-right">
                            {currentValues.subjectBounds.heightPct}% · {currentValues.subjectBounds.placementLabel}
                          </div>
                          <div className="text-zinc-400">World XYZ</div>
                          <div className="text-zinc-200 text-right">
                            ({currentValues.worldPosition.x}, {currentValues.worldPosition.y},{' '}
                            {currentValues.worldPosition.z})
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Primary Cyan/Violet Gradient CTA */}
                <button
                  type="button"
                  disabled={validationResult.hasErrors}
                  onClick={() => handleGeneratePrompt(true)}
                  className="w-full min-h-[46px] px-4 rounded-xl studio-cta-primary font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-45 transition cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Prompt</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* TAB 2: OPTIONAL PRIMARY IMAGE & AI CAMERA ANALYSIS */}
            {inspectorTab === 'source' && (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-bold text-white">
                      Optional Source Image
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Inspect a source photo&apos;s starting camera angle or keep Camera-First mode.
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-mono font-semibold whitespace-nowrap ${
                      sourceAnalysis ? 'text-violet-300' : 'text-cyan-300'
                    }`}
                  >
                    {sourceAnalysis ? 'Image-Aware' : 'Camera-First'}
                  </span>
                </div>

                {!primaryImage ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingImage(true);
                    }}
                    onDragLeave={() => setIsDraggingImage(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingImage(false);
                      handleUploadPrimaryImage(e.dataTransfer.files?.[0]);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`rounded-xl border border-dashed p-6 text-center transition-colors cursor-pointer ${
                      isDraggingImage
                        ? 'border-cyan-400 bg-cyan-400/10'
                        : 'border-white/15 hover:border-cyan-400/50 bg-[#0b101b]'
                    }`}
                  >
                    <Upload className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
                    <div className="text-xs font-bold text-white">
                      Upload Optional Primary Image
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1">
                      JPEG, PNG, WebP · Analyzed for starting angle estimation
                    </div>
                  </div>
                ) : (
                  <div className="studio-card rounded-xl p-3 space-y-3">
                    <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-black">
                      <img
                        src={primaryImage.previewUrl}
                        alt={primaryImage.name || 'Primary source image'}
                        className="w-full h-full object-contain"
                      />
                      <button
                        type="button"
                        onClick={handleClearPrimaryImage}
                        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/80 text-white hover:bg-red-500 flex items-center justify-center cursor-pointer"
                        title="Remove source image"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isAnalyzingImage}
                        onClick={handleAnalyzePrimaryImage}
                        className="flex-1 min-h-[40px] py-2 px-3 rounded-xl studio-cta-primary font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        {isAnalyzingImage ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Analyzing Perspective...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>{sourceAnalysis ? 'Re-Analyze Image' : 'Analyze Source Image'}</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="min-h-[40px] py-2 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-xs font-semibold cursor-pointer"
                      >
                        Replace
                      </button>
                    </div>
                  </div>
                )}

                {analysisError && <StatusBanner tone="error">{analysisError}</StatusBanner>}

                {sourceAnalysis && (
                  <div className="space-y-3">
                    {sourceAnalysis.isFallbackEstimate && (
                      <StatusBanner tone="warning">
                        {sourceAnalysis.warningMessage ||
                          'Live AI quota reached; values below are local estimates. Review and edit to match your photo.'}
                      </StatusBanner>
                    )}

                    <div className="studio-card rounded-xl p-3.5 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-white">Inferred Camera Estimates</span>
                        <span className="text-[11px] text-cyan-300">Editable</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="space-y-1">
                          <span className="text-[11px] text-zinc-400 block">
                            Azimuth° ({sourceAnalysis.inferredCamera.azimuthDeg.confidence})
                          </span>
                          <input
                            type="number"
                            min={-180}
                            max={180}
                            value={sourceAnalysis.inferredCamera.azimuthDeg.value ?? ''}
                            onChange={(e) => updateInferredField('azimuth', e.target.value)}
                            placeholder="Unknown"
                            className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-2 text-xs text-white font-mono outline-none focus:border-cyan-400"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] text-zinc-400 block">
                            Elevation° ({sourceAnalysis.inferredCamera.elevationDeg.confidence})
                          </span>
                          <input
                            type="number"
                            min={-65}
                            max={85}
                            value={sourceAnalysis.inferredCamera.elevationDeg.value ?? ''}
                            onChange={(e) => updateInferredField('elevation', e.target.value)}
                            placeholder="Unknown"
                            className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-2 text-xs text-white font-mono outline-none focus:border-cyan-400"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] text-zinc-400 block">
                            Focal mm ({sourceAnalysis.inferredCamera.focalLengthMm.confidence})
                          </span>
                          <input
                            type="number"
                            min={14}
                            max={200}
                            value={sourceAnalysis.inferredCamera.focalLengthMm.value ?? ''}
                            onChange={(e) => updateInferredField('focalLength', e.target.value)}
                            placeholder="Unknown"
                            className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-2 text-xs text-white font-mono outline-none focus:border-cyan-400"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] text-zinc-400 block">
                            Shot Size ({sourceAnalysis.inferredCamera.shotSizeConfidence})
                          </span>
                          <input
                            type="text"
                            value={sourceAnalysis.inferredCamera.shotSize}
                            onChange={(e) => updateInferredField('shotSize', e.target.value)}
                            className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400"
                          />
                        </label>
                      </div>

                      <label className="space-y-1 block">
                        <span className="text-[11px] text-zinc-400 block">Subject Placement</span>
                        <input
                          type="text"
                          value={sourceAnalysis.inferredCamera.subjectPlacement}
                          onChange={(e) => updateInferredField('placement', e.target.value)}
                          className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: PRESERVATION RULES & STRICT CONSTRAINTS */}
            {inspectorTab === 'prompt' && (
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-bold text-white">
                      Preservation &amp; Constraints
                    </h3>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Control what external AI keeps fixed while relocating camera angle.
                    </p>
                  </div>
                  <select
                    value={targetModel}
                    onChange={(e) => setTargetModel(e.target.value as TargetModelType)}
                    className="bg-[#0b101b] text-white border border-white/15 rounded-xl px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-cyan-400"
                  >
                    <option value="universal" className="bg-[#0e1118]">Universal</option>
                    <option value="gemini" className="bg-[#0e1118]">Gemini</option>
                    <option value="chatgpt" className="bg-[#0e1118]">ChatGPT</option>
                    <option value="flux" className="bg-[#0e1118]">Flux</option>
                  </select>
                </div>

                {validationResult.issues.length > 0 && (
                  <div className="space-y-2">
                    {validationResult.issues.map((issue) => (
                      <StatusBanner
                        key={issue.id}
                        tone={issue.severity === 'error' ? 'error' : 'warning'}
                        title={issue.title}
                        icon={<ShieldAlert className="w-4 h-4 shrink-0" />}
                        action={
                          issue.resolutionActionId && (
                            <button
                              type="button"
                              onClick={() => handleResolveContradiction(issue.resolutionActionId)}
                              className="min-h-[34px] px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-xs cursor-pointer whitespace-nowrap"
                            >
                              {issue.resolutionActionId === 'unlock_to_adjust'
                                ? 'Unlock Camera'
                                : 'Remove Constraint'}
                            </button>
                          )
                        }
                      >
                        <div>{issue.explanation}</div>
                        <div className="text-zinc-400 mt-1">
                          Resolution: {issue.suggestedResolution}
                        </div>
                      </StatusBanner>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5 text-xs">
                  <div className="font-semibold text-zinc-200 mb-1">Elements to Preserve</div>
                  {(
                    [
                      ['preserveIdentityAndFace', 'Facial identity & likeness'],
                      ['preserveHairAndFeatures', 'Hair & distinctive features'],
                      ['preserveClothingAndAccessories', 'Clothing & accessories'],
                      ['preserveBodyProportions', 'Body proportions'],
                      ['preservePoseAndOrientation', 'Pose & body orientation (frozen)'],
                      ['preserveExpression', 'Facial expression & original gaze'],
                      ['preserveEnvironmentAndLighting', 'Environment, lighting & shadows'],
                      ['preserveColorsAndTextures', 'Materials, colors & textures'],
                    ] as Array<[keyof PreservationPreferences, string]>
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-[#0b101b] border border-white/[0.06] cursor-pointer hover:border-white/15"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(preservation[key])}
                        onChange={(e) =>
                          setPreservation((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                      />
                      <span className="text-zinc-200">{label}</span>
                    </label>
                  ))}
                </div>

                <div className="space-y-1.5 text-xs pt-2 border-t border-white/[0.07]">
                  <div className="font-semibold text-zinc-200 mb-1">Strict Constraints &amp; Notes</div>
                  {(
                    [
                      ['requirePixelIdenticalComposition', 'Require pixel-identical composition'],
                      ['requireFullBodyVisibleInOutput', 'Require full-body framing in output'],
                      ['requireFrontDetailsDirectlyVisible', 'Require all front details directly visible'],
                    ] as Array<[keyof PreservationPreferences, string]>
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-[#0b101b] border border-white/[0.06] cursor-pointer hover:border-white/15"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(preservation[key])}
                        onChange={(e) =>
                          setPreservation((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                      />
                      <span className="text-zinc-300">{label}</span>
                    </label>
                  ))}

                  <textarea
                    rows={2}
                    value={preservation.additionalUserNotes}
                    onChange={(e) =>
                      setPreservation((prev) => ({
                        ...prev,
                        additionalUserNotes: e.target.value,
                      }))
                    }
                    placeholder="Optional custom note (e.g., maintain soft window rim light)..."
                    className="w-full mt-1 bg-[#0b101b] border border-white/10 focus:border-cyan-400 rounded-xl p-2.5 text-xs text-white outline-none resize-none"
                  />
                </div>

                <button
                  type="button"
                  disabled={validationResult.hasErrors}
                  onClick={() => handleGeneratePrompt(true)}
                  className="w-full min-h-[46px] px-4 rounded-xl studio-cta-primary font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-45 transition cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isLocked ? 'Compile 9-Section Prompt' : 'Lock & Generate Prompt'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FULL-WIDTH TABBED OUTPUT TRAY (Mirrors Image 1 Bottom Output Area + Seamless Mobile Scroll Target) */}
      {compiledFull && isLocked && (
        <div
          ref={outputTrayRef}
          className="studio-panel rounded-2xl overflow-hidden border border-cyan-400/25"
        >
          <div className="px-4 pt-2 pb-2 bg-[#090d16] border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
            <SegmentedTabs
              variant="underline"
              value={outputTrayTab}
              onChange={setOutputTrayTab}
              options={[
                { id: 'generated', label: 'Generated Prompt', icon: FileText },
                { id: 'comparison', label: 'Camera Comparison', icon: Compass },
                { id: 'analysis', label: 'Analysis Details', icon: ImageIcon },
              ]}
            />

            <div className="flex flex-wrap items-center gap-2 ml-auto py-1">
              <select
                value={targetModel}
                onChange={(e) => setTargetModel(e.target.value as TargetModelType)}
                className="min-h-[34px] bg-[#111622] text-white border border-white/15 rounded-lg px-2.5 py-1 text-xs font-semibold outline-none focus:border-cyan-400"
              >
                <option value="universal" className="bg-[#0e1118]">Universal</option>
                <option value="gemini" className="bg-[#0e1118]">Google Gemini</option>
                <option value="chatgpt" className="bg-[#0e1118]">ChatGPT</option>
                <option value="flux" className="bg-[#0e1118]">Flux</option>
              </select>

              <button
                type="button"
                onClick={handleCopyPrompt}
                className="min-h-[34px] px-3 py-1 rounded-lg studio-cta-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                {copySuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadPrompt}
                className="min-h-[34px] px-3 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>Download</span>
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {outputTrayTab === 'generated' && (
              <>
                <textarea
                  readOnly
                  rows={12}
                  value={displayedPromptText}
                  className="w-full bg-[#070a11] border border-white/[0.1] text-zinc-100 p-4 rounded-xl text-xs font-mono leading-relaxed outline-none select-text selection:bg-cyan-400 selection:text-slate-950 resize-y min-h-[220px]"
                />

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                    placeholder="Optional project title to save this setup..."
                    className="flex-1 min-h-[40px] bg-[#0b101b] border border-white/15 focus:border-cyan-400 rounded-xl px-3 py-2 text-xs text-white outline-none min-w-0"
                  />
                  <button
                    type="button"
                    onClick={handleSaveAsProject}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] text-white font-semibold text-xs border border-white/15 flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Save Project</span>
                  </button>
                </div>

                {savedNotice && (
                  <StatusBanner
                    tone="success"
                    icon={<Check className="w-4 h-4 text-emerald-400" />}
                    action={
                      onOpenProjects && (
                        <button
                          type="button"
                          onClick={onOpenProjects}
                          className="text-xs text-emerald-300 hover:text-white underline font-semibold cursor-pointer"
                        >
                          Open Projects
                        </button>
                      )
                    }
                  >
                    {savedNotice}
                  </StatusBanner>
                )}
              </>
            )}

            {outputTrayTab === 'comparison' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="studio-card rounded-xl p-4 space-y-2">
                  <div className="font-mono text-[11px] text-zinc-400 uppercase tracking-wider">
                    Source Perspective
                  </div>
                  {sourceAnalysis ? (
                    <div className="space-y-1.5 text-zinc-200 font-mono">
                      <div>
                        Azimuth: {sourceAnalysis.inferredCamera.azimuthDeg.value ?? 'Unknown'}° (
                        {sourceAnalysis.inferredCamera.azimuthDeg.confidence})
                      </div>
                      <div>
                        Elevation: {sourceAnalysis.inferredCamera.elevationDeg.value ?? 'Unknown'}° (
                        {sourceAnalysis.inferredCamera.elevationDeg.confidence})
                      </div>
                      <div>
                        Focal: {sourceAnalysis.inferredCamera.focalLengthMm.value ?? 'Unknown'}mm
                      </div>
                      <div>Shot Size: {sourceAnalysis.inferredCamera.shotSize}</div>
                      <div>Placement: {sourceAnalysis.inferredCamera.subjectPlacement}</div>
                    </div>
                  ) : (
                    <p className="text-zinc-400 leading-relaxed">
                      Camera-First Mode — no source image uploaded. External model will apply this target perspective directly to whatever reference image you supply.
                    </p>
                  )}
                </div>

                <div className="studio-card-active rounded-xl p-4 space-y-2">
                  <div className="font-mono text-[11px] text-cyan-300 uppercase tracking-wider">
                    {lockedFrame ? 'Locked Target Perspective' : 'Live Preview Perspective'}
                  </div>
                  {(() => {
                    const targetCam = lockedFrame?.cameraState ?? liveCameraState;
                    if (!targetCam) {
                      return (
                        <p className="text-zinc-400">
                          Initializing 3D camera telemetry...
                        </p>
                      );
                    }
                    return (
                      <div className="space-y-1.5 text-zinc-100 font-mono tabular-nums">
                        <div>
                          Azimuth: {targetCam.azimuthDeg}° ({targetCam.azimuthLabel})
                        </div>
                        <div>
                          Elevation: {targetCam.elevationDeg}° ({targetCam.elevationLabel})
                        </div>
                        <div>
                          Distance / Lens: {targetCam.distanceMeters}m ·{' '}
                          {targetCam.focalLengthMm}mm ({targetCam.fovDeg}° FOV)
                        </div>
                        <div>Shot Size: {targetCam.shotSize}</div>
                        <div>
                          Aspect Ratio: {targetCam.aspectRatio} · Roll {targetCam.rollDeg}°
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {outputTrayTab === 'analysis' && (
              <div className="studio-card rounded-xl p-4 space-y-2 text-xs">
                {sourceAnalysis ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-zinc-300">
                    <div>
                      <span className="text-zinc-500 block">Subject</span>
                      <span>{sourceAnalysis.observable.subjectDescription}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Pose &amp; Orientation</span>
                      <span>{sourceAnalysis.observable.poseAndOrientation}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Head &amp; Gaze</span>
                      <span>{sourceAnalysis.observable.headAndGaze}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Clothing &amp; Accessories</span>
                      <span>{sourceAnalysis.observable.clothingAndAccessories}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Environment</span>
                      <span>{sourceAnalysis.observable.environmentAndBackground}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Lighting &amp; Shadows</span>
                      <span>{sourceAnalysis.observable.lightingAndShadows}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-zinc-400">
                    Upload and analyze an optional primary source image in the Image tab to inspect grounded scene observations.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Camera Presets Bottom Sheet (Mobile & Desktop quick picker) */}
      <BottomSheet
        isOpen={isPresetSheetOpen}
        onClose={() => setIsPresetSheetOpen(false)}
        title="Camera Angle Presets"
        subtitle="Smoothly glide camera to a starting angle — fine-tune freely afterwards"
        icon={<Compass className="w-4 h-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {CAMERA_PRESETS.map((preset) => {
            const active = selectedPresetLabel === preset.label;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setSelectedPresetLabel(preset.label);
                  viewportRef.current?.animateToPreset(preset);
                  setIsPresetSheetOpen(false);
                }}
                className={`p-3.5 rounded-xl text-left border transition cursor-pointer ${
                  active
                    ? 'studio-card-active'
                    : 'bg-[#0b101b] border-white/[0.08] hover:border-cyan-400/45'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-white">{preset.label}</span>
                  <span className="font-mono text-[11px] text-cyan-300 tabular-nums">
                    Az {preset.azimuthDeg}° · El {preset.elevationDeg}°
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{preset.description}</p>
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Coordinate Convention Bottom Sheet */}
      <BottomSheet
        isOpen={showDocsModal}
        onClose={() => setShowDocsModal(false)}
        title="3D Camera Coordinate Conventions"
        subtitle="Anchored subject coordinate definitions used for Three.js & prompt export"
        icon={<Info className="w-4 h-4" />}
      >
        <div className="space-y-2.5 text-xs text-zinc-300">
          {Object.entries(COORDINATE_SYSTEM_DOCS).map(([k, desc]) => (
            <div key={k} className="p-3 rounded-xl bg-[#0b101b] border border-white/[0.08]">
              <div className="font-mono font-bold text-cyan-300 mb-1">{k}</div>
              <div className="text-zinc-300 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
};
