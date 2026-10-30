import {
  PlayboardFullConfig,
  PlayboardEnvironment,
  PlayboardLightingPreset,
  Camera3DSettings,
  CameraTargetMode,
  CharacterPose3DSettings,
  I2ITransformationScope,
  I2IEditableField,
  I2IFieldId,
  HandGesture,
  GazeDirection,
  FacialExpression,
  ShotFraming,
  LensFocalLength,
  FocusDof,
  SubjectComposition,
} from '../types/cameraPlayboard';
import { TargetModelType } from '../types';
import {
  analyzePlayboardFraming,
  parseOutputAspectRatio,
  computePlayboardCameraTransform,
  computeCharacterWorldLandmarks,
  computeRelativeCameraSubjectAngles,
  computeSubjectGazeTarget,
  resolvePlayboardCameraTargetXZ,
  switchCameraTargetMode,
  applyRequestedFramingState,
  getCustomModelDiagnostics,
  computePlayboardVisualGuidesGeometry,
  resolveSemanticCharacterRigPose,
  getHandGestureTargets,
  CANONICAL_POSE_PRESET_VALUES,
  FRAMING_PRESET_DISTANCES,
  NEUTRAL_CAMERA_REFERENCE_HEIGHT,
  DynamicFramingAnalysis,
  RelativeCameraSubjectAngles,
  ComputedCameraTransform,
  CharacterWorldLandmarks,
  ComputedEyeGazeTarget,
  ResolvedCameraTargetXZ,
  PlayboardVisualGuidesGeometry,
  SemanticCharacterRigPose,
  HandGestureArticulationTarget,
} from './framingAnalyzer';
import {
  evaluateActiveSceneInteraction,
  EvaluatedSceneInteraction,
  SceneInteractionPreset,
} from './sceneInteractionPresets';
import {
  resolveEnvironmentTransformationPolicy,
  buildStructuredPromptSummary,
  validatePlayboardPromptConsistency,
  inspectPlayboardSceneState,
  describePresetUpdateScope,
  computeExpectedChangeSummary,
  sanitizePersistentPlayboardConfig,
  createPlayboardCheckpoint,
  restorePlayboardCheckpoint,
  createShotVariation,
  activateShotVariation,
  compareShotVariations,
  ResolvedEnvironmentTransformation,
} from './playboardSceneIntelligence';

export {
  analyzePlayboardFraming,
  parseOutputAspectRatio,
  computePlayboardCameraTransform,
  computeCharacterWorldLandmarks,
  computeRelativeCameraSubjectAngles,
  computeSubjectGazeTarget,
  resolvePlayboardCameraTargetXZ,
  switchCameraTargetMode,
  applyRequestedFramingState,
  getCustomModelDiagnostics,
  computePlayboardVisualGuidesGeometry,
  resolveSemanticCharacterRigPose,
  getHandGestureTargets,
  CANONICAL_POSE_PRESET_VALUES,
  FRAMING_PRESET_DISTANCES,
  NEUTRAL_CAMERA_REFERENCE_HEIGHT,
  resolveEnvironmentTransformationPolicy,
  buildStructuredPromptSummary,
  validatePlayboardPromptConsistency,
  inspectPlayboardSceneState,
  describePresetUpdateScope,
  computeExpectedChangeSummary,
  sanitizePersistentPlayboardConfig,
  createPlayboardCheckpoint,
  restorePlayboardCheckpoint,
  createShotVariation,
  activateShotVariation,
  compareShotVariations,
};
export type {
  DynamicFramingAnalysis,
  EvaluatedSceneInteraction,
  RelativeCameraSubjectAngles,
  ComputedCameraTransform,
  CharacterWorldLandmarks,
  ComputedEyeGazeTarget,
  ResolvedCameraTargetXZ,
  PlayboardVisualGuidesGeometry,
  SemanticCharacterRigPose,
  HandGestureArticulationTarget,
  ResolvedEnvironmentTransformation,
};

// ==========================================
// 1. Camera Angle & Viewpoint Geometry Helpers
// ==========================================

/**
 * Normalizes an angle in degrees into [-180, 180)
 */
export function normalizeAngleDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/**
 * Computes the camera's horizontal viewing angle relative to the character's actual body facing direction.
 * - When `camera` and `pose` objects are available, uses the true 3D world-space vector from the
 *   character's pelvis to the camera lens (`analyzePlayboardFraming(camera, pose).relativeAngles.relativeToBodyYawDeg`).
 * - When called with raw degrees `(cameraYawDeg, characterYawDeg)`, computes `normalizeAngleDeg(cameraYawDeg - characterYawDeg)`.
 */
export function getEffectiveCameraYawDeg(
  cameraYawDeg: number,
  characterYawDeg: number = 0,
  camera?: Camera3DSettings,
  pose?: CharacterPose3DSettings
): number {
  if (camera && pose) {
    return analyzePlayboardFraming(camera, pose).relativeAngles.relativeToBodyYawDeg;
  }
  return normalizeAngleDeg(cameraYawDeg - (characterYawDeg || 0));
}

/**
 * Accurately describes the camera's horizontal viewing direction relative to the character's
 * current facing orientation.
 *
 * Coordinate convention (relative to character's body facing):
 * - 0°: Camera is directly in front of the character, viewing the character's front.
 * - +90°: Camera is on the character's right side, viewing the character's right profile.
 * - -90°: Camera is on the character's left side, viewing the character's left profile.
 * - ±180°: Camera is directly behind the character, viewing the character's back.
 *
 * Never uses the hard-coded label "front-facing" unless the camera is genuinely within ±12° of the
 * character's front axis.
 */
export function describeCameraHorizontal(relativeYawDeg: number): string {
  const norm = normalizeAngleDeg(relativeYawDeg);
  const absNorm = Math.abs(norm);

  if (absNorm <= 12) {
    return 'direct front-facing camera viewpoint facing squarely toward the subject';
  }
  if (norm > 12 && norm <= 32) {
    return `angled front-right viewpoint viewing the subject from ${Math.round(norm)}° toward the subject's right side (${Math.round(norm)}° yaw)`;
  }
  if (norm >= -32 && norm < -12) {
    return `angled front-left viewpoint viewing the subject from ${Math.round(absNorm)}° toward the subject's left side (${Math.round(norm)}° yaw)`;
  }
  if (norm > 32 && norm <= 68) {
    return `front-right three-quarter perspective viewing subject's right side (approx ${Math.round(norm)}° yaw)`;
  }
  if (norm >= -68 && norm < -32) {
    return `front-left three-quarter perspective viewing subject's left side (approx ${Math.round(absNorm)}° yaw)`;
  }
  if (norm > 68 && norm <= 112) {
    return `right side profile view perpendicular to the subject (${Math.round(norm)}° yaw)`;
  }
  if (norm >= -112 && norm < -68) {
    return `left side profile view perpendicular to the subject (${Math.round(norm)}° yaw)`;
  }
  if (norm > 112 && norm <= 162) {
    return `rear-right three-quarter perspective viewing subject from behind right (approx ${Math.round(norm)}° yaw)`;
  }
  if (norm >= -162 && norm < -112) {
    return `rear-left three-quarter perspective viewing subject from behind left (approx ${Math.round(norm)}° yaw)`;
  }
  return `direct rear viewpoint viewing subject completely from behind (${Math.round(absNorm)}° yaw)`;
}

/**
 * Accurately describes camera height and vertical pitch angle relative to the character's actual
 * 3D posture and eye elevation.
 * Avoids hard-coded "eye-level" labels unless the camera lens is genuinely near the subject's
 * eye height AND the vertical pitch is near level.
 */
export function describeCameraElevation(
  pitchDeg: number,
  height: number,
  basePose: string = 'natural_standing',
  relativeAngles?: RelativeCameraSubjectAngles
): string {
  const roundedPitch = Math.round(pitchDeg);
  const absPitch = Math.abs(roundedPitch);

  // Estimate subject eye height when relativeAngles is not explicitly passed
  const estimatedEyeY =
    basePose === 'reclined_lying'
      ? 0.45
      : basePose === 'floor_seated_cross_legged'
      ? 0.89
      : basePose === 'grounded_kneeling'
      ? 1.15
      : basePose === 'casual_sitting' || basePose === 'deep_squat'
      ? 1.24
      : 1.63;

  // Actual world lens height accounts for pitch orbit around lookTarget when relativeAngles is absent
  const estimatedLensY = Math.max(
    0.08,
    height - 0.11 + Math.sin((pitchDeg * Math.PI) / 180) * 2.8
  );
  const actualLensHeight =
    relativeAngles !== undefined ? relativeAngles.cameraLensHeightMeters : estimatedLensY;

  const camAboveEyes =
    relativeAngles !== undefined
      ? relativeAngles.cameraAboveEyesMeters
      : actualLensHeight - estimatedEyeY;

  const verticalEyeAngleDeg =
    relativeAngles !== undefined
      ? relativeAngles.verticalCameraToEyeAngleDeg
      : (Math.atan2(camAboveEyes, 2.8) * 180) / Math.PI;

  let elevationText = '';
  const isTrueEyeLevel =
    Math.abs(verticalEyeAngleDeg) <= 7.5 && Math.abs(camAboveEyes) <= 0.36 && absPitch <= 8;

  if (isTrueEyeLevel) {
    if (
      basePose === 'casual_sitting' ||
      basePose === 'floor_seated_cross_legged' ||
      basePose === 'grounded_kneeling'
    ) {
      elevationText = `seated eye-level camera placement (${height.toFixed(1)}m height)`;
    } else {
      elevationText = `eye-level camera placement (${height.toFixed(1)}m height)`;
    }
  } else if (actualLensHeight <= 0.45) {
    if (Math.abs(actualLensHeight - height) > 0.25) {
      elevationText = `low ground-level camera placement (lens at ${actualLensHeight.toFixed(2)}m from floor, ${height.toFixed(1)}m height setting)`;
    } else {
      elevationText = `low ground-level camera placement (${height.toFixed(1)}m from floor)`;
    }
  } else if (camAboveEyes < -0.45) {
    if (Math.abs(actualLensHeight - height) > 0.25) {
      elevationText = `low-angle waist/knee-level camera placement positioned below the subject's eye line (lens at ${actualLensHeight.toFixed(2)}m world height, ${height.toFixed(1)}m height setting)`;
    } else {
      elevationText = `low-angle waist/knee-level camera placement positioned below the subject's eye line (${height.toFixed(1)}m height)`;
    }
  } else if (camAboveEyes < -0.18) {
    elevationText = `chest-level camera placement slightly below the subject's eye line (${height.toFixed(1)}m height)`;
  } else if (camAboveEyes <= 0.22) {
    // Near eye height, but camera pitch is tilted (> 8 deg)
    elevationText = `camera positioned near subject eye height (${height.toFixed(1)}m height)`;
  } else if (camAboveEyes <= 0.65) {
    elevationText = `elevated camera placement positioned above the subject's eye line (${height.toFixed(1)}m height)`;
  } else if (actualLensHeight <= 2.4) {
    if (roundedPitch > 3) {
      elevationText = `high-angle elevated camera placement looking down from ${height.toFixed(1)}m height`;
    } else {
      elevationText = `high-angle elevated camera placement positioned well above the subject's eye line (${height.toFixed(1)}m height)`;
    }
  } else {
    elevationText = `overhead bird's-eye camera placement (${height.toFixed(1)}m height)`;
  }

  let pitchText = '';
  if (absPitch <= 3) {
    pitchText = 'level horizontal camera angle (0° pitch)';
  } else if (roundedPitch > 3 && roundedPitch <= 18) {
    pitchText = `subtly angled downward toward subject (${roundedPitch}° downward tilt)`;
  } else if (roundedPitch > 18 && roundedPitch <= 50) {
    pitchText = `angled downward toward subject (${roundedPitch}° high-angle downward tilt)`;
  } else if (roundedPitch > 50) {
    pitchText = `steep overhead downward pitch (${roundedPitch}° bird's-eye angle)`;
  } else if (roundedPitch < -3 && roundedPitch >= -18) {
    pitchText = `angled upward toward subject (${Math.abs(roundedPitch)}° low-angle upward tilt)`;
  } else {
    pitchText = `steep upward worm's-eye tilt (${Math.abs(roundedPitch)}° looking up from low vantage)`;
  }

  return `${elevationText}, ${pitchText}`;
}

export function describeCameraRoll(rollDeg: number): string {
  const r = Math.round(rollDeg);
  if (Math.abs(r) <= 1) {
    return 'level camera roll with zero horizon tilt';
  }
  if (r > 0) {
    return `deliberate Dutch angle tilt rolled ${r}° clockwise`;
  }
  return `deliberate Dutch angle tilt rolled ${Math.abs(r)}° counter-clockwise`;
}

export function describeLensAndFov(focal: LensFocalLength): string {
  switch (focal) {
    case '16mm_ultra_wide':
      return '16mm ultra-wide lens (approx 95° FOV) with deep spatial perspective distortion';
    case '24mm_wide':
      return '24mm wide-angle lens (approx 84° FOV) with broad environmental field of view';
    case '35mm_moderate_wide':
      return '35mm moderate wide lens (approx 63° FOV) with natural environmental reportage perspective';
    case '50mm_standard_normal':
      return '50mm standard normal lens (approx 47° FOV) with true-to-life human eye perspective';
    case '85mm_portrait_telephoto':
      return '85mm portrait telephoto lens (approx 28° FOV) with flattering facial perspective compression';
    case '135mm_telephoto':
      return '135mm telephoto lens (approx 18° FOV) with tight background compression and shallow focal plane';
    default:
      return '50mm standard prime lens';
  }
}

export function describeFraming(framing: ShotFraming): string {
  switch (framing) {
    case 'extreme_close_up':
      return 'extreme close-up framing focused tightly on facial features and eyes';
    case 'close_up_portrait':
      return 'close-up portrait framing capturing the head and collarbone';
    case 'medium_close_up':
      return 'medium close-up framing capturing subject from the chest up';
    case 'medium_shot':
      return 'medium shot framing capturing subject from the waist up';
    case 'three_quarter_shot':
      return 'three-quarter shot framing capturing subject from above the knees up';
    case 'full_shot':
      return 'full-body shot framing capturing the entire subject from head to feet with footroom';
    case 'wide_shot':
      return 'wide shot framing with full subject visible and generous environmental margins';
    default:
      return 'medium shot framing';
  }
}

export function describeComposition(comp: SubjectComposition): string {
  switch (comp) {
    case 'center':
      return 'balanced horizontal camera composition';
    case 'rule_of_thirds_left':
      return 'subject positioned along the left-third vertical axis with open negative space on the right';
    case 'rule_of_thirds_right':
      return 'subject positioned along the right-third vertical axis with open negative space on the left';
    case 'low_frame':
      return 'subject anchored low in the frame with generous headroom above';
    case 'high_frame':
      return 'subject positioned high in the frame with grounded lower space';
    default:
      return 'balanced composition';
  }
}

export function describeDepthOfField(dof: FocusDof): string {
  switch (dof) {
    case 'shallow_f1_4':
      return 'shallow depth of field at f/1.4, razor-sharp focus on subject with smooth background bokeh';
    case 'moderate_f4_0':
      return 'moderate depth of field at f/4.0, subject sharp with gentle natural depth separation';
    case 'deep_f11':
      return 'deep depth of field at f/11, crisp edge-to-edge sharpness across foreground and background';
    default:
      return 'natural depth of field';
  }
}

export function describePlayboardEnvironment(
  environment: PlayboardEnvironment = 'studio_bedroom'
): string {
  switch (environment) {
    case 'minimal_neutral':
      return 'clean minimal neutral studio backdrop with soft seamless cyclorama lighting and subtle floor reflections';
    case 'cyber_grid':
      return 'stylized dark architectural cyber-grid stage with atmospheric neon-indigo rim accents and dark reflective floor';
    case 'studio_bedroom':
    default:
      return 'warm contemporary studio bedroom interior with architectural window light, bed, chair, desk, and natural spatial depth';
  }
}

// ==========================================
// 2. Anatomical Pose & Joint Helpers
// ==========================================

export function describeHandGesture(gesture: HandGesture, side: 'left' | 'right'): string {
  const prefix = side === 'left' ? 'left hand' : 'right hand';
  switch (gesture) {
    case 'relaxed_natural':
      return `${prefix} relaxed with naturally curled fingers`;
    case 'open_palm':
      return `${prefix} open with palm facing outward and fingers extended`;
    case 'wave':
      return `${prefix} raised in a friendly waving gesture with open palm`;
    case 'pointing':
      return `${prefix} with index finger extended pointing forward and other fingers curled`;
    case 'thumbs_up':
      return `${prefix} forming a clear thumbs-up gesture with thumb raised`;
    case 'fist':
      return `${prefix} closed into a firm fist`;
    case 'peace_sign':
      return `${prefix} forming a clean two-finger V / peace sign`;
    case 'hand_on_hip':
      return `${prefix} resting on the hip with fingers placed over waistband`;
    case 'raised_up':
      return `${prefix} raised upward above shoulder height`;
    case 'hands_clasped':
      return `${prefix} clasped together comfortably with fingers intertwined`;
    case 'touching_face':
      return `${prefix} gently resting fingers against chin / jawline in a thoughtful gesture`;
    case 'soft_pinch_gap':
      return `${prefix} forming a soft pinch / C-shape with thumb extended and fingers gently curled, creating a clear empty gap between thumb and fingers`;
    case 'cupped_palm_inward':
      return `${prefix} with palm facing upward or slightly toward viewer, fingers softly curled inward creating a hollow cupped shape with empty space in the palm`;
    default:
      return `${prefix} relaxed`;
  }
}

/**
 * Accurately describes an arm's position based on configured values.
 * Avoids inventing pseudoscientific degrees when the arm is resting naturally.
 */
export function describeArm(
  side: 'left' | 'right',
  fwdDeg: number,
  outDeg: number,
  elbowDeg: number,
  wristDeg: number,
  gesture: HandGesture,
  isWaving: boolean = false,
  basePose: string = 'natural_standing'
): string {
  const name = side === 'left' ? "character's left arm" : "character's right arm";
  const descParts: string[] = [];

  if (side === 'right' && isWaving && gesture !== 'wave') {
    descParts.push('raised high in an active waving motion with elbow bent and hand waving');
    return `${name}: ${descParts.join(', ')}`;
  }

  // Gesture first if specific
  if (gesture === 'hand_on_hip') {
    descParts.push(`hand resting on the hip with elbow bent and flared outward`);
    return `${name}: ${descParts.join(', ')}`;
  }
  if (gesture === 'touching_face') {
    descParts.push(`hand raised touching chin/cheek with bent elbow`);
    return `${name}: ${descParts.join(', ')}`;
  }
  if (gesture === 'hands_clasped') {
    descParts.push(`clasped in front of the body with forearm angled inward`);
    return `${name}: ${descParts.join(', ')}`;
  }
  if (gesture === 'wave') {
    descParts.push(`raised high in an active waving gesture with elbow bent`);
    return `${name}: ${descParts.join(', ')}`;
  }

  const isSupportGesture =
    gesture === 'relaxed_natural' || gesture === 'open_palm' || gesture === 'fist';
  const isQuadrupedPose =
    basePose === 'all_fours_neutral' ||
    basePose === 'cow_pose_arched' ||
    basePose === 'cat_pose_rounded' ||
    basePose === 'all_fours_rear_presentation';

  if (isQuadrupedPose && isSupportGesture) {
    const handContactText =
      gesture === 'fist'
        ? `${side} hand closed into a firm fist supporting weight on the knuckles against the floor`
        : `${side} palm planted flat on the floor supporting upper-body weight`;
    const elbowClause =
      elbowDeg >= 25
        ? `with elbow flexed (${Math.round(elbowDeg)}° bend)`
        : 'with weight-bearing extended elbow';
    descParts.push(
      `planted beneath the shoulder supporting the upper body on the floor ${elbowClause}`,
      handContactText
    );
    if (Math.abs(wristDeg) >= 15) {
      descParts.push(`wrist turned ${Math.round(wristDeg)}°`);
    }
    return `${name}: ${descParts.join(', ')}`;
  }

  if (basePose === 'prone_hip_elevated' && isSupportGesture) {
    descParts.push(
      `forearm and elbow (${Math.round(elbowDeg)}° bend) grounded on the floor supporting the lowered upper chest`,
      gesture === 'fist'
        ? `${side} hand closed into a fist on the floor`
        : `${side} palm resting flat on the floor`
    );
    return `${name}: ${descParts.join(', ')}`;
  }

  if (basePose === 'kneeling_forward_fold' && isSupportGesture) {
    descParts.push(
      `extended forward along the floor in front of the folded torso`,
      gesture === 'fist'
        ? `${side} hand resting in a fist on the floor`
        : `${side} palm resting flat against the floor`
    );
    return `${name}: ${descParts.join(', ')}`;
  }

  if (basePose === 'bent_over_support' && isSupportGesture) {
    descParts.push(
      `angled downward from the forward-bent torso to brace upper-body weight on a support surface`,
      describeHandGesture(gesture, side)
    );
    return `${name}: ${descParts.join(', ')}`;
  }

  // Forward/back extension
  if (fwdDeg >= 55) {
    if (elbowDeg <= 30) {
      descParts.push(`extended forward in front of the body with straightened elbow (${Math.round(fwdDeg)}° elevation)`);
    } else {
      descParts.push(`reaching forward in front of the body (${Math.round(fwdDeg)}° shoulder angle) with elbow bent (${Math.round(elbowDeg)}°)`);
    }
  } else if (fwdDeg >= 25) {
    if (elbowDeg <= 30) {
      descParts.push(`angled forward (${Math.round(fwdDeg)}° shoulder angle) with straightened elbow`);
    } else {
      descParts.push(`angled forward (${Math.round(fwdDeg)}° shoulder angle) with elbow bent (${Math.round(elbowDeg)}°)`);
    }
  } else if (fwdDeg <= -25) {
    descParts.push(`drawn backward behind the torso (${Math.round(Math.abs(fwdDeg))}° angle)`);
  } else {
    // Near 0 forward
    if (outDeg >= 35) {
      descParts.push(`abducted outward away from torso (${Math.round(outDeg)}° abduction)`);
    } else {
      descParts.push('resting alongside the torso');
    }

    if (elbowDeg >= 40) {
      descParts.push(`elbow bent at approx ${Math.round(elbowDeg)}°`);
    } else {
      descParts.push('elbow extended naturally');
    }
  }

  // Hand gesture
  descParts.push(describeHandGesture(gesture, side));

  if (Math.abs(wristDeg) >= 15) {
    descParts.push(`wrist turned ${Math.round(wristDeg)}°`);
  }

  return `${name}: ${descParts.join(', ')}`;
}

/**
 * Accurately describes leg positioning based on base pose and configured angles.
 * Does NOT describe seated legs as "stepped forward", while still honoring manual abduction/knee/foot adjustments.
 */
export function describeLeg(
  side: 'left' | 'right',
  fwdDeg: number,
  outDeg: number,
  kneeDeg: number,
  footDeg: number,
  basePose: string = 'natural_standing'
): string {
  const name = side === 'left' ? "character's left leg" : "character's right leg";
  const extraModifiers: string[] = [];
  if (outDeg >= 18) {
    extraModifiers.push(`thigh angled outward (${Math.round(outDeg)}° abduction)`);
  }
  if (Math.abs(footDeg) >= 12) {
    extraModifiers.push(
      footDeg > 0
        ? `foot angled outward (${Math.round(footDeg)}°)`
        : `foot angled inward (${Math.round(Math.abs(footDeg))}°)`
    );
  }
  const modSuffix = extraModifiers.length > 0 ? `, ${extraModifiers.join(', ')}` : '';

  if (basePose === 'casual_sitting') {
    return `${name}: seated with thigh extended forward horizontally, knee bent at approx ${Math.round(kneeDeg)}° with shin hanging vertically and foot resting naturally on the floor${modSuffix}`;
  }
  if (basePose === 'floor_seated_cross_legged') {
    return `${name}: folded in seated cross-legged position on the floor with knee bent outward (${Math.round(kneeDeg)}° bend)${modSuffix}`;
  }
  if (basePose === 'grounded_kneeling') {
    return `${name}: grounded kneeling position with knee bent (${Math.round(kneeDeg)}°) against the floor${modSuffix}`;
  }
  if (basePose === 'deep_squat') {
    return `${name}: deep athletic squat with thigh horizontal, knee deeply flexed at ${Math.round(kneeDeg)}°, and foot planted${modSuffix}`;
  }
  if (basePose === 'reclined_lying') {
    const kneeClause =
      kneeDeg >= 25 ? ` with knee bent at ${Math.round(kneeDeg)}°` : ' with knee relaxed';
    return `${name}: extended comfortably in a reclined resting position${kneeClause}${modSuffix}`;
  }
  if (
    basePose === 'all_fours_neutral' ||
    basePose === 'cow_pose_arched' ||
    basePose === 'cat_pose_rounded' ||
    basePose === 'all_fours_rear_presentation'
  ) {
    return `${name}: bent at hip and knee with lower leg and knee grounded on the floor in an all-fours tabletop stance${modSuffix}`;
  }
  if (basePose === 'kneeling_forward_fold') {
    return `${name}: folded beneath the hips with shin and foot grounded on the floor${modSuffix}`;
  }
  if (basePose === 'prone_hip_elevated') {
    return `${name}: extended rearward in a prone stomach-down posture with hip slightly elevated${modSuffix}`;
  }
  if (basePose === 'bent_over_support') {
    return `${name}: grounded straight supporting the forward-bent torso${modSuffix}`;
  }
  if (basePose === 'side_lying_open') {
    return `${name}: positioned in a side-lying posture with leg bent and open${modSuffix}`;
  }

  // Standing / walking postures
  const descParts: string[] = [];
  if (fwdDeg >= 20) {
    descParts.push(`stepped forward (${Math.round(fwdDeg)}° hip angle)`);
  } else if (fwdDeg <= -20) {
    descParts.push(`extended backward behind body (${Math.round(Math.abs(fwdDeg))}° hip angle)`);
  } else {
    descParts.push('aligned beneath the hips supporting body weight');
  }

  if (outDeg >= 18) {
    descParts.push(`widened stance (${Math.round(outDeg)}° outward abduction)`);
  }

  if (kneeDeg >= 25) {
    descParts.push(`knee flexed at ${Math.round(kneeDeg)}° bend`);
  } else {
    descParts.push('knee straight');
  }

  if (Math.abs(footDeg) >= 12) {
    descParts.push(
      footDeg > 0
        ? `foot angled outward (${Math.round(footDeg)}°)`
        : `foot angled inward (${Math.round(Math.abs(footDeg))}°)`
    );
  }

  return `${name}: ${descParts.join(', ')}`;
}

export function describeTorso(
  pose: CharacterPose3DSettings,
  relativeAngles?: RelativeCameraSubjectAngles
): string {
  const parts: string[] = [];

  const bodyYaw = Math.round(normalizeAngleDeg(pose.characterYawDeg ?? 0));
  if (Math.abs(bodyYaw) >= 165) {
    parts.push(`whole body turned ${Math.abs(bodyYaw)}° around facing away from default front`);
  } else if (Math.abs(bodyYaw) >= 5) {
    const relYaw = relativeAngles ? Math.round(relativeAngles.relativeToBodyYawDeg) : -bodyYaw;
    const sideSuffix =
      Math.abs(relYaw) <= 15
        ? 'relative to the studio stage while aligned with the camera axis'
        : bodyYaw < 0
        ? "exposing the subject's right side"
        : "exposing the subject's left side";
    parts.push(
      bodyYaw < 0
        ? `whole body oriented ${Math.abs(bodyYaw)}° clockwise ${sideSuffix}`
        : `whole body oriented ${bodyYaw}° counter-clockwise ${sideSuffix}`
    );
  }

  if (pose.isWalking) {
    parts.push('captured mid-stride in an active walking gait');
  }

  if (Math.abs(pose.torsoLeanDeg) >= 4) {
    parts.push(
      pose.torsoLeanDeg > 0
        ? `torso leaning forward ${Math.round(pose.torsoLeanDeg)}°`
        : `torso leaning backward ${Math.round(Math.abs(pose.torsoLeanDeg))}°`
    );
  } else {
    parts.push('torso upright with poised posture');
  }

  if (Math.abs(pose.torsoTwistDeg) >= 4) {
    parts.push(
      pose.torsoTwistDeg > 0
        ? `torso rotated ${Math.round(pose.torsoTwistDeg)}° to character's right`
        : `torso rotated ${Math.round(Math.abs(pose.torsoTwistDeg))}° to character's left`
    );
  }

  if (Math.abs(pose.torsoTiltDeg) >= 4) {
    parts.push(
      pose.torsoTiltDeg > 0
        ? `torso laterally tilted ${Math.round(pose.torsoTiltDeg)}° to character's right side`
        : `torso laterally tilted ${Math.round(Math.abs(pose.torsoTiltDeg))}° to character's left side`
    );
  }

  return parts.join(', ');
}

export function describeHead(
  pose: CharacterPose3DSettings,
  relativeAngles?: RelativeCameraSubjectAngles
): string {
  const parts: string[] = [];
  const rot = Math.round(pose.headRotationDeg);
  const tilt = Math.round(pose.headTiltDeg);

  if (Math.abs(rot) <= 4) {
    parts.push('head facing forward relative to torso');
  } else if (rot > 4) {
    parts.push(`head turned sideways ${rot}° toward character's right`);
  } else {
    parts.push(`head turned sideways ${Math.abs(rot)}° toward character's left`);
  }

  if (Math.abs(tilt) >= 4) {
    parts.push(
      tilt > 0
        ? `tilted upward ${tilt}°`
        : `tilted downward ${Math.abs(tilt)}°`
    );
  }

  if (relativeAngles) {
    const headToCamYaw = relativeAngles.headLocalCameraYawDeg;
    const absHeadToCamYaw = Math.abs(headToCamYaw);
    if (absHeadToCamYaw <= 14) {
      parts.push('face oriented toward the camera viewpoint');
    } else if (absHeadToCamYaw <= 65) {
      parts.push('face seen at a three-quarter angle relative to the camera');
    } else if (absHeadToCamYaw <= 115) {
      parts.push('face seen in side profile relative to the camera');
    } else {
      parts.push('head facing away from the camera');
    }

    const vertAngle = relativeAngles.verticalCameraToEyeAngleDeg;
    if (vertAngle <= -10) {
      parts.push(
        `camera views the face from below eye level (${Math.round(Math.abs(vertAngle))}° below the subject's eyes)`
      );
    } else if (vertAngle >= 10) {
      parts.push(
        `camera views the face from above eye level (${Math.round(vertAngle)}° above the subject's eyes)`
      );
    }
  }

  return parts.join(', ');
}

/**
 * Evaluates 3D head facing direction and eye-socket gaze relative to the camera lens in both
 * horizontal (yaw) and vertical (pitch) axes.
 *
 * Key guarantees:
 * 1. Explicit off-camera gaze presets (`looking_upward`, `looking_downward`, `looking_camera_left`,
 *    `looking_camera_right`, `soft_off_camera`, `eyes_closed`) are always respected and never
 *    claim direct lens contact.
 * 2. When `pose.gaze === 'direct_at_camera'`:
 *    - Horizontally aligned + vertically near eye-level -> direct eye contact with the camera lens.
 *    - Horizontally aligned + low-angle camera below eyes -> explicitly specifies downward eye gaze
 *      (or downward head tilt alignment) toward the lower camera lens.
 *    - Horizontally aligned + high-angle camera above eyes -> explicitly specifies upward eye gaze
 *      (or upward head tilt alignment) toward the elevated camera lens.
 *    - Moderately turned head (`14° < |headLocalCameraYawDeg| <= 50°`) within anatomical eye-rotation
 *      range -> explicitly distinguishes that the face is angled away while the eyes use eye-only
 *      compensation to maintain direct eye contact with the camera lens.
 *    - Head turned beyond anatomical eye-rotation limits (`> 50°` yaw or `> 48°` vertical pitch) ->
 *      never claims direct eye contact; explicitly states `no direct eye contact with the camera lens`.
 */
export function describeGazeAndEyeContact(
  pose: CharacterPose3DSettings,
  cameraYawDeg: number,
  relativeAngles?: RelativeCameraSubjectAngles,
  cameraPitchDeg: number = 0,
  cameraHeight: number = 1.4,
  cameraDistance: number = 3.0
): string {
  // 1. Respect explicit non-camera gaze presets first (never override user's explicit off-camera choice)
  if (pose.gaze === 'eyes_closed') {
    return 'eyes gently closed in a serene, calm expression';
  }
  if (pose.gaze === 'looking_upward') {
    return 'gaze directed upward in a contemplative, aspirational look (no direct eye contact with the camera lens)';
  }
  if (pose.gaze === 'looking_downward') {
    return 'gaze cast downward toward the ground (no direct eye contact with the camera lens)';
  }
  if (pose.gaze === 'looking_camera_left') {
    return 'gaze directed off-camera toward the left (no direct eye contact with the camera lens)';
  }
  if (pose.gaze === 'looking_camera_right') {
    return 'gaze directed off-camera toward the right (no direct eye contact with the camera lens)';
  }
  if (pose.gaze === 'soft_off_camera') {
    return 'soft, natural gaze looking slightly off-axis from the camera line (no direct eye contact with the camera lens)';
  }

  // 2. Ensure we have full 3D relative angles (including vertical camera-to-eye geometry)
  const resolvedAngles: RelativeCameraSubjectAngles =
    relativeAngles ??
    analyzePlayboardFraming(
      {
        yawDeg: cameraYawDeg,
        pitchDeg: cameraPitchDeg,
        height: cameraHeight,
        distance: cameraDistance,
        rollDeg: 0,
        focalLength: '50mm_standard_normal',
        framing: 'medium_shot',
        composition: 'center',
        outputRatio: '3:4',
        orientation: 'Portrait',
        focusDof: 'shallow_f1_4',
      },
      pose
    ).relativeAngles;

  const headYawToCam = resolvedAngles.headLocalCameraYawDeg;
  const absYaw = Math.abs(headYawToCam);
  const headPitchToCam = resolvedAngles.headLocalCameraPitchDeg;
  const absPitchToCam = Math.abs(headPitchToCam);
  const vertEyeAngle = resolvedAngles.verticalCameraToEyeAngleDeg;
  const absVertEye = Math.abs(vertEyeAngle);
  const gazeSol = resolvedAngles.gazeSolution;
  const isHeadTurnedSideways = Math.abs(pose.headRotationDeg) >= 20;

  // 3. Evaluate 'direct_at_camera' in full 3D (horizontal + vertical)
  const canReachHorizontally = absYaw <= 32;
  const canReachVertically = absPitchToCam <= 44;

  if (canReachHorizontally && canReachVertically && gazeSol.canAchieveDirectLensContact) {
    // Case A: Face is horizontally aligned toward the camera (within ±14°)
    if (absYaw <= 14) {
      const turnPrefix = isHeadTurnedSideways
        ? `head turned toward ${pose.headRotationDeg > 0 ? "character's right" : "character's left"} to face the camera horizontally, with `
        : '';

      // Subcase A1: Camera is vertically near eye level in world space (|vertEyeAngle| <= 7.5°)
      if (absVertEye <= 7.5) {
        if (absPitchToCam <= 7.5) {
          if (isHeadTurnedSideways) {
            const dirLabel = pose.headRotationDeg > 0 ? "character's right" : "character's left";
            return `head turned toward ${dirLabel} to face the camera lens with direct eye contact`;
          }
          return 'face and eyes directed straight into the camera lens with engaging direct eye contact';
        }
        // Camera is at eye level, but head is tilted up or down, so eyes compensate vertically
        const eyeDeg = Math.max(4, Math.round(Math.abs(gazeSol.eyePitchDeg)));
        if (headPitchToCam < -7.5) {
          return `${turnPrefix}head tilted upward while eyes angle downward (${eyeDeg}° downward eye gaze) to maintain direct eye contact with the eye-level camera lens`;
        }
        return `${turnPrefix}head tilted downward while eyes angle upward (${eyeDeg}° upward eye gaze) to maintain direct eye contact with the eye-level camera lens`;
      }

      // Subcase A2: Camera is below the subject's eyes in world space (vertEyeAngle < -7.5°)
      if (vertEyeAngle < -7.5) {
        const camBelowDeg = Math.max(4, Math.round(absVertEye));
        if (absPitchToCam <= 7.5 && pose.headTiltDeg < -4) {
          return `${turnPrefix}head tilted downward (${Math.abs(Math.round(pose.headTiltDeg))}°) aligning the face and eyes directly with the low-angle camera lens (${camBelowDeg}° below eye level) for direct downward eye contact`;
        }
        const downDeg = Math.max(4, Math.round(Math.abs(gazeSol.eyePitchDeg)));
        return `${turnPrefix}eyes angled downward (${downDeg}° downward eye gaze with natural upper-eyelid follow) looking down into the low-angle camera lens positioned ${camBelowDeg}° below the subject's eye line to maintain direct eye contact`;
      }

      // Subcase A3: Camera is above the subject's eyes in world space (vertEyeAngle > 7.5°)
      const camAboveDeg = Math.max(4, Math.round(absVertEye));
      if (absPitchToCam <= 7.5 && (pose.headTiltDeg > 4 || pose.basePose === 'reclined_lying')) {
        return `${turnPrefix}face and eyes aligned upward toward the elevated camera lens (${camAboveDeg}° above eye level) for direct upward eye contact`;
      }
      const eyeVertDeg = Math.max(4, Math.round(Math.abs(gazeSol.eyePitchDeg)));
      if (headPitchToCam < -7.5 && pose.basePose === 'reclined_lying') {
        return `${turnPrefix}reclined gaze directed toward the elevated high-angle camera lens positioned ${camAboveDeg}° above the subject's eye line (${eyeVertDeg}° eye-socket adjustment) to maintain direct eye contact`;
      }
      return `${turnPrefix}eyes angled upward (${eyeVertDeg}° upward eye gaze) looking up into the elevated high-angle camera lens positioned ${camAboveDeg}° above the subject's eye line to maintain direct eye contact`;
    }

    // Case B: Face is angled 14°–50° away from the camera horizontally, requiring eye-only lateral compensation
    const eyeHorizontalDir = headYawToCam > 0 ? "character's right" : "character's left";
    const eyeYawDeg = Math.max(8, Math.round(Math.abs(gazeSol.eyeYawDeg)));
    let verticalCompClause = '';
    if (headPitchToCam < -7.5) {
      verticalCompClause = ` and downward ${Math.max(4, Math.round(Math.abs(gazeSol.eyePitchDeg)))}° toward the lower lens`;
    } else if (headPitchToCam > 7.5) {
      verticalCompClause = ` and upward ${Math.max(4, Math.round(Math.abs(gazeSol.eyePitchDeg)))}° toward the elevated lens`;
    }
    return `face angled ${Math.round(absYaw)}° away from the camera while the eyes use eye-only compensation (glancing ${eyeYawDeg}° sideways toward ${eyeHorizontalDir}${verticalCompClause}) to maintain direct eye contact with the camera lens`;
  }

  // 4. Beyond anatomical eye-rotation limits: direct eye contact is physically impossible
  if (Math.abs(pose.headRotationDeg) >= 25) {
    const dirLabel = pose.headRotationDeg > 0 ? "character's right" : "character's left";
    return `head is turned sideways toward ${dirLabel} (${Math.round(absYaw)}° off-axis from the camera lens, beyond anatomical eye-turn limits) with gaze directed off-camera along the head direction (no direct eye contact with the camera lens)`;
  }

  if (Math.abs(pose.headRotationDeg) > 4) {
    const dirLabel = pose.headRotationDeg > 0 ? "character's right" : "character's left";
    return `head is turned toward ${dirLabel} (${Math.round(absYaw)}° away from the camera lens, beyond anatomical eye-turn limits) with gaze directed off-camera (no direct eye contact with the camera lens)`;
  }

  if (!canReachVertically) {
    const vertDir = headPitchToCam < 0 ? 'below' : 'above';
    return `camera is positioned at an extreme vertical angle (${Math.round(absVertEye)}° ${vertDir} the subject's eye line, beyond anatomical vertical eye-turn limits) while the head faces forward (no direct eye contact with the camera lens)`;
  }

  return `gaze directed forward along the subject's head facing direction, angled ${Math.round(absYaw)}° away from the camera lens (no direct eye contact with the camera lens)`;
}

export function describeExpression(expr: FacialExpression): string {
  switch (expr) {
    case 'neutral_relaxed':
      return 'neutral, relaxed facial expression with soft mouth and calm brow';
    case 'gentle_smile':
      return 'subtle, warm and gentle genuine smile with relaxed facial muscles';
    case 'confident_focused':
      return 'confident, sharp and focused expression with determined presence';
    case 'thoughtful_pensive':
      return 'thoughtful, pensive and introspective facial expression';
    case 'serious_editorial':
      return 'serious, high-fashion editorial intensity with composed features';
    case 'expressive_laugh':
      return 'candid joyful expression with a radiant, open smile';
    case 'determined_intense':
      return 'resolute and determined expression with strong presence';
    case 'open_mouth_shock':
      return 'mouth wide open in clear shock or surprise, eyes wide';
    case 'intense_open_mouth':
      return 'mouth wide open showing teeth and tongue, intense and forceful expression';
    case 'gasping_open':
      return 'mouth openly gasping, soft but clearly open expression';
    default:
      return 'natural relaxed expression';
  }
}

// ==========================================
// 3. TEXT-TO-IMAGE (T2I) COMPILER
// ==========================================

export function buildPlayboardT2IPrompt(
  config: PlayboardFullConfig,
  targetModel: TargetModelType = 'universal'
): string {
  const { camera, pose } = config;
  const framingAnalysis = analyzePlayboardFraming(camera, pose);
  const effectiveCamYaw = framingAnalysis.relativeAngles.relativeToBodyYawDeg;
  const sceneInteraction = evaluateActiveSceneInteraction(pose, config.environment);
  const actualRatio = framingAnalysis.parsedAspectRatio.ratioString;
  const environmentDesc = describePlayboardEnvironment(config.environment);

  const cameraParts = [
    `Photographic capture from a ${describeCameraHorizontal(effectiveCamYaw)}`,
    describeCameraElevation(camera.pitchDeg, camera.height, pose.basePose, framingAnalysis.relativeAngles),
    describeCameraRoll(camera.rollDeg),
    describeLensAndFov(camera.focalLength),
    framingAnalysis.shotSizeDescription,
    framingAnalysis.croppingDescription,
    framingAnalysis.placementDescription,
    describeComposition(camera.composition),
    describeDepthOfField(camera.focusDof),
    `framed in ${framingAnalysis.aspectRatioDescription}`,
  ];

  const torsoSummary = describeTorso(pose, framingAnalysis.relativeAngles);
  let poseStanceSummary = '';
  if (sceneInteraction.hasActiveInteraction) {
    poseStanceSummary = `Subject is ${sceneInteraction.surfaceDescription}. ${torsoSummary}.`;
  } else if (pose.basePose === 'casual_sitting') {
    poseStanceSummary = `Subject is seated in a relaxed seated position (seated posture with thighs resting horizontally forward and knees bent). ${torsoSummary}.`;
  } else if (pose.basePose === 'floor_seated_cross_legged') {
    poseStanceSummary = `Subject is seated cross-legged on the floor. ${torsoSummary}.`;
  } else if (pose.basePose === 'all_fours_neutral') {
    poseStanceSummary = `Subject is on all fours in a neutral tabletop position, hands under shoulders, knees under hips, spine neutral. ${torsoSummary}.`;
  } else if (pose.basePose === 'cow_pose_arched') {
    poseStanceSummary = `Subject is on all fours in cow pose, chest dropped low, belly toward the floor, deep lumbar arch, head lifted. ${torsoSummary}.`;
  } else if (pose.basePose === 'cat_pose_rounded') {
    poseStanceSummary = `Subject is on all fours in cat pose, spine strongly rounded, head tucked downward. ${torsoSummary}.`;
  } else if (pose.basePose === 'all_fours_rear_presentation') {
    poseStanceSummary = `Subject is on all fours with hips pushed back and elevated, chest lower than hips, weight shifted rearward. ${torsoSummary}.`;
  } else if (pose.basePose === 'prone_hip_elevated') {
    poseStanceSummary = `Subject is lying prone on the stomach with hips slightly elevated. ${torsoSummary}.`;
  } else if (pose.basePose === 'kneeling_forward_fold') {
    poseStanceSummary = `Subject is kneeling with torso folded forward over the thighs. ${torsoSummary}.`;
  } else if (pose.basePose === 'bent_over_support') {
    poseStanceSummary = `Subject is bent forward at the waist with hands supporting on a surface. ${torsoSummary}.`;
  } else if (pose.basePose === 'side_lying_open') {
    poseStanceSummary = `Subject is lying on one side with the top leg bent or opened. ${torsoSummary}.`;
  } else {
    poseStanceSummary = `Subject posed in ${pose.basePose.replace(/_/g, ' ')} stance. ${torsoSummary}.`;
  }

  // Combined arms description if both arms are extended forward in non-floor-supported poses
  const isFloorSupportedArmPose =
    pose.basePose === 'all_fours_neutral' ||
    pose.basePose === 'cow_pose_arched' ||
    pose.basePose === 'cat_pose_rounded' ||
    pose.basePose === 'all_fours_rear_presentation' ||
    pose.basePose === 'prone_hip_elevated' ||
    pose.basePose === 'kneeling_forward_fold' ||
    pose.basePose === 'bent_over_support';

  let armsDesc = '';
  if (
    !isFloorSupportedArmPose &&
    pose.leftArmShoulderForwardDeg >= 45 &&
    pose.rightArmShoulderForwardDeg >= 45 &&
    pose.leftArmElbowBendDeg <= 35 &&
    pose.rightArmElbowBendDeg <= 35 &&
    !pose.isWaving
  ) {
    armsDesc = `Both arms are extended straight forward in front of the body with straightened elbows, ${describeHandGesture(pose.leftHandGesture, 'left')}, and ${describeHandGesture(pose.rightHandGesture, 'right')}.`;
  } else {
    const leftArmDesc = describeArm(
      'left',
      pose.leftArmShoulderForwardDeg,
      pose.leftArmShoulderOutDeg,
      pose.leftArmElbowBendDeg,
      pose.leftArmWristDeg,
      pose.leftHandGesture,
      pose.isWaving,
      pose.basePose
    );
    const rightArmDesc = describeArm(
      'right',
      pose.rightArmShoulderForwardDeg,
      pose.rightArmShoulderOutDeg,
      pose.rightArmElbowBendDeg,
      pose.rightArmWristDeg,
      pose.rightHandGesture,
      pose.isWaving,
      pose.basePose
    );
    armsDesc = `${leftArmDesc}. ${rightArmDesc}.`;
  }

  const leftLegDesc = describeLeg(
    'left',
    pose.leftLegHipForwardDeg,
    pose.leftLegHipOutDeg,
    pose.leftLegKneeBendDeg,
    pose.leftFootAngleDeg,
    pose.basePose
  );
  const rightLegDesc = describeLeg(
    'right',
    pose.rightLegHipForwardDeg,
    pose.rightLegHipOutDeg,
    pose.rightLegKneeBendDeg,
    pose.rightFootAngleDeg,
    pose.basePose
  );
  const gazeText = describeGazeAndEyeContact(
    pose,
    camera.yawDeg,
    framingAnalysis.relativeAngles,
    camera.pitchDeg,
    camera.height,
    camera.distance
  );
  const headDesc = `${describeHead(pose, framingAnalysis.relativeAngles)}. Gaze and eye direction: ${gazeText}. Facial expression: ${describeExpression(pose.expression)}.`;

  let prompt = '';

  if (targetModel === 'flux') {
    prompt = [
      `A high-end editorial photograph set in a ${environmentDesc}.`,
      `Camera viewpoint and perspective: ${cameraParts.join(', ')}.`,
      `Subject stance and body pose: ${poseStanceSummary} ${armsDesc} ${leftLegDesc}. ${rightLegDesc}.`,
      `Head and gaze: ${headDesc}`,
      `Crisp focus, realistic skin textures, physically accurate anatomical geometry, natural fabric drape.`,
      `--ar ${actualRatio.replace(':', ':')}`,
    ].join(' ');
  } else if (targetModel === 'chatgpt') {
    prompt = [
      `Generate a photographic image with the following strict camera, environment, and posing specifications:`,
      `1. Camera Viewpoint & Angle: ${cameraParts.join('; ')}.`,
      `2. Character Stance & Body Pose: ${poseStanceSummary}`,
      `3. Arms and Hands: ${armsDesc}`,
      `4. Legs and Feet: ${leftLegDesc}. ${rightLegDesc}.`,
      `5. Facial Direction & Gaze: ${headDesc}`,
      `6. Environment & Stage Setting: ${environmentDesc}.`,
      `7. Aspect Ratio: ${actualRatio} (${framingAnalysis.parsedAspectRatio.orientationDescriptor}).`,
      `Do not add extra stylized graphics, maintain natural human anatomy and photographic lighting realism.`,
    ].join('\n\n');
  } else if (targetModel === 'gemini') {
    prompt = [
      `Professional photographic image adhering precisely to these viewpoint, environment, and anatomical parameters:`,
      `[Camera Configuration]: ${cameraParts.join(', ')}. Aspect ratio ${actualRatio} (${framingAnalysis.parsedAspectRatio.orientationDescriptor}).`,
      `[Character Pose]: ${poseStanceSummary}`,
      `[Arms & Hands]: ${armsDesc}`,
      `[Lower Body & Legs]: ${leftLegDesc}. ${rightLegDesc}`,
      `[Head & Gaze]: ${headDesc}`,
      `[Environment & Lighting]: ${environmentDesc}.`,
      `Maintain photographic authenticity with natural depth and realistic spatial perspective.`,
    ].join('\n');
  } else {
    // Universal
    prompt = [
      `Professional photograph, ${framingAnalysis.shotSizeDescription}, ${describeCameraHorizontal(effectiveCamYaw)}, ${describeCameraElevation(camera.pitchDeg, camera.height, pose.basePose, framingAnalysis.relativeAngles)}.`,
      `Visible frame composition: ${framingAnalysis.croppingDescription}, ${framingAnalysis.placementDescription}.`,
      `${describeLensAndFov(camera.focalLength)}, ${describeDepthOfField(camera.focusDof)}, ${describeComposition(camera.composition)}, ${describeCameraRoll(camera.rollDeg)}.`,
      `Subject pose: ${poseStanceSummary} ${armsDesc} ${leftLegDesc}. ${rightLegDesc}.`,
      `${headDesc}`,
      `Scene environment: ${environmentDesc}.`,
      `Aspect ratio: ${actualRatio} (${framingAnalysis.parsedAspectRatio.orientationDescriptor}). Realistic photographic rendering, accurate anatomical proportions, zero artificial distortion.`,
    ].join(' ');
  }

  return prompt.trim();
}

// ==========================================
// 4. IMAGE-TO-IMAGE (I2I) FIELD GENERATOR
// ==========================================

export function buildInitialI2IFields(
  config: PlayboardFullConfig,
  scope: I2ITransformationScope = 'both'
): I2IEditableField[] {
  const { camera, pose } = config;
  const framingAnalysis = analyzePlayboardFraming(camera, pose);
  const effectiveCamYaw = framingAnalysis.relativeAngles.relativeToBodyYawDeg;
  const sceneInteraction = evaluateActiveSceneInteraction(pose, config.environment);
  const actualRatio = framingAnalysis.parsedAspectRatio.ratioString;
  const environmentDesc = describePlayboardEnvironment(config.environment);
  const replaceEnv = config.preserveEnvironment === false;

  const gazeText = describeGazeAndEyeContact(
    pose,
    camera.yawDeg,
    framingAnalysis.relativeAngles,
    camera.pitchDeg,
    camera.height,
    camera.distance
  );

  const cameraFramingParts = [
    `Reposition camera viewpoint to a ${describeCameraHorizontal(effectiveCamYaw)}.`,
    `Camera elevation: ${describeCameraElevation(camera.pitchDeg, camera.height, pose.basePose, framingAnalysis.relativeAngles)}.`,
    `Camera roll: ${describeCameraRoll(camera.rollDeg)}.`,
    `Optical characteristics: ${describeLensAndFov(camera.focalLength)}.`,
    `Dynamic shot framing: ${framingAnalysis.shotSizeDescription} (${framingAnalysis.croppingDescription}).`,
    `Subject placement: ${framingAnalysis.placementDescription} with ${describeComposition(camera.composition)}.`,
    `Depth of field: ${describeDepthOfField(camera.focusDof)}.`,
    `Output aspect ratio: ${actualRatio} (${framingAnalysis.parsedAspectRatio.orientationDescriptor}).`,
  ];

  if (scope === 'camera_only') {
    cameraFramingParts.push(
      `Camera-relative gaze alignment: preserve the subject's existing head and body pose while ${gazeText}.`
    );
  }

  const cameraFramingText = cameraFramingParts.join(' ');

  const torsoSummary = describeTorso(pose, framingAnalysis.relativeAngles);
  let torsoText = '';
  if (sceneInteraction.hasActiveInteraction) {
    torsoText = `${sceneInteraction.i2iActionDescription} so the subject is ${sceneInteraction.surfaceDescription}. ${torsoSummary}.`;
  } else if (pose.basePose === 'casual_sitting') {
    torsoText = `Re-orient the subject into a seated posture with hips lowered and thighs resting horizontally forward. ${torsoSummary}.`;
  } else if (pose.basePose === 'floor_seated_cross_legged') {
    torsoText = `Re-orient the subject into a floor-seated cross-legged posture. ${torsoSummary}.`;
  } else if (pose.basePose === 'all_fours_neutral') {
    torsoText = `Re-orient the subject on all fours in a neutral tabletop position, hands under shoulders, knees under hips, spine neutral. ${torsoSummary}.`;
  } else if (pose.basePose === 'cow_pose_arched') {
    torsoText = `Re-orient the subject on all fours in cow pose, chest dropped low, belly toward the floor, deep lumbar arch, head lifted. ${torsoSummary}.`;
  } else if (pose.basePose === 'cat_pose_rounded') {
    torsoText = `Re-orient the subject on all fours in cat pose, spine strongly rounded, head tucked downward. ${torsoSummary}.`;
  } else if (pose.basePose === 'all_fours_rear_presentation') {
    torsoText = `Re-orient the subject on all fours with hips pushed back and elevated, chest lower than hips, weight shifted rearward. ${torsoSummary}.`;
  } else if (pose.basePose === 'prone_hip_elevated') {
    torsoText = `Re-orient the subject lying prone on the stomach with hips slightly elevated. ${torsoSummary}.`;
  } else if (pose.basePose === 'kneeling_forward_fold') {
    torsoText = `Re-orient the subject kneeling with torso folded forward over the thighs. ${torsoSummary}.`;
  } else if (pose.basePose === 'bent_over_support') {
    torsoText = `Re-orient the subject bent forward at the waist with hands supporting on a surface. ${torsoSummary}.`;
  } else if (pose.basePose === 'side_lying_open') {
    torsoText = `Re-orient the subject lying on one side with the top leg bent or opened. ${torsoSummary}.`;
  } else {
    torsoText = `Re-orient body pose into a ${pose.basePose.replace(/_/g, ' ')} stance. ${torsoSummary}.`;
  }

  // Both arms extended forward special phrasing (only for non-floor-supported poses) or individual arm descriptions
  const isFloorSupportedArmPose =
    pose.basePose === 'all_fours_neutral' ||
    pose.basePose === 'cow_pose_arched' ||
    pose.basePose === 'cat_pose_rounded' ||
    pose.basePose === 'all_fours_rear_presentation' ||
    pose.basePose === 'prone_hip_elevated' ||
    pose.basePose === 'kneeling_forward_fold' ||
    pose.basePose === 'bent_over_support';

  let armsText = '';
  if (
    !isFloorSupportedArmPose &&
    pose.leftArmShoulderForwardDeg >= 45 &&
    pose.rightArmShoulderForwardDeg >= 45 &&
    pose.leftArmElbowBendDeg <= 35 &&
    pose.rightArmElbowBendDeg <= 35 &&
    !pose.isWaving
  ) {
    armsText = `Both arms extended forward in front of the body with straightened elbows (${Math.round(pose.leftArmShoulderForwardDeg)}° forward angle). ${describeHandGesture(pose.leftHandGesture, 'left')}. ${describeHandGesture(pose.rightHandGesture, 'right')}.`;
  } else {
    armsText = `${describeArm(
      'left',
      pose.leftArmShoulderForwardDeg,
      pose.leftArmShoulderOutDeg,
      pose.leftArmElbowBendDeg,
      pose.leftArmWristDeg,
      pose.leftHandGesture,
      pose.isWaving,
      pose.basePose
    )}. ${describeArm(
      'right',
      pose.rightArmShoulderForwardDeg,
      pose.rightArmShoulderOutDeg,
      pose.rightArmElbowBendDeg,
      pose.rightArmWristDeg,
      pose.rightHandGesture,
      pose.isWaving,
      pose.basePose
    )}.`;
  }

  const legsText = `${describeLeg(
    'left',
    pose.leftLegHipForwardDeg,
    pose.leftLegHipOutDeg,
    pose.leftLegKneeBendDeg,
    pose.leftFootAngleDeg,
    pose.basePose
  )}. ${describeLeg(
    'right',
    pose.rightLegHipForwardDeg,
    pose.rightLegHipOutDeg,
    pose.rightLegKneeBendDeg,
    pose.rightFootAngleDeg,
    pose.basePose
  )}.`;

  const headGazeText = `${describeHead(pose, framingAnalysis.relativeAngles)}. Gaze and eye direction: ${gazeText}. Facial expression: ${describeExpression(pose.expression)}.`;

  const identityText =
    scope === 'camera_only'
      ? 'Keep the original subject’s facial identity, skin tone, hair texture, hairstyle, recognizable facial features, age, body proportions, personal appearance, and existing body pose unchanged from the provided original image, adjusting only the camera viewing angle and framing to match the specified configuration.'
      : scope === 'pose_only'
      ? 'Keep the original subject’s facial identity, skin tone, hair texture, hairstyle, recognizable facial features, age, body proportions, and personal appearance unchanged from the provided original image, adjusting only the subject’s posture, limb articulation, head direction, gaze, and expression to match the specified configuration.'
      : 'Keep the original subject’s facial identity, skin tone, hair texture, hairstyle, recognizable facial features, age, body proportions, and personal appearance unchanged from the provided original image, adjusting the camera viewing angle, framing, body pose, head direction, gaze, and expression to match the specified configuration.';

  const envResolution = resolveEnvironmentTransformationPolicy(config, scope);
  const isSourceInspired = envResolution.effectiveMode === 'source_inspired_transformation';
  const isExplicitReplace =
    config.preserveEnvironment === false || config.environmentPolicy === 'replace_environment';

  const envClause = isExplicitReplace
    ? `Transition the surrounding stage environment to a ${environmentDesc}, while preserving the original clothing garments, outfit fabric, and colors`
    : isSourceInspired
    ? `Preserve the original clothing garments, outfit fabric and colors, and use the source image as the visual reference for lighting character, tonal balance, shadow softness, color grading, skin appearance, and photographic texture without forcing retention of incompatible original room furniture`
    : `Preserve the original clothing garments, outfit fabric and colors, environment, background setting (${environmentDesc} staging context), and existing ambient lighting style from the original image`;

  let scenePreservationText = '';
  if (scope === 'camera_only') {
    scenePreservationText = `${envClause}, keeping the subject pose intact while adjusting perspective, shadows, and occlusions to naturally accommodate the new camera angle and framing specified above.`;
  } else if (sceneInteraction.hasActiveInteraction) {
    const targetSurface = sceneInteraction.preset?.furnitureTarget || 'furniture';
    // Active furniture/object interaction: authorize the required support surface and source-inspired visual continuity
    if (scope === 'pose_only') {
      scenePreservationText = `Preserve the original camera viewpoint, framing, clothing garments, outfit fabric and colors, and existing ambient lighting style from the original image, while naturally integrating or aligning the required ${targetSurface} support surface (${sceneInteraction.surfaceDescription}) and using the source image as the visual reference for lighting character, tonal balance, shadow softness, color grading, skin appearance, and photographic texture without forcing retention of incompatible original room furniture, adjusting limb placement, drapery, shadows, and occlusions to accommodate the interactive pose specified above.`;
    } else if (isExplicitReplace) {
      scenePreservationText = `${envClause}, while naturally integrating or aligning the required ${targetSurface} support surface (${sceneInteraction.surfaceDescription}) and adjusting perspective, limb placement, contact shadows, and occlusions to accommodate the new camera angle and interactive pose specified above.`;
    } else {
      scenePreservationText = `${envClause}, while naturally integrating or aligning the required ${targetSurface} support surface (${sceneInteraction.surfaceDescription}) in a source-inspired ${environmentDesc} setting and adjusting perspective, limb placement, contact shadows, and occlusions to accommodate the new camera angle and interactive pose specified above.`;
    }
  } else if (scope === 'pose_only') {
    scenePreservationText = isSourceInspired
      ? `Preserve the original camera viewpoint, framing, clothing garments, outfit fabric and colors, and use the source image as the visual reference for lighting character, tonal balance, shadow softness, color grading, skin appearance, and photographic texture without forcing retention of incompatible original room furniture, adjusting limb placement, drapery, shadows, and occlusions to naturally accommodate the new pose specified above.`
      : `Preserve the original camera viewpoint, framing, clothing garments, outfit fabric and colors, environment, background setting, and existing ambient lighting style from the original image, adjusting limb placement, drapery, shadows, and occlusions to naturally accommodate the new pose specified above.`;
  } else {
    scenePreservationText = `${envClause}, adjusting perspective, limb placement, shadows, and occlusions to naturally accommodate the new camera angle and pose specified above.`;
  }

  let constraintsText = '';
  if (scope === 'camera_only') {
    constraintsText =
      'Apply this camera-only transformation strictly to the original image supplied alongside this prompt. Do not alter the subject’s body pose, limb placement, clothing design, or identity; re-render the scene strictly from the specified camera perspective and framing.';
  } else if (sceneInteraction.hasActiveInteraction) {
    const targetSurface = sceneInteraction.preset?.furnitureTarget || 'furniture';
    const scopeNote =
      scope === 'pose_only'
        ? 'Do not alter the original camera angle, lens perspective, clothing design, or identity; '
        : 'Do not alter clothing design or subject identity; ';
    constraintsText = `Apply this transformation strictly to the original image supplied alongside this prompt. ${scopeNote}authorize physical contact and support with the ${targetSurface} surface (${sceneInteraction.surfaceDescription}) and derive the scene’s lighting direction, shadow softness, color grading, and photographic texture from the source image while avoiding unrelated extra subjects or clutter, ensuring the subject precisely adopts the body stance, limb placement, and head orientation specified above.`;
  } else if (scope === 'pose_only') {
    constraintsText =
      'Apply this pose-only transformation strictly to the original image supplied alongside this prompt. Do not alter the original camera angle, lens perspective, clothing design, or identity; ensure the subject precisely adopts the body stance, limb placement, and head orientation specified above.';
  } else {
    constraintsText =
      'Apply this transformation strictly to the original image supplied alongside this prompt. Do not add unwanted subjects or objects, do not alter clothing design or identity, and ensure the re-rendered subject precisely adopts the camera perspective, body stance, limb placement, and head orientation specified in the transformation fields above.';
  }

  const fields: I2IEditableField[] = [
    {
      id: 'identity_preservation',
      label: 'Subject Identity Preservation',
      subtitle: 'Locks facial features, skin tone, hair, and subject likeness',
      defaultText: identityText,
      userText: identityText,
      isLocked: false,
      isRemoved: false,
      order: 1,
    },
    {
      id: 'camera_framing',
      label: 'Camera Viewpoint & Framing',
      subtitle: 'Specifies camera angles, elevation, focal length, and shot framing',
      defaultText: cameraFramingText,
      userText: cameraFramingText,
      isLocked: false,
      isRemoved: scope === 'pose_only',
      order: 2,
    },
    {
      id: 'body_pose_torso',
      label: 'Body Pose & Torso Alignment',
      subtitle: 'Controls stance, torso orientation, lean, and twist',
      defaultText: torsoText,
      userText: torsoText,
      isLocked: false,
      isRemoved: scope === 'camera_only',
      order: 3,
    },
    {
      id: 'arms_and_hands',
      label: 'Arms & Hand Gestures',
      subtitle: 'Specifies left vs. right arm articulation, elbow angles, and hand gestures',
      defaultText: armsText,
      userText: armsText,
      isLocked: false,
      isRemoved: scope === 'camera_only',
      order: 4,
    },
    {
      id: 'legs_and_feet',
      label: 'Legs & Foot Placement',
      subtitle: 'Specifies left vs. right leg position, knee bends, and stance width',
      defaultText: legsText,
      userText: legsText,
      isLocked: false,
      isRemoved: scope === 'camera_only',
      order: 5,
    },
    {
      id: 'head_gaze_expression',
      label: 'Head Direction, Gaze & Expression',
      subtitle: 'Specifies head tilt, eye contact direction, and facial expression',
      defaultText: headGazeText,
      userText: headGazeText,
      isLocked: false,
      isRemoved: scope === 'camera_only',
      order: 6,
    },
    {
      id: 'scene_preservation',
      label: 'Background, Clothing & Lighting Preservation',
      subtitle: 'Protects existing clothing garments and environment fidelity',
      defaultText: scenePreservationText,
      userText: scenePreservationText,
      isLocked: false,
      isRemoved: false,
      order: 7,
    },
    {
      id: 'transformation_constraints',
      label: 'Transformation Scope & Constraints',
      subtitle: 'Instructions for image-to-image AI tools',
      defaultText: constraintsText,
      userText: constraintsText,
      isLocked: false,
      isRemoved: false,
      order: 8,
    },
  ];

  return fields;
}

/**
 * Merges fresh configuration values into existing fields, preserving user locked states,
 * custom edits on locked fields, and removed statuses.
 */
export function syncI2IFieldsWithConfig(
  existingFields: I2IEditableField[],
  config: PlayboardFullConfig,
  scope: I2ITransformationScope = 'both'
): I2IEditableField[] {
  const freshFields = buildInitialI2IFields(config, scope);
  if (!existingFields || existingFields.length === 0) {
    return freshFields;
  }

  const existingMap = new Map<I2IFieldId, I2IEditableField>();
  existingFields.forEach((f) => existingMap.set(f.id, f));

  return freshFields.map((fresh) => {
    const existing = existingMap.get(fresh.id);
    if (!existing) return fresh;

    // If the field is locked, preserve the user's locked state and their locked text
    if (existing.isLocked) {
      return {
        ...fresh,
        userText: existing.userText,
        isLocked: true,
        isRemoved: existing.isRemoved,
        order: existing.order,
      };
    }

    // If the user made a manual edit that differs from the old default, preserve their manual edit
    if (existing.userText !== existing.defaultText && existing.userText.trim().length > 0) {
      return {
        ...fresh,
        userText: existing.userText,
        isLocked: false,
        isRemoved: existing.isRemoved,
        order: existing.order,
      };
    }

    // Otherwise, update with the fresh accurate default based on the latest 3D configuration
    return {
      ...fresh,
      isRemoved: existing.isRemoved,
      order: existing.order,
    };
  });
}

export function compileFinalI2IPrompt(
  fields: I2IEditableField[],
  scope: I2ITransformationScope,
  config: PlayboardFullConfig,
  targetModel: TargetModelType = 'universal'
): string {
  const activeFields = fields
    .filter((f) => !f.isRemoved)
    .sort((a, b) => a.order - b.order);
  const sceneInteraction = evaluateActiveSceneInteraction(config.pose, config.environment);

  let scopeDirective = '';
  switch (scope) {
    case 'camera_only':
      scopeDirective =
        "TRANSFORMATION INSTRUCTION (Camera Viewpoint & Framing Shift Only): Preserve the subject's original pose, clothing, and scene, while shifting the camera perspective as specified below.";
      break;
    case 'pose_only':
      scopeDirective = sceneInteraction.hasActiveInteraction
        ? `TRANSFORMATION INSTRUCTION (Pose & Scene-Surface Interaction Modification): Maintain the original camera angle and subject identity while re-posing the subject into the specified ${sceneInteraction.preset?.furnitureTarget || 'furniture'} interaction.`
        : 'TRANSFORMATION INSTRUCTION (Pose & Gesture Modification Only): Maintain the original camera angle, background, and identity, while re-posing the subject as specified below.';
      break;
    case 'both':
      scopeDirective =
        'TRANSFORMATION INSTRUCTION (Coordinated Camera & Pose Reconfiguration): Re-render the supplied original image with the new camera viewpoint, framing, and anatomical pose detailed below.';
      break;
    default:
      scopeDirective =
        'TRANSFORMATION INSTRUCTION: Apply the specified image-to-image transformation to the supplied original image.';
  }

  const sections = activeFields.map((field) => {
    return `[${field.label.toUpperCase()}]\n${field.userText.trim()}`;
  });

  if (targetModel === 'flux') {
    return [
      scopeDirective,
      ...sections,
      `OUTPUT FORMAT: Aspect ratio --ar ${config.camera.outputRatio.replace(':', ':')}`,
    ].join('\n\n');
  }

  if (targetModel === 'chatgpt') {
    return [
      scopeDirective,
      ...sections,
      `[OUTPUT SPECIFICATION]\nRender in ${config.camera.outputRatio} aspect ratio with natural photographic lighting and anatomical fidelity matching the original subject.`,
    ].join('\n\n');
  }

  if (targetModel === 'gemini') {
    return [
      scopeDirective,
      ...sections,
      `[OUTPUT SPECIFICATION]\nRender in ${config.camera.outputRatio} aspect ratio with realistic photographic grading and consistent spatial geometry matching the original image.`,
    ].join('\n\n');
  }

  return [
    scopeDirective,
    ...sections,
    `[OUTPUT SPECIFICATION]\nRender in ${config.camera.outputRatio} aspect ratio with realistic photographic grading matching the original image.`,
  ].join('\n\n');
}

// ==========================================
// 5. CANONICAL STATE OWNERSHIP, PRESET ISOLATION & RESET HELPERS
// ==========================================

export const DEFAULT_PLAYBOARD_CAMERA: Camera3DSettings = {
  yawDeg: 0,
  pitchDeg: 0,
  height: 1.1,
  distance: 3.1,
  rollDeg: 0,
  focalLength: '50mm_standard_normal',
  framing: 'full_shot',
  composition: 'center',
  outputRatio: '3:4',
  orientation: 'Portrait',
  focusDof: 'shallow_f1_4',
  targetMode: 'track_subject',
};

export const DEFAULT_PLAYBOARD_POSE: CharacterPose3DSettings = {
  basePose: 'natural_standing',
  torsoLeanDeg: 0,
  torsoTwistDeg: 0,
  torsoTiltDeg: 0,
  headRotationDeg: 0,
  headTiltDeg: 0,
  gaze: 'direct_at_camera',
  expression: 'neutral_relaxed',
  leftArmShoulderForwardDeg: 5,
  leftArmShoulderOutDeg: 8,
  leftArmElbowBendDeg: 14,
  leftArmWristDeg: 0,
  leftHandGesture: 'relaxed_natural',
  rightArmShoulderForwardDeg: 5,
  rightArmShoulderOutDeg: 8,
  rightArmElbowBendDeg: 14,
  rightArmWristDeg: 0,
  rightHandGesture: 'relaxed_natural',
  leftLegHipForwardDeg: 0,
  leftLegHipOutDeg: 4,
  leftLegKneeBendDeg: 4,
  leftFootAngleDeg: 5,
  rightLegHipForwardDeg: 0,
  rightLegHipOutDeg: 4,
  rightLegKneeBendDeg: 4,
  rightFootAngleDeg: 5,
  isWalking: false,
  isWaving: false,
  hipHeightOffset: 0,
  characterYawDeg: 0,
  characterPosX: 0,
  characterPosZ: 0,
  interactionPresetId: null,
  seatHeightY: null,
  pelvisPitchDeg: 0,
  pelvisRollDeg: 0,
  anchorPosX: 0,
  anchorPosZ: 0,
  customModelBounds: null,
};

/**
 * Applies a body pose preset strictly to anatomical posture fields without overwriting
 * the subject's staged world position (characterPosX, characterPosZ), orientation (characterYawDeg),
 * custom model bounds, or any camera settings.
 * Clears active furniture elevation (interactionPresetId, seatHeightY) and keeps anchorPosX/Z
 * aligned with the active camera targetMode.
 */
export function applyPosePresetState(
  currentPose: CharacterPose3DSettings,
  presetPatch: Partial<CharacterPose3DSettings>,
  currentCamera?: Pick<Camera3DSettings, 'targetMode'>
): CharacterPose3DSettings {
  const charX =
    typeof currentPose.characterPosX === 'number' && Number.isFinite(currentPose.characterPosX)
      ? currentPose.characterPosX
      : 0;
  const charZ =
    typeof currentPose.characterPosZ === 'number' && Number.isFinite(currentPose.characterPosZ)
      ? currentPose.characterPosZ
      : 0;
  const charYaw =
    typeof currentPose.characterYawDeg === 'number' && Number.isFinite(currentPose.characterYawDeg)
      ? currentPose.characterYawDeg
      : 0;

  const isFixedComposition = currentCamera?.targetMode === 'fixed_composition';
  const nextAnchorX = isFixedComposition
    ? typeof currentPose.anchorPosX === 'number' && Number.isFinite(currentPose.anchorPosX)
      ? currentPose.anchorPosX
      : charX
    : charX;
  const nextAnchorZ = isFixedComposition
    ? typeof currentPose.anchorPosZ === 'number' && Number.isFinite(currentPose.anchorPosZ)
      ? currentPose.anchorPosZ
      : charZ
    : charZ;

  const nextBasePose = presetPatch.basePose ?? currentPose.basePose;
  const canonicalPreset = CANONICAL_POSE_PRESET_VALUES[nextBasePose] ?? {};
  const defaultPelvisPitch =
    typeof canonicalPreset.pelvisPitchDeg === 'number'
      ? canonicalPreset.pelvisPitchDeg
      : nextBasePose === 'reclined_lying'
      ? -76
      : 0;
  const defaultPelvisRoll =
    typeof canonicalPreset.pelvisRollDeg === 'number'
      ? canonicalPreset.pelvisRollDeg
      : 0;

  return {
    ...DEFAULT_PLAYBOARD_POSE,
    ...canonicalPreset,
    ...presetPatch,
    basePose: nextBasePose,
    characterPosX:
      typeof presetPatch.characterPosX === 'number' ? presetPatch.characterPosX : charX,
    characterPosZ:
      typeof presetPatch.characterPosZ === 'number' ? presetPatch.characterPosZ : charZ,
    characterYawDeg:
      typeof presetPatch.characterYawDeg === 'number' ? presetPatch.characterYawDeg : charYaw,
    gaze: presetPatch.gaze ?? currentPose.gaze ?? DEFAULT_PLAYBOARD_POSE.gaze,
    expression:
      presetPatch.expression ??
      canonicalPreset.expression ??
      currentPose.expression ??
      DEFAULT_PLAYBOARD_POSE.expression,
    interactionPresetId: null,
    seatHeightY: null,
    pelvisPitchDeg:
      typeof presetPatch.pelvisPitchDeg === 'number'
        ? presetPatch.pelvisPitchDeg
        : defaultPelvisPitch,
    pelvisRollDeg:
      typeof presetPatch.pelvisRollDeg === 'number'
        ? presetPatch.pelvisRollDeg
        : defaultPelvisRoll,
    anchorPosX: nextAnchorX,
    anchorPosZ: nextAnchorZ,
    customModelBounds: currentPose.customModelBounds ?? null,
    isWalking: Boolean(presetPatch.isWalking ?? canonicalPreset.isWalking ?? false),
    isWaving: Boolean(presetPatch.isWaving ?? canonicalPreset.isWaving ?? false),
  };
}

/**
 * Applies a camera preset strictly to Camera3DSettings without modifying subject position,
 * subject orientation, body pose, or gaze. Preserves camera.targetMode, outputRatio, and orientation
 * unless explicitly included in cameraPatch.
 */
export function applyCameraPresetState(
  currentCamera: Camera3DSettings,
  cameraPatch: Partial<Camera3DSettings>
): Camera3DSettings {
  return {
    ...currentCamera,
    ...cameraPatch,
    targetMode: cameraPatch.targetMode ?? currentCamera.targetMode ?? 'track_subject',
    outputRatio: cameraPatch.outputRatio ?? currentCamera.outputRatio ?? '3:4',
    orientation: cameraPatch.orientation ?? currentCamera.orientation ?? 'Portrait',
  };
}

/**
 * Applies a gaze preset strictly to pose.gaze without mutating head/body angles, position, or camera.
 */
export function applyGazeControlState(
  currentPose: CharacterPose3DSettings,
  gaze: GazeDirection
): CharacterPose3DSettings {
  return {
    ...currentPose,
    gaze,
  };
}

/**
 * Applies a scene-interaction preset (e.g., sit on chair, sit on bed, lean on wall) while preserving
 * camera settings, customModelBounds, and automatically switching environment to 'studio_bedroom'
 * if the current environment lacks the interactive furniture props.
 */
export function applySceneInteractionPresetState(
  currentPose: CharacterPose3DSettings,
  currentCamera: Camera3DSettings,
  preset: SceneInteractionPreset,
  currentEnvironment: PlayboardEnvironment = 'studio_bedroom'
): {
  pose: CharacterPose3DSettings;
  camera: Camera3DSettings;
  environment: PlayboardEnvironment;
} {
  const needsBedroom = preset.requiresBedroomFurniture || preset.furnitureTarget === 'wall';
  const nextEnvironment: PlayboardEnvironment =
    needsBedroom && currentEnvironment !== 'studio_bedroom'
      ? 'studio_bedroom'
      : currentEnvironment;

  const isFixedComposition = currentCamera.targetMode === 'fixed_composition';
  const nextPose: CharacterPose3DSettings = {
    ...DEFAULT_PLAYBOARD_POSE,
    ...currentPose,
    ...preset.poseValues,
    interactionPresetId: preset.id,
    seatHeightY: preset.seatHeightY,
    characterPosX: preset.anchorX,
    characterPosZ: preset.anchorZ,
    anchorPosX: isFixedComposition
      ? typeof currentPose.anchorPosX === 'number' && Number.isFinite(currentPose.anchorPosX)
        ? currentPose.anchorPosX
        : preset.anchorX
      : preset.anchorX,
    anchorPosZ: isFixedComposition
      ? typeof currentPose.anchorPosZ === 'number' && Number.isFinite(currentPose.anchorPosZ)
        ? currentPose.anchorPosZ
        : preset.anchorZ
      : preset.anchorZ,
    customModelBounds: currentPose.customModelBounds ?? null,
    isWalking: false,
    isWaving: false,
  };

  return {
    pose: nextPose,
    camera: { ...currentCamera },
    environment: nextEnvironment,
  };
}

/**
 * Resets anatomical body pose, limbs, head, gaze, and clears furniture elevation while
 * preserving the subject's staged world position (characterPosX, characterPosZ), orientation (characterYawDeg),
 * and customModelBounds.
 */
export function resetPoseState(
  currentPose: CharacterPose3DSettings,
  currentCamera?: Pick<Camera3DSettings, 'targetMode'>
): CharacterPose3DSettings {
  const charX =
    typeof currentPose.characterPosX === 'number' && Number.isFinite(currentPose.characterPosX)
      ? currentPose.characterPosX
      : 0;
  const charZ =
    typeof currentPose.characterPosZ === 'number' && Number.isFinite(currentPose.characterPosZ)
      ? currentPose.characterPosZ
      : 0;
  const charYaw =
    typeof currentPose.characterYawDeg === 'number' && Number.isFinite(currentPose.characterYawDeg)
      ? currentPose.characterYawDeg
      : 0;
  const isFixedComposition = currentCamera?.targetMode === 'fixed_composition';

  return {
    ...DEFAULT_PLAYBOARD_POSE,
    characterPosX: charX,
    characterPosZ: charZ,
    characterYawDeg: charYaw,
    anchorPosX: isFixedComposition ? (currentPose.anchorPosX ?? charX) : charX,
    anchorPosZ: isFixedComposition ? (currentPose.anchorPosZ ?? charZ) : charZ,
    customModelBounds: currentPose.customModelBounds ?? null,
  };
}

/**
 * Resets the subject's world position (characterPosX, characterPosZ) and yaw (characterYawDeg) to origin (0, 0, 0°),
 * clearing active furniture interactions while preserving anatomical joint angles, gaze, and expression.
 */
export function resetSubjectPositionState(
  currentPose: CharacterPose3DSettings,
  currentCamera?: Pick<Camera3DSettings, 'targetMode'>
): CharacterPose3DSettings {
  const isFixedComposition = currentCamera?.targetMode === 'fixed_composition';
  const presetDefaults = CANONICAL_POSE_PRESET_VALUES[currentPose.basePose];
  return {
    ...currentPose,
    characterPosX: 0,
    characterPosZ: 0,
    characterYawDeg: 0,
    interactionPresetId: null,
    seatHeightY: null,
    pelvisPitchDeg:
      presetDefaults?.pelvisPitchDeg ??
      (currentPose.basePose === 'reclined_lying' ? -76 : 0),
    pelvisRollDeg: presetDefaults?.pelvisRollDeg ?? 0,
    anchorPosX: isFixedComposition ? (currentPose.anchorPosX ?? 0) : 0,
    anchorPosZ: isFixedComposition ? (currentPose.anchorPosZ ?? 0) : 0,
  };
}

/**
 * Resets camera controls to default while preserving outputRatio and orientation.
 */
export function resetCameraState(currentCamera?: Camera3DSettings): Camera3DSettings {
  return {
    ...DEFAULT_PLAYBOARD_CAMERA,
    outputRatio: currentCamera?.outputRatio ?? DEFAULT_PLAYBOARD_CAMERA.outputRatio,
    orientation: currentCamera?.orientation ?? DEFAULT_PLAYBOARD_CAMERA.orientation,
    targetMode: 'track_subject',
  };
}

/**
 * Resets all Playboard state (camera, pose, subject position, and environment) to canonical defaults.
 */
export function resetAllPlayboardState(): {
  camera: Camera3DSettings;
  pose: CharacterPose3DSettings;
  environment: PlayboardEnvironment;
  lightingPreset: PlayboardLightingPreset;
} {
  return {
    camera: { ...DEFAULT_PLAYBOARD_CAMERA },
    pose: { ...DEFAULT_PLAYBOARD_POSE },
    environment: 'studio_bedroom',
    lightingPreset: 'daylight_warm',
  };
}

/**
 * Migrates legacy saved blueprints or localStorage configs to ensure targetMode, lightingPreset,
 * and anchorPosX/Z are consistent and free of stale anchor/subject split states.
 */
export function migrateLegacyPlayboardConfig(
  raw: Partial<PlayboardFullConfig>
): PlayboardFullConfig {
  const mergedCamera: Camera3DSettings = {
    ...DEFAULT_PLAYBOARD_CAMERA,
    ...(raw.camera || {}),
  };
  const mergedPose: CharacterPose3DSettings = {
    ...DEFAULT_PLAYBOARD_POSE,
    ...(raw.pose || {}),
    isWalking: false,
  };

  const targetMode: CameraTargetMode = mergedCamera.targetMode ?? 'track_subject';
  mergedCamera.targetMode = targetMode;

  if (targetMode === 'track_subject') {
    mergedPose.anchorPosX = mergedPose.characterPosX ?? 0;
    mergedPose.anchorPosZ = mergedPose.characterPosZ ?? 0;
  }

  const validLightingPresets: PlayboardLightingPreset[] = [
    'daylight_warm',
    'golden_hour',
    'cozy_evening',
    'studio_neutral',
  ];
  const resolvedLighting: PlayboardLightingPreset =
    raw.lightingPreset && validLightingPresets.includes(raw.lightingPreset)
      ? raw.lightingPreset
      : 'daylight_warm';

  return {
    id: raw.id || 'active_workspace',
    name: raw.name || 'Active Studio Setup',
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
    environment: raw.environment || 'studio_bedroom',
    lightingPreset: resolvedLighting,
    instantPoseTransitions: raw.instantPoseTransitions ?? false,
    camera: mergedCamera,
    pose: mergedPose,
    preserveEnvironment: raw.preserveEnvironment ?? true,
    environmentPolicy: raw.environmentPolicy ?? 'auto',
    sourceVisualNotes: raw.sourceVisualNotes ?? '',
  };
}

