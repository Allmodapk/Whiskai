import {
  ComponentKey,
  DetectedComponent,
  TargetModelType,
  PromptSafetyCheck,
  PromptMode,
  AuthoritySource,
  ComponentAuthorityMap,
  MasterOutfit,
  CameraControlSettings,
  ALL_COMPONENT_KEYS,
  CameraComponentKey,
  ALL_CAMERA_COMPONENT_KEYS,
  CAMERA_COMPONENT_LABELS,
  CameraExtractedComponent,
  CameraReferenceAnalysisState,
  GazeBehaviorType,
} from '../types';

export const FIXED_REFERENCE_TAIL = 'inspired from input reference image';
export const FIXED_TAIL_COMPONENTS: ComponentKey[] = ['environment', 'lighting', 'background'];

/**
 * Appends the fixed phrase "inspired from input reference image" to the description
 * of Environment, Lighting, and Background if not already present and when sourced from reference.
 */
export function appendReferenceTail(key: ComponentKey, text: string): string {
  if (!text || !text.trim()) return text;
  if (!FIXED_TAIL_COMPONENTS.includes(key)) return text;

  const trimmed = text.trim();
  const regex = /inspired\s+from\s+input\s+reference\s+image\.?$/i;
  if (regex.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.toLowerCase().includes('inspired from input reference image')) {
    return trimmed;
  }

  const cleanBase = trimmed.replace(/[.,;]+$/, '').trim();
  return `${cleanBase} ${FIXED_REFERENCE_TAIL}`;
}

export function sanitizeProductionPrompt(promptText: string): string {
  if (!promptText) return '';

  let sanitized = promptText;

  // 1. Target recurring explicit phrases and variations
  sanitized = sanitized.replace(
    /Natural\s+nipples\s+at\s+or\s+slightly\s+below\s+inframammary\s+fold[,\s]*dark\s+areolas\.?/gi,
    'Natural breast shape and realistic anatomical proportions.'
  );

  // 2. Target any clinical / medical anatomical classifications
  sanitized = sanitized.replace(/Grade\s+\d+[-–]\d+\s+ptosis/gi, 'gentle natural contour');
  sanitized = sanitized.replace(/\bptosis\s+grade[s]?\b/gi, 'natural contour');
  sanitized = sanitized.replace(/lower-pole\s+dominant\s+fullness\s*\(\d+:\d+\)/gi, 'natural gravity-settled contour');
  sanitized = sanitized.replace(/gynoid\s+(fat\s+distribution|proportions|morphology)?/gi, 'soft feminine hip proportions');
  sanitized = sanitized.replace(/hormonal\s+(lower-belly|fat\s+distribution)/gi, 'soft lower-belly');
  sanitized = sanitized.replace(/\binframammary\s+fold\b/gi, 'lower breast contour');

  // 3. Target any remaining explicit nipple/areola references
  sanitized = sanitized.replace(
    /\b(natural\s+)?nipples?\s+(at\s+or\s+slightly\s+below\s+inframammary\s+fold|pointing\s+forward|visible|prominent|defined|soft)?([,\s]*dark\s+areolas?)?\.?/gi,
    'natural torso silhouette'
  );

  sanitized = sanitized.replace(/\b(dark\s+)?areolas?([,\s]*natural\s+nipples?)?\.?/gi, '');
  sanitized = sanitized.replace(/\b(nipple|nipples|areola|areolas)\b/gi, '');

  // 4. Clean up awkward repetitions (e.g. "soft soft", "natural natural")
  sanitized = sanitized.replace(/\b(soft)\s+\1\b/gi, '$1');
  sanitized = sanitized.replace(/\b(natural)\s+\1\b/gi, '$1');
  sanitized = sanitized.replace(/\b(clean)\s+\1\b/gi, '$1');
  sanitized = sanitized.replace(/\b(realistic)\s+\1\b/gi, '$1');

  // 5. Clean up double periods, trailing commas, double spaces from replacements
  sanitized = sanitized
    .replace(/[,\s]+(?=\.)/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  return sanitized;
}

const COMPONENT_DISPLAY_ORDER: { key: ComponentKey; title: string }[] = [
  { key: 'subject', title: 'SUBJECT' },
  { key: 'body', title: 'BODY' },
  { key: 'pose', title: 'POSE' },
  { key: 'facial_expression', title: 'FACIAL EXPRESSION' },
  { key: 'hand_gestures', title: 'HAND GESTURES' },
  { key: 'leg_gestures', title: 'LEG GESTURES' },
  { key: 'camera', title: 'CAMERA' },
  { key: 'framing', title: 'FRAMING' },
  { key: 'clothing', title: 'CLOTHING' },
  { key: 'lighting', title: 'LIGHTING' },
  { key: 'environment', title: 'ENVIRONMENT' },
  { key: 'background', title: 'BACKGROUND' },
  { key: 'composition', title: 'COMPOSITION' },
];

/**
 * Resolves the active text of a single component strictly honoring:
 * 1. Excluded states ('ignored' or 'unavailable') -> null
 * 2. Current userText (manual edits or selected saved profile items) -> userText
 * 3. Original detectedText (only when state === 'locked' and not cleared) -> detectedText
 */
export function resolveActiveComponentContent(comp: DetectedComponent | undefined): string | null {
  if (!comp) return null;
  if (comp.state === 'ignored' || comp.state === 'unavailable') {
    return null;
  }

  // If the user edited the field or applied a saved profile, userText holds the current value.
  // If state === 'edited' and userText is empty, the user explicitly cleared/removed it.
  if (comp.state === 'edited') {
    const editedVal = (comp.userText || '').trim();
    return editedVal ? editedVal : null;
  }

  // When state === 'locked', prefer userText if populated (e.g., from a selected profile), otherwise detectedText
  const val = (comp.userText && comp.userText.trim()) ? comp.userText.trim() : (comp.detectedText || '').trim();
  if (!val) return null;
  if (val.toLowerCase() === 'unavailable' || val.toLowerCase() === 'not visible in frame') {
    return null;
  }
  return val;
}

/**
 * Generates the final prompt for the General Prompt Extractor (Tool 1).
 * Strictly follows the current contents of all 13 component fields.
 * Never restores removed, ignored, or unavailable details from the original scan.
 */
export function buildGeneralExtractorPrompt(
  components: Record<ComponentKey, DetectedComponent>,
  outputRatio: string
): string {
  const sections: { title: string; content: string }[] = [];

  for (const item of COMPONENT_DISPLAY_ORDER) {
    const comp = components[item.key];
    const resolved = resolveActiveComponentContent(comp);
    if (resolved) {
      sections.push({
        title: item.title,
        content: resolved,
      });
    }
  }

  if (outputRatio && outputRatio.trim()) {
    sections.push({ title: 'ASPECT RATIO & CROP', content: outputRatio.trim() });
  }

  const promptBody = sections.map((s) => `${s.title}:\n${s.content}`).join('\n\n');
  return sanitizeProductionPrompt(promptBody);
}

/**
 * Generates the final prompt for the Subject Swapping tool (Tool 2).
 * Instructs the image model to introduce the replacement subject while preserving
 * the selected non-subject reference characteristics and respecting any replaced/edited/ignored components.
 */
export function buildSubjectSwapPrompt(
  components: Record<ComponentKey, DetectedComponent>,
  outputRatio: string
): string {
  const sections: { title: string; content: string }[] = [];

  for (const item of COMPONENT_DISPLAY_ORDER) {
    const comp = components[item.key];
    const resolved = resolveActiveComponentContent(comp);
    if (resolved) {
      sections.push({
        title: item.title,
        content: resolved,
      });
    }
  }

  if (outputRatio && outputRatio.trim()) {
    sections.push({ title: 'OUTPUT IMAGE RATIO', content: outputRatio.trim() });
  }

  const headerDirective = `SUBJECT REPLACEMENT DIRECTIVE:\nGenerate a high-resolution photograph featuring the specified SUBJECT and BODY below, while adhering to the selected pose, camera perspective, framing, lighting, environment, and scene configuration.`;

  const promptBody = sections.map((s) => `${s.title}:\n${s.content}`).join('\n\n');
  return sanitizeProductionPrompt(`${headerDirective}\n\n${promptBody}`);
}

/**
 * Generates the final prompt for the Camera Angle Controller (Tool 3).
 * Instructs the image model to apply the requested camera viewpoint, elevation, shot size,
 * framing, and camera-to-subject distance while preserving the selected subject, pose, clothing, lighting, and background.
 */
export function buildCameraControlPrompt(
  cameraSettings: CameraControlSettings,
  components: Record<ComponentKey, DetectedComponent>,
  outputRatio: string
): string {
  const cameraLines: string[] = [];
  if (cameraSettings.viewpoint.trim()) {
    cameraLines.push(`Viewpoint & Horizontal Direction: ${cameraSettings.viewpoint.trim()}`);
  }
  if (cameraSettings.elevation.trim()) {
    cameraLines.push(`Camera Elevation: ${cameraSettings.elevation.trim()}`);
  }
  if (cameraSettings.shotSize.trim()) {
    cameraLines.push(`Shot Size: ${cameraSettings.shotSize.trim()}`);
  }
  if (cameraSettings.distance.trim()) {
    cameraLines.push(`Camera-to-Subject Distance: ${cameraSettings.distance.trim()}`);
  }
  if (cameraSettings.angleOfView.trim()) {
    cameraLines.push(`Angle of View & Optical Perspective: ${cameraSettings.angleOfView.trim()}`);
  }
  if (cameraSettings.customNotes.trim()) {
    cameraLines.push(`Additional Camera Notes: ${cameraSettings.customNotes.trim()}`);
  }

  // If the user also edited or applied a saved preset to the Camera component card directly, include it
  const cameraComp = components.camera;
  if (cameraComp && cameraComp.state === 'edited' && cameraComp.userText.trim()) {
    cameraLines.push(`Custom Camera Specification: ${cameraComp.userText.trim()}`);
  }

  const sections: { title: string; content: string }[] = [];

  if (!cameraComp || cameraComp.state !== 'ignored') {
    sections.push({
      title: 'TARGET CAMERA CONFIGURATION',
      content: cameraLines.join('\n'),
    });
  }

  const framingComp = components.framing;
  if (!framingComp || framingComp.state !== 'ignored') {
    const activeFraming =
      framingComp && framingComp.state === 'edited' && framingComp.userText.trim()
        ? framingComp.userText.trim()
        : cameraSettings.framing.trim();
    if (activeFraming) {
      sections.push({
        title: 'TARGET FRAMING & CROP',
        content: activeFraming,
      });
    }
  }

  // Include preserved non-camera components
  const preservedOrder: { key: ComponentKey; title: string }[] = [
    { key: 'subject', title: 'PRESERVED SUBJECT' },
    { key: 'body', title: 'PRESERVED BODY' },
    { key: 'pose', title: 'PRESERVED POSE' },
    { key: 'facial_expression', title: 'PRESERVED FACIAL EXPRESSION' },
    { key: 'hand_gestures', title: 'PRESERVED HAND GESTURES' },
    { key: 'leg_gestures', title: 'PRESERVED LEG GESTURES' },
    { key: 'clothing', title: 'PRESERVED CLOTHING' },
    { key: 'lighting', title: 'PRESERVED LIGHTING' },
    { key: 'environment', title: 'PRESERVED ENVIRONMENT' },
    { key: 'background', title: 'PRESERVED BACKGROUND' },
  ];

  if (cameraSettings.preserveComposition) {
    preservedOrder.push({ key: 'composition', title: 'PRESERVED COMPOSITION' });
  }

  for (const item of preservedOrder) {
    const comp = components[item.key];
    const resolved = resolveActiveComponentContent(comp);
    if (resolved) {
      sections.push({
        title: item.title,
        content: resolved,
      });
    }
  }

  if (outputRatio && outputRatio.trim()) {
    sections.push({ title: 'OUTPUT IMAGE RATIO', content: outputRatio.trim() });
  }

  const intro = `CAMERA PERSPECTIVE TRANSFORMATION DIRECTIVE:\nRender the scene from the specified TARGET CAMERA CONFIGURATION and TARGET FRAMING below while preserving the subject identity, pose geometry, wardrobe, lighting, and background elements.`;

  const body = sections.map((s) => `${s.title}:\n${s.content}`).join('\n\n');
  return sanitizeProductionPrompt(`${intro}\n\n${body}`);
}

/**
 * Resolves the default gaze behavior instruction text for a selected GazeBehaviorType.
 */
export function getDefaultGazeDirectiveText(
  gazeBehavior: GazeBehaviorType,
  detectedReferenceGaze?: string
): string {
  switch (gazeBehavior) {
    case 'look_at_camera':
      return 'Direct the subject’s eyes and gaze directly into the camera lens from the new camera position, maintaining a natural, unforced eye alignment consistent with the new viewing angle.';
    case 'keep_original_gaze':
      return 'Maintain the subject’s original gaze direction within the scene as established in the supplied input image, so that as the camera viewpoint moves around the subject, their eyes remain oriented toward the same point in the environment rather than following the camera.';
    case 'match_reference_gaze':
      if (detectedReferenceGaze && detectedReferenceGaze.trim()) {
        return `Reproduce the gaze relationship relative to the camera observed in the camera reference: ${detectedReferenceGaze.trim()}`;
      }
      return 'Match the eye-to-camera gaze relationship implied by the extracted camera viewpoint and framing.';
    case 'look_away':
      return 'Direct the subject’s gaze naturally off-camera away from the lens for an unposed, candid perspective.';
    case 'none':
      return '';
    case 'custom':
      return '';
    default:
      return '';
  }
}

/**
 * Resolves the active text of a single Camera Extracted Component (A through K),
 * strictly honoring ignored, unavailable, cleared, or edited states.
 */
export function resolveCameraComponentContent(
  comp: CameraExtractedComponent | undefined
): string | null {
  if (!comp) return null;
  if (comp.state === 'ignored' || comp.state === 'unavailable') {
    return null;
  }
  if (comp.state === 'edited') {
    const editedVal = (comp.userText || '').trim();
    return editedVal ? editedVal : null;
  }
  const val = (comp.userText && comp.userText.trim())
    ? comp.userText.trim()
    : (comp.detectedText || '').trim();
  if (!val) return null;
  if (val.toLowerCase() === 'unavailable' || val.toLowerCase() === 'not visible in frame') {
    return null;
  }
  return val;
}

/**
 * Builds the reusable Image-to-Image Camera Transformation Prompt for the upgraded
 * Camera Angle Controller (11 Camera Reference Components A–K + Gaze Behavior).
 * Explicitly instructs the external image-generation model to apply the extracted camera
 * characteristics to the user's ORIGINAL IMAGE supplied alongside the prompt.
 */
export function buildCameraReferenceTransformationPrompt(
  state: CameraReferenceAnalysisState
): string {
  const directiveHeader = `IMAGE-TO-IMAGE CAMERA TRANSFORMATION DIRECTIVE:
Apply the camera viewpoint, optical perspective, framing, spatial arrangement, focus behavior, and photographic rendering characteristics specified below to the original image supplied alongside this prompt. Re-photograph the subject and scene from the supplied input image as if captured from this exact camera setup.`;

  const preservationRules: string[] = [];
  if (state.preserveSubjectIdentity) {
    preservationRules.push(
      '- Preserve the exact subject identity, facial structure, skin tone, hair texture/style, and anatomical body proportions from the supplied input image.'
    );
  }
  if (state.preserveOriginalClothing) {
    preservationRules.push(
      '- Preserve the exact clothing, garments, colors, patterns, fabric textures, fit, and accessories from the supplied input image.'
    );
  }
  if (state.preserveOriginalPoseStructure) {
    preservationRules.push(
      '- Preserve the subject’s body pose, posture, and gesture configuration from the supplied input image, naturally foreshortened and geometrically projected as viewed from the new camera position and angle.'
    );
  }
  if (state.preserveOriginalScene) {
    preservationRules.push(
      '- Preserve the environment, background elements, spatial setting, and lighting continuity from the supplied input image, naturally revealing perspectives consistent with the new camera angle.'
    );
  }
  preservationRules.push(
    '- Do NOT copy or transfer any person, clothing, or scene objects from the camera reference—transform ONLY the camera angle, framing, perspective, and photographic characteristics of the supplied input image.'
  );

  const cameraSpecLines: string[] = [];
  for (const key of ALL_CAMERA_COMPONENT_KEYS) {
    const comp = state.components[key];
    const resolved = resolveCameraComponentContent(comp);
    if (resolved) {
      const meta = CAMERA_COMPONENT_LABELS[key];
      cameraSpecLines.push(`${meta.code}. ${meta.label.toUpperCase()}:\n${resolved}`);
    }
  }

  const gazeText =
    state.customGazeText && state.customGazeText.trim()
      ? state.customGazeText.trim()
      : getDefaultGazeDirectiveText(state.gazeBehavior, state.detectedReferenceGaze);

  const blocks: string[] = [
    directiveHeader,
    `ORIGINAL INPUT IMAGE PRESERVATION RULES:\n${preservationRules.join('\n')}`,
  ];

  if (cameraSpecLines.length > 0) {
    blocks.push(
      `TARGET CAMERA & PHOTOGRAPHIC SPECIFICATIONS (APPLY TO SUPPLIED IMAGE):\n\n${cameraSpecLines.join('\n\n')}`
    );
  }

  if (state.gazeBehavior !== 'none' && gazeText) {
    blocks.push(`SUBJECT GAZE & EYE DIRECTION BEHAVIOR:\n${gazeText}`);
  }

  if (state.additionalTransformationNotes && state.additionalTransformationNotes.trim()) {
    blocks.push(
      `ADDITIONAL CAMERA TRANSFORMATION INSTRUCTIONS:\n${state.additionalTransformationNotes.trim()}`
    );
  }

  if (state.outputRatio && state.outputRatio.trim()) {
    blocks.push(
      `TARGET OUTPUT ASPECT RATIO & ORIENTATION:\n${state.outputRatio.trim()}${
        state.orientation ? ` (${state.orientation})` : ''
      }`
    );
  }

  return sanitizeProductionPrompt(blocks.join('\n\n'));
}

/**
 * Optional Negative Prompt generator based on active components and camera settings
 */
export function buildNegativePrompt(components?: Record<ComponentKey, DetectedComponent> | null): string {
  const baseNegatives = [
    'identity drift',
    'plastic skin smoothing',
    'airbrushed texture',
    'distorted anatomy',
    'extra limbs or fused fingers',
    'asymmetrical eyes',
    'artificial CGI sheen',
    'oversaturated neon lighting',
    'watermark or text overlay',
  ];

  if (components) {
    if (components.leg_gestures?.state === 'unavailable') {
      baseNegatives.push('invented lower legs or feet when cropped out of frame');
    }
    if (components.hand_gestures?.state === 'unavailable') {
      baseNegatives.push('invented hands or malformed fingers');
    }
  }

  return baseNegatives.join(', ');
}

/**
 * Legacy compatibility Authority Map builder
 */
export function buildAuthorityMap(
  mode: PromptMode,
  components?: Record<ComponentKey, DetectedComponent>
): ComponentAuthorityMap {
  const map: Partial<ComponentAuthorityMap> = {};
  for (const k of ALL_COMPONENT_KEYS) {
    const comp = components?.[k];
    if (comp?.state === 'unavailable') {
      map[k] = 'UNAVAILABLE';
      continue;
    }
    if (comp?.state === 'ignored') {
      map[k] = 'IGNORED';
      continue;
    }
    if (comp?.state === 'edited') {
      map[k] = 'USER_EDIT';
      continue;
    }
    if (mode === 'replace_subject' && (k === 'subject' || k === 'body')) {
      map[k] = 'MASTER_PERSONA';
    } else if (mode === 'replace_subject_outfit' && (k === 'subject' || k === 'body')) {
      map[k] = 'MASTER_PERSONA';
    } else if (mode === 'replace_subject_outfit' && k === 'clothing') {
      map[k] = 'MASTER_OUTFIT';
    } else {
      map[k] = 'REFERENCE';
    }
  }
  return map as ComponentAuthorityMap;
}

export interface PromptResolutionInput {
  masterSubject: string;
  masterBody: string;
  masterOutfit?: MasterOutfit | string;
  components: Record<ComponentKey, DetectedComponent>;
  authorityMap: ComponentAuthorityMap;
  outputRatio: string;
}

export function buildMasterPromptFromAuthority(input: PromptResolutionInput): string {
  const { masterSubject, masterBody, masterOutfit, components, authorityMap, outputRatio } = input;
  const outfitText =
    typeof masterOutfit === 'string'
      ? masterOutfit
      : masterOutfit
      ? masterOutfit.description
      : '';

  const sections: { title: string; content: string }[] = [];

  for (const item of COMPONENT_DISPLAY_ORDER) {
    const auth = authorityMap[item.key] || 'REFERENCE';
    const comp = components[item.key];
    if (!comp || auth === 'IGNORED' || auth === 'UNAVAILABLE' || comp.state === 'ignored' || comp.state === 'unavailable') {
      continue;
    }

    let content: string | null = null;
    if (auth === 'USER_EDIT') {
      content = (comp.userText || '').trim() || null;
    } else if (auth === 'MASTER_PERSONA') {
      if (item.key === 'subject') content = (comp.userText || masterSubject || '').trim();
      else if (item.key === 'body') content = sanitizeProductionPrompt((comp.userText || masterBody || '').trim());
    } else if (auth === 'MASTER_OUTFIT' && item.key === 'clothing') {
      content = (comp.userText || outfitText || '').trim() || null;
    } else {
      content = resolveActiveComponentContent(comp);
    }

    if (content && content.trim()) {
      sections.push({
        title: item.title,
        content: content.trim(),
      });
    }
  }

  if (outputRatio && outputRatio.trim()) {
    sections.push({ title: 'OUTPUT IMAGE RATIO', content: outputRatio.trim() });
  }

  const promptBody = sections.map((s) => `${s.title}:\n${s.content}`).join('\n\n');
  return sanitizeProductionPrompt(promptBody);
}

export function buildMasterPrompt(
  masterSubject: string,
  masterBody: string,
  components: Record<ComponentKey, DetectedComponent>,
  outputRatio: string,
  mode: PromptMode = 'reference_control',
  masterOutfit?: MasterOutfit | string
): string {
  const authorityMap = buildAuthorityMap(mode, components);
  return buildMasterPromptFromAuthority({
    masterSubject,
    masterBody,
    masterOutfit,
    components,
    authorityMap,
    outputRatio,
  });
}

/**
 * Exports the structured master prompt for target models
 */
export function exportPromptForModel(
  masterPrompt: string,
  targetModel: TargetModelType,
  outputRatio: string
): string {
  const cleanPrompt = sanitizeProductionPrompt(masterPrompt);

  switch (targetModel) {
    case 'flux':
      return sanitizeProductionPrompt(`--ar ${outputRatio.replace(':', ':')} --style raw

${cleanPrompt}

[FLUX Photographic Directive: Maintain exact spatial pose geometry, anatomical configuration, and optical camera perspective as specified above.]`);

    case 'gemini':
      return sanitizeProductionPrompt(`Photographic Generation Specification:

${cleanPrompt}

Instructions:
- Follow every component specification above with high visual fidelity.
- Preserve spatial relationships, joint articulation, camera viewpoint, and framing without inventing excluded details.`);

    case 'chatgpt':
      return sanitizeProductionPrompt(`Generate a realistic high-resolution photograph adhering strictly to the following visual specification:

${cleanPrompt}

Requirements:
- Authentic skin and fabric textures, accurate anatomical proportions, and faithful adherence to the specified camera perspective and pose.`);

    case 'universal':
    default:
      return cleanPrompt;
  }
}

/**
 * Lightweight pre-flight prompt safety & ambiguity screening
 */
export function checkPromptSafety(text: string): PromptSafetyCheck {
  const notices: PromptSafetyCheck['notices'] = [];

  const checkPatterns = [
    {
      regex: /\b(nipples?|areolae?|areolas?)\b/gi,
      category: 'Anatomical Specificity',
      suggestion: 'natural torso silhouette / soft realistic contours',
      explanation: 'Explicit anatomical terms often trigger external platform safety filters. Recommend photographic silhouette phrasing.',
    },
    {
      regex: /\b(ptosis\s*grade|35:65|breast-development)\b/gi,
      category: 'Clinical Medical Jargon',
      suggestion: 'gravity-settled natural shape',
      explanation: 'Clinical surgical terms may confuse image model semantic parsers.',
    },
    {
      regex: /\b(naked|nude|undressed|explicit)\b/gi,
      category: 'Safety Moderation Risk',
      suggestion: 'minimalist unadorned aesthetic / natural skin exposure',
      explanation: 'High likelihood of triggering commercial platform content blocks.',
    },
    {
      regex: /\b(zero perspective distortion|exact 50\.0mm lens)\b/gi,
      category: 'Technical Over-Specification',
      suggestion: 'neutral eye-level optical perspective',
      explanation: 'Generative models hallucinate or fight rigid mathematical lens mandates.',
    },
  ];

  for (const item of checkPatterns) {
    const match = text.match(item.regex);
    if (match) {
      notices.push({
        category: item.category,
        originalPhrase: match[0],
        suggestedPhrase: item.suggestion,
        explanation: item.explanation,
      });
    }
  }

  return {
    hasIssues: notices.length > 0,
    score: notices.length === 0 ? 'clean' : notices.length > 1 ? 'attention' : 'advisory',
    notices,
  };
}
