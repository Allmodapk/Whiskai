import * as THREE from 'three';
import {
  Camera3DSettings,
  CameraTargetMode,
  CharacterPose3DSettings,
  CustomModelBounds,
  CustomModelDiagnostics,
  GazeDirection,
  HandGesture,
  LensFocalLength,
  PlayboardEnvironment,
  PlayboardSupportSurfaceId,
  PosePreset,
  SceneInteractionCategory,
  ShotFraming,
} from '../types/cameraPlayboard';

export const FOCAL_LENGTH_FOV_DEG: Record<LensFocalLength, number> = {
  '16mm_ultra_wide': 95,
  '24mm_wide': 84,
  '35mm_moderate_wide': 63,
  '50mm_standard_normal': 47,
  '85mm_portrait_telephoto': 28,
  '135mm_telephoto': 18,
};

export interface ParsedAspectRatio {
  ratioString: string;
  numericAspect: number; // width / height
  orientation: 'Portrait' | 'Landscape' | 'Square';
  orientationDescriptor: string;
}

/**
 * Parses the user's selected output aspect ratio string (e.g. '3:4', '16:9', '1:1', '9:16')
 * without assuming '3:4' unless that is the actual selection.
 */
export function parseOutputAspectRatio(outputRatio?: string): ParsedAspectRatio {
  const raw = (outputRatio || '3:4').trim();
  const parts = raw.split(':').map((n) => parseFloat(n));
  let w = 3;
  let h = 4;
  if (
    parts.length === 2 &&
    Number.isFinite(parts[0]) &&
    Number.isFinite(parts[1]) &&
    parts[0] > 0 &&
    parts[1] > 0
  ) {
    w = parts[0];
    h = parts[1];
  }
  const numericAspect = w / h;
  let orientation: 'Portrait' | 'Landscape' | 'Square' = 'Portrait';
  let orientationDescriptor = 'vertical portrait';

  if (Math.abs(numericAspect - 1.0) < 0.03) {
    orientation = 'Square';
    orientationDescriptor = 'square 1:1';
  } else if (numericAspect > 1.0) {
    orientation = 'Landscape';
    orientationDescriptor =
      numericAspect >= 1.7 ? 'widescreen horizontal landscape' : 'horizontal landscape';
  } else {
    orientation = 'Portrait';
    orientationDescriptor =
      numericAspect <= 0.6 ? 'tall vertical portrait' : 'vertical portrait';
  }

  return {
    ratioString: raw,
    numericAspect,
    orientation,
    orientationDescriptor,
  };
}

/**
 * Computes the effective vertical FOV in degrees for a given lens focal length and output aspect ratio.
 */
export function getEffectiveVerticalFovDeg(
  focalLength: LensFocalLength,
  numericAspect: number
): number {
  const baseFov = FOCAL_LENGTH_FOV_DEG[focalLength] || 47;
  const aspectFactor = Math.pow(0.75 / Math.max(0.4, Math.min(2.5, numericAspect)), 0.22);
  return THREE.MathUtils.clamp(baseFov * aspectFactor, 12, 110);
}

/**
 * Analytical 2-Bone IK Helper matching Playboard3DCanvas.tsx for target-based gestures
 * (hand_on_hip, touching_face, hands_clasped).
 */
export function solveCharacterArmIK(
  side: -1 | 1,
  shoulderPos: THREE.Vector3,
  targetPos: THREE.Vector3,
  upperLen = 0.26,
  lowerLen = 0.23
): { forwardDeg: number; outDeg: number; elbowDeg: number } {
  const delta = new THREE.Vector3().subVectors(targetPos, shoulderPos);
  const dist = THREE.MathUtils.clamp(delta.length(), 0.08, upperLen + lowerLen - 0.005);

  const cosElbow = THREE.MathUtils.clamp(
    (upperLen * upperLen + lowerLen * lowerLen - dist * dist) / (2 * upperLen * lowerLen),
    -1,
    1
  );
  const elbowRad = Math.PI - Math.acos(cosElbow);

  const cosShoulderOffset = THREE.MathUtils.clamp(
    (upperLen * upperLen + dist * dist - lowerLen * lowerLen) / (2 * upperLen * dist),
    -1,
    1
  );
  const shoulderOffsetRad = Math.acos(cosShoulderOffset);

  const dir = delta.clone().normalize();
  const forwardRad = Math.atan2(dir.z, -dir.y) + shoulderOffsetRad * 0.65;
  const lateralDist = side === -1 ? -dir.x : dir.x;
  const outRad = Math.max(
    0,
    Math.atan2(lateralDist, Math.hypot(dir.y, dir.z)) + shoulderOffsetRad * 0.35
  );

  return {
    forwardDeg: THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(forwardRad), -45, 115),
    outDeg: THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(outRad), 0, 95),
    elbowDeg: THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(elbowRad), 0, 142),
  };
}

/**
 * Canonical joint baseline values for all 20 PosePreset definitions.
 * Shared across preset application, semantic 3D rig solving, and prompt compilation.
 */
export const CANONICAL_POSE_PRESET_VALUES: Record<PosePreset, Partial<CharacterPose3DSettings>> = {
  natural_standing: {
    basePose: 'natural_standing',
    torsoLeanDeg: 0,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 0,
    leftArmShoulderForwardDeg: 0,
    leftArmShoulderOutDeg: 12,
    leftArmElbowBendDeg: 15,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: 0,
    rightArmShoulderOutDeg: 12,
    rightArmElbowBendDeg: 15,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 0,
    leftLegHipOutDeg: 6,
    leftLegKneeBendDeg: 4,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 0,
    rightLegHipOutDeg: 6,
    rightLegKneeBendDeg: 4,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: 0,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  contrapposto: {
    basePose: 'contrapposto',
    torsoLeanDeg: 2,
    torsoTwistDeg: 8,
    torsoTiltDeg: -7,
    headRotationDeg: -10,
    headTiltDeg: 5,
    leftArmShoulderForwardDeg: 5,
    leftArmShoulderOutDeg: 16,
    leftArmElbowBendDeg: 30,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: -8,
    rightArmShoulderOutDeg: 38,
    rightArmElbowBendDeg: 85,
    rightArmWristDeg: 0,
    rightHandGesture: 'hand_on_hip',
    leftLegHipForwardDeg: 12,
    leftLegHipOutDeg: 10,
    leftLegKneeBendDeg: 22,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: -4,
    rightLegHipOutDeg: 4,
    rightLegKneeBendDeg: 2,
    rightFootAngleDeg: 0,
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.02,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  power_stance: {
    basePose: 'power_stance',
    torsoLeanDeg: -4,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 8,
    leftArmShoulderForwardDeg: -10,
    leftArmShoulderOutDeg: 45,
    leftArmElbowBendDeg: 90,
    leftArmWristDeg: 0,
    leftHandGesture: 'hand_on_hip',
    rightArmShoulderForwardDeg: -10,
    rightArmShoulderOutDeg: 45,
    rightArmElbowBendDeg: 90,
    rightArmWristDeg: 0,
    rightHandGesture: 'hand_on_hip',
    leftLegHipForwardDeg: 0,
    leftLegHipOutDeg: 20,
    leftLegKneeBendDeg: 6,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 0,
    rightLegHipOutDeg: 20,
    rightLegKneeBendDeg: 6,
    rightFootAngleDeg: 0,
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.04,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  casual_sitting: {
    basePose: 'casual_sitting',
    torsoLeanDeg: 6,
    torsoTwistDeg: 4,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 0,
    leftArmShoulderForwardDeg: 25,
    leftArmShoulderOutDeg: 18,
    leftArmElbowBendDeg: 75,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: 25,
    rightArmShoulderOutDeg: 18,
    rightArmElbowBendDeg: 75,
    rightArmWristDeg: 0,
    rightHandGesture: 'relaxed_natural',
    leftLegHipForwardDeg: 80,
    leftLegHipOutDeg: 14,
    leftLegKneeBendDeg: 85,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 80,
    rightLegHipOutDeg: 14,
    rightLegKneeBendDeg: 85,
    rightFootAngleDeg: 0,
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.32,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  floor_seated_cross_legged: {
    basePose: 'floor_seated_cross_legged',
    torsoLeanDeg: 2,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 0,
    leftArmShoulderForwardDeg: 20,
    leftArmShoulderOutDeg: 24,
    leftArmElbowBendDeg: 60,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: 20,
    rightArmShoulderOutDeg: 24,
    rightArmElbowBendDeg: 60,
    rightArmWristDeg: 0,
    rightHandGesture: 'relaxed_natural',
    leftLegHipForwardDeg: 70,
    leftLegHipOutDeg: 40,
    leftLegKneeBendDeg: 110,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 70,
    rightLegHipOutDeg: 40,
    rightLegKneeBendDeg: 110,
    rightFootAngleDeg: 0,
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.65,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  mid_stride_walking: {
    basePose: 'mid_stride_walking',
    torsoLeanDeg: 6,
    torsoTwistDeg: -8,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 0,
    leftArmShoulderForwardDeg: 35,
    leftArmShoulderOutDeg: 14,
    leftArmElbowBendDeg: 35,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: -28,
    rightArmShoulderOutDeg: 14,
    rightArmElbowBendDeg: 20,
    rightArmWristDeg: 0,
    rightHandGesture: 'relaxed_natural',
    leftLegHipForwardDeg: -32,
    leftLegHipOutDeg: 8,
    leftLegKneeBendDeg: 15,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 40,
    rightLegHipOutDeg: 8,
    rightLegKneeBendDeg: 30,
    rightFootAngleDeg: 0,
    isWalking: true,
    isWaving: false,
    hipHeightOffset: 0,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  dynamic_running: {
    basePose: 'dynamic_running',
    torsoLeanDeg: 18,
    torsoTwistDeg: -12,
    torsoTiltDeg: 2,
    headRotationDeg: 0,
    headTiltDeg: 0,
    leftArmShoulderForwardDeg: 60,
    leftArmShoulderOutDeg: 18,
    leftArmElbowBendDeg: 85,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: -40,
    rightArmShoulderOutDeg: 18,
    rightArmElbowBendDeg: 75,
    rightArmWristDeg: 0,
    rightHandGesture: 'relaxed_natural',
    leftLegHipForwardDeg: -45,
    leftLegHipOutDeg: 10,
    leftLegKneeBendDeg: 55,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 65,
    rightLegHipOutDeg: 10,
    rightLegKneeBendDeg: 80,
    rightFootAngleDeg: 0,
    isWalking: true,
    isWaving: false,
    hipHeightOffset: -0.05,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  grounded_kneeling: {
    basePose: 'grounded_kneeling',
    torsoLeanDeg: 4,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 0,
    leftLegHipForwardDeg: 60,
    leftLegHipOutDeg: 12,
    leftLegKneeBendDeg: 90,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: -10,
    rightLegHipOutDeg: 10,
    rightLegKneeBendDeg: 110,
    rightFootAngleDeg: 0,
    leftArmShoulderForwardDeg: 10,
    leftArmShoulderOutDeg: 14,
    leftArmElbowBendDeg: 40,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: 10,
    rightArmShoulderOutDeg: 14,
    rightArmElbowBendDeg: 40,
    rightArmWristDeg: 0,
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.42,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  deep_squat: {
    basePose: 'deep_squat',
    torsoLeanDeg: 22,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 0,
    leftLegHipForwardDeg: 75,
    leftLegHipOutDeg: 35,
    leftLegKneeBendDeg: 120,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 75,
    rightLegHipOutDeg: 35,
    rightLegKneeBendDeg: 120,
    rightFootAngleDeg: 0,
    leftArmShoulderForwardDeg: 40,
    leftArmShoulderOutDeg: 20,
    leftArmElbowBendDeg: 60,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: 40,
    rightArmShoulderOutDeg: 20,
    rightArmElbowBendDeg: 60,
    rightArmWristDeg: 0,
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.48,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  reclined_lying: {
    basePose: 'reclined_lying',
    torsoLeanDeg: -22,
    torsoTwistDeg: 5,
    torsoTiltDeg: 0,
    headRotationDeg: 8,
    headTiltDeg: -12,
    leftArmShoulderForwardDeg: -25,
    leftArmShoulderOutDeg: 28,
    leftArmElbowBendDeg: 80,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: 15,
    rightArmShoulderOutDeg: 20,
    rightArmElbowBendDeg: 55,
    rightArmWristDeg: 0,
    rightHandGesture: 'relaxed_natural',
    leftLegHipForwardDeg: 25,
    leftLegHipOutDeg: 12,
    leftLegKneeBendDeg: 35,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 10,
    rightLegHipOutDeg: 8,
    rightLegKneeBendDeg: 12,
    rightFootAngleDeg: 0,
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.68,
    pelvisPitchDeg: -76,
    pelvisRollDeg: 0,
  },
  wall_lean: {
    basePose: 'wall_lean',
    torsoLeanDeg: -14,
    torsoTwistDeg: -10,
    torsoTiltDeg: 6,
    headRotationDeg: 12,
    headTiltDeg: 4,
    leftArmShoulderForwardDeg: 12,
    leftArmShoulderOutDeg: 16,
    leftArmElbowBendDeg: 45,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightArmShoulderForwardDeg: -12,
    rightArmShoulderOutDeg: 35,
    rightArmElbowBendDeg: 88,
    rightArmWristDeg: 0,
    rightHandGesture: 'hand_on_hip',
    leftLegHipForwardDeg: 22,
    leftLegHipOutDeg: 6,
    leftLegKneeBendDeg: 42,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: -6,
    rightLegHipOutDeg: 4,
    rightLegKneeBendDeg: 4,
    rightFootAngleDeg: 0,
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.03,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  welcoming_wave: {
    basePose: 'welcoming_wave',
    torsoLeanDeg: 0,
    torsoTwistDeg: 6,
    torsoTiltDeg: -3,
    headRotationDeg: 0,
    headTiltDeg: 4,
    rightArmShoulderForwardDeg: 15,
    rightArmShoulderOutDeg: 70,
    rightArmElbowBendDeg: 80,
    rightArmWristDeg: 0,
    rightHandGesture: 'wave',
    leftArmShoulderForwardDeg: 0,
    leftArmShoulderOutDeg: 12,
    leftArmElbowBendDeg: 15,
    leftArmWristDeg: 0,
    leftHandGesture: 'relaxed_natural',
    leftLegHipForwardDeg: 0,
    leftLegHipOutDeg: 6,
    leftLegKneeBendDeg: 4,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 0,
    rightLegHipOutDeg: 6,
    rightLegKneeBendDeg: 4,
    rightFootAngleDeg: 0,
    expression: 'gentle_smile',
    isWalking: false,
    isWaving: true,
    hipHeightOffset: 0,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  all_fours_neutral: {
    basePose: 'all_fours_neutral',
    torsoLeanDeg: 5,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 8,
    leftArmShoulderForwardDeg: 70,
    leftArmShoulderOutDeg: 15,
    leftArmElbowBendDeg: 10,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: 70,
    rightArmShoulderOutDeg: 15,
    rightArmElbowBendDeg: 10,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 80,
    leftLegHipOutDeg: 12,
    leftLegKneeBendDeg: 90,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 80,
    rightLegHipOutDeg: 12,
    rightLegKneeBendDeg: 90,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.55,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 0,
  },
  cow_pose_arched: {
    basePose: 'cow_pose_arched',
    torsoLeanDeg: -18,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 22,
    leftArmShoulderForwardDeg: 75,
    leftArmShoulderOutDeg: 18,
    leftArmElbowBendDeg: 8,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: 75,
    rightArmShoulderOutDeg: 18,
    rightArmElbowBendDeg: 8,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 85,
    leftLegHipOutDeg: 14,
    leftLegKneeBendDeg: 95,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 85,
    rightLegHipOutDeg: 14,
    rightLegKneeBendDeg: 95,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.52,
    pelvisPitchDeg: -12,
    pelvisRollDeg: 0,
  },
  cat_pose_rounded: {
    basePose: 'cat_pose_rounded',
    torsoLeanDeg: 20,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: -25,
    leftArmShoulderForwardDeg: 65,
    leftArmShoulderOutDeg: 12,
    leftArmElbowBendDeg: 15,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: 65,
    rightArmShoulderOutDeg: 12,
    rightArmElbowBendDeg: 15,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 75,
    leftLegHipOutDeg: 10,
    leftLegKneeBendDeg: 90,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 75,
    rightLegHipOutDeg: 10,
    rightLegKneeBendDeg: 90,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.55,
    pelvisPitchDeg: 15,
    pelvisRollDeg: 0,
  },
  all_fours_rear_presentation: {
    basePose: 'all_fours_rear_presentation',
    torsoLeanDeg: -8,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 5,
    leftArmShoulderForwardDeg: 80,
    leftArmShoulderOutDeg: 20,
    leftArmElbowBendDeg: 5,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: 80,
    rightArmShoulderOutDeg: 20,
    rightArmElbowBendDeg: 5,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 70,
    leftLegHipOutDeg: 18,
    leftLegKneeBendDeg: 85,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 70,
    rightLegHipOutDeg: 18,
    rightLegKneeBendDeg: 85,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.48,
    pelvisPitchDeg: -20,
    pelvisRollDeg: 0,
  },
  prone_hip_elevated: {
    basePose: 'prone_hip_elevated',
    torsoLeanDeg: -5,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: -10,
    leftArmShoulderForwardDeg: -20,
    leftArmShoulderOutDeg: 25,
    leftArmElbowBendDeg: 40,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: -20,
    rightArmShoulderOutDeg: 25,
    rightArmElbowBendDeg: 40,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 15,
    leftLegHipOutDeg: 10,
    leftLegKneeBendDeg: 20,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 15,
    rightLegHipOutDeg: 10,
    rightLegKneeBendDeg: 20,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.72,
    pelvisPitchDeg: -70,
    pelvisRollDeg: 0,
  },
  kneeling_forward_fold: {
    basePose: 'kneeling_forward_fold',
    torsoLeanDeg: 35,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: -15,
    leftArmShoulderForwardDeg: 40,
    leftArmShoulderOutDeg: 15,
    leftArmElbowBendDeg: 30,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: 40,
    rightArmShoulderOutDeg: 15,
    rightArmElbowBendDeg: 30,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 70,
    leftLegHipOutDeg: 12,
    leftLegKneeBendDeg: 110,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 70,
    rightLegHipOutDeg: 12,
    rightLegKneeBendDeg: 110,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.5,
    pelvisPitchDeg: 10,
    pelvisRollDeg: 0,
  },
  bent_over_support: {
    basePose: 'bent_over_support',
    torsoLeanDeg: 45,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: -5,
    leftArmShoulderForwardDeg: 60,
    leftArmShoulderOutDeg: 20,
    leftArmElbowBendDeg: 15,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: 60,
    rightArmShoulderOutDeg: 20,
    rightArmElbowBendDeg: 15,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 10,
    leftLegHipOutDeg: 8,
    leftLegKneeBendDeg: 15,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 10,
    rightLegHipOutDeg: 8,
    rightLegKneeBendDeg: 15,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.15,
    pelvisPitchDeg: 25,
    pelvisRollDeg: 0,
  },
  side_lying_open: {
    basePose: 'side_lying_open',
    torsoLeanDeg: 0,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 0,
    leftArmShoulderForwardDeg: 20,
    leftArmShoulderOutDeg: 30,
    leftArmElbowBendDeg: 50,
    leftArmWristDeg: 0,
    rightArmShoulderForwardDeg: 10,
    rightArmShoulderOutDeg: 15,
    rightArmElbowBendDeg: 40,
    rightArmWristDeg: 0,
    leftLegHipForwardDeg: 45,
    leftLegHipOutDeg: 35,
    leftLegKneeBendDeg: 70,
    leftFootAngleDeg: 0,
    rightLegHipForwardDeg: 10,
    rightLegHipOutDeg: 8,
    rightLegKneeBendDeg: 20,
    rightFootAngleDeg: 0,
    leftHandGesture: 'relaxed_natural',
    rightHandGesture: 'relaxed_natural',
    isWalking: false,
    isWaving: false,
    hipHeightOffset: -0.68,
    pelvisPitchDeg: 0,
    pelvisRollDeg: 80,
  },
};

export interface HandGestureTargetAngles {
  thumbCurl: number;
  thumbSpread: number;
  indexCurl: number;
  middleCurl: number;
  ringCurl: number;
  pinkyCurl: number;
  fingerSpread: number;
  wristPitch: number;
  wristRoll: number;
}

export type HandGestureArticulationTarget = HandGestureTargetAngles;

/**
 * Target finger curl angles and wrist orientation (in radians) for all 13 HandGesture values.
 * Shared between Playboard3DCanvas and tests.
 */
export function getHandGestureTargets(
  gesture: HandGesture,
  side: -1 | 1,
  time = 0
): HandGestureTargetAngles {
  switch (gesture) {
    case 'open_palm':
      return {
        thumbCurl: 0.05,
        thumbSpread: 0.45,
        indexCurl: 0.04,
        middleCurl: 0.03,
        ringCurl: 0.04,
        pinkyCurl: 0.06,
        fingerSpread: 0.14,
        wristPitch: -0.15,
        wristRoll: 0,
      };
    case 'wave':
      return {
        thumbCurl: 0.08,
        thumbSpread: 0.4,
        indexCurl: 0.06,
        middleCurl: 0.05,
        ringCurl: 0.07,
        pinkyCurl: 0.09,
        fingerSpread: 0.16,
        wristPitch: -0.1,
        wristRoll: Math.sin(time * 8.5) * 0.32,
      };
    case 'pointing':
      return {
        thumbCurl: 0.85,
        thumbSpread: -0.1,
        indexCurl: 0.02,
        middleCurl: 1.35,
        ringCurl: 1.42,
        pinkyCurl: 1.48,
        fingerSpread: 0.02,
        wristPitch: 0,
        wristRoll: 0,
      };
    case 'thumbs_up':
      return {
        thumbCurl: -0.15,
        thumbSpread: 0.65,
        indexCurl: 1.45,
        middleCurl: 1.48,
        ringCurl: 1.5,
        pinkyCurl: 1.52,
        fingerSpread: 0,
        wristPitch: 0.1,
        wristRoll: side * 0.6,
      };
    case 'fist':
      return {
        thumbCurl: 0.95,
        thumbSpread: -0.2,
        indexCurl: 1.48,
        middleCurl: 1.52,
        ringCurl: 1.54,
        pinkyCurl: 1.56,
        fingerSpread: 0,
        wristPitch: 0.08,
        wristRoll: 0,
      };
    case 'peace_sign':
      return {
        thumbCurl: 0.9,
        thumbSpread: -0.15,
        indexCurl: 0.03,
        middleCurl: 0.03,
        ringCurl: 1.4,
        pinkyCurl: 1.45,
        fingerSpread: 0.22,
        wristPitch: -0.08,
        wristRoll: 0,
      };
    case 'hand_on_hip':
      return {
        thumbCurl: 0.35,
        thumbSpread: 0.3,
        indexCurl: 0.55,
        middleCurl: 0.62,
        ringCurl: 0.68,
        pinkyCurl: 0.72,
        fingerSpread: 0.06,
        wristPitch: 0.45,
        wristRoll: side * -0.3,
      };
    case 'raised_up':
      return {
        thumbCurl: 0.12,
        thumbSpread: 0.35,
        indexCurl: 0.1,
        middleCurl: 0.08,
        ringCurl: 0.12,
        pinkyCurl: 0.16,
        fingerSpread: 0.12,
        wristPitch: -0.1,
        wristRoll: 0,
      };
    case 'hands_clasped':
      return {
        thumbCurl: 0.65,
        thumbSpread: 0.1,
        indexCurl: 1.05,
        middleCurl: 1.12,
        ringCurl: 1.16,
        pinkyCurl: 1.2,
        fingerSpread: 0.04,
        wristPitch: 0.2,
        wristRoll: side * 0.35,
      };
    case 'touching_face':
      return {
        thumbCurl: 0.25,
        thumbSpread: 0.25,
        indexCurl: 0.2,
        middleCurl: 0.48,
        ringCurl: 0.65,
        pinkyCurl: 0.78,
        fingerSpread: 0.06,
        wristPitch: -0.25,
        wristRoll: side * 0.25,
      };
    case 'soft_pinch_gap':
      return {
        thumbCurl: 0.15,
        thumbSpread: 0.35,
        indexCurl: 0.45,
        middleCurl: 0.52,
        ringCurl: 0.58,
        pinkyCurl: 0.65,
        fingerSpread: 0.04,
        wristPitch: -0.05,
        wristRoll: 0,
      };
    case 'cupped_palm_inward':
      return {
        thumbCurl: 0.2,
        thumbSpread: 0.18,
        indexCurl: 0.42,
        middleCurl: 0.48,
        ringCurl: 0.52,
        pinkyCurl: 0.56,
        fingerSpread: 0.02,
        wristPitch: 0.22,
        wristRoll: side * -0.3,
      };
    case 'relaxed_natural':
    default:
      return {
        thumbCurl: 0.28,
        thumbSpread: 0.22,
        indexCurl: 0.38,
        middleCurl: 0.46,
        ringCurl: 0.54,
        pinkyCurl: 0.62,
        fingerSpread: 0.05,
        wristPitch: 0,
        wristRoll: 0,
      };
  }
}

export interface SemanticCharacterRigPose {
  poseFamily:
    | 'standing'
    | 'locomotion'
    | 'sitting'
    | 'floor_sitting'
    | 'squatting'
    | 'kneeling_upright'
    | 'kneeling_fold'
    | 'quadruped'
    | 'prone'
    | 'supine_reclined'
    | 'side_lying'
    | 'bent_over';
  pelvisY: number;
  pelvisZOffset: number;
  pelvisPitchRad: number;
  pelvisYawRad: number;
  pelvisRollRad: number;
  spinePitchRad: number;
  spineYawRad: number;
  spineRollRad: number;
  chestPitchRad: number;
  chestYawRad: number;
  chestRollRad: number;
  neckPitchRad: number;
  neckYawRad: number;
  headPitchRad: number;
  headYawRad: number;
  leftShoulderPitchRad: number;
  leftShoulderRollRad: number;
  leftElbowPitchRad: number;
  leftWristSupportPitchRad: number | null;
  rightShoulderPitchRad: number;
  rightShoulderRollRad: number;
  rightElbowPitchRad: number;
  rightWristSupportPitchRad: number | null;
  leftHipPitchRad: number;
  leftHipRollRad: number;
  leftKneePitchRad: number;
  leftAnklePitchRad: number;
  leftAnkleYawRad: number;
  rightHipPitchRad: number;
  rightHipRollRad: number;
  rightKneePitchRad: number;
  rightAnklePitchRad: number;
  rightAnkleYawRad: number;
  requiresFloorHandContact: boolean;
  requiresFloorKneeContact: boolean;
}

function solveFloorSupportArmAngles(
  side: -1 | 1,
  shoulderY: number,
  clavicleWorldPitchRad: number,
  targetWristY: number,
  outDeg: number,
  userFwdDeltaDeg: number,
  userElbDeltaDeg: number,
  reachAngleOffsetRad = 0
): {
  shoulderPitchRad: number;
  shoulderRollRad: number;
  elbowPitchRad: number;
  wristSupportPitchRad: number;
} {
  const upperLen = 0.26;
  const lowerLen = 0.23;
  const clampedOutDeg = THREE.MathUtils.clamp(outDeg, 4, 38);
  const outRad = THREE.MathUtils.degToRad(clampedOutDeg);
  const cosOut = Math.max(0.82, Math.cos(outRad));

  const rawDropY = Math.max(0.14, shoulderY - targetWristY);
  const reachDist = THREE.MathUtils.clamp(rawDropY / cosOut, 0.16, upperLen + lowerLen - 0.004);

  const cosElbowInternal = THREE.MathUtils.clamp(
    (upperLen * upperLen + lowerLen * lowerLen - reachDist * reachDist) / (2 * upperLen * lowerLen),
    -1,
    1
  );
  const baseElbowBendRad = Math.PI - Math.acos(cosElbowInternal);
  const elbowBendRad = THREE.MathUtils.clamp(
    baseElbowBendRad + THREE.MathUtils.degToRad(userElbDeltaDeg * 0.35),
    0.05,
    2.45
  );
  const elbowPitchRad = -elbowBendRad;

  const cosBeta = THREE.MathUtils.clamp(
    (upperLen * upperLen + reachDist * reachDist - lowerLen * lowerLen) / (2 * upperLen * reachDist),
    -1,
    1
  );
  const beta = Math.acos(cosBeta);

  const upperWorldPitchRad =
    reachAngleOffsetRad + beta - THREE.MathUtils.degToRad(userFwdDeltaDeg * 0.45);
  const shoulderPitchRad = upperWorldPitchRad - clavicleWorldPitchRad;
  const shoulderRollRad = side * outRad;

  const forearmWorldPitchRad = upperWorldPitchRad + elbowPitchRad;
  const wristSupportPitchRad = -Math.PI / 2 - forearmWorldPitchRad;

  return {
    shoulderPitchRad,
    shoulderRollRad,
    elbowPitchRad,
    wristSupportPitchRad,
  };
}

/**
 * Semantic 3D character rig solver shared between Playboard3DCanvas.tsx and framingAnalyzer.ts.
 * Translates any PosePreset and user joint adjustments into anatomically coherent root/pelvis
 * height & orientation, multi-segment spine/chest curvature, floor-contact arm/leg kinematics,
 * and palm support orientation.
 */
export function resolveSemanticCharacterRigPose(
  rawPose: CharacterPose3DSettings,
  ikEnabled = true
): SemanticCharacterRigPose {
  const basePose = rawPose.basePose || 'natural_standing';
  const canonical = CANONICAL_POSE_PRESET_VALUES[basePose] || CANONICAL_POSE_PRESET_VALUES.natural_standing;

  // If a non-standing basePose was constructed with uninitialized standing defaults (e.g. in unit tests),
  // hydrate from its canonical preset definition while preserving any explicitly customized fields.
  const isUninitializedNonStanding =
    basePose !== 'natural_standing' &&
    !rawPose.interactionPresetId &&
    rawPose.leftLegKneeBendDeg === 4 &&
    rawPose.rightLegKneeBendDeg === 4 &&
    rawPose.leftLegHipForwardDeg === 0 &&
    rawPose.rightLegHipForwardDeg === 0 &&
    rawPose.hipHeightOffset === 0 &&
    rawPose.torsoLeanDeg === 0 &&
    (rawPose.pelvisPitchDeg ?? 0) === 0 &&
    (rawPose.pelvisRollDeg ?? 0) === 0;

  const pose: CharacterPose3DSettings = isUninitializedNonStanding
    ? {
        ...rawPose,
        ...canonical,
        characterPosX: rawPose.characterPosX,
        characterPosZ: rawPose.characterPosZ,
        characterYawDeg: rawPose.characterYawDeg,
        gaze: rawPose.gaze,
        expression: rawPose.expression,
        leftHandGesture:
          rawPose.leftHandGesture !== 'relaxed_natural'
            ? rawPose.leftHandGesture
            : (canonical.leftHandGesture ?? 'relaxed_natural'),
        rightHandGesture:
          rawPose.rightHandGesture !== 'relaxed_natural'
            ? rawPose.rightHandGesture
            : (canonical.rightHandGesture ?? 'relaxed_natural'),
      }
    : rawPose;

  const hasSeatHeight =
    typeof pose.seatHeightY === 'number' && Number.isFinite(pose.seatHeightY);
  const totalTwistRad = THREE.MathUtils.degToRad(pose.torsoTwistDeg || 0);
  const totalTiltRad = -THREE.MathUtils.degToRad(pose.torsoTiltDeg || 0);
  const headYawRad = THREE.MathUtils.degToRad(pose.headRotationDeg || 0);
  const lAnkleYawRad = THREE.MathUtils.degToRad(pose.leftFootAngleDeg || 0);
  const rAnkleYawRad = THREE.MathUtils.degToRad(pose.rightFootAngleDeg || 0);

  // ============================================================================
  // 1. QUADRUPED / ALL-FOURS POSE FAMILY
  // (all_fours_neutral, cat_pose_rounded, cow_pose_arched, all_fours_rear_presentation)
  // ============================================================================
  if (
    basePose === 'all_fours_neutral' ||
    basePose === 'cat_pose_rounded' ||
    basePose === 'cow_pose_arched' ||
    basePose === 'all_fours_rear_presentation'
  ) {
    const canonLean = canonical.torsoLeanDeg ?? 0;
    const canonPelvisPitch = canonical.pelvisPitchDeg ?? 0;
    const canonHeadTilt = canonical.headTiltDeg ?? 0;
    const canonHipOffset = canonical.hipHeightOffset ?? -0.55;
    const canonLArmFwd = canonical.leftArmShoulderForwardDeg ?? 70;
    const canonRArmFwd = canonical.rightArmShoulderForwardDeg ?? 70;
    const canonLElb = canonical.leftArmElbowBendDeg ?? 10;
    const canonRElb = canonical.rightArmElbowBendDeg ?? 10;
    const canonLHipFwd = canonical.leftLegHipForwardDeg ?? 80;
    const canonRHipFwd = canonical.rightLegHipForwardDeg ?? 80;
    const canonLKnee = canonical.leftLegKneeBendDeg ?? 90;
    const canonRKnee = canonical.rightLegKneeBendDeg ?? 90;

    const deltaLean = (pose.torsoLeanDeg ?? canonLean) - canonLean;
    const deltaPelvisPitch = (pose.pelvisPitchDeg ?? canonPelvisPitch) - canonPelvisPitch;
    const deltaHeadTilt = (pose.headTiltDeg ?? canonHeadTilt) - canonHeadTilt;
    const deltaHipOffset = (pose.hipHeightOffset ?? canonHipOffset) - canonHipOffset;

    let pelvisY = 0.468;
    let pelvisZOffset = -0.04;
    let pelvisPitchDeg = 88;
    let spinePitchDeg = 1;
    let chestPitchDeg = 1;
    let neckHeadPitchDeg = -16;
    let armReachOffsetRad = 0;

    if (basePose === 'all_fours_neutral') {
      pelvisY = 0.468 + deltaHipOffset * 0.25;
      pelvisZOffset = -0.04;
      pelvisPitchDeg = 88 + deltaPelvisPitch * 0.6;
      spinePitchDeg = 1 + deltaLean * 0.45;
      chestPitchDeg = 1 + deltaLean * 0.55;
      neckHeadPitchDeg = -16 - deltaHeadTilt;
    } else if (basePose === 'cat_pose_rounded') {
      // Posterior pelvic tuck (68°), high upward dorsal arch in mid-back (spine +4°, chest +38°), tucked head (+36°)
      pelvisY = 0.468 + deltaHipOffset * 0.25;
      pelvisZOffset = -0.04;
      pelvisPitchDeg = 68 - deltaPelvisPitch * 0.5;
      spinePitchDeg = 4 - deltaLean * 0.2;
      chestPitchDeg = 38 + deltaLean * 0.6;
      neckHeadPitchDeg = 36 - deltaHeadTilt;
    } else if (basePose === 'cow_pose_arched') {
      // Anterior pelvic tilt (108°), deep downward lumbar sag (chest drops low), lifted sternum & head (-46°)
      pelvisY = 0.472 + deltaHipOffset * 0.25;
      pelvisZOffset = -0.04;
      pelvisPitchDeg = 108 + deltaPelvisPitch * 0.5;
      spinePitchDeg = -2 + deltaLean * 0.35;
      chestPitchDeg = -22 + deltaLean * 0.5;
      neckHeadPitchDeg = -46 - deltaHeadTilt;
    } else {
      // all_fours_rear_presentation: hips elevated (0.475m) & shifted rearward (-0.11m), chest sloping down to 0.345m
      pelvisY = 0.475 + deltaHipOffset * 0.25;
      pelvisZOffset = -0.11;
      pelvisPitchDeg = 112 + deltaPelvisPitch * 0.5;
      spinePitchDeg = 4 + deltaLean * 0.4;
      chestPitchDeg = -10 + deltaLean * 0.5;
      neckHeadPitchDeg = -28 - deltaHeadTilt;
      armReachOffsetRad = -0.08;
    }

    if (hasSeatHeight) {
      pelvisY = pose.seatHeightY!;
    }
    pelvisY = Math.max(0.22, pelvisY);

    const pelvisPitchRad = THREE.MathUtils.degToRad(pelvisPitchDeg);
    const pelvisRollRad = THREE.MathUtils.degToRad(pose.pelvisRollDeg ?? 0);
    const spinePitchRad = THREE.MathUtils.degToRad(spinePitchDeg);
    const chestPitchRad = THREE.MathUtils.degToRad(chestPitchDeg);

    const neckHeadPitchRad = THREE.MathUtils.degToRad(neckHeadPitchDeg);
    const neckPitchRad = neckHeadPitchRad * 0.35;
    const headPitchRad = neckHeadPitchRad * 0.65;

    // Exact shoulder world Y for floor-contact arm solver
    const spineWorldPitch = pelvisPitchRad + spinePitchRad;
    const clavicleWorldPitch = spineWorldPitch + chestPitchRad;
    const spineY = pelvisY + 0.12 * Math.cos(pelvisPitchRad);
    const chestY = spineY + 0.18 * Math.cos(spineWorldPitch);
    const shoulderY = chestY + 0.19 * Math.cos(clavicleWorldPitch);

    const lArmSolved = solveFloorSupportArmAngles(
      -1,
      shoulderY,
      clavicleWorldPitch,
      0.042,
      pose.leftArmShoulderOutDeg ?? 12,
      (pose.leftArmShoulderForwardDeg ?? canonLArmFwd) - canonLArmFwd,
      (pose.leftArmElbowBendDeg ?? canonLElb) - canonLElb,
      armReachOffsetRad
    );
    const rArmSolved = solveFloorSupportArmAngles(
      1,
      shoulderY,
      clavicleWorldPitch,
      0.042,
      pose.rightArmShoulderOutDeg ?? 12,
      (pose.rightArmShoulderForwardDeg ?? canonRArmFwd) - canonRArmFwd,
      (pose.rightArmElbowBendDeg ?? canonRElb) - canonRElb,
      armReachOffsetRad
    );

    // Quadruped legs: knees grounded directly under hips (y ≈ 0.06m), shins flat along floor, ankles plantarflexed
    const hipY = pelvisY - 0.01 * Math.cos(pelvisPitchRad);
    const lHipOutRad = -THREE.MathUtils.degToRad(
      THREE.MathUtils.clamp(pose.leftLegHipOutDeg ?? 10, 0, 35)
    );
    const rHipOutRad = THREE.MathUtils.degToRad(
      THREE.MathUtils.clamp(pose.rightLegHipOutDeg ?? 10, 0, 35)
    );

    const baseThighWorldPitchRad = 0.0;
    const lUserHipDeltaRad = THREE.MathUtils.degToRad(
      ((pose.leftLegHipForwardDeg ?? canonLHipFwd) - canonLHipFwd) * 0.5
    );
    const rUserHipDeltaRad = THREE.MathUtils.degToRad(
      ((pose.rightLegHipForwardDeg ?? canonRHipFwd) - canonRHipFwd) * 0.5
    );

    const lThighWorldPitch = baseThighWorldPitchRad - lUserHipDeltaRad;
    const rThighWorldPitch = baseThighWorldPitchRad - rUserHipDeltaRad;

    const lHipPitchRad = lThighWorldPitch - pelvisPitchRad;
    const rHipPitchRad = rThighWorldPitch - pelvisPitchRad;

    const lUserKneeDeltaRad = THREE.MathUtils.degToRad(
      ((pose.leftLegKneeBendDeg ?? canonLKnee) - canonLKnee) * 0.5
    );
    const rUserKneeDeltaRad = THREE.MathUtils.degToRad(
      ((pose.rightLegKneeBendDeg ?? canonRKnee) - canonRKnee) * 0.5
    );

    const lKneePitchRad = Math.PI / 2 - lThighWorldPitch + lUserKneeDeltaRad;
    const rKneePitchRad = Math.PI / 2 - rThighWorldPitch + rUserKneeDeltaRad;

    // Plantarflexed ankle (+55° from horizontal shin -> +145° world pitch) so toes rest on floor at y ≈ 0.035m
    const lAnklePitchRad = THREE.MathUtils.degToRad(55);
    const rAnklePitchRad = THREE.MathUtils.degToRad(55);

    return {
      poseFamily: 'quadruped',
      pelvisY: Math.max(0.22, hipY > 0 ? pelvisY : 0.475),
      pelvisZOffset,
      pelvisPitchRad,
      pelvisYawRad: 0,
      pelvisRollRad,
      spinePitchRad,
      spineYawRad: totalTwistRad * 0.45,
      spineRollRad: totalTiltRad * 0.45,
      chestPitchRad,
      chestYawRad: totalTwistRad * 0.55,
      chestRollRad: totalTiltRad * 0.55,
      neckPitchRad,
      neckYawRad: headYawRad * 0.3,
      headPitchRad,
      headYawRad: headYawRad * 0.7,
      leftShoulderPitchRad: lArmSolved.shoulderPitchRad,
      leftShoulderRollRad: lArmSolved.shoulderRollRad,
      leftElbowPitchRad: lArmSolved.elbowPitchRad,
      leftWristSupportPitchRad: lArmSolved.wristSupportPitchRad,
      rightShoulderPitchRad: rArmSolved.shoulderPitchRad,
      rightShoulderRollRad: rArmSolved.shoulderRollRad,
      rightElbowPitchRad: rArmSolved.elbowPitchRad,
      rightWristSupportPitchRad: rArmSolved.wristSupportPitchRad,
      leftHipPitchRad: lHipPitchRad,
      leftHipRollRad: lHipOutRad,
      leftKneePitchRad: lKneePitchRad,
      leftAnklePitchRad: lAnklePitchRad,
      leftAnkleYawRad: lAnkleYawRad,
      rightHipPitchRad: rHipPitchRad,
      rightHipRollRad: rHipOutRad,
      rightKneePitchRad: rKneePitchRad,
      rightAnklePitchRad: rAnklePitchRad,
      rightAnkleYawRad: rAnkleYawRad,
      requiresFloorHandContact: true,
      requiresFloorKneeContact: true,
    };
  }

  // ============================================================================
  // 2. PRONE HIP ELEVATED (Lying stomach-down with hips slightly elevated)
  // ============================================================================
  if (basePose === 'prone_hip_elevated') {
    const canonLean = canonical.torsoLeanDeg ?? -5;
    const canonHeadTilt = canonical.headTiltDeg ?? -10;
    const canonHipOffset = canonical.hipHeightOffset ?? -0.72;
    const deltaLean = (pose.torsoLeanDeg ?? canonLean) - canonLean;
    const deltaHeadTilt = (pose.headTiltDeg ?? canonHeadTilt) - canonHeadTilt;
    const deltaHipOffset = (pose.hipHeightOffset ?? canonHipOffset) - canonHipOffset;

    const pelvisY = hasSeatHeight
      ? pose.seatHeightY!
      : Math.max(0.16, 0.235 + deltaHipOffset * 0.25);
    const pelvisZOffset = -0.08;
    const pelvisPitchRad = THREE.MathUtils.degToRad(104);
    const pelvisRollRad = THREE.MathUtils.degToRad(pose.pelvisRollDeg ?? 0);

    const spinePitchRad = THREE.MathUtils.degToRad(-2 + deltaLean * 0.4);
    const chestPitchRad = THREE.MathUtils.degToRad(-18 + deltaLean * 0.5);
    const neckHeadPitchRad = THREE.MathUtils.degToRad(-22 - deltaHeadTilt);

    const spineWorldPitch = pelvisPitchRad + spinePitchRad;
    const clavicleWorldPitch = spineWorldPitch + chestPitchRad;
    const spineY = pelvisY + 0.12 * Math.cos(pelvisPitchRad);
    const chestY = spineY + 0.18 * Math.cos(spineWorldPitch);
    const shoulderY = chestY + 0.19 * Math.cos(clavicleWorldPitch);

    const lArmSolved = solveFloorSupportArmAngles(
      -1,
      shoulderY,
      clavicleWorldPitch,
      0.042,
      pose.leftArmShoulderOutDeg ?? 25,
      (pose.leftArmShoulderForwardDeg ?? -20) - -20,
      (pose.leftArmElbowBendDeg ?? 40) - 40,
      -0.05
    );
    const rArmSolved = solveFloorSupportArmAngles(
      1,
      shoulderY,
      clavicleWorldPitch,
      0.042,
      pose.rightArmShoulderOutDeg ?? 25,
      (pose.rightArmShoulderForwardDeg ?? -20) - -20,
      (pose.rightArmElbowBendDeg ?? 40) - 40,
      -0.05
    );

    // Thighs slope gently rearward/downward from elevated pelvis (0.235m) to floor knees (0.058m)
    const thighWorldPitch = THREE.MathUtils.degToRad(66);
    const lHipPitchRad = thighWorldPitch - pelvisPitchRad;
    const rHipPitchRad = thighWorldPitch - pelvisPitchRad;
    const lKneePitchRad = Math.PI / 2 - thighWorldPitch;
    const rKneePitchRad = Math.PI / 2 - thighWorldPitch;
    const anklePitchRad = THREE.MathUtils.degToRad(55);

    return {
      poseFamily: 'prone',
      pelvisY,
      pelvisZOffset,
      pelvisPitchRad,
      pelvisYawRad: 0,
      pelvisRollRad,
      spinePitchRad,
      spineYawRad: totalTwistRad * 0.45,
      spineRollRad: totalTiltRad * 0.45,
      chestPitchRad,
      chestYawRad: totalTwistRad * 0.55,
      chestRollRad: totalTiltRad * 0.55,
      neckPitchRad: neckHeadPitchRad * 0.35,
      neckYawRad: headYawRad * 0.3,
      headPitchRad: neckHeadPitchRad * 0.65,
      headYawRad: headYawRad * 0.7,
      leftShoulderPitchRad: lArmSolved.shoulderPitchRad,
      leftShoulderRollRad: lArmSolved.shoulderRollRad,
      leftElbowPitchRad: lArmSolved.elbowPitchRad,
      leftWristSupportPitchRad: lArmSolved.wristSupportPitchRad,
      rightShoulderPitchRad: rArmSolved.shoulderPitchRad,
      rightShoulderRollRad: rArmSolved.shoulderRollRad,
      rightElbowPitchRad: rArmSolved.elbowPitchRad,
      rightWristSupportPitchRad: rArmSolved.wristSupportPitchRad,
      leftHipPitchRad: lHipPitchRad,
      leftHipRollRad: -THREE.MathUtils.degToRad(pose.leftLegHipOutDeg ?? 10),
      leftKneePitchRad: lKneePitchRad,
      leftAnklePitchRad: anklePitchRad,
      leftAnkleYawRad: lAnkleYawRad,
      rightHipPitchRad: rHipPitchRad,
      rightHipRollRad: THREE.MathUtils.degToRad(pose.rightLegHipOutDeg ?? 10),
      rightKneePitchRad: rKneePitchRad,
      rightAnklePitchRad: anklePitchRad,
      rightAnkleYawRad: rAnkleYawRad,
      requiresFloorHandContact: true,
      requiresFloorKneeContact: true,
    };
  }

  // ============================================================================
  // 3. KNEELING FORWARD FOLD (Kneeling with torso folded forward over thighs)
  // ============================================================================
  if (basePose === 'kneeling_forward_fold') {
    const canonLean = canonical.torsoLeanDeg ?? 35;
    const canonPelvisPitch = canonical.pelvisPitchDeg ?? 10;
    const canonHeadTilt = canonical.headTiltDeg ?? -15;
    const canonHipOffset = canonical.hipHeightOffset ?? -0.5;

    const deltaLean = (pose.torsoLeanDeg ?? canonLean) - canonLean;
    const deltaPelvisPitch = (pose.pelvisPitchDeg ?? canonPelvisPitch) - canonPelvisPitch;
    const deltaHeadTilt = (pose.headTiltDeg ?? canonHeadTilt) - canonHeadTilt;
    const deltaHipOffset = (pose.hipHeightOffset ?? canonHipOffset) - canonHipOffset;

    const pelvisY = hasSeatHeight
      ? pose.seatHeightY!
      : Math.max(0.16, 0.22 + deltaHipOffset * 0.25);
    const pelvisZOffset = -0.14;
    const pelvisPitchRad = THREE.MathUtils.degToRad(72 + deltaPelvisPitch);
    const pelvisRollRad = THREE.MathUtils.degToRad(pose.pelvisRollDeg ?? 0);

    const spinePitchRad = THREE.MathUtils.degToRad(12 + deltaLean * 0.45);
    const chestPitchRad = THREE.MathUtils.degToRad(16 + deltaLean * 0.55);
    const neckHeadPitchRad = THREE.MathUtils.degToRad(16 - deltaHeadTilt);

    const spineWorldPitch = pelvisPitchRad + spinePitchRad;
    const clavicleWorldPitch = spineWorldPitch + chestPitchRad;
    const spineY = pelvisY + 0.12 * Math.cos(pelvisPitchRad);
    const chestY = spineY + 0.18 * Math.cos(spineWorldPitch);
    const shoulderY = chestY + 0.19 * Math.cos(clavicleWorldPitch);

    const lArmSolved = solveFloorSupportArmAngles(
      -1,
      shoulderY,
      clavicleWorldPitch,
      0.042,
      pose.leftArmShoulderOutDeg ?? 15,
      (pose.leftArmShoulderForwardDeg ?? 40) - 40,
      (pose.leftArmElbowBendDeg ?? 30) - 30,
      -0.25
    );
    const rArmSolved = solveFloorSupportArmAngles(
      1,
      shoulderY,
      clavicleWorldPitch,
      0.042,
      pose.rightArmShoulderOutDeg ?? 15,
      (pose.rightArmShoulderForwardDeg ?? 40) - 40,
      (pose.rightArmElbowBendDeg ?? 30) - 30,
      -0.25
    );

    // Thighs reach forward from low folded hips (0.22m) to knees on floor (0.06m), shins folded back under hips
    const thighWorldPitch = THREE.MathUtils.degToRad(-68);
    const lHipPitchRad = thighWorldPitch - pelvisPitchRad;
    const rHipPitchRad = thighWorldPitch - pelvisPitchRad;
    const lKneePitchRad = Math.PI / 2 - thighWorldPitch;
    const rKneePitchRad = Math.PI / 2 - thighWorldPitch;
    const anklePitchRad = THREE.MathUtils.degToRad(55);

    return {
      poseFamily: 'kneeling_fold',
      pelvisY,
      pelvisZOffset,
      pelvisPitchRad,
      pelvisYawRad: 0,
      pelvisRollRad,
      spinePitchRad,
      spineYawRad: totalTwistRad * 0.45,
      spineRollRad: totalTiltRad * 0.45,
      chestPitchRad,
      chestYawRad: totalTwistRad * 0.55,
      chestRollRad: totalTiltRad * 0.55,
      neckPitchRad: neckHeadPitchRad * 0.35,
      neckYawRad: headYawRad * 0.3,
      headPitchRad: neckHeadPitchRad * 0.65,
      headYawRad: headYawRad * 0.7,
      leftShoulderPitchRad: lArmSolved.shoulderPitchRad,
      leftShoulderRollRad: lArmSolved.shoulderRollRad,
      leftElbowPitchRad: lArmSolved.elbowPitchRad,
      leftWristSupportPitchRad: lArmSolved.wristSupportPitchRad,
      rightShoulderPitchRad: rArmSolved.shoulderPitchRad,
      rightShoulderRollRad: rArmSolved.shoulderRollRad,
      rightElbowPitchRad: rArmSolved.elbowPitchRad,
      rightWristSupportPitchRad: rArmSolved.wristSupportPitchRad,
      leftHipPitchRad: lHipPitchRad,
      leftHipRollRad: -THREE.MathUtils.degToRad(pose.leftLegHipOutDeg ?? 12),
      leftKneePitchRad: lKneePitchRad,
      leftAnklePitchRad: anklePitchRad,
      leftAnkleYawRad: lAnkleYawRad,
      rightHipPitchRad: rHipPitchRad,
      rightHipRollRad: THREE.MathUtils.degToRad(pose.rightLegHipOutDeg ?? 12),
      rightKneePitchRad: rKneePitchRad,
      rightAnklePitchRad: anklePitchRad,
      rightAnkleYawRad: rAnkleYawRad,
      requiresFloorHandContact: true,
      requiresFloorKneeContact: true,
    };
  }

  // ============================================================================
  // 4. BENT-OVER SUPPORT (Standing feet on floor, hinged forward at waist, hands supporting)
  // ============================================================================
  if (basePose === 'bent_over_support') {
    const canonLean = canonical.torsoLeanDeg ?? 45;
    const canonPelvisPitch = canonical.pelvisPitchDeg ?? 25;
    const canonHeadTilt = canonical.headTiltDeg ?? -5;
    const canonHipOffset = canonical.hipHeightOffset ?? -0.15;

    const deltaLean = (pose.torsoLeanDeg ?? canonLean) - canonLean;
    const deltaPelvisPitch = (pose.pelvisPitchDeg ?? canonPelvisPitch) - canonPelvisPitch;
    const deltaHeadTilt = (pose.headTiltDeg ?? canonHeadTilt) - canonHeadTilt;
    const deltaHipOffset = (pose.hipHeightOffset ?? canonHipOffset) - canonHipOffset;

    const pelvisY = hasSeatHeight
      ? pose.seatHeightY!
      : Math.max(0.55, 0.82 + deltaHipOffset * 0.25);
    const pelvisZOffset = -0.08;
    const pelvisPitchRad = THREE.MathUtils.degToRad(64 + deltaPelvisPitch);
    const pelvisRollRad = THREE.MathUtils.degToRad(pose.pelvisRollDeg ?? 0);

    const spinePitchRad = THREE.MathUtils.degToRad(18 + deltaLean * 0.45);
    const chestPitchRad = THREE.MathUtils.degToRad(22 + deltaLean * 0.55);
    const neckHeadPitchRad = THREE.MathUtils.degToRad(-28 - deltaHeadTilt);

    const spineWorldPitch = pelvisPitchRad + spinePitchRad;
    const clavicleWorldPitch = spineWorldPitch + chestPitchRad;
    const spineY = pelvisY + 0.12 * Math.cos(pelvisPitchRad);
    const chestY = spineY + 0.18 * Math.cos(spineWorldPitch);
    const shoulderY = chestY + 0.19 * Math.cos(clavicleWorldPitch);

    // Hands support on a surface at waist/table height (~0.45m) in front of the hinged torso
    const lArmSolved = solveFloorSupportArmAngles(
      -1,
      shoulderY,
      clavicleWorldPitch,
      0.45,
      pose.leftArmShoulderOutDeg ?? 20,
      (pose.leftArmShoulderForwardDeg ?? 60) - 60,
      (pose.leftArmElbowBendDeg ?? 15) - 15,
      -0.12
    );
    const rArmSolved = solveFloorSupportArmAngles(
      1,
      shoulderY,
      clavicleWorldPitch,
      0.45,
      pose.rightArmShoulderOutDeg ?? 20,
      (pose.rightArmShoulderForwardDeg ?? 60) - 60,
      (pose.rightArmElbowBendDeg ?? 15) - 15,
      -0.12
    );

    // Legs remain standing on the floor with slight knee bend (compensated for forward pelvic hinge)
    const lThighWorldPitch = -THREE.MathUtils.degToRad(pose.leftLegHipForwardDeg ?? 10);
    const rThighWorldPitch = -THREE.MathUtils.degToRad(pose.rightLegHipForwardDeg ?? 10);
    const lHipPitchRad = lThighWorldPitch - pelvisPitchRad;
    const rHipPitchRad = rThighWorldPitch - pelvisPitchRad;
    const lKneePitchRad = THREE.MathUtils.degToRad(pose.leftLegKneeBendDeg ?? 15);
    const rKneePitchRad = THREE.MathUtils.degToRad(pose.rightLegKneeBendDeg ?? 15);
    const lAnklePitchRad = -(lThighWorldPitch + lKneePitchRad);
    const rAnklePitchRad = -(rThighWorldPitch + rKneePitchRad);

    return {
      poseFamily: 'bent_over',
      pelvisY,
      pelvisZOffset,
      pelvisPitchRad,
      pelvisYawRad: 0,
      pelvisRollRad,
      spinePitchRad,
      spineYawRad: totalTwistRad * 0.45,
      spineRollRad: totalTiltRad * 0.45,
      chestPitchRad,
      chestYawRad: totalTwistRad * 0.55,
      chestRollRad: totalTiltRad * 0.55,
      neckPitchRad: neckHeadPitchRad * 0.35,
      neckYawRad: headYawRad * 0.3,
      headPitchRad: neckHeadPitchRad * 0.65,
      headYawRad: headYawRad * 0.7,
      leftShoulderPitchRad: lArmSolved.shoulderPitchRad,
      leftShoulderRollRad: lArmSolved.shoulderRollRad,
      leftElbowPitchRad: lArmSolved.elbowPitchRad,
      leftWristSupportPitchRad: lArmSolved.wristSupportPitchRad,
      rightShoulderPitchRad: rArmSolved.shoulderPitchRad,
      rightShoulderRollRad: rArmSolved.shoulderRollRad,
      rightElbowPitchRad: rArmSolved.elbowPitchRad,
      rightWristSupportPitchRad: rArmSolved.wristSupportPitchRad,
      leftHipPitchRad: lHipPitchRad,
      leftHipRollRad: -THREE.MathUtils.degToRad(pose.leftLegHipOutDeg ?? 8),
      leftKneePitchRad: lKneePitchRad,
      leftAnklePitchRad: lAnklePitchRad,
      leftAnkleYawRad: lAnkleYawRad,
      rightHipPitchRad: rHipPitchRad,
      rightHipRollRad: THREE.MathUtils.degToRad(pose.rightLegHipOutDeg ?? 8),
      rightKneePitchRad: rKneePitchRad,
      rightAnklePitchRad: rAnklePitchRad,
      rightAnkleYawRad: rAnkleYawRad,
      requiresFloorHandContact: false,
      requiresFloorKneeContact: false,
    };
  }

  // ============================================================================
  // 5. SIDE-LYING OPEN (Lying horizontally on one side with top leg bent/opened)
  // ============================================================================
  if (basePose === 'side_lying_open') {
    const canonHipOffset = canonical.hipHeightOffset ?? -0.68;
    const deltaHipOffset = (pose.hipHeightOffset ?? canonHipOffset) - canonHipOffset;
    const pelvisY = hasSeatHeight
      ? pose.seatHeightY!
      : Math.max(0.12, 0.155 + deltaHipOffset * 0.25);

    // Roll -82° around Z so right hip/side rests on the floor and left hip/leg is on top
    const rawRoll = pose.pelvisRollDeg !== undefined && pose.pelvisRollDeg !== 0 ? pose.pelvisRollDeg : 80;
    const pelvisRollRad = -THREE.MathUtils.degToRad(Math.abs(rawRoll));
    const pelvisPitchRad = THREE.MathUtils.degToRad(pose.pelvisPitchDeg ?? 0);

    const totalLeanRad = THREE.MathUtils.degToRad(pose.torsoLeanDeg || 0);
    const spinePitchRad = totalLeanRad * 0.45;
    const chestPitchRad = totalLeanRad * 0.55;
    // Slight upward lateral curve of ribcage so upper shoulder/head stay propped cleanly above floor
    const spineRollRad = THREE.MathUtils.degToRad(6) + totalTiltRad * 0.45;
    const chestRollRad = THREE.MathUtils.degToRad(8) + totalTiltRad * 0.55;

    const headPitchRadTotal = -THREE.MathUtils.degToRad(pose.headTiltDeg || 0);

    // Top leg (leftLeg) opens upward (-Z roll rotates thigh toward -X_pelvis = +Y_world) and bends
    const lHipPitchRad = -THREE.MathUtils.degToRad(pose.leftLegHipForwardDeg ?? 45);
    const lHipRollRad = -THREE.MathUtils.degToRad(pose.leftLegHipOutDeg ?? 35);
    const lKneePitchRad = THREE.MathUtils.degToRad(pose.leftLegKneeBendDeg ?? 70);

    // Bottom leg (rightLeg) rests along floor
    const rHipPitchRad = -THREE.MathUtils.degToRad(pose.rightLegHipForwardDeg ?? 10);
    const rHipRollRad = THREE.MathUtils.degToRad(4);
    const rKneePitchRad = THREE.MathUtils.degToRad(pose.rightLegKneeBendDeg ?? 20);

    return {
      poseFamily: 'side_lying',
      pelvisY,
      pelvisZOffset: 0,
      pelvisPitchRad,
      pelvisYawRad: 0,
      pelvisRollRad,
      spinePitchRad,
      spineYawRad: totalTwistRad * 0.45,
      spineRollRad,
      chestPitchRad,
      chestYawRad: totalTwistRad * 0.55,
      chestRollRad,
      neckPitchRad: headPitchRadTotal * 0.3,
      neckYawRad: headYawRad * 0.3,
      headPitchRad: headPitchRadTotal * 0.7,
      headYawRad: headYawRad * 0.7,
      leftShoulderPitchRad: -THREE.MathUtils.degToRad(pose.leftArmShoulderForwardDeg ?? 20),
      leftShoulderRollRad: -THREE.MathUtils.degToRad(pose.leftArmShoulderOutDeg ?? 30),
      leftElbowPitchRad: -THREE.MathUtils.degToRad(pose.leftArmElbowBendDeg ?? 50),
      leftWristSupportPitchRad: null,
      rightShoulderPitchRad: -THREE.MathUtils.degToRad(pose.rightArmShoulderForwardDeg ?? 10),
      rightShoulderRollRad: THREE.MathUtils.degToRad(pose.rightArmShoulderOutDeg ?? 15),
      rightElbowPitchRad: -THREE.MathUtils.degToRad(pose.rightArmElbowBendDeg ?? 40),
      rightWristSupportPitchRad: null,
      leftHipPitchRad: lHipPitchRad,
      leftHipRollRad: lHipRollRad,
      leftKneePitchRad: lKneePitchRad,
      leftAnklePitchRad: -lKneePitchRad * 0.22 - lHipPitchRad * 0.35,
      leftAnkleYawRad: lAnkleYawRad,
      rightHipPitchRad: rHipPitchRad,
      rightHipRollRad: rHipRollRad,
      rightKneePitchRad: rKneePitchRad,
      rightAnklePitchRad: -rKneePitchRad * 0.22 - rHipPitchRad * 0.35,
      rightAnkleYawRad: rAnkleYawRad,
      requiresFloorHandContact: false,
      requiresFloorKneeContact: false,
    };
  }

  // ============================================================================
  // 6. STANDARD / EXISTING POSES (Standing, Locomotion, Sitting, Squat, Kneeling, Reclined)
  // ============================================================================
  let lArmFwd = pose.leftArmShoulderForwardDeg;
  let lArmOut = pose.leftArmShoulderOutDeg;
  let lElbow = pose.leftArmElbowBendDeg;

  let rArmFwd = pose.rightArmShoulderForwardDeg;
  let rArmOut = pose.rightArmShoulderOutDeg;
  let rElbow = pose.rightArmElbowBendDeg;

  if (ikEnabled) {
    const shoulderLeftPos = new THREE.Vector3(-0.195, 0.43, 0);
    if (pose.leftHandGesture === 'hand_on_hip') {
      const s = solveCharacterArmIK(-1, shoulderLeftPos, new THREE.Vector3(-0.17, 0.06, 0.04));
      lArmFwd = s.forwardDeg;
      lArmOut = s.outDeg;
      lElbow = s.elbowDeg;
    } else if (pose.leftHandGesture === 'touching_face') {
      const s = solveCharacterArmIK(-1, shoulderLeftPos, new THREE.Vector3(-0.06, 0.56, 0.14));
      lArmFwd = s.forwardDeg;
      lArmOut = s.outDeg;
      lElbow = s.elbowDeg;
    } else if (pose.leftHandGesture === 'hands_clasped') {
      const s = solveCharacterArmIK(-1, shoulderLeftPos, new THREE.Vector3(-0.03, 0.16, 0.17));
      lArmFwd = s.forwardDeg;
      lArmOut = s.outDeg;
      lElbow = s.elbowDeg;
    }

    const shoulderRightPos = new THREE.Vector3(0.195, 0.43, 0);
    if (pose.rightHandGesture === 'hand_on_hip') {
      const s = solveCharacterArmIK(1, shoulderRightPos, new THREE.Vector3(0.17, 0.06, 0.04));
      rArmFwd = s.forwardDeg;
      rArmOut = s.outDeg;
      rElbow = s.elbowDeg;
    } else if (pose.rightHandGesture === 'touching_face') {
      const s = solveCharacterArmIK(1, shoulderRightPos, new THREE.Vector3(0.06, 0.56, 0.14));
      rArmFwd = s.forwardDeg;
      rArmOut = s.outDeg;
      rElbow = s.elbowDeg;
    } else if (pose.rightHandGesture === 'hands_clasped') {
      const s = solveCharacterArmIK(1, shoulderRightPos, new THREE.Vector3(0.03, 0.16, 0.17));
      rArmFwd = s.forwardDeg;
      rArmOut = s.outDeg;
      rElbow = s.elbowDeg;
    }
  }

  let lHipFwdRad = -THREE.MathUtils.degToRad(pose.leftLegHipForwardDeg || 0);
  const lHipOutRad = -THREE.MathUtils.degToRad(pose.leftLegHipOutDeg || 0);
  let lKneeRad = THREE.MathUtils.degToRad(pose.leftLegKneeBendDeg || 0);

  let rHipFwdRad = -THREE.MathUtils.degToRad(pose.rightLegHipForwardDeg || 0);
  const rHipOutRad = THREE.MathUtils.degToRad(pose.rightLegHipOutDeg || 0);
  let rKneeRad = THREE.MathUtils.degToRad(pose.rightLegKneeBendDeg || 0);

  let lAnklePitchRad = -lKneeRad * 0.22 - lHipFwdRad * 0.35;
  let rAnklePitchRad = -rKneeRad * 0.22 - rHipFwdRad * 0.35;

  const lFootDrop =
    0.41 * Math.cos(lHipFwdRad) * Math.cos(lHipOutRad) +
    0.39 * Math.cos(lHipFwdRad + lKneeRad) +
    0.085;
  const rFootDrop =
    0.41 * Math.cos(rHipFwdRad) * Math.cos(rHipOutRad) +
    0.39 * Math.cos(rHipFwdRad + rKneeRad) +
    0.085;

  const standingPelvisY = Math.max(0.18, lFootDrop, rFootDrop);
  let pelvisY = Math.max(0.14, standingPelvisY + (pose.hipHeightOffset || 0) * 0.25);

  if (hasSeatHeight) {
    pelvisY = pose.seatHeightY!;
  } else if (basePose === 'floor_seated_cross_legged') {
    pelvisY = 0.16;
  } else if (basePose === 'reclined_lying') {
    pelvisY = 0.18;
  } else if (basePose === 'grounded_kneeling' && !pose.interactionPresetId) {
    // Standalone grounded_kneeling (half-kneeling with right knee on floor y≈0.055m and left foot planted on floor)
    const deltaHipOffset = (pose.hipHeightOffset ?? -0.42) - -0.42;
    pelvisY = Math.max(0.24, 0.46 + deltaHipOffset * 0.25);
    rHipFwdRad = THREE.MathUtils.degToRad(4);
    rKneeRad = THREE.MathUtils.degToRad(94);
    rAnklePitchRad = THREE.MathUtils.degToRad(55);
    lHipFwdRad = -THREE.MathUtils.degToRad(pose.leftLegHipForwardDeg ?? 60);
    lKneeRad = THREE.MathUtils.degToRad(74);
    lAnklePitchRad = -(lHipFwdRad + lKneeRad);
  } else if (basePose === 'deep_squat' && !pose.interactionPresetId) {
    const deltaHipOffset = (pose.hipHeightOffset ?? -0.48) - -0.48;
    pelvisY = Math.max(0.22, 0.38 + deltaHipOffset * 0.25);
  }

  const targetPelvisPitch =
    pose.pelvisPitchDeg !== undefined && pose.pelvisPitchDeg !== 0
      ? THREE.MathUtils.degToRad(pose.pelvisPitchDeg)
      : basePose === 'reclined_lying'
      ? -Math.PI * 0.42
      : 0;
  const targetPelvisRoll = THREE.MathUtils.degToRad(pose.pelvisRollDeg ?? 0);

  const totalLeanRad = THREE.MathUtils.degToRad(pose.torsoLeanDeg || 0);
  const headPitchRad = -THREE.MathUtils.degToRad(pose.headTiltDeg || 0);

  const rShoulderPitchRad = pose.isWaving ? -0.35 : -THREE.MathUtils.degToRad(rArmFwd);
  const rShoulderRollRad = pose.isWaving ? 1.32 : THREE.MathUtils.degToRad(rArmOut);
  const rElbowPitchRad = pose.isWaving ? -1.45 : -THREE.MathUtils.degToRad(rElbow);

  const poseFamily: SemanticCharacterRigPose['poseFamily'] =
    basePose === 'mid_stride_walking' || basePose === 'dynamic_running' || pose.isWalking
      ? 'locomotion'
      : basePose === 'casual_sitting'
      ? 'sitting'
      : basePose === 'floor_seated_cross_legged'
      ? 'floor_sitting'
      : basePose === 'deep_squat'
      ? 'squatting'
      : basePose === 'grounded_kneeling'
      ? 'kneeling_upright'
      : basePose === 'reclined_lying'
      ? 'supine_reclined'
      : 'standing';

  return {
    poseFamily,
    pelvisY,
    pelvisZOffset: 0,
    pelvisPitchRad: targetPelvisPitch,
    pelvisYawRad: 0,
    pelvisRollRad: targetPelvisRoll,
    spinePitchRad: totalLeanRad * 0.45,
    spineYawRad: totalTwistRad * 0.45,
    spineRollRad: totalTiltRad * 0.45,
    chestPitchRad: totalLeanRad * 0.55,
    chestYawRad: totalTwistRad * 0.55,
    chestRollRad: totalTiltRad * 0.55,
    neckPitchRad: headPitchRad * 0.3,
    neckYawRad: headYawRad * 0.3,
    headPitchRad: headPitchRad * 0.7,
    headYawRad: headYawRad * 0.7,
    leftShoulderPitchRad: -THREE.MathUtils.degToRad(lArmFwd),
    leftShoulderRollRad: -THREE.MathUtils.degToRad(lArmOut),
    leftElbowPitchRad: -THREE.MathUtils.degToRad(lElbow),
    leftWristSupportPitchRad: null,
    rightShoulderPitchRad: rShoulderPitchRad,
    rightShoulderRollRad: rShoulderRollRad,
    rightElbowPitchRad: rElbowPitchRad,
    rightWristSupportPitchRad: null,
    leftHipPitchRad: lHipFwdRad,
    leftHipRollRad: lHipOutRad,
    leftKneePitchRad: lKneeRad,
    leftAnklePitchRad: lAnklePitchRad,
    leftAnkleYawRad: lAnkleYawRad,
    rightHipPitchRad: rHipFwdRad,
    rightHipRollRad: rHipOutRad,
    rightKneePitchRad: rKneeRad,
    rightAnklePitchRad: rAnklePitchRad,
    rightAnkleYawRad: rAnkleYawRad,
    requiresFloorHandContact: false,
    requiresFloorKneeContact: basePose === 'grounded_kneeling',
  };
}

/**
 * Computes the character's pelvis world Y elevation from the current pose settings,
 * matching Playboard3DCanvas's ground-contact solver and furniture seat heights.
 */
export function computeCharacterPelvisWorldY(pose: CharacterPose3DSettings): number {
  return resolveSemanticCharacterRigPose(pose, true).pelvisY;
}

export interface ComputedCameraTransform {
  cameraPos: THREE.Vector3;
  lookTarget: THREE.Vector3;
  fovDeg: number;
  numericAspect: number;
  rollRad: number;
}

export const NEUTRAL_CAMERA_REFERENCE_HEIGHT = 1.1;

export const FRAMING_PRESET_DISTANCES: Record<ShotFraming, number> = {
  extreme_close_up: 1.0,
  close_up_portrait: 1.08,
  medium_close_up: 1.25,
  medium_shot: 1.55,
  three_quarter_shot: 2.1,
  full_shot: 3.1,
  wide_shot: 5.2,
};

export interface ResolvedCameraTargetXZ {
  targetX: number;
  targetZ: number;
  effectiveMode: CameraTargetMode;
}

/**
 * Single source of truth for resolving the camera's horizontal (X, Z) look-target anchor
 * across Playboard3DCanvas, framingAnalyzer, and prompt generation.
 *
 * - 'track_subject': Camera orbits/tracks the subject's current world position (characterPosX, characterPosZ).
 * - 'fixed_composition': Camera orbits/looks at a fixed scene composition anchor (anchorPosX, anchorPosZ),
 *   allowing the subject to move off-center through the frame via the blue movement joystick.
 * - If camera.targetMode is omitted (legacy configs), defaults to 'fixed_composition' if explicit numeric
 *   anchorPosX/anchorPosZ are present, otherwise 'track_subject'.
 */
export function resolvePlayboardCameraTargetXZ(
  camera: Pick<Camera3DSettings, 'targetMode'>,
  pose: Pick<CharacterPose3DSettings, 'characterPosX' | 'characterPosZ' | 'anchorPosX' | 'anchorPosZ'>
): ResolvedCameraTargetXZ {
  const charX =
    typeof pose.characterPosX === 'number' && Number.isFinite(pose.characterPosX)
      ? pose.characterPosX
      : 0;
  const charZ =
    typeof pose.characterPosZ === 'number' && Number.isFinite(pose.characterPosZ)
      ? pose.characterPosZ
      : 0;
  const hasExplicitAnchor =
    (typeof pose.anchorPosX === 'number' && Number.isFinite(pose.anchorPosX)) ||
    (typeof pose.anchorPosZ === 'number' && Number.isFinite(pose.anchorPosZ));

  const effectiveMode: CameraTargetMode =
    camera.targetMode ?? (hasExplicitAnchor ? 'fixed_composition' : 'track_subject');

  if (effectiveMode === 'fixed_composition') {
    const targetX =
      typeof pose.anchorPosX === 'number' && Number.isFinite(pose.anchorPosX)
        ? pose.anchorPosX
        : charX;
    const targetZ =
      typeof pose.anchorPosZ === 'number' && Number.isFinite(pose.anchorPosZ)
        ? pose.anchorPosZ
        : charZ;
    return { targetX, targetZ, effectiveMode: 'fixed_composition' };
  }

  return { targetX: charX, targetZ: charZ, effectiveMode: 'track_subject' };
}

/**
 * Switches between 'track_subject' and 'fixed_composition' camera target modes without
 * causing a sudden jump when locking composition, and cleanly syncing anchor when returning
 * to subject tracking.
 */
export function switchCameraTargetMode(
  camera: Camera3DSettings,
  pose: CharacterPose3DSettings,
  nextMode: CameraTargetMode
): { camera: Camera3DSettings; pose: CharacterPose3DSettings } {
  const charX =
    typeof pose.characterPosX === 'number' && Number.isFinite(pose.characterPosX)
      ? pose.characterPosX
      : 0;
  const charZ =
    typeof pose.characterPosZ === 'number' && Number.isFinite(pose.characterPosZ)
      ? pose.characterPosZ
      : 0;

  if (nextMode === 'fixed_composition') {
    const currentResolved = resolvePlayboardCameraTargetXZ(camera, pose);
    return {
      camera: { ...camera, targetMode: 'fixed_composition' },
      pose: {
        ...pose,
        anchorPosX: currentResolved.targetX,
        anchorPosZ: currentResolved.targetZ,
      },
    };
  }

  return {
    camera: { ...camera, targetMode: 'track_subject' },
    pose: {
      ...pose,
      anchorPosX: charX,
      anchorPosZ: charZ,
    },
  };
}

/**
 * Applies a user-requested framing selection (shot size) to Camera3DSettings,
 * adjusting camera distance to achieve the requested framing at the current focal length
 * while preserving camera yaw, pitch, height, composition, and targetMode.
 */
export function applyRequestedFramingState(
  camera: Camera3DSettings,
  requestedFraming: ShotFraming
): Camera3DSettings {
  const baseDist50mm = FRAMING_PRESET_DISTANCES[requestedFraming] ?? 3.1;
  const currentFov = FOCAL_LENGTH_FOV_DEG[camera.focalLength] || 47;
  const refTan = Math.tan(THREE.MathUtils.degToRad(47 * 0.5));
  const curTan = Math.tan(THREE.MathUtils.degToRad(currentFov * 0.5));
  const scaledDist = THREE.MathUtils.clamp(baseDist50mm * (refTan / curTan), 0.7, 8.5);
  return {
    ...camera,
    framing: requestedFraming,
    distance: Number(scaledDist.toFixed(2)),
  };
}

/**
 * Deterministic camera transform calculation shared by Playboard3DCanvas and the prompt framing analyzer.
 *
 * Semantics:
 * - `naturalLookY` frames the subject's vertical center (smoothly transitioning from full-body midpoint
 *   to chest/portrait focus as optical frustum height tightens).
 * - `camera.height` applies a direct 1:1 vertical pedestal offset (`camera.height - NEUTRAL_CAMERA_REFERENCE_HEIGHT`)
 *   with zero coupling to `sin(pitch) * distance` and no arbitrary 0.55 scaling factor.
 * - `camera.pitchDeg` and `camera.distance` orbit the camera around `lookTarget` without shifting `lookTarget.y`.
 */
export function computePlayboardCameraTransform(
  camera: Camera3DSettings,
  pose: CharacterPose3DSettings,
  viewportAspectOverride?: number,
  pelvisYOverride?: number
): ComputedCameraTransform {
  const parsedRatio = parseOutputAspectRatio(camera.outputRatio);
  const numericAspect = viewportAspectOverride ?? parsedRatio.numericAspect;
  const fovDeg = getEffectiveVerticalFovDeg(camera.focalLength, parsedRatio.numericAspect);

  const yawRad = THREE.MathUtils.degToRad(camera.yawDeg);
  const pitchRad = THREE.MathUtils.degToRad(camera.pitchDeg);
  const rollRad = THREE.MathUtils.degToRad(camera.rollDeg);
  const dist = Math.max(0.6, camera.distance);

  const pelvisY =
    typeof pelvisYOverride === 'number' && Number.isFinite(pelvisYOverride)
      ? pelvisYOverride
      : computeCharacterPelvisWorldY(pose);
  const isLying =
    pose.basePose === 'reclined_lying' ||
    pose.basePose === 'all_fours_neutral' ||
    pose.basePose === 'cow_pose_arched' ||
    pose.basePose === 'cat_pose_rounded' ||
    pose.basePose === 'all_fours_rear_presentation' ||
    pose.basePose === 'prone_hip_elevated' ||
    pose.basePose === 'kneeling_forward_fold' ||
    pose.basePose === 'side_lying_open' ||
    Math.abs(pose.pelvisPitchDeg ?? 0) >= 55;

  const frustumHeightAtDist = 2 * dist * Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5));
  const closeUpBlend = THREE.MathUtils.clamp((2.25 - frustumHeightAtDist) / 1.15, 0, 1);
  const fullBodyCenterY = isLying ? pelvisY + 0.08 : pelvisY + 0.1;
  const upperFocusY = isLying ? pelvisY + 0.18 : pelvisY + 0.68;
  const naturalLookY = THREE.MathUtils.lerp(fullBodyCenterY, upperFocusY, closeUpBlend);

  // Direct 1:1 vertical pedestal shift uncoupled from pitchDeg and distance
  const heightPedestalOffset = camera.height - NEUTRAL_CAMERA_REFERENCE_HEIGHT;
  const lookY = Math.max(0.15, naturalLookY + heightPedestalOffset);

  let compRightOffset = 0;
  let compUpOffset = 0;
  if (camera.composition === 'rule_of_thirds_left') compRightOffset = 0.24 * (dist / 3.0);
  if (camera.composition === 'rule_of_thirds_right') compRightOffset = -0.24 * (dist / 3.0);
  if (camera.composition === 'low_frame') compUpOffset = 0.2 * (dist / 3.0);
  if (camera.composition === 'high_frame') compUpOffset = -0.2 * (dist / 3.0);

  const rightX = Math.cos(yawRad);
  const rightZ = -Math.sin(yawRad);

  const resolvedTarget = resolvePlayboardCameraTargetXZ(camera, pose);
  const anchorX = resolvedTarget.targetX;
  const anchorZ = resolvedTarget.targetZ;

  const lookTarget = new THREE.Vector3(
    anchorX + rightX * compRightOffset,
    lookY + compUpOffset,
    anchorZ + rightZ * compRightOffset
  );

  const cp = Math.cos(pitchRad);
  const hx = Math.sin(yawRad) * cp * dist;
  const hz = Math.cos(yawRad) * cp * dist;
  const v = Math.sin(pitchRad) * dist;

  const cameraPos = new THREE.Vector3(
    lookTarget.x + hx,
    Math.max(0.15, lookTarget.y + v),
    lookTarget.z + hz
  );

  return {
    cameraPos,
    lookTarget,
    fovDeg,
    numericAspect,
    rollRad,
  };
}

export interface CharacterWorldLandmarks {
  headTop: THREE.Vector3;
  headCenter: THREE.Vector3;
  leftEye: THREE.Vector3;
  rightEye: THREE.Vector3;
  eyeCenter: THREE.Vector3;
  headForward: THREE.Vector3;
  headUp: THREE.Vector3;
  headRight: THREE.Vector3;
  chin: THREE.Vector3;
  leftEar: THREE.Vector3;
  rightEar: THREE.Vector3;
  neck: THREE.Vector3;
  chest: THREE.Vector3;
  upperBack: THREE.Vector3;
  leftShoulder: THREE.Vector3;
  rightShoulder: THREE.Vector3;
  leftElbow: THREE.Vector3;
  rightElbow: THREE.Vector3;
  leftWrist: THREE.Vector3;
  rightWrist: THREE.Vector3;
  leftHand: THREE.Vector3;
  rightHand: THREE.Vector3;
  waist: THREE.Vector3;
  pelvis: THREE.Vector3;
  leftHip: THREE.Vector3;
  rightHip: THREE.Vector3;
  leftMidThigh: THREE.Vector3;
  rightMidThigh: THREE.Vector3;
  leftKnee: THREE.Vector3;
  rightKnee: THREE.Vector3;
  leftMidCalf: THREE.Vector3;
  rightMidCalf: THREE.Vector3;
  leftAnkle: THREE.Vector3;
  rightAnkle: THREE.Vector3;
  leftHeel: THREE.Vector3;
  rightHeel: THREE.Vector3;
  leftFoot: THREE.Vector3;
  rightFoot: THREE.Vector3;
}

/**
 * Forward-kinematics solver matching `buildStylizedHumanRig()` in `Playboard3DCanvas.tsx`
 * (including exact bone offsets, mesh surface extents, eye sockets, and analytical arm IK).
 */
export function computeCharacterWorldLandmarks(
  pose: CharacterPose3DSettings,
  ikEnabled = true
): CharacterWorldLandmarks {
  const root = new THREE.Group();
  root.position.set(pose.characterPosX ?? 0, 0, pose.characterPosZ ?? 0);
  root.rotation.y = THREE.MathUtils.degToRad(pose.characterYawDeg ?? 0);

  // Custom GLB bounding-box landmark fallback when a custom model is active
  if (
    pose.customModelBounds &&
    typeof pose.customModelBounds.height === 'number' &&
    pose.customModelBounds.height > 0.1
  ) {
    const b: CustomModelBounds = pose.customModelBounds;
    const scaleMult =
      typeof b.scaleMultiplier === 'number' && Number.isFinite(b.scaleMultiplier) && b.scaleMultiplier > 0.1
        ? b.scaleMultiplier
        : 1.0;
    const offsetY =
      typeof b.offsetY === 'number' && Number.isFinite(b.offsetY) ? b.offsetY : 0;
    const yawOffsetDeg =
      typeof b.yawOffsetDeg === 'number' && Number.isFinite(b.yawOffsetDeg) ? b.yawOffsetDeg : 0;

    const minY = (Number.isFinite(b.minY) ? b.minY : 0) * scaleMult + offsetY;
    const h = Math.max(0.2, b.height * scaleMult);
    const halfW = Math.max(0.1, (b.width || 0.5) * scaleMult * 0.5);
    const halfD = Math.max(0.08, (b.depth || 0.3) * scaleMult * 0.5);
    const cx = typeof b.centerX === 'number' && Number.isFinite(b.centerX) ? b.centerX : 0;
    const cz = typeof b.centerZ === 'number' && Number.isFinite(b.centerZ) ? b.centerZ : 0;

    root.rotation.y = THREE.MathUtils.degToRad((pose.characterYawDeg ?? 0) + yawOffsetDeg);
    root.updateMatrixWorld(true);
    const toWorld = (lx: number, ly: number, lz: number) =>
      new THREE.Vector3(cx + lx, minY + ly, cz + lz).applyMatrix4(root.matrixWorld);

    const headYawRad = THREE.MathUtils.degToRad(pose.headRotationDeg || 0);
    const headPitchRad = -THREE.MathUtils.degToRad(pose.headTiltDeg || 0);
    const headQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        headPitchRad,
        ((pose.characterYawDeg ?? 0) + yawOffsetDeg) * (Math.PI / 180) + headYawRad,
        0,
        'YXZ'
      )
    );
    const headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(headQuat).normalize();
    const headUp = new THREE.Vector3(0, 1, 0).applyQuaternion(headQuat).normalize();
    const headRight = new THREE.Vector3(-1, 0, 0).applyQuaternion(headQuat).normalize();

    return {
      headTop: toWorld(0, h * 0.99, 0),
      headCenter: toWorld(0, h * 0.91, 0),
      leftEye: toWorld(-halfW * 0.16, h * 0.92, halfD * 0.45),
      rightEye: toWorld(halfW * 0.16, h * 0.92, halfD * 0.45),
      eyeCenter: toWorld(0, h * 0.92, halfD * 0.45),
      headForward,
      headUp,
      headRight,
      chin: toWorld(0, h * 0.85, halfD * 0.35),
      leftEar: toWorld(-halfW * 0.32, h * 0.91, 0),
      rightEar: toWorld(halfW * 0.32, h * 0.91, 0),
      neck: toWorld(0, h * 0.82, 0),
      chest: toWorld(0, h * 0.72, 0),
      upperBack: toWorld(0, h * 0.74, -halfD * 0.4),
      leftShoulder: toWorld(-halfW * 0.72, h * 0.78, 0),
      rightShoulder: toWorld(halfW * 0.72, h * 0.78, 0),
      leftElbow: toWorld(-halfW * 0.82, h * 0.62, 0),
      rightElbow: toWorld(halfW * 0.82, h * 0.62, 0),
      leftWrist: toWorld(-halfW * 0.85, h * 0.48, 0),
      rightWrist: toWorld(halfW * 0.85, h * 0.48, 0),
      leftHand: toWorld(-halfW * 0.88, h * 0.44, 0),
      rightHand: toWorld(halfW * 0.88, h * 0.44, 0),
      waist: toWorld(0, h * 0.58, 0),
      pelvis: toWorld(0, h * 0.52, 0),
      leftHip: toWorld(-halfW * 0.45, h * 0.52, 0),
      rightHip: toWorld(halfW * 0.45, h * 0.52, 0),
      leftMidThigh: toWorld(-halfW * 0.42, h * 0.39, 0),
      rightMidThigh: toWorld(halfW * 0.42, h * 0.39, 0),
      leftKnee: toWorld(-halfW * 0.4, h * 0.28, 0),
      rightKnee: toWorld(halfW * 0.4, h * 0.28, 0),
      leftMidCalf: toWorld(-halfW * 0.38, h * 0.16, 0),
      rightMidCalf: toWorld(halfW * 0.38, h * 0.16, 0),
      leftAnkle: toWorld(-halfW * 0.36, h * 0.05, 0),
      rightAnkle: toWorld(halfW * 0.36, h * 0.05, 0),
      leftHeel: toWorld(-halfW * 0.36, h * 0.01, -halfD * 0.25),
      rightHeel: toWorld(halfW * 0.36, h * 0.01, -halfD * 0.25),
      leftFoot: toWorld(-halfW * 0.36, h * 0.01, halfD * 0.45),
      rightFoot: toWorld(halfW * 0.36, h * 0.01, halfD * 0.45),
    };
  }

  // Core Spine & Limb Hierarchy driven by resolveSemanticCharacterRigPose:
  // Pelvis(0, pelvisY, pelvisZOffset) -> Spine(0, 0.12, 0) -> Chest(0, 0.18, 0) -> Neck(0, 0.24, 0) -> Head(0, 0.09, 0)
  const solved = resolveSemanticCharacterRigPose(pose, ikEnabled);

  const pelvis = new THREE.Group();
  pelvis.position.set(0, solved.pelvisY, solved.pelvisZOffset);
  pelvis.rotation.set(solved.pelvisPitchRad, 0, solved.pelvisRollRad);
  root.add(pelvis);

  const spine = new THREE.Group();
  spine.position.set(0, 0.12, 0);
  spine.rotation.set(solved.spinePitchRad, solved.spineYawRad, solved.spineRollRad);
  pelvis.add(spine);

  const chest = new THREE.Group();
  chest.position.set(0, 0.18, 0);
  chest.rotation.set(solved.chestPitchRad, solved.chestYawRad, solved.chestRollRad);
  spine.add(chest);

  const upperBackNode = new THREE.Object3D();
  upperBackNode.position.set(0, 0.14, -0.11);
  chest.add(upperBackNode);

  const neck = new THREE.Group();
  neck.position.set(0, 0.24, 0);
  neck.rotation.set(solved.neckPitchRad, solved.neckYawRad, 0);
  chest.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 0.09, 0);
  head.rotation.set(solved.headPitchRad, solved.headYawRad, 0);
  neck.add(head);

  // Cranium group at (0, 0.105, 0) + hairTop up to +0.15m above cranium center
  const headTopNode = new THREE.Object3D();
  headTopNode.position.set(0, 0.25, 0);
  head.add(headTopNode);

  const headCenterNode = new THREE.Object3D();
  headCenterNode.position.set(0, 0.11, 0.095);
  head.add(headCenterNode);

  // Exact eye positions matching Playboard3DCanvas.tsx buildEye():
  // craniumGroup at (0, 0.105, 0) + eyeHolder at (side * 0.042, 0.008, 0.098) -> (side * 0.042, 0.113, 0.098) in head space
  const leftEyeNode = new THREE.Object3D();
  leftEyeNode.position.set(-0.042, 0.113, 0.098);
  head.add(leftEyeNode);

  const rightEyeNode = new THREE.Object3D();
  rightEyeNode.position.set(0.042, 0.113, 0.098);
  head.add(rightEyeNode);

  const eyeCenterNode = new THREE.Object3D();
  eyeCenterNode.position.set(0, 0.113, 0.098);
  head.add(eyeCenterNode);

  const chinNode = new THREE.Object3D();
  chinNode.position.set(0, 0.03, 0.085);
  head.add(chinNode);

  const leftEarNode = new THREE.Object3D();
  leftEarNode.position.set(-0.12, 0.095, 0);
  head.add(leftEarNode);

  const rightEarNode = new THREE.Object3D();
  rightEarNode.position.set(0.12, 0.095, 0);
  head.add(rightEarNode);

  // Arms FK matching Playboard3DCanvas.tsx:
  // Clavicle(side * 0.06, 0.19, 0) -> Shoulder(side * 0.135, 0, 0) -> Elbow(0, -0.26, 0) -> Wrist(0, -0.23, 0) -> Hand/Fingers(0, -0.075, 0)
  const buildArmFK = (
    side: -1 | 1,
    shoulderPitchRad: number,
    shoulderRollRad: number,
    elbowPitchRad: number,
    wristSupportPitchRad: number | null,
    gesture: HandGesture,
    wristDeg: number,
    isWavingArm = false
  ) => {
    const clavicle = new THREE.Group();
    clavicle.position.set(side * 0.06, 0.19, 0);
    chest.add(clavicle);

    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.135, 0, 0);
    if (isWavingArm) {
      shoulder.rotation.x = -0.35;
      shoulder.rotation.z = 1.32;
    } else {
      shoulder.rotation.x = shoulderPitchRad;
      shoulder.rotation.z = shoulderRollRad;
    }
    clavicle.add(shoulder);

    const shoulderOuterCap = new THREE.Object3D();
    shoulderOuterCap.position.set(side * 0.052, 0.02, 0);
    shoulder.add(shoulderOuterCap);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.26, 0);
    elbow.rotation.x = isWavingArm ? -1.45 : elbowPitchRad;
    shoulder.add(elbow);

    const g = getHandGestureTargets(gesture, side, 0);
    const userWristRad = THREE.MathUtils.degToRad(wristDeg || 0);
    const targetWristPitch =
      wristSupportPitchRad !== null
        ? gesture === 'open_palm' || gesture === 'relaxed_natural'
          ? wristSupportPitchRad
          : gesture === 'fist'
          ? 0
          : wristSupportPitchRad * 0.65 + g.wristPitch
        : g.wristPitch;

    const wrist = new THREE.Group();
    wrist.position.set(0, -0.23, 0);
    wrist.rotation.x = targetWristPitch;
    wrist.rotation.y = userWristRad * 0.8;
    wrist.rotation.z = g.wristRoll + userWristRad * 0.4;
    elbow.add(wrist);

    const handTip = new THREE.Object3D();
    handTip.position.set(0, -0.075, 0);
    wrist.add(handTip);

    return { shoulderOuterCap, elbow, wrist, handTip };
  };

  const leftArm = buildArmFK(
    -1,
    solved.leftShoulderPitchRad,
    solved.leftShoulderRollRad,
    solved.leftElbowPitchRad,
    solved.leftWristSupportPitchRad,
    pose.leftHandGesture || 'relaxed_natural',
    pose.leftArmWristDeg || 0,
    false
  );
  const rightArm = buildArmFK(
    1,
    solved.rightShoulderPitchRad,
    solved.rightShoulderRollRad,
    solved.rightElbowPitchRad,
    solved.rightWristSupportPitchRad,
    pose.rightHandGesture || 'relaxed_natural',
    pose.rightArmWristDeg || 0,
    pose.isWaving
  );

  // Legs FK matching Playboard3DCanvas.tsx:
  // Hip(side * 0.095, -0.01, 0) -> Knee(0, -0.41, 0) -> Ankle(0, -0.39, 0) -> Heel(0, -0.083, -0.035) & Toe(0, -0.072, 0.145)
  const buildLegFK = (
    side: -1 | 1,
    hipPitchRad: number,
    hipRollRad: number,
    kneePitchRad: number,
    anklePitchRad: number,
    ankleYawRad: number
  ) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, -0.01, 0);
    hip.rotation.x = hipPitchRad;
    hip.rotation.z = hipRollRad;
    pelvis.add(hip);

    const midThigh = new THREE.Object3D();
    midThigh.position.set(0, -0.2, 0);
    hip.add(midThigh);

    const knee = new THREE.Group();
    knee.position.set(0, -0.41, 0);
    knee.rotation.x = kneePitchRad;
    hip.add(knee);

    const midCalf = new THREE.Object3D();
    midCalf.position.set(0, -0.19, 0);
    knee.add(midCalf);

    const ankle = new THREE.Group();
    ankle.position.set(0, -0.39, 0);
    ankle.rotation.x = anklePitchRad;
    ankle.rotation.y = ankleYawRad;
    knee.add(ankle);

    const heel = new THREE.Object3D();
    heel.position.set(0, -0.083, -0.035);
    ankle.add(heel);

    const footTip = new THREE.Object3D();
    footTip.position.set(0, -0.072, 0.145);
    ankle.add(footTip);

    return { hip, midThigh, knee, midCalf, ankle, heel, footTip };
  };

  const leftLeg = buildLegFK(
    -1,
    solved.leftHipPitchRad,
    solved.leftHipRollRad,
    solved.leftKneePitchRad,
    solved.leftAnklePitchRad,
    solved.leftAnkleYawRad
  );
  const rightLeg = buildLegFK(
    1,
    solved.rightHipPitchRad,
    solved.rightHipRollRad,
    solved.rightKneePitchRad,
    solved.rightAnklePitchRad,
    solved.rightAnkleYawRad
  );

  root.updateMatrixWorld(true);

  const worldPos = (obj: THREE.Object3D) => {
    const v = new THREE.Vector3();
    obj.getWorldPosition(v);
    return v;
  };

  const headQuat = new THREE.Quaternion();
  head.getWorldQuaternion(headQuat);
  const headRight = new THREE.Vector3(1, 0, 0).applyQuaternion(headQuat).normalize();
  const headUp = new THREE.Vector3(0, 1, 0).applyQuaternion(headQuat).normalize();
  const headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(headQuat).normalize();

  return {
    headTop: worldPos(headTopNode),
    headCenter: worldPos(headCenterNode),
    leftEye: worldPos(leftEyeNode),
    rightEye: worldPos(rightEyeNode),
    eyeCenter: worldPos(eyeCenterNode),
    headForward,
    headUp,
    headRight,
    chin: worldPos(chinNode),
    leftEar: worldPos(leftEarNode),
    rightEar: worldPos(rightEarNode),
    neck: worldPos(neck),
    chest: worldPos(chest),
    upperBack: worldPos(upperBackNode),
    leftShoulder: worldPos(leftArm.shoulderOuterCap),
    rightShoulder: worldPos(rightArm.shoulderOuterCap),
    leftElbow: worldPos(leftArm.elbow),
    rightElbow: worldPos(rightArm.elbow),
    leftWrist: worldPos(leftArm.wrist),
    rightWrist: worldPos(rightArm.wrist),
    leftHand: worldPos(leftArm.handTip),
    rightHand: worldPos(rightArm.handTip),
    waist: worldPos(spine),
    pelvis: worldPos(pelvis),
    leftHip: worldPos(leftLeg.hip),
    rightHip: worldPos(rightLeg.hip),
    leftMidThigh: worldPos(leftLeg.midThigh),
    rightMidThigh: worldPos(rightLeg.midThigh),
    leftKnee: worldPos(leftLeg.knee),
    rightKnee: worldPos(rightLeg.knee),
    leftMidCalf: worldPos(leftLeg.midCalf),
    rightMidCalf: worldPos(rightLeg.midCalf),
    leftAnkle: worldPos(leftLeg.ankle),
    rightAnkle: worldPos(rightLeg.ankle),
    leftHeel: worldPos(leftLeg.heel),
    rightHeel: worldPos(rightLeg.heel),
    leftFoot: worldPos(leftLeg.footTip),
    rightFoot: worldPos(rightLeg.footTip),
  };
}

export type RegionVisibilityStatus = 'fully_visible' | 'partially_cropped' | 'outside_frame';

export interface ComputedEyeGazeTarget {
  /** Horizontal angle in degrees from the head's 3D forward axis to the camera lens (-180 to 180; >0 = character's right, <0 = character's left) */
  headLocalCameraYawDeg: number;
  /** Vertical elevation angle in degrees from the head's 3D forward-right plane to the camera lens (-90 to 90; >0 = lens above head axis, <0 = lens below head axis) */
  headLocalCameraPitchDeg: number;
  /** Resulting horizontal eye rotation in degrees in head-local space after applying gaze mode and anatomical clamping */
  eyeYawDeg: number;
  /** Resulting vertical eye rotation in degrees in head-local space after applying gaze mode and anatomical clamping */
  eyePitchDeg: number;
  /** Horizontal pupil mesh offset in head-local meters (clamped to ±0.0056m) */
  pupilOffsetX: number;
  /** Vertical pupil mesh offset in head-local meters (clamped to ±0.0046m) */
  pupilOffsetY: number;
  /** Upper eyelid X-rotation target in radians */
  eyelidRotX: number;
  /** True when the camera lens is within anatomically plausible oculomotor reach of the face */
  canAchieveDirectLensContact: boolean;
  /** True when direct lens contact requires noticeable eye-in-socket rotation relative to the head orientation */
  requiresEyeOnlyCompensation: boolean;
  /** World-space unit direction vector from the subject's eye center toward the camera lens */
  eyeToCameraDirectionWorld: THREE.Vector3;
  /** World-space unit direction vector of the subject's active eye gaze */
  activeGazeDirectionWorld: THREE.Vector3;
  /** Horizontal angular difference in degrees between active eye gaze and camera lens in head-local space */
  gazeToCameraHorizontalDiffDeg: number;
  /** Vertical angular difference in degrees between active eye gaze and camera lens in head-local space */
  gazeToCameraVerticalDiffDeg: number;
  /** Total 3D angular difference in degrees between active eye gaze and camera lens */
  gazeToCameraTotalAngleDeg: number;
}

/**
 * Pure 3D gaze target solver shared by the 3D preview and the prompt generator.
 * Projects the world-space eye-to-camera ray into the character's head-local orthonormal basis
 * `(headRight, headUp, headForward)` and solves for anatomically bounded eye angles and pupil offsets.
 */
export function computeSubjectGazeTarget(
  gaze: GazeDirection,
  cameraWorldPos: THREE.Vector3,
  eyeCenterWorld: THREE.Vector3,
  headRight: THREE.Vector3,
  headUp: THREE.Vector3,
  headForward: THREE.Vector3
): ComputedEyeGazeTarget {
  const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

  const eyeToCam = new THREE.Vector3().subVectors(cameraWorldPos, eyeCenterWorld);
  const eyeToCamLenSq = eyeToCam.lengthSq();
  const eyeToCameraDirectionWorld =
    eyeToCamLenSq > 1e-8 ? eyeToCam.normalize() : headForward.clone().normalize();

  const localX = eyeToCameraDirectionWorld.dot(headRight);
  const localY = eyeToCameraDirectionWorld.dot(headUp);
  const localZ = eyeToCameraDirectionWorld.dot(headForward);
  const localXZ = Math.hypot(localX, localZ);

  const headLocalCameraYawDeg =
    localXZ > 1e-5 ? THREE.MathUtils.radToDeg(Math.atan2(localX, localZ)) : 0;
  const headLocalCameraPitchDeg = THREE.MathUtils.radToDeg(
    Math.atan2(localY, Math.max(1e-6, localXZ))
  );

  const maxAnatomicalYawDeg = 38;
  const maxAnatomicalPitchDeg = 32;

  const canAchieveDirectLensContact =
    Math.abs(headLocalCameraYawDeg) <= 32 &&
    Math.abs(headLocalCameraPitchDeg) <= 44 &&
    localZ > 0.15;
  const requiresEyeOnlyCompensation =
    Math.abs(headLocalCameraYawDeg) > 12 || Math.abs(headLocalCameraPitchDeg) > 7.5;

  let eyeYawDeg = 0;
  let eyePitchDeg = 0;
  let pupilOffsetX = 0;
  let pupilOffsetY = 0;
  let eyelidRotX = -0.38;

  switch (gaze) {
    case 'looking_camera_left':
      eyeYawDeg = -28;
      eyePitchDeg = 0;
      pupilOffsetX = -0.0055;
      pupilOffsetY = 0;
      eyelidRotX = -0.38;
      break;
    case 'looking_camera_right':
      eyeYawDeg = 28;
      eyePitchDeg = 0;
      pupilOffsetX = 0.0055;
      pupilOffsetY = 0;
      eyelidRotX = -0.38;
      break;
    case 'looking_upward':
      eyeYawDeg = 0;
      eyePitchDeg = 25;
      pupilOffsetX = 0;
      pupilOffsetY = 0.0045;
      eyelidRotX = -0.52;
      break;
    case 'looking_downward':
      eyeYawDeg = 0;
      eyePitchDeg = -25;
      pupilOffsetX = 0;
      pupilOffsetY = -0.0045;
      eyelidRotX = 0.05;
      break;
    case 'soft_off_camera':
      eyeYawDeg = 16;
      eyePitchDeg = 8;
      pupilOffsetX = 0.003;
      pupilOffsetY = 0.0015;
      eyelidRotX = -0.38;
      break;
    case 'eyes_closed':
      eyeYawDeg = 0;
      eyePitchDeg = 0;
      pupilOffsetX = 0;
      pupilOffsetY = 0;
      eyelidRotX = 0.55;
      break;
    case 'direct_at_camera':
    default: {
      // Smoothly attenuate eye deflection to 0 if the camera moves behind the head
      const frontWeight =
        localZ <= -0.1
          ? 0
          : THREE.MathUtils.clamp((95 - Math.abs(headLocalCameraYawDeg)) / 30, 0, 1);
      eyeYawDeg =
        THREE.MathUtils.clamp(headLocalCameraYawDeg, -maxAnatomicalYawDeg, maxAnatomicalYawDeg) *
        frontWeight;
      eyePitchDeg =
        THREE.MathUtils.clamp(
          headLocalCameraPitchDeg,
          -maxAnatomicalPitchDeg,
          maxAnatomicalPitchDeg
        ) * frontWeight;
      const normX = eyeYawDeg / maxAnatomicalYawDeg;
      const normY = eyePitchDeg / maxAnatomicalPitchDeg;
      pupilOffsetX = normX * 0.0056;
      pupilOffsetY = normY * 0.0046;
      eyelidRotX = normY >= 0 ? -0.38 - normY * 0.14 : -0.38 + (-normY) * 0.36;
      break;
    }
  }

  const eyeYawRad = THREE.MathUtils.degToRad(eyeYawDeg);
  const eyePitchRad = THREE.MathUtils.degToRad(eyePitchDeg);
  const cp = Math.cos(eyePitchRad);
  const localGazeX = Math.sin(eyeYawRad) * cp;
  const localGazeY = Math.sin(eyePitchRad);
  const localGazeZ = Math.cos(eyeYawRad) * cp;

  const activeGazeDirectionWorld = new THREE.Vector3()
    .addScaledVector(headRight, localGazeX)
    .addScaledVector(headUp, localGazeY)
    .addScaledVector(headForward, localGazeZ)
    .normalize();

  const gazeToCameraHorizontalDiffDeg = normDeg(headLocalCameraYawDeg - eyeYawDeg);
  const gazeToCameraVerticalDiffDeg = headLocalCameraPitchDeg - eyePitchDeg;
  const dotGaze = THREE.MathUtils.clamp(
    activeGazeDirectionWorld.dot(eyeToCameraDirectionWorld),
    -1,
    1
  );
  const gazeToCameraTotalAngleDeg = THREE.MathUtils.radToDeg(Math.acos(dotGaze));

  return {
    headLocalCameraYawDeg,
    headLocalCameraPitchDeg,
    eyeYawDeg,
    eyePitchDeg,
    pupilOffsetX,
    pupilOffsetY,
    eyelidRotX,
    canAchieveDirectLensContact,
    requiresEyeOnlyCompensation,
    eyeToCameraDirectionWorld,
    activeGazeDirectionWorld,
    gazeToCameraHorizontalDiffDeg,
    gazeToCameraVerticalDiffDeg,
    gazeToCameraTotalAngleDeg,
  };
}

export interface RelativeCameraSubjectAngles {
  /** Camera horizontal angle in degrees relative to the character's root body facing direction (-180 to 180, 0 = directly in front of body) */
  relativeToBodyYawDeg: number;
  /** Camera horizontal angle in degrees relative to the character's upper torso/chest facing direction (-180 to 180) */
  relativeToTorsoYawDeg: number;
  /** Camera horizontal angle in degrees relative to the character's head/face facing direction (-180 to 180, 0 = camera directly in front of face) */
  relativeToHeadYawDeg: number;
  /** Camera vertical pitch angle in degrees relative to the camera's lookTarget (>0 = camera above lookTarget looking down, <0 = camera below lookTarget looking up) */
  cameraPitchToLookTargetDeg: number;
  /** True vertical angle in degrees between camera lens and subject's eyes (>0 = camera above eyes looking down, <0 = camera below eyes looking up) */
  verticalPitchToSubjectDeg: number;
  /** True vertical elevation angle in degrees from the subject's eyes to the camera lens in world space (>0 = camera lens above eyes, <0 = camera lens below eyes) */
  verticalCameraToEyeAngleDeg: number;
  /** Horizontal angle in degrees of the camera lens in the head's 3D local coordinate frame (>0 = character's right, <0 = character's left) */
  headLocalCameraYawDeg: number;
  /** Vertical angle in degrees of the camera lens in the head's 3D local coordinate frame (>0 = upward relative to head, <0 = downward relative to head) */
  headLocalCameraPitchDeg: number;
  /** Actual world Y elevation of the camera lens in meters (camTransform.cameraPos.y) */
  cameraLensHeightMeters: number;
  /** Actual world Y elevation of the subject's eyes in meters (landmarks.eyeCenter.y) */
  subjectEyeHeightMeters: number;
  /** Actual camera world lens elevation minus character eye world elevation in meters (cameraPos.y - eyeCenter.y) */
  cameraAboveEyesMeters: number;
  /** Euclidean 3D distance in meters from camera lens to character chest/pelvis */
  trueSubjectDistanceMeters: number;
  /** Euclidean 3D distance in meters from camera lens to character eye center */
  trueEyeDistanceMeters: number;
  /** Shared 3D gaze target solution for the active configuration */
  gazeSolution: ComputedEyeGazeTarget;
}

/**
 * Computes the true 3D relative angles between the active camera and the character's body,
 * upper torso, head, and eyes using their actual world positions and orientations.
 */
export function computeRelativeCameraSubjectAngles(
  cameraSettings: Camera3DSettings,
  poseSettings: CharacterPose3DSettings,
  landmarksInput?: CharacterWorldLandmarks,
  camTransformInput?: ComputedCameraTransform
): RelativeCameraSubjectAngles {
  const landmarks = landmarksInput || computeCharacterWorldLandmarks(poseSettings);
  const camTransform =
    camTransformInput || computePlayboardCameraTransform(cameraSettings, poseSettings);

  // Horizontal vector from the character's body reference point to the camera in world XZ
  const subjectRef = new THREE.Vector3()
    .addVectors(landmarks.pelvis, landmarks.chest)
    .multiplyScalar(0.5);
  const dxBody = camTransform.cameraPos.x - subjectRef.x;
  const dzBody = camTransform.cameraPos.z - subjectRef.z;
  const horizontalDistBody = Math.hypot(dxBody, dzBody);

  // If camera is almost directly overhead (horizontalDistBody < 0.08m), fall back to camera.yawDeg
  const worldCamAzimuthBodyDeg =
    horizontalDistBody >= 0.08
      ? THREE.MathUtils.radToDeg(Math.atan2(dxBody, dzBody))
      : cameraSettings.yawDeg;

  // Horizontal vector from the character's eye center to the camera in world XZ
  const dxEye = camTransform.cameraPos.x - landmarks.eyeCenter.x;
  const dzEye = camTransform.cameraPos.z - landmarks.eyeCenter.z;
  const horizontalDistEyes = Math.hypot(dxEye, dzEye);
  const worldCamAzimuthEyeDeg =
    horizontalDistEyes >= 0.08
      ? THREE.MathUtils.radToDeg(Math.atan2(dxEye, dzEye))
      : worldCamAzimuthBodyDeg;

  const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

  const bodyYawDeg = poseSettings.characterYawDeg ?? 0;
  const torsoYawDeg = normDeg(bodyYawDeg + (poseSettings.torsoTwistDeg || 0));
  const headYawDeg = normDeg(torsoYawDeg + (poseSettings.headRotationDeg || 0));

  const relativeToBodyYawDeg = normDeg(worldCamAzimuthBodyDeg - bodyYawDeg);
  const relativeToTorsoYawDeg = normDeg(worldCamAzimuthBodyDeg - torsoYawDeg);
  const relativeToHeadYawDeg = normDeg(worldCamAzimuthEyeDeg - headYawDeg);

  // True world-space camera lens elevation vs. actual subject eye elevation
  const cameraLensHeightMeters = camTransform.cameraPos.y;
  const subjectEyeHeightMeters = landmarks.eyeCenter.y;
  const cameraAboveEyesMeters = cameraLensHeightMeters - subjectEyeHeightMeters;

  // Camera vertical pitch relative to lookTarget (kept distinct from camera-to-eye vertical angle)
  const dyToLookTarget = camTransform.cameraPos.y - camTransform.lookTarget.y;
  const distToLookTargetXZ = Math.max(
    0.05,
    Math.hypot(
      camTransform.cameraPos.x - camTransform.lookTarget.x,
      camTransform.cameraPos.z - camTransform.lookTarget.z
    )
  );
  const cameraPitchToLookTargetDeg = THREE.MathUtils.radToDeg(
    Math.atan2(dyToLookTarget, distToLookTargetXZ)
  );

  // True vertical angle between the camera lens and the subject's eyes in world space
  // (>0 = camera lens is above the subject's eyes, <0 = camera lens is below the subject's eyes)
  const safeHorizDistEyes = Math.max(0.05, horizontalDistEyes);
  const verticalCameraToEyeAngleDeg = THREE.MathUtils.radToDeg(
    Math.atan2(cameraAboveEyesMeters, safeHorizDistEyes)
  );
  const verticalPitchToSubjectDeg = verticalCameraToEyeAngleDeg;

  const gazeSolution = computeSubjectGazeTarget(
    poseSettings.gaze,
    camTransform.cameraPos,
    landmarks.eyeCenter,
    landmarks.headRight,
    landmarks.headUp,
    landmarks.headForward
  );

  const trueSubjectDistanceMeters = camTransform.cameraPos.distanceTo(subjectRef);
  const trueEyeDistanceMeters = camTransform.cameraPos.distanceTo(landmarks.eyeCenter);

  return {
    relativeToBodyYawDeg,
    relativeToTorsoYawDeg,
    relativeToHeadYawDeg,
    cameraPitchToLookTargetDeg,
    verticalPitchToSubjectDeg,
    verticalCameraToEyeAngleDeg,
    headLocalCameraYawDeg: gazeSolution.headLocalCameraYawDeg,
    headLocalCameraPitchDeg: gazeSolution.headLocalCameraPitchDeg,
    cameraLensHeightMeters,
    subjectEyeHeightMeters,
    cameraAboveEyesMeters,
    trueSubjectDistanceMeters,
    trueEyeDistanceMeters,
    gazeSolution,
  };
}

export interface DynamicFramingAnalysis {
  /** User-selected framing preset from Camera3DSettings.framing */
  requestedFraming: ShotFraming;
  /** Actual measured shot size derived from 3D landmark frustum projection */
  measuredFraming: ShotFraming;
  /** Alias for measuredFraming preserved for backward compatibility */
  derivedFraming: ShotFraming;
  /** True when the 3D measured shot size matches the user's requested framing preset */
  framingMatchesRequest: boolean;
  /** Explanatory note when manual distance/fov overrides cause measured framing to differ from requested preset */
  framingDiscrepancyNote: string | null;
  /** True when landmarks were derived from a custom GLB bounding box rather than the procedural rig */
  usingCustomModelFallback?: boolean;
  shotSizeLabel: string;
  visibleRegions: {
    head: boolean;
    shoulders: boolean;
    chest: boolean;
    waist: boolean;
    hips: boolean;
    knees: boolean;
    calves: boolean;
    feet: boolean;
    leftHand: boolean;
    rightHand: boolean;
  };
  regionStatuses: {
    head: RegionVisibilityStatus;
    chest: RegionVisibilityStatus;
    waist: RegionVisibilityStatus;
    knees: RegionVisibilityStatus;
    feet: RegionVisibilityStatus;
    hands: RegionVisibilityStatus;
  };
  croppedParts: string[];
  partiallyCroppedParts: string[];
  subjectHeightFraction: number;
  subjectWidthFraction: number;
  horizontalPlacement: 'centered' | 'left_third' | 'right_third' | 'far_left' | 'far_right';
  verticalPlacement: 'centered' | 'upper_frame' | 'lower_frame';
  parsedAspectRatio: ParsedAspectRatio;
  relativeAngles: RelativeCameraSubjectAngles;
  shotSizeDescription: string;
  croppingDescription: string;
  placementDescription: string;
  aspectRatioDescription: string;
  combinedFramingSentence: string;
}

/**
 * Projects the character's 3D anatomical landmarks and surface bounds into the active camera's
 * view frustum and derives the shot size, visible/partially-cropped/outside body parts,
 * subject scale, and placement within the selected aspect ratio frame.
 */
export function analyzePlayboardFraming(
  cameraSettings: Camera3DSettings,
  poseSettings: CharacterPose3DSettings
): DynamicFramingAnalysis {
  const parsedAspectRatio = parseOutputAspectRatio(cameraSettings.outputRatio);
  const camTransform = computePlayboardCameraTransform(
    cameraSettings,
    poseSettings,
    parsedAspectRatio.numericAspect
  );
  const landmarks = computeCharacterWorldLandmarks(poseSettings);
  const relativeAngles = computeRelativeCameraSubjectAngles(
    cameraSettings,
    poseSettings,
    landmarks,
    camTransform
  );

  // Build perspective camera matching the WebGL renderer
  const cam = new THREE.PerspectiveCamera(
    camTransform.fovDeg,
    camTransform.numericAspect,
    0.05,
    100
  );
  cam.position.copy(camTransform.cameraPos);
  cam.lookAt(camTransform.lookTarget);
  cam.rotation.z += camTransform.rollRad;
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  const camForward = new THREE.Vector3();
  cam.getWorldDirection(camForward);

  const projectPoint = (worldPt: THREE.Vector3, margin = 1.0) => {
    const toPt = new THREE.Vector3().subVectors(worldPt, cam.position);
    const depth = toPt.dot(camForward);
    const ndc = worldPt.clone().project(cam);
    const inFront = depth > 0.08;
    const inFrameX = Math.abs(ndc.x) <= margin;
    const inFrameY = Math.abs(ndc.y) <= margin;
    return {
      x: ndc.x,
      y: ndc.y,
      depth,
      inFront,
      visible: inFront && inFrameX && inFrameY,
      croppedTop: inFront && ndc.y > margin,
      croppedBottom: inFront && ndc.y < -margin,
      croppedLeft: inFront && ndc.x < -margin,
      croppedRight: inFront && ndc.x > margin,
    };
  };

  const pHeadTop = projectPoint(landmarks.headTop);
  const pHeadCenter = projectPoint(landmarks.headCenter);
  const pChin = projectPoint(landmarks.chin);
  const pLEar = projectPoint(landmarks.leftEar);
  const pREar = projectPoint(landmarks.rightEar);
  const pNeck = projectPoint(landmarks.neck);
  const pChest = projectPoint(landmarks.chest);
  const pLShoulder = projectPoint(landmarks.leftShoulder);
  const pRShoulder = projectPoint(landmarks.rightShoulder);
  const pLElbow = projectPoint(landmarks.leftElbow);
  const pRElbow = projectPoint(landmarks.rightElbow);
  const pLWrist = projectPoint(landmarks.leftWrist);
  const pRWrist = projectPoint(landmarks.rightWrist);
  const pLHand = projectPoint(landmarks.leftHand);
  const pRHand = projectPoint(landmarks.rightHand);
  const pWaist = projectPoint(landmarks.waist);
  const pPelvis = projectPoint(landmarks.pelvis);
  const pLHip = projectPoint(landmarks.leftHip);
  const pRHip = projectPoint(landmarks.rightHip);
  const pLThigh = projectPoint(landmarks.leftMidThigh);
  const pRThigh = projectPoint(landmarks.rightMidThigh);
  const pLKnee = projectPoint(landmarks.leftKnee);
  const pRKnee = projectPoint(landmarks.rightKnee);
  const pLCalf = projectPoint(landmarks.leftMidCalf);
  const pRCalf = projectPoint(landmarks.rightMidCalf);
  const pLAnkle = projectPoint(landmarks.leftAnkle);
  const pRAnkle = projectPoint(landmarks.rightAnkle);
  const pLHeel = projectPoint(landmarks.leftHeel);
  const pRHeel = projectPoint(landmarks.rightHeel);
  const pLFoot = projectPoint(landmarks.leftFoot);
  const pRFoot = projectPoint(landmarks.rightFoot);

  const allProjected = [
    pHeadTop,
    pHeadCenter,
    pChin,
    pLEar,
    pREar,
    pNeck,
    pChest,
    pLShoulder,
    pRShoulder,
    pLElbow,
    pRElbow,
    pLWrist,
    pRWrist,
    pLHand,
    pRHand,
    pWaist,
    pPelvis,
    pLHip,
    pRHip,
    pLThigh,
    pRThigh,
    pLKnee,
    pRKnee,
    pLCalf,
    pRCalf,
    pLAnkle,
    pRAnkle,
    pLHeel,
    pRHeel,
    pLFoot,
    pRFoot,
  ];

  const inFrontPoints = allProjected.filter((p) => p.inFront);
  let rawMinX = Infinity;
  let rawMaxX = -Infinity;
  let rawMinY = Infinity;
  let rawMaxY = -Infinity;

  for (const pt of inFrontPoints) {
    if (pt.x < rawMinX) rawMinX = pt.x;
    if (pt.x > rawMaxX) rawMaxX = pt.x;
    if (pt.y < rawMinY) rawMinY = pt.y;
    if (pt.y > rawMaxY) rawMaxY = pt.y;
  }

  if (!Number.isFinite(rawMinY)) {
    rawMinX = -0.2;
    rawMaxX = 0.2;
    rawMinY = -0.5;
    rawMaxY = 0.5;
  }

  const visMinX = Math.max(-1, Math.min(1, rawMinX));
  const visMaxX = Math.max(-1, Math.min(1, rawMaxX));
  const visMinY = Math.max(-1, Math.min(1, rawMinY));
  const visMaxY = Math.max(-1, Math.min(1, rawMaxY));

  const subjectHeightFraction = Math.max(0, (visMaxY - visMinY) / 2);
  const subjectWidthFraction = Math.max(0, (visMaxX - visMinX) / 2);
  const unclampedHeightFraction = Math.max(0, (rawMaxY - rawMinY) / 2);

  const evalRegionStatus = (pts: { visible: boolean }[]): RegionVisibilityStatus => {
    const visCount = pts.filter((p) => p.visible).length;
    if (visCount === pts.length) return 'fully_visible';
    if (visCount > 0) return 'partially_cropped';
    return 'outside_frame';
  };

  const headStatus = evalRegionStatus([pHeadTop, pHeadCenter, pChin]);
  const chestStatus = evalRegionStatus([pChest, pLShoulder, pRShoulder]);
  const waistStatus = evalRegionStatus([pWaist, pPelvis]);
  const kneesStatus = evalRegionStatus([pLKnee, pRKnee]);
  const feetStatus = evalRegionStatus([pLHeel, pLFoot, pRHeel, pRFoot]);
  const handsStatus = evalRegionStatus([pLHand, pLWrist, pRHand, pRWrist]);

  const headVisible = pHeadCenter.visible || pChin.visible;
  const shouldersVisible = pLShoulder.visible || pRShoulder.visible || pNeck.visible;
  const chestVisible = pChest.visible || (pLShoulder.visible && pRShoulder.visible);
  const waistVisible = pPelvis.visible || (pWaist.visible && pWaist.y > -0.78);
  const hipsVisible = pPelvis.visible || pLHip.visible || pRHip.visible;
  const kneesVisible = pLKnee.visible || pRKnee.visible;
  const calvesVisible = pLCalf.visible || pRCalf.visible || pLAnkle.visible || pRAnkle.visible;
  // Require the actual foot soles (heel or toe) to be inside the frame for feetVisible = true!
  const feetVisible = (pLHeel.visible || pLFoot.visible) && (pRHeel.visible || pRFoot.visible);
  const anyFootVisible = pLHeel.visible || pLFoot.visible || pRHeel.visible || pRFoot.visible;
  const leftHandVisible = pLHand.visible || pLWrist.visible;
  const rightHandVisible = pRHand.visible || pRWrist.visible;

  // Detect cropped and partially cropped anatomical parts
  const croppedParts: string[] = [];
  const partiallyCroppedParts: string[] = [];

  if (!headVisible) {
    croppedParts.push('head');
  } else if (!pHeadTop.visible) {
    partiallyCroppedParts.push('top of head/crown');
  }

  if (!leftHandVisible && !rightHandVisible) {
    croppedParts.push('both hands');
  } else if (!leftHandVisible) {
    croppedParts.push('left hand');
  } else if (!rightHandVisible) {
    croppedParts.push('right hand');
  }

  if (!waistVisible && headVisible && chestVisible) {
    croppedParts.push('waist');
  }
  if (!kneesVisible) {
    croppedParts.push('knees');
  }
  if (!anyFootVisible) {
    croppedParts.push('feet and lower legs');
  } else if (!feetVisible) {
    partiallyCroppedParts.push('one foot partially at frame edge');
  }

  // Classify shot size strictly from visible anatomical bounds and viewport occupancy
  // Never describe a full-body shot if the feet are outside the frame!
  let derivedFraming: ShotFraming = 'full_shot';
  let shotSizeLabel = 'full-body shot';
  let shotSizeDescription =
    'full-body framing showing the entire subject from head to feet inside the frame';

  const isSeatedOrCompact =
    poseSettings.basePose === 'casual_sitting' ||
    poseSettings.basePose === 'floor_seated_cross_legged' ||
    poseSettings.basePose === 'grounded_kneeling' ||
    poseSettings.basePose === 'deep_squat' ||
    poseSettings.basePose === 'reclined_lying' ||
    poseSettings.basePose === 'all_fours_neutral' ||
    poseSettings.basePose === 'cow_pose_arched' ||
    poseSettings.basePose === 'cat_pose_rounded' ||
    poseSettings.basePose === 'all_fours_rear_presentation' ||
    poseSettings.basePose === 'prone_hip_elevated' ||
    poseSettings.basePose === 'kneeling_forward_fold' ||
    poseSettings.basePose === 'bent_over_support' ||
    poseSettings.basePose === 'side_lying_open';

  if (headVisible && !waistVisible) {
    if (
      unclampedHeightFraction >= 2.18 ||
      (!chestVisible && (!pHeadTop.visible || !shouldersVisible))
    ) {
      derivedFraming = 'extreme_close_up';
      shotSizeLabel = 'extreme close-up';
      shotSizeDescription =
        'extreme close-up framing tightly focused on the face and eyes, with shoulders and body outside the frame';
    } else if (unclampedHeightFraction >= 1.98 || !chestVisible) {
      derivedFraming = 'close_up_portrait';
      shotSizeLabel = 'head-and-shoulders close-up';
      shotSizeDescription =
        'head-and-shoulders close-up portrait framing capturing the head, face, and upper shoulders, cropped above the chest and waist';
    } else {
      derivedFraming = 'medium_close_up';
      shotSizeLabel = 'chest-up medium close-up';
      shotSizeDescription =
        'chest-up medium close-up framing capturing the head, shoulders, and upper chest, with the waist and legs cropped below the frame';
    }
  } else if (headVisible && waistVisible && !kneesVisible) {
    derivedFraming = 'medium_shot';
    shotSizeLabel = 'waist-up medium shot';
    shotSizeDescription =
      'waist-up medium shot framing capturing the subject from the head and torso down to the waist/hips, with knees and feet outside the lower frame';
  } else if (headVisible && kneesVisible && !feetVisible) {
    derivedFraming = 'three_quarter_shot';
    if (calvesVisible) {
      shotSizeLabel = 'three-quarter shot (calf-up, feet cropped)';
      shotSizeDescription =
        'three-quarter shot framing capturing the subject from the head through the knees and upper calves, with the feet cropped below the bottom edge of the frame';
    } else {
      shotSizeLabel = 'knee-up three-quarter shot';
      shotSizeDescription =
        'knee-up three-quarter shot framing capturing the subject from head to knees, with ankles and feet cropped below the bottom edge of the frame';
    }
  } else if (!headVisible && (waistVisible || kneesVisible || anyFootVisible)) {
    derivedFraming = 'three_quarter_shot';
    shotSizeLabel = 'lower-body framing (head cropped)';
    shotSizeDescription =
      'low-framed composition showing the lower torso and legs while the head is cropped above the top edge of the frame';
  } else if (headVisible && feetVisible) {
    const maxSpan = Math.max(subjectHeightFraction, subjectWidthFraction);
    if (maxSpan < 0.42) {
      derivedFraming = 'wide_shot';
      shotSizeLabel = 'wide environmental shot';
      shotSizeDescription = `wide environmental shot showing the full-body subject smaller within the scene (occupying approx ${Math.round(
        maxSpan * 100
      )}% of the frame) surrounded by expansive environmental space`;
    } else {
      derivedFraming = 'full_shot';
      shotSizeLabel = isSeatedOrCompact ? 'full-figure seated/reclined shot' : 'full-body shot';
      shotSizeDescription = isSeatedOrCompact
        ? `full-figure framing capturing the entire ${poseSettings.basePose.replace(
            /_/g,
            ' '
          )} subject from head to feet within the frame (occupying approx ${Math.round(
            maxSpan * 100
          )}% of the viewport)`
        : `full-body shot capturing the entire standing subject from head to feet with visible headroom and footroom (occupying approx ${Math.round(
            subjectHeightFraction * 100
          )}% of frame height)`;
    }
  } else {
    derivedFraming = 'wide_shot';
    shotSizeLabel = 'off-center partial/wide view';
    shotSizeDescription =
      'wide directional view where the subject is positioned near the edge of the camera frustum';
  }

  // Horizontal & Vertical Placement inside the frame
  // Use a strict threshold so we NEVER describe the subject as centered if visibly off-center!
  const visiblePoints = inFrontPoints.filter((p) => p.visible);
  let centerX = (visMinX + visMaxX) / 2;
  let centerY = (visMinY + visMaxY) / 2;
  if (visiblePoints.length > 0) {
    let sumX = 0;
    let sumY = 0;
    for (const vp of visiblePoints) {
      sumX += vp.x;
      sumY += vp.y;
    }
    centerX = (centerX + sumX / visiblePoints.length) * 0.5;
    centerY = (centerY + sumY / visiblePoints.length) * 0.5;
  }

  let horizontalPlacement: DynamicFramingAnalysis['horizontalPlacement'] = 'centered';
  let hPlaceText = 'horizontally centered in the frame';
  if (centerX < -0.42) {
    horizontalPlacement = 'far_left';
    hPlaceText = 'offset toward the far-left side of the frame';
  } else if (centerX < -0.11) {
    horizontalPlacement = 'left_third';
    hPlaceText = 'offset to the left of center (along the left third of the frame)';
  } else if (centerX > 0.42) {
    horizontalPlacement = 'far_right';
    hPlaceText = 'offset toward the far-right side of the frame';
  } else if (centerX > 0.11) {
    horizontalPlacement = 'right_third';
    hPlaceText = 'offset to the right of center (along the right third of the frame)';
  }

  let verticalPlacement: DynamicFramingAnalysis['verticalPlacement'] = 'centered';
  let vPlaceText = 'vertically balanced';
  if (centerY > 0.18) {
    verticalPlacement = 'upper_frame';
    vPlaceText = 'positioned in the upper portion of the frame';
  } else if (centerY < -0.18) {
    verticalPlacement = 'lower_frame';
    vPlaceText = 'positioned in the lower portion of the frame with generous headroom above';
  }

  const scalePercent = Math.max(
    5,
    Math.min(100, Math.round(Math.max(subjectHeightFraction, subjectWidthFraction) * 100))
  );
  const placementDescription = `subject ${hPlaceText} and ${vPlaceText} (spanning approx ${scalePercent}% of the frame)`;

  const allCropNotes = [...croppedParts, ...partiallyCroppedParts];
  const croppingDescription =
    allCropNotes.length === 0
      ? 'entire figure including head, both hands, knees, and both feet fully visible inside the frame without cropping'
      : `frame crops out ${allCropNotes.join(', ')}`;

  const aspectRatioDescription = `${parsedAspectRatio.ratioString} ${parsedAspectRatio.orientationDescriptor} aspect ratio`;
  const combinedFramingSentence = `${shotSizeDescription}; ${croppingDescription}; ${placementDescription} in a ${aspectRatioDescription}`;

  const requestedFraming = cameraSettings.framing || derivedFraming;
  const measuredFraming = derivedFraming;
  const framingMatchesRequest = requestedFraming === measuredFraming;
  const framingDiscrepancyNote = framingMatchesRequest
    ? null
    : `Requested framing preset is ${requestedFraming.replace(/_/g, ' ')}, while actual 3D camera distance (${cameraSettings.distance.toFixed(2)}m) and lens produce a measured ${shotSizeLabel} (${measuredFraming.replace(/_/g, ' ')})`;
  const usingCustomModelFallback = Boolean(
    poseSettings.customModelBounds &&
      typeof poseSettings.customModelBounds.height === 'number' &&
      poseSettings.customModelBounds.height > 0.1
  );

  return {
    requestedFraming,
    measuredFraming,
    derivedFraming,
    framingMatchesRequest,
    framingDiscrepancyNote,
    usingCustomModelFallback,
    shotSizeLabel,
    visibleRegions: {
      head: headVisible,
      shoulders: shouldersVisible,
      chest: chestVisible,
      waist: waistVisible,
      hips: hipsVisible,
      knees: kneesVisible,
      calves: calvesVisible,
      feet: feetVisible,
      leftHand: leftHandVisible,
      rightHand: rightHandVisible,
    },
    regionStatuses: {
      head: headStatus,
      chest: chestStatus,
      waist: waistStatus,
      knees: kneesStatus,
      feet: feetStatus,
      hands: handsStatus,
    },
    croppedParts,
    partiallyCroppedParts,
    subjectHeightFraction,
    subjectWidthFraction,
    horizontalPlacement,
    verticalPlacement,
    parsedAspectRatio,
    relativeAngles,
    shotSizeDescription,
    croppingDescription,
    placementDescription,
    aspectRatioDescription,
    combinedFramingSentence,
  };
}

/**
 * Inspects the current character configuration and returns reliable diagnostics for
 * built-in procedural rig vs custom GLB models without falsely claiming exact skeletal
 * gaze/landmark calibration when bounding-box fallback is active.
 */
export function getCustomModelDiagnostics(pose: CharacterPose3DSettings): CustomModelDiagnostics {
  const b = pose.customModelBounds;
  const isActive = Boolean(b && typeof b.height === 'number' && b.height > 0.1);

  if (!isActive || !b) {
    return {
      isActive: false,
      hasSkeletalRig: true,
      boneCount: 28,
      handBoneCount: 22,
      hasHeadBone: true,
      normalizedHeight: 1.78,
      normalizedWidth: 0.52,
      normalizedDepth: 0.34,
      scaleMultiplier: 1.0,
      offsetY: 0,
      yawOffsetDeg: 0,
      usesApproximateLandmarks: false,
      statusSummary: 'Built-in procedural rig active (full joint FK/IK, 5-finger hands & per-eye gaze tracking).',
    };
  }

  const hasSkeletalRig = Boolean(b.hasSkeleton && (b.boneCount ?? 0) > 0);
  const boneCount = typeof b.boneCount === 'number' ? b.boneCount : 0;
  const handBoneCount = typeof b.handBoneCount === 'number' ? b.handBoneCount : 0;
  const hasHeadBone = Boolean(b.hasHeadBone);
  const scaleMultiplier =
    typeof b.scaleMultiplier === 'number' && Number.isFinite(b.scaleMultiplier) && b.scaleMultiplier > 0.1
      ? b.scaleMultiplier
      : 1.0;
  const offsetY = typeof b.offsetY === 'number' && Number.isFinite(b.offsetY) ? b.offsetY : 0;
  const yawOffsetDeg =
    typeof b.yawOffsetDeg === 'number' && Number.isFinite(b.yawOffsetDeg) ? b.yawOffsetDeg : 0;

  return {
    isActive: true,
    hasSkeletalRig,
    boneCount,
    handBoneCount,
    hasHeadBone,
    normalizedHeight: Number((b.height * scaleMultiplier).toFixed(2)),
    normalizedWidth: Number((b.width * scaleMultiplier).toFixed(2)),
    normalizedDepth: Number((b.depth * scaleMultiplier).toFixed(2)),
    scaleMultiplier,
    offsetY,
    yawOffsetDeg,
    usesApproximateLandmarks: true,
    statusSummary: hasSkeletalRig
      ? `Custom GLB active (${boneCount} bones${handBoneCount > 0 ? `, ${handBoneCount} hand/finger bones` : ', no finger rig'}${hasHeadBone ? ', head/neck bone detected' : ', no head bone'}; approximate bounding-box landmarks used for framing & gaze vectors).`
      : 'Custom static GLB mesh active (0 bones; root transform & approximate bounding-box landmarks used; limb/eye/finger sliders do not deform mesh).',
  };
}

export interface PlayboardVisualGuidesGeometry {
  subjectOrigin: THREE.Vector3;
  subjectFacingVector: THREE.Vector3;
  subjectRightVector: THREE.Vector3;
  movementWorldVector: THREE.Vector3;
  hasMovementInput: boolean;
  cameraPosition: THREE.Vector3;
  cameraLookTarget: THREE.Vector3;
  cameraDirectionVector: THREE.Vector3;
  headForwardVector: THREE.Vector3;
  eyeGazeVector: THREE.Vector3;
  eyeMidpoint: THREE.Vector3;
  canAchieveDirectLensContact: boolean;
  usesApproximateLandmarks: boolean;
}

/**
 * Computes runtime 3D visual guide and gizmo geometry directly from the canonical
 * camera and subject state (shared by Playboard3DCanvas and automated tests).
 */
export function computePlayboardVisualGuidesGeometry(
  camera: Camera3DSettings,
  pose: CharacterPose3DSettings,
  movementInput: { x: number; y: number } = { x: 0, y: 0 },
  aspectRatio?: number
): PlayboardVisualGuidesGeometry {
  const camTransform = computePlayboardCameraTransform(camera, pose, aspectRatio);
  const landmarks = computeCharacterWorldLandmarks(pose);
  const gazeTarget = computeSubjectGazeTarget(
    pose.gaze,
    camTransform.cameraPos,
    landmarks.eyeCenter,
    landmarks.headRight,
    landmarks.headUp,
    landmarks.headForward
  );
  const diagnostics = getCustomModelDiagnostics(pose);

  const charX =
    typeof pose.characterPosX === 'number' && Number.isFinite(pose.characterPosX)
      ? pose.characterPosX
      : 0;
  const charZ =
    typeof pose.characterPosZ === 'number' && Number.isFinite(pose.characterPosZ)
      ? pose.characterPosZ
      : 0;
  const charYawDeg =
    typeof pose.characterYawDeg === 'number' && Number.isFinite(pose.characterYawDeg)
      ? pose.characterYawDeg
      : 0;
  const charYawRad = THREE.MathUtils.degToRad(charYawDeg);

  const fwdX = Math.sin(charYawRad);
  const fwdZ = Math.cos(charYawRad);
  const rightX = Math.cos(charYawRad);
  const rightZ = -Math.sin(charYawRad);

  const subjectOrigin = new THREE.Vector3(charX, 0, charZ);
  const subjectFacingVector = new THREE.Vector3(fwdX, 0, fwdZ).normalize();
  const subjectRightVector = new THREE.Vector3(rightX, 0, rightZ).normalize();

  const mvX = movementInput.x || 0;
  const mvY = movementInput.y || 0;
  const mvMag = Math.hypot(mvX, mvY);
  const hasMovementInput = mvMag > 0.04;
  const movementWorldVector = new THREE.Vector3(fwdX, 0, fwdZ);
  if (hasMovementInput) {
    const rawWx = rightX * mvX + fwdX * mvY;
    const rawWz = rightZ * mvX + fwdZ * mvY;
    const rawLen = Math.hypot(rawWx, rawWz);
    if (rawLen > 1e-5) {
      movementWorldVector.set(rawWx / rawLen, 0, rawWz / rawLen);
    }
  }

  const cameraDirectionVector = new THREE.Vector3()
    .subVectors(camTransform.lookTarget, camTransform.cameraPos)
    .normalize();

  return {
    subjectOrigin,
    subjectFacingVector,
    subjectRightVector,
    movementWorldVector,
    hasMovementInput,
    cameraPosition: camTransform.cameraPos.clone(),
    cameraLookTarget: camTransform.lookTarget.clone(),
    cameraDirectionVector,
    headForwardVector: landmarks.headForward.clone().normalize(),
    eyeGazeVector: gazeTarget.activeGazeDirectionWorld.clone().normalize(),
    eyeMidpoint: landmarks.eyeCenter.clone(),
    canAchieveDirectLensContact: gazeTarget.canAchieveDirectLensContact,
    usesApproximateLandmarks: diagnostics.usesApproximateLandmarks,
  };
}

// ============================================================================
// PHASE 2A, 2B, 2C: SURFACE-AWARE IK, POSE TRANSITIONS & SECONDARY MOTION
// ============================================================================

export interface SupportSurfaceDefinition {
  id: PlayboardSupportSurfaceId;
  label: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
  normal: { x: number; y: number; z: number };
  /** Soft cushion sink allowance in meters (e.g. mattress vs. hardwood floor) */
  compliance: number;
  recommendedCategory?: SceneInteractionCategory;
}

/**
 * Anatomical clearance from the pelvis bone center to the bottom of the glutes/hips
 * when seated (~0.068m, matching chair 0.47m -> 0.535m and bed 0.49m -> 0.56m) or lying (~0.088m, matching bed 0.49m -> 0.58m).
 */
export const PELVIS_SEATED_GLUTE_CLEARANCE_M = 0.068;
export const PELVIS_LYING_BACK_CLEARANCE_M = 0.088;

export const STUDIO_BEDROOM_SUPPORT_SURFACES: SupportSurfaceDefinition[] = [
  {
    id: 'bed_pillow',
    label: 'Plump Bed Pillows',
    minX: 0.48,
    maxX: 2.02,
    minZ: -2.82,
    maxZ: -2.18,
    topY: 0.56,
    normal: { x: 0, y: 0.99, z: 0.14 },
    compliance: 0.02,
    recommendedCategory: 'bed_lying',
  },
  {
    id: 'bed_mattress',
    label: 'Bed Mattress',
    minX: 0.41,
    maxX: 2.09,
    minZ: -2.92,
    maxZ: -0.77,
    topY: 0.49,
    normal: { x: 0, y: 1, z: 0 },
    compliance: 0.015,
    recommendedCategory: 'bed_sitting',
  },
  {
    id: 'chair_seat',
    label: 'Task Chair Seat',
    minX: -1.85,
    maxX: -1.25,
    minZ: -0.06,
    maxZ: 0.56,
    topY: 0.47,
    normal: { x: 0, y: 1, z: 0 },
    compliance: 0.008,
    recommendedCategory: 'chair_sitting',
  },
  {
    id: 'desk_top',
    label: 'Creator Desk Surface',
    minX: -2.74,
    maxX: -1.96,
    minZ: -0.58,
    maxZ: 1.08,
    topY: 0.76,
    normal: { x: 0, y: 1, z: 0 },
    compliance: 0,
    recommendedCategory: 'leaning',
  },
  {
    id: 'window_bench',
    label: 'Window Seat Bench',
    minX: -2.96,
    maxX: -2.52,
    minZ: -2.55,
    maxZ: -1.15,
    topY: 0.44,
    normal: { x: 0, y: 1, z: 0 },
    compliance: 0.01,
    recommendedCategory: 'chair_sitting',
  },
  {
    id: 'rug',
    label: 'Woven Area Rug',
    minX: -1.57,
    maxX: 1.47,
    minZ: -1.97,
    maxZ: 1.47,
    topY: 0.012,
    normal: { x: 0, y: 1, z: 0 },
    compliance: 0.004,
    recommendedCategory: 'kneeling_floor',
  },
  {
    id: 'floor',
    label: 'Hardwood Studio Floor',
    minX: -10,
    maxX: 10,
    minZ: -10,
    maxZ: 10,
    topY: 0,
    normal: { x: 0, y: 1, z: 0 },
    compliance: 0,
    recommendedCategory: 'kneeling_floor',
  },
];

const _surfaceRaycaster = new THREE.Raycaster();
const _surfaceRayOrigin = new THREE.Vector3();
const _surfaceRayDir = new THREE.Vector3(0, -1, 0);

/**
 * Queries the active support surface at world `(x, z)` for a given environment.
 * Supports optional downward Three.js raycasting against explicit furniture collider meshes,
 * combined with deterministic analytical bounds so unit tests and headless runs stay 100% reliable.
 */
export function querySupportSurfaceAt(
  worldX: number,
  worldZ: number,
  environment: PlayboardEnvironment = 'studio_bedroom',
  maxRefY = 1.2,
  raycastMeshes?: THREE.Object3D[]
): SupportSurfaceDefinition {
  const floorDefault = STUDIO_BEDROOM_SUPPORT_SURFACES[STUDIO_BEDROOM_SUPPORT_SURFACES.length - 1];
  if (environment !== 'studio_bedroom') {
    return floorDefault;
  }
  let bestSurface = floorDefault;
  for (const surf of STUDIO_BEDROOM_SUPPORT_SURFACES) {
    if (
      worldX >= surf.minX &&
      worldX <= surf.maxX &&
      worldZ >= surf.minZ &&
      worldZ <= surf.maxZ &&
      surf.topY <= maxRefY + 0.15 &&
      surf.topY >= bestSurface.topY
    ) {
      bestSurface = surf;
    }
  }

  if (raycastMeshes && raycastMeshes.length > 0) {
    _surfaceRayOrigin.set(worldX, maxRefY + 0.45, worldZ);
    _surfaceRaycaster.set(_surfaceRayOrigin, _surfaceRayDir);
    _surfaceRaycaster.near = 0.01;
    _surfaceRaycaster.far = maxRefY + 0.6;
    const hits = _surfaceRaycaster.intersectObjects(raycastMeshes, true);
    for (const hit of hits) {
      if (hit.point.y >= -0.02 && hit.point.y <= maxRefY + 0.2) {
        const hitSurfId = (hit.object.userData?.supportSurfaceId ||
          hit.object.userData?.surfaceId) as PlayboardSupportSurfaceId | undefined;
        const matched = hitSurfId
          ? STUDIO_BEDROOM_SUPPORT_SURFACES.find((s) => s.id === hitSurfId)
          : undefined;
        const baseDef = matched || bestSurface;
        const worldNormal = hit.face?.normal
          ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
          : null;
        return {
          ...baseDef,
          topY: hit.point.y,
          normal:
            worldNormal && worldNormal.y > 0.35
              ? { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z }
              : baseDef.normal,
        };
      }
    }
  }

  return bestSurface;
}

export interface TwoBoneLimbIKResult {
  upperPitchRad: number;
  upperRollRad: number;
  hingeBendRad: number;
  endEffectorWorld: THREE.Vector3;
  clampedReach: boolean;
}

/**
 * General analytical Two-Bone IK solver with anatomical joint limits and pole preference.
 * Avoids knee/elbow flipping and excessive stretching.
 */
export function solveTwoBoneLimbIK(params: {
  rootWorld: THREE.Vector3;
  targetWorld: THREE.Vector3;
  upperLen: number;
  lowerLen: number;
  side: -1 | 1;
  isLeg: boolean;
  minHingeRad?: number;
  maxHingeRad?: number;
  maxRollRad?: number;
}): TwoBoneLimbIKResult {
  const {
    rootWorld,
    targetWorld,
    upperLen,
    lowerLen,
    side,
    isLeg,
    minHingeRad = 0.04,
    maxHingeRad = 2.42,
    maxRollRad = 0.78,
  } = params;

  const delta = new THREE.Vector3().subVectors(targetWorld, rootWorld);
  const rawDist = delta.length();
  const minReach = Math.max(0.12, Math.abs(upperLen - lowerLen) + 0.02);
  const maxReach = upperLen + lowerLen - 0.004;
  const clampedReach = rawDist > maxReach || rawDist < minReach;
  const dist = THREE.MathUtils.clamp(rawDist, minReach, maxReach);

  // Law of cosines for internal knee/elbow angle
  const cosInternal = THREE.MathUtils.clamp(
    (upperLen * upperLen + lowerLen * lowerLen - dist * dist) / (2 * upperLen * lowerLen),
    -1,
    1
  );
  const rawHingeRad = Math.PI - Math.acos(cosInternal);
  const hingeBendRad = THREE.MathUtils.clamp(rawHingeRad, minHingeRad, maxHingeRad);

  // Angle from root-to-target line to upper bone
  const cosBeta = THREE.MathUtils.clamp(
    (upperLen * upperLen + dist * dist - lowerLen * lowerLen) / (2 * upperLen * dist),
    -1,
    1
  );
  const beta = Math.acos(cosBeta);

  const downY = Math.max(0.05, -delta.y);
  const fwdZ = delta.z;
  const latX = delta.x;

  const dirPitch = Math.atan2(fwdZ, downY);
  // Legs bend with knee forward (-beta pitch); arms bend with elbow backward (+beta pitch)
  const upperPitchRad = isLeg ? -(dirPitch + beta) : -(dirPitch - beta);

  const rawRoll = Math.atan2(side * latX, Math.hypot(downY, fwdZ));
  const upperRollRad = side * THREE.MathUtils.clamp(rawRoll, -maxRollRad, maxRollRad);

  const dirNorm = rawDist > 1e-5 ? delta.clone().divideScalar(rawDist) : new THREE.Vector3(0, -1, 0);
  const endEffectorWorld = rootWorld.clone().addScaledVector(dirNorm, dist);

  return {
    upperPitchRad,
    upperRollRad,
    hingeBendRad,
    endEffectorWorld,
    clampedReach,
  };
}

/**
 * Cooperatively refines a resolved `SemanticCharacterRigPose` with surface-aware contact IK
 * for hands, knees, and feet on the floor, bed mattress, pillows, chair, window bench, or desk.
 * Gracefully returns the unadjusted pose if IK is disabled or if a custom GLB lacks validated bones.
 */
export function applySurfaceContactIKToRigPose(
  baseRig: SemanticCharacterRigPose,
  pose: CharacterPose3DSettings,
  environment: PlayboardEnvironment = 'studio_bedroom',
  ikEnabled = true,
  raycastMeshes?: THREE.Object3D[]
): SemanticCharacterRigPose {
  if (!ikEnabled) {
    return baseRig;
  }
  // Do not force procedural bone IK onto custom GLB models without validated human rig mapping
  if (pose.customModelBounds) {
    return baseRig;
  }

  const result: SemanticCharacterRigPose = { ...baseRig };
  const charX = pose.characterPosX ?? 0;
  const charZ = pose.characterPosZ ?? 0;
  const charYawRad = THREE.MathUtils.degToRad(pose.characterYawDeg ?? 0);
  const hasExplicitSeatHeight =
    typeof pose.seatHeightY === 'number' && Number.isFinite(pose.seatHeightY);

  // Determine the active support surface beneath the character root
  const maxSurfaceQueryY = hasExplicitSeatHeight ? pose.seatHeightY! + 0.18 : result.pelvisY + 0.55;
  const rootSurface = querySupportSurfaceAt(
    charX,
    charZ,
    environment,
    maxSurfaceQueryY,
    raycastMeshes
  );
  const effectiveSurfaceTopY = Math.max(0, rootSurface.topY - rootSurface.compliance);

  // 1. Quadruped, Prone, Kneeling, Sitting, or Lying on an elevated surface without explicit seatHeightY:
  if (!hasExplicitSeatHeight && effectiveSurfaceTopY > 0.05 && rootSurface.id !== 'desk_top') {
    if (result.requiresFloorHandContact || result.requiresFloorKneeContact) {
      result.pelvisY += effectiveSurfaceTopY;
    } else if (result.poseFamily === 'sitting') {
      // Elevate seated pelvis to surface top + anatomical glute clearance (0.068m)
      result.pelvisY = rootSurface.topY + PELVIS_SEATED_GLUTE_CLEARANCE_M;
    } else if (result.poseFamily === 'supine_reclined' || result.poseFamily === 'side_lying') {
      // Elevate lying pelvis to surface top + anatomical back/hip clearance (0.088m)
      result.pelvisY = rootSurface.topY + PELVIS_LYING_BACK_CLEARANCE_M;
    } else if (result.poseFamily === 'floor_sitting') {
      result.pelvisY = effectiveSurfaceTopY + 0.14;
    }
  }

  // 2. Floor/surface-supporting hands (all-fours, cow, cat, prone, kneeling fold)
  if (result.requiresFloorHandContact) {
    const handWorldX = charX + Math.sin(charYawRad) * 0.34;
    const handWorldZ = charZ + Math.cos(charYawRad) * 0.34;
    const handSurf = querySupportSurfaceAt(
      handWorldX,
      handWorldZ,
      environment,
      result.pelvisY + 0.25,
      raycastMeshes
    );
    const handContactY = Math.max(0, handSurf.topY - handSurf.compliance) + 0.042;

    const spineWorldPitch = result.pelvisPitchRad + result.spinePitchRad;
    const clavicleWorldPitch = spineWorldPitch + result.chestPitchRad;
    const spineY = result.pelvisY + 0.12 * Math.cos(result.pelvisPitchRad);
    const chestY = spineY + 0.18 * Math.cos(spineWorldPitch);
    const shoulderY = chestY + 0.19 * Math.cos(clavicleWorldPitch);

    if (Math.abs(handContactY - 0.042) > 0.008) {
      const lSolved = solveFloorSupportArmAngles(
        -1,
        shoulderY,
        clavicleWorldPitch,
        handContactY,
        pose.leftArmShoulderOutDeg ?? 14,
        0,
        0,
        result.poseFamily === 'kneeling_fold' ? -0.25 : -0.04
      );
      const rSolved = solveFloorSupportArmAngles(
        1,
        shoulderY,
        clavicleWorldPitch,
        handContactY,
        pose.rightArmShoulderOutDeg ?? 14,
        0,
        0,
        result.poseFamily === 'kneeling_fold' ? -0.25 : -0.04
      );
      result.leftShoulderPitchRad = lSolved.shoulderPitchRad;
      result.leftShoulderRollRad = lSolved.shoulderRollRad;
      result.leftElbowPitchRad = lSolved.elbowPitchRad;
      result.leftWristSupportPitchRad = lSolved.wristSupportPitchRad;
      result.rightShoulderPitchRad = rSolved.shoulderPitchRad;
      result.rightShoulderRollRad = rSolved.shoulderRollRad;
      result.rightElbowPitchRad = rSolved.elbowPitchRad;
      result.rightWristSupportPitchRad = rSolved.wristSupportPitchRad;
    }
  }

  // 3. Seated poses on Bed, Chair, or Window Bench: ensure feet plant cleanly on the floor/rug without sinking or hovering
  if (result.poseFamily === 'sitting' && (hasExplicitSeatHeight || effectiveSurfaceTopY > 0.2)) {
    const footWorldX = charX + Math.sin(charYawRad) * 0.36;
    const footWorldZ = charZ + Math.cos(charYawRad) * 0.36;
    const footSurface = querySupportSurfaceAt(
      footWorldX,
      footWorldZ,
      environment,
      0.25,
      raycastMeshes
    );
    const floorY = Math.max(0, footSurface.topY - footSurface.compliance);

    const checkSeatedLeg = (
      side: -1 | 1,
      hipPitchRad: number,
      hipRollRad: number,
      kneePitchRad: number,
      anklePitchRad: number
    ) => {
      const thighWorldPitch = result.pelvisPitchRad + hipPitchRad;
      const shinWorldPitch = thighWorldPitch + kneePitchRad;
      const footDrop =
        0.41 * Math.cos(thighWorldPitch) * Math.cos(hipRollRad) +
        0.39 * Math.cos(shinWorldPitch) +
        0.082;
      const footWorldY = result.pelvisY - footDrop;
      // Prevent foot from penetrating below floorY or hovering slightly when meant to plant
      if (footWorldY < floorY - 0.004 || (footWorldY > floorY + 0.008 && footWorldY < floorY + 0.09)) {
        const targetAnkleY = floorY + 0.082;
        const hipRoot = new THREE.Vector3(side * 0.095, result.pelvisY - 0.01, 0);
        const kneeHorizZ = 0.41 * Math.sin(-thighWorldPitch);
        const targetAnkle = new THREE.Vector3(
          side * (0.095 + Math.sin(Math.abs(hipRollRad)) * 0.14),
          targetAnkleY,
          Math.max(0.18, kneeHorizZ + 0.06)
        );
        const ikLeg = solveTwoBoneLimbIK({
          rootWorld: hipRoot,
          targetWorld: targetAnkle,
          upperLen: 0.41,
          lowerLen: 0.39,
          side,
          isLeg: true,
        });
        const targetDrop = Math.max(0.18, result.pelvisY - floorY);
        const thighDrop = 0.41 * Math.cos(thighWorldPitch) * Math.cos(hipRollRad);
        const neededShinCos = THREE.MathUtils.clamp((targetDrop - thighDrop - 0.082) / 0.39, -0.95, 0.99);
        const adjustedShinWorldPitch = Math.acos(neededShinCos);
        const adjustedKneePitch = THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(adjustedShinWorldPitch - thighWorldPitch, ikLeg.hingeBendRad, 0.35),
          0.1,
          2.35
        );
        const adjustedAnklePitch = THREE.MathUtils.clamp(
          -(thighWorldPitch + adjustedKneePitch) * 0.65,
          -0.65,
          0.65
        );
        return { kneePitchRad: adjustedKneePitch, anklePitchRad: adjustedAnklePitch };
      }
      return { kneePitchRad, anklePitchRad };
    };

    const lLeg = checkSeatedLeg(
      -1,
      result.leftHipPitchRad,
      result.leftHipRollRad,
      result.leftKneePitchRad,
      result.leftAnklePitchRad
    );
    result.leftKneePitchRad = lLeg.kneePitchRad;
    result.leftAnklePitchRad = lLeg.anklePitchRad;

    const rLeg = checkSeatedLeg(
      1,
      result.rightHipPitchRad,
      result.rightHipRollRad,
      result.rightKneePitchRad,
      result.rightAnklePitchRad
    );
    result.rightKneePitchRad = rLeg.kneePitchRad;
    result.rightAnklePitchRad = rLeg.anklePitchRad;
  }

  // 4. Standing / Squatting on Rug or Elevated Surface without explicit seatHeightY:
  if (
    (result.poseFamily === 'standing' || result.poseFamily === 'squatting') &&
    !hasExplicitSeatHeight &&
    effectiveSurfaceTopY > 0.002 &&
    effectiveSurfaceTopY < 0.05
  ) {
    result.pelvisY += effectiveSurfaceTopY;
  }

  return result;
}

// ============================================================================
// PHASE 2A: QUATERNION-SAFE POSE-TO-POSE TRANSITION CONTROLLER
// ============================================================================

export interface PoseTransitionState {
  currentPose: SemanticCharacterRigPose;
  fromPose: SemanticCharacterRigPose;
  targetPose: SemanticCharacterRigPose;
  progress: number;
  durationSec: number;
  isTransitioning: boolean;
  transitionSignature: string;
}

/**
 * Builds a signature string that identifies when a user changes semantic pose preset
 * or scene interaction preset (as opposed to continuous slider scrubbing).
 */
export function getPosePresetTransitionSignature(pose: CharacterPose3DSettings): string {
  return `${pose.basePose || 'natural_standing'}::${pose.interactionPresetId || 'none'}`;
}

/**
 * Interpolates two Euler (XYZ) joint rotations safely using `THREE.Quaternion.slerp`
 * to prevent gimbal lock, joint flipping, or unnatural axis wraparound.
 */
export function slerpEulerXYZ(
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  alpha: number
): { x: number; y: number; z: number } {
  const t = THREE.MathUtils.clamp(alpha, 0, 1);
  if (t <= 0) return { x: fromX, y: fromY, z: fromZ };
  if (t >= 1) return { x: toX, y: toY, z: toZ };

  const qFrom = new THREE.Quaternion().setFromEuler(new THREE.Euler(fromX, fromY, fromZ, 'XYZ'));
  const qTo = new THREE.Quaternion().setFromEuler(new THREE.Euler(toX, toY, toZ, 'XYZ'));
  qFrom.slerp(qTo, t);
  const eOut = new THREE.Euler().setFromQuaternion(qFrom, 'XYZ');
  return { x: eOut.x, y: eOut.y, z: eOut.z };
}

/**
 * Smooth C2-continuous quintic easing (`6t^5 - 15t^4 + 10t^3`) for natural acceleration/deceleration
 * between semantic poses.
 */
export function smoothstepQuintic(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Computes coordinated intermediate path offsets when transitioning between distinct pose families
 * (e.g. standing ↔ sitting, standing ↔ kneeling, standing ↔ quadruped/prone) so the pelvis,
 * spine, and knees follow an anatomically natural arc without clipping through the floor or bed.
 */
export function computeCoordinatedTransitionArc(
  fromFamily: SemanticCharacterRigPose['poseFamily'],
  toFamily: SemanticCharacterRigPose['poseFamily'],
  linearT: number
): {
  pelvisYArcOffset: number;
  pelvisZArcOffset: number;
  torsoCounterbalancePitchRad: number;
  kneeClearanceBendRad: number;
} {
  if (fromFamily === toFamily || linearT <= 0.001 || linearT >= 0.999) {
    return {
      pelvisYArcOffset: 0,
      pelvisZArcOffset: 0,
      torsoCounterbalancePitchRad: 0,
      kneeClearanceBendRad: 0,
    };
  }

  // Bell curve peaking at mid-transition (t = 0.5 -> sin(pi * t) = 1.0)
  const bell = Math.sin(Math.PI * THREE.MathUtils.clamp(linearT, 0, 1));
  const groundedFamilies: SemanticCharacterRigPose['poseFamily'][] = [
    'quadruped',
    'prone',
    'supine_reclined',
    'side_lying',
    'kneeling_fold',
    'floor_sitting',
  ];
  const isFromGrounded = groundedFamilies.includes(fromFamily);
  const isToGrounded = groundedFamilies.includes(toFamily);
  const isStandingToSeated =
    (fromFamily === 'standing' && (toFamily === 'sitting' || toFamily === 'kneeling_upright')) ||
    ((fromFamily === 'sitting' || fromFamily === 'kneeling_upright') && toFamily === 'standing');

  if (isFromGrounded !== isToGrounded) {
    // Transitioning between upright/seated and floor/bed grounded pose:
    // Add upward clearance arc on pelvisY, slight knee flexion clearance, and forward counterbalance lean
    return {
      pelvisYArcOffset: 0.065 * bell,
      pelvisZArcOffset: -0.035 * bell,
      torsoCounterbalancePitchRad: 0.16 * bell,
      kneeClearanceBendRad: 0.28 * bell,
    };
  }

  if (isStandingToSeated) {
    // Standing <-> Sitting/Kneeling: natural hip hinge & counterbalance forward lean
    return {
      pelvisYArcOffset: 0.03 * bell,
      pelvisZArcOffset: -0.025 * bell,
      torsoCounterbalancePitchRad: 0.14 * bell,
      kneeClearanceBendRad: 0.12 * bell,
    };
  }

  return {
    pelvisYArcOffset: 0.02 * bell,
    pelvisZArcOffset: 0,
    torsoCounterbalancePitchRad: 0.06 * bell,
    kneeClearanceBendRad: 0.08 * bell,
  };
}

/**
 * Interpolates two `SemanticCharacterRigPose` states using quaternion slerp for multi-axis joints
 * and coordinated transition arcs for root/pelvis and hinge joints.
 */
export function interpolateSemanticRigPose(
  fromPose: SemanticCharacterRigPose,
  toPose: SemanticCharacterRigPose,
  rawT: number
): SemanticCharacterRigPose {
  const clampedT = THREE.MathUtils.clamp(rawT, 0, 1);
  if (clampedT <= 0) return { ...fromPose };
  if (clampedT >= 1) return { ...toPose };

  const easedT = smoothstepQuintic(clampedT);
  const arc = computeCoordinatedTransitionArc(fromPose.poseFamily, toPose.poseFamily, clampedT);

  const pelvisRot = slerpEulerXYZ(
    fromPose.pelvisPitchRad,
    fromPose.pelvisYawRad,
    fromPose.pelvisRollRad,
    toPose.pelvisPitchRad,
    toPose.pelvisYawRad,
    toPose.pelvisRollRad,
    easedT
  );
  const spineRot = slerpEulerXYZ(
    fromPose.spinePitchRad,
    fromPose.spineYawRad,
    fromPose.spineRollRad,
    toPose.spinePitchRad,
    toPose.spineYawRad,
    toPose.spineRollRad,
    easedT
  );
  const chestRot = slerpEulerXYZ(
    fromPose.chestPitchRad,
    fromPose.chestYawRad,
    fromPose.chestRollRad,
    toPose.chestPitchRad,
    toPose.chestYawRad,
    toPose.chestRollRad,
    easedT
  );
  const neckRot = slerpEulerXYZ(
    fromPose.neckPitchRad,
    fromPose.neckYawRad,
    0,
    toPose.neckPitchRad,
    toPose.neckYawRad,
    0,
    easedT
  );
  const headRot = slerpEulerXYZ(
    fromPose.headPitchRad,
    fromPose.headYawRad,
    0,
    toPose.headPitchRad,
    toPose.headYawRad,
    0,
    easedT
  );
  const lShoulderRot = slerpEulerXYZ(
    fromPose.leftShoulderPitchRad,
    0,
    fromPose.leftShoulderRollRad,
    toPose.leftShoulderPitchRad,
    0,
    toPose.leftShoulderRollRad,
    easedT
  );
  const rShoulderRot = slerpEulerXYZ(
    fromPose.rightShoulderPitchRad,
    0,
    fromPose.rightShoulderRollRad,
    toPose.rightShoulderPitchRad,
    0,
    toPose.rightShoulderRollRad,
    easedT
  );
  const lHipRot = slerpEulerXYZ(
    fromPose.leftHipPitchRad,
    0,
    fromPose.leftHipRollRad,
    toPose.leftHipPitchRad,
    0,
    toPose.leftHipRollRad,
    easedT
  );
  const rHipRot = slerpEulerXYZ(
    fromPose.rightHipPitchRad,
    0,
    fromPose.rightHipRollRad,
    toPose.rightHipPitchRad,
    0,
    toPose.rightHipRollRad,
    easedT
  );

  const lerp = THREE.MathUtils.lerp;
  const lWristSupport =
    fromPose.leftWristSupportPitchRad !== null && toPose.leftWristSupportPitchRad !== null
      ? lerp(fromPose.leftWristSupportPitchRad, toPose.leftWristSupportPitchRad, easedT)
      : easedT < 0.5
      ? fromPose.leftWristSupportPitchRad
      : toPose.leftWristSupportPitchRad;
  const rWristSupport =
    fromPose.rightWristSupportPitchRad !== null && toPose.rightWristSupportPitchRad !== null
      ? lerp(fromPose.rightWristSupportPitchRad, toPose.rightWristSupportPitchRad, easedT)
      : easedT < 0.5
      ? fromPose.rightWristSupportPitchRad
      : toPose.rightWristSupportPitchRad;

  return {
    poseFamily: easedT < 0.5 ? fromPose.poseFamily : toPose.poseFamily,
    pelvisY: Math.max(0.12, lerp(fromPose.pelvisY, toPose.pelvisY, easedT) + arc.pelvisYArcOffset),
    pelvisZOffset: lerp(fromPose.pelvisZOffset, toPose.pelvisZOffset, easedT) + arc.pelvisZArcOffset,
    pelvisPitchRad: pelvisRot.x,
    pelvisYawRad: pelvisRot.y,
    pelvisRollRad: pelvisRot.z,
    spinePitchRad: spineRot.x + arc.torsoCounterbalancePitchRad * 0.45,
    spineYawRad: spineRot.y,
    spineRollRad: spineRot.z,
    chestPitchRad: chestRot.x + arc.torsoCounterbalancePitchRad * 0.55,
    chestYawRad: chestRot.y,
    chestRollRad: chestRot.z,
    neckPitchRad: neckRot.x,
    neckYawRad: neckRot.y,
    headPitchRad: headRot.x,
    headYawRad: headRot.y,
    leftShoulderPitchRad: lShoulderRot.x,
    leftShoulderRollRad: lShoulderRot.z,
    leftElbowPitchRad: lerp(fromPose.leftElbowPitchRad, toPose.leftElbowPitchRad, easedT),
    leftWristSupportPitchRad: lWristSupport,
    rightShoulderPitchRad: rShoulderRot.x,
    rightShoulderRollRad: rShoulderRot.z,
    rightElbowPitchRad: lerp(fromPose.rightElbowPitchRad, toPose.rightElbowPitchRad, easedT),
    rightWristSupportPitchRad: rWristSupport,
    leftHipPitchRad: lHipRot.x - arc.kneeClearanceBendRad * 0.35,
    leftHipRollRad: lHipRot.z,
    leftKneePitchRad: THREE.MathUtils.clamp(
      lerp(fromPose.leftKneePitchRad, toPose.leftKneePitchRad, easedT) + arc.kneeClearanceBendRad,
      0,
      2.45
    ),
    leftAnklePitchRad: lerp(fromPose.leftAnklePitchRad, toPose.leftAnklePitchRad, easedT),
    leftAnkleYawRad: lerp(fromPose.leftAnkleYawRad, toPose.leftAnkleYawRad, easedT),
    rightHipPitchRad: rHipRot.x - arc.kneeClearanceBendRad * 0.35,
    rightHipRollRad: rHipRot.z,
    rightKneePitchRad: THREE.MathUtils.clamp(
      lerp(fromPose.rightKneePitchRad, toPose.rightKneePitchRad, easedT) + arc.kneeClearanceBendRad,
      0,
      2.45
    ),
    rightAnklePitchRad: lerp(fromPose.rightAnklePitchRad, toPose.rightAnklePitchRad, easedT),
    rightAnkleYawRad: lerp(fromPose.rightAnkleYawRad, toPose.rightAnkleYawRad, easedT),
    requiresFloorHandContact:
      easedT < 0.5 ? fromPose.requiresFloorHandContact : toPose.requiresFloorHandContact,
    requiresFloorKneeContact:
      easedT < 0.5 ? fromPose.requiresFloorKneeContact : toPose.requiresFloorKneeContact,
  };
}

export function createPoseTransitionState(
  initialPose: SemanticCharacterRigPose,
  signature = 'natural_standing::none'
): PoseTransitionState {
  return {
    currentPose: { ...initialPose },
    fromPose: { ...initialPose },
    targetPose: { ...initialPose },
    progress: 1,
    durationSec: 0.42,
    isTransitioning: false,
    transitionSignature: signature,
  };
}

/**
 * Advances or retargets the pose transition state machine.
 * - If `newSignature !== state.transitionSignature`, retargets cleanly from `state.currentPose`
 *   so overlapping transitions never fight or snap.
 * - If `instantPoseTransitions` is true, snaps immediately (`progress = 1`) to the deterministic target.
 */
export function stepPoseTransition(
  state: PoseTransitionState,
  targetPose: SemanticCharacterRigPose,
  newSignature: string,
  dt: number,
  instantPoseTransitions = false
): SemanticCharacterRigPose {
  if (instantPoseTransitions) {
    state.fromPose = { ...targetPose };
    state.targetPose = { ...targetPose };
    state.currentPose = { ...targetPose };
    state.progress = 1;
    state.isTransitioning = false;
    state.transitionSignature = newSignature;
    return state.currentPose;
  }

  if (newSignature !== state.transitionSignature) {
    // Retarget from the current blended pose so overlapping transitions are seamless
    state.fromPose = { ...state.currentPose };
    state.targetPose = { ...targetPose };
    state.progress = 0;
    state.isTransitioning = true;
    // Slightly longer transition when crossing pose families (e.g. standing -> bed lying)
    state.durationSec =
      state.fromPose.poseFamily !== targetPose.poseFamily ? 0.46 : 0.34;
    state.transitionSignature = newSignature;
  } else {
    // Keep target updated with any live slider adjustments
    state.targetPose = { ...targetPose };
  }

  if (!state.isTransitioning || state.progress >= 1) {
    // When not in a preset transition, smoothly damp towards slider edits
    const safeDt = Math.min(Math.max(dt, 0), 0.1);
    const sliderAlpha = safeDt > 0 ? 1 - Math.exp(-18 * safeDt) : 1;
    state.currentPose = interpolateSemanticRigPose(state.currentPose, state.targetPose, sliderAlpha);
    state.progress = 1;
    state.isTransitioning = false;
    return state.currentPose;
  }

  const safeDt = Math.min(Math.max(dt, 0), 0.1);
  state.progress = Math.min(1, state.progress + safeDt / Math.max(0.08, state.durationSec));
  if (state.progress >= 1) {
    state.progress = 1;
    state.isTransitioning = false;
    state.currentPose = { ...state.targetPose };
  } else {
    state.currentPose = interpolateSemanticRigPose(
      state.fromPose,
      state.targetPose,
      state.progress
    );
  }
  return state.currentPose;
}

// ============================================================================
// PHASE 2C: TIME-BASED SECONDARY MOTION & EYE-LEAD GAZE RESPONSE
// ============================================================================

export interface SecondaryMotionState {
  breathTimeSec: number;
  eyeLeadYawRad: number;
  eyeLeadPitchRad: number;
  headFollowYawRad: number;
  headFollowPitchRad: number;
  chestFollowYawRad: number;
  chestBreathPitchRad: number;
  shoulderBreathRollRad: number;
  neckCounterPitchRad: number;
  fingerRelaxWaveRad: number;
}

export function createSecondaryMotionState(): SecondaryMotionState {
  return {
    breathTimeSec: 0,
    eyeLeadYawRad: 0,
    eyeLeadPitchRad: 0,
    headFollowYawRad: 0,
    headFollowPitchRad: 0,
    chestFollowYawRad: 0,
    chestBreathPitchRad: 0,
    shoulderBreathRollRad: 0,
    neckCounterPitchRad: 0,
    fingerRelaxWaveRad: 0,
  };
}

/**
 * Advances subtle breathing, shoulder/clavicle rise, neck counterbalance, finger micro-relaxation,
 * and eye-lead gaze response where eyes lead a gaze change followed by a subtle delayed head/chest response.
 * When `animationPaused` is true, returns zeroed secondary offsets so the pose is 100% deterministic for I2I.
 */
export function stepSecondaryMotionAndGaze(
  state: SecondaryMotionState,
  gaze: GazeDirection,
  dt: number,
  animationPaused = false
): SecondaryMotionState {
  if (animationPaused) {
    state.chestBreathPitchRad = 0;
    state.shoulderBreathRollRad = 0;
    state.neckCounterPitchRad = 0;
    state.headFollowYawRad = 0;
    state.headFollowPitchRad = 0;
    state.chestFollowYawRad = 0;
    state.fingerRelaxWaveRad = 0;
    return state;
  }

  const safeDt = Math.min(Math.max(dt, 0), 0.1);
  state.breathTimeSec += safeDt;

  // Target gaze bias for eye-lead + subtle delayed head/upper-body follow
  let targetGazeBiasYaw = 0;
  let targetGazeBiasPitch = 0;
  if (gaze === 'looking_camera_left') {
    targetGazeBiasYaw = -0.085;
  } else if (gaze === 'looking_camera_right') {
    targetGazeBiasYaw = 0.085;
  } else if (gaze === 'looking_upward') {
    targetGazeBiasPitch = -0.065;
  } else if (gaze === 'looking_downward') {
    targetGazeBiasPitch = 0.065;
  } else if (gaze === 'soft_off_camera') {
    targetGazeBiasYaw = 0.05;
    targetGazeBiasPitch = 0.025;
  }

  // Eyes lead rapidly (lambda = 20), head follows smoothly after eyes (lambda = 4.5), chest follows subtly (lambda = 2.8)
  const eyeFactor = 1 - Math.exp(-20 * safeDt);
  const headFactor = 1 - Math.exp(-4.5 * safeDt);
  const chestFactor = 1 - Math.exp(-2.8 * safeDt);

  state.eyeLeadYawRad += (targetGazeBiasYaw - state.eyeLeadYawRad) * eyeFactor;
  state.eyeLeadPitchRad += (targetGazeBiasPitch - state.eyeLeadPitchRad) * eyeFactor;

  state.headFollowYawRad += (state.eyeLeadYawRad * 0.65 - state.headFollowYawRad) * headFactor;
  state.headFollowPitchRad += (state.eyeLeadPitchRad * 0.6 - state.headFollowPitchRad) * headFactor;
  state.chestFollowYawRad += (state.headFollowYawRad * 0.35 - state.chestFollowYawRad) * chestFactor;

  // Subtle chest/clavicle breathing with restrained neck/head counterbalance
  const breathCycle = Math.sin(state.breathTimeSec * 1.85);
  state.chestBreathPitchRad = breathCycle * 0.014;
  state.shoulderBreathRollRad = (breathCycle * 0.5 + 0.5) * 0.012;
  state.neckCounterPitchRad = -breathCycle * 0.008;
  state.fingerRelaxWaveRad = Math.sin(state.breathTimeSec * 1.35 + 0.7) * 0.028;

  return state;
}



