import * as THREE from 'three';
import {
  slerpBoneEuler,
  interpolateSemanticPoses,
  PoseTransitionController,
  querySceneSurfaceAt,
  solveTwoBoneIK3D,
  computeSurfaceAwarePoseAdjustments,
  evaluateMagneticAnchorSnap,
  SecondaryMotionController,
} from '../poseKinematicsEngine';
import { resolveSemanticCharacterRigPose } from '../framingAnalyzer';
import { CharacterPose3DSettings } from '../../types/cameraPlayboard';
import {
  createInitialLocomotionState,
  stepThirdPersonLocomotion,
  stepCharacterTurnInPlace,
} from '../thirdPersonLocomotion';

const DEFAULT_CHARACTER_POSE_3D: CharacterPose3DSettings = {
  basePose: 'natural_standing',
  torsoLeanDeg: 0,
  torsoTwistDeg: 0,
  torsoTiltDeg: 0,
  headRotationDeg: 0,
  headTiltDeg: 0,
  gaze: 'direct_at_camera',
  expression: 'neutral_relaxed',
  leftArmShoulderForwardDeg: 0,
  leftArmShoulderOutDeg: 8,
  leftArmElbowBendDeg: 8,
  leftArmWristDeg: 0,
  leftHandGesture: 'relaxed_natural',
  rightArmShoulderForwardDeg: 0,
  rightArmShoulderOutDeg: 8,
  rightArmElbowBendDeg: 8,
  rightArmWristDeg: 0,
  rightHandGesture: 'relaxed_natural',
  leftLegHipForwardDeg: 0,
  leftLegHipOutDeg: 4,
  leftLegKneeBendDeg: 2,
  leftFootAngleDeg: 0,
  rightLegHipForwardDeg: 0,
  rightLegHipOutDeg: 4,
  rightLegKneeBendDeg: 2,
  rightFootAngleDeg: 0,
  isWalking: false,
  isWaving: false,
  hipHeightOffset: 0,
  characterYawDeg: 0,
  characterPosX: 0,
  characterPosZ: 0,
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`Assertion failed: ${message} (expected ~${expected}, got ${actual})`);
  }
}

// ---------------------------------------------------------------------------
// A. Natural Pose-to-Pose Transitions & Pelvis Clearance Arcs
// ---------------------------------------------------------------------------
{
  const bone = new THREE.Object3D();
  bone.rotation.set(0, 0, 0);
  slerpBoneEuler(bone, Math.PI / 2, -Math.PI / 4, Math.PI / 6, 0.5);
  assert(
    Number.isFinite(bone.rotation.x) &&
      Number.isFinite(bone.rotation.y) &&
      Number.isFinite(bone.rotation.z),
    'slerpBoneEuler midpoint produces finite Euler rotations'
  );

  slerpBoneEuler(bone, Math.PI / 2, -Math.PI / 4, Math.PI / 6, 1);
  assertClose(bone.rotation.x, Math.PI / 2, 1e-3, 'slerpBoneEuler t=1 matches target X');
  assertClose(bone.rotation.y, -Math.PI / 4, 1e-3, 'slerpBoneEuler t=1 matches target Y');
  assertClose(bone.rotation.z, Math.PI / 6, 1e-3, 'slerpBoneEuler t=1 matches target Z');

  const standing = resolveSemanticCharacterRigPose({
    ...DEFAULT_CHARACTER_POSE_3D,
    basePose: 'natural_standing',
  });
  const sitting = resolveSemanticCharacterRigPose({
    ...DEFAULT_CHARACTER_POSE_3D,
    basePose: 'casual_sitting',
    seatHeightY: 0.56,
  });
  const kneeling = resolveSemanticCharacterRigPose({
    ...DEFAULT_CHARACTER_POSE_3D,
    basePose: 'grounded_kneeling',
  });

  const linearMidY = (standing.pelvisY + sitting.pelvisY) * 0.5;
  const midPose = interpolateSemanticPoses(standing, sitting, 0.5, 0.055);
  assert(
    midPose.pelvisY > linearMidY + 0.04,
    'interpolateSemanticPoses adds vertical pelvis clearance arc at midpoint'
  );

  const controller = new PoseTransitionController();
  controller.updateTarget(standing, 'natural_standing', null, false);
  assert(controller.getSnapshot().isTransitioning === false, 'Initial pose is not transitioning');

  controller.updateTarget(sitting, 'casual_sitting', 'bed_sit_edge_forward', false);
  assert(controller.getSnapshot().isTransitioning === true, 'Transition begins on new target');

  controller.step(0.1);
  controller.step(0.1);
  const mid1 = controller.step(0.1);
  assert(
    mid1.pelvisY < standing.pelvisY && mid1.pelvisY > sitting.pelvisY,
    'Mid-transition pelvisY interpolates between standing and sitting'
  );

  controller.updateTarget(kneeling, 'grounded_kneeling', null, false);
  const midAfterRetarget = controller.step(0.016);
  assert(
    Math.abs(midAfterRetarget.pelvisY - mid1.pelvisY) < 0.06,
    'Retargeting mid-transition continues smoothly from live blended pose'
  );

  let finalPose = midAfterRetarget;
  for (let i = 0; i < 12; i++) {
    finalPose = controller.step(0.08);
  }
  assert(controller.getSnapshot().isTransitioning === false, 'Transition completes');
  assertClose(finalPose.pelvisY, kneeling.pelvisY, 1e-4, 'Completed transition matches target');

  controller.updateTarget(standing, 'natural_standing', null, true);
  assert(controller.getSnapshot().isTransitioning === false, 'Instant mode completes immediately');
  const instantPose = controller.step(0.016, true);
  assertClose(instantPose.pelvisY, standing.pelvisY, 1e-5, 'Instant mode matches standing pelvisY');
}

// ---------------------------------------------------------------------------
// B. Surface-Aware Inverse Kinematics & Furniture Contact
// ---------------------------------------------------------------------------
{
  const floorHit = querySceneSurfaceAt(0, 1.8, 'studio_bedroom');
  assert(floorHit.surfaceId === 'floor', 'Floor hit detected at (0, 1.8)');
  assertClose(floorHit.elevationY, 0, 1e-3, 'Floor elevation is 0m');

  const rugHit = querySceneSurfaceAt(0.35, -0.2, 'studio_bedroom');
  assert(rugHit.surfaceId === 'rug', 'Rug hit detected at (0.35, -0.2)');
  assertClose(rugHit.elevationY, 0.012, 1e-3, 'Rug elevation is 0.012m');

  const bedHit = querySceneSurfaceAt(1.25, -1.5, 'studio_bedroom');
  assert(bedHit.surfaceId === 'bed_mattress', 'Bed mattress hit detected at (1.25, -1.5)');
  assertClose(bedHit.elevationY, 0.49, 1e-2, 'Bed mattress elevation is 0.49m');

  const pillowHit = querySceneSurfaceAt(1.25, -2.35, 'studio_bedroom');
  assert(pillowHit.surfaceId === 'bed_pillow', 'Bed pillow hit detected at (1.25, -2.35)');
  assertClose(pillowHit.elevationY, 0.56, 1e-2, 'Bed pillow elevation is 0.56m');

  const chairHit = querySceneSurfaceAt(-1.55, 0.25, 'studio_bedroom');
  assert(chairHit.surfaceId === 'chair_seat', 'Chair seat hit detected at (-1.55, 0.25)');
  assertClose(chairHit.elevationY, 0.47, 1e-2, 'Chair seat elevation is 0.47m');

  const benchHit = querySceneSurfaceAt(-2.62, -1.85, 'studio_bedroom');
  assert(benchHit.surfaceId === 'window_bench', 'Window bench hit detected at (-2.62, -1.85)');
  assertClose(benchHit.elevationY, 0.44, 1e-2, 'Window bench elevation is 0.44m');

  const ik = solveTwoBoneIK3D({
    upperLength: 0.41,
    lowerLength: 0.39,
    currentTargetDist: 0.74,
    desiredElevationDeltaY: 0.06,
    baseUpperPitch: -0.2,
    baseLowerBend: 0.4,
    isLeg: true,
  });
  assert(ik.contactActive === true, 'solveTwoBoneIK3D activates contact for non-zero delta');
  assert(
    Math.abs(ik.lowerBendDelta) <= 0.78 && Math.abs(ik.upperPitchDelta) <= 0.52,
    'solveTwoBoneIK3D respects joint angle bounds'
  );

  const sittingPose = resolveSemanticCharacterRigPose({
    ...DEFAULT_CHARACTER_POSE_3D,
    basePose: 'casual_sitting',
    seatHeightY: 0.56,
  });
  const bedContact = computeSurfaceAwarePoseAdjustments({
    pose: sittingPose,
    poseSettings: {
      ...DEFAULT_CHARACTER_POSE_3D,
      basePose: 'casual_sitting',
      seatHeightY: 0.56,
      characterPosX: 1.25,
      characterPosZ: -1.08,
    },
    environment: 'studio_bedroom',
    ikEnabled: true,
    hasCustomGlb: false,
  });
  assert(bedContact.diagnosis.activeSurfaceId === 'bed_mattress', 'Detects bed mattress contact');

  const glbFallback = computeSurfaceAwarePoseAdjustments({
    pose: sittingPose,
    poseSettings: {
      ...DEFAULT_CHARACTER_POSE_3D,
      basePose: 'casual_sitting',
      seatHeightY: 0.56,
      characterPosX: 1.25,
      characterPosZ: -1.08,
    },
    environment: 'studio_bedroom',
    ikEnabled: true,
    hasCustomGlb: true,
  });
  assert(glbFallback.diagnosis.customGlbFallback === true, 'Custom GLB fallback is flagged');
  assert(glbFallback.diagnosis.appliedFootLiftL === 0, 'Custom GLB fallback zeroes foot lift');

  const nearBedEdge = evaluateMagneticAnchorSnap(1.22, -1.02, 'studio_bedroom', true);
  assert(
    nearBedEdge.snappedAnchor?.id === 'bed_front_edge_anchor',
    'Snaps to bed_front_edge_anchor within magnetic radius'
  );

  const farFromFurniture = evaluateMagneticAnchorSnap(0, 1.8, 'studio_bedroom', true);
  assert(farFromFurniture.snappedAnchor === null, 'Does not snap when far from furniture anchors');
}

// ---------------------------------------------------------------------------
// C. Subtle Secondary Motion & Eye-Lead Gaze Lag
// ---------------------------------------------------------------------------
{
  const controller = new SecondaryMotionController();
  controller.reset();

  const step1 = controller.step({
    dt: 0.032,
    targetGazeYawRad: 0.6,
    targetGazePitchRad: -0.25,
    breathingEnabled: true,
    handGesture: 'relaxed_natural',
    isHandWeightBearing: false,
  });

  assert(
    step1.eyeGazeYawRad > step1.headGazeYawRad &&
      step1.headGazeYawRad > step1.chestGazeYawRad,
    'Eyes lead gaze transitions ahead of head and chest'
  );

  const paused = controller.step({
    dt: 0.05,
    targetGazeYawRad: 0.5,
    targetGazePitchRad: 0.2,
    breathingEnabled: false,
    handGesture: 'relaxed_natural',
    isHandWeightBearing: false,
  });
  assertClose(paused.chestBreathPitch, 0, 1e-6, 'Paused breathing zeroes chestBreathPitch');
  assertClose(paused.fingerRelaxationCurlDelta, 0, 1e-6, 'Paused breathing zeroes finger relaxation');
}

// ---------------------------------------------------------------------------
// D. Third-Person Locomotion Lean & Turn-in-Place Footwork
// ---------------------------------------------------------------------------
{
  let state = createInitialLocomotionState();
  for (let i = 0; i < 12; i++) {
    state = stepThirdPersonLocomotion(state, { x: 0.4, y: 0.8 }, 0, 0.032);
  }
  assert(Math.hypot(state.vx, state.vz) > 0.3, 'Locomotion accelerates smoothly');
  assert((state.leanPitchRad ?? 0) > 0, 'Forward movement produces positive leanPitchRad');

  let turnState = createInitialLocomotionState();
  for (let i = 0; i < 8; i++) {
    turnState = stepCharacterTurnInPlace(turnState, 0.8, 0.032);
  }
  assert((turnState.turnStepAmt ?? 0) > 0.1, 'Turn-in-place activates pivot footwork');
}

console.log('✓ poseKinematicsEngine.test.ts passed');

