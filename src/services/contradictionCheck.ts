import { ComponentKey, DetectedComponent, ContradictionIssue, COMPONENT_LABELS } from '../types';

/**
 * Pure deterministic contradiction checking engine for My Whisk AI (No AI calls).
 * Analyzes active component texts and output ratio for geometric, posture, lighting,
 * and cross-field contradictions.
 */
export function checkPromptContradictions(
  components: Partial<Record<ComponentKey, DetectedComponent>>,
  outputRatio: string,
  tickedKeys?: ComponentKey[]
): ContradictionIssue[] {
  const issues: ContradictionIssue[] = [];

  const getText = (key: ComponentKey): string => {
    const comp = components[key];
    if (!comp) return '';
    if (tickedKeys && !tickedKeys.includes(key)) return '';
    if (comp.state === 'ignored' || comp.state === 'unavailable') return '';
    const active = comp.state === 'edited' ? comp.userText : comp.userText || comp.detectedText;
    return (active || '').trim();
  };

  const getLabel = (key: ComponentKey): string => {
    return COMPONENT_LABELS[key] || key;
  };

  const cameraText = getText('camera');
  const framingText = getText('framing');
  const poseText = getText('pose');
  const bodyText = getText('body');
  const legText = getText('leg_gestures');
  const handText = getText('hand_gestures');
  const lightingText = getText('lighting');
  const envText = getText('environment');
  const bgText = getText('background');
  const compText = getText('composition');

  // Rule 1: Full-body vs Cropped Cutoff
  const fullBodyKeywords = ['full-body', 'full body', 'head-to-toe', 'standing full height', 'entire body visible'];
  const croppedKeywords = ['cuts at knees', 'cut off at the waist', 'waist-up', 'chest-up', 'cropped at knees', 'lower legs outside frame', 'legs outside frame', 'cut at ankles', 'close-up', 'close up', 'cropped at', 'tight close-up'];

  const claimsFullBody =
    fullBodyKeywords.some((k) => framingText.toLowerCase().includes(k)) ||
    fullBodyKeywords.some((k) => cameraText.toLowerCase().includes(k));

  const claimsCropped =
    croppedKeywords.some((k) => framingText.toLowerCase().includes(k)) ||
    croppedKeywords.some((k) => cameraText.toLowerCase().includes(k)) ||
    croppedKeywords.some((k) => legText.toLowerCase().includes(k)) ||
    components.leg_gestures?.state === 'unavailable' ||
    components.leg_gestures?.visibility === 'unavailable';

  if (claimsFullBody && claimsCropped) {
    issues.push({
      id: 'issue_fullbody_vs_crop',
      fieldA: 'framing',
      fieldB: 'leg_gestures',
      labelA: getLabel('framing'),
      labelB: getLabel('leg_gestures'),
      textA: framingText || cameraText,
      textB: legText || 'Legs marked unavailable / cropped outside frame',
      explanation:
        'Framing claims a full-body shot, but frame cutoffs or leg gestures indicate lower legs are cropped or outside the frame.',
    });
  }

  // Rule 2: Seated vs Standing Posture Mismatch
  const claimsSeated =
    ['seated', 'sitting', 'perched on', 'sat on', 'seated on'].some((k) => poseText.toLowerCase().includes(k)) ||
    ['seated', 'sitting'].some((k) => bodyText.toLowerCase().includes(k));

  const claimsStanding =
    ['standing posture', 'standing upright', 'standing position', 'feet flat while standing'].some((k) => legText.toLowerCase().includes(k)) ||
    ['standing posture', 'standing upright', 'standing silhouette', 'standing position'].some((k) => bodyText.toLowerCase().includes(k)) ||
    ['standing posture', 'standing upright'].some((k) => poseText.toLowerCase().includes(k));

  if (claimsSeated && claimsStanding) {
    issues.push({
      id: 'issue_seated_vs_standing',
      fieldA: 'pose',
      fieldB: 'leg_gestures',
      labelA: getLabel('pose'),
      labelB: getLabel('leg_gestures'),
      textA: poseText,
      textB: legText,
      explanation:
        'Pose specifies a seated posture, but leg gestures describe a standing position.',
    });
  }

  // Rule 3: Eye-Level Camera vs Low/High Elevation
  const claimsEyeLevel = cameraText.toLowerCase().includes('eye-level') || cameraText.toLowerCase().includes('eye level');
  const claimsLowHighAngle =
    ['floor-level', 'near floor', 'below seat', 'low-angle', 'high-angle', "worm's-eye", 'overhead'].some((k) =>
      cameraText.toLowerCase().includes(k)
    );

  if (claimsEyeLevel && claimsLowHighAngle) {
    issues.push({
      id: 'issue_eyelevel_vs_elevation',
      fieldA: 'camera',
      fieldB: 'camera',
      labelA: `${getLabel('camera')} (Elevation)`,
      labelB: `${getLabel('camera')} (Angle)`,
      textA: 'Eye-level camera mandate',
      textB: cameraText,
      explanation:
        'Camera description contains both "eye-level" and a low/high elevation or tilted viewing angle cue.',
    });
  }

  // Rule 4: Direct Sunlight vs Windowless Indoor Environment
  const claimsDirectSunlight =
    ['direct sunlight', 'bright sun', 'sunbeam', 'harsh sunlight'].some((k) => lightingText.toLowerCase().includes(k));
  const claimsWindowlessIndoor =
    ['windowless', 'no windows', 'enclosed basement', 'dark room with no natural light'].some((k) => envText.toLowerCase().includes(k) || bgText.toLowerCase().includes(k));

  if (claimsDirectSunlight && claimsWindowlessIndoor) {
    issues.push({
      id: 'issue_sunlight_vs_windowless',
      fieldA: 'lighting',
      fieldB: 'environment',
      labelA: getLabel('lighting'),
      labelB: getLabel('environment'),
      textA: lightingText,
      textB: envText || bgText,
      explanation:
        'Lighting specifies direct outdoor sunlight, but environment describes a windowless enclosed room.',
    });
  }

  // Rule 5: Aspect Ratio vs Orientation Wording
  const isPortraitRatio = ['3:4', '9:16', '4:5', '2:3'].includes(outputRatio.trim());
  const claimsLandscapeText =
    ['landscape orientation', 'wide horizontal frame', 'horizontal landscape format'].some(
      (k) => cameraText.toLowerCase().includes(k) || framingText.toLowerCase().includes(k) || compText.toLowerCase().includes(k)
    );

  if (isPortraitRatio && claimsLandscapeText) {
    issues.push({
      id: 'issue_ratio_vs_orientation',
      fieldA: 'camera',
      fieldB: 'framing',
      labelA: 'Output Ratio',
      labelB: getLabel('framing'),
      textA: `Output Ratio: ${outputRatio} (Vertical/Portrait)`,
      textB: framingText || cameraText,
      explanation:
        `Selected output ratio is vertical portrait (${outputRatio}), but text describes a horizontal landscape orientation.`,
    });
  }

  // Rule 6: Unticked / Unavailable Component References
  if (handText && (components.hand_gestures?.state === 'ignored' || components.hand_gestures?.state === 'unavailable')) {
    if (poseText.toLowerCase().includes('hand') || poseText.toLowerCase().includes('finger') || poseText.toLowerCase().includes('holding')) {
      issues.push({
        id: 'issue_pose_references_ignored_hands',
        fieldA: 'pose',
        fieldB: 'hand_gestures',
        labelA: getLabel('pose'),
        labelB: getLabel('hand_gestures'),
        textA: poseText,
        textB: 'Hand gestures are ignored or excluded',
        explanation: 'Pose description references hand positions, but hand gestures are unticked or excluded.',
      });
    }
  }

  return issues;
}
