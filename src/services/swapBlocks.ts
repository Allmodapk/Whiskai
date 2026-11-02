import {
  SwapPresetId,
  SWAP_V1_TEXT,
  SWAP_V2_TEXT,
  SWAP_V3_1_TEXT,
  SWAP_V1_SUB_2_TEXT,
} from './swapPresets';

export type BodySource = 'template' | 'mannequin';
export type OutfitSource = 'template' | 'face' | 'saved' | 'typed';
export type ExpressionSource = 'template' | 'face';
export type BackgroundSource = 'template' | 'face_style' | 'saved' | 'typed';
export type LightingSource = 'template' | 'face';
export type OrnamentsSource = 'face' | 'template' | 'none';

export interface SwapMatrixSwitches {
  body: BodySource;
  outfit: OutfitSource;
  expression: ExpressionSource;
  background: BackgroundSource;
  lighting: LightingSource;
  ornaments: OrnamentsSource;
}

export interface SwapTextAnchors {
  faceOutfitEnabled: boolean;
  faceOutfitText: string;
  faceLightingEnabled: boolean;
  faceLightingText: string;
  mannequinBuildEnabled: boolean;
  mannequinBuildText: string;
}

export interface SwapAssemblyOptions {
  /** If set to a locked preset ID and switches/anchors are unmodified, returns verbatim preset text */
  lockedPresetId?: SwapPresetId | null;
  savedOutfitText?: string;
  typedOutfitText?: string;
  typedBottomWearLine?: string;
  savedBackgroundText?: string;
  typedBackgroundText?: string;
  peopleCount?: 1 | 2;
  secondPersonSwapped?: boolean;
  anchors?: Partial<SwapTextAnchors>;
}

export const DEFAULT_SWAP_SWITCHES: SwapMatrixSwitches = {
  body: 'template',
  outfit: 'template',
  expression: 'template',
  background: 'template',
  lighting: 'template',
  ornaments: 'face',
};

export const PRESET_SWITCHES: Record<SwapPresetId, SwapMatrixSwitches> = {
  swap_v1: {
    body: 'mannequin',
    outfit: 'template',
    expression: 'template',
    background: 'template',
    lighting: 'template',
    ornaments: 'face',
  },
  swap_v2: {
    body: 'mannequin',
    outfit: 'face',
    expression: 'template',
    background: 'template',
    lighting: 'template',
    ornaments: 'face',
  },
  swap_v3_1: {
    body: 'mannequin',
    outfit: 'face',
    expression: 'template',
    background: 'face_style',
    lighting: 'face',
    ornaments: 'face',
  },
  swap_v1_sub_2: {
    body: 'template',
    outfit: 'template',
    expression: 'template',
    background: 'template',
    lighting: 'template',
    ornaments: 'face',
  },
};

export function areSwitchesEqual(a: SwapMatrixSwitches, b: SwapMatrixSwitches): boolean {
  return (
    a.body === b.body &&
    a.outfit === b.outfit &&
    a.expression === b.expression &&
    a.background === b.background &&
    a.lighting === b.lighting &&
    a.ornaments === b.ornaments
  );
}

export function matchPresetBySwitches(switches: SwapMatrixSwitches): SwapPresetId | null {
  const ids: SwapPresetId[] = ['swap_v1', 'swap_v2', 'swap_v3_1', 'swap_v1_sub_2'];
  for (const id of ids) {
    if (areSwitchesEqual(switches, PRESET_SWITCHES[id])) {
      return id;
    }
  }
  return null;
}

export type SwapImageSlot = 'Template' | 'Face' | 'Mannequin' | 'Man';

/**
 * Computes the ordered list of images needed based on current switches and people count.
 * Template and Face are always required.
 * Mannequin is needed only if Body = Mannequin.
 * Man is needed only when a second swapped person exists in the Template.
 */
export function getImagesNeeded(
  switches: SwapMatrixSwitches,
  peopleCount: 1 | 2 = 1,
  secondPersonSwapped = true
): SwapImageSlot[] {
  const slots: SwapImageSlot[] = ['Template', 'Face'];
  if (switches.body === 'mannequin') {
    slots.push('Mannequin');
  }
  if (peopleCount === 2 && secondPersonSwapped) {
    slots.push('Man');
  }
  return slots;
}

// ============================================================================
// CUT-OUT BLOCK VARIANTS FROM THE FOUR VERBATIM PRESET TEXTS
// ============================================================================

const BLOCK_TITLES = {
  v1: 'SWAP PROMPT MAIN v1: PURE SUBJECT SWAPPING',
  v2: 'SWAP PROMPT MAIN v2: PURE SUBJECT SWAPPING (OUTFIT FROM FACE)',
  v3_1: 'SWAP PROMPT MAIN v3.1: PURE SUBJECT SWAPPING (OUTFIT + BACKGROUND + LIGHTING FROM FACE)',
  v1_sub_2: 'SWAP PROMPT MAIN v1 SUB 2: PURE SUBJECT SWAPPING (BODY KEPT FROM TEMPLATE)',
  custom: 'SWAP PROMPT CUSTOM: MODULAR SUBJECT SWAPPING',
};

const KEEP_BULLETS = {
  body_template:
    '- Body shape, size, volume, build and proportions of the person (neck, shoulders, chest/bust, waist, abdomen, hips, arms, hands, thighs, knees, calves). Do not slim, enlarge, reshape or beautify the body in any way.',
  background_template: '- Background, environment, objects, surfaces and depth of field',
  lighting_template: '- Lighting (direction, softness, color temperature, shadows, highlights)',
  camera:
    '- Camera angle, camera height, distance, lens perspective, shot type, framing and crop',
  pose: '- Exact pose from toe to head (whatever is visible): joint angles, limb placement, hands, palms, fingers, legs, head tilt',
  gaze: '- Exact gaze direction',
  expression_template:
    '- Exact facial expression (smile shape, eye openness, mouth, cheek and brow movement), re-expressed on the new face',
  outfit_template_mannequin:
    '- Exact outfit design, color, fabric, pattern, trims and details, refitted to the new body',
  outfit_template_body_kept:
    '- Exact outfit design, color, fabric, pattern, trims and details, with its original fit, folds and fabric tension on the same body',
  position_standard:
    "- Subject's position in frame, sitting or standing point, eye-line height, and contact with furniture or objects",
  position_v3_1:
    "- Subject's position in frame, sitting or standing point, eye-line height, and the physical contact with furniture or objects",
  scene_type_layout:
    '- Scene TYPE and LAYOUT: the kind of place, the kinds of elements it contains, and where they sit relative to the subject and the camera',
  ratio: '- Image ratio: output must be exactly the same as TEMPLATE',
};

function hasActiveAnchors(options: SwapAssemblyOptions): boolean {
  const anchors = options.anchors;
  const hasAnchor = Boolean(
    anchors &&
      ((anchors.faceOutfitEnabled && anchors.faceOutfitText?.trim()) ||
        (anchors.faceLightingEnabled && anchors.faceLightingText?.trim()) ||
        (anchors.mannequinBuildEnabled && anchors.mannequinBuildText?.trim()))
  );
  const hasBottomWear = Boolean(options.typedBottomWearLine?.trim());
  return hasAnchor || hasBottomWear;
}

function buildTitleBlock(matchedPreset: SwapPresetId | null): string {
  if (matchedPreset === 'swap_v1') return BLOCK_TITLES.v1;
  if (matchedPreset === 'swap_v2') return BLOCK_TITLES.v2;
  if (matchedPreset === 'swap_v3_1') return BLOCK_TITLES.v3_1;
  if (matchedPreset === 'swap_v1_sub_2') return BLOCK_TITLES.v1_sub_2;
  return BLOCK_TITLES.custom;
}

function buildImageIdentificationBlock(
  switches: SwapMatrixSwitches,
  matchedPreset: SwapPresetId | null,
  options: SwapAssemblyOptions
): string {
  const heading =
    'IMAGE IDENTIFICATION (upload order does NOT matter. Identify each image by its content, never by its position):';

  if (matchedPreset === 'swap_v1') {
    return `${heading}
- TEMPLATE = the real scene with person(s) in a pose and outfit. It is the master image.
- FACE = the close-up, chest-level, front-facing portrait of a woman looking at the camera. It is the identity reference for subject 1.
- MANNEQUIN = the full-figure gray/plastic 3D mannequin. It is the body blueprint for subject 1.
- MAN = a portrait of a man, optional. Use it only if TEMPLATE contains a second person; otherwise ignore it completely.`;
  }

  if (matchedPreset === 'swap_v2') {
    return `${heading}
- TEMPLATE = the real scene with person(s) in a pose. It is the master image.
- FACE = the close-up, chest-level, front-facing portrait of a woman looking at the camera. It is the identity reference AND the outfit reference for subject 1.
- MANNEQUIN = the full-figure gray/plastic 3D mannequin. It is the body blueprint for subject 1.
- MAN = a portrait of a man, optional. Use it only if TEMPLATE contains a second person; otherwise ignore it completely.`;
  }

  if (matchedPreset === 'swap_v3_1') {
    return `${heading}
- TEMPLATE = the real scene with person(s) in a pose. It is the master image for pose, camera, framing and the TYPE and LAYOUT of the scene.
- FACE = the close-up or half-body, front-facing portrait of a woman looking at the camera. It is the identity reference, the outfit reference, the LIGHTING reference, and the style reference for the background and environment.
- MANNEQUIN = the full-figure gray/plastic 3D mannequin. It is the body blueprint for subject 1.
- MAN = a portrait of a man, optional. Use it only if TEMPLATE contains a second person; otherwise ignore it completely.`;
  }

  if (matchedPreset === 'swap_v1_sub_2') {
    return `${heading}
- TEMPLATE = the real scene with a person in a pose. It is the master image.
- FACE = the close-up or half-body, front-facing portrait of a woman looking at the camera. It is the identity reference for subject 1.
Only these two images are provided. There is no mannequin image and no second-person image.`;
  }

  // Dynamic modular assembly for custom user recipes: one line per slot in use
  const lines: string[] = [heading];

  const templateRoles: string[] = ['pose, camera, framing'];
  if (switches.outfit === 'template') templateRoles.push('outfit');
  if (switches.background === 'template') templateRoles.push('background');
  else if (switches.background === 'face_style') templateRoles.push('the TYPE and LAYOUT of the scene');
  if (switches.lighting === 'template') templateRoles.push('lighting');
  lines.push(
    `- TEMPLATE = the real scene with person(s) in a pose (${templateRoles.join(', ')}). It is the master image.`
  );

  const faceRoles: string[] = ['the identity reference'];
  if (switches.outfit === 'face') faceRoles.push('the outfit reference');
  if (switches.expression === 'face') faceRoles.push('the facial expression reference');
  if (switches.lighting === 'face') faceRoles.push('the LIGHTING reference');
  if (switches.background === 'face_style') {
    faceRoles.push('the style reference for the background and environment');
  }
  lines.push(
    `- FACE = the close-up or half-body, front-facing portrait of a woman looking at the camera. It is ${faceRoles.join(', ')} for subject 1.`
  );

  if (switches.body === 'mannequin') {
    lines.push(
      '- MANNEQUIN = the full-figure gray/plastic 3D mannequin. It is the body blueprint for subject 1.'
    );
  }

  const includeMan =
    options.peopleCount === 2 ? options.secondPersonSwapped !== false : switches.body === 'mannequin';
  if (includeMan) {
    lines.push(
      '- MAN = a portrait of a man, optional. Use it only if TEMPLATE contains a second person; otherwise ignore it completely.'
    );
  } else if (switches.body === 'template') {
    lines.push(
      'Only these two images are provided. There is no mannequin image and no second-person image.'
    );
  }

  return lines.join('\n');
}

function buildTaskBlock(
  switches: SwapMatrixSwitches,
  matchedPreset: SwapPresetId | null
): string {
  if (matchedPreset === 'swap_v1') {
    return `TASK:
Stay 100% true to TEMPLATE. Replace only the person(s) in it. Subject 1 becomes the woman from FACE, with the body of the MANNEQUIN, placed in the exact same spot, pose and outfit as the original person. Everything else in TEMPLATE stays untouched.`;
  }
  if (matchedPreset === 'swap_v2') {
    return `TASK:
Stay 100% true to TEMPLATE. Replace only the person(s) in it. Subject 1 becomes the woman from FACE, wearing the outfit from FACE, with the body of the MANNEQUIN, placed in the exact same spot and pose as the original person. Everything else in TEMPLATE stays untouched.`;
  }
  if (matchedPreset === 'swap_v3_1') {
    return `TASK:
Stay true to TEMPLATE's scene type, layout, pose, camera and framing. Replace the person(s) in it. Subject 1 becomes the woman from FACE, wearing the outfit from FACE, with the body of the MANNEQUIN, in the exact same spot and pose as the original person. Rebuild the background and environment as a NEW scene (see BACKGROUND RULES), and light the whole image with the lighting visible in FACE (see LIGHTING RULES).`;
  }
  if (matchedPreset === 'swap_v1_sub_2') {
    return `TASK:
Stay 100% true to TEMPLATE. Replace only the face, head, hair and skin identity of subject 1 with the woman from FACE. Everything else in TEMPLATE stays untouched: the body, pose, outfit, background and lighting. If TEMPLATE contains any other person, leave them completely unchanged.`;
  }

  const bodyPhrase =
    switches.body === 'mannequin'
      ? 'with the body of the MANNEQUIN'
      : 'keeping the original body from TEMPLATE';
  const outfitPhrase =
    switches.outfit === 'face'
      ? 'wearing the outfit from FACE'
      : switches.outfit === 'saved'
      ? 'wearing the specified saved outfit'
      : switches.outfit === 'typed'
      ? 'wearing the specified custom outfit'
      : 'wearing the outfit from TEMPLATE';
  const bgPhrase =
    switches.background === 'face_style'
      ? 'Rebuild the background and environment as a NEW scene in FACE style (see BACKGROUND RULES).'
      : switches.background === 'saved'
      ? 'Place the scene in the specified saved background (see BACKGROUND RULES).'
      : switches.background === 'typed'
      ? 'Place the scene in the specified custom background (see BACKGROUND RULES).'
      : 'Keep TEMPLATE background untouched.';
  const lightPhrase =
    switches.lighting === 'face'
      ? 'Light the whole image with the lighting visible in FACE (see LIGHTING RULES).'
      : 'Keep TEMPLATE lighting untouched.';

  return `TASK:
Stay true to TEMPLATE's pose, camera and framing. Replace the person(s) in it. Subject 1 becomes the woman from FACE, ${outfitPhrase}, ${bodyPhrase}, placed in the exact same spot and pose as the original person. ${bgPhrase} ${lightPhrase}`;
}

function buildKeepFromTemplateBlock(
  switches: SwapMatrixSwitches,
  matchedPreset: SwapPresetId | null
): string {
  const bullets: string[] = [];

  if (switches.body === 'template') {
    // Notice in Swap v1 Sub 2, body is first, then pose, gaze, expression, outfit, background, lighting, camera, position, ratio
    bullets.push(KEEP_BULLETS.body_template);
    bullets.push(KEEP_BULLETS.pose);
    bullets.push(KEEP_BULLETS.gaze);
    if (switches.expression === 'template') {
      bullets.push(KEEP_BULLETS.expression_template);
    }
    if (switches.outfit === 'template') {
      bullets.push(KEEP_BULLETS.outfit_template_body_kept);
    }
    if (switches.background === 'template') {
      bullets.push(KEEP_BULLETS.background_template);
    }
    if (switches.lighting === 'template') {
      bullets.push(KEEP_BULLETS.lighting_template);
    }
    bullets.push(KEEP_BULLETS.camera);
    bullets.push(KEEP_BULLETS.position_standard);
    if (switches.background === 'face_style') {
      bullets.push(KEEP_BULLETS.scene_type_layout);
    }
    bullets.push(KEEP_BULLETS.ratio);
  } else {
    // Body = mannequin (v1, v2, v3.1 order)
    if (switches.background === 'template') {
      bullets.push(KEEP_BULLETS.background_template);
    }
    if (switches.lighting === 'template') {
      bullets.push(KEEP_BULLETS.lighting_template);
    }
    bullets.push(KEEP_BULLETS.camera);
    bullets.push(KEEP_BULLETS.pose);
    bullets.push(KEEP_BULLETS.gaze);
    if (switches.expression === 'template') {
      bullets.push(KEEP_BULLETS.expression_template);
    }
    if (switches.outfit === 'template') {
      bullets.push(KEEP_BULLETS.outfit_template_mannequin);
    }
    if (
      matchedPreset === 'swap_v3_1' ||
      (switches.background === 'face_style' && switches.lighting === 'face')
    ) {
      bullets.push(KEEP_BULLETS.position_v3_1);
    } else {
      bullets.push(KEEP_BULLETS.position_standard);
    }
    if (switches.background === 'face_style') {
      bullets.push(KEEP_BULLETS.scene_type_layout);
    }
    bullets.push(KEEP_BULLETS.ratio);
  }

  return ['KEEP EXACTLY FROM TEMPLATE (do not change):', ...bullets].join('\n');
}

function buildBackgroundRulesBlock(
  switches: SwapMatrixSwitches,
  options: SwapAssemblyOptions
): string | null {
  if (switches.background === 'template') return null;

  if (switches.background === 'face_style') {
    return `BACKGROUND RULES:
- Step 1: Identify what TEMPLATE's environment is (location type, key elements, layout, depth, where objects sit around the subject).
- Step 2: Study what is visible in FACE's background (materials, surfaces, colors, textures, decor style, object style, depth of field).
- Step 3: Build a NEW background that is the same TYPE of place with the same layout as TEMPLATE, but made entirely from FACE's visual language: FACE's materials, color palette, textures, decor style and atmosphere.
- Do not paste FACE's actual background as it is, and do not keep TEMPLATE's original background, colors or objects. The result is a third scene: TEMPLATE's type and layout in FACE's style.
- Furniture or objects the subject touches in TEMPLATE stay the same kind of object in the same position, restyled to FACE's materials and colors, so the pose still makes physical sense.
- Do not copy FACE's framing or camera angle. Camera and framing come from TEMPLATE only.`;
  }

  const customBgText =
    switches.background === 'saved'
      ? (options.savedBackgroundText || '').trim()
      : (options.typedBackgroundText || '').trim();

  return `BACKGROUND RULES:
- Replace TEMPLATE's original background with the following specified background while preserving TEMPLATE's camera angle, perspective, and the physical support surfaces the subject touches:
- ${customBgText || 'Use clean, realistic environmental surfaces matching the scene geometry.'}
- Do not copy FACE's framing or camera angle. Camera and framing come from TEMPLATE only.`;
}

function buildLightingRulesBlock(
  switches: SwapMatrixSwitches,
  options: SwapAssemblyOptions
): string | null {
  const anchorActive =
    options.anchors?.faceLightingEnabled && options.anchors?.faceLightingText?.trim();

  if (switches.lighting === 'template') {
    if (!anchorActive) return null;
    return `LIGHTING RULES:
- Keep TEMPLATE's lighting direction, softness, color temperature, shadows and highlights.
- TEXT ANCHOR: ${options.anchors!.faceLightingText!.trim()}`;
  }

  const lines = [
    'LIGHTING RULES (lighting comes from FACE only, same authority as the background):',
    "- Step 1: Read FACE's lighting before generating. Identify: main light direction relative to the subject (for example from the front-left), light softness (soft or hard), color temperature (warm, neutral or cool), brightness and contrast level, shadow direction and softness (under the nose, chin, hair, neck, arms), highlight position on skin and hair, catchlights in the eyes, and the ambient or bounce light on the skin and clothes. Use the skin, hair, clothing and any visible background in FACE as evidence.",
    '- Step 2: Apply exactly this lighting to the entire new image: subject 1, subject 2 if present, outfits, the new background and every object in it.',
    "- Do NOT use TEMPLATE's original lighting. Do NOT invent new lighting, add dramatic, studio, cinematic or rim lighting, or add extra light sources that FACE does not show.",
    "- Keep FACE's light direction relative to the subject. Adapt only the shadows on the background and objects so they make physical sense for TEMPLATE's layout.",
    "- Any window, lamp or light source visible in the new background must be consistent with FACE's light direction, color and softness.",
    "- Lighting on subject 1's face must stay identical in character to FACE (same softness, direction and color), so the identity stays intact.",
    '- Add natural contact shadows and ambient occlusion where the subject touches furniture or surfaces, using this same lighting.',
  ];

  if (anchorActive) {
    lines.push(`- TEXT ANCHOR: ${options.anchors!.faceLightingText!.trim()}`);
  }

  return lines.join('\n');
}

function buildSubject1OutfitBlock(
  switches: SwapMatrixSwitches,
  matchedPreset: SwapPresetId | null,
  options: SwapAssemblyOptions
): string | null {
  const anchorActive =
    options.anchors?.faceOutfitEnabled && options.anchors?.faceOutfitText?.trim();

  if (switches.outfit === 'template') {
    if (!anchorActive) return null;
    return `SUBJECT 1 OUTFIT:
- Keep TEMPLATE's original outfit design, color, fabric, pattern, trims and details.
- TEXT ANCHOR: ${options.anchors!.faceOutfitText!.trim()}`;
  }

  if (switches.outfit === 'face') {
    const isV31Style =
      matchedPreset === 'swap_v3_1' ||
      (switches.background === 'face_style' && switches.lighting === 'face');

    const lines = isV31Style
      ? [
          "SUBJECT 1 OUTFIT (from FACE, replaces TEMPLATE's outfit completely):",
          '- Take the exact outfit design, color, fabric, pattern, neckline, collar, sleeves, trims and details visible in FACE.',
          "- Discard TEMPLATE's original outfit completely.",
          "- FACE shows the outfit only partly. Extend it logically and consistently wherever TEMPLATE's crop shows more of the body, keeping the same fabric, color, pattern and design language.",
          `- Fit the outfit onto ${switches.body === 'mannequin' ? "the mannequin's body" : "TEMPLATE's body"} and TEMPLATE's pose, with natural stretch, tension, folds and creases, lit by ${switches.lighting === 'face' ? "FACE's" : "TEMPLATE's"} lighting.`,
          "- Do not copy FACE's pose.",
        ]
      : [
          "SUBJECT 1 OUTFIT (from FACE, replaces TEMPLATE's outfit completely):",
          '- Take the exact outfit design, color, fabric, pattern, neckline, collar, sleeves, trims and details visible in FACE.',
          "- Discard TEMPLATE's original outfit completely, including its color, trims and style.",
          "- FACE shows the outfit only down to chest level. Extend it logically and consistently below the chest wherever TEMPLATE's crop shows more of the body (torso, sleeves, hem, lower garments), keeping the same fabric, color, pattern and design language as the visible part of FACE.",
          `- Fit the outfit onto ${switches.body === 'mannequin' ? "the mannequin's body" : "TEMPLATE's body"} and TEMPLATE's pose, with natural stretch, tension, folds and creases, lit by ${switches.lighting === 'face' ? "FACE's" : "TEMPLATE's"} lighting.`,
          "- Do not copy FACE's pose, background or lighting.",
        ];

    if (options.typedBottomWearLine?.trim()) {
      lines.push(`- Lower garments / bottom wear: ${options.typedBottomWearLine.trim()}`);
    }
    if (anchorActive) {
      lines.push(`- TEXT ANCHOR: ${options.anchors!.faceOutfitText!.trim()}`);
    }
    return lines.join('\n');
  }

  const customOutfitText =
    switches.outfit === 'saved'
      ? (options.savedOutfitText || '').trim()
      : (options.typedOutfitText || '').trim();

  const lines = [
    `SUBJECT 1 OUTFIT (from ${switches.outfit === 'saved' ? 'SAVED OUTFIT' : 'TYPED OUTFIT'}, replaces TEMPLATE's outfit completely):`,
    `- Dress subject 1 in the following outfit: ${customOutfitText || 'Clean tailored garment fitted naturally to the pose.'}`,
    "- Discard TEMPLATE's original outfit completely, including its color, trims and style.",
    `- Fit the outfit onto ${switches.body === 'mannequin' ? "the mannequin's body" : "TEMPLATE's body"} and TEMPLATE's pose, with natural stretch, tension, folds and creases, lit by ${switches.lighting === 'face' ? "FACE's" : "TEMPLATE's"} lighting.`,
  ];

  if (anchorActive) {
    lines.push(`- TEXT ANCHOR: ${options.anchors!.faceOutfitText!.trim()}`);
  }
  return lines.join('\n');
}

function buildSubject1FaceBlock(
  switches: SwapMatrixSwitches,
  matchedPreset: SwapPresetId | null
): string {
  const skinLine =
    switches.body === 'template'
      ? "- Exact skin tone, skin color, skin texture and skin detailing (pores, marks, natural tone variation), applied uniformly across all visible skin: face, neck, chest, arms, hands, legs. The body skin must match FACE's skin exactly, with no leftover skin tone from TEMPLATE."
      : '- Exact skin tone, skin color, skin texture and skin detailing (pores, marks, natural tone variation), applied uniformly across all visible skin: face, neck, chest, arms, hands, legs';

  let ornamentLine: string;
  if (switches.ornaments === 'face') {
    if (
      matchedPreset === 'swap_v3_1' ||
      (switches.background === 'face_style' && switches.lighting === 'face')
    ) {
      ornamentLine =
        "- Ornaments: take only the ornaments visible in FACE. Remove all of TEMPLATE's original ornaments and jewelry.";
    } else {
      ornamentLine =
        "- Ornaments: take only the ornaments visible in FACE (earrings, chain, etc.). Remove all of TEMPLATE's original ornaments and jewelry.";
    }
  } else if (switches.ornaments === 'template') {
    ornamentLine =
      "- Ornaments: keep only the ornaments and jewelry visible in TEMPLATE. Ignore any ornaments visible in FACE.";
  } else {
    ornamentLine =
      '- Ornaments: include NO ornaments or jewelry on subject 1. Remove all ornaments from both TEMPLATE and FACE.';
  }

  const doNotTakeLine =
    switches.outfit === 'template'
      ? '- Do NOT take body, body shape, size, outfit, pose or background from FACE.'
      : '- Do NOT take body, body shape, size or pose from FACE.';

  const lines = [
    'SUBJECT 1 FACE AND IDENTITY (from FACE only):',
    '- Exact facial identity and geometry: face shape, eyes, nose, lips, jawline, cheeks, brows, ears',
    "- Exact hairstyle and hair color (replaces TEMPLATE's hair)",
    skinLine,
  ];

  if (switches.expression === 'face') {
    lines.push(
      "- Exact facial expression from FACE (smile shape, eye openness, mouth, cheek and brow movement), replacing TEMPLATE's original expression."
    );
  }

  lines.push(
    ornamentLine,
    doNotTakeLine,
    '- No beautification, no polishing, no smoothing, no brightening, no reshaping.'
  );

  return lines.join('\n');
}

function buildSubject1BodyOrHeadMatchBlock(
  switches: SwapMatrixSwitches,
  options: SwapAssemblyOptions
): string {
  if (switches.body === 'template') {
    return `HEAD AND BODY MATCH:
- The body stays exactly as in TEMPLATE. Only the head, hair and skin identity change.
- Scale the new head and neck to fit TEMPLATE's body naturally, keeping TEMPLATE's head size relative to the body, neck length, neck width and shoulder line.
- Keep TEMPLATE's head position, head tilt and hairline-to-shoulder relationship, with the new hair falling naturally over the shoulders and outfit.
- Do not change the body to look like FACE's person. FACE gives identity only.`;
  }

  const lines = [
    'SUBJECT 1 BODY (from MANNEQUIN only, HIGHEST PRIORITY):',
    "- Subject 1's entire visible body (neck, shoulders, chest/bust, waist, abdomen, hips, arms, hands, thighs, knees, calves) must be an exact copy of the MANNEQUIN's shape, size, volume, build and proportions. Treat the mannequin as the real body. TEMPLATE only tells you how that body is posed.",
    '- Discard the body of the original person in TEMPLATE completely. Discard the body of the person in FACE completely.',
    '- If the mannequin is fuller, slimmer, taller, shorter or curvier than the original person, the new body must visibly be so.',
    '- Study all mannequin views and match: head-to-body ratio, neck length, shoulder width, bust size and shape, waist width, waist-to-hip ratio, hip width, torso length, arm thickness, thigh and calf thickness, overall silhouette.',
    "- Scale the head and neck to the mannequin's head-to-body ratio.",
    "- Copy only shape and proportions. Do not copy the mannequin's gray material, seams, joints, face or pose.",
    "- Show only the body parts visible in TEMPLATE's crop. Do not widen the frame to show the full figure.",
  ];

  if (switches.outfit === 'template') {
    lines.push(
      `- The outfit must stretch, tighten, loosen and fold according to the mannequin's body, not the original body, with natural fabric tension and shadows under ${switches.lighting === 'face' ? "FACE's" : "TEMPLATE's"} lighting.`
    );
  }

  if (options.anchors?.mannequinBuildEnabled && options.anchors?.mannequinBuildText?.trim()) {
    lines.push(`- TEXT ANCHOR: ${options.anchors.mannequinBuildText.trim()}`);
  }

  return lines.join('\n');
}

function buildSubject2Block(
  switches: SwapMatrixSwitches,
  matchedPreset: SwapPresetId | null,
  options: SwapAssemblyOptions
): string | null {
  if (matchedPreset === 'swap_v1_sub_2') {
    return null;
  }
  if (options.peopleCount === 1 && matchedPreset === null && switches.body === 'template') {
    return null;
  }
  if (options.secondPersonSwapped === false && matchedPreset === null) {
    return null;
  }

  if (
    matchedPreset === 'swap_v3_1' ||
    (switches.background === 'face_style' && switches.lighting === 'face')
  ) {
    return `SUBJECT 2 (only if TEMPLATE has a second person):
- Replace him with the man from MAN: exact face, expression from TEMPLATE, hairstyle, hair color, facial hair, skin tone and texture.
- Keep his body build, pose, outfit and position from TEMPLATE. No mannequin applies to him, and FACE's outfit does not apply to him.
- He is lit by FACE's lighting and sits inside the same new background.
- Keep the relationship between both subjects exactly as in TEMPLATE: distance, overlap, who is in front, contact points, height difference.
- Each person keeps their own identity. Do not mix features, skin tone or hair between subjects.`;
  }

  if (switches.outfit !== 'template') {
    return `SUBJECT 2 (only if TEMPLATE has a second person):
- Replace him with the man from MAN: exact face, expression from TEMPLATE, hairstyle, hair color, facial hair, skin tone and texture.
- Keep his body build, pose, outfit and position from TEMPLATE. No mannequin applies to him, and FACE's outfit does not apply to him.
- Keep the relationship between both subjects exactly as in TEMPLATE: distance, overlap, who is in front, contact points, height difference.
- Each person keeps their own identity. Do not mix features, skin tone or hair between subjects or with the original people.`;
  }

  return `SUBJECT 2 (only if TEMPLATE has a second person):
- Replace him with the man from MAN: exact face, expression from TEMPLATE, hairstyle, hair color, facial hair, skin tone and texture.
- Keep his body build, pose, outfit and position from TEMPLATE. No mannequin applies to him.
- Keep the relationship between both subjects exactly as in TEMPLATE: distance, overlap, who is in front, contact points, height difference.
- Each person keeps their own identity. Do not mix features, skin tone or hair between subjects or with the original people.`;
}

function buildIntegrationBlock(
  switches: SwapMatrixSwitches,
  matchedPreset: SwapPresetId | null
): string {
  if (
    matchedPreset === 'swap_v3_1' ||
    (switches.background === 'face_style' && switches.lighting === 'face')
  ) {
    return `INTEGRATION:
- Subject(s), outfit and new background must share one lighting setup, the one read from FACE, with matching shadows, highlights, color temperature and contact shadows.
- Seamless head-to-neck-to-body transition. The result must not look like a head swap or a cut-out pasted into the scene.`;
  }

  if (switches.body === 'template' && switches.lighting === 'template') {
    return `INTEGRATION:
- The new subject must be lit by TEMPLATE's lighting, with matching shadows, highlights, color temperature and contact shadows with the surfaces and furniture.
- Seamless head-to-neck-to-body transition, with no visible seam, mismatch in skin tone or mismatch in sharpness between face, neck and body. The result must not look like a head swap or a cut-out pasted into the scene.`;
  }

  if (switches.lighting === 'face') {
    return `INTEGRATION:
- The new subject must be lit by FACE's lighting, with matching shadows, highlights, color temperature and contact shadows with the sofa or surfaces.
- Seamless head-to-neck-to-body transition. The result must not look like a head swap or a cut-out pasted into the scene.`;
  }

  return `INTEGRATION:
- The new subject must be lit by TEMPLATE's lighting, with matching shadows, highlights, color temperature and contact shadows with the sofa or surfaces.
- Seamless head-to-neck-to-body transition. The result must not look like a head swap or a cut-out pasted into the scene.`;
}

function buildFinalCheckBlock(
  switches: SwapMatrixSwitches,
  matchedPreset: SwapPresetId | null
): string {
  if (matchedPreset === 'swap_v1') {
    return `FINAL CHECK BEFORE OUTPUT:
1. Does subject 1's body silhouette match the MANNEQUIN rather than TEMPLATE's original person? If not, rebuild the body.
2. Are pose, gaze, expression, outfit, background, lighting, camera and framing identical to TEMPLATE?
3. Do face, hair, skin and ornaments come from FACE only?
4. Is the output ratio identical to TEMPLATE?`;
  }

  if (matchedPreset === 'swap_v2') {
    return `FINAL CHECK BEFORE OUTPUT:
1. Does subject 1's body silhouette match the MANNEQUIN rather than TEMPLATE's original person? If not, rebuild the body.
2. Does subject 1's outfit come from FACE, with no trace of TEMPLATE's original outfit?
3. Are pose, gaze, expression, background, lighting, camera and framing identical to TEMPLATE?
4. Do face, hair, skin and ornaments come from FACE only?
5. Is the output ratio identical to TEMPLATE?`;
  }

  if (matchedPreset === 'swap_v3_1') {
    return `FINAL CHECK BEFORE OUTPUT:
1. Does subject 1's body silhouette match the MANNEQUIN rather than TEMPLATE's original person? If not, rebuild the body.
2. Does the outfit come from FACE, with no trace of TEMPLATE's original outfit?
3. Is the new background the same type and layout as TEMPLATE, but made in FACE's materials, colors and style? It must not be a copy of FACE's background or of TEMPLATE's.
4. Does the lighting direction, softness and color temperature on the whole image match FACE, with no trace of TEMPLATE's lighting and no invented lighting? If not, relight everything.
5. Are pose, gaze, expression, camera, framing and crop identical to TEMPLATE?
6. Do face, hair, skin and ornaments come from FACE only?
7. Is the output ratio identical to TEMPLATE?`;
  }

  if (matchedPreset === 'swap_v1_sub_2') {
    return `FINAL CHECK BEFORE OUTPUT:
1. Is the body shape, size and proportions identical to TEMPLATE's original person, with no reshaping?
2. Are pose, gaze, expression, outfit, background, lighting, camera and framing identical to TEMPLATE?
3. Do face, hair, skin and ornaments come from FACE only, with the same skin tone on the face, neck and all body skin?
4. Is the head-to-body and neck transition seamless?
5. Is the output ratio identical to TEMPLATE?`;
  }

  // Dynamic Final Check items generated from active switches
  const checks: string[] = [];

  if (switches.body === 'mannequin') {
    checks.push(
      "Does subject 1's body silhouette match the MANNEQUIN rather than TEMPLATE's original person? If not, rebuild the body."
    );
  } else {
    checks.push(
      "Is the body shape, size and proportions identical to TEMPLATE's original person, with no reshaping?"
    );
  }

  if (switches.outfit === 'face') {
    checks.push(
      "Does subject 1's outfit come from FACE, with no trace of TEMPLATE's original outfit?"
    );
  } else if (switches.outfit === 'saved' || switches.outfit === 'typed') {
    checks.push(
      `Does subject 1's outfit match the ${switches.outfit} specification, with no trace of TEMPLATE's original outfit?`
    );
  }

  if (switches.background === 'face_style') {
    checks.push(
      "Is the new background the same type and layout as TEMPLATE, but made in FACE's materials, colors and style? It must not be a copy of FACE's background or of TEMPLATE's."
    );
  } else if (switches.background === 'saved' || switches.background === 'typed') {
    checks.push(
      `Does the background match the ${switches.background} background specification while preserving TEMPLATE's layout and perspective?`
    );
  }

  if (switches.lighting === 'face') {
    checks.push(
      "Does the lighting direction, softness and color temperature on the whole image match FACE, with no trace of TEMPLATE's lighting and no invented lighting? If not, relight everything."
    );
  }

  const keptList: string[] = ['pose', 'gaze'];
  if (switches.expression === 'template') keptList.push('expression');
  if (switches.outfit === 'template') keptList.push('outfit');
  if (switches.background === 'template') keptList.push('background');
  if (switches.lighting === 'template') keptList.push('lighting');
  keptList.push('camera and framing');
  checks.push(`Are ${keptList.join(', ')} identical to TEMPLATE?`);

  if (switches.ornaments === 'face') {
    checks.push('Do face, hair, skin and ornaments come from FACE only?');
  } else if (switches.ornaments === 'template') {
    checks.push('Do face, hair and skin come from FACE only, with ornaments kept from TEMPLATE?');
  } else {
    checks.push('Do face, hair and skin come from FACE only, with all ornaments removed?');
  }

  if (switches.body === 'template') {
    checks.push('Is the head-to-body and neck transition seamless?');
  }

  checks.push('Is the output ratio identical to TEMPLATE?');

  return [
    'FINAL CHECK BEFORE OUTPUT:',
    ...checks.map((c, idx) => `${idx + 1}. ${c}`),
  ].join('\n');
}

/**
 * Deterministic prompt builder for Swap Studio.
 * - Never makes an AI call.
 * - Same switches + options always produce byte-identical text.
 * - When switches match one of the four presets and no custom anchors/overrides are active,
 *   the assembled blocks match that preset's verbatim text.
 */
export function assembleSwapPrompt(
  switches: SwapMatrixSwitches,
  options: SwapAssemblyOptions = {}
): string {
  const anchorsActive = hasActiveAnchors(options);

  // If lockedPresetId is explicitly requested and no anchors are active, return verbatim constant directly
  if (options.lockedPresetId && !anchorsActive) {
    if (options.lockedPresetId === 'swap_v1') return SWAP_V1_TEXT;
    if (options.lockedPresetId === 'swap_v2') return SWAP_V2_TEXT;
    if (options.lockedPresetId === 'swap_v3_1') return SWAP_V3_1_TEXT;
    if (options.lockedPresetId === 'swap_v1_sub_2') return SWAP_V1_SUB_2_TEXT;
  }

  const matchedPreset = matchPresetBySwitches(switches);

  const blocks: string[] = [
    buildTitleBlock(matchedPreset),
    buildImageIdentificationBlock(switches, matchedPreset, options),
    buildTaskBlock(switches, matchedPreset),
    buildKeepFromTemplateBlock(switches, matchedPreset),
  ];

  const bgBlock = buildBackgroundRulesBlock(switches, options);
  if (bgBlock) blocks.push(bgBlock);

  const lightBlock = buildLightingRulesBlock(switches, options);
  if (lightBlock) blocks.push(lightBlock);

  const outfitBlock = buildSubject1OutfitBlock(switches, matchedPreset, options);
  if (outfitBlock) blocks.push(outfitBlock);

  blocks.push(buildSubject1FaceBlock(switches, matchedPreset));
  blocks.push(buildSubject1BodyOrHeadMatchBlock(switches, options));

  const subj2Block = buildSubject2Block(switches, matchedPreset, options);
  if (subj2Block) blocks.push(subj2Block);

  blocks.push(buildIntegrationBlock(switches, matchedPreset));
  blocks.push(buildFinalCheckBlock(switches, matchedPreset));

  return blocks.join('\n\n');
}
