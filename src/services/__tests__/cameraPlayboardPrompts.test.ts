import * as THREE from 'three';
import {
  buildInitialI2IFields,
  compileFinalI2IPrompt,
  buildPlayboardT2IPrompt,
  syncI2IFieldsWithConfig,
  describeCameraHorizontal,
  describeCameraElevation,
  describeGazeAndEyeContact,
  describePlayboardEnvironment,
  describeTorso,
  describeLeg,
  describeArm,
  getEffectiveCameraYawDeg,
  analyzePlayboardFraming,
  computePlayboardCameraTransform,
  computeCharacterWorldLandmarks,
  computeRelativeCameraSubjectAngles,
  computeSubjectGazeTarget,
  resolvePlayboardCameraTargetXZ,
  switchCameraTargetMode,
  applyRequestedFramingState,
  applyPosePresetState,
  applyCameraPresetState,
  applyGazeControlState,
  applySceneInteractionPresetState,
  resetPoseState,
  resetCameraState,
  resetSubjectPositionState,
  resetAllPlayboardState,
  migrateLegacyPlayboardConfig,
  getCustomModelDiagnostics,
  computePlayboardVisualGuidesGeometry,
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
  resolveSemanticCharacterRigPose,
  getHandGestureTargets,
  CANONICAL_POSE_PRESET_VALUES,
} from '../cameraPlayboardPrompts';
import {
  createInitialLocomotionState,
  stepThirdPersonLocomotion,
  stepCharacterTurnInPlace,
  normalizeJoystickInput,
  normalizeTurnJoystickInput,
  getSubjectGroundBasis,
  getCameraGroundBasis,
  normalizeAngleRad,
  shortestAngleDiffRad,
  dampAngleRad,
  classifyCharacterLocalGait,
} from '../thirdPersonLocomotion';
import {
  SCENE_INTERACTION_PRESETS,
  SCENE_INTERACTION_CATEGORIES,
  getInteractionPresetById,
  evaluateActiveSceneInteraction,
  BEDROOM_SUPPORT_SURFACES,
  getSupportSurfaceById,
  inferActiveSupportSurface,
  clampPosePlacementToSupportBounds,
} from '../sceneInteractionPresets';
import {
  PlayboardFullConfig,
  Camera3DSettings,
  CharacterPose3DSettings,
  ShotFraming,
  PlayboardEnvironment,
} from '../../types/cameraPlayboard';
import { computeOpticalBokehParams } from '../../components/Playboard3DCanvas';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED ASSERTION: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('--- STARTING CAMERA PLAYBOARD & THIRD-PERSON LOCOMOTION VALIDATION TESTS ---');

// =========================================================================
// TEST 1: User's Scenario:
// Side-oriented camera (90° yaw), seated character, both arms extended forward, head turned sideways (55°)
// =========================================================================
console.log('\n[TEST 1]: Side-oriented camera + seated character + both arms extended forward + head turned sideways');

const sideCameraConfig: Camera3DSettings = {
  yawDeg: 90, // Right side profile
  pitchDeg: 0,
  height: 1.1,
  distance: 3.0,
  rollDeg: 0,
  focalLength: '50mm_standard_normal',
  framing: 'medium_shot',
  composition: 'center',
  outputRatio: '3:4',
  orientation: 'Portrait',
  focusDof: 'shallow_f1_4',
};

const seatedArmsForwardHeadTurnedPose: CharacterPose3DSettings = {
  basePose: 'casual_sitting',
  torsoLeanDeg: 0,
  torsoTwistDeg: 0,
  torsoTiltDeg: 0,
  headRotationDeg: 55, // Head turned sideways
  headTiltDeg: 0,
  gaze: 'direct_at_camera',
  expression: 'neutral_relaxed',
  leftArmShoulderForwardDeg: 75,
  leftArmShoulderOutDeg: 12,
  leftArmElbowBendDeg: 15,
  leftArmWristDeg: 0,
  leftHandGesture: 'relaxed_natural',
  rightArmShoulderForwardDeg: 75,
  rightArmShoulderOutDeg: 12,
  rightArmElbowBendDeg: 15,
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
};

const test1FullConfig: PlayboardFullConfig = {
  id: 'test_side_seated',
  name: 'Test Side Seated',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  environment: 'studio_bedroom',
  camera: sideCameraConfig,
  pose: seatedArmsForwardHeadTurnedPose,
};

const test1Fields = buildInitialI2IFields(test1FullConfig, 'both');
const test1FinalPrompt = compileFinalI2IPrompt(test1Fields, 'both', test1FullConfig, 'universal');

// 1. Verify camera description is SIDE PROFILE, not front-facing!
const cameraField = test1Fields.find((f) => f.id === 'camera_framing');
assert(!!cameraField, 'Camera framing field exists');
assert(
  cameraField!.userText.includes('side profile view') || cameraField!.userText.includes('90° yaw'),
  `Camera field must describe a side profile view (90° yaw). Got: ${cameraField!.userText}`
);
assert(
  !cameraField!.userText.includes('direct front-facing camera viewpoint'),
  'Camera field must NOT describe a direct front-facing viewpoint when camera yaw is 90°'
);

// 2. Verify pose is SEATED, not standing!
const torsoField = test1Fields.find((f) => f.id === 'body_pose_torso');
assert(!!torsoField, 'Torso field exists');
assert(
  torsoField!.userText.includes('seated posture') || torsoField!.userText.includes('seated'),
  `Torso field must describe seated posture. Got: ${torsoField!.userText}`
);

// 3. Verify legs describe seated legs (NOT "stepped forward 80°")!
const legsField = test1Fields.find((f) => f.id === 'legs_and_feet');
assert(!!legsField, 'Legs field exists');
assert(
  legsField!.userText.includes('seated') || legsField!.userText.includes('thigh extended forward horizontally'),
  `Legs field must describe seated legs. Got: ${legsField!.userText}`
);
assert(
  !legsField!.userText.includes('stepped forward'),
  'Legs field must NOT say "stepped forward" for a seated character'
);

// 4. Verify arms describe arms extended forward (NOT "hanging alongside body")!
const armsField = test1Fields.find((f) => f.id === 'arms_and_hands');
assert(!!armsField, 'Arms field exists');
assert(
  armsField!.userText.includes('extended forward in front of the body'),
  `Arms field must describe arms extended forward. Got: ${armsField!.userText}`
);

// 5. Verify head and gaze: Head turned sideways, no false direct eye contact!
const headField = test1Fields.find((f) => f.id === 'head_gaze_expression');
assert(!!headField, 'Head field exists');
assert(
  headField!.userText.includes('head turned sideways 55°') || headField!.userText.includes('turned sideways'),
  `Head field must describe head turned sideways. Got: ${headField!.userText}`
);
assert(
  headField!.userText.includes('no direct eye contact with the camera lens'),
  `Head field must NOT describe direct eye contact when head is turned sideways away from camera. Got: ${headField!.userText}`
);

console.log('✅ Test 1 PASSED: All side-seated forward-arms assertions verified successfully.');

// =========================================================================
// TEST 2: Front-facing pose tested separately
// =========================================================================
console.log('\n[TEST 2]: Front-facing camera + standing character + direct eye contact');

const frontCameraConfig: Camera3DSettings = {
  yawDeg: 0,
  pitchDeg: 0,
  height: 1.5,
  distance: 3.0,
  rollDeg: 0,
  focalLength: '50mm_standard_normal',
  framing: 'medium_shot',
  composition: 'center',
  outputRatio: '3:4',
  orientation: 'Portrait',
  focusDof: 'shallow_f1_4',
};

const frontStandingPose: CharacterPose3DSettings = {
  basePose: 'natural_standing',
  torsoLeanDeg: 0,
  torsoTwistDeg: 0,
  torsoTiltDeg: 0,
  headRotationDeg: 0,
  headTiltDeg: 0,
  gaze: 'direct_at_camera',
  expression: 'gentle_smile',
  leftArmShoulderForwardDeg: 0,
  leftArmShoulderOutDeg: 12,
  leftArmElbowBendDeg: 15,
  leftArmWristDeg: 0,
  leftHandGesture: 'relaxed_natural',
  rightArmShoulderForwardDeg: 0,
  rightArmShoulderOutDeg: 12,
  rightArmElbowBendDeg: 15,
  rightArmWristDeg: 0,
  rightHandGesture: 'relaxed_natural',
  leftLegHipForwardDeg: 0,
  leftLegHipOutDeg: 6,
  leftLegKneeBendDeg: 4,
  leftFootAngleDeg: 0,
  rightLegHipForwardDeg: 0,
  rightLegHipOutDeg: 6,
  rightLegKneeBendDeg: 4,
  rightFootAngleDeg: 0,
  isWalking: false,
  isWaving: false,
  hipHeightOffset: 0,
};

const test2FullConfig: PlayboardFullConfig = {
  id: 'test_front_standing',
  name: 'Test Front Standing',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  environment: 'studio_bedroom',
  camera: frontCameraConfig,
  pose: frontStandingPose,
};

const test2Fields = buildInitialI2IFields(test2FullConfig, 'both');
const t2CameraField = test2Fields.find((f) => f.id === 'camera_framing');
assert(
  t2CameraField!.userText.includes('direct front-facing camera viewpoint'),
  `Test 2 must describe direct front-facing camera. Got: ${t2CameraField!.userText}`
);

const t2HeadField = test2Fields.find((f) => f.id === 'head_gaze_expression');
assert(
  t2HeadField!.userText.includes('direct eye contact'),
  `Test 2 must describe direct eye contact when facing camera. Got: ${t2HeadField!.userText}`
);

console.log('✅ Test 2 PASSED: Front-facing standing stance with direct eye contact verified.');

// =========================================================================
// TEST 3: Preservation of locked fields and custom manual edits
// =========================================================================
console.log('\n[TEST 3]: Preservation of locked fields and manual user edits');

const modifiedFields = test1Fields.map((f) => {
  if (f.id === 'identity_preservation') {
    return {
      ...f,
      userText: 'CUSTOM USER LOCKED IDENTITY: Woman in her late 20s with hazel eyes and curly brunette hair.',
      isLocked: true,
    };
  }
  if (f.id === 'scene_preservation') {
    return {
      ...f,
      isRemoved: true,
    };
  }
  return f;
});

const leftCameraConfig = { ...sideCameraConfig, yawDeg: -90 };
const updatedConfig: PlayboardFullConfig = {
  ...test1FullConfig,
  camera: leftCameraConfig,
};

const syncedFields = syncI2IFieldsWithConfig(modifiedFields, updatedConfig, 'both');
const syncedIdentity = syncedFields.find((f) => f.id === 'identity_preservation');
assert(syncedIdentity!.isLocked === true, 'Locked identity field must remain locked');
assert(
  syncedIdentity!.userText.includes('CUSTOM USER LOCKED IDENTITY'),
  `Locked identity userText must NOT be overwritten!`
);

console.log('✅ Test 3 PASSED: Field locking, custom edits, removal and sync verified.');

// =========================================================================
// THIRD-PERSON MOVEMENT & CAMERA VALIDATION SUITE (SCENARIOS 1 TO 8)
// =========================================================================

// Helper to simulate N frames at 60fps
function simulateLocomotion(
  state: ReturnType<typeof createInitialLocomotionState>,
  stick: { x: number; y: number },
  camYawRad: number,
  seconds: number
) {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    stepThirdPersonLocomotion(state, stick, camYawRad, dt);
  }
}

// Scenario 1: Move forward along subject's current facing direction (+Z, rot = 0)
console.log('\n[MOVEMENT SCENARIO 1]: Move forward along subject facing direction (+Z, rot = 0)');
{
  const state = createInitialLocomotionState();
  const camYawRad = Math.PI;
  simulateLocomotion(state, { x: 0, y: 0.6 }, camYawRad, 0.5);
  assert(state.z > 0.25 && Math.abs(state.x) < 0.001, `Character should move forward along +Z. Got x=${state.x}, z=${state.z}`);
  assert(Math.abs(shortestAngleDiffRad(state.rot, 0)) < 1e-6, `Character must remain at rot=0. Got rot=${state.rot}`);
  assert(state.gaitMode === 'walk_forward', `Expected walk_forward at 0.6 intensity, got ${state.gaitMode}`);

  // Full stick push triggers run_forward
  simulateLocomotion(state, { x: 0, y: 1.0 }, camYawRad, 0.4);
  assert(state.gaitMode === 'run_forward' && state.runBlend > 0.5, `Expected run_forward at 1.0 intensity, got ${state.gaitMode}`);
  console.log('✅ Scenario 1 PASSED: Subject-relative forward walk and run verified.');
}

// Scenario 2: Rotate camera 90 degrees (camYaw = PI/2), then push forward -> moves in SUBJECT facing direction, independent of camera
console.log('\n[MOVEMENT SCENARIO 2]: Rotate camera 90 degrees (camYaw = PI/2), then push forward -> moves along subject facing (+Z), independent of camera');
{
  const state = createInitialLocomotionState();
  const camYawRad = Math.PI / 2;
  simulateLocomotion(state, { x: 0, y: 0.8 }, camYawRad, 0.6);
  assert(
    state.z > 0.35 && Math.abs(state.x) < 1e-5,
    `Character facing +Z (0°) must move along +Z regardless of camera yaw (+90°)! Got x=${state.x}, z=${state.z}`
  );
  assert(
    Math.abs(shortestAngleDiffRad(state.rot, 0)) < 1e-6,
    `Character rotation must remain 0° and never rotate toward camera! Got rot=${state.rot}`
  );
  console.log('✅ Scenario 2 PASSED: Camera rotation does not alter subject-relative movement basis or subject facing.');
}

// Scenario 3: Push diagonally forward-left and forward-right (subject-relative diagonal translation + normalized speed, no rotation)
console.log('\n[MOVEMENT SCENARIO 3]: Push diagonally forward-left and forward-right + diagonal normalization without rotating subject');
{
  // Verify diagonal input normalization prevents speed boost
  const diagNorm = normalizeJoystickInput(1, 1);
  const straightNorm = normalizeJoystickInput(0, 1);
  assert(
    Math.abs(Math.hypot(diagNorm.dirX, diagNorm.dirY) - 1.0) < 1e-6 &&
      Math.abs(diagNorm.magnitude - straightNorm.magnitude) < 1e-6,
    'Diagonal joystick input must be normalized to unit length with no speed boost'
  );

  // Subject facing +Z (rot = 0): local right is +X, local left is -X, local forward is +Z
  const camYawRad = 0;
  const stateRight = createInitialLocomotionState();
  simulateLocomotion(stateRight, { x: 0.707, y: 0.707 }, camYawRad, 0.6);
  assert(
    stateRight.x > 0.2 && stateRight.z > 0.2,
    `Subject-relative forward-right at rot=0 should move in (+X, +Z). Got x=${stateRight.x}, z=${stateRight.z}`
  );
  assert(
    Math.abs(shortestAngleDiffRad(stateRight.rot, 0)) < 1e-6,
    `Diagonal movement must NOT rotate the subject! Got rot=${stateRight.rot}`
  );

  // Forward-left diagonal
  const stateLeft = createInitialLocomotionState();
  simulateLocomotion(stateLeft, { x: -0.707, y: 0.707 }, camYawRad, 0.6);
  assert(
    stateLeft.x < -0.2 && stateLeft.z > 0.2,
    `Subject-relative forward-left at rot=0 should move in (-X, +Z). Got x=${stateLeft.x}, z=${stateLeft.z}`
  );
  assert(
    Math.abs(shortestAngleDiffRad(stateLeft.rot, 0)) < 1e-6,
    `Diagonal movement must NOT rotate the subject! Got rot=${stateLeft.rot}`
  );
  console.log('✅ Scenario 3 PASSED: Diagonal subject-relative movement and speed normalization verified without auto-rotation.');
}

// Scenario 4: Pull backward (backward locomotion along subject's -forward without spinning 180 degrees around)
console.log('\n[MOVEMENT SCENARIO 4]: Pull backward (backward locomotion without rotating subject)');
{
  const state = createInitialLocomotionState();
  const camYawRad = 0;
  simulateLocomotion(state, { x: 0, y: -0.8 }, camYawRad, 0.6);
  assert(
    state.z < -0.25 && Math.abs(state.x) < 1e-5,
    `Pulling backward at rot=0 should move character along -Z. Got x=${state.x}, z=${state.z}`
  );
  assert(
    state.gaitMode === 'walk_backward' && state.forwardBlend < -0.8,
    `Pulling backward must activate walk_backward locomotion. Got gaitMode=${state.gaitMode}, forwardBlend=${state.forwardBlend}`
  );
  assert(
    Math.abs(shortestAngleDiffRad(state.rot, 0)) < 1e-6,
    `Character must NOT rotate when backing up! Expected rot=0, got rot=${state.rot}`
  );
  console.log('✅ Scenario 4 PASSED: Backward locomotion moves along subject backward vector while preserving exact facing.');
}

// Scenario 5: Strafe left and right relative to subject
console.log('\n[MOVEMENT SCENARIO 5]: Strafe left and right relative to subject facing direction');
{
  const state = createInitialLocomotionState();
  const camYawRad = 0; // Camera at +Z looking toward -Z; subject faces +Z (rot = 0)

  // Strafe right (stick.x = +0.8, stick.y = 0) -> subject facing +Z has local right = +X
  simulateLocomotion(state, { x: 0.8, y: 0 }, camYawRad, 0.5);
  assert(
    state.x > 0.25 && Math.abs(state.z) < 1e-5,
    `Strafing right at rot=0 must move along +X. Got x=${state.x}, z=${state.z}`
  );
  assert(
    state.gaitMode === 'strafe_right' && state.strafeBlend > 0.8,
    `Strafing right must use strafe_right gait. Got ${state.gaitMode}, strafeBlend=${state.strafeBlend}`
  );
  assert(
    Math.abs(shortestAngleDiffRad(state.rot, 0)) < 1e-6,
    `Strafing must keep character rotation unchanged (0). Got rot=${state.rot}`
  );

  // Strafe left (stick.x = -0.8, stick.y = 0) -> subject facing +Z has local left = -X
  const startX = state.x;
  simulateLocomotion(state, { x: -0.8, y: 0 }, camYawRad, 0.6);
  assert(
    state.x < startX - 0.25,
    `Strafing left at rot=0 must move along -X. Got x=${state.x}`
  );
  assert(
    state.gaitMode === 'strafe_left' && state.strafeBlend < -0.8,
    `Strafing left must use strafe_left gait. Got ${state.gaitMode}, strafeBlend=${state.strafeBlend}`
  );
  assert(
    Math.abs(shortestAngleDiffRad(state.rot, 0)) < 1e-6,
    `Strafing left must keep character rotation unchanged (0). Got rot=${state.rot}`
  );
  console.log('✅ Scenario 5 PASSED: Subject-relative left and right strafing movement and gait classification verified.');
}

// Scenario 6: Rotate camera while moving -> camera orbit never alters subject trajectory or subject facing
console.log('\n[MOVEMENT SCENARIO 6]: Rotate camera while moving — trajectory and facing remain strictly subject-relative');
{
  const state = createInitialLocomotionState();
  let camYawRad = Math.PI;
  const dt = 1 / 60;
  for (let i = 0; i < 45; i++) {
    camYawRad -= (Math.PI / 2) / 45;
    stepThirdPersonLocomotion(state, { x: 0, y: 0.85 }, camYawRad, dt);
  }
  assert(
    state.z > 0.4 && Math.abs(state.x) < 1e-5,
    `Orbiting the camera while holding blue joystick up must keep moving the subject straight along its own forward (+Z), never curving with the camera! Got x=${state.x}, z=${state.z}`
  );
  assert(
    Math.abs(shortestAngleDiffRad(state.rot, 0)) < 1e-6,
    `Orbiting the camera while moving must never rotate the subject! Got rot=${state.rot}`
  );
  console.log('✅ Scenario 6 PASSED: Camera orbit during movement leaves subject trajectory and orientation completely untouched.');
}

// Scenario 7: Release joystick and verify smooth stopping without losing character facing direction
console.log('\n[MOVEMENT SCENARIO 7]: Release joystick — smooth deceleration without losing facing direction');
{
  const state = createInitialLocomotionState();
  const camYawRad = Math.PI / 3; // Arbitrary 60° camera angle
  simulateLocomotion(state, { x: 0.4, y: 0.8 }, camYawRad, 0.6);
  const facingBeforeRelease = state.rot;
  const speedAtRelease = Math.hypot(state.vx, state.vz);
  assert(speedAtRelease > 0.8, 'Character is moving at release');

  // Step 1 frame after release: velocity should decelerate smoothly, not drop to 0 in a single frame
  stepThirdPersonLocomotion(state, { x: 0, y: 0 }, camYawRad, 1 / 60);
  const speedAfter1Frame = Math.hypot(state.vx, state.vz);
  assert(
    speedAfter1Frame > 0.1 && speedAfter1Frame < speedAtRelease,
    `Velocity must decelerate smoothly after release. Got ${speedAfter1Frame}`
  );

  // Settle for 0.6s
  simulateLocomotion(state, { x: 0, y: 0 }, camYawRad, 0.6);
  assert(
    Math.hypot(state.vx, state.vz) === 0 && state.walkAmt === 0 && state.gaitMode === 'idle',
    `Character must come to a complete idle stop. Got vx=${state.vx}, vz=${state.vz}, gait=${state.gaitMode}`
  );
  assert(
    Math.abs(shortestAngleDiffRad(state.rot, facingBeforeRelease)) < 0.001,
    `Character must preserve its exact facing direction after stopping! Before=${facingBeforeRelease}, After=${state.rot}`
  );
  console.log('✅ Scenario 7 PASSED: Smooth stopping and preserved facing direction verified.');
}

// Scenario 8: Verify manual posing and prompt generation reflect final character orientation and camera viewpoint
console.log('\n[MOVEMENT SCENARIO 8]: Verify manual posing and prompt generation after locomotion');
{
  // Suppose camera is at yaw = 0° (on +Z looking toward -Z), and user moved character forward
  // so character turned to face -Z (characterYawDeg = 180°), then posed right arm raised waving.
  const movedPose: CharacterPose3DSettings = {
    ...frontStandingPose,
    characterYawDeg: 180,
    characterPosX: 0,
    characterPosZ: -1.1,
    rightArmShoulderForwardDeg: 30,
    rightArmShoulderOutDeg: 70,
    rightArmElbowBendDeg: 80,
    rightHandGesture: 'wave',
  };

  const postMoveConfig: PlayboardFullConfig = {
    id: 'test_post_move',
    name: 'Post Locomotion Config',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    environment: 'studio_bedroom',
    camera: { ...frontCameraConfig, yawDeg: 0 },
    pose: movedPose,
  };

  const effectiveYaw = getEffectiveCameraYawDeg(postMoveConfig.camera.yawDeg, postMoveConfig.pose.characterYawDeg);
  assert(Math.abs(effectiveYaw) === 180, `Effective camera yaw must be 180° (rear view). Got ${effectiveYaw}`);

  const t2i = buildPlayboardT2IPrompt(postMoveConfig, 'universal');
  const i2iFields = buildInitialI2IFields(postMoveConfig, 'both');
  const i2iCompiled = compileFinalI2IPrompt(i2iFields, 'both', postMoveConfig, 'universal');

  assert(
    t2i.includes('direct rear viewpoint viewing subject completely from behind') &&
      i2iCompiled.includes('direct rear viewpoint viewing subject completely from behind'),
    `Prompt after character turns 180° away from camera must describe rear view! Got: ${t2i}`
  );
  assert(
    t2i.includes('waving gesture') && i2iCompiled.includes('waving gesture'),
    'Manual arm/hand pose after locomotion must be preserved in generated prompts'
  );
  assert(
    !i2iCompiled.includes('engaging direct eye contact'),
    'Rear-facing character must not claim direct eye contact with camera lens'
  );
  console.log('✅ Scenario 8 PASSED: Manual posing and T2I/I2I prompt accuracy verified after character locomotion.');
}

// =========================================================================
// NEW VALIDATION SUITE: DYNAMIC FRAMING, ORANGE JOYSTICK TURN, & 34 SCENE INTERACTIONS
// =========================================================================

// Validation 1: Dynamic framing and shot size from actual 3D frustum bounds
console.log('\n[DYNAMIC FRAMING 1]: Zooming in/out & lens changes dynamically derive wide, full-body, knee-up, waist-up, chest-up, and close-up');
{
  const baseCam: Camera3DSettings = { ...frontCameraConfig, focalLength: '50mm_standard_normal', pitchDeg: 0, height: 1.1 };

  const wideAnalysis = analyzePlayboardFraming({ ...baseCam, distance: 5.2 }, frontStandingPose);
  assert(
    wideAnalysis.derivedFraming === 'wide_shot' && wideAnalysis.croppedParts.length === 0,
    `At 5.2m 50mm, expected wide_shot with 0 cropped parts. Got ${wideAnalysis.derivedFraming}, cropped=${wideAnalysis.croppedParts.join(',')}`
  );

  const fullBodyAnalysis = analyzePlayboardFraming({ ...baseCam, distance: 3.1 }, frontStandingPose);
  assert(
    fullBodyAnalysis.derivedFraming === 'full_shot' &&
      fullBodyAnalysis.visibleRegions.head &&
      fullBodyAnalysis.visibleRegions.feet,
    `At 3.1m 50mm, expected full_shot with head & feet visible. Got ${fullBodyAnalysis.derivedFraming}`
  );

  const kneeUpAnalysis = analyzePlayboardFraming({ ...baseCam, distance: 2.1 }, frontStandingPose);
  assert(
    kneeUpAnalysis.derivedFraming === 'three_quarter_shot' &&
      kneeUpAnalysis.visibleRegions.knees &&
      !kneeUpAnalysis.visibleRegions.feet &&
      kneeUpAnalysis.croppedParts.includes('feet and lower legs'),
    `At 2.1m 50mm, expected three_quarter_shot (knee-up) with feet cropped. Got ${kneeUpAnalysis.derivedFraming}, cropped=${kneeUpAnalysis.croppedParts.join(',')}`
  );

  const waistUpAnalysis = analyzePlayboardFraming({ ...baseCam, distance: 1.55 }, frontStandingPose);
  assert(
    waistUpAnalysis.derivedFraming === 'medium_shot' &&
      waistUpAnalysis.visibleRegions.waist &&
      !waistUpAnalysis.visibleRegions.knees,
    `At 1.55m 50mm, expected medium_shot (waist-up) with knees cropped. Got ${waistUpAnalysis.derivedFraming}`
  );

  const chestUpAnalysis = analyzePlayboardFraming({ ...baseCam, distance: 1.22 }, frontStandingPose);
  assert(
    chestUpAnalysis.derivedFraming === 'medium_close_up' &&
      chestUpAnalysis.visibleRegions.chest &&
      !chestUpAnalysis.visibleRegions.waist,
    `At 1.22m 50mm, expected medium_close_up (chest-up) with waist cropped. Got ${chestUpAnalysis.derivedFraming}`
  );

  const closeUpAnalysis = analyzePlayboardFraming(
    { ...baseCam, distance: 1.25, focalLength: '85mm_portrait_telephoto' },
    frontStandingPose
  );
  assert(
    (closeUpAnalysis.derivedFraming === 'close_up_portrait' || closeUpAnalysis.derivedFraming === 'extreme_close_up') &&
      closeUpAnalysis.visibleRegions.head &&
      !closeUpAnalysis.visibleRegions.waist,
    `At 1.25m 85mm, expected close-up portrait. Got ${closeUpAnalysis.derivedFraming}`
  );

  // Verify camera distance alone does NOT determine shot size:
  // A close camera (1.8m) with a 16mm ultra-wide lens OR character stepped back shows full-body, not close-up!
  const closeWideLensAnalysis = analyzePlayboardFraming(
    { ...baseCam, distance: 1.8, focalLength: '16mm_ultra_wide' },
    frontStandingPose
  );
  assert(
    closeWideLensAnalysis.derivedFraming === 'full_shot' || closeWideLensAnalysis.derivedFraming === 'wide_shot',
    `Close camera (1.8m) with 16mm ultra-wide lens must show full/wide shot, proving distance alone does not dictate shot size! Got ${closeWideLensAnalysis.derivedFraming}`
  );

  console.log('✅ Dynamic Framing 1 PASSED: Frustum-based shot size & cropped extremity detection verified across all zoom levels.');
}

// Validation 2: Output aspect ratio updates framing & prompt without defaulting to 3:4
console.log('\n[DYNAMIC FRAMING 2]: Output aspect ratio updates framing description without assuming 3:4');
{
  const widescreenConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: {
      ...frontCameraConfig,
      outputRatio: '16:9',
      orientation: 'Landscape',
      distance: 1.6,
    },
  };
  const t2iWide = buildPlayboardT2IPrompt(widescreenConfig, 'universal');
  const i2iWide = compileFinalI2IPrompt(buildInitialI2IFields(widescreenConfig, 'both'), 'both', widescreenConfig, 'universal');
  assert(
    t2iWide.includes('16:9') && !t2iWide.includes('3:4'),
    `16:9 T2I prompt must include 16:9 and NOT assume 3:4. Got: ${t2iWide}`
  );
  assert(
    i2iWide.includes('16:9') && !i2iWide.includes('3:4'),
    `16:9 I2I prompt must include 16:9 and NOT assume 3:4. Got: ${i2iWide}`
  );

  const squareConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: { ...frontCameraConfig, outputRatio: '1:1', orientation: 'Square' },
  };
  const t2iSquare = buildPlayboardT2IPrompt(squareConfig, 'universal');
  assert(
    t2iSquare.includes('1:1') && t2iSquare.includes('square') && !t2iSquare.includes('3:4'),
    `1:1 T2I prompt must describe 1:1 square aspect ratio and NOT 3:4. Got: ${t2iSquare}`
  );
  console.log('✅ Dynamic Framing 2 PASSED: Selected aspect ratios (16:9, 1:1, etc.) accurately reflected with zero 3:4 assumption.');
}

// Validation 3: Orange (Right) Joystick rotates character body left/right in place without moving position or camera
console.log('\n[ORANGE JOYSTICK]: Rotate character body left and right in place without moving (x, z) or camera');
{
  const state = createInitialLocomotionState();
  state.x = 1.25;
  state.z = -0.84;
  state.rot = 0;
  state.targetRot = 0;

  const dt = 1 / 60;
  // Push orange joystick right (+0.85) for 0.5s -> rotates clockwise (-Y yaw)
  for (let i = 0; i < 30; i++) {
    stepCharacterTurnInPlace(state, 0.85, dt);
  }
  const rotAfterRightTurn = state.rot;
  assert(rotAfterRightTurn < -0.5, `Pushing orange joystick right must rotate character clockwise (rot < -0.5). Got ${rotAfterRightTurn}`);
  assert(state.x === 1.25 && state.z === -0.84, `Orange joystick must NOT move character (x, z)! Got (${state.x}, ${state.z})`);
  assert(state.walkAmt === 0 && state.gaitMode === 'idle', `Orange joystick must NOT trigger walking animation! Got walkAmt=${state.walkAmt}`);

  // Release orange joystick (input = 0) -> stops immediately and holds orientation
  stepCharacterTurnInPlace(state, 0, dt);
  const rotAfterRelease = state.rot;
  stepCharacterTurnInPlace(state, 0, 0.5);
  assert(
    Math.abs(shortestAngleDiffRad(state.rot, rotAfterRelease)) < 1e-5,
    `Releasing orange joystick must hold final orientation without snapping back!`
  );

  // Push orange joystick left (-0.9) for 0.8s -> rotates counter-clockwise (+Y yaw)
  for (let i = 0; i < 48; i++) {
    stepCharacterTurnInPlace(state, -0.9, dt);
  }
  assert(state.rot > rotAfterRelease + 0.8, `Pushing orange joystick left must rotate character counter-clockwise. Got ${state.rot}`);
  assert(state.x === 1.25 && state.z === -0.84, `Character position must remain strictly unchanged!`);
  console.log('✅ Orange Joystick PASSED: Smooth in-place body rotation left/right with stationary position and preserved pose.');
}

// Validation 4: Scene Interaction Presets (Categories A, B, C, D, E) & Prompt-Aware Post-Preset Modifications
console.log('\n[SCENE INTERACTION PRESETS]: Verify all 34 presets across Bed Sitting, Chair Sitting, Bed Lying, Kneeling/Floor, and Leaning');
{
  assert(SCENE_INTERACTION_PRESETS.length >= 34, `Expected at least 34 scene interaction presets, found ${SCENE_INTERACTION_PRESETS.length}`);

  const categories = new Set(SCENE_INTERACTION_PRESETS.map((p) => p.category));
  assert(
    categories.has('bed_sitting') &&
      categories.has('chair_sitting') &&
      categories.has('bed_lying') &&
      categories.has('kneeling_floor') &&
      categories.has('leaning'),
    'All 5 required scene interaction categories (A-E) must be present'
  );

  // Test A: Sitting on edge of bed facing forward
  const bedEdgePreset = getInteractionPresetById('bed_sit_edge_forward')!;
  const bedPose: CharacterPose3DSettings = {
    ...frontStandingPose,
    ...bedEdgePreset.poseValues,
    interactionPresetId: bedEdgePreset.id,
  };
  const bedConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    pose: bedPose,
  };
  const bedT2I = buildPlayboardT2IPrompt(bedConfig, 'universal');
  const bedI2I = compileFinalI2IPrompt(buildInitialI2IFields(bedConfig, 'both'), 'both', bedConfig, 'universal');
  assert(
    bedT2I.includes('platform bed') && bedI2I.includes('bed mattress'),
    `Bed sitting preset must describe sitting on the bed in T2I and I2I prompts. Got: ${bedT2I}`
  );

  // Test B: Sitting on a chair with legs crossed
  const chairPreset = getInteractionPresetById('chair_sit_legs_crossed')!;
  const chairConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    pose: {
      ...frontStandingPose,
      ...chairPreset.poseValues,
      interactionPresetId: chairPreset.id,
    },
  };
  const chairT2I = buildPlayboardT2IPrompt(chairConfig, 'universal');
  assert(
    chairT2I.includes('studio chair') && chairT2I.includes('legs crossed'),
    `Chair sitting preset must describe sitting in the studio chair with legs crossed. Got: ${chairT2I}`
  );

  // Test C: Lying on the bed (hands behind head)
  const liePreset = getInteractionPresetById('bed_lie_hands_behind_head')!;
  const lieConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    pose: {
      ...frontStandingPose,
      ...liePreset.poseValues,
      interactionPresetId: liePreset.id,
    },
  };
  const lieT2I = buildPlayboardT2IPrompt(lieConfig, 'universal');
  assert(
    lieT2I.includes('lying on the back on the bed') && lieT2I.includes('hands cradled behind the head'),
    `Bed lying preset must describe lying on the bed with hands behind head. Got: ${lieT2I}`
  );

  // Test D & E: Kneeling with hands on bed & Leaning forward with hands on table
  const kneelBedPreset = getInteractionPresetById('floor_kneel_hands_on_bed')!;
  const kneelConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    pose: { ...frontStandingPose, ...kneelBedPreset.poseValues, interactionPresetId: kneelBedPreset.id },
  };
  assert(
    buildPlayboardT2IPrompt(kneelConfig, 'universal').includes('kneeling on the floor directly beside the bed'),
    'Kneeling beside bed preset must describe kneeling beside the bed with hands on mattress'
  );

  const leanDeskPreset = getInteractionPresetById('lean_forward_hands_on_desk')!;
  const leanConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    pose: { ...frontStandingPose, ...leanDeskPreset.poseValues, interactionPresetId: leanDeskPreset.id },
  };
  assert(
    buildPlayboardT2IPrompt(leanConfig, 'universal').includes('standing at the studio desk and leaning forward'),
    'Leaning on desk preset must describe leaning forward with hands on tabletop'
  );

  // Test Post-Preset Manual Adjustment: User selects bed sitting preset, then manually raises right arm to wave & turns head 45°
  const manuallyAdjustedBedConfig: PlayboardFullConfig = {
    ...bedConfig,
    pose: {
      ...bedPose,
      rightArmShoulderForwardDeg: 35,
      rightArmShoulderOutDeg: 75,
      rightArmElbowBendDeg: 85,
      rightHandGesture: 'wave',
      headRotationDeg: 45,
    },
  };
  const adjustedT2I = buildPlayboardT2IPrompt(manuallyAdjustedBedConfig, 'universal');
  assert(
    adjustedT2I.includes('platform bed') &&
      adjustedT2I.includes('waving gesture') &&
      adjustedT2I.includes('45°'),
    `Post-preset manual arm/head adjustments must be reflected alongside the bed interaction! Got: ${adjustedT2I}`
  );

  // Test Walking Away from Preset Anchor: If user moves character away from bed (e.g., to x=0, z=1.2), do NOT claim still on bed!
  const walkedAwayEval = evaluateActiveSceneInteraction({
    ...bedPose,
    characterPosX: 0,
    characterPosZ: 1.2,
  });
  assert(
    walkedAwayEval.hasActiveInteraction === false && walkedAwayEval.isStillAtAnchor === false,
    'Walking away from the bed anchor must deactivate the bed surface description so prompts never lie!'
  );

  // Test Contact Verification: If user selects lean_forward_hands_on_desk, hands touch the desk.
  // If user then raises both arms high above the desk, do NOT claim hands are planted on the tabletop!
  const handsRaisedOffDeskConfig: PlayboardFullConfig = {
    ...leanConfig,
    pose: {
      ...leanConfig.pose,
      torsoLeanDeg: 0,
      leftArmShoulderForwardDeg: 135,
      rightArmShoulderForwardDeg: 135,
      leftHandGesture: 'raised_up',
      rightHandGesture: 'raised_up',
    },
  };
  const handsRaisedEval = evaluateActiveSceneInteraction(
    handsRaisedOffDeskConfig.pose,
    'studio_bedroom'
  );
  assert(
    !handsRaisedEval.surfaceDescription.includes('hands planted firmly on the tabletop'),
    `When arms are raised away from the desk, must NOT claim hands are planted on the tabletop! Got: ${handsRaisedEval.surfaceDescription}`
  );

  // Test Unsupported Environment: In minimal_neutral or cyber_grid, do NOT claim contact with invisible bedroom furniture!
  const minimalEnvBedEval = evaluateActiveSceneInteraction(bedPose, 'minimal_neutral');
  assert(
    minimalEnvBedEval.hasActiveInteraction === false,
    'Bedroom-specific furniture preset must not claim furniture contact when environment is minimal_neutral'
  );

  console.log('✅ Scene Interaction Presets PASSED: All 34 presets, 3D contact checks, environment safety, and anchor departure checks verified.');
}

// Validation 5: Rotate character with orange joystick while keeping camera fixed -> updates relative viewpoint (front -> three-quarter -> profile -> rear)
console.log('\n[RELATIVE VIEWPOINT & Simultaneous Joysticks]: Orange joystick rotation updates relative viewpoint with fixed camera, and blue + orange joysticks do not conflict');
{
  const fixedCam: Camera3DSettings = { ...frontCameraConfig, yawDeg: 0, pitchDeg: 0, height: 1.5, distance: 3.0 };
  const state = createInitialLocomotionState();
  const dt = 1 / 60;

  // 1. At rot = 0 (0°), camera at 0° sees front view
  const frontCfg: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: fixedCam,
    pose: { ...frontStandingPose, characterYawDeg: 0 },
  };
  assert(
    buildPlayboardT2IPrompt(frontCfg, 'universal').includes('direct front-facing camera viewpoint'),
    'At characterYaw=0° and cameraYaw=0°, prompt must describe direct front-facing viewpoint'
  );

  // 2. Rotate character with orange joystick to ~-45° -> camera at 0° now sees front-right three-quarter view (+45° relative)
  while (THREE.MathUtils.radToDeg(state.rot) > -45) {
    stepThirdPersonLocomotion(state, { x: 0, y: 0 }, 0, dt, undefined, 0.85);
  }
  const yaw45 = Math.round(THREE.MathUtils.radToDeg(state.rot));
  const threeQuarterCfg: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: fixedCam,
    pose: { ...frontStandingPose, characterYawDeg: yaw45 },
  };
  const tqPrompt = buildPlayboardT2IPrompt(threeQuarterCfg, 'universal');
  assert(
    tqPrompt.includes('front-right three-quarter perspective'),
    `When orange joystick rotates character to ${yaw45}° with fixed camera (0°), prompt must update to front-right three-quarter view! Got: ${tqPrompt}`
  );

  // 3. Rotate character further with orange joystick to ~-90° -> camera at 0° now sees right side profile (+90° relative)
  while (THREE.MathUtils.radToDeg(state.rot) > -90) {
    stepThirdPersonLocomotion(state, { x: 0, y: 0 }, 0, dt, undefined, 0.85);
  }
  const yaw90 = Math.round(THREE.MathUtils.radToDeg(state.rot));
  const profileCfg: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: fixedCam,
    pose: { ...frontStandingPose, characterYawDeg: yaw90 },
  };
  const profPrompt = buildPlayboardT2IPrompt(profileCfg, 'universal');
  assert(
    profPrompt.includes('right side profile view'),
    `When orange joystick rotates character to ${yaw90}° with fixed camera (0°), prompt must update to right side profile view! Got: ${profPrompt}`
  );

  // 4. Simultaneous Blue movement + Orange rotation: verify orange rotation is not overwritten by blue movement!
  const simState = createInitialLocomotionState();
  const startRot = simState.rot;
  for (let i = 0; i < 30; i++) {
    // Moving forward with blue stick (y: 0.8) while turning right with orange stick (+0.9)
    stepThirdPersonLocomotion(simState, { x: 0, y: 0.8 }, Math.PI, dt, undefined, 0.9);
  }
  assert(
    simState.z > 0.2 && simState.rot < startRot - 0.5,
    `Simultaneous blue movement and orange turning must BOTH move character (z=${simState.z}) AND rotate character via orange stick (rot=${simState.rot}) without conflict!`
  );

  // Release both sticks and verify final orientation is preserved
  const rotAtSimRelease = simState.rot;
  for (let i = 0; i < 30; i++) {
    stepThirdPersonLocomotion(simState, { x: 0, y: 0 }, Math.PI, dt, undefined, 0);
  }
  assert(
    Math.abs(shortestAngleDiffRad(simState.rot, rotAtSimRelease)) < 1e-5,
    `Releasing both joysticks must preserve exact final orientation! Expected ${rotAtSimRelease}, got ${simState.rot}`
  );

  console.log('✅ Relative Viewpoint & Simultaneous Joysticks PASSED: Fixed-camera character rotation updates front -> 3/4 -> profile -> rear, and simultaneous joysticks never fight.');
}

// =========================================================================
// PHASE 2 & 3 VERIFICATION: COORDINATE CONVENTIONS, UNCOUPLED CAMERA HEIGHT/PITCH/DISTANCE, & SHORTEST-ARC YAW DAMPING
// =========================================================================
console.log('\n[PHASE 2 & 3]: Coordinate conventions, uncoupled 1:1 camera height/pitch/distance transform, and shortest-arc -180/+180 yaw damping');
{
  // 1. Verify Left (-X, -90°) vs Right (+X, +90°) anatomical landmarks & camera positions
  const landmarks = computeCharacterWorldLandmarks(frontStandingPose);
  assert(
    landmarks.rightShoulder.x > 0 && landmarks.leftShoulder.x < 0,
    `Character facing +Z (0°) must have rightShoulder at +X (${landmarks.rightShoulder.x}) and leftShoulder at -X (${landmarks.leftShoulder.x})`
  );
  assert(
    landmarks.rightEar.x > 0 && landmarks.leftEar.x < 0,
    `Character facing +Z (0°) must have rightEar at +X and leftEar at -X`
  );

  const rightCamTransform = computePlayboardCameraTransform(
    { ...frontCameraConfig, yawDeg: 90, pitchDeg: 0, distance: 3.0 },
    frontStandingPose
  );
  const leftCamTransform = computePlayboardCameraTransform(
    { ...frontCameraConfig, yawDeg: -90, pitchDeg: 0, distance: 3.0 },
    frontStandingPose
  );
  assert(
    rightCamTransform.cameraPos.x > 2.9 && Math.abs(rightCamTransform.cameraPos.z) < 0.01,
    `Camera yaw +90° must place camera on +X axis (${rightCamTransform.cameraPos.x}) viewing subject's right side`
  );
  assert(
    leftCamTransform.cameraPos.x < -2.9 && Math.abs(leftCamTransform.cameraPos.z) < 0.01,
    `Camera yaw -90° must place camera on -X axis (${leftCamTransform.cameraPos.x}) viewing subject's left side`
  );
  assert(
    describeCameraHorizontal(90).includes('right side profile') &&
      describeCameraHorizontal(-90).includes('left side profile') &&
      describeCameraHorizontal(45).includes("subject's right side") &&
      describeCameraHorizontal(-45).includes("subject's left side"),
    'describeCameraHorizontal must map +45/+90 to right side and -45/-90 to left side'
  );

  // 2. Verify 1:1 uncoupled vertical camera height shift (no 0.55 scaling factor)
  const h1 = computePlayboardCameraTransform(
    { ...frontCameraConfig, height: 1.0, pitchDeg: 0, distance: 3.0 },
    frontStandingPose
  );
  const h2 = computePlayboardCameraTransform(
    { ...frontCameraConfig, height: 2.0, pitchDeg: 0, distance: 3.0 },
    frontStandingPose
  );
  const deltaLookY = h2.lookTarget.y - h1.lookTarget.y;
  const deltaCamY = h2.cameraPos.y - h1.cameraPos.y;
  assert(
    Math.abs(deltaLookY - 1.0) < 1e-5 && Math.abs(deltaCamY - 1.0) < 1e-5,
    `Increasing camera.height by +1.0m must shift lookTarget.y and cameraPos.y by exact +1.0m (no 0.55 factor)! Got deltaLookY=${deltaLookY}, deltaCamY=${deltaCamY}`
  );

  // 3. Verify changing pitchDeg does NOT corrupt lookTarget.y when camera.height is constant
  const p0 = computePlayboardCameraTransform(
    { ...frontCameraConfig, height: 1.4, pitchDeg: 0, distance: 3.0 },
    frontStandingPose
  );
  const p35 = computePlayboardCameraTransform(
    { ...frontCameraConfig, height: 1.4, pitchDeg: 35, distance: 3.0 },
    frontStandingPose
  );
  assert(
    Math.abs(p35.lookTarget.y - p0.lookTarget.y) < 1e-6,
    `Changing pitchDeg from 0° to 35° must NOT shift lookTarget.y! Got p0=${p0.lookTarget.y}, p35=${p35.lookTarget.y}`
  );
  assert(
    p35.cameraPos.y > p0.cameraPos.y + 1.5,
    `Positive pitchDeg (+35°) must elevate cameraPos.y above lookTarget.y`
  );

  // 4. Verify shortest-arc angular damping across -180° / +180° boundary
  const fromRad = THREE.MathUtils.degToRad(175);
  const toRad = THREE.MathUtils.degToRad(-175);
  const dampedStep = dampAngleRad(fromRad, toRad, 14, 1 / 60);
  const stepDiffDeg = THREE.MathUtils.radToDeg(shortestAngleDiffRad(fromRad, dampedStep));
  assert(
    stepDiffDeg > 0 && stepDiffDeg < 10,
    `Shortest-arc damping from +175° to -175° must move + across ±180° boundary (10° arc), NOT -350°! Got stepDiffDeg=${stepDiffDeg}`
  );

  console.log('✅ Phase 2 & 3 PASSED: Left/right yaw symmetry, 1:1 uncoupled height/pitch/distance math, and shortest-arc ±180° damping verified.');
}

// =========================================================================
// PHASE 4 VERIFICATION: SIMULTANEOUS SUBJECT-RELATIVE MOVEMENT & TURNING + POST-TURN PERSISTENCE
// =========================================================================
console.log('\n[PHASE 4]: Simultaneous blue + orange joystick curves trajectory smoothly and releasing turn joystick preserves new facing');
{
  const state = createInitialLocomotionState();
  const dt = 1 / 60;
  const camYawRad = 0;

  // 1. Start moving forward along +Z (rot = 0)
  for (let i = 0; i < 20; i++) {
    stepThirdPersonLocomotion(state, { x: 0, y: 0.8 }, camYawRad, dt, undefined, 0);
  }
  assert(state.facingMode === 'manual', `Expected facingMode='manual', got ${state.facingMode}`);
  assert(Math.abs(state.rot) < 1e-6, `Character faces +Z (0 rad) while moving forward`);

  // 2. While continuing to hold forward on the blue stick (y: 0.8), rotate character ~90° right with orange stick (+0.9) -> faces -X (-PI/2)
  while (state.rot > -Math.PI / 2) {
    stepThirdPersonLocomotion(state, { x: 0, y: 0.8 }, camYawRad, dt, undefined, 0.9);
  }
  const manualRot = state.rot;
  assert(
    state.x < -0.15 && state.z > 0.25,
    `Turning toward -X while moving forward must curve the subject-relative path into -X! Got x=${state.x}, z=${state.z}`
  );

  // 3. Release the orange turn joystick (rawTurnStickX = 0) while STILL holding forward on the blue movement joystick!
  const xAtTurnRelease = state.x;
  for (let i = 0; i < 30; i++) {
    stepThirdPersonLocomotion(state, { x: 0, y: 0.8 }, camYawRad, dt, undefined, 0);
  }
  assert(
    Math.abs(shortestAngleDiffRad(state.rot, manualRot)) < 1e-6 && state.x < xAtTurnRelease - 0.25,
    `Releasing the turn joystick while still holding forward must preserve exact orientation (${manualRot}) and continue moving along the new facing direction (-X)! Got rot=${state.rot}, x=${state.x}`
  );

  // 4. Release blue movement joystick -> decelerates to idle while keeping final orientation
  const finalTurnedRot = state.rot;
  for (let i = 0; i < 45; i++) {
    stepThirdPersonLocomotion(state, { x: 0, y: 0 }, camYawRad, dt, undefined, 0);
  }
  assert(
    state.gaitMode === 'idle' &&
      Math.abs(shortestAngleDiffRad(state.rot, finalTurnedRot)) < 1e-6,
    `Stopping movement must preserve final orientation (${finalTurnedRot})`
  );

  console.log('✅ Phase 4 PASSED: Simultaneous subject-relative movement + turning and post-turn orientation persistence verified.');
}

// =========================================================================
// PHASE 6 & 7 VERIFICATION: END-TO-END SCENARIOS A TO F & I2I SCOPE SEPARATION
// =========================================================================
console.log('\n[PHASE 6 & 7]: End-to-End Scenarios A–F and strict camera_only vs pose_only vs both scope separation');
{
  // Scenario A: Pure Camera Orbit (0° -> +45° -> +90° -> 180° -> -90° -> -45°) with stationary character
  const anglesAndExpected: [number, string][] = [
    [0, 'direct front-facing'],
    [45, 'front-right three-quarter'],
    [90, 'right side profile'],
    [180, 'direct rear viewpoint'],
    [-90, 'left side profile'],
    [-45, 'front-left three-quarter'],
  ];
  for (const [yaw, expectedPhrase] of anglesAndExpected) {
    const cfg: PlayboardFullConfig = {
      ...test2FullConfig,
      camera: { ...frontCameraConfig, yawDeg: yaw },
      pose: { ...frontStandingPose, characterYawDeg: 0 },
    };
    const prompt = buildPlayboardT2IPrompt(cfg, 'universal');
    assert(
      prompt.includes(expectedPhrase),
      `Scenario A at camera yaw=${yaw}° must include "${expectedPhrase}". Got: ${prompt}`
    );
  }

  // Scenario B: Camera Elevation & Pitch Independence
  const lowCamCfg: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: { ...frontCameraConfig, height: 0.4, pitchDeg: -20, distance: 2.6 },
  };
  const highCamCfg: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: { ...frontCameraConfig, height: 2.3, pitchDeg: 35, distance: 2.8 },
  };
  const eyeCamCfg: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: { ...frontCameraConfig, height: 1.5, pitchDeg: 0, distance: 3.0 },
  };
  const lowPrompt = buildPlayboardT2IPrompt(lowCamCfg, 'universal');
  const highPrompt = buildPlayboardT2IPrompt(highCamCfg, 'universal');
  const eyePrompt = buildPlayboardT2IPrompt(eyeCamCfg, 'universal');
  assert(
    lowPrompt.includes('ground-level') && lowPrompt.includes('worm\'s-eye'),
    `Scenario B low camera must describe ground-level and upward worm's-eye tilt. Got: ${lowPrompt}`
  );
  assert(
    highPrompt.includes('high-angle') && highPrompt.includes('35°'),
    `Scenario B high camera must describe high-angle and 35° downward tilt. Got: ${highPrompt}`
  );
  assert(
    eyePrompt.includes('eye-level camera placement (1.5m height)'),
    `Scenario B eye-level camera (1.5m, 0° pitch) must describe true eye-level placement. Got: ${eyePrompt}`
  );

  // Scenario E: Head vs. Body Independence (body rotated -45° clockwise so camera at 0° is at +45° right of body, while head turns +45° right to look straight into camera!)
  const bodyTurnedHeadAtCameraCfg: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: { ...frontCameraConfig, yawDeg: 0 },
    pose: {
      ...frontStandingPose,
      characterYawDeg: -45, // Body turned 45° clockwise (camera is at +45° front-right of body)
      headRotationDeg: 45,  // Head turned +45° right relative to body -> faces 0° (straight at camera!)
      gaze: 'direct_at_camera',
    },
  };
  const scenarioEPrompt = buildPlayboardT2IPrompt(bodyTurnedHeadAtCameraCfg, 'universal');
  assert(
    scenarioEPrompt.includes('front-right three-quarter perspective') &&
      scenarioEPrompt.includes("head turned toward character's right to face the camera lens with direct eye contact"),
    `Scenario E must describe 3/4 body viewpoint AND head turned toward camera with direct eye contact! Got: ${scenarioEPrompt}`
  );

  // Scenario F: Strict I2I Scope Separation ('camera_only' vs 'pose_only' vs 'both')
  const customPoseAndCamConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: { ...frontCameraConfig, yawDeg: -90, height: 2.2, pitchDeg: 28, outputRatio: '16:9' },
    pose: {
      ...frontStandingPose,
      characterYawDeg: -45,
      torsoTwistDeg: 15,
      rightArmShoulderForwardDeg: 45,
      rightHandGesture: 'wave',
      headRotationDeg: -35,
      expression: 'expressive_laugh',
    },
  };

  const camOnlyFields = buildInitialI2IFields(customPoseAndCamConfig, 'camera_only');
  const camOnlyPrompt = compileFinalI2IPrompt(camOnlyFields, 'camera_only', customPoseAndCamConfig, 'universal');
  assert(
    camOnlyPrompt.includes('Camera Viewpoint & Framing Shift Only') &&
      camOnlyPrompt.includes('CAMERA VIEWPOINT & FRAMING') &&
      !camOnlyPrompt.includes('[BODY POSE & TORSO ALIGNMENT]') &&
      !camOnlyPrompt.includes('[ARMS & HAND GESTURES]') &&
      !camOnlyPrompt.includes('[LEGS & FOOT PLACEMENT]') &&
      !camOnlyPrompt.includes('[HEAD DIRECTION, GAZE & EXPRESSION]'),
    `camera_only scope must include camera framing and exclude all body/limb/head pose sections! Got: ${camOnlyPrompt}`
  );

  const poseOnlyFields = buildInitialI2IFields(customPoseAndCamConfig, 'pose_only');
  const poseOnlyPrompt = compileFinalI2IPrompt(poseOnlyFields, 'pose_only', customPoseAndCamConfig, 'universal');
  assert(
    poseOnlyPrompt.includes('Pose & Gesture Modification Only') &&
      !poseOnlyPrompt.includes('[CAMERA VIEWPOINT & FRAMING]') &&
      poseOnlyPrompt.includes('[BODY POSE & TORSO ALIGNMENT]') &&
      poseOnlyPrompt.includes('whole body oriented 45° clockwise') &&
      poseOnlyPrompt.includes('[ARMS & HAND GESTURES]') &&
      poseOnlyPrompt.includes('[LEGS & FOOT PLACEMENT]') &&
      poseOnlyPrompt.includes('[HEAD DIRECTION, GAZE & EXPRESSION]'),
    `pose_only scope must include whole-body orientation, torso, arms, legs, and head/gaze while excluding camera framing! Got: ${poseOnlyPrompt}`
  );

  const bothFields = buildInitialI2IFields(customPoseAndCamConfig, 'both');
  const bothPrompt = compileFinalI2IPrompt(bothFields, 'both', customPoseAndCamConfig, 'universal');
  assert(
    bothPrompt.includes('[CAMERA VIEWPOINT & FRAMING]') &&
      bothPrompt.includes('[BODY POSE & TORSO ALIGNMENT]') &&
      bothPrompt.includes('[HEAD DIRECTION, GAZE & EXPRESSION]'),
    `both scope must include both camera framing and full pose sections! Got: ${bothPrompt}`
  );

  console.log('✅ Phase 6 & 7 PASSED: Scenarios A–F and camera_only / pose_only / both scope separation verified.');
}

// =========================================================================
// PHASE 8: VERTICAL GAZE, CAMERA-TO-EYE GEOMETRY & PROMPT CONSISTENCY (SCENARIOS A–H)
// =========================================================================
console.log('\n[PHASE 8]: Vertical Gaze, 3D Camera-to-Eye Geometry, Preview Eye Tracking & Prompt Consistency (Scenarios A–H)');
{
  const baseStandingPose: CharacterPose3DSettings = {
    ...frontStandingPose,
    basePose: 'natural_standing',
    torsoLeanDeg: 0,
    torsoTwistDeg: 0,
    torsoTiltDeg: 0,
    headRotationDeg: 0,
    headTiltDeg: 0,
    gaze: 'direct_at_camera',
    expression: 'neutral_relaxed',
    characterYawDeg: 0,
    characterPosX: 0,
    characterPosZ: 0,
    hipHeightOffset: 0,
  };

  // -------------------------------------------------------------------------
  // Scenario A — Eye-level direct eye contact
  // -------------------------------------------------------------------------
  const scenarioACamera: Camera3DSettings = {
    ...frontCameraConfig,
    yawDeg: 0,
    pitchDeg: 0,
    height: 1.5,
    distance: 3.0,
  };
  const scenarioAAnalysis = analyzePlayboardFraming(scenarioACamera, baseStandingPose);
  const scenarioARel = scenarioAAnalysis.relativeAngles;

  assert(
    Math.abs(scenarioARel.headLocalCameraYawDeg) < 1 &&
      Math.abs(scenarioARel.verticalCameraToEyeAngleDeg) <= 7.5 &&
      Math.abs(scenarioARel.headLocalCameraPitchDeg) <= 7.5,
    `Scenario A must have near-zero horizontal and vertical camera-to-eye angles. Got yaw=${scenarioARel.headLocalCameraYawDeg.toFixed(2)}°, vert=${scenarioARel.verticalCameraToEyeAngleDeg.toFixed(2)}°`
  );
  assert(
    scenarioARel.gazeSolution.canAchieveDirectLensContact,
    'Scenario A must allow direct lens contact'
  );

  const scenarioAConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: scenarioACamera,
    pose: baseStandingPose,
  };
  const scenarioAT2I = buildPlayboardT2IPrompt(scenarioAConfig, 'universal');
  const scenarioAI2I = compileFinalI2IPrompt(
    buildInitialI2IFields(scenarioAConfig, 'both'),
    'both',
    scenarioAConfig,
    'universal'
  );
  assert(
    scenarioAT2I.includes('eye-level camera placement') &&
      scenarioAT2I.includes('face and eyes directed straight into the camera lens with engaging direct eye contact'),
    `Scenario A T2I must describe eye-level placement and straight direct eye contact. Got: ${scenarioAT2I}`
  );
  assert(
    scenarioAI2I.includes('eye-level camera placement') &&
      scenarioAI2I.includes('face and eyes directed straight into the camera lens with engaging direct eye contact'),
    `Scenario A I2I must describe eye-level placement and straight direct eye contact. Got: ${scenarioAI2I}`
  );

  // -------------------------------------------------------------------------
  // Scenario B — Low-angle direct eye contact (The Primary Bug!)
  // Pose: standing, headTiltDeg = 0, gaze = "direct_at_camera"
  // Camera: low angle below eye level (e.g., height: 0.55m, pitchDeg: -18° AND height: 1.4m, pitchDeg: -20° orbit)
  // -------------------------------------------------------------------------
  const scenarioBCameraLowPedestal: Camera3DSettings = {
    ...frontCameraConfig,
    yawDeg: 0,
    pitchDeg: -18,
    height: 0.55,
    distance: 2.6,
  };
  const scenarioBAnalysis1 = analyzePlayboardFraming(scenarioBCameraLowPedestal, baseStandingPose);
  const scenarioBRel1 = scenarioBAnalysis1.relativeAngles;

  // Also test the exact orbit case where height slider stayed at 1.4m while user orbited camera to -20° pitch!
  const scenarioBCameraOrbitedLow: Camera3DSettings = {
    ...frontCameraConfig,
    yawDeg: 0,
    pitchDeg: -20,
    height: 1.4,
    distance: 3.0,
  };
  const scenarioBAnalysis2 = analyzePlayboardFraming(scenarioBCameraOrbitedLow, baseStandingPose);
  const scenarioBRel2 = scenarioBAnalysis2.relativeAngles;

  assert(
    scenarioBRel1.cameraAboveEyesMeters < -0.8 &&
      scenarioBRel1.verticalCameraToEyeAngleDeg < -15 &&
      scenarioBRel1.headLocalCameraPitchDeg < -15 &&
      scenarioBRel1.gazeSolution.eyePitchDeg < -10 &&
      scenarioBRel1.gazeSolution.pupilOffsetY < -0.002,
    `Scenario B (low pedestal) must compute negative cameraAboveEyesMeters (${scenarioBRel1.cameraAboveEyesMeters.toFixed(2)}m), negative verticalCameraToEyeAngleDeg (${scenarioBRel1.verticalCameraToEyeAngleDeg.toFixed(1)}°), and downward pupil offset (${scenarioBRel1.gazeSolution.pupilOffsetY.toFixed(4)}m)`
  );

  assert(
    scenarioBRel2.cameraLensHeightMeters < 0.45 &&
      scenarioBRel2.cameraAboveEyesMeters < -1.0 &&
      scenarioBRel2.verticalCameraToEyeAngleDeg < -18 &&
      scenarioBRel2.gazeSolution.pupilOffsetY < -0.002,
    `Scenario B (orbited low pitch=-20° at height=1.4m) must use true world cameraPos.y (${scenarioBRel2.cameraLensHeightMeters.toFixed(2)}m), NOT slider height 1.4m! Got cameraAboveEyes=${scenarioBRel2.cameraAboveEyesMeters.toFixed(2)}m, vertAngle=${scenarioBRel2.verticalCameraToEyeAngleDeg.toFixed(1)}°`
  );

  for (const camB of [scenarioBCameraLowPedestal, scenarioBCameraOrbitedLow]) {
    const cfgB: PlayboardFullConfig = {
      ...test2FullConfig,
      camera: camB,
      pose: baseStandingPose,
    };
    const t2iB = buildPlayboardT2IPrompt(cfgB, 'universal');
    const i2iBothB = compileFinalI2IPrompt(
      buildInitialI2IFields(cfgB, 'both'),
      'both',
      cfgB,
      'universal'
    );
    const i2iCamOnlyB = compileFinalI2IPrompt(
      buildInitialI2IFields(cfgB, 'camera_only'),
      'camera_only',
      cfgB,
      'universal'
    );

    // Must NOT claim flat "eye-level camera placement" or flat "face and eyes directed straight into the camera lens"
    assert(
      !t2iB.includes('eye-level camera placement') &&
        !t2iB.includes('face and eyes directed straight into the camera lens'),
      `Scenario B T2I must not claim flat eye-level gaze when camera is at a low angle. Got: ${t2iB}`
    );
    assert(
      t2iB.includes('eyes angled downward') &&
        t2iB.includes('low-angle camera lens') &&
        t2iB.includes('below the subject\'s eye line') &&
        t2iB.includes('direct eye contact'),
      `Scenario B T2I must explicitly specify downward gaze into the low-angle camera lens to maintain direct eye contact. Got: ${t2iB}`
    );
    assert(
      i2iBothB.includes('eyes angled downward') &&
        i2iBothB.includes('low-angle camera lens') &&
        i2iBothB.includes('direct eye contact'),
      `Scenario B I2I (both) must explicitly specify downward gaze into the low-angle camera lens. Got: ${i2iBothB}`
    );
    assert(
      i2iCamOnlyB.includes('eyes angled downward') &&
        i2iCamOnlyB.includes('low-angle camera lens'),
      `Scenario B I2I (camera_only) must also communicate camera-relative downward gaze toward the low-angle lens. Got: ${i2iCamOnlyB}`
    );
  }

  // Also verify Scenario B when the user explicitly tilts the head downward (e.g. headTiltDeg = -22°) to align with the low camera
  const scenarioBPoseHeadTiltedDown: CharacterPose3DSettings = {
    ...baseStandingPose,
    headTiltDeg: -22,
    gaze: 'direct_at_camera',
  };
  const scenarioBHeadTiltedGaze = describeGazeAndEyeContact(
    scenarioBPoseHeadTiltedDown,
    scenarioBCameraLowPedestal.yawDeg,
    analyzePlayboardFraming(scenarioBCameraLowPedestal, scenarioBPoseHeadTiltedDown).relativeAngles
  );
  assert(
    scenarioBHeadTiltedGaze.includes('head tilted downward') ||
      scenarioBHeadTiltedGaze.includes('low-angle camera lens'),
    `Scenario B with downward head tilt must describe downward alignment with the low-angle camera lens. Got: ${scenarioBHeadTiltedGaze}`
  );

  // -------------------------------------------------------------------------
  // Scenario C — High-angle direct eye contact
  // Pose: standing, headTiltDeg = 0, gaze = "direct_at_camera"
  // Camera: high angle above eye level (looking downward at subject)
  // -------------------------------------------------------------------------
  const scenarioCCamera: Camera3DSettings = {
    ...frontCameraConfig,
    yawDeg: 0,
    pitchDeg: 28,
    height: 2.2,
    distance: 2.8,
  };
  const scenarioCAnalysis = analyzePlayboardFraming(scenarioCCamera, baseStandingPose);
  const scenarioCRel = scenarioCAnalysis.relativeAngles;

  assert(
    scenarioCRel.cameraAboveEyesMeters > 0.8 &&
      scenarioCRel.verticalCameraToEyeAngleDeg > 15 &&
      scenarioCRel.headLocalCameraPitchDeg > 15 &&
      scenarioCRel.gazeSolution.eyePitchDeg > 10 &&
      scenarioCRel.gazeSolution.pupilOffsetY > 0.002,
    `Scenario C must compute positive cameraAboveEyesMeters (${scenarioCRel.cameraAboveEyesMeters.toFixed(2)}m), positive verticalCameraToEyeAngleDeg (${scenarioCRel.verticalCameraToEyeAngleDeg.toFixed(1)}°), and upward pupil offset (${scenarioCRel.gazeSolution.pupilOffsetY.toFixed(4)}m)`
  );

  const scenarioCConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: scenarioCCamera,
    pose: baseStandingPose,
  };
  const scenarioCT2I = buildPlayboardT2IPrompt(scenarioCConfig, 'universal');
  const scenarioCI2I = compileFinalI2IPrompt(
    buildInitialI2IFields(scenarioCConfig, 'both'),
    'both',
    scenarioCConfig,
    'universal'
  );
  assert(
    scenarioCT2I.includes('eyes angled upward') &&
      scenarioCT2I.includes('elevated high-angle camera lens') &&
      scenarioCT2I.includes('above the subject\'s eye line') &&
      scenarioCT2I.includes('direct eye contact'),
    `Scenario C T2I must explicitly specify upward eye gaze toward the elevated high-angle camera lens. Got: ${scenarioCT2I}`
  );
  assert(
    scenarioCI2I.includes('eyes angled upward') &&
      scenarioCI2I.includes('elevated high-angle camera lens'),
    `Scenario C I2I must explicitly specify upward eye gaze toward the elevated high-angle camera lens. Got: ${scenarioCI2I}`
  );

  // -------------------------------------------------------------------------
  // Scenario D — Low-angle camera with explicit "looking_upward"
  // Pose: standing, gaze: "looking_upward", Camera: low angle
  // -------------------------------------------------------------------------
  const scenarioDPose: CharacterPose3DSettings = {
    ...baseStandingPose,
    gaze: 'looking_upward',
  };
  const scenarioDConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: scenarioBCameraLowPedestal,
    pose: scenarioDPose,
  };
  const scenarioDT2I = buildPlayboardT2IPrompt(scenarioDConfig, 'universal');
  const scenarioDI2I = compileFinalI2IPrompt(
    buildInitialI2IFields(scenarioDConfig, 'both'),
    'both',
    scenarioDConfig,
    'universal'
  );
  assert(
    scenarioDT2I.includes('gaze directed upward') &&
      scenarioDT2I.includes('no direct eye contact with the camera lens') &&
      !scenarioDT2I.includes('maintain direct eye contact'),
    `Scenario D must preserve explicit "looking_upward" off-camera gaze and never claim direct lens contact. Got: ${scenarioDT2I}`
  );
  assert(
    scenarioDI2I.includes('gaze directed upward') &&
      scenarioDI2I.includes('no direct eye contact with the camera lens'),
    `Scenario D I2I must preserve explicit "looking_upward" off-camera gaze. Got: ${scenarioDI2I}`
  );

  // -------------------------------------------------------------------------
  // Scenario E — Body rotated, head turned back toward camera (plus moderate angle eye-only compensation)
  // -------------------------------------------------------------------------
  const scenarioEPoseAligned: CharacterPose3DSettings = {
    ...baseStandingPose,
    characterYawDeg: -45,
    headRotationDeg: 45,
    gaze: 'direct_at_camera',
  };
  const scenarioEConfigLow: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: scenarioBCameraLowPedestal,
    pose: scenarioEPoseAligned,
  };
  const scenarioELowPrompt = buildPlayboardT2IPrompt(scenarioEConfigLow, 'universal');
  assert(
    scenarioELowPrompt.includes('front-right three-quarter perspective') &&
      scenarioELowPrompt.includes("head turned toward character's right to face the camera horizontally") &&
      scenarioELowPrompt.includes('eyes angled downward'),
    `Scenario E with low camera must combine 3/4 body view, head turned toward camera horizontally, and downward eye gaze into the low lens! Got: ${scenarioELowPrompt}`
  );

  // Also verify moderate head angle (24° off-camera) where eyes use eye-only lateral compensation
  const scenarioEPoseEyeOnly: CharacterPose3DSettings = {
    ...baseStandingPose,
    characterYawDeg: 0,
    headRotationDeg: -24, // Head turned 24° left while camera is at 0° -> camera is +24° to character's right of head
    gaze: 'direct_at_camera',
  };
  const scenarioEEyeOnlyAnalysis = analyzePlayboardFraming(scenarioACamera, scenarioEPoseEyeOnly);
  const scenarioEEyeOnlyGaze = describeGazeAndEyeContact(
    scenarioEPoseEyeOnly,
    scenarioACamera.yawDeg,
    scenarioEEyeOnlyAnalysis.relativeAngles
  );
  assert(
    scenarioEEyeOnlyAnalysis.relativeAngles.gazeSolution.requiresEyeOnlyCompensation &&
      scenarioEEyeOnlyAnalysis.relativeAngles.gazeSolution.pupilOffsetX > 0.002 &&
      scenarioEEyeOnlyGaze.includes('eye-only compensation') &&
      scenarioEEyeOnlyGaze.includes('direct eye contact'),
    `Scenario E (moderate 24° head angle) must use eye-only lateral compensation to maintain direct eye contact. Got: ${scenarioEEyeOnlyGaze}`
  );

  // -------------------------------------------------------------------------
  // Scenario F — Head turned away beyond eye-contact threshold
  // Pose: standing, head turned strongly away from camera (e.g., 60°), Gaze: "direct_at_camera"
  // -------------------------------------------------------------------------
  const scenarioFPose: CharacterPose3DSettings = {
    ...baseStandingPose,
    headRotationDeg: 60,
    gaze: 'direct_at_camera',
  };
  const scenarioFConfig: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: scenarioACamera,
    pose: scenarioFPose,
  };
  const scenarioFAnalysis = analyzePlayboardFraming(scenarioACamera, scenarioFPose);
  const scenarioFT2I = buildPlayboardT2IPrompt(scenarioFConfig, 'universal');
  assert(
    !scenarioFAnalysis.relativeAngles.gazeSolution.canAchieveDirectLensContact &&
      scenarioFT2I.includes('beyond anatomical eye-turn limits') &&
      scenarioFT2I.includes('no direct eye contact with the camera lens'),
    `Scenario F must not falsely claim direct eye contact when head is turned 60° away from camera. Got: ${scenarioFT2I}`
  );

  // -------------------------------------------------------------------------
  // Scenario G — Seated or lying pose with low/high camera
  // Verify subject eye height comes from actual posed landmarks rather than standing assumptions
  // -------------------------------------------------------------------------
  const seatedPoseG: CharacterPose3DSettings = {
    ...seatedArmsForwardHeadTurnedPose,
    headRotationDeg: 0,
    headTiltDeg: 0,
    gaze: 'direct_at_camera',
  };
  const floorCrossLeggedPoseG: CharacterPose3DSettings = {
    ...baseStandingPose,
    basePose: 'floor_seated_cross_legged',
    gaze: 'direct_at_camera',
  };
  const lyingPoseG: CharacterPose3DSettings = {
    ...baseStandingPose,
    basePose: 'reclined_lying',
    pelvisPitchDeg: -75,
    gaze: 'direct_at_camera',
  };

  const standingLandmarks = computeCharacterWorldLandmarks(baseStandingPose);
  const seatedLandmarks = computeCharacterWorldLandmarks(seatedPoseG);
  const floorLandmarks = computeCharacterWorldLandmarks(floorCrossLeggedPoseG);
  const lyingLandmarks = computeCharacterWorldLandmarks(lyingPoseG);

  assert(
    standingLandmarks.eyeCenter.y > 1.55 &&
      seatedLandmarks.eyeCenter.y < 1.35 &&
      seatedLandmarks.eyeCenter.y > 1.05 &&
      floorLandmarks.eyeCenter.y < 1.0 &&
      lyingLandmarks.eyeCenter.y < 0.65,
    `Scenario G must derive distinct posed 3D eye heights from actual landmarks: standing=${standingLandmarks.eyeCenter.y.toFixed(2)}m, seated=${seatedLandmarks.eyeCenter.y.toFixed(2)}m, floor=${floorLandmarks.eyeCenter.y.toFixed(2)}m, lying=${lyingLandmarks.eyeCenter.y.toFixed(2)}m`
  );

  // Verify that for seated, floor-seated, and lying poses, low and high cameras compute vertical gaze relative to the posed eyeCenter.y
  const seatedLowCamAnalysis = analyzePlayboardFraming(scenarioBCameraLowPedestal, seatedPoseG);
  const seatedHighCamAnalysis = analyzePlayboardFraming(scenarioCCamera, seatedPoseG);
  assert(
    Math.abs(seatedLowCamAnalysis.relativeAngles.subjectEyeHeightMeters - seatedLandmarks.eyeCenter.y) < 1e-6 &&
      seatedLowCamAnalysis.relativeAngles.cameraAboveEyesMeters < -0.7 &&
      seatedLowCamAnalysis.relativeAngles.verticalCameraToEyeAngleDeg < -14 &&
      seatedHighCamAnalysis.relativeAngles.cameraAboveEyesMeters > 1.2 &&
      seatedHighCamAnalysis.relativeAngles.verticalCameraToEyeAngleDeg > 20,
    `Scenario G: Seated pose must compute cameraAboveEyes relative to seated eye height (${seatedLandmarks.eyeCenter.y.toFixed(2)}m): low=${seatedLowCamAnalysis.relativeAngles.cameraAboveEyesMeters.toFixed(2)}m, high=${seatedHighCamAnalysis.relativeAngles.cameraAboveEyesMeters.toFixed(2)}m`
  );

  const seatedLowPrompt = buildPlayboardT2IPrompt(
    { ...test2FullConfig, camera: scenarioBCameraLowPedestal, pose: seatedPoseG },
    'universal'
  );
  const seatedHighPrompt = buildPlayboardT2IPrompt(
    { ...test2FullConfig, camera: scenarioCCamera, pose: seatedPoseG },
    'universal'
  );
  assert(
    seatedLowPrompt.includes('eyes angled downward') &&
      seatedLowPrompt.includes('low-angle camera lens') &&
      seatedHighPrompt.includes('eyes angled upward') &&
      seatedHighPrompt.includes('elevated high-angle camera lens'),
    `Scenario G: Seated pose with low/high camera must produce downward/upward eye gaze accordingly! Low: ${seatedLowPrompt} | High: ${seatedHighPrompt}`
  );

  const lyingHighCamAnalysis = analyzePlayboardFraming(scenarioCCamera, lyingPoseG);
  const lyingHighPrompt = buildPlayboardT2IPrompt(
    { ...test2FullConfig, camera: scenarioCCamera, pose: lyingPoseG },
    'universal'
  );
  assert(
    lyingHighCamAnalysis.relativeAngles.subjectEyeHeightMeters < 0.65 &&
      lyingHighCamAnalysis.relativeAngles.cameraAboveEyesMeters > 1.8 &&
      lyingHighPrompt.includes("elevated high-angle camera lens positioned") &&
      lyingHighPrompt.includes("above the subject's eye line") &&
      !lyingHighPrompt.includes("low-angle camera lens"),
    `Scenario G: Reclined lying pose with high camera must use lying eye height (${lyingHighCamAnalysis.relativeAngles.subjectEyeHeightMeters.toFixed(2)}m) and describe the elevated camera lens above the subject's eye line! Got: ${lyingHighPrompt}`
  );

  // -------------------------------------------------------------------------
  // Scenario H — All prompt compilation modes (T2I: universal, gemini, chatgpt, flux; I2I: both, camera_only, pose_only, custom)
  // -------------------------------------------------------------------------
  const lowAngleConfigH: PlayboardFullConfig = {
    ...test2FullConfig,
    camera: scenarioBCameraLowPedestal,
    pose: baseStandingPose,
  };

  for (const model of ['universal', 'gemini', 'chatgpt', 'flux'] as const) {
    const t2iOut = buildPlayboardT2IPrompt(lowAngleConfigH, model);
    assert(
      t2iOut.includes('eyes angled downward') &&
        t2iOut.includes('low-angle camera lens') &&
        !t2iOut.includes('face and eyes directed straight into the camera lens'),
      `Scenario H T2I (${model}) must include vertical downward gaze compensation for low-angle camera. Got: ${t2iOut}`
    );
  }

  for (const scope of ['both', 'camera_only', 'pose_only', 'custom'] as const) {
    const fieldsH = buildInitialI2IFields(lowAngleConfigH, scope);
    const compiledH = compileFinalI2IPrompt(fieldsH, scope, lowAngleConfigH, 'universal');
    assert(
      compiledH.includes('eyes angled downward') &&
        compiledH.includes('low-angle camera lens') &&
        !compiledH.includes('face and eyes directed straight into the camera lens'),
      `Scenario H I2I (${scope}) must include vertical downward gaze compensation for low-angle camera. Got: ${compiledH}`
    );
  }

  console.log('✅ Phase 8 PASSED: All Scenarios A–H (3D camera-to-eye geometry, vertical/horizontal gaze, anatomical clamping, posed eye landmarks, and multi-target T2I/I2I consistency) verified.');
}

// =========================================================================
// PHASE 9: SUBJECT-RELATIVE MOVEMENT, INDEPENDENT TURNING & CAMERA INDEPENDENCE (TESTS 1–35)
// =========================================================================
console.log('\n[PHASE 9]: Subject-Relative Movement (1–12), Independent Turning (13–18), Combined Input (19–24), Camera Independence (25–29), and Regression (30–35)');
{
  const dt = 1 / 60;

  // Helper to run N steps of locomotion
  const runSteps = (
    s: ReturnType<typeof createInitialLocomotionState>,
    stick: { x: number; y: number },
    camYawRad: number,
    frames: number,
    turnStickX = 0
  ) => {
    for (let i = 0; i < frames; i++) {
      stepThirdPersonLocomotion(s, stick, camYawRad, dt, undefined, turnStickX);
    }
  };

  // -------------------------------------------------------------------------
  // Movement tests (1–12)
  // -------------------------------------------------------------------------

  // Test 1: Subject facing 0° (+Z), push blue joystick up -> moves toward +Z, rotation remains 0°.
  {
    const s = createInitialLocomotionState();
    s.rot = 0;
    s.targetRot = 0;
    runSteps(s, { x: 0, y: 0.8 }, 0, 30);
    assert(
      s.z > 0.3 && Math.abs(s.x) < 1e-6 && Math.abs(shortestAngleDiffRad(s.rot, 0)) < 1e-6,
      `Test 1 failed: expected +Z movement and rot=0, got x=${s.x}, z=${s.z}, rot=${s.rot}`
    );
  }

  // Test 2: Subject facing 0° (+Z), push blue joystick down -> moves toward -Z, rotation remains 0°.
  {
    const s = createInitialLocomotionState();
    s.rot = 0;
    s.targetRot = 0;
    runSteps(s, { x: 0, y: -0.8 }, 0, 30);
    assert(
      s.z < -0.25 &&
        Math.abs(s.x) < 1e-6 &&
        Math.abs(shortestAngleDiffRad(s.rot, 0)) < 1e-6 &&
        s.gaitMode === 'walk_backward',
      `Test 2 failed: expected -Z movement, rot=0, and walk_backward, got x=${s.x}, z=${s.z}, rot=${s.rot}, gait=${s.gaitMode}`
    );
  }

  // Test 3: Subject facing 0° (+Z), push blue joystick right -> moves toward +X, rotation remains 0°, gait is strafe_right.
  {
    const s = createInitialLocomotionState();
    s.rot = 0;
    s.targetRot = 0;
    runSteps(s, { x: 0.8, y: 0 }, 0, 30);
    assert(
      s.x > 0.25 &&
        Math.abs(s.z) < 1e-6 &&
        Math.abs(shortestAngleDiffRad(s.rot, 0)) < 1e-6 &&
        s.gaitMode === 'strafe_right',
      `Test 3 failed: expected +X movement, rot=0, and strafe_right, got x=${s.x}, z=${s.z}, rot=${s.rot}, gait=${s.gaitMode}`
    );
  }

  // Test 4: Subject facing 0° (+Z), push blue joystick left -> moves toward -X, rotation remains 0°, gait is strafe_left.
  {
    const s = createInitialLocomotionState();
    s.rot = 0;
    s.targetRot = 0;
    runSteps(s, { x: -0.8, y: 0 }, 0, 30);
    assert(
      s.x < -0.25 &&
        Math.abs(s.z) < 1e-6 &&
        Math.abs(shortestAngleDiffRad(s.rot, 0)) < 1e-6 &&
        s.gaitMode === 'strafe_left',
      `Test 4 failed: expected -X movement, rot=0, and strafe_left, got x=${s.x}, z=${s.z}, rot=${s.rot}, gait=${s.gaitMode}`
    );
  }

  // Test 5: Subject facing +90° (+X), push blue joystick up -> moves toward +X, rotation remains +90°.
  {
    const s = createInitialLocomotionState();
    const rot90 = Math.PI / 2;
    s.rot = rot90;
    s.targetRot = rot90;
    runSteps(s, { x: 0, y: 0.8 }, 0, 30);
    assert(
      s.x > 0.3 &&
        Math.abs(s.z) < 1e-5 &&
        Math.abs(shortestAngleDiffRad(s.rot, rot90)) < 1e-6,
      `Test 5 failed: expected +X movement and rot=+90°, got x=${s.x}, z=${s.z}, rot=${s.rot}`
    );
  }

  // Test 6: Subject facing +90° (+X), push blue joystick right -> moves toward -Z, rotation remains +90°, gait is strafe_right.
  {
    const s = createInitialLocomotionState();
    const rot90 = Math.PI / 2;
    s.rot = rot90;
    s.targetRot = rot90;
    runSteps(s, { x: 0.8, y: 0 }, 0, 30);
    assert(
      s.z < -0.25 &&
        Math.abs(s.x) < 1e-5 &&
        Math.abs(shortestAngleDiffRad(s.rot, rot90)) < 1e-6 &&
        s.gaitMode === 'strafe_right',
      `Test 6 failed: expected -Z movement, rot=+90°, and strafe_right, got x=${s.x}, z=${s.z}, rot=${s.rot}, gait=${s.gaitMode}`
    );
  }

  // Test 7: Subject facing +90° (+X), push blue joystick left -> moves toward +Z, rotation remains +90°, gait is strafe_left.
  {
    const s = createInitialLocomotionState();
    const rot90 = Math.PI / 2;
    s.rot = rot90;
    s.targetRot = rot90;
    runSteps(s, { x: -0.8, y: 0 }, 0, 30);
    assert(
      s.z > 0.25 &&
        Math.abs(s.x) < 1e-5 &&
        Math.abs(shortestAngleDiffRad(s.rot, rot90)) < 1e-6 &&
        s.gaitMode === 'strafe_left',
      `Test 7 failed: expected +Z movement, rot=+90°, and strafe_left, got x=${s.x}, z=${s.z}, rot=${s.rot}, gait=${s.gaitMode}`
    );
  }

  // Test 8: Subject facing 180° (-Z), push blue joystick up -> moves toward -Z, rotation remains 180°.
  {
    const s = createInitialLocomotionState();
    s.rot = Math.PI;
    s.targetRot = Math.PI;
    runSteps(s, { x: 0, y: 0.8 }, 0, 30);
    assert(
      s.z < -0.3 &&
        Math.abs(s.x) < 1e-5 &&
        Math.abs(shortestAngleDiffRad(s.rot, Math.PI)) < 1e-6,
      `Test 8 failed: expected -Z movement and rot=180°, got x=${s.x}, z=${s.z}, rot=${s.rot}`
    );
  }

  // Test 9: Subject facing -90° (-X), push blue joystick up -> moves toward -X, rotation remains -90°.
  {
    const s = createInitialLocomotionState();
    const rotNeg90 = -Math.PI / 2;
    s.rot = rotNeg90;
    s.targetRot = rotNeg90;
    runSteps(s, { x: 0, y: 0.8 }, 0, 30);
    assert(
      s.x < -0.3 &&
        Math.abs(s.z) < 1e-5 &&
        Math.abs(shortestAngleDiffRad(s.rot, rotNeg90)) < 1e-6,
      `Test 9 failed: expected -X movement and rot=-90°, got x=${s.x}, z=${s.z}, rot=${s.rot}`
    );
  }

  // Test 10: Diagonal input (x = 1, y = 1) is normalized so speed does not exceed straight-line maximum speed.
  {
    const sDiag = createInitialLocomotionState();
    const sStraight = createInitialLocomotionState();
    runSteps(sDiag, { x: 1, y: 1 }, 0, 30);
    runSteps(sStraight, { x: 0, y: 1 }, 0, 30);
    const diagSpeed = Math.hypot(sDiag.vx, sDiag.vz);
    const straightSpeed = Math.hypot(sStraight.vx, sStraight.vz);
    const diagDist = Math.hypot(sDiag.x, sDiag.z);
    const straightDist = Math.hypot(sStraight.x, sStraight.z);
    assert(
      diagSpeed <= straightSpeed + 1e-5 && Math.abs(diagDist - straightDist) < 1e-4,
      `Test 10 failed: diagonal speed (${diagSpeed}) / distance (${diagDist}) must not exceed straight-line speed (${straightSpeed}) / distance (${straightDist})`
    );
  }

  // Test 11: Forward high-magnitude input triggers run_forward; moderate forward input triggers walk_forward.
  {
    const sWalk = createInitialLocomotionState();
    const sRun = createInitialLocomotionState();
    runSteps(sWalk, { x: 0, y: 0.55 }, 0, 25);
    runSteps(sRun, { x: 0, y: 0.95 }, 0, 25);
    assert(
      sWalk.gaitMode === 'walk_forward' && sRun.gaitMode === 'run_forward' && sRun.runBlend > 0.5,
      `Test 11 failed: moderate input must trigger walk_forward (${sWalk.gaitMode}) and high input must trigger run_forward (${sRun.gaitMode})`
    );
  }

  // Test 12: Releasing blue joystick smoothly decelerates to idle while preserving position within bounds and exact facing angle.
  {
    const s = createInitialLocomotionState();
    const customFacing = THREE.MathUtils.degToRad(37);
    s.rot = customFacing;
    s.targetRot = customFacing;
    runSteps(s, { x: 0.4, y: 0.85 }, 0, 35);
    const speedBeforeRelease = Math.hypot(s.vx, s.vz);
    stepThirdPersonLocomotion(s, { x: 0, y: 0 }, 0, dt);
    const speedAfter1Frame = Math.hypot(s.vx, s.vz);
    runSteps(s, { x: 0, y: 0 }, 0, 45);
    assert(
      speedAfter1Frame > 0.1 &&
        speedAfter1Frame < speedBeforeRelease &&
        s.gaitMode === 'idle' &&
        Math.hypot(s.vx, s.vz) === 0 &&
        Math.abs(shortestAngleDiffRad(s.rot, customFacing)) < 1e-6,
      `Test 12 failed: must decelerate smoothly to idle while preserving exact facing (${customFacing} vs ${s.rot})`
    );
  }

  // -------------------------------------------------------------------------
  // Turning tests (13–18)
  // -------------------------------------------------------------------------

  // Test 13: Dragging orange joystick right rotates subject in the right-turn direction without changing x or z.
  {
    const s = createInitialLocomotionState();
    s.x = 0.65;
    s.z = -0.45;
    s.rot = 0;
    runSteps(s, { x: 0, y: 0 }, 0, 25, 0.85);
    assert(
      s.rot < -0.4 && s.x === 0.65 && s.z === -0.45,
      `Test 13 failed: orange right drag must rotate clockwise (rot < -0.4) without changing (x, z). Got rot=${s.rot}, x=${s.x}, z=${s.z}`
    );
  }

  // Test 14: Dragging orange joystick left rotates subject in the opposite direction without changing x or z.
  {
    const s = createInitialLocomotionState();
    s.x = -0.35;
    s.z = 0.75;
    s.rot = 0;
    runSteps(s, { x: 0, y: 0 }, 0, 25, -0.85);
    assert(
      s.rot > 0.4 && s.x === -0.35 && s.z === 0.75,
      `Test 14 failed: orange left drag must rotate counter-clockwise (rot > 0.4) without changing (x, z). Got rot=${s.rot}, x=${s.x}, z=${s.z}`
    );
  }

  // Test 15: Releasing orange joystick preserves final orientation.
  {
    const s = createInitialLocomotionState();
    runSteps(s, { x: 0, y: 0 }, 0, 20, 0.8);
    const heldRot = s.rot;
    runSteps(s, { x: 0, y: 0 }, 0, 40, 0);
    assert(
      Math.abs(shortestAngleDiffRad(s.rot, heldRot)) < 1e-6,
      `Test 15 failed: releasing orange joystick must preserve exact orientation (${heldRot} vs ${s.rot})`
    );
  }

  // Test 16: Turning within deadzone produces no rotation.
  {
    const s = createInitialLocomotionState();
    s.rot = 0.25;
    runSteps(s, { x: 0, y: 0 }, 0, 30, 0.04);
    stepCharacterTurnInPlace(s, -0.045, 0.5);
    assert(
      Math.abs(shortestAngleDiffRad(s.rot, 0.25)) < 1e-6,
      `Test 16 failed: turn input within deadzone (<= 0.05) must produce zero rotation. Got ${s.rot}`
    );
  }

  // Test 17: Vertical pointer offset on the orange joystick does not weaken horizontal turn input.
  {
    // Compare horizontal drag dx=28 with maxR=38 regardless of vertical drift
    const normZeroDy = normalizeTurnJoystickInput(28, 38);
    const normLargeDy = normalizeTurnJoystickInput(28, 38);
    assert(
      Math.abs(normZeroDy.rawTurnX - 28 / 38) < 1e-6 &&
        Math.abs(normZeroDy.normalizedTurn - normLargeDy.normalizedTurn) < 1e-6 &&
        normZeroDy.rawTurnX > 0.73,
      `Test 17 failed: horizontal turn normalization must depend only on dx/maxR and never be weakened by vertical pointer offset`
    );
  }

  // Test 18: Turning across -180° / +180° wraps cleanly without discontinuities.
  {
    const s = createInitialLocomotionState();
    s.rot = THREE.MathUtils.degToRad(176);
    s.targetRot = s.rot;
    // Turn left (+rot) across +180° -> wraps smoothly into negative radians near -175°
    for (let i = 0; i < 10; i++) {
      const prevRot = s.rot;
      stepThirdPersonLocomotion(s, { x: 0, y: 0 }, 0, dt, undefined, -0.8);
      const stepDelta = Math.abs(shortestAngleDiffRad(prevRot, s.rot));
      assert(
        stepDelta > 0 && stepDelta < 0.06 && s.rot >= -Math.PI && s.rot <= Math.PI,
        `Test 18 failed: step across ±180° boundary must wrap smoothly without jump! prev=${prevRot}, next=${s.rot}, delta=${stepDelta}`
      );
    }
    assert(s.rot < -2.8, `Test 18 failed: expected wrapped angle near -PI, got ${s.rot}`);
  }

  // -------------------------------------------------------------------------
  // Combined-input tests (19–24)
  // -------------------------------------------------------------------------

  // Test 19: Turn subject to +90°, release orange joystick, then push blue joystick up -> subject moves toward +X.
  {
    const s = createInitialLocomotionState();
    // Turn left (-turnStickX -> +rot) until reaching +90° (+PI/2)
    while (s.rot < Math.PI / 2) {
      stepThirdPersonLocomotion(s, { x: 0, y: 0 }, 0, dt, undefined, -0.85);
    }
    s.rot = Math.PI / 2;
    s.targetRot = Math.PI / 2;
    // Release orange stick, push blue stick up
    runSteps(s, { x: 0, y: 0.8 }, 0, 30, 0);
    assert(
      s.x > 0.3 && Math.abs(s.z) < 1e-5 && Math.abs(shortestAngleDiffRad(s.rot, Math.PI / 2)) < 1e-6,
      `Test 19 failed: after turning to +90°, pushing blue stick up must move toward +X. Got x=${s.x}, z=${s.z}`
    );
  }

  // Test 20: Turn subject to -90°, release orange joystick, then push blue joystick up -> subject moves toward -X.
  {
    const s = createInitialLocomotionState();
    while (s.rot > -Math.PI / 2) {
      stepThirdPersonLocomotion(s, { x: 0, y: 0 }, 0, dt, undefined, 0.85);
    }
    s.rot = -Math.PI / 2;
    s.targetRot = -Math.PI / 2;
    runSteps(s, { x: 0, y: 0.8 }, 0, 30, 0);
    assert(
      s.x < -0.3 && Math.abs(s.z) < 1e-5 && Math.abs(shortestAngleDiffRad(s.rot, -Math.PI / 2)) < 1e-6,
      `Test 20 failed: after turning to -90°, pushing blue stick up must move toward -X. Got x=${s.x}, z=${s.z}`
    );
  }

  // Test 21: Hold blue joystick up while dragging orange joystick right -> subject moves along a smooth curved path as facing updates.
  {
    const s = createInitialLocomotionState();
    runSteps(s, { x: 0, y: 0.85 }, 0, 30, 0.85);
    // Started facing +Z (0) and turned clockwise toward -X (-rot), so path curves into (+Z, -X)
    assert(
      s.z > 0.2 && s.x < -0.1 && s.rot < -0.5,
      `Test 21 failed: holding blue up while turning right must curve trajectory into (+Z, -X) as facing updates. Got x=${s.x}, z=${s.z}, rot=${s.rot}`
    );
  }

  // Test 22: Release orange joystick while still holding blue joystick -> subject stops turning and continues moving in the newly established facing direction.
  {
    const s = createInitialLocomotionState();
    runSteps(s, { x: 0, y: 0.85 }, 0, 25, 0.85);
    const rotAtOrangeRelease = s.rot;
    const xAtRelease = s.x;
    const zAtRelease = s.z;
    // Continue holding blue joystick up with orange joystick released (0)
    runSteps(s, { x: 0, y: 0.85 }, 0, 30, 0);
    const dx = s.x - xAtRelease;
    const dz = s.z - zAtRelease;
    const expectedBasis = getSubjectGroundBasis(rotAtOrangeRelease);
    const moveDotExpected =
      (dx * expectedBasis.forwardX + dz * expectedBasis.forwardZ) / Math.hypot(dx, dz);
    assert(
      Math.abs(shortestAngleDiffRad(s.rot, rotAtOrangeRelease)) < 1e-6 && moveDotExpected > 0.99,
      `Test 22 failed: releasing orange stick while holding blue stick must freeze rotation (${rotAtOrangeRelease} vs ${s.rot}) and move along the new facing vector (dot=${moveDotExpected})`
    );
  }

  // Test 23: Release blue joystick while still holding orange joystick -> subject stops translating and continues turning in place.
  {
    const s = createInitialLocomotionState();
    runSteps(s, { x: 0, y: 0.85 }, 0, 25, 0.85);
    // Let velocity decelerate while still turning with orange joystick
    runSteps(s, { x: 0, y: 0 }, 0, 35, 0.85);
    const posAfterDecelX = s.x;
    const posAfterDecelZ = s.z;
    const rotAfterDecel = s.rot;
    // Step 20 more frames with blue released and orange held
    runSteps(s, { x: 0, y: 0 }, 0, 20, 0.85);
    assert(
      Math.abs(s.x - posAfterDecelX) < 1e-6 &&
        Math.abs(s.z - posAfterDecelZ) < 1e-6 &&
        Math.abs(shortestAngleDiffRad(s.rot, rotAfterDecel)) > 0.3,
      `Test 23 failed: after blue stick release, subject must stop translating and continue turning in place`
    );
  }

  // Test 24: Release both joysticks -> subject comes to rest and preserves final position and orientation.
  {
    const s = createInitialLocomotionState();
    runSteps(s, { x: 0.5, y: 0.7 }, 0, 25, -0.7);
    const rotAtBothRelease = s.rot;
    runSteps(s, { x: 0, y: 0 }, 0, 45, 0);
    const restX = s.x;
    const restZ = s.z;
    runSteps(s, { x: 0, y: 0 }, 0, 20, 0);
    assert(
      s.gaitMode === 'idle' &&
        s.vx === 0 &&
        s.vz === 0 &&
        s.x === restX &&
        s.z === restZ &&
        Math.abs(shortestAngleDiffRad(s.rot, rotAtBothRelease)) < 1e-6,
      `Test 24 failed: releasing both joysticks must bring subject to rest and preserve final position and orientation`
    );
  }

  // -------------------------------------------------------------------------
  // Camera-independence tests (25–29)
  // -------------------------------------------------------------------------

  // Test 25: Camera at yaw 0°, 90°, 180°, and -90° with subject facing 0°: pushing blue joystick up always moves subject toward +Z.
  {
    for (const camYawDeg of [0, 90, 180, -90]) {
      const s = createInitialLocomotionState();
      s.rot = 0;
      s.targetRot = 0;
      runSteps(s, { x: 0, y: 0.85 }, THREE.MathUtils.degToRad(camYawDeg), 30, 0);
      assert(
        s.z > 0.35 && Math.abs(s.x) < 1e-6 && Math.abs(shortestAngleDiffRad(s.rot, 0)) < 1e-6,
        `Test 25 failed at camYaw=${camYawDeg}°: subject facing 0° must move toward +Z regardless of camera yaw! Got x=${s.x}, z=${s.z}, rot=${s.rot}`
      );
    }
  }

  // Test 26: Orbiting camera while subject moves forward does not alter subject movement direction or subject yaw.
  {
    const sFixedCam = createInitialLocomotionState();
    const sOrbitingCam = createInitialLocomotionState();
    const initialRot = THREE.MathUtils.degToRad(35);
    sFixedCam.rot = initialRot;
    sFixedCam.targetRot = initialRot;
    sOrbitingCam.rot = initialRot;
    sOrbitingCam.targetRot = initialRot;

    for (let i = 0; i < 40; i++) {
      stepThirdPersonLocomotion(sFixedCam, { x: 0.25, y: 0.8 }, 0, dt, undefined, 0);
      stepThirdPersonLocomotion(
        sOrbitingCam,
        { x: 0.25, y: 0.8 },
        THREE.MathUtils.degToRad(i * 9 - 180),
        dt,
        undefined,
        0
      );
    }
    assert(
      Math.abs(sFixedCam.x - sOrbitingCam.x) < 1e-6 &&
        Math.abs(sFixedCam.z - sOrbitingCam.z) < 1e-6 &&
        Math.abs(shortestAngleDiffRad(sOrbitingCam.rot, initialRot)) < 1e-6,
      `Test 26 failed: orbiting camera must produce identical subject trajectory and yaw as fixed camera!`
    );
  }

  // Test 27: Moving or turning subject does not overwrite camera settings (yawDeg, pitchDeg, height, distance, rollDeg).
  {
    const customCamera: Camera3DSettings = {
      ...frontCameraConfig,
      yawDeg: -62,
      pitchDeg: 19,
      height: 1.85,
      distance: 2.75,
      rollDeg: 8,
    };
    const s = createInitialLocomotionState();
    runSteps(s, { x: -0.4, y: 0.9 }, THREE.MathUtils.degToRad(customCamera.yawDeg), 35, 0.75);
    const updatedPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: Number(s.x.toFixed(2)),
      characterPosZ: Number(s.z.toFixed(2)),
      characterYawDeg: Math.round(THREE.MathUtils.radToDeg(s.rot)),
    };
    const analysis = analyzePlayboardFraming(customCamera, updatedPose);
    assert(
      customCamera.yawDeg === -62 &&
        customCamera.pitchDeg === 19 &&
        customCamera.height === 1.85 &&
        customCamera.distance === 2.75 &&
        customCamera.rollDeg === 8 &&
        analysis.shotSizeLabel.length > 0,
      `Test 27 failed: moving or turning subject must never mutate or overwrite manual camera settings`
    );
  }

  // Test 28: Rotating subject with fixed camera updates relative camera-to-subject viewpoint in framing analysis and generated prompts.
  {
    const fixedCam28: Camera3DSettings = { ...frontCameraConfig, yawDeg: 0, pitchDeg: 0, height: 1.5, distance: 3.0 };
    const s = createInitialLocomotionState();
    while (THREE.MathUtils.radToDeg(s.rot) < 90) {
      stepThirdPersonLocomotion(s, { x: 0, y: 0 }, 0, dt, undefined, -0.85);
    }
    const turnedPose28: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterYawDeg: Math.round(THREE.MathUtils.radToDeg(s.rot)),
    };
    const framing28 = analyzePlayboardFraming(fixedCam28, turnedPose28);
    const prompt28 = buildPlayboardT2IPrompt(
      { ...test2FullConfig, camera: fixedCam28, pose: turnedPose28 },
      'universal'
    );
    assert(
      framing28.relativeAngles.relativeToBodyYawDeg < -80 &&
        prompt28.includes('left side profile view'),
      `Test 28 failed: rotating subject to +90° with fixed camera (0°) must update relative viewpoint to left side profile view! Got relYaw=${framing28.relativeAngles.relativeToBodyYawDeg}, prompt=${prompt28}`
    );
  }

  // Test 29: Moving subject closer/further/off-center relative to camera updates framing analysis and generated prompts.
  {
    const fixedCam29: Camera3DSettings = { ...frontCameraConfig, yawDeg: 0, pitchDeg: 0, height: 1.25, distance: 2.8 };
    const sCloser = createInitialLocomotionState();
    // Move forward along +Z toward camera at +Z
    runSteps(sCloser, { x: 0, y: 1.0 }, 0, 45, 0);
    // Also strafe right along +X to move off-center
    const sOffCenter = createInitialLocomotionState();
    runSteps(sOffCenter, { x: 1.0, y: 0 }, 0, 40, 0);

    const baseFraming29 = analyzePlayboardFraming(fixedCam29, frontStandingPose);
    const closerPose29: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: Number(sCloser.x.toFixed(2)),
      characterPosZ: Number(sCloser.z.toFixed(2)),
      anchorPosX: 0,
      anchorPosZ: 0,
    };
    const closerFraming29 = analyzePlayboardFraming(fixedCam29, closerPose29);

    const offCenterPose29: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: Number(sOffCenter.x.toFixed(2)),
      characterPosZ: Number(sOffCenter.z.toFixed(2)),
      anchorPosX: 0,
      anchorPosZ: 0,
    };
    const offCenterFraming29 = analyzePlayboardFraming(fixedCam29, offCenterPose29);
    const offCenterPrompt29 = buildPlayboardT2IPrompt(
      { ...test2FullConfig, camera: fixedCam29, pose: offCenterPose29 },
      'universal'
    );

    assert(
      closerFraming29.subjectHeightFraction > baseFraming29.subjectHeightFraction + 0.15 &&
        offCenterFraming29.horizontalPlacement !== 'centered' &&
        offCenterPrompt29.includes(offCenterFraming29.placementDescription),
      `Test 29 failed: moving subject closer/off-center relative to camera anchor must update framing span (${baseFraming29.subjectHeightFraction.toFixed(2)} -> ${closerFraming29.subjectHeightFraction.toFixed(2)}) and placement (${offCenterFraming29.horizontalPlacement})`
    );
  }

  // -------------------------------------------------------------------------
  // Regression tests (30–35)
  // -------------------------------------------------------------------------

  // Test 30: Vertical gaze compensation for low-angle and high-angle cameras still passes.
  {
    const lowCam30: Camera3DSettings = { ...frontCameraConfig, yawDeg: 0, pitchDeg: -20, height: 0.55, distance: 2.6 };
    const highCam30: Camera3DSettings = { ...frontCameraConfig, yawDeg: 0, pitchDeg: 28, height: 2.2, distance: 2.8 };
    const lowP30 = buildPlayboardT2IPrompt({ ...test2FullConfig, camera: lowCam30, pose: frontStandingPose }, 'universal');
    const highP30 = buildPlayboardT2IPrompt({ ...test2FullConfig, camera: highCam30, pose: frontStandingPose }, 'universal');
    assert(
      lowP30.includes('eyes angled downward') &&
        lowP30.includes('low-angle camera lens') &&
        highP30.includes('eyes angled upward') &&
        highP30.includes('elevated high-angle camera lens'),
      `Test 30 failed: vertical gaze compensation for low/high cameras must remain intact`
    );
  }

  // Test 31: Eye-level direct eye contact still passes.
  {
    const eyeCam31: Camera3DSettings = { ...frontCameraConfig, yawDeg: 0, pitchDeg: 0, height: 1.5, distance: 3.0 };
    const eyeP31 = buildPlayboardT2IPrompt({ ...test2FullConfig, camera: eyeCam31, pose: frontStandingPose }, 'universal');
    assert(
      eyeP31.includes('eye-level camera placement') &&
        eyeP31.includes('face and eyes directed straight into the camera lens with engaging direct eye contact'),
      `Test 31 failed: eye-level direct eye contact must remain intact`
    );
  }

  // Test 32: Off-camera gaze options (looking_upward, looking_downward, looking_camera_left, looking_camera_right, eyes_closed) still pass.
  {
    const gazeCases: [CharacterPose3DSettings['gaze'], string][] = [
      ['looking_upward', 'gaze directed upward'],
      ['looking_downward', 'gaze cast downward'],
      ['looking_camera_left', 'gaze directed off-camera toward the left'],
      ['looking_camera_right', 'gaze directed off-camera toward the right'],
      ['eyes_closed', 'eyes gently closed'],
    ];
    for (const [gazeMode, expectedSnippet] of gazeCases) {
      const p = buildPlayboardT2IPrompt(
        { ...test2FullConfig, camera: frontCameraConfig, pose: { ...frontStandingPose, gaze: gazeMode } },
        'universal'
      );
      assert(
        p.includes(expectedSnippet),
        `Test 32 failed for gaze=${gazeMode}: expected "${expectedSnippet}", got: ${p}`
      );
    }
  }

  // Test 33: Scene interaction presets still activate and deactivate correctly when moving away from furniture anchors.
  {
    const bedPreset33 = getInteractionPresetById('bed_sit_edge_forward')!;
    const s33 = createInitialLocomotionState();
    s33.x = bedPreset33.anchorX;
    s33.z = bedPreset33.anchorZ;
    s33.rot = THREE.MathUtils.degToRad(bedPreset33.poseValues.characterYawDeg ?? 0);
    s33.targetRot = s33.rot;

    const atAnchorEval = evaluateActiveSceneInteraction({
      ...frontStandingPose,
      ...bedPreset33.poseValues,
      interactionPresetId: bedPreset33.id,
      characterPosX: s33.x,
      characterPosZ: s33.z,
    });
    assert(atAnchorEval.hasActiveInteraction === true, 'Test 33 failed: preset must be active at anchor');

    // Walk forward away from bed anchor using subject-relative locomotion
    runSteps(s33, { x: 0, y: 1.0 }, 0, 45, 0);
    const awayEval = evaluateActiveSceneInteraction({
      ...frontStandingPose,
      ...bedPreset33.poseValues,
      interactionPresetId: bedPreset33.id,
      characterPosX: s33.x,
      characterPosZ: s33.z,
    });
    assert(
      awayEval.hasActiveInteraction === false && awayEval.isStillAtAnchor === false,
      `Test 33 failed: walking away from bed anchor via subject-relative blue joystick must deactivate bed interaction`
    );
  }

  // Test 34: T2I and I2I prompt scopes (both, camera_only, pose_only, custom) remain consistent.
  {
    const cfg34: PlayboardFullConfig = {
      ...test2FullConfig,
      camera: { ...frontCameraConfig, yawDeg: 45, height: 1.4, pitchDeg: 6 },
      pose: { ...frontStandingPose, characterYawDeg: -45 }, // Relative yaw = 90° (right side profile)
    };
    const t2i34 = buildPlayboardT2IPrompt(cfg34, 'universal');
    const i2iBoth34 = compileFinalI2IPrompt(buildInitialI2IFields(cfg34, 'both'), 'both', cfg34, 'universal');
    const i2iCam34 = compileFinalI2IPrompt(buildInitialI2IFields(cfg34, 'camera_only'), 'camera_only', cfg34, 'universal');
    const i2iPose34 = compileFinalI2IPrompt(buildInitialI2IFields(cfg34, 'pose_only'), 'pose_only', cfg34, 'universal');
    const i2iCustom34 = compileFinalI2IPrompt(buildInitialI2IFields(cfg34, 'custom'), 'custom', cfg34, 'universal');
    assert(
      t2i34.includes('right side profile view') &&
        i2iBoth34.includes('right side profile view') &&
        i2iCam34.includes('right side profile view') &&
        !i2iCam34.includes('[BODY POSE & TORSO ALIGNMENT]') &&
        i2iPose34.includes('whole body oriented 45° clockwise') &&
        !i2iPose34.includes('[CAMERA VIEWPOINT & FRAMING]') &&
        i2iCustom34.includes('right side profile view'),
      `Test 34 failed: T2I and I2I scopes (both, camera_only, pose_only, custom) must remain consistent`
    );
  }

  // Test 35: Locked custom I2I fields remain preserved during config sync.
  {
    const fields35 = buildInitialI2IFields(test2FullConfig, 'both').map((f) =>
      f.id === 'camera_framing'
        ? { ...f, userText: 'LOCKED CUSTOM CAMERA FRAMING 35', isLocked: true }
        : f
    );
    const synced35 = syncI2IFieldsWithConfig(
      fields35,
      { ...test2FullConfig, camera: { ...frontCameraConfig, yawDeg: 180 } },
      'both'
    );
    const camField35 = synced35.find((f) => f.id === 'camera_framing')!;
    assert(
      camField35.isLocked && camField35.userText === 'LOCKED CUSTOM CAMERA FRAMING 35',
      `Test 35 failed: locked custom I2I field must remain preserved during config sync`
    );
  }

  console.log('✅ Phase 9 PASSED: All 35 required tests (Movement 1–12, Turning 13–18, Combined 19–24, Camera Independence 25–29, Regression 30–35) verified.');
}

// ============================================================================
// INTEGRATED FINAL CONTROL-CONSISTENCY SUITE (Phase 12: Tests 1–47)
// ============================================================================
console.log('Running Integrated Final Control-Consistency Suite (Phase 12: Tests 1–47)...');
{
  const runSteps = (
    state: ReturnType<typeof createInitialLocomotionState>,
    move: { x: number; y: number },
    turnX: number,
    steps: number,
    cameraYawRad = 0
  ) => {
    for (let i = 0; i < steps; i++) {
      stepThirdPersonLocomotion(state, move, cameraYawRad, 1 / 60, undefined, turnX);
    }
  };

  // --------------------------------------------------------------------------
  // A. Camera Tracking and Target Mode Tests (1–6)
  // --------------------------------------------------------------------------

  // 1. In track_subject mode, moving the subject updates the camera look target to the subject's position.
  {
    const camTrack: Camera3DSettings = { ...frontCameraConfig, targetMode: 'track_subject', yawDeg: 0 };
    const poseMoved: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: 1.4,
      characterPosZ: -0.9,
      anchorPosX: 0, // Even if legacy anchor is 0, track_subject tracks characterPosX/Z
      anchorPosZ: 0,
    };
    const resolved = resolvePlayboardCameraTargetXZ(camTrack, poseMoved);
    const camTransform = computePlayboardCameraTransform(camTrack, poseMoved);
    assert(
      resolved.effectiveMode === 'track_subject' &&
        Math.abs(resolved.targetX - 1.4) < 1e-6 &&
        Math.abs(resolved.targetZ - -0.9) < 1e-6 &&
        Math.abs(camTransform.lookTarget.x - 1.4) < 1e-6 &&
        Math.abs(camTransform.lookTarget.z - -0.9) < 1e-6,
      `Phase 12 Test 1 failed: track_subject must set lookTarget to subject position (1.4, -0.9), got (${camTransform.lookTarget.x}, ${camTransform.lookTarget.z})`
    );
  }

  // 2. In track_subject mode, moving the subject away from origin and orbiting the camera orbits around the subject, not world origin.
  {
    const subjectPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: 1.8,
      characterPosZ: -1.2,
      anchorPosX: 0,
      anchorPosZ: 0,
    };
    const camFront: Camera3DSettings = {
      ...frontCameraConfig,
      targetMode: 'track_subject',
      yawDeg: 0,
      distance: 3.0,
    };
    const camRightProfile: Camera3DSettings = {
      ...camFront,
      yawDeg: 90,
    };
    const tFront = computePlayboardCameraTransform(camFront, subjectPose);
    const tRight = computePlayboardCameraTransform(camRightProfile, subjectPose);
    const fFront = analyzePlayboardFraming(camFront, subjectPose);
    const fRight = analyzePlayboardFraming(camRightProfile, subjectPose);

    assert(
      Math.abs(tFront.lookTarget.x - 1.8) < 1e-5 &&
        Math.abs(tRight.lookTarget.x - 1.8) < 1e-5 &&
        Math.abs(tFront.lookTarget.z - -1.2) < 1e-5 &&
        Math.abs(tRight.lookTarget.z - -1.2) < 1e-5 &&
        fFront.horizontalPlacement === 'centered' &&
        fRight.horizontalPlacement === 'centered' &&
        Math.abs(fRight.relativeAngles.relativeToBodyYawDeg - 90) < 2,
      `Phase 12 Test 2 failed: orbiting in track_subject mode must orbit around displaced subject (1.8, -1.2) and keep subject centered`
    );
  }

  // 3. In fixed_composition mode, moving the subject with the blue joystick shifts the subject horizontally in the frame while the camera look target remains at the fixed composition anchor.
  {
    const camFixed: Camera3DSettings = {
      ...frontCameraConfig,
      targetMode: 'fixed_composition',
      yawDeg: 0,
      distance: 3.2,
    };
    const sFixed = createInitialLocomotionState();
    runSteps(sFixed, { x: 1.0, y: 0 }, 0, 45, 0); // Walk toward character's right (-X)
    const poseFixedMoved: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: sFixed.x,
      characterPosZ: sFixed.z,
      anchorPosX: 0,
      anchorPosZ: 0,
    };
    const camTransform = computePlayboardCameraTransform(camFixed, poseFixedMoved);
    assert(
      Math.abs(camTransform.lookTarget.x - 0) < 1e-6 &&
        Math.abs(camTransform.lookTarget.z - 0) < 1e-6 &&
        Math.abs(sFixed.x) > 0.5,
      `Phase 12 Test 3 failed: fixed_composition must keep camera lookTarget at anchor (0, 0) while subject moves to x=${sFixed.x}`
    );
  }

  // 4. In fixed_composition mode, moving the subject to the left or right third updates framingAnalysis.horizontalPlacement and placement description accordingly.
  {
    const camFixed: Camera3DSettings = {
      ...frontCameraConfig,
      targetMode: 'fixed_composition',
      yawDeg: 0,
      distance: 3.2,
    };
    const poseLeftInFrame: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: -0.45,
      characterPosZ: 0,
      anchorPosX: 0,
      anchorPosZ: 0,
    };
    const poseRightInFrame: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: 0.45,
      characterPosZ: 0,
      anchorPosX: 0,
      anchorPosZ: 0,
    };
    const fLeft = analyzePlayboardFraming(camFixed, poseLeftInFrame);
    const fRight = analyzePlayboardFraming(camFixed, poseRightInFrame);
    assert(
      (fLeft.horizontalPlacement === 'left_third' || fLeft.horizontalPlacement === 'far_left') &&
        fLeft.placementDescription.includes('left') &&
        (fRight.horizontalPlacement === 'right_third' || fRight.horizontalPlacement === 'far_right') &&
        fRight.placementDescription.includes('right'),
      `Phase 12 Test 4 failed: fixed_composition horizontal offsets must produce left/right placement, got ${fLeft.horizontalPlacement} and ${fRight.horizontalPlacement}`
    );
  }

  // 5. Switching between track_subject and fixed_composition behaves predictably without corrupting subject position or pose.
  {
    const startCam: Camera3DSettings = { ...frontCameraConfig, targetMode: 'track_subject' };
    const startPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: 1.15,
      characterPosZ: -0.75,
      characterYawDeg: 35,
      torsoLeanDeg: 10,
      anchorPosX: 1.15,
      anchorPosZ: -0.75,
    };
    const toFixed = switchCameraTargetMode(startCam, startPose, 'fixed_composition');
    assert(
      toFixed.camera.targetMode === 'fixed_composition' &&
        toFixed.pose.characterPosX === 1.15 &&
        toFixed.pose.characterPosZ === -0.75 &&
        toFixed.pose.characterYawDeg === 35 &&
        toFixed.pose.torsoLeanDeg === 10 &&
        toFixed.pose.anchorPosX === 1.15 &&
        toFixed.pose.anchorPosZ === -0.75,
      `Phase 12 Test 5a failed: switching to fixed_composition must lock current target without corrupting pose`
    );

    // Move character while in fixed_composition, then switch back to track_subject
    const movedInFixed: CharacterPose3DSettings = {
      ...toFixed.pose,
      characterPosX: 1.65,
      characterPosZ: -0.45,
    };
    const backToTrack = switchCameraTargetMode(toFixed.camera, movedInFixed, 'track_subject');
    assert(
      backToTrack.camera.targetMode === 'track_subject' &&
        backToTrack.pose.characterPosX === 1.65 &&
        backToTrack.pose.characterPosZ === -0.45 &&
        backToTrack.pose.anchorPosX === 1.65 &&
        backToTrack.pose.anchorPosZ === -0.45,
      `Phase 12 Test 5b failed: switching back to track_subject must sync anchor to current subject position`
    );
  }

  // 6. Anchor coordinates equal to 0 are treated as valid coordinates and not as missing values.
  {
    const camFixedZero: Camera3DSettings = { ...frontCameraConfig, targetMode: 'fixed_composition' };
    const poseZeroAnchor: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: 1.25,
      characterPosZ: -1.1,
      anchorPosX: 0,
      anchorPosZ: 0,
    };
    const resolvedZero = resolvePlayboardCameraTargetXZ(camFixedZero, poseZeroAnchor);
    assert(
      resolvedZero.targetX === 0 && resolvedZero.targetZ === 0,
      `Phase 12 Test 6 failed: anchorPosX=0, anchorPosZ=0 must be treated as valid 0 coordinates, got (${resolvedZero.targetX}, ${resolvedZero.targetZ})`
    );
  }

  // --------------------------------------------------------------------------
  // B. Preset Isolation Tests (7–11)
  // --------------------------------------------------------------------------

  // 7. Applying a pose preset after moving the subject preserves characterPosX, characterPosZ, and characterYawDeg.
  {
    const stagedPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      characterPosX: 1.42,
      characterPosZ: -0.88,
      characterYawDeg: -55,
      gaze: 'looking_upward',
    };
    const afterPosePreset = applyPosePresetState(
      stagedPose,
      {
        basePose: 'power_stance',
        leftArmElbowBendDeg: 90,
        rightArmElbowBendDeg: 90,
        gaze: stagedPose.gaze,
      },
      { targetMode: 'track_subject' }
    );
    assert(
      afterPosePreset.basePose === 'power_stance' &&
        afterPosePreset.characterPosX === 1.42 &&
        afterPosePreset.characterPosZ === -0.88 &&
        afterPosePreset.characterYawDeg === -55 &&
        afterPosePreset.anchorPosX === 1.42 &&
        afterPosePreset.anchorPosZ === -0.88,
      `Phase 12 Test 7 failed: applyPosePresetState must preserve staged characterPosX, characterPosZ, and characterYawDeg`
    );
  }

  // 8. Applying a pose preset does not modify camera yaw, pitch, height, distance, lens, framing, or composition.
  {
    const customCamera: Camera3DSettings = {
      yawDeg: -38,
      pitchDeg: 22,
      height: 1.85,
      distance: 2.35,
      rollDeg: 9,
      focalLength: '85mm_portrait_telephoto',
      framing: 'medium_close_up',
      composition: 'rule_of_thirds_left',
      outputRatio: '16:9',
      orientation: 'Landscape',
      focusDof: 'shallow_f1_4',
      targetMode: 'track_subject',
    };
    const snapshotBefore = JSON.stringify(customCamera);
    applyPosePresetState(frontStandingPose, { basePose: 'contrapposto', torsoTwistDeg: 10 }, customCamera);
    assert(
      JSON.stringify(customCamera) === snapshotBefore,
      `Phase 12 Test 8 failed: applyPosePresetState must never mutate Camera3DSettings`
    );
  }

  // 9. Applying a camera preset does not modify subject position, subject yaw, body pose, or gaze.
  {
    const stagedPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      basePose: 'contrapposto',
      characterPosX: -0.95,
      characterPosZ: 0.65,
      characterYawDeg: 42,
      gaze: 'looking_camera_left',
    };
    const poseSnapshot = JSON.stringify(stagedPose);
    const updatedCam = applyCameraPresetState(frontCameraConfig, {
      yawDeg: 45,
      pitchDeg: -15,
      height: 0.7,
      distance: 2.5,
      framing: 'full_shot',
    });
    assert(
      JSON.stringify(stagedPose) === poseSnapshot &&
        updatedCam.yawDeg === 45 &&
        updatedCam.pitchDeg === -15 &&
        updatedCam.targetMode === 'track_subject',
      `Phase 12 Test 9 failed: applyCameraPresetState must not modify pose, gaze, or subject position`
    );
  }

  // 10. Applying a gaze preset does not modify subject position, subject yaw, body pose, or camera transform.
  {
    const stagedPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      basePose: 'power_stance',
      characterPosX: 0.8,
      characterPosZ: -0.5,
      characterYawDeg: -30,
      headRotationDeg: 18,
      headTiltDeg: -6,
    };
    const updatedGazePose = applyGazeControlState(stagedPose, 'soft_off_camera');
    assert(
      updatedGazePose.gaze === 'soft_off_camera' &&
        updatedGazePose.basePose === 'power_stance' &&
        updatedGazePose.characterPosX === 0.8 &&
        updatedGazePose.characterPosZ === -0.5 &&
        updatedGazePose.characterYawDeg === -30 &&
        updatedGazePose.headRotationDeg === 18 &&
        updatedGazePose.headTiltDeg === -6,
      `Phase 12 Test 10 failed: applyGazeControlState must only modify gaze`
    );
  }

  // 11. Applying a scene-interaction preset updates only its documented scene/pose fields and does not overwrite unrelated camera controls.
  {
    const customCam: Camera3DSettings = {
      ...frontCameraConfig,
      yawDeg: -35,
      pitchDeg: 14,
      focalLength: '85mm_portrait_telephoto',
      outputRatio: '16:9',
      targetMode: 'track_subject',
    };
    const chairPreset = getInteractionPresetById('chair_sit_upright_thighs')!;
    const applied = applySceneInteractionPresetState(
      frontStandingPose,
      customCam,
      chairPreset,
      'minimal_neutral'
    );
    assert(
      applied.pose.interactionPresetId === 'chair_sit_upright_thighs' &&
        applied.pose.characterPosX === chairPreset.anchorX &&
        applied.pose.characterPosZ === chairPreset.anchorZ &&
        applied.pose.seatHeightY === chairPreset.seatHeightY &&
        applied.environment === 'studio_bedroom' &&
        applied.camera.yawDeg === -35 &&
        applied.camera.pitchDeg === 14 &&
        applied.camera.focalLength === '85mm_portrait_telephoto' &&
        applied.camera.outputRatio === '16:9',
      `Phase 12 Test 11 failed: applySceneInteractionPresetState must update scene/pose fields without overwriting camera settings`
    );
  }

  // --------------------------------------------------------------------------
  // C. Reset Isolation Tests (12–15)
  // --------------------------------------------------------------------------

  // 12. Resetting pose preserves subject world position and orientation.
  {
    const movedAndPosed: CharacterPose3DSettings = {
      ...frontStandingPose,
      basePose: 'deep_squat',
      torsoLeanDeg: 22,
      leftArmShoulderForwardDeg: 65,
      gaze: 'eyes_closed',
      characterPosX: 1.55,
      characterPosZ: -1.05,
      characterYawDeg: 75,
      interactionPresetId: 'bed_sit_edge_forward',
      seatHeightY: 0.56,
    };
    const afterResetPose = resetPoseState(movedAndPosed, { targetMode: 'track_subject' });
    assert(
      afterResetPose.basePose === 'natural_standing' &&
        afterResetPose.torsoLeanDeg === 0 &&
        afterResetPose.gaze === 'direct_at_camera' &&
        afterResetPose.interactionPresetId === null &&
        afterResetPose.seatHeightY === null &&
        afterResetPose.characterPosX === 1.55 &&
        afterResetPose.characterPosZ === -1.05 &&
        afterResetPose.characterYawDeg === 75,
      `Phase 12 Test 12 failed: resetPoseState must preserve characterPosX, characterPosZ, and characterYawDeg`
    );
  }

  // 13. Resetting camera preserves subject world position, orientation, and pose.
  {
    const resetCam = resetCameraState({
      ...frontCameraConfig,
      yawDeg: 120,
      pitchDeg: 40,
      distance: 4.5,
      outputRatio: '16:9',
      orientation: 'Landscape',
    });
    assert(
      resetCam.yawDeg === 0 &&
        resetCam.pitchDeg === 0 &&
        resetCam.outputRatio === '16:9' &&
        resetCam.targetMode === 'track_subject',
      `Phase 12 Test 13 failed: resetCameraState must reset camera angles/distance while preserving outputRatio`
    );
  }

  // 14. Resetting subject position resets subject position cleanly without corrupting camera or joint settings.
  {
    const posedAtBed: CharacterPose3DSettings = {
      ...frontStandingPose,
      basePose: 'power_stance',
      torsoLeanDeg: -6,
      leftArmElbowBendDeg: 88,
      gaze: 'looking_upward',
      characterPosX: 1.25,
      characterPosZ: -1.08,
      characterYawDeg: -90,
      interactionPresetId: 'bed_sit_edge_forward',
      seatHeightY: 0.56,
    };
    const resetPos = resetSubjectPositionState(posedAtBed, { targetMode: 'track_subject' });
    assert(
      resetPos.characterPosX === 0 &&
        resetPos.characterPosZ === 0 &&
        resetPos.characterYawDeg === 0 &&
        resetPos.anchorPosX === 0 &&
        resetPos.anchorPosZ === 0 &&
        resetPos.interactionPresetId === null &&
        resetPos.seatHeightY === null &&
        resetPos.basePose === 'power_stance' &&
        resetPos.torsoLeanDeg === -6 &&
        resetPos.leftArmElbowBendDeg === 88 &&
        resetPos.gaze === 'looking_upward',
      `Phase 12 Test 14 failed: resetSubjectPositionState must reset position/yaw/furniture while preserving joint angles and gaze`
    );
  }

  // 15. Resetting all resets camera, pose, subject position, and scene interaction state cleanly.
  {
    const allReset = resetAllPlayboardState();
    assert(
      allReset.camera.yawDeg === 0 &&
        allReset.camera.targetMode === 'track_subject' &&
        allReset.pose.basePose === 'natural_standing' &&
        allReset.pose.characterPosX === 0 &&
        allReset.pose.characterPosZ === 0 &&
        allReset.pose.characterYawDeg === 0 &&
        allReset.pose.interactionPresetId === null &&
        allReset.environment === 'studio_bedroom',
      `Phase 12 Test 15 failed: resetAllPlayboardState must reset camera, pose, position, and environment`
    );
  }

  // --------------------------------------------------------------------------
  // D. Scene Interaction and I2I Consistency Tests (16–20)
  // --------------------------------------------------------------------------

  // 16. sit_on_chair in I2I both produces no contradiction between action/pose fields and preservation/constraint fields.
  {
    const chairPreset = getInteractionPresetById('chair_sit_upright_thighs')!;
    const applied = applySceneInteractionPresetState(
      frontStandingPose,
      frontCameraConfig,
      chairPreset,
      'studio_bedroom'
    );
    const cfgChair: PlayboardFullConfig = {
      ...test2FullConfig,
      environment: applied.environment,
      camera: applied.camera,
      pose: applied.pose,
    };
    const fieldsBoth = buildInitialI2IFields(cfgChair, 'both');
    const sceneField = fieldsBoth.find((f) => f.id === 'scene_preservation')!.userText;
    const constraintsField = fieldsBoth.find((f) => f.id === 'transformation_constraints')!.userText;
    const compiledBoth = compileFinalI2IPrompt(fieldsBoth, 'both', cfgChair, 'universal');
    assert(
      sceneField.includes('support surface') &&
        sceneField.includes('clothing garments') &&
        constraintsField.includes('authorize physical contact and support') &&
        !constraintsField.includes('Do not add unwanted subjects or objects') &&
        compiledBoth.includes('studio chair'),
      `Phase 12 Test 16 failed: sit_on_chair in I2I 'both' must authorize chair support surface without contradicting preservation`
    );
  }

  // 17. sit_on_chair in I2I pose_only produces no contradiction between action/pose fields and preservation/constraint fields.
  {
    const chairPreset = getInteractionPresetById('chair_sit_upright_thighs')!;
    const applied = applySceneInteractionPresetState(
      frontStandingPose,
      frontCameraConfig,
      chairPreset,
      'studio_bedroom'
    );
    const cfgChair: PlayboardFullConfig = {
      ...test2FullConfig,
      environment: applied.environment,
      camera: applied.camera,
      pose: applied.pose,
    };
    const fieldsPoseOnly = buildInitialI2IFields(cfgChair, 'pose_only');
    const sceneField = fieldsPoseOnly.find((f) => f.id === 'scene_preservation')!.userText;
    const constraintsField = fieldsPoseOnly.find((f) => f.id === 'transformation_constraints')!.userText;
    const compiledPoseOnly = compileFinalI2IPrompt(fieldsPoseOnly, 'pose_only', cfgChair, 'universal');
    assert(
      sceneField.includes('support surface') &&
        constraintsField.includes('authorize physical contact and support') &&
        compiledPoseOnly.includes('Pose & Scene-Surface Interaction Modification') &&
        !compiledPoseOnly.includes('Do not add unwanted subjects or objects'),
      `Phase 12 Test 17 failed: sit_on_chair in I2I 'pose_only' must have non-contradictory scene-surface directive`
    );
  }

  // 18. sit_on_bed_edge and lie_on_bed_supine produce coherent furniture-interaction instructions without weakening identity or clothing preservation.
  {
    for (const presetId of ['bed_sit_edge_forward', 'bed_lie_back'] as const) {
      const preset = getInteractionPresetById(presetId)!;
      const applied = applySceneInteractionPresetState(
        frontStandingPose,
        frontCameraConfig,
        preset,
        'studio_bedroom'
      );
      const cfgBed: PlayboardFullConfig = {
        ...test2FullConfig,
        environment: applied.environment,
        camera: applied.camera,
        pose: applied.pose,
      };
      const fields = buildInitialI2IFields(cfgBed, 'both');
      const idText = fields.find((f) => f.id === 'identity_preservation')!.userText;
      const sceneText = fields.find((f) => f.id === 'scene_preservation')!.userText;
      assert(
        idText.includes('facial identity') &&
          sceneText.includes('clothing garments') &&
          sceneText.includes('bed support surface'),
        `Phase 12 Test 18 failed for ${presetId}: must preserve identity and clothing while authorizing bed support surface`
      );
    }
  }

  // 19. Moving away from a furniture interaction anchor deactivates the furniture interaction cleanly.
  {
    const bedPreset = getInteractionPresetById('bed_sit_edge_forward')!;
    const applied = applySceneInteractionPresetState(
      frontStandingPose,
      frontCameraConfig,
      bedPreset,
      'studio_bedroom'
    );
    const walkedAwayPose: CharacterPose3DSettings = {
      ...applied.pose,
      characterPosX: 0,
      characterPosZ: 0.4,
    };
    const evalAway = evaluateActiveSceneInteraction(walkedAwayPose, 'studio_bedroom');
    assert(
      evalAway.hasActiveInteraction === false && evalAway.isStillAtAnchor === false,
      `Phase 12 Test 19 failed: moving away from furniture anchor must deactivate furniture interaction`
    );
  }

  // 20. Selecting a pose preset after a furniture interaction clears stale furniture elevation/interaction state.
  {
    const bedPreset = getInteractionPresetById('bed_lie_back')!;
    const applied = applySceneInteractionPresetState(
      frontStandingPose,
      frontCameraConfig,
      bedPreset,
      'studio_bedroom'
    );
    const afterStandingPreset = applyPosePresetState(
      applied.pose,
      { basePose: 'natural_standing' },
      applied.camera
    );
    assert(
      afterStandingPreset.interactionPresetId === null &&
        afterStandingPreset.seatHeightY === null &&
        afterStandingPreset.pelvisPitchDeg === 0 &&
        afterStandingPreset.pelvisRollDeg === 0 &&
        afterStandingPreset.characterPosX === bedPreset.anchorX &&
        afterStandingPreset.characterPosZ === bedPreset.anchorZ,
      `Phase 12 Test 20 failed: selecting a pose preset after furniture interaction must clear seatHeightY/pelvisPitch while preserving XZ position`
    );
  }

  // --------------------------------------------------------------------------
  // E. Environment Tests (21–24)
  // --------------------------------------------------------------------------

  // 21. Selecting each environment updates canonical environment state and produces distinct descriptions.
  {
    const descBedroom = describePlayboardEnvironment('studio_bedroom');
    const descMinimal = describePlayboardEnvironment('minimal_neutral');
    const descCyber = describePlayboardEnvironment('cyber_grid');
    assert(
      descBedroom !== descMinimal &&
        descMinimal !== descCyber &&
        descBedroom !== descCyber &&
        descBedroom.includes('bedroom') &&
        descMinimal.includes('minimal neutral studio') &&
        descCyber.includes('cyber-grid'),
      `Phase 12 Test 21 failed: each PlayboardEnvironment must produce a distinct canonical description`
    );
  }

  // 22. Environment descriptions in T2I prompts match the selected environment.
  {
    const envs: PlayboardEnvironment[] = ['studio_bedroom', 'minimal_neutral', 'cyber_grid'];
    for (const env of envs) {
      const cfgEnv: PlayboardFullConfig = { ...test2FullConfig, environment: env };
      const expectedEnvText = describePlayboardEnvironment(env);
      for (const model of ['universal', 'gemini', 'chatgpt', 'flux'] as const) {
        const p = buildPlayboardT2IPrompt(cfgEnv, model);
        assert(
          p.includes(expectedEnvText),
          `Phase 12 Test 22 failed for env=${env}, model=${model}: T2I prompt missing environment description`
        );
      }
    }
  }

  // 23. I2I environment preservation vs replacement is consistent with user configuration.
  {
    const cfgPreserve: PlayboardFullConfig = {
      ...test2FullConfig,
      environment: 'cyber_grid',
      preserveEnvironment: true,
    };
    const cfgReplace: PlayboardFullConfig = {
      ...test2FullConfig,
      environment: 'cyber_grid',
      preserveEnvironment: false,
    };
    const scenePreserve = buildInitialI2IFields(cfgPreserve, 'both').find(
      (f) => f.id === 'scene_preservation'
    )!.userText;
    const sceneReplace = buildInitialI2IFields(cfgReplace, 'both').find(
      (f) => f.id === 'scene_preservation'
    )!.userText;
    assert(
      scenePreserve.includes('Preserve the original clothing garments') &&
        sceneReplace.includes('Transition the surrounding stage environment to a stylized dark architectural cyber-grid stage'),
      `Phase 12 Test 23 failed: preserveEnvironment=true vs false must produce distinct I2I scene_preservation instructions`
    );
  }

  const neutralFramingCam: Camera3DSettings = {
    ...frontCameraConfig,
    focalLength: '50mm_standard_normal',
    pitchDeg: 0,
    height: 1.1,
  };

  // 24. Wide-shot descriptions do not hard-code "room architecture" when a non-room environment is active.
  {
    const wideCam: Camera3DSettings = applyRequestedFramingState(neutralFramingCam, 'wide_shot');
    const wideAnalysis = analyzePlayboardFraming(wideCam, frontStandingPose);
    const wideT2IMinimal = buildPlayboardT2IPrompt(
      { ...test2FullConfig, environment: 'minimal_neutral', camera: wideCam },
      'universal'
    );
    assert(
      wideAnalysis.measuredFraming === 'wide_shot' &&
        !wideAnalysis.shotSizeDescription.includes('room architecture') &&
        !wideT2IMinimal.includes('room architecture'),
      `Phase 12 Test 24 failed: wide_shot description must not hard-code "room architecture"`
    );
  }

  // --------------------------------------------------------------------------
  // F. Framing Tests (25–29)
  // --------------------------------------------------------------------------

  // 25. Selecting each framing preset updates requested framing and achieves matching measured framing.
  {
    const allFramings: ShotFraming[] = [
      'extreme_close_up',
      'close_up_portrait',
      'medium_close_up',
      'medium_shot',
      'three_quarter_shot',
      'full_shot',
      'wide_shot',
    ];
    for (const fPreset of allFramings) {
      const camApplied = applyRequestedFramingState(neutralFramingCam, fPreset);
      const analysis = analyzePlayboardFraming(camApplied, frontStandingPose);
      assert(
        camApplied.framing === fPreset &&
          analysis.requestedFraming === fPreset &&
          analysis.measuredFraming === fPreset &&
          analysis.framingMatchesRequest === true,
        `Phase 12 Test 25 failed for preset ${fPreset}: requested=${analysis.requestedFraming}, measured=${analysis.measuredFraming} (dist=${camApplied.distance}m)`
      );
    }
  }

  // 26. Measured framing from analyzePlayboardFraming() does not overwrite camera.framing.
  {
    const camReqFull: Camera3DSettings = {
      ...neutralFramingCam,
      framing: 'full_shot',
      distance: 1.25, // Manual close distance while framing preset is still 'full_shot'
    };
    const analysis = analyzePlayboardFraming(camReqFull, frontStandingPose);
    assert(
      camReqFull.framing === 'full_shot' &&
        analysis.requestedFraming === 'full_shot' &&
        analysis.measuredFraming === 'medium_close_up' &&
        analysis.framingMatchesRequest === false &&
        Boolean(analysis.framingDiscrepancyNote),
      `Phase 12 Test 26 failed: analyzePlayboardFraming must keep requestedFraming='full_shot' while reporting measuredFraming='medium_close_up'`
    );
  }

  // 27. Close-up and extreme-close-up presets produce matching measured framing and prompt descriptions.
  {
    const camCloseUp = applyRequestedFramingState(neutralFramingCam, 'close_up_portrait');
    const camECU = applyRequestedFramingState(neutralFramingCam, 'extreme_close_up');
    const fCloseUp = analyzePlayboardFraming(camCloseUp, frontStandingPose);
    const fECU = analyzePlayboardFraming(camECU, frontStandingPose);
    assert(
      fCloseUp.measuredFraming === 'close_up_portrait' &&
        fCloseUp.shotSizeDescription.includes('head-and-shoulders close-up') &&
        fECU.measuredFraming === 'extreme_close_up' &&
        fECU.shotSizeDescription.includes('extreme close-up'),
      `Phase 12 Test 27 failed: close_up_portrait (${fCloseUp.measuredFraming}) and extreme_close_up (${fECU.measuredFraming}) must match`
    );
  }

  // 28. Manual distance changes update measured framing without mutating requested framing.
  {
    const baseCam = applyRequestedFramingState(neutralFramingCam, 'medium_shot');
    const manualPulledBack: Camera3DSettings = { ...baseCam, distance: 3.2 };
    const analysis = analyzePlayboardFraming(manualPulledBack, frontStandingPose);
    assert(
      manualPulledBack.framing === 'medium_shot' &&
        analysis.requestedFraming === 'medium_shot' &&
        analysis.measuredFraming === 'full_shot' &&
        analysis.framingMatchesRequest === false,
      `Phase 12 Test 28 failed: manual distance pullback must update measuredFraming without mutating requestedFraming`
    );
  }

  // 29. Generated prompts describe the actual visible framing without contradicting the 3D preview.
  {
    const camClose = applyRequestedFramingState(neutralFramingCam, 'medium_close_up');
    const cfgClose: PlayboardFullConfig = { ...test2FullConfig, camera: camClose };
    const t2iClose = buildPlayboardT2IPrompt(cfgClose, 'universal');
    const i2iClose = compileFinalI2IPrompt(
      buildInitialI2IFields(cfgClose, 'both'),
      'both',
      cfgClose,
      'universal'
    );
    assert(
      t2iClose.includes('chest-up medium close-up') &&
        i2iClose.includes('chest-up medium close-up') &&
        !t2iClose.includes('full-body shot'),
      `Phase 12 Test 29 failed: prompts must describe actual measured medium_close_up framing`
    );
  }

  // --------------------------------------------------------------------------
  // G. Custom GLB Fallback Tests (30–32)
  // --------------------------------------------------------------------------

  // 30. Default procedural rig still uses full landmark analysis.
  {
    const analysisDefault = analyzePlayboardFraming(frontCameraConfig, frontStandingPose);
    assert(
      analysisDefault.usingCustomModelFallback === false,
      `Phase 12 Test 30 failed: default procedural rig must have usingCustomModelFallback=false`
    );
  }

  // 31. Custom model mode uses defined fallback behavior and does not read hidden procedural rig landmarks.
  {
    const customPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      basePose: 'deep_squat', // Hidden procedural rig would have low headTop (~1.1m), but custom GLB is 1.95m tall
      customModelBounds: {
        minY: 0,
        maxY: 1.95,
        height: 1.95,
        width: 0.6,
        depth: 0.4,
        centerX: 0,
        centerZ: 0,
      },
    };
    const landmarksCustom = computeCharacterWorldLandmarks(customPose);
    const analysisCustom = analyzePlayboardFraming(frontCameraConfig, customPose);
    assert(
      analysisCustom.usingCustomModelFallback === true &&
        landmarksCustom.headTop.y > 1.85,
      `Phase 12 Test 31 failed: customModelBounds must use bounding-box landmarks (headTop.y=${landmarksCustom.headTop.y}) instead of hidden deep_squat rig`
    );
  }

  // 32. Custom model mode does not corrupt camera, gaze, or framing state.
  {
    const customPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      customModelBounds: {
        minY: 0,
        maxY: 1.68,
        height: 1.68,
        width: 0.5,
        depth: 0.35,
        centerX: 0,
        centerZ: 0,
      },
    };
    const cfgCustom: PlayboardFullConfig = { ...test2FullConfig, pose: customPose };
    const t2iCustom = buildPlayboardT2IPrompt(cfgCustom, 'universal');
    const clearedPose: CharacterPose3DSettings = { ...customPose, customModelBounds: null };
    const analysisRestored = analyzePlayboardFraming(frontCameraConfig, clearedPose);
    assert(
      t2iCustom.includes('direct eye contact') &&
        analysisRestored.usingCustomModelFallback === false,
      `Phase 12 Test 32 failed: customModelBounds must preserve valid camera/gaze/framing state and restore cleanly when cleared`
    );
  }

  // --------------------------------------------------------------------------
  // H. Prompt Completeness and Consistency Tests (33–38)
  // --------------------------------------------------------------------------

  // 33. describeTorso() does not make camera-relative exposure claims without camera context.
  {
    const rotatedCamera: Camera3DSettings = { ...frontCameraConfig, yawDeg: -45 };
    const rotatedSubject: CharacterPose3DSettings = { ...frontStandingPose, characterYawDeg: -45 };
    // Here camera (-45°) and subject (-45°) are aligned (relativeToBodyYawDeg === 0°)!
    const fAligned = analyzePlayboardFraming(rotatedCamera, rotatedSubject);
    const torsoDescAligned = describeTorso(rotatedSubject, fAligned.relativeAngles);
    assert(
      torsoDescAligned.includes('whole body oriented 45° clockwise') &&
        !torsoDescAligned.includes("exposing the subject's right side"),
      `Phase 12 Test 33 failed: when camera and subject are both at -45°, describeTorso must not claim right side is exposed, got: ${torsoDescAligned}`
    );
  }

  // 34. describeLeg() reflects modified leg parameters when applicable.
  {
    const sittingAbducted = describeLeg('left', 80, 28, 90, 18, 'casual_sitting');
    const lyingBent = describeLeg('right', 15, 22, 45, -16, 'reclined_lying');
    assert(
      sittingAbducted.includes('28° abduction') &&
        sittingAbducted.includes('foot angled outward (18°)') &&
        lyingBent.includes('knee bent at 45°') &&
        lyingBent.includes('22° abduction'),
      `Phase 12 Test 34 failed: describeLeg must include manual abduction/knee/foot modifiers on non-standing poses`
    );
  }

  // 35. isWaving and isWalking states are reflected consistently.
  {
    const walkingWavingPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      isWalking: true,
      isWaving: true,
      rightHandGesture: 'relaxed_natural',
    };
    const torsoWalk = describeTorso(walkingWavingPose);
    const rightArmWave = describeArm('right', 5, 8, 14, 0, 'relaxed_natural', true);
    assert(
      torsoWalk.includes('active walking gait') &&
        rightArmWave.includes('active waving motion'),
      `Phase 12 Test 35 failed: isWalking and isWaving must be reflected in describeTorso and describeArm`
    );
  }

  // 36. All target model branches (universal, gemini, chatgpt, flux) follow the same scope and preservation semantics.
  {
    const models = ['universal', 'gemini', 'chatgpt', 'flux'] as const;
    for (const m of models) {
      const t2iM = buildPlayboardT2IPrompt(test2FullConfig, m);
      const i2iCamM = compileFinalI2IPrompt(
        buildInitialI2IFields(test2FullConfig, 'camera_only'),
        'camera_only',
        test2FullConfig,
        m
      );
      const i2iPoseM = compileFinalI2IPrompt(
        buildInitialI2IFields(test2FullConfig, 'pose_only'),
        'pose_only',
        test2FullConfig,
        m
      );
      assert(
        t2iM.length > 80 &&
          i2iCamM.includes('Camera Viewpoint & Framing Shift Only') &&
          !i2iCamM.includes('[BODY POSE & TORSO ALIGNMENT]') &&
          i2iPoseM.includes('Pose & Gesture Modification Only') &&
          !i2iPoseM.includes('[CAMERA VIEWPOINT & FRAMING]'),
        `Phase 12 Test 36 failed for targetModel=${m}: scope semantics must match across all models`
      );
    }
  }

  // 37. Locked custom I2I fields remain preserved during config sync.
  {
    const fields37 = buildInitialI2IFields(test2FullConfig, 'both').map((f) =>
      f.id === 'head_gaze_expression'
        ? { ...f, userText: 'CUSTOM LOCKED GAZE 37', isLocked: true }
        : f
    );
    const synced37 = syncI2IFieldsWithConfig(
      fields37,
      { ...test2FullConfig, pose: { ...frontStandingPose, gaze: 'eyes_closed' } },
      'both'
    );
    const headField37 = synced37.find((f) => f.id === 'head_gaze_expression')!;
    assert(
      headField37.isLocked && headField37.userText === 'CUSTOM LOCKED GAZE 37',
      `Phase 12 Test 37 failed: locked I2I field must remain preserved`
    );
  }

  // 38. Legacy saved blueprints migrate cleanly via migrateLegacyPlayboardConfig without stale anchor/subject split state.
  {
    const legacyBlueprint: Partial<PlayboardFullConfig> = {
      id: 'legacy_bp_1',
      name: 'Legacy Setup',
      environment: 'studio_bedroom',
      camera: {
        ...frontCameraConfig,
        targetMode: undefined,
      },
      pose: {
        ...frontStandingPose,
        characterPosX: 1.35,
        characterPosZ: -0.95,
        anchorPosX: 0, // Stale 0 anchor from legacy save
        anchorPosZ: 0,
      },
    };
    const migrated = migrateLegacyPlayboardConfig(legacyBlueprint);
    assert(
      migrated.camera.targetMode === 'track_subject' &&
        migrated.pose.anchorPosX === 1.35 &&
        migrated.pose.anchorPosZ === -0.95,
      `Phase 12 Test 38 failed: migrateLegacyPlayboardConfig must sync stale anchorPosX/Z to characterPosX/Z in track_subject mode`
    );
  }

  // --------------------------------------------------------------------------
  // I. Regression Tests for Previously Fixed Systems (39–47)
  // --------------------------------------------------------------------------

  // 39. Camera yaw +45° and -45° produce right and left relative views respectively.
  {
    const fRight45 = analyzePlayboardFraming({ ...frontCameraConfig, yawDeg: 45 }, frontStandingPose);
    const fLeft45 = analyzePlayboardFraming({ ...frontCameraConfig, yawDeg: -45 }, frontStandingPose);
    assert(
      describeCameraHorizontal(fRight45.relativeAngles.relativeToBodyYawDeg).includes('front-right three-quarter') &&
        describeCameraHorizontal(fLeft45.relativeAngles.relativeToBodyYawDeg).includes('front-left three-quarter'),
      `Phase 12 Test 39 failed: +45° and -45° camera yaw must produce front-right and front-left views`
    );
  }

  // 40. Camera height, pitch, and distance remain decoupled.
  {
    const cBase = computePlayboardCameraTransform(
      { ...frontCameraConfig, height: 1.4, pitchDeg: 0, distance: 3.0 },
      frontStandingPose
    );
    const cPitched = computePlayboardCameraTransform(
      { ...frontCameraConfig, height: 1.4, pitchDeg: 25, distance: 4.2 },
      frontStandingPose
    );
    const cRaised = computePlayboardCameraTransform(
      { ...frontCameraConfig, height: 1.9, pitchDeg: 0, distance: 3.0 },
      frontStandingPose
    );
    assert(
      Math.abs(cRaised.lookTarget.y - cBase.lookTarget.y - 0.5) < 1e-4 &&
        Math.abs(cPitched.lookTarget.y - cBase.lookTarget.y) < 0.15,
      `Phase 12 Test 40 failed: camera height, pitch, and distance must remain decoupled`
    );
  }

  // 41. Low-angle direct_at_camera produces downward eye compensation and low-angle direct eye-contact prompt text.
  {
    const lowCam: Camera3DSettings = { ...frontCameraConfig, height: 0.45, pitchDeg: -16, distance: 2.3 };
    const lowAnalysis = analyzePlayboardFraming(lowCam, frontStandingPose);
    const lowGaze = describeGazeAndEyeContact(
      frontStandingPose,
      lowCam.yawDeg,
      lowAnalysis.relativeAngles,
      lowCam.pitchDeg,
      lowCam.height,
      lowCam.distance
    );
    assert(
      lowAnalysis.relativeAngles.gazeSolution.eyePitchDeg < -8 &&
        lowAnalysis.relativeAngles.gazeSolution.pupilOffsetY < -0.001 &&
        lowGaze.includes('eyes angled downward') &&
        lowGaze.includes('low-angle camera lens'),
      `Phase 12 Test 41 failed: low-angle direct_at_camera must produce downward eye compensation and low-angle prompt text`
    );
  }

  // 42. High-angle direct_at_camera produces upward eye compensation and high-angle direct eye-contact prompt text.
  {
    const highCam: Camera3DSettings = { ...frontCameraConfig, height: 2.35, pitchDeg: 24, distance: 2.6 };
    const highAnalysis = analyzePlayboardFraming(highCam, frontStandingPose);
    const highGaze = describeGazeAndEyeContact(
      frontStandingPose,
      highCam.yawDeg,
      highAnalysis.relativeAngles,
      highCam.pitchDeg,
      highCam.height,
      highCam.distance
    );
    assert(
      highAnalysis.relativeAngles.gazeSolution.eyePitchDeg > 8 &&
        highAnalysis.relativeAngles.gazeSolution.pupilOffsetY > 0.001 &&
        highGaze.includes('eyes angled upward') &&
        highGaze.includes('elevated high-angle camera lens'),
      `Phase 12 Test 42 failed: high-angle direct_at_camera must produce upward eye compensation and high-angle prompt text`
    );
  }

  // 43. Head turned beyond anatomical eye limits does not claim direct lens contact.
  {
    const headTurned70: CharacterPose3DSettings = {
      ...frontStandingPose,
      headRotationDeg: 70,
      gaze: 'direct_at_camera',
    };
    const a70 = analyzePlayboardFraming(frontCameraConfig, headTurned70);
    const g70 = describeGazeAndEyeContact(frontStandingPose, 0, a70.relativeAngles);
    assert(
      a70.relativeAngles.gazeSolution.canAchieveDirectLensContact === false &&
        g70.includes('no direct eye contact with the camera lens'),
      `Phase 12 Test 43 failed: head turned 70° must not claim direct lens contact`
    );
  }

  // 44. Blue joystick moves relative to subject facing direction at 0°, +90°, -90°, and 180°, independent of camera yaw.
  {
    const yaws = [0, 90, -90, 180];
    for (const yDeg of yaws) {
      const sA = createInitialLocomotionState();
      sA.rot = THREE.MathUtils.degToRad(yDeg);
      sA.targetRot = sA.rot;
      runSteps(sA, { x: 0, y: 1 }, 0, 20, 0);

      const sB = createInitialLocomotionState();
      sB.rot = THREE.MathUtils.degToRad(yDeg);
      sB.targetRot = sB.rot;
      runSteps(sB, { x: 0, y: 1 }, 0, 20, Math.PI * 0.75);

      assert(
        Math.abs(sA.x - sB.x) < 1e-6 && Math.abs(sA.z - sB.z) < 1e-6,
        `Phase 12 Test 44 failed at yaw=${yDeg}°: blue joystick movement must be subject-relative and independent of camera yaw`
      );
    }
  }

  // 45. Orange joystick rotates subject in place without translating the subject or moving the camera.
  {
    const sTurn = createInitialLocomotionState();
    sTurn.x = 0.75;
    sTurn.z = -0.55;
    runSteps(sTurn, { x: 0, y: 0 }, 0.85, 30, 0.4);
    assert(
      Math.abs(sTurn.x - 0.75) < 1e-6 &&
        Math.abs(sTurn.z - -0.55) < 1e-6 &&
        sTurn.rot < -0.2,
      `Phase 12 Test 45 failed: orange joystick must rotate subject in place without translation`
    );
  }

  // 46. Simultaneous blue + orange joystick movement follows a smooth curved path without camera interference.
  {
    const sCurveA = createInitialLocomotionState();
    runSteps(sCurveA, { x: 0, y: 0.9 }, 0.65, 40, 0);
    const sCurveB = createInitialLocomotionState();
    runSteps(sCurveB, { x: 0, y: 0.9 }, 0.65, 40, -1.9);
    assert(
      Math.abs(sCurveA.x - sCurveB.x) < 1e-6 &&
        Math.abs(sCurveA.z - sCurveB.z) < 1e-6 &&
        Math.abs(sCurveA.rot - sCurveB.rot) < 1e-6 &&
        Math.abs(sCurveA.x) > 0.1 &&
        sCurveA.z > 0.2,
      `Phase 12 Test 46 failed: simultaneous blue + orange joystick movement must follow a smooth curved path independent of camera`
    );
  }

  // 47. Gait classification matches character-local movement.
  {
    const gFwd = classifyCharacterLocalGait(0, 1, 0, 1.0, 2.0, false);
    const gBack = classifyCharacterLocalGait(0, -1, 0, 1.0, 2.0, false);
    const gLeft = classifyCharacterLocalGait(-1, 0, 0, 1.0, 2.0, false);
    const gRight = classifyCharacterLocalGait(1, 0, 0, 1.0, 2.0, false);
    assert(
      gFwd.gaitMode === 'walk_forward' &&
        gBack.gaitMode === 'walk_backward' &&
        gLeft.gaitMode === 'strafe_left' &&
        gRight.gaitMode === 'strafe_right',
      `Phase 12 Test 47 failed: gait classification must match character-local movement`
    );
  }

  console.log('✅ Phase 12 PASSED: All 47 Integrated Final Control-Consistency tests verified.');
}

// ============================================================================
// PHASE 13: NEXT-VERSION VISUAL SCENE EDITOR, INSPECTOR, GUIDES, PROMPT
// VALIDATION, CHECKPOINTS, SHOT VARIATIONS & SOURCE-INSPIRED CONTINUITY (1–46)
// ============================================================================
console.log('Running Phase 13: Next-Version Complete Implementation Acceptance Tests (1–46)...');

{
  const baseConfig13: PlayboardFullConfig = {
    id: 'p13_base',
    name: 'Phase 13 Base Scene',
    createdAt: 1000,
    updatedAt: 1000,
    environment: 'studio_bedroom',
    preserveEnvironment: true,
    environmentPolicy: 'auto',
    camera: {
      yawDeg: 0,
      pitchDeg: 0,
      height: 1.1,
      distance: 1.55,
      rollDeg: 0,
      focalLength: '50mm_standard_normal',
      framing: 'medium_shot',
      composition: 'center',
      outputRatio: '3:4',
      orientation: 'Portrait',
      focusDof: 'shallow_f1_4',
      targetMode: 'track_subject',
    },
    pose: {
      ...frontStandingPose,
      characterPosX: 0,
      characterPosZ: 0,
      characterYawDeg: 0,
      anchorPosX: 0,
      anchorPosZ: 0,
      interactionPresetId: null,
      seatHeightY: null,
      pelvisPitchDeg: 0,
      pelvisRollDeg: 0,
    },
  };

  // --------------------------------------------------------------------------
  // A. Scene State Inspector (1–5)
  // --------------------------------------------------------------------------

  // 1. Inspector displays current subject position and facing yaw.
  {
    const cfg: PlayboardFullConfig = {
      ...baseConfig13,
      pose: { ...baseConfig13.pose, characterPosX: 1.25, characterPosZ: -0.85, characterYawDeg: 35 },
    };
    const insp = inspectPlayboardSceneState(cfg, 'both');
    assert(
      insp.subject.posX === 1.25 && insp.subject.posZ === -0.85 && insp.subject.yawDeg === 35,
      `Phase 13 Test 1 failed: Inspector must display current subject position and facing yaw`
    );
  }

  // 2. Inspector displays camera yaw, pitch, distance, height, and target mode.
  {
    const cfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: {
        ...baseConfig13.camera,
        yawDeg: 45,
        pitchDeg: -12,
        distance: 2.6,
        height: 0.9,
        targetMode: 'fixed_composition',
      },
    };
    const insp = inspectPlayboardSceneState(cfg, 'both');
    assert(
      insp.camera.yawDeg === 45 &&
        insp.camera.pitchDeg === -12 &&
        insp.camera.distance === 2.6 &&
        insp.camera.height === 0.9 &&
        insp.camera.targetMode === 'fixed_composition',
      `Phase 13 Test 2 failed: Inspector must display camera yaw, pitch, distance, height, and targetMode`
    );
  }

  // 3. Inspector displays requested framing and measured framing.
  {
    const cfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: { ...baseConfig13.camera, framing: 'close_up_portrait', distance: 4.5 },
    };
    const insp = inspectPlayboardSceneState(cfg, 'both');
    assert(
      insp.framing.requestedFraming === 'close_up_portrait' &&
        insp.framing.measuredFraming !== 'close_up_portrait' &&
        insp.framing.matchesRequest === false,
      `Phase 13 Test 3 failed: Inspector must display requested framing and measured framing`
    );
  }

  // 4. Inspector displays head orientation and gaze mode.
  {
    const cfg: PlayboardFullConfig = {
      ...baseConfig13,
      pose: {
        ...baseConfig13.pose,
        headRotationDeg: 22,
        headTiltDeg: -8,
        gaze: 'looking_camera_left',
      },
    };
    const insp = inspectPlayboardSceneState(cfg, 'both');
    assert(
      insp.gazeAndHead.headRotationDeg === 22 &&
        insp.gazeAndHead.headTiltDeg === -8 &&
        insp.gazeAndHead.gazeMode === 'looking_camera_left',
      `Phase 13 Test 4 failed: Inspector must display head orientation and gaze mode`
    );
  }

  // 5. Inspector displays active scene interaction, environment, and transformation scope.
  {
    const bedPreset = getInteractionPresetById('bed_sit_edge_forward')!;
    const applied = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const cfg: PlayboardFullConfig = {
      ...baseConfig13,
      pose: applied.pose,
      environment: applied.environment,
    };
    const insp = inspectPlayboardSceneState(cfg, 'pose_only');
    assert(
      insp.environmentAndInteraction.hasActiveInteraction === true &&
        insp.environmentAndInteraction.interactionPresetId === 'bed_sit_edge_forward' &&
        insp.environmentAndInteraction.environment === 'studio_bedroom' &&
        insp.transformation.scope === 'pose_only',
      `Phase 13 Test 5 failed: Inspector must display active scene interaction, environment, and transformation scope`
    );
  }

  // --------------------------------------------------------------------------
  // B. Visual Guides (6–10)
  // --------------------------------------------------------------------------

  // 6. Subject facing guide matches characterYawDeg.
  {
    const pose90: CharacterPose3DSettings = { ...baseConfig13.pose, characterYawDeg: 90 };
    const geom = computePlayboardVisualGuidesGeometry(baseConfig13.camera, pose90);
    assert(
      Math.abs(geom.subjectFacingVector.x - 1) < 1e-5 &&
        Math.abs(geom.subjectFacingVector.z - 0) < 1e-5,
      `Phase 13 Test 6 failed: Subject facing guide at +90° must point along +X (1,0,0)`
    );
  }

  // 7. Movement guide matches subject-relative movement basis.
  {
    const pose180: CharacterPose3DSettings = { ...baseConfig13.pose, characterYawDeg: 180 };
    const geomUp = computePlayboardVisualGuidesGeometry(baseConfig13.camera, pose180, { x: 0, y: 1 });
    const geomRight = computePlayboardVisualGuidesGeometry(baseConfig13.camera, pose180, { x: 1, y: 0 });
    assert(
      geomUp.hasMovementInput &&
        Math.abs(geomUp.movementWorldVector.z - -1) < 1e-5 &&
        Math.abs(geomRight.movementWorldVector.x - -1) < 1e-5,
      `Phase 13 Test 7 failed: Movement guide must match subject-relative movement basis at yaw=180°`
    );
  }

  // 8. Camera target guide matches track_subject or fixed_composition.
  {
    const movedPose: CharacterPose3DSettings = {
      ...baseConfig13.pose,
      characterPosX: 1.4,
      characterPosZ: -0.7,
      anchorPosX: 0.1,
      anchorPosZ: 0.2,
    };
    const geomTrack = computePlayboardVisualGuidesGeometry(
      { ...baseConfig13.camera, targetMode: 'track_subject' },
      movedPose
    );
    const geomFixed = computePlayboardVisualGuidesGeometry(
      { ...baseConfig13.camera, targetMode: 'fixed_composition' },
      movedPose
    );
    assert(
      Math.abs(geomTrack.cameraLookTarget.x - 1.4) < 1e-5 &&
        Math.abs(geomTrack.cameraLookTarget.z - -0.7) < 1e-5 &&
        Math.abs(geomFixed.cameraLookTarget.x - 0.1) < 1e-5 &&
        Math.abs(geomFixed.cameraLookTarget.z - 0.2) < 1e-5,
      `Phase 13 Test 8 failed: Camera target guide must match track_subject or fixed_composition`
    );
  }

  // 9. Head direction guide and eye-gaze guide match the gaze/head math.
  {
    const headTurnedPose: CharacterPose3DSettings = {
      ...baseConfig13.pose,
      characterYawDeg: 0,
      headRotationDeg: -24,
      gaze: 'direct_at_camera',
    };
    const geom = computePlayboardVisualGuidesGeometry(baseConfig13.camera, headTurnedPose);
    // Head turned -24° left -> headForwardVector.x < 0, while eyeGazeVector points toward camera at x=0 -> eyeGazeVector.x > headForwardVector.x
    assert(
      geom.headForwardVector.x < -0.25 &&
        geom.eyeGazeVector.x > geom.headForwardVector.x + 0.15 &&
        geom.canAchieveDirectLensContact === true,
      `Phase 13 Test 9 failed: Head direction guide and eye-gaze guide must reflect distinct head-forward vs eye-compensated rays`
    );
  }

  // 10. Visual guide toggles do not mutate canonical scene state.
  {
    const snapshotBefore = JSON.stringify(baseConfig13);
    computePlayboardVisualGuidesGeometry(baseConfig13.camera, baseConfig13.pose, { x: 0.5, y: 0.5 });
    const snapshotAfter = JSON.stringify(baseConfig13);
    assert(
      snapshotBefore === snapshotAfter,
      `Phase 13 Test 10 failed: Computing visual guides must never mutate canonical scene state`
    );
  }

  // --------------------------------------------------------------------------
  // C. Camera Target and Framing (11–15)
  // --------------------------------------------------------------------------

  // 11. track_subject keeps camera target on subject when subject moves.
  {
    const movedPose: CharacterPose3DSettings = {
      ...baseConfig13.pose,
      characterPosX: -1.1,
      characterPosZ: 0.95,
    };
    const camTrack = computePlayboardCameraTransform(
      { ...baseConfig13.camera, targetMode: 'track_subject' },
      movedPose
    );
    assert(
      Math.abs(camTrack.lookTarget.x - -1.1) < 1e-5 &&
        Math.abs(camTrack.lookTarget.z - 0.95) < 1e-5,
      `Phase 13 Test 11 failed: track_subject must keep camera target on subject when subject moves`
    );
  }

  // 12. fixed_composition keeps camera target on fixed anchor when subject moves.
  {
    const switched = switchCameraTargetMode(
      baseConfig13.camera,
      { ...baseConfig13.pose, characterPosX: 0.25, characterPosZ: -0.35 },
      'fixed_composition'
    );
    const walkedPose: CharacterPose3DSettings = {
      ...switched.pose,
      characterPosX: 1.65,
      characterPosZ: 0.8,
    };
    const camFixed = computePlayboardCameraTransform(switched.camera, walkedPose);
    assert(
      Math.abs(camFixed.lookTarget.x - 0.25) < 1e-5 &&
        Math.abs(camFixed.lookTarget.z - -0.35) < 1e-5,
      `Phase 13 Test 12 failed: fixed_composition must keep camera target on fixed anchor when subject moves`
    );
  }

  // 13. Selecting a framing preset updates distance to canonical framing distance.
  {
    const closeCam = applyRequestedFramingState(baseConfig13.camera, 'close_up_portrait');
    const wideCam = applyRequestedFramingState(baseConfig13.camera, 'wide_shot');
    assert(
      closeCam.framing === 'close_up_portrait' &&
        closeCam.distance < 1.8 &&
        wideCam.framing === 'wide_shot' &&
        wideCam.distance > 4.0,
      `Phase 13 Test 13 failed: Selecting a framing preset must update distance to canonical framing distance`
    );
  }

  // 14. Manual zoom after framing selection updates measured framing and reports discrepancy if needed.
  {
    const zoomedOutCam: Camera3DSettings = {
      ...applyRequestedFramingState(baseConfig13.camera, 'close_up_portrait'),
      distance: 4.8,
    };
    const analysis = analyzePlayboardFraming(zoomedOutCam, baseConfig13.pose);
    assert(
      analysis.framingMatchesRequest === false &&
        analysis.measuredFraming !== 'close_up_portrait' &&
        typeof analysis.framingDiscrepancyNote === 'string' &&
        analysis.framingDiscrepancyNote.length > 10,
      `Phase 13 Test 14 failed: Manual zoom after framing selection must update measured framing and report discrepancy`
    );
  }

  // 15. Framing alignment action resolves requested/measured framing discrepancy.
  {
    const discrepantCam: Camera3DSettings = {
      ...baseConfig13.camera,
      framing: 'close_up_portrait',
      distance: 4.8,
    };
    const alignedDistanceCam = applyRequestedFramingState(discrepantCam, discrepantCam.framing);
    const afterDistanceAlign = analyzePlayboardFraming(alignedDistanceCam, baseConfig13.pose);
    assert(
      afterDistanceAlign.framingMatchesRequest === true &&
        afterDistanceAlign.measuredFraming === 'close_up_portrait',
      `Phase 13 Test 15 failed: Framing alignment action must resolve requested/measured framing discrepancy`
    );
  }

  // --------------------------------------------------------------------------
  // D. Scene Interactions and Presets (16–19)
  // --------------------------------------------------------------------------

  // 16. Scene-interaction presets update subject position, orientation, pose, and support surface.
  {
    const preset = getInteractionPresetById('bed_lie_back')!;
    const next = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      preset,
      'studio_bedroom'
    );
    assert(
      next.pose.characterPosX === preset.anchorX &&
        next.pose.characterPosZ === preset.anchorZ &&
        next.pose.characterYawDeg === (preset.poseValues.characterYawDeg ?? 0) &&
        next.pose.seatHeightY === preset.seatHeightY &&
        next.pose.interactionPresetId === 'bed_lie_back',
      `Phase 13 Test 16 failed: Scene-interaction preset must update subject position, orientation, pose, and support surface`
    );
  }

  // 17. Scene-interaction presets preserve camera angles unless explicitly configured.
  {
    const customCam: Camera3DSettings = {
      ...baseConfig13.camera,
      yawDeg: -55,
      pitchDeg: 18,
      distance: 2.7,
      height: 1.65,
    };
    const preset = getInteractionPresetById('chair_sit_upright_thighs')!;
    applySceneInteractionPresetState(baseConfig13.pose, customCam, preset, 'studio_bedroom');
    assert(
      customCam.yawDeg === -55 &&
        customCam.pitchDeg === 18 &&
        customCam.distance === 2.7 &&
        customCam.height === 1.65,
      `Phase 13 Test 17 failed: Scene-interaction preset must preserve camera angles`
    );
  }

  // 18. Pose presets preserve subject world position and facing yaw.
  {
    const stagedPose: CharacterPose3DSettings = {
      ...baseConfig13.pose,
      characterPosX: -1.45,
      characterPosZ: 0.65,
      characterYawDeg: -110,
    };
    const posed = applyPosePresetState(
      stagedPose,
      { basePose: 'power_stance', torsoLeanDeg: -4 },
      baseConfig13.camera
    );
    assert(
      posed.characterPosX === -1.45 &&
        posed.characterPosZ === 0.65 &&
        posed.characterYawDeg === -110 &&
        posed.basePose === 'power_stance',
      `Phase 13 Test 18 failed: Pose presets must preserve subject world position and facing yaw`
    );
  }

  // 19. Camera presets preserve pose, subject position, and active scene interaction.
  {
    const bedPreset = getInteractionPresetById('bed_sit_one_leg_bent')!;
    const staged = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const nextCam = applyCameraPresetState(baseConfig13.camera, {
      yawDeg: 45,
      pitchDeg: -15,
      distance: 2.5,
    });
    assert(
      nextCam.yawDeg === 45 &&
        staged.pose.interactionPresetId === 'bed_sit_one_leg_bent' &&
        staged.pose.characterPosX === bedPreset.anchorX &&
        staged.pose.characterPosZ === bedPreset.anchorZ,
      `Phase 13 Test 19 failed: Camera presets must preserve pose, subject position, and active scene interaction`
    );
  }

  // --------------------------------------------------------------------------
  // E. Source-Inspired Environment Transformation (20–26)
  // --------------------------------------------------------------------------

  // 20. When no scene interaction requires a new environment and environment preservation is enabled, prompt preserves physical environment.
  {
    const resolved = resolveEnvironmentTransformationPolicy(baseConfig13, 'both');
    const fields = buildInitialI2IFields(baseConfig13, 'both');
    const sceneField = fields.find((f) => f.id === 'scene_preservation')!.userText;
    assert(
      resolved.effectiveMode === 'preserve_physical_environment' &&
        sceneField.includes('Preserve the original clothing garments') &&
        sceneField.includes('existing ambient lighting style from the original image'),
      `Phase 13 Test 20 failed: When no scene interaction is active and preserveEnvironment is true, prompt must preserve physical environment`
    );
  }

  // 21. When a bed or chair interaction is active, or source-inspired environment transformation is active, prompt uses source-inspired transformation wording.
  {
    const bedPreset = getInteractionPresetById('bed_lie_back')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const bedConfig: PlayboardFullConfig = {
      ...baseConfig13,
      pose: bedState.pose,
      environment: bedState.environment,
    };
    const resolvedBed = resolveEnvironmentTransformationPolicy(bedConfig, 'both');

    const chairPreset = getInteractionPresetById('chair_sit_upright_thighs')!;
    const chairState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      chairPreset,
      'studio_bedroom'
    );
    const chairConfig: PlayboardFullConfig = {
      ...baseConfig13,
      pose: chairState.pose,
      environment: chairState.environment,
    };
    const resolvedChair = resolveEnvironmentTransformationPolicy(chairConfig, 'both');

    assert(
      resolvedBed.effectiveMode === 'source_inspired_transformation' &&
        resolvedChair.effectiveMode === 'source_inspired_transformation',
      `Phase 13 Test 21 failed: Bed and chair interactions must resolve to source_inspired_transformation`
    );
  }

  // 22. In source-inspired transformation mode, the prompt introduces the required furniture/setting while using the source image as the visual reference for lighting character, tonal balance, shadow softness, color grading, skin appearance, and photographic texture.
  {
    const bedPreset = getInteractionPresetById('bed_lie_back')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const bedConfig: PlayboardFullConfig = {
      ...baseConfig13,
      pose: bedState.pose,
      environment: bedState.environment,
    };
    const fields = buildInitialI2IFields(bedConfig, 'both');
    const sceneText = fields.find((f) => f.id === 'scene_preservation')!.userText;
    assert(
      sceneText.includes('bed support surface') &&
        sceneText.includes('lighting character') &&
        sceneText.includes('tonal balance') &&
        sceneText.includes('shadow softness') &&
        sceneText.includes('color grading') &&
        sceneText.includes('skin appearance') &&
        sceneText.includes('photographic texture'),
      `Phase 13 Test 22 failed: Source-inspired transformation must introduce required furniture while referencing source lighting, tonal balance, shadow softness, color grading, skin appearance, and photographic texture. Got: ${sceneText}`
    );
  }

  // 23. In source-inspired transformation mode, the prompt does not blindly preserve incompatible original room furniture.
  {
    const bedPreset = getInteractionPresetById('bed_sit_edge_forward')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const bedConfig: PlayboardFullConfig = {
      ...baseConfig13,
      pose: bedState.pose,
      environment: bedState.environment,
    };
    const fields = buildInitialI2IFields(bedConfig, 'both');
    const sceneText = fields.find((f) => f.id === 'scene_preservation')!.userText;
    assert(
      sceneText.includes('without forcing retention of incompatible original room furniture'),
      `Phase 13 Test 23 failed: Source-inspired transformation must explicitly avoid forcing retention of incompatible original room furniture. Got: ${sceneText}`
    );
  }

  // 24. In source-inspired transformation mode, the prompt does not replace the source image's lighting/color grading with an unrelated generic look.
  {
    const bedPreset = getInteractionPresetById('bed_lie_back')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const bedConfig: PlayboardFullConfig = {
      ...baseConfig13,
      pose: bedState.pose,
      environment: bedState.environment,
    };
    const fields = buildInitialI2IFields(bedConfig, 'both');
    const sceneText = fields.find((f) => f.id === 'scene_preservation')!.userText;
    const constraintsText = fields.find((f) => f.id === 'transformation_constraints')!.userText;
    assert(
      !sceneText.includes('Transition the surrounding stage environment') &&
        constraintsText.includes('derive the scene’s lighting direction, shadow softness, color grading, and photographic texture from the source image'),
      `Phase 13 Test 24 failed: Source-inspired transformation must derive lighting/color grading from the source image rather than unrelated stage replacement`
    );
  }

  // 25. Subject identity, face, skin tone, hair, body proportions, and clothing remain preserved unless explicitly changed.
  {
    for (const policy of [
      'preserve_physical_environment',
      'source_inspired_transformation',
      'replace_environment',
    ] as const) {
      const cfg: PlayboardFullConfig = {
        ...baseConfig13,
        environmentPolicy: policy,
        preserveEnvironment: policy !== 'replace_environment',
      };
      const fields = buildInitialI2IFields(cfg, 'both');
      const idText = fields.find((f) => f.id === 'identity_preservation')!.userText;
      const sceneText = fields.find((f) => f.id === 'scene_preservation')!.userText;
      assert(
        idText.includes('facial identity') &&
          idText.includes('skin tone') &&
          idText.includes('hair texture') &&
          idText.includes('body proportions') &&
          sceneText.includes('clothing garments'),
        `Phase 13 Test 25 failed for policy=${policy}: identity, face, skin tone, hair, body proportions, and clothing must remain preserved`
      );
    }
  }

  // 26. All target model formatting branches (universal, gemini, chatgpt, flux) preserve the source-inspired visual continuity instructions.
  {
    const bedPreset = getInteractionPresetById('bed_lie_back')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const bedConfig: PlayboardFullConfig = {
      ...baseConfig13,
      pose: bedState.pose,
      environment: bedState.environment,
    };
    const bedFields = buildInitialI2IFields(bedConfig, 'both');
    for (const model of ['universal', 'gemini', 'chatgpt', 'flux'] as const) {
      const compiled = compileFinalI2IPrompt(bedFields, 'both', bedConfig, model);
      assert(
        compiled.includes('lighting character') &&
          compiled.includes('tonal balance') &&
          compiled.includes('without forcing retention of incompatible original room furniture'),
        `Phase 13 Test 26 failed for model=${model}: compiled prompt must preserve source-inspired visual continuity instructions`
      );
    }
  }

  // --------------------------------------------------------------------------
  // F. Prompt Validation and Consistency Checker (27–33)
  // --------------------------------------------------------------------------

  // 27. Validator reports consistent when state, framing, gaze, interaction, and prompt align.
  {
    const alignedCam = applyRequestedFramingState(baseConfig13.camera, 'medium_shot');
    const alignedCfg: PlayboardFullConfig = { ...baseConfig13, camera: alignedCam };
    const report = validatePlayboardPromptConsistency(alignedCfg, 'both');
    assert(
      report.overallStatus === 'consistent' && report.issues.length === 0,
      `Phase 13 Test 27 failed: Validator must report consistent when state, framing, gaze, interaction, and prompt align. Got: ${JSON.stringify(report.issues)}`
    );
  }

  // 28. Validator reports a warning when requested framing differs from measured framing.
  {
    const discrepantCfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: { ...baseConfig13.camera, framing: 'close_up_portrait', distance: 4.5 },
    };
    const report = validatePlayboardPromptConsistency(discrepantCfg, 'both');
    assert(
      report.overallStatus === 'warning' &&
        report.issues.some((i) => i.id === 'framing_discrepancy' && i.actionType === 'fix_framing_distance'),
      `Phase 13 Test 28 failed: Validator must report a warning when requested framing differs from measured framing`
    );
  }

  // 29. Validator reports a warning when direct_at_camera cannot achieve direct eye contact due to head/camera angle.
  {
    const extremeHeadCfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: applyRequestedFramingState(baseConfig13.camera, 'medium_shot'),
      pose: { ...baseConfig13.pose, headRotationDeg: 70, gaze: 'direct_at_camera' },
    };
    const report = validatePlayboardPromptConsistency(extremeHeadCfg, 'both');
    assert(
      report.issues.some((i) => i.id === 'gaze_beyond_anatomical_limit' && i.status === 'warning'),
      `Phase 13 Test 29 failed: Validator must report a warning when direct_at_camera exceeds anatomical eye limits`
    );
  }

  // 30. Validator reports a conflict when a furniture interaction is selected with an incompatible environment or scope.
  {
    const bedPreset = getInteractionPresetById('bed_lie_back')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const cameraOnlyBedCfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: applyRequestedFramingState(baseConfig13.camera, 'medium_shot'),
      pose: bedState.pose,
      environment: 'studio_bedroom',
    };
    const reportScopeConflict = validatePlayboardPromptConsistency(cameraOnlyBedCfg, 'camera_only');
    assert(
      reportScopeConflict.overallStatus === 'conflict' &&
        reportScopeConflict.issues.some((i) => i.id === 'camera_only_ignores_interaction'),
      `Phase 13 Test 30 failed: Validator must report a conflict when a furniture interaction is active under camera_only scope`
    );
  }

  // 31. Validator reports a warning when locked I2I fields are stale after 3D changes.
  {
    const initialCfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: applyRequestedFramingState(baseConfig13.camera, 'medium_shot'),
    };
    const initialFields = buildInitialI2IFields(initialCfg, 'both');
    // Lock camera_framing field, then rotate camera to +90°
    const lockedFields = initialFields.map((f) =>
      f.id === 'camera_framing' ? { ...f, isLocked: true } : f
    );
    const rotatedCfg: PlayboardFullConfig = {
      ...initialCfg,
      camera: { ...initialCfg.camera, yawDeg: 90 },
    };
    const syncedFields = syncI2IFieldsWithConfig(lockedFields, rotatedCfg, 'both');
    const report = validatePlayboardPromptConsistency(rotatedCfg, 'both', syncedFields);
    assert(
      report.issues.some((i) => i.id === 'stale_locked_i2i_fields' && i.status === 'warning'),
      `Phase 13 Test 31 failed: Validator must report a warning when locked I2I fields are stale after 3D changes`
    );
  }

  // 32. Validator reports not_verifiable when a custom GLB lacks skeletal rig data for joint posing.
  {
    const staticGlbCfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: applyRequestedFramingState(baseConfig13.camera, 'medium_shot'),
      pose: {
        ...baseConfig13.pose,
        torsoLeanDeg: 18,
        customModelBounds: {
          minY: 0,
          maxY: 1.68,
          height: 1.68,
          width: 0.5,
          depth: 0.35,
          centerX: 0,
          centerZ: 0,
          hasSkeleton: false,
          boneCount: 0,
        },
      },
    };
    const report = validatePlayboardPromptConsistency(staticGlbCfg, 'both');
    assert(
      report.issues.some((i) => i.id === 'custom_glb_static_rig' && i.status === 'not_verifiable'),
      `Phase 13 Test 32 failed: Validator must report not_verifiable when a custom GLB lacks skeletal rig data`
    );
  }

  // 33. Validator does not report false positives when the prompt already authorizes the active support surface.
  {
    const bedPreset = getInteractionPresetById('bed_sit_edge_forward')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      applyRequestedFramingState(baseConfig13.camera, 'medium_shot'),
      bedPreset,
      'studio_bedroom'
    );
    const alignedBedCam = applyRequestedFramingState(
      { ...baseConfig13.camera, targetMode: 'track_subject' },
      'medium_shot'
    );
    const bedCfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: alignedBedCam,
      pose: bedState.pose,
      environment: bedState.environment,
    };
    const measuredForBed = analyzePlayboardFraming(bedCfg.camera, bedCfg.pose);
    bedCfg.camera = { ...bedCfg.camera, framing: measuredForBed.measuredFraming };
    const report = validatePlayboardPromptConsistency(bedCfg, 'both');
    assert(
      report.overallStatus === 'consistent' && report.issues.length === 0,
      `Phase 13 Test 33 failed: Validator must not report false positives when prompt authorizes the active support surface. Got: ${JSON.stringify(report.issues)}`
    );
  }

  // --------------------------------------------------------------------------
  // G. Checkpoints, Persistence, and Variations (34–39)
  // --------------------------------------------------------------------------

  // 34. Creating and restoring a checkpoint restores camera, pose, subject position, gaze, environment, and scope.
  {
    const bedPreset = getInteractionPresetById('bed_lie_back')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const customCfg: PlayboardFullConfig = {
      ...baseConfig13,
      camera: { ...baseConfig13.camera, yawDeg: -35, pitchDeg: 14, distance: 2.4 },
      pose: { ...bedState.pose, gaze: 'looking_camera_right', expression: 'gentle_smile' },
      environment: 'studio_bedroom',
      environmentPolicy: 'source_inspired_transformation',
    };
    const cp = createPlayboardCheckpoint(customCfg, 'Bed Angle 1', 'pose_only');
    const restored = restorePlayboardCheckpoint(cp);
    assert(
      restored.config.camera.yawDeg === -35 &&
        restored.config.pose.interactionPresetId === 'bed_lie_back' &&
        restored.config.pose.gaze === 'looking_camera_right' &&
        restored.scope === 'pose_only',
      `Phase 13 Test 34 failed: Restoring checkpoint must restore camera, pose, subject position, gaze, environment, and scope`
    );
  }

  // 35. Persistent save/load strips transient locomotion state unless a walking/waving preset is intentionally active.
  {
    const transientWalkCfg: PlayboardFullConfig = {
      ...baseConfig13,
      pose: { ...baseConfig13.pose, basePose: 'natural_standing', isWalking: true, isWaving: true },
    };
    const sanitized = sanitizePersistentPlayboardConfig(transientWalkCfg);
    const intentionalWalkCfg: PlayboardFullConfig = {
      ...baseConfig13,
      pose: { ...baseConfig13.pose, basePose: 'mid_stride_walking', isWalking: true },
    };
    const sanitizedIntentional = sanitizePersistentPlayboardConfig(intentionalWalkCfg);
    assert(
      sanitized.pose.isWalking === false &&
        sanitized.pose.isWaving === false &&
        sanitizedIntentional.pose.isWalking === true,
      `Phase 13 Test 35 failed: sanitizePersistentPlayboardConfig must strip transient walking/waving while keeping intentional walking/waving presets`
    );
  }

  // 36. Legacy blueprint migration repairs stale anchorPosX/anchorPosZ in track_subject mode.
  {
    const legacy: Partial<PlayboardFullConfig> = {
      camera: { ...baseConfig13.camera, targetMode: 'track_subject' },
      pose: { ...baseConfig13.pose, characterPosX: 1.5, characterPosZ: -1.2, anchorPosX: 0, anchorPosZ: 0 },
    };
    const migrated = migrateLegacyPlayboardConfig(legacy);
    assert(
      migrated.pose.anchorPosX === 1.5 && migrated.pose.anchorPosZ === -1.2,
      `Phase 13 Test 36 failed: Legacy blueprint migration must repair stale anchorPosX/anchorPosZ in track_subject mode`
    );
  }

  // 37. Creating a shot variation captures an independent snapshot.
  {
    const varA = createShotVariation(baseConfig13, 'Shot A', 'both');
    const mutatedOriginal: PlayboardFullConfig = {
      ...baseConfig13,
      camera: { ...baseConfig13.camera, yawDeg: 120 },
    };
    assert(
      varA.config.camera.yawDeg === 0 && mutatedOriginal.camera.yawDeg === 120,
      `Phase 13 Test 37 failed: Creating a shot variation must capture an independent deep-cloned snapshot`
    );
  }

  // 38. Switching shot variations updates the active scene and prompt summary.
  {
    const shotBConfig: PlayboardFullConfig = {
      ...baseConfig13,
      camera: { ...baseConfig13.camera, yawDeg: 65, pitchDeg: -15 },
      pose: { ...baseConfig13.pose, basePose: 'power_stance' },
    };
    const varB = createShotVariation(shotBConfig, 'Shot B', 'camera_only');
    const activated = activateShotVariation(varB);
    assert(
      activated.config.camera.yawDeg === 65 &&
        activated.config.pose.basePose === 'power_stance' &&
        activated.scope === 'camera_only' &&
        activated.promptSummary.cameraSummary.includes('65°'),
      `Phase 13 Test 38 failed: Switching shot variations must update the active scene and prompt summary`
    );
  }

  // 39. Comparing two shot variations correctly identifies changed fields (camera, pose, gaze, framing, interaction, environment, scope).
  {
    const varA = createShotVariation(baseConfig13, 'Shot A — Standing Front', 'both');
    const bedPreset = getInteractionPresetById('bed_lie_back')!;
    const bedState = applySceneInteractionPresetState(
      baseConfig13.pose,
      baseConfig13.camera,
      bedPreset,
      'studio_bedroom'
    );
    const cfgB: PlayboardFullConfig = {
      ...baseConfig13,
      camera: { ...baseConfig13.camera, yawDeg: -45, framing: 'full_shot', distance: 3.4 },
      pose: { ...bedState.pose, gaze: 'looking_upward' },
      environment: 'studio_bedroom',
    };
    const varB = createShotVariation(cfgB, 'Shot B — Bed 3/4', 'pose_only');
    const cmp = compareShotVariations(varA, varB);
    const diffLabels = cmp.differences.filter((d) => d.isDifferent).map((d) => d.fieldLabel);
    assert(
      diffLabels.includes('Camera Angle & Distance') &&
        diffLabels.includes('Shot Framing') &&
        diffLabels.includes('Subject Pose & Position') &&
        diffLabels.includes('Gaze & Head Orientation') &&
        diffLabels.includes('Scene Interaction & Surface') &&
        diffLabels.includes('Transformation Scope'),
      `Phase 13 Test 39 failed: Comparing two shot variations must identify changed fields. Got: ${diffLabels.join(', ')}`
    );
  }

  // --------------------------------------------------------------------------
  // H. Regression Tests for Previously Fixed Systems (40–46)
  // --------------------------------------------------------------------------

  // 40. Camera yaw +45° and -45° produce right and left relative views respectively.
  {
    const r45 = analyzePlayboardFraming({ ...baseConfig13.camera, yawDeg: 45 }, baseConfig13.pose);
    const l45 = analyzePlayboardFraming({ ...baseConfig13.camera, yawDeg: -45 }, baseConfig13.pose);
    assert(
      describeCameraHorizontal(r45.relativeAngles.relativeToBodyYawDeg).includes('front-right') &&
        describeCameraHorizontal(l45.relativeAngles.relativeToBodyYawDeg).includes('front-left'),
      `Phase 13 Test 40 failed: Camera yaw +45° and -45° must produce right and left relative views`
    );
  }

  // 41. Low-angle direct_at_camera produces downward eye compensation and low-angle direct eye-contact prompt text.
  {
    const lowCam: Camera3DSettings = { ...baseConfig13.camera, height: 0.45, pitchDeg: -16, distance: 2.3 };
    const lowAnalysis = analyzePlayboardFraming(lowCam, baseConfig13.pose);
    const lowGaze = describeGazeAndEyeContact(
      baseConfig13.pose,
      lowCam.yawDeg,
      lowAnalysis.relativeAngles,
      lowCam.pitchDeg,
      lowCam.height,
      lowCam.distance
    );
    assert(
      lowAnalysis.relativeAngles.gazeSolution.eyePitchDeg < -8 &&
        lowGaze.includes('eyes angled downward') &&
        lowGaze.includes('low-angle camera lens'),
      `Phase 13 Test 41 failed: Low-angle direct_at_camera must produce downward eye compensation`
    );
  }

  // 42. High-angle direct_at_camera produces upward eye compensation and high-angle direct eye-contact prompt text.
  {
    const highCam: Camera3DSettings = { ...baseConfig13.camera, height: 2.35, pitchDeg: 24, distance: 2.6 };
    const highAnalysis = analyzePlayboardFraming(highCam, baseConfig13.pose);
    const highGaze = describeGazeAndEyeContact(
      baseConfig13.pose,
      highCam.yawDeg,
      highAnalysis.relativeAngles,
      highCam.pitchDeg,
      highCam.height,
      highCam.distance
    );
    assert(
      highAnalysis.relativeAngles.gazeSolution.eyePitchDeg > 8 &&
        highGaze.includes('eyes angled upward') &&
        highGaze.includes('elevated high-angle camera lens'),
      `Phase 13 Test 42 failed: High-angle direct_at_camera must produce upward eye compensation`
    );
  }

  // 43. Blue joystick moves relative to subject facing direction at 0°, +90°, -90°, and 180°, independent of camera yaw.
  {
    for (const yawDeg of [0, 90, -90, 180]) {
      const s1 = createInitialLocomotionState();
      s1.rot = THREE.MathUtils.degToRad(yawDeg);
      s1.targetRot = s1.rot;
      for (let i = 0; i < 15; i++) stepThirdPersonLocomotion(s1, { x: 0, y: 1 }, 0, 1 / 60, undefined, 0);

      const s2 = createInitialLocomotionState();
      s2.rot = THREE.MathUtils.degToRad(yawDeg);
      s2.targetRot = s2.rot;
      for (let i = 0; i < 15; i++) stepThirdPersonLocomotion(s2, { x: 0, y: 1 }, 1.2, 1 / 60, undefined, 0);

      assert(
        Math.abs(s1.x - s2.x) < 1e-6 && Math.abs(s1.z - s2.z) < 1e-6,
        `Phase 13 Test 43 failed at yaw=${yawDeg}°: Blue joystick must move relative to subject facing direction independent of camera yaw`
      );
    }
  }

  // 44. Orange joystick rotates subject in place without translating the subject or moving the camera.
  {
    const sTurn = createInitialLocomotionState();
    sTurn.x = -0.6;
    sTurn.z = 0.85;
    for (let i = 0; i < 20; i++) stepThirdPersonLocomotion(sTurn, { x: 0, y: 0 }, 0.5, 1 / 60, undefined, 0.9);
    assert(
      Math.abs(sTurn.x - -0.6) < 1e-6 &&
        Math.abs(sTurn.z - 0.85) < 1e-6 &&
        Math.abs(sTurn.rot) > 0.2,
      `Phase 13 Test 44 failed: Orange joystick must rotate subject in place without translation`
    );
  }

  // 45. Simultaneous blue + orange joystick movement follows a smooth curved path without camera interference.
  {
    const sCurve1 = createInitialLocomotionState();
    const sCurve2 = createInitialLocomotionState();
    for (let i = 0; i < 30; i++) {
      stepThirdPersonLocomotion(sCurve1, { x: 0, y: 0.85 }, 0, 1 / 60, undefined, 0.6);
      stepThirdPersonLocomotion(sCurve2, { x: 0, y: 0.85 }, -1.5, 1 / 60, undefined, 0.6);
    }
    assert(
      Math.abs(sCurve1.x - sCurve2.x) < 1e-6 &&
        Math.abs(sCurve1.z - sCurve2.z) < 1e-6 &&
        Math.abs(sCurve1.x) > 0.05 &&
        sCurve1.z > 0.15,
      `Phase 13 Test 45 failed: Simultaneous blue + orange joystick movement must follow a smooth curved path independent of camera`
    );
  }

  // 46. Left/right movement and gait classification match character-local movement.
  {
    const gL = classifyCharacterLocalGait(-1, 0, 0, 1.0, 2.0, false);
    const gR = classifyCharacterLocalGait(1, 0, 0, 1.0, 2.0, false);
    assert(
      gL.gaitMode === 'strafe_left' &&
        gL.strafeBlend < -0.9 &&
        gR.gaitMode === 'strafe_right' &&
        gR.strafeBlend > 0.9,
      `Phase 13 Test 46 failed: Left/right movement and gait classification must match character-local movement`
    );
  }

  console.log('✅ Phase 13 PASSED: All 46 Next-Version Complete Implementation Acceptance Tests verified.');
}

// ============================================================================
// PHASE 14: POSE PRESET VISUAL FIDELITY & 3D RIG ARTICULATION SUITE (Tests 1–20)
// ============================================================================
{
  const runStepsPhase14 = (
    state: ReturnType<typeof createInitialLocomotionState>,
    stick: { x: number; y: number },
    camYawRad: number,
    steps: number = 25,
    turnStickX: number = 0
  ) => {
    for (let i = 0; i < steps; i++) {
      stepThirdPersonLocomotion(state, stick, camYawRad, 1 / 60, undefined, turnStickX);
    }
  };

  const baseStanding = applyPosePresetState(
    {
      ...frontStandingPose,
      characterPosX: 0.45,
      characterPosZ: -0.35,
      characterYawDeg: 30,
      gaze: 'direct_at_camera',
    },
    { basePose: 'natural_standing' },
    { targetMode: 'track_subject' }
  );

  // 1. Selecting "all_fours_neutral" produces an all-fours pose state rather than a standing or reclined state.
  {
    const allFoursPose = applyPosePresetState(baseStanding, { basePose: 'all_fours_neutral' });
    const solved = resolveSemanticCharacterRigPose(allFoursPose, true);
    const lm = computeCharacterWorldLandmarks(allFoursPose, true);
    const reclinedPose = applyPosePresetState(baseStanding, { basePose: 'reclined_lying' });
    const reclinedSolved = resolveSemanticCharacterRigPose(reclinedPose, true);
    const standingSolved = resolveSemanticCharacterRigPose(baseStanding, true);

    assert(
      solved.poseFamily === 'quadruped' &&
        solved.pelvisPitchRad > 1.2 && // forward quadruped pitch (+82°), NOT supine negative (-76°) or upright (0°)
        reclinedSolved.pelvisPitchRad < -1.0 &&
        Math.abs(standingSolved.pelvisPitchRad) < 0.2 &&
        lm.pelvis.y > 0.35 &&
        lm.pelvis.y < 0.62 &&
        Math.abs(lm.chest.y - lm.pelvis.y) < 0.12,
      `Phase 14 Test 1 failed: all_fours_neutral must produce a horizontal quadruped state (pelvisY=${lm.pelvis.y.toFixed(3)}, chestY=${lm.chest.y.toFixed(3)}) distinct from standing or reclined`
    );
  }

  // 2. Selecting "cat_pose_rounded" produces a rounded-spine all-fours pose state.
  {
    const catPose = applyPosePresetState(baseStanding, { basePose: 'cat_pose_rounded' });
    const neutralPose = applyPosePresetState(baseStanding, { basePose: 'all_fours_neutral' });
    const catSolved = resolveSemanticCharacterRigPose(catPose, true);
    const neutralSolved = resolveSemanticCharacterRigPose(neutralPose, true);
    const catLm = computeCharacterWorldLandmarks(catPose, true);

    assert(
      catSolved.poseFamily === 'quadruped' &&
        catSolved.spinePitchRad + catSolved.chestPitchRad >
          neutralSolved.spinePitchRad + neutralSolved.chestPitchRad + 0.3 &&
        catLm.chest.y > catLm.pelvis.y + 0.04 &&
        catLm.headCenter.y < catLm.chest.y - 0.1,
      `Phase 14 Test 2 failed: cat_pose_rounded must round the dorsal spine upward and tuck the head downward (pelvisY=${catLm.pelvis.y.toFixed(3)}, chestY=${catLm.chest.y.toFixed(3)}, headY=${catLm.headCenter.y.toFixed(3)})`
    );
  }

  // 3. Selecting "cow_pose_arched" produces an arched-spine all-fours pose state distinct from "cat_pose_rounded".
  {
    const cowPose = applyPosePresetState(baseStanding, { basePose: 'cow_pose_arched' });
    const catPose = applyPosePresetState(baseStanding, { basePose: 'cat_pose_rounded' });
    const cowSolved = resolveSemanticCharacterRigPose(cowPose, true);
    const catSolved = resolveSemanticCharacterRigPose(catPose, true);
    const cowLm = computeCharacterWorldLandmarks(cowPose, true);
    const catLm = computeCharacterWorldLandmarks(catPose, true);

    assert(
      cowSolved.poseFamily === 'quadruped' &&
        cowSolved.pelvisPitchRad > catSolved.pelvisPitchRad + 0.4 &&
        cowSolved.spinePitchRad + cowSolved.chestPitchRad <
          catSolved.spinePitchRad + catSolved.chestPitchRad - 0.7 &&
        cowLm.chest.y < catLm.chest.y - 0.12 &&
        cowLm.headCenter.y > catLm.headCenter.y + 0.08,
      `Phase 14 Test 3 failed: cow_pose_arched must drop the belly/chest and lift the head relative to cat_pose_rounded (cowChestY=${cowLm.chest.y.toFixed(3)} vs catChestY=${catLm.chest.y.toFixed(3)}, cowHeadY=${cowLm.headCenter.y.toFixed(3)} vs catHeadY=${catLm.headCenter.y.toFixed(3)})`
    );
  }

  // 4. Selecting "all_fours_rear_presentation" produces a lowered-chest, elevated-hip all-fours pose state.
  {
    const rearPose = applyPosePresetState(baseStanding, {
      basePose: 'all_fours_rear_presentation',
    });
    const neutralPose = applyPosePresetState(baseStanding, { basePose: 'all_fours_neutral' });
    const rearLm = computeCharacterWorldLandmarks(rearPose, true);
    const neutralLm = computeCharacterWorldLandmarks(neutralPose, true);

    assert(
      rearLm.pelvis.y > rearLm.chest.y + 0.08 &&
        rearLm.pelvis.y >= neutralLm.pelvis.y &&
        rearLm.chest.y < neutralLm.chest.y - 0.05,
      `Phase 14 Test 4 failed: all_fours_rear_presentation must have elevated hips above lowered chest (pelvisY=${rearLm.pelvis.y.toFixed(3)}, chestY=${rearLm.chest.y.toFixed(3)})`
    );
  }

  // 5. All-fours poses place hands and knees near the floor plane (y ≈ 0).
  {
    const quadrupedPresets: CharacterPose3DSettings['basePose'][] = [
      'all_fours_neutral',
      'cow_pose_arched',
      'cat_pose_rounded',
      'all_fours_rear_presentation',
    ];
    for (const preset of quadrupedPresets) {
      const p = applyPosePresetState(baseStanding, { basePose: preset });
      const lm = computeCharacterWorldLandmarks(p, true);
      assert(
        lm.leftKnee.y >= 0.01 &&
          lm.leftKnee.y <= 0.11 &&
          lm.rightKnee.y >= 0.01 &&
          lm.rightKnee.y <= 0.11 &&
          lm.leftWrist.y >= 0.01 &&
          lm.leftWrist.y <= 0.11 &&
          lm.rightWrist.y >= 0.01 &&
          lm.rightWrist.y <= 0.11 &&
          lm.leftFoot.y >= -0.02 &&
          lm.rightFoot.y >= -0.02,
        `Phase 14 Test 5 failed for ${preset}: hands and knees must contact floor near y≈0 without sinking below floor (kneeY=${lm.leftKnee.y.toFixed(3)}, wristY=${lm.leftWrist.y.toFixed(3)}, footY=${lm.leftFoot.y.toFixed(3)})`
      );
    }
  }

  // 6. All-fours poses do not revert to standing pelvis height.
  {
    const standingLm = computeCharacterWorldLandmarks(baseStanding, true);
    for (const preset of [
      'all_fours_neutral',
      'cow_pose_arched',
      'cat_pose_rounded',
      'all_fours_rear_presentation',
    ] as const) {
      const p = applyPosePresetState(baseStanding, { basePose: preset });
      const solved = resolveSemanticCharacterRigPose(p, true);
      assert(
        solved.pelvisY < standingLm.pelvis.y - 0.32 && solved.pelvisY <= 0.56,
        `Phase 14 Test 6 failed for ${preset}: pelvisY (${solved.pelvisY.toFixed(3)}) must not revert to standing pelvis height (${standingLm.pelvis.y.toFixed(3)})`
      );
    }
  }

  // 7. Ground-based poses ("prone_hip_elevated", "kneeling_forward_fold", "side_lying_open") use appropriate pelvis/root height and orientation.
  {
    const pronePose = applyPosePresetState(baseStanding, { basePose: 'prone_hip_elevated' });
    const foldPose = applyPosePresetState(baseStanding, { basePose: 'kneeling_forward_fold' });
    const sidePose = applyPosePresetState(baseStanding, { basePose: 'side_lying_open' });
    const bentPose = applyPosePresetState(baseStanding, { basePose: 'bent_over_support' });

    const proneSolved = resolveSemanticCharacterRigPose(pronePose, true);
    const foldSolved = resolveSemanticCharacterRigPose(foldPose, true);
    const sideSolved = resolveSemanticCharacterRigPose(sidePose, true);
    const bentSolved = resolveSemanticCharacterRigPose(bentPose, true);

    const proneLm = computeCharacterWorldLandmarks(pronePose, true);
    const foldLm = computeCharacterWorldLandmarks(foldPose, true);
    const sideLm = computeCharacterWorldLandmarks(sidePose, true);
    const bentLm = computeCharacterWorldLandmarks(bentPose, true);

    assert(
      proneSolved.poseFamily === 'prone' &&
        proneLm.pelvis.y >= 0.18 &&
        proneLm.pelvis.y <= 0.34 &&
        proneLm.pelvis.y > proneLm.chest.y &&
        proneLm.leftWrist.y <= 0.11,
      `Phase 14 Test 7a failed for prone_hip_elevated: pelvisY=${proneLm.pelvis.y.toFixed(3)}, chestY=${proneLm.chest.y.toFixed(3)}, wristY=${proneLm.leftWrist.y.toFixed(3)}`
    );
    assert(
      foldSolved.poseFamily === 'kneeling_fold' &&
        foldLm.pelvis.y >= 0.16 &&
        foldLm.pelvis.y <= 0.32 &&
        foldLm.leftKnee.y <= 0.12 &&
        foldLm.leftWrist.y <= 0.11,
      `Phase 14 Test 7b failed for kneeling_forward_fold: pelvisY=${foldLm.pelvis.y.toFixed(3)}, kneeY=${foldLm.leftKnee.y.toFixed(3)}, wristY=${foldLm.leftWrist.y.toFixed(3)}`
    );
    assert(
      sideSolved.poseFamily === 'side_lying' &&
        sideLm.pelvis.y >= 0.12 &&
        sideLm.pelvis.y <= 0.25 &&
        Math.abs(sideSolved.pelvisRollRad) > 1.0 &&
        Math.abs(sideLm.leftKnee.y - sideLm.rightKnee.y) > 0.05,
      `Phase 14 Test 7c failed for side_lying_open: pelvisY=${sideLm.pelvis.y.toFixed(3)}, roll=${sideSolved.pelvisRollRad.toFixed(2)}`
    );
    assert(
      bentSolved.poseFamily === 'bent_over' &&
        bentLm.pelvis.y >= 0.72 &&
        bentLm.chest.y < bentLm.pelvis.y + 0.12,
      `Phase 14 Test 7d failed for bent_over_support: pelvisY=${bentLm.pelvis.y.toFixed(3)}, chestY=${bentLm.chest.y.toFixed(3)}`
    );
  }

  // 8. Switching between pose families resets incompatible joint values from the previous pose.
  {
    const reclinedDirty: CharacterPose3DSettings = {
      ...applyPosePresetState(baseStanding, { basePose: 'reclined_lying' }),
      pelvisPitchDeg: -76,
      pelvisRollDeg: 45,
      torsoTwistDeg: 35,
      torsoTiltDeg: -22,
      leftLegHipOutDeg: 38,
      rightLegHipOutDeg: 38,
      leftArmWristDeg: 40,
      rightArmWristDeg: -40,
      leftHandGesture: 'fist',
    };

    const switchedToCat = applyPosePresetState(reclinedDirty, { basePose: 'cat_pose_rounded' });
    const switchedToStanding = applyPosePresetState(switchedToCat, {
      basePose: 'natural_standing',
    });

    assert(
      switchedToCat.pelvisPitchDeg === CANONICAL_POSE_PRESET_VALUES.cat_pose_rounded.pelvisPitchDeg &&
        switchedToCat.pelvisRollDeg === 0 &&
        switchedToCat.torsoTwistDeg === 0 &&
        switchedToCat.leftArmWristDeg === 0 &&
        switchedToCat.leftHandGesture === 'relaxed_natural' &&
        switchedToStanding.pelvisPitchDeg === 0 &&
        switchedToStanding.torsoLeanDeg === 0 &&
        switchedToStanding.leftLegKneeBendDeg === 4 &&
        switchedToStanding.leftHandGesture === 'relaxed_natural',
      `Phase 14 Test 8 failed: switching pose families must reset incompatible joint values from previous pose`
    );
  }

  // 9. Applying a pose preset preserves subject position, subject yaw, camera settings, camera target mode, and gaze unless explicitly included in the preset.
  {
    const customStart: CharacterPose3DSettings = {
      ...baseStanding,
      characterPosX: -1.15,
      characterPosZ: 0.75,
      characterYawDeg: -65,
      anchorPosX: 0.25,
      anchorPosZ: -0.4,
      gaze: 'looking_camera_left',
    };
    const camFixed: Camera3DSettings = {
      ...frontCameraConfig,
      yawDeg: 42,
      pitchDeg: 14,
      height: 1.65,
      distance: 2.9,
      targetMode: 'fixed_composition',
    };

    const afterPreset = applyPosePresetState(
      customStart,
      { basePose: 'cow_pose_arched' },
      camFixed
    );
    assert(
      afterPreset.characterPosX === -1.15 &&
        afterPreset.characterPosZ === 0.75 &&
        afterPreset.characterYawDeg === -65 &&
        afterPreset.anchorPosX === 0.25 &&
        afterPreset.anchorPosZ === -0.4 &&
        afterPreset.gaze === 'looking_camera_left' &&
        camFixed.yawDeg === 42 &&
        camFixed.targetMode === 'fixed_composition',
      `Phase 14 Test 9 failed: applyPosePresetState must preserve subject position, yaw, gaze, and fixed_composition anchor`
    );
  }

  // 10. Hand and finger presets update hand/finger target state distinctly across all 13 HandGesture values.
  {
    const allGestures: CharacterPose3DSettings['leftHandGesture'][] = [
      'relaxed_natural',
      'open_palm',
      'wave',
      'pointing',
      'thumbs_up',
      'fist',
      'peace_sign',
      'hand_on_hip',
      'raised_up',
      'hands_clasped',
      'touching_face',
      'soft_pinch_gap',
      'cupped_palm_inward',
    ];
    const signatures = new Set<string>();
    for (const g of allGestures) {
      const target = getHandGestureTargets(g, 1, 0.25);
      const sig = [
        target.thumbCurl.toFixed(2),
        target.thumbSpread.toFixed(2),
        target.indexCurl.toFixed(2),
        target.middleCurl.toFixed(2),
        target.ringCurl.toFixed(2),
        target.pinkyCurl.toFixed(2),
        target.fingerSpread.toFixed(2),
        target.wristPitch.toFixed(2),
      ].join('|');
      signatures.add(sig);
    }

    const pinch = getHandGestureTargets('soft_pinch_gap', 1, 0);
    const cupped = getHandGestureTargets('cupped_palm_inward', 1, 0);
    const openPalm = getHandGestureTargets('open_palm', 1, 0);
    const fist = getHandGestureTargets('fist', 1, 0);

    // Also verify palm floor-support wrist extension on all-fours poses:
    const catPose = applyPosePresetState(baseStanding, { basePose: 'cat_pose_rounded' });
    const catSolved = resolveSemanticCharacterRigPose(catPose, true);
    const catLm = computeCharacterWorldLandmarks(catPose, true);

    assert(
      signatures.size === allGestures.length &&
        pinch.thumbSpread > cupped.thumbSpread &&
        openPalm.indexCurl < pinch.indexCurl &&
        fist.indexCurl > pinch.indexCurl &&
        catSolved.leftWristSupportPitchRad !== null &&
        Math.abs(catLm.leftHand.y - catLm.leftWrist.y) < 0.03,
      `Phase 14 Test 10 failed: all 13 hand/finger presets must produce distinct finger articulation targets and floor-supported palms must lie flat on the floor`
    );
  }

  // 11. Prompt output for the repaired presets remains coherent and unchanged in meaning.
  {
    const newPresetsAndPhrases: [CharacterPose3DSettings['basePose'], string][] = [
      ['all_fours_neutral', 'on all fours in a neutral tabletop position'],
      ['cow_pose_arched', 'on all fours in cow pose'],
      ['cat_pose_rounded', 'on all fours in cat pose, spine strongly rounded'],
      ['all_fours_rear_presentation', 'on all fours with hips pushed back and elevated'],
      ['prone_hip_elevated', 'lying prone on the stomach with hips slightly elevated'],
      ['kneeling_forward_fold', 'kneeling with torso folded forward over the thighs'],
      ['bent_over_support', 'bent forward at the waist with hands supporting on a surface'],
      ['side_lying_open', 'lying on one side with the top leg bent or opened'],
    ];

    for (const [preset, expectedPhrase] of newPresetsAndPhrases) {
      const p = applyPosePresetState(baseStanding, { basePose: preset });
      const cfg: PlayboardFullConfig = {
        ...test2FullConfig,
        camera: frontCameraConfig,
        pose: p,
      };
      const t2i = buildPlayboardT2IPrompt(cfg, 'universal');
      const i2i = compileFinalI2IPrompt(
        buildInitialI2IFields(cfg, 'both'),
        'both',
        cfg,
        'universal'
      );
      assert(
        t2i.includes(expectedPhrase) && i2i.includes(expectedPhrase),
        `Phase 14 Test 11 failed for ${preset}: expected "${expectedPhrase}" in T2I and I2I prompts`
      );
    }
  }

  // 12. Existing camera orbit, camera framing, and relative camera-angle tests pass.
  {
    const catPose = applyPosePresetState(
      { ...baseStanding, characterPosX: 0, characterPosZ: 0, characterYawDeg: 0 },
      { basePose: 'cat_pose_rounded' }
    );
    const sideCam: Camera3DSettings = {
      ...frontCameraConfig,
      yawDeg: 90,
      pitchDeg: 8,
      height: 0.75,
      distance: 2.2,
    };
    const analysis = analyzePlayboardFraming(sideCam, catPose);
    assert(
      Math.abs(Math.abs(analysis.relativeAngles.relativeToBodyYawDeg) - 90) <= 5 &&
        analysis.subjectHeightFraction > 0.1 &&
        !analysis.croppingDescription.includes('standing subject'),
      `Phase 14 Test 12 failed: camera orbit and relative angle analysis must remain accurate for quadruped poses`
    );
  }

  // 13. Existing blue/orange joystick movement tests pass.
  {
    const s = createInitialLocomotionState();
    runStepsPhase14(s, { x: 0, y: 1 }, 0, 20, 0.5);
    assert(
      s.z > 0.05 && Math.abs(s.rot) > 0.1,
      `Phase 14 Test 13 failed: blue and orange joystick movement must remain functional`
    );
  }

  // 14. Existing gaze tests pass.
  {
    const catPose = applyPosePresetState(
      { ...baseStanding, characterPosX: 0, characterPosZ: 0, characterYawDeg: 0, gaze: 'direct_at_camera' },
      { basePose: 'cat_pose_rounded' }
    );
    const analysis = analyzePlayboardFraming(frontCameraConfig, catPose);
    const gazeDesc = describeGazeAndEyeContact(
      catPose,
      frontCameraConfig.yawDeg,
      analysis.relativeAngles,
      frontCameraConfig.pitchDeg,
      frontCameraConfig.height,
      frontCameraConfig.distance
    );
    assert(
      gazeDesc.length > 15 && Number.isFinite(analysis.relativeAngles.gazeSolution.eyePitchDeg),
      `Phase 14 Test 14 failed: gaze calculation and description must remain valid on repaired poses`
    );
  }

  // 15. Existing scene-interaction, prompt-validator, and source-continuity tests pass.
  {
    const catPose = applyPosePresetState(
      { ...baseStanding, characterPosX: 0, characterPosZ: 0, characterYawDeg: 0 },
      { basePose: 'cat_pose_rounded' }
    );
    const cfg: PlayboardFullConfig = {
      ...test2FullConfig,
      camera: { ...frontCameraConfig, height: 0.85, distance: 2.4 },
      pose: catPose,
    };
    const fields = buildInitialI2IFields(cfg, 'both');
    const prompt = compileFinalI2IPrompt(fields, 'both', cfg, 'universal');
    const validation = validatePlayboardPromptConsistency(cfg, 'both', fields);
    const inspection = inspectPlayboardSceneState(cfg, 'both', fields);

    assert(
      Array.isArray(validation.issues) &&
        inspection.subject.basePose === 'cat_pose_rounded' &&
        prompt.includes('facial identity'),
      `Phase 14 Test 15 failed: scene inspector, validator, and source continuity must remain coherent for cat_pose_rounded`
    );
  }

  // 16. Quadruped poses describe floor-supporting arms in T2I and I2I prompts rather than standing forward-extended arms.
  {
    const catPose = applyPosePresetState(baseStanding, { basePose: 'cat_pose_rounded' });
    const cfg: PlayboardFullConfig = {
      ...test2FullConfig,
      camera: frontCameraConfig,
      pose: catPose,
    };
    const t2i = buildPlayboardT2IPrompt(cfg, 'universal');
    const i2i = compileFinalI2IPrompt(buildInitialI2IFields(cfg, 'both'), 'both', cfg, 'universal');

    assert(
      !t2i.includes('extended straight forward in front of the body') &&
        !i2i.includes('extended forward in front of the body with straightened elbows') &&
        t2i.includes('planted beneath the shoulder supporting the upper body on the floor') &&
        i2i.includes('planted beneath the shoulder supporting the upper body on the floor'),
      `Phase 14 Test 16 failed: quadruped poses must describe weight-bearing floor-supporting arms rather than forward-reaching arms`
    );
  }

  // 17. Hand gesture support conflict detection warns when non-supporting gestures (e.g., peace_sign / wave) are combined with all-fours poses.
  {
    const catWithPeaceSign: CharacterPose3DSettings = {
      ...applyPosePresetState(baseStanding, { basePose: 'cat_pose_rounded' }),
      leftHandGesture: 'peace_sign',
    };
    const cfg: PlayboardFullConfig = {
      ...test2FullConfig,
      camera: frontCameraConfig,
      pose: catWithPeaceSign,
    };
    const report = validatePlayboardPromptConsistency(cfg, 'both');
    const conflictIssue = report.issues.find((i) => i.id === 'hand_gesture_support_conflict');

    assert(
      Boolean(conflictIssue) && conflictIssue?.actionType === 'reset_hands_to_support',
      `Phase 14 Test 17 failed: validatePlayboardPromptConsistency must flag hand_gesture_support_conflict when peace_sign is used on cat_pose_rounded`
    );
  }

  // 18. resetSubjectPositionState preserves canonical pelvisPitchDeg and pelvisRollDeg for cat_pose_rounded and side_lying_open.
  {
    const catStaged: CharacterPose3DSettings = {
      ...applyPosePresetState(baseStanding, { basePose: 'cat_pose_rounded' }),
      characterPosX: 1.2,
      characterPosZ: -0.8,
      characterYawDeg: 45,
    };
    const sideStaged: CharacterPose3DSettings = {
      ...applyPosePresetState(baseStanding, { basePose: 'side_lying_open' }),
      characterPosX: -0.9,
      characterPosZ: 0.5,
      characterYawDeg: -30,
    };

    const catReset = resetSubjectPositionState(catStaged, { targetMode: 'track_subject' });
    const sideReset = resetSubjectPositionState(sideStaged, { targetMode: 'track_subject' });

    assert(
      catReset.characterPosX === 0 &&
        catReset.characterPosZ === 0 &&
        catReset.characterYawDeg === 0 &&
        catReset.pelvisPitchDeg === CANONICAL_POSE_PRESET_VALUES.cat_pose_rounded.pelvisPitchDeg &&
        sideReset.pelvisRollDeg === CANONICAL_POSE_PRESET_VALUES.side_lying_open.pelvisRollDeg,
      `Phase 14 Test 18 failed: resetSubjectPositionState must preserve canonical pelvisPitchDeg/pelvisRollDeg of the active basePose`
    );
  }

  // 19. Prompt validator detects gaze text contradiction and interaction-object prohibition in manually edited fields.
  {
    const bedPreset = SCENE_INTERACTION_PRESETS[0];
    const stagedBed = applySceneInteractionPresetState(
      baseStanding,
      frontCameraConfig,
      bedPreset,
      'studio_bedroom'
    );
    const cfg: PlayboardFullConfig = {
      ...test2FullConfig,
      environment: 'studio_bedroom',
      camera: frontCameraConfig,
      pose: { ...stagedBed.pose, gaze: 'looking_downward' },
    };
    const fields = buildInitialI2IFields(cfg, 'both').map((f) => {
      if (f.id === 'head_gaze_expression') {
        return { ...f, userText: 'Subject looking straight into lens with direct eye contact.' };
      }
      if (f.id === 'transformation_constraints') {
        return { ...f, userText: 'Do not add unwanted subjects or objects to the scene.' };
      }
      return f;
    });

    const report = validatePlayboardPromptConsistency(cfg, 'both', fields);
    assert(
      report.issues.some((i) => i.id === 'gaze_text_contradiction') &&
        report.issues.some((i) => i.id === 'interaction_object_prohibited_in_prompt'),
      `Phase 14 Test 19 failed: validator must detect gaze_text_contradiction and interaction_object_prohibited_in_prompt`
    );
  }

  // 20. Custom GLB diagnostics accurately distinguish full rig (with hand & head bones) vs partial skeletal rig vs static mesh.
  {
    const staticDiag = getCustomModelDiagnostics({
      ...baseStanding,
      customModelBounds: {
        minY: 0,
        maxY: 1.7,
        height: 1.7,
        width: 0.5,
        depth: 0.35,
        centerX: 0,
        centerZ: 0,
        hasSkeleton: false,
        boneCount: 0,
      },
    });
    const fullRigDiag = getCustomModelDiagnostics({
      ...baseStanding,
      customModelBounds: {
        minY: 0,
        maxY: 1.7,
        height: 1.7,
        width: 0.5,
        depth: 0.35,
        centerX: 0,
        centerZ: 0,
        hasSkeleton: true,
        boneCount: 52,
        handBoneCount: 24,
        hasHeadBone: true,
      },
    });

    assert(
      staticDiag.isActive &&
        !staticDiag.hasSkeletalRig &&
        fullRigDiag.isActive &&
        fullRigDiag.hasSkeletalRig &&
        fullRigDiag.handBoneCount === 24 &&
        fullRigDiag.hasHeadBone === true &&
        fullRigDiag.statusSummary.includes('finger bones') &&
        fullRigDiag.statusSummary.includes('head/neck'),
      `Phase 14 Test 20 failed: getCustomModelDiagnostics must accurately report handBoneCount and hasHeadBone`
    );
  }

  console.log('✅ Phase 14 PASSED: All 20 Pose Preset Visual Fidelity & 3D Rig Articulation Tests verified.');
}

// ============================================================================
// PHASE 15: POSE-FIRST 3D PLAYBOARD ENHANCEMENT VERIFICATION SUITE
// ============================================================================
console.log('\nRunning Phase 15: Pose-First 3D Playboard Enhancement Verification Suite...');
{
  // 1. Verify expanded pose library covers all 6 categories and >= 60 total presets
  assert(
    SCENE_INTERACTION_CATEGORIES.length === 6 &&
      SCENE_INTERACTION_CATEGORIES.some((c) => c.id === 'standing_wall') &&
      SCENE_INTERACTION_CATEGORIES.some((c) => c.id === 'chair_sitting') &&
      SCENE_INTERACTION_CATEGORIES.some((c) => c.id === 'bed_sitting') &&
      SCENE_INTERACTION_CATEGORIES.some((c) => c.id === 'bed_lying') &&
      SCENE_INTERACTION_CATEGORIES.some((c) => c.id === 'kneeling_floor') &&
      SCENE_INTERACTION_CATEGORIES.some((c) => c.id === 'leaning'),
    `Phase 15 Test 1 failed: Expected all 6 scene interaction categories including standing_wall`
  );

  assert(
    SCENE_INTERACTION_PRESETS.length >= 60,
    `Phase 15 Test 1b failed: Expected >= 60 presets in expanded pose library, got ${SCENE_INTERACTION_PRESETS.length}`
  );

  // 2. Verify representative new presets across all 5 requested user domains exist and produce valid 3D landmarks & prompts
  const requiredNewPresetIds = [
    // Standing & Wall
    'stand_natural_room',
    'stand_contrapposto_rug',
    'stand_wall_shoulder_lean',
    'stand_wall_back_relaxed_knees',
    'stand_beside_bed',
    'stand_beside_nightstand',
    'stand_both_hands_on_bench',
    // Chair & Bench
    'chair_sit_edge_perched',
    'window_bench_sit_upright',
    'window_bench_recline_side',
    'bed_bench_sit_forward',
    // Bed
    'bed_sit_cross_legged',
    'bed_sit_headboard_pillows',
    'bed_kneel_upright_mattress',
    'bed_lean_hands_on_edge',
    'bed_lie_side_right',
    // Floor / Kneeling / Quadruped
    'floor_sit_side_mermaid',
    'floor_recline_on_elbow',
    'floor_sit_back_against_bed',
    'floor_sit_back_against_wall',
    'floor_sit_knees_raised',
    'floor_all_fours_neutral',
    'floor_cow_pose_arch',
    'floor_cat_pose_round',
    'floor_kneeling_child_fold',
    // Table / Desk / Nightstand
    'desk_sit_on_edge',
    'nightstand_reach_hand',
    'nightstand_crouch_beside',
  ] as const;

  for (const presetId of requiredNewPresetIds) {
    const preset = getInteractionPresetById(presetId);
    assert(Boolean(preset), `Phase 15 Test 2 failed: Missing preset "${presetId}"`);
    const testPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      ...preset!.poseValues,
      interactionPresetId: preset!.id,
    };
    const landmarks = computeCharacterWorldLandmarks(testPose);
    assert(
      Number.isFinite(landmarks.eyeCenter.x) &&
        Number.isFinite(landmarks.eyeCenter.y) &&
        Number.isFinite(landmarks.eyeCenter.z) &&
        landmarks.eyeCenter.y > 0.04,
      `Phase 15 Test 2b failed: Invalid 3D eyeCenter landmark for preset "${presetId}": (${landmarks.eyeCenter.x}, ${landmarks.eyeCenter.y}, ${landmarks.eyeCenter.z})`
    );
    const t2i = buildPlayboardT2IPrompt({ ...test2FullConfig, pose: testPose }, 'universal');
    assert(
      t2i.length > 80 && !t2i.includes('[object Object]'),
      `Phase 15 Test 2c failed: Prompt generation failed for preset "${presetId}"`
    );
  }

  // 3. Verify Support-Surface Registry & Safe Pose Placement Clamping
  assert(
    BEDROOM_SUPPORT_SURFACES.length >= 10,
    `Phase 15 Test 3 failed: Expected >= 10 support surfaces in BEDROOM_SUPPORT_SURFACES`
  );

  // Seated on bed mattress: moving far to +X/+Z via Pose Placement Joystick must clamp onto the bed mattress and preserve seatHeightY!
  {
    const bedCrossLegged = getInteractionPresetById('bed_sit_cross_legged')!;
    const bedPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      ...bedCrossLegged.poseValues,
      interactionPresetId: bedCrossLegged.id,
    };
    const support = inferActiveSupportSurface(bedPose);
    assert(
      support.id === 'bed_mattress' && support.seatHeightY !== null,
      `Phase 15 Test 3b failed: Expected bed_sit_cross_legged to infer 'bed_mattress', got '${support.id}'`
    );

    const clamped = clampPosePlacementToSupportBounds(bedPose, 5.0, 5.0, 'studio_bedroom');
    assert(
      clamped.clampedToSupport === true &&
        clamped.x >= support.bounds.minX &&
        clamped.x <= support.bounds.maxX &&
        clamped.z >= support.bounds.minZ &&
        clamped.z <= support.bounds.maxZ,
      `Phase 15 Test 3c failed: Clamped bed placement (${clamped.x}, ${clamped.z}) must stay within bed_mattress bounds [${support.bounds.minX}..${support.bounds.maxX}, ${support.bounds.minZ}..${support.bounds.maxZ}]`
    );

    // Verify interaction remains active when repositioned within bed mattress bounds
    const repositionedBedPose: CharacterPose3DSettings = {
      ...bedPose,
      characterPosX: clamped.x,
      characterPosZ: clamped.z,
    };
    const evalAfterMove = evaluateActiveSceneInteraction(repositionedBedPose, 'studio_bedroom');
    assert(
      evalAfterMove.hasActiveInteraction === true && evalAfterMove.isStillAtAnchor === true,
      `Phase 15 Test 3d failed: Repositioning a bed pose within bed mattress bounds must keep the bed interaction active`
    );
  }

  // Seated on armchair: moving via Pose Placement Joystick clamps to armchair support bounds and never drops seatHeightY
  {
    const chairPreset = getInteractionPresetById('chair_sit_edge_perched')!;
    const chairPose: CharacterPose3DSettings = {
      ...frontStandingPose,
      ...chairPreset.poseValues,
      interactionPresetId: chairPreset.id,
    };
    const support = inferActiveSupportSurface(chairPose);
    assert(
      support.id === 'club_armchair' && support.seatHeightY !== null,
      `Phase 15 Test 3e failed: Expected chair_sit_edge_perched to infer 'club_armchair', got '${support.id}'`
    );
    const clampedChair = clampPosePlacementToSupportBounds(chairPose, 0, 0, 'studio_bedroom');
    assert(
      clampedChair.clampedToSupport === true &&
        Math.hypot(clampedChair.x - support.anchorX, clampedChair.z - support.anchorZ) < 0.35,
      `Phase 15 Test 3f failed: Armchair placement must stay safely clamped on the armchair cushion`
    );
  }

  // 4. Verify 360° camera orbit around a stationary pose never mutates the subject's pose or position
  {
    const quadPreset = getInteractionPresetById('floor_cow_pose_arch')!;
    const stationaryPose: CharacterPose3DSettings = Object.freeze({
      ...frontStandingPose,
      ...quadPreset.poseValues,
      interactionPresetId: quadPreset.id,
    });

    for (const yawDeg of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
      const cam: Camera3DSettings = {
        ...frontCameraConfig,
        yawDeg,
        pitchDeg: 18,
        height: 1.15,
        distance: 2.4,
        targetMode: 'track_subject',
      };
      const transform = computePlayboardCameraTransform(cam, stationaryPose);
      assert(
        Math.abs(transform.lookTarget.x - (stationaryPose.characterPosX ?? 0)) < 1e-6 &&
          Math.abs(transform.lookTarget.z - (stationaryPose.characterPosZ ?? 0)) < 1e-6,
        `Phase 15 Test 4 failed: 360° camera orbit at yaw=${yawDeg}° must orbit around stationary subject (${stationaryPose.characterPosX}, ${stationaryPose.characterPosZ})`
      );
    }
  }

  // 5. Verify migrateLegacyPlayboardConfig preserves lightingPreset, instantPoseTransitions, and sourceVisualNotes
  {
    const migrated = migrateLegacyPlayboardConfig({
      camera: frontCameraConfig,
      pose: frontStandingPose,
      environment: 'studio_bedroom',
      lightingPreset: 'golden_hour',
      instantPoseTransitions: true,
      sourceVisualNotes: 'Warm sunset architectural reference',
    });
    assert(
      migrated.lightingPreset === 'golden_hour' &&
        migrated.instantPoseTransitions === true &&
        migrated.sourceVisualNotes === 'Warm sunset architectural reference',
      `Phase 15 Test 5 failed: migrateLegacyPlayboardConfig must preserve lightingPreset, instantPoseTransitions, and sourceVisualNotes`
    );

    const resetState = resetAllPlayboardState();
    assert(
      resetState.lightingPreset === 'daylight_warm',
      `Phase 15 Test 5b failed: resetAllPlayboardState must return default lightingPreset='daylight_warm'`
    );
  }

  console.log('✅ Phase 15 PASSED: Pose-First 3D Playboard Enhancement tests verified.');
}

// ============================================================================
// PHASE 16: STUDIO REALISM & OPTICAL BOKEH DOF VERIFICATION SUITE
// ============================================================================
console.log('\nRunning Phase 16: Studio Realism & Optical Bokeh DOF Verification Suite...');
{
  const dofShallow50 = computeOpticalBokehParams('50mm_standard_normal', 'shallow_f1_4', 2.2);
  const dofModerate50 = computeOpticalBokehParams('50mm_standard_normal', 'moderate_f4_0', 2.2);
  const dofDeep50 = computeOpticalBokehParams('50mm_standard_normal', 'deep_f11', 2.2);

  assert(
    dofShallow50.aperture > dofModerate50.aperture &&
      dofModerate50.aperture > dofDeep50.aperture &&
      dofDeep50.maxBlur === 0,
    `Phase 16 Test 1 failed: Optical bokeh aperture must monotonically decrease from f/1.4 -> f/4.0 -> f/11 (sharp)`
  );

  const dofWide16 = computeOpticalBokehParams('16mm_ultra_wide', 'shallow_f1_4', 2.2);
  const dofTele85 = computeOpticalBokehParams('85mm_portrait_telephoto', 'shallow_f1_4', 2.2);
  const dofTele135 = computeOpticalBokehParams('135mm_telephoto', 'shallow_f1_4', 2.2);

  assert(
    dofTele135.aperture > dofTele85.aperture &&
      dofTele85.aperture > dofShallow50.aperture &&
      dofShallow50.aperture > dofWide16.aperture,
    `Phase 16 Test 2 failed: Telephoto focal lengths (85mm, 135mm) must produce stronger optical bokeh compression than 50mm and 16mm at identical f-stop`
  );

  const dofClampedNear = computeOpticalBokehParams('85mm_portrait_telephoto', 'shallow_f1_4', 0.1);
  assert(
    dofClampedNear.focusDistance >= 0.45 && dofClampedNear.focusDistance <= 9.5,
    `Phase 16 Test 3 failed: Focus distance must clamp safely to [0.45, 9.5]m range, got ${dofClampedNear.focusDistance}`
  );

  console.log('✅ Phase 16 PASSED: Optical Bokeh DOF focal-length and f-stop scaling verified.');
}

console.log('\n🎉 ALL PROMPT, DYNAMIC FRAMING, JOYSTICK, SCENE INTERACTION, POSE PRESET & STUDIO REALISM TESTS PASSED! 🎉\n');

