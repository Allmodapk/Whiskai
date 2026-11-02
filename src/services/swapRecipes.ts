import { SwapPresetId } from './swapPresets';
import {
  SwapMatrixSwitches,
  SwapTextAnchors,
  PRESET_SWITCHES,
  DEFAULT_SWAP_SWITCHES,
} from './swapBlocks';

export const SWAP_STUDIO_SCHEMA_VERSION = 1;

export const SWAP_STORAGE_KEYS = {
  USER_RECIPES: 'whisk_swap_studio_user_recipes_v1',
  WORKSPACE_STATE: 'whisk_swap_studio_workspace_v1',
  RUN_LOG: 'whisk_swap_studio_run_log_v1',
  ANCHOR_CACHE: 'whisk_swap_studio_anchor_cache_v1',
};

export interface SwapRecipe {
  id: string;
  name: string;
  description: string;
  isLockedPreset: boolean;
  presetId?: SwapPresetId;
  switches: SwapMatrixSwitches;
  createdAt: number;
  updatedAt: number;
}

export const LOCKED_SWAP_PRESETS: SwapRecipe[] = [
  {
    id: 'preset_swap_v1',
    name: 'Swap v1',
    description: 'Body from Mannequin; Outfit, Expression, Background & Lighting from Template; Ornaments from Face only.',
    isLockedPreset: true,
    presetId: 'swap_v1',
    switches: { ...PRESET_SWITCHES.swap_v1 },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset_swap_v2',
    name: 'Swap v2',
    description: 'Swap v1 + Outfit from Face; Background & Lighting from Template; Body from Mannequin.',
    isLockedPreset: true,
    presetId: 'swap_v2',
    switches: { ...PRESET_SWITCHES.swap_v2 },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset_swap_v3_1',
    name: 'Swap v3.1',
    description: "Outfit from Face, Background recreated in Face's style, Lighting from Face, Body from Mannequin.",
    isLockedPreset: true,
    presetId: 'swap_v3_1',
    switches: { ...PRESET_SWITCHES.swap_v3_1 },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'preset_swap_v1_sub_2',
    name: 'Swap v1 Sub 2',
    description: 'Body kept from Template (no Mannequin, no second-person image); everything else from Template; Face gives identity & ornaments.',
    isLockedPreset: true,
    presetId: 'swap_v1_sub_2',
    switches: { ...PRESET_SWITCHES.swap_v1_sub_2 },
    createdAt: 0,
    updatedAt: 0,
  },
];

interface StoredUserRecipesEnvelope {
  schemaVersion: number;
  recipes: SwapRecipe[];
}

export interface SwapTemplateScanSummary {
  scanned: boolean;
  isEstimate: boolean;
  estimateNote?: string;
  sceneType: string;
  visibleBodyParts: string[];
  detectedPeopleCount: 1 | 2;
  subjectLabels: Array<{ id: string; label: string }>;
}

export interface SwapWorkspacePersistedState {
  schemaVersion: number;
  activeRecipeId: string;
  switches: SwapMatrixSwitches;
  savedOutfitId: string;
  typedOutfitText: string;
  typedBottomWearLine: string;
  savedBackgroundId: string;
  typedBackgroundText: string;
  peopleCount: 1 | 2;
  secondPersonSwapped: boolean;
  swappedPersonId: string;
  faceShowsOnlyUpperBody: boolean;
  faceHasClearExpression: boolean;
  anchors: SwapTextAnchors;
  templateScanSummary?: SwapTemplateScanSummary | null;
}

export type SwapRunResultTag =
  | 'Worked'
  | 'Body drift'
  | 'Lighting random'
  | 'Identity drift'
  | 'Background wrong'
  | 'Other';

export const SWAP_RUN_RESULT_TAGS: SwapRunResultTag[] = [
  'Worked',
  'Body drift',
  'Lighting random',
  'Identity drift',
  'Background wrong',
  'Other',
];

export interface SwapRunLogEntry {
  id: string;
  recipeId: string;
  recipeName: string;
  tag: SwapRunResultTag;
  note?: string;
  timestamp: number;
}

interface StoredRunLogEnvelope {
  schemaVersion: number;
  entries: SwapRunLogEntry[];
}

export interface CachedAnchorData {
  faceLightingText?: string;
  faceOutfitText?: string;
  mannequinBuildText?: string;
  updatedAt: number;
}

interface StoredAnchorCacheEnvelope {
  schemaVersion: number;
  byHash: Record<string, CachedAnchorData>;
}

function safeReadJson<T>(key: string): T | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeWriteJson(key: string, value: unknown): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`SwapStudio storage write warning (${key}):`, err);
    return false;
  }
}

// ============================================================================
// RECIPES MANAGEMENT
// ============================================================================

export function getUserSwapRecipes(): SwapRecipe[] {
  const parsed = safeReadJson<StoredUserRecipesEnvelope | SwapRecipe[]>(
    SWAP_STORAGE_KEYS.USER_RECIPES
  );
  if (!parsed) return [];
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.recipes)
    ? parsed.recipes
    : [];

  return list
    .filter((r) => r && typeof r.id === 'string' && r.switches)
    .map((r) => ({
      ...r,
      isLockedPreset: false,
      presetId: undefined,
      switches: {
        ...DEFAULT_SWAP_SWITCHES,
        ...r.switches,
      },
    }));
}

export function saveUserSwapRecipes(recipes: SwapRecipe[]): void {
  const sanitized = recipes.map((r) => ({
    ...r,
    isLockedPreset: false,
    presetId: undefined,
  }));
  const envelope: StoredUserRecipesEnvelope = {
    schemaVersion: SWAP_STUDIO_SCHEMA_VERSION,
    recipes: sanitized,
  };
  safeWriteJson(SWAP_STORAGE_KEYS.USER_RECIPES, envelope);
}

export function getAllSwapRecipes(): SwapRecipe[] {
  return [...LOCKED_SWAP_PRESETS, ...getUserSwapRecipes()];
}

export function getSwapRecipeById(id: string): SwapRecipe {
  const all = getAllSwapRecipes();
  return all.find((r) => r.id === id) || LOCKED_SWAP_PRESETS[0];
}

export function duplicateSwapRecipe(sourceRecipe: SwapRecipe, customName?: string): SwapRecipe {
  const userRecipes = getUserSwapRecipes();
  const baseName = customName?.trim() || `${sourceRecipe.name} (Copy)`;
  const now = Date.now();
  const created: SwapRecipe = {
    id: `user_swap_recipe_${now}_${Math.random().toString(36).slice(2, 6)}`,
    name: baseName,
    description: `Custom recipe duplicated from ${sourceRecipe.name}`,
    isLockedPreset: false,
    switches: { ...sourceRecipe.switches },
    createdAt: now,
    updatedAt: now,
  };
  userRecipes.unshift(created);
  saveUserSwapRecipes(userRecipes);
  return created;
}

export function updateUserSwapRecipe(
  recipeId: string,
  updates: Partial<Pick<SwapRecipe, 'name' | 'description' | 'switches'>>
): SwapRecipe | null {
  const userRecipes = getUserSwapRecipes();
  const idx = userRecipes.findIndex((r) => r.id === recipeId);
  if (idx < 0) return null;

  const updated: SwapRecipe = {
    ...userRecipes[idx],
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.description !== undefined ? { description: updates.description } : {}),
    ...(updates.switches !== undefined ? { switches: { ...updates.switches } } : {}),
    isLockedPreset: false,
    updatedAt: Date.now(),
  };
  userRecipes[idx] = updated;
  saveUserSwapRecipes(userRecipes);
  return updated;
}

export function deleteUserSwapRecipe(recipeId: string): void {
  const filtered = getUserSwapRecipes().filter((r) => r.id !== recipeId);
  saveUserSwapRecipes(filtered);
}

// ============================================================================
// ACTIVE WORKSPACE STATE PERSISTENCE (NO IMAGES STORED)
// ============================================================================

export const DEFAULT_SWAP_ANCHORS: SwapTextAnchors = {
  faceOutfitEnabled: false,
  faceOutfitText: '',
  faceLightingEnabled: false,
  faceLightingText: '',
  mannequinBuildEnabled: false,
  mannequinBuildText: '',
};

export function getDefaultSwapWorkspaceState(): SwapWorkspacePersistedState {
  return {
    schemaVersion: SWAP_STUDIO_SCHEMA_VERSION,
    activeRecipeId: LOCKED_SWAP_PRESETS[0].id,
    switches: { ...LOCKED_SWAP_PRESETS[0].switches },
    savedOutfitId: '',
    typedOutfitText: '',
    typedBottomWearLine: '',
    savedBackgroundId: '',
    typedBackgroundText: '',
    peopleCount: 1,
    secondPersonSwapped: true,
    swappedPersonId: 'A',
    faceShowsOnlyUpperBody: true,
    faceHasClearExpression: true,
    anchors: { ...DEFAULT_SWAP_ANCHORS },
    templateScanSummary: null,
  };
}

export function getPersistedSwapWorkspace(): SwapWorkspacePersistedState {
  const defaults = getDefaultSwapWorkspaceState();
  const raw = safeReadJson<Partial<SwapWorkspacePersistedState>>(SWAP_STORAGE_KEYS.WORKSPACE_STATE);
  if (!raw || typeof raw !== 'object') return defaults;

  return {
    schemaVersion: SWAP_STUDIO_SCHEMA_VERSION,
    activeRecipeId:
      typeof raw.activeRecipeId === 'string' && raw.activeRecipeId
        ? raw.activeRecipeId
        : defaults.activeRecipeId,
    switches: {
      ...defaults.switches,
      ...(raw.switches || {}),
    },
    savedOutfitId: typeof raw.savedOutfitId === 'string' ? raw.savedOutfitId : '',
    typedOutfitText: typeof raw.typedOutfitText === 'string' ? raw.typedOutfitText : '',
    typedBottomWearLine: typeof raw.typedBottomWearLine === 'string' ? raw.typedBottomWearLine : '',
    savedBackgroundId: typeof raw.savedBackgroundId === 'string' ? raw.savedBackgroundId : '',
    typedBackgroundText: typeof raw.typedBackgroundText === 'string' ? raw.typedBackgroundText : '',
    peopleCount: raw.peopleCount === 2 ? 2 : 1,
    secondPersonSwapped:
      typeof raw.secondPersonSwapped === 'boolean' ? raw.secondPersonSwapped : true,
    swappedPersonId: typeof raw.swappedPersonId === 'string' ? raw.swappedPersonId : 'A',
    faceShowsOnlyUpperBody:
      typeof raw.faceShowsOnlyUpperBody === 'boolean' ? raw.faceShowsOnlyUpperBody : true,
    faceHasClearExpression:
      typeof raw.faceHasClearExpression === 'boolean' ? raw.faceHasClearExpression : true,
    anchors: {
      ...DEFAULT_SWAP_ANCHORS,
      ...(raw.anchors || {}),
    },
    templateScanSummary: raw.templateScanSummary || null,
  };
}

export function savePersistedSwapWorkspace(state: SwapWorkspacePersistedState): void {
  const payload: SwapWorkspacePersistedState = {
    ...state,
    schemaVersion: SWAP_STUDIO_SCHEMA_VERSION,
  };
  safeWriteJson(SWAP_STORAGE_KEYS.WORKSPACE_STATE, payload);
}

// ============================================================================
// RESULT LOG & PER-RECIPE TALLY (SMALL JSON, NO IMAGES)
// ============================================================================

export function getSwapRunLogs(): SwapRunLogEntry[] {
  const raw = safeReadJson<StoredRunLogEnvelope | SwapRunLogEntry[]>(SWAP_STORAGE_KEYS.RUN_LOG);
  if (!raw) return [];
  const entries = Array.isArray(raw) ? raw : Array.isArray(raw.entries) ? raw.entries : [];
  return entries.filter((e) => e && typeof e.id === 'string' && typeof e.tag === 'string');
}

export function addSwapRunLog(
  recipeId: string,
  recipeName: string,
  tag: SwapRunResultTag,
  note?: string
): SwapRunLogEntry[] {
  const current = getSwapRunLogs();
  const entry: SwapRunLogEntry = {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    recipeId,
    recipeName,
    tag,
    note: note?.trim() || undefined,
    timestamp: Date.now(),
  };
  const updated = [entry, ...current].slice(0, 200);
  const envelope: StoredRunLogEnvelope = {
    schemaVersion: SWAP_STUDIO_SCHEMA_VERSION,
    entries: updated,
  };
  safeWriteJson(SWAP_STORAGE_KEYS.RUN_LOG, envelope);
  return updated;
}

export function clearSwapRunLogs(): void {
  const envelope: StoredRunLogEnvelope = {
    schemaVersion: SWAP_STUDIO_SCHEMA_VERSION,
    entries: [],
  };
  safeWriteJson(SWAP_STORAGE_KEYS.RUN_LOG, envelope);
}

export function getRecipeRunTally(
  entries: SwapRunLogEntry[],
  recipeId?: string
): Record<SwapRunResultTag, number> {
  const tally: Record<SwapRunResultTag, number> = {
    Worked: 0,
    'Body drift': 0,
    'Lighting random': 0,
    'Identity drift': 0,
    'Background wrong': 0,
    Other: 0,
  };
  for (const e of entries) {
    if (recipeId && e.recipeId !== recipeId) continue;
    if (tally[e.tag] !== undefined) {
      tally[e.tag] += 1;
    }
  }
  return tally;
}

// ============================================================================
// TEXT ANCHOR CACHE BY IMAGE HASH
// ============================================================================

/**
 * Fast deterministic FNV-1a 32-bit hash over base64 image payload (sampled if very large).
 */
export function computeImageHash(base64Data: string): string {
  if (!base64Data) return 'empty';
  let hash = 0x811c9dc5;
  const len = base64Data.length;
  const step = Math.max(1, Math.floor(len / 4096));
  for (let i = 0; i < len; i += step) {
    hash ^= base64Data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `imghash_${len}_${(hash >>> 0).toString(16)}`;
}

export function getCachedTextAnchor(imageHash: string): CachedAnchorData | null {
  if (!imageHash) return null;
  const raw = safeReadJson<StoredAnchorCacheEnvelope>(SWAP_STORAGE_KEYS.ANCHOR_CACHE);
  if (!raw || !raw.byHash) return null;
  return raw.byHash[imageHash] || null;
}

export function setCachedTextAnchor(
  imageHash: string,
  partialData: Partial<CachedAnchorData>
): void {
  if (!imageHash) return;
  const raw = safeReadJson<StoredAnchorCacheEnvelope>(SWAP_STORAGE_KEYS.ANCHOR_CACHE) || {
    schemaVersion: SWAP_STUDIO_SCHEMA_VERSION,
    byHash: {},
  };
  const existing = raw.byHash[imageHash] || { updatedAt: Date.now() };
  raw.byHash[imageHash] = {
    ...existing,
    ...partialData,
    updatedAt: Date.now(),
  };
  // Keep at most 40 cached hashes so localStorage stays tiny
  const keys = Object.keys(raw.byHash);
  if (keys.length > 40) {
    const sorted = keys.sort(
      (a, b) => (raw.byHash[b]?.updatedAt || 0) - (raw.byHash[a]?.updatedAt || 0)
    );
    const trimmed: Record<string, CachedAnchorData> = {};
    for (const k of sorted.slice(0, 40)) {
      trimmed[k] = raw.byHash[k];
    }
    raw.byHash = trimmed;
  }
  safeWriteJson(SWAP_STORAGE_KEYS.ANCHOR_CACHE, raw);
}
