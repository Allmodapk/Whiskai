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
import { ComponentCard } from './components/ComponentCard';
import { ScanProgressPanel } from './components/ScanProgressPanel';
import { ProfileManager } from './components/ProfileManager';
import { BlueprintProjects } from './components/BlueprintProjects';
import { PromptCheckBanner } from './components/PromptCheckBanner';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { CameraAngleController } from './components/CameraAngleController';
import { CameraPlayboardStudio } from './components/CameraPlayboardStudio';
import { ReferenceViewfinder } from './components/ReferenceViewfinder';
import { FloatingPromptDock } from './components/FloatingPromptDock';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench,
  Users,
  FolderKanban,
  Upload,
  Lock,
  Sparkles,
  Copy,
  Download,
  Check,
  RotateCcw,
  ShieldCheck,
  Plus,
  BookmarkPlus,
  Shirt,
  UserCheck,
  Camera,
  FileSearch,
  Image as ImageIcon,
  EyeOff,
  Loader2,
  Sliders,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ArrowLeft,
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

  // Main Navigation: Tools | Profiles | Projects
  const [activeNav, setActiveNav] = useState<'tools' | 'profiles' | 'projects'>('tools');

  // Active Tool inside Main Tools page:
  // 1. General Prompt Extractor ('general_extractor')
  // 2. Subject Swapping ('subject_swapping')
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

  const SCENE_ACCORDION_GROUPS: Array<{
    id: string;
    title: string;
    subtitle: string;
    codes: string;
    keys: ComponentKey[];
  }> = [
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

  // Execute 13-Component Grounded Image Analysis
  const handleScanReference = async () => {
    if (!referenceImage) {
      setScanError('Please upload a reference image to analyze.');
      return;
    }

    triggerHaptic();
    setIsScanning(true);
    setScanError(null);
    setFallbackNotice(null);
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
      };

      const data = await postApiJson<any>('/api/analyze-reference', payload, {
        customKey,
        timeoutMs: 45000,
        maxRetries: 2,
      });

      clearInterval(timer);
      setScanStageIndex(9);
      setFallbackNotice(typeof data.warning === 'string' && data.warning.trim() ? data.warning : null);

      const analysis = data.analysis || {};
      setScanSummary(analysis.summary || 'Reference analyzed into 13 grounded visual components.');
      setOutputRatio(analysis.outputRatio || '3:4');
      setRatioExplanation(analysis.ratioExplanation || '');

      // Populate Camera Angle Controller initial estimates from the analyzed image
      const est = analysis.cameraEstimates || {};
      const framingDetected = analysis.components?.framing?.detectedText || '';
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

      // Build all 13 components grounded strictly in the actual image (NO preset descriptions injected on scan)
      const originalSnap: Record<ComponentKey, DetectedComponent> = {} as any;
      const workingComps: Record<ComponentKey, DetectedComponent> = {} as any;

      for (const key of ALL_COMPONENT_KEYS) {
        const item = analysis.components?.[key];
        const visibility: 'visible' | 'partial' | 'unavailable' =
          item?.visibility === 'unavailable' ||
          (!item?.detectedText?.trim() && item?.visibility !== 'visible')
            ? 'unavailable'
            : item?.visibility === 'partial'
            ? 'partial'
            : 'visible';

        const detectedText = visibility === 'unavailable' ? '' : (item?.detectedText || '').trim();
        const initialState: ComponentState =
          visibility === 'unavailable' ? 'unavailable' : 'locked';

        const baseComp: DetectedComponent = {
          key,
          label: COMPONENT_LABELS[key],
          detectedText,
          userText: '',
          state: initialState,
          source: 'reference',
          explanation: item?.explanation || '',
          visibility,
        };

        originalSnap[key] = { ...baseComp };

        // If user is currently in Subject Swapping tool, pre-apply the selected replacement Subject & Body
        // while keeping originalSnap intact so the user can restore the original scanned subject anytime
        if (activeTool === 'subject_swapping' && (key === 'subject' || key === 'body')) {
          workingComps[key] = {
            ...baseComp,
            userText: key === 'subject' ? activeProfile.masterSubject : activeProfile.masterBody,
            state: 'edited',
            source: 'saved_profile',
            selectedProfileId: activeProfile.id,
            selectedProfileName: activeProfile.name,
          };
        } else {
          workingComps[key] = { ...baseComp };
        }
      }

      setOriginalComponents(originalSnap);
      setComponents(workingComps);
      setGeneratedMasterPrompt(null);
      setGeneratedNegativePrompt('');
      setHasUnbuiltChanges(false);
      setProjectTitleInput(
        referenceImage.name
          ? `${referenceImage.name.replace(/\.[^.]+$/, '')}`
          : `Analysis ${new Date().toLocaleDateString()}`
      );
      triggerHaptic();
    } catch (err: any) {
      clearInterval(timer);
      setFallbackNotice(null);
      setScanError(extractApiErrorMessage(err, 'Reference analysis could not be completed.'));
    } finally {
      setIsScanning(false);
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

  // Generate Final Prompt from CURRENT component field contents
  const handleGenerateFinalPrompt = () => {
    if (!components) return;
    triggerHaptic();

    let prompt = '';
    if (activeTool === 'general_extractor') {
      prompt = buildGeneralExtractorPrompt(components, outputRatio);
    } else if (activeTool === 'subject_swapping') {
      prompt = buildSubjectSwapPrompt(components, outputRatio);
    } else if (activeTool === 'camera_controller') {
      prompt = buildCameraControlPrompt(cameraSettings, components, outputRatio);
    }

    const neg = buildNegativePrompt(components);
    setGeneratedMasterPrompt(prompt);
    setGeneratedNegativePrompt(neg);
    setHasUnbuiltChanges(false);
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
          {/* Glassmorphic Spatial Pro Studio Top Header Bar */}
          <header className="sticky top-0 z-40 bg-[#06070b]/80 backdrop-blur-2xl border-b border-white/[0.08] px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#FFE169] via-[#F5C518] to-[#D49A00] flex items-center justify-center font-black text-black shadow-lg shadow-amber-500/20">
              <Sparkles className="w-4 h-4 text-black stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-extrabold text-sm sm:text-base tracking-tight text-white">
                  My Whisk <span className="text-[#f5c518]">AI</span>
                </span>
                <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                <span className="text-xs font-mono text-zinc-400 hidden sm:inline">
                  Spatial Optical Prompt Studio
                </span>
              </div>
            </div>
          </div>

          {/* Primary Top-Level Navigation: Tools | Profiles | Projects with Spring Pill + PWA Install */}
          <div className="flex items-center gap-2">
            <PWAInstallButton />
            <nav className="flex items-center gap-1 p-1 bg-black/50 backdrop-blur-xl border border-white/[0.09] rounded-xl">
              {(
                [
                  { id: 'tools', label: 'Tools', icon: Wrench },
                  { id: 'profiles', label: 'Profiles', icon: Users },
                  { id: 'projects', label: 'Projects', icon: FolderKanban },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      setActiveNav(item.id);
                    }}
                    className={`relative min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                      isActive ? 'text-black' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="primaryNavPill"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        className="absolute inset-0 rounded-lg bg-[#f5c518] shadow-sm shadow-amber-500/30"
                      />
                    )}
                    <Icon className="relative z-10 w-3.5 h-3.5" />
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 pb-28 space-y-6">
        {/* TAB 1: TOOLS */}
        {activeNav === 'tools' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* Three Tools Selector Bar inside Tools */}
            <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h1 className="font-display text-base sm:text-lg font-bold text-white tracking-tight">
                    Visual Analysis & Prompt Engineering Tools
                  </h1>
                  <p className="text-xs text-zinc-400">
                    Select a specialized optical tool below. Upload one reference image to extract grounded visual or camera parameters.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-300 bg-white/[0.04] border border-white/10 px-3 py-1.5 rounded-xl shrink-0">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Grounded Multimodal Vision</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(
                  [
                    {
                      id: 'general_extractor',
                      num: '01',
                      title: '1. General Prompt Extractor',
                      desc: 'Analyze one image into 13 detailed, editable visual components and combine with saved profiles.',
                      icon: FileSearch,
                    },
                    {
                      id: 'subject_swapping',
                      num: '02',
                      title: '2. Subject Swapping',
                      desc: 'Keep the reference pose, lighting, and scene while replacing the subject with a saved or uploaded identity.',
                      icon: UserCheck,
                    },
                    {
                      id: 'camera_controller',
                      num: '03',
                      title: '3. Camera Angle Controller',
                      desc: 'Opens in a dedicated full-screen workspace: 3D playboard for camera & pose simulation (T2I / I2I) and reference extraction.',
                      icon: Camera,
                    },
                  ] as const
                ).map((tool) => {
                  const Icon = tool.icon;
                  const isCameraTool = tool.id === 'camera_controller';
                  const isSelected = !isCameraTool && activeTool === tool.id;

                  if (isCameraTool) {
                    return (
                      <div
                        key={tool.id}
                        className="relative text-left p-4 rounded-2xl transition-all flex flex-col justify-between gap-3 glass-card hover:border-[#f5c518]/40 hover:bg-white/[0.06] overflow-hidden"
                      >
                        <a
                          href="/camera-controller"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => handleCameraNewTabLaunch('playboard')}
                          className="flex flex-col gap-2 cursor-pointer group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-display text-xs sm:text-sm font-bold text-white group-hover:text-[#f5c518] transition-colors flex items-center gap-2">
                              <Icon className="w-4 h-4 text-[#f5c518] shrink-0" />
                              <span>{tool.title}</span>
                            </span>
                            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-[#f5c518]/15 text-[#f5c518] border border-[#f5c518]/30 flex items-center gap-1 shrink-0">
                              <span>NEW TAB</span>
                              <ExternalLink className="w-3 h-3" />
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 leading-relaxed">{tool.desc}</p>
                        </a>

                        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/[0.08]">
                          <a
                            href="/camera-controller"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleCameraNewTabLaunch('playboard')}
                            className="flex-1 py-1.5 px-3 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
                          >
                            <span>🎮 3D Playboard Studio</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                          <button
                            type="button"
                            onClick={() => openCameraInCurrentTab('playboard')}
                            className="py-1.5 px-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white border border-white/10 text-[11px] font-semibold transition cursor-pointer"
                            title="Open full-screen in this tab"
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
                      className={`relative text-left p-4 rounded-2xl transition-all flex flex-col justify-between gap-2.5 cursor-pointer overflow-hidden ${
                        isSelected
                          ? 'glass-card-active'
                          : 'glass-card hover:border-white/20 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                          <Icon className="w-4 h-4 text-[#f5c518] shrink-0" />
                          <span>{tool.title}</span>
                        </span>
                        <span
                          className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                            isSelected
                              ? 'bg-[#f5c518] text-black font-bold'
                              : 'bg-white/[0.06] text-zinc-400'
                          }`}
                        >
                          {isSelected ? 'ACTIVE' : tool.num}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">{tool.desc}</p>
                    </button>
                  );
                })}
              </div>

              {/* Graceful Popup Restriction Fallback Banner */}
              {popupFallbackBanner && (
                <div className="p-3.5 rounded-xl bg-indigo-950/60 border border-indigo-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-indigo-200">
                    <span className="font-bold text-white">Camera Angle Controller launched in a new tab.</span>{' '}
                    If your browser blocked the new tab, you can open the full-screen controller directly in this tab:
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openCameraInCurrentTab('playboard')}
                      className="px-3.5 py-1.5 rounded-lg bg-[#f5c518] hover:bg-[#ffe169] text-black text-xs font-bold transition cursor-pointer"
                    >
                      Open in Current Tab →
                    </button>
                    <button
                      type="button"
                      onClick={() => setPopupFallbackBanner(false)}
                      className="px-2 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>

            <>
              {/* Tool-Specific Configuration Panel for Tool 2: Subject Swapping */}
                {activeTool === 'subject_swapping' && (
                  <div className="glass-panel rounded-2xl p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
                      <div>
                        <h2 className="font-display text-sm sm:text-base font-bold text-white">
                          Subject Swapping Configuration
                        </h2>
                        <p className="text-xs text-zinc-400">
                          Choose the replacement subject identity from your saved profiles or upload 1–5 photos of the replacement subject.
                        </p>
                      </div>

                      <div className="flex items-center gap-1 p-1 bg-black/40 border border-white/[0.08] rounded-xl">
                        <button
                          type="button"
                          onClick={() => setSwapSubjectSource('saved')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            swapSubjectSource === 'saved'
                              ? 'bg-[#f5c518] text-black font-bold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          Saved Subject Profile
                        </button>
                        <button
                          type="button"
                          onClick={() => setSwapSubjectSource('upload')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            swapSubjectSource === 'upload'
                              ? 'bg-[#f5c518] text-black font-bold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          Upload Subject Photos (1–5)
                        </button>
                      </div>
                    </div>

                    {swapSubjectSource === 'saved' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3.5 rounded-xl glass-card space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white">
                              Replacement Subject Profile
                            </span>
                            <button
                              type="button"
                              onClick={() => setActiveNav('profiles')}
                              className="text-xs text-[#f5c518] hover:underline font-medium cursor-pointer"
                            >
                              Manage Profiles
                            </button>
                          </div>
                          <select
                            value={activeProfile.id}
                            onChange={(e) => {
                              const found = StorageService.getProfileById(e.target.value);
                              if (found) handleSelectProfile(found);
                            }}
                            className="w-full bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white font-semibold outline-none focus:border-[#f5c518]"
                          >
                            {StorageService.getProfiles().map((p) => (
                              <option key={p.id} value={p.id} className="bg-[#0e111a]">
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] text-zinc-400 line-clamp-2">
                            {activeProfile.masterSubject}
                          </p>
                        </div>

                        <div className="p-3.5 rounded-xl glass-card space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white">
                              Optional Outfit Override
                            </span>
                            <span className="text-[11px] text-zinc-400">
                              Or keep scanned clothing below
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={activeOutfit.id}
                              onChange={(e) => {
                                const found = StorageService.getOutfitById(e.target.value);
                                if (found) setActiveOutfit(found);
                              }}
                              className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white font-semibold outline-none focus:border-[#f5c518]"
                            >
                              {StorageService.getOutfits().map((o) => (
                                <option key={o.id} value={o.id} className="bg-[#0e111a]">
                                  {o.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleSelectOutfit(activeOutfit)}
                              disabled={!components}
                              className="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-[#f5c518] border border-[#f5c518]/30 text-xs font-bold transition disabled:opacity-40 shrink-0 cursor-pointer"
                            >
                              Apply Outfit
                            </button>
                          </div>
                          <p className="text-[11px] text-zinc-400 line-clamp-2">
                            {activeOutfit.description}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl glass-card space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            Upload Replacement Subject Photos ({swapSubjectImages.length}/5)
                          </span>
                          <input
                            type="file"
                            ref={swapSubjectFileRef}
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handleSwapSubjectFiles}
                          />
                          {swapSubjectImages.length < 5 && (
                            <button
                              type="button"
                              onClick={() => swapSubjectFileRef.current?.click()}
                              className="text-xs font-bold text-[#f5c518] hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>Select Photos</span>
                            </button>
                          )}
                        </div>

                        {swapSubjectImages.length > 0 && (
                          <div className="grid grid-cols-5 gap-2">
                            {swapSubjectImages.map((img) => (
                              <div
                                key={img.id}
                                className="relative aspect-square rounded-lg overflow-hidden bg-black border border-white/15"
                              >
                                <img
                                  src={img.previewUrl}
                                  alt="Subject"
                                  className="w-full h-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSwapSubjectImages((prev) =>
                                      prev.filter((i) => i.id !== img.id)
                                    )
                                  }
                                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/80 text-white text-xs flex items-center justify-center cursor-pointer"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {swapSubjectImages.length > 0 && (
                          <button
                            type="button"
                            disabled={isAnalyzingSwapSubject}
                            onClick={handleAnalyzeSwapSubjectPhotos}
                            className="w-full py-2.5 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
                          >
                            {isAnalyzingSwapSubject ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Consolidating Subject Identity...</span>
                              </>
                            ) : (
                              <span>Extract & Apply Replacement Subject</span>
                            )}
                          </button>
                        )}

                        {swapSubjectError && (
                          <p className="text-xs text-red-400">{swapSubjectError}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Single Reference Image Upload Zone with Optical Viewfinder */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="font-display text-xs sm:text-sm font-bold text-white">
                        {activeTool === 'subject_swapping'
                          ? 'Target Scene / Pose Reference Image (1 Image)'
                          : 'Reference Image to Analyze (1 Image)'}
                      </label>
                    </div>

                    {referenceImage && (
                      <button
                        type="button"
                        onClick={() => {
                          setReferenceImage(null);
                          setComponents(null);
                          setOriginalComponents(null);
                          setGeneratedMasterPrompt(null);
                        }}
                        className="text-xs text-zinc-400 hover:text-white cursor-pointer"
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
                    onDrop={handleFileDrop}
                    onClick={() => !referenceImage && fileInputRef.current?.click()}
                    className={`relative rounded-2xl border-2 border-dashed p-5 sm:p-7 text-center transition-all ${
                      isDragging
                        ? 'border-[#f5c518] bg-[#f5c518]/5 scale-[0.99]'
                        : !referenceImage
                        ? 'border-white/15 glass-panel hover:border-[#f5c518]/50 cursor-pointer'
                        : 'border-white/10 glass-panel'
                    }`}
                  >
                    {!referenceImage ? (
                      <div className="flex flex-col items-center gap-2.5 text-zinc-400 py-2">
                        <div className="w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-[#f5c518]">
                          <Upload className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="font-display font-bold text-white text-sm sm:text-base">
                            Upload or drop one reference image
                          </span>
                          <span className="text-zinc-400 text-xs block mt-0.5">
                            Supports JPEG, PNG, WebP • Or paste directly with Ctrl + V
                          </span>
                        </div>
                        <div className="mt-1">
                          <span className="text-xs font-semibold text-[#f5c518] underline">
                            Browse file from device
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
                            imageName={referenceImage.name || 'Uploaded Reference'}
                            aspectRatioLabel={outputRatio}
                            toolBadgeLabel={
                              activeTool === 'subject_swapping'
                                ? 'Target Scene Reference'
                                : '13-Component Reference'
                            }
                            isScanning={isScanning}
                            compact
                          />
                        </div>

                        <div className="flex-1 space-y-3">
                          <div>
                            <div className="text-xs font-mono font-semibold text-[#f5c518] tracking-wide">
                              {activeTool === 'subject_swapping'
                                ? 'Scene & Pose Reference · Identity Lock Ready'
                                : 'Optical Source · 13-Component Extraction'}
                            </div>
                            <div className="font-display text-sm sm:text-base font-bold text-white truncate mt-0.5">
                              {referenceImage.name || 'Uploaded Reference Image'}
                            </div>
                            <div className="text-xs text-zinc-400 mt-1 leading-relaxed">
                              Click the viewfinder preview to open the fullscreen optical lightbox or toggle the 3×3 rule-of-thirds and center crosshair grid.
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5">
                            <button
                              type="button"
                              onClick={handleScanReference}
                              disabled={isScanning}
                              className="min-h-[42px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ffe169] via-[#f5c518] to-[#d49a00] hover:brightness-105 text-black font-black text-xs uppercase tracking-wider shadow-md transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                            >
                              <Sparkles className="w-4 h-4 stroke-[2.5]" />
                              <span>
                                {components ? 'Re-Analyze Image' : 'Analyze Reference Image'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isScanning}
                              className="min-h-[42px] px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-xs font-semibold border border-white/10 transition cursor-pointer"
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
                  <div className="py-4">
                    <ScanProgressPanel
                      currentStageIndex={scanStageIndex}
                      fallbackNotice={fallbackNotice}
                    />
                  </div>
                )}

                {/* Scan Error Notice */}
                {scanError && (
                  <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-red-300">Analysis Notice</div>
                      <div className="text-zinc-300 mt-0.5">{scanError}</div>
                    </div>

                    <button
                      type="button"
                      onClick={handleScanReference}
                      className="px-3.5 py-2 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs shrink-0 flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry Analysis</span>
                    </button>
                  </div>
                )}

                {/* ANALYSIS RESULTS & 13-COMPONENT COLLAPSIBLE ACCORDION GROUPS */}
                {components && !isScanning && (
                  <div className="space-y-6 pt-4 border-t border-white/[0.08] animate-in fade-in duration-300">
                    {/* Results Top Header Bar */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass-panel p-4 sm:p-5 rounded-2xl">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-display font-bold text-white text-sm sm:text-base">
                            13-Component Visual Analysis
                          </span>
                          <span className="text-zinc-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-[#f5c518] font-medium">
                            {activeTool === 'general_extractor'
                              ? 'General Prompt Extractor'
                              : 'Subject Swapping'}
                          </span>
                          <span className="text-zinc-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-zinc-400 tabular-nums">
                            {componentCounts.locked} Locked · {componentCounts.edited} Edited ·{' '}
                            {componentCounts.ignored} Ignored · {componentCounts.unavailable}{' '}
                            Unavailable
                          </span>
                        </div>
                        {scanSummary && <p className="text-xs text-zinc-400">{scanSummary}</p>}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleRestoreAllOriginal}
                          className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-xs font-semibold border border-white/10 transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restore All Original</span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={projectTitleInput}
                            onChange={(e) => setProjectTitleInput(e.target.value)}
                            placeholder="Project title..."
                            className="bg-black/40 border border-white/15 focus:border-[#f5c518] rounded-xl px-3 py-1.5 text-xs text-white outline-none w-36 sm:w-44"
                          />
                          <button
                            type="button"
                            onClick={handleSaveBlueprint}
                            className="min-h-[36px] flex items-center gap-1.5 px-3.5 py-1.5 bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs rounded-xl transition cursor-pointer"
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

                    {/* Two-Column Desktop Layout: Left Optical Viewfinder + Right 4 Accordion Groups */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
                      {/* Left Column: Reference Viewfinder & Aspect Ratio (4 cols) */}
                      <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-20">
                        {referenceImage && (
                          <ReferenceViewfinder
                            imageUrl={referenceImage.previewUrl}
                            imageName={referenceImage.name || 'Analyzed Reference'}
                            aspectRatioLabel={outputRatio}
                            toolBadgeLabel={
                              activeTool === 'subject_swapping'
                                ? 'Subject Swap Scene Source'
                                : '13-Component Optical Source'
                            }
                            isScanning={isScanning}
                          />
                        )}

                        {/* Aspect Ratio Selector */}
                        <div className="glass-panel p-4 rounded-2xl space-y-2.5">
                          <div className="flex items-center justify-between">
                            <label className="font-display text-xs font-bold text-white">
                              Output Aspect Ratio
                            </label>
                            <span className="text-xs font-mono font-semibold text-[#f5c518] tabular-nums">
                              {outputRatio}
                            </span>
                          </div>
                          {ratioExplanation && (
                            <p className="text-[11px] text-zinc-400 leading-normal">
                              {ratioExplanation}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'].map(
                              (ratio) => (
                                <button
                                  key={ratio}
                                  type="button"
                                  onClick={() => {
                                    triggerHaptic();
                                    setOutputRatio(ratio);
                                    if (generatedMasterPrompt) setHasUnbuiltChanges(true);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold tabular-nums transition cursor-pointer ${
                                    outputRatio === ratio
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
                      </div>

                      {/* Right Column: 4 Collapsible Accordion Groups for the 13 Component Fields (8 cols) */}
                      <div className="lg:col-span-8 space-y-4">
                        {/* Filter & Accordion Group Toolbar */}
                        <div className="glass-panel rounded-2xl p-3.5 sm:px-4 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-black/40 border border-white/[0.07]">
                            {(
                              [
                                { id: 'all', label: `All (${ALL_COMPONENT_KEYS.length})` },
                                { id: 'locked', label: `Locked (${componentCounts.locked})` },
                                { id: 'edited', label: `Edited (${componentCounts.edited})` },
                                {
                                  id: 'ignored',
                                  label: `Excluded (${
                                    componentCounts.ignored + componentCounts.unavailable
                                  })`,
                                },
                              ] as const
                            ).map((tab) => {
                              const active = sceneFilter === tab.id;
                              return (
                                <button
                                  key={tab.id}
                                  type="button"
                                  onClick={() => {
                                    triggerHaptic();
                                    setSceneFilter(tab.id);
                                  }}
                                  className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                                    active
                                      ? 'text-black font-bold'
                                      : 'text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  {active && (
                                    <motion.div
                                      layoutId="sceneFilterPill"
                                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                                      className="absolute inset-0 rounded-lg bg-[#f5c518]"
                                    />
                                  )}
                                  <span className="relative z-10 font-mono tabular-nums">
                                    {tab.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          <div className="flex items-center gap-1.5 text-xs">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenSceneGroups({
                                  identity_pose: true,
                                  camera_framing: true,
                                  wardrobe_scene: true,
                                  expression_gestures: true,
                                })
                              }
                              className="px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-300 font-semibold transition cursor-pointer whitespace-nowrap"
                            >
                              Expand Groups
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setOpenSceneGroups({
                                  identity_pose: false,
                                  camera_framing: false,
                                  wardrobe_scene: false,
                                  expression_gestures: false,
                                })
                              }
                              className="px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-300 font-semibold transition cursor-pointer whitespace-nowrap"
                            >
                              Collapse Groups
                            </button>
                          </div>
                        </div>

                        {SCENE_ACCORDION_GROUPS.map((group) => {
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
                            <div
                              key={group.id}
                              className="glass-panel rounded-2xl overflow-hidden transition-all"
                            >
                              {/* Accordion Group Header */}
                              <button
                                type="button"
                                onClick={() => {
                                  triggerHaptic();
                                  setOpenSceneGroups((prev) => ({
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
                                      {editedInGroup > 0 ? ` · ${editedInGroup} Edited` : ''}
                                    </span>
                                  </div>
                                  <p className="text-xs text-zinc-400 mt-0.5 truncate">
                                    {group.subtitle}
                                  </p>
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
                                            onUpdateState={(st) =>
                                              handleUpdateComponentState(key, st)
                                            }
                                            onUpdateText={(txt, meta) =>
                                              handleUpdateComponentText(key, txt, meta)
                                            }
                                            onApplyBackgroundBundle={
                                              key === 'background' ||
                                              key === 'environment' ||
                                              key === 'lighting'
                                                ? handleApplyBackgroundBundle
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

                    {/* Prominent GENERATE FINAL PROMPT Button */}
                    <div className="pt-2 pb-2">
                      <div className="rounded-2xl glass-panel p-5 sm:p-6 text-center space-y-3">
                        <div className="max-w-xl mx-auto space-y-1">
                          <h3 className="font-display text-base sm:text-lg font-bold text-white tracking-tight">
                            {generatedMasterPrompt
                              ? 'Update Final Prompt from Current Fields'
                              : 'Generate Final Prompt'}
                          </h3>
                          <p className="text-xs text-zinc-400">
                            Synthesizes a coherent, image-model-oriented prompt strictly from the current contents of your active component fields. Removed, ignored, and unavailable components are excluded.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleGenerateFinalPrompt}
                          className="w-full sm:w-auto min-w-[280px] px-8 py-4 rounded-xl bg-gradient-to-r from-[#ffe169] via-[#f5c518] to-[#d49a00] hover:brightness-105 active:scale-[0.99] text-black font-black text-sm uppercase tracking-wider shadow-lg shadow-amber-500/15 transition-all inline-flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Sparkles className="w-4 h-4 text-black stroke-[2.5]" />
                          <span>Generate Final Prompt</span>
                        </button>
                      </div>
                    </div>

                    {/* Unbuilt Changes Banner */}
                    {hasUnbuiltChanges && generatedMasterPrompt && (
                      <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <span className="font-bold text-amber-300">
                            Component fields or tool controls were modified.
                          </span>
                          <span className="text-zinc-300 ml-1">
                            Click "Generate Final Prompt" to refresh the output with your latest changes.
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={handleGenerateFinalPrompt}
                          className="px-3.5 py-2 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs shrink-0 flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Generate Final Prompt</span>
                        </button>
                      </div>
                    )}

                    {/* Final Generated Prompt Output Section */}
                    {generatedMasterPrompt && (
                      <div className="pt-4 border-t border-white/[0.08] space-y-4 w-full animate-in fade-in duration-200">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                          <div>
                            <h3 className="font-display text-sm sm:text-base font-bold text-white">
                              Final Generated Prompt
                            </h3>
                            <p className="text-xs text-zinc-400">
                              Constructed strictly from your current active components and edits.
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={showNegativePrompt}
                                onChange={(e) => setShowNegativePrompt(e.target.checked)}
                                className="accent-[#f5c518]"
                              />
                              <span>Show Negative Prompt</span>
                            </label>

                            <div className="flex items-center gap-2">
                              <label className="text-xs text-zinc-400 font-semibold">Format:</label>
                              <select
                                value={targetModel}
                                onChange={(e) => setTargetModel(e.target.value as TargetModelType)}
                                className="bg-white/[0.06] text-white border border-white/15 rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
                              >
                                <option value="universal" className="bg-[#0e111a]">
                                  Universal / Standard
                                </option>
                                <option value="flux" className="bg-[#0e111a]">
                                  Flux
                                </option>
                                <option value="gemini" className="bg-[#0e111a]">
                                  Google Gemini
                                </option>
                                <option value="chatgpt" className="bg-[#0e111a]">
                                  ChatGPT / DALL-E
                                </option>
                              </select>
                            </div>
                          </div>
                        </div>

                        {promptCheck && (
                          <PromptCheckBanner
                            check={promptCheck}
                            onApplyFix={handleApplySafetyFix}
                          />
                        )}

                        <textarea
                          readOnly
                          value={exportedPrompt}
                          rows={14}
                          className="w-full glass-panel text-white p-4 rounded-2xl text-xs font-mono leading-relaxed outline-none select-text selection:bg-[#f5c518] selection:text-black shadow-inner resize-y min-h-[240px]"
                        />

                        {showNegativePrompt && generatedNegativePrompt && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-zinc-400">
                              Optional Negative Prompt (Excludes unsupported or cropped anatomy)
                            </label>
                            <textarea
                              value={generatedNegativePrompt}
                              onChange={(e) => setGeneratedNegativePrompt(e.target.value)}
                              rows={2}
                              className="w-full glass-panel text-zinc-300 p-3 rounded-xl text-xs font-mono leading-relaxed outline-none"
                            />
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <button
                            type="button"
                            onClick={handleCopyPrompt}
                            className="py-3 px-4 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                          >
                            {copyFeedback ? (
                              <>
                                <Check className="w-4 h-4 text-black" />
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
                            onClick={handleDownloadPrompt}
                            className="py-3 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-white font-bold text-xs transition flex items-center justify-center gap-2 border border-white/10 cursor-pointer"
                          >
                            <Download className="w-4 h-4 text-sky-400" />
                            <span>Download Prompt (.txt)</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleSaveBlueprint}
                            className="py-3 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 font-bold text-xs transition flex items-center justify-center gap-2 border border-white/10 cursor-pointer"
                          >
                            <BookmarkPlus className="w-4 h-4 text-[#f5c518]" />
                            <span>Save to Projects</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Floating Animated Prompt Compilation Dock */}
                    <FloatingPromptDock
                      toolLabel={
                        activeTool === 'general_extractor'
                          ? 'General Prompt Extractor'
                          : 'Subject Swapping'
                      }
                      activeCount={componentCounts.locked + componentCounts.edited}
                      totalCount={ALL_COMPONENT_KEYS.length}
                      editedCount={componentCounts.edited}
                      outputRatio={outputRatio}
                      hasUnbuiltChanges={hasUnbuiltChanges}
                      generatedPrompt={generatedMasterPrompt}
                      exportedPrompt={exportedPrompt}
                      targetModel={targetModel}
                      onSetTargetModel={setTargetModel}
                      onGeneratePrompt={handleGenerateFinalPrompt}
                      onCopyPrompt={handleCopyPrompt}
                      onDownloadPrompt={handleDownloadPrompt}
                      onSaveProject={handleSaveBlueprint}
                      copyFeedback={copyFeedback}
                      negativePrompt={generatedNegativePrompt}
                      showNegativePrompt={showNegativePrompt}
                      onToggleNegativePrompt={setShowNegativePrompt}
                      onChangeNegativePrompt={setGeneratedNegativePrompt}
                    />
                  </div>
                )}
              </>
          </motion.div>
        )}

        {/* TAB 2: PROFILES */}
        {activeNav === 'profiles' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ProfileManager
              activeProfileId={activeProfile.id}
              onSelectProfile={handleSelectProfile}
              activeOutfitId={activeOutfit.id}
              onSelectOutfit={handleSelectOutfit}
            />
          </motion.div>
        )}

        {/* TAB 3: PROJECTS */}
        {activeNav === 'projects' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <BlueprintProjects onLoadBlueprint={handleLoadBlueprint} />
          </motion.div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.07] bg-[#06070b]/80 backdrop-blur-xl py-6 px-4 text-center text-xs text-zinc-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-zinc-300">My Whisk AI</span>
            <span aria-hidden="true">·</span>
            <span>Spatial Visual Prompt & Reference Control Studio</span>
          </div>

          <div className="text-[11px] font-mono text-zinc-500">
            Local-first profiles & projects storage
          </div>
        </div>
      </footer>

      <OfflineIndicator />
    </>
      )}
    </div>
  );
}
