import * as THREE from 'three';
import {
  CharacterPose3DSettings,
  HandGesture,
  PlayboardEnvironment,
  PosePreset,
  SceneInteractionPresetId,
} from '../types/cameraPlayboard';
import { SemanticCharacterRigPose } from './framingAnalyzer';

export type SupportSurfaceId =
  | 'floor'
  | 'rug'
  | 'bed_mattress'
  | 'bed_pillow'
  | 'chair_seat'
  | 'window_bench'
  | 'desk_top';

export interface SceneSurfaceCollider {
  id: SupportSurfaceId;
  label: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
  normal: [number, number, number];
  isSeatingSurface: boolean;
  isLyingSurface: boolean;
  recommendedPoses: PosePreset[];
  recommendedPresets: SceneInteractionPresetId[];
}

export interface FurnitureAnchorHotspot {
  id: string;
  label: string;
  surfaceId: SupportSurfaceId;
  x: number;
  z: number;
  topY: number;
  facingDeg: number;
  snapRadius: number;
  defaultPose: PosePreset;
  defaultInteractionPresetId?: SceneInteractionPresetId;
  recommendedPoses: PosePreset[];
  recommendedPresets: SceneInteractionPresetId[];
}

export interface SurfaceContactQueryResult {
  surfaceId: SupportSurfaceId;
  surfaceLabel: string;
  elevationY: number;
  normal: THREE.Vector3;
  nearestAnchor: FurnitureAnchorHotspot | null;
  anchorDistance: number;
  isSnappedToAnchor: boolean;
}

export interface TwoBoneIKResult {
  upperPitchDelta: number;
  upperRollDelta: number;
  lowerBendDelta: number;
  effectorDeltaY: number;
  contactActive: boolean;
}

export interface SurfaceAwareIKDiagnosis {
  activeSurfaceId: SupportSurfaceId;
  activeSurfaceLabel: string;
  supportElevationY: number;
  pelvisSurfaceOffsetY: number;
  leftFootContact: boolean;
  rightFootContact: boolean;
  leftHandContact: boolean;
  rightHandContact: boolean;
  leftKneeContact: boolean;
  rightKneeContact: boolean;
  appliedFootLiftL: number;
  appliedFootLiftR: number;
  appliedHandLiftL: number;
  appliedHandLiftR: number;
  customGlbFallback: boolean;
}

export interface PoseTransitionSnapshot {
  isTransitioning: boolean;
  progress: number;
  durationSec: number;
  fromPose: PosePreset;
  toPose: PosePreset;
  pelvisArcOffsetY: number;
  retargetCount: number;
}

export interface SecondaryMotionOffsets {
  chestBreathPitch: number;
  chestBreathScaleY: number;
  chestBreathScaleXZ: number;
  clavicleBreathRoll: number;
  neckCounterPitch: number;
  headMicroSwayYaw: number;
  headMicroSwayRoll: number;
  eyeGazeYawRad: number;
  eyeGazePitchRad: number;
  headGazeYawRad: number;
  headGazePitchRad: number;
  chestGazeYawRad: number;
  chestGazePitchRad: number;
  fingerRelaxationCurlDelta: number;
  fingerRelaxationSpreadDelta: number;
}

export type DirectJointHandleId =
  | 'root'
  | 'hips'
  | 'torso'
  | 'head'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_knee'
  | 'right_knee';

/**
 * Exact bedroom furniture surface colliders aligned with Playboard3DCanvas.tsx & framingAnalyzer.ts:
 * - Bed center: (1.25, 0, -1.85), width 1.68m [0.41..2.09], length 2.15m [-2.92..-0.77], mattress top Y = 0.49m
 * - Pillows zone: X [0.48..2.02], Z [-2.82..-2.18], top Y = 0.56m
 * - Chair center: (-1.55, 0, 0.25), seat top Y = 0.47m
 * - Desk center: (-2.35, 0, 0.25), tabletop Y = 0.76m
 * - Window seat bench: (-2.74, 0, -1.85), X [-2.96..-2.52], Z [-2.55..-1.15], top Y = 0.44m
 * - Woven area rug: center (-0.05, 0, -0.25), X [-1.57..1.47], Z [-1.97..1.47], top Y = 0.012m
 */
export const BEDROOM_SURFACE_COLLIDERS: SceneSurfaceCollider[] = [
  {
    id: 'bed_pillow',
    label: 'Plump Bed Pillows',
    minX: 0.48,
    maxX: 2.02,
    minZ: -2.82,
    maxZ: -2.18,
    topY: 0.56,
    normal: [0, 0.99, 0.14],
    isSeatingSurface: true,
    isLyingSurface: true,
    recommendedPoses: ['reclined_lying', 'casual_sitting', 'side_lying_open'],
    recommendedPresets: [
      'bed_lie_hands_behind_head',
      'bed_lie_arm_above_head',
      'bed_lie_back',
      'bed_lie_look_side',
      'bed_sit_cross_legged',
    ],
  },
  {
    id: 'bed_mattress',
    label: 'Bed Mattress & Duvet',
    minX: 0.41,
    maxX: 2.09,
    minZ: -2.92,
    maxZ: -0.77,
    topY: 0.49,
    normal: [0, 1, 0],
    isSeatingSurface: true,
    isLyingSurface: true,
    recommendedPoses: [
      'casual_sitting',
      'reclined_lying',
      'side_lying_open',
      'all_fours_neutral',
      'cow_pose_arched',
      'grounded_kneeling',
    ],
    recommendedPresets: [
      'bed_sit_edge_forward',
      'bed_sit_left_edge',
      'bed_sit_cross_legged',
      'bed_lie_back',
      'bed_lie_side',
      'bed_lie_stomach',
    ],
  },
  {
    id: 'chair_seat',
    label: 'Cognac Swivel Chair',
    minX: -1.85,
    maxX: -1.25,
    minZ: -0.06,
    maxZ: 0.56,
    topY: 0.47,
    normal: [0, 1, 0],
    isSeatingSurface: true,
    isLyingSurface: false,
    recommendedPoses: ['casual_sitting', 'natural_standing'],
    recommendedPresets: [
      'chair_sit_upright_thighs',
      'chair_sit_legs_crossed',
      'chair_sit_lean_forward',
      'chair_sit_arm_on_desk',
    ],
  },
  {
    id: 'desk_top',
    label: 'Creator Desk Surface',
    minX: -2.74,
    maxX: -1.96,
    minZ: -0.58,
    maxZ: 1.08,
    topY: 0.76,
    normal: [0, 1, 0],
    isSeatingSurface: false,
    isLyingSurface: false,
    recommendedPoses: ['wall_lean', 'bent_over_support', 'natural_standing'],
    recommendedPresets: ['lean_against_desk', 'lean_forward_hands_on_desk'],
  },
  {
    id: 'window_bench',
    label: 'Window Seat Bench',
    minX: -2.96,
    maxX: -2.52,
    minZ: -2.55,
    maxZ: -1.15,
    topY: 0.44,
    normal: [0, 1, 0],
    isSeatingSurface: true,
    isLyingSurface: false,
    recommendedPoses: ['casual_sitting', 'floor_seated_cross_legged', 'wall_lean'],
    recommendedPresets: ['lean_against_wall', 'chair_sit_legs_crossed'],
  },
  {
    id: 'rug',
    label: 'Woven Area Rug',
    minX: -1.57,
    maxX: 1.47,
    minZ: -1.97,
    maxZ: 1.47,
    topY: 0.012,
    normal: [0, 1, 0],
    isSeatingSurface: true,
    isLyingSurface: true,
    recommendedPoses: [
      'natural_standing',
      'contrapposto',
      'floor_seated_cross_legged',
      'grounded_kneeling',
      'all_fours_neutral',
      'cow_pose_arched',
      'deep_squat',
    ],
    recommendedPresets: [
      'floor_sit_cross_legged',
      'floor_kneel_upright',
      'floor_sit_on_heels',
      'floor_kneel_hands_on_bed',
    ],
  },
  {
    id: 'floor',
    label: 'Honey-Oak Plank Floor',
    minX: -3.2,
    maxX: 3.2,
    minZ: -3.2,
    maxZ: 3.2,
    topY: 0,
    normal: [0, 1, 0],
    isSeatingSurface: true,
    isLyingSurface: true,
    recommendedPoses: [
      'natural_standing',
      'contrapposto',
      'power_stance',
      'mid_stride_walking',
      'floor_seated_cross_legged',
      'grounded_kneeling',
    ],
    recommendedPresets: ['floor_sit_cross_legged', 'floor_kneel_upright', 'lean_against_wall'],
  },
];

export const FURNITURE_ANCHOR_HOTSPOTS: FurnitureAnchorHotspot[] = [
  {
    id: 'bed_front_edge_anchor',
    label: 'Bed Front Edge',
    surfaceId: 'bed_mattress',
    x: 1.25,
    z: -1.08,
    topY: 0.49,
    facingDeg: 0,
    snapRadius: 0.34,
    defaultPose: 'casual_sitting',
    defaultInteractionPresetId: 'bed_sit_edge_forward',
    recommendedPoses: ['casual_sitting', 'natural_standing', 'grounded_kneeling'],
    recommendedPresets: [
      'bed_sit_edge_forward',
      'bed_sit_legs_together',
      'bed_sit_legs_apart',
      'bed_sit_lean_forward_elbows',
      'bed_sit_one_leg_bent',
    ],
  },
  {
    id: 'bed_left_edge_anchor',
    label: 'Bed Left Edge',
    surfaceId: 'bed_mattress',
    x: 0.73,
    z: -1.65,
    topY: 0.49,
    facingDeg: -90,
    snapRadius: 0.32,
    defaultPose: 'casual_sitting',
    defaultInteractionPresetId: 'bed_sit_left_edge',
    recommendedPoses: ['casual_sitting', 'reclined_lying'],
    recommendedPresets: [
      'bed_sit_left_edge',
      'bed_sit_sideways_hanging',
      'bed_sit_look_over_shoulder',
    ],
  },
  {
    id: 'bed_center_lounge_anchor',
    label: 'Bed Center Lounge',
    surfaceId: 'bed_mattress',
    x: 1.25,
    z: -1.82,
    topY: 0.49,
    facingDeg: 0,
    snapRadius: 0.42,
    defaultPose: 'reclined_lying',
    defaultInteractionPresetId: 'bed_lie_back',
    recommendedPoses: [
      'reclined_lying',
      'side_lying_open',
      'all_fours_neutral',
      'cow_pose_arched',
      'prone_hip_elevated',
    ],
    recommendedPresets: [
      'bed_lie_back',
      'bed_lie_side',
      'bed_lie_stomach',
      'bed_lie_knees_bent',
      'bed_sit_cross_legged',
    ],
  },
  {
    id: 'bed_pillow_anchor',
    label: 'Pillow Headrest Area',
    surfaceId: 'bed_pillow',
    x: 1.25,
    z: -2.35,
    topY: 0.56,
    facingDeg: 0,
    snapRadius: 0.36,
    defaultPose: 'reclined_lying',
    defaultInteractionPresetId: 'bed_lie_hands_behind_head',
    recommendedPoses: ['reclined_lying', 'side_lying_open', 'casual_sitting'],
    recommendedPresets: [
      'bed_lie_hands_behind_head',
      'bed_lie_arm_above_head',
      'bed_lie_look_side',
      'bed_lie_back',
    ],
  },
  {
    id: 'chair_seat_anchor',
    label: 'Desk Swivel Chair',
    surfaceId: 'chair_seat',
    x: -1.55,
    z: 0.25,
    topY: 0.47,
    facingDeg: -90,
    snapRadius: 0.32,
    defaultPose: 'casual_sitting',
    defaultInteractionPresetId: 'chair_sit_upright_thighs',
    recommendedPoses: ['casual_sitting', 'natural_standing'],
    recommendedPresets: [
      'chair_sit_upright_thighs',
      'chair_sit_legs_crossed',
      'chair_sit_lean_forward',
      'chair_sit_arm_on_desk',
    ],
  },
  {
    id: 'desk_lean_anchor',
    label: 'Creator Desk Edge',
    surfaceId: 'desk_top',
    x: -1.78,
    z: -0.18,
    topY: 0.76,
    facingDeg: 90,
    snapRadius: 0.3,
    defaultPose: 'wall_lean',
    defaultInteractionPresetId: 'lean_against_desk',
    recommendedPoses: ['wall_lean', 'bent_over_support', 'natural_standing'],
    recommendedPresets: ['lean_against_desk', 'lean_forward_hands_on_desk'],
  },
  {
    id: 'window_nook_anchor',
    label: 'Window Seat Bench',
    surfaceId: 'window_bench',
    x: -2.62,
    z: -1.85,
    topY: 0.44,
    facingDeg: 90,
    snapRadius: 0.36,
    defaultPose: 'casual_sitting',
    recommendedPoses: ['casual_sitting', 'floor_seated_cross_legged', 'wall_lean'],
    recommendedPresets: ['lean_against_wall', 'chair_sit_legs_crossed'],
  },
  {
    id: 'rug_center_anchor',
    label: 'Center Stage Rug',
    surfaceId: 'rug',
    x: 0,
    z: 0,
    topY: 0.012,
    facingDeg: 0,
    snapRadius: 0.34,
    defaultPose: 'contrapposto',
    recommendedPoses: [
      'natural_standing',
      'contrapposto',
      'floor_seated_cross_legged',
      'grounded_kneeling',
      'all_fours_neutral',
    ],
    recommendedPresets: ['floor_sit_cross_legged', 'floor_kneel_upright', 'floor_sit_on_heels'],
  },
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * Math.max(0, dt)));
}

/**
 * Classifies a pose into high-level vertical stance families so transitions
 * coordinate a natural vertical pelvis clearance arc and avoid floor/furniture clipping.
 */
export type PoseVerticalFamily = 'standing' | 'elevated_sit' | 'floor_low' | 'horizontal';

export function classifyPoseVerticalFamily(
  pose: PosePreset,
  interactionPresetId?: SceneInteractionPresetId | null
): PoseVerticalFamily {
  if (
    pose === 'natural_standing' ||
    pose === 'contrapposto' ||
    pose === 'power_stance' ||
    pose === 'mid_stride_walking' ||
    pose === 'dynamic_running' ||
    pose === 'wall_lean' ||
    pose === 'welcoming_wave' ||
    pose === 'bent_over_support'
  ) {
    return 'standing';
  }
  if (pose === 'casual_sitting') {
    return 'elevated_sit';
  }
  if (
    pose === 'reclined_lying' ||
    pose === 'side_lying_open' ||
    pose === 'prone_hip_elevated'
  ) {
    return 'horizontal';
  }
  if (
    interactionPresetId &&
    (interactionPresetId.startsWith('bed_') || interactionPresetId.startsWith('chair_'))
  ) {
    return 'elevated_sit';
  }
  return 'floor_low';
}

/**
 * Queries the active support surface at world (x, z) using optional Three.js raycasting
 * combined with deterministic analytical bounds so unit tests and headless runs stay 100% reliable.
 */
export function querySceneSurfaceAt(
  x: number,
  z: number,
  environment: PlayboardEnvironment,
  raycastMeshes?: THREE.Object3D[]
): SurfaceContactQueryResult {
  if (environment !== 'studio_bedroom') {
    return {
      surfaceId: 'floor',
      surfaceLabel: environment === 'cyber_grid' ? 'Cyber Stage Grid' : 'Studio Cyclorama Floor',
      elevationY: 0,
      normal: new THREE.Vector3(0, 1, 0),
      nearestAnchor: null,
      anchorDistance: Infinity,
      isSnappedToAnchor: false,
    };
  }

  let matchedCollider = BEDROOM_SURFACE_COLLIDERS[BEDROOM_SURFACE_COLLIDERS.length - 1];
  for (const collider of BEDROOM_SURFACE_COLLIDERS) {
    if (x >= collider.minX && x <= collider.maxX && z >= collider.minZ && z <= collider.maxZ) {
      matchedCollider = collider;
      break;
    }
  }

  let elevationY = matchedCollider.topY;
  const normal = new THREE.Vector3(
    matchedCollider.normal[0],
    matchedCollider.normal[1],
    matchedCollider.normal[2]
  ).normalize();

  // Optional mesh raycast refinement when live Three.js furniture meshes are provided
  if (raycastMeshes && raycastMeshes.length > 0) {
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, 2.2, z),
      new THREE.Vector3(0, -1, 0),
      0.1,
      2.5
    );
    const hits = raycaster.intersectObjects(raycastMeshes, true);
    if (hits.length > 0) {
      const topHit = hits[0];
      if (Number.isFinite(topHit.point.y) && topHit.point.y >= 0 && topHit.point.y <= 0.95) {
        elevationY = topHit.point.y;
        if (topHit.face?.normal) {
          normal.copy(topHit.face.normal).transformDirection(topHit.object.matrixWorld).normalize();
        }
      }
    }
  }

  let nearestAnchor: FurnitureAnchorHotspot | null = null;
  let nearestDist = Infinity;
  for (const anchor of FURNITURE_ANCHOR_HOTSPOTS) {
    const d = Math.hypot(x - anchor.x, z - anchor.z);
    if (d < nearestDist) {
      nearestDist = d;
      nearestAnchor = anchor;
    }
  }

  const isSnappedToAnchor =
    nearestAnchor !== null && nearestDist <= nearestAnchor.snapRadius;

  return {
    surfaceId: matchedCollider.id,
    surfaceLabel: matchedCollider.label,
    elevationY,
    normal,
    nearestAnchor,
    anchorDistance: nearestDist,
    isSnappedToAnchor,
  };
}

/**
 * Evaluates magnetic furniture anchor snapping when dragging the character in the 3D viewport.
 */
export function evaluateMagneticAnchorSnap(
  x: number,
  z: number,
  environment: PlayboardEnvironment,
  magneticEnabled = true
): {
  x: number;
  z: number;
  snappedAnchor: FurnitureAnchorHotspot | null;
} {
  if (!magneticEnabled || environment !== 'studio_bedroom') {
    return { x, z, snappedAnchor: null };
  }

  let bestAnchor: FurnitureAnchorHotspot | null = null;
  let bestDist = Infinity;
  for (const anchor of FURNITURE_ANCHOR_HOTSPOTS) {
    const d = Math.hypot(x - anchor.x, z - anchor.z);
    if (d <= anchor.snapRadius && d < bestDist) {
      bestDist = d;
      bestAnchor = anchor;
    }
  }

  if (!bestAnchor) {
    return { x, z, snappedAnchor: null };
  }

  const pullT = clamp(1 - bestDist / bestAnchor.snapRadius, 0, 1);
  const pullStrength = pullT > 0.55 ? 0.85 : pullT * 0.45;
  return {
    x: x + (bestAnchor.x - x) * pullStrength,
    z: z + (bestAnchor.z - z) * pullStrength,
    snappedAnchor: bestAnchor,
  };
}

/**
 * Analytical 2-bone IK solver with joint limits and pole constraint for adapting
 * planted hands, feet, or knees to surface height deltas without over-extending limbs.
 */
export function solveTwoBoneIK3D(params: {
  upperLength: number;
  lowerLength: number;
  currentTargetDist: number;
  desiredElevationDeltaY: number;
  baseUpperPitch: number;
  baseLowerBend: number;
  isLeg: boolean;
  maxUpperDeltaRad?: number;
  maxLowerDeltaRad?: number;
}): TwoBoneIKResult {
  const {
    upperLength,
    lowerLength,
    currentTargetDist,
    desiredElevationDeltaY,
    isLeg,
    maxUpperDeltaRad = 0.52,
    maxLowerDeltaRad = 0.78,
  } = params;

  if (Math.abs(desiredElevationDeltaY) < 0.002) {
    return {
      upperPitchDelta: 0,
      upperRollDelta: 0,
      lowerBendDelta: 0,
      effectorDeltaY: 0,
      contactActive: false,
    };
  }

  const maxReach = (upperLength + lowerLength) * 0.985;
  const minReach = Math.abs(upperLength - lowerLength) + 0.06;
  const clampedCurrDist = clamp(currentTargetDist, minReach, maxReach);
  const clampedNewDist = clamp(
    clampedCurrDist - desiredElevationDeltaY * 0.82,
    minReach,
    maxReach
  );

  const cosAngle = (dist: number) =>
    clamp(
      (upperLength * upperLength + lowerLength * lowerLength - dist * dist) /
        (2 * upperLength * lowerLength),
      -0.98,
      0.98
    );

  const interiorOld = Math.acos(cosAngle(clampedCurrDist));
  const interiorNew = Math.acos(cosAngle(clampedNewDist));
  const bendChange = interiorOld - interiorNew;

  const sign = isLeg ? 1 : -1;
  const lowerBendDelta = clamp(sign * bendChange, -maxLowerDeltaRad, maxLowerDeltaRad);
  const upperPitchDelta = clamp(-bendChange * 0.52, -maxUpperDeltaRad, maxUpperDeltaRad);

  return {
    upperPitchDelta,
    upperRollDelta: 0,
    lowerBendDelta,
    effectorDeltaY: desiredElevationDeltaY,
    contactActive: true,
  };
}

/**
 * Computes surface-aware elevation and two-bone IK limb adjustments for a resolved semantic pose,
 * keeping planted feet, knees, and hands in coherent contact with the floor, rug, bed, chair, or window bench.
 */
export function computeSurfaceAwarePoseAdjustments(params: {
  pose: SemanticCharacterRigPose;
  poseSettings: CharacterPose3DSettings;
  environment: PlayboardEnvironment;
  ikEnabled?: boolean;
  hasCustomGlb?: boolean;
  raycastMeshes?: THREE.Object3D[];
}): {
  adjustedPose: SemanticCharacterRigPose;
  diagnosis: SurfaceAwareIKDiagnosis;
} {
  const {
    pose,
    poseSettings,
    environment,
    ikEnabled = true,
    hasCustomGlb = false,
    raycastMeshes,
  } = params;

  const x = poseSettings.characterPosX ?? 0;
  const z = poseSettings.characterPosZ ?? 0;
  const basePose = poseSettings.basePose || 'natural_standing';
  const presetId = poseSettings.interactionPresetId ?? null;

  const centerSurface = querySceneSurfaceAt(x, z, environment, raycastMeshes);
  const adjusted: SemanticCharacterRigPose = { ...pose };

  const hasExplicitSeatHeight =
    typeof poseSettings.seatHeightY === 'number' && poseSettings.seatHeightY > 0.05;

  const isOnElevatedFurniture =
    environment === 'studio_bedroom' &&
    (centerSurface.surfaceId === 'bed_mattress' ||
      centerSurface.surfaceId === 'bed_pillow' ||
      centerSurface.surfaceId === 'chair_seat' ||
      centerSurface.surfaceId === 'window_bench');

  let pelvisSurfaceOffsetY = 0;

  if (environment === 'studio_bedroom' && !hasExplicitSeatHeight) {
    if (centerSurface.surfaceId === 'rug') {
      pelvisSurfaceOffsetY = centerSurface.elevationY;
    } else if (isOnElevatedFurniture) {
      const family = classifyPoseVerticalFamily(basePose, presetId);
      if (family === 'floor_low' || family === 'horizontal') {
        pelvisSurfaceOffsetY = centerSurface.elevationY;
      } else if (family === 'elevated_sit') {
        pelvisSurfaceOffsetY = centerSurface.elevationY - 0.46;
      }
    }
  }

  adjusted.pelvisY = Math.max(0.14, adjusted.pelvisY + pelvisSurfaceOffsetY);

  if (!ikEnabled || hasCustomGlb) {
    return {
      adjustedPose: adjusted,
      diagnosis: {
        activeSurfaceId: centerSurface.surfaceId,
        activeSurfaceLabel: centerSurface.surfaceLabel,
        supportElevationY: centerSurface.elevationY,
        pelvisSurfaceOffsetY,
        leftFootContact:
          pose.poseFamily === 'standing' ||
          pose.poseFamily === 'sitting' ||
          pose.poseFamily === 'squatting',
        rightFootContact:
          pose.poseFamily === 'standing' ||
          pose.poseFamily === 'sitting' ||
          pose.poseFamily === 'squatting',
        leftHandContact: pose.requiresFloorHandContact,
        rightHandContact: pose.requiresFloorHandContact,
        leftKneeContact: pose.requiresFloorKneeContact,
        rightKneeContact: pose.requiresFloorKneeContact,
        appliedFootLiftL: 0,
        appliedFootLiftR: 0,
        appliedHandLiftL: 0,
        appliedHandLiftR: 0,
        customGlbFallback: hasCustomGlb,
      },
    };
  }

  const facingRad = ((poseSettings.characterYawDeg ?? 0) * Math.PI) / 180;
  const sinYaw = Math.sin(facingRad);
  const cosYaw = Math.cos(facingRad);

  const leftFootX = x - 0.11 * cosYaw;
  const leftFootZ = z + 0.11 * sinYaw;
  const rightFootX = x + 0.11 * cosYaw;
  const rightFootZ = z - 0.11 * sinYaw;

  const leftFootSurface = querySceneSurfaceAt(leftFootX, leftFootZ, environment, raycastMeshes);
  const rightFootSurface = querySceneSurfaceAt(rightFootX, rightFootZ, environment, raycastMeshes);

  let appliedFootLiftL = 0;
  let appliedFootLiftR = 0;
  let appliedHandLiftL = 0;
  let appliedHandLiftR = 0;

  const isStandingOrSeatedWithPlantedFeet =
    pose.poseFamily === 'standing' ||
    pose.poseFamily === 'sitting' ||
    pose.poseFamily === 'squatting' ||
    pose.poseFamily === 'bent_over';

  if (isStandingOrSeatedWithPlantedFeet) {
    const footFloorTargetL =
      leftFootSurface.surfaceId === 'rug' || leftFootSurface.surfaceId === 'floor'
        ? leftFootSurface.elevationY
        : 0;
    const footFloorTargetR =
      rightFootSurface.surfaceId === 'rug' || rightFootSurface.surfaceId === 'floor'
        ? rightFootSurface.elevationY
        : 0;

    const approxLeftAnkleY =
      adjusted.pelvisY -
      0.01 -
      0.41 * Math.cos(adjusted.leftHipPitchRad) -
      0.39 * Math.cos(adjusted.leftHipPitchRad + adjusted.leftKneePitchRad);
    const approxRightAnkleY =
      adjusted.pelvisY -
      0.01 -
      0.41 * Math.cos(adjusted.rightHipPitchRad) -
      0.39 * Math.cos(adjusted.rightHipPitchRad + adjusted.rightKneePitchRad);

    const minAnkleClearance = 0.055;
    const penetrationL = footFloorTargetL + minAnkleClearance - approxLeftAnkleY;
    const penetrationR = footFloorTargetR + minAnkleClearance - approxRightAnkleY;

    if (penetrationL > 0.002 && penetrationL < 0.24) {
      const ikL = solveTwoBoneIK3D({
        upperLength: 0.41,
        lowerLength: 0.39,
        currentTargetDist: 0.74,
        desiredElevationDeltaY: penetrationL,
        baseUpperPitch: adjusted.leftHipPitchRad,
        baseLowerBend: adjusted.leftKneePitchRad,
        isLeg: true,
      });
      adjusted.leftHipPitchRad += ikL.upperPitchDelta;
      adjusted.leftKneePitchRad += ikL.lowerBendDelta;
      adjusted.leftAnklePitchRad -= ikL.upperPitchDelta * 0.5;
      appliedFootLiftL = ikL.effectorDeltaY;
    }

    if (penetrationR > 0.002 && penetrationR < 0.24) {
      const ikR = solveTwoBoneIK3D({
        upperLength: 0.41,
        lowerLength: 0.39,
        currentTargetDist: 0.74,
        desiredElevationDeltaY: penetrationR,
        baseUpperPitch: adjusted.rightHipPitchRad,
        baseLowerBend: adjusted.rightKneePitchRad,
        isLeg: true,
      });
      adjusted.rightHipPitchRad += ikR.upperPitchDelta;
      adjusted.rightKneePitchRad += ikR.lowerBendDelta;
      adjusted.rightAnklePitchRad -= ikR.upperPitchDelta * 0.5;
      appliedFootLiftR = ikR.effectorDeltaY;
    }
  }

  if (pose.requiresFloorHandContact) {
    const handForwardDist = pose.poseFamily === 'quadruped' ? 0.34 : 0.26;
    const handSampleX = x + sinYaw * handForwardDist;
    const handSampleZ = z + cosYaw * handForwardDist;
    const handSurface = querySceneSurfaceAt(handSampleX, handSampleZ, environment, raycastMeshes);

    const pillowExtraLift =
      handSurface.surfaceId === 'bed_pillow'
        ? 0.045
        : handSurface.surfaceId === 'rug'
          ? 0.015
          : 0;

    if (pillowExtraLift > 0) {
      const ikHand = solveTwoBoneIK3D({
        upperLength: 0.26,
        lowerLength: 0.23,
        currentTargetDist: 0.44,
        desiredElevationDeltaY: pillowExtraLift,
        baseUpperPitch: adjusted.leftShoulderPitchRad,
        baseLowerBend: adjusted.leftElbowPitchRad,
        isLeg: false,
      });
      adjusted.leftShoulderPitchRad += ikHand.upperPitchDelta;
      adjusted.leftElbowPitchRad += ikHand.lowerBendDelta;
      adjusted.rightShoulderPitchRad += ikHand.upperPitchDelta;
      adjusted.rightElbowPitchRad += ikHand.lowerBendDelta;
      appliedHandLiftL = pillowExtraLift;
      appliedHandLiftR = pillowExtraLift;
    }
  }

  return {
    adjustedPose: adjusted,
    diagnosis: {
      activeSurfaceId: centerSurface.surfaceId,
      activeSurfaceLabel: centerSurface.surfaceLabel,
      supportElevationY: centerSurface.elevationY,
      pelvisSurfaceOffsetY,
      leftFootContact: isStandingOrSeatedWithPlantedFeet,
      rightFootContact: isStandingOrSeatedWithPlantedFeet,
      leftHandContact: pose.requiresFloorHandContact,
      rightHandContact: pose.requiresFloorHandContact,
      leftKneeContact: pose.requiresFloorKneeContact,
      rightKneeContact: pose.requiresFloorKneeContact,
      appliedFootLiftL,
      appliedFootLiftR,
      appliedHandLiftL,
      appliedHandLiftR,
      customGlbFallback: false,
    },
  };
}

const EULER_SCRATCH_A = new THREE.Euler();
const EULER_SCRATCH_B = new THREE.Euler();
const QUAT_SCRATCH_A = new THREE.Quaternion();
const QUAT_SCRATCH_B = new THREE.Quaternion();

/**
 * Safely interpolates a 3D bone rotation using quaternion slerp to eliminate Euler gimbal flipping
 * when transitioning between vertical (standing) and horizontal (all-fours, prone, supine) poses.
 */
export function slerpBoneEuler(
  bone: THREE.Object3D,
  targetX: number,
  targetY: number,
  targetZ: number,
  alpha: number
): void {
  const clampedAlpha = clamp(alpha, 0, 1);
  if (clampedAlpha >= 0.999) {
    bone.rotation.set(targetX, targetY, targetZ);
    return;
  }
  QUAT_SCRATCH_A.copy(bone.quaternion);
  EULER_SCRATCH_B.set(targetX, targetY, targetZ, bone.rotation.order);
  QUAT_SCRATCH_B.setFromEuler(EULER_SCRATCH_B);
  QUAT_SCRATCH_A.slerp(QUAT_SCRATCH_B, clampedAlpha);
  bone.quaternion.copy(QUAT_SCRATCH_A);
}

/**
 * Interpolates between two SemanticCharacterRigPose structures using quaternion slerp for all 3-axis joints
 * and coordinated vertical pelvis clearance arcs so standing↔seated/kneeling/lying transitions never clip.
 */
export function interpolateSemanticPoses(
  from: SemanticCharacterRigPose,
  to: SemanticCharacterRigPose,
  rawT: number,
  arcClearanceY = 0
): SemanticCharacterRigPose {
  const t = clamp(rawT, 0, 1);
  const smoothT = t * t * (3 - 2 * t);
  const lowerT = clamp(smoothT * 1.06, 0, 1);
  const upperT = clamp(smoothT * 0.96 + 0.04 * t, 0, 1);

  const slerpTriplet = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    blend: number
  ): [number, number, number] => {
    EULER_SCRATCH_A.set(ax, ay, az, 'XYZ');
    EULER_SCRATCH_B.set(bx, by, bz, 'XYZ');
    QUAT_SCRATCH_A.setFromEuler(EULER_SCRATCH_A);
    QUAT_SCRATCH_B.setFromEuler(EULER_SCRATCH_B);
    QUAT_SCRATCH_A.slerp(QUAT_SCRATCH_B, blend);
    EULER_SCRATCH_A.setFromQuaternion(QUAT_SCRATCH_A, 'XYZ');
    return [EULER_SCRATCH_A.x, EULER_SCRATCH_A.y, EULER_SCRATCH_A.z];
  };

  const [pelvisPitchRad, pelvisYawRad, pelvisRollRad] = slerpTriplet(
    from.pelvisPitchRad,
    from.pelvisYawRad,
    from.pelvisRollRad,
    to.pelvisPitchRad,
    to.pelvisYawRad,
    to.pelvisRollRad,
    smoothT
  );
  const [spinePitchRad, spineYawRad, spineRollRad] = slerpTriplet(
    from.spinePitchRad,
    from.spineYawRad,
    from.spineRollRad,
    to.spinePitchRad,
    to.spineYawRad,
    to.spineRollRad,
    smoothT
  );
  const [chestPitchRad, chestYawRad, chestRollRad] = slerpTriplet(
    from.chestPitchRad,
    from.chestYawRad,
    from.chestRollRad,
    to.chestPitchRad,
    to.chestYawRad,
    to.chestRollRad,
    upperT
  );
  const [neckPitchRad, neckYawRad] = slerpTriplet(
    from.neckPitchRad,
    from.neckYawRad,
    0,
    to.neckPitchRad,
    to.neckYawRad,
    0,
    upperT
  );
  const [headPitchRad, headYawRad] = slerpTriplet(
    from.headPitchRad,
    from.headYawRad,
    0,
    to.headPitchRad,
    to.headYawRad,
    0,
    upperT
  );

  const [leftShoulderPitchRad, , leftShoulderRollRad] = slerpTriplet(
    from.leftShoulderPitchRad,
    0,
    from.leftShoulderRollRad,
    to.leftShoulderPitchRad,
    0,
    to.leftShoulderRollRad,
    upperT
  );
  const [rightShoulderPitchRad, , rightShoulderRollRad] = slerpTriplet(
    from.rightShoulderPitchRad,
    0,
    from.rightShoulderRollRad,
    to.rightShoulderPitchRad,
    0,
    to.rightShoulderRollRad,
    upperT
  );

  const [leftHipPitchRad, , leftHipRollRad] = slerpTriplet(
    from.leftHipPitchRad,
    0,
    from.leftHipRollRad,
    to.leftHipPitchRad,
    0,
    to.leftHipRollRad,
    lowerT
  );
  const [rightHipPitchRad, , rightHipRollRad] = slerpTriplet(
    from.rightHipPitchRad,
    0,
    from.rightHipRollRad,
    to.rightHipPitchRad,
    0,
    to.rightHipRollRad,
    lowerT
  );

  const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
  const arcOffsetY = Math.sin(t * Math.PI) * arcClearanceY;
  const kneeClearanceBoost = Math.sin(t * Math.PI) * Math.max(0, arcClearanceY * 1.6);

  const blendNullable = (a: number | null, b: number | null, u: number): number | null => {
    if (a === null && b === null) return null;
    if (a !== null && b !== null) return lerp(a, b, u);
    return u >= 0.5 ? b : a;
  };

  return {
    poseFamily: smoothT >= 0.5 ? to.poseFamily : from.poseFamily,
    pelvisY: lerp(from.pelvisY, to.pelvisY, smoothT) + arcOffsetY,
    pelvisZOffset: lerp(from.pelvisZOffset, to.pelvisZOffset, smoothT),
    pelvisPitchRad,
    pelvisYawRad,
    pelvisRollRad,
    spinePitchRad,
    spineYawRad,
    spineRollRad,
    chestPitchRad,
    chestYawRad,
    chestRollRad,
    neckPitchRad,
    neckYawRad,
    headPitchRad,
    headYawRad,
    leftShoulderPitchRad,
    leftShoulderRollRad,
    leftElbowPitchRad: lerp(from.leftElbowPitchRad, to.leftElbowPitchRad, upperT),
    leftWristSupportPitchRad: blendNullable(
      from.leftWristSupportPitchRad,
      to.leftWristSupportPitchRad,
      upperT
    ),
    rightShoulderPitchRad,
    rightShoulderRollRad,
    rightElbowPitchRad: lerp(from.rightElbowPitchRad, to.rightElbowPitchRad, upperT),
    rightWristSupportPitchRad: blendNullable(
      from.rightWristSupportPitchRad,
      to.rightWristSupportPitchRad,
      upperT
    ),
    leftHipPitchRad: leftHipPitchRad - kneeClearanceBoost * 0.45,
    leftHipRollRad,
    leftKneePitchRad: lerp(from.leftKneePitchRad, to.leftKneePitchRad, lowerT) + kneeClearanceBoost,
    leftAnklePitchRad: lerp(from.leftAnklePitchRad, to.leftAnklePitchRad, lowerT),
    leftAnkleYawRad: lerp(from.leftAnkleYawRad, to.leftAnkleYawRad, lowerT),
    rightHipPitchRad: rightHipPitchRad - kneeClearanceBoost * 0.45,
    rightHipRollRad,
    rightKneePitchRad: lerp(from.rightKneePitchRad, to.rightKneePitchRad, lowerT) + kneeClearanceBoost,
    rightAnklePitchRad: lerp(from.rightAnklePitchRad, to.rightAnklePitchRad, lowerT),
    rightAnkleYawRad: lerp(from.rightAnkleYawRad, to.rightAnkleYawRad, lowerT),
    requiresFloorHandContact:
      smoothT >= 0.5 ? to.requiresFloorHandContact : from.requiresFloorHandContact,
    requiresFloorKneeContact:
      smoothT >= 0.5 ? to.requiresFloorKneeContact : from.requiresFloorKneeContact,
  };
}

/**
 * Stateful controller for smooth, non-fighting pose-to-pose transitions.
 * Safely retargets from the live blended pose if the user switches presets mid-transition.
 */
export class PoseTransitionController {
  private currentPose: SemanticCharacterRigPose | null = null;
  private startPose: SemanticCharacterRigPose | null = null;
  private targetPose: SemanticCharacterRigPose | null = null;
  private activePoseKey = '';
  private fromPoseName: PosePreset = 'natural_standing';
  private toPoseName: PosePreset = 'natural_standing';
  private progress = 1;
  private durationSec = 0.48;
  private arcClearanceY = 0;
  private retargetCount = 0;

  public updateTarget(
    newTarget: SemanticCharacterRigPose,
    basePose: PosePreset,
    interactionPresetId: SceneInteractionPresetId | null | undefined,
    instantMode = false
  ): void {
    const poseKey = `${basePose}::${interactionPresetId ?? ''}`;
    if (!this.currentPose || !this.targetPose) {
      this.currentPose = { ...newTarget };
      this.startPose = { ...newTarget };
      this.targetPose = { ...newTarget };
      this.activePoseKey = poseKey;
      this.fromPoseName = basePose;
      this.toPoseName = basePose;
      this.progress = 1;
      return;
    }

    if (instantMode) {
      this.currentPose = { ...newTarget };
      this.startPose = { ...newTarget };
      this.targetPose = { ...newTarget };
      this.activePoseKey = poseKey;
      this.fromPoseName = basePose;
      this.toPoseName = basePose;
      this.progress = 1;
      this.arcClearanceY = 0;
      return;
    }

    if (poseKey !== this.activePoseKey) {
      if (this.progress < 0.999) {
        this.retargetCount += 1;
      }
      this.startPose = { ...this.currentPose };
      this.targetPose = { ...newTarget };
      const prevFamily = classifyPoseVerticalFamily(this.toPoseName);
      const nextFamily = classifyPoseVerticalFamily(basePose, interactionPresetId);
      this.fromPoseName = this.toPoseName;
      this.toPoseName = basePose;
      this.activePoseKey = poseKey;
      this.progress = 0;

      const pelvisDelta = Math.abs(newTarget.pelvisY - this.startPose.pelvisY);
      if (prevFamily !== nextFamily) {
        this.durationSec = clamp(0.45 + pelvisDelta * 0.35, 0.4, 0.7);
        this.arcClearanceY = clamp(0.055 + pelvisDelta * 0.14, 0.04, 0.14);
      } else {
        this.durationSec = 0.34;
        this.arcClearanceY = 0.025;
      }
    } else {
      this.targetPose = { ...newTarget };
    }
  }

  public step(dt: number, instantMode = false): SemanticCharacterRigPose {
    if (!this.currentPose || !this.targetPose || !this.startPose) {
      throw new Error('PoseTransitionController.step called before updateTarget');
    }

    if (instantMode || this.progress >= 1) {
      this.progress = 1;
      this.currentPose = { ...this.targetPose };
      return this.currentPose;
    }

    const safeDt = clamp(dt, 0, 0.1);
    this.progress = clamp(this.progress + safeDt / Math.max(0.05, this.durationSec), 0, 1);
    this.currentPose = interpolateSemanticPoses(
      this.startPose,
      this.targetPose,
      this.progress,
      this.arcClearanceY
    );
    return this.currentPose;
  }

  public getSnapshot(): PoseTransitionSnapshot {
    const t = clamp(this.progress, 0, 1);
    return {
      isTransitioning: t < 0.999,
      progress: t,
      durationSec: this.durationSec,
      fromPose: this.fromPoseName,
      toPose: this.toPoseName,
      pelvisArcOffsetY: t < 0.999 ? Math.sin(t * Math.PI) * this.arcClearanceY : 0,
      retargetCount: this.retargetCount,
    };
  }
}

/**
 * Time-based secondary motion and hierarchical eye-lead gaze lag controller.
 * Ensures eyes lead gaze shifts immediately, followed smoothly by head and upper chest,
 * while keeping the canonical stored state untouched.
 */
export class SecondaryMotionController {
  private eyeYaw = 0;
  private eyePitch = 0;
  private headYaw = 0;
  private headPitch = 0;
  private chestYaw = 0;
  private chestPitch = 0;
  private breathPhase = 0;

  public reset(): void {
    this.eyeYaw = 0;
    this.eyePitch = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.chestYaw = 0;
    this.chestPitch = 0;
    this.breathPhase = 0;
  }

  public step(params: {
    dt: number;
    targetGazeYawRad: number;
    targetGazePitchRad: number;
    breathingEnabled: boolean;
    handGesture: HandGesture;
    isHandWeightBearing: boolean;
  }): SecondaryMotionOffsets {
    const {
      dt,
      targetGazeYawRad,
      targetGazePitchRad,
      breathingEnabled,
      handGesture,
      isHandWeightBearing,
    } = params;

    const safeDt = clamp(dt, 0, 0.1);

    this.eyeYaw = damp(this.eyeYaw, targetGazeYawRad, 26, safeDt);
    this.eyePitch = damp(this.eyePitch, targetGazePitchRad, 26, safeDt);
    this.headYaw = damp(this.headYaw, targetGazeYawRad, 11, safeDt);
    this.headPitch = damp(this.headPitch, targetGazePitchRad, 11, safeDt);
    this.chestYaw = damp(this.chestYaw, targetGazeYawRad * 0.28, 5.5, safeDt);
    this.chestPitch = damp(this.chestPitch, targetGazePitchRad * 0.2, 5.5, safeDt);

    if (!breathingEnabled) {
      return {
        chestBreathPitch: 0,
        chestBreathScaleY: 1,
        chestBreathScaleXZ: 1,
        clavicleBreathRoll: 0,
        neckCounterPitch: 0,
        headMicroSwayYaw: 0,
        headMicroSwayRoll: 0,
        eyeGazeYawRad: targetGazeYawRad,
        eyeGazePitchRad: targetGazePitchRad,
        headGazeYawRad: targetGazeYawRad,
        headGazePitchRad: targetGazePitchRad,
        chestGazeYawRad: targetGazeYawRad * 0.28,
        chestGazePitchRad: targetGazePitchRad * 0.2,
        fingerRelaxationCurlDelta: 0,
        fingerRelaxationSpreadDelta: 0,
      };
    }

    this.breathPhase += safeDt * 1.75;
    const primaryBreath = Math.sin(this.breathPhase);
    const harmonic = Math.sin(this.breathPhase * 0.5 + 0.7);

    const canRelaxFingers =
      !isHandWeightBearing &&
      (handGesture === 'relaxed_natural' || handGesture === 'open_palm');

    return {
      chestBreathPitch: primaryBreath * 0.015,
      chestBreathScaleY: 1 + primaryBreath * 0.008,
      chestBreathScaleXZ: 1 + primaryBreath * 0.012,
      clavicleBreathRoll: primaryBreath * 0.014,
      neckCounterPitch: -primaryBreath * 0.009,
      headMicroSwayYaw: harmonic * 0.006,
      headMicroSwayRoll: Math.cos(this.breathPhase * 0.5) * 0.004,
      eyeGazeYawRad: this.eyeYaw,
      eyeGazePitchRad: this.eyePitch,
      headGazeYawRad: this.headYaw,
      headGazePitchRad: this.headPitch,
      chestGazeYawRad: this.chestYaw,
      chestGazePitchRad: this.chestPitch,
      fingerRelaxationCurlDelta: canRelaxFingers ? primaryBreath * 0.032 : 0,
      fingerRelaxationSpreadDelta: canRelaxFingers ? harmonic * 0.012 : 0,
    };
  }
}
