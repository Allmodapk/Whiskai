import React, { useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  FileText,
  Image as ImageIcon,
  Info,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
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

interface PerspectivePlayboardProps {
  optimizeImageFile: (file: File, label?: string) => Promise<ImageDataItem>;
  onOpenProjects?: () => void;
}

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

  // Camera framing & locking state
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>(
    DEFAULT_CAMERA_CONFIG.aspectRatio
  );
  const [liveCameraState, setLiveCameraState] = useState<CameraStateSnapshot | null>(null);
  const [lockedFrame, setLockedFrame] = useState<LockedCameraFrame | null>(null);

  // Optional primary image upload & AI analysis state
  const [primaryImage, setPrimaryImage] = useState<ImageDataItem | null>(null);
  const [sourceAnalysis, setSourceAnalysis] = useState<SourceImageAnalysis | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);

  // Preservation, validation & prompt design state
  const [preservation, setPreservation] = useState<PreservationPreferences>(DEFAULT_PRESERVATION);
  const [targetModel, setTargetModel] = useState<TargetModelType>('universal');
  const [compiledPrompt, setCompiledPrompt] = useState<CompiledPerspectivePrompt | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // UI toggles
  const [showDocsDrawer, setShowDocsDrawer] = useState(false);
  const [showAdvancedFraming, setShowAdvancedFraming] = useState(false);

  const isLocked = Boolean(lockedFrame?.isLocked);

  // Lock or Unlock camera frame
  const handleToggleLock = () => {
    if (isLocked) {
      // Unlocking clears finalized target frame so previous locked state is not treated as current
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

  // Drive camera sliders directly into the live Three.js camera
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

  // Upload primary image (optional)
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

  // Analyze uploaded image via existing project endpoint
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
        extractApiErrorMessage(err, 'Visual analysis could not be completed. You can retry or continue in Camera-First mode.')
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

  // Update uncertain inferred camera estimates manually
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

  // Evaluate consistency against currently locked (or live) camera state
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

  // Generate prompt strictly from LockedCameraFrame
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
      return;
    }

    const result = compilePerspectivePrompt({
      lockedFrame: targetLock,
      sourceAnalysis,
      preservation,
      targetModel,
    });
    setCompiledPrompt(result);
  };

  // Re-export cleanly when user switches target model after generating
  const displayedPromptText = useMemo(() => {
    if (!compiledPrompt || !lockedFrame) return '';
    return compilePerspectivePrompt({
      lockedFrame,
      sourceAnalysis,
      preservation,
      targetModel,
    }).exportedText;
  }, [compiledPrompt, lockedFrame, sourceAnalysis, preservation, targetModel]);

  const handleCopyPrompt = () => {
    if (!displayedPromptText) return;
    navigator.clipboard.writeText(displayedPromptText);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2200);
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
    <div className="space-y-6">
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

      {/* Tool Header */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#f5c518]/15 border border-[#f5c518]/35 flex items-center justify-center text-[#f5c518]">
              <Compass className="w-4 h-4" />
            </div>
            <h2 className="font-display text-base sm:text-lg font-bold text-white">
              3D Camera Perspective Playboard
            </h2>
          </div>
          <p className="text-xs text-zinc-400 max-w-3xl">
            Orbit the virtual camera around the stationary 3D reference subject, lock your target frame, optionally inspect a source image, and compile a structured image-to-image prompt for external AI tools.
          </p>
        </div>

        {/* Clean unboxed workflow step indicators */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 shrink-0">
          <span className="text-white font-medium">1. Frame Camera</span>
          <span aria-hidden="true">·</span>
          <span className={isLocked ? 'text-emerald-400 font-semibold' : 'text-zinc-300'}>
            2. {isLocked ? 'Frame Locked' : 'Lock Frame'}
          </span>
          <span aria-hidden="true">·</span>
          <span className={sourceAnalysis ? 'text-[#f5c518] font-medium' : 'text-zinc-400'}>
            3. {sourceAnalysis ? 'Image Analyzed' : 'Optional Image'}
          </span>
          <span aria-hidden="true">·</span>
          <span className={compiledPrompt ? 'text-emerald-400 font-semibold' : 'text-zinc-300'}>
            4. Compile Prompt
          </span>
        </div>
      </div>

      {/* Main Split: 3D Viewport (Primary Visual Focus) + Camera Controller */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left / Top: Large 3D Viewport + Aspect Ratio & Presets */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-3">
          <PlayboardViewport
            ref={viewportRef}
            aspectRatio={aspectRatio}
            isLocked={isLocked}
            onToggleLock={handleToggleLock}
            onCameraStateChange={(snap) => setLiveCameraState(snap)}
          />

          {/* Aspect Ratio + Quick Camera Presets */}
          <div className="glass-panel rounded-2xl p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-zinc-300">Viewport Aspect Ratio</span>
              <div className="flex flex-wrap items-center gap-1">
                {ASPECT_OPTIONS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    disabled={isLocked}
                    onClick={() => setAspectRatio(ratio)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition cursor-pointer disabled:opacity-45 ${
                      aspectRatio === ratio
                        ? 'bg-[#f5c518] text-black font-bold'
                        : 'bg-white/[0.05] text-zinc-300 hover:bg-white/[0.1] hover:text-white'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-white/[0.08] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-300">
                  Camera Angle Presets
                </span>
                <span className="text-[11px] text-zinc-500">
                  Smoothly glides camera while keeping free orbit unlocked
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CAMERA_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isLocked}
                    onClick={() => viewportRef.current?.animateToPreset(preset)}
                    title={preset.description}
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-xs text-zinc-200 hover:text-white transition disabled:opacity-40 cursor-pointer whitespace-nowrap"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right / Bottom: Intuitive Camera Controls & Exact Extracted State */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-4">
          <div className="glass-panel rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="font-display text-sm font-bold text-white">Camera Controls</h3>
                <p className="text-[11px] text-zinc-400">
                  Adjusts the virtual camera around the fixed subject
                </p>
              </div>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => viewportRef.current?.resetToDefault()}
                className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-zinc-200 flex items-center gap-1 disabled:opacity-40 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Default</span>
              </button>
            </div>

            {isLocked && (
              <div className="p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/35 text-xs text-emerald-200 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Target frame locked for prompt generation.</span>
                </span>
                <button
                  type="button"
                  onClick={handleToggleLock}
                  className="text-emerald-300 hover:text-white underline font-semibold shrink-0 cursor-pointer"
                >
                  Unlock
                </button>
              </div>
            )}

            {currentValues && (
              <div className="space-y-3.5">
                {/* Horizontal Orbit */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-200 font-medium">Horizontal Angle (Orbit)</span>
                    <span className="font-mono text-[#f5c518] tabular-nums">
                      {currentValues.azimuthDeg > 0 ? `+${currentValues.azimuthDeg}` : currentValues.azimuthDeg}° · {currentValues.azimuthLabel}
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
                    className="w-full accent-[#f5c518] cursor-pointer disabled:opacity-45"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                    <span>Back -180°</span>
                    <span>Left -90°</span>
                    <span>Front 0°</span>
                    <span>Right +90°</span>
                    <span>Back +180°</span>
                  </div>
                </div>

                {/* Vertical Elevation */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-200 font-medium">Camera Height / Angle</span>
                    <span className="font-mono text-[#f5c518] tabular-nums">
                      {currentValues.elevationDeg > 0 ? `+${currentValues.elevationDeg}` : currentValues.elevationDeg}°
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
                    className="w-full accent-[#f5c518] cursor-pointer disabled:opacity-45"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>Low Angle</span>
                    <span>Eye Level (0°)</span>
                    <span>High</span>
                    <span>Overhead</span>
                  </div>
                </div>

                {/* Distance / Zoom */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-200 font-medium">Camera Distance</span>
                    <span className="font-mono text-zinc-200 tabular-nums">
                      {currentValues.distanceMeters}m · {currentValues.shotSize}
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
                    className="w-full accent-[#f5c518] cursor-pointer disabled:opacity-45"
                  />
                </div>

                {/* Lens / Focal Length */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-200 font-medium">Lens Perspective</span>
                    <span className="font-mono text-zinc-200 tabular-nums">
                      {currentValues.focalLengthMm}mm ({currentValues.fovDeg}° FOV)
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
                    className="w-full accent-[#f5c518] cursor-pointer disabled:opacity-45"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>16mm Wide</span>
                    <span>35mm</span>
                    <span>50mm Natural</span>
                    <span>85mm+ Telephoto</span>
                  </div>
                </div>

                {/* Expandable Framing Target & Roll */}
                <button
                  type="button"
                  onClick={() => setShowAdvancedFraming((v) => !v)}
                  className="w-full py-1.5 px-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] text-xs font-medium text-zinc-300 flex items-center justify-between cursor-pointer"
                >
                  <span>Framing Target Offset & Roll Tilt</span>
                  {showAdvancedFraming ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {showAdvancedFraming && (
                  <div className="space-y-3 pt-1 border-t border-white/[0.06]">
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
                        className="w-full accent-[#f5c518] cursor-pointer disabled:opacity-45"
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
                        className="w-full accent-[#f5c518] cursor-pointer disabled:opacity-45"
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
                        className="w-full accent-[#f5c518] cursor-pointer disabled:opacity-45"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Primary Lock CTA inside panel as well */}
            <button
              type="button"
              onClick={handleToggleLock}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                isLocked
                  ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30'
                  : 'bg-[#f5c518] hover:bg-[#ffe169] text-black'
              }`}
            >
              {isLocked ? (
                <>
                  <Unlock className="w-4 h-4" />
                  <span>Unlock Frame to Reposition Camera</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Lock Target Frame</span>
                </>
              )}
            </button>
          </div>

          {/* Live / Locked Extracted Camera Parameters Summary */}
          {currentValues && (
            <div className="glass-panel rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-display text-xs font-bold text-white">
                  {isLocked ? 'Locked Camera Parameters' : 'Live Camera Parameters'}
                </h4>
                <button
                  type="button"
                  onClick={() => setShowDocsDrawer((v) => !v)}
                  className="text-[11px] text-[#f5c518] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Info className="w-3 h-3" />
                  <span>{showDocsDrawer ? 'Hide Coord Docs' : 'Coordinate Docs'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-mono tabular-nums">
                <div className="text-zinc-400">Azimuth / Orbit</div>
                <div className="text-white text-right">{currentValues.azimuthDeg}°</div>

                <div className="text-zinc-400">Elevation / Pitch</div>
                <div className="text-white text-right">
                  {currentValues.elevationDeg}° / {currentValues.pitchDeg}°
                </div>

                <div className="text-zinc-400">Distance</div>
                <div className="text-white text-right">{currentValues.distanceMeters} m</div>

                <div className="text-zinc-400">Camera World XYZ</div>
                <div className="text-white text-right">
                  ({currentValues.worldPosition.x}, {currentValues.worldPosition.y}, {currentValues.worldPosition.z})
                </div>

                <div className="text-zinc-400">Target Look-At XYZ</div>
                <div className="text-white text-right">
                  ({currentValues.targetPosition.x}, {currentValues.targetPosition.y}, {currentValues.targetPosition.z})
                </div>

                <div className="text-zinc-400">Lens / vFOV / Roll</div>
                <div className="text-white text-right">
                  {currentValues.focalLengthMm}mm · {currentValues.fovDeg}° · {currentValues.rollDeg}°
                </div>

                <div className="text-zinc-400">Shot Size</div>
                <div className="text-[#f5c518] text-right font-semibold">
                  {currentValues.shotSize}
                </div>

                <div className="text-zinc-400">Subject Placement</div>
                <div className="text-white text-right">
                  {currentValues.subjectBounds.heightPct}% H · {currentValues.subjectBounds.placementLabel}
                </div>

                <div className="text-zinc-400">Viewport / Projection</div>
                <div className="text-white text-right">
                  {currentValues.aspectRatio} ({currentValues.viewportDimensions.width}×{currentValues.viewportDimensions.height}) · {currentValues.projectionType}
                </div>
              </div>

              {showDocsDrawer && (
                <div className="pt-2.5 mt-2 border-t border-white/[0.08] space-y-1.5 max-h-48 overflow-y-auto pr-1 text-[11px] text-zinc-400">
                  {Object.entries(COORDINATE_SYSTEM_DOCS).map(([k, desc]) => (
                    <div key={k}>
                      <span className="font-mono text-zinc-200">{k}:</span> {desc}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2: Optional Primary Image Upload & AI Analysis */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div>
            <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-[#f5c518]" />
              <span>Optional Source Image & AI Perspective Analysis</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {sourceAnalysis
                ? 'Image-Aware Mode active: the prompt engine compares your uploaded photo’s estimated camera perspective with the locked 3D target.'
                : 'Optional: upload your primary photo to estimate its starting perspective, or skip this step to generate a reusable Camera-First prompt.'}
            </p>
          </div>

          <div className="text-xs font-medium text-zinc-300 shrink-0">
            Active Mode:{' '}
            <span className={sourceAnalysis ? 'text-[#f5c518] font-bold' : 'text-sky-300 font-bold'}>
              {sourceAnalysis ? 'Image-Aware Comparison' : 'Camera-First (No Source Image)'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Upload Slot */}
          <div className="lg:col-span-4 space-y-3">
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
                className={`rounded-xl border-2 border-dashed p-6 text-center transition cursor-pointer ${
                  isDraggingImage
                    ? 'border-[#f5c518] bg-[#f5c518]/10'
                    : 'border-white/15 hover:border-[#f5c518]/50 bg-black/25'
                }`}
              >
                <Upload className="w-6 h-6 text-[#f5c518] mx-auto mb-2" />
                <div className="text-xs font-bold text-white">
                  Upload Optional Primary Image
                </div>
                <div className="text-[11px] text-zinc-400 mt-1">
                  JPEG, PNG, WebP · Analyzed strictly for camera understanding (not edited)
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/35 p-3 space-y-3">
                <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-black">
                  <img
                    src={primaryImage.previewUrl}
                    alt={primaryImage.name || 'Primary source image'}
                    className="w-full h-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={handleClearPrimaryImage}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/80 text-white hover:bg-red-500 flex items-center justify-center cursor-pointer"
                    title="Remove source image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isAnalyzingImage}
                    onClick={handleAnalyzePrimaryImage}
                    className="flex-1 py-2 px-3 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
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
                    className="py-2 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-xs font-semibold cursor-pointer"
                  >
                    Replace
                  </button>
                </div>
              </div>
            )}

            {analysisError && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-200">
                {analysisError}
              </div>
            )}
          </div>

          {/* Extracted Source Results: Observable vs Inferred + Editable Correction */}
          <div className="lg:col-span-8">
            {!sourceAnalysis ? (
              <div className="rounded-xl border border-white/[0.08] bg-black/25 p-5 text-xs text-zinc-400 space-y-2">
                <div className="font-semibold text-zinc-200">
                  Camera-First Mode Ready (No Source Image Required)
                </div>
                <p>
                  When no primary image is uploaded, the Prompt Design Engine does not invent original camera numbers. Instead, it writes an instruction telling your external image AI to inspect your attached image first and relocate the camera cleanly to your locked Playboard perspective.
                </p>
                {primaryImage && (
                  <p className="text-[#f5c518]">
                    Image uploaded — click &quot;Analyze Source Image&quot; on the left to inspect its observable properties and estimated starting camera perspective.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {sourceAnalysis.isFallbackEstimate && (
                  <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200">
                    {sourceAnalysis.warningMessage ||
                      'Live AI quota reached; values below are low-confidence local placeholders. Please review and correct them to match your photo.'}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Observable Facts */}
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3.5 space-y-2 text-xs">
                    <div className="font-bold text-white">Directly Observable in Photo</div>
                    <div className="space-y-1.5 text-zinc-300">
                      <div>
                        <span className="text-zinc-400">Subject:</span> {sourceAnalysis.observable.subjectDescription}
                      </div>
                      <div>
                        <span className="text-zinc-400">Pose:</span> {sourceAnalysis.observable.poseAndOrientation}
                      </div>
                      <div>
                        <span className="text-zinc-400">Gaze:</span> {sourceAnalysis.observable.headAndGaze}
                      </div>
                      <div>
                        <span className="text-zinc-400">Clothing:</span> {sourceAnalysis.observable.clothingAndAccessories}
                      </div>
                      <div>
                        <span className="text-zinc-400">Setting:</span> {sourceAnalysis.observable.environmentAndBackground}
                      </div>
                      <div>
                        <span className="text-zinc-400">Lighting:</span> {sourceAnalysis.observable.lightingAndShadows}
                      </div>
                    </div>
                  </div>

                  {/* Inferred Camera Estimates (Editable + Honest Confidence) */}
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3.5 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white">
                        Inferred Camera Estimates (Review / Edit)
                      </span>
                      <span className="text-[11px] text-zinc-400">Single 2D photo estimates</span>
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
                          className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-[#f5c518]"
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
                          className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-[#f5c518]"
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
                          className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono outline-none focus:border-[#f5c518]"
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
                          className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#f5c518]"
                        />
                      </label>
                    </div>

                    <label className="space-y-1 block">
                      <span className="text-[11px] text-zinc-400 block">Subject Placement</span>
                      <input
                        type="text"
                        value={sourceAnalysis.inferredCamera.subjectPlacement}
                        onChange={(e) => updateInferredField('placement', e.target.value)}
                        className="w-full bg-black/50 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#f5c518]"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: Preservation Settings, Consistency Check & Prompt Design Engine */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div>
            <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#f5c518]" />
              <span>Prompt Design Engine</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Compiles your locked 3D camera configuration into a structured 9-section image-to-image prompt.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={targetModel}
              onChange={(e) => setTargetModel(e.target.value as TargetModelType)}
              className="bg-black/60 text-white border border-white/15 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-[#f5c518]"
            >
              <option value="universal" className="bg-[#0e111a]">Universal / Standard</option>
              <option value="gemini" className="bg-[#0e111a]">Google Gemini</option>
              <option value="chatgpt" className="bg-[#0e111a]">ChatGPT / DALL-E</option>
              <option value="flux" className="bg-[#0e111a]">Flux</option>
            </select>

            <button
              type="button"
              disabled={!isLocked || validationResult.hasErrors}
              onClick={() => handleGeneratePrompt(false)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#ffe169] via-[#f5c518] to-[#d49a00] hover:brightness-105 text-black font-black text-xs uppercase tracking-wider shadow-md disabled:opacity-45 cursor-pointer flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Generate Structured Prompt</span>
            </button>
          </div>
        </div>

        {/* Preservation & Consistency Checkboxes */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 space-y-2.5">
            <div className="text-xs font-semibold text-zinc-200">
              Elements to Preserve from Primary Image
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
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
                  className="flex items-center gap-2 p-2 rounded-lg bg-black/30 border border-white/[0.06] cursor-pointer hover:border-white/15"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(preservation[key])}
                    onChange={(e) =>
                      setPreservation((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    className="accent-[#f5c518]"
                  />
                  <span className="text-zinc-200">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-2.5">
            <div className="text-xs font-semibold text-zinc-200">
              Strict Constraints & Custom Notes
            </div>
            <div className="space-y-1.5 text-xs">
              {(
                [
                  ['requirePixelIdenticalComposition', 'Require pixel-identical composition'],
                  ['requireFullBodyVisibleInOutput', 'Require full-body framing in output'],
                  ['requireFrontDetailsDirectlyVisible', 'Require all front details directly visible'],
                ] as Array<[keyof PreservationPreferences, string]>
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 p-2 rounded-lg bg-black/30 border border-white/[0.06] cursor-pointer hover:border-white/15"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(preservation[key])}
                    onChange={(e) =>
                      setPreservation((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    className="accent-[#f5c518]"
                  />
                  <span className="text-zinc-300">{label}</span>
                </label>
              ))}

              <textarea
                rows={2}
                value={preservation.additionalUserNotes}
                onChange={(e) =>
                  setPreservation((prev) => ({ ...prev, additionalUserNotes: e.target.value }))
                }
                placeholder="Optional custom note (e.g., maintain warm window rim light on hair)..."
                className="w-full mt-1 bg-black/45 border border-white/10 focus:border-[#f5c518] rounded-xl p-2.5 text-xs text-white outline-none resize-none"
              />
            </div>
          </div>
        </div>

        {/* Contradiction / Consistency Alert Box */}
        {validationResult.issues.length > 0 && (
          <div className="space-y-2.5">
            {validationResult.issues.map((issue) => (
              <div
                key={issue.id}
                className={`p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  issue.severity === 'error'
                    ? 'bg-red-950/45 border-red-500/45 text-red-100'
                    : 'bg-amber-950/40 border-amber-500/40 text-amber-100'
                }`}
              >
                <div className="space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>{issue.title}</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed">{issue.explanation}</p>
                  <p className="text-zinc-400">
                    Resolution: {issue.suggestedResolution}
                  </p>
                </div>

                {issue.resolutionActionId && (
                  <button
                    type="button"
                    onClick={() => handleResolveContradiction(issue.resolutionActionId)}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-xs shrink-0 cursor-pointer"
                  >
                    {issue.resolutionActionId === 'unlock_to_adjust'
                      ? 'Unlock Camera'
                      : 'Remove Conflicting Constraint'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Lock Requirement Banner if user hasn't locked yet */}
        {!isLocked && (
          <div className="p-3.5 rounded-xl bg-black/35 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <span className="text-zinc-300">
              Lock your target camera frame to freeze the exact camera configuration before generating the final prompt.
            </span>
            <button
              type="button"
              disabled={validationResult.hasErrors}
              onClick={() => handleGeneratePrompt(true)}
              className="px-3.5 py-2 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs shrink-0 flex items-center gap-1.5 disabled:opacity-45 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock Frame & Generate Prompt</span>
            </button>
          </div>
        )}

        {/* Final Compiled 9-Section Prompt Viewer */}
        {compiledPrompt && isLocked && (
          <div className="space-y-3 pt-2 border-t border-white/[0.08]">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-emerald-300">
                Prompt compiled from locked frame ({compiledPrompt.mode === 'image_aware' ? 'Image-Aware Mode' : 'Camera-First Mode'})
              </span>
              <span className="font-mono text-zinc-400">
                Target: Az {lockedFrame?.cameraState.azimuthDeg}° · El {lockedFrame?.cameraState.elevationDeg}° · {lockedFrame?.cameraState.distanceMeters}m · {lockedFrame?.cameraState.focalLengthMm}mm · {lockedFrame?.cameraState.aspectRatio}
              </span>
            </div>

            <textarea
              readOnly
              rows={18}
              value={displayedPromptText}
              className="w-full glass-panel text-white p-4 rounded-2xl text-xs font-mono leading-relaxed outline-none select-text selection:bg-[#f5c518] selection:text-black resize-y min-h-[300px]"
            />

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder="Project title..."
                  className="bg-black/45 border border-white/15 focus:border-[#f5c518] rounded-xl px-3 py-2 text-xs text-white outline-none flex-1 sm:w-52"
                />
                <button
                  type="button"
                  onClick={handleSaveAsProject}
                  className="px-3.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white font-bold text-xs border border-white/15 flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <BookmarkPlus className="w-3.5 h-3.5 text-[#f5c518]" />
                  <span>Save Project</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleCopyPrompt}
                className="w-full sm:w-auto min-w-[200px] py-2.5 px-5 rounded-xl bg-gradient-to-r from-[#ffe169] via-[#f5c518] to-[#d49a00] hover:brightness-105 text-black font-black text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 cursor-pointer"
              >
                {copySuccess ? (
                  <>
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>Copied Prompt</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 stroke-[2.5]" />
                    <span>Copy Prompt for External AI</span>
                  </>
                )}
              </button>
            </div>

            {savedNotice && (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>{savedNotice}</span>
                </span>
                {onOpenProjects && (
                  <button
                    type="button"
                    onClick={onOpenProjects}
                    className="text-emerald-300 hover:text-white underline font-semibold cursor-pointer"
                  >
                    Open Projects
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
