import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Lock,
  CopyPlus,
  Upload,
  Sparkles,
  Check,
  Copy,
  BookmarkPlus,
  AlertTriangle,
  ShieldAlert,
  Wrench,
  Trash2,
  Image as ImageIcon,
  UserCheck,
  Layers,
  Sliders,
  ClipboardCheck,
  BarChart3,
  RefreshCw,
  X,
  Info,
} from 'lucide-react';
import {
  SwapMatrixSwitches,
  BodySource,
  OutfitSource,
  ExpressionSource,
  BackgroundSource,
  LightingSource,
  OrnamentsSource,
  getImagesNeeded,
  assembleSwapPrompt,
  matchPresetBySwitches,
} from '../services/swapBlocks';
import {
  SwapRecipe,
  LOCKED_SWAP_PRESETS,
  getAllSwapRecipes,
  duplicateSwapRecipe,
  updateUserSwapRecipe,
  deleteUserSwapRecipe,
  getPersistedSwapWorkspace,
  savePersistedSwapWorkspace,
  SwapRunResultTag,
  SWAP_RUN_RESULT_TAGS,
  getSwapRunLogs,
  addSwapRunLog,
  getRecipeRunTally,
  computeImageHash,
  getCachedTextAnchor,
  setCachedTextAnchor,
  SwapTemplateScanSummary,
} from '../services/swapRecipes';
import {
  checkSwapConflicts,
  hasBlockingSwapConflict,
  SwapConflictItem,
} from '../services/swapConflicts';
import { StorageService } from '../services/storage';
import { postApiJson } from '../services/apiClient';
import { normalizeScanResult } from '../services/scanNormalizer';
import { ReferenceBlueprint, ImageDataItem } from '../types';

export interface SwapStudioProps {
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
          id: `swap_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

function extractVisibleBodyPartsFromScan(components: Record<string, any>): string[] {
  const parts: string[] = ['Head & Face'];
  const combined = [
    components?.body?.detectedText || '',
    components?.pose?.detectedText || '',
    components?.clothing?.detectedText || '',
    components?.hand_gestures?.detectedText || '',
    components?.leg_gestures?.detectedText || '',
  ]
    .join(' ')
    .toLowerCase();

  if (/\b(shoulder|chest|bust|torso|waist|upper body)\b/.test(combined)) {
    parts.push('Torso & Shoulders');
  }
  if (/\b(arm|forearm|elbow|wrist|hand|finger|palm)\b/.test(combined)) {
    parts.push('Arms & Hands');
  }
  if (/\b(hip|thigh|knee|leg|calf|calves)\b/.test(combined)) {
    parts.push('Hips & Legs');
  }
  if (/\b(foot|feet|ankle|toe|shoe|sneaker|sandal|heel|boot)\b/.test(combined)) {
    parts.push('Feet & Footwear');
  }
  return parts;
}

export const SwapStudio: React.FC<SwapStudioProps> = ({
  optimizeImageFile = defaultOptimizeImageFile,
  onOpenProjects,
}) => {
  // Load initial persisted workspace state
  const initialWorkspace = useMemo(() => getPersistedSwapWorkspace(), []);
  const [recipes, setRecipes] = useState<SwapRecipe[]>(() => getAllSwapRecipes());
  const [activeRecipeId, setActiveRecipeId] = useState<string>(initialWorkspace.activeRecipeId);
  const [switches, setSwitches] = useState<SwapMatrixSwitches>(initialWorkspace.switches);

  // Saved / Typed selectors for Outfit & Background
  const savedOutfits = useMemo(() => StorageService.getOutfits(), []);
  const savedBackgrounds = useMemo(() => StorageService.getBackgrounds(), []);

  const [savedOutfitId, setSavedOutfitId] = useState<string>(
    initialWorkspace.savedOutfitId || savedOutfits[0]?.id || ''
  );
  const [typedOutfitText, setTypedOutfitText] = useState<string>(
    initialWorkspace.typedOutfitText || ''
  );
  const [typedBottomWearLine, setTypedBottomWearLine] = useState<string>(
    initialWorkspace.typedBottomWearLine || ''
  );
  const [savedBackgroundId, setSavedBackgroundId] = useState<string>(
    initialWorkspace.savedBackgroundId || savedBackgrounds[0]?.id || ''
  );
  const [typedBackgroundText, setTypedBackgroundText] = useState<string>(
    initialWorkspace.typedBackgroundText || ''
  );

  // Template People Count & Scan State
  const [peopleCount, setPeopleCount] = useState<1 | 2>(initialWorkspace.peopleCount);
  const [secondPersonSwapped, setSecondPersonSwapped] = useState<boolean>(
    initialWorkspace.secondPersonSwapped
  );
  const [swappedPersonId, setSwappedPersonId] = useState<string>(
    initialWorkspace.swappedPersonId || 'A'
  );
  const [templateScanSummary, setTemplateScanSummary] =
    useState<SwapTemplateScanSummary | null>(initialWorkspace.templateScanSummary || null);
  const [isScanningTemplate, setIsScanningTemplate] = useState(false);

  // Face checks & Optional Text Anchors
  const [faceShowsOnlyUpperBody, setFaceShowsOnlyUpperBody] = useState<boolean>(
    initialWorkspace.faceShowsOnlyUpperBody
  );
  const [faceHasClearExpression, setFaceHasClearExpression] = useState<boolean>(
    initialWorkspace.faceHasClearExpression
  );
  const [anchors, setAnchors] = useState(initialWorkspace.anchors);
  const [isDescribingFace, setIsDescribingFace] = useState(false);
  const [isDescribingMannequin, setIsDescribingMannequin] = useState(false);
  const [anchorStatusNotice, setAnchorStatusNotice] = useState<string | null>(null);

  // 4 Image Slots (kept in memory only; never stored in localStorage)
  const [templateImage, setTemplateImage] = useState<ImageDataItem | null>(null);
  const [faceImage, setFaceImage] = useState<ImageDataItem | null>(null);
  const [mannequinImage, setMannequinImage] = useState<ImageDataItem | null>(null);
  const [manImage, setManImage] = useState<ImageDataItem | null>(null);

  // Hidden file input refs
  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const faceInputRef = useRef<HTMLInputElement | null>(null);
  const mannequinInputRef = useRef<HTMLInputElement | null>(null);
  const manInputRef = useRef<HTMLInputElement | null>(null);
  const bottomWearInputRef = useRef<HTMLInputElement | null>(null);

  // Recipe renaming / duplication UI state
  const [editingRecipeName, setEditingRecipeName] = useState<string>('');
  const [isRenamingRecipe, setIsRenamingRecipe] = useState(false);
  const [lockedSwitchNotice, setLockedSwitchNotice] = useState<string | null>(null);

  // Output & Project Save & Result Log state
  const [copySuccess, setCopySuccess] = useState(false);
  const [showPostCopyTagBar, setShowPostCopyTagBar] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectSavedNotice, setProjectSavedNotice] = useState<string | null>(null);
  const [runLogs, setRunLogs] = useState(() => getSwapRunLogs());
  const [otherRunNote, setOtherRunNote] = useState('');
  const [loggedFeedbackNotice, setLoggedFeedbackNotice] = useState<string | null>(null);

  const activeRecipe = useMemo(
    () => recipes.find((r) => r.id === activeRecipeId) || LOCKED_SWAP_PRESETS[0],
    [recipes, activeRecipeId]
  );

  // Persist workspace settings on every change (never storing images)
  useEffect(() => {
    savePersistedSwapWorkspace({
      schemaVersion: 1,
      activeRecipeId,
      switches,
      savedOutfitId,
      typedOutfitText,
      typedBottomWearLine,
      savedBackgroundId,
      typedBackgroundText,
      peopleCount,
      secondPersonSwapped,
      swappedPersonId,
      faceShowsOnlyUpperBody,
      faceHasClearExpression,
      anchors,
      templateScanSummary,
    });
  }, [
    activeRecipeId,
    switches,
    savedOutfitId,
    typedOutfitText,
    typedBottomWearLine,
    savedBackgroundId,
    typedBackgroundText,
    peopleCount,
    secondPersonSwapped,
    swappedPersonId,
    faceShowsOnlyUpperBody,
    faceHasClearExpression,
    anchors,
    templateScanSummary,
  ]);

  // Resolve selected Saved Outfit and Saved Background descriptions
  const selectedSavedOutfitText = useMemo(() => {
    const found = savedOutfits.find((o) => o.id === savedOutfitId);
    return found ? found.description : '';
  }, [savedOutfits, savedOutfitId]);

  const selectedSavedBackgroundText = useMemo(() => {
    const found = savedBackgrounds.find((b) => b.id === savedBackgroundId);
    if (!found) return '';
    return `${found.background} ${found.environment}`.trim();
  }, [savedBackgrounds, savedBackgroundId]);

  // Compute deterministic prompt output
  const finalPrompt = useMemo(() => {
    return assembleSwapPrompt(switches, {
      lockedPresetId: activeRecipe.isLockedPreset ? activeRecipe.presetId : null,
      savedOutfitText: selectedSavedOutfitText,
      typedOutfitText,
      typedBottomWearLine,
      savedBackgroundText: selectedSavedBackgroundText,
      typedBackgroundText,
      peopleCount,
      secondPersonSwapped,
      anchors,
    });
  }, [
    switches,
    activeRecipe,
    selectedSavedOutfitText,
    typedOutfitText,
    typedBottomWearLine,
    selectedSavedBackgroundText,
    typedBackgroundText,
    peopleCount,
    secondPersonSwapped,
    anchors,
  ]);

  // Compute needed images in order
  const imagesNeeded = useMemo(
    () => getImagesNeeded(switches, peopleCount, secondPersonSwapped),
    [switches, peopleCount, secondPersonSwapped]
  );

  // Run instant local conflict checker
  const conflicts = useMemo(
    () =>
      checkSwapConflicts({
        switches,
        hasTemplateImage: Boolean(templateImage),
        hasFaceImage: Boolean(faceImage),
        hasMannequinImage: Boolean(mannequinImage),
        hasManImage: Boolean(manImage),
        peopleCount,
        faceShowsOnlyUpperBody,
        faceHasClearExpression,
        typedBottomWearLine,
        savedOutfitText: selectedSavedOutfitText,
        typedOutfitText,
        savedBackgroundText: selectedSavedBackgroundText,
        typedBackgroundText,
      }),
    [
      switches,
      templateImage,
      faceImage,
      mannequinImage,
      manImage,
      peopleCount,
      faceShowsOnlyUpperBody,
      faceHasClearExpression,
      typedBottomWearLine,
      selectedSavedOutfitText,
      typedOutfitText,
      selectedSavedBackgroundText,
      typedBackgroundText,
    ]
  );

  const isCopyBlocked = useMemo(() => hasBlockingSwapConflict(conflicts), [conflicts]);
  const activeRecipeTally = useMemo(
    () => getRecipeRunTally(runLogs, activeRecipe.id),
    [runLogs, activeRecipe.id]
  );

  // Select recipe handler
  const handleSelectRecipe = (recipe: SwapRecipe) => {
    setActiveRecipeId(recipe.id);
    setSwitches({ ...recipe.switches });
    setLockedSwitchNotice(null);
    setIsRenamingRecipe(false);
  };

  // Duplicate active recipe into a user recipe
  const handleDuplicateAndEdit = (overrideSwitches?: SwapMatrixSwitches) => {
    const duplicated = duplicateSwapRecipe(activeRecipe);
    const nextSwitches = overrideSwitches ? { ...overrideSwitches } : { ...duplicated.switches };
    if (overrideSwitches) {
      updateUserSwapRecipe(duplicated.id, { switches: nextSwitches });
    }
    const refreshed = getAllSwapRecipes();
    setRecipes(refreshed);
    setActiveRecipeId(duplicated.id);
    setSwitches(nextSwitches);
    setLockedSwitchNotice(null);
  };

  // Change a switch row in the Source Matrix
  const handleSwitchChange = <K extends keyof SwapMatrixSwitches>(
    key: K,
    value: SwapMatrixSwitches[K]
  ) => {
    if (switches[key] === value) return;

    if (activeRecipe.isLockedPreset) {
      // Locked presets cannot be edited in place; automatically duplicate into a user recipe
      const nextSwitches = { ...switches, [key]: value };
      const duplicated = duplicateSwapRecipe(
        activeRecipe,
        `${activeRecipe.name} (Custom)`
      );
      updateUserSwapRecipe(duplicated.id, { switches: nextSwitches });
      setRecipes(getAllSwapRecipes());
      setActiveRecipeId(duplicated.id);
      setSwitches(nextSwitches);
      setLockedSwitchNotice(
        `"${activeRecipe.name}" is a locked preset, so a new editable recipe "${duplicated.name}" was created for your change.`
      );
      return;
    }

    const nextSwitches = { ...switches, [key]: value };
    setSwitches(nextSwitches);
    updateUserSwapRecipe(activeRecipe.id, { switches: nextSwitches });
    setRecipes(getAllSwapRecipes());
  };

  // Handle image upload for any of the 4 slots (resized to 1024px)
  const handleSlotFileUpload = async (
    slot: 'Template' | 'Face' | 'Mannequin' | 'Man',
    file: File | undefined | null
  ) => {
    if (!file) return;
    try {
      const optimized = await optimizeImageFile(file);
      if (slot === 'Template') {
        setTemplateImage(optimized);
      } else if (slot === 'Face') {
        setFaceImage(optimized);
        // Check if we have cached text anchors for this Face image hash
        const hash = computeImageHash(optimized.data);
        const cached = getCachedTextAnchor(hash);
        if (cached) {
          setAnchors((prev) => ({
            ...prev,
            faceLightingText: cached.faceLightingText || prev.faceLightingText,
            faceOutfitText: cached.faceOutfitText || prev.faceOutfitText,
          }));
        }
      } else if (slot === 'Mannequin') {
        setMannequinImage(optimized);
        const hash = computeImageHash(optimized.data);
        const cached = getCachedTextAnchor(hash);
        if (cached?.mannequinBuildText) {
          setAnchors((prev) => ({
            ...prev,
            mannequinBuildText: cached.mannequinBuildText || prev.mannequinBuildText,
          }));
        }
      } else if (slot === 'Man') {
        setManImage(optimized);
      }
    } catch (err) {
      console.warn(`SwapStudio image upload failed for ${slot}:`, err);
    }
  };

  // Optional Template Scan (reuses /api/analyze-reference + normalizeScanResult, never blocks)
  const handleScanTemplateOptional = async () => {
    if (!templateImage || isScanningTemplate) return;
    setIsScanningTemplate(true);
    try {
      const customKey = StorageService.getCustomApiKey();
      const rawResponse = await postApiJson<any>(
        '/api/analyze-reference',
        {
          image: {
            data: templateImage.data,
            mimeType: templateImage.mimeType,
          },
          toolType: 'general_extractor',
        },
        { customKey }
      );

      const normalized = normalizeScanResult(rawResponse, {
        activeTool: 'general_extractor',
      });

      const detectedCount: 1 | 2 = normalized.subjects.length >= 2 ? 2 : 1;
      setPeopleCount(detectedCount);
      if (normalized.subjects[0]?.id) {
        setSwappedPersonId(normalized.subjects[0].id);
      }

      const envText =
        normalized.sharedComponents.environment?.detectedText ||
        normalized.sharedComponents.background?.detectedText ||
        'Indoor / natural scene';
      const firstSentence = envText.split(/(?<=[.!?])\s+/)[0] || envText;
      const visibleParts = extractVisibleBodyPartsFromScan(normalized.activeComponents);

      setTemplateScanSummary({
        scanned: true,
        isEstimate: Boolean(rawResponse?.quotaFallback),
        estimateNote: rawResponse?.fallbackNotice,
        sceneType: firstSentence,
        visibleBodyParts: visibleParts,
        detectedPeopleCount: detectedCount,
        subjectLabels: normalized.subjects.map((s) => ({ id: s.id, label: s.label })),
      });
    } catch (err: any) {
      setTemplateScanSummary({
        scanned: true,
        isEstimate: true,
        estimateNote:
          err?.message ||
          'Estimated blueprint, not an AI analysis. Set People in template manually below.',
        sceneType: 'Template scene (manual people count active)',
        visibleBodyParts: ['Head & Face', 'Torso & Shoulders'],
        detectedPeopleCount: peopleCount,
        subjectLabels: [
          { id: 'A', label: 'Subject 1 (Primary)' },
          ...(peopleCount === 2 ? [{ id: 'B', label: 'Subject 2 (Second Person)' }] : []),
        ],
      });
    } finally {
      setIsScanningTemplate(false);
    }
  };

  // Optional Text Anchor 1: "Describe Face lighting and outfit"
  const handleDescribeFaceAnchor = async () => {
    if (!faceImage || isDescribingFace) return;
    const hash = computeImageHash(faceImage.data);
    const cached = getCachedTextAnchor(hash);
    if (cached?.faceLightingText && cached?.faceOutfitText) {
      setAnchors((prev) => ({
        ...prev,
        faceLightingText: cached.faceLightingText!,
        faceOutfitText: cached.faceOutfitText!,
        faceLightingEnabled: true,
        faceOutfitEnabled: true,
      }));
      setAnchorStatusNotice('Loaded Face lighting & outfit anchor from image hash cache.');
      return;
    }

    setIsDescribingFace(true);
    setAnchorStatusNotice(null);
    try {
      const customKey = StorageService.getCustomApiKey();
      const rawResponse = await postApiJson<any>(
        '/api/analyze-reference',
        {
          image: {
            data: faceImage.data,
            mimeType: faceImage.mimeType,
          },
          toolType: 'general_extractor',
        },
        { customKey }
      );
      const normalized = normalizeScanResult(rawResponse, {
        activeTool: 'general_extractor',
      });
      const lightingText =
        normalized.activeComponents.lighting?.detectedText?.trim() ||
        'Soft front-facing portrait illumination with natural catchlights and gentle shadow falloff.';
      const outfitText =
        normalized.activeComponents.clothing?.detectedText?.trim() ||
        'Upper-body garment with clean neckline, natural fabric weave, and authentic color tone from FACE.';

      setCachedTextAnchor(hash, {
        faceLightingText: lightingText,
        faceOutfitText: outfitText,
      });
      setAnchors((prev) => ({
        ...prev,
        faceLightingText: lightingText,
        faceOutfitText: outfitText,
        faceLightingEnabled: true,
        faceOutfitEnabled: true,
      }));
      setAnchorStatusNotice(
        rawResponse?.quotaFallback
          ? 'Estimated Face text anchor generated (editable below).'
          : 'Face lighting & outfit anchor extracted and cached.'
      );
    } catch {
      const fallbackLighting =
        'Soft directional portrait lighting on the face with natural skin highlights and balanced shadows.';
      const fallbackOutfit =
        'Exact neckline, fabric texture, color palette, and garment details visible in FACE.';
      setAnchors((prev) => ({
        ...prev,
        faceLightingText: prev.faceLightingText || fallbackLighting,
        faceOutfitText: prev.faceOutfitText || fallbackOutfit,
        faceLightingEnabled: true,
        faceOutfitEnabled: true,
      }));
      setAnchorStatusNotice('Offline template anchor populated — edit freely below.');
    } finally {
      setIsDescribingFace(false);
    }
  };

  // Optional Text Anchor 2: "Describe Mannequin build"
  const handleDescribeMannequinAnchor = async () => {
    if (!mannequinImage || isDescribingMannequin) return;
    const hash = computeImageHash(mannequinImage.data);
    const cached = getCachedTextAnchor(hash);
    if (cached?.mannequinBuildText) {
      setAnchors((prev) => ({
        ...prev,
        mannequinBuildText: cached.mannequinBuildText!,
        mannequinBuildEnabled: true,
      }));
      setAnchorStatusNotice('Loaded Mannequin build anchor from image hash cache.');
      return;
    }

    setIsDescribingMannequin(true);
    setAnchorStatusNotice(null);
    try {
      const customKey = StorageService.getCustomApiKey();
      const rawResponse = await postApiJson<any>(
        '/api/analyze-reference',
        {
          image: {
            data: mannequinImage.data,
            mimeType: mannequinImage.mimeType,
          },
          toolType: 'general_extractor',
        },
        { customKey }
      );
      const normalized = normalizeScanResult(rawResponse, {
        activeTool: 'general_extractor',
      });
      const buildText =
        normalized.activeComponents.body?.detectedText?.trim() ||
        'Full-figure 3D mannequin proportions with defined shoulder-to-waist-to-hip ratio and natural limb volume.';

      setCachedTextAnchor(hash, {
        mannequinBuildText: buildText,
      });
      setAnchors((prev) => ({
        ...prev,
        mannequinBuildText: buildText,
        mannequinBuildEnabled: true,
      }));
      setAnchorStatusNotice(
        rawResponse?.quotaFallback
          ? 'Estimated Mannequin build anchor generated (editable below).'
          : 'Mannequin build anchor extracted and cached.'
      );
    } catch {
      const fallbackBuild =
        'Exact 3D mannequin shoulder width, bust volume, waist-to-hip curvature, and thigh/calf thickness.';
      setAnchors((prev) => ({
        ...prev,
        mannequinBuildText: prev.mannequinBuildText || fallbackBuild,
        mannequinBuildEnabled: true,
      }));
      setAnchorStatusNotice('Offline Mannequin build anchor populated — edit freely below.');
    } finally {
      setIsDescribingMannequin(false);
    }
  };

  // One-tap Fix handler for Conflict Checker items
  const handleApplyConflictFix = (item: SwapConflictItem) => {
    const action = item.fixAction;
    if (action.type === 'upload_template') {
      templateInputRef.current?.click();
    } else if (action.type === 'upload_face') {
      faceInputRef.current?.click();
    } else if (action.type === 'set_switch') {
      handleSwitchChange(action.key, action.value);
    } else if (action.type === 'add_bottom_wear_line') {
      if (!typedBottomWearLine.trim()) {
        setTypedBottomWearLine(
          'Extend below the chest into matching high-waisted tailored trousers in the same fabric and color tone.'
        );
      }
      setTimeout(() => bottomWearInputRef.current?.focus(), 60);
    } else if (action.type === 'clear_mannequin_image') {
      setMannequinImage(null);
    } else if (action.type === 'set_people_count') {
      setPeopleCount(action.count);
    } else if (action.type === 'clear_man_image') {
      setManImage(null);
    }
  };

  // Copy Prompt handler
  const handleCopyPrompt = () => {
    if (isCopyBlocked) return;
    navigator.clipboard.writeText(finalPrompt);
    setCopySuccess(true);
    setShowPostCopyTagBar(true);
    setTimeout(() => setCopySuccess(false), 2200);
  };

  // Save as Project (stores switches, recipe name, prompt text, and small Template thumbnail only)
  const handleSaveAsProject = async () => {
    const title =
      projectTitle.trim() ||
      `${activeRecipe.name} · ${templateImage?.name ? templateImage.name.replace(/\.[^.]+$/, '') : 'Swap Project'}`;

    const smallThumb = templateImage
      ? await createSmallThumbnailDataUrl(templateImage.previewUrl)
      : '';

    const blueprint: ReferenceBlueprint = {
      id: `swap_proj_${Date.now()}`,
      schemaVersion: 2,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      toolType: 'subject_swapping',
      referenceThumbnails: smallThumb ? [smallThumb] : [],
      referenceImageIds: [],
      subjectProfileId: activeRecipe.id,
      masterSubject: `Recipe: ${activeRecipe.name} | Switches: ${JSON.stringify(switches)}`,
      masterBody: `Images needed: ${imagesNeeded.join(', ')}`,
      originalComponents: {} as any,
      components: {} as any,
      outputRatio: '3:4',
      finalPrompt,
      targetModel: 'universal',
    };

    StorageService.saveBlueprint(blueprint);
    setProjectSavedNotice(
      `Saved "${title}" to Projects (switches, recipe name, prompt text, and small Template thumbnail only).`
    );
    setTimeout(() => setProjectSavedNotice(null), 4000);
  };

  // Log a run result tag
  const handleLogRunResult = (tag: SwapRunResultTag) => {
    const note = tag === 'Other' ? otherRunNote : undefined;
    const updated = addSwapRunLog(activeRecipe.id, activeRecipe.name, tag, note);
    setRunLogs(updated);
    if (tag === 'Other') setOtherRunNote('');
    setLoggedFeedbackNotice(`Logged "${tag}" for ${activeRecipe.name}.`);
    setTimeout(() => setLoggedFeedbackNotice(null), 2500);
  };

  const matchedPresetId = useMemo(() => matchPresetBySwitches(switches), [switches]);
  const [mobileSection, setMobileSection] = useState<'recipes' | 'images' | 'matrix' | 'output'>('recipes');

  return (
    <div className="space-y-5">
      {/* Mobile-only 4-Step Section Switcher */}
      <div className="lg:hidden grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#0e1118] border border-white/[0.09]">
        {(
          [
            { id: 'recipes', label: '1. Recipes' },
            { id: 'images', label: '2. Slots' },
            { id: 'matrix', label: '3. Matrix' },
            { id: 'output', label: '4. Prompt' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMobileSection(tab.id)}
            className={`min-h-[40px] px-2 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer whitespace-nowrap ${
              mobileSection === tab.id
                ? 'bg-[#f5c518] text-black font-bold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Hidden File Inputs for the 4 Slots */}
      <input
        ref={templateInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleSlotFileUpload('Template', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={faceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleSlotFileUpload('Face', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={mannequinInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleSlotFileUpload('Mannequin', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={manInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleSlotFileUpload('Man', e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* SECTION 1: SAVED RECIPES & LOCKED PRESETS BAR */}
      <div
        className={`studio-panel rounded-2xl p-4 sm:p-5 space-y-4 ${
          mobileSection === 'recipes' ? 'block' : 'hidden lg:block'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base sm:text-lg font-bold text-white">
                Swap Studio · Recipe &amp; Source Matrix
              </h2>
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <span className="text-xs font-mono text-[#f5c518]">Deterministic Builder</span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Choose one of the 4 locked presets (verbatim prompt output) or duplicate a recipe to customize the Source Matrix switches.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleDuplicateAndEdit()}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <CopyPlus className="w-3.5 h-3.5" />
              <span>Duplicate and edit</span>
            </button>
          </div>
        </div>

        {/* Recipe Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {recipes.map((recipe) => {
            const isSelected = recipe.id === activeRecipe.id;
            const tally = getRecipeRunTally(runLogs, recipe.id);
            const totalRuns = Object.values(tally).reduce((a, b) => a + b, 0);

            return (
              <div
                key={recipe.id}
                onClick={() => handleSelectRecipe(recipe)}
                className={`p-3.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between gap-2 ${
                  isSelected
                    ? 'bg-[#f5c518]/12 border-[#f5c518]'
                    : 'bg-white/[0.025] border-white/10 hover:border-white/25 hover:bg-white/[0.04]'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="font-display text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 truncate">
                      {recipe.isLockedPreset ? (
                        <Lock className="w-3.5 h-3.5 text-[#f5c518] shrink-0" />
                      ) : (
                        <Sliders className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      <span className="truncate">{recipe.name}</span>
                    </span>
                    <span
                      className={`text-[11px] font-mono font-medium shrink-0 ${
                        recipe.isLockedPreset ? 'text-amber-300' : 'text-emerald-300'
                      }`}
                    >
                      {recipe.isLockedPreset ? 'Locked' : 'Custom'}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                    {recipe.description}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1.5 border-t border-white/[0.06] text-[10px] font-mono text-zinc-400">
                  <span>
                    Body: <strong className="text-zinc-200">{recipe.switches.body}</strong> · Outfit:{' '}
                    <strong className="text-zinc-200">{recipe.switches.outfit}</strong>
                  </span>
                  {totalRuns > 0 && (
                    <span className="text-emerald-300">
                      ✓ {tally.Worked}/{totalRuns}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* User Recipe Rename / Delete Controls */}
        {!activeRecipe.isLockedPreset && (
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">Active User Recipe:</span>
              {isRenamingRecipe ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={editingRecipeName}
                    onChange={(e) => setEditingRecipeName(e.target.value)}
                    className="bg-black/60 border border-[#f5c518] rounded-lg px-2.5 py-1 text-xs text-white outline-none"
                    placeholder="Recipe name..."
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (editingRecipeName.trim()) {
                        updateUserSwapRecipe(activeRecipe.id, {
                          name: editingRecipeName.trim(),
                        });
                        setRecipes(getAllSwapRecipes());
                      }
                      setIsRenamingRecipe(false);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#f5c518] text-black font-bold cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <strong className="text-white">{activeRecipe.name}</strong>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!isRenamingRecipe && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingRecipeName(activeRecipe.name);
                    setIsRenamingRecipe(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/10 cursor-pointer"
                >
                  Rename
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  deleteUserSwapRecipe(activeRecipe.id);
                  const nextList = getAllSwapRecipes();
                  setRecipes(nextList);
                  handleSelectRecipe(LOCKED_SWAP_PRESETS[0]);
                }}
                className="px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete Recipe</span>
              </button>
            </div>
          </div>
        )}

        {lockedSwitchNotice && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-2">
            <span>{lockedSwitchNotice}</span>
            <button
              type="button"
              onClick={() => setLockedSwitchNotice(null)}
              className="text-zinc-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* SECTION 2: UP TO 4 IMAGE SLOTS (RESIZED TO 1024PX, NO AUTO-SCAN) */}
      <div
        className={`studio-panel rounded-2xl p-4 sm:p-5 space-y-4 ${
          mobileSection === 'images' ? 'block' : 'hidden lg:block'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div>
            <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-[#f5c518]" />
              <span>Reference Image Slots (Max 4 · Resized to 1024px)</span>
            </h3>
            <p className="text-xs text-zinc-400">
              Template and Face are required. Mannequin and Man are optional and never sent to the server unless you tap an optional text anchor.
            </p>
          </div>

          {/* People in Template Manual Selector (Always Available) */}
          <div className="flex flex-wrap items-center gap-2 bg-black/40 border border-white/10 px-3 py-1.5 rounded-xl shrink-0">
            <span className="text-xs font-semibold text-zinc-300">People in template:</span>
            {([1, 2] as const).map((cnt) => (
              <button
                key={cnt}
                type="button"
                onClick={() => setPeopleCount(cnt)}
                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                  peopleCount === cnt
                    ? 'bg-[#f5c518] text-black'
                    : 'bg-white/[0.06] text-zinc-400 hover:text-white'
                }`}
              >
                {cnt} {cnt === 1 ? 'Person' : 'People'}
              </button>
            ))}
          </div>
        </div>

        {/* 4 Image Slot Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* SLOT 1: TEMPLATE (REQUIRED) */}
          <div className="p-3.5 rounded-xl studio-card flex flex-col justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs font-bold text-white">1. Template</span>
                <span className="text-[11px] font-mono font-medium text-amber-300">
                  Required
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Master scene with person(s) in a pose. Controls pose, camera, framing & layout.
              </p>

              {templateImage ? (
                <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-black border border-white/15">
                  <img
                    src={templateImage.previewUrl}
                    alt="Template"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setTemplateImage(null)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/80 text-white hover:bg-red-600 flex items-center justify-center text-xs cursor-pointer"
                    title="Remove Template image"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => templateInputRef.current?.click()}
                  className="w-full aspect-[4/3] rounded-lg border-2 border-dashed border-white/15 hover:border-[#f5c518]/60 flex flex-col items-center justify-center gap-1.5 text-zinc-400 hover:text-white transition cursor-pointer bg-black/20"
                >
                  <Upload className="w-5 h-5 text-[#f5c518]" />
                  <span className="text-xs font-semibold">Upload Template</span>
                </button>
              )}
            </div>

            <div className="space-y-2 pt-1 border-t border-white/[0.06]">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => templateInputRef.current?.click()}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 text-[11px] font-semibold border border-white/10 transition cursor-pointer"
                >
                  {templateImage ? 'Replace' : 'Select Image'}
                </button>
                <button
                  type="button"
                  disabled={!templateImage || isScanningTemplate}
                  onClick={handleScanTemplateOptional}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#f5c518]/15 hover:bg-[#f5c518]/25 text-[#f5c518] border border-[#f5c518]/30 text-[11px] font-bold transition disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1"
                  title="Optional scan for people count, scene type, and visible body parts"
                >
                  {isScanningTemplate ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  <span>Scan template (optional)</span>
                </button>
              </div>
            </div>
          </div>

          {/* SLOT 2: FACE (REQUIRED) */}
          <div className="p-3.5 rounded-xl studio-card flex flex-col justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs font-bold text-white">2. Face</span>
                <span className="text-[11px] font-mono font-medium text-amber-300">
                  Required
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Close-up or half-body front-facing portrait of a woman. Identity reference for Subject 1.
              </p>

              {faceImage ? (
                <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-black border border-white/15">
                  <img
                    src={faceImage.previewUrl}
                    alt="Face"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setFaceImage(null)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/80 text-white hover:bg-red-600 flex items-center justify-center text-xs cursor-pointer"
                    title="Remove Face image"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => faceInputRef.current?.click()}
                  className="w-full aspect-[4/3] rounded-lg border-2 border-dashed border-white/15 hover:border-[#f5c518]/60 flex flex-col items-center justify-center gap-1.5 text-zinc-400 hover:text-white transition cursor-pointer bg-black/20"
                >
                  <Upload className="w-5 h-5 text-[#f5c518]" />
                  <span className="text-xs font-semibold">Upload Face</span>
                </button>
              )}
            </div>

            <div className="space-y-1.5 pt-1 border-t border-white/[0.06] text-[11px]">
              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={faceShowsOnlyUpperBody}
                  onChange={(e) => setFaceShowsOnlyUpperBody(e.target.checked)}
                  className="accent-[#f5c518]"
                />
                <span>Face shows upper body only</span>
              </label>
              <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={faceHasClearExpression}
                  onChange={(e) => setFaceHasClearExpression(e.target.checked)}
                  className="accent-[#f5c518]"
                />
                <span>Face has clear expression</span>
              </label>
              <button
                type="button"
                disabled={!faceImage || isDescribingFace}
                onClick={handleDescribeFaceAnchor}
                className="w-full mt-1 py-1.5 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/10 font-semibold transition disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1"
              >
                {isDescribingFace ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3 text-[#f5c518]" />
                )}
                <span>Describe Face lighting and outfit</span>
              </button>
            </div>
          </div>

          {/* SLOT 3: MANNEQUIN (OPTIONAL) */}
          <div
            className={`p-3.5 rounded-xl studio-card flex flex-col justify-between gap-3 ${
              switches.body === 'mannequin' ? 'border-[#f5c518]/50' : ''
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs font-bold text-white">3. Mannequin</span>
                <span
                  className={`text-[11px] font-mono ${
                    switches.body === 'mannequin' ? 'text-[#f5c518] font-medium' : 'text-zinc-400'
                  }`}
                >
                  {switches.body === 'mannequin' ? 'Active in Matrix' : 'Optional'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Full-figure 3D mannequin body blueprint for Subject 1 when Body = Mannequin.
              </p>

              {mannequinImage ? (
                <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-black border border-white/15">
                  <img
                    src={mannequinImage.previewUrl}
                    alt="Mannequin"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setMannequinImage(null)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/80 text-white hover:bg-red-600 flex items-center justify-center text-xs cursor-pointer"
                    title="Remove Mannequin image"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => mannequinInputRef.current?.click()}
                  className="w-full aspect-[4/3] rounded-lg border-2 border-dashed border-white/15 hover:border-[#f5c518]/60 flex flex-col items-center justify-center gap-1.5 text-zinc-400 hover:text-white transition cursor-pointer bg-black/20"
                >
                  <Upload className="w-5 h-5 text-zinc-400" />
                  <span className="text-xs font-semibold">Upload Mannequin</span>
                </button>
              )}
            </div>

            <div className="space-y-1.5 pt-1 border-t border-white/[0.06] text-[11px]">
              <button
                type="button"
                onClick={() => mannequinInputRef.current?.click()}
                className="w-full py-1.5 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/10 font-semibold transition cursor-pointer"
              >
                {mannequinImage ? 'Replace Mannequin' : 'Select Mannequin'}
              </button>
              <button
                type="button"
                disabled={!mannequinImage || isDescribingMannequin}
                onClick={handleDescribeMannequinAnchor}
                className="w-full py-1.5 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/10 font-semibold transition disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1"
              >
                {isDescribingMannequin ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3 text-[#f5c518]" />
                )}
                <span>Describe Mannequin build</span>
              </button>
            </div>
          </div>

          {/* SLOT 4: MAN (OPTIONAL) */}
          <div
            className={`p-3.5 rounded-xl studio-card flex flex-col justify-between gap-3 ${
              peopleCount === 2 && secondPersonSwapped ? 'border-[#f5c518]/50' : ''
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs font-bold text-white">4. Man</span>
                <span
                  className={`text-[11px] font-mono ${
                    peopleCount === 2 && secondPersonSwapped
                      ? 'text-[#f5c518] font-medium'
                      : 'text-zinc-400'
                  }`}
                >
                  {peopleCount === 2 && secondPersonSwapped ? '2-Person Active' : 'Optional'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Optional portrait of a man. Used only when Template contains a second person to swap.
              </p>

              {manImage ? (
                <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-black border border-white/15">
                  <img
                    src={manImage.previewUrl}
                    alt="Man"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setManImage(null)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/80 text-white hover:bg-red-600 flex items-center justify-center text-xs cursor-pointer"
                    title="Remove Man image"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => manInputRef.current?.click()}
                  className="w-full aspect-[4/3] rounded-lg border-2 border-dashed border-white/15 hover:border-[#f5c518]/60 flex flex-col items-center justify-center gap-1.5 text-zinc-400 hover:text-white transition cursor-pointer bg-black/20"
                >
                  <Upload className="w-5 h-5 text-zinc-400" />
                  <span className="text-xs font-semibold">Upload Man</span>
                </button>
              )}
            </div>

            <div className="space-y-1.5 pt-1 border-t border-white/[0.06] text-[11px]">
              {peopleCount === 2 && (
                <label className="flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={secondPersonSwapped}
                    onChange={(e) => setSecondPersonSwapped(e.target.checked)}
                    className="accent-[#f5c518]"
                  />
                  <span>Swap 2nd person with Man image</span>
                </label>
              )}
              <button
                type="button"
                onClick={() => manInputRef.current?.click()}
                className="w-full py-1.5 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/10 font-semibold transition cursor-pointer"
              >
                {manImage ? 'Replace Man Image' : 'Select Man Image'}
              </button>
            </div>
          </div>
        </div>

        {/* Optional Template Scan Summary & 2-Person Picker */}
        {templateScanSummary && (
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-2.5 text-xs">
            {templateScanSummary.isEstimate && (
              <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-500/40 text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Estimated blueprint, not an AI analysis:</strong>{' '}
                  {templateScanSummary.estimateNote ||
                    'You can set People in template (1 or 2) manually at any time.'}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-zinc-400">Template Scene Type: </span>
                <strong className="text-white">{templateScanSummary.sceneType}</strong>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-zinc-400">Visible in crop:</span>
                {templateScanSummary.visibleBodyParts.map((part) => (
                  <span
                    key={part}
                    className="px-2 py-0.5 rounded bg-white/[0.06] text-zinc-200 font-mono text-[11px]"
                  >
                    {part}
                  </span>
                ))}
              </div>
            </div>

            {peopleCount === 2 && (
              <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-300 font-semibold">
                  Which person in Template is Subject 1 (swapped with FACE)?
                </span>
                <div className="flex items-center gap-2">
                  {(templateScanSummary.subjectLabels.length >= 2
                    ? templateScanSummary.subjectLabels
                    : [
                        { id: 'A', label: 'Person A (Left / Primary)' },
                        { id: 'B', label: 'Person B (Right / Secondary)' },
                      ]
                  ).map((subj) => (
                    <button
                      key={subj.id}
                      type="button"
                      onClick={() => setSwappedPersonId(subj.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        swappedPersonId === subj.id
                          ? 'bg-[#f5c518] text-black font-bold'
                          : 'bg-white/[0.06] text-zinc-300 hover:text-white'
                      }`}
                    >
                      {subj.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION 3: SOURCE MATRIX SCREEN & LOCKED RULES */}
      <div
        className={`space-y-5 ${mobileSection === 'matrix' ? 'block' : 'hidden lg:block'}`}
      >
      <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div>
            <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#f5c518]" />
              <span>Source Matrix (Every Row Defaults to Template)</span>
            </h3>
            <p className="text-xs text-zinc-400">
              {activeRecipe.isLockedPreset
                ? `Viewing locked preset "${activeRecipe.name}". Clicking any switch will automatically create an editable copy.`
                : `Editing custom recipe "${activeRecipe.name}".`}
            </p>
          </div>
          {matchedPresetId && (
            <span className="text-xs font-mono text-emerald-300 shrink-0">
              Matches preset: {matchedPresetId.toUpperCase()}
            </span>
          )}
        </div>

        {/* 6 Matrix Switch Rows */}
        <div className="space-y-3">
          {/* ROW 1: BODY */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="font-display text-xs sm:text-sm font-bold text-white">1. Body</div>
              <div className="text-[11px] text-zinc-400">
                Keep original body from Template or rebuild from 3D Mannequin proportions
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'template', label: 'Template' },
                  { id: 'mannequin', label: 'Mannequin' },
                ] as Array<{ id: BodySource; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSwitchChange('body', opt.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    switches.body === opt.id
                      ? 'bg-[#f5c518] text-black font-bold'
                      : 'bg-white/[0.06] text-zinc-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ROW 2: OUTFIT */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-display text-xs sm:text-sm font-bold text-white">2. Outfit</div>
                <div className="text-[11px] text-zinc-400">
                  Source for Subject 1&apos;s clothing and garment fit
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'template', label: 'Template' },
                    { id: 'face', label: 'Face' },
                    { id: 'saved', label: 'Saved outfit' },
                    { id: 'typed', label: 'Typed text' },
                  ] as Array<{ id: OutfitSource; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSwitchChange('outfit', opt.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      switches.outfit === opt.id
                        ? 'bg-[#f5c518] text-black font-bold'
                        : 'bg-white/[0.06] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {switches.outfit === 'saved' && (
              <div className="pt-2 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-xs text-zinc-400 shrink-0">Saved Outfit:</span>
                <select
                  value={savedOutfitId}
                  onChange={(e) => setSavedOutfitId(e.target.value)}
                  className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-[#f5c518]"
                >
                  {savedOutfits.map((o) => (
                    <option key={o.id} value={o.id} className="bg-[#0e111a]">
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {switches.outfit === 'typed' && (
              <div className="pt-2 border-t border-white/[0.06]">
                <input
                  type="text"
                  value={typedOutfitText}
                  onChange={(e) => setTypedOutfitText(e.target.value)}
                  placeholder="Type custom outfit description (fabric, color, cut, footwear)..."
                  className="w-full bg-black/50 border border-white/15 focus:border-[#f5c518] rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
              </div>
            )}

            {switches.outfit === 'face' && (
              <div className="pt-2 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-[11px] text-zinc-400 shrink-0">
                  Optional bottom-wear line (if Face is upper-body only):
                </span>
                <input
                  ref={bottomWearInputRef}
                  type="text"
                  value={typedBottomWearLine}
                  onChange={(e) => setTypedBottomWearLine(e.target.value)}
                  placeholder="Leave blank for verbatim preset, or specify lower garment..."
                  className="flex-1 bg-black/50 border border-white/15 focus:border-[#f5c518] rounded-xl px-3 py-1.5 text-xs text-white outline-none"
                />
              </div>
            )}
          </div>

          {/* ROW 3: EXPRESSION */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="font-display text-xs sm:text-sm font-bold text-white">
                3. Expression
              </div>
              <div className="text-[11px] text-zinc-400">
                Smile shape, eye openness, mouth, cheek & brow movement
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'template', label: 'Template' },
                  { id: 'face', label: 'Face' },
                ] as Array<{ id: ExpressionSource; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSwitchChange('expression', opt.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    switches.expression === opt.id
                      ? 'bg-[#f5c518] text-black font-bold'
                      : 'bg-white/[0.06] text-zinc-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ROW 4: BACKGROUND */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-display text-xs sm:text-sm font-bold text-white">
                  4. Background
                </div>
                <div className="text-[11px] text-zinc-400">
                  Keep Template environment, rebuild in Face&apos;s visual language, or use Saved/Typed
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'template', label: 'Template' },
                    { id: 'face_style', label: "Recreated in Face's style" },
                    { id: 'saved', label: 'Saved background' },
                    { id: 'typed', label: 'Typed text' },
                  ] as Array<{ id: BackgroundSource; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSwitchChange('background', opt.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      switches.background === opt.id
                        ? 'bg-[#f5c518] text-black font-bold'
                        : 'bg-white/[0.06] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {switches.background === 'saved' && (
              <div className="pt-2 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-xs text-zinc-400 shrink-0">Saved Background:</span>
                <select
                  value={savedBackgroundId}
                  onChange={(e) => setSavedBackgroundId(e.target.value)}
                  className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-[#f5c518]"
                >
                  {savedBackgrounds.map((b) => (
                    <option key={b.id} value={b.id} className="bg-[#0e111a]">
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {switches.background === 'typed' && (
              <div className="pt-2 border-t border-white/[0.06]">
                <input
                  type="text"
                  value={typedBackgroundText}
                  onChange={(e) => setTypedBackgroundText(e.target.value)}
                  placeholder="Type custom background & environment description..."
                  className="w-full bg-black/50 border border-white/15 focus:border-[#f5c518] rounded-xl px-3 py-2 text-xs text-white outline-none"
                />
              </div>
            )}
          </div>

          {/* ROW 5: LIGHTING */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="font-display text-xs sm:text-sm font-bold text-white">5. Lighting</div>
              <div className="text-[11px] text-zinc-400">
                Direction, softness, color temperature, shadows & catchlights
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'template', label: 'Template' },
                  { id: 'face', label: 'Face' },
                ] as Array<{ id: LightingSource; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSwitchChange('lighting', opt.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    switches.lighting === opt.id
                      ? 'bg-[#f5c518] text-black font-bold'
                      : 'bg-white/[0.06] text-zinc-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ROW 6: ORNAMENTS */}
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="font-display text-xs sm:text-sm font-bold text-white">
                6. Ornaments
              </div>
              <div className="text-[11px] text-zinc-400">
                Earrings, chains, jewelry & body ornaments on Subject 1
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'face', label: 'Face only' },
                  { id: 'template', label: 'Template' },
                  { id: 'none', label: 'None' },
                ] as Array<{ id: OrnamentsSource; label: string }>
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSwitchChange('ornaments', opt.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    switches.ornaments === opt.id
                      ? 'bg-[#f5c518] text-black font-bold'
                      : 'bg-white/[0.06] text-zinc-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Optional Text Anchors Editor (Off by Default, Cached by Image Hash) */}
        <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#f5c518]" />
              <span>Optional Text Anchors (Off by default · Inserts - TEXT ANCHOR: ...)</span>
            </span>
            {anchorStatusNotice && (
              <span className="text-[11px] text-emerald-300 font-mono">{anchorStatusNotice}</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {/* Face Outfit Anchor */}
            <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/10 space-y-1.5">
              <label className="flex items-center justify-between gap-2 font-semibold text-zinc-200 cursor-pointer">
                <span>Face Outfit Anchor</span>
                <input
                  type="checkbox"
                  checked={anchors.faceOutfitEnabled}
                  onChange={(e) =>
                    setAnchors((prev) => ({ ...prev, faceOutfitEnabled: e.target.checked }))
                  }
                  className="accent-[#f5c518]"
                />
              </label>
              <input
                type="text"
                value={anchors.faceOutfitText}
                onChange={(e) =>
                  setAnchors((prev) => ({ ...prev, faceOutfitText: e.target.value }))
                }
                placeholder="Tap 'Describe Face...' or type anchor..."
                className="w-full bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white outline-none"
              />
            </div>

            {/* Face Lighting Anchor */}
            <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/10 space-y-1.5">
              <label className="flex items-center justify-between gap-2 font-semibold text-zinc-200 cursor-pointer">
                <span>Face Lighting Anchor</span>
                <input
                  type="checkbox"
                  checked={anchors.faceLightingEnabled}
                  onChange={(e) =>
                    setAnchors((prev) => ({ ...prev, faceLightingEnabled: e.target.checked }))
                  }
                  className="accent-[#f5c518]"
                />
              </label>
              <input
                type="text"
                value={anchors.faceLightingText}
                onChange={(e) =>
                  setAnchors((prev) => ({ ...prev, faceLightingText: e.target.value }))
                }
                placeholder="Tap 'Describe Face...' or type anchor..."
                className="w-full bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white outline-none"
              />
            </div>

            {/* Mannequin Build Anchor */}
            <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/10 space-y-1.5">
              <label className="flex items-center justify-between gap-2 font-semibold text-zinc-200 cursor-pointer">
                <span>Mannequin Build Anchor</span>
                <input
                  type="checkbox"
                  checked={anchors.mannequinBuildEnabled}
                  onChange={(e) =>
                    setAnchors((prev) => ({ ...prev, mannequinBuildEnabled: e.target.checked }))
                  }
                  className="accent-[#f5c518]"
                />
              </label>
              <input
                type="text"
                value={anchors.mannequinBuildText}
                onChange={(e) =>
                  setAnchors((prev) => ({ ...prev, mannequinBuildText: e.target.value }))
                }
                placeholder="Tap 'Describe Mannequin...' or type anchor..."
                className="w-full bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white outline-none"
              />
            </div>
          </div>
        </div>

        {/* Locked Invariant Rules + Live "Images needed" Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1">
          <div className="lg:col-span-7 p-3 rounded-xl bg-white/[0.02] border border-white/10 text-[11px] text-zinc-300 flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-[#f5c518] shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Locked Rules (Always Enforced):</strong> Pose, hand/leg
              gestures, gaze direction, camera angle, framing, crop, ratio, and subject positions
              always come from <strong>TEMPLATE</strong>. Subject 1 face, hair, and skin identity
              always come from <strong>FACE</strong>. Subject 2 identity comes from{' '}
              <strong>MAN</strong> with body &amp; outfit from <strong>TEMPLATE</strong>.
            </div>
          </div>

          <div className="lg:col-span-5 p-3 rounded-xl bg-[#f5c518]/10 border border-[#f5c518]/30 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#f5c518] shrink-0">Images needed:</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {imagesNeeded.map((slot, idx) => (
                <span
                  key={slot}
                  className="px-2 py-0.5 rounded-md bg-black/60 text-white font-mono text-xs font-bold border border-white/15"
                >
                  {idx + 1}. {slot}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 4: INSTANT CONFLICT CHECKER */}
      {conflicts.length > 0 && (
        <div className="studio-panel rounded-2xl p-4 sm:p-5 space-y-3 border border-amber-500/40">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xs sm:text-sm font-bold text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>
                Setup &amp; Matrix Conflict Check ({conflicts.filter((c) => c.blocking).length}{' '}
                Blocking · {conflicts.filter((c) => !c.blocking).length} Warning)
              </span>
            </h3>
            <span className="text-[11px] text-zinc-400">
              Only missing required images block Copy
            </span>
          </div>

          <div className="space-y-2">
            {conflicts.map((item) => (
              <div
                key={item.id}
                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs ${
                  item.blocking
                    ? 'bg-red-950/40 border-red-500/40 text-red-200'
                    : 'bg-amber-950/30 border-amber-500/30 text-amber-100'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`text-[11px] font-mono font-bold shrink-0 mt-0.5 ${
                      item.blocking ? 'text-red-300' : 'text-amber-300'
                    }`}
                  >
                    {item.blocking ? 'Blocking:' : 'Warning:'}
                  </span>
                  <span>{item.message}</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleApplyConflictFix(item)}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#f5c518] hover:bg-[#ffe169] text-black font-bold text-xs shrink-0 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>{item.fixLabel}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>

      {/* SECTION 5: OUTPUT SCREEN & CHEAT SHEET */}
      <div
        className={`studio-panel rounded-2xl p-4 sm:p-5 space-y-4 ${
          mobileSection === 'output' ? 'block' : 'hidden lg:block'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div>
            <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-[#f5c518]" />
              <span>Deterministic Swap Prompt Output</span>
            </h3>
            <p className="text-xs text-zinc-400">
              {activeRecipe.isLockedPreset
                ? `Verbatim locked preset "${activeRecipe.name}". Read-only.`
                : `Assembled deterministically from cut-out blocks for "${activeRecipe.name}". Read-only.`}
            </p>
          </div>

          {/* Save as Project Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="Project title..."
              className="bg-black/40 border border-white/15 focus:border-[#f5c518] rounded-xl px-3 py-1.5 text-xs text-white outline-none w-40 sm:w-48"
            />
            <button
              type="button"
              onClick={handleSaveAsProject}
              className="px-3.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white font-bold text-xs border border-white/15 flex items-center gap-1.5 transition cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-[#f5c518]" />
              <span>Save as project</span>
            </button>
            {onOpenProjects && (
              <button
                type="button"
                onClick={onOpenProjects}
                className="px-2.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 text-xs border border-white/10 transition cursor-pointer"
              >
                View Projects
              </button>
            )}
          </div>
        </div>

        {projectSavedNotice && (
          <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{projectSavedNotice}</span>
          </div>
        )}

        {/* "Images needed, in this order" Cheat Sheet */}
        <div className="p-3.5 rounded-xl bg-black/50 border border-white/10 space-y-2">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-[#f5c518]" />
            <span>Images needed, in this order (attach alongside the prompt):</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {imagesNeeded.map((slot, idx) => {
              const uploaded =
                (slot === 'Template' && Boolean(templateImage)) ||
                (slot === 'Face' && Boolean(faceImage)) ||
                (slot === 'Mannequin' && Boolean(mannequinImage)) ||
                (slot === 'Man' && Boolean(manImage));
              return (
                <div
                  key={slot}
                  className={`p-2.5 rounded-lg border flex items-center justify-between text-xs ${
                    uploaded
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                      : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                  }`}
                >
                  <span className="font-mono font-bold">
                    #{idx + 1} · {slot.toUpperCase()}
                  </span>
                  <span className="text-[11px]">{uploaded ? '✓ Ready' : 'Upload slot'}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Read-only Deterministic Prompt Textarea */}
        <textarea
          readOnly
          value={finalPrompt}
          rows={18}
          className="w-full glass-panel text-white p-4 rounded-2xl text-xs font-mono leading-relaxed outline-none select-text selection:bg-[#f5c518] selection:text-black shadow-inner resize-y min-h-[280px]"
        />

        {/* Primary Copy Button */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <button
            type="button"
            disabled={isCopyBlocked}
            onClick={handleCopyPrompt}
            className="flex-1 py-3.5 px-6 rounded-xl bg-gradient-to-r from-[#ffe169] via-[#f5c518] to-[#d49a00] hover:brightness-105 text-black font-black text-xs sm:text-sm uppercase tracking-wider shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {copySuccess ? (
              <>
                <Check className="w-4 h-4 text-black stroke-[2.5]" />
                <span>Copied Swap Prompt!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-black stroke-[2.5]" />
                <span>
                  {isCopyBlocked
                    ? 'Upload Required Template & Face Images to Copy'
                    : `Copy ${activeRecipe.name} Prompt`}
                </span>
              </>
            )}
          </button>
        </div>

        {/* SECTION 6: RESULT LOG & PER-RECIPE TALLY */}
        <div className="pt-3 border-t border-white/[0.08] space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#f5c518]" />
              <span className="font-display text-xs sm:text-sm font-bold text-white">
                Result Log · Tag Run Outcome for &ldquo;{activeRecipe.name}&rdquo;
              </span>
            </div>
            {loggedFeedbackNotice && (
              <span className="text-xs font-mono text-emerald-300">{loggedFeedbackNotice}</span>
            )}
          </div>

          {showPostCopyTagBar && (
            <div className="text-xs text-[#f5c518] font-medium">
              Prompt copied! After generating your image, tap a result tag below to track how this recipe performed:
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {SWAP_RUN_RESULT_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleLogRunResult(tag)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 ${
                  tag === 'Worked'
                    ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/30'
                    : 'bg-white/[0.05] hover:bg-white/[0.1] text-zinc-200 border-white/10'
                }`}
              >
                <span>{tag}</span>
                <span className="px-1.5 py-0.2 rounded bg-black/50 font-mono text-[10px] text-zinc-300">
                  {activeRecipeTally[tag] || 0}
                </span>
              </button>
            ))}

            <input
              type="text"
              value={otherRunNote}
              onChange={(e) => setOtherRunNote(e.target.value)}
              placeholder="Optional note for 'Other'..."
              className="bg-black/40 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white outline-none w-48"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
