import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { CameraAiBaseAnalysis } from '../../types';
import {
  extractCameraStateFromThree,
  fovDegToFocalLengthMm,
  focalLengthMmToFovDeg,
  ASPECT_RATIO_VALUES,
} from '../perspectivePlayboard/cameraExtractor';
import {
  sphericalToWorldPosition,
  applyCameraRollToCamera,
  CAMERA_PRESETS,
  DEFAULT_CAMERA_CONFIG,
} from '../perspectivePlayboard/cameraController';
import { mapBaseAnalysisToSourceAnalysis } from '../perspectivePlayboard/sourceImageAnalysis';
import {
  compareSourceAndTarget,
  validateTransformationConsistency,
} from '../perspectivePlayboard/comparisonAndValidation';
import { compilePerspectivePrompt } from '../perspectivePlayboard/promptCompiler';
import type {
  LockedCameraFrame,
  PreservationPreferences,
  CameraStateSnapshot,
} from '../perspectivePlayboard/types';

console.log('--- Running 3D Camera Perspective Playboard Test Suite ---');

const BASE_PRESERVATION: PreservationPreferences = {
  preserveIdentityAndFace: true,
  preserveHairAndFeatures: true,
  preserveClothingAndAccessories: true,
  preserveBodyProportions: true,
  preservePoseAndOrientation: true,
  preserveExpression: true,
  preserveEnvironmentAndLighting: true,
  preserveColorsAndTextures: true,
  requirePixelIdenticalComposition: false,
  requireFullBodyVisibleInOutput: false,
  requireFrontDetailsDirectlyVisible: false,
  additionalUserNotes: '',
};

function createTestSnapshot(opts: {
  azimuthDeg: number;
  elevationDeg: number;
  distanceMeters: number;
  focalLengthMm: number;
  rollDeg?: number;
  targetY?: number;
  aspectRatio?: '3:4' | '16:9' | '1:1' | '9:16' | '4:5' | '2:3' | '4:3';
}): { camera: THREE.PerspectiveCamera; snapshot: CameraStateSnapshot } {
  const aspectRatio = opts.aspectRatio || '3:4';
  const aspect = ASPECT_RATIO_VALUES[aspectRatio];
  const fov = focalLengthMmToFovDeg(opts.focalLengthMm);
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
  const targetVec = { x: 0, y: opts.targetY ?? 1.02, z: 0 };
  const target = new THREE.Vector3(targetVec.x, targetVec.y, targetVec.z);

  const pos = sphericalToWorldPosition(
    opts.azimuthDeg,
    opts.elevationDeg,
    opts.distanceMeters,
    targetVec
  );
  camera.position.copy(pos);
  camera.lookAt(target);
  applyCameraRollToCamera(camera, opts.rollDeg ?? 0);

  const width = 720;
  const height = Math.round(width / aspect);
  const snapshot = extractCameraStateFromThree({
    camera,
    target,
    rollDeg: opts.rollDeg ?? 0,
    aspectRatio,
    viewportWidth: width,
    viewportHeight: height,
  });

  return { camera, snapshot };
}

// ---------------------------------------------------------------------------
// Scenario A: Spherical Camera Orbit Round-Trip & Subject World Immutability
// ---------------------------------------------------------------------------
{
  const { camera, snapshot } = createTestSnapshot({
    azimuthDeg: 42,
    elevationDeg: 24,
    distanceMeters: 3.4,
    focalLengthMm: 35,
    rollDeg: 0,
  });

  assert.ok(Math.abs(snapshot.azimuthDeg - 42) <= 0.2, 'Azimuth round-trip should match 42°');
  assert.ok(Math.abs(snapshot.elevationDeg - 24) <= 0.2, 'Elevation round-trip should match 24°');
  assert.ok(Math.abs(snapshot.pitchDeg - -24) <= 0.2, 'Pitch should be -elevation');
  assert.ok(Math.abs(snapshot.distanceMeters - 3.4) <= 0.02, 'Distance round-trip should match 3.4m');
  assert.equal(snapshot.focalLengthMm, 35, 'Focal length round-trip should match 35mm');
  assert.equal(snapshot.projectionType, 'perspective');
  assert.ok(snapshot.worldPosition.x > 0, 'Positive azimuth places camera at +X (camera-right)');
  assert.ok(snapshot.worldPosition.z > 0, '42° azimuth places camera in front (+Z) hemisphere');

  // Verify camera.position itself wasn't shifted near origin and remains at distanceMeters from target
  const target = new THREE.Vector3(
    snapshot.targetPosition.x,
    snapshot.targetPosition.y,
    snapshot.targetPosition.z
  );
  assert.ok(Math.abs(camera.position.distanceTo(target) - 3.4) < 0.01);
  console.log('✓ Scenario A passed: Spherical orbit math & world-space coordinates are exact');
}

// ---------------------------------------------------------------------------
// Scenario B: Camera Roll, Focal Length / FOV Math, and Shot Size Classification
// ---------------------------------------------------------------------------
{
  const fov50 = focalLengthMmToFovDeg(50);
  assert.equal(fovDegToFocalLengthMm(fov50), 50, '50mm <-> FOV round-trip must be exact');

  const { camera: rolledCam, snapshot: rolledSnap } = createTestSnapshot({
    azimuthDeg: -35,
    elevationDeg: -18,
    distanceMeters: 2.9,
    focalLengthMm: 28,
    rollDeg: 12,
    aspectRatio: '16:9',
  });

  const basePosBeforeRoll = rolledCam.position.clone();
  assert.equal(rolledSnap.rollDeg, 12, 'Roll angle preserved deterministically');
  assert.equal(rolledSnap.aspectRatio, '16:9');
  assert.ok(basePosBeforeRoll.y < 1.02, 'Negative elevation places camera lower than target');

  // Close-up headshot preset check
  const cuPreset = CAMERA_PRESETS.find((p) => p.id === 'closeup_headshot')!;
  const { snapshot: cuSnap } = createTestSnapshot({
    azimuthDeg: cuPreset.azimuthDeg,
    elevationDeg: cuPreset.elevationDeg,
    distanceMeters: cuPreset.distanceMeters,
    focalLengthMm: cuPreset.focalLengthMm,
    targetY: cuPreset.targetOffset.y,
  });
  assert.ok(
    cuSnap.shotSize === 'Close-Up (CU)' ||
      cuSnap.shotSize === 'Medium Close-Up (MCU)' ||
      cuSnap.shotSize === 'Extreme Close-Up (ECU)',
    `Close-up preset classified as tight framing (got ${cuSnap.shotSize})`
  );

  // Overhead preset check
  const ohPreset = CAMERA_PRESETS.find((p) => p.id === 'overhead')!;
  const { snapshot: ohSnap } = createTestSnapshot({
    azimuthDeg: ohPreset.azimuthDeg,
    elevationDeg: ohPreset.elevationDeg,
    distanceMeters: ohPreset.distanceMeters,
    focalLengthMm: ohPreset.focalLengthMm,
    targetY: ohPreset.targetOffset.y,
  });
  assert.ok(ohSnap.elevationLabel.includes("Overhead") || ohSnap.elevationLabel.includes("bird's-eye"));
  console.log('✓ Scenario B passed: Roll, focal/FOV inversion, and shot-size classification');
}

// ---------------------------------------------------------------------------
// Scenario C: Frame Locking — Locked Numbers Match Prompt Numbers 1:1
// ---------------------------------------------------------------------------
{
  const { snapshot } = createTestSnapshot({
    azimuthDeg: -52,
    elevationDeg: 36,
    distanceMeters: 3.15,
    focalLengthMm: 35,
    rollDeg: -8,
    aspectRatio: '4:5',
  });

  const lockedFrame: LockedCameraFrame = {
    isLocked: true,
    lockedAt: 1700000000000,
    cameraState: snapshot,
  };

  const compiled = compilePerspectivePrompt({
    lockedFrame,
    sourceAnalysis: null,
    preservation: BASE_PRESERVATION,
    targetModel: 'universal',
  });

  const sections = [
    '1. TASK OBJECTIVE',
    '2. SOURCE IMAGE UNDERSTANDING',
    '3. ORIGINAL CAMERA PERSPECTIVE',
    '4. TARGET CAMERA PERSPECTIVE',
    '5. REQUIRED CAMERA TRANSFORMATION',
    '6. ELEMENTS THAT MUST REMAIN UNCHANGED',
    '7. VISUAL CONSISTENCY REQUIREMENTS',
    '8. HANDLING OF PREVIOUSLY HIDDEN OR UNSEEN DETAILS',
    '9. FINAL OUTPUT REQUIREMENTS',
  ];
  for (const heading of sections) {
    assert.ok(compiled.fullText.includes(heading), `Prompt must include section "${heading}"`);
  }

  assert.ok(compiled.sections.targetCameraPerspective.includes(`${snapshot.azimuthDeg}°`));
  assert.ok(compiled.sections.targetCameraPerspective.includes(`${snapshot.elevationDeg}°`));
  assert.ok(compiled.sections.targetCameraPerspective.includes(`${snapshot.pitchDeg}°`));
  assert.ok(compiled.sections.targetCameraPerspective.includes(`${snapshot.distanceMeters}m`));
  assert.ok(compiled.sections.targetCameraPerspective.includes(`${snapshot.focalLengthMm}mm`));
  assert.ok(compiled.sections.targetCameraPerspective.includes(`${snapshot.aspectRatio}`));
  assert.ok(compiled.sections.targetCameraPerspective.includes('8° counter-clockwise Dutch tilt'));
  console.log('✓ Scenario C passed: Locked CameraStateSnapshot values match 9-section prompt 1:1');
}

// ---------------------------------------------------------------------------
// Scenario D: Camera-First Mode (No Source Image) Never Fabricates Source Camera
// ---------------------------------------------------------------------------
{
  const { snapshot } = createTestSnapshot({
    azimuthDeg: 65,
    elevationDeg: 18,
    distanceMeters: DEFAULT_CAMERA_CONFIG.distanceMeters,
    focalLengthMm: 50,
  });

  const lockedFrame: LockedCameraFrame = {
    isLocked: true,
    lockedAt: Date.now(),
    cameraState: snapshot,
  };

  const compiled = compilePerspectivePrompt({
    lockedFrame,
    sourceAnalysis: null,
    preservation: BASE_PRESERVATION,
    targetModel: 'gemini',
  });

  assert.equal(compiled.mode, 'camera_first');
  assert.ok(
    compiled.sections.originalCameraPerspective.includes('Do not assume fixed source camera coordinates'),
    'Camera-First mode must instruct inspecting the primary image rather than fabricating source angles'
  );
  assert.ok(
    !compiled.sections.originalCameraPerspective.includes('approximately'),
    'Camera-First mode must not emit fabricated approximate source degrees'
  );
  console.log('✓ Scenario D passed: Camera-First mode operates without fabricating source angles');
}

// ---------------------------------------------------------------------------
// Scenario E: Image-Aware Mode Mapping (Server pitch_deg -> elevationDeg & Confidence)
// ---------------------------------------------------------------------------
{
  const mockBase: CameraAiBaseAnalysis = {
    subject_type_and_count: 'Single standing woman',
    pose: 'Standing relaxed facing camera',
    head_orientation: 'Facing forward toward original camera',
    gaze_direction: 'Looking directly at original lens',
    clothing_details: 'Warm beige knit sweater and dark trousers',
    environment_and_background: 'Minimalist bedroom with wood flooring and window daylight',
    lighting_details: 'Soft natural window light from camera-right',
    current_camera: {
      pitch_deg: -12, // server: -12 means looking downward 12° -> elevated +12°
      pitch_range: [-18, -6],
      pitch_confidence: 0.72,
      pitch_label: 'slightly elevated',
      camera_height: 'chest to eye level',
      camera_height_meters: 1.55,
      camera_height_confidence: 0.7,
      azimuth_deg: 5,
      azimuth_range: [-5, 15],
      azimuth_confidence: 0.85,
      azimuth_reference_axis: 'Subject torso facing axis',
      distance_label: 'medium',
      distance_meters: 3.0,
      distance_confidence: 0.65,
      perspective_strength_rating: 'Natural normal-lens perspective',
      focal_length_mm: 50,
      focal_length_range: [42, 58],
      focal_length_label: 'normal',
      focal_length_confidence: 0.6,
      distortion_character: 'Minimal optical distortion',
      roll_deg: 0,
      roll_confidence: 0.9,
      shot_size: 'full',
      framing: {
        aspect_ratio: '3:4',
        orientation: 'Portrait',
        subject_position_in_frame: 'Centered',
        headroom: '15% headroom',
        lead_room: 'Balanced',
        negative_space: 'Clean room margins',
        crop_behavior: 'Full body visible',
      },
      depth_of_field: {
        dof_type: 'medium',
        focus_plane_position: 'Subject face and torso',
      },
      camera_position_summary: 'Slightly elevated front portrait around 50mm',
    },
    must_not_change: ['Subject identity', 'Sweater & trousers', 'Bedroom layout'],
    geometry_risks: ['Rear side of bedroom chair and back of hair occluded in source'],
  };

  const sourceAnalysis = mapBaseAnalysisToSourceAnalysis(mockBase, 'bedroom_portrait.jpg');
  assert.equal(sourceAnalysis.inferredCamera.elevationDeg.value, 12, 'Server pitch_deg=-12 maps to +12° elevation');
  assert.deepEqual(
    [sourceAnalysis.inferredCamera.elevationDeg.rangeMin, sourceAnalysis.inferredCamera.elevationDeg.rangeMax],
    [6, 18]
  );
  assert.equal(sourceAnalysis.inferredCamera.azimuthDeg.confidence, 'high');
  assert.equal(sourceAnalysis.inferredCamera.focalLengthMm.confidence, 'medium');

  const { snapshot } = createTestSnapshot({
    azimuthDeg: 135,
    elevationDeg: 48,
    distanceMeters: 3.2,
    focalLengthMm: 28,
    rollDeg: 6,
  });

  const compiled = compilePerspectivePrompt({
    lockedFrame: { isLocked: true, lockedAt: Date.now(), cameraState: snapshot },
    sourceAnalysis,
    preservation: BASE_PRESERVATION,
    targetModel: 'chatgpt',
  });

  assert.equal(compiled.mode, 'image_aware');
  assert.ok(compiled.sections.originalCameraPerspective.includes('approximately 5°'));
  assert.ok(compiled.sections.originalCameraPerspective.includes('approximately 12° elevation'));
  assert.ok(compiled.sections.requiredCameraTransformation.includes('+130° orbit shift'));
  assert.ok(compiled.sections.requiredCameraTransformation.includes('+36° height shift'));
  assert.ok(compiled.sections.requiredCameraTransformation.includes('Wider (-22mm)'));
  assert.ok(compiled.sections.hiddenOrUnseenDetails.includes('Rear side of bedroom chair'));
  console.log('✓ Scenario E & F passed: Image-aware source mapping, confidence badges, & multi-variable deltas');
}

// ---------------------------------------------------------------------------
// Scenario G: Preservation Isolation + Contradiction Detection (Never Silently Resolved)
// ---------------------------------------------------------------------------
{
  const { snapshot: rearCloseupSnap } = createTestSnapshot({
    azimuthDeg: 165,
    elevationDeg: 10,
    distanceMeters: 1.35,
    focalLengthMm: 85,
    targetY: 1.48,
  });

  const conflictingPrefs: PreservationPreferences = {
    ...BASE_PRESERVATION,
    requirePixelIdenticalComposition: true,
    requireFullBodyVisibleInOutput: true,
    requireFrontDetailsDirectlyVisible: true,
    additionalUserNotes: 'Have the subject turn around to face the camera.',
  };

  const validation = validateTransformationConsistency(rearCloseupSnap, conflictingPrefs, null);
  assert.equal(validation.hasErrors, true);
  assert.equal(validation.hasWarnings, true);

  const ids = validation.issues.map((i) => i.id);
  assert.ok(ids.includes('pixel_identical_vs_camera_move'), 'Must catch pixel-identical vs camera move');
  assert.ok(ids.includes('closeup_vs_full_body'), 'Must catch tight shot vs full-body lock');
  assert.ok(ids.includes('rear_view_vs_front_visible'), 'Must catch rear view vs front visibility lock');
  assert.ok(ids.includes('note_vs_pose_freeze'), 'Must warn when notes ask subject to turn around');

  // Verify compareSourceAndTarget does not crash on equal values either
  const comparison = compareSourceAndTarget(rearCloseupSnap, null);
  assert.equal(comparison.mode, 'camera_first');
  console.log('✓ Scenario G passed: Deterministic contradiction detection surfaces all conflicts cleanly');
}

// ---------------------------------------------------------------------------
// Scenario H: Camera-First Regression — Untouched Playboard Shot Size & Bounds
// ---------------------------------------------------------------------------
{
  const { snapshot: cfSnap } = createTestSnapshot({
    azimuthDeg: 35,
    elevationDeg: 18,
    distanceMeters: 4.8,
    focalLengthMm: 35,
    rollDeg: 0,
    aspectRatio: '16:9',
  });
  assert.equal(cfSnap.shotSize, 'Full-Body Shot');

  const cfLocked: LockedCameraFrame = {
    isLocked: true,
    lockedAt: 1700000000000,
    cameraState: cfSnap,
  };
  const cfPrompt = compilePerspectivePrompt({
    lockedFrame: cfLocked,
    sourceAnalysis: null,
    preservation: BASE_PRESERVATION,
    targetModel: 'flux',
  });

  assert.equal(cfPrompt.mode, 'camera_first');
  assert.ok(cfPrompt.sections.taskObjective.includes(cfSnap.shotSize));
  assert.ok(cfPrompt.sections.targetCameraPerspective.includes(`Shot size & scale: ${cfSnap.shotSize}`));
  assert.ok(cfPrompt.sections.targetCameraPerspective.includes('16:9 aspect ratio'));
  assert.ok(cfPrompt.sections.finalOutputRequirements.includes(`Output a single, clean 16:9 photograph framed as a ${cfSnap.shotSize}`));
  assert.ok(cfPrompt.exportedText.startsWith('--ar 16:9'));
  console.log('✓ Scenario H passed: Camera-First mode remains 100% untouched (uses Playboard shot size, bounds, and 16:9 aspect)');
}

// ---------------------------------------------------------------------------
// Scenario I: Image-Aware Framing Lock — Chest-Up & Waist-Up & Medium Source Photos
// Even when the 3D Playboard mannequin sits at Full-Body Shot / 16:9, source framing wins.
// ---------------------------------------------------------------------------
{
  const { snapshot: fullBodyPlayboardSnap } = createTestSnapshot({
    azimuthDeg: -45,
    elevationDeg: 28,
    distanceMeters: 4.0,
    focalLengthMm: 35,
    rollDeg: 0,
    aspectRatio: '16:9',
  });
  assert.equal(fullBodyPlayboardSnap.shotSize, 'Full-Body Shot');

  const lockedRig: LockedCameraFrame = {
    isLocked: true,
    lockedAt: 1700000000000,
    cameraState: fullBodyPlayboardSnap,
  };

  const makeMockSource = (opts: {
    shot_size: string;
    aspect_ratio: string;
    crop_behavior: string;
    subject_position: string;
    headroom: string;
  }) =>
    mapBaseAnalysisToSourceAnalysis(
      {
        subject_type_and_count: 'Single woman in studio portrait',
        pose: 'Seated upright facing slightly right',
        head_orientation: 'Facing camera-front',
        gaze_direction: 'Looking directly at original lens',
        clothing_details: 'Olive ribbed knit top',
        environment_and_background: 'Warm textured studio backdrop',
        lighting_details: 'Soft diffused key light from camera-left',
        current_camera: {
          pitch_deg: 0,
          pitch_range: [-5, 5],
          pitch_confidence: 0.9,
          pitch_label: 'eye level',
          camera_height: 'eye level',
          camera_height_meters: 1.5,
          camera_height_confidence: 0.85,
          azimuth_deg: 0,
          azimuth_range: [-8, 8],
          azimuth_confidence: 0.9,
          azimuth_reference_axis: 'Subject facing direction',
          distance_label: 'close',
          distance_meters: 1.4,
          distance_confidence: 0.8,
          perspective_strength_rating: 'Natural 50mm portrait perspective',
          focal_length_mm: 50,
          focal_length_range: [45, 60],
          focal_length_label: 'normal',
          focal_length_confidence: 0.8,
          distortion_character: 'Natural compression',
          roll_deg: 0,
          roll_confidence: 0.95,
          shot_size: opts.shot_size,
          framing: {
            aspect_ratio: opts.aspect_ratio,
            orientation: 'Portrait',
            subject_position_in_frame: opts.subject_position,
            headroom: opts.headroom,
            lead_room: 'Balanced',
            negative_space: 'Clean margins',
            crop_behavior: opts.crop_behavior,
          },
          depth_of_field: {
            dof_type: 'shallow',
            focus_plane_position: 'Subject eyes',
          },
          camera_position_summary: 'Front portrait camera',
        },
        must_not_change: ['Subject identity', 'Ribbed top', 'Backdrop'],
        geometry_risks: ['Right ear and rear hair side occluded in source'],
      },
      'portrait_test.jpg'
    );

  // 1) Chest-up source image
  const chestUpSource = makeMockSource({
    shot_size: 'chest_up',
    aspect_ratio: '4:5',
    crop_behavior: 'Cropped cleanly at mid-chest; lower torso, hips, legs, and feet out of frame',
    subject_position: 'Centered upper-third',
    headroom: '12% headroom',
  });
  const chestUpPrompt = compilePerspectivePrompt({
    lockedFrame: lockedRig,
    sourceAnalysis: chestUpSource,
    preservation: BASE_PRESERVATION,
    targetModel: 'flux',
  });

  assert.equal(chestUpPrompt.mode, 'image_aware');
  assert.ok(!chestUpPrompt.fullText.includes('Full-Body Shot'), 'Must never force Full-Body Shot on chest-up source');
  assert.ok(!chestUpPrompt.fullText.includes('key body landmarks in frame'), 'Must not leak mannequin body landmarks');
  assert.ok(chestUpPrompt.sections.taskObjective.includes('Chest-Up Medium Close-Up'));
  assert.ok(chestUpPrompt.sections.targetCameraPerspective.includes('-45°'));
  assert.ok(chestUpPrompt.sections.targetCameraPerspective.includes('+28°'));
  assert.ok(chestUpPrompt.sections.targetCameraPerspective.includes('35mm'));
  assert.ok(chestUpPrompt.sections.targetCameraPerspective.includes('Chest-Up Medium Close-Up'));
  assert.ok(chestUpPrompt.sections.hiddenOrUnseenDetails.includes('do NOT zoom out, uncrop, or reconstruct'));
  assert.ok(chestUpPrompt.sections.finalOutputRequirements.includes('4:5'));
  assert.ok(chestUpPrompt.sections.finalOutputRequirements.includes('Chest-Up Medium Close-Up'));
  assert.ok(chestUpPrompt.exportedText.startsWith('--ar 4:5'), 'Flux export must use source 4:5 aspect ratio');
  assert.equal(
    chestUpPrompt.comparison.deltas.find((d) => d.variable.startsWith('Shot Size'))?.changed,
    false
  );

  // 2) Waist-up source image
  const waistUpSource = makeMockSource({
    shot_size: 'waist_up',
    aspect_ratio: '3:4',
    crop_behavior: 'Cropped at natural waistline; legs and shoes excluded',
    subject_position: 'Centered',
    headroom: '10% headroom',
  });
  const waistUpPrompt = compilePerspectivePrompt({
    lockedFrame: lockedRig,
    sourceAnalysis: waistUpSource,
    preservation: BASE_PRESERVATION,
    targetModel: 'universal',
  });
  assert.ok(!waistUpPrompt.fullText.includes('Full-Body Shot'));
  assert.ok(waistUpPrompt.sections.targetCameraPerspective.includes('Waist-Up Medium Shot'));
  assert.ok(waistUpPrompt.sections.finalOutputRequirements.includes('3:4'));

  // 3) Medium shot source image
  const mediumSource = makeMockSource({
    shot_size: 'medium',
    aspect_ratio: '2:3',
    crop_behavior: 'Mid-thigh crop; lower legs excluded',
    subject_position: 'Slightly left of center',
    headroom: '14% headroom',
  });
  const mediumPrompt = compilePerspectivePrompt({
    lockedFrame: lockedRig,
    sourceAnalysis: mediumSource,
    preservation: BASE_PRESERVATION,
    targetModel: 'universal',
  });
  assert.ok(!mediumPrompt.fullText.includes('Full-Body Shot'));
  assert.ok(mediumPrompt.sections.targetCameraPerspective.includes('Medium Shot'));
  assert.ok(mediumPrompt.sections.finalOutputRequirements.includes('2:3'));

  // 4) Full-body source image
  const fullBodySource = makeMockSource({
    shot_size: 'full',
    aspect_ratio: '3:4',
    crop_behavior: 'Full body from head to shoes visible',
    subject_position: 'Centered',
    headroom: '10% headroom',
  });
  const fullBodyPrompt = compilePerspectivePrompt({
    lockedFrame: lockedRig,
    sourceAnalysis: fullBodySource,
    preservation: BASE_PRESERVATION,
    targetModel: 'universal',
  });
  assert.ok(fullBodyPrompt.sections.targetCameraPerspective.includes('Full-Body Shot'));
  assert.ok(fullBodyPrompt.sections.finalOutputRequirements.includes('3:4'));

  // 5) Explicit user opt-in: requireFullBodyVisibleInOutput = true on chest-up source
  const expandedPrompt = compilePerspectivePrompt({
    lockedFrame: lockedRig,
    sourceAnalysis: chestUpSource,
    preservation: {
      ...BASE_PRESERVATION,
      requireFullBodyVisibleInOutput: true,
    },
    targetModel: 'universal',
  });
  assert.ok(expandedPrompt.sections.taskObjective.includes('full-body visibility explicitly requested'));
  assert.ok(expandedPrompt.sections.targetCameraPerspective.includes('Full-Body Shot'));
  assert.ok(expandedPrompt.sections.finalOutputRequirements.includes('full-body visibility explicitly enabled'));
  console.log('✓ Scenario I passed: Image-Aware preserves Chest-Up, Waist-Up, Medium, Full-Body source framing and respects explicit full-body opt-in');
}

console.log('All 3D Camera Perspective Playboard tests passed successfully!');
