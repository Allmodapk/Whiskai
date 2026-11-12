import React, { useState, useEffect, useRef } from 'react';
import {
  ImageDataItem,
  ComponentKey,
  ALL_COMPONENT_KEYS,
  COMPONENT_LABELS,
  DetectedComponent,
  ComponentState,
  SubjectProfile,
  ReferenceBlueprint,
  TargetModelType,
  MasterOutfit,
  BackgroundProfile,
  ToolType,
  CameraControlSettings,
  CameraReferenceAnalysisState,
} from './types';
import { StorageService, SEED_OUTFITS } from './services/storage';
import { ImageDB } from './services/imageDb';
import { postApiJson, extractApiErrorMessage } from './services/apiClient';
import {
  buildGeneralExtractorPrompt,
  buildSubjectSwapPrompt,
  buildCameraControlPrompt,
  buildNegativePrompt,
  exportPromptForModel,
  checkPromptSafety,
} from './services/promptBuilder';
import { checkPromptContradictions } from './services/contradictionCheck';
import { findIgnoredSubjectLeaks } from './services/leakGuard';
import {
  normalizeScanResult,
  mergeRepairedScanResult,
  buildSoloFromMultiSnapshot,
  formatPlainTextDebugReport,
  CanonicalScanStructure,
  ScanDebugReportData,
} from './services/scanNormalizer';
import { SubjectData, ContradictionIssue } from './types';
import { ProfileManager } from './components/ProfileManager';
import { BlueprintProjects } from './components/BlueprintProjects';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { CameraAngleController } from './components/CameraAngleController';
import { CameraPlayboardStudio } from './components/CameraPlayboardStudio';
import { SwapStudio } from './components/SwapStudio';
import { CameraAI } from './components/CameraAI';
import { PerspectivePlayboard } from './components/perspectivePlayboard/PerspectivePlayboard';
import {
  GeneralExtractorWorkspace,
  type SceneAccordionGroup,
} from './components/GeneralExtractorWorkspace';
import { BottomSheet } from './components/ui/StudioPrimitives';
import {
  Wrench,
  Users,
  FolderKanban,
  Sparkles,
  UserCheck,
  Camera,
  FileSearch,
  Loader2,
  Sliders,
  ExternalLink,
  ArrowLeft,
  AlertTriangle,
  X,
  ListChecks,
  Compass,
  ArrowRight,
  Layers,
} from 'lucide-react';

function checkIsCameraRoute(): { isCameraRoute: boolean; mode: 'playboard' | 'extractor' } {
  if (typeof window === 'undefined') return { isCameraRoute: false, mode: 'playboard' };
  const pathname = window.location.pathname.toLowerCase();
  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.toLowerCase();

  const isPathMatch =
    pathname === '/camera-controller' ||
    pathname === '/camera-angle-controller' ||
    pathname.endsWith('/camera-controller');
  const isQueryMatch =
    searchParams.get('view') === 'camera-controller' ||
    searchParams.get('tool') === 'camera-controller';
  const isHashMatch =
    hash === '#camera-controller' ||
    hash === '#/camera-controller';

  const modeParam = searchParams.get('mode');
  const mode: 'playboard' | 'extractor' =
    modeParam === 'extractor' ? 'extractor' : 'playboard';

  return {
    isCameraRoute: isPathMatch || isQueryMatch || isHashMatch,
    mode,
  };
}

const DEFAULT_CAMERA_SETTINGS: CameraControlSettings = {
  viewpoint: 'Front-facing view',
  elevation: 'Eye-level camera',
  shotSize: 'Three-quarter-body shot',
  framing:
    'Three-quarter-body framing cutting off cleanly mid-calf, subject centered with balanced headroom and breathing room on left and right margins.',
  distance: 'Medium portrait distance',
  angleOfView: 'Natural normal-lens perspective with undistorted proportions',
  preserveComposition: true,
  customNotes: '',
};

const VIEWPOINT_OPTIONS = [
  'Front-facing view',
  'Three-quarter view (camera-left)',
  'Three-quarter view (camera-right)',
  'Side profile view',
  'Rear three-quarter view',
  'Rear view',
  'Over-the-shoulder view',
];

const ELEVATION_OPTIONS = [
  'Eye-level camera',
  'Subtle low-angle shot (slightly upward-looking)',
  'Low-angle shot (upward-looking perspective)',
  'Subtle high-angle shot (slightly downward-looking)',
  'High-angle shot (downward-looking perspective)',
  'Overhead bird-eye perspective',
];

const SHOT_SIZE_OPTIONS = [
  'Full-body shot (head to toe visible)',
  'Three-quarter-body shot (head to mid-calf/knee)',
  'Half-body / Waist-up shot',
  'Chest-up medium close-up',
  'Close-up portrait (head and shoulders)',
  'Extreme close-up (facial detail)',
];

const DISTANCE_OPTIONS = [
  'Close intimate portrait distance',
  'Medium portrait distance',
  'Full-body studio distance',
  'Wide environmental distance',
];

const PERSPECTIVE_OPTIONS = [
  'Natural normal-lens perspective with undistorted proportions',
  'Moderate wide-angle perspective with expanded spatial depth',
  'Telephoto portrait perspective with gentle background compression',
];

export default function App() {
  const initialRoute = checkIsCameraRoute();
  const [isDedicatedCameraView, setIsDedicatedCameraView] = useState<boolean>(
    initialRoute.isCameraRoute
  );
  const [popupFallbackBanner, setPopupFallbackBanner] = useState<boolean>(false);

  // Main Navigation: Tools | Profiles | Projects & Hub vs Workspace state
  const [activeNav, setActiveNav] = useState<'tools' | 'profiles' | 'projects'>('tools');
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState<boolean>(false);

  // Active Tool inside Main Tools page:
  const [activeTool, setActiveTool] = useState<ToolType>(() => {
    const saved = StorageService.getActiveTool();
    return saved === 'camera_controller' ? 'general_extractor' : saved;
  });

  // Saved Profiles state
  const [activeProfile, setActiveProfile] = useState<SubjectProfile>(() => {
    const id = StorageService.getActiveProfileId();
    return StorageService.getProfileById(id) || StorageService.getProfiles()[0];
  });
  const [activeOutfit, setActiveOutfit] = useState<MasterOutfit>(() => {
    const id = StorageService.getActiveOutfitId();
    return StorageService.getOutfitById(id) || StorageService.getOutfits()[0] || SEED_OUTFITS[0];
  });

  // Subject Swapping custom multi-image replacement uploader state
  const [swapSubjectSource, setSwapSubjectSource] = useState<'saved' | 'upload'>('saved');
  const [swapSubjectImages, setSwapSubjectImages] = useState<ImageDataItem[]>([]);
  const [isAnalyzingSwapSubject, setIsAnalyzingSwapSubject] = useState(false);
  const [swapSubjectError, setSwapSubjectError] = useState<string | null>(null);
  const swapSubjectFileRef = useRef<HTMLInputElement>(null);

  // Reference image state (ONE image at a time as required)
  const [referenceImage, setReferenceImage] = useState<ImageDataItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Analysis status
  const [isScanning, setIsScanning] = useState(false);
  const [scanStageIndex, setScanStageIndex] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  // 13 Extracted Components state + Original Immutable Snapshot
  const [originalComponents, setOriginalComponents] = useState<Record<
    ComponentKey,
    DetectedComponent
  > | null>(null);
  const [components, setComponents] = useState<Record<ComponentKey, DetectedComponent> | null>(
    null
  );
  const [outputRatio, setOutputRatio] = useState<string>('3:4');
  const [ratioExplanation, setRatioExplanation] = useState<string>('');
  const [scanSummary, setScanSummary] = useState<string>('');

  // Scan Quality, Multi-Subject, Checklist & Contradiction State (Phases 1-4)
  const [scannedLeadSentence, setScannedLeadSentence] = useState<string>('');
  const [scannedStyleCategory, setScannedStyleCategory] = useState<
    'photorealistic' | 'illustration' | '3D' | 'painting'
  >('photorealistic');
  const [scannedModelUsed, setScannedModelUsed] = useState<string>('');
  const [isQuotaFallback, setIsQuotaFallback] = useState<boolean>(false);
  const [quotaFallbackAcknowledged, setQuotaFallbackAcknowledged] = useState<boolean>(false);

  // Canonical Scan & On-Screen Debug state
  const [canonicalScan, setCanonicalScan] = useState<CanonicalScanStructure | null>(null);
  const [multiCanonicalSnapshot, setMultiCanonicalSnapshot] =
    useState<CanonicalScanStructure | null>(null);
  const [scanDebugReport, setScanDebugReport] = useState<ScanDebugReportData | null>(null);
  const [isDebugEnabled, setIsDebugEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mywhisk_scan_debug') === 'true';
    } catch {
      return false;
    }
  });
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState<boolean>(true);
  const [debugCopyFeedback, setDebugCopyFeedback] = useState<boolean>(false);
  const [lowVisibilityError, setLowVisibilityError] = useState<{
    reason: string;
    visibleCount: number;
  } | null>(null);

  // Multi-Subject state (Phase 2)
  const [detectedSubjects, setDetectedSubjects] = useState<SubjectData[]>([]);
  const [subjectComponents, setSubjectComponents] =
    useState<Record<string, Record<ComponentKey, DetectedComponent>> | null>(null);
  const [activeSubjectDecision, setActiveSubjectDecision] = useState<'all' | 'solo'>('all');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(['A']);
  const [isMultiSubjectModalOpen, setIsMultiSubjectModalOpen] = useState<boolean>(false);
  const [multiSubjectSnapshot, setMultiSubjectSnapshot] = useState<{
    components: Record<ComponentKey, DetectedComponent>;
    originalComponents: Record<ComponentKey, DetectedComponent>;
    subjects: SubjectData[];
    subjectComponents?: Record<string, Record<ComponentKey, DetectedComponent>> | null;
  } | null>(null);
  const [soloRewriteWarning, setSoloRewriteWarning] = useState<string | null>(null);
  const [isRewritingFields, setIsRewritingFields] = useState<boolean>(false);

  // Tick-box Checklist state (Phase 3)
  const [isChecklistStepOpen, setIsChecklistStepOpen] = useState<boolean>(false);
  const [tickedComponentKeys, setTickedComponentKeys] = useState<ComponentKey[]>(ALL_COMPONENT_KEYS);

  // Contradiction Check state (Phase 4)
  const [contradictionIssues, setContradictionIssues] = useState<ContradictionIssue[]>([]);
  const [isContradictionModalOpen, setIsContradictionModalOpen] = useState<boolean>(false);
  const [isPerformingDeepCheck, setIsPerformingDeepCheck] = useState<boolean>(false);

  // Camera Angle Controller settings & 11-Component Camera Reference state
  const [cameraSettings, setCameraSettings] =
    useState<CameraControlSettings>(DEFAULT_CAMERA_SETTINGS);
  const [cameraReferenceState, setCameraReferenceState] =
    useState<CameraReferenceAnalysisState | null>(null);
  const [cameraGeneratedPrompt, setCameraGeneratedPrompt] = useState<string | null>(null);
  const [cameraHasUnbuiltChanges, setCameraHasUnbuiltChanges] = useState<boolean>(false);
  const [cameraToolMode, setCameraToolMode] = useState<'playboard' | 'extractor'>(
    initialRoute.mode
  );

  // Sync dedicated route state on browser popstate / hashchange
  useEffect(() => {
    const syncRoute = () => {
      const route = checkIsCameraRoute();
      setIsDedicatedCameraView(route.isCameraRoute);
      if (route.isCameraRoute) {
        setCameraToolMode(route.mode);
      }
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  // Final Prompt Generation state
  const [generatedMasterPrompt, setGeneratedMasterPrompt] = useState<string | null>(null);
  const [generatedNegativePrompt, setGeneratedNegativePrompt] = useState<string>('');
  const [showNegativePrompt, setShowNegativePrompt] = useState<boolean>(false);
  const [hasUnbuiltChanges, setHasUnbuiltChanges] = useState<boolean>(false);

  // Export & Project saving
  const [targetModel, setTargetModel] = useState<TargetModelType>('universal');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [projectTitleInput, setProjectTitleInput] = useState<string>('');
  const [savedBlueprintNotice, setSavedBlueprintNotice] = useState<string | null>(null);

  // Collapsible Accordion Groups & Filter state for 13 Scene Components
  const [sceneFilter, setSceneFilter] = useState<'all' | 'locked' | 'edited' | 'ignored'>('all');
  const [openSceneGroups, setOpenSceneGroups] = useState<Record<string, boolean>>({
    identity_pose: true,
    camera_framing: true,
    wardrobe_scene: true,
    expression_gestures: true,
  });

  const SCENE_ACCORDION_GROUPS: SceneAccordionGroup[] = [
    {
      id: 'identity_pose',
      title: 'Identity, Body & Pose Geometry',
      subtitle: 'Subject facial identity, anatomical body build, and spatial pose articulation',
      codes: '01 – 03',
      keys: ['subject', 'body', 'pose'],
    },
    {
      id: 'camera_framing',
      title: 'Camera, Framing & Composition',
      subtitle: 'Optical viewpoint, crop boundaries, subject scale, and visual balance',
      codes: '04 – 06',
      keys: ['camera', 'framing', 'composition'],
    },
    {
      id: 'wardrobe_scene',
      title: 'Wardrobe, Lighting & Environment',
      subtitle: 'Garment construction, light direction & softness, background objects & setting',
      codes: '07 – 10',
      keys: ['clothing', 'lighting', 'background', 'environment'],
    },
    {
      id: 'expression_gestures',
      title: 'Expression & Fine Limb Gestures',
      subtitle: 'Micro-facial expression, gaze tension, hand/finger articulation & leg stance',
      codes: '11 – 13',
      keys: ['facial_expression', 'hand_gestures', 'leg_gestures'],
    },
  ];

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  // Open Camera Angle Controller in the current tab (fallback when popup/new tab is restricted)
  const openCameraInCurrentTab = (mode: 'playboard' | 'extractor' = 'playboard') => {
    triggerHaptic();
    const targetUrl =
      mode === 'extractor' ? '/camera-controller?mode=extractor' : '/camera-controller';
    window.history.pushState({ dedicatedCamera: true }, '', targetUrl);
    setCameraToolMode(mode);
    setIsDedicatedCameraView(true);
    setPopupFallbackBanner(false);
  };

  // Return from full-viewport Camera Angle Controller back to MyWhisk AI
  const handleExitCameraRoute = () => {
    triggerHaptic();
    window.history.pushState({}, '', '/');
    setIsDedicatedCameraView(false);
  };

  // Triggered when user clicks the Camera Angle Controller card or 3D Playboard button (opens new tab via native <a target="_blank">)
  const handleCameraNewTabLaunch = (mode: 'playboard' | 'extractor' = 'playboard') => {
    triggerHaptic();
    setCameraToolMode(mode);
    // Keep original MyWhisk AI tab open with its state untouched; show fallback option in case browser blocks popups
    setPopupFallbackBanner(true);
  };

  // Switch active tool inside Main Tools page
  const handleSelectTool = (tool: ToolType) => {
    if (tool === 'camera_controller') {
      handleCameraNewTabLaunch('playboard');
      return;
    }
    triggerHaptic();
    const prevTool = activeTool;
    setActiveTool(tool);
    StorageService.setActiveTool(tool);
    setActiveNav('tools');
    setIsWorkspaceOpen(true);

    if (components) {
      if (tool === 'subject_swapping') {
        setComponents((prev) => {
          if (!prev) return null;
          const next = { ...prev };
          if (next.subject.source !== 'user_edit') {
            next.subject = {
              ...next.subject,
              userText: activeProfile.masterSubject,
              state: 'edited',
              source: 'saved_profile',
              selectedProfileId: activeProfile.id,
              selectedProfileName: activeProfile.name,
            };
          }
          if (next.body.source !== 'user_edit') {
            next.body = {
              ...next.body,
              userText: activeProfile.masterBody,
              state: 'edited',
              source: 'saved_profile',
              selectedProfileId: activeProfile.id,
              selectedProfileName: activeProfile.name,
            };
          }
          return next;
        });
      } else if (prevTool === 'subject_swapping' && originalComponents) {
        // Restore scanned reference subject/body if they were auto-populated by Subject Swapping
        setComponents((prev) => {
          if (!prev) return null;
          const next = { ...prev };
          if (next.subject.source === 'saved_profile' && originalComponents.subject) {
            next.subject = { ...originalComponents.subject };
          }
          if (next.body.source === 'saved_profile' && originalComponents.body) {
            next.body = { ...originalComponents.body };
          }
          return next;
        });
      }
    }

    if (generatedMasterPrompt) {
      setHasUnbuiltChanges(true);
    }
  };

  // Select a Saved Subject Profile
  const handleSelectProfile = (profile: SubjectProfile) => {
    triggerHaptic();
    setActiveProfile(profile);
    StorageService.setActiveProfileId(profile.id);

    // Update subject & body components without overwriting unrelated manual edits
    if (components && activeTool === 'subject_swapping') {
      setComponents((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          subject: {
            ...prev.subject,
            userText: profile.masterSubject,
            state: 'edited',
            source: 'saved_profile',
            selectedProfileId: profile.id,
            selectedProfileName: profile.name,
          },
          body: {
            ...prev.body,
            userText: profile.masterBody,
            state: 'edited',
            source: 'saved_profile',
            selectedProfileId: profile.id,
            selectedProfileName: profile.name,
          },
        };
      });
      if (generatedMasterPrompt) {
        setHasUnbuiltChanges(true);
      }
    }
  };

  // Select a Saved Outfit Profile
  const handleSelectOutfit = (outfit: MasterOutfit) => {
    triggerHaptic();
    setActiveOutfit(outfit);
    StorageService.setActiveOutfitId(outfit.id);
    if (components) {
      setComponents((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          clothing: {
            ...prev.clothing,
            userText: outfit.description,
            state: 'edited',
            source: 'saved_profile',
            selectedProfileId: outfit.id,
            selectedProfileName: outfit.name,
          },
        };
      });
      if (generatedMasterPrompt) {
        setHasUnbuiltChanges(true);
      }
    }
  };

  // Apply a Background Profile bundle (independent selection of background, environment, lighting)
  const handleApplyBackgroundBundle = (
    bgProfile: BackgroundProfile,
    parts: { background: boolean; environment: boolean; lighting: boolean }
  ) => {
    triggerHaptic();
    setComponents((prev) => {
      if (!prev) return null;
      const next = { ...prev };
      if (parts.background && bgProfile.background) {
        next.background = {
          ...next.background,
          userText: bgProfile.background,
          state: 'edited',
          source: 'saved_profile',
          selectedProfileId: bgProfile.id,
          selectedProfileName: bgProfile.name,
        };
      }
      if (parts.environment && bgProfile.environment) {
        next.environment = {
          ...next.environment,
          userText: bgProfile.environment,
          state: 'edited',
          source: 'saved_profile',
          selectedProfileId: bgProfile.id,
          selectedProfileName: bgProfile.name,
        };
      }
      if (parts.lighting && bgProfile.lighting) {
        next.lighting = {
          ...next.lighting,
          userText: bgProfile.lighting,
          state: 'edited',
          source: 'saved_profile',
          selectedProfileId: bgProfile.id,
          selectedProfileName: bgProfile.name,
        };
      }
      return next;
    });
    if (generatedMasterPrompt) {
      setHasUnbuiltChanges(true);
    }
  };

  function calculateNearestRatio(width: number, height: number): string {
    const ratio = width / height;
    const ratios: { label: string; value: number }[] = [
      { label: '1:1', value: 1 },
      { label: '4:3', value: 4 / 3 },
      { label: '3:4', value: 3 / 4 },
      { label: '16:9', value: 16 / 9 },
      { label: '9:16', value: 9 / 16 },
      { label: '2:3', value: 2 / 3 },
      { label: '3:2', value: 3 / 2 },
      { label: '21:9', value: 21 / 9 },
    ];
    let closest = ratios[0];
    let minDiff = Math.abs(ratio - ratios[0].value);
    for (let i = 1; i < ratios.length; i++) {
      const diff = Math.abs(ratio - ratios[i].value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = ratios[i];
      }
    }
    return closest.label;
  }

  // Optimize single uploaded image via HTML5 Canvas
  const optimizeImageFile = (file: File, label = 'Reference Image'): Promise<ImageDataItem> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rawDataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const MAX_DIM = 1024;
          let width = img.width;
          let height = img.height;

          const detectedRatio = calculateNearestRatio(img.width, img.height);
          if (label === 'Primary Reference' || label === 'Reference Image') {
            setOutputRatio(detectedRatio);
          }

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
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const base64 = optimizedDataUrl.split(',')[1];
            resolve({
              id: 'img_' + Date.now() + Math.random().toString(36).slice(2, 6),
              data: base64,
              mimeType: 'image/jpeg',
              previewUrl: optimizedDataUrl,
              name: file.name,
              sizeBytes: Math.round((base64.length * 3) / 4),
              label,
            });
          } else {
            const base64 = rawDataUrl.split(',')[1];
            resolve({
              id: 'img_' + Date.now() + Math.random().toString(36).slice(2, 6),
              data: base64,
              mimeType: file.type || 'image/jpeg',
              previewUrl: rawDataUrl,
              name: file.name,
              sizeBytes: file.size,
              label,
            });
          }
        };
        img.onerror = () => {
          const base64 = rawDataUrl.split(',')[1];
          resolve({
            id: 'img_' + Date.now() + Math.random().toString(36).slice(2, 6),
            data: base64,
            mimeType: file.type || 'image/jpeg',
            previewUrl: rawDataUrl,
            name: file.name,
            sizeBytes: file.size,
            label,
          });
        };
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    });
  };

  // Set single reference image
  const setSingleReferenceFile = async (file: File) => {
    triggerHaptic();
    const item = await optimizeImageFile(file, 'Primary Reference');
    setReferenceImage(item);
    setScanError(null);
  };

  // Clipboard paste support (Ctrl+V / Cmd+V) for single reference image
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (activeNav !== 'tools') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            setSingleReferenceFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeNav]);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSingleReferenceFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSingleReferenceFile(file);
    }
    e.target.value = '';
  };

  // Upload up to 5 subject images inside Subject Swapping tool
  const handleSwapSubjectFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const remaining = 5 - swapSubjectImages.length;
    const slice = Array.from(files).slice(0, remaining);
    const processed: ImageDataItem[] = [];
    for (const f of slice) {
      if (f.type.startsWith('image/')) {
        processed.push(await optimizeImageFile(f, 'Subject Ref'));
      }
    }
    setSwapSubjectImages((prev) => [...prev, ...processed]);
    e.target.value = '';
  };

  const handleAnalyzeSwapSubjectPhotos = async () => {
    if (swapSubjectImages.length === 0) return;
    setIsAnalyzingSwapSubject(true);
    setSwapSubjectError(null);
    try {
      const customKey = StorageService.getCustomApiKey();
      const data = await postApiJson<{ success: boolean; profile: any }>(
        '/api/analyze-subject-profile',
        {
          images: swapSubjectImages.map((img) => ({ data: img.data, mimeType: img.mimeType })),
        },
        { customKey }
      );

      const prof = data.profile;
      const newProfile: SubjectProfile = {
        id: 'profile_' + Date.now(),
        name: prof.suggestedName || `Uploaded Subject (${new Date().toLocaleTimeString()})`,
        masterSubject: prof.masterSubject || '',
        masterBody: prof.masterBody || '',
        tags: prof.tags || ['Uploaded', 'Subject Swap'],
        thumbnailUrl: swapSubjectImages[0]?.previewUrl,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      StorageService.saveProfile(newProfile);
      handleSelectProfile(newProfile);
      setSwapSubjectSource('saved');
    } catch (err: any) {
      setSwapSubjectError(
        extractApiErrorMessage(err, 'Failed to extract replacement subject identity.')
      );
    } finally {
      setIsAnalyzingSwapSubject(false);
    }
  };

  // Toggle Debug Mode
  const handleToggleDebug = () => {
    setIsDebugEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('mywhisk_scan_debug', String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  // Copy plain-text debug report (never includes API keys)
  const handleCopyDebugReport = () => {
    if (!scanDebugReport) return;
    triggerHaptic();
    const reportText = formatPlainTextDebugReport(scanDebugReport);
    navigator.clipboard.writeText(reportText);
    setDebugCopyFeedback(true);
    setTimeout(() => setDebugCopyFeedback(false), 2000);
  };

  // Apply a canonical scan structure into App state
  const applyCanonicalScanStructure = (
    canonical: CanonicalScanStructure,
    storeAsMultiSnapshot = false
  ) => {
    setCanonicalScan(canonical);
    setOriginalComponents({ ...canonical.originalComponents });
    setComponents({ ...canonical.activeComponents });
    setDetectedSubjects([...canonical.subjects]);
    setSubjectComponents(canonical.personComponents);
    setScanSummary(canonical.summary);
    setOutputRatio(canonical.outputRatio || outputRatio || '3:4');
    setRatioExplanation(canonical.ratioExplanation || '');
    setScannedLeadSentence(canonical.leadSentence || '');
    setScannedStyleCategory(canonical.styleCategory || 'photorealistic');

    const visibleKeys = ALL_COMPONENT_KEYS.filter(
      (k) => canonical.activeComponents[k]?.state !== 'unavailable'
    );
    setTickedComponentKeys(visibleKeys.length > 0 ? visibleKeys : [...ALL_COMPONENT_KEYS]);

    if (storeAsMultiSnapshot || canonical.subjects.length >= 2) {
      setMultiCanonicalSnapshot(canonical);
      setMultiSubjectSnapshot({
        components: { ...canonical.activeComponents },
        originalComponents: { ...canonical.originalComponents },
        subjects: [...canonical.subjects],
        subjectComponents: canonical.personComponents,
      });
    }
  };

  // Execute 13-Component Grounded Image Analysis
  const handleScanReference = async () => {
    if (!referenceImage) {
      setScanError('Please upload a reference image to analyze.');
      return;
    }

    triggerHaptic();
    setIsScanning(true);
    setScanError(null);
    setLowVisibilityError(null);
    setFallbackNotice(null);
    setSoloRewriteWarning(null);
    setScanStageIndex(0);

    const timer = setInterval(() => {
      setScanStageIndex((curr) => {
        if (curr >= 6 && curr < 9) {
          setFallbackNotice('Completing deep 13-component anatomical & optical extraction...');
        }
        return curr < 9 ? curr + 1 : curr;
      });
    }, 650);

    try {
      const customKey = StorageService.getCustomApiKey();
      const payload = {
        images: [
          {
            data: referenceImage.data,
            mimeType: referenceImage.mimeType,
          },
        ],
        outputRatio,
      };

      const data = await postApiJson<any>('/api/analyze-reference', payload, {
        customKey,
        timeoutMs: 55000,
        maxRetries: 1,
      });

      clearInterval(timer);
      setScanStageIndex(9);
      setFallbackNotice(
        typeof data.warning === 'string' && data.warning.trim() ? data.warning : null
      );

      const debugMeta = data.debugMeta || {};
      const quotaFallback = Boolean(data.isQuotaFallback || data.quotaFallback || debugMeta.quotaFallback);
      setIsQuotaFallback(quotaFallback);
      if (quotaFallback) {
        setQuotaFallbackAcknowledged(false);
      }
      setScannedModelUsed(data.modelUsed || debugMeta.modelUsed || '');

      let canonical = normalizeScanResult(data, {
        mode: 'all',
        fallbackRatio: outputRatio || '3:4',
        finishReason: debugMeta.finishReason,
        jsonRepaired: debugMeta.jsonRepaired,
        activeTool,
        activeProfile,
      });

      let truncationRepairTriggered = Boolean(debugMeta.truncationRepairTriggered);
      let repairedKeys: string[] = Array.isArray(debugMeta.repairedKeys)
        ? [...debugMeta.repairedKeys]
        : [];

      // Client-side targeted repair safety net if < 60% present or truncated and missing keys remain
      if (canonical.needsRepair && canonical.missingCoreKeys.length > 0 && !quotaFallback) {
        truncationRepairTriggered = true;
        try {
          const repairRes = await postApiJson<any>(
            '/api/repair-components',
            {
              image: { data: referenceImage.data, mimeType: referenceImage.mimeType },
              missingKeys: canonical.missingCoreKeys,
              subjects: canonical.subjects,
              outputRatio: canonical.outputRatio,
            },
            { customKey, timeoutMs: 35000, maxRetries: 0 }
          );
          if (repairRes && repairRes.analysis) {
            canonical = mergeRepairedScanResult(canonical, repairRes.analysis, {
              mode: 'all',
              fallbackRatio: canonical.outputRatio,
              activeTool,
              activeProfile,
            });
            if (Array.isArray(repairRes.repairedKeys)) {
              repairedKeys = Array.from(new Set([...repairedKeys, ...repairRes.repairedKeys]));
            }
          }
        } catch (repairErr) {
          console.warn('Client targeted repair call warning:', repairErr);
        }
      }

      // Populate Camera Angle Controller initial estimates from the analyzed image
      const est = canonical.cameraEstimates || {};
      const framingDetected = canonical.sharedComponents.framing?.detectedText || '';
      setCameraSettings({
        viewpoint: est.viewpoint || 'Front-facing view',
        elevation: est.elevation || 'Eye-level camera',
        shotSize: est.shotSize || 'Three-quarter-body shot',
        framing: est.framing || framingDetected || DEFAULT_CAMERA_SETTINGS.framing,
        distance: est.distance || 'Medium portrait distance',
        angleOfView:
          est.angleOfView || 'Natural normal-lens perspective with undistorted proportions',
        preserveComposition: true,
        customNotes: '',
      });

      setActiveSubjectDecision('all');
      setSelectedSubjectIds(canonical.subjects.map((s) => s.id));
      applyCanonicalScanStructure(canonical, true);

      // Build On-Screen Scan Debug Report
      const rawPreview =
        typeof debugMeta.rawTextPreview === 'string'
          ? debugMeta.rawTextPreview.slice(0, 1500)
          : JSON.stringify(data.analysis || data).slice(0, 1500);

      setScanDebugReport({
        timestamp: new Date().toISOString(),
        httpStatus: debugMeta.httpStatus || 200,
        modelUsed: data.modelUsed || debugMeta.modelUsed || 'gemini-3.8-flash',
        quotaFallback,
        responseLength: debugMeta.responseLength || rawPreview.length,
        finishReason: debugMeta.finishReason || 'STOP',
        jsonParseSucceeded: debugMeta.jsonParseSucceeded !== false,
        jsonRepaired: Boolean(debugMeta.jsonRepaired),
        repairNote: debugMeta.repairNote,
        truncationRepairTriggered,
        repairedKeys,
        topLevelKeys: canonical.topLevelKeys,
        subjects: canonical.subjects,
        bucketKeysFound: canonical.bucketKeysFound,
        decisions: canonical.decisions,
        rawModelTextPreview: rawPreview,
      });

      setGeneratedMasterPrompt(null);
      setGeneratedNegativePrompt('');
      setHasUnbuiltChanges(false);
      setProjectTitleInput(
        referenceImage.name
          ? `${referenceImage.name.replace(/\.[^.]+$/, '')}`
          : `Analysis ${new Date().toLocaleDateString()}`
      );

      // Fix 4: If fewer than 3 components are visible after repair, show clear error card instead of empty checklist
      if (canonical.visibleCount < 3) {
        const missingCount = canonical.decisions.filter(
          (d) => d.key !== 'interaction' && d.reason === 'missing from response'
        ).length;
        const emptyCount = canonical.decisions.filter(
          (d) => d.key !== 'interaction' && d.reason === 'empty detectedText'
        ).length;
        setLowVisibilityError({
          visibleCount: canonical.visibleCount,
          reason: `Only ${canonical.visibleCount}/13 components were visible (${missingCount} missing from response, ${emptyCount} empty detectedText, finishReason: ${debugMeta.finishReason || 'STOP'}).`,
        });
        setIsMultiSubjectModalOpen(false);
        setIsChecklistStepOpen(false);
      } else if (canonical.subjects.length >= 2) {
        setIsMultiSubjectModalOpen(true);
      } else {
        setIsChecklistStepOpen(true);
      }
      triggerHaptic();
    } catch (err: any) {
      clearInterval(timer);
      setFallbackNotice(null);
      setScanError(extractApiErrorMessage(err, 'Reference analysis could not be completed.'));
    } finally {
      setIsScanning(false);
    }
  };

  // Phase 2: Multi-subject decision handlers
  const handleConsiderAllSubjects = () => {
    setLowVisibilityError(null);
    if (multiCanonicalSnapshot) {
      applyCanonicalScanStructure(multiCanonicalSnapshot, false);
      setActiveSubjectDecision('all');
      setSelectedSubjectIds(multiCanonicalSnapshot.subjects.map((s) => s.id));
      setIsMultiSubjectModalOpen(false);
      setSoloRewriteWarning(null);
      if (multiCanonicalSnapshot.visibleCount < 3) {
        setLowVisibilityError({
          visibleCount: multiCanonicalSnapshot.visibleCount,
          reason: `Only ${multiCanonicalSnapshot.visibleCount}/13 components are visible in the multi-subject scan.`,
        });
      } else {
        setIsChecklistStepOpen(true);
      }
      return;
    }

    if (multiSubjectSnapshot) {
      setComponents({ ...multiSubjectSnapshot.components });
      setOriginalComponents({ ...multiSubjectSnapshot.originalComponents });
      setDetectedSubjects(multiSubjectSnapshot.subjects);
      setSubjectComponents(multiSubjectSnapshot.subjectComponents || null);
    }
    setActiveSubjectDecision('all');
    setSelectedSubjectIds(detectedSubjects.map((s) => s.id));
    setIsMultiSubjectModalOpen(false);
    setIsChecklistStepOpen(true);
    setSoloRewriteWarning(null);
  };

  const handleSelectSoloSubject = async (subjectId: string) => {
    if (!referenceImage) return;

    if (!multiSubjectSnapshot && components && originalComponents) {
      setMultiSubjectSnapshot({
        components: { ...components },
        originalComponents: { ...originalComponents },
        subjects: [...detectedSubjects],
        subjectComponents: subjectComponents || null,
      });
    }

    setActiveSubjectDecision('solo');
    setSelectedSubjectIds([subjectId]);
    setIsMultiSubjectModalOpen(false);
    setIsScanning(true);
    setSoloRewriteWarning(null);
    setLowVisibilityError(null);

    const keptSubj = detectedSubjects.find((s) => s.id === subjectId);
    const keptLabel = keptSubj ? keptSubj.label : `Subject ${subjectId}`;
    const ignoredSubjs = detectedSubjects.filter((s) => s.id !== subjectId);
    const ignoredLabels = ignoredSubjs.map((s) => s.label);

    const applyStoredMultiFallbackForSolo = (reasonNote: string, rawSoloPreview = '') => {
      if (multiCanonicalSnapshot) {
        const fallbackSolo = buildSoloFromMultiSnapshot(multiCanonicalSnapshot, subjectId);
        applyCanonicalScanStructure(fallbackSolo.canonical, false);
        setSoloRewriteWarning(
          fallbackSolo.leakedFieldKeys.length > 0
            ? `${reasonNote} Built solo view from stored multi-subject scan. ${fallbackSolo.leakedFieldKeys.length} scene field(s) flagged with "needs solo rewrite" badge.`
            : `${reasonNote} Built solo view from stored multi-subject scan for ${keptLabel}.`
        );
        setScanDebugReport((prev) =>
          prev
            ? {
                ...prev,
                decisions: fallbackSolo.canonical.decisions,
                soloDebug: {
                  ran: true,
                  httpStatus: 200,
                  modelUsed: 'stored-multi-subject-fallback',
                  finishReason: 'FALLBACK_TO_STORED_MULTI',
                  responseLength: rawSoloPreview.length,
                  jsonParseSucceeded: false,
                  jsonRepaired: false,
                  visibleCount: fallbackSolo.canonical.visibleCount,
                  fallbackToStoredMultiUsed: true,
                  rawModelTextPreview:
                    rawSoloPreview || 'Used stored multi-subject snapshot for solo mode.',
                },
              }
            : prev
        );
        return true;
      }
      return false;
    };

    try {
      const customKey = StorageService.getCustomApiKey();
      const res = await postApiJson<any>(
        '/api/reanalyze-solo',
        {
          image: { data: referenceImage.data, mimeType: referenceImage.mimeType },
          keepIds: [subjectId],
          outputRatio,
          keptSubjectLabel: keptLabel,
        },
        { customKey, timeoutMs: 55000, maxRetries: 1 }
      );

      const soloMeta = res.debugMeta || {};
      const soloQuotaFallback = Boolean(
        res.isQuotaFallback || res.quotaFallback || soloMeta.quotaFallback
      );

      let soloCanonical = normalizeScanResult(res, {
        mode: 'solo',
        keepIds: [subjectId],
        fallbackRatio: outputRatio || '3:4',
        finishReason: soloMeta.finishReason,
        jsonRepaired: soloMeta.jsonRepaired,
        activeTool,
        activeProfile,
      });

      // Targeted repair if solo response was truncated or < 60% present
      if (soloCanonical.needsRepair && soloCanonical.missingCoreKeys.length > 0 && !soloQuotaFallback) {
        try {
          const repairRes = await postApiJson<any>(
            '/api/repair-components',
            {
              image: { data: referenceImage.data, mimeType: referenceImage.mimeType },
              missingKeys: soloCanonical.missingCoreKeys,
              subjects: [{ id: subjectId, label: keptLabel, prominence: 'primary' }],
              soloSubjectLabel: keptLabel,
              outputRatio: soloCanonical.outputRatio,
            },
            { customKey, timeoutMs: 35000, maxRetries: 0 }
          );
          if (repairRes && repairRes.analysis) {
            soloCanonical = mergeRepairedScanResult(soloCanonical, repairRes.analysis, {
              mode: 'solo',
              keepIds: [subjectId],
              fallbackRatio: soloCanonical.outputRatio,
              activeTool,
              activeProfile,
            });
          }
        } catch (repairErr) {
          console.warn('Solo targeted repair warning:', repairErr);
        }
      }

      const rawSoloPreview =
        typeof soloMeta.rawTextPreview === 'string'
          ? soloMeta.rawTextPreview.slice(0, 1500)
          : JSON.stringify(res.analysis || res).slice(0, 1500);

      // Fix 5: If /api/reanalyze-solo returns empty (< 3 visible) or quota template when we have real multi-subject data, build solo view from stored multi-subject result!
      if ((soloCanonical.visibleCount < 3 || soloQuotaFallback) && multiCanonicalSnapshot) {
        applyStoredMultiFallbackForSolo(
          soloQuotaFallback
            ? 'AI solo re-analysis hit quota limit.'
            : `AI solo re-analysis returned only ${soloCanonical.visibleCount}/13 visible components.`,
          rawSoloPreview
        );
        return;
      }

      // Leak guard check on solo components
      const leakCheck = findIgnoredSubjectLeaks(
        soloCanonical.activeComponents,
        ignoredLabels,
        keptLabel
      );
      if (leakCheck.hasLeaks) {
        for (const leak of leakCheck.leaks) {
          if (soloCanonical.activeComponents[leak.key]) {
            soloCanonical.activeComponents[leak.key] = {
              ...soloCanonical.activeComponents[leak.key],
              needsSoloRewrite: true,
            };
            soloCanonical.originalComponents[leak.key] = {
              ...soloCanonical.originalComponents[leak.key],
              needsSoloRewrite: true,
            };
          }
        }
        setSoloRewriteWarning(
          `Some scene fields contain references to ignored subject(s) (${leakCheck.leaks.map((l) => l.label).join(', ')}). Click "Rewrite for Solo" to sanitize.`
        );
      }

      applyCanonicalScanStructure(soloCanonical, false);

      setScanDebugReport((prev) =>
        prev
          ? {
              ...prev,
              decisions: soloCanonical.decisions,
              soloDebug: {
                ran: true,
                httpStatus: soloMeta.httpStatus || 200,
                modelUsed: res.modelUsed || soloMeta.modelUsed || 'gemini-3.8-flash',
                finishReason: soloMeta.finishReason || 'STOP',
                responseLength: soloMeta.responseLength || rawSoloPreview.length,
                jsonParseSucceeded: soloMeta.jsonParseSucceeded !== false,
                jsonRepaired: Boolean(soloMeta.jsonRepaired),
                repairNote: soloMeta.repairNote,
                visibleCount: soloCanonical.visibleCount,
                fallbackToStoredMultiUsed: false,
                rawModelTextPreview: rawSoloPreview,
              },
            }
          : prev
      );
    } catch (err: any) {
      console.warn('Solo re-analysis notice:', err);
      const usedStored = applyStoredMultiFallbackForSolo(
        'Solo re-analysis request failed.'
      );
      if (!usedStored && subjectComponents && subjectComponents[subjectId] && components) {
        const keptPersonComps = subjectComponents[subjectId];
        const nextComps = { ...components };
        const nextOrig = originalComponents ? { ...originalComponents } : { ...components };

        const personKeys: ComponentKey[] = [
          'subject',
          'body',
          'pose',
          'facial_expression',
          'hand_gestures',
          'leg_gestures',
          'clothing',
        ];

        for (const pk of personKeys) {
          if (keptPersonComps[pk]) {
            nextComps[pk] = { ...keptPersonComps[pk], subjectId };
            nextOrig[pk] = { ...keptPersonComps[pk], subjectId };
          }
        }

        const leakCheck = findIgnoredSubjectLeaks(nextComps, ignoredLabels, keptLabel);
        if (leakCheck.hasLeaks) {
          for (const leak of leakCheck.leaks) {
            if (nextComps[leak.key]) {
              nextComps[leak.key] = { ...nextComps[leak.key], needsSoloRewrite: true };
            }
          }
          setSoloRewriteWarning(
            `Offline fallback used: ${leakCheck.leaks.length} field(s) (${leakCheck.leaks.map((l) => l.label).join(', ')}) contain references to ignored subjects. Click "Rewrite for Solo" to sanitize.`
          );
        }

        setOriginalComponents(nextOrig);
        setComponents(nextComps);
        setScannedLeadSentence(`${keptLabel} in ${nextComps.environment?.detectedText || 'scene'}.`);
      }
    } finally {
      setIsScanning(false);
      setIsChecklistStepOpen(true);
    }
  };

  const handleRewriteFieldsSolo = async () => {
    if (!components) return;
    setIsRewritingFields(true);

    const keptSubjId = selectedSubjectIds[0] || 'A';
    const keptSubj = detectedSubjects.find((s) => s.id === keptSubjId);
    const keptLabel = keptSubj ? keptSubj.label : `Subject ${keptSubjId}`;
    const ignoredSubjs = detectedSubjects.filter((s) => s.id !== keptSubjId);
    const ignoredLabels = ignoredSubjs.map((s) => s.label);

    const leakCheck = findIgnoredSubjectLeaks(components, ignoredLabels, keptLabel);
    const fieldsToRewrite: Record<string, string> = {};

    for (const leak of leakCheck.leaks) {
      fieldsToRewrite[leak.key] = leak.text;
    }

    if (Object.keys(fieldsToRewrite).length === 0) {
      setIsRewritingFields(false);
      setSoloRewriteWarning(null);
      return;
    }

    try {
      const customKey = StorageService.getCustomApiKey();
      const res = await postApiJson<any>(
        '/api/rewrite-fields-solo',
        { fields: fieldsToRewrite, keptSubjectLabel: keptLabel },
        { customKey }
      );

      const rewritten = res.rewrittenFields || {};
      const nextComps = { ...components };
      const nextOrig = originalComponents ? { ...originalComponents } : { ...components };

      for (const k of Object.keys(rewritten) as ComponentKey[]) {
        if (nextComps[k]) {
          nextComps[k] = {
            ...nextComps[k],
            detectedText: rewritten[k],
            userText: nextComps[k].state === 'edited' ? rewritten[k] : nextComps[k].userText,
            needsSoloRewrite: false,
          };
          nextOrig[k] = {
            ...nextOrig[k],
            detectedText: rewritten[k],
            needsSoloRewrite: false,
          };
        }
      }

      setComponents(nextComps);
      setOriginalComponents(nextOrig);
      setSoloRewriteWarning(null);
      triggerHaptic();
    } catch (err: any) {
      console.warn('Field rewrite failed:', err);
    } finally {
      setIsRewritingFields(false);
    }
  };

  // Phase 3: Checklist drawer handlers
  const handleToggleChecklistKey = (key: ComponentKey) => {
    setTickedComponentKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleFinishChecklist = () => {
    setIsChecklistStepOpen(false);
    if (!components) return;
    const next = { ...components };
    for (const key of ALL_COMPONENT_KEYS) {
      if (!tickedComponentKeys.includes(key) && next[key].state !== 'unavailable') {
        next[key] = { ...next[key], state: 'ignored' };
      } else if (tickedComponentKeys.includes(key) && next[key].state === 'ignored') {
        next[key] = { ...next[key], state: 'locked' };
      }
    }
    setComponents(next);

    if (activeSubjectDecision === 'solo') {
      const keptSubjId = selectedSubjectIds[0] || 'A';
      const keptSubj = detectedSubjects.find((s) => s.id === keptSubjId);
      const keptLabel = keptSubj ? keptSubj.label : `Subject ${keptSubjId}`;
      const ignoredSubjs = detectedSubjects.filter((s) => s.id !== keptSubjId);
      const ignoredLabels = ignoredSubjs.map((s) => s.label);

      const leakCheck = findIgnoredSubjectLeaks(next, ignoredLabels, keptLabel);
      if (leakCheck.hasLeaks) {
        setSoloRewriteWarning(
          `Selection contains ${leakCheck.leaks.length} component(s) with references to ignored subjects (${leakCheck.leaks.map((l) => l.label).join(', ')}). Click "Rewrite for Solo" to sanitize.`
        );
      }
    }
  };

  // Update a single component's state ('locked' | 'edited' | 'ignored' | 'unavailable')
  const handleUpdateComponentState = (key: ComponentKey, newState: ComponentState) => {
    triggerHaptic();
    setComponents((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        [key]: {
          ...prev[key],
          state: newState,
        },
      };
    });
    if (generatedMasterPrompt) {
      setHasUnbuiltChanges(true);
    }
  };

  // Update a single component's text (manual edit or saved profile replacement)
  const handleUpdateComponentText = (
    key: ComponentKey,
    newText: string,
    profileMeta?: { id?: string; name?: string }
  ) => {
    triggerHaptic();
    setComponents((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        [key]: {
          ...prev[key],
          userText: newText,
          source: profileMeta?.id ? 'saved_profile' : newText ? 'user_edit' : 'reference',
          selectedProfileId: profileMeta?.id,
          selectedProfileName: profileMeta?.name,
        },
      };
    });
    if (generatedMasterPrompt) {
      setHasUnbuiltChanges(true);
    }
  };

  // Restore all 13 components to original extracted image descriptions
  const handleRestoreAllOriginal = () => {
    if (!originalComponents) return;
    triggerHaptic();
    const restored: Record<ComponentKey, DetectedComponent> = {} as any;
    for (const k of ALL_COMPONENT_KEYS) {
      restored[k] = { ...originalComponents[k] };
    }
    setComponents(restored);
    if (generatedMasterPrompt) {
      setHasUnbuiltChanges(true);
    }
  };

  // Phase 4: Contradiction Check & Final Prompt Builder
  const buildAndSetFinalPrompt = (workingComponents: Record<ComponentKey, DetectedComponent>) => {
    let prompt = '';
    const options = {
      leadSentence: scannedLeadSentence,
      styleCategory: scannedStyleCategory,
      isSoloMode: activeSubjectDecision === 'solo',
      tickedKeys: tickedComponentKeys,
      subjects: detectedSubjects,
      subjectComponents: subjectComponents || undefined,
      activeSubjectDecision,
    };

    if (activeTool === 'general_extractor') {
      prompt = buildGeneralExtractorPrompt(workingComponents, outputRatio, options);
    } else if (activeTool === 'subject_swapping') {
      prompt = buildSubjectSwapPrompt(workingComponents, outputRatio);
    } else if (activeTool === 'camera_controller') {
      prompt = buildCameraControlPrompt(cameraSettings, workingComponents, outputRatio);
    }

    const neg = buildNegativePrompt(workingComponents);
    setGeneratedMasterPrompt(prompt);
    setGeneratedNegativePrompt(neg);
    setHasUnbuiltChanges(false);
    setIsContradictionModalOpen(false);
  };

  const handleGenerateFinalPrompt = () => {
    if (!components) return;
    triggerHaptic();

    // Leak Guard check in solo mode
    if (activeSubjectDecision === 'solo') {
      const keptSubjId = selectedSubjectIds[0] || 'A';
      const keptSubj = detectedSubjects.find((s) => s.id === keptSubjId);
      const keptLabel = keptSubj ? keptSubj.label : `Subject ${keptSubjId}`;
      const ignoredSubjs = detectedSubjects.filter((s) => s.id !== keptSubjId);
      const ignoredLabels = ignoredSubjs.map((s) => s.label);

      const leakCheck = findIgnoredSubjectLeaks(components, ignoredLabels, keptLabel);
      if (leakCheck.hasLeaks) {
        setSoloRewriteWarning(
          `Prompt blocked: ${leakCheck.leaks.length} component(s) (${leakCheck.leaks.map((l) => l.label).join(', ')}) contain references to ignored subjects. Click "Rewrite for Solo" to sanitize.`
        );
        return;
      }
    }

    // Perform deterministic contradiction check
    const issues = checkPromptContradictions(components, outputRatio, tickedComponentKeys);
    if (issues.length > 0) {
      setContradictionIssues(issues);
      setIsContradictionModalOpen(true);
      return;
    }

    buildAndSetFinalPrompt(components);
  };

  const handleDeepAiCheck = async () => {
    if (!generatedMasterPrompt) return;
    setIsPerformingDeepCheck(true);
    try {
      const customKey = StorageService.getCustomApiKey();
      const res = await postApiJson<{ success: boolean; check: { hasIssues: boolean; issues: ContradictionIssue[] } }>(
        '/api/check-prompt',
        { promptText: generatedMasterPrompt },
        { customKey }
      );
      if (res.check?.issues?.length) {
        setContradictionIssues((prev) => [...prev, ...res.check.issues]);
      }
    } catch (err) {
      console.warn('Deep AI Check notice:', err);
    } finally {
      setIsPerformingDeepCheck(false);
    }
  };

  const exportedPrompt = generatedMasterPrompt
    ? exportPromptForModel(generatedMasterPrompt, targetModel, outputRatio)
    : '';

  const promptCheck = generatedMasterPrompt ? checkPromptSafety(generatedMasterPrompt) : null;

  const handleApplySafetyFix = (orig: string, replacement: string) => {
    triggerHaptic();
    if (!components) return;
    const next = { ...components };
    for (const k of ALL_COMPONENT_KEYS) {
      const comp = next[k];
      const currentTxt = comp.state === 'edited' ? comp.userText : comp.detectedText;
      if (currentTxt && currentTxt.toLowerCase().includes(orig.toLowerCase())) {
        const updatedTxt = currentTxt.replace(new RegExp(orig, 'gi'), replacement);
        next[k] = {
          ...comp,
          userText: updatedTxt,
          state: 'edited',
          source: 'user_edit',
        };
      }
    }
    setComponents(next);

    if (generatedMasterPrompt) {
      let rebuilt = '';
      if (activeTool === 'general_extractor') {
        rebuilt = buildGeneralExtractorPrompt(next, outputRatio);
      } else if (activeTool === 'subject_swapping') {
        rebuilt = buildSubjectSwapPrompt(next, outputRatio);
      } else {
        rebuilt = buildCameraControlPrompt(cameraSettings, next, outputRatio);
      }
      setGeneratedMasterPrompt(rebuilt);
      setHasUnbuiltChanges(false);
    }
  };

  // Save Project / Blueprint to IndexedDB + LocalStorage
  const handleSaveBlueprint = async () => {
    if (!components) return;
    triggerHaptic();

    const title =
      projectTitleInput.trim() ||
      (referenceImage?.name
        ? `Project (${referenceImage.name.replace(/\.[^.]+$/, '')})`
        : `Project (${new Date().toLocaleTimeString()})`);

    let currentFinal = generatedMasterPrompt;
    if (!currentFinal) {
      if (activeTool === 'general_extractor') {
        currentFinal = buildGeneralExtractorPrompt(components, outputRatio);
      } else if (activeTool === 'subject_swapping') {
        currentFinal = buildSubjectSwapPrompt(components, outputRatio);
      } else {
        currentFinal = buildCameraControlPrompt(cameraSettings, components, outputRatio);
      }
    }

    const imageIds: string[] = [];
    if (referenceImage) {
      await ImageDB.saveImage(referenceImage.id, referenceImage.previewUrl, referenceImage.mimeType);
      imageIds.push(referenceImage.id);
    }

    const blueprint: ReferenceBlueprint = {
      id: 'blueprint_' + Date.now(),
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      toolType: activeTool,
      referenceThumbnails: referenceImage ? [referenceImage.previewUrl] : [],
      referenceImageIds: imageIds,
      subjectProfileId: activeProfile.id,
      masterSubject: activeProfile.masterSubject,
      masterBody: activeProfile.masterBody,
      outfitId: activeOutfit?.id,
      masterOutfit: activeOutfit,
      originalComponents: originalComponents || components,
      components,
      cameraSettings,
      outputRatio,
      finalPrompt: currentFinal || '',
      negativePrompt: generatedNegativePrompt || buildNegativePrompt(components),
      targetModel,
    };

    StorageService.saveBlueprint(blueprint);
    setSavedBlueprintNotice('Project saved to Projects! You can reopen, rename, or duplicate it anytime.');
    setTimeout(() => setSavedBlueprintNotice(null), 3500);
  };

  // Save Camera Angle Controller Project (11-Component Camera Reference Analysis)
  const handleSaveCameraProject = async (currentPrompt: string) => {
    if (!cameraReferenceState) return;
    triggerHaptic();

    const title =
      projectTitleInput.trim() ||
      (referenceImage?.name
        ? `Camera Setup (${referenceImage.name.replace(/\.[^.]+$/, '')})`
        : `Camera Setup (${new Date().toLocaleTimeString()})`);

    const imageIds: string[] = [];
    if (referenceImage) {
      await ImageDB.saveImage(
        referenceImage.id,
        referenceImage.previewUrl,
        referenceImage.mimeType
      );
      imageIds.push(referenceImage.id);
    }

    const blueprint: ReferenceBlueprint = {
      id: 'blueprint_' + Date.now(),
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      toolType: 'camera_controller',
      referenceThumbnails: referenceImage ? [referenceImage.previewUrl] : [],
      referenceImageIds: imageIds,
      subjectProfileId: activeProfile.id,
      masterSubject: activeProfile.masterSubject,
      masterBody: activeProfile.masterBody,
      originalComponents: originalComponents || ({} as any),
      components: components || ({} as any),
      cameraSettings,
      cameraReferenceState,
      outputRatio: cameraReferenceState.outputRatio || '3:4',
      finalPrompt: currentPrompt || '',
      targetModel,
    };

    StorageService.saveBlueprint(blueprint);
    setSavedBlueprintNotice(
      'Camera Angle Controller project saved to Projects! You can reopen or duplicate it anytime.'
    );
    setTimeout(() => setSavedBlueprintNotice(null), 3500);
  };

  // Load saved project from Projects tab
  const handleLoadBlueprint = async (blueprint: ReferenceBlueprint) => {
    triggerHaptic();
    if (blueprint.toolType && blueprint.toolType !== 'camera_controller') {
      setActiveTool(blueprint.toolType);
      StorageService.setActiveTool(blueprint.toolType);
    }
    if (blueprint.toolType === 'perspective_playboard') {
      setOutputRatio(blueprint.outputRatio || '3:4');
      setProjectTitleInput(blueprint.title || '');
      setTargetModel(blueprint.targetModel || 'universal');
      setActiveNav('tools');
      setIsWorkspaceOpen(true);
      return;
    }
    if (blueprint.components && Object.keys(blueprint.components).length > 0) {
      setComponents(blueprint.components);
      setOriginalComponents(blueprint.originalComponents || blueprint.components);
    }
    if (blueprint.cameraSettings) {
      setCameraSettings(blueprint.cameraSettings);
    }
    if (blueprint.cameraReferenceState) {
      setCameraReferenceState(blueprint.cameraReferenceState);
      setCameraGeneratedPrompt(blueprint.finalPrompt || null);
      setCameraHasUnbuiltChanges(false);
    }
    if (blueprint.toolType === 'camera_controller' || blueprint.cameraReferenceState) {
      openCameraInCurrentTab('extractor');
      return;
    }
    setOutputRatio(blueprint.outputRatio || '3:4');
    setProjectTitleInput(blueprint.title || '');
    setTargetModel(blueprint.targetModel || 'universal');
    setGeneratedMasterPrompt(blueprint.finalPrompt || null);
    setGeneratedNegativePrompt(blueprint.negativePrompt || '');
    setHasUnbuiltChanges(false);

    // Restore reference image from IndexedDB or thumbnail
    if (blueprint.referenceImageIds?.[0]) {
      const storedDataUrl = await ImageDB.getImage(blueprint.referenceImageIds[0]);
      if (storedDataUrl) {
        const base64 = storedDataUrl.split(',')[1] || '';
        setReferenceImage({
          id: blueprint.referenceImageIds[0],
          data: base64,
          mimeType: 'image/jpeg',
          previewUrl: storedDataUrl,
          name: blueprint.title,
        });
      }
    } else if (blueprint.referenceThumbnails?.[0]) {
      const thumbUrl = blueprint.referenceThumbnails[0];
      const base64 = thumbUrl.split(',')[1] || '';
      setReferenceImage({
        id: 'img_restored_' + Date.now(),
        data: base64,
        mimeType: 'image/jpeg',
        previewUrl: thumbUrl,
        name: blueprint.title,
      });
    }

    setActiveNav('tools');
    setIsWorkspaceOpen(true);
  };

  // Copy prompt
  const handleCopyPrompt = () => {
    triggerHaptic();
    navigator.clipboard.writeText(exportedPrompt);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Download prompt file
  const handleDownloadPrompt = () => {
    triggerHaptic();
    const contentToSave = showNegativePrompt && generatedNegativePrompt
      ? `${exportedPrompt}\n\nNEGATIVE PROMPT:\n${generatedNegativePrompt}`
      : exportedPrompt;
    const blob = new Blob([contentToSave], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my_whisk_ai_prompt_${outputRatio.replace(':', 'x')}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Count component status summary
  const componentCounts = components
    ? ALL_COMPONENT_KEYS.reduce(
        (acc, k) => {
          const c = components[k];
          if (!c) return acc;
          if (c.state === 'unavailable') acc.unavailable++;
          else if (c.state === 'ignored') acc.ignored++;
          else if (c.state === 'edited') acc.edited++;
          else acc.locked++;
          return acc;
        },
        { locked: 0, edited: 0, ignored: 0, unavailable: 0 }
      )
    : { locked: 0, edited: 0, ignored: 0, unavailable: 0 };

  return (
    <div className="min-h-screen text-[#f3f4f8] flex flex-col justify-between selection:bg-[#f5c518] selection:text-black">
      {/* Hidden single image file input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {isDedicatedCameraView ? (
        <div className="fixed inset-0 h-[100dvh] w-screen overflow-hidden bg-slate-950 flex flex-col z-50">
          {cameraToolMode === 'playboard' ? (
            <CameraPlayboardStudio
              onBackToMain={handleExitCameraRoute}
              subMode={cameraToolMode}
              onSubModeChange={(mode) => {
                setCameraToolMode(mode);
                const url =
                  mode === 'extractor'
                    ? '/camera-controller?mode=extractor'
                    : '/camera-controller';
                window.history.replaceState({ dedicatedCamera: true }, '', url);
              }}
            />
          ) : (
            <div className="flex flex-col h-full w-full bg-[#07080c] overflow-hidden">
              {/* Compact Header for Reference Image Extractor Mode */}
              <header className="flex-none h-12 sm:h-13 px-2.5 sm:px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 z-30">
                <div className="flex items-center gap-2 min-w-0">
                  <a
                    href="/"
                    onClick={(e) => {
                      e.preventDefault();
                      handleExitCameraRoute();
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-[#f5c518]" />
                    <span>MyWhisk</span>
                  </a>
                  <div className="h-4 w-px bg-slate-800 shrink-0" />
                  <h1 className="text-xs sm:text-sm font-bold text-white truncate">
                    Camera Angle Controller
                  </h1>
                </div>

                <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setCameraToolMode('playboard');
                      window.history.replaceState(
                        { dedicatedCamera: true },
                        '',
                        '/camera-controller'
                      );
                    }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-400 hover:text-white transition cursor-pointer"
                  >
                    3D Playboard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCameraToolMode('extractor');
                      window.history.replaceState(
                        { dedicatedCamera: true },
                        '',
                        '/camera-controller?mode=extractor'
                      );
                    }}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#f5c518] text-black transition cursor-pointer"
                  >
                    Ref Image
                  </button>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto p-3 sm:p-6 max-w-6xl w-full mx-auto">
                <CameraAngleController
                  referenceImage={referenceImage}
                  onSelectReferenceFile={setSingleReferenceFile}
                  onClearReferenceImage={() => {
                    setReferenceImage(null);
                    setCameraReferenceState(null);
                    setCameraGeneratedPrompt(null);
                    setCameraHasUnbuiltChanges(false);
                  }}
                  onTriggerFileDialog={() => fileInputRef.current?.click()}
                  cameraState={cameraReferenceState}
                  onUpdateCameraState={setCameraReferenceState}
                  generatedPrompt={cameraGeneratedPrompt}
                  onSetGeneratedPrompt={setCameraGeneratedPrompt}
                  hasUnbuiltChanges={cameraHasUnbuiltChanges}
                  onSetHasUnbuiltChanges={setCameraHasUnbuiltChanges}
                  targetModel={targetModel}
                  onSetTargetModel={setTargetModel}
                  projectTitleInput={projectTitleInput}
                  onSetProjectTitleInput={setProjectTitleInput}
                  onSaveProject={handleSaveCameraProject}
                  savedBlueprintNotice={savedBlueprintNotice}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Compact 3-Zone Studio Top Bar */}
          <header className="sticky top-0 z-40 h-14 bg-[#07090e]/95 border-b border-white/[0.08] px-4">
            <div className="max-w-6xl mx-auto h-full flex items-center justify-between gap-6">
              {/* Zone 1: Brand Wordmark */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic();
                  setActiveNav('tools');
                  setIsWorkspaceOpen(false);
                }}
                className="flex items-center gap-2.5 text-left cursor-pointer shrink-0 group"
              >
                <div className="w-8 h-8 rounded-lg bg-[#f5c518] flex items-center justify-center text-black shrink-0">
                  <Sparkles className="w-4 h-4 stroke-[2.4]" />
                </div>
                <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white whitespace-nowrap group-hover:text-[#f5c518] transition-colors">
                  My Whisk <span className="text-[#f5c518]">AI</span>
                </span>
              </button>

              {/* Zone 2: Concise Primary Navigation (Desktop) */}
              <nav
                aria-label="Primary studio sections"
                className="hidden md:flex items-center gap-6"
              >
                {(
                  [
                    { id: 'tools', label: 'Studio Hub' },
                    { id: 'profiles', label: 'Profiles' },
                    { id: 'projects', label: 'Projects' },
                  ] as const
                ).map((item) => {
                  const isActive = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        triggerHaptic();
                        setActiveNav(item.id);
                        if (item.id === 'tools') setIsWorkspaceOpen(false);
                      }}
                      className={`relative py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <span>{item.label}</span>
                      {isActive && (
                        <span className="absolute left-0 right-0 -bottom-[15px] h-0.5 bg-[#f5c518] rounded-full" />
                      )}
                    </button>
                  );
                })}
              </nav>

              {/* Zone 3: Single Primary Action */}
              <div className="flex items-center shrink-0">
                {activeNav === 'tools' && isWorkspaceOpen ? (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      setIsWorkspaceOpen(false);
                    }}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-zinc-100 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-[#f5c518]" />
                    <span>Studio Hub</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSelectTool('perspective_playboard')}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>3D Playboard</span>
                  </button>
                )}
              </div>
            </div>
          </header>

          {/* Main Container */}
          <main
            className={`flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6 ${
              !isWorkspaceOpen || activeNav !== 'tools' ? 'pb-24 md:pb-12' : 'pb-10'
            }`}
          >
            {/* TAB 1: STUDIO HUB & DEDICATED WORKSPACES */}
            {activeNav === 'tools' && !isWorkspaceOpen && (
              <div className="space-y-6">
                {/* Concise Studio Hub Hero */}
                <section className="studio-panel rounded-2xl p-5 sm:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  <div className="space-y-2 max-w-2xl">
                    <div className="text-xs font-mono text-[#f5c518] tracking-wide">
                      My Whisk AI · Prompt Engineering &amp; Camera Control Studio
                    </div>
                    <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-tight">
                      Structured Prompt &amp; Perspective Control
                    </h1>
                    <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                      Deconstruct reference photography into editable visual blueprints, swap subject identities, extract lens perspective, or frame virtual camera angles in 3D.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-2.5 shrink-0">
                    <PWAInstallButton variant="banner" />
                    <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
                      <span>{StorageService.getProfiles().length} Profiles</span>
                      <span aria-hidden="true">·</span>
                      <span>{StorageService.getBlueprints().length} Saved Projects</span>
                    </div>
                  </div>
                </section>

                {/* 5 Specialized Tool Launch Cards */}
                <section aria-label="Creative studio tools" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-bold text-white tracking-tight">
                      Select a Workspace
                    </h2>
                    <span className="text-xs text-zinc-500">Tap any tool to open its workspace</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {(
                      [
                        {
                          id: 'general_extractor',
                          index: '01',
                          tag: '13-Component Extraction',
                          title: 'General Prompt Extractor',
                          desc: 'Analyze any image into 13 grounded visual fields, filter or edit details, merge saved profiles, and compile clean prompts.',
                          icon: FileSearch,
                        },
                        {
                          id: 'subject_swapping',
                          index: '02',
                          tag: 'Identity Transfer',
                          title: 'Swap Studio',
                          desc: 'Deterministic multi-image subject replacement using locked recipes, 4 slot controls, and Source Matrix switches.',
                          icon: UserCheck,
                        },
                        {
                          id: 'perspective_playboard',
                          index: '03',
                          tag: 'Interactive 3D Camera',
                          title: '3D Perspective Playboard',
                          desc: 'Orbit a virtual camera around a fixed 3D subject, lock framing and focal length, and compile a 9-section camera prompt.',
                          icon: Compass,
                        },
                        {
                          id: 'camera_ai',
                          index: '04',
                          tag: 'Optical Re-Shoot',
                          title: 'Camera AI',
                          desc: "Extract a template photo's elevation, azimuth, distance, and optics to re-shoot your own image from that camera angle.",
                          icon: Sliders,
                        },
                        {
                          id: 'camera_controller',
                          index: '05',
                          tag: 'Full-Screen Studio',
                          title: 'Camera Angle Controller',
                          desc: 'Dedicated full-screen 3D pose & camera rig workspace for multi-angle staging and reference camera breakdown.',
                          icon: Camera,
                        },
                      ] as const
                    ).map((tool) => {
                      const Icon = tool.icon;
                      if (tool.id === 'camera_controller') {
                        return (
                          <div
                            key={tool.id}
                            className="studio-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 hover:border-[#f5c518]/45 transition-colors"
                          >
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-9 h-9 rounded-xl bg-[#f5c518]/12 border border-[#f5c518]/30 flex items-center justify-center text-[#f5c518] shrink-0">
                                    <Icon className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <div className="text-[11px] font-mono text-zinc-400">
                                      {tool.index} · {tool.tag}
                                    </div>
                                    <h3 className="font-display text-sm sm:text-base font-bold text-white">
                                      {tool.title}
                                    </h3>
                                  </div>
                                </div>
                              </div>
                              <p className="text-xs text-zinc-400 leading-relaxed">{tool.desc}</p>
                            </div>

                            <div className="flex items-center gap-2 pt-3 border-t border-white/[0.07]">
                              <a
                                href="/camera-controller"
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => handleCameraNewTabLaunch('playboard')}
                                className="flex-1 min-h-[42px] px-3.5 py-2 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                              >
                                <span>Launch New Tab</span>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                              </a>
                              <button
                                type="button"
                                onClick={() => openCameraInCurrentTab('playboard')}
                                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/10 text-xs font-semibold transition cursor-pointer whitespace-nowrap"
                              >
                                Open Here
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => handleSelectTool(tool.id)}
                          className="studio-card hover:border-[#f5c518]/50 hover:bg-[#151a26] rounded-2xl p-4 sm:p-5 text-left flex flex-col justify-between gap-4 transition-all cursor-pointer group"
                        >
                          <div className="space-y-2.5 w-full">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-9 h-9 rounded-xl bg-[#f5c518]/12 border border-[#f5c518]/30 flex items-center justify-center text-[#f5c518] shrink-0 group-hover:bg-[#f5c518] group-hover:text-black transition-colors">
                                  <Icon className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[11px] font-mono text-zinc-400 truncate">
                                    {tool.index} · {tool.tag}
                                  </div>
                                  <h3 className="font-display text-sm sm:text-base font-bold text-white group-hover:text-[#f5c518] transition-colors truncate">
                                    {tool.title}
                                  </h3>
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-zinc-400 leading-relaxed">{tool.desc}</p>
                          </div>

                          <div className="w-full pt-3 border-t border-white/[0.07] flex items-center justify-between text-xs font-semibold text-zinc-300 group-hover:text-[#f5c518] transition-colors">
                            <span>Open Workspace</span>
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Graceful Popup Restriction Fallback Banner */}
                  {popupFallbackBanner && (
                    <div className="p-3.5 rounded-xl bg-[#111726] border border-[#f5c518]/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="text-xs text-zinc-200">
                        <span className="font-bold text-white">
                          Camera Angle Controller launched in a new tab.
                        </span>{' '}
                        If popups are blocked on mobile, open it directly in this tab:
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openCameraInCurrentTab('playboard')}
                          className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold transition cursor-pointer"
                        >
                          Open in Current Tab
                        </button>
                        <button
                          type="button"
                          onClick={() => setPopupFallbackBanner(false)}
                          className="min-h-[38px] px-2.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-white cursor-pointer"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* Recent Saved Projects Quick Resume */}
                {(() => {
                  const recentBlueprints = StorageService.getBlueprints().slice(0, 3);
                  if (recentBlueprints.length === 0) return null;
                  return (
                    <section aria-label="Recent saved projects" className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="font-display text-sm font-bold text-white tracking-tight">
                          Recent Projects
                        </h2>
                        <button
                          type="button"
                          onClick={() => setActiveNav('projects')}
                          className="text-xs font-semibold text-[#f5c518] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>View All</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {recentBlueprints.map((bp) => (
                          <button
                            key={bp.id}
                            type="button"
                            onClick={() => handleLoadBlueprint(bp)}
                            className="studio-card hover:border-[#f5c518]/45 rounded-2xl p-3.5 text-left flex items-center gap-3 transition-colors cursor-pointer"
                          >
                            {bp.referenceThumbnails?.[0] ? (
                              <img
                                src={bp.referenceThumbnails[0]}
                                alt={bp.title}
                                className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-zinc-400 shrink-0">
                                <Layers className="w-4 h-4" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="font-display text-xs font-bold text-white truncate">
                                {bp.title}
                              </div>
                              <div className="text-[11px] font-mono text-zinc-400 mt-0.5 truncate tabular-nums">
                                {bp.outputRatio} · {new Date(bp.updatedAt || bp.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })()}
              </div>
            )}

            {/* DEDICATED WORKSPACE VIEW */}
            {activeNav === 'tools' && isWorkspaceOpen && (
              <div className="space-y-5">
                {/* Workspace Switcher Bar */}
                <div className="studio-panel rounded-2xl p-2.5 sm:px-3.5 flex flex-wrap items-center justify-between gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      setIsWorkspaceOpen(false);
                    }}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-zinc-100 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-[#f5c518]" />
                    <span>Studio Hub</span>
                  </button>

                  {/* Quick Switcher between the 4 Workspace Tools */}
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full">
                    {(
                      [
                        { id: 'general_extractor', label: 'Extractor' },
                        { id: 'subject_swapping', label: 'Swap Studio' },
                        { id: 'perspective_playboard', label: '3D Playboard' },
                        { id: 'camera_ai', label: 'Camera AI' },
                      ] as const
                    ).map((t) => {
                      const active = activeTool === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleSelectTool(t.id)}
                          className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 ${
                            active
                              ? 'bg-[#f5c518] text-black font-bold'
                              : 'text-zinc-400 hover:text-white hover:bg-white/[0.06]'
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Render Dedicated Workspace for Active Tool */}
                {(activeTool as string) === 'subject_swapping' ? (
                  <SwapStudio
                    optimizeImageFile={optimizeImageFile}
                    onOpenProjects={() => setActiveNav('projects')}
                  />
                ) : (activeTool as string) === 'camera_ai' ? (
                  <CameraAI
                    optimizeImageFile={optimizeImageFile}
                    onOpenProjects={() => setActiveNav('projects')}
                  />
                ) : (activeTool as string) === 'perspective_playboard' ? (
                  <PerspectivePlayboard
                    optimizeImageFile={optimizeImageFile}
                    onOpenProjects={() => setActiveNav('projects')}
                  />
                ) : (
                  <GeneralExtractorWorkspace
                    activeTool={activeTool}
                    referenceImage={referenceImage}
                    isDragging={isDragging}
                    setIsDragging={setIsDragging}
                    onFileDrop={handleFileDrop}
                    onOpenFilePicker={() => fileInputRef.current?.click()}
                    onClearReference={() => {
                      setReferenceImage(null);
                      setComponents(null);
                      setOriginalComponents(null);
                      setGeneratedMasterPrompt(null);
                    }}
                    isScanning={isScanning}
                    scanStageIndex={scanStageIndex}
                    scanError={scanError}
                    fallbackNotice={fallbackNotice}
                    onScanReference={handleScanReference}
                    isQuotaFallback={isQuotaFallback}
                    quotaFallbackAcknowledged={quotaFallbackAcknowledged}
                    onAcknowledgeQuotaFallback={() => setQuotaFallbackAcknowledged(true)}
                    lowVisibilityError={lowVisibilityError}
                    hasMultiSnapshotReady={Boolean(
                      multiCanonicalSnapshot && multiCanonicalSnapshot.visibleCount >= 3
                    )}
                    onConsiderAllSubjects={handleConsiderAllSubjects}
                    onContinueManuallyAfterLowVis={() => {
                      setLowVisibilityError(null);
                      if (components) {
                        const manualComps = { ...components };
                        for (const k of ALL_COMPONENT_KEYS) {
                          if (manualComps[k]?.state === 'unavailable') {
                            manualComps[k] = {
                              ...manualComps[k],
                              state: 'edited',
                              visibility: 'visible',
                            };
                          }
                        }
                        setComponents(manualComps);
                      }
                    }}
                    isDebugEnabled={isDebugEnabled}
                    onToggleDebug={handleToggleDebug}
                    scanDebugReport={scanDebugReport}
                    isDebugPanelOpen={isDebugPanelOpen}
                    onToggleDebugPanelOpen={() => setIsDebugPanelOpen((prev) => !prev)}
                    debugCopyFeedback={debugCopyFeedback}
                    onCopyDebugReport={handleCopyDebugReport}
                    soloRewriteWarning={soloRewriteWarning}
                    isRewritingFields={isRewritingFields}
                    onRewriteFieldsSolo={handleRewriteFieldsSolo}
                    components={components}
                    componentCounts={componentCounts}
                    scanSummary={scanSummary}
                    detectedSubjects={detectedSubjects}
                    activeSubjectDecision={activeSubjectDecision}
                    onOpenMultiSubjectModal={() => setIsMultiSubjectModalOpen(true)}
                    tickedComponentKeys={tickedComponentKeys}
                    onOpenChecklistModal={() => setIsChecklistStepOpen(true)}
                    onRestoreAllOriginal={handleRestoreAllOriginal}
                    projectTitleInput={projectTitleInput}
                    onChangeProjectTitleInput={setProjectTitleInput}
                    onSaveBlueprint={handleSaveBlueprint}
                    savedBlueprintNotice={savedBlueprintNotice}
                    outputRatio={outputRatio}
                    ratioExplanation={ratioExplanation}
                    onChangeOutputRatio={(ratio) => {
                      triggerHaptic();
                      setOutputRatio(ratio);
                      if (generatedMasterPrompt) setHasUnbuiltChanges(true);
                    }}
                    sceneFilter={sceneFilter}
                    onChangeSceneFilter={(filter) => {
                      triggerHaptic();
                      setSceneFilter(filter);
                    }}
                    sceneAccordionGroups={SCENE_ACCORDION_GROUPS}
                    openSceneGroups={openSceneGroups}
                    onToggleSceneGroup={(groupId) => {
                      triggerHaptic();
                      setOpenSceneGroups((prev) => ({
                        ...prev,
                        [groupId]: !(prev[groupId] !== false),
                      }));
                    }}
                    onExpandAllGroups={() =>
                      setOpenSceneGroups({
                        identity_pose: true,
                        camera_framing: true,
                        wardrobe_scene: true,
                        expression_gestures: true,
                      })
                    }
                    onCollapseAllGroups={() =>
                      setOpenSceneGroups({
                        identity_pose: false,
                        camera_framing: false,
                        wardrobe_scene: false,
                        expression_gestures: false,
                      })
                    }
                    onUpdateComponentState={handleUpdateComponentState}
                    onUpdateComponentText={handleUpdateComponentText}
                    onApplyBackgroundBundle={handleApplyBackgroundBundle}
                    generatedMasterPrompt={generatedMasterPrompt}
                    exportedPrompt={exportedPrompt}
                    hasUnbuiltChanges={hasUnbuiltChanges}
                    onGenerateFinalPrompt={handleGenerateFinalPrompt}
                    targetModel={targetModel}
                    onSetTargetModel={setTargetModel}
                    showNegativePrompt={showNegativePrompt}
                    onSetShowNegativePrompt={setShowNegativePrompt}
                    generatedNegativePrompt={generatedNegativePrompt}
                    onSetGeneratedNegativePrompt={setGeneratedNegativePrompt}
                    promptCheck={promptCheck}
                    onApplySafetyFix={handleApplySafetyFix}
                    onCopyPrompt={handleCopyPrompt}
                    onDownloadPrompt={handleDownloadPrompt}
                    copyFeedback={copyFeedback}
                  />
                )}
              </div>
            )}

            {/* TAB 2: PROFILES */}
            {activeNav === 'profiles' && (
              <ProfileManager
                activeProfileId={activeProfile.id}
                onSelectProfile={handleSelectProfile}
                activeOutfitId={activeOutfit.id}
                onSelectOutfit={handleSelectOutfit}
              />
            )}

            {/* TAB 3: PROJECTS */}
            {activeNav === 'projects' && (
              <BlueprintProjects onLoadBlueprint={handleLoadBlueprint} />
            )}
          </main>

          {/* Clean Footer (Hidden in dedicated tool workspaces on mobile to prioritize content) */}
          <footer className="hidden md:block border-t border-white/[0.07] bg-[#07090e] py-5 px-4 text-xs text-zinc-500">
            <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-zinc-300">My Whisk AI</span>
                <span aria-hidden="true">·</span>
                <span>Visual Prompt &amp; Camera Reference Studio</span>
              </div>
              <div className="text-[11px] font-mono text-zinc-500">
                Local-first profiles &amp; projects storage
              </div>
            </div>
          </footer>

          {/* Thumb-Friendly Mobile Bottom Navigation (Hidden inside open tool workspaces to avoid stacking) */}
          {(!isWorkspaceOpen || activeNav !== 'tools') && (
            <nav
              aria-label="Mobile navigation"
              className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 pb-safe-nav bg-[#0a0d14]/95 border-t border-white/[0.09] px-2 flex items-center justify-around"
            >
              {(
                [
                  { id: 'tools', label: 'Studio Hub', icon: Wrench },
                  { id: 'profiles', label: 'Profiles', icon: Users },
                  { id: 'projects', label: 'Projects', icon: FolderKanban },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      setActiveNav(item.id);
                      if (item.id === 'tools') setIsWorkspaceOpen(false);
                    }}
                    className={`min-h-[44px] flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition cursor-pointer ${
                      active ? 'text-[#f5c518]' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => handleSelectTool('perspective_playboard')}
                className="min-h-[44px] flex-1 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-zinc-300 hover:text-[#f5c518] transition cursor-pointer"
              >
                <Compass className="w-4 h-4 text-[#f5c518]" />
                <span>3D Rig</span>
              </button>
            </nav>
          )}

          {/* Multi-Subject Decision Bottom Sheet / Modal */}
          <BottomSheet
            isOpen={isMultiSubjectModalOpen}
            onClose={() => setIsMultiSubjectModalOpen(false)}
            title={`Multiple Subjects Detected (${detectedSubjects.length})`}
            subtitle="Choose how to structure the extracted prompt blueprint"
            icon={<Users className="w-4 h-4" />}
          >
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleConsiderAllSubjects}
                className="w-full min-h-[56px] p-4 rounded-xl bg-[#f5c518]/12 hover:bg-[#f5c518]/18 border border-[#f5c518]/45 text-left transition space-y-1 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 font-bold text-sm text-[#f5c518]">
                  <span>Consider all subjects in scene</span>
                  <span className="text-xs font-mono">Multi-Subject</span>
                </div>
                <p className="text-xs text-zinc-300">
                  Keeps spatial relationships, interaction, and descriptions for all detected people.
                </p>
              </button>

              <div className="text-xs font-semibold text-zinc-400 pt-1">
                Or isolate one subject (Solo Mode):
              </div>

              {detectedSubjects.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  onClick={() => handleSelectSoloSubject(subject.id)}
                  className="w-full min-h-[52px] p-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-left transition flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#161b28] flex items-center justify-center font-bold text-xs text-[#f5c518] border border-white/10 shrink-0">
                      {subject.id}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-white truncate">{subject.label}</div>
                      <div className="text-[11px] text-zinc-400 capitalize">
                        {subject.prominence} subject
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[#f5c518] shrink-0">
                    Keep Subject {subject.id}
                  </span>
                </button>
              ))}
            </div>
          </BottomSheet>

          {/* Tick-box Component Selection Checklist Bottom Sheet */}
          <BottomSheet
            isOpen={isChecklistStepOpen}
            onClose={() => setIsChecklistStepOpen(false)}
            title="Visible & Relevant Component Selection"
            subtitle="Choose which extracted components to include in the final prompt"
            icon={<ListChecks className="w-4 h-4" />}
            maxWidth="max-w-2xl"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-zinc-400 tabular-nums">
                  {tickedComponentKeys.length} / {ALL_COMPONENT_KEYS.length} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTickedComponentKeys([...ALL_COMPONENT_KEYS])}
                    className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-[#f5c518] bg-[#f5c518]/12 hover:bg-[#f5c518]/20 rounded-lg transition cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setTickedComponentKeys([])}
                    className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg transition cursor-pointer"
                  >
                    Select None
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                {ALL_COMPONENT_KEYS.map((key) => {
                  const item = components?.[key];
                  const isUnavailable =
                    item?.state === 'unavailable' || item?.visibility === 'unavailable';
                  const isPartial = item?.visibility === 'partial';
                  const isChecked = tickedComponentKeys.includes(key);

                  if (isUnavailable) return null;

                  return (
                    <label
                      key={key}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer ${
                        isChecked
                          ? 'bg-[#f5c518]/10 border-[#f5c518]/40'
                          : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleChecklistKey(key)}
                        className="mt-1 accent-[#f5c518] w-4 h-4 rounded cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-white">
                            {COMPONENT_LABELS[key]}
                          </span>
                          {isPartial && (
                            <span className="text-[11px] font-mono text-amber-300">
                              Partial visibility
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 line-clamp-2 mt-0.5">
                          {item?.userText || item?.detectedText || 'No description extracted.'}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {components && (
                <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <span className="text-[11px] font-mono text-zinc-500">
                    {ALL_COMPONENT_KEYS.filter((k) => components[k]?.state === 'unavailable').length}{' '}
                    unavailable in frame (excluded)
                  </span>
                  <button
                    type="button"
                    onClick={handleFinishChecklist}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs transition cursor-pointer"
                  >
                    Continue with Selected Components
                  </button>
                </div>
              )}
            </div>
          </BottomSheet>

          {/* Contradiction Check Bottom Sheet */}
          <BottomSheet
            isOpen={isContradictionModalOpen}
            onClose={() => setIsContradictionModalOpen(false)}
            title="Potential Prompt Contradictions"
            subtitle="Review detected conflicts before compiling your prompt"
            icon={<AlertTriangle className="w-4 h-4" />}
            maxWidth="max-w-xl"
          >
            <div className="space-y-4">
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {contradictionIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                      <span>
                        {issue.labelA} vs {issue.labelB}
                      </span>
                      <span className="font-mono text-[11px] text-amber-400/80">Conflict</span>
                    </div>
                    <p className="text-xs text-zinc-300">{issue.explanation}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (components && issue.fieldB) {
                            handleUpdateComponentState(issue.fieldB as ComponentKey, 'ignored');
                          }
                          setContradictionIssues((prev) => prev.filter((i) => i.id !== issue.id));
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold border border-amber-500/40 cursor-pointer"
                      >
                        Keep {issue.labelA} (Exclude {issue.labelB})
                      </button>
                      {issue.fieldA && (
                        <button
                          type="button"
                          onClick={() => {
                            if (components) {
                              handleUpdateComponentState(issue.fieldA as ComponentKey, 'ignored');
                            }
                            setContradictionIssues((prev) => prev.filter((i) => i.id !== issue.id));
                          }}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold border border-amber-500/40 cursor-pointer"
                        >
                          Keep {issue.labelB} (Exclude {issue.labelA})
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={handleDeepAiCheck}
                  disabled={isPerformingDeepCheck}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] text-white font-semibold text-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isPerformingDeepCheck ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#f5c518]" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-[#f5c518]" />
                  )}
                  <span>Deep AI Check</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsContradictionModalOpen(false)}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 font-semibold text-xs cursor-pointer"
                  >
                    Edit Fields
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsContradictionModalOpen(false);
                      if (components) buildAndSetFinalPrompt(components);
                    }}
                    className="min-h-[42px] px-5 py-2 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs transition cursor-pointer"
                  >
                    Proceed &amp; Generate
                  </button>
                </div>
              </div>
            </div>
          </BottomSheet>

          <OfflineIndicator />
        </>
      )}
    </div>
  );
}
