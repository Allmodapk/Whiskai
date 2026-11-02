import assert from 'node:assert/strict';
import {
  buildCameraAiPrompt,
  validateCameraAiConsistency,
} from '../cameraAiPrompt';
import {
  CameraAiTemplateAnalysis,
  CameraAiBaseAnalysis,
} from '../../types';

console.log('--- Running Camera AI Test Suite ---');

const mockTemplateAnalysis: CameraAiTemplateAnalysis = {
  evidence: {
    horizon_visible: 'No horizon line visible in frame due to steep downward pitch (-80°)',
    vanishing_points: 'Vertical lines converge sharply toward the bottom of the frame',
    vertical_lines_convergence: 'Sharply converging vertical perspective lines',
    ground_floor_visibility: 'Floor dominates 85% of total frame area',
    ceiling_visibility: 'Not visible',
    top_vs_side_surfaces: 'Tops of head and shoulders dominate front planes',
    foreshortening: 'Extreme top-down foreshortening',
    shadow_direction_length: 'Short cast shadows directly underneath subjects',
    perspective_strength: 'Steep wide-angle perspective',
    edge_distortion: 'Mild barrel distortion at frame edges',
    background_compression: 'Uncompressed expansive floor background',
    depth_of_field_bokeh: 'Focus plane on subject with soft background drop-off',
    tilt_roll: 'Level horizon, 0° roll angle',
    crop_margins: 'Full-body wide angle from above with 15% margins',
  },
  estimates: {
    pitch_deg: -80,
    pitch_range: [-85, -75],
    pitch_confidence: 0.95,
    pitch_label: 'top-down',
    camera_height: 'overhead',
    camera_height_meters: 3.2,
    camera_height_confidence: 0.9,
    azimuth_deg: 0,
    azimuth_range: [-10, 10],
    azimuth_confidence: 0.9,
    azimuth_reference_axis: 'Subject facing direction',
    distance_label: 'medium',
    distance_meters: 3.5,
    distance_confidence: 0.85,
    perspective_strength_rating: 'Steep wide-angle top-down perspective',
    focal_length_mm: 24,
    focal_length_range: [20, 28],
    focal_length_label: 'wide',
    focal_length_confidence: 0.9,
    distortion_character: 'Subtle wide-angle barrel distortion',
    roll_deg: 0,
    roll_confidence: 0.95,
    shot_size: 'full',
    framing: {
      aspect_ratio: '3:4',
      orientation: 'Portrait',
      subject_position_in_frame: 'Center cell',
      headroom: '15% vertical headroom',
      lead_room: 'Centered lead room',
      negative_space: 'Balanced lateral margins',
      crop_behavior: 'Clean non-cutting frame edges',
    },
    depth_of_field: {
      dof_type: 'medium',
      focus_plane_position: 'On principal subject torso',
    },
    camera_position_summary: 'Camera C overhead at elevation 3.2m, pitch -80° looking steeply down',
  },
  visual_consequences: [
    'Floor plane dominates 85% of total frame background',
    'Subject proportions exhibit top-down foreshortening',
    'Vertical lines converge sharply toward bottom edge',
  ],
  consistency_check: {
    verified: true,
    reasoning: 'Steep pitch (-80°) aligns with invisible horizon line and top-down foreshortening.',
    warnings: [],
  },
};

const mockBaseAnalysis: CameraAiBaseAnalysis = {
  subject_type_and_count: 'Single standing man',
  pose: 'Standing erect with weight balanced equally on both feet',
  head_orientation: 'Facing directly forward toward camera B',
  gaze_direction: 'Looking straight into Camera B at eye level',
  clothing_details: 'Grey sweatshirt, dark jeans, beige sneakers',
  environment_and_background: 'Bright modern bedroom interior with light hardwood floor',
  lighting_details: 'Soft natural daylight from camera-right window',
  current_camera: {
    ...mockTemplateAnalysis.estimates,
    pitch_deg: 0,
    pitch_label: 'level / eye-level',
    camera_height: 'eye level',
    camera_height_meters: 1.5,
    distance_meters: 3.0,
    focal_length_mm: 50,
    focal_length_label: 'normal',
    camera_position_summary: 'Eye-level Camera B at 1.5m height',
  },
  must_not_change: ['Subject identity', 'Clothing', 'Bedroom environment', 'Lighting direction'],
  geometry_risks: ['Steep top-down pitch requires rendering floor plane'],
};

// Test 1: Determinism
console.log('Test 1: Deterministic prompt output');
const prompt1 = buildCameraAiPrompt(mockTemplateAnalysis, mockBaseAnalysis, {
  variant: 'full',
  targetModel: 'universal',
});
const prompt2 = buildCameraAiPrompt(mockTemplateAnalysis, mockBaseAnalysis, {
  variant: 'full',
  targetModel: 'universal',
});
assert.equal(prompt1, prompt2, 'Prompt assembly must be 100% deterministic');
console.log('  Passed!');

// Test 2: All 8 blocks present in order for 'full' variant
console.log('Test 2: All 8 blocks present in order for full variant');
const blockMarkers = [
  'TASK:',
  'FROZEN MOMENT LOCK:',
  'SCENE & IDENTITY LOCK (MUST NOT CHANGE):',
  'NEW CAMERA SPECIFICATION (CAMERA C):',
  'GEOMETRY & VISUAL CONSEQUENCES:',
  'CAMERA B RELATIONSHIP:',
  'NEGATIVES (do not include):',
  'OUTPUT FORMAT:',
];

let lastIndex = -1;
for (const marker of blockMarkers) {
  const index = prompt1.indexOf(marker);
  assert.ok(index !== -1, `Missing block marker: ${marker}`);
  assert.ok(index > lastIndex, `Block marker out of order: ${marker}`);
  lastIndex = index;
}
console.log('  Passed!');

// Test 3: Gaze lock and no-turn rule enforced
console.log('Test 3: Gaze lock & no-turn rules');
assert.ok(
  prompt1.includes('Camera B') && prompt1.includes('gaze'),
  'Must state gaze lock toward Camera B'
);
assert.ok(
  prompt1.includes('does NOT look at, turn toward, or acknowledge new Camera C'),
  'Must state no-turn rule toward Camera C'
);
console.log('  Passed!');

// Test 4: 'no_base' variant contains no invented pose facts
console.log('Test 4: no_base variant contains no invented pose facts');
const noBasePrompt = buildCameraAiPrompt(mockTemplateAnalysis, null, {
  variant: 'no_base',
  targetModel: 'universal',
});
assert.ok(
  !noBasePrompt.includes('Grey sweatshirt'),
  'no_base prompt must not contain base subject details'
);
assert.ok(
  noBasePrompt.includes('Re-photograph the subject and scene from the attached image'),
  'no_base prompt must state generic application'
);
console.log('  Passed!');

// Test 5: 'compact' variant word count check
console.log('Test 5: compact variant word count');
const compactPrompt = buildCameraAiPrompt(mockTemplateAnalysis, mockBaseAnalysis, {
  variant: 'compact',
  targetModel: 'universal',
});
const wordCount = compactPrompt.split(/\s+/).length;
console.log(`  Compact prompt word count: ${wordCount} words`);
assert.ok(wordCount < 200, 'Compact prompt should be under 200 words');
console.log('  Passed!');

// Test 6: validateCameraAiConsistency pitch/horizon contradiction check
console.log('Test 6: Contradiction validation');
const invalidTemplate: CameraAiTemplateAnalysis = {
  ...mockTemplateAnalysis,
  estimates: {
    ...mockTemplateAnalysis.estimates,
    pitch_deg: -85,
  },
  evidence: {
    ...mockTemplateAnalysis.evidence,
    horizon_visible: 'Visible in frame at y = 50% middle of frame', // Contradicts -85° pitch
  },
};
const issues = validateCameraAiConsistency(invalidTemplate);
assert.ok(issues.length > 0, 'Should detect pitch vs horizon contradiction');
assert.ok(
  issues.some((i) => i.includes('Pitch contradiction')),
  'Should flag Pitch contradiction'
);
console.log('  Passed!');

// Test 7: Acceptance scenario - Overhead bedroom template + standing man
console.log('Test 7: Acceptance scenario (Steep pitch camera reshoot)');
assert.ok(
  prompt1.includes('Camera C overhead at elevation 3.2m'),
  'Prompt must include elevated camera position'
);
assert.ok(
  prompt1.includes('Standing erect'),
  'Prompt must keep man in standing pose from base image'
);
console.log('  Passed!');

console.log('=== All Camera AI Tests Passed Successfully! ===');
