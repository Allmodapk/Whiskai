import { TargetModelType } from './index';

export type CameraViewPreset =
  | 'eye_level_front'
  | 'three_quarter_left'
  | 'three_quarter_right'
  | 'side_profile_left'
  | 'side_profile_right'
  | 'rear_three_quarter'
  | 'rear_view'
  | 'low_angle_hero'
  | 'worms_eye_ground'
  | 'high_angle_editorial'
  | 'birds_eye_overhead'
  | 'over_the_shoulder'
  | 'dutch_angle_tilt';

export type PosePreset =
  | 'natural_standing'
  | 'contrapposto'
  | 'power_stance'
  | 'casual_sitting'
  | 'floor_seated_cross_legged'
  | 'mid_stride_walking'
  | 'dynamic_running'
  | 'grounded_kneeling'
  | 'deep_squat'
  | 'reclined_lying'
  | 'wall_lean'
  | 'welcoming_wave'
  | 'all_fours_neutral'
  | 'cow_pose_arched'
  | 'cat_pose_rounded'
  | 'all_fours_rear_presentation'
  | 'prone_hip_elevated'
  | 'kneeling_forward_fold'
  | 'bent_over_support'
  | 'side_lying_open';

export type HandGesture =
  | 'relaxed_natural'
  | 'open_palm'
  | 'wave'
  | 'pointing'
  | 'thumbs_up'
  | 'fist'
  | 'peace_sign'
  | 'hand_on_hip'
  | 'raised_up'
  | 'hands_clasped'
  | 'touching_face'
  | 'soft_pinch_gap'
  | 'cupped_palm_inward';

export type GazeDirection =
  | 'direct_at_camera'
  | 'looking_camera_left'
  | 'looking_camera_right'
  | 'looking_upward'
  | 'looking_downward'
  | 'soft_off_camera'
  | 'eyes_closed';

export type FacialExpression =
  | 'neutral_relaxed'
  | 'gentle_smile'
  | 'confident_focused'
  | 'thoughtful_pensive'
  | 'serious_editorial'
  | 'expressive_laugh'
  | 'determined_intense'
  | 'open_mouth_shock'
  | 'intense_open_mouth'
  | 'gasping_open';

export type ShotFraming =
  | 'extreme_close_up'
  | 'close_up_portrait'
  | 'medium_close_up'
  | 'medium_shot'
  | 'three_quarter_shot'
  | 'full_shot'
  | 'wide_shot';

export type LensFocalLength =
  | '16mm_ultra_wide'
  | '24mm_wide'
  | '35mm_moderate_wide'
  | '50mm_standard_normal'
  | '85mm_portrait_telephoto'
  | '135mm_telephoto';

export type FocusDof =
  | 'shallow_f1_4'
  | 'moderate_f4_0'
  | 'deep_f11';

export type SubjectComposition =
  | 'center'
  | 'rule_of_thirds_left'
  | 'rule_of_thirds_right'
  | 'low_frame'
  | 'high_frame';

export type PlayboardEnvironment =
  | 'studio_bedroom'
  | 'minimal_neutral'
  | 'cyber_grid';

export type PlayboardLightingPreset =
  | 'daylight_warm'
  | 'golden_hour'
  | 'cozy_evening'
  | 'studio_neutral';

export type PlayboardInteractiveHandleId =
  | 'root_translate'
  | 'root_ring'
  | 'root_yaw'
  | 'yaw_ring'
  | 'pelvis_height'
  | 'pelvis'
  | 'head_aim'
  | 'head'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_knee'
  | 'right_knee'
  | null;

export type PlayboardSupportSurfaceId =
  | 'floor'
  | 'rug'
  | 'bed_mattress'
  | 'bed_pillow'
  | 'chair_seat'
  | 'desk_top'
  | 'window_bench';

export type CameraTargetMode =
  | 'track_subject'
  | 'fixed_composition';

/**
 * Policy controlling how the source image's environment is handled during I2I generation:
 * - 'auto': Automatically preserves the original physical environment unless an active scene
 *   interaction requires new furniture/setting (e.g., bed, chair, desk), in which case it uses
 *   source-inspired environment transformation.
 * - 'preserve_physical_environment': Preserves the original physical background and existing objects.
 * - 'source_inspired_transformation': Introduces the required physical setting/furniture while using
 *   the source image as the visual reference for lighting character, tonal balance, shadow softness,
 *   color grading, skin appearance, and photographic texture.
 * - 'replace_environment': Transitions the surrounding stage environment to the selected 3D stage.
 */
export type EnvironmentTransformationPolicy =
  | 'auto'
  | 'preserve_physical_environment'
  | 'source_inspired_transformation'
  | 'replace_environment';

export type ResolvedEnvironmentPolicyMode =
  | 'preserve_physical_environment'
  | 'source_inspired_transformation'
  | 'replace_environment';

export interface CustomModelBounds {
  minY: number;
  maxY: number;
  height: number;
  width: number;
  depth: number;
  centerX?: number;
  centerZ?: number;
  hasSkeleton?: boolean;
  boneCount?: number;
  handBoneCount?: number;
  hasHeadBone?: boolean;
  scaleMultiplier?: number;
  offsetY?: number;
  yawOffsetDeg?: number;
}

export interface CustomModelDiagnostics {
  isActive: boolean;
  hasSkeletalRig: boolean;
  boneCount: number;
  handBoneCount?: number;
  hasHeadBone?: boolean;
  normalizedHeight: number;
  normalizedWidth: number;
  normalizedDepth: number;
  scaleMultiplier: number;
  offsetY: number;
  yawOffsetDeg: number;
  usesApproximateLandmarks: boolean;
  statusSummary: string;
}

export interface PlayboardVisualGuidesConfig {
  groundGrid: boolean;
  worldAxes: boolean;
  subjectOriginAndFacing: boolean;
  movementDirection: boolean;
  cameraGizmoAndTarget: boolean;
  headAndGazeVectors: boolean;
  ruleOfThirdsOverlay: boolean;
  safeFramingGuides: boolean;
}

export interface Camera3DSettings {
  yawDeg: number;          // -180 to 180 (0 = front (+Z), +90 = subject's right profile (+X), -90 = subject's left profile (-X), ±180 = rear (-Z))
  pitchDeg: number;        // -30 to 80 (0 = horizontal orbit plane, >0 = elevated orbit looking down at lookTarget, <0 = low orbit looking up at lookTarget)
  height: number;
  distance: number;        // 1.0m to 6.5m (3D orbit distance from lookTarget to camera lens)
  rollDeg: number;         // -30 to 30 (Dutch angle tilt)
  focalLength: LensFocalLength;
  framing: ShotFraming;
  composition: SubjectComposition;
  outputRatio: string;     // '3:4', '1:1', '16:9', etc.
  orientation: 'Portrait' | 'Landscape' | 'Square';
  focusDof: FocusDof;
  targetMode?: CameraTargetMode;
}

export type SceneInteractionCategory =
  | 'standing_wall'
  | 'chair_sitting'
  | 'bed_sitting'
  | 'bed_lying'
  | 'kneeling_floor'
  | 'leaning';

export type SupportSurfaceId =
  | 'floor_center'
  | 'area_rug'
  | 'bed_mattress'
  | 'bed_pillows'
  | 'bed_edge_front'
  | 'bed_bench'
  | 'club_armchair'
  | 'window_bench'
  | 'desk_console'
  | 'bedside_table'
  | 'studio_wall';

export type SceneInteractionPresetId =
  // 1. Standing & Wall Interaction
  | 'stand_natural_room'
  | 'stand_contrapposto_rug'
  | 'stand_wall_shoulder_lean'
  | 'stand_wall_back_relaxed_knees'
  | 'stand_beside_bed'
  | 'stand_beside_nightstand'
  | 'stand_both_hands_on_bench'
  // A. Sitting on the bed
  | 'bed_sit_edge_forward'
  | 'bed_sit_left_edge'
  | 'bed_sit_right_edge'
  | 'bed_sit_sideways_hanging'
  | 'bed_sit_legs_together'
  | 'bed_sit_legs_apart'
  | 'bed_sit_lean_forward_elbows'
  | 'bed_sit_lean_back_hands'
  | 'bed_sit_one_leg_bent'
  | 'bed_sit_look_over_shoulder'
  | 'bed_sit_cross_legged'
  | 'bed_sit_headboard_pillows'
  | 'bed_kneel_upright_mattress'
  | 'bed_lean_hands_on_edge'
  // B. Sitting on a chair / bench / sofa
  | 'chair_sit_upright_thighs'
  | 'chair_sit_relaxed_slouch'
  | 'chair_sit_legs_together'
  | 'chair_sit_legs_apart'
  | 'chair_sit_legs_crossed'
  | 'chair_sit_legs_extended'
  | 'chair_sit_lean_forward'
  | 'chair_sit_lean_back'
  | 'chair_sit_arm_on_desk'
  | 'chair_sit_turn_sideways'
  | 'chair_sit_edge_perched'
  | 'window_bench_sit_upright'
  | 'window_bench_recline_side'
  | 'bed_bench_sit_forward'
  // C. Lying on the bed
  | 'bed_lie_back'
  | 'bed_lie_side'
  | 'bed_lie_side_right'
  | 'bed_lie_stomach'
  | 'bed_lie_recline_pillows'
  | 'bed_lie_knees_bent'
  | 'bed_lie_arm_above_head'
  | 'bed_lie_hands_behind_head'
  | 'bed_lie_look_side'
  // D. Kneeling and floor poses
  | 'floor_kneel_upright'
  | 'floor_kneel_one_knee'
  | 'floor_deep_squat'
  | 'floor_kneel_lean_forward'
  | 'floor_kneel_hands_on_bed'
  | 'floor_sit_on_heels'
  | 'floor_sit_cross_legged'
  | 'floor_sit_side_mermaid'
  | 'floor_recline_on_elbow'
  | 'floor_sit_back_against_bed'
  | 'floor_sit_back_against_wall'
  | 'floor_sit_knees_raised'
  | 'floor_all_fours_neutral'
  | 'floor_cow_pose_arch'
  | 'floor_cat_pose_round'
  | 'floor_kneeling_child_fold'
  // E. Table, Desk & Bedside Furniture Interactions
  | 'lean_against_wall'
  | 'lean_against_desk'
  | 'lean_forward_hands_on_desk'
  | 'stand_beside_desk_hand_rest'
  | 'lean_back_desk_edge'
  | 'desk_sit_on_edge'
  | 'nightstand_reach_hand'
  | 'nightstand_crouch_beside';

export interface CharacterPose3DSettings {
  basePose: PosePreset;
  torsoLeanDeg: number;     // -25 to 25 (forward/backward)
  torsoTwistDeg: number;    // -40 to 40 (left/right rotation)
  torsoTiltDeg: number;     // -20 to 20 (lateral side lean)
  headRotationDeg: number;  // -75 to 75 (yaw)
  headTiltDeg: number;      // -35 to 35 (pitch up/down)
  gaze: GazeDirection;
  expression: FacialExpression;

  // Left Arm (Character's physical left side)
  leftArmShoulderForwardDeg: number;   // -45 to 110
  leftArmShoulderOutDeg: number;        // 0 to 90
  leftArmElbowBendDeg: number;          // 0 to 140
  leftArmWristDeg: number;              // -30 to 30
  leftHandGesture: HandGesture;

  // Right Arm (Character's physical right side)
  rightArmShoulderForwardDeg: number;  // -45 to 110
  rightArmShoulderOutDeg: number;       // 0 to 90
  rightArmElbowBendDeg: number;         // 0 to 140
  rightArmWristDeg: number;             // -30 to 30
  rightHandGesture: HandGesture;

  // Left Leg (Character's physical left side)
  leftLegHipForwardDeg: number;         // -50 to 90
  leftLegHipOutDeg: number;             // 0 to 45
  leftLegKneeBendDeg: number;           // 0 to 130
  leftFootAngleDeg: number;             // -20 to 20

  // Right Leg (Character's physical right side)
  rightLegHipForwardDeg: number;        // -50 to 90
  rightLegHipOutDeg: number;            // 0 to 45
  rightLegKneeBendDeg: number;          // 0 to 130
  rightFootAngleDeg: number;            // -20 to 20

  // Animation walk/wave state & 3D world orientation/position
  isWalking: boolean;
  isWaving: boolean;
  hipHeightOffset: number;
  characterYawDeg?: number; // World Y rotation of the character in degrees (-180 to 180, default 0 = facing +Z)
  characterPosX?: number;   // Ground X position in meters (default 0)
  characterPosZ?: number;   // Ground Z position in meters (default 0)

  // Scene interaction & root pelvis articulation
  interactionPresetId?: SceneInteractionPresetId | null;
  seatHeightY?: number | null; // Explicit pelvis Y height in meters when seated/lying on furniture
  pelvisPitchDeg?: number;     // Root pelvis pitch in degrees (e.g., -88 for supine, +86 for prone)
  pelvisRollDeg?: number;      // Root pelvis roll in degrees (e.g., +82 for side-lying)
  anchorPosX?: number;         // Scene object anchor X in meters
  anchorPosZ?: number;         // Scene object anchor Z in meters
  customModelBounds?: CustomModelBounds | null; // Optional bounding box for custom GLB models
}

export interface PlayboardFullConfig {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  environment: PlayboardEnvironment;
  lightingPreset?: PlayboardLightingPreset;
  instantPoseTransitions?: boolean;
  camera: Camera3DSettings;
  pose: CharacterPose3DSettings;
  preserveEnvironment?: boolean;
  environmentPolicy?: EnvironmentTransformationPolicy;
  sourceVisualNotes?: string;
}

export type I2ITransformationScope =
  | 'both'
  | 'camera_only'
  | 'pose_only'
  | 'custom';

export type I2IFieldId =
  | 'identity_preservation'
  | 'camera_framing'
  | 'body_pose_torso'
  | 'arms_and_hands'
  | 'legs_and_feet'
  | 'head_gaze_expression'
  | 'scene_preservation'
  | 'transformation_constraints';

export interface I2IEditableField {
  id: I2IFieldId;
  label: string;
  subtitle: string;
  defaultText: string;
  userText: string;
  isLocked: boolean;
  isRemoved: boolean;
  order: number;
}

export type PromptValidationStatus =
  | 'consistent'
  | 'warning'
  | 'conflict'
  | 'not_verifiable';

export interface PromptValidationIssue {
  id: string;
  status: PromptValidationStatus;
  title: string;
  message: string;
  affectedFields: I2IFieldId[];
  actionLabel?: string;
  actionType?:
    | 'fix_framing_distance'
    | 'sync_framing_to_measured'
    | 'switch_to_bedroom_environment'
    | 'switch_scope_to_both'
    | 'enable_source_inspired_environment'
    | 'sync_unlocked_i2i_fields'
    | 'reset_hands_to_support';
}

export interface StructuredPromptSummary {
  identitySummary: string;
  poseSummary: string;
  cameraSummary: string;
  gazeSummary: string;
  environmentSummary: string;
  scopeSummary: string;
  effectiveEnvironmentPolicy: ResolvedEnvironmentPolicyMode;
  preservesList: string[];
  changesList: string[];
}

export interface PromptValidationReport {
  overallStatus: PromptValidationStatus;
  issues: PromptValidationIssue[];
  summary: StructuredPromptSummary;
}

export interface ExpectedChangeSummary {
  actionLabel: string;
  changedCategories: string[];
  preservedCategories: string[];
  timestamp: number;
}

export interface PresetScopePreview {
  presetCategory: 'camera' | 'pose' | 'scene_interaction';
  presetLabel: string;
  changes: string[];
  preserves: string[];
}

export interface PlayboardCheckpoint {
  id: string;
  label: string;
  createdAt: number;
  config: PlayboardFullConfig;
  scope: I2ITransformationScope;
  summaryLine: string;
}

export interface PlayboardShotVariation {
  id: string;
  name: string;
  createdAt: number;
  config: PlayboardFullConfig;
  scope: I2ITransformationScope;
  promptSummary: StructuredPromptSummary;
  compiledPromptPreview: string;
}

export interface VariationFieldDiff {
  fieldLabel: string;
  variationAValue: string;
  variationBValue: string;
  isDifferent: boolean;
}

export interface VariationComparisonReport {
  variationAId: string;
  variationAName: string;
  variationBId: string;
  variationBName: string;
  differences: VariationFieldDiff[];
  summary: string;
}

export interface SceneStateInspectionSummary {
  subject: {
    posX: number;
    posZ: number;
    yawDeg: number;
    basePose: PosePreset;
    basePoseLabel: string;
    isCustomModel: boolean;
    customModelStatus: string;
  };
  camera: {
    yawDeg: number;
    pitchDeg: number;
    distance: number;
    height: number;
    lensWorldY: number;
    focalLength: LensFocalLength;
    outputRatio: string;
    targetMode: CameraTargetMode;
    lookTargetXZ: { x: number; z: number };
  };
  framing: {
    requestedFraming: ShotFraming;
    measuredFraming: ShotFraming;
    measuredLabel: string;
    matchesRequest: boolean;
    discrepancyNote: string | null;
  };
  gazeAndHead: {
    headRotationDeg: number;
    headTiltDeg: number;
    gazeMode: GazeDirection;
    expression: FacialExpression;
    relativeToHeadYawDeg: number;
    cameraToEyeElevationDeg: number;
    canAchieveDirectLensContact: boolean;
    requiresEyeOnlyCompensation: boolean;
    eyeContactSummary: string;
  };
  environmentAndInteraction: {
    environment: PlayboardEnvironment;
    interactionPresetId: SceneInteractionPresetId | null;
    interactionLabel: string;
    furnitureTarget: string | null;
    hasActiveInteraction: boolean;
    effectiveEnvironmentPolicy: ResolvedEnvironmentPolicyMode;
    environmentPolicySummary: string;
  };
  transformation: {
    scope: I2ITransformationScope;
    validationStatus: PromptValidationStatus;
    issueCount: number;
  };
}
