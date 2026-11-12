import type { TargetModelType } from '../../types';

/**
 * COORDINATE SYSTEM SPECIFICATION (Right-Handed, Y-Up)
 * ----------------------------------------------------
 * - Origin (0, 0, 0): Floor center directly beneath the fixed reference subject's feet.
 * - +X axis: Subject's left (camera-right when viewing the front of the subject).
 * - +Y axis: Vertical up (floor is y = 0; standing eye level is ~1.58m; crown is ~1.72m).
 * - +Z axis: Subject's forward-facing direction (front of the fixed mannequin).
 *
 * CAMERA ANGLES & SPHERICAL CONVENTION (Relative to Target Look-At)
 * - azimuthDeg (-180 to +180): Horizontal orbit angle around the subject.
 *     0°    = Directly in front of the subject (+Z)
 *    +90°   = To the subject's left / camera-right side (+X)
 *    -90°   = To the subject's right / camera-left side (-X)
 *    ±180°  = Directly behind the subject (-Z)
 * - elevationDeg (-65 to +85): Vertical angle of the camera vector from target toward camera.
 *     0°    = Level with the look-at target (horizontal)
 *    +deg   = Camera is raised above the target (high-angle / looking down)
 *    -deg   = Camera is lowered below the target (low-angle / looking up)
 * - pitchDeg (-85 to +65): Optical tilt angle of the lens (= -elevationDeg).
 *    Negative pitch = lens tilted downward; Positive pitch = lens tilted upward.
 * - rollDeg (-45 to +45): Rotation around the camera's forward optical Z axis (Dutch tilt).
 *     +deg = clockwise roll of the camera view (horizon tilts counter-clockwise).
 */

export type AspectRatioOption = '3:4' | '4:5' | '2:3' | '1:1' | '4:3' | '16:9' | '9:16';

export type ShotSizeLabel =
  | 'Extreme Close-Up (ECU)'
  | 'Close-Up (CU)'
  | 'Medium Close-Up (MCU)'
  | 'Waist-Up Medium Shot'
  | 'Three-Quarter Shot'
  | 'Full-Body Shot'
  | 'Wide Environmental Shot';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface SubjectFrameBounds {
  minNdcX: number;
  maxNdcX: number;
  minNdcY: number;
  maxNdcY: number;
  widthPct: number;
  heightPct: number;
  centerNdcX: number;
  centerNdcY: number;
  placementLabel: string;
  visibleLandmarks: string[];
  croppedEdges: Array<'top' | 'bottom' | 'left' | 'right'>;
}

export interface CameraStateSnapshot {
  azimuthDeg: number;
  azimuthLabel: string;
  elevationDeg: number;
  elevationLabel: string;
  pitchDeg: number;
  distanceMeters: number;
  worldPosition: Vec3;
  targetPosition: Vec3;
  rollDeg: number;
  fovDeg: number;
  focalLengthMm: number;
  lensCategoryLabel: string;
  aspectRatio: AspectRatioOption;
  aspectRatioNumeric: number;
  viewportDimensions: ViewportDimensions;
  shotSize: ShotSizeLabel;
  subjectBounds: SubjectFrameBounds;
  projectionType: 'perspective';
  capturedAt: number;
}

export interface LockedCameraFrame {
  isLocked: true;
  lockedAt: number;
  cameraState: CameraStateSnapshot;
}

export interface CameraPresetSpec {
  id: string;
  label: string;
  description: string;
  azimuthDeg: number;
  elevationDeg: number;
  distanceMeters: number;
  focalLengthMm: number;
  targetOffset: Vec3;
  rollDeg: number;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface InferredNumericEstimate {
  value: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
  confidence: ConfidenceLevel;
  note: string;
}

export interface SourceObservableFacts {
  subjectDescription: string;
  poseAndOrientation: string;
  headAndGaze: string;
  expressionAndFeatures: string;
  clothingAndAccessories: string;
  environmentAndBackground: string;
  lightingAndShadows: string;
  aspectRatioDetected: string;
  framingDescription: string;
}

export interface SourceInferredCamera {
  azimuthDeg: InferredNumericEstimate;
  elevationDeg: InferredNumericEstimate;
  distanceLabel: string;
  distanceConfidence: ConfidenceLevel;
  focalLengthMm: InferredNumericEstimate;
  perspectiveCharacter: string;
  shotSize: string;
  shotSizeConfidence: ConfidenceLevel;
  subjectPlacement: string;
  subjectScalePct: number | null;
  summary: string;
}

export interface SourceImageAnalysis {
  analyzedAt: number;
  imageName: string;
  isFallbackEstimate: boolean;
  warningMessage?: string;
  observable: SourceObservableFacts;
  inferredCamera: SourceInferredCamera;
  mustNotChange: string[];
  occlusionNotes: string[];
  userConfirmedEdits: boolean;
}

export interface PreservationPreferences {
  preserveIdentityAndFace: boolean;
  preserveHairAndFeatures: boolean;
  preserveClothingAndAccessories: boolean;
  preserveBodyProportions: boolean;
  preservePoseAndOrientation: boolean;
  preserveExpression: boolean;
  preserveEnvironmentAndLighting: boolean;
  preserveColorsAndTextures: boolean;
  // Intentional conflict-test / explicit constraints
  requirePixelIdenticalComposition: boolean;
  requireFullBodyVisibleInOutput: boolean;
  requireFrontDetailsDirectlyVisible: boolean;
  additionalUserNotes: string;
}

export interface CameraVariableDelta {
  variable: string;
  sourceValue: string;
  targetValue: string;
  changed: boolean;
  magnitudeLabel: string;
  spatialMeaning: string;
}

export interface CameraDeltaComparison {
  mode: 'image_aware' | 'camera_first';
  deltas: CameraVariableDelta[];
  changedVariables: string[];
  unchangedVariables: string[];
  coupledVisualEffects: string[];
  hiddenDetailImplications: string[];
}

export interface ContradictionIssue {
  id: string;
  severity: 'error' | 'warning';
  title: string;
  explanation: string;
  suggestedResolution: string;
  resolutionActionId?:
    | 'disable_pixel_identical'
    | 'disable_full_body_lock'
    | 'disable_front_visibility_lock'
    | 'unlock_to_adjust';
}

export interface ContradictionCheckResult {
  hasErrors: boolean;
  hasWarnings: boolean;
  issues: ContradictionIssue[];
}

export interface CompiledPerspectivePrompt {
  mode: 'image_aware' | 'camera_first';
  targetModel: TargetModelType;
  lockedAt: number;
  sections: {
    taskObjective: string;
    sourceImageUnderstanding: string;
    originalCameraPerspective: string;
    targetCameraPerspective: string;
    requiredCameraTransformation: string;
    elementsUnchanged: string;
    visualConsistencyRequirements: string;
    hiddenOrUnseenDetails: string;
    finalOutputRequirements: string;
  };
  fullText: string;
  exportedText: string;
  comparison: CameraDeltaComparison;
}

export const COORDINATE_SYSTEM_DOCS: Record<string, string> = {
  azimuthDeg:
    'Horizontal orbit angle around the fixed subject at (0,0,0). 0° = front (+Z), +90° = camera-right (+X / subject left), -90° = camera-left (-X / subject right), ±180° = rear (-Z).',
  elevationDeg:
    'Vertical camera angle relative to horizontal at the look-at target. 0° = level with target, positive (+) = high angle above looking down, negative (-) = low angle below looking up.',
  pitchDeg:
    'Optical vertical tilt of the camera lens (-elevationDeg). Negative = tilted downward, positive = tilted upward.',
  distanceMeters:
    'Euclidean 3D distance in meters from the virtual camera position to the look-at target point.',
  worldPosition:
    'Camera (x, y, z) coordinates in right-handed Y-up meters relative to the subject floor center (0, 0, 0).',
  targetPosition:
    'Look-at pivot point (x, y, z) in world meters that the virtual camera aims toward.',
  rollDeg:
    'Camera Dutch tilt rotation around its optical forward axis in degrees (-45° to +45°).',
  focalLengthMm:
    '35mm full-frame equivalent focal length derived deterministically from vertical FOV via 24mm sensor height.',
  fovDeg: 'Vertical field of view of the Three.js PerspectiveCamera in degrees.',
  aspectRatio:
    'Locked viewport frame aspect ratio (width : height) used during camera composition.',
  viewportDimensions:
    'Rendered viewport pixel dimensions (width × height) at the moment the camera state was read.',
  shotSize:
    'Framing classification derived deterministically from projected 3D subject height and visible landmarks in the viewport.',
  subjectBounds:
    'Projected normalized viewport coordinates and scale (%) of the fixed 3D subject inside the active camera frame.',
  projectionType:
    'Optical projection model used by the Three.js camera ("perspective").',
};
