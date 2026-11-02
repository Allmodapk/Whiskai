import { SwapMatrixSwitches } from './swapBlocks';

export type SwapConflictFixAction =
  | { type: 'upload_template' }
  | { type: 'upload_face' }
  | { type: 'set_switch'; key: keyof SwapMatrixSwitches; value: SwapMatrixSwitches[keyof SwapMatrixSwitches] }
  | { type: 'add_bottom_wear_line' }
  | { type: 'clear_mannequin_image' }
  | { type: 'set_people_count'; count: 1 | 2 }
  | { type: 'clear_man_image' };

export interface SwapConflictItem {
  id: string;
  severity: 'blocking' | 'warning';
  blocking: boolean;
  message: string;
  fixLabel: string;
  fixAction: SwapConflictFixAction;
}

export interface SwapConflictCheckInput {
  switches: SwapMatrixSwitches;
  hasTemplateImage: boolean;
  hasFaceImage: boolean;
  hasMannequinImage: boolean;
  hasManImage: boolean;
  peopleCount: 1 | 2;
  faceShowsOnlyUpperBody?: boolean;
  faceHasClearExpression?: boolean;
  typedBottomWearLine?: string;
  savedOutfitText?: string;
  typedOutfitText?: string;
  savedBackgroundText?: string;
  typedBackgroundText?: string;
}

/**
 * Local, instant conflict checker for Swap Studio.
 * ADDENDUM RULE 7:
 * A missing required image (Template or Face) is the ONLY blocking condition.
 * Every other rule is a warning with a "Fix" button; it never blocks Copy.
 */
export function checkSwapConflicts(input: SwapConflictCheckInput): SwapConflictItem[] {
  const conflicts: SwapConflictItem[] = [];
  const {
    switches,
    hasTemplateImage,
    hasFaceImage,
    hasMannequinImage,
    hasManImage,
    peopleCount,
    faceShowsOnlyUpperBody = true,
    faceHasClearExpression = true,
    typedBottomWearLine = '',
    savedOutfitText = '',
    typedOutfitText = '',
    savedBackgroundText = '',
    typedBackgroundText = '',
  } = input;

  // -------------------------------------------------------------------------
  // BLOCKING CONDITIONS: ONLY missing required images (Template or Face)
  // -------------------------------------------------------------------------
  if (!hasTemplateImage) {
    conflicts.push({
      id: 'missing_template_image',
      severity: 'blocking',
      blocking: true,
      message: 'Required image missing: Upload a Template image (the scene, pose, and camera master).',
      fixLabel: 'Upload Template',
      fixAction: { type: 'upload_template' },
    });
  }

  if (!hasFaceImage) {
    conflicts.push({
      id: 'missing_face_image',
      severity: 'blocking',
      blocking: true,
      message: 'Required image missing: Upload a Face image (the identity reference for subject 1).',
      fixLabel: 'Upload Face',
      fixAction: { type: 'upload_face' },
    });
  }

  // -------------------------------------------------------------------------
  // NON-BLOCKING WARNINGS WITH ONE-TAP "FIX" ACTIONS
  // -------------------------------------------------------------------------

  // 1. Body = Mannequin and no mannequin uploaded
  if (switches.body === 'mannequin' && !hasMannequinImage) {
    conflicts.push({
      id: 'body_mannequin_missing_image',
      severity: 'warning',
      blocking: false,
      message:
        'Body is set to Mannequin, but no Mannequin image is uploaded. Upload a Mannequin or switch Body to Template.',
      fixLabel: 'Fix: Set Body to Template',
      fixAction: { type: 'set_switch', key: 'body', value: 'template' },
    });
  }

  // 2. Outfit = Face while Face shows only the upper body
  if (
    switches.outfit === 'face' &&
    faceShowsOnlyUpperBody &&
    !typedBottomWearLine.trim()
  ) {
    conflicts.push({
      id: 'outfit_face_upper_body_only',
      severity: 'warning',
      blocking: false,
      message:
        'Outfit is set to Face while Face shows only the upper body: lower garments will be invented, add a typed bottom-wear line.',
      fixLabel: 'Fix: Add bottom-wear line',
      fixAction: { type: 'add_bottom_wear_line' },
    });
  }

  // 3. Background = Recreated in Face's style while Lighting = Template
  if (switches.background === 'face_style' && switches.lighting === 'template') {
    conflicts.push({
      id: 'background_face_lighting_template_mismatch',
      severity: 'warning',
      blocking: false,
      message:
        "Background is set to Recreated in Face's style while Lighting is still set to Template. Matching Lighting to Face prevents lighting clashes.",
      fixLabel: 'Fix: Set Lighting to Face',
      fixAction: { type: 'set_switch', key: 'lighting', value: 'face' },
    });
  }

  // 4. Body = Template while a mannequin was uploaded
  if (switches.body === 'template' && hasMannequinImage) {
    conflicts.push({
      id: 'body_template_with_mannequin_uploaded',
      severity: 'warning',
      blocking: false,
      message:
        'A Mannequin image is uploaded while Body is set to Template; the Mannequin image will be ignored.',
      fixLabel: 'Fix: Set Body to Mannequin',
      fixAction: { type: 'set_switch', key: 'body', value: 'mannequin' },
    });
  }

  // 5. A Man image uploaded while the Template has 1 person
  if (hasManImage && peopleCount === 1) {
    conflicts.push({
      id: 'man_uploaded_single_person_template',
      severity: 'warning',
      blocking: false,
      message:
        'A Man image is uploaded while People in template is set to 1. Set People in template to 2 or remove the Man image.',
      fixLabel: 'Fix: Set People in template to 2',
      fixAction: { type: 'set_people_count', count: 2 },
    });
  }

  // 6. Expression = Face while Face has no clear expression
  if (switches.expression === 'face' && !faceHasClearExpression) {
    conflicts.push({
      id: 'expression_face_unclear',
      severity: 'warning',
      blocking: false,
      message:
        'Expression is set to Face, but Face is marked as having no clear expression.',
      fixLabel: 'Fix: Set Expression to Template',
      fixAction: { type: 'set_switch', key: 'expression', value: 'template' },
    });
  }

  // 7a. Outfit switch set to Saved or Typed with empty text
  if (switches.outfit === 'saved' && !savedOutfitText.trim()) {
    conflicts.push({
      id: 'outfit_saved_empty',
      severity: 'warning',
      blocking: false,
      message: 'Outfit is set to Saved outfit, but no saved outfit description is selected.',
      fixLabel: 'Fix: Set Outfit to Template',
      fixAction: { type: 'set_switch', key: 'outfit', value: 'template' },
    });
  } else if (switches.outfit === 'typed' && !typedOutfitText.trim()) {
    conflicts.push({
      id: 'outfit_typed_empty',
      severity: 'warning',
      blocking: false,
      message: 'Outfit is set to Typed text, but the outfit text box is empty.',
      fixLabel: 'Fix: Set Outfit to Template',
      fixAction: { type: 'set_switch', key: 'outfit', value: 'template' },
    });
  }

  // 7b. Background switch set to Saved or Typed with empty text
  if (switches.background === 'saved' && !savedBackgroundText.trim()) {
    conflicts.push({
      id: 'background_saved_empty',
      severity: 'warning',
      blocking: false,
      message:
        'Background is set to Saved background, but no saved background description is selected.',
      fixLabel: 'Fix: Set Background to Template',
      fixAction: { type: 'set_switch', key: 'background', value: 'template' },
    });
  } else if (switches.background === 'typed' && !typedBackgroundText.trim()) {
    conflicts.push({
      id: 'background_typed_empty',
      severity: 'warning',
      blocking: false,
      message: 'Background is set to Typed text, but the background text box is empty.',
      fixLabel: 'Fix: Set Background to Template',
      fixAction: { type: 'set_switch', key: 'background', value: 'template' },
    });
  }

  return conflicts;
}

export function hasBlockingSwapConflict(conflicts: SwapConflictItem[]): boolean {
  return conflicts.some((c) => c.blocking);
}
