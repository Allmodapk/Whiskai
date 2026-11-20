export interface LockCategory {
  readonly id: number;
  readonly name: string;
  readonly items: readonly string[];
}

export interface LockAddon {
  readonly id: 'A' | 'B';
  readonly name: string;
  readonly items: readonly string[];
}

export interface LockCatalog {
  readonly cats: readonly LockCategory[];
  readonly adds: readonly LockAddon[];
  readonly bodyRules: string;
  readonly imageRules: string;
  readonly strictHeader: string;
  readonly strictFooter: string;
  readonly changeHeader: string;
  readonly additionalHeader: string;
}

export const CATS: readonly LockCategory[] = [
  {
    id: 1,
    name: 'Color and grade',
    items: [
      'All colors in the image',
      'Brightness, exposure, contrast',
      'Saturation, hue, tint',
      'Warmth, color temperature, color grade',
      'No relighting, filter look, tone mapping, or enhancement',
    ],
  },
  {
    id: 2,
    name: 'Identity',
    items: [
      'Face shape, bone structure, proportions',
      'Eyes, eyebrows, nose, lips, jawline, chin',
      'Eye color',
      'Expression',
      'Gaze direction',
      'No face drift, face swap, or blending',
    ],
  },
  {
    id: 3,
    name: 'Skin',
    items: [
      'Skin tone and undertone',
      'Texture and pores',
      'Marks, moles, freckles, natural lines',
      'Natural shine and reflectivity',
      'No smoothing, airbrushing, or beautification',
    ],
  },
  {
    id: 4,
    name: 'Hair',
    items: [
      'Hairstyle and arrangement',
      'Hair length, volume, density',
      'Hair color, roots, highlights, lowlights',
      'Parting and hairline',
      'Strand direction, flow, and texture',
      'Loose strands and baby hairs',
      'Hair shine and highlights',
      'Hair movement (video)',
    ],
  },
  {
    id: 5,
    name: 'Body and pose',
    items: [
      'Body shape and proportions',
      'Height impression, shoulders, waist, hips, limbs',
      'Ears, neck',
      'Pose and body position',
      'Head angle and position',
      'Hand and finger placement',
    ],
  },
  {
    id: 6,
    name: 'Clothing',
    items: [
      'Garment type, color, fabric, pattern',
      'Fit, draping, folds',
      'Neckline, sleeves, hem',
      'Footwear (if visible)',
    ],
  },
  {
    id: 7,
    name: 'Accessories and jewelry',
    items: [
      'All existing items exactly as they appear',
      'Nothing added',
      'Nothing removed',
    ],
  },
  {
    id: 8,
    name: 'Scene',
    items: [
      'Background and environment',
      'Objects and props',
      'Depth and atmosphere',
      'Nothing added, nothing removed',
    ],
  },
  {
    id: 9,
    name: 'Lighting',
    items: [
      'Light direction and quality',
      'Shadows and reflections',
      'Highlights and exposure balance',
    ],
  },
  {
    id: 10,
    name: 'Camera and technical',
    items: [
      'Framing, crop, aspect ratio, resolution',
      'Camera angle and perspective',
      'Lens distortion characteristics',
      'Sharpness and grain',
      'No zoom, reframing, or padding',
      'Subject size and position in frame',
    ],
  },
  {
    id: 11,
    name: 'Realism rules',
    items: [
      'Photorealistic',
      'No pasted, plastic, or cut-out look',
      'No halo or edge artifacts',
      'No hallucinated details',
    ],
  },
  {
    id: 12,
    name: 'Output',
    items: [
      'Same resolution and aspect ratio',
      'Looks like an unedited real photograph',
    ],
  },
  {
    id: 13,
    name: 'Video only',
    items: [
      'Camera movement, no stabilizing',
      'Subject motion, frame by frame',
      'Lip-sync to the original audio',
      'Audio, untouched and unshifted',
      'No flickering or frame drift',
    ],
  },
];

export const ADDS: readonly LockAddon[] = [
  {
    id: 'A',
    name: 'Newly exposed areas',
    items: [
      "Revealed skin matches the person's own tone, texture, and lighting",
      'Revealed background matches the existing one',
      'Natural hairline, no hard edges',
    ],
  },
  {
    id: 'B',
    name: 'Blending',
    items: [
      'The changed element has realistic shadows',
      'Same sharpness, texture, and lighting as the rest of the image',
    ],
  },
];

export const BODY_RULES =
  "- The fit follows the person's actual body contours. The body is never reshaped, resized, or adjusted to suit the garment.\n" +
  "- The new garment's color and pattern are the one exception to the color lock. Everything else keeps its original color.\n" +
  '- The neckline, collar, or sleeves must not hide or alter the neck, ears, or hands. Existing accessories stay visible and in place.\n' +
  '- Folds, tension lines, and creases follow the existing pose and light direction.\n' +
  "- Newly visible or newly covered skin matches the person's own tone, texture, and lighting.";

export const IMAGE_RULES =
  'IMAGE ROLES:\n' +
  'Image 1 = the photo to edit. It is the "original" referred to in the lock list.\n' +
  'Image 2 = outfit reference only.\n\n' +
  'CHANGE (the only permitted edit):\n' +
  'Replace the outfit in Image 1 with the outfit worn in Image 2.\n\n' +
  'TAKE FROM IMAGE 2 (outfit only):\n' +
  'Garment type, color, fabric, pattern, cut, neckline, sleeve length, hem length, and fine details such as buttons, stitching, and embroidery.\n\n' +
  'TAKE NOTHING ELSE FROM IMAGE 2:\n' +
  "Not the person's face, body shape, pose, skin, hair, accessories, background, or lighting.\n\n" +
  'BODY PROPORTIONS ARE FIXED:\n' +
  "- Image 1's body stays exactly as it is now: height, width, shoulders, bust, waist, hips, arms, legs, and posture.\n" +
  '- Do not slim, widen, lengthen, shorten, or reshape any part of the body to suit the garment.\n' +
  "- The garment is the only thing that adapts. Re-tailor it to Image 1's exact measurements and pose, even if it fits differently from how it fit the person in Image 2.\n" +
  "- If the garment would not fit Image 1's body as it appears in Image 2, change the garment's fit, not the body.\n\n" +
  'FIT AND DRAPE:\n' +
  "- Redraw folds, tension lines, creases, and stretch for Image 1's pose. Do not copy Image 2's folds.\n" +
  "- The fabric follows Image 1's body contours: it sits where the body is and falls where gravity pulls it in Image 1's pose.\n" +
  "- Keep the garment's original cut and style, but adjust its tightness or looseness to the body in Image 1.\n" +
  "- Sleeve and hem lengths keep the proportions shown in Image 2, measured against Image 1's limbs and torso.\n\n" +
  'LIGHTING AND COLOR:\n' +
  "- Re-light the garment with Image 1's light direction, shadows, highlights, and color temperature.\n" +
  "- The garment's color and pattern from Image 2 are the one exception to the color lock. Everything else keeps its original color.\n\n" +
  'NECK, HANDS, AND ACCESSORIES:\n' +
  '- The collar, neckline, and sleeves must not hide or alter the neck, ears, or hands.\n' +
  "- Image 1's existing accessories stay visible and in place. Image 2's accessories are not carried over.\n\n" +
  'NEWLY EXPOSED OR COVERED AREAS:\n' +
  "- Skin that is newly visible or newly covered matches Image 1's person in tone, texture, and lighting.";

export const STRICT_LOCK_HEADER =
  'STRICT LOCK INSTRUCTION\n' +
  'The elements listed below are strictly locked. They must stay exactly as they appear ' +
  'in the original, with no changes, regeneration, or reinterpretation. Do not compromise ' +
  'on any of them for any reason, even if changing one would improve the result.';

export const STRICT_LOCK_FOOTER =
  'Anything not listed above may change only where I explicitly instruct. ' +
  'If an instruction conflicts with a locked element, the locked element wins.';

export const CHANGE_BLOCK_HEADER = 'CHANGE (the only permitted edit):';

export const ADDITIONAL_REQUIREMENTS_HEADER = 'ADDITIONAL REQUIREMENTS';

export const LOCK_CATALOG: LockCatalog = {
  cats: CATS,
  adds: ADDS,
  bodyRules: BODY_RULES,
  imageRules: IMAGE_RULES,
  strictHeader: STRICT_LOCK_HEADER,
  strictFooter: STRICT_LOCK_FOOTER,
  changeHeader: CHANGE_BLOCK_HEADER,
  additionalHeader: ADDITIONAL_REQUIREMENTS_HEADER,
};
