import {
  CATS,
  ADDS,
  LOCK_CATALOG,
  type LockCatalog,
} from './lockCatalog';

export type LockStatus = 'locked' | 'partial' | 'released';
export type LockMediaType = 'image' | 'video';

export interface LockChangeItem {
  what: string;
  category_ids: number[];
}

export interface LockCategoryDecision {
  id: number;
  status: LockStatus;
  keep_item_indexes?: number[];
  note?: string;
  reason: string;
}

export interface ConflictFixAction {
  type: 'release' | 'lock' | 'partial' | 'set_media' | 'edit_task';
  category_id?: number;
  keep_item_indexes?: number[];
  value?: string;
}

export interface ConflictFix {
  label: string;
  action: ConflictFixAction;
}

export interface Conflict {
  id: string;
  severity: 'blocking' | 'warning';
  category_ids: number[];
  message: string;
  fix: ConflictFix;
  secondary_fix?: ConflictFix;
}

export interface LockDecision {
  media: LockMediaType;
  understood_task: string;
  changes: LockChangeItem[];
  categories: LockCategoryDecision[]; // ids 1-13, each exactly once
  addon_ids: ('A' | 'B')[];
  change_block: string;
  uses_body_rules: boolean;
  uses_image_roles: boolean;
  conflicts: Conflict[];
  clarifying_question: string | null;
}

export const LOCK_ADVISOR_SYSTEM_INSTRUCTION =
  "You are a prompt-safety planner for image-to-image and video edits. You receive (a) the user's edit task, (b) a lock catalog of 13 categories with numbered items, (c) optional images. Decide what stays locked.\n" +
  '1. Default is everything locked. Release only what the task truly requires changing. If the user says keep the rest untouched, all other categories are locked.\n' +
  "2. Prefer 'partial' over 'released'. Example: outfit change to full sleeves and trousers means Clothing is partial: keep Footwear, and write a note that color, fabric and pattern carry over from the original while only sleeve length and lower garment type change.\n" +
  '3. Color lock [1] stays locked unless the task asks for a new color. Never release it silently.\n' +
  '4. When a garment or visible area changes, set uses_body_rules=true and consider add-on A (newly exposed or covered areas) and add-on B (blending, shadows).\n' +
  '5. Identity [2], Skin [3] and Body and pose [5] stay locked for outfit-only tasks. Sleeves or trousers must not reshape the body or hide hands, neck or ears.\n' +
  '6. Video only [13] is locked only when media is video; otherwise released.\n' +
  '7. If the task contradicts a lock the user pinned, do not override the pin. Report a conflict with a one-tap fix. A locked element wins over the task.\n' +
  '8. If the task is ambiguous, return your best decision plus ONE clarifying_question.\n' +
  '9. Use only ids and item indexes from the catalog. Never rewrite catalog wording. Keep each reason under 12 words. Output JSON only.';

interface LocalKeywordRule {
  id: string;
  pattern: RegExp;
  categoryIds: number[];
  specialWarning?: {
    conflictId: string;
    categoryId: number;
    message: string;
  };
}

export const LOCAL_KEYWORD_RULES: readonly LocalKeywordRule[] = [
  {
    id: 'clothing',
    pattern: /\b(sleeves?|shirts?|trousers?|pants|dress(?:es)?|jackets?|skirts?|outfits?|wear(?:ing)?|garments?|blouse|jeans|coat|sweater|shorts)\b/i,
    categoryIds: [6],
  },
  {
    id: 'hair',
    pattern: /\b(hair|hairstyles?|buns?|ponytails?|bangs|braids?|curls?|fringes?)\b/i,
    categoryIds: [4],
  },
  {
    id: 'scene',
    pattern: /\b(background|backgrounds|scenes?|props?|locations?|backdrop|setting)\b/i,
    categoryIds: [8],
  },
  {
    id: 'lighting',
    pattern: /\b(lighting|sunset|brighter|darker|night|shadows?|sunlight|backlit|spotlight)\b/i,
    categoryIds: [9, 1],
  },
  {
    id: 'color',
    pattern: /\b(red|blue|black|white|green|yellow|purple|pink|orange|brown|gr[ae]y|beige|navy|gold|silver|maroon|teal|turquoise|burgundy|ivory|cream|pastel|neon|monochrome|sepia|recolor|colou?r(?:ed|s)?|tint|hue|saturation)\b/i,
    categoryIds: [1],
  },
  {
    id: 'camera',
    pattern: /\b(crop|cropped|zoom|zoomed|angle|aspect|closer|wider|framing|reframe|lens)\b/i,
    categoryIds: [10],
  },
  {
    id: 'accessories',
    pattern: /\b(earrings?|necklaces?|glasses|sunglasses|watch(?:es)?|rings?|bracelets?|jewel(?:ry|lery))\b/i,
    categoryIds: [7],
  },
  {
    id: 'identity_expression',
    pattern: /\b(smile|smiling|smiled|expression|look at camera|eyes|gaze|frown|laugh(?:ing)?)\b/i,
    categoryIds: [2],
  },
  {
    id: 'body_pose',
    pattern: /\b(pose|posed|hands?|sit|sitting|seated|stand|standing|arms?|posture|legs?)\b/i,
    categoryIds: [5],
  },
  {
    id: 'skin_beauty',
    pattern: /\b(skin|smooth(?:ing)?|blemish(?:es)?|younger|older|airbrush(?:ed)?|wrinkles?|acne)\b/i,
    categoryIds: [3],
    specialWarning: {
      conflictId: 'local_warn_skin_beauty',
      categoryId: 3,
      message: 'Beauty/skin edit detected: conflicts with natural [3] Skin lock (no smoothing, airbrushing, or beautification).',
    },
  },
  {
    id: 'body_proportions',
    pattern: /\b(slim(?:mer)?|curvy|taller|thinner|skinnier|muscular|broader|narrower)\b/i,
    categoryIds: [5],
    specialWarning: {
      conflictId: 'local_warn_body_proportions',
      categoryId: 5,
      message: 'Body edit detected: conflicts with fixed body proportions in [5] Body and pose.',
    },
  },
  {
    id: 'video',
    pattern: /\b(lip-?sync|lip sync|motion|audio|camera movement)\b/i,
    categoryIds: [13],
  },
];

export interface LocalDetectionResult {
  categoryIds: number[];
  matchedRuleIds: string[];
  specialWarnings: Array<{
    conflictId: string;
    categoryId: number;
    message: string;
  }>;
}

export function detectTouchedCategories(task: string): LocalDetectionResult {
  const clean = (task || '').trim();
  if (!clean) {
    return { categoryIds: [], matchedRuleIds: [], specialWarnings: [] };
  }

  const catSet = new Set<number>();
  const matchedRuleIds: string[] = [];
  const specialWarnings: LocalDetectionResult['specialWarnings'] = [];
  const seenWarnings = new Set<string>();

  for (const rule of LOCAL_KEYWORD_RULES) {
    if (rule.pattern.test(clean)) {
      matchedRuleIds.push(rule.id);
      for (const cid of rule.categoryIds) {
        catSet.add(cid);
      }
      if (rule.specialWarning && !seenWarnings.has(rule.specialWarning.conflictId)) {
        seenWarnings.add(rule.specialWarning.conflictId);
        specialWarnings.push(rule.specialWarning);
      }
    }
  }

  return {
    categoryIds: Array.from(catSet).sort((a, b) => a - b),
    matchedRuleIds,
    specialWarnings,
  };
}

function getCategoryById(id: number, catalog: LockCatalog = LOCK_CATALOG) {
  return catalog.cats.find((c) => c.id === id);
}

export function defaultPartialKeepIndexes(catId: number): number[] {
  switch (catId) {
    case 2:
      return [0, 1, 2, 5]; // keep facial identity, release expression/gaze
    case 4:
      return [2, 3]; // keep hair color & hairline
    case 5:
      return [0, 1, 2]; // keep body proportions & neck/ears, release pose
    case 6:
      return [3]; // keep Footwear (if visible)
    case 8:
      return [2]; // keep depth & atmosphere
    case 9:
      return [2]; // keep exposure balance
    case 10:
      return [3]; // keep sharpness & grain
    default:
      return [0];
  }
}

export function evaluateLocalConflicts(params: {
  task: string;
  media: LockMediaType;
  categories: LockCategoryDecision[];
  pinnedLocks?: number[];
  catalog?: LockCatalog;
}): Conflict[] {
  const { task, media, categories, pinnedLocks = [], catalog = LOCK_CATALOG } = params;
  const detection = detectTouchedCategories(task);
  const pinnedSet = new Set(pinnedLocks);
  const byId = new Map<number, LockCategoryDecision>();
  for (const c of categories) {
    byId.set(c.id, c);
  }

  const conflicts: Conflict[] = [];

  // Check [13] Video only locked/partial while media is image
  const cat13 = byId.get(13);
  if (media === 'image' && cat13 && cat13.status !== 'released') {
    conflicts.push({
      id: 'local_video_locked_in_image',
      severity: 'warning',
      category_ids: [13],
      message: '[13] Video only is active while media mode is Image.',
      fix: {
        label: 'Release [13]',
        action: { type: 'release', category_id: 13 },
      },
      secondary_fix: {
        label: 'Switch to Video',
        action: { type: 'set_media', value: 'video' },
      },
    });
  }

  // Check video keywords in image mode
  if (media === 'image' && detection.categoryIds.includes(13)) {
    conflicts.push({
      id: 'local_video_keywords_in_image',
      severity: 'warning',
      category_ids: [13],
      message: 'Task mentions video motion/audio terms while media mode is Image.',
      fix: {
        label: 'Switch to Video',
        action: { type: 'set_media', value: 'video' },
      },
    });
  }

  // Check each touched category against locked state
  for (const catId of detection.categoryIds) {
    if (catId === 13 && media === 'image') continue;
    const state = byId.get(catId);
    const catDef = getCategoryById(catId, catalog);
    if (!state || !catDef) continue;

    if (state.status === 'locked') {
      const isPinned = pinnedSet.has(catId);
      conflicts.push({
        id: `local_locked_${catId}`,
        severity: 'warning',
        category_ids: [catId],
        message: isPinned
          ? `Task changes [${catId}] ${catDef.name}, which you pinned as locked. Locked element wins until released.`
          : `Task changes [${catId}] ${catDef.name}, but [${catId}] ${catDef.name} is locked.`,
        fix: {
          label: 'Release',
          action: { type: 'release', category_id: catId },
        },
        secondary_fix: isPinned
          ? {
              label: 'Keep locked',
              action: { type: 'lock', category_id: catId },
            }
          : {
              label: 'Make partial',
              action: {
                type: 'partial',
                category_id: catId,
                keep_item_indexes: defaultPartialKeepIndexes(catId),
              },
            },
      });
    }
  }

  // Add special warnings (beauty edit, fixed body proportions)
  for (const warn of detection.specialWarnings) {
    const state = byId.get(warn.categoryId);
    conflicts.push({
      id: warn.conflictId,
      severity: 'warning',
      category_ids: [warn.categoryId],
      message: warn.message,
      fix:
        state && state.status === 'locked'
          ? {
              label: 'Release',
              action: { type: 'release', category_id: warn.categoryId },
            }
          : {
              label: 'Keep locked',
              action: { type: 'lock', category_id: warn.categoryId },
            },
      secondary_fix:
        state && state.status === 'locked'
          ? {
              label: 'Keep locked',
              action: { type: 'lock', category_id: warn.categoryId },
            }
          : undefined,
    });
  }

  return conflicts;
}

export function mergeAndDedupeConflicts(
  localConflicts: Conflict[],
  aiConflicts: Conflict[]
): Conflict[] {
  const seen = new Set<string>();
  const merged: Conflict[] = [];

  for (const item of [...aiConflicts, ...localConflicts]) {
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export interface SanitizeDecisionOptions {
  media?: LockMediaType;
  task?: string;
  pinnedLocks?: number[];
  hasImage2?: boolean;
  overrides?: Partial<Record<number, LockCategoryDecision>>;
  catalog?: LockCatalog;
}

export function sanitizeDecision(
  raw: unknown,
  options: SanitizeDecisionOptions = {}
): LockDecision {
  const catalog = options.catalog ?? LOCK_CATALOG;
  const validCatIds = new Set(catalog.cats.map((c) => c.id));
  const catItemCounts = new Map(catalog.cats.map((c) => [c.id, c.items.length]));
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const media: LockMediaType =
    options.media === 'video' || options.media === 'image'
      ? options.media
      : obj.media === 'video'
      ? 'video'
      : 'image';

  const fallbackTask = (options.task || '').trim();
  const understoodTask =
    typeof obj.understood_task === 'string' && obj.understood_task.trim()
      ? obj.understood_task.trim()
      : fallbackTask || 'Apply the requested edit while preserving locked elements.';

  // Sanitize changes
  const rawChanges = Array.isArray(obj.changes) ? obj.changes : [];
  const changes: LockChangeItem[] = [];
  for (const ch of rawChanges) {
    if (!ch || typeof ch !== 'object') continue;
    const chObj = ch as Record<string, unknown>;
    const what = typeof chObj.what === 'string' ? chObj.what.trim() : '';
    if (!what) continue;
    const rawIds = Array.isArray(chObj.category_ids) ? chObj.category_ids : [];
    const cleanedIds = Array.from(
      new Set(
        rawIds
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && validCatIds.has(n))
      )
    ).sort((a, b) => a - b);
    changes.push({ what, category_ids: cleanedIds });
  }

  // Map incoming categories, dropping unknown ids and duplicates
  const rawCats = Array.isArray(obj.categories) ? obj.categories : [];
  const incomingById = new Map<number, Record<string, unknown>>();
  for (const item of rawCats) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = Number(rec.id);
    if (!Number.isInteger(id) || !validCatIds.has(id) || incomingById.has(id)) continue;
    incomingById.set(id, rec);
  }

  const pinnedSet = new Set(
    (options.pinnedLocks || []).filter((id) => Number.isInteger(id) && validCatIds.has(id))
  );
  const overrides = options.overrides || {};

  const categories: LockCategoryDecision[] = catalog.cats.map((catDef) => {
    const id = catDef.id;
    const maxItems = catItemCounts.get(id) ?? catDef.items.length;

    // Rule: [13] is forced to 'released' when media is 'image'
    if (id === 13 && media === 'image') {
      return {
        id: 13,
        status: 'released',
        reason: 'Not applicable in image mode.',
      };
    }

    const override = overrides[id];
    const src = override ?? incomingById.get(id);

    if (!src) {
      return {
        id,
        status: 'locked',
        reason: 'Locked by default.',
      };
    }

    const rawStatus = src.status;
    let status: LockStatus =
      rawStatus === 'locked' || rawStatus === 'partial' || rawStatus === 'released'
        ? rawStatus
        : 'locked';

    // Never override a user-pinned lock unless the user explicitly provided an override for that id
    if (pinnedSet.has(id) && !override) {
      status = 'locked';
    }

    const reasonRaw = typeof src.reason === 'string' ? src.reason.trim() : '';
    const reason =
      reasonRaw ||
      (status === 'locked'
        ? 'Locked by default.'
        : status === 'partial'
        ? 'Partially locked for targeted edit.'
        : 'Released for requested edit.');

    if (status === 'partial') {
      const rawIndexes = Array.isArray(src.keep_item_indexes) ? src.keep_item_indexes : [];
      const keepIndexes = Array.from(
        new Set(
          rawIndexes
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n >= 0 && n < maxItems)
        )
      ).sort((a, b) => a - b);

      const note = typeof src.note === 'string' && src.note.trim() ? src.note.trim() : undefined;
      return {
        id,
        status: 'partial',
        keep_item_indexes: keepIndexes,
        ...(note ? { note } : {}),
        reason,
      };
    }

    return {
      id,
      status,
      reason,
    };
  });

  // Sanitize addon_ids ('A' | 'B' only)
  const validAddonIds = new Set(catalog.adds.map((a) => a.id));
  const rawAddons = Array.isArray(obj.addon_ids) ? obj.addon_ids : [];
  const addonSet = new Set<'A' | 'B'>();
  for (const a of rawAddons) {
    if ((a === 'A' || a === 'B') && validAddonIds.has(a)) {
      addonSet.add(a);
    }
  }
  const addon_ids: ('A' | 'B')[] = (['A', 'B'] as const).filter((id) => addonSet.has(id));

  const change_block =
    typeof obj.change_block === 'string' && obj.change_block.trim()
      ? obj.change_block.trim()
      : fallbackTask;

  const uses_body_rules = Boolean(obj.uses_body_rules);
  const uses_image_roles =
    typeof options.hasImage2 === 'boolean'
      ? options.hasImage2 && Boolean(obj.uses_image_roles)
      : Boolean(obj.uses_image_roles);

  // Sanitize conflicts
  const validActionTypes = new Set(['release', 'lock', 'partial', 'set_media', 'edit_task']);
  const rawConflicts = Array.isArray(obj.conflicts) ? obj.conflicts : [];
  const conflicts: Conflict[] = [];
  const seenConflictIds = new Set<string>();

  for (let i = 0; i < rawConflicts.length; i++) {
    const c = rawConflicts[i];
    if (!c || typeof c !== 'object') continue;
    const cObj = c as Record<string, unknown>;
    const message = typeof cObj.message === 'string' ? cObj.message.trim() : '';
    if (!message) continue;

    const id =
      typeof cObj.id === 'string' && cObj.id.trim()
        ? cObj.id.trim()
        : `ai_conflict_${i + 1}`;
    if (seenConflictIds.has(id)) continue;

    const category_ids = Array.from(
      new Set(
        (Array.isArray(cObj.category_ids) ? cObj.category_ids : [])
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && validCatIds.has(n))
      )
    ).sort((a, b) => a - b);

    const severity: 'blocking' | 'warning' =
      cObj.severity === 'blocking' ? 'blocking' : 'warning';

    const sanitizeFix = (rawFix: unknown): ConflictFix | null => {
      if (!rawFix || typeof rawFix !== 'object') return null;
      const fObj = rawFix as Record<string, unknown>;
      const label = typeof fObj.label === 'string' && fObj.label.trim() ? fObj.label.trim() : '';
      const actObj =
        fObj.action && typeof fObj.action === 'object'
          ? (fObj.action as Record<string, unknown>)
          : null;
      if (!label || !actObj || typeof actObj.type !== 'string' || !validActionTypes.has(actObj.type)) {
        return null;
      }
      const action: ConflictFixAction = {
        type: actObj.type as ConflictFixAction['type'],
      };
      if (actObj.category_id !== undefined) {
        const cid = Number(actObj.category_id);
        if (Number.isInteger(cid) && validCatIds.has(cid)) {
          action.category_id = cid;
        }
      }
      if (Array.isArray(actObj.keep_item_indexes) && action.category_id) {
        const maxLen = catItemCounts.get(action.category_id) ?? 0;
        action.keep_item_indexes = Array.from(
          new Set(
            actObj.keep_item_indexes
              .map((n) => Number(n))
              .filter((n) => Number.isInteger(n) && n >= 0 && n < maxLen)
          )
        ).sort((a, b) => a - b);
      }
      if (typeof actObj.value === 'string' && actObj.value.trim()) {
        action.value = actObj.value.trim();
      }
      return { label, action };
    };

    const primaryFix =
      sanitizeFix(cObj.fix) ??
      (category_ids[0]
        ? {
            label: 'Release',
            action: { type: 'release' as const, category_id: category_ids[0] },
          }
        : {
            label: 'Edit task',
            action: { type: 'edit_task' as const },
          });

    const secondaryFix = sanitizeFix(cObj.secondary_fix);

    seenConflictIds.add(id);
    conflicts.push({
      id,
      severity,
      category_ids,
      message,
      fix: primaryFix,
      ...(secondaryFix ? { secondary_fix: secondaryFix } : {}),
    });
  }

  const clarifying_question =
    typeof obj.clarifying_question === 'string' && obj.clarifying_question.trim()
      ? obj.clarifying_question.trim()
      : null;

  return {
    media,
    understood_task: understoodTask,
    changes,
    categories,
    addon_ids,
    change_block,
    uses_body_rules,
    uses_image_roles,
    conflicts,
    clarifying_question,
  };
}

/**
 * Instant, deterministic local draft decision before Gemini responds (or when offline).
 * Respects pinnedLocks (never releases a pinned category) and builds clean defaults.
 */
export function buildLocalDraftDecision(params: {
  task: string;
  media: LockMediaType;
  pinnedLocks?: number[];
  hasImage2?: boolean;
  catalog?: LockCatalog;
}): LockDecision {
  const { task, media, pinnedLocks = [], hasImage2 = false, catalog = LOCK_CATALOG } = params;
  const cleanTask = (task || '').trim();
  const detection = detectTouchedCategories(cleanTask);
  const touchedSet = new Set(detection.categoryIds);
  const pinnedSet = new Set(pinnedLocks);

  const isSleeveAndTrousersModify =
    touchedSet.has(6) &&
    /\b(full[- ]?sleeves?|long[- ]?sleeves?)\b/i.test(cleanTask) &&
    /\b(trousers?|pants)\b/i.test(cleanTask);

  const isGarmentModify =
    touchedSet.has(6) &&
    !hasImage2 &&
    /\b(modify|current outfit|sleeves?|trousers?|pants|hem|neckline|length|collar)\b/i.test(cleanTask);

  const categories: LockCategoryDecision[] = catalog.cats.map((cat) => {
    if (cat.id === 13) {
      if (media === 'image') {
        return { id: 13, status: 'released', reason: 'Not applicable in image mode.' };
      }
      if (touchedSet.has(13) && !pinnedSet.has(13)) {
        return { id: 13, status: 'partial', keep_item_indexes: [3, 4], reason: 'Video edit requested.' };
      }
      return { id: 13, status: 'locked', reason: 'Preserve video motion and audio.' };
    }

    if (pinnedSet.has(cat.id)) {
      return { id: cat.id, status: 'locked', reason: 'Pinned by you as always locked.' };
    }

    if (!touchedSet.has(cat.id)) {
      return { id: cat.id, status: 'locked', reason: 'Untouched by requested edit.' };
    }

    // Special handling for [6] Clothing
    if (cat.id === 6) {
      if (isSleeveAndTrousersModify) {
        return {
          id: 6,
          status: 'partial',
          keep_item_indexes: [3],
          note: 'Color, fabric, and pattern carry over from the original; only sleeve length and lower garment type change.',
          reason: 'Keep footwear and fabric; adjust sleeves and trousers.',
        };
      }
      if (isGarmentModify) {
        return {
          id: 6,
          status: 'partial',
          keep_item_indexes: [3],
          note: 'Original color, fabric, and pattern carry over except the requested garment modification.',
          reason: 'Partial garment modification requested.',
        };
      }
      return {
        id: 6,
        status: 'partial',
        keep_item_indexes: [3],
        note: 'Replace outfit per instruction while keeping footwear unless specified.',
        reason: 'Outfit edit requested.',
      };
    }

    // Prefer partial for identity (expression/gaze) and pose
    if (cat.id === 2) {
      return {
        id: 2,
        status: 'partial',
        keep_item_indexes: [0, 1, 2, 5],
        note: 'Only facial expression or gaze changes; face structure and identity stay locked.',
        reason: 'Keep identity; allow expression change.',
      };
    }

    if (cat.id === 5) {
      return {
        id: 5,
        status: 'partial',
        keep_item_indexes: [0, 1, 2],
        note: 'Body proportions, neck, and ears stay locked; only the requested pose adjusts.',
        reason: 'Keep body shape; adjust pose.',
      };
    }

    // Color lock [1] stays locked unless explicit color/lighting edit
    if (cat.id === 1 && !detection.matchedRuleIds.includes('color') && !detection.matchedRuleIds.includes('lighting')) {
      return { id: 1, status: 'locked', reason: 'Color lock stays active.' };
    }

    return {
      id: cat.id,
      status: 'released',
      reason: `Changed by task (${cat.name.toLowerCase()}).`,
    };
  });

  const usesBodyRules = touchedSet.has(6) && !hasImage2;
  const usesImageRoles = hasImage2;
  const addonIds: ('A' | 'B')[] = [];
  if (touchedSet.has(6) || touchedSet.has(4) || touchedSet.has(8) || touchedSet.has(5) || hasImage2) {
    addonIds.push('A', 'B');
  } else if (touchedSet.size > 0) {
    addonIds.push('B');
  }

  const changeBlock = isSleeveAndTrousersModify
    ? 'Modify the current outfit to full-length sleeves and full-length trousers, keeping the original color, fabric, and pattern.'
    : cleanTask;

  const changes: LockChangeItem[] =
    detection.categoryIds.length > 0
      ? [
          {
            what: cleanTask || 'Edit detected elements',
            category_ids: detection.categoryIds.filter((id) => !(id === 13 && media === 'image')),
          },
        ]
      : [];

  const localConflicts = evaluateLocalConflicts({
    task: cleanTask,
    media,
    categories,
    pinnedLocks,
    catalog,
  });

  return sanitizeDecision(
    {
      media,
      understood_task: cleanTask || 'Describe an edit to plan locks.',
      changes,
      categories,
      addon_ids: addonIds,
      change_block: changeBlock,
      uses_body_rules: usesBodyRules,
      uses_image_roles: usesImageRoles,
      conflicts: localConflicts,
      clarifying_question: null,
    },
    { media, task: cleanTask, pinnedLocks, hasImage2, catalog }
  );
}

export interface AssembleLockPromptOptions {
  short?: boolean;
}

/**
 * Pure deterministic prompt assembler from a LockDecision and the verbatim LockCatalog.
 * Lock wording is NEVER paraphrased by AI.
 */
export function assembleLockPrompt(
  decision: LockDecision,
  catalog: LockCatalog = LOCK_CATALOG,
  options: AssembleLockPromptOptions = {}
): string {
  const short = Boolean(options.short);
  const catById = new Map(catalog.cats.map((c) => [c.id, c]));

  const activeLocks = decision.categories.filter((c) => {
    if (c.id === 13 && decision.media === 'image') return false;
    return c.status === 'locked' || c.status === 'partial';
  });

  const chosenAdds = catalog.adds.filter((a) => decision.addon_ids.includes(a.id));
  const cleanChange = (decision.change_block || '').trim();

  if (short) {
    const lines: string[] = [];

    if (activeLocks.length > 0) {
      lines.push('STRICT LOCK INSTRUCTION (locked element wins on conflict):');
      const fullLocked = activeLocks
        .filter((c) => c.status === 'locked')
        .map((c) => {
          const def = catById.get(c.id);
          return def ? `[${def.id}] ${def.name}` : null;
        })
        .filter((v): v is string => Boolean(v));

      if (fullLocked.length > 0) {
        lines.push(`Locked: ${fullLocked.join(', ')}`);
      }

      const partials = activeLocks.filter((c) => c.status === 'partial');
      for (const p of partials) {
        const def = catById.get(p.id);
        if (!def) continue;
        const keptNames = (p.keep_item_indexes || [])
          .map((idx) => def.items[idx])
          .filter(Boolean);
        const keptPart = keptNames.length > 0 ? `keep ${keptNames.join(', ')}` : 'partial lock';
        const notePart = p.note && p.note.trim() ? ` — Exception: ${p.note.trim()}` : '';
        lines.push(`Partial [${def.id}] ${def.name}: ${keptPart}${notePart}`);
      }
    }

    if (decision.uses_image_roles) {
      lines.push(
        `CHANGE (the only permitted edit): Replace the outfit in Image 1 with Image 2 (outfit only; body fixed, re-light to Image 1).${cleanChange ? ` ${cleanChange}` : ''}`
      );
    } else if (cleanChange) {
      lines.push(`${catalog.changeHeader} ${cleanChange.replace(/\s+/g, ' ')}`);
      if (decision.uses_body_rules) {
        lines.push(
          'Body rules: Fit follows actual body contours; never reshape body; do not hide neck, ears, hands, or accessories; match pose/lighting and skin.'
        );
      }
    }

    if (chosenAdds.length > 0) {
      const addSummary = chosenAdds
        .map((a) => `${a.name} (${a.items.join('; ')})`)
        .join(' | ');
      lines.push(`${catalog.additionalHeader}: ${addSummary}`);
    }

    return lines.join('\n').trim();
  }

  // Full mode — exact layout & wording from lock-list.html
  const parts: string[] = [];

  if (activeLocks.length > 0) {
    let lockSection = `${catalog.strictHeader}\n\n`;

    for (const entry of activeLocks) {
      const def = catById.get(entry.id);
      if (!def) continue;

      if (entry.status === 'locked') {
        lockSection += `[${def.id}] ${def.name.toUpperCase()}\n- ${def.items.join('\n- ')}\n\n`;
      } else if (entry.status === 'partial') {
        const keptItems = (entry.keep_item_indexes || [])
          .map((idx) => def.items[idx])
          .filter((item): item is string => Boolean(item));
        const bodyLines: string[] = keptItems.map((item) => `- ${item}`);
        if (entry.note && entry.note.trim()) {
          bodyLines.push(`Exception: ${entry.note.trim()}`);
        }
        if (bodyLines.length > 0) {
          lockSection += `[${def.id}] ${def.name.toUpperCase()}\n${bodyLines.join('\n')}\n\n`;
        } else {
          lockSection += `[${def.id}] ${def.name.toUpperCase()}\n\n`;
        }
      }
    }

    lockSection += catalog.strictFooter;
    parts.push(lockSection);
  }

  if (decision.uses_image_roles) {
    const imgBlock =
      catalog.imageRules + (cleanChange ? `\n\nEXTRA NOTES:\n${cleanChange}` : '');
    parts.push(imgBlock);
  } else if (cleanChange) {
    let changeSection = `${catalog.changeHeader}\n${cleanChange}`;
    if (decision.uses_body_rules) {
      changeSection += `\n\n${catalog.bodyRules}`;
    }
    parts.push(changeSection);
  }

  if (chosenAdds.length > 0) {
    let addSection = `${catalog.additionalHeader}\n`;
    for (const add of chosenAdds) {
      addSection += `${add.name.toUpperCase()}\n- ${add.items.join('\n- ')}\n\n`;
    }
    parts.push(addSection.trimEnd());
  }

  return parts.join('\n\n');
}

export { CATS, ADDS, LOCK_CATALOG };
