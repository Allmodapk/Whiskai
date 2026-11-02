import {
  ComponentKey,
  ALL_COMPONENT_KEYS,
  COMPONENT_LABELS,
  DetectedComponent,
  ComponentState,
  SubjectData,
  CameraControlSettings,
  ToolType,
  SubjectProfile,
} from '../types';
import { findIgnoredSubjectLeaks } from './leakGuard';

export const PERSON_COMPONENT_KEYS: ComponentKey[] = [
  'subject',
  'body',
  'pose',
  'clothing',
  'facial_expression',
  'hand_gestures',
  'leg_gestures',
];

export const SHARED_SCENE_COMPONENT_KEYS: ComponentKey[] = [
  'camera',
  'framing',
  'lighting',
  'background',
  'environment',
  'composition',
  'interaction',
];

export const CORE_13_COMPONENT_KEYS: ComponentKey[] = [
  'subject',
  'body',
  'pose',
  'camera',
  'framing',
  'clothing',
  'lighting',
  'background',
  'environment',
  'composition',
  'facial_expression',
  'hand_gestures',
  'leg_gestures',
];

export type VisibilityReason =
  | 'missing from response'
  | 'empty detectedText'
  | 'model said unavailable'
  | 'visible'
  | 'partial';

export interface ComponentDecisionInfo {
  key: ComponentKey;
  label: string;
  bucket: string;
  visibility: 'visible' | 'partial' | 'unavailable';
  reason: VisibilityReason;
  textLength: number;
  detectedTextLength: number;
}

export interface ScanDebugReportData {
  timestamp: string;
  httpStatus: number;
  modelUsed: string;
  quotaFallback: boolean;
  responseLength: number;
  finishReason: string;
  jsonParseSucceeded: boolean;
  jsonRepaired: boolean;
  repairNote?: string;
  truncationRepairTriggered: boolean;
  repairedKeys: string[];
  topLevelKeys: string[];
  subjects: SubjectData[];
  bucketKeysFound: {
    shared: ComponentKey[];
    perSubject: Record<string, ComponentKey[]>;
    flatComponents: ComponentKey[];
  };
  decisions: ComponentDecisionInfo[];
  rawModelTextPreview: string;
  soloDebug?: {
    ran?: boolean;
    httpStatus: number;
    modelUsed: string;
    finishReason: string;
    responseLength: number;
    jsonParseSucceeded: boolean;
    jsonRepaired: boolean;
    repairNote?: string;
    visibleCount: number;
    fallbackToStoredMultiUsed: boolean;
    rawModelTextPreview: string;
  };
}

export interface CanonicalScanStructure {
  leadSentence: string;
  styleCategory: 'photorealistic' | 'illustration' | '3D' | 'painting';
  summary: string;
  outputRatio: string;
  ratioExplanation: string;
  cameraEstimates: Partial<CameraControlSettings>;
  subjects: SubjectData[];
  topLevelKeys: string[];
  sharedComponents: Record<ComponentKey, DetectedComponent>;
  personComponents: Record<string, Record<ComponentKey, DetectedComponent>>;
  /** Complete 14-component map for the active mode ('all' or 'solo') */
  activeComponents: Record<ComponentKey, DetectedComponent>;
  /** Unmodified reference snapshot of activeComponents */
  originalComponents: Record<ComponentKey, DetectedComponent>;
  decisions: ComponentDecisionInfo[];
  bucketKeysFound: {
    shared: ComponentKey[];
    perSubject: Record<string, ComponentKey[]>;
    flatComponents: ComponentKey[];
  };
  presentCoreCount: number;
  expectedCoreCount: number;
  missingCoreKeys: ComponentKey[];
  visibleCount: number;
  needsRepair: boolean;
  repairReasons: string[];
}

export interface NormalizeScanOptions {
  mode?: 'all' | 'solo';
  keepIds?: string[];
  fallbackRatio?: string;
  finishReason?: string;
  jsonRepaired?: boolean;
  activeTool?: ToolType;
  activeProfile?: SubjectProfile;
}

interface RawFieldExtract {
  presentInResponse: boolean;
  detectedText: string;
  explanation: string;
  rawVisibility?: string;
  confidence?: 'high' | 'medium' | 'estimated';
}

function extractRawField(rawVal: any): RawFieldExtract {
  if (rawVal === undefined || rawVal === null) {
    return {
      presentInResponse: false,
      detectedText: '',
      explanation: '',
    };
  }

  if (typeof rawVal === 'string') {
    const trimmed = rawVal.trim();
    const isUnavailString =
      trimmed.toLowerCase() === 'unavailable' ||
      trimmed.toLowerCase() === 'not visible in frame' ||
      trimmed.toLowerCase() === 'n/a';
    return {
      presentInResponse: true,
      detectedText: isUnavailString ? '' : trimmed,
      explanation: '',
      rawVisibility: isUnavailString ? 'unavailable' : trimmed ? 'visible' : undefined,
      confidence: 'high',
    };
  }

  if (typeof rawVal === 'object' && !Array.isArray(rawVal)) {
    const rawText =
      typeof rawVal.detectedText === 'string'
        ? rawVal.detectedText
        : typeof rawVal.text === 'string'
        ? rawVal.text
        : typeof rawVal.description === 'string'
        ? rawVal.description
        : typeof rawVal.value === 'string'
        ? rawVal.value
        : '';
    const trimmed = rawText.trim();
    const isUnavailString =
      trimmed.toLowerCase() === 'unavailable' ||
      trimmed.toLowerCase() === 'not visible in frame' ||
      trimmed.toLowerCase() === 'n/a';

    const rawVis =
      typeof rawVal.visibility === 'string'
        ? rawVal.visibility.toLowerCase().trim()
        : isUnavailString
        ? 'unavailable'
        : undefined;

    const explanation =
      typeof rawVal.explanation === 'string'
        ? rawVal.explanation.trim()
        : typeof rawVal.evidence === 'string'
        ? rawVal.evidence.trim()
        : '';

    const conf =
      rawVal.confidence === 'estimated' || rawVal.confidence === 'medium'
        ? rawVal.confidence
        : 'high';

    return {
      presentInResponse: true,
      detectedText: isUnavailString || rawVis === 'unavailable' ? '' : trimmed,
      explanation,
      rawVisibility: rawVis,
      confidence: conf,
    };
  }

  return {
    presentInResponse: false,
    detectedText: '',
    explanation: '',
  };
}

function evaluateDecision(
  key: ComponentKey,
  extract: RawFieldExtract
): {
  component: DetectedComponent;
  decision: ComponentDecisionInfo;
} {
  let visibility: 'visible' | 'partial' | 'unavailable' = 'unavailable';
  let reason: VisibilityReason = 'missing from response';

  if (!extract.presentInResponse) {
    visibility = 'unavailable';
    reason = 'missing from response';
  } else if (extract.rawVisibility === 'unavailable') {
    visibility = 'unavailable';
    reason = 'model said unavailable';
  } else if (!extract.detectedText.trim()) {
    visibility = 'unavailable';
    reason = 'empty detectedText';
  } else if (extract.rawVisibility === 'partial') {
    visibility = 'partial';
    reason = 'partial';
  } else {
    visibility = 'visible';
    reason = 'visible';
  }

  const detectedText = visibility === 'unavailable' ? '' : extract.detectedText.trim();
  const state: ComponentState = visibility === 'unavailable' ? 'unavailable' : 'locked';

  const component: DetectedComponent = {
    key,
    label: COMPONENT_LABELS[key],
    detectedText,
    userText: '',
    state,
    source: 'reference',
    explanation: extract.explanation,
    confidence: extract.confidence || 'high',
    visibility,
  };

  const bucket = SHARED_SCENE_COMPONENT_KEYS.includes(key) ? 'shared' : 'person';
  const decision: ComponentDecisionInfo = {
    key,
    label: COMPONENT_LABELS[key],
    bucket,
    visibility,
    reason,
    textLength: detectedText.length,
    detectedTextLength: detectedText.length,
  };

  return { component, decision };
}

/**
 * Splits a merged "Subject A: ... Subject B: ..." string into per-subject descriptions if present.
 */
function trySplitMergedSubjectText(text: string, subjectId: string): string | null {
  if (!text) return null;
  const regex = new RegExp(
    `Subject\\s+${subjectId}\\b[^:]*:\\s*([\\s\\S]*?)(?=\\bSubject\\s+[A-Z]\\b[^:]*:|$)`,
    'i'
  );
  const match = text.match(regex);
  if (match && match[1] && match[1].trim()) {
    return match[1].trim();
  }
  return null;
}

/**
 * Normalizes ANY server/model scan response shape (old flat shape, per-subject shape,
 * top-level flat keys, or nested subject maps) into the canonical structure:
 * `sharedComponents` + `personComponents[subjectId]` + `activeComponents`.
 */
export function normalizeScanResult(
  rawInput: any,
  options: NormalizeScanOptions = {}
): CanonicalScanStructure {
  const mode = options.mode || 'all';
  const raw =
    rawInput && typeof rawInput === 'object' && rawInput.analysis && typeof rawInput.analysis === 'object'
      ? rawInput.analysis
      : rawInput && typeof rawInput === 'object'
      ? rawInput
      : {};

  const topLevelKeys = raw && typeof raw === 'object' ? Object.keys(raw) : [];

  // 1. Normalize subjects array
  const rawSubjects = Array.isArray(raw.subjects)
    ? raw.subjects
    : Array.isArray(rawInput?.subjects)
    ? rawInput.subjects
    : [];

  const subjects: SubjectData[] =
    rawSubjects.length > 0
      ? rawSubjects.map((s: any, idx: number) => ({
          id: typeof s?.id === 'string' && s.id.trim() ? s.id.trim() : String.fromCharCode(65 + idx),
          label:
            typeof s?.label === 'string' && s.label.trim()
              ? s.label.trim()
              : `Subject ${String.fromCharCode(65 + idx)}`,
          prominence: s?.prominence === 'secondary' ? 'secondary' : 'primary',
        }))
      : [{ id: 'A', label: 'Primary subject', prominence: 'primary' }];

  // Also check if personComponents / subjectComponents has additional subject keys (e.g. A, B)
  const rawPersonMap =
    raw.personComponents && typeof raw.personComponents === 'object'
      ? raw.personComponents
      : raw.subjectComponents && typeof raw.subjectComponents === 'object'
      ? raw.subjectComponents
      : rawInput?.personComponents && typeof rawInput.personComponents === 'object'
      ? rawInput.personComponents
      : rawInput?.subjectComponents && typeof rawInput.subjectComponents === 'object'
      ? rawInput.subjectComponents
      : null;

  if (rawPersonMap) {
    for (const subjKey of Object.keys(rawPersonMap)) {
      if (!subjects.some((s) => s.id === subjKey)) {
        subjects.push({
          id: subjKey,
          label: `Subject ${subjKey}`,
          prominence: subjects.length === 0 ? 'primary' : 'secondary',
        });
      }
    }
  }

  const keepIds =
    options.keepIds && options.keepIds.length > 0
      ? options.keepIds
      : subjects.map((s) => s.id);
  const primaryKeepId = keepIds[0] || subjects[0]?.id || 'A';

  // Track which keys were found in which bucket for debug visibility
  const bucketKeysFound: {
    shared: ComponentKey[];
    perSubject: Record<string, ComponentKey[]>;
    flatComponents: ComponentKey[];
  } = {
    shared: [],
    perSubject: {},
    flatComponents: [],
  };

  const rawSharedBucket =
    raw.sharedComponents && typeof raw.sharedComponents === 'object'
      ? raw.sharedComponents
      : raw.sceneComponents && typeof raw.sceneComponents === 'object'
      ? raw.sceneComponents
      : null;

  const rawFlatComponents =
    raw.components && typeof raw.components === 'object' ? raw.components : null;

  if (rawSharedBucket) {
    for (const k of ALL_COMPONENT_KEYS) {
      if (rawSharedBucket[k] !== undefined) {
        bucketKeysFound.shared.push(k);
      }
    }
  }

  if (rawFlatComponents) {
    for (const k of ALL_COMPONENT_KEYS) {
      if (rawFlatComponents[k] !== undefined) {
        bucketKeysFound.flatComponents.push(k);
      }
    }
  }

  // 2. Build sharedComponents for scene keys
  const sharedComponents: Record<ComponentKey, DetectedComponent> = {} as any;
  const sharedExtracts: Record<ComponentKey, RawFieldExtract> = {} as any;

  for (const key of SHARED_SCENE_COMPONENT_KEYS) {
    const candidate =
      rawSharedBucket?.[key] !== undefined
        ? rawSharedBucket[key]
        : rawFlatComponents?.[key] !== undefined
        ? rawFlatComponents[key]
        : raw[key] !== undefined
        ? raw[key]
        : undefined;

    const ext = extractRawField(candidate);
    sharedExtracts[key] = ext;
    const { component } = evaluateDecision(key, ext);
    sharedComponents[key] = component;
  }

  // 3. Build personComponents[subjectId] for person keys
  const personComponents: Record<string, Record<ComponentKey, DetectedComponent>> = {};
  const personExtracts: Record<string, Record<ComponentKey, RawFieldExtract>> = {};

  for (const subj of subjects) {
    const sid = subj.id;
    personComponents[sid] = {} as any;
    personExtracts[sid] = {} as any;
    bucketKeysFound.perSubject[sid] = [];

    const rawSubjObj = rawSubjects.find((rs: any) => rs?.id === sid);
    const subjBucket =
      rawPersonMap?.[sid] && typeof rawPersonMap[sid] === 'object'
        ? rawPersonMap[sid]
        : rawSubjObj?.components && typeof rawSubjObj.components === 'object'
        ? rawSubjObj.components
        : rawSubjObj && typeof rawSubjObj === 'object'
        ? rawSubjObj
        : null;

    for (const key of PERSON_COMPONENT_KEYS) {
      let candidate: any = undefined;

      // Priority A: Explicit per-subject bucket (personComponents[sid][key] or subjectComponents[sid][key])
      if (subjBucket && subjBucket[key] !== undefined) {
        candidate = subjBucket[key];
        bucketKeysFound.perSubject[sid].push(key);
      }
      // Priority B: Key-nested subject map inside components (e.g. components.subject.A)
      else if (
        rawFlatComponents?.[key] &&
        typeof rawFlatComponents[key] === 'object' &&
        rawFlatComponents[key][sid] !== undefined
      ) {
        candidate = rawFlatComponents[key][sid];
        bucketKeysFound.perSubject[sid].push(key);
      }
      // Priority C: Flat component fallback (single-subject or merged string in components[key] or top-level raw[key])
      else {
        const flatCand =
          rawFlatComponents?.[key] !== undefined
            ? rawFlatComponents[key]
            : rawSharedBucket?.[key] !== undefined
            ? rawSharedBucket[key]
            : raw[key] !== undefined
            ? raw[key]
            : undefined;

        const flatExt = extractRawField(flatCand);
        if (flatExt.presentInResponse) {
          if (subjects.length >= 2 && flatExt.detectedText) {
            const splitText = trySplitMergedSubjectText(flatExt.detectedText, sid);
            if (splitText) {
              candidate = {
                detectedText: splitText,
                explanation: flatExt.explanation,
                visibility: flatExt.rawVisibility || 'visible',
                confidence: flatExt.confidence,
              };
            } else {
              candidate = flatCand;
            }
          } else {
            candidate = flatCand;
          }
        }
      }

      const ext = extractRawField(candidate);
      personExtracts[sid][key] = ext;
      const { component } = evaluateDecision(key, ext);
      component.subjectId = sid;
      personComponents[sid][key] = component;
    }
  }

  // 4. Construct the canonical 14-component `activeComponents`, `originalComponents`, and `decisions`
  const activeComponents: Record<ComponentKey, DetectedComponent> = {} as any;
  const originalComponents: Record<ComponentKey, DetectedComponent> = {} as any;
  const decisionsMap: Record<ComponentKey, ComponentDecisionInfo> = {} as any;

  for (const key of ALL_COMPONENT_KEYS) {
    if (SHARED_SCENE_COMPONENT_KEYS.includes(key)) {
      if (key === 'interaction' && (mode === 'solo' || subjects.length < 2)) {
        const ext = sharedExtracts[key];
        const comp: DetectedComponent = {
          key,
          label: COMPONENT_LABELS[key],
          detectedText: '',
          userText: '',
          state: 'unavailable',
          source: 'reference',
          explanation: ext?.explanation || 'Single subject mode',
          visibility: 'unavailable',
        };
        activeComponents[key] = comp;
        originalComponents[key] = { ...comp };
        decisionsMap[key] = {
          key,
          label: COMPONENT_LABELS[key],
          bucket: 'shared',
          visibility: 'unavailable',
          reason: 'model said unavailable',
          textLength: 0,
          detectedTextLength: 0,
        };
      } else {
        const ext = sharedExtracts[key];
        const { component, decision } = evaluateDecision(key, ext);
        activeComponents[key] = component;
        originalComponents[key] = { ...component };
        decisionsMap[key] = decision;
      }
    } else {
      // Person component key
      if (mode === 'solo' || subjects.length <= 1) {
        const targetSid = mode === 'solo' ? primaryKeepId : subjects[0].id;
        const ext =
          personExtracts[targetSid]?.[key] ||
          personExtracts[subjects[0].id]?.[key] || {
            presentInResponse: false,
            detectedText: '',
            explanation: '',
          };
        const { component, decision } = evaluateDecision(key, ext);
        component.subjectId = targetSid;
        if (component.detectedText) {
          component.detectedText = component.detectedText
            .replace(/^Subject\s+[A-Z0-9]+(?:\s*\([^)]*\))?:\s*/i, '')
            .trim();
        }
        decision.bucket = `person:${targetSid}`;
        decision.textLength = component.detectedText.length;
        decision.detectedTextLength = component.detectedText.length;
        activeComponents[key] = component;
        originalComponents[key] = { ...component };
        decisionsMap[key] = decision;
      } else {
        // Multi-subject 'all' mode
        const extractsForSubjects = subjects.map((s) => ({
          subj: s,
          ext: personExtracts[s.id]?.[key],
        }));

        const anyPresent = extractsForSubjects.some((item) => item.ext?.presentInResponse);
        const nonEmptyParts: string[] = [];
        const explanations: string[] = [];
        let anyPartial = false;
        let allExplicitUnavailable = anyPresent;

        for (const { subj, ext } of extractsForSubjects) {
          if (!ext || !ext.presentInResponse) continue;
          if (ext.rawVisibility !== 'unavailable') {
            allExplicitUnavailable = false;
          }
          if (ext.rawVisibility === 'partial') {
            anyPartial = true;
          }
          if (ext.detectedText.trim()) {
            const cleanPart = ext.detectedText
              .trim()
              .replace(new RegExp(`^Subject\\s+${subj.id}\\b[^:]*:\\s*`, 'i'), '');
            nonEmptyParts.push(`Subject ${subj.id} (${subj.label}): ${cleanPart}`);
          }
          if (ext.explanation && !explanations.includes(ext.explanation)) {
            explanations.push(ext.explanation);
          }
        }

        const uniqueTexts = Array.from(
          new Set(
            extractsForSubjects
              .map((item) => item.ext?.detectedText?.trim())
              .filter((t): t is string => Boolean(t))
          )
        );
        const mergedText =
          uniqueTexts.length === 1 && nonEmptyParts.length > 1
            ? uniqueTexts[0]
            : nonEmptyParts.join(' ');

        const syntheticExtract: RawFieldExtract = {
          presentInResponse: anyPresent,
          detectedText: mergedText,
          explanation: explanations.join(' | ').slice(0, 120),
          rawVisibility: allExplicitUnavailable
            ? 'unavailable'
            : anyPartial
            ? 'partial'
            : mergedText
            ? 'visible'
            : undefined,
          confidence: 'high',
        };

        const { component, decision } = evaluateDecision(key, syntheticExtract);
        decision.bucket = `person:${subjects.map((s) => s.id).join('+')}`;
        activeComponents[key] = component;
        originalComponents[key] = { ...component };
        decisionsMap[key] = decision;
      }
    }

    // Apply Subject Swapping profile override if activeTool === 'subject_swapping'
    if (
      options.activeTool === 'subject_swapping' &&
      options.activeProfile &&
      (key === 'subject' || key === 'body')
    ) {
      const base = activeComponents[key];
      activeComponents[key] = {
        ...base,
        userText:
          key === 'subject'
            ? options.activeProfile.masterSubject
            : options.activeProfile.masterBody,
        state: 'edited',
        source: 'saved_profile',
        selectedProfileId: options.activeProfile.id,
        selectedProfileName: options.activeProfile.name,
      };
    }
  }

  // Populate sharedComponents with active person components too so any legacy lookup on sharedComponents works
  for (const key of PERSON_COMPONENT_KEYS) {
    if (!sharedComponents[key]) {
      sharedComponents[key] = { ...activeComponents[key] };
    }
  }

  const decisions: ComponentDecisionInfo[] = ALL_COMPONENT_KEYS.map((k) => decisionsMap[k]);

  // 5. Evaluate truncation and missing-component repair triggers
  const expectedCoreKeys: ComponentKey[] =
    subjects.length >= 2 && mode === 'all'
      ? [...CORE_13_COMPONENT_KEYS, 'interaction']
      : [...CORE_13_COMPONENT_KEYS];

  const missingCoreKeys: ComponentKey[] = [];
  let presentCoreCount = 0;

  for (const k of expectedCoreKeys) {
    const dec = decisionsMap[k];
    if (
      dec.reason === 'visible' ||
      dec.reason === 'partial' ||
      dec.reason === 'model said unavailable'
    ) {
      presentCoreCount++;
    } else {
      missingCoreKeys.push(k);
    }
  }

  // Count visible among the 13 standard components so single, solo, and multi all report out of 13
  const visibleCount = CORE_13_COMPONENT_KEYS.filter(
    (k) => decisionsMap[k]?.visibility === 'visible' || decisionsMap[k]?.visibility === 'partial'
  ).length;

  const repairReasons: string[] = [];
  if (options.finishReason === 'MAX_TOKENS' || options.finishReason === 'LENGTH') {
    repairReasons.push(`finishReason=${options.finishReason}`);
  }
  if (options.jsonRepaired) {
    repairReasons.push('JSON parsing required syntax repair');
  }
  const coverageRatio = expectedCoreKeys.length > 0 ? presentCoreCount / expectedCoreKeys.length : 1;
  if (coverageRatio < 0.6) {
    repairReasons.push(
      `Only ${presentCoreCount}/${expectedCoreKeys.length} (${Math.round(
        coverageRatio * 100
      )}%) expected components present (< 60% threshold)`
    );
  }

  const needsRepair = repairReasons.length > 0 && missingCoreKeys.length > 0;

  const outputRatio =
    (typeof raw.outputRatio === 'string' && raw.outputRatio.trim()) ||
    (typeof rawInput?.outputRatio === 'string' && rawInput.outputRatio.trim()) ||
    options.fallbackRatio ||
    '3:4';

  const leadSentence =
    (typeof raw.leadSentence === 'string' && raw.leadSentence.trim()) ||
    (typeof rawInput?.leadSentence === 'string' && rawInput.leadSentence.trim()) ||
    '';

  const styleCategory =
    raw.styleCategory === 'illustration' ||
    raw.styleCategory === '3D' ||
    raw.styleCategory === 'painting'
      ? raw.styleCategory
      : 'photorealistic';

  const summary =
    (typeof raw.summary === 'string' && raw.summary.trim()) ||
    `Reference analyzed (${visibleCount}/13 visible components).`;

  const ratioExplanation =
    (typeof raw.ratioExplanation === 'string' && raw.ratioExplanation.trim()) || '';

  const cameraEstimates =
    raw.cameraEstimates && typeof raw.cameraEstimates === 'object' ? raw.cameraEstimates : {};

  return {
    leadSentence,
    styleCategory,
    summary,
    outputRatio,
    ratioExplanation,
    cameraEstimates,
    subjects,
    topLevelKeys,
    sharedComponents,
    personComponents,
    activeComponents,
    originalComponents,
    decisions,
    bucketKeysFound,
    presentCoreCount,
    expectedCoreCount: expectedCoreKeys.length,
    missingCoreKeys,
    visibleCount,
    needsRepair,
    repairReasons,
  };
}

/**
 * Merges a targeted repair response into an existing raw scan object and re-normalizes.
 */
export function mergeRepairedScanResult(
  baseCanonical: CanonicalScanStructure,
  repairPayload: any,
  options: NormalizeScanOptions = {}
): CanonicalScanStructure {
  const repairRaw =
    repairPayload?.repairedComponents ||
    repairPayload?.analysis ||
    repairPayload?.components ||
    repairPayload ||
    {};

  // Clone base structure into a synthetic canonical raw payload
  const mergedRaw: any = {
    leadSentence: baseCanonical.leadSentence || repairRaw.leadSentence || '',
    styleCategory: baseCanonical.styleCategory,
    summary: baseCanonical.summary,
    outputRatio: baseCanonical.outputRatio,
    ratioExplanation: baseCanonical.ratioExplanation,
    subjects: baseCanonical.subjects,
    cameraEstimates: baseCanonical.cameraEstimates,
    sharedComponents: {} as Record<string, any>,
    personComponents: {} as Record<string, Record<string, any>>,
  };

  for (const k of SHARED_SCENE_COMPONENT_KEYS) {
    const existing = baseCanonical.sharedComponents[k];
    if (existing && existing.detectedText.trim()) {
      mergedRaw.sharedComponents[k] = {
        detectedText: existing.detectedText,
        explanation: existing.explanation,
        visibility: existing.visibility,
        confidence: existing.confidence,
      };
    }
  }

  for (const subj of baseCanonical.subjects) {
    mergedRaw.personComponents[subj.id] = {};
    for (const k of PERSON_COMPONENT_KEYS) {
      const existing = baseCanonical.personComponents[subj.id]?.[k];
      if (existing && existing.detectedText.trim()) {
        mergedRaw.personComponents[subj.id][k] = {
          detectedText: existing.detectedText,
          explanation: existing.explanation,
          visibility: existing.visibility,
          confidence: existing.confidence,
        };
      }
    }
  }

  // Merge repaired fields from repairRaw (supports flat, sharedComponents, or personComponents)
  const repairShared =
    repairRaw.sharedComponents || repairRaw.sceneComponents || repairRaw.components || repairRaw;
  const repairPerson =
    repairRaw.personComponents || repairRaw.subjectComponents || null;

  for (const k of SHARED_SCENE_COMPONENT_KEYS) {
    const cand = repairShared?.[k] ?? repairRaw?.[k];
    const ext = extractRawField(cand);
    if (ext.presentInResponse && (ext.detectedText || ext.rawVisibility === 'unavailable')) {
      mergedRaw.sharedComponents[k] = {
        detectedText: ext.detectedText,
        explanation: ext.explanation,
        visibility: ext.rawVisibility || 'visible',
        confidence: ext.confidence || 'high',
      };
    }
  }

  for (const subj of baseCanonical.subjects) {
    const sid = subj.id;
    for (const k of PERSON_COMPONENT_KEYS) {
      const cand =
        repairPerson?.[sid]?.[k] ??
        repairShared?.[k]?.[sid] ??
        repairShared?.[k] ??
        repairRaw?.[k];
      const ext = extractRawField(cand);
      if (ext.presentInResponse && (ext.detectedText || ext.rawVisibility === 'unavailable')) {
        mergedRaw.personComponents[sid][k] = {
          detectedText: ext.detectedText,
          explanation: ext.explanation,
          visibility: ext.rawVisibility || 'visible',
          confidence: ext.confidence || 'high',
        };
      }
    }
  }

  return normalizeScanResult(mergedRaw, {
    ...options,
    finishReason: 'STOP',
    jsonRepaired: false,
  });
}

/**
 * Fallback builder for Solo Mode when `/api/reanalyze-solo` fails or returns < 3 visible components.
 * Builds the solo view directly from the stored multi-subject canonical structure
 * (kept subject's personComponents + sharedComponents), flags plural/ignored-subject wording
 * with `needsSoloRewrite: true`, and never drops components.
 */
export function buildSoloFromMultiSnapshot(
  multiCanonical: CanonicalScanStructure,
  keepId: string
): {
  canonical: CanonicalScanStructure;
  flaggedKeys: ComponentKey[];
  leakedFieldKeys: ComponentKey[];
} {
  const keptSubject =
    multiCanonical.subjects.find((s) => s.id === keepId) ||
    multiCanonical.subjects[0] || {
      id: keepId,
      label: `Subject ${keepId}`,
      prominence: 'primary',
    };
  const ignoredSubjects = multiCanonical.subjects.filter((s) => s.id !== keptSubject.id);
  const ignoredLabels = ignoredSubjects.map((s) => s.label);

  const syntheticSoloRaw: any = {
    leadSentence: `${keptSubject.label}${
      multiCanonical.sharedComponents.environment?.detectedText
        ? ` in ${multiCanonical.sharedComponents.environment.detectedText}`
        : ''
    }`,
    styleCategory: multiCanonical.styleCategory,
    summary: `Solo view constructed for ${keptSubject.label} from multi-subject scan.`,
    outputRatio: multiCanonical.outputRatio,
    ratioExplanation: multiCanonical.ratioExplanation,
    cameraEstimates: multiCanonical.cameraEstimates,
    subjects: [keptSubject],
    sharedComponents: {},
    personComponents: {
      [keptSubject.id]: {},
    },
  };

  for (const k of SHARED_SCENE_COMPONENT_KEYS) {
    if (k === 'interaction') {
      syntheticSoloRaw.sharedComponents[k] = {
        detectedText: '',
        explanation: 'Excluded in solo mode',
        visibility: 'unavailable',
      };
    } else {
      const comp = multiCanonical.sharedComponents[k] || multiCanonical.activeComponents[k];
      if (comp) {
        syntheticSoloRaw.sharedComponents[k] = {
          detectedText: comp.detectedText,
          explanation: comp.explanation,
          visibility: comp.visibility,
          confidence: comp.confidence,
        };
      }
    }
  }

  const keptPersonMap =
    multiCanonical.personComponents[keptSubject.id] ||
    multiCanonical.personComponents[multiCanonical.subjects[0]?.id || 'A'] ||
    {};

  for (const k of PERSON_COMPONENT_KEYS) {
    const comp = keptPersonMap[k] || multiCanonical.activeComponents[k];
    if (comp) {
      const cleanedText = (comp.detectedText || '')
        .replace(/^Subject\s+[A-Z0-9]+(?:\s*\([^)]*\))?:\s*/i, '')
        .trim();
      syntheticSoloRaw.personComponents[keptSubject.id][k] = {
        detectedText: cleanedText,
        explanation: comp.explanation,
        visibility: comp.visibility,
        confidence: comp.confidence,
      };
    }
  }

  const soloCanonical = normalizeScanResult(syntheticSoloRaw, {
    mode: 'solo',
    keepIds: [keptSubject.id],
    fallbackRatio: multiCanonical.outputRatio,
  });

  // Check for plural or ignored-subject leaks in the shared scene fields and flag them
  const leakCheck = findIgnoredSubjectLeaks(
    soloCanonical.activeComponents,
    ignoredLabels,
    keptSubject.label
  );
  const flaggedKeys: ComponentKey[] = [];

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
      flaggedKeys.push(leak.key);
    }
  }

  return {
    canonical: soloCanonical,
    flaggedKeys,
    leakedFieldKeys: flaggedKeys,
  };
}

/**
 * Formats the complete plain-text debug report for copying on mobile or desktop.
 * Never includes API keys.
 */
export function formatPlainTextDebugReport(report: ScanDebugReportData): string {
  const lines: string[] = [
    '=== MY WHISK AI - SCAN DEBUG REPORT ===',
    `Timestamp: ${report.timestamp}`,
    `HTTP Status: ${report.httpStatus}`,
    `Model Used: ${report.modelUsed || 'unknown'}`,
    `Quota Fallback: ${report.quotaFallback}`,
    `Response Length: ${report.responseLength} chars`,
    `Finish Reason: ${report.finishReason || 'STOP'}`,
    `JSON Parse Succeeded: ${report.jsonParseSucceeded}`,
    `JSON Repaired: ${report.jsonRepaired}${report.repairNote ? ` (${report.repairNote})` : ''}`,
    `Truncation/Missing Repair Triggered: ${report.truncationRepairTriggered}`,
    `Repaired Keys: ${report.repairedKeys.length > 0 ? report.repairedKeys.join(', ') : 'none'}`,
    `Top-Level Keys: ${report.topLevelKeys.join(', ')}`,
    '',
    '--- SUBJECTS ARRAY ---',
    ...report.subjects.map((s) => `- [${s.id}] ${s.label} (${s.prominence})`),
    '',
    '--- BUCKET KEYS FOUND ---',
    `Shared Bucket (${report.bucketKeysFound.shared.length}): ${report.bucketKeysFound.shared.join(', ') || 'none'}`,
    `Flat Components Bucket (${report.bucketKeysFound.flatComponents.length}): ${report.bucketKeysFound.flatComponents.join(', ') || 'none'}`,
    ...Object.entries(report.bucketKeysFound.perSubject).map(
      ([sid, keys]) => `Per-Subject [${sid}] (${keys.length}): ${keys.join(', ') || 'none'}`
    ),
    '',
    '--- 14 COMPONENT VISIBILITY DECISIONS ---',
    ...report.decisions.map(
      (d) =>
        `- ${d.key} (${d.label}) [${d.bucket}]: visibility=${d.visibility} | reason="${d.reason}" | len=${d.textLength}`
    ),
    '',
    '--- RAW MODEL TEXT (FIRST 1500 CHARS) ---',
    (report.rawModelTextPreview || '(empty)').slice(0, 1500),
  ];

  if (report.soloDebug) {
    lines.push(
      '',
      '=== SOLO RE-ANALYSIS (/api/reanalyze-solo) ===',
      `HTTP Status: ${report.soloDebug.httpStatus}`,
      `Model Used: ${report.soloDebug.modelUsed || 'unknown'}`,
      `Finish Reason: ${report.soloDebug.finishReason || 'STOP'}`,
      `Response Length: ${report.soloDebug.responseLength} chars`,
      `JSON Parse Succeeded: ${report.soloDebug.jsonParseSucceeded}`,
      `JSON Repaired: ${report.soloDebug.jsonRepaired}`,
      `Visible Count: ${report.soloDebug.visibleCount}/13`,
      `Fallback to Multi-Subject Snapshot Used: ${report.soloDebug.fallbackToStoredMultiUsed}`,
      '',
      '--- SOLO RAW MODEL TEXT (FIRST 1500 CHARS) ---',
      (report.soloDebug.rawModelTextPreview || '(empty)').slice(0, 1500)
    );
  }

  return lines.join('\n');
}
