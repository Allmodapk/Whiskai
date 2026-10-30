import * as THREE from 'three';
import {
  resolveSemanticCharacterRigPose,
  slerpEulerXYZ,
  interpolateSemanticRigPose,
  createPoseTransitionState,
  stepPoseTransition,
  querySupportSurfaceAt,
  solveTwoBoneLimbIK,
  applySurfaceContactIKToRigPose,
  createSecondaryMotionState,
  stepSecondaryMotionAndGaze,
  PELVIS_SEATED_GLUTE_CLEARANCE_M,
  PELVIS_LYING_BACK_CLEARANCE_M,
} from '../framingAnalyzer';
import {
  FURNITURE_ANCHOR_HOTSPOTS,
  evaluateMagneticAnchorSnap,
} from '../poseKinematicsEngine';
import { CharacterPose3DSettings } from '../../types/cameraPlayboard';
import {
  createInitialLocomotionState,
  stepThirdPersonLocomotion,
  stepCharacterTurnInPlace,
  resolveBedroomObstacleCollision,
  convertCameraPoseToFreeOrbitState,
  evaluateFreeOrbitCameraPosition,
  convertFreeOrbitToThirdPersonOrientation,
  panFreeOrbitTarget,
} from '../thirdPersonLocomotion';

const DEFAULT_POSE_3D: CharacterPose3DSettings = {
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

console.log('Running Playboard 3D Movement, IK, Secondary Motion, and Locomotion Upgrade Tests...\n');

// ---------------------------------------------------------------------------
// Phase 2A — Natural Pose-to-Pose Transitions
// ---------------------------------------------------------------------------
{
  const start = slerpEulerXYZ(0.2, -1.4, 0.1, -0.3, 1.5, -0.2, 0);
  const mid = slerpEulerXYZ(0.2, -1.4, 0.1, -0.3, 1.5, -0.2, 0.5);
  const end = slerpEulerXYZ(0.2, -1.4, 0.1, -0.3, 1.5, -0.2, 1);

  assertClose(start.x, 0.2, 1e-4, 'slerpEulerXYZ t=0 matches start X');
  assertClose(start.y, -1.4, 1e-4, 'slerpEulerXYZ t=0 matches start Y');
  assertClose(end.x, -0.3, 1e-4, 'slerpEulerXYZ t=1 matches end X');
  assertClose(end.y, 1.5, 1e-4, 'slerpEulerXYZ t=1 matches end Y');
  assert(
    Number.isFinite(mid.x) && Number.isFinite(mid.y) && Number.isFinite(mid.z),
    'slerpEulerXYZ midpoint is finite'
  );

  const standPose = resolveSemanticCharacterRigPose({
    ...DEFAULT_POSE_3D,
    basePose: 'natural_standing',
  });

  const sitPose = resolveSemanticCharacterRigPose({
    ...DEFAULT_POSE_3D,
    basePose: 'casual_sitting',
    seatHeightY: 0.56,
  });

  const midPose = interpolateSemanticRigPose(standPose, sitPose, 0.5);
  assert(
    midPose.pelvisY > sitPose.pelvisY && midPose.pelvisY < standPose.pelvisY + 0.06,
    'Standing-to-seated transition midpoint pelvisY stays between endpoints with coordinated arc'
  );

  const finalPose = interpolateSemanticRigPose(standPose, sitPose, 1);
  assertClose(
    finalPose.pelvisY,
    sitPose.pelvisY,
    1e-5,
    'Completed transition deterministically matches target pelvisY'
  );
  assertClose(
    finalPose.leftHipPitchRad,
    sitPose.leftHipPitchRad,
    1e-4,
    'Completed transition deterministically matches target leftHipPitchRad'
  );

  // Retargeting mid-flight & instant transitions
  const state = createPoseTransitionState(standPose, 'natural_standing::none');
  const midStep = stepPoseTransition(state, sitPose, 'casual_sitting::bed_edge', 0.15, false);
  assert(state.progress > 0 && state.progress < 1, 'Active transition progresses smoothly');

  const kneelPose = resolveSemanticCharacterRigPose({
    ...DEFAULT_POSE_3D,
    basePose: 'grounded_kneeling',
  });
  const retargeted = stepPoseTransition(
    state,
    kneelPose,
    'grounded_kneeling::floor',
    0.05,
    false
  );
  assertClose(
    state.fromPose.pelvisY,
    midStep.pelvisY,
    1e-4,
    'Retargeting mid-transition snapshots current blended pose as new origin'
  );
  assert(Number.isFinite(retargeted.pelvisY), 'Retargeted pose pelvisY is finite');

  const instantPose = stepPoseTransition(state, standPose, 'natural_standing::none', 0.016, true);
  assert(state.progress === 1, 'Instant transition completes immediately');
  assertClose(instantPose.pelvisY, standPose.pelvisY, 1e-5, 'Instant transition matches target pose');

  console.log('✓ Phase 2A: Natural pose-to-pose transitions passed');
}

// ---------------------------------------------------------------------------
// Phase 2B — Surface-Aware Inverse Kinematics, Anatomical Clearance & Hotspots
// ---------------------------------------------------------------------------
{
  const bedHit = querySupportSurfaceAt(1.25, -1.8, 'studio_bedroom', 1.2);
  assert(bedHit.id === 'bed_mattress', 'Detects bed mattress at (1.25, -1.8)');
  assertClose(bedHit.topY, 0.49, 1e-3, 'Bed mattress support height is 0.49m');

  const pillowHit = querySupportSurfaceAt(1.25, -2.35, 'studio_bedroom', 1.2);
  assert(pillowHit.id === 'bed_pillow', 'Detects bed pillow headrest at (1.25, -2.35)');
  assertClose(pillowHit.topY, 0.56, 1e-3, 'Bed pillow support height is 0.56m');

  const chairHit = querySupportSurfaceAt(-1.55, 0.25, 'studio_bedroom', 1.2);
  assert(chairHit.id === 'chair_seat', 'Detects chair seat at (-1.55, 0.25)');
  assertClose(chairHit.topY, 0.47, 1e-3, 'Chair seat support height is 0.47m');

  const deskHit = querySupportSurfaceAt(-2.35, 0.25, 'studio_bedroom', 1.2);
  assert(deskHit.id === 'desk_top', 'Detects desk top at (-2.35, 0.25)');
  assertClose(deskHit.topY, 0.76, 1e-3, 'Desk top support height is 0.76m');

  const windowBenchHit = querySupportSurfaceAt(-2.62, -1.85, 'studio_bedroom', 1.2);
  assert(windowBenchHit.id === 'window_bench', 'Detects window bench at (-2.62, -1.85) in back-left corner');
  assertClose(windowBenchHit.topY, 0.44, 1e-3, 'Window bench support height is 0.44m');

  const floorHit = querySupportSurfaceAt(0, 1.8, 'studio_bedroom', 1.2);
  assert(floorHit.id === 'floor', 'Detects room floor at (0, 1.8)');
  assertClose(floorHit.topY, 0, 1e-3, 'Floor support height is 0m');

  // Verify all 8 furniture hotspots match scene surfaces
  assert(FURNITURE_ANCHOR_HOTSPOTS.length === 8, 'Provides 8 discoverable furniture anchor hotspots');
  const windowHotspot = FURNITURE_ANCHOR_HOTSPOTS.find((h) => h.id === 'window_nook_anchor');
  assert(windowHotspot !== undefined && windowHotspot.z === -1.85, 'Window bench hotspot is at Z = -1.85');
  const pillowHotspot = FURNITURE_ANCHOR_HOTSPOTS.find((h) => h.id === 'bed_pillow_anchor');
  assert(pillowHotspot !== undefined && pillowHotspot.topY === 0.56, 'Bed pillow hotspot is at Y = 0.56');

  const snapCheck = evaluateMagneticAnchorSnap(1.22, -1.02, 'studio_bedroom', true);
  assert(
    snapCheck.snappedAnchor?.id === 'bed_front_edge_anchor',
    'Magnetic snap locks onto bed front edge anchor'
  );

  const ikReachable = solveTwoBoneLimbIK({
    rootWorld: new THREE.Vector3(0, 0.85, 0),
    targetWorld: new THREE.Vector3(0, 0.23, 0.12),
    upperLen: 0.41,
    lowerLen: 0.39,
    side: -1,
    isLeg: true,
  });
  assert(
    ikReachable.hingeBendRad > 0.1 && ikReachable.hingeBendRad < 2.45,
    'Two-bone IK bends knee naturally'
  );
  assert(ikReachable.clampedReach === false, 'Reachable IK target is not clamped');

  const ikStretched = solveTwoBoneLimbIK({
    rootWorld: new THREE.Vector3(0, 0.85, 0),
    targetWorld: new THREE.Vector3(0, -1.5, 0.5),
    upperLen: 0.41,
    lowerLen: 0.39,
    side: 1,
    isLeg: true,
  });
  assert(
    Number.isFinite(ikStretched.hingeBendRad) && ikStretched.clampedReach === true,
    'Two-bone IK clamps unreachable targets safely without NaN'
  );

  // Verify seated pose on bed without explicit seatHeightY elevates pelvis with anatomical glute clearance
  const unanchoredSitRaw = resolveSemanticCharacterRigPose({
    ...DEFAULT_POSE_3D,
    basePose: 'casual_sitting',
  });
  const unanchoredSitOnBed = applySurfaceContactIKToRigPose(
    unanchoredSitRaw,
    {
      ...DEFAULT_POSE_3D,
      basePose: 'casual_sitting',
      characterPosX: 1.25,
      characterPosZ: -0.82,
    },
    'studio_bedroom',
    true
  );
  assertClose(
    unanchoredSitOnBed.pelvisY,
    0.49 + PELVIS_SEATED_GLUTE_CLEARANCE_M,
    0.01,
    'Seated pose on bed elevates pelvis to mattress topY + PELVIS_SEATED_GLUTE_CLEARANCE_M (~0.558m)'
  );

  // Verify lying pose on bed without explicit seatHeightY elevates pelvis with anatomical back clearance
  const unanchoredLieRaw = resolveSemanticCharacterRigPose({
    ...DEFAULT_POSE_3D,
    basePose: 'reclined_lying',
  });
  const unanchoredLieOnBed = applySurfaceContactIKToRigPose(
    unanchoredLieRaw,
    {
      ...DEFAULT_POSE_3D,
      basePose: 'reclined_lying',
      characterPosX: 1.25,
      characterPosZ: -1.8,
    },
    'studio_bedroom',
    true
  );
  assertClose(
    unanchoredLieOnBed.pelvisY,
    0.49 + PELVIS_LYING_BACK_CLEARANCE_M,
    0.01,
    'Lying pose on bed elevates pelvis to mattress topY + PELVIS_LYING_BACK_CLEARANCE_M (~0.578m)'
  );

  const standPose = resolveSemanticCharacterRigPose({
    ...DEFAULT_POSE_3D,
    basePose: 'natural_standing',
  });

  const onFloor = applySurfaceContactIKToRigPose(
    standPose,
    {
      ...DEFAULT_POSE_3D,
      basePose: 'natural_standing',
      characterPosX: 0,
      characterPosZ: 0,
    },
    'studio_bedroom',
    true
  );
  assert(onFloor.pelvisY >= standPose.pelvisY, 'Standing on rug/floor keeps pelvis supported');

  const quadrupedPose = resolveSemanticCharacterRigPose({
    ...DEFAULT_POSE_3D,
    basePose: 'all_fours_neutral',
  });

  const onBed = applySurfaceContactIKToRigPose(
    quadrupedPose,
    {
      ...DEFAULT_POSE_3D,
      basePose: 'all_fours_neutral',
      characterPosX: 1.25,
      characterPosZ: -1.8,
    },
    'studio_bedroom',
    true
  );
  assert(
    onBed.pelvisY > quadrupedPose.pelvisY + 0.35,
    'All-fours on bed elevates pelvis and hands to mattress height'
  );

  const customFallback = applySurfaceContactIKToRigPose(
    quadrupedPose,
    {
      ...DEFAULT_POSE_3D,
      basePose: 'all_fours_neutral',
      characterPosX: 1.25,
      characterPosZ: -1.8,
      customModelBounds: {
        minY: 0,
        maxY: 1.7,
        height: 1.7,
        width: 0.5,
        depth: 0.3,
        centerX: 0,
        centerZ: 0,
        scaleMultiplier: 1,
        offsetY: 0,
        yawOffsetDeg: 0,
      },
    },
    'studio_bedroom',
    true
  );
  assertClose(
    customFallback.pelvisY,
    quadrupedPose.pelvisY,
    1e-5,
    'Custom GLB fallback preserves base pose without unvalidated bone overrides'
  );

  console.log('✓ Phase 2B: Surface-aware inverse kinematics, anatomical clearance & hotspots passed');
}

// ---------------------------------------------------------------------------
// Phase 2C — Subtle Secondary Motion & Gaze Response
// ---------------------------------------------------------------------------
{
  const secState = createSecondaryMotionState();
  const pausedResult = stepSecondaryMotionAndGaze(secState, 'looking_camera_left', 0.5, true);
  assertClose(pausedResult.chestBreathPitchRad, 0, 1e-6, 'Paused secondary motion zeros chest breathing');
  assertClose(pausedResult.headFollowYawRad, 0, 1e-6, 'Paused secondary motion zeros head follow');
  assertClose(pausedResult.fingerRelaxWaveRad, 0, 1e-6, 'Paused secondary motion zeros finger relaxation');

  // Eye-lead followed by gradual head/chest follow
  const activeState = createSecondaryMotionState();
  const step1 = stepSecondaryMotionAndGaze(activeState, 'looking_camera_right', 0.032, false);
  const eyeMag1 = Math.abs(step1.eyeLeadYawRad);
  const headMag1 = Math.abs(step1.headFollowYawRad);
  assert(eyeMag1 > headMag1, 'Eyes lead gaze shift ahead of head follow on initial frame');

  let laterStep = step1;
  for (let i = 0; i < 20; i++) {
    laterStep = stepSecondaryMotionAndGaze(activeState, 'looking_camera_right', 0.032, false);
  }
  const headMagLater = Math.abs(laterStep.headFollowYawRad);
  assert(headMagLater > headMag1, 'Head smoothly follows eye-lead gaze over subsequent frames');
  assert(Math.abs(laterStep.fingerRelaxWaveRad) > 0, 'Secondary motion computes subtle finger relaxation wave');

  console.log('✓ Phase 2C: Subtle secondary motion & gaze response passed');
}

// ---------------------------------------------------------------------------
// Phase 2D — Third-Person Locomotion & Turn-in-Place
// ---------------------------------------------------------------------------
{
  let loco = createInitialLocomotionState();
  for (let i = 0; i < 15; i++) {
    loco = stepThirdPersonLocomotion(loco, { x: 0, y: 1 }, 0, 0.032);
  }
  const movingSpeed = Math.hypot(loco.vx, loco.vz);
  assert(movingSpeed > 0.5, 'Locomotion accelerates forward smoothly');
  assert((loco.leanPitchRad ?? 0) > 0, 'Forward movement produces subtle forward body lean');

  for (let i = 0; i < 35; i++) {
    loco = stepThirdPersonLocomotion(loco, { x: 0, y: 0 }, 0, 0.032);
  }
  const stoppedSpeed = Math.hypot(loco.vx, loco.vz);
  assert(stoppedSpeed === 0, 'Releasing controls decelerates to clean zero speed without drift');
  assert(loco.gaitMode === 'idle', 'gaitMode returns to idle after stopping');

  let turnLoco = createInitialLocomotionState();
  for (let i = 0; i < 8; i++) {
    turnLoco = stepCharacterTurnInPlace(turnLoco, 0.85, 0.032);
  }
  assert((turnLoco.turnStepAmt ?? 0) > 0.1, 'Turn-in-place activates foot pivot stepping');
  assert(Math.abs(turnLoco.turnRateRadPerSec ?? 0) > 0.5, 'Turn-in-place records angular turn rate');

  console.log('✓ Phase 2D: Third-person locomotion & turn-in-place passed');
}

// ---------------------------------------------------------------------------
// Phase 2E — Normalized Diagonal Speed, Furniture Collision, and Camera Modes
// ---------------------------------------------------------------------------
{
  // 1. Cardinal & Diagonal normalized speed test (Acceptance Tests 1 & 2)
  let forwardLoco = createInitialLocomotionState();
  let diagonalLoco = createInitialLocomotionState();
  for (let i = 0; i < 30; i++) {
    forwardLoco = stepThirdPersonLocomotion(
      forwardLoco,
      { x: 0, y: 1 },
      0,
      0.032,
      undefined,
      0,
      { enableFurnitureCollision: false }
    );
    // Raw unnormalized diagonal input { x: 1, y: 1 } must be normalized internally so speed matches straight { x: 0, y: 1 }
    diagonalLoco = stepThirdPersonLocomotion(
      diagonalLoco,
      { x: 1, y: 1 },
      0,
      0.032,
      undefined,
      0,
      { enableFurnitureCollision: false }
    );
  }
  const forwardSpeed = Math.hypot(forwardLoco.vx, forwardLoco.vz);
  const diagonalSpeed = Math.hypot(diagonalLoco.vx, diagonalLoco.vz);
  assertClose(
    diagonalSpeed,
    forwardSpeed,
    1e-4,
    'Diagonal movement speed is normalized and identical to cardinal movement speed'
  );

  // Verify forward, backward, left, and right movement directions (character faces +Z at rot = 0)
  let backLoco = createInitialLocomotionState();
  let leftLoco = createInitialLocomotionState();
  let rightLoco = createInitialLocomotionState();
  for (let i = 0; i < 15; i++) {
    backLoco = stepThirdPersonLocomotion(backLoco, { x: 0, y: -1 }, 0, 0.032);
    leftLoco = stepThirdPersonLocomotion(leftLoco, { x: -1, y: 0 }, 0, 0.032);
    rightLoco = stepThirdPersonLocomotion(rightLoco, { x: 1, y: 0 }, 0, 0.032);
  }
  assert(forwardLoco.z > 0.2, 'Forward joystick input (+y) moves character forward (+Z at rot=0)');
  assert(backLoco.z < -0.2, 'Backward joystick input (-y) moves character backward (-Z at rot=0)');
  assert(leftLoco.x < -0.2, 'Left joystick input (-x) moves character left (-X at rot=0)');
  assert(rightLoco.x > 0.2, 'Right joystick input (+x) moves character right (+X at rot=0)');

  // Verify character movement is independent of camera rotation
  let camRotA = createInitialLocomotionState();
  let camRotB = createInitialLocomotionState();
  for (let i = 0; i < 15; i++) {
    camRotA = stepThirdPersonLocomotion(camRotA, { x: 0.4, y: 0.8 }, 0, 0.032);
    camRotB = stepThirdPersonLocomotion(camRotB, { x: 0.4, y: 0.8 }, 1.45, 0.032);
  }
  assertClose(camRotA.x, camRotB.x, 1e-6, 'Character X movement is independent of camera yaw');
  assertClose(camRotA.z, camRotB.z, 1e-6, 'Character Z movement is independent of camera yaw');

  // 2. Solid Furniture Collision test (walking from x=0, z=-1.5 into bed at x=1.2, z=-1.5)
  const colTest = resolveBedroomObstacleCollision(1.2, -1.5, 0.0, -1.5, undefined, 0.2);
  assert(
    colTest.collidedObstacleId === 'bed_frame',
    'Walking from x=0 into bed at x=1.2, z=-1.5 triggers solid bed_frame obstacle collision'
  );
  assertClose(
    colTest.x,
    0.38 - 0.2,
    1e-4,
    'Character stops cleanly at bed exterior boundary without penetrating'
  );

  // When already posed on top of the bed, movement is allowed within the surface
  const onBedSlide = resolveBedroomObstacleCollision(1.35, -1.5, 1.25, -1.5, undefined, 0.2);
  assert(
    onBedSlide.collidedObstacleId === null,
    'Character already posed on a furniture surface can adjust position without getting stuck'
  );

  // 3. Camera Mode Switching: Third Person -> Free Orbit zero-jump verification (Acceptance Test 5)
  const tpCamPos = { x: -0.85, y: 1.72, z: 2.35 };
  const tpLookTarget = { x: 0.12, y: 1.15, z: -0.18 };
  const freeOrbitState = convertCameraPoseToFreeOrbitState(tpCamPos, tpLookTarget);
  const reconstructedCam = evaluateFreeOrbitCameraPosition(freeOrbitState);

  assertClose(
    reconstructedCam.cameraPos.x,
    tpCamPos.x,
    1e-5,
    'Switching Third Person -> Free Orbit preserves exact camera X position (zero jump)'
  );
  assertClose(
    reconstructedCam.cameraPos.y,
    tpCamPos.y,
    1e-5,
    'Switching Third Person -> Free Orbit preserves exact camera Y position (zero jump)'
  );
  assertClose(
    reconstructedCam.cameraPos.z,
    tpCamPos.z,
    1e-5,
    'Switching Third Person -> Free Orbit preserves exact camera Z position (zero jump)'
  );
  assertClose(freeOrbitState.targetX, tpLookTarget.x, 1e-5, 'Free Orbit preserves look target X');
  assertClose(freeOrbitState.targetY, tpLookTarget.y, 1e-5, 'Free Orbit preserves look target Y');
  assertClose(freeOrbitState.targetZ, tpLookTarget.z, 1e-5, 'Free Orbit preserves look target Z');

  // 4. Free Orbit independence during character movement (Acceptance Test 6)
  let movedChar = createInitialLocomotionState();
  movedChar.x = 0.12;
  movedChar.z = -0.18;
  for (let i = 0; i < 20; i++) {
    movedChar = stepThirdPersonLocomotion(movedChar, { x: -0.8, y: 0.6 }, freeOrbitState.yaw, 0.032);
  }
  const camAfterCharMove = evaluateFreeOrbitCameraPosition(freeOrbitState);
  assertClose(
    camAfterCharMove.cameraPos.x,
    tpCamPos.x,
    1e-6,
    'Moving character in Free Orbit does not pull or snap Free Orbit camera X'
  );
  assertClose(
    camAfterCharMove.cameraPos.z,
    tpCamPos.z,
    1e-6,
    'Moving character in Free Orbit does not pull or snap Free Orbit camera Z'
  );

  // 5. Free Orbit Panning & Zooming (Acceptance Test 8)
  const prevTargetX = freeOrbitState.targetX;
  const prevTargetY = freeOrbitState.targetY;
  const prevTargetZ = freeOrbitState.targetZ;
  const pannedOrbit = panFreeOrbitTarget({ ...freeOrbitState }, 120, 80, 600, 47);
  pannedOrbit.currTargetX = pannedOrbit.targetX;
  pannedOrbit.currTargetY = pannedOrbit.targetY;
  pannedOrbit.currTargetZ = pannedOrbit.targetZ;
  assert(
    Math.hypot(pannedOrbit.targetX - prevTargetX, pannedOrbit.targetZ - prevTargetZ) > 0.1,
    'Panning in Free Orbit shifts world-space orbit target horizontally'
  );
  assert(
    Math.abs(pannedOrbit.targetY - prevTargetY) > 0.05,
    'Panning in Free Orbit shifts world-space orbit target vertically'
  );

  // 6. Switching back Free Orbit -> Third Person preserves viewing direction & distance (Acceptance Test 7)
  const currentFreeCam = evaluateFreeOrbitCameraPosition(pannedOrbit);
  const subjectAnchor = { x: movedChar.x, y: 1.15, z: movedChar.z };
  const tpOrientation = convertFreeOrbitToThirdPersonOrientation(
    currentFreeCam.cameraPos,
    subjectAnchor
  );
  assert(
    Number.isFinite(tpOrientation.yawRad) &&
      Number.isFinite(tpOrientation.pitchRad) &&
      tpOrientation.distance >= 0.7 &&
      tpOrientation.distance <= 6.8,
    'Switching Free Orbit -> Third Person computes valid spherical yaw, pitch, and distance relative to subject'
  );

  console.log('✓ Phase 2E: Normalized diagonal speed, solid obstacle collision, and camera mode transitions passed');
}

console.log('\nAll Playboard 3D Upgrade tests passed successfully! 🎉');


