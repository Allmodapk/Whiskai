import React, { useState, useEffect, useMemo } from 'react';
import {
  Camera3DSettings,
  CharacterPose3DSettings,
  PlayboardFullConfig,
  CameraViewPreset,
  PosePreset,
  HandGesture,
  GazeDirection,
  FacialExpression,
  ShotFraming,
  LensFocalLength,
  FocusDof,
  SubjectComposition,
  PlayboardEnvironment,
  I2ITransformationScope,
  I2IEditableField,
  SceneInteractionCategory,
  EnvironmentTransformationPolicy,
  PlayboardVisualGuidesConfig,
  PlayboardCheckpoint,
  PlayboardShotVariation,
  ExpectedChangeSummary,
  PromptValidationIssue,
  PlayboardLightingPreset,
} from '../types/cameraPlayboard';
import { TargetModelType } from '../types';
import { Playboard3DCanvas, DEFAULT_VISUAL_GUIDES } from './Playboard3DCanvas';
import { PWAInstallButton } from './PWAInstallButton';
import {
  buildPlayboardT2IPrompt,
  buildInitialI2IFields,
  syncI2IFieldsWithConfig,
  compileFinalI2IPrompt,
  analyzePlayboardFraming,
  parseOutputAspectRatio,
  switchCameraTargetMode,
  applyRequestedFramingState,
  applyPosePresetState,
  applyCameraPresetState,
  applySceneInteractionPresetState,
  resetPoseState,
  resetCameraState,
  resetSubjectPositionState,
  resetAllPlayboardState,
  migrateLegacyPlayboardConfig,
  getCustomModelDiagnostics,
  resolveEnvironmentTransformationPolicy,
  buildStructuredPromptSummary,
  validatePlayboardPromptConsistency,
  inspectPlayboardSceneState,
  describePresetUpdateScope,
  computeExpectedChangeSummary,
  createPlayboardCheckpoint,
  restorePlayboardCheckpoint,
  createShotVariation,
  activateShotVariation,
  compareShotVariations,
} from '../services/cameraPlayboardPrompts';
import {
  SCENE_INTERACTION_CATEGORIES,
  SCENE_INTERACTION_PRESETS,
  SceneInteractionPreset,
  getInteractionPresetById,
  BEDROOM_SUPPORT_SURFACES,
  BedroomSupportSurfaceSpec,
  inferActiveSupportSurface,
  clampPosePlacementToSupportBounds,
} from '../services/sceneInteractionPresets';
import {
  Camera,
  User,
  RotateCcw,
  Sparkles,
  Copy,
  Check,
  Download,
  Eye,
  Lock,
  Unlock,
  Trash2,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Smartphone,
  Save,
  FolderOpen,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Sliders,
  Maximize2,
  Minimize2,
} from 'lucide-react';

export interface CameraPlayboardStudioProps {
  onBackToMain?: () => void;
  subMode?: 'playboard' | 'extractor';
  onSubModeChange?: (mode: 'playboard' | 'extractor') => void;
}

const DEFAULT_CAMERA: Camera3DSettings = {
  yawDeg: 0,
  pitchDeg: 12,
  height: 1.4,
  distance: 3.2,
  rollDeg: 0,
  focalLength: '50mm_standard_normal',
  framing: 'medium_shot',
  composition: 'center',
  outputRatio: '3:4',
  orientation: 'Portrait',
  focusDof: 'shallow_f1_4',
  targetMode: 'track_subject',
};

const DEFAULT_POSE: CharacterPose3DSettings = {
  basePose: 'natural_standing',
  torsoLeanDeg: 0,
  torsoTwistDeg: 0,
  torsoTiltDeg: 0,
  headRotationDeg: 0,
  headTiltDeg: 0,
  gaze: 'direct_at_camera',
  expression: 'neutral_relaxed',
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
  characterYawDeg: 0,
  characterPosX: 0,
  characterPosZ: 0,
  interactionPresetId: null,
  seatHeightY: null,
  pelvisPitchDeg: 0,
  pelvisRollDeg: 0,
  anchorPosX: 0,
  anchorPosZ: 0,
};

const CAMERA_PRESETS: { id: CameraViewPreset; label: string; desc: string; values: Partial<Camera3DSettings> }[] = [
  {
    id: 'eye_level_front',
    label: 'Eye-Level Front',
    desc: 'Direct frontal portrait viewpoint at subject eye-height',
    values: { yawDeg: 0, pitchDeg: 2, height: 1.4, distance: 3.0, rollDeg: 0, framing: 'medium_shot' },
  },
  {
    id: 'three_quarter_left',
    label: '3/4 View Left',
    desc: 'Classic 45° angle viewing subject’s left side (-45° yaw)',
    values: { yawDeg: -45, pitchDeg: 6, height: 1.45, distance: 3.1, rollDeg: 0, framing: 'medium_shot' },
  },
  {
    id: 'three_quarter_right',
    label: '3/4 View Right',
    desc: 'Classic 45° angle viewing subject’s right side (+45° yaw)',
    values: { yawDeg: 45, pitchDeg: 6, height: 1.45, distance: 3.1, rollDeg: 0, framing: 'medium_shot' },
  },
  {
    id: 'side_profile_left',
    label: 'Profile Left',
    desc: '90° lateral profile viewing subject’s left side (-90° yaw)',
    values: { yawDeg: -90, pitchDeg: 0, height: 1.4, distance: 2.9, rollDeg: 0, framing: 'medium_shot' },
  },
  {
    id: 'side_profile_right',
    label: 'Profile Right',
    desc: '90° lateral profile viewing subject’s right side (+90° yaw)',
    values: { yawDeg: 90, pitchDeg: 0, height: 1.4, distance: 2.9, rollDeg: 0, framing: 'medium_shot' },
  },
  {
    id: 'rear_three_quarter',
    label: 'Rear 3/4 View',
    desc: 'Dynamic over-shoulder perspective from behind',
    values: { yawDeg: 140, pitchDeg: 8, height: 1.5, distance: 3.2, rollDeg: 0, framing: 'medium_shot' },
  },
  {
    id: 'rear_view',
    label: 'Direct Rear View',
    desc: 'Full back view showing silhouette and environment',
    values: { yawDeg: 180, pitchDeg: 4, height: 1.4, distance: 3.4, rollDeg: 0, framing: 'full_shot' },
  },
  {
    id: 'low_angle_hero',
    label: 'Low-Angle Hero',
    desc: 'Waist-height camera tilted upward for commanding presence',
    values: { yawDeg: 15, pitchDeg: -18, height: 0.65, distance: 2.6, rollDeg: 0, framing: 'full_shot' },
  },
  {
    id: 'worms_eye_ground',
    label: 'Worm’s-Eye Ground',
    desc: 'Extreme ground-level perspective looking up',
    values: { yawDeg: 0, pitchDeg: -25, height: 0.3, distance: 2.0, rollDeg: 0, framing: 'full_shot' },
  },
  {
    id: 'high_angle_editorial',
    label: 'High-Angle Editorial',
    desc: 'Elevated camera looking down on subject',
    values: { yawDeg: -25, pitchDeg: 35, height: 2.4, distance: 2.8, rollDeg: 0, framing: 'medium_close_up' },
  },
  {
    id: 'birds_eye_overhead',
    label: 'Bird’s-Eye Overhead',
    desc: 'Near-vertical overhead vantage point looking down',
    values: { yawDeg: 0, pitchDeg: 72, height: 3.1, distance: 3.6, rollDeg: 0, framing: 'wide_shot' },
  },
  {
    id: 'over_the_shoulder',
    label: 'Over-The-Shoulder',
    desc: 'Intimate close perspective framing subject over shoulder',
    values: { yawDeg: 165, pitchDeg: 6, height: 1.48, distance: 1.8, rollDeg: 0, framing: 'close_up_portrait' },
  },
  {
    id: 'dutch_angle_tilt',
    label: 'Dutch Angle Tilt',
    desc: 'Stylized 15° camera roll creating dynamic tension',
    values: { yawDeg: 30, pitchDeg: 10, height: 1.3, distance: 2.8, rollDeg: 16, framing: 'medium_shot' },
  },
];

const POSE_PRESETS: { id: PosePreset; label: string; desc: string; values: Partial<CharacterPose3DSettings> }[] = [
  {
    id: 'natural_standing',
    label: 'Natural Standing',
    desc: 'Relaxed balanced posture, natural arm hang',
    values: {
      basePose: 'natural_standing',
      torsoLeanDeg: 0,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: 0,
      leftArmShoulderForwardDeg: 0,
      leftArmShoulderOutDeg: 12,
      leftArmElbowBendDeg: 15,
      rightArmShoulderForwardDeg: 0,
      rightArmShoulderOutDeg: 12,
      rightArmElbowBendDeg: 15,
      leftLegHipForwardDeg: 0,
      leftLegHipOutDeg: 6,
      leftLegKneeBendDeg: 4,
      rightLegHipForwardDeg: 0,
      rightLegHipOutDeg: 6,
      rightLegKneeBendDeg: 4,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: 0,
    },
  },
  {
    id: 'contrapposto',
    label: 'Contrapposto Stance',
    desc: 'Classical weight shift to one hip with relaxed opposite leg',
    values: {
      basePose: 'contrapposto',
      torsoLeanDeg: 2,
      torsoTwistDeg: 8,
      torsoTiltDeg: -7,
      headRotationDeg: -10,
      headTiltDeg: 5,
      leftArmShoulderForwardDeg: 5,
      leftArmShoulderOutDeg: 16,
      leftArmElbowBendDeg: 30,
      rightArmShoulderForwardDeg: -8,
      rightArmShoulderOutDeg: 38,
      rightArmElbowBendDeg: 85,
      rightHandGesture: 'hand_on_hip',
      leftLegHipForwardDeg: 12,
      leftLegHipOutDeg: 10,
      leftLegKneeBendDeg: 22,
      rightLegHipForwardDeg: -4,
      rightLegHipOutDeg: 4,
      rightLegKneeBendDeg: 2,
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.02,
    },
  },
  {
    id: 'power_stance',
    label: 'Power Stance',
    desc: 'Assertive widened stance with both hands on hips',
    values: {
      basePose: 'power_stance',
      torsoLeanDeg: -4,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: 8,
      leftArmShoulderForwardDeg: -10,
      leftArmShoulderOutDeg: 45,
      leftArmElbowBendDeg: 90,
      leftHandGesture: 'hand_on_hip',
      rightArmShoulderForwardDeg: -10,
      rightArmShoulderOutDeg: 45,
      rightArmElbowBendDeg: 90,
      rightHandGesture: 'hand_on_hip',
      leftLegHipForwardDeg: 0,
      leftLegHipOutDeg: 20,
      leftLegKneeBendDeg: 6,
      rightLegHipForwardDeg: 0,
      rightLegHipOutDeg: 20,
      rightLegKneeBendDeg: 6,
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.04,
    },
  },
  {
    id: 'casual_sitting',
    label: 'Casual Sitting',
    desc: 'Seated posture with hips lowered, hands on thighs',
    values: {
      basePose: 'casual_sitting',
      torsoLeanDeg: 6,
      torsoTwistDeg: 4,
      torsoTiltDeg: 0,
      leftArmShoulderForwardDeg: 25,
      leftArmShoulderOutDeg: 18,
      leftArmElbowBendDeg: 75,
      rightArmShoulderForwardDeg: 25,
      rightArmShoulderOutDeg: 18,
      rightArmElbowBendDeg: 75,
      leftLegHipForwardDeg: 80,
      leftLegHipOutDeg: 14,
      leftLegKneeBendDeg: 85,
      rightLegHipForwardDeg: 80,
      rightLegHipOutDeg: 14,
      rightLegKneeBendDeg: 85,
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.32,
    },
  },
  {
    id: 'floor_seated_cross_legged',
    label: 'Seated Cross-Legged',
    desc: 'Grounded floor meditation pose with relaxed posture',
    values: {
      basePose: 'floor_seated_cross_legged',
      torsoLeanDeg: 2,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      leftArmShoulderForwardDeg: 20,
      leftArmShoulderOutDeg: 24,
      leftArmElbowBendDeg: 60,
      rightArmShoulderForwardDeg: 20,
      rightArmShoulderOutDeg: 24,
      rightArmElbowBendDeg: 60,
      leftLegHipForwardDeg: 70,
      leftLegHipOutDeg: 40,
      leftLegKneeBendDeg: 110,
      rightLegHipForwardDeg: 70,
      rightLegHipOutDeg: 40,
      rightLegKneeBendDeg: 110,
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.65,
    },
  },
  {
    id: 'mid_stride_walking',
    label: 'Mid-Stride Walking',
    desc: 'Dynamic captured step with arms swinging naturally',
    values: {
      basePose: 'mid_stride_walking',
      torsoLeanDeg: 6,
      torsoTwistDeg: -8,
      torsoTiltDeg: 0,
      leftArmShoulderForwardDeg: 35,
      leftArmShoulderOutDeg: 14,
      leftArmElbowBendDeg: 35,
      rightArmShoulderForwardDeg: -28,
      rightArmShoulderOutDeg: 14,
      rightArmElbowBendDeg: 20,
      leftLegHipForwardDeg: -32,
      leftLegHipOutDeg: 8,
      leftLegKneeBendDeg: 15,
      rightLegHipForwardDeg: 40,
      rightLegHipOutDeg: 8,
      rightLegKneeBendDeg: 30,
      isWalking: true,
      isWaving: false,
      hipHeightOffset: 0,
    },
  },
  {
    id: 'dynamic_running',
    label: 'Dynamic Running',
    desc: 'Athletic forward drive with acute knee articulation',
    values: {
      basePose: 'dynamic_running',
      torsoLeanDeg: 18,
      torsoTwistDeg: -12,
      torsoTiltDeg: 2,
      leftArmShoulderForwardDeg: 60,
      leftArmShoulderOutDeg: 18,
      leftArmElbowBendDeg: 85,
      rightArmShoulderForwardDeg: -40,
      rightArmShoulderOutDeg: 18,
      rightArmElbowBendDeg: 75,
      leftLegHipForwardDeg: -45,
      leftLegHipOutDeg: 10,
      leftLegKneeBendDeg: 55,
      rightLegHipForwardDeg: 65,
      rightLegHipOutDeg: 10,
      rightLegKneeBendDeg: 80,
      isWalking: true,
      isWaving: false,
      hipHeightOffset: -0.05,
    },
  },
  {
    id: 'grounded_kneeling',
    label: 'Grounded Kneeling',
    desc: 'Low kneeling pose on one or both knees',
    values: {
      basePose: 'grounded_kneeling',
      torsoLeanDeg: 4,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      leftLegHipForwardDeg: 60,
      leftLegHipOutDeg: 12,
      leftLegKneeBendDeg: 90,
      rightLegHipForwardDeg: -10,
      rightLegHipOutDeg: 10,
      rightLegKneeBendDeg: 110,
      leftArmShoulderForwardDeg: 10,
      leftArmShoulderOutDeg: 14,
      leftArmElbowBendDeg: 40,
      rightArmShoulderForwardDeg: 10,
      rightArmShoulderOutDeg: 14,
      rightArmElbowBendDeg: 40,
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.42,
    },
  },
  {
    id: 'deep_squat',
    label: 'Deep Squat',
    desc: 'Low grounded athletic crouch with knees flared outward',
    values: {
      basePose: 'deep_squat',
      torsoLeanDeg: 22,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      leftLegHipForwardDeg: 75,
      leftLegHipOutDeg: 35,
      leftLegKneeBendDeg: 120,
      rightLegHipForwardDeg: 75,
      rightLegHipOutDeg: 35,
      rightLegKneeBendDeg: 120,
      leftArmShoulderForwardDeg: 40,
      leftArmShoulderOutDeg: 20,
      leftArmElbowBendDeg: 60,
      rightArmShoulderForwardDeg: 40,
      rightArmShoulderOutDeg: 20,
      rightArmElbowBendDeg: 60,
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.48,
    },
  },
  {
    id: 'reclined_lying',
    label: 'Reclined Lounge',
    desc: 'Relaxed reclined posture with propped elbows and extended legs',
    values: {
      basePose: 'reclined_lying',
      torsoLeanDeg: -22,
      torsoTwistDeg: 5,
      torsoTiltDeg: 0,
      headRotationDeg: 8,
      headTiltDeg: -12,
      leftArmShoulderForwardDeg: -25,
      leftArmShoulderOutDeg: 28,
      leftArmElbowBendDeg: 80,
      rightArmShoulderForwardDeg: 15,
      rightArmShoulderOutDeg: 20,
      rightArmElbowBendDeg: 55,
      leftLegHipForwardDeg: 25,
      leftLegHipOutDeg: 12,
      leftLegKneeBendDeg: 35,
      rightLegHipForwardDeg: 10,
      rightLegHipOutDeg: 8,
      rightLegKneeBendDeg: 12,
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.68,
    },
  },
  {
    id: 'wall_lean',
    label: 'Casual Wall Lean',
    desc: 'Relaxed editorial lean back with crossed ankle stance',
    values: {
      basePose: 'wall_lean',
      torsoLeanDeg: -14,
      torsoTwistDeg: -10,
      torsoTiltDeg: 6,
      headRotationDeg: 12,
      headTiltDeg: 4,
      leftArmShoulderForwardDeg: 12,
      leftArmShoulderOutDeg: 16,
      leftArmElbowBendDeg: 45,
      rightArmShoulderForwardDeg: -12,
      rightArmShoulderOutDeg: 35,
      rightArmElbowBendDeg: 88,
      rightHandGesture: 'hand_on_hip',
      leftLegHipForwardDeg: 22,
      leftLegHipOutDeg: 6,
      leftLegKneeBendDeg: 42,
      rightLegHipForwardDeg: -6,
      rightLegHipOutDeg: 4,
      rightLegKneeBendDeg: 4,
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.03,
    },
  },
  {
    id: 'welcoming_wave',
    label: 'Welcoming Wave',
    desc: 'Friendly raised hand wave with gentle smile',
    values: {
      basePose: 'welcoming_wave',
      torsoLeanDeg: 0,
      torsoTwistDeg: 6,
      torsoTiltDeg: -3,
      headRotationDeg: 0,
      headTiltDeg: 4,
      rightArmShoulderForwardDeg: 15,
      rightArmShoulderOutDeg: 70,
      rightArmElbowBendDeg: 80,
      rightHandGesture: 'wave',
      leftArmShoulderForwardDeg: 0,
      leftArmShoulderOutDeg: 12,
      leftArmElbowBendDeg: 15,
      leftHandGesture: 'relaxed_natural',
      expression: 'gentle_smile',
      isWalking: false,
      isWaving: true,
      hipHeightOffset: 0,
    },
  },
  {
    id: 'all_fours_neutral',
    label: 'All-Fours Neutral',
    desc: 'Neutral tabletop position on hands and knees',
    values: {
      basePose: 'all_fours_neutral',
      torsoLeanDeg: 5,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: 8,
      leftArmShoulderForwardDeg: 70,
      leftArmShoulderOutDeg: 15,
      leftArmElbowBendDeg: 10,
      rightArmShoulderForwardDeg: 70,
      rightArmShoulderOutDeg: 15,
      rightArmElbowBendDeg: 10,
      leftLegHipForwardDeg: 80,
      leftLegHipOutDeg: 12,
      leftLegKneeBendDeg: 90,
      rightLegHipForwardDeg: 80,
      rightLegHipOutDeg: 12,
      rightLegKneeBendDeg: 90,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.55,
      pelvisPitchDeg: 0,
    },
  },
  {
    id: 'cow_pose_arched',
    label: 'Cow Pose (Arched)',
    desc: 'All-fours with deep lumbar arch, chest dropped, head lifted',
    values: {
      basePose: 'cow_pose_arched',
      torsoLeanDeg: -18,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: 22,
      leftArmShoulderForwardDeg: 75,
      leftArmShoulderOutDeg: 18,
      leftArmElbowBendDeg: 8,
      rightArmShoulderForwardDeg: 75,
      rightArmShoulderOutDeg: 18,
      rightArmElbowBendDeg: 8,
      leftLegHipForwardDeg: 85,
      leftLegHipOutDeg: 14,
      leftLegKneeBendDeg: 95,
      rightLegHipForwardDeg: 85,
      rightLegHipOutDeg: 14,
      rightLegKneeBendDeg: 95,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.52,
      pelvisPitchDeg: -12,
    },
  },
  {
    id: 'cat_pose_rounded',
    label: 'Cat Pose (Rounded)',
    desc: 'All-fours with strongly rounded spine and tucked head',
    values: {
      basePose: 'cat_pose_rounded',
      torsoLeanDeg: 20,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: -25,
      leftArmShoulderForwardDeg: 65,
      leftArmShoulderOutDeg: 12,
      leftArmElbowBendDeg: 15,
      rightArmShoulderForwardDeg: 65,
      rightArmShoulderOutDeg: 12,
      rightArmElbowBendDeg: 15,
      leftLegHipForwardDeg: 75,
      leftLegHipOutDeg: 10,
      leftLegKneeBendDeg: 90,
      rightLegHipForwardDeg: 75,
      rightLegHipOutDeg: 10,
      rightLegKneeBendDeg: 90,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.55,
      pelvisPitchDeg: 15,
    },
  },
  {
    id: 'all_fours_rear_presentation',
    label: 'All-Fours Rear Presentation',
    desc: 'Hips elevated and pushed back, chest lower, weight shifted rearward',
    values: {
      basePose: 'all_fours_rear_presentation',
      torsoLeanDeg: -8,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: 5,
      leftArmShoulderForwardDeg: 80,
      leftArmShoulderOutDeg: 20,
      leftArmElbowBendDeg: 5,
      rightArmShoulderForwardDeg: 80,
      rightArmShoulderOutDeg: 20,
      rightArmElbowBendDeg: 5,
      leftLegHipForwardDeg: 70,
      leftLegHipOutDeg: 18,
      leftLegKneeBendDeg: 85,
      rightLegHipForwardDeg: 70,
      rightLegHipOutDeg: 18,
      rightLegKneeBendDeg: 85,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.48,
      pelvisPitchDeg: -20,
    },
  },
  {
    id: 'prone_hip_elevated',
    label: 'Prone Hip Elevated',
    desc: 'Lying on stomach with hips slightly lifted',
    values: {
      basePose: 'prone_hip_elevated',
      torsoLeanDeg: -5,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: -10,
      leftArmShoulderForwardDeg: -20,
      leftArmShoulderOutDeg: 25,
      leftArmElbowBendDeg: 40,
      rightArmShoulderForwardDeg: -20,
      rightArmShoulderOutDeg: 25,
      rightArmElbowBendDeg: 40,
      leftLegHipForwardDeg: 15,
      leftLegHipOutDeg: 10,
      leftLegKneeBendDeg: 20,
      rightLegHipForwardDeg: 15,
      rightLegHipOutDeg: 10,
      rightLegKneeBendDeg: 20,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.72,
      pelvisPitchDeg: -70,
    },
  },
  {
    id: 'kneeling_forward_fold',
    label: 'Kneeling Forward Fold',
    desc: 'Kneeling with torso folded forward over thighs',
    values: {
      basePose: 'kneeling_forward_fold',
      torsoLeanDeg: 35,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: -15,
      leftArmShoulderForwardDeg: 40,
      leftArmShoulderOutDeg: 15,
      leftArmElbowBendDeg: 30,
      rightArmShoulderForwardDeg: 40,
      rightArmShoulderOutDeg: 15,
      rightArmElbowBendDeg: 30,
      leftLegHipForwardDeg: 70,
      leftLegHipOutDeg: 12,
      leftLegKneeBendDeg: 110,
      rightLegHipForwardDeg: 70,
      rightLegHipOutDeg: 12,
      rightLegKneeBendDeg: 110,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.50,
      pelvisPitchDeg: 10,
    },
  },
  {
    id: 'bent_over_support',
    label: 'Bent-Over Support',
    desc: 'Bent forward at the waist with hands supporting on a surface',
    values: {
      basePose: 'bent_over_support',
      torsoLeanDeg: 45,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: -5,
      leftArmShoulderForwardDeg: 60,
      leftArmShoulderOutDeg: 20,
      leftArmElbowBendDeg: 15,
      rightArmShoulderForwardDeg: 60,
      rightArmShoulderOutDeg: 20,
      rightArmElbowBendDeg: 15,
      leftLegHipForwardDeg: 10,
      leftLegHipOutDeg: 8,
      leftLegKneeBendDeg: 15,
      rightLegHipForwardDeg: 10,
      rightLegHipOutDeg: 8,
      rightLegKneeBendDeg: 15,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.15,
      pelvisPitchDeg: 25,
    },
  },
  {
    id: 'side_lying_open',
    label: 'Side-Lying Open',
    desc: 'Lying on one side with top leg bent or opened',
    values: {
      basePose: 'side_lying_open',
      torsoLeanDeg: 0,
      torsoTwistDeg: 0,
      torsoTiltDeg: 0,
      headRotationDeg: 0,
      headTiltDeg: 0,
      leftArmShoulderForwardDeg: 20,
      leftArmShoulderOutDeg: 30,
      leftArmElbowBendDeg: 50,
      rightArmShoulderForwardDeg: 10,
      rightArmShoulderOutDeg: 15,
      rightArmElbowBendDeg: 40,
      leftLegHipForwardDeg: 45,
      leftLegHipOutDeg: 35,
      leftLegKneeBendDeg: 70,
      rightLegHipForwardDeg: 10,
      rightLegHipOutDeg: 8,
      rightLegKneeBendDeg: 20,
      leftHandGesture: 'relaxed_natural',
      rightHandGesture: 'relaxed_natural',
      isWalking: false,
      isWaving: false,
      hipHeightOffset: -0.68,
      pelvisPitchDeg: 0,
      pelvisRollDeg: 80,
    },
  },
];

const LOCAL_STORAGE_KEY = 'mywhisk_camera_playboard_blueprints_v1';
const ACTIVE_SESSION_STORAGE_KEY = 'mywhisk_camera_playboard_active_session_v1';
const CHECKPOINTS_STORAGE_KEY = 'mywhisk_camera_playboard_checkpoints_v1';
const VARIATIONS_STORAGE_KEY = 'mywhisk_camera_playboard_variations_v1';

export const CameraPlayboardStudio: React.FC<CameraPlayboardStudioProps> = ({
  onBackToMain,
  subMode = 'playboard',
  onSubModeChange,
}) => {
  // Load initial active session state from localStorage so refreshing the dedicated route preserves work
  const [camera, setCamera] = useState<Camera3DSettings>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.camera) {
          return migrateLegacyPlayboardConfig(parsed).camera;
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_CAMERA;
  });

  const [pose, setPose] = useState<CharacterPose3DSettings>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.pose) {
          return migrateLegacyPlayboardConfig(parsed).pose;
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_POSE;
  });

  const [environment, setEnvironment] = useState<PlayboardEnvironment>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.environment) return parsed.environment;
      }
    } catch {
      // ignore
    }
    return 'studio_bedroom';
  });

  const [preserveEnvironment, setPreserveEnvironment] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.preserveEnvironment === 'boolean') return parsed.preserveEnvironment;
      }
    } catch {
      // ignore
    }
    return true;
  });

  const [environmentPolicy, setEnvironmentPolicy] = useState<EnvironmentTransformationPolicy>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.environmentPolicy) return parsed.environmentPolicy;
      }
    } catch {
      // ignore
    }
    return 'auto';
  });

  const [visualGuides, setVisualGuides] = useState<PlayboardVisualGuidesConfig>(DEFAULT_VISUAL_GUIDES);
  const [showInspectorPanel, setShowInspectorPanel] = useState<boolean>(false);
  const [expectedChangeBanner, setExpectedChangeBanner] = useState<ExpectedChangeSummary | null>(null);

  const [showJoysticks, setShowJoysticks] = useState<boolean>(true);
  const [animationPaused, setAnimationPaused] = useState<boolean>(false);
  const [instantPoseTransitions, setInstantPoseTransitions] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.instantPoseTransitions === 'boolean') {
          return parsed.instantPoseTransitions;
        }
      }
    } catch {
      // ignore
    }
    return false;
  });
  const [lightingPreset, setLightingPreset] = useState<PlayboardLightingPreset>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.lightingPreset) return parsed.lightingPreset;
      }
    } catch {
      // ignore
    }
    return 'daylight_warm';
  });
  const [ikEnabled, setIkEnabled] = useState<boolean>(true);
  const [customGlbUrl, setCustomGlbUrl] = useState<string | null>(null);
  const [customGlbName, setCustomGlbName] = useState<string | null>(null);
  const [ghostPoseSnapshot, setGhostPoseSnapshot] = useState<CharacterPose3DSettings | null>(null);
  const [ghostPoseLabel, setGhostPoseLabel] = useState<string>('Captured Reference');
  const [showGhostPose, setShowGhostPose] = useState<boolean>(false);
  const [ghostOpacity, setGhostOpacity] = useState<number>(0.36);
  const [activeTab, setActiveTab] = useState<'camera' | 'pose' | 'gaze' | 'blueprints'>('pose');
  const [activeInteractionCategory, setActiveInteractionCategory] =
    useState<SceneInteractionCategory | 'all'>('standing_wall');
  const [poseSearchQuery, setPoseSearchQuery] = useState<string>('');

  // Mobile bottom sheet state: 'collapsed' maximizes the 3D playboard on mobile; 'half' or 'expanded' shows controls
  const [mobileSheetState, setMobileSheetState] = useState<'collapsed' | 'half' | 'expanded'>('collapsed');
  // Desktop side panel open/collapsed state
  const [desktopPanelOpen, setDesktopPanelOpen] = useState<boolean>(true);
  // Reset menu popover
  const [showResetMenu, setShowResetMenu] = useState<boolean>(false);

  // Blueprints (Saved configurations in localStorage)
  const [savedBlueprints, setSavedBlueprints] = useState<PlayboardFullConfig[]>([]);
  const [blueprintNameInput, setBlueprintNameInput] = useState('');
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);

  // Checkpoints (Session History) & Shot Variations
  const [checkpoints, setCheckpoints] = useState<PlayboardCheckpoint[]>(() => {
    try {
      const raw = localStorage.getItem(CHECKPOINTS_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return [];
  });
  const [checkpointLabelInput, setCheckpointLabelInput] = useState('');

  const [shotVariations, setShotVariations] = useState<PlayboardShotVariation[]>(() => {
    try {
      const raw = localStorage.getItem(VARIATIONS_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return [];
  });
  const [variationNameInput, setVariationNameInput] = useState('');
  const [activeVariationId, setActiveVariationId] = useState<string | null>(null);
  const [compareVarAId, setCompareVarAId] = useState<string>('');
  const [compareVarBId, setCompareVarBId] = useState<string>('');

  // Generate Prompt Modal State
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptTab, setPromptTab] = useState<'t2i' | 'i2i'>('t2i');
  const [targetModel, setTargetModel] = useState<TargetModelType>('universal');
  const [i2iScope, setI2iScope] = useState<I2ITransformationScope>('both');
  const [i2iFields, setI2iFields] = useState<I2IEditableField[]>([]);
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Persist current camera, pose, environment, lighting, and transition preferences to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        ACTIVE_SESSION_STORAGE_KEY,
        JSON.stringify({
          camera,
          pose,
          environment,
          preserveEnvironment,
          environmentPolicy,
          lightingPreset,
          instantPoseTransitions,
        })
      );
    } catch {
      // ignore
    }
  }, [
    camera,
    pose,
    environment,
    preserveEnvironment,
    environmentPolicy,
    lightingPreset,
    instantPoseTransitions,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(CHECKPOINTS_STORAGE_KEY, JSON.stringify(checkpoints));
    } catch {
      // ignore
    }
  }, [checkpoints]);

  useEffect(() => {
    try {
      localStorage.setItem(VARIATIONS_STORAGE_KEY, JSON.stringify(shotVariations));
    } catch {
      // ignore
    }
  }, [shotVariations]);

  const fullConfig: PlayboardFullConfig = useMemo(
    () => ({
      id: selectedBlueprintId || 'current_session',
      name: blueprintNameInput || 'Default 3D Setup',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      environment,
      camera,
      pose,
      preserveEnvironment,
      environmentPolicy,
      lightingPreset,
      instantPoseTransitions,
    }),
    [
      camera,
      pose,
      environment,
      preserveEnvironment,
      environmentPolicy,
      lightingPreset,
      instantPoseTransitions,
      selectedBlueprintId,
      blueprintNameInput,
    ]
  );

  const effectiveGhostPose = useMemo<CharacterPose3DSettings | null>(() => {
    if (ghostPoseSnapshot) return ghostPoseSnapshot;
    if (checkpoints.length > 0) return checkpoints[0].config.pose;
    return null;
  }, [ghostPoseSnapshot, checkpoints]);

  const effectiveGhostLabel = useMemo<string>(() => {
    if (ghostPoseSnapshot) return ghostPoseLabel;
    if (checkpoints.length > 0) return `Checkpoint: ${checkpoints[0].label}`;
    return 'Reference Pose';
  }, [ghostPoseSnapshot, ghostPoseLabel, checkpoints]);

  const handleCaptureGhostReference = () => {
    setGhostPoseSnapshot(JSON.parse(JSON.stringify(pose)));
    setGhostPoseLabel(`Snapshot (${pose.basePose.replace(/_/g, ' ')})`);
    setShowGhostPose(true);
    showToast('Captured current pose as Ghost Reference Silhouette');
  };

  // Keep unlocked I2I fields synchronized as camera, pose, environment, or scope changes
  useEffect(() => {
    setI2iFields((prev) => syncI2IFieldsWithConfig(prev, fullConfig, i2iScope));
  }, [fullConfig, i2iScope]);

  // Load blueprints from localStorage on mount
  useEffect(() => {
    try {
      const data = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (data) {
        setSavedBlueprints(JSON.parse(data));
      }
    } catch {
      // ignore
    }
  }, []);

  const saveBlueprintsToStorage = (list: PlayboardFullConfig[]) => {
    setSavedBlueprints(list);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2200);
  };

  const liveFraming = useMemo(() => analyzePlayboardFraming(camera, pose), [camera, pose]);
  const activeInteractionPreset = useMemo(
    () => getInteractionPresetById(pose.interactionPresetId),
    [pose.interactionPresetId]
  );
  const sceneInspectorSummary = useMemo(
    () => inspectPlayboardSceneState(fullConfig, i2iScope),
    [fullConfig, i2iScope]
  );
  const resolvedEnvPolicy = useMemo(
    () => resolveEnvironmentTransformationPolicy(fullConfig, i2iScope),
    [fullConfig, i2iScope]
  );
  const customModelDiag = useMemo(() => getCustomModelDiagnostics(pose), [pose]);
  const structuredPromptSummary = useMemo(
    () => buildStructuredPromptSummary(fullConfig, i2iScope, i2iFields),
    [fullConfig, i2iScope, i2iFields]
  );
  const promptValidation = useMemo(
    () => validatePlayboardPromptConsistency(fullConfig, i2iScope, i2iFields),
    [fullConfig, i2iScope, i2iFields]
  );

  // Preset Handlers (Strictly decoupled & preserving staged subject position)
  const applyCameraPreset = (preset: typeof CAMERA_PRESETS[0]) => {
    const nextCamera = applyCameraPresetState(camera, preset.values);
    const nextConfig: PlayboardFullConfig = { ...fullConfig, camera: nextCamera };
    setExpectedChangeBanner(
      computeExpectedChangeSummary(fullConfig, nextConfig, `Camera Preset: ${preset.label}`)
    );
    setCamera(nextCamera);
    showToast(`Camera: ${preset.label}`);
  };

  const applyPosePreset = (preset: typeof POSE_PRESETS[0]) => {
    const nextPose = applyPosePresetState(
      pose,
      {
        gaze: pose.gaze,
        expression: preset.values.expression ?? pose.expression,
        ...preset.values,
      },
      camera
    );
    const nextConfig: PlayboardFullConfig = { ...fullConfig, pose: nextPose };
    setExpectedChangeBanner(
      computeExpectedChangeSummary(fullConfig, nextConfig, `Pose Preset: ${preset.label}`)
    );
    setPose(nextPose);
    showToast(`Pose: ${preset.label}`);
  };

  const applyInteractionPreset = (preset: SceneInteractionPreset) => {
    const needsBedroom = preset.requiresBedroomFurniture || preset.furnitureTarget === 'wall';
    const nextState = applySceneInteractionPresetState(pose, camera, preset, environment);
    const nextConfig: PlayboardFullConfig = {
      ...fullConfig,
      pose: nextState.pose,
      environment: nextState.environment,
    };
    setExpectedChangeBanner(
      computeExpectedChangeSummary(fullConfig, nextConfig, `Scene Interaction: ${preset.label}`)
    );
    if (nextState.environment !== environment) {
      setEnvironment(nextState.environment);
    }
    setPose(nextState.pose);
    showToast(
      needsBedroom && environment !== 'studio_bedroom'
        ? `Scene Pose: ${preset.label} (Bedroom furniture enabled)`
        : `Scene Pose: ${preset.label}`
    );
  };

  const handleEnvironmentChange = (nextEnv: PlayboardEnvironment) => {
    setEnvironment(nextEnv);
    if (
      nextEnv !== 'studio_bedroom' &&
      activeInteractionPreset &&
      (activeInteractionPreset.requiresBedroomFurniture ||
        activeInteractionPreset.furnitureTarget === 'wall')
    ) {
      setPose((prev) => ({
        ...prev,
        interactionPresetId: null,
        seatHeightY: null,
        pelvisPitchDeg: 0,
        pelvisRollDeg: 0,
        characterPosX: 0,
        characterPosZ: 0,
        anchorPosX: camera.targetMode === 'fixed_composition' ? (prev.anchorPosX ?? 0) : 0,
        anchorPosZ: camera.targetMode === 'fixed_composition' ? (prev.anchorPosZ ?? 0) : 0,
        basePose:
          prev.basePose === 'reclined_lying' || prev.basePose === 'casual_sitting'
            ? 'natural_standing'
            : prev.basePose,
        hipHeightOffset:
          prev.basePose === 'reclined_lying' || prev.basePose === 'casual_sitting'
            ? 0
            : prev.hipHeightOffset,
      }));
      showToast('Cleared bedroom furniture pose for open studio environment');
    }
  };

  const handleReturnToActivePreset = () => {
    if (!activeInteractionPreset) return;
    applyInteractionPreset(activeInteractionPreset);
  };

  const handleExitInteractionPreset = () => {
    setPose((prev) => resetSubjectPositionState(prev, camera));
    showToast('Returned character to studio center');
  };

  // Reset Handlers (Strictly isolated)
  const handleResetCamera = () => {
    setCamera((prev) => resetCameraState(prev));
    setShowResetMenu(false);
    showToast('Camera reset to default');
  };

  const handleResetPose = () => {
    setPose((prev) => resetPoseState(prev, camera));
    setShowResetMenu(false);
    showToast('Character pose reset (position preserved)');
  };

  const handleResetSubjectPosition = () => {
    setPose((prev) => resetSubjectPositionState(prev, camera));
    setShowResetMenu(false);
    showToast('Subject position reset to studio center');
  };

  const handleResetAll = () => {
    const reset = resetAllPlayboardState();
    setCamera(reset.camera);
    setPose(reset.pose);
    setEnvironment(reset.environment);
    setLightingPreset(reset.lightingPreset);
    setPreserveEnvironment(true);
    setEnvironmentPolicy('auto');
    setI2iFields(
      buildInitialI2IFields(
        {
          ...fullConfig,
          camera: reset.camera,
          pose: reset.pose,
          environment: reset.environment,
          lightingPreset: reset.lightingPreset,
          preserveEnvironment: true,
          environmentPolicy: 'auto',
        },
        i2iScope
      )
    );
    setShowResetMenu(false);
    showToast('All camera, pose, and stage controls reset');
  };

  const activeSupportSurface = useMemo(
    () => inferActiveSupportSurface(pose),
    [pose]
  );

  const handleSelectSupportSurface = (support: BedroomSupportSurfaceSpec) => {
    if (environment !== 'studio_bedroom' && support.category !== 'floor') {
      setEnvironment('studio_bedroom');
    }
    const defaultPreset = getInteractionPresetById(support.defaultPresetId);
    if (defaultPreset && support.seatHeightY !== null) {
      applyInteractionPreset(defaultPreset);
      return;
    }
    const isFixedComp = camera.targetMode === 'fixed_composition';
    setPose((prev) => ({
      ...prev,
      characterPosX: support.anchorX,
      characterPosZ: support.anchorZ,
      characterYawDeg: support.defaultYawDeg,
      seatHeightY: support.seatHeightY,
      anchorPosX: isFixedComp ? (prev.anchorPosX ?? 0) : support.anchorX,
      anchorPosZ: isFixedComp ? (prev.anchorPosZ ?? 0) : support.anchorZ,
      isWalking: false,
      isWaving: false,
    }));
    showToast(`Support: ${support.label}`);
  };

  const handleCenterOnActiveSupport = () => {
    const preset = getInteractionPresetById(pose.interactionPresetId);
    const targetX = preset ? preset.anchorX : activeSupportSurface.anchorX;
    const targetZ = preset ? preset.anchorZ : activeSupportSurface.anchorZ;
    const targetSeatY = preset ? preset.seatHeightY : activeSupportSurface.seatHeightY;
    const isFixedComp = camera.targetMode === 'fixed_composition';
    setPose((prev) => ({
      ...prev,
      characterPosX: targetX,
      characterPosZ: targetZ,
      seatHeightY: targetSeatY,
      anchorPosX: isFixedComp ? (prev.anchorPosX ?? 0) : targetX,
      anchorPosZ: isFixedComp ? (prev.anchorPosZ ?? 0) : targetZ,
      isWalking: false,
    }));
    showToast(`Centered pose on ${activeSupportSurface.shortLabel}`);
  };

  // Save Blueprint
  const handleSaveBlueprint = () => {
    const name = blueprintNameInput.trim() || `Setup ${savedBlueprints.length + 1}`;
    const newConfig: PlayboardFullConfig = {
      id: `bp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      environment,
      camera,
      pose,
      preserveEnvironment,
      environmentPolicy,
      lightingPreset,
      instantPoseTransitions,
    };
    const updated = [newConfig, ...savedBlueprints];
    saveBlueprintsToStorage(updated);
    setSelectedBlueprintId(newConfig.id);
    setBlueprintNameInput('');
    showToast(`Saved "${name}"`);
  };

  const handleLoadBlueprint = (bp: PlayboardFullConfig) => {
    const migrated = migrateLegacyPlayboardConfig(bp);
    setExpectedChangeBanner(
      computeExpectedChangeSummary(fullConfig, migrated, `Loaded Blueprint: ${bp.name}`)
    );
    setCamera(migrated.camera);
    setPose(migrated.pose);
    setEnvironment(migrated.environment);
    setPreserveEnvironment(migrated.preserveEnvironment ?? true);
    setEnvironmentPolicy(migrated.environmentPolicy ?? 'auto');
    if (migrated.lightingPreset) setLightingPreset(migrated.lightingPreset);
    if (typeof migrated.instantPoseTransitions === 'boolean') {
      setInstantPoseTransitions(migrated.instantPoseTransitions);
    }
    setI2iFields(buildInitialI2IFields(migrated, i2iScope));
    setSelectedBlueprintId(bp.id);
    showToast(`Loaded "${bp.name}"`);
  };

  const handleDeleteBlueprint = (id: string) => {
    const updated = savedBlueprints.filter((b) => b.id !== id);
    saveBlueprintsToStorage(updated);
    if (selectedBlueprintId === id) setSelectedBlueprintId(null);
    showToast('Blueprint deleted');
  };

  const handleDuplicateBlueprint = (bp: PlayboardFullConfig) => {
    const copy: PlayboardFullConfig = {
      ...bp,
      id: `bp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: `${bp.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [copy, ...savedBlueprints];
    saveBlueprintsToStorage(updated);
    showToast(`Duplicated "${bp.name}"`);
  };

  // Checkpoints & Shot Variations Handlers
  const handleCreateCheckpoint = () => {
    const label = checkpointLabelInput.trim() || `Checkpoint ${checkpoints.length + 1}`;
    const cp = createPlayboardCheckpoint(fullConfig, label, i2iScope);
    setCheckpoints((prev) => [cp, ...prev.slice(0, 14)]);
    setCheckpointLabelInput('');
    showToast(`Saved "${cp.label}"`);
  };

  const handleRestoreCheckpoint = (cp: PlayboardCheckpoint) => {
    const restored = restorePlayboardCheckpoint(cp);
    setExpectedChangeBanner(
      computeExpectedChangeSummary(fullConfig, restored.config, `Restored Checkpoint: ${cp.label}`)
    );
    setCamera(restored.config.camera);
    setPose(restored.config.pose);
    setEnvironment(restored.config.environment);
    setPreserveEnvironment(restored.config.preserveEnvironment ?? true);
    setEnvironmentPolicy(restored.config.environmentPolicy ?? 'auto');
    setI2iScope(restored.scope);
    setI2iFields(buildInitialI2IFields(restored.config, restored.scope));
    showToast(`Restored "${cp.label}"`);
  };

  const handleCreateShotVariation = () => {
    const label =
      variationNameInput.trim() || `Shot ${String.fromCharCode(65 + (shotVariations.length % 26))}`;
    const variation = createShotVariation(fullConfig, label, i2iScope);
    setShotVariations((prev) => {
      const next = [...prev, variation];
      if (!compareVarAId && next.length >= 1) setCompareVarAId(next[0].id);
      if (!compareVarBId && next.length >= 2) setCompareVarBId(variation.id);
      return next;
    });
    setActiveVariationId(variation.id);
    setVariationNameInput('');
    showToast(`Created variation "${variation.name}"`);
  };

  const handleActivateShotVariation = (variation: PlayboardShotVariation) => {
    const activated = activateShotVariation(variation);
    setExpectedChangeBanner(
      computeExpectedChangeSummary(fullConfig, activated.config, `Shot Variation: ${variation.name}`)
    );
    setCamera(activated.config.camera);
    setPose(activated.config.pose);
    setEnvironment(activated.config.environment);
    setPreserveEnvironment(activated.config.preserveEnvironment ?? true);
    setEnvironmentPolicy(activated.config.environmentPolicy ?? 'auto');
    setI2iScope(activated.scope);
    setI2iFields(buildInitialI2IFields(activated.config, activated.scope));
    setActiveVariationId(variation.id);
    showToast(`Activated "${variation.name}"`);
  };

  const handleApplyValidationFix = (actionType: PromptValidationIssue['actionType']) => {
    if (!actionType) return;
    if (actionType === 'fix_framing_distance') {
      setCamera((prev) => applyRequestedFramingState(prev, prev.framing));
      showToast('Adjusted camera distance to match requested framing');
    } else if (actionType === 'sync_framing_to_measured') {
      setCamera((prev) => ({ ...prev, framing: liveFraming.measuredFraming }));
      showToast(`Synced framing label to ${liveFraming.shotSizeLabel}`);
    } else if (actionType === 'switch_to_bedroom_environment') {
      setEnvironment('studio_bedroom');
      showToast('Switched environment to Studio Bedroom');
    } else if (actionType === 'switch_scope_to_both') {
      handleScopeChange('both');
      showToast('Switched transformation scope to Both Camera & Pose');
    } else if (actionType === 'enable_source_inspired_environment') {
      setPreserveEnvironment(true);
      setEnvironmentPolicy('source_inspired_transformation');
      setI2iFields((prev) =>
        syncI2IFieldsWithConfig(
          prev,
          { ...fullConfig, preserveEnvironment: true, environmentPolicy: 'source_inspired_transformation' },
          i2iScope
        )
      );
      showToast('Enabled Source-Inspired Environment Transformation');
    } else if (actionType === 'reset_hands_to_support') {
      setPose((prev) => ({
        ...prev,
        leftHandGesture: 'relaxed_natural',
        rightHandGesture: 'relaxed_natural',
        isWaving: false,
      }));
      showToast('Reset hand gestures to floor-supporting palms');
    } else if (actionType === 'sync_unlocked_i2i_fields') {
      setI2iFields(buildInitialI2IFields(fullConfig, i2iScope));
      showToast('Resynced I2I prompt blocks with current 3D scene');
    }
  };

  // Open Prompt Generation Modal
  const handleOpenPromptModal = () => {
    setI2iFields((prevFields) => syncI2IFieldsWithConfig(prevFields, fullConfig, i2iScope));
    setShowPromptModal(true);
  };

  // Handle I2I Scope Change
  const handleScopeChange = (newScope: I2ITransformationScope) => {
    setI2iScope(newScope);
    setI2iFields((prev) => {
      const synced = syncI2IFieldsWithConfig(prev, fullConfig, newScope);
      return synced.map((f) => {
        let isRemoved = f.isRemoved;
        if (newScope === 'camera_only') {
          if (['body_pose_torso', 'arms_and_hands', 'legs_and_feet', 'head_gaze_expression'].includes(f.id)) {
            isRemoved = true;
          }
          if (['camera_framing'].includes(f.id)) {
            isRemoved = false;
          }
        } else if (newScope === 'pose_only') {
          if (['camera_framing'].includes(f.id)) {
            isRemoved = true;
          }
          if (['body_pose_torso', 'arms_and_hands', 'legs_and_feet', 'head_gaze_expression'].includes(f.id)) {
            isRemoved = false;
          }
        } else if (newScope === 'both') {
          isRemoved = false;
        }
        return { ...f, isRemoved };
      });
    });
  };

  // Move Field Up/Down
  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= i2iFields.length) return;
    const reordered = [...i2iFields];
    const temp = reordered[index];
    reordered[index] = reordered[targetIndex];
    reordered[targetIndex] = temp;
    reordered.forEach((f, idx) => (f.order = idx + 1));
    setI2iFields(reordered);
  };

  // Compiled Prompts
  const compiledT2IPrompt = useMemo(
    () => buildPlayboardT2IPrompt(fullConfig, targetModel),
    [fullConfig, targetModel]
  );

  const compiledI2IPrompt = useMemo(
    () => compileFinalI2IPrompt(i2iFields, i2iScope, fullConfig, targetModel),
    [i2iFields, i2iScope, fullConfig, targetModel]
  );

  const activePromptText = promptTab === 't2i' ? compiledT2IPrompt : compiledI2IPrompt;

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(activePromptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Prompt copied to clipboard!');
    } catch {
      showToast('Failed to copy');
    }
  };

  const handleDownloadPrompt = () => {
    const blob = new Blob([activePromptText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mywhisk_${promptTab}_${targetModel}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Prompt downloaded');
  };

  const handleSelectControlTab = (tab: 'camera' | 'pose' | 'gaze' | 'blueprints') => {
    if (activeTab === tab && mobileSheetState !== 'collapsed') {
      // Clicking active tab on mobile toggles collapse so user can immediately see full 3D canvas
      setMobileSheetState('collapsed');
    } else {
      setActiveTab(tab);
      if (mobileSheetState === 'collapsed') {
        setMobileSheetState('half');
      }
      if (!desktopPanelOpen) {
        setDesktopPanelOpen(true);
      }
    }
  };

  const mobileSheetHeightClass =
    mobileSheetState === 'collapsed'
      ? 'h-auto'
      : mobileSheetState === 'half'
      ? 'h-[44dvh]'
      : 'h-[72dvh]';

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs shadow-xl border border-indigo-400 flex items-center gap-1.5 pointer-events-none">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Compact Full-Viewport Header */}
      <header className="flex-none h-12 sm:h-13 px-2.5 sm:px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 z-30">
        {/* Left: Back to MyWhisk + Tool Name + Mode Switch */}
        <div className="flex items-center gap-2 min-w-0">
          <a
            href="/"
            onClick={(e) => {
              if (onBackToMain) {
                e.preventDefault();
                onBackToMain();
              }
            }}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
            title="Return to MyWhisk AI"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#f5c518]" />
            <span className="hidden xs:inline">MyWhisk</span>
          </a>

          <div className="h-4 w-px bg-slate-800 hidden xs:block shrink-0" />

          <h1 className="text-xs sm:text-sm font-bold text-white truncate">
            Camera Angle Controller
          </h1>

          {onSubModeChange && (
            <div className="hidden md:flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 ml-1 shrink-0">
              <button
                type="button"
                onClick={() => onSubModeChange('playboard')}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                  subMode === 'playboard'
                    ? 'bg-[#f5c518] text-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                3D Playboard
              </button>
              <button
                type="button"
                onClick={() => onSubModeChange('extractor')}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                  subMode === 'extractor'
                    ? 'bg-[#f5c518] text-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Ref Image
              </button>
            </div>
          )}
        </div>

        {/* Right: Essential Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mobile SubMode toggle if applicable */}
          {onSubModeChange && (
            <button
              type="button"
              onClick={() => onSubModeChange(subMode === 'playboard' ? 'extractor' : 'playboard')}
              className="md:hidden px-2 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-800 text-slate-300 border border-slate-700"
              title="Switch between 3D Playboard and Reference Image Extractor"
            >
              {subMode === 'playboard' ? '📷 Ref Mode' : '🎮 3D Mode'}
            </button>
          )}

          {/* Environment Selector */}
          <select
            value={environment}
            onChange={(e) => handleEnvironmentChange(e.target.value as PlayboardEnvironment)}
            aria-label="3D Environment"
            className="px-2 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 border border-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="studio_bedroom">Bedroom</option>
            <option value="minimal_neutral">Minimal</option>
            <option value="cyber_grid">Grid</option>
          </select>

          {/* Joysticks Toggle */}
          <button
            type="button"
            onClick={() => setShowJoysticks((prev) => !prev)}
            className={`p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
              showJoysticks
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
            }`}
            title="Toggle On-Screen Touch Joysticks"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sticks</span>
          </button>

          {/* Compact Reset Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowResetMenu((prev) => !prev)}
              className="p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
              title="Reset Options"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>

            {showResetMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowResetMenu(false)}
                />
                <div className="absolute right-0 mt-1.5 w-44 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1 z-50 text-xs">
                  <button
                    type="button"
                    onClick={handleResetCamera}
                    className="w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Reset Camera Only</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetPose}
                    className="w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Reset Pose Only</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetSubjectPosition}
                    className="w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Reset Subject Position</span>
                  </button>
                  <div className="my-1 border-t border-slate-800" />
                  <button
                    type="button"
                    onClick={handleResetAll}
                    className="w-full px-3 py-2 text-left text-red-400 hover:bg-red-500/10 font-semibold flex items-center justify-between"
                  >
                    <span>Reset All</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Desktop Controls Drawer Toggle */}
          <button
            type="button"
            onClick={() => setDesktopPanelOpen((prev) => !prev)}
            className={`hidden lg:flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              desktopPanelOpen
                ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
            }`}
            title="Toggle Side Controls Drawer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{desktopPanelOpen ? 'Hide Controls' : 'Controls'}</span>
          </button>

          {/* PWA Install Button */}
          <PWAInstallButton />

          {/* Generate Prompt Button */}
          <button
            type="button"
            onClick={handleOpenPromptModal}
            className="px-3 sm:px-4 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 border border-indigo-400/40 cursor-pointer active:scale-95 transition-transform"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span>Generate Prompt</span>
          </button>
        </div>
      </header>

      {/* Main Workspace: Full-Screen 3D Playboard + Collapsible Sheet/Drawer */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 min-w-0 overflow-hidden relative">
        {/* 3D Playboard Stage — Fills all available viewport space */}
        <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden bg-slate-950">
          <Playboard3DCanvas
            cameraSettings={camera}
            poseSettings={pose}
            environment={environment}
            onCameraChange={(updates) => setCamera((prev) => ({ ...prev, ...updates }))}
            onPoseChange={(updates) =>
              setPose((prev) => ({
                ...prev,
                ...updates,
                isWalking: false,
                isWaving: false,
              }))
            }
            onCharacterTransformChange={(transformUpdates) =>
              setPose((prev) => {
                const rawNextX = transformUpdates.characterPosX ?? prev.characterPosX ?? 0;
                const rawNextZ = transformUpdates.characterPosZ ?? prev.characterPosZ ?? 0;
                const isFixedComposition = camera.targetMode === 'fixed_composition';

                // Safely clamp X/Z placement to the active elevated support surface (or room bounds)
                // so repositioning with the Blue Pose Placement Joystick never drops the subject through
                // furniture or unexpectedly resets a seated/lying pose to standing.
                const clamped = clampPosePlacementToSupportBounds(
                  prev,
                  rawNextX,
                  rawNextZ,
                  environment
                );

                return {
                  ...prev,
                  ...transformUpdates,
                  characterPosX: clamped.x,
                  characterPosZ: clamped.z,
                  seatHeightY: clamped.seatHeightY,
                  isWalking: false,
                  anchorPosX: isFixedComposition
                    ? prev.anchorPosX ?? 0
                    : clamped.x,
                  anchorPosZ: isFixedComposition
                    ? prev.anchorPosZ ?? 0
                    : clamped.z,
                };
              })
            }
            showJoysticks={showJoysticks}
            animationPaused={animationPaused}
            onToggleAnimationPause={() => {
              setAnimationPaused((prev) => {
                const next = !prev;
                showToast(next ? 'Animation paused — manual posing active' : 'Animation resumed');
                return next;
              });
            }}
            ikEnabled={ikEnabled}
            customGlbUrl={customGlbUrl}
            visualGuides={visualGuides}
            onVisualGuidesChange={(updates) =>
              setVisualGuides((prev) => ({ ...prev, ...updates }))
            }
            lightingPreset={lightingPreset}
            onLightingPresetChange={(preset) => {
              setLightingPreset(preset);
              showToast(`Lighting: ${preset.replace(/_/g, ' ')}`);
            }}
            instantPoseTransitions={instantPoseTransitions}
            onToggleInstantPoseTransitions={() => {
              setInstantPoseTransitions((prev) => {
                const next = !prev;
                showToast(
                  next
                    ? 'Instant pose snap enabled (reduced motion)'
                    : 'Smooth natural pose transitions enabled'
                );
                return next;
              });
            }}
            onSelectSceneInteractionPreset={applyInteractionPreset}
            ghostPoseSettings={effectiveGhostPose}
            ghostLabel={effectiveGhostLabel}
            showGhostPose={showGhostPose}
            ghostOpacity={ghostOpacity}
            onToggleGhostPose={() => setShowGhostPose((v) => !v)}
            onGhostOpacityChange={(op) => setGhostOpacity(op)}
            onCaptureGhostReference={handleCaptureGhostReference}
          />

          {/* Compact Pose-First Quick-Staging Pills at bottom of 3D Stage */}
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-2xl z-10 max-w-[94vw] overflow-x-auto">
            <button
              type="button"
              onClick={() => {
                const p = getInteractionPresetById('bed_sit_edge_forward');
                if (p) applyInteractionPreset(p);
              }}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              🛏️ Bed Sit
            </button>
            <button
              type="button"
              onClick={() => {
                const p = getInteractionPresetById('bed_lie_back');
                if (p) applyInteractionPreset(p);
              }}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              🛌 Bed Lie
            </button>
            <button
              type="button"
              onClick={() => {
                const p = getInteractionPresetById('chair_sit_upright_thighs');
                if (p) applyInteractionPreset(p);
              }}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              🪑 Chair
            </button>
            <button
              type="button"
              onClick={() => {
                const p = getInteractionPresetById('window_bench_sit_upright');
                if (p) applyInteractionPreset(p);
              }}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              🪟 Bench
            </button>
            <button
              type="button"
              onClick={() => {
                const p = getInteractionPresetById('floor_sit_cross_legged');
                if (p) applyInteractionPreset(p);
              }}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              🧘 Floor
            </button>
            <button
              type="button"
              onClick={() => {
                const p = getInteractionPresetById('stand_contrapposto_rug');
                if (p) applyInteractionPreset(p);
              }}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              🧍 Stand
            </button>
            <button
              type="button"
              onClick={() => applyCameraPreset(CAMERA_PRESETS[0])}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              🎯 Front Cam
            </button>
          </div>
        </div>

        {/* Collapsible Control Drawer (Bottom Sheet on Mobile, Side Drawer on Desktop) */}
        <aside
          className={`flex-none flex flex-col bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 z-20 transition-all duration-200 ${mobileSheetHeightClass} ${
            desktopPanelOpen
              ? 'lg:w-[420px] xl:w-[460px] lg:h-full'
              : 'lg:w-0 lg:h-full lg:overflow-hidden lg:border-l-0'
          }`}
        >
          {/* Control Tabs + Mobile Sheet Collapse/Expand Bar (Pose-First Workflow Order) */}
          <div className="flex-none px-2 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 flex-1 overflow-x-auto">
              <button
                type="button"
                onClick={() => handleSelectControlTab('pose')}
                className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                  activeTab === 'pose' && (mobileSheetState !== 'collapsed' || desktopPanelOpen)
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>1. Pose</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectControlTab('camera')}
                className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                  activeTab === 'camera' && (mobileSheetState !== 'collapsed' || desktopPanelOpen)
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>2. Camera</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectControlTab('gaze')}
                className={`flex-1 py-1.5 px-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                  activeTab === 'gaze' && (mobileSheetState !== 'collapsed' || desktopPanelOpen)
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>3. Gaze</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectControlTab('blueprints')}
                className={`py-1.5 px-2.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                  activeTab === 'blueprints' && (mobileSheetState !== 'collapsed' || desktopPanelOpen)
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Saved</span>
              </button>
            </div>

            {/* Mobile Sheet Size Controls */}
            <div className="flex lg:hidden items-center gap-1 pl-1 border-l border-slate-800">
              {mobileSheetState !== 'collapsed' && (
                <button
                  type="button"
                  onClick={() =>
                    setMobileSheetState((prev) => (prev === 'expanded' ? 'half' : 'expanded'))
                  }
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                  title={mobileSheetState === 'expanded' ? 'Half Sheet' : 'Expand Sheet'}
                >
                  {mobileSheetState === 'expanded' ? (
                    <Minimize2 className="w-3.5 h-3.5" />
                  ) : (
                    <Maximize2 className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setMobileSheetState((prev) => (prev === 'collapsed' ? 'half' : 'collapsed'))
                }
                className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1"
                title={mobileSheetState === 'collapsed' ? 'Open Controls' : 'Minimize Controls'}
              >
                {mobileSheetState === 'collapsed' ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Controls</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Hide</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Scrollable Tab Content (Hidden on mobile when sheet is collapsed) */}
          <div
            className={`flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-5 custom-scrollbar ${
              mobileSheetState === 'collapsed' ? 'hidden lg:block' : 'block'
            }`}
          >
            {/* Expected-Change Summary Banner */}
            {expectedChangeBanner && (
              <div
                data-testid="expected-change-banner"
                className="p-2.5 rounded-xl bg-indigo-950/50 border border-indigo-500/40 text-[11px] text-slate-200 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-indigo-300 truncate">
                    {expectedChangeBanner.actionLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpectedChangeBanner(null)}
                    className="text-slate-400 hover:text-white px-1 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                {expectedChangeBanner.changedCategories.length > 0 && (
                  <div className="text-[10px] text-emerald-300">
                    <strong>Updated:</strong> {expectedChangeBanner.changedCategories.join(' · ')}
                  </div>
                )}
                {expectedChangeBanner.preservedCategories.length > 0 && (
                  <div className="text-[10px] text-slate-400">
                    <strong>Preserved:</strong> {expectedChangeBanner.preservedCategories.join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Collapsible Scene State Inspector & Visual Guides Strip */}
            <div
              data-testid="scene-state-inspector"
              className="rounded-xl bg-slate-950/90 border border-slate-800 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setShowInspectorPanel((prev) => !prev)}
                className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-slate-200 hover:bg-slate-900 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Scene State Inspector</span>
                  <span
                    className={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${
                      promptValidation.overallStatus === 'consistent'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : promptValidation.overallStatus === 'conflict'
                        ? 'bg-red-500/15 text-red-300 border-red-500/30'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    }`}
                  >
                    {promptValidation.overallStatus.toUpperCase()}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-indigo-400">
                  {showInspectorPanel ? 'Hide ▲' : 'Inspect ▼'}
                </span>
              </button>

              {showInspectorPanel && (
                <div className="px-3 pb-3 pt-1.5 border-t border-slate-800/80 space-y-2.5 text-[11px]">
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-[9px] font-mono uppercase text-slate-400">Subject</div>
                      <div className="font-mono text-emerald-300 mt-0.5">
                        ({sceneInspectorSummary.subject.posX}m, {sceneInspectorSummary.subject.posZ}m) ·{' '}
                        {sceneInspectorSummary.subject.yawDeg}°
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {sceneInspectorSummary.subject.basePoseLabel}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-[9px] font-mono uppercase text-slate-400">
                        Camera ({sceneInspectorSummary.camera.targetMode})
                      </div>
                      <div className="font-mono text-amber-300 mt-0.5">
                        {sceneInspectorSummary.camera.yawDeg}°Y · {sceneInspectorSummary.camera.pitchDeg}°P ·{' '}
                        {sceneInspectorSummary.camera.distance}m
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        Look ({sceneInspectorSummary.camera.lookTargetXZ.x}m,{' '}
                        {sceneInspectorSummary.camera.lookTargetXZ.z}m)
                      </div>
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Framing (Req → Meas):</span>
                      <span
                        className={`font-mono ${
                          sceneInspectorSummary.framing.matchesRequest
                            ? 'text-emerald-300'
                            : 'text-amber-300'
                        }`}
                      >
                        {sceneInspectorSummary.framing.requestedFraming.replace(/_/g, ' ')} →{' '}
                        {sceneInspectorSummary.framing.measuredLabel}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Gaze & Head:</span>
                      <span className="font-mono text-sky-300">
                        {sceneInspectorSummary.gazeAndHead.gazeMode.replace(/_/g, ' ')} (
                        {sceneInspectorSummary.gazeAndHead.headRotationDeg}°H /{' '}
                        {sceneInspectorSummary.gazeAndHead.headTiltDeg}°V)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Environment Policy:</span>
                      <span className="font-mono text-indigo-300 truncate max-w-[175px]">
                        {sceneInspectorSummary.environmentAndInteraction.effectiveEnvironmentPolicy.replace(
                          /_/g,
                          ' '
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Character Rig:</span>
                      <span className="font-mono text-slate-300 truncate max-w-[195px]">
                        {sceneInspectorSummary.subject.customModelStatus}
                      </span>
                    </div>
                  </div>

                  {/* Quick 3D/2D Visual Guide Toggles */}
                  <div className="pt-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">
                      3D Gizmos & Viewport Overlays
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          ['worldAxes', 'World Axes'],
                          ['subjectOriginAndFacing', 'Facing Arrow'],
                          ['movementDirection', 'Move Basis'],
                          ['headAndGazeVectors', 'Head & Gaze Rays'],
                          ['cameraGizmoAndTarget', 'Camera Target'],
                          ['ruleOfThirdsOverlay', 'Thirds Grid'],
                          ['safeFramingGuides', 'Framing Guide'],
                          ['groundGrid', '3D Grid'],
                        ] as [keyof PlayboardVisualGuidesConfig, string][]
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setVisualGuides((prev) => ({ ...prev, [key]: !prev[key] }))
                          }
                          className={`px-2 py-0.5 text-[10px] font-medium rounded-md border transition-colors cursor-pointer ${
                            visualGuides[key]
                              ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500/60'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ============================================================== */}
            {/* TAB 1: CAMERA & OPTICS */}
            {/* ============================================================== */}
            {activeTab === 'camera' && (
              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Camera View Presets
                    </label>
                    <span className="text-[11px] text-slate-500">Pose untouched</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {CAMERA_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyCameraPreset(preset)}
                        className="px-2.5 py-2 text-left rounded-lg bg-slate-800/70 hover:bg-slate-700/80 border border-slate-700/60 transition-all group cursor-pointer"
                      >
                        <div className="text-xs font-medium text-slate-200 group-hover:text-indigo-300 truncate">
                          {preset.label}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {preset.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-4 space-y-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Viewing Angles & Position
                  </h4>

                  {/* Horizontal Viewing Angle (Yaw) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-medium">Horizontal Yaw</span>
                      <span className="font-mono text-indigo-400">{camera.yawDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      value={camera.yawDeg}
                      onChange={(e) => setCamera({ ...camera, yawDeg: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>-180° Rear</span>
                      <span>-90° Left</span>
                      <span>0° Front</span>
                      <span>+90° Right</span>
                      <span>+180° Rear</span>
                    </div>
                  </div>

                  {/* Vertical Pitch Angle */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-medium">Vertical Pitch Angle</span>
                      <span className="font-mono text-indigo-400">{camera.pitchDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min="-25"
                      max="75"
                      value={camera.pitchDeg}
                      onChange={(e) => setCamera({ ...camera, pitchDeg: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>-25° Up</span>
                      <span>0° Eye-Level</span>
                      <span>+45° High</span>
                      <span>+75° Overhead</span>
                    </div>
                  </div>

                  {/* Camera Height */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-medium">Camera Elevation (Height)</span>
                      <span className="font-mono text-indigo-400">{camera.height} m</span>
                    </div>
                    <input
                      type="range"
                      min="0.3"
                      max="3.2"
                      step="0.05"
                      value={camera.height}
                      onChange={(e) => setCamera({ ...camera, height: parseFloat(e.target.value) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>0.3m Ground</span>
                      <span>1.4m Eye-Level</span>
                      <span>3.2m Overhead</span>
                    </div>
                  </div>

                  {/* Distance */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-medium">Camera Distance</span>
                      <span className="font-mono text-indigo-400">{camera.distance} m</span>
                    </div>
                    <input
                      type="range"
                      min="1.0"
                      max="6.0"
                      step="0.1"
                      value={camera.distance}
                      onChange={(e) => setCamera({ ...camera, distance: parseFloat(e.target.value) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Camera Roll (Dutch Angle) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-medium">Camera Roll (Dutch Angle)</span>
                      <span className="font-mono text-indigo-400">{camera.rollDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min="-30"
                      max="30"
                      value={camera.rollDeg}
                      onChange={(e) => setCamera({ ...camera, rollDeg: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                {/* Optics, Framing & Composition */}
                <div className="border-t border-slate-800 pt-4 space-y-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Optics, Framing & Composition
                  </h4>

                  {/* Camera Target / Tracking Mode */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-300">
                        Camera Target Mode
                      </label>
                      <span className="text-[10px] font-mono text-indigo-400">
                        {(camera.targetMode ?? 'track_subject') === 'fixed_composition'
                          ? 'Fixed Frame Anchor'
                          : 'Follows Subject'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        data-testid="target-mode-track-subject"
                        onClick={() => {
                          const switched = switchCameraTargetMode(camera, pose, 'track_subject');
                          setCamera(switched.camera);
                          setPose(switched.pose);
                        }}
                        className={`px-2.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                          (camera.targetMode ?? 'track_subject') === 'track_subject'
                            ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        Track Subject
                      </button>
                      <button
                        type="button"
                        data-testid="target-mode-fixed-composition"
                        onClick={() => {
                          const switched = switchCameraTargetMode(
                            camera,
                            pose,
                            'fixed_composition'
                          );
                          setCamera(switched.camera);
                          setPose(switched.pose);
                        }}
                        className={`px-2.5 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                          camera.targetMode === 'fixed_composition'
                            ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        Fixed Composition
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {camera.targetMode === 'fixed_composition'
                        ? 'Camera locks onto the current stage anchor so the blue Move joystick walks the subject across the frame (left/right thirds).'
                        : 'Camera tracks the subject as they move so orbit and framing stay centered on the character.'}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Lens / Field of View</label>
                    <select
                      value={camera.focalLength}
                      onChange={(e) => setCamera({ ...camera, focalLength: e.target.value as LensFocalLength })}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="16mm_ultra_wide">16mm Ultra-Wide (Deep perspective distortion)</option>
                      <option value="24mm_wide">24mm Wide-Angle (Expansive environmental FOV)</option>
                      <option value="35mm_moderate_wide">35mm Classic Reportage (Natural environmental)</option>
                      <option value="50mm_standard_normal">50mm Standard Prime (True human eye view)</option>
                      <option value="85mm_portrait_telephoto">85mm Portrait Telephoto (Flattering compression)</option>
                      <option value="135mm_telephoto">135mm Telephoto (Tight background compression)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-300">
                        Requested Shot Framing
                      </label>
                      <span className="text-[10px] font-mono text-emerald-400">
                        Measured: {liveFraming.shotSizeLabel}
                      </span>
                    </div>
                    <select
                      value={camera.framing}
                      onChange={(e) => {
                        const nextFraming = e.target.value as ShotFraming;
                        setCamera((prev) => applyRequestedFramingState(prev, nextFraming));
                      }}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="extreme_close_up">Extreme Close-Up (Eyes and facial detail)</option>
                      <option value="close_up_portrait">Close-Up Portrait (Head & collar)</option>
                      <option value="medium_close_up">Medium Close-Up (Chest-up framing)</option>
                      <option value="medium_shot">Medium Shot (Waist-up framing)</option>
                      <option value="three_quarter_shot">Three-Quarter Shot (Knee-up framing)</option>
                      <option value="full_shot">Full Shot (Head-to-toe full body)</option>
                      <option value="wide_shot">Wide Shot (Full body with expansive environment)</option>
                    </select>
                    <div
                      data-testid="live-framing-summary"
                      className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-indigo-300">
                          Visible Frame Composition ({liveFraming.parsedAspectRatio.ratioString})
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {Math.round(Math.max(liveFraming.subjectHeightFraction, liveFraming.subjectWidthFraction) * 100)}% span
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        {liveFraming.shotSizeDescription}.{' '}
                        {liveFraming.croppedParts.length > 0
                          ? `Cropped outside frame: ${liveFraming.croppedParts.join(', ')}.`
                          : 'Full figure visible inside frame.'}
                      </p>
                      {!liveFraming.framingMatchesRequest && liveFraming.framingDiscrepancyNote && (
                        <div className="pt-1 space-y-1.5">
                          <p className="text-[10px] text-amber-300/90 leading-snug">
                            Note: {liveFraming.framingDiscrepancyNote}.
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setCamera((prev) => applyRequestedFramingState(prev, prev.framing));
                                showToast('Camera distance aligned to requested framing');
                              }}
                              className="px-2 py-1 text-[10px] font-semibold rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 cursor-pointer"
                            >
                              Match Distance to {camera.framing.replace(/_/g, ' ')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCamera((prev) => ({
                                  ...prev,
                                  framing: liveFraming.measuredFraming,
                                }));
                                showToast(`Synced label to ${liveFraming.shotSizeLabel}`);
                              }}
                              className="px-2 py-1 text-[10px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                            >
                              Sync Label to {liveFraming.shotSizeLabel}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Subject Composition</label>
                    <select
                      value={camera.composition}
                      onChange={(e) => setCamera({ ...camera, composition: e.target.value as SubjectComposition })}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="center">Center Balanced (Symmetrical)</option>
                      <option value="rule_of_thirds_left">Rule of Thirds (Camera Left)</option>
                      <option value="rule_of_thirds_right">Rule of Thirds (Camera Right)</option>
                      <option value="low_frame">Low Frame (Generous Headroom)</option>
                      <option value="high_frame">High Frame (Anchored Top)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Target Output Ratio</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'].map((ratio) => (
                        <button
                          key={ratio}
                          type="button"
                          onClick={() => {
                            const parsed = parseOutputAspectRatio(ratio);
                            setCamera({
                              ...camera,
                              outputRatio: ratio,
                              orientation: parsed.orientation,
                            });
                          }}
                          className={`py-1.5 px-2 text-xs font-mono font-medium rounded-lg border transition-all cursor-pointer ${
                            camera.outputRatio === ratio
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Depth of Field / Aperture</label>
                    <select
                      value={camera.focusDof}
                      onChange={(e) => setCamera({ ...camera, focusDof: e.target.value as FocusDof })}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="shallow_f1_4">Shallow f/1.4 (Creamy bokeh, sharp subject isolation)</option>
                      <option value="moderate_f4_0">Moderate f/4.0 (Natural gentle depth separation)</option>
                      <option value="deep_f11">Deep f/11 (Edge-to-edge landscape clarity)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 2: POSE & GESTURES */}
            {/* ============================================================== */}
            {activeTab === 'pose' && (
              <div className="space-y-5">
                {/* ============================================================== */}
                {/* POSE-FIRST WORKFLOW BANNER & SUPPORT SURFACE PLACEMENT CARD    */}
                {/* ============================================================== */}
                <div
                  data-testid="support-surface-placement-card"
                  className="p-3 rounded-xl bg-slate-900/95 border border-indigo-500/35 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">
                        1. Support Surface & Pose Placement
                      </h4>
                      <p className="text-[10px] text-slate-400">
                        Select supporting furniture or floor, then fine-tune X/Z position with the Blue Joystick or sliders
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid="studio-center-on-support-btn"
                      onClick={handleCenterOnActiveSupport}
                      className="px-2 py-1 text-[10px] font-semibold rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 shrink-0 cursor-pointer"
                      title="Center subject on the active support surface anchor"
                    >
                      Center on Support
                    </button>
                  </div>

                  {/* Support Surface Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {BEDROOM_SUPPORT_SURFACES.map((surf) => {
                      const isCurrentSupport = activeSupportSurface.id === surf.id;
                      return (
                        <button
                          key={surf.id}
                          type="button"
                          data-testid={`support-surface-${surf.id}`}
                          onClick={() => handleSelectSupportSurface(surf)}
                          className={`px-2 py-1.5 text-left rounded-lg border transition-all cursor-pointer ${
                            isCurrentSupport
                              ? 'bg-indigo-600/35 border-indigo-400 text-indigo-100 shadow-sm'
                              : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700/70 text-slate-300'
                          }`}
                        >
                          <div className="text-[11px] font-semibold truncate">{surf.shortLabel}</div>
                          <div className="text-[9px] text-slate-400 font-mono truncate">
                            {surf.seatHeightY !== null ? `Elev Y=${surf.seatHeightY}m` : 'Floor Y=0m'}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Fine X / Z Placement & Subject Facing Controls */}
                  <div className="pt-2 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                        <span>Pos X (L/R)</span>
                        <span className="font-mono text-indigo-300">
                          {(pose.characterPosX ?? 0).toFixed(2)}m
                        </span>
                      </div>
                      <input
                        type="range"
                        min={pose.seatHeightY !== null ? activeSupportSurface.bounds.minX : -2.6}
                        max={pose.seatHeightY !== null ? activeSupportSurface.bounds.maxX : 2.6}
                        step="0.02"
                        value={pose.characterPosX ?? 0}
                        onChange={(e) => {
                          const rawX = parseFloat(e.target.value);
                          const clamped = clampPosePlacementToSupportBounds(
                            pose,
                            rawX,
                            pose.characterPosZ ?? 0,
                            environment
                          );
                          setPose((prev) => ({
                            ...prev,
                            characterPosX: clamped.x,
                            anchorPosX:
                              camera.targetMode === 'fixed_composition'
                                ? prev.anchorPosX ?? 0
                                : clamped.x,
                            isWalking: false,
                          }));
                        }}
                        className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                        <span>Pos Z (F/B)</span>
                        <span className="font-mono text-indigo-300">
                          {(pose.characterPosZ ?? 0).toFixed(2)}m
                        </span>
                      </div>
                      <input
                        type="range"
                        min={pose.seatHeightY !== null ? activeSupportSurface.bounds.minZ : -2.65}
                        max={pose.seatHeightY !== null ? activeSupportSurface.bounds.maxZ : 2.65}
                        step="0.02"
                        value={pose.characterPosZ ?? 0}
                        onChange={(e) => {
                          const rawZ = parseFloat(e.target.value);
                          const clamped = clampPosePlacementToSupportBounds(
                            pose,
                            pose.characterPosX ?? 0,
                            rawZ,
                            environment
                          );
                          setPose((prev) => ({
                            ...prev,
                            characterPosZ: clamped.z,
                            anchorPosZ:
                              camera.targetMode === 'fixed_composition'
                                ? prev.anchorPosZ ?? 0
                                : clamped.z,
                            isWalking: false,
                          }));
                        }}
                        className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                        <span>Facing Yaw</span>
                        <span className="font-mono text-emerald-300">
                          {pose.characterYawDeg ?? 0}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        step="5"
                        value={pose.characterYawDeg ?? 0}
                        onChange={(e) =>
                          setPose((prev) => ({
                            ...prev,
                            characterYawDeg: parseInt(e.target.value, 10),
                            isWalking: false,
                          }))
                        }
                        className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* ============================================================== */}
                {/* 2. SCENE & FURNITURE POSE LIBRARY (68+ Poses across 5 Domains) */}
                {/* ============================================================== */}
                <div
                  data-testid="scene-interactions-section"
                  className="p-3 rounded-xl bg-slate-900/90 border border-indigo-500/30 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">
                        2. Scene & Furniture Pose Library ({SCENE_INTERACTION_PRESETS.length} Poses)
                      </h4>
                      <p className="text-[10px] text-slate-400">
                        Places character at bed, chair, bench, desk, wall, or floor while keeping camera angle & framing
                      </p>
                    </div>
                    {activeInteractionPreset && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={handleReturnToActivePreset}
                          className="px-2 py-1 text-[10px] font-semibold rounded-md bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 cursor-pointer"
                          title="Snap back to active interaction preset pose and position"
                        >
                          Return to Preset
                        </button>
                        <button
                          type="button"
                          onClick={handleExitInteractionPreset}
                          className="px-2 py-1 text-[10px] font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                          title="Reset character to studio center"
                        >
                          Center
                        </button>
                      </div>
                    )}
                  </div>

                  {environment !== 'studio_bedroom' && (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
                      <span>Bed, chair, and desk furniture are visible in Studio Bedroom environment.</span>
                      <button
                        type="button"
                        onClick={() => setEnvironment('studio_bedroom')}
                        className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-semibold text-[10px] shrink-0 cursor-pointer"
                      >
                        Switch to Bedroom
                      </button>
                    </div>
                  )}

                  {/* Search Input for Pose Library */}
                  <div className="relative">
                    <input
                      type="text"
                      data-testid="pose-library-search-input"
                      value={poseSearchQuery}
                      onChange={(e) => setPoseSearchQuery(e.target.value)}
                      placeholder="Search poses (e.g. wall, bench, side-lying, cross-legged, squat, desk)..."
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-700/80 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    {poseSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setPoseSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white px-1 cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Category Selector Pills */}
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveInteractionCategory('all')}
                      className={`px-2 py-1 text-[11px] font-medium rounded-lg border transition-all cursor-pointer ${
                        activeInteractionCategory === 'all'
                          ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                          : 'bg-slate-800/80 text-slate-300 border-slate-700/70 hover:bg-slate-700/70'
                      }`}
                    >
                      All ({SCENE_INTERACTION_PRESETS.length})
                    </button>
                    {SCENE_INTERACTION_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setActiveInteractionCategory(cat.id)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all cursor-pointer ${
                          activeInteractionCategory === cat.id
                            ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                            : 'bg-slate-800/80 text-slate-300 border-slate-700/70 hover:bg-slate-700/70'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  {/* Presets Grid for Selected Category & Search Filter */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-0.5 custom-scrollbar">
                    {SCENE_INTERACTION_PRESETS.filter((p) => {
                      const matchesCat =
                        activeInteractionCategory === 'all' || p.category === activeInteractionCategory;
                      const q = poseSearchQuery.trim().toLowerCase();
                      if (!q) return matchesCat;
                      return (
                        matchesCat &&
                        (p.label.toLowerCase().includes(q) ||
                          p.shortDesc.toLowerCase().includes(q) ||
                          p.furnitureTarget.toLowerCase().includes(q) ||
                          p.categoryLabel.toLowerCase().includes(q))
                      );
                    }).map((preset) => {
                      const isSelected = pose.interactionPresetId === preset.id;
                      const scopePreview = describePresetUpdateScope('scene_interaction', preset.label);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          data-testid={`interaction-preset-${preset.id}`}
                          onClick={() => applyInteractionPreset(preset)}
                          className={`p-2.5 text-left rounded-lg border transition-all cursor-pointer space-y-1 ${
                            isSelected
                              ? 'bg-indigo-600/35 border-indigo-400 text-indigo-100 shadow-sm'
                              : 'bg-slate-800/75 hover:bg-slate-800 border-slate-700/60 text-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-semibold truncate">{preset.label}</span>
                            <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-900/80 text-indigo-300 shrink-0">
                              {preset.furnitureTarget}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-300 line-clamp-1">
                            {preset.shortDesc}
                          </div>
                          <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 pt-0.5 border-t border-slate-700/40">
                            <span title={scopePreview.changes.join(', ')}>
                              Δ Pose + {preset.furnitureTarget}
                            </span>
                            <span className="text-emerald-400/90" title={scopePreview.preserves.join(', ')}>
                              ✓ Cam + Identity
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Source-Inspired Environment Continuity Policy Card */}
                  <div
                    data-testid="environment-continuity-card"
                    className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-emerald-300">
                        Source Image Continuity & Scene Policy
                      </span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        {resolvedEnvPolicy.modeLabel}
                      </span>
                    </div>
                    <select
                      value={environmentPolicy}
                      onChange={(e) => {
                        const val = e.target.value as EnvironmentTransformationPolicy;
                        setEnvironmentPolicy(val);
                        setPreserveEnvironment(val !== 'replace_environment');
                      }}
                      className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
                    >
                      <option value="auto">
                        Auto (Source-Inspired Continuity for Furniture Poses)
                      </option>
                      <option value="source_inspired_transformation">
                        Source-Inspired Transformation (Adapt Scene + Match Source Lighting & Tone)
                      </option>
                      <option value="preserve_physical_environment">
                        Preserve Original Physical Room & Lighting
                      </option>
                      <option value="replace_environment">
                        Full Stage Environment Replacement
                      </option>
                    </select>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {resolvedEnvPolicy.summary}
                    </p>
                  </div>
                </div>

                {/* Standalone Base Pose Templates (Applies Pose In-Place Without Moving X/Z) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      In-Place Body Pose Templates ({POSE_PRESETS.length})
                    </label>
                    <span className="text-[10px] text-slate-400">Keeps current X/Z & camera</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-0.5 custom-scrollbar">
                    {POSE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPosePreset(preset)}
                        className={`px-2.5 py-2 text-left rounded-lg border transition-all group cursor-pointer ${
                          pose.basePose === preset.id && !pose.interactionPresetId
                            ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                            : 'bg-slate-800/70 hover:bg-slate-700/80 border-slate-700/60'
                        }`}
                      >
                        <div className="text-xs font-medium truncate group-hover:text-indigo-300">
                          {preset.label}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {preset.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Motion, IK & Rig Controls */}
                <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/70 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Animation & Rig Controls
                    </span>
                    <span className="text-[10px] text-slate-400">Shift+Drag character to pose</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAnimationPaused((prev) => !prev);
                        if (pose.isWalking || pose.isWaving) {
                          setPose((prev) => ({ ...prev, isWalking: false, isWaving: false }));
                        }
                      }}
                      className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                        animationPaused || (!pose.isWalking && !pose.isWaving)
                          ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                      }`}
                    >
                      {animationPaused ? '▶ Resume Idle Motion' : '✋ Manual Pose Mode'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIkEnabled((prev) => !prev)}
                      className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                        ikEnabled
                          ? 'bg-emerald-600/25 border-emerald-500/60 text-emerald-200'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                      title="Enable surface-aware Two-Bone IK for hands, knees, and feet on bed/chair/floor plus smart arm gestures"
                    >
                      {ikEnabled ? '🦾 Smart Pose & Surface IK: ON' : '🦾 Smart Pose & Surface IK: OFF'}
                    </button>
                  </div>

                  {/* Ghost Pose Reference Comparison Controls */}
                  <div className="pt-1.5 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleCaptureGhostReference}
                        className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-cyan-600/25 hover:bg-cyan-600/40 text-cyan-200 border border-cyan-500/50 cursor-pointer"
                        title="Capture current 3D pose as a translucent reference silhouette"
                      >
                        👻 Snapshot Ghost Pose
                      </button>
                      {effectiveGhostPose && (
                        <button
                          type="button"
                          onClick={() => setShowGhostPose((v) => !v)}
                          className={`px-2 py-1 text-[11px] font-semibold rounded-lg border cursor-pointer ${
                            showGhostPose
                              ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                              : 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white'
                          }`}
                        >
                          {showGhostPose ? 'Hide Ghost' : 'Show Ghost'}
                        </button>
                      )}
                    </div>
                    {effectiveGhostPose && showGhostPose && (
                      <div className="flex items-center gap-1.5 text-[10px] text-cyan-300">
                        <span className="truncate max-w-[120px]">{effectiveGhostLabel}</span>
                        <input
                          type="range"
                          min={0.1}
                          max={0.75}
                          step={0.05}
                          value={ghostOpacity}
                          onChange={(e) => setGhostOpacity(parseFloat(e.target.value))}
                          className="w-16 accent-cyan-400 cursor-pointer"
                          title="Ghost Silhouette Opacity"
                        />
                      </div>
                    )}
                  </div>

                  {/* Optional Custom GLB/GLTF Character Loader + Diagnostics & Calibration */}
                  <div className="pt-1 border-t border-slate-700/60 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-300 truncate font-medium">
                        {customGlbName ? `Rig: ${customGlbName}` : customModelDiag.statusSummary}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <label className="px-2 py-1 text-[10px] font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 cursor-pointer">
                          Load .GLB
                          <input
                            type="file"
                            accept=".glb,.gltf"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (customGlbUrl) URL.revokeObjectURL(customGlbUrl);
                                const url = URL.createObjectURL(file);
                                setCustomGlbUrl(url);
                                setCustomGlbName(file.name);
                                showToast(`Loaded ${file.name}`);
                              }
                            }}
                          />
                        </label>
                        {customGlbUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              URL.revokeObjectURL(customGlbUrl);
                              setCustomGlbUrl(null);
                              setCustomGlbName(null);
                              showToast('Restored built-in Studio Human rig');
                            }}
                            className="px-2 py-1 text-[10px] font-semibold rounded-md bg-red-500/20 text-red-300 border border-red-500/40 cursor-pointer"
                          >
                            Reset Rig
                          </button>
                        )}
                      </div>
                    </div>

                    {customModelDiag.isActive && pose.customModelBounds && (
                      <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-700/80 space-y-2 text-[10px]">
                        <div className="text-amber-300/90 leading-snug">
                          {customModelDiag.statusSummary} · Bounds:{' '}
                          {customModelDiag.normalizedWidth.toFixed(2)}m W ×{' '}
                          {customModelDiag.normalizedHeight.toFixed(2)}m H
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <div className="flex justify-between text-slate-400">
                              <span>Scale</span>
                              <span>{(pose.customModelBounds.scaleMultiplier ?? 1).toFixed(2)}x</span>
                            </div>
                            <input
                              type="range"
                              min="0.5"
                              max="1.8"
                              step="0.05"
                              value={pose.customModelBounds.scaleMultiplier ?? 1}
                              onChange={(e) =>
                                setPose((prev) =>
                                  prev.customModelBounds
                                    ? {
                                        ...prev,
                                        customModelBounds: {
                                          ...prev.customModelBounds,
                                          scaleMultiplier: parseFloat(e.target.value),
                                        },
                                      }
                                    : prev
                                )
                              }
                              className="w-full accent-indigo-500 h-1"
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-slate-400">
                              <span>Vertical Y</span>
                              <span>{(pose.customModelBounds.offsetY ?? 0).toFixed(2)}m</span>
                            </div>
                            <input
                              type="range"
                              min="-0.4"
                              max="0.4"
                              step="0.02"
                              value={pose.customModelBounds.offsetY ?? 0}
                              onChange={(e) =>
                                setPose((prev) =>
                                  prev.customModelBounds
                                    ? {
                                        ...prev,
                                        customModelBounds: {
                                          ...prev.customModelBounds,
                                          offsetY: parseFloat(e.target.value),
                                        },
                                      }
                                    : prev
                                )
                              }
                              className="w-full accent-indigo-500 h-1"
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-slate-400">
                              <span>Facing Off</span>
                              <span>{pose.customModelBounds.yawOffsetDeg ?? 0}°</span>
                            </div>
                            <input
                              type="range"
                              min="-180"
                              max="180"
                              step="5"
                              value={pose.customModelBounds.yawOffsetDeg ?? 0}
                              onChange={(e) =>
                                setPose((prev) =>
                                  prev.customModelBounds
                                    ? {
                                        ...prev,
                                        customModelBounds: {
                                          ...prev.customModelBounds,
                                          yawOffsetDeg: parseInt(e.target.value, 10),
                                        },
                                      }
                                    : prev
                                )
                              }
                              className="w-full accent-indigo-500 h-1"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Head & Neck Articulation (Quick Access in Pose Tab) */}
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-violet-300 uppercase tracking-wider">
                      3A. Head & Neck Articulation
                    </h4>
                    <button
                      type="button"
                      data-testid="reset-head-joints-btn"
                      onClick={() =>
                        setPose((prev) => ({
                          ...prev,
                          headRotationDeg: 0,
                          headTiltDeg: 0,
                        }))
                      }
                      className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                    >
                      Reset Head
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Head Turn (Yaw):</span>
                        <span className="font-mono text-violet-300">{pose.headRotationDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="-75"
                        max="75"
                        value={pose.headRotationDeg}
                        onChange={(e) =>
                          setPose({ ...pose, headRotationDeg: parseInt(e.target.value, 10) })
                        }
                        className="w-full accent-violet-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Head Tilt (Pitch):</span>
                        <span className="font-mono text-violet-300">{pose.headTiltDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="-35"
                        max="35"
                        value={pose.headTiltDeg}
                        onChange={(e) =>
                          setPose({ ...pose, headTiltDeg: parseInt(e.target.value, 10) })
                        }
                        className="w-full accent-violet-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Torso, Spine & Root Pelvis Articulation */}
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      3B. Torso, Spine & Pelvis Articulation
                    </h4>
                    <button
                      type="button"
                      data-testid="reset-torso-joints-btn"
                      onClick={() =>
                        setPose((prev) => ({
                          ...prev,
                          torsoLeanDeg: 0,
                          torsoTwistDeg: 0,
                          torsoTiltDeg: 0,
                          pelvisPitchDeg: 0,
                          pelvisRollDeg: 0,
                        }))
                      }
                      className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                    >
                      Reset Torso
                    </button>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Torso Lean (Forward / Back)</span>
                      <span className="font-mono text-indigo-400">{pose.torsoLeanDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min="-25"
                      max="25"
                      value={pose.torsoLeanDeg}
                      onChange={(e) => setPose({ ...pose, torsoLeanDeg: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Torso Twist (Rotation)</span>
                      <span className="font-mono text-indigo-400">{pose.torsoTwistDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min="-40"
                      max="40"
                      value={pose.torsoTwistDeg}
                      onChange={(e) => setPose({ ...pose, torsoTwistDeg: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Torso Lateral Tilt</span>
                      <span className="font-mono text-indigo-400">{pose.torsoTiltDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min="-20"
                      max="20"
                      value={pose.torsoTiltDeg}
                      onChange={(e) => setPose({ ...pose, torsoTiltDeg: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                        <span>Pelvis Pitch</span>
                        <span className="font-mono text-indigo-300">{pose.pelvisPitchDeg ?? 0}°</span>
                      </div>
                      <input
                        type="range"
                        min="-90"
                        max="90"
                        value={pose.pelvisPitchDeg ?? 0}
                        onChange={(e) =>
                          setPose({ ...pose, pelvisPitchDeg: parseInt(e.target.value, 10) })
                        }
                        className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                        <span>Pelvis Roll</span>
                        <span className="font-mono text-indigo-300">{pose.pelvisRollDeg ?? 0}°</span>
                      </div>
                      <input
                        type="range"
                        min="-90"
                        max="90"
                        value={pose.pelvisRollDeg ?? 0}
                        onChange={(e) =>
                          setPose({ ...pose, pelvisRollDeg: parseInt(e.target.value, 10) })
                        }
                        className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                        <span>Hip Offset Y</span>
                        <span className="font-mono text-indigo-300">
                          {(pose.hipHeightOffset ?? 0).toFixed(2)}m
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-0.85"
                        max="0.15"
                        step="0.02"
                        value={pose.hipHeightOffset ?? 0}
                        onChange={(e) =>
                          setPose({ ...pose, hipHeightOffset: parseFloat(e.target.value) })
                        }
                        className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Left Arm Controls */}
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      3C. Character's Left Arm & Hand
                    </h4>
                    <button
                      type="button"
                      data-testid="reset-left-arm-btn"
                      onClick={() =>
                        setPose((prev) => ({
                          ...prev,
                          leftArmShoulderForwardDeg: 0,
                          leftArmShoulderOutDeg: 8,
                          leftArmElbowBendDeg: 10,
                          leftArmWristDeg: 0,
                          leftHandGesture: 'relaxed_natural',
                        }))
                      }
                      className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                    >
                      Reset L Arm
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-300">Left Hand Gesture (5-Finger Rig)</label>
                    <select
                      value={pose.leftHandGesture}
                      onChange={(e) => setPose({ ...pose, leftHandGesture: e.target.value as HandGesture })}
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200"
                    >
                      <option value="relaxed_natural">Relaxed / Natural</option>
                      <option value="open_palm">Open Palm Extended</option>
                      <option value="wave">Waving Hand</option>
                      <option value="pointing">Pointing Index Finger</option>
                      <option value="thumbs_up">Thumbs Up</option>
                      <option value="fist">Firm Fist</option>
                      <option value="peace_sign">Peace / V-Sign</option>
                      <option value="hand_on_hip">Resting on Hip (IK)</option>
                      <option value="raised_up">Raised Up High</option>
                      <option value="hands_clasped">Hands Clasped (IK)</option>
                      <option value="touching_face">Touching Chin / Face (IK)</option>
                      <option value="soft_pinch_gap">Soft Pinch / Gap</option>
                      <option value="cupped_palm_inward">Cupped Palm Inward</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Shoulder Fwd:</span>
                        <span className="font-mono text-indigo-400">{pose.leftArmShoulderForwardDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="-45"
                        max="110"
                        value={pose.leftArmShoulderForwardDeg}
                        onChange={(e) =>
                          setPose({
                            ...pose,
                            isWalking: false,
                            leftArmShoulderForwardDeg: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Shoulder Out:</span>
                        <span className="font-mono text-indigo-400">{pose.leftArmShoulderOutDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="90"
                        value={pose.leftArmShoulderOutDeg}
                        onChange={(e) =>
                          setPose({
                            ...pose,
                            isWalking: false,
                            leftArmShoulderOutDeg: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Elbow Bend:</span>
                        <span className="font-mono text-indigo-400">{pose.leftArmElbowBendDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="140"
                        value={pose.leftArmElbowBendDeg}
                        onChange={(e) =>
                          setPose({
                            ...pose,
                            isWalking: false,
                            leftArmElbowBendDeg: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Wrist Twist:</span>
                        <span className="font-mono text-indigo-400">{pose.leftArmWristDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="-30"
                        max="30"
                        value={pose.leftArmWristDeg}
                        onChange={(e) =>
                          setPose({
                            ...pose,
                            leftArmWristDeg: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Right Arm Controls */}
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                      3D. Character's Right Arm & Hand
                    </h4>
                    <button
                      type="button"
                      data-testid="reset-right-arm-btn"
                      onClick={() =>
                        setPose((prev) => ({
                          ...prev,
                          rightArmShoulderForwardDeg: 0,
                          rightArmShoulderOutDeg: 8,
                          rightArmElbowBendDeg: 10,
                          rightArmWristDeg: 0,
                          rightHandGesture: 'relaxed_natural',
                        }))
                      }
                      className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                    >
                      Reset R Arm
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-300">Right Hand Gesture (5-Finger Rig)</label>
                    <select
                      value={pose.rightHandGesture}
                      onChange={(e) => setPose({ ...pose, rightHandGesture: e.target.value as HandGesture })}
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200"
                    >
                      <option value="relaxed_natural">Relaxed / Natural</option>
                      <option value="open_palm">Open Palm Extended</option>
                      <option value="wave">Waving Hand</option>
                      <option value="pointing">Pointing Index Finger</option>
                      <option value="thumbs_up">Thumbs Up</option>
                      <option value="fist">Firm Fist</option>
                      <option value="peace_sign">Peace / V-Sign</option>
                      <option value="hand_on_hip">Resting on Hip (IK)</option>
                      <option value="raised_up">Raised Up High</option>
                      <option value="hands_clasped">Hands Clasped (IK)</option>
                      <option value="touching_face">Touching Chin / Face (IK)</option>
                      <option value="soft_pinch_gap">Soft Pinch / Gap</option>
                      <option value="cupped_palm_inward">Cupped Palm Inward</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Shoulder Fwd:</span>
                        <span className="font-mono text-indigo-400">{pose.rightArmShoulderForwardDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="-45"
                        max="110"
                        value={pose.rightArmShoulderForwardDeg}
                        onChange={(e) =>
                          setPose({
                            ...pose,
                            isWalking: false,
                            isWaving: false,
                            rightArmShoulderForwardDeg: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-sky-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Shoulder Out:</span>
                        <span className="font-mono text-indigo-400">{pose.rightArmShoulderOutDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="90"
                        value={pose.rightArmShoulderOutDeg}
                        onChange={(e) =>
                          setPose({
                            ...pose,
                            isWalking: false,
                            isWaving: false,
                            rightArmShoulderOutDeg: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-sky-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Elbow Bend:</span>
                        <span className="font-mono text-indigo-400">{pose.rightArmElbowBendDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="140"
                        value={pose.rightArmElbowBendDeg}
                        onChange={(e) =>
                          setPose({
                            ...pose,
                            isWalking: false,
                            isWaving: false,
                            rightArmElbowBendDeg: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-sky-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                        <span>Wrist Twist:</span>
                        <span className="font-mono text-indigo-400">{pose.rightArmWristDeg}°</span>
                      </div>
                      <input
                        type="range"
                        min="-30"
                        max="30"
                        value={pose.rightArmWristDeg}
                        onChange={(e) =>
                          setPose({
                            ...pose,
                            rightArmWristDeg: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-sky-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Legs & Stance Controls */}
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      3E. Legs, Knees & Foot Articulation
                    </h4>
                    <button
                      type="button"
                      data-testid="reset-legs-joints-btn"
                      onClick={() =>
                        setPose((prev) => ({
                          ...prev,
                          leftLegHipForwardDeg: 0,
                          leftLegHipOutDeg: 4,
                          leftLegKneeBendDeg: 0,
                          leftFootAngleDeg: 0,
                          rightLegHipForwardDeg: 0,
                          rightLegHipOutDeg: 4,
                          rightLegKneeBendDeg: 0,
                          rightFootAngleDeg: 0,
                        }))
                      }
                      className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                    >
                      Reset Legs
                    </button>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800 space-y-2.5">
                    <span className="text-[11px] font-semibold text-emerald-400">Left Leg & Foot</span>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Hip Step:</span>
                          <span>{pose.leftLegHipForwardDeg}°</span>
                        </div>
                        <input
                          type="range"
                          min="-50"
                          max="90"
                          value={pose.leftLegHipForwardDeg}
                          onChange={(e) =>
                            setPose({
                              ...pose,
                              isWalking: false,
                              leftLegHipForwardDeg: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-emerald-500 bg-slate-800 h-1 rounded-lg"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Knee Bend:</span>
                          <span>{pose.leftLegKneeBendDeg}°</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="130"
                          value={pose.leftLegKneeBendDeg}
                          onChange={(e) =>
                            setPose({
                              ...pose,
                              isWalking: false,
                              leftLegKneeBendDeg: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-emerald-500 bg-slate-800 h-1 rounded-lg"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Outward Spread:</span>
                          <span>{pose.leftLegHipOutDeg}°</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="45"
                          value={pose.leftLegHipOutDeg}
                          onChange={(e) =>
                            setPose({
                              ...pose,
                              isWalking: false,
                              leftLegHipOutDeg: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-emerald-500 bg-slate-800 h-1 rounded-lg"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Foot Turn:</span>
                          <span>{pose.leftFootAngleDeg}°</span>
                        </div>
                        <input
                          type="range"
                          min="-20"
                          max="20"
                          value={pose.leftFootAngleDeg}
                          onChange={(e) =>
                            setPose({
                              ...pose,
                              leftFootAngleDeg: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-emerald-500 bg-slate-800 h-1 rounded-lg"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800 space-y-2.5">
                    <span className="text-[11px] font-semibold text-sky-400">Right Leg & Foot</span>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Hip Step:</span>
                          <span>{pose.rightLegHipForwardDeg}°</span>
                        </div>
                        <input
                          type="range"
                          min="-50"
                          max="90"
                          value={pose.rightLegHipForwardDeg}
                          onChange={(e) =>
                            setPose({
                              ...pose,
                              isWalking: false,
                              rightLegHipForwardDeg: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-sky-500 bg-slate-800 h-1 rounded-lg"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Knee Bend:</span>
                          <span>{pose.rightLegKneeBendDeg}°</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="130"
                          value={pose.rightLegKneeBendDeg}
                          onChange={(e) =>
                            setPose({
                              ...pose,
                              isWalking: false,
                              rightLegKneeBendDeg: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-sky-500 bg-slate-800 h-1 rounded-lg"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Outward Spread:</span>
                          <span>{pose.rightLegHipOutDeg}°</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="45"
                          value={pose.rightLegHipOutDeg}
                          onChange={(e) =>
                            setPose({
                              ...pose,
                              isWalking: false,
                              rightLegHipOutDeg: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-sky-500 bg-slate-800 h-1 rounded-lg"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Foot Turn:</span>
                          <span>{pose.rightFootAngleDeg}°</span>
                        </div>
                        <input
                          type="range"
                          min="-20"
                          max="20"
                          value={pose.rightFootAngleDeg}
                          onChange={(e) =>
                            setPose({
                              ...pose,
                              rightFootAngleDeg: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-sky-500 bg-slate-800 h-1 rounded-lg"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 3: GAZE & EXPRESSION */}
            {/* ============================================================== */}
            {activeTab === 'gaze' && (
              <div className="space-y-5">
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Head Direction & Orientation
                  </h4>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Head Rotation (Yaw)</span>
                      <span className="font-mono text-indigo-400">{pose.headRotationDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min="-75"
                      max="75"
                      value={pose.headRotationDeg}
                      onChange={(e) => setPose({ ...pose, headRotationDeg: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Head Tilt (Pitch)</span>
                      <span className="font-mono text-indigo-400">{pose.headTiltDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min="-35"
                      max="35"
                      value={pose.headTiltDeg}
                      onChange={(e) => setPose({ ...pose, headTiltDeg: parseInt(e.target.value, 10) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Head-vs-Gaze 3D Relationship Readout & Gizmo Toggle */}
                  <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-indigo-300">
                        Head vs. Eye-Gaze Relationship
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setVisualGuides((prev) => ({
                            ...prev,
                            headAndGazeVectors: !prev.headAndGazeVectors,
                          }))
                        }
                        className={`px-2 py-0.5 text-[10px] font-mono rounded border cursor-pointer ${
                          visualGuides.headAndGazeVectors
                            ? 'bg-indigo-600 text-white border-indigo-400'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {visualGuides.headAndGazeVectors ? '3D Rays: ON' : 'Show 3D Rays'}
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Head relative to camera:{' '}
                      <span className="font-mono text-violet-300">
                        {sceneInspectorSummary.gazeAndHead.relativeToHeadYawDeg}° Yaw
                      </span>{' '}
                      ·{' '}
                      <span className="font-mono text-cyan-300">
                        {sceneInspectorSummary.gazeAndHead.cameraToEyeElevationDeg}° Elev
                      </span>
                    </div>
                    <div className="text-[10px] text-emerald-300/90">
                      {sceneInspectorSummary.gazeAndHead.eyeContactSummary}
                    </div>
                    {customModelDiag.isActive && !customModelDiag.hasSkeletalRig && (
                      <div className="text-[10px] text-amber-300">
                        Note: Custom static GLB uses approximate head/eye bounds.
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-4 space-y-2">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Gaze Direction
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'direct_at_camera', label: 'Direct at Camera Lens' },
                      { id: 'looking_camera_left', label: 'Looking Off Camera Left' },
                      { id: 'looking_camera_right', label: 'Looking Off Camera Right' },
                      { id: 'looking_upward', label: 'Aspirational Upward' },
                      { id: 'looking_downward', label: 'Cast Downward' },
                      { id: 'soft_off_camera', label: 'Soft Natural Off-Axis' },
                      { id: 'eyes_closed', label: 'Eyes Closed' },
                    ].map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setPose({ ...pose, gaze: g.id as GazeDirection })}
                        className={`p-2 text-xs font-medium rounded-lg text-left border transition-all cursor-pointer ${
                          pose.gaze === g.id
                            ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500 shadow-sm'
                            : 'bg-slate-800/70 text-slate-300 border-slate-700/60 hover:bg-slate-700/80'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-4 space-y-2">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Facial Expression
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'neutral_relaxed', label: 'Neutral & Relaxed' },
                      { id: 'gentle_smile', label: 'Gentle Genuine Smile' },
                      { id: 'confident_focused', label: 'Confident & Focused' },
                      { id: 'thoughtful_pensive', label: 'Thoughtful & Pensive' },
                      { id: 'serious_editorial', label: 'Editorial High-Fashion' },
                      { id: 'expressive_laugh', label: 'Joyful Open Smile' },
                      { id: 'determined_intense', label: 'Determined & Resolute' },
                      { id: 'open_mouth_shock', label: 'Open Mouth Shock' },
                      { id: 'intense_open_mouth', label: 'Intense Open Mouth' },
                      { id: 'gasping_open', label: 'Gasping Open' },
                    ].map((expr) => (
                      <button
                        key={expr.id}
                        type="button"
                        onClick={() => setPose({ ...pose, expression: expr.id as FacialExpression })}
                        className={`p-2 text-xs font-medium rounded-lg text-left border transition-all cursor-pointer ${
                          pose.expression === expr.id
                            ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500 shadow-sm'
                            : 'bg-slate-800/70 text-slate-300 border-slate-700/60 hover:bg-slate-700/80'
                        }`}
                      >
                        {expr.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* TAB 4: BLUEPRINTS (SAVED CONFIGURATIONS) */}
            {/* ============================================================== */}
            {activeTab === 'blueprints' && (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/80 space-y-3">
                  <div className="text-xs font-semibold text-slate-200">Save Current Setup as Blueprint</div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Hero Editorial 3/4"
                      value={blueprintNameInput}
                      onChange={(e) => setBlueprintNameInput(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleSaveBlueprint}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Saved Blueprints ({savedBlueprints.length})
                  </div>

                  {savedBlueprints.length === 0 ? (
                    <div className="p-6 text-center rounded-xl bg-slate-800/30 border border-dashed border-slate-700 text-slate-400 text-xs">
                      No saved blueprints yet. Adjust the 3D scene and save your first setup!
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {savedBlueprints.map((bp) => (
                        <div
                          key={bp.id}
                          className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                            selectedBlueprintId === bp.id
                              ? 'bg-indigo-600/20 border-indigo-500 shadow-md'
                              : 'bg-slate-800/60 border-slate-700/70 hover:bg-slate-800'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-200 truncate">{bp.name}</div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                              <span>{bp.camera.yawDeg}° Yaw</span>
                              <span>·</span>
                              <span>{bp.camera.framing.replace(/_/g, ' ')}</span>
                              <span>·</span>
                              <span>{bp.pose.basePose.replace(/_/g, ' ')}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleLoadBlueprint(bp)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm cursor-pointer"
                            >
                              Load
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateBlueprint(bp)}
                              className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 cursor-pointer"
                              title="Duplicate blueprint"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBlueprint(bp.id)}
                              className="p-1 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer"
                              title="Delete blueprint"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Scene Checkpoints (Session History & Quick Restore) */}
                <div className="border-t border-slate-800 pt-4 space-y-2.5">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Scene History & Checkpoints ({checkpoints.length})
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Checkpoint label (optional)"
                      value={checkpointLabelInput}
                      onChange={(e) => setCheckpointLabelInput(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleCreateCheckpoint}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shrink-0"
                    >
                      + Checkpoint
                    </button>
                  </div>
                  {checkpoints.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5 custom-scrollbar">
                      {checkpoints.map((cp) => (
                        <div
                          key={cp.id}
                          className="p-2 rounded-lg bg-slate-800/60 border border-slate-700/70 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-slate-200 truncate">{cp.label}</div>
                            <div className="text-[10px] text-slate-400 truncate">{cp.summaryLine}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setGhostPoseSnapshot(JSON.parse(JSON.stringify(cp.config.pose)));
                                setGhostPoseLabel(`Checkpoint: ${cp.label}`);
                                setShowGhostPose(true);
                                showToast(`Comparing against ghost "${cp.label}"`);
                              }}
                              className="px-1.5 py-1 text-[10px] font-semibold rounded bg-cyan-900/60 hover:bg-cyan-800 text-cyan-200 border border-cyan-700/50 cursor-pointer"
                              title="Show this checkpoint as 3D Ghost Reference Silhouette"
                            >
                              👻 Ghost
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRestoreCheckpoint(cp)}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-indigo-600/80 hover:bg-indigo-500 text-white cursor-pointer"
                            >
                              Restore
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setCheckpoints((prev) => prev.filter((item) => item.id !== cp.id))
                              }
                              className="p-1 text-red-400 hover:text-red-300 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Shot Variations & Side-by-Side Comparison */}
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div className="text-xs font-bold text-indigo-300 uppercase tracking-wider">
                    Shot Variations & Comparison ({shotVariations.length})
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Shot A — Low Angle Bed"
                      value={variationNameInput}
                      onChange={(e) => setVariationNameInput(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleCreateShotVariation}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shrink-0"
                    >
                      + Shot Variation
                    </button>
                  </div>

                  {shotVariations.length > 0 && (
                    <div className="space-y-1.5">
                      {shotVariations.map((v) => (
                        <div
                          key={v.id}
                          className={`p-2 rounded-lg border flex items-center justify-between gap-2 text-xs ${
                            activeVariationId === v.id
                              ? 'bg-indigo-600/25 border-indigo-400'
                              : 'bg-slate-800/60 border-slate-700/70'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-200 truncate">{v.name}</div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {v.promptSummary.cameraSummary}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setGhostPoseSnapshot(JSON.parse(JSON.stringify(v.config.pose)));
                                setGhostPoseLabel(`Variation: ${v.name}`);
                                setShowGhostPose(true);
                                showToast(`Comparing against ghost "${v.name}"`);
                              }}
                              className="px-1.5 py-1 text-[10px] font-semibold rounded bg-cyan-900/60 hover:bg-cyan-800 text-cyan-200 border border-cyan-700/50 cursor-pointer"
                              title="Show this shot variation as 3D Ghost Reference Silhouette"
                            >
                              👻 Ghost
                            </button>
                            <button
                              type="button"
                              onClick={() => handleActivateShotVariation(v)}
                              className="px-2 py-1 text-[11px] font-semibold rounded bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                            >
                              Activate
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setShotVariations((prev) => prev.filter((item) => item.id !== v.id))
                              }
                              className="p-1 text-red-400 hover:text-red-300 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {shotVariations.length >= 2 && (
                    <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-[11px]">
                      <div className="font-semibold text-slate-200">Compare Two Shot Variations</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={compareVarAId || shotVariations[0].id}
                          onChange={(e) => setCompareVarAId(e.target.value)}
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 text-[11px]"
                        >
                          {shotVariations.map((v) => (
                            <option key={v.id} value={v.id}>
                              A: {v.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={compareVarBId || shotVariations[1].id}
                          onChange={(e) => setCompareVarBId(e.target.value)}
                          className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 text-[11px]"
                        >
                          {shotVariations.map((v) => (
                            <option key={v.id} value={v.id}>
                              B: {v.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {(() => {
                        const varA =
                          shotVariations.find((v) => v.id === compareVarAId) || shotVariations[0];
                        const varB =
                          shotVariations.find((v) => v.id === compareVarBId) || shotVariations[1];
                        const cmp = compareShotVariations(varA, varB);
                        return (
                          <div className="space-y-1 pt-1">
                            <div className="text-[10px] text-indigo-300 font-mono">{cmp.summary}</div>
                            {cmp.differences
                              .filter((d) => d.isDifferent)
                              .map((diff) => (
                                <div
                                  key={diff.fieldLabel}
                                  className="p-1.5 rounded bg-slate-900 border border-slate-800 text-[10px]"
                                >
                                  <div className="font-semibold text-slate-300">{diff.fieldLabel}</div>
                                  <div className="grid grid-cols-2 gap-1 mt-0.5 font-mono">
                                    <span className="text-amber-300 truncate" title={diff.variationAValue}>
                                      A: {diff.variationAValue}
                                    </span>
                                    <span className="text-emerald-300 truncate" title={diff.variationBValue}>
                                      B: {diff.variationBValue}
                                    </span>
                                  </div>
                                </div>
                              ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ============================================================== */}
      {/* GENERATE PROMPT MODAL (T2I & I2I OPTIONS) */}
      {/* ============================================================== */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 bg-black/85">
          <div className="w-full max-w-4xl max-h-[92dvh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex-none px-4 sm:px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-slate-100 truncate">
                    Compiled Prompt Generator
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate">
                    3D Configuration ({camera.yawDeg}° Yaw, {camera.pitchDeg}° Pitch, {pose.basePose.replace(/_/g, ' ')})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPromptModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Option Tabs (T2I vs I2I) */}
            <div className="flex-none px-4 sm:px-5 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-900/60">
              <div className="flex rounded-xl bg-slate-800 p-1 border border-slate-700">
                <button
                  type="button"
                  onClick={() => setPromptTab('t2i')}
                  className={`px-3 sm:px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    promptTab === 't2i'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>Text-to-Image (T2I)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPromptTab('i2i')}
                  className={`px-3 sm:px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    promptTab === 'i2i'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>Image-to-Image (I2I)</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 hidden sm:inline">Target Model:</span>
                <select
                  value={targetModel}
                  onChange={(e) => setTargetModel(e.target.value as TargetModelType)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-200 font-medium focus:outline-none focus:border-indigo-500"
                >
                  <option value="universal">Universal Format</option>
                  <option value="gemini">Gemini Vision</option>
                  <option value="chatgpt">ChatGPT / DALL-E</option>
                  <option value="flux">FLUX.1 / Midjourney</option>
                </select>
              </div>
            </div>

            {/* Modal Content Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 custom-scrollbar">
              {promptTab === 't2i' && (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-900/50 text-indigo-300 text-xs leading-relaxed">
                    <strong>Text-to-Image Specification:</strong> Translates your 3D camera angles, focal length, framing, body orientation, independent limb angles, and facial expressions into photography prompt syntax without inventing unspecified details.
                  </div>

                  <div className="relative">
                    <textarea
                      readOnly
                      rows={10}
                      value={compiledT2IPrompt}
                      className="w-full p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs leading-relaxed resize-none focus:outline-none focus:border-indigo-500 select-all"
                    />
                  </div>
                </div>
              )}

              {promptTab === 'i2i' && (
                <div className="space-y-4">
                  {/* Structured Prompt Summary & Consistency Validation Panel */}
                  <div
                    data-testid="prompt-consistency-checker"
                    className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                          Scene-to-Prompt Consistency Check
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-md border ${
                            promptValidation.overallStatus === 'consistent'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : promptValidation.overallStatus === 'conflict'
                              ? 'bg-red-500/20 text-red-300 border-red-500/40'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          }`}
                        >
                          {promptValidation.overallStatus.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-indigo-300">
                        {resolvedEnvPolicy.modeLabel}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] font-bold text-indigo-300">Pose & Action</div>
                        <div className="text-slate-300 mt-0.5">{structuredPromptSummary.poseSummary}</div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] font-bold text-amber-300">Camera & Framing</div>
                        <div className="text-slate-300 mt-0.5">{structuredPromptSummary.cameraSummary}</div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] font-bold text-sky-300">Gaze & Expression</div>
                        <div className="text-slate-300 mt-0.5">{structuredPromptSummary.gazeSummary}</div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800/80">
                        <div className="text-[10px] font-bold text-emerald-300">
                          Environment & Source Continuity
                        </div>
                        <div className="text-slate-300 mt-0.5">
                          {structuredPromptSummary.environmentSummary}
                        </div>
                      </div>
                    </div>

                    {promptValidation.issues.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {promptValidation.issues.map((issue) => (
                          <div
                            key={issue.id}
                            className={`p-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-xs ${
                              issue.status === 'conflict'
                                ? 'bg-red-950/30 border-red-500/40 text-red-200'
                                : issue.status === 'warning'
                                ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                                : 'bg-slate-900 border-slate-700 text-slate-300'
                            }`}
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="font-semibold">{issue.title}</div>
                              <div className="text-[11px] opacity-90">{issue.message}</div>
                            </div>
                            {issue.actionType && issue.actionLabel && (
                              <button
                                type="button"
                                onClick={() => handleApplyValidationFix(issue.actionType)}
                                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shrink-0 cursor-pointer"
                              >
                                {issue.actionLabel}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                        Transformation Scope
                      </label>
                      <span className="text-[11px] text-slate-400">No image upload needed</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {[
                        { id: 'both', label: 'Both Camera & Pose' },
                        { id: 'camera_only', label: 'Camera Only' },
                        { id: 'pose_only', label: 'Pose Only' },
                        { id: 'custom', label: 'Custom' },
                      ].map((scope) => (
                        <button
                          key={scope.id}
                          type="button"
                          onClick={() => handleScopeChange(scope.id as I2ITransformationScope)}
                          className={`py-2 px-2.5 text-xs font-semibold rounded-lg border transition-all text-center cursor-pointer ${
                            i2iScope === scope.id
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {scope.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Editable Transformation Fields ({i2iFields.filter((f) => !f.isRemoved).length} Active)
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setI2iFields((prev) => syncI2IFieldsWithConfig(prev, fullConfig, i2iScope));
                          showToast('Synced unlocked fields from 3D playboard');
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Update unlocked fields with latest 3D configuration"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Sync from 3D</span>
                      </button>
                    </div>

                    {i2iFields.map((field, idx) => (
                      <div
                        key={field.id}
                        className={`rounded-xl border transition-all ${
                          field.isRemoved
                            ? 'bg-slate-900/40 border-slate-800/50 opacity-60'
                            : 'bg-slate-950/80 border-slate-800 shadow-sm'
                        }`}
                      >
                        <div className="p-3 flex items-center justify-between gap-3 border-b border-slate-800/80">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-200">{field.label}</span>
                              {field.isLocked && (
                                <span className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  LOCKED
                                </span>
                              )}
                              {field.isRemoved && (
                                <span className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-red-500/20 text-red-300 border border-red-500/30">
                                  REMOVED
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">{field.subtitle}</div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveField(idx, 'up')}
                              disabled={idx === 0}
                              className="p-1 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 cursor-pointer"
                              title="Move up"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveField(idx, 'down')}
                              disabled={idx === i2iFields.length - 1}
                              className="p-1 rounded text-slate-400 hover:text-slate-200 disabled:opacity-30 cursor-pointer"
                              title="Move down"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...i2iFields];
                                updated[idx].isLocked = !updated[idx].isLocked;
                                setI2iFields(updated);
                              }}
                              className={`p-1 rounded cursor-pointer ${
                                field.isLocked ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
                              }`}
                              title={field.isLocked ? 'Unlock field' : 'Lock field'}
                            >
                              {field.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...i2iFields];
                                updated[idx].isRemoved = !updated[idx].isRemoved;
                                setI2iFields(updated);
                              }}
                              className={`p-1 rounded cursor-pointer ${
                                field.isRemoved
                                  ? 'text-emerald-400 hover:text-emerald-300'
                                  : 'text-red-400 hover:text-red-300'
                              }`}
                              title={field.isRemoved ? 'Restore field' : 'Remove field'}
                            >
                              {field.isRemoved ? <RefreshCw className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        {!field.isRemoved && (
                          <div className="p-3">
                            <textarea
                              disabled={field.isLocked}
                              rows={2}
                              value={field.userText}
                              onChange={(e) => {
                                const updated = [...i2iFields];
                                updated[idx].userText = e.target.value;
                                setI2iFields(updated);
                              }}
                              className={`w-full p-2 text-xs rounded-lg bg-slate-900 border text-slate-200 font-mono resize-none focus:outline-none ${
                                field.isLocked
                                  ? 'border-amber-900/40 bg-slate-900/60 text-slate-400 cursor-not-allowed'
                                  : 'border-slate-800 focus:border-indigo-500'
                              }`}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-slate-800 pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Live Final Compiled Transformation Prompt
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {compiledI2IPrompt.split(/\s+/).filter(Boolean).length} words
                      </span>
                    </div>
                    <textarea
                      readOnly
                      rows={6}
                      value={compiledI2IPrompt}
                      className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs leading-relaxed resize-none focus:outline-none select-all"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="flex-none px-4 sm:px-5 py-3 border-t border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                Use this prompt with your external image generation tool.
              </span>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleDownloadPrompt}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .txt</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className="px-4 sm:px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer active:scale-95"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied!' : 'Copy Final Prompt'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
