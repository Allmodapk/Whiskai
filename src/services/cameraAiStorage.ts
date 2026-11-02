import {
  CameraAiTemplateAnalysis,
  CameraAiBaseAnalysis,
  TargetModelType,
} from '../types';
import { CameraAiVariant } from './cameraAiPrompt';

export const CAMERA_AI_SCHEMA_VERSION = 1;

export const CAMERA_AI_STORAGE_KEYS = {
  CACHE: 'whisk_camera_ai_cache_v1',
  WORKSPACE: 'whisk_camera_ai_workspace_v1',
};

export interface CachedCameraAiScan {
  template?: CameraAiTemplateAnalysis;
  base?: CameraAiBaseAnalysis;
  updatedAt: number;
}

export interface CameraAiPersistedWorkspace {
  schemaVersion: number;
  templateAnalysis: CameraAiTemplateAnalysis | null;
  baseAnalysis: CameraAiBaseAnalysis | null;
  activeVariant: CameraAiVariant;
  targetModel: TargetModelType;
  projectTitle: string;
}

/**
 * Fast deterministic FNV-1a hash over base64 string
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
    console.warn(`CameraAI storage write warning (${key}):`, err);
    return false;
  }
}

export function getCachedCameraScan(imageHash: string): CachedCameraAiScan | null {
  if (!imageHash) return null;
  const envelope = safeReadJson<{
    schemaVersion: number;
    byHash: Record<string, CachedCameraAiScan>;
  }>(CAMERA_AI_STORAGE_KEYS.CACHE);
  if (!envelope || !envelope.byHash) return null;
  return envelope.byHash[imageHash] || null;
}

export function setCachedCameraScan(
  imageHash: string,
  partialScan: Partial<CachedCameraAiScan>
): void {
  if (!imageHash) return;
  const envelope = safeReadJson<{
    schemaVersion: number;
    byHash: Record<string, CachedCameraAiScan>;
  }>(CAMERA_AI_STORAGE_KEYS.CACHE) || {
    schemaVersion: CAMERA_AI_SCHEMA_VERSION,
    byHash: {},
  };

  const existing = envelope.byHash[imageHash] || { updatedAt: Date.now() };
  envelope.byHash[imageHash] = {
    ...existing,
    ...partialScan,
    updatedAt: Date.now(),
  };

  // Limit to 30 cached hashes to keep localStorage small
  const keys = Object.keys(envelope.byHash);
  if (keys.length > 30) {
    const sorted = keys.sort(
      (a, b) => (envelope.byHash[b]?.updatedAt || 0) - (envelope.byHash[a]?.updatedAt || 0)
    );
    const trimmed: Record<string, CachedCameraAiScan> = {};
    for (const k of sorted.slice(0, 30)) {
      trimmed[k] = envelope.byHash[k];
    }
    envelope.byHash = trimmed;
  }

  safeWriteJson(CAMERA_AI_STORAGE_KEYS.CACHE, envelope);
}

export function getPersistedCameraAiWorkspace(): CameraAiPersistedWorkspace {
  const defaults: CameraAiPersistedWorkspace = {
    schemaVersion: CAMERA_AI_SCHEMA_VERSION,
    templateAnalysis: null,
    baseAnalysis: null,
    activeVariant: 'full',
    targetModel: 'universal',
    projectTitle: '',
  };

  const raw = safeReadJson<Partial<CameraAiPersistedWorkspace>>(CAMERA_AI_STORAGE_KEYS.WORKSPACE);
  if (!raw || typeof raw !== 'object') return defaults;

  return {
    schemaVersion: CAMERA_AI_SCHEMA_VERSION,
    templateAnalysis: raw.templateAnalysis || null,
    baseAnalysis: raw.baseAnalysis || null,
    activeVariant:
      raw.activeVariant === 'compact' || raw.activeVariant === 'no_base'
        ? raw.activeVariant
        : 'full',
    targetModel:
      raw.targetModel === 'gemini' || raw.targetModel === 'chatgpt' || raw.targetModel === 'flux'
        ? raw.targetModel
        : 'universal',
    projectTitle: typeof raw.projectTitle === 'string' ? raw.projectTitle : '',
  };
}

export function savePersistedCameraAiWorkspace(workspace: CameraAiPersistedWorkspace): void {
  safeWriteJson(CAMERA_AI_STORAGE_KEYS.WORKSPACE, {
    ...workspace,
    schemaVersion: CAMERA_AI_SCHEMA_VERSION,
  });
}
