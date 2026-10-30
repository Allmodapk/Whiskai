import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ImageDataItem,
  CameraComponentKey,
  ALL_CAMERA_COMPONENT_KEYS,
  CAMERA_COMPONENT_LABELS,
  CameraExtractedComponent,
  CameraReferenceAnalysisState,
  GazeBehaviorType,
  TargetModelType,
  ComponentState,
  SavedComponentItem,
} from '../types';
import { StorageService } from '../services/storage';
import { postApiJson, extractApiErrorMessage } from '../services/apiClient';
import {
  buildCameraReferenceTransformationPrompt,
  getDefaultGazeDirectiveText,
  exportPromptForModel,
  checkPromptSafety,
} from '../services/promptBuilder';
import { PromptCheckBanner } from './PromptCheckBanner';
import { ReferenceViewfinder } from './ReferenceViewfinder';
import { FloatingPromptDock } from './FloatingPromptDock';
import {
  Camera,
  Upload,
  Sparkles,
  RotateCcw,
  Copy,
  Download,
  Check,
  BookmarkPlus,
  Lock,
  Edit3,
  Ban,
  ChevronDown,
  ChevronUp,
  Eye,
  FolderOpen,
  Bookmark,
  Trash2,
  Loader2,
  Sliders,
  Info,
} from 'lucide-react';

interface CameraAngleControllerProps {
  referenceImage: ImageDataItem | null;
  onSelectReferenceFile: (file: File) => void;
  onClearReferenceImage: () => void;
  onTriggerFileDialog: () => void;
  cameraState: CameraReferenceAnalysisState | null;
  onUpdateCameraState: React.Dispatch<React.SetStateAction<CameraReferenceAnalysisState | null>>;
  generatedPrompt: string | null;
  onSetGeneratedPrompt: (prompt: string | null) => void;
  hasUnbuiltChanges: boolean;
  onSetHasUnbuiltChanges: (val: boolean) => void;
  targetModel: TargetModelType;
  onSetTargetModel: (model: TargetModelType) => void;
  projectTitleInput: string;
  onSetProjectTitleInput: (title: string) => void;
  onSaveProject: (currentPrompt: string) => void;
  savedBlueprintNotice: string | null;
}

const CAMERA_EXTRACTION_STAGES = [
  'Loading camera reference image',
  'A. Analyzing aspect ratio, orientation & crop geometry',
  'B. Analyzing horizontal camera position vs. subject orientation',
  'C & D. Analyzing camera height & vertical viewing angle',
  'E & F. Analyzing optical roll, lens perspective & foreshortening',
  'G & H. Analyzing subject-to-frame scale, shot size & spatial arrangement',
  'I, J & K. Analyzing capture style, depth of field & rendering characteristics',
];

const QUICK_HELPERS: Record<CameraComponentKey, string[]> = {
  aspect_ratio_orientation: [
    'Portrait orientation (3:4 aspect ratio) with vertical framing.',
    'Portrait orientation (4:5 aspect ratio) with balanced vertical crop.',
    'Vertical full-screen orientation (9:16 aspect ratio).',
    'Square orientation (1:1 aspect ratio) with symmetrical framing.',
    'Landscape orientation (16:9 widescreen aspect ratio).',
    'Landscape orientation (3:2 aspect ratio) with horizontal framing.',
  ],
  horizontal_camera_position: [
    'Front-facing camera position directly ahead of the subject along the central axis.',
    'Front-left three-quarter camera position (approx. 30–45 degrees to camera-left of the subject).',
    'Front-right three-quarter camera position (approx. 30–45 degrees to camera-right of the subject).',
    'True side-profile camera position (90 degrees lateral to the subject).',
    'Rear three-quarter over-the-shoulder camera position behind and slightly to the side of the subject.',
    'Direct rear camera position positioned directly behind the subject.',
  ],
  camera_height: [
    'Ground-level camera height positioned near the floor plane.',
    'Low-angle camera height positioned near knee-to-waist level.',
    'Waist-to-chest level camera height.',
    'Eye-level camera height aligned horizontally with the subject’s eyes.',
    'Elevated camera height positioned noticeably above the subject’s head level.',
    'High overhead bird’s-eye camera height positioned directly above the scene.',
  ],
  vertical_viewing_angle: [
    'Horizontal level viewing angle (optical axis parallel to the ground plane).',
    'Subtle upward-looking vertical viewing angle tilting gently toward the subject.',
    'Pronounced upward-looking vertical tilt creating converging vertical lines.',
    'Subtle downward-looking vertical viewing angle tilting gently toward the subject.',
    'Steep downward-looking vertical viewing angle looking down at the subject and floor plane.',
    'Directly overhead 90-degree top-down vertical viewing angle.',
  ],
  camera_roll: [
    'Level camera roll with horizontal and vertical scene lines aligned cleanly to the frame edges.',
    'Subtle clockwise Dutch angle roll (~5–10 degrees) tilting the horizon line.',
    'Subtle counter-clockwise Dutch angle roll (~5–10 degrees) tilting the horizon line.',
    'Dynamic diagonal Dutch tilt (~15–25 degrees) rotating the optical axis.',
  ],
  lens_and_perspective: [
    'Natural normal-lens perspective (~50mm equivalent) with realistic proportions and undistorted spatial depth.',
    'Moderate wide-angle perspective (~24–35mm equivalent) with expanded foreground-to-background spatial separation and slight perspective exaggeration on nearer elements.',
    'Ultra-wide perspective with pronounced near-to-far scale contrast and expansive spatial depth.',
    'Short-telephoto portrait perspective (~85mm equivalent) with flattering facial proportions and subtle background compression.',
    'Telephoto perspective (~135mm+ equivalent) with strong spatial compression bringing background elements visually closer to the subject.',
  ],
  subject_to_frame_scale: [
    'Subject occupies approximately 70–80% of the frame height with tight headroom and balanced lateral margins.',
    'Subject occupies approximately 50–65% of the frame with comfortable breathing room above the head and on both sides.',
    'Subject fills 85–95% of the frame in a tight, intimate crop with minimal margins.',
    'Subject occupies approximately 25–40% of the frame within an environmental composition with generous surrounding space.',
  ],
  framing_and_spatial_arrangement: [
    'Medium close-up (chest-up) framing centered on the vertical axis; lower frame edge cuts off cleanly across the mid-chest.',
    'Waist-up medium shot with the subject centered, clear foreground plane, and softly separated background layer.',
    'Three-quarter shot cutting off cleanly just above or below the knees, with balanced negative space on left and right margins.',
    'Full-body shot showing the entire subject from head to feet with visible floor plane and clear headroom.',
    'Close-up portrait framing the head, neck, and upper shoulders with the subject placed along the upper rule-of-thirds line.',
  ],
  capture_style: [
    'Editorial portrait photography with intentional framing, controlled optical perspective, and refined visual polish.',
    'Casual smartphone photography with natural handheld immediacy and authentic everyday framing.',
    'Candid snapshot aesthetic with spontaneous unposed framing and natural ambient character.',
    'Controlled studio photography with clean geometric alignment and deliberate compositional precision.',
    'Documentary lifestyle photography with grounded environmental context and observational realism.',
  ],
  focus_and_depth_of_field: [
    'Critical focus locked sharply on the subject’s eyes and face, with a shallow depth of field producing smooth, gradual background blur (bokeh).',
    'Moderate depth of field keeping the entire subject sharp from front to back while softly blurring the distant background.',
    'Deep depth of field maintaining crisp optical sharpness across foreground, subject, and background planes.',
    'Ultra-shallow depth of field with razor-thin focal plane on the foreground feature and rapid focus falloff.',
  ],
  image_rendering_characteristics: [
    'Crisp optical micro-contrast, clean highlight roll-off, natural shadow detail, and fine organic sensor/film texture without artificial smoothing.',
    'Clean high-resolution digital rendering with tack-sharp edges, balanced dynamic range, and zero motion blur.',
    'Subtle analog film grain texture with soft highlight bloom, rich midtone contrast, and organic tonal transitions.',
    'Slight candid motion softness with natural ambient shadow falloff and unretouched photographic realism.',
  ],
};

const GAZE_OPTIONS: {
  id: GazeBehaviorType;
  title: string;
  subtitle: string;
}[] = [
  {
    id: 'look_at_camera',
    title: 'Look Directly at Camera',
    subtitle:
      'Subject adjusts their eyes/gaze to make direct eye contact with the camera lens from its new position.',
  },
  {
    id: 'keep_original_gaze',
    title: 'Keep Original Gaze Direction',
    subtitle:
      'Subject keeps looking at the same point in the scene as in the original image (gaze stays scene-locked as camera moves).',
  },
  {
    id: 'match_reference_gaze',
    title: 'Match Camera Reference Gaze',
    subtitle:
      'Reproduces the eye-to-camera gaze relationship observed in the uploaded Camera Reference Image.',
  },
  {
    id: 'look_away',
    title: 'Look Away / Off-Camera',
    subtitle:
      'Subject directs their gaze naturally away from the camera lens for a candid, unposed look.',
  },
  {
    id: 'none',
    title: 'Automatic / No Gaze Override',
    subtitle:
      'Lets the camera geometry and pose determine visibility naturally (ideal for rear views or scenes without a person).',
  },
  {
    id: 'custom',
    title: 'Custom Gaze Instruction',
    subtitle: 'Write a custom eye direction and head-to-camera gaze instruction below.',
  },
];

export const CameraAngleController: React.FC<CameraAngleControllerProps> = ({
  referenceImage,
  onSelectReferenceFile,
  onClearReferenceImage,
  onTriggerFileDialog,
  cameraState,
  onUpdateCameraState,
  generatedPrompt,
  onSetGeneratedPrompt,
  hasUnbuiltChanges,
  onSetHasUnbuiltChanges,
  targetModel,
  onSetTargetModel,
  projectTitleInput,
  onSetProjectTitleInput,
  onSaveProject,
  savedBlueprintNotice,
}) => {
  const [isExtracting, setIsExtracting] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isDraggingRef, setIsDraggingRef] = useState(false);

  // Track which of the 11 component cards are expanded or in edit mode
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({
    aspect_ratio_orientation: true,
    horizontal_camera_position: true,
    camera_height: true,
    vertical_viewing_angle: true,
    framing_and_spatial_arrangement: true,
  });
  const [editingKey, setEditingKey] = useState<CameraComponentKey | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');
  const [libraryOpenKey, setLibraryOpenKey] = useState<CameraComponentKey | null>(null);
  const [savingLibraryKey, setSavingLibraryKey] = useState<CameraComponentKey | null>(null);
  const [saveLibraryTitle, setSaveLibraryTitle] = useState<string>('');
  const [cameraFilter, setCameraFilter] = useState<'all' | 'locked' | 'edited' | 'ignored'>('all');
  const [openCameraGroups, setOpenCameraGroups] = useState<Record<string, boolean>>({
    geometry_angles: true,
    optics_scale: true,
    capture_rendering: true,
  });

  const CAMERA_ACCORDION_GROUPS: Array<{
    id: string;
    title: string;
    subtitle: string;
    codes: string;
    keys: CameraComponentKey[];
  }> = [
    {
      id: 'geometry_angles',
      title: 'Frame & Camera Geometry',
      subtitle: 'Orientation, horizontal position, camera elevation, vertical viewing tilt & roll',
      codes: 'A – E',
      keys: [
        'aspect_ratio_orientation',
        'horizontal_camera_position',
        'camera_height',
        'vertical_viewing_angle',
        'camera_roll',
      ],
    },
    {
      id: 'optics_scale',
      title: 'Lens Perspective & Spatial Scale',
      subtitle: 'Optical focal perspective, subject-to-frame scale, margins & crop arrangement',
      codes: 'F – H',
      keys: [
        'lens_and_perspective',
        'subject_to_frame_scale',
        'framing_and_spatial_arrangement',
      ],
    },
    {
      id: 'capture_rendering',
      title: 'Capture Style, Focus & Rendering',
      subtitle: 'Photographic style classification, depth-of-field falloff & sensor/grain texture',
      codes: 'I – K',
      keys: [
        'capture_style',
        'focus_and_depth_of_field',
        'image_rendering_characteristics',
      ],
    },
  ];

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  // Extract 11 Camera Reference Components (A through K) from the uploaded Camera Reference Image
  const handleExtractCameraReference = async () => {
    if (!referenceImage) {
      setExtractError('Please upload a Camera Reference Image first.');
      return;
    }

    triggerHaptic();
    setIsExtracting(true);
    setExtractError(null);
    setStageIndex(0);

    const timer = setInterval(() => {
      setStageIndex((prev) => (prev < CAMERA_EXTRACTION_STAGES.length - 1 ? prev + 1 : prev));
    }, 600);

    try {
      const customKey = StorageService.getCustomApiKey();
      const data = await postApiJson<any>(
        '/api/analyze-camera-reference',
        {
          image: {
            data: referenceImage.data,
            mimeType: referenceImage.mimeType,
          },
        },
        { customKey, timeoutMs: 110000, maxRetries: 2 }
      );

      clearInterval(timer);
      setStageIndex(CAMERA_EXTRACTION_STAGES.length - 1);

      const analysis = data.cameraAnalysis || {};
      const rawComps = analysis.components || {};

      const originalSnap: Record<CameraComponentKey, CameraExtractedComponent> = {} as any;
      const workingComps: Record<CameraComponentKey, CameraExtractedComponent> = {} as any;

      for (const key of ALL_CAMERA_COMPONENT_KEYS) {
        const meta = CAMERA_COMPONENT_LABELS[key];
        const item = rawComps[key];
        const detectedText = (item?.detectedText || '').trim();
        const visibility: 'visible' | 'partial' | 'unavailable' =
          item?.visibility === 'unavailable' || !detectedText
            ? 'unavailable'
            : item?.visibility === 'partial'
            ? 'partial'
            : 'visible';

        const compObj: CameraExtractedComponent = {
          key,
          code: meta.code,
          label: meta.label,
          detectedText,
          userText: '',
          state: visibility === 'unavailable' ? 'unavailable' : 'locked',
          explanation: item?.explanation || meta.description,
          visibility,
        };

        originalSnap[key] = { ...compObj };
        workingComps[key] = { ...compObj };
      }

      const detectedRatio = analysis.outputRatio || '3:4';
      const detectedOrientation = analysis.orientation || 'Portrait';
      const detectedGaze =
        analysis.detectedReferenceGaze ||
        'Subject gaze relationship follows the extracted camera position.';
      const defaultGazeBehavior: GazeBehaviorType = 'look_at_camera';

      const newState: CameraReferenceAnalysisState = {
        summary:
          analysis.summary ||
          'Extracted 11 camera viewpoint, perspective, framing, and photographic rendering components from the Camera Reference Image.',
        outputRatio: detectedRatio,
        orientation: detectedOrientation,
        subjectPresentInReference: Boolean(analysis.subjectPresentInReference ?? true),
        detectedReferenceGaze: detectedGaze,
        originalComponents: originalSnap,
        components: workingComps,
        gazeBehavior: defaultGazeBehavior,
        customGazeText: getDefaultGazeDirectiveText(defaultGazeBehavior, detectedGaze),
        preserveSubjectIdentity: true,
        preserveOriginalClothing: true,
        preserveOriginalScene: true,
        preserveOriginalPoseStructure: true,
        additionalTransformationNotes: '',
      };

      onUpdateCameraState(newState);
      onSetGeneratedPrompt(null);
      onSetHasUnbuiltChanges(false);

      if (!projectTitleInput.trim() && referenceImage.name) {
        onSetProjectTitleInput(
          `Camera Setup (${referenceImage.name.replace(/\.[^.]+$/, '')})`
        );
      }
      triggerHaptic();
    } catch (err: any) {
      clearInterval(timer);
      setExtractError(
        extractApiErrorMessage(err, 'Failed to analyze camera reference image.')
      );
    } finally {
      setIsExtracting(false);
    }
  };

  // Update a single camera component's state
  const handleComponentStateChange = (key: CameraComponentKey, newState: ComponentState) => {
    triggerHaptic();
    onUpdateCameraState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        components: {
          ...prev.components,
          [key]: {
            ...prev.components[key],
            state: newState,
          },
        },
      };
    });
    if (generatedPrompt) onSetHasUnbuiltChanges(true);
  };

  // Update a single camera component's text
  const handleComponentTextChange = (key: CameraComponentKey, newText: string) => {
    triggerHaptic();
    onUpdateCameraState((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        components: {
          ...prev.components,
          [key]: {
            ...prev.components[key],
            userText: newText,
            state: 'edited',
          },
        },
      };
    });
    if (generatedPrompt) onSetHasUnbuiltChanges(true);
  };

  // Restore a single camera component to its original extracted state
  const handleRestoreComponent = (key: CameraComponentKey) => {
    triggerHaptic();
    onUpdateCameraState((prev) => {
      if (!prev) return null;
      const orig = prev.originalComponents[key];
      if (!orig) return prev;
      return {
        ...prev,
        components: {
          ...prev.components,
          [key]: { ...orig },
        },
      };
    });
    if (editingKey === key) {
      setEditingKey(null);
    }
    if (generatedPrompt) onSetHasUnbuiltChanges(true);
  };

  // Restore all 11 components to original extracted descriptions
  const handleRestoreAllComponents = () => {
    if (!cameraState) return;
    triggerHaptic();
    onUpdateCameraState((prev) => {
      if (!prev) return null;
      const restored: Record<CameraComponentKey, CameraExtractedComponent> = {} as any;
      for (const k of ALL_CAMERA_COMPONENT_KEYS) {
        restored[k] = { ...prev.originalComponents[k] };
      }
      return {
        ...prev,
        components: restored,
      };
    });
    setEditingKey(null);
    if (generatedPrompt) onSetHasUnbuiltChanges(true);
  };

  // Select Gaze Behavior
  const handleSelectGazeBehavior = (behavior: GazeBehaviorType) => {
    triggerHaptic();
    onUpdateCameraState((prev) => {
      if (!prev) return null;
      const defaultTxt =
        behavior === 'custom'
          ? prev.customGazeText
          : getDefaultGazeDirectiveText(behavior, prev.detectedReferenceGaze);
      return {
        ...prev,
        gazeBehavior: behavior,
        customGazeText: defaultTxt,
      };
    });
    if (generatedPrompt) onSetHasUnbuiltChanges(true);
  };

  // Generate Final Prompt
  const handleGeneratePrompt = () => {
    if (!cameraState) return;
    triggerHaptic();
    const built = buildCameraReferenceTransformationPrompt(cameraState);
    onSetGeneratedPrompt(built);
    onSetHasUnbuiltChanges(false);
  };

  const exportedPrompt =
    generatedPrompt && cameraState
      ? exportPromptForModel(generatedPrompt, targetModel, cameraState.outputRatio)
      : '';

  const promptSafety = generatedPrompt ? checkPromptSafety(generatedPrompt) : null;

  const handleCopyPrompt = () => {
    if (!exportedPrompt) return;
    triggerHaptic();
    navigator.clipboard.writeText(exportedPrompt);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const handleDownloadPrompt = () => {
    if (!exportedPrompt || !cameraState) return;
    triggerHaptic();
    const blob = new Blob([exportedPrompt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my_whisk_camera_transform_${cameraState.outputRatio.replace(':', 'x')}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Determine workflow step completion
  const hasUploaded = Boolean(referenceImage);
  const hasExtracted = Boolean(cameraState);
  const hasGenerated = Boolean(generatedPrompt);

  // Count active/edited/ignored components
  const counts = cameraState
    ? ALL_CAMERA_COMPONENT_KEYS.reduce(
        (acc, k) => {
          const c = cameraState.components[k];
          if (!c || c.state === 'unavailable') acc.unavailable++;
          else if (c.state === 'ignored') acc.ignored++;
          else if (c.state === 'edited') acc.edited++;
          else acc.locked++;
          return acc;
        },
        { locked: 0, edited: 0, ignored: 0, unavailable: 0 }
      )
    : { locked: 0, edited: 0, ignored: 0, unavailable: 0 };

  return (
    <div className="space-y-6">
      {/* WORKFLOW STEPPER & ROLE DISTINCTION BANNER */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-[#f5c518] shrink-0" />
              <h2 className="font-display text-sm sm:text-base font-bold text-white tracking-tight">
                Camera Angle Controller · Image-to-Image Camera Transformation
              </h2>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Extracts 11 camera and photographic characteristics (A–K) from a{' '}
              <span className="text-white font-semibold">Camera Reference Image</span> and converts
              them into a reusable transformation prompt for your external image-to-image AI tool.
            </p>
          </div>

          <div className="text-xs font-mono text-zinc-400 flex items-center gap-2 shrink-0">
            <span>Prompts Only</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#f5c518] font-semibold">11 Camera Components (A–K)</span>
          </div>
        </div>

        {/* 6-Step Exact Workflow Progress Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          {[
            { step: '1', label: 'Upload Camera Reference', done: hasUploaded, active: !hasUploaded },
            {
              step: '2',
              label: 'Extract (A–K)',
              done: hasExtracted,
              active: hasUploaded && !hasExtracted,
            },
            {
              step: '3',
              label: 'Review & Customize',
              done: hasExtracted,
              active: hasExtracted && !hasGenerated,
            },
            {
              step: '4',
              label: 'Select Gaze Behavior',
              done: hasExtracted,
              active: hasExtracted && !hasGenerated,
            },
            {
              step: '5',
              label: 'Generate Final Prompt',
              done: hasGenerated && !hasUnbuiltChanges,
              active: hasExtracted && (!hasGenerated || hasUnbuiltChanges),
            },
            {
              step: '6',
              label: 'Copy Prompt',
              done: copyFeedback,
              active: hasGenerated,
            },
          ].map((item) => (
            <div
              key={item.step}
              className={`px-3 py-2 rounded-xl border flex items-center gap-2 transition ${
                item.active
                  ? 'glass-card-active text-white font-bold'
                  : item.done
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-semibold'
                  : 'bg-black/35 border-white/[0.06] text-zinc-500'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-mono font-bold shrink-0 ${
                  item.active
                    ? 'bg-[#f5c518] text-black'
                    : item.done
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/[0.06] text-zinc-500'
                }`}
              >
                {item.done && !item.active ? '✓' : item.step}
              </span>
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Crucial Distinction Callout: Camera Reference Image vs. Original Image */}
        <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.08] flex items-start gap-3 text-xs text-zinc-300">
          <Info className="w-4 h-4 text-[#f5c518] shrink-0 mt-0.5" />
          <div className="space-y-0.5 leading-relaxed">
            <span className="font-bold text-white">How this workflow operates:</span> The image you
            upload below is the <span className="text-[#f5c518] font-semibold">CAMERA REFERENCE IMAGE</span>{' '}
            (providing the camera angle, framing, lens perspective, and rendering style to reproduce).
            Your <span className="text-white font-semibold">ORIGINAL IMAGE</span> (the photo whose
            subject and scene you want to transform) is supplied separately alongside the final prompt
            in your external image-to-image AI tool.
          </div>
        </div>
      </div>

      {/* STEP 1 & STEP 2: UPLOAD CAMERA REFERENCE IMAGE & EXTRACT */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-white">
            Step 1 & 2 · Upload Camera Reference Image (1 Image) & Extract Camera Characteristics
          </label>
          {referenceImage && (
            <button
              type="button"
              onClick={onClearReferenceImage}
              className="text-xs text-zinc-400 hover:text-white transition"
            >
              Remove camera reference
            </button>
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingRef(true);
          }}
          onDragLeave={() => setIsDraggingRef(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingRef(false);
            const file = e.dataTransfer.files?.[0];
            if (file && file.type.startsWith('image/')) {
              onSelectReferenceFile(file);
            }
          }}
          onClick={() => !referenceImage && onTriggerFileDialog()}
          className={`relative rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-all ${
            isDraggingRef
              ? 'border-[#f5c518] bg-[#f5c518]/5 scale-[0.99]'
              : !referenceImage
              ? 'border-[#2e3444] bg-[#11131a] hover:border-zinc-400 hover:bg-[#141720] cursor-pointer'
              : 'border-[#262a36] bg-[#0e1017]'
          }`}
        >
          {!referenceImage ? (
            <div className="flex flex-col items-center gap-2.5 text-zinc-400">
              <div className="w-12 h-12 rounded-2xl bg-[#161922] border border-[#262a36] flex items-center justify-center text-[#f5c518]">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-white text-sm">
                  Upload or drop one Camera Reference Image
                </span>
                <span className="text-zinc-400 text-xs block mt-0.5">
                  Provides the camera viewpoint, framing, lens perspective & capture style to extract •
                  Or paste with Ctrl + V
                </span>
              </div>
              <div className="mt-1">
                <span className="text-xs font-semibold text-[#f5c518] underline">
                  Browse Camera Reference Image
                </span>
              </div>
            </div>
          ) : (
            <div
              className="flex flex-col sm:flex-row items-center gap-5 text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-full sm:w-56 shrink-0">
                <ReferenceViewfinder
                  imageUrl={referenceImage.previewUrl}
                  imageName={referenceImage.name || 'Camera Reference Image'}
                  aspectRatioLabel={cameraState?.outputRatio || 'Ref'}
                  orientationLabel={cameraState?.orientation}
                  toolBadgeLabel="Camera Reference Source"
                  isScanning={isExtracting}
                  compact
                />
              </div>

              <div className="flex-1 space-y-3">
                <div>
                  <div className="text-xs font-mono font-semibold text-[#f5c518] tracking-wide">
                    Camera Reference Image · Optical Source
                  </div>
                  <div className="font-display text-sm sm:text-base font-bold text-white truncate mt-0.5">
                    {referenceImage.name || 'Uploaded Camera Reference'}
                  </div>
                  <div className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Ready to extract Components A–K (Aspect Ratio, Horizontal Position, Camera Height,
                    Vertical Viewing Angle, Roll, Lens & Perspective, Scale, Framing, Capture Style,
                    Focus & Depth of Field, and Rendering Characteristics). Click the preview to open the fullscreen optical lightbox or toggle the 3×3 viewfinder grid.
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleExtractCameraReference}
                    disabled={isExtracting}
                    className="min-h-[42px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ffe169] via-[#f5c518] to-[#d49a00] hover:brightness-105 text-black font-black text-xs uppercase tracking-wider shadow-md transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <Camera className="w-4 h-4 stroke-[2.5]" />
                    <span>
                      {cameraState
                        ? 'Re-Extract Camera Characteristics (A–K)'
                        : 'Extract Camera Characteristics (A–K)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onTriggerFileDialog}
                    disabled={isExtracting}
                    className="min-h-[42px] px-4 py-2.5 rounded-xl bg-[#161922] hover:bg-[#1f232d] text-zinc-300 text-xs font-semibold border border-[#262a36] transition"
                  >
                    Replace Camera Reference
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* EXTRACTION PROGRESS PANEL */}
      {isExtracting && (
        <div className="w-full max-w-xl mx-auto rounded-2xl bg-[#11131a] border border-[#262a36] p-6 shadow-2xl animate-in fade-in duration-200">
          <div className="flex items-center gap-3 mb-4 border-b border-[#1f232d] pb-3">
            <div className="w-9 h-9 rounded-xl bg-[#f5c518]/15 border border-[#f5c518]/30 flex items-center justify-center text-[#f5c518]">
              <Camera className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                Extracting Camera & Photographic Characteristics
              </h3>
              <p className="text-xs text-zinc-400">
                Performing grounded multimodal vision examination of Components A through K...
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            {CAMERA_EXTRACTION_STAGES.map((stage, idx) => {
              const isDone = idx < stageIndex;
              const isCurrent = idx === stageIndex;
              return (
                <div
                  key={stage}
                  className={`flex items-center gap-3 text-xs ${
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
                  <span>{stage}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* EXTRACTION ERROR */}
      {extractError && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="font-bold text-red-300">Camera Extraction Notice</div>
            <div className="text-zinc-300 mt-0.5">{extractError}</div>
          </div>
          <button
            type="button"
            onClick={handleExtractCameraReference}
            className="px-3.5 py-2 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs shrink-0 flex items-center gap-1.5 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry Extraction</span>
          </button>
        </div>
      )}

      {/* STEP 3, 4, 5, 6: REVIEW & CUSTOMIZE (A-K) -> SELECT GAZE BEHAVIOR -> GENERATE -> COPY */}
      {cameraState && !isExtracting && (
        <div className="space-y-6 pt-4 border-t border-[#1f232d] animate-in fade-in duration-300">
          {/* Top Bar: Summary + Restore All + Save Project */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#11131a] border border-[#262a36] p-4 sm:p-5 rounded-2xl">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-white text-sm">
                  Step 3 · Review & Customize Extracted Camera Characteristics (A–K)
                </span>
                <span className="text-zinc-600" aria-hidden="true">
                  ·
                </span>
                <span className="text-zinc-400 tabular-nums">
                  {counts.locked} Extracted · {counts.edited} Customized · {counts.ignored} Ignored
                </span>
              </div>
              {cameraState.summary && (
                <p className="text-xs text-zinc-400 leading-relaxed">{cameraState.summary}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleRestoreAllComponents}
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#161922] hover:bg-[#1f232d] text-zinc-300 text-xs font-semibold border border-[#262a36] transition flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore All Extracted</span>
              </button>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={projectTitleInput}
                  onChange={(e) => onSetProjectTitleInput(e.target.value)}
                  placeholder="Camera project title..."
                  className="bg-[#161922] border border-[#262a36] focus:border-[#f5c518] rounded-xl px-3 py-1.5 text-xs text-white outline-none w-36 sm:w-44"
                />
                <button
                  type="button"
                  onClick={() => {
                    const current =
                      generatedPrompt || buildCameraReferenceTransformationPrompt(cameraState);
                    onSaveProject(current);
                  }}
                  className="min-h-[36px] flex items-center gap-1.5 px-3.5 py-1.5 bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs rounded-xl transition"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Save Project</span>
                </button>
              </div>
            </div>
          </div>

          {savedBlueprintNotice && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>{savedBlueprintNotice}</span>
            </div>
          )}

          {/* TWO-COLUMN DESKTOP LAYOUT: LEFT REFERENCE PREVIEW & PRESERVATION + RIGHT 11 CAMERA COMPONENTS */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
            {/* Left Column (4 cols on desktop) */}
            <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
              {referenceImage && (
                <ReferenceViewfinder
                  imageUrl={referenceImage.previewUrl}
                  imageName={referenceImage.name || 'Camera Reference Image'}
                  aspectRatioLabel={cameraState.outputRatio}
                  orientationLabel={cameraState.orientation}
                  toolBadgeLabel="Camera Reference Optical Source"
                  isScanning={isExtracting}
                />
              )}

              {/* Quick Aspect Ratio & Orientation Selector */}
              <div className="glass-panel p-4 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-display text-xs font-bold text-white">
                    Target Aspect Ratio & Orientation
                  </label>
                  <span className="text-xs font-mono font-semibold text-[#f5c518] tabular-nums">
                    {cameraState.outputRatio} ({cameraState.orientation})
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(['Portrait', 'Landscape', 'Square'] as const).map((orient) => (
                    <button
                      key={orient}
                      type="button"
                      onClick={() => {
                        triggerHaptic();
                        onUpdateCameraState((prev) =>
                          prev ? { ...prev, orientation: orient } : null
                        );
                        if (generatedPrompt) onSetHasUnbuiltChanges(true);
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        cameraState.orientation.toLowerCase() === orient.toLowerCase()
                          ? 'bg-[#f5c518] text-black font-bold'
                          : 'bg-white/[0.05] text-zinc-400 hover:text-white border border-white/10'
                      }`}
                    >
                      {orient}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'].map(
                    (ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => {
                          triggerHaptic();
                          const [w, h] = ratio.split(':').map(Number);
                          const inferredOrientation =
                            w === h ? 'Square' : w > h ? 'Landscape' : 'Portrait';
                          onUpdateCameraState((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  outputRatio: ratio,
                                  orientation: inferredOrientation,
                                }
                              : null
                          );
                          if (generatedPrompt) onSetHasUnbuiltChanges(true);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold tabular-nums transition cursor-pointer ${
                          cameraState.outputRatio === ratio
                            ? 'bg-[#f5c518] text-black font-bold'
                            : 'bg-white/[0.05] text-zinc-400 hover:text-white border border-white/10'
                        }`}
                      >
                        {ratio}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Original Image Preservation Controls */}
              <div className="glass-panel p-4 rounded-2xl space-y-3">
                <div>
                  <h4 className="font-display text-xs font-bold text-white">
                    Original Input Image Preservation
                  </h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Instructs the external image-to-image model what to keep locked from the
                    original image you supply alongside the prompt.
                  </p>
                </div>

                <div className="space-y-2 text-xs text-zinc-300">
                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cameraState.preserveSubjectIdentity}
                      onChange={(e) => {
                        onUpdateCameraState((prev) =>
                          prev
                            ? { ...prev, preserveSubjectIdentity: e.target.checked }
                            : null
                        );
                        if (generatedPrompt) onSetHasUnbuiltChanges(true);
                      }}
                      className="accent-[#f5c518] mt-0.5"
                    />
                    <span>Preserve original subject identity, face, hair & body proportions</span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cameraState.preserveOriginalClothing}
                      onChange={(e) => {
                        onUpdateCameraState((prev) =>
                          prev
                            ? { ...prev, preserveOriginalClothing: e.target.checked }
                            : null
                        );
                        if (generatedPrompt) onSetHasUnbuiltChanges(true);
                      }}
                      className="accent-[#f5c518] mt-0.5"
                    />
                    <span>Preserve original clothing, fabrics, colors & accessories</span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cameraState.preserveOriginalPoseStructure}
                      onChange={(e) => {
                        onUpdateCameraState((prev) =>
                          prev
                            ? { ...prev, preserveOriginalPoseStructure: e.target.checked }
                            : null
                        );
                        if (generatedPrompt) onSetHasUnbuiltChanges(true);
                      }}
                      className="accent-[#f5c518] mt-0.5"
                    />
                    <span>
                      Preserve original pose configuration (projected from new camera angle)
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cameraState.preserveOriginalScene}
                      onChange={(e) => {
                        onUpdateCameraState((prev) =>
                          prev
                            ? { ...prev, preserveOriginalScene: e.target.checked }
                            : null
                        );
                        if (generatedPrompt) onSetHasUnbuiltChanges(true);
                      }}
                      className="accent-[#f5c518] mt-0.5"
                    />
                    <span>Preserve original environment, background & lighting continuity</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Right Column: 3 Collapsible Accordion Groups for Components A through K */}
            <div className="lg:col-span-8 space-y-4">
              {/* Filter & Accordion Group Toolbar */}
              <div className="glass-panel rounded-2xl p-3.5 sm:px-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/[0.07]">
                  {(
                    [
                      { id: 'all', label: `All (${ALL_CAMERA_COMPONENT_KEYS.length})` },
                      { id: 'locked', label: `Extracted (${counts.locked})` },
                      { id: 'edited', label: `Customized (${counts.edited})` },
                      { id: 'ignored', label: `Excluded (${counts.ignored})` },
                    ] as const
                  ).map((tab) => {
                    const active = cameraFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic();
                          setCameraFilter(tab.id);
                        }}
                        className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                          active ? 'text-black font-bold' : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {active && (
                          <motion.div
                            layoutId="cameraFilterPill"
                            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                            className="absolute inset-0 rounded-lg bg-[#f5c518]"
                          />
                        )}
                        <span className="relative z-10 font-mono tabular-nums">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenCameraGroups({
                        geometry_angles: true,
                        optics_scale: true,
                        capture_rendering: true,
                      });
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-300 font-semibold transition cursor-pointer whitespace-nowrap"
                  >
                    Expand Groups
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenCameraGroups({
                        geometry_angles: false,
                        optics_scale: false,
                        capture_rendering: false,
                      });
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-300 font-semibold transition cursor-pointer whitespace-nowrap"
                  >
                    Collapse Groups
                  </button>
                </div>
              </div>

              {CAMERA_ACCORDION_GROUPS.map((group) => {
                const filteredKeys = group.keys.filter((k) => {
                  const c = cameraState.components[k];
                  if (!c) return false;
                  if (cameraFilter === 'all') return true;
                  if (cameraFilter === 'locked') return c.state === 'locked';
                  if (cameraFilter === 'edited') return c.state === 'edited';
                  if (cameraFilter === 'ignored')
                    return c.state === 'ignored' || c.state === 'unavailable';
                  return true;
                });

                if (filteredKeys.length === 0) return null;

                const isGroupOpen = openCameraGroups[group.id] !== false;
                const activeInGroup = group.keys.filter((k) => {
                  const st = cameraState.components[k]?.state;
                  return st === 'locked' || st === 'edited';
                }).length;
                const editedInGroup = group.keys.filter(
                  (k) => cameraState.components[k]?.state === 'edited'
                ).length;

                return (
                  <div
                    key={group.id}
                    className="glass-panel rounded-2xl overflow-hidden transition-all"
                  >
                    {/* Accordion Group Header */}
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic();
                        setOpenCameraGroups((prev) => ({
                          ...prev,
                          [group.id]: !isGroupOpen,
                        }));
                      }}
                      className="w-full px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition cursor-pointer select-none"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-[#f5c518]/15 border border-[#f5c518]/30 text-[11px] font-mono font-bold text-[#f5c518] tabular-nums">
                            {group.codes}
                          </span>
                          <span className="font-display font-bold text-sm sm:text-base text-white">
                            {group.title}
                          </span>
                          <span className="text-zinc-600">·</span>
                          <span className="text-xs font-mono text-zinc-400 tabular-nums">
                            {activeInGroup}/{group.keys.length} Active
                            {editedInGroup > 0 ? ` · ${editedInGroup} Customized` : ''}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5 truncate">{group.subtitle}</p>
                      </div>

                      <div className="w-8 h-8 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-zinc-300 shrink-0">
                        {isGroupOpen ? (
                          <ChevronUp className="w-4 h-4 text-[#f5c518]" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </button>

                    {/* Accordion Group Body */}
                    <AnimatePresence initial={false}>
                      {isGroupOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden border-t border-white/[0.07]"
                        >
                          <div className="p-3.5 sm:p-4 space-y-3">
                            {filteredKeys.map((key) => {
                              const comp = cameraState.components[key];
                              if (!comp) return null;
                              const meta = CAMERA_COMPONENT_LABELS[key];
                              const isExpanded = Boolean(expandedKeys[key]);
                              const isEditing = editingKey === key;
                              const activeText =
                                comp.state === 'edited'
                                  ? comp.userText
                                  : comp.userText || comp.detectedText;
                              const isIgnored =
                                comp.state === 'ignored' || comp.state === 'unavailable';
                              const savedLibraryItems: SavedComponentItem[] =
                                StorageService.getComponentLibrary(key);
                              const quickOptions = QUICK_HELPERS[key] || [];

                              return (
                                <motion.div
                                  layout
                                  initial={{ opacity: 0, y: 8 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ duration: 0.16 }}
                                  key={key}
                                  className={`rounded-2xl transition-all duration-150 overflow-hidden ${
                                    isIgnored
                                      ? 'bg-black/35 border border-white/[0.04] opacity-65'
                                      : comp.state === 'edited'
                                      ? 'glass-card border-sky-400/40 shadow-[0_8px_28px_-12px_rgba(56,189,248,0.2)]'
                                      : 'glass-card hover:border-white/20'
                                  }`}
                                >
                                  {/* Card Header */}
                                  <div
                                    onClick={() =>
                                      setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }))
                                    }
                                    className="p-3.5 sm:px-4 flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className="font-display text-xs sm:text-sm font-bold text-white">
                                          <span className="font-mono text-[#f5c518]">
                                            {meta.code}.
                                          </span>{' '}
                                          {meta.label}
                                        </span>
                                        <span className="text-zinc-600" aria-hidden="true">
                                          ·
                                        </span>
                                        <span
                                          className={`text-[11px] font-medium ${
                                            isIgnored
                                              ? 'text-red-400/90'
                                              : comp.state === 'edited'
                                              ? 'text-sky-400'
                                              : 'text-emerald-400/90'
                                          }`}
                                        >
                                          {isIgnored
                                            ? 'Ignored · Excluded from Prompt'
                                            : comp.state === 'edited'
                                            ? 'Customized by User · Included'
                                            : 'Extracted from Camera Reference · Included'}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-zinc-500 truncate max-w-xl mt-0.5">
                                        {comp.explanation || meta.description}
                                      </p>
                                    </div>

                                    {/* Action Buttons */}
                                    <div
                                      className="flex items-center gap-1 shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        title="Quick presets & saved library items"
                                        onClick={() => {
                                          setLibraryOpenKey(libraryOpenKey === key ? null : key);
                                          setExpandedKeys((prev) => ({ ...prev, [key]: true }));
                                        }}
                                        className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                                          libraryOpenKey === key
                                            ? 'bg-[#f5c518]/15 text-[#f5c518] border border-[#f5c518]/40'
                                            : 'bg-[#181b24] text-zinc-300 hover:text-white border border-[#262a36]'
                                        }`}
                                      >
                                        <Sliders className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">Presets</span>
                                      </button>

                                      <button
                                        type="button"
                                        title="Include this camera component"
                                        onClick={() => handleComponentStateChange(key, 'locked')}
                                        className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                                          comp.state === 'locked'
                                            ? 'bg-[#f5c518] text-black font-bold'
                                            : 'bg-[#181b24] text-zinc-400 hover:text-white border border-[#262a36]'
                                        }`}
                                      >
                                        <Lock className="w-3 h-3" />
                                        <span className="hidden md:inline">Keep</span>
                                      </button>

                                      <button
                                        type="button"
                                        title="Edit component description"
                                        onClick={() => {
                                          setEditingKey(key);
                                          setEditDraft(activeText);
                                          setExpandedKeys((prev) => ({ ...prev, [key]: true }));
                                        }}
                                        className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                                          comp.state === 'edited' || isEditing
                                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                            : 'bg-[#181b24] text-zinc-400 hover:text-white border border-[#262a36]'
                                        }`}
                                      >
                                        <Edit3 className="w-3 h-3" />
                                        <span className="hidden md:inline">Edit</span>
                                      </button>

                                      <button
                                        type="button"
                                        title="Ignore / Exclude this component from final prompt"
                                        onClick={() =>
                                          handleComponentStateChange(
                                            key,
                                            comp.state === 'ignored' ? 'locked' : 'ignored'
                                          )
                                        }
                                        className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                                          comp.state === 'ignored'
                                            ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                                            : 'bg-[#181b24] text-zinc-400 hover:text-zinc-200 border border-[#262a36]'
                                        }`}
                                      >
                                        <Ban className="w-3 h-3" />
                                        <span className="hidden md:inline">Ignore</span>
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedKeys((prev) => ({
                                            ...prev,
                                            [key]: !prev[key],
                                          }))
                                        }
                                        className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white"
                                      >
                                        {isExpanded ? (
                                          <ChevronUp className="w-4 h-4" />
                                        ) : (
                                          <ChevronDown className="w-4 h-4" />
                                        )}
                                      </button>
                                    </div>
                                  </div>

                                  {/* Collapsed Preview */}
                                  {!isExpanded && (
                                    <div
                                      onClick={() =>
                                        setExpandedKeys((prev) => ({ ...prev, [key]: true }))
                                      }
                                      className="px-4 pb-3 pt-0 text-xs text-zinc-400 line-clamp-2 cursor-pointer leading-relaxed"
                                    >
                                      {activeText || (
                                        <span className="italic text-zinc-500">
                                          Empty or excluded — click Edit or Presets to specify.
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Expanded Content */}
                                  {isExpanded && (
                                    <div className="px-4 pb-4 pt-2 border-t border-white/[0.06] space-y-3">
                                      {/* Quick Helpers & Saved Library Drawer */}
                                      {libraryOpenKey === key && (
                                        <div className="p-3 rounded-xl bg-[#161922] border border-[#2c3244] space-y-3">
                                          <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold text-white">
                                              Photographic Terminology Presets for {meta.code}.{' '}
                                              {meta.label}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() => setLibraryOpenKey(null)}
                                              className="text-xs text-zinc-400 hover:text-white"
                                            >
                                              Close
                                            </button>
                                          </div>

                                          <div className="grid grid-cols-1 gap-1.5">
                                            {quickOptions.map((opt, i) => (
                                              <button
                                                key={i}
                                                type="button"
                                                onClick={() => {
                                                  handleComponentTextChange(key, opt);
                                                  setEditDraft(opt);
                                                  setLibraryOpenKey(null);
                                                }}
                                                className="text-left p-2 rounded-lg bg-[#11131a] hover:bg-[#1c202c] border border-[#262a36] hover:border-[#f5c518]/50 text-xs text-zinc-200 transition"
                                              >
                                                {opt}
                                              </button>
                                            ))}
                                          </div>

                                          {savedLibraryItems.length > 0 && (
                                            <div className="pt-2 border-t border-[#262a36] space-y-1.5">
                                              <span className="text-[11px] font-bold text-[#f5c518]">
                                                Your Saved {meta.label} Presets
                                              </span>
                                              {savedLibraryItems.map((saved) => (
                                                <div
                                                  key={saved.id}
                                                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#11131a] border border-[#262a36]"
                                                >
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      handleComponentTextChange(
                                                        key,
                                                        saved.description
                                                      );
                                                      setEditDraft(saved.description);
                                                      setLibraryOpenKey(null);
                                                    }}
                                                    className="text-left flex-1 min-w-0"
                                                  >
                                                    <div className="text-xs font-bold text-white truncate">
                                                      {saved.name}
                                                    </div>
                                                    <div className="text-[11px] text-zinc-400 line-clamp-1">
                                                      {saved.description}
                                                    </div>
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      StorageService.deleteComponentItem(saved.id);
                                                      onUpdateCameraState((s) =>
                                                        s ? { ...s } : null
                                                      );
                                                    }}
                                                    className="p-1.5 text-zinc-500 hover:text-red-400"
                                                  >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Edit Mode vs View Mode */}
                                      {isEditing ? (
                                        <div className="space-y-2.5">
                                          <textarea
                                            rows={3}
                                            value={editDraft}
                                            onChange={(e) => setEditDraft(e.target.value)}
                                            className="w-full bg-[#161922] border border-[#f5c518] rounded-xl p-3 text-xs text-white outline-none leading-relaxed"
                                            placeholder={`Customize ${meta.label}...`}
                                          />
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  handleComponentTextChange(key, editDraft);
                                                  setEditingKey(null);
                                                }}
                                                className="px-3.5 py-1.5 rounded-lg bg-[#f5c518] text-black font-bold text-xs flex items-center gap-1.5"
                                              >
                                                <Check className="w-3.5 h-3.5" />
                                                <span>Apply Changes</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setEditingKey(null)}
                                                className="px-3 py-1.5 rounded-lg bg-[#181b24] text-zinc-300 text-xs font-semibold border border-[#262a36]"
                                              >
                                                Cancel
                                              </button>
                                            </div>

                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditDraft('');
                                                  handleComponentTextChange(key, '');
                                                  setEditingKey(null);
                                                }}
                                                className="px-2.5 py-1.5 rounded-lg bg-red-950/40 text-red-300 border border-red-500/30 text-xs font-semibold"
                                              >
                                                Clear Field
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleRestoreComponent(key)}
                                                className="px-2.5 py-1.5 rounded-lg bg-[#181b24] text-zinc-300 hover:text-white border border-[#262a36] text-xs font-semibold flex items-center gap-1"
                                              >
                                                <RotateCcw className="w-3 h-3" />
                                                <span>Restore Extracted</span>
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="space-y-2.5">
                                          <div
                                            onClick={() => {
                                              setEditingKey(key);
                                              setEditDraft(activeText);
                                            }}
                                            className="p-3 rounded-xl bg-black/40 border border-white/[0.07] hover:border-white/20 text-xs text-zinc-200 leading-relaxed cursor-text"
                                          >
                                            {activeText || (
                                              <span className="italic text-zinc-500">
                                                Field cleared — click here to enter a custom camera
                                                description or click Restore Extracted.
                                              </span>
                                            )}
                                          </div>

                                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                            <div className="flex items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditingKey(key);
                                                  setEditDraft(activeText);
                                                }}
                                                className="text-sky-400 hover:underline font-semibold flex items-center gap-1"
                                              >
                                                <Edit3 className="w-3 h-3" />
                                                <span>Customize Text</span>
                                              </button>
                                              {(comp.state === 'edited' ||
                                                comp.state === 'ignored') && (
                                                <>
                                                  <span className="text-zinc-600">·</span>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleRestoreComponent(key)}
                                                    className="text-zinc-400 hover:text-white flex items-center gap-1"
                                                  >
                                                    <RotateCcw className="w-3 h-3" />
                                                    <span>Restore Extracted</span>
                                                  </button>
                                                </>
                                              )}
                                            </div>

                                            {/* Save to Reusable Library */}
                                            {activeText.trim() && (
                                              <div>
                                                {savingLibraryKey === key ? (
                                                  <div className="flex items-center gap-1.5">
                                                    <input
                                                      type="text"
                                                      value={saveLibraryTitle}
                                                      onChange={(e) =>
                                                        setSaveLibraryTitle(e.target.value)
                                                      }
                                                      placeholder="Preset name..."
                                                      className="bg-[#161922] border border-[#f5c518] rounded-lg px-2 py-1 text-xs text-white outline-none w-36"
                                                    />
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        if (!saveLibraryTitle.trim()) return;
                                                        StorageService.saveComponentItem({
                                                          id: `cam_${key}_${Date.now()}`,
                                                          componentKey: key,
                                                          name: saveLibraryTitle.trim(),
                                                          description: activeText.trim(),
                                                          createdAt: Date.now(),
                                                          updatedAt: Date.now(),
                                                        });
                                                        setSaveLibraryTitle('');
                                                        setSavingLibraryKey(null);
                                                      }}
                                                      className="px-2.5 py-1 rounded-lg bg-[#f5c518] text-black font-bold text-xs"
                                                    >
                                                      Save
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => setSavingLibraryKey(null)}
                                                      className="text-zinc-400 hover:text-white px-1"
                                                    >
                                                      ×
                                                    </button>
                                                  </div>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setSavingLibraryKey(key);
                                                      setSaveLibraryTitle(`${meta.label} Preset`);
                                                    }}
                                                    className="text-zinc-400 hover:text-[#f5c518] flex items-center gap-1 transition"
                                                  >
                                                    <Bookmark className="w-3 h-3" />
                                                    <span>Save as Reusable Preset</span>
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

          {/* STEP 4: SELECT GAZE BEHAVIOR */}
          <div className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2.5">
                <Eye className="w-5 h-5 text-[#f5c518] shrink-0" />
                <div>
                  <h3 className="font-display text-sm sm:text-base font-bold text-white">
                    Step 4 · Select Gaze Behavior (Subject Eye & Head Direction Relative to New Camera)
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Choose how the subject in your original image should direct their eyes and gaze
                    when re-photographed from this camera position.
                  </p>
                </div>
              </div>
              {cameraState.detectedReferenceGaze && (
                <span className="text-[11px] font-mono text-zinc-400">
                  Reference Gaze Detected
                </span>
              )}
            </div>

            {cameraState.detectedReferenceGaze && (
              <div className="p-3 rounded-xl bg-black/40 border border-white/[0.08] text-xs text-zinc-300">
                <span className="font-bold text-[#f5c518]">
                  Observed in Camera Reference Image:{' '}
                </span>
                <span>{cameraState.detectedReferenceGaze}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {GAZE_OPTIONS.map((opt) => {
                const isSelected = cameraState.gazeBehavior === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectGazeBehavior(opt.id)}
                    className={`text-left p-3.5 rounded-xl transition-all flex flex-col justify-between gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'glass-card-active'
                        : 'glass-card hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-xs font-bold text-white">{opt.title}</span>
                      {isSelected && (
                        <span className="text-[11px] font-mono font-semibold text-[#f5c518]">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">{opt.subtitle}</p>
                  </button>
                );
              })}
            </div>

            {cameraState.gazeBehavior !== 'none' && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300">
                    Active Gaze Directive (Editable — Included in Final Transformation Prompt)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const resetTxt = getDefaultGazeDirectiveText(
                        cameraState.gazeBehavior,
                        cameraState.detectedReferenceGaze
                      );
                      onUpdateCameraState((prev) =>
                        prev ? { ...prev, customGazeText: resetTxt } : null
                      );
                      if (generatedPrompt) onSetHasUnbuiltChanges(true);
                    }}
                    className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Gaze Text</span>
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={cameraState.customGazeText}
                  onChange={(e) => {
                    const val = e.target.value;
                    onUpdateCameraState((prev) =>
                      prev ? { ...prev, customGazeText: val } : null
                    );
                    if (generatedPrompt) onSetHasUnbuiltChanges(true);
                  }}
                  placeholder="Describe how the subject's eyes and gaze should relate to the camera..."
                  className="w-full bg-black/40 border border-white/15 focus:border-[#f5c518] rounded-xl p-3 text-xs text-white outline-none leading-relaxed"
                />
              </div>
            )}

            {/* Optional Additional Transformation Notes */}
            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold text-zinc-300">
                Optional Additional Camera Transformation Notes
              </label>
              <input
                type="text"
                value={cameraState.additionalTransformationNotes}
                onChange={(e) => {
                  const val = e.target.value;
                  onUpdateCameraState((prev) =>
                    prev ? { ...prev, additionalTransformationNotes: val } : null
                  );
                  if (generatedPrompt) onSetHasUnbuiltChanges(true);
                }}
                placeholder="Any extra camera instructions (e.g., maintain exact background architectural alignment)..."
                className="w-full bg-black/40 border border-white/15 focus:border-[#f5c518] rounded-xl px-3 py-2 text-xs text-white outline-none"
              />
            </div>
          </div>

          {/* STEP 5: GENERATE FINAL PROMPT BUTTON */}
          <div className="pt-2 pb-2">
            <div className="rounded-2xl glass-panel p-5 sm:p-6 text-center space-y-3">
              <div className="max-w-xl mx-auto space-y-1">
                <h3 className="font-display text-base sm:text-lg font-bold text-white tracking-tight">
                  Step 5 ·{' '}
                  {generatedPrompt
                    ? 'Update Final Camera Transformation Prompt'
                    : 'Generate Final Prompt'}
                </h3>
                <p className="text-xs text-zinc-400">
                  Converts your customized Camera Reference components (A–K) and selected Gaze
                  Behavior into a complete, reusable image-to-image transformation prompt ready to
                  use alongside your original image.
                </p>
              </div>

              <button
                type="button"
                onClick={handleGeneratePrompt}
                className="w-full sm:w-auto min-w-[280px] px-8 py-4 rounded-xl bg-gradient-to-r from-[#ffe169] via-[#f5c518] to-[#d49a00] hover:brightness-105 active:scale-[0.99] text-black font-black text-sm uppercase tracking-wider shadow-lg shadow-amber-500/15 transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-black stroke-[2.5]" />
                <span>Generate Final Prompt</span>
              </button>
            </div>
          </div>

          {/* Unbuilt Changes Banner */}
          {hasUnbuiltChanges && generatedPrompt && (
            <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span className="font-bold text-amber-300">
                  Camera components or gaze behavior were updated.
                </span>
                <span className="text-zinc-300 ml-1">
                  Click "Generate Final Prompt" to refresh the prompt with your latest edits.
                </span>
              </div>
              <button
                type="button"
                onClick={handleGeneratePrompt}
                className="px-3.5 py-2 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs shrink-0 flex items-center gap-1.5 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Generate Final Prompt</span>
              </button>
            </div>
          )}

          {/* STEP 6: COPY FINAL PROMPT */}
          {generatedPrompt && (
            <div className="pt-4 border-t border-[#1f232d] space-y-4 w-full animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Step 6 · Final Image-to-Image Camera Transformation Prompt
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Supply your original image alongside this prompt in your external image-to-image
                    AI tool.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs text-zinc-400 font-semibold">Format:</label>
                  <select
                    value={targetModel}
                    onChange={(e) => onSetTargetModel(e.target.value as TargetModelType)}
                    className="bg-[#181b24] text-white border border-[#262a36] rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
                  >
                    <option value="universal">Universal Image-to-Image</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="chatgpt">ChatGPT / DALL-E</option>
                    <option value="flux">Flux</option>
                  </select>
                </div>
              </div>

              {promptSafety && (
                <PromptCheckBanner
                  check={promptSafety}
                  onApplyFix={() => {}}
                />
              )}

              <textarea
                readOnly
                value={exportedPrompt}
                rows={16}
                className="w-full bg-[#11131a] border border-[#262a36] text-white p-4 rounded-2xl text-xs font-mono leading-relaxed outline-none select-text selection:bg-[#f5c518] selection:text-black shadow-inner resize-y min-h-[260px]"
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="py-3 px-4 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  {copyFeedback ? (
                    <>
                      <Check className="w-4 h-4 text-black" />
                      <span>Copied to Clipboard!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy Prompt</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPrompt}
                  className="py-3 px-4 rounded-xl bg-[#161922] hover:bg-[#1f232d] text-white font-bold text-xs transition flex items-center justify-center gap-2 border border-[#262a36]"
                >
                  <Download className="w-4 h-4 text-sky-400" />
                  <span>Download Prompt (.txt)</span>
                </button>

                <button
                  type="button"
                  onClick={() => onSaveProject(generatedPrompt)}
                  className="py-3 px-4 rounded-xl bg-[#161922] hover:bg-[#1f232d] text-zinc-200 font-bold text-xs transition flex items-center justify-center gap-2 border border-[#262a36]"
                >
                  <BookmarkPlus className="w-4 h-4 text-[#f5c518]" />
                  <span>Save to Projects</span>
                </button>
              </div>
            </div>
          )}

          {/* FLOATING ANIMATED PROMPT COMPILATION DOCK */}
          <FloatingPromptDock
            toolLabel="Camera Angle Controller"
            activeCount={counts.locked + counts.edited}
            totalCount={ALL_CAMERA_COMPONENT_KEYS.length}
            editedCount={counts.edited}
            outputRatio={`${cameraState.outputRatio} · ${cameraState.orientation}`}
            hasUnbuiltChanges={hasUnbuiltChanges}
            generatedPrompt={generatedPrompt}
            exportedPrompt={exportedPrompt}
            targetModel={targetModel}
            onSetTargetModel={onSetTargetModel}
            onGeneratePrompt={handleGeneratePrompt}
            onCopyPrompt={handleCopyPrompt}
            onDownloadPrompt={handleDownloadPrompt}
            onSaveProject={() =>
              onSaveProject(
                generatedPrompt || buildCameraReferenceTransformationPrompt(cameraState)
              )
            }
            copyFeedback={copyFeedback}
          />
        </div>
      )}
    </div>
  );
};
