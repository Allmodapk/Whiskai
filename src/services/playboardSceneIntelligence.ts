import {
  Camera3DSettings,
  CharacterPose3DSettings,
  EnvironmentTransformationPolicy,
  ExpectedChangeSummary,
  I2IEditableField,
  I2ITransformationScope,
  PlayboardCheckpoint,
  PlayboardFullConfig,
  PlayboardShotVariation,
  PosePreset,
  PresetScopePreview,
  PromptValidationIssue,
  PromptValidationReport,
  PromptValidationStatus,
  ResolvedEnvironmentPolicyMode,
  SceneInteractionPresetId,
  SceneStateInspectionSummary,
  ShotFraming,
  StructuredPromptSummary,
  VariationComparisonReport,
  VariationFieldDiff,
} from '../types/cameraPlayboard';
import {
  analyzePlayboardFraming,
  computePlayboardCameraTransform,
  getCustomModelDiagnostics,
  resolvePlayboardCameraTargetXZ,
} from './framingAnalyzer';
import {
  evaluateActiveSceneInteraction,
  getInteractionPresetById,
} from './sceneInteractionPresets';
import {
  buildInitialI2IFields,
  compileFinalI2IPrompt,
  describeCameraElevation,
  describeCameraHorizontal,
  describeGazeAndEyeContact,
} from './cameraPlayboardPrompts';

export const BASE_POSE_LABELS: Record<PosePreset, string> = {
  natural_standing: 'Natural Standing with balanced weight distribution',
  contrapposto: 'Contrapposto Stance with relaxed hip shift',
  power_stance: 'Confident Power Stance with grounded footing',
  casual_sitting: 'Casual Seated Posture with thighs forward and knees bent',
  floor_seated_cross_legged: 'Floor Cross-Legged Seated Posture',
  mid_stride_walking: 'Mid-Stride Walking Gait with natural arm swing',
  dynamic_running: 'Dynamic Running Stride with athletic forward drive',
  grounded_kneeling: 'Grounded Kneeling Posture on the floor',
  deep_squat: 'Deep Squat Posture with flexed knees',
  reclined_lying: 'Reclined Lying Posture',
  wall_lean: 'Relaxed Wall Lean Posture',
  welcoming_wave: 'Welcoming Wave Stance with raised greeting hand',
  all_fours_neutral: 'All-Fours Neutral Tabletop Posture',
  cow_pose_arched: 'Cow Pose (Arched Lumbar Spine)',
  cat_pose_rounded: 'Cat Pose (Rounded Spine)',
  all_fours_rear_presentation: 'All-Fours Rear Presentation (Elevated Hips)',
  prone_hip_elevated: 'Prone Hip-Elevated Posture',
  kneeling_forward_fold: 'Kneeling Forward Fold Posture',
  bent_over_support: 'Bent-Over Support Posture',
  side_lying_open: 'Side-Lying Open Posture',
};

export const FRAMING_LABELS: Record<ShotFraming, { label: string }> = {
  extreme_close_up: { label: 'Extreme Close-Up (ECU)' },
  close_up_portrait: { label: 'Close-Up Portrait (CU)' },
  medium_close_up: { label: 'Medium Close-Up (MCU)' },
  medium_shot: { label: 'Medium Shot (MS)' },
  three_quarter_shot: { label: 'Three-Quarter Shot' },
  full_shot: { label: 'Full-Body Shot' },
  wide_shot: { label: 'Wide Environmental Shot' },
};

export interface ResolvedEnvironmentTransformation {
  effectiveMode: ResolvedEnvironmentPolicyMode;
  requestedPolicy: EnvironmentTransformationPolicy;
  hasActiveSceneInteraction: boolean;
  requiresFurnitureSupport: boolean;
  furnitureTarget: string | null;
  surfaceDescription: string;
  modeLabel: string;
  summary: string;
  preserves: string[];
  adapts: string[];
}

/**
 * Resolves the effective environment transformation mode based on the user's policy,
 * legacy preserveEnvironment flag, active scene interaction, and transformation scope.
 *
 * Key product requirement (Section 2 & 8):
 * - When a scene interaction requires furniture/setting (bed, chair, desk, wall) or when
 *   'source_inspired_transformation' is selected, do NOT blindly force preservation of incompatible
 *   original room furniture, and do NOT replace the source image's visual character with an unrelated
 *   generic studio look. Instead, introduce the needed support furniture/setting while using the source
 *   image as the visual reference for lighting character, tonal balance, shadow softness, color grading,
 *   skin appearance, and photographic texture.
 */
export function resolveEnvironmentTransformationPolicy(
  config: PlayboardFullConfig,
  scope: I2ITransformationScope = 'both'
): ResolvedEnvironmentTransformation {
  const requestedPolicy: EnvironmentTransformationPolicy =
    config.environmentPolicy ||
    (config.preserveEnvironment === false ? 'replace_environment' : 'auto');

  const interactionEval = evaluateActiveSceneInteraction(
    config.pose,
    config.environment
  );
  const hasActiveSceneInteraction = interactionEval.hasActiveInteraction;
  const furnitureTarget = interactionEval.preset?.furnitureTarget || null;
  const requiresFurnitureSupport = Boolean(
    hasActiveSceneInteraction &&
      furnitureTarget &&
      ['bed', 'chair', 'desk', 'wall'].includes(furnitureTarget)
  );

  let effectiveMode: ResolvedEnvironmentPolicyMode =
    'preserve_physical_environment';

  if (requestedPolicy === 'replace_environment') {
    effectiveMode = 'replace_environment';
  } else if (requestedPolicy === 'source_inspired_transformation') {
    effectiveMode = 'source_inspired_transformation';
  } else if (requestedPolicy === 'preserve_physical_environment') {
    effectiveMode = 'preserve_physical_environment';
  } else {
    // 'auto' mode:
    // If an active scene interaction requires furniture support (bed/chair/desk/wall) and scope includes pose,
    // automatically use source-inspired environment transformation so the model introduces the required
    // furniture while preserving the source image's lighting/color/photographic character.
    if (requiresFurnitureSupport && scope !== 'camera_only') {
      effectiveMode = 'source_inspired_transformation';
    } else if (config.preserveEnvironment === false) {
      effectiveMode = 'replace_environment';
    } else {
      effectiveMode = 'preserve_physical_environment';
    }
  }

  const furnitureNoun =
    furnitureTarget === 'bed'
      ? 'bed support surface and bedroom setting'
      : furnitureTarget === 'chair'
      ? 'chair support surface and seating area'
      : furnitureTarget === 'desk'
      ? 'desk/tabletop support surface'
      : furnitureTarget === 'wall'
      ? 'architectural wall support surface'
      : 'staged support surface and surrounding setting';

  if (effectiveMode === 'source_inspired_transformation') {
    return {
      effectiveMode,
      requestedPolicy,
      hasActiveSceneInteraction,
      requiresFurnitureSupport,
      furnitureTarget,
      surfaceDescription: interactionEval.surfaceDescription,
      modeLabel: 'Source-Inspired Environment Transformation',
      summary: hasActiveSceneInteraction
        ? `Introduces the required ${furnitureNoun} for "${interactionEval.preset?.label}" while using the source image as the visual reference for lighting character, tonal balance, shadow softness, color grading, skin appearance, and photographic texture.`
        : `Adapts the physical setting around the subject while using the source image as the visual reference for lighting character, tonal balance, shadow softness, color grading, skin appearance, and photographic texture.`,
      preserves: [
        'Subject facial identity, bone structure, and age',
        'Skin tone, complexion, and natural skin texture',
        'Hair color, style, and body proportions',
        'Original clothing garments, fabric texture, and accessories',
        'Source image lighting direction, shadow softness, tonal balance, color grading, and photographic grain',
      ],
      adapts: [
        hasActiveSceneInteraction
          ? `Physical setting & support furniture (${furnitureNoun}) required by the staged pose`
          : 'Surrounding physical room geometry to support the staged composition',
        'Incompatible original room furniture is replaced rather than awkwardly retained',
      ],
    };
  }

  if (effectiveMode === 'replace_environment') {
    return {
      effectiveMode,
      requestedPolicy,
      hasActiveSceneInteraction,
      requiresFurnitureSupport,
      furnitureTarget,
      surfaceDescription: interactionEval.surfaceDescription,
      modeLabel: 'Stage Environment Replacement',
      summary: `Transitions the surrounding physical environment to the selected "${config.environment}" stage while preserving subject identity and clothing.`,
      preserves: [
        'Subject facial identity, bone structure, and age',
        'Skin tone, hair style, and body proportions',
        'Original clothing garments and accessories',
      ],
      adapts: [
        `Surrounding stage environment (${config.environment})`,
        hasActiveSceneInteraction
          ? `Support surface (${furnitureNoun})`
          : 'Background setting and room architecture',
      ],
    };
  }

  return {
    effectiveMode: 'preserve_physical_environment',
    requestedPolicy,
    hasActiveSceneInteraction,
    requiresFurnitureSupport,
    furnitureTarget,
    surfaceDescription: interactionEval.surfaceDescription,
    modeLabel: 'Preserve Original Physical Environment',
    summary:
      'Preserves the original physical background, room architecture, existing furniture, clothing, and ambient lighting from the source image.',
    preserves: [
      'Subject facial identity, skin tone, hair, and body proportions',
      'Original clothing garments and accessories',
      'Original physical background, room architecture, and existing objects',
      'Original ambient lighting, shadow character, and color palette',
    ],
    adapts: [
      scope === 'pose_only'
        ? 'Subject body posture, limb articulation, and gaze only'
        : scope === 'camera_only'
        ? 'Camera viewpoint, framing, and perspective only'
        : 'Camera viewpoint, framing, and subject posture within the existing scene',
    ],
  };
}

/**
 * Builds a structured, human-readable summary of the current I2I prompt intent
 * across identity, pose, camera, gaze, environment, and transformation scope.
 */
export function buildStructuredPromptSummary(
  config: PlayboardFullConfig,
  scope: I2ITransformationScope,
  fields?: I2IEditableField[]
): StructuredPromptSummary {
  const framingAnalysis = analyzePlayboardFraming(config.camera, config.pose);
  const envResolution = resolveEnvironmentTransformationPolicy(config, scope);
  const interactionEval = evaluateActiveSceneInteraction(
    config.pose,
    config.environment
  );

  const relYaw = framingAnalysis.relativeAngles.relativeToBodyYawDeg;
  const horizView = describeCameraHorizontal(relYaw);
  const elevView = describeCameraElevation(
    config.camera.pitchDeg,
    config.camera.height,
    config.pose.basePose,
    framingAnalysis.relativeAngles
  );

  const cameraSummary =
    scope === 'pose_only'
      ? 'Locked to source image camera angle, framing, and perspective (Pose-Only scope).'
      : `${framingAnalysis.shotSizeDescription} (${framingAnalysis.shotSizeLabel}), ${horizView} (${Math.round(config.camera.yawDeg)}° yaw, ${Math.round(config.camera.pitchDeg)}° pitch, ${config.camera.distance.toFixed(2)}m), ${elevView}, ${config.camera.focalLength.replace(/_/g, ' ')} lens, ${config.camera.outputRatio} ${framingAnalysis.parsedAspectRatio.orientation}.`;

  const basePoseLabel =
    BASE_POSE_LABELS[config.pose.basePose] || config.pose.basePose;
  const poseSummary =
    scope === 'camera_only'
      ? 'Locked to source image body posture and limb placement (Camera-Only scope).'
      : interactionEval.hasActiveInteraction && interactionEval.preset
      ? `${interactionEval.preset.label} (${interactionEval.surfaceDescription}); torso lean ${config.pose.torsoLeanDeg}°, twist ${config.pose.torsoTwistDeg}°, facing yaw ${Math.round(config.pose.characterYawDeg ?? 0)}°.`
      : `${basePoseLabel}; torso lean ${config.pose.torsoLeanDeg}°, twist ${config.pose.torsoTwistDeg}°, facing yaw ${Math.round(config.pose.characterYawDeg ?? 0)}° at (${(config.pose.characterPosX ?? 0).toFixed(2)}m, ${(config.pose.characterPosZ ?? 0).toFixed(2)}m).`;

  const gazeSummary =
    scope === 'camera_only'
      ? 'Gaze & expression preserved relative to original pose.'
      : describeGazeAndEyeContact(
          config.pose,
          config.camera.yawDeg,
          framingAnalysis.relativeAngles,
          config.camera.pitchDeg,
          config.camera.height,
          config.camera.distance
        );

  const scopeSummary =
    scope === 'both'
      ? 'Camera + Pose (Full Compositional Staging)'
      : scope === 'camera_only'
      ? 'Camera Only (Keep Original Pose)'
      : scope === 'pose_only'
      ? 'Pose Only (Keep Original Camera)'
      : 'Custom Field Selection';

  const changesList: string[] = [];
  if (scope === 'both' || scope === 'camera_only' || scope === 'custom') {
    changesList.push(
      `Camera viewpoint (${Math.round(config.camera.yawDeg)}° yaw, ${Math.round(config.camera.pitchDeg)}° pitch, ${config.camera.distance.toFixed(2)}m) & ${framingAnalysis.shotSizeLabel} framing`
    );
  }
  if (scope === 'both' || scope === 'pose_only' || scope === 'custom') {
    changesList.push(
      interactionEval.hasActiveInteraction && interactionEval.preset
        ? `Subject pose & interaction: ${interactionEval.preset.label}`
        : `Subject pose: ${BASE_POSE_LABELS[config.pose.basePose]?.split(' with ')[0] || config.pose.basePose}`
    );
    changesList.push(
      `Head & gaze: ${config.pose.gaze.replace(/_/g, ' ')} (${config.pose.expression.replace(/_/g, ' ')})`
    );
  }
  if (envResolution.effectiveMode !== 'preserve_physical_environment') {
    changesList.push(...envResolution.adapts);
  }

  return {
    identitySummary:
      'Preserves exact facial identity, facial bone structure, skin tone, hair texture/style, body proportions, and original clothing.',
    poseSummary,
    cameraSummary,
    gazeSummary,
    environmentSummary: envResolution.summary,
    scopeSummary,
    effectiveEnvironmentPolicy: envResolution.effectiveMode,
    preservesList: envResolution.preserves,
    changesList,
  };
}

/**
 * Validates the current Playboard scene state, framing analysis, gaze geometry,
 * environment policy, custom GLB status, and editable I2I fields for contradictions or warnings.
 */
export function validatePlayboardPromptConsistency(
  config: PlayboardFullConfig,
  scope: I2ITransformationScope,
  fields?: I2IEditableField[]
): PromptValidationReport {
  const issues: PromptValidationIssue[] = [];
  const framingAnalysis = analyzePlayboardFraming(config.camera, config.pose);
  const interactionEval = evaluateActiveSceneInteraction(
    config.pose,
    config.environment
  );
  const modelDiag = getCustomModelDiagnostics(config.pose);
  const activeFields = fields || buildInitialI2IFields(config, scope);

  // 1. Check requested framing vs measured 3D framing discrepancy (when camera is included in scope)
  if (
    scope !== 'pose_only' &&
    !framingAnalysis.framingMatchesRequest &&
    framingAnalysis.framingDiscrepancyNote
  ) {
    issues.push({
      id: 'framing_discrepancy',
      status: 'warning',
      title: 'Requested vs. Measured Framing Mismatch',
      message: `${framingAnalysis.framingDiscrepancyNote} The generated prompt uses the measured "${framingAnalysis.shotSizeLabel}" framing so it matches the 3D viewport.`,
      affectedFields: ['camera_framing'],
      actionLabel: `Snap Distance to ${FRAMING_LABELS[config.camera.framing]?.label || config.camera.framing}`,
      actionType: 'fix_framing_distance',
    });
  }

  // 2. Check direct_at_camera eye contact anatomical feasibility
  if (
    scope !== 'camera_only' &&
    config.pose.gaze === 'direct_at_camera' &&
    !framingAnalysis.relativeAngles.gazeSolution.canAchieveDirectLensContact
  ) {
    issues.push({
      id: 'gaze_beyond_anatomical_limit',
      status: 'warning',
      title: 'Direct Eye Contact Exceeds Head/Socket Reach',
      message: `Gaze is set to "Direct at Camera", but the camera is ${Math.abs(Math.round(framingAnalysis.relativeAngles.relativeToHeadYawDeg))}° horizontally / ${Math.abs(Math.round(framingAnalysis.relativeAngles.verticalCameraToEyeAngleDeg))}° vertically away from the head's facing direction. The prompt automatically falls back to an angled/profile gaze description.`,
      affectedFields: ['head_gaze_expression'],
    });
  }

  // 3. Check scene-interaction preset selected in non-bedroom environment (minimal_neutral or cyber_grid)
  if (config.pose.interactionPresetId) {
    const presetObj = getInteractionPresetById(config.pose.interactionPresetId);
    if (
      presetObj &&
      ['bed', 'chair', 'desk', 'wall'].includes(presetObj.furnitureTarget) &&
      config.environment !== 'studio_bedroom'
    ) {
      issues.push({
        id: 'furniture_hidden_in_environment',
        status: 'conflict',
        title: `Furniture Preset Active in "${config.environment}" Stage`,
        message: `"${presetObj.label}" targets the bedroom ${presetObj.furnitureTarget}, which is not present in the "${config.environment}" stage. The prompt suppresses invisible furniture claims until Studio Bedroom is active.`,
        affectedFields: ['body_pose_torso', 'scene_preservation'],
        actionLabel: 'Switch Stage to Studio Bedroom',
        actionType: 'switch_to_bedroom_environment',
      });
    }
  }

  // 4. Check active scene-interaction preset when scope is 'camera_only'
  if (scope === 'camera_only' && interactionEval.hasActiveInteraction && interactionEval.preset) {
    issues.push({
      id: 'camera_only_ignores_interaction',
      status: 'conflict',
      title: 'Camera-Only Scope Excludes Active Scene Interaction',
      message: `Scene interaction "${interactionEval.preset.label}" is staged in 3D, but Transformation Scope is set to "Camera Only". The generated I2I prompt will keep the original pose and ignore the ${interactionEval.preset.furnitureTarget} interaction.`,
      affectedFields: ['body_pose_torso', 'transformation_constraints'],
      actionLabel: 'Switch Scope to Camera + Pose',
      actionType: 'switch_scope_to_both',
    });
  }

  // 5. Check active furniture interaction combined with strict physical environment preservation
  if (
    scope !== 'camera_only' &&
    interactionEval.hasActiveInteraction &&
    interactionEval.preset &&
    ['bed', 'chair', 'desk'].includes(interactionEval.preset.furnitureTarget) &&
    config.environmentPolicy === 'preserve_physical_environment'
  ) {
    issues.push({
      id: 'strict_env_blocks_furniture_adaptation',
      status: 'conflict',
      title: 'Strict Environment Preservation Conflicts with New Furniture Interaction',
      message: `You staged "${interactionEval.preset.label}" on a ${interactionEval.preset.furnitureTarget}, but Environment Policy is forced to "Preserve Original Physical Environment". If the source photo does not already contain that ${interactionEval.preset.furnitureTarget}, the model will receive conflicting instructions.`,
      affectedFields: ['scene_preservation', 'transformation_constraints'],
      actionLabel: 'Use Source-Inspired Environment Transformation',
      actionType: 'enable_source_inspired_environment',
    });
  }

  // 6. Check locked I2I fields that have drifted from the current 3D scene state
  const freshFields = buildInitialI2IFields(config, scope);
  const staleLockedFieldIds = activeFields
    .filter((f) => {
      if (!f.isLocked || f.isRemoved) return false;
      const fresh = freshFields.find((ff) => ff.id === f.id);
      return fresh && fresh.defaultText.trim() !== f.userText.trim();
    })
    .map((f) => f.id);

  if (staleLockedFieldIds.length > 0) {
    issues.push({
      id: 'stale_locked_i2i_fields',
      status: 'warning',
      title: `${staleLockedFieldIds.length} Locked Prompt Block(s) Differ from 3D Scene`,
      message: `Locked prompt fields (${staleLockedFieldIds.join(', ')}) retain earlier text and do not reflect recent 3D camera or pose changes.`,
      affectedFields: staleLockedFieldIds,
      actionLabel: 'Unlock & Resync All Prompt Blocks',
      actionType: 'sync_unlocked_i2i_fields',
    });
  }

  // 7. Check hand/finger gesture compatibility with floor-supported poses
  const isFloorHandSupportPose =
    config.pose.basePose === 'all_fours_neutral' ||
    config.pose.basePose === 'cow_pose_arched' ||
    config.pose.basePose === 'cat_pose_rounded' ||
    config.pose.basePose === 'all_fours_rear_presentation' ||
    config.pose.basePose === 'prone_hip_elevated' ||
    config.pose.basePose === 'kneeling_forward_fold';
  const supportGestures = new Set(['relaxed_natural', 'open_palm', 'fist']);
  if (
    scope !== 'camera_only' &&
    isFloorHandSupportPose &&
    (!supportGestures.has(config.pose.leftHandGesture) ||
      !supportGestures.has(config.pose.rightHandGesture) ||
      config.pose.isWaving)
  ) {
    issues.push({
      id: 'hand_gesture_support_conflict',
      status: 'warning',
      title: 'Non-Supporting Hand Gesture in Floor-Supported Pose',
      message: `Pose "${BASE_POSE_LABELS[config.pose.basePose]?.split(' with ')[0] || config.pose.basePose}" relies on hands supporting upper-body weight on the floor, while left/right hand gestures are set to "${config.pose.leftHandGesture}" / "${config.pose.rightHandGesture}".`,
      affectedFields: ['arms_and_hands'],
      actionLabel: 'Reset Hands to Floor Support',
      actionType: 'reset_hands_to_support',
    });
  }

  // 8. Check off-camera gaze mode vs. manual direct-eye-contact text in active fields
  const gazeField = activeFields.find((f) => f.id === 'head_gaze_expression' && !f.isRemoved);
  if (scope !== 'camera_only' && gazeField) {
    const lowerGazeText = gazeField.userText.toLowerCase();
    const claimsDirectEyeContact =
      lowerGazeText.includes('direct eye contact') &&
      !lowerGazeText.includes('no direct eye contact');
    if (config.pose.gaze !== 'direct_at_camera' && claimsDirectEyeContact) {
      issues.push({
        id: 'gaze_text_contradiction',
        status: 'conflict',
        title: 'Off-Camera Gaze Conflicts with Direct Eye-Contact Text',
        message: `Gaze control is set to "${config.pose.gaze.replace(/_/g, ' ')}", but the active Head & Gaze prompt block still claims direct eye contact with the camera lens.`,
        affectedFields: ['head_gaze_expression'],
        actionLabel: 'Unlock & Resync Prompt Blocks',
        actionType: 'sync_unlocked_i2i_fields',
      });
    }
  }

  // 9. Check active furniture interaction vs. constraint text prohibiting objects/furniture
  const constraintField = activeFields.find(
    (f) => f.id === 'transformation_constraints' && !f.isRemoved
  );
  if (
    scope !== 'camera_only' &&
    interactionEval.hasActiveInteraction &&
    interactionEval.preset &&
    constraintField
  ) {
    const lowerConstraint = constraintField.userText.toLowerCase();
    if (
      lowerConstraint.includes('do not add unwanted subjects or objects') ||
      lowerConstraint.includes('do not add any furniture')
    ) {
      issues.push({
        id: 'interaction_object_prohibited_in_prompt',
        status: 'conflict',
        title: 'Constraint Block Prohibits Required Interaction Surface',
        message: `Active interaction "${interactionEval.preset.label}" requires a ${interactionEval.preset.furnitureTarget}, but the Transformation Constraints block prohibits adding objects or furniture.`,
        affectedFields: ['transformation_constraints'],
        actionLabel: 'Unlock & Resync Prompt Blocks',
        actionType: 'sync_unlocked_i2i_fields',
      });
    }
  }

  // 10. Check scope vs. manually re-enabled prompt blocks
  if (scope === 'pose_only') {
    const camFieldActive = activeFields.some((f) => f.id === 'camera_framing' && !f.isRemoved);
    if (camFieldActive) {
      issues.push({
        id: 'pose_only_includes_camera_field',
        status: 'warning',
        title: 'Camera Framing Block Enabled in Pose-Only Scope',
        message:
          'Transformation Scope is set to "Pose Only", which instructs the model not to alter the camera angle, while the Camera Viewpoint & Framing block is also active.',
        affectedFields: ['camera_framing', 'transformation_constraints'],
        actionLabel: 'Switch Scope to Camera + Pose',
        actionType: 'switch_scope_to_both',
      });
    }
  } else if (scope === 'camera_only') {
    const poseFieldActive = activeFields.some(
      (f) =>
        ['body_pose_torso', 'arms_and_hands', 'legs_and_feet'].includes(f.id) && !f.isRemoved
    );
    if (poseFieldActive) {
      issues.push({
        id: 'camera_only_includes_pose_field',
        status: 'warning',
        title: 'Pose Blocks Enabled in Camera-Only Scope',
        message:
          'Transformation Scope is set to "Camera Only", which instructs the model to keep the original body pose unchanged, while one or more body pose blocks are also active.',
        affectedFields: ['body_pose_torso', 'transformation_constraints'],
        actionLabel: 'Switch Scope to Camera + Pose',
        actionType: 'switch_scope_to_both',
      });
    }
  }

  // 11. Check Custom GLB without skeletal rig when non-neutral joint sliders are applied
  if (modelDiag.isActive && !modelDiag.hasSkeletalRig) {
    const hasCustomJointEdits =
      Math.abs(config.pose.torsoLeanDeg) > 2 ||
      Math.abs(config.pose.torsoTwistDeg) > 2 ||
      Math.abs(config.pose.headRotationDeg) > 2 ||
      config.pose.basePose !== 'natural_standing' ||
      Boolean(config.pose.interactionPresetId);

    if (hasCustomJointEdits) {
      issues.push({
        id: 'custom_glb_static_rig',
        status: 'not_verifiable',
        title: 'Custom GLB Lacks Skeletal Rig for Joint Deformation',
        message:
          'The imported GLB model is a static mesh (0 bones). Root position, yaw rotation, and approximate bounding-box framing work in 3D, and the prompt still describes your selected pose/gaze, but the 3D mesh itself cannot bend its limbs or eyes.',
        affectedFields: ['body_pose_torso', 'head_gaze_expression'],
      });
    }
  }

  let overallStatus: PromptValidationStatus = 'consistent';
  if (issues.some((i) => i.status === 'conflict')) {
    overallStatus = 'conflict';
  } else if (issues.some((i) => i.status === 'warning')) {
    overallStatus = 'warning';
  } else if (issues.some((i) => i.status === 'not_verifiable')) {
    overallStatus = 'not_verifiable';
  }

  const summary = buildStructuredPromptSummary(config, scope, activeFields);

  return {
    overallStatus,
    issues,
    summary,
  };
}

/**
 * Produces the canonical Scene State Inspector readout directly from the live PlayboardFullConfig.
 * Every number and label in this summary comes from the same analyzers that drive the 3D canvas and prompt compiler.
 */
export function inspectPlayboardSceneState(
  config: PlayboardFullConfig,
  scope: I2ITransformationScope = 'both',
  fields?: I2IEditableField[]
): SceneStateInspectionSummary {
  const framingAnalysis = analyzePlayboardFraming(config.camera, config.pose);
  const camTransform = computePlayboardCameraTransform(
    config.camera,
    config.pose
  );
  const targetXZ = resolvePlayboardCameraTargetXZ(config.camera, config.pose);
  const interactionEval = evaluateActiveSceneInteraction(
    config.pose,
    config.environment
  );
  const envResolution = resolveEnvironmentTransformationPolicy(config, scope);
  const modelDiag = getCustomModelDiagnostics(config.pose);
  const validation = validatePlayboardPromptConsistency(config, scope, fields);

  const eyeContactSummary = describeGazeAndEyeContact(
    config.pose,
    config.camera.yawDeg,
    framingAnalysis.relativeAngles,
    config.camera.pitchDeg,
    config.camera.height,
    config.camera.distance
  );

  return {
    subject: {
      posX: Number((config.pose.characterPosX ?? 0).toFixed(2)),
      posZ: Number((config.pose.characterPosZ ?? 0).toFixed(2)),
      yawDeg: Math.round(config.pose.characterYawDeg ?? 0),
      basePose: config.pose.basePose,
      basePoseLabel:
        BASE_POSE_LABELS[config.pose.basePose]?.split(' with ')[0] ||
        config.pose.basePose,
      isCustomModel: modelDiag.isActive,
      customModelStatus: modelDiag.statusSummary,
    },
    camera: {
      yawDeg: Math.round(config.camera.yawDeg),
      pitchDeg: Math.round(config.camera.pitchDeg),
      distance: Number(config.camera.distance.toFixed(2)),
      height: Number(config.camera.height.toFixed(2)),
      lensWorldY: Number(camTransform.cameraPos.y.toFixed(2)),
      focalLength: config.camera.focalLength,
      outputRatio: config.camera.outputRatio,
      targetMode: targetXZ.effectiveMode,
      lookTargetXZ: {
        x: Number(targetXZ.targetX.toFixed(2)),
        z: Number(targetXZ.targetZ.toFixed(2)),
      },
    },
    framing: {
      requestedFraming: config.camera.framing,
      measuredFraming: framingAnalysis.measuredFraming,
      measuredLabel: framingAnalysis.shotSizeLabel,
      matchesRequest: framingAnalysis.framingMatchesRequest,
      discrepancyNote: framingAnalysis.framingDiscrepancyNote,
    },
    gazeAndHead: {
      headRotationDeg: Math.round(config.pose.headRotationDeg),
      headTiltDeg: Math.round(config.pose.headTiltDeg),
      gazeMode: config.pose.gaze,
      expression: config.pose.expression,
      relativeToHeadYawDeg: Math.round(
        framingAnalysis.relativeAngles.relativeToHeadYawDeg
      ),
      cameraToEyeElevationDeg: Math.round(
        framingAnalysis.relativeAngles.verticalCameraToEyeAngleDeg
      ),
      canAchieveDirectLensContact:
        framingAnalysis.relativeAngles.gazeSolution.canAchieveDirectLensContact,
      requiresEyeOnlyCompensation:
        framingAnalysis.relativeAngles.gazeSolution.requiresEyeOnlyCompensation,
      eyeContactSummary,
    },
    environmentAndInteraction: {
      environment: config.environment,
      interactionPresetId: config.pose.interactionPresetId ?? null,
      interactionLabel: interactionEval.hasActiveInteraction
        ? interactionEval.preset?.label || 'Active Interaction'
        : 'Free-Standing / Unanchored',
      furnitureTarget: interactionEval.hasActiveInteraction
        ? interactionEval.preset?.furnitureTarget || null
        : null,
      hasActiveInteraction: interactionEval.hasActiveInteraction,
      effectiveEnvironmentPolicy: envResolution.effectiveMode,
      environmentPolicySummary: envResolution.modeLabel,
    },
    transformation: {
      scope,
      validationStatus: validation.overallStatus,
      issueCount: validation.issues.length,
    },
  };
}

/**
 * Returns a transparent preview of what a preset category will change vs preserve
 * before or when the user selects it.
 */
export function describePresetUpdateScope(
  category: 'camera' | 'pose' | 'scene_interaction',
  presetLabel: string
): PresetScopePreview {
  if (category === 'camera') {
    return {
      presetCategory: 'camera',
      presetLabel,
      changes: [
        'Camera orbit yaw & pitch angles',
        'Camera lens height, distance & roll',
      ],
      preserves: [
        'Subject world position (X, Z) & facing yaw',
        'Body pose, joint angles, hand gestures & gaze',
        'Active furniture interaction & support surface',
      ],
    };
  }

  if (category === 'pose') {
    return {
      presetCategory: 'pose',
      presetLabel,
      changes: [
        'Body posture & limb joint angles',
        'Clears furniture-anchored elevation/pelvis tilt for standing/floor poses',
      ],
      preserves: [
        'Subject world position (X, Z) & facing yaw',
        'Camera orbit angles, distance, lens & framing',
        'Camera target tracking mode',
      ],
    };
  }

  return {
    presetCategory: 'scene_interaction',
    presetLabel,
    changes: [
      'Subject anchor position (X, Z) & facing yaw on furniture',
      'Pelvis support elevation (seatHeightY) & body articulation',
      'Activates Source-Inspired Environment Transformation when needed',
    ],
    preserves: [
      'Camera orbit yaw, pitch, distance, lens & roll',
      'Subject facial identity, clothing & source lighting character',
    ],
  };
}

/**
 * Computes a concise diff between two Playboard states so the UI can show an
 * expected-change summary ("Changed: ... | Preserved: ...") after high-level actions.
 */
export function computeExpectedChangeSummary(
  prevConfig: PlayboardFullConfig,
  nextConfig: PlayboardFullConfig,
  actionLabel: string
): ExpectedChangeSummary {
  const changedCategories: string[] = [];
  const preservedCategories: string[] = [];

  const cameraAngleChanged =
    Math.round(prevConfig.camera.yawDeg) !==
      Math.round(nextConfig.camera.yawDeg) ||
    Math.round(prevConfig.camera.pitchDeg) !==
      Math.round(nextConfig.camera.pitchDeg) ||
    Math.abs(prevConfig.camera.height - nextConfig.camera.height) > 0.02 ||
    Math.round(prevConfig.camera.rollDeg) !==
      Math.round(nextConfig.camera.rollDeg);

  const cameraFramingChanged =
    prevConfig.camera.framing !== nextConfig.camera.framing ||
    Math.abs(prevConfig.camera.distance - nextConfig.camera.distance) > 0.04 ||
    prevConfig.camera.focalLength !== nextConfig.camera.focalLength;

  const subjectPosChanged =
    Math.abs(
      (prevConfig.pose.characterPosX ?? 0) -
        (nextConfig.pose.characterPosX ?? 0)
    ) > 0.02 ||
    Math.abs(
      (prevConfig.pose.characterPosZ ?? 0) -
        (nextConfig.pose.characterPosZ ?? 0)
    ) > 0.02 ||
    Math.round(prevConfig.pose.characterYawDeg ?? 0) !==
      Math.round(nextConfig.pose.characterYawDeg ?? 0);

  const bodyPoseChanged =
    prevConfig.pose.basePose !== nextConfig.pose.basePose ||
    prevConfig.pose.interactionPresetId !==
      nextConfig.pose.interactionPresetId ||
    prevConfig.pose.torsoLeanDeg !== nextConfig.pose.torsoLeanDeg ||
    prevConfig.pose.torsoTwistDeg !== nextConfig.pose.torsoTwistDeg ||
    prevConfig.pose.leftArmShoulderForwardDeg !==
      nextConfig.pose.leftArmShoulderForwardDeg ||
    prevConfig.pose.rightArmShoulderForwardDeg !==
      nextConfig.pose.rightArmShoulderForwardDeg ||
    prevConfig.pose.leftLegKneeBendDeg !== nextConfig.pose.leftLegKneeBendDeg ||
    prevConfig.pose.rightLegKneeBendDeg !== nextConfig.pose.rightLegKneeBendDeg;

  const gazeChanged =
    prevConfig.pose.gaze !== nextConfig.pose.gaze ||
    prevConfig.pose.expression !== nextConfig.pose.expression ||
    prevConfig.pose.headRotationDeg !== nextConfig.pose.headRotationDeg ||
    prevConfig.pose.headTiltDeg !== nextConfig.pose.headTiltDeg;

  if (cameraAngleChanged) {
    changedCategories.push('Camera Angle');
  } else {
    preservedCategories.push('Camera Angle');
  }

  if (cameraFramingChanged) {
    changedCategories.push('Framing & Distance');
  } else {
    preservedCategories.push('Framing & Distance');
  }

  if (subjectPosChanged) {
    changedCategories.push('Subject Position & Facing');
  } else {
    preservedCategories.push('Subject Position & Facing');
  }

  if (bodyPoseChanged) {
    changedCategories.push('Body Pose & Support Surface');
  } else {
    preservedCategories.push('Body Pose');
  }

  if (gazeChanged) {
    changedCategories.push('Head & Gaze');
  } else {
    preservedCategories.push('Head & Gaze');
  }

  return {
    actionLabel,
    changedCategories,
    preservedCategories,
    timestamp: Date.now(),
  };
}

/**
 * Strips transient joystick/animation locomotion flags when saving a persistent blueprint or checkpoint,
 * unless the user explicitly selected an intentional walking or waving pose preset.
 */
export function sanitizePersistentPlayboardConfig(
  config: PlayboardFullConfig
): PlayboardFullConfig {
  const intentionalWalk =
    config.pose.basePose === 'mid_stride_walking' ||
    config.pose.basePose === 'dynamic_running';
  const intentionalWave =
    config.pose.basePose === 'welcoming_wave' ||
    config.pose.leftHandGesture === 'wave' ||
    config.pose.rightHandGesture === 'wave';

  const targetMode = config.camera.targetMode || 'track_subject';
  const charX =
    typeof config.pose.characterPosX === 'number' &&
    Number.isFinite(config.pose.characterPosX)
      ? config.pose.characterPosX
      : 0;
  const charZ =
    typeof config.pose.characterPosZ === 'number' &&
    Number.isFinite(config.pose.characterPosZ)
      ? config.pose.characterPosZ
      : 0;

  return {
    ...config,
    camera: {
      ...config.camera,
      targetMode,
    },
    pose: {
      ...config.pose,
      characterPosX: charX,
      characterPosZ: charZ,
      characterYawDeg:
        typeof config.pose.characterYawDeg === 'number' &&
        Number.isFinite(config.pose.characterYawDeg)
          ? config.pose.characterYawDeg
          : 0,
      anchorPosX:
        targetMode === 'track_subject'
          ? charX
          : (config.pose.anchorPosX ?? charX),
      anchorPosZ:
        targetMode === 'track_subject'
          ? charZ
          : (config.pose.anchorPosZ ?? charZ),
      isWalking: intentionalWalk ? Boolean(config.pose.isWalking) : false,
      isWaving: intentionalWave ? Boolean(config.pose.isWaving) : false,
    },
  };
}

/**
 * Creates a named scene checkpoint snapshot that can be restored at any time.
 */
export function createPlayboardCheckpoint(
  config: PlayboardFullConfig,
  label: string,
  scope: I2ITransformationScope = 'both'
): PlayboardCheckpoint {
  const sanitized = sanitizePersistentPlayboardConfig(
    JSON.parse(JSON.stringify(config))
  );
  const inspection = inspectPlayboardSceneState(sanitized, scope);
  const summaryLine = `${inspection.framing.measuredLabel} • Cam ${inspection.camera.yawDeg}°/${inspection.camera.pitchDeg}° • ${inspection.environmentAndInteraction.hasActiveInteraction ? inspection.environmentAndInteraction.interactionLabel : inspection.subject.basePoseLabel}`;

  return {
    id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: label.trim() || 'Scene Checkpoint',
    createdAt: Date.now(),
    config: sanitized,
    scope,
    summaryLine,
  };
}

/**
 * Restores a PlayboardCheckpoint into an independent deep-cloned config and scope.
 */
export function restorePlayboardCheckpoint(checkpoint: PlayboardCheckpoint): {
  config: PlayboardFullConfig;
  scope: I2ITransformationScope;
} {
  const cloned = sanitizePersistentPlayboardConfig(
    JSON.parse(JSON.stringify(checkpoint.config))
  );
  return {
    config: cloned,
    scope: checkpoint.scope,
  };
}

/**
 * Creates an independent Shot Variation (A/B/C) with its own structured prompt summary and compiled prompt preview.
 */
export function createShotVariation(
  config: PlayboardFullConfig,
  name: string,
  scope: I2ITransformationScope = 'both'
): PlayboardShotVariation {
  const sanitized = sanitizePersistentPlayboardConfig(
    JSON.parse(JSON.stringify(config))
  );
  const fields = buildInitialI2IFields(sanitized, scope);
  const promptSummary = buildStructuredPromptSummary(sanitized, scope, fields);
  const compiledPromptPreview = compileFinalI2IPrompt(
    fields,
    scope,
    sanitized,
    'universal'
  );

  return {
    id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || 'Shot Variation',
    createdAt: Date.now(),
    config: sanitized,
    scope,
    promptSummary,
    compiledPromptPreview,
  };
}

/**
 * Activates a saved Shot Variation, returning a clean deep copy of its config, scope, and rebuilt I2I fields.
 */
export function activateShotVariation(variation: PlayboardShotVariation): {
  config: PlayboardFullConfig;
  scope: I2ITransformationScope;
  fields: I2IEditableField[];
  promptSummary: StructuredPromptSummary;
} {
  const cloned = sanitizePersistentPlayboardConfig(
    JSON.parse(JSON.stringify(variation.config))
  );
  const fields = buildInitialI2IFields(cloned, variation.scope);
  const promptSummary = buildStructuredPromptSummary(
    cloned,
    variation.scope,
    fields
  );
  return {
    config: cloned,
    scope: variation.scope,
    fields,
    promptSummary,
  };
}

/**
 * Compares two Shot Variations side by side and identifies exact differences across
 * camera, framing, pose, subject position, gaze, scene interaction, environment policy, and scope.
 */
export function compareShotVariations(
  variationA: PlayboardShotVariation,
  variationB: PlayboardShotVariation
): VariationComparisonReport {
  const inspA = inspectPlayboardSceneState(
    variationA.config,
    variationA.scope
  );
  const inspB = inspectPlayboardSceneState(
    variationB.config,
    variationB.scope
  );

  const differences: VariationFieldDiff[] = [
    {
      fieldLabel: 'Transformation Scope',
      variationAValue: variationA.scope,
      variationBValue: variationB.scope,
      isDifferent: variationA.scope !== variationB.scope,
    },
    {
      fieldLabel: 'Camera Angle & Distance',
      variationAValue: `Yaw ${inspA.camera.yawDeg}°, Pitch ${inspA.camera.pitchDeg}°, Dist ${inspA.camera.distance}m, H ${inspA.camera.height}m`,
      variationBValue: `Yaw ${inspB.camera.yawDeg}°, Pitch ${inspB.camera.pitchDeg}°, Dist ${inspB.camera.distance}m, H ${inspB.camera.height}m`,
      isDifferent:
        inspA.camera.yawDeg !== inspB.camera.yawDeg ||
        inspA.camera.pitchDeg !== inspB.camera.pitchDeg ||
        Math.abs(inspA.camera.distance - inspB.camera.distance) > 0.02 ||
        Math.abs(inspA.camera.height - inspB.camera.height) > 0.02,
    },
    {
      fieldLabel: 'Shot Framing',
      variationAValue: `${inspA.framing.measuredLabel} (req: ${inspA.framing.requestedFraming.replace(/_/g, ' ')})`,
      variationBValue: `${inspB.framing.measuredLabel} (req: ${inspB.framing.requestedFraming.replace(/_/g, ' ')})`,
      isDifferent:
        inspA.framing.measuredFraming !== inspB.framing.measuredFraming ||
        inspA.framing.requestedFraming !== inspB.framing.requestedFraming,
    },
    {
      fieldLabel: 'Subject Pose & Position',
      variationAValue: `${inspA.subject.basePoseLabel} at (${inspA.subject.posX}m, ${inspA.subject.posZ}m), Yaw ${inspA.subject.yawDeg}°`,
      variationBValue: `${inspB.subject.basePoseLabel} at (${inspB.subject.posX}m, ${inspB.subject.posZ}m), Yaw ${inspB.subject.yawDeg}°`,
      isDifferent:
        inspA.subject.basePose !== inspB.subject.basePose ||
        inspA.subject.posX !== inspB.subject.posX ||
        inspA.subject.posZ !== inspB.subject.posZ ||
        inspA.subject.yawDeg !== inspB.subject.yawDeg,
    },
    {
      fieldLabel: 'Scene Interaction & Surface',
      variationAValue: inspA.environmentAndInteraction.interactionLabel,
      variationBValue: inspB.environmentAndInteraction.interactionLabel,
      isDifferent:
        inspA.environmentAndInteraction.interactionPresetId !==
          inspB.environmentAndInteraction.interactionPresetId ||
        inspA.environmentAndInteraction.hasActiveInteraction !==
          inspB.environmentAndInteraction.hasActiveInteraction,
    },
    {
      fieldLabel: 'Gaze & Head Orientation',
      variationAValue: `${inspA.gazeAndHead.gazeMode.replace(/_/g, ' ')} (Head ${inspA.gazeAndHead.headRotationDeg}°/${inspA.gazeAndHead.headTiltDeg}°, ${inspA.gazeAndHead.expression.replace(/_/g, ' ')})`,
      variationBValue: `${inspB.gazeAndHead.gazeMode.replace(/_/g, ' ')} (Head ${inspB.gazeAndHead.headRotationDeg}°/${inspB.gazeAndHead.headTiltDeg}°, ${inspB.gazeAndHead.expression.replace(/_/g, ' ')})`,
      isDifferent:
        inspA.gazeAndHead.gazeMode !== inspB.gazeAndHead.gazeMode ||
        inspA.gazeAndHead.headRotationDeg !==
          inspB.gazeAndHead.headRotationDeg ||
        inspA.gazeAndHead.headTiltDeg !== inspB.gazeAndHead.headTiltDeg ||
        inspA.gazeAndHead.expression !== inspB.gazeAndHead.expression,
    },
    {
      fieldLabel: 'Environment & Continuity Policy',
      variationAValue: `${inspA.environmentAndInteraction.environment} (${inspA.environmentAndInteraction.environmentPolicySummary})`,
      variationBValue: `${inspB.environmentAndInteraction.environment} (${inspB.environmentAndInteraction.environmentPolicySummary})`,
      isDifferent:
        inspA.environmentAndInteraction.environment !==
          inspB.environmentAndInteraction.environment ||
        inspA.environmentAndInteraction.effectiveEnvironmentPolicy !==
          inspB.environmentAndInteraction.effectiveEnvironmentPolicy,
    },
  ];

  const changedLabels = differences
    .filter((d) => d.isDifferent)
    .map((d) => d.fieldLabel);

  const summary =
    changedLabels.length === 0
      ? `"${variationA.name}" and "${variationB.name}" have identical scene parameters.`
      : `${changedLabels.length} area(s) differ between "${variationA.name}" and "${variationB.name}": ${changedLabels.join(', ')}.`;

  return {
    variationAId: variationA.id,
    variationAName: variationA.name,
    variationBId: variationB.id,
    variationBName: variationB.name,
    differences,
    summary,
  };
}
