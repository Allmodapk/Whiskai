export interface ImageDataItem {
  id: string;
  data: string; // base64 string without data: prefix
  mimeType: string;
  previewUrl: string; // full data URL for <img>
  label?: string;
  name?: string;
  sizeBytes?: number;
}

export type ComponentKey =
  | 'subject'
  | 'body'
  | 'pose'
  | 'camera'
  | 'framing'
  | 'clothing'
  | 'lighting'
  | 'background'
  | 'environment'
  | 'composition'
  | 'facial_expression'
  | 'hand_gestures'
  | 'leg_gestures';

export const ALL_COMPONENT_KEYS: ComponentKey[] = [
  'subject',
  'body',
  'pose',
  'camera',
  'framing',
  'clothing',
  'lighting',
  'background',
  'environment',
  'composition',
  'facial_expression',
  'hand_gestures',
  'leg_gestures',
];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  subject: 'Subject',
  body: 'Body',
  pose: 'Pose',
  camera: 'Camera',
  framing: 'Framing',
  clothing: 'Clothing',
  lighting: 'Lighting',
  background: 'Background',
  environment: 'Environment',
  composition: 'Composition',
  facial_expression: 'Facial Expression',
  hand_gestures: 'Hand Gestures',
  leg_gestures: 'Leg Gestures',
};

export type ComponentState = 'locked' | 'edited' | 'ignored' | 'unavailable';
export type ComponentSource = 'reference' | 'user_master' | 'user_edit' | 'saved_profile';

export interface DetectedComponent {
  key: ComponentKey;
  label: string;
  detectedText: string;
  userText: string; // current active text when edited or replaced
  state: ComponentState;
  source?: ComponentSource;
  explanation?: string;
  confidence?: 'high' | 'medium' | 'estimated';
  visibility?: 'visible' | 'partial' | 'unavailable';
  selectedProfileId?: string;
  selectedProfileName?: string;
}

export type ToolType = 'general_extractor' | 'subject_swapping' | 'camera_controller';

export interface CameraControlSettings {
  viewpoint: string; // e.g., Front-facing view, Three-quarter view, Side profile, Rear view
  elevation: string; // e.g., Eye-level camera, Low-angle shot, High-angle shot, Overhead shot
  shotSize: string; // e.g., Close-up, Chest-up, Waist-up, Three-quarter-body, Full-body shot
  framing: string; // editable description of framing, margins, headroom, crop
  distance: string; // e.g., Close intimate distance, Medium studio distance, Wide full-room distance
  angleOfView: string; // e.g., Natural normal perspective, Wide-angle expansive view, Telephoto compressed perspective
  preserveComposition: boolean;
  customNotes: string;
}

export type CameraComponentKey =
  | 'aspect_ratio_orientation'
  | 'horizontal_camera_position'
  | 'camera_height'
  | 'vertical_viewing_angle'
  | 'camera_roll'
  | 'lens_and_perspective'
  | 'subject_to_frame_scale'
  | 'framing_and_spatial_arrangement'
  | 'capture_style'
  | 'focus_and_depth_of_field'
  | 'image_rendering_characteristics';

export const ALL_CAMERA_COMPONENT_KEYS: CameraComponentKey[] = [
  'aspect_ratio_orientation',
  'horizontal_camera_position',
  'camera_height',
  'vertical_viewing_angle',
  'camera_roll',
  'lens_and_perspective',
  'subject_to_frame_scale',
  'framing_and_spatial_arrangement',
  'capture_style',
  'focus_and_depth_of_field',
  'image_rendering_characteristics',
];

export const CAMERA_COMPONENT_LABELS: Record<
  CameraComponentKey,
  { code: string; label: string; description: string }
> = {
  aspect_ratio_orientation: {
    code: 'A',
    label: 'Aspect Ratio and Orientation',
    description: 'Portrait, landscape, or square orientation, approximate aspect ratio, and crop geometry.',
  },
  horizontal_camera_position: {
    code: 'B',
    label: 'Horizontal Camera Position',
    description: 'Front, front-left, front-right, three-quarter, side profile, rear three-quarter, or rear view relative to subject.',
  },
  camera_height: {
    code: 'C',
    label: 'Camera Height',
    description: 'Ground-level, low-angle, waist-level, eye-level, elevated, high-angle, or overhead elevation.',
  },
  vertical_viewing_angle: {
    code: 'D',
    label: 'Vertical Viewing Angle',
    description: 'Upward, horizontal, downward, or directly overhead camera tilt (distinguished from elevation).',
  },
  camera_roll: {
    code: 'E',
    label: 'Camera Roll',
    description: 'Level optical axis vs. rotated Dutch angle or horizon tilt.',
  },
  lens_and_perspective: {
    code: 'F',
    label: 'Lens and Perspective',
    description: 'Perspective distortion, near-to-far size relationships, compression, depth, and supported focal-length characteristics.',
  },
  subject_to_frame_scale: {
    code: 'G',
    label: 'Subject-to-Frame Scale',
    description: 'Subject proportion of the frame, headroom, footroom, side margins, and crop boundaries.',
  },
  framing_and_spatial_arrangement: {
    code: 'H',
    label: 'Framing and Spatial Arrangement',
    description: 'Shot size, subject placement, foreground/background, negative space, frame cutoffs, and spatial relationships.',
  },
  capture_style: {
    code: 'I',
    label: 'Capture Style',
    description: 'Apparent photographic style (e.g., casual smartphone, candid snapshot, editorial, studio, documentary) and supporting visual traits.',
  },
  focus_and_depth_of_field: {
    code: 'J',
    label: 'Focus and Depth of Field',
    description: 'Apparent focus target, subject sharpness, foreground/background blur, and focus falloff.',
  },
  image_rendering_characteristics: {
    code: 'K',
    label: 'Image Rendering Characteristics',
    description: 'Sharpness, motion blur, grain/noise, highlight rendering, shadow detail, and visible photographic rendering.',
  },
};

export interface CameraExtractedComponent {
  key: CameraComponentKey;
  code: string;
  label: string;
  detectedText: string;
  userText: string;
  state: ComponentState;
  explanation?: string;
  visibility?: 'visible' | 'partial' | 'unavailable';
}

export type GazeBehaviorType =
  | 'look_at_camera'
  | 'keep_original_gaze'
  | 'match_reference_gaze'
  | 'look_away'
  | 'none'
  | 'custom';

export interface CameraReferenceAnalysisState {
  summary: string;
  outputRatio: string;
  orientation: string;
  subjectPresentInReference: boolean;
  detectedReferenceGaze: string;
  originalComponents: Record<CameraComponentKey, CameraExtractedComponent>;
  components: Record<CameraComponentKey, CameraExtractedComponent>;
  gazeBehavior: GazeBehaviorType;
  customGazeText: string;
  preserveSubjectIdentity: boolean;
  preserveOriginalClothing: boolean;
  preserveOriginalScene: boolean;
  preserveOriginalPoseStructure: boolean;
  additionalTransformationNotes: string;
}

export interface ScanAnalysisResult {
  components: Record<ComponentKey, DetectedComponent>;
  outputRatio: string;
  ratioExplanation?: string;
  detectedSummary?: string;
  cameraEstimates?: Partial<CameraControlSettings>;
  rawResponse?: string;
}

export interface SubjectProfile {
  id: string;
  name: string;
  masterSubject: string;
  masterBody: string;
  tags?: string[];
  thumbnailUrl?: string;
  referenceImageIds?: string[]; // Stored in IndexedDB
  createdAt: number;
  updatedAt: number;
}

export interface MasterOutfit {
  id: string;
  name: string;
  description: string; // comprehensive prompt-ready description
  garmentType?: string;
  colors?: string;
  materials?: string;
  fit?: string;
  sleeves?: string;
  neckline?: string;
  accessories?: string;
  footwear?: string;
  thumbnailUrl?: string;
  imageId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BackgroundProfile {
  id: string;
  name: string;
  background: string;
  environment: string;
  lighting: string;
  tags?: string[];
  thumbnailUrl?: string;
  imageId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedComponentItem {
  id: string;
  componentKey: ComponentKey | CameraComponentKey;
  name: string;
  description: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export type TargetModelType = 'universal' | 'gemini' | 'chatgpt' | 'flux';

export type PromptMode = 'replace_subject' | 'replace_subject_outfit' | 'reference_control';

export type AuthoritySource =
  | 'MASTER_PERSONA'
  | 'MASTER_OUTFIT'
  | 'REFERENCE'
  | 'USER_EDIT'
  | 'IGNORED'
  | 'UNAVAILABLE';

export type ComponentAuthorityMap = Record<ComponentKey, AuthoritySource>;

export interface ReferenceBlueprint {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  toolType?: ToolType;
  referenceThumbnails: string[];
  referenceImageIds?: string[]; // IndexedDB image keys
  subjectProfileId?: string;
  masterSubject: string;
  masterBody: string;
  outfitId?: string;
  masterOutfit?: MasterOutfit;
  backgroundProfileId?: string;
  promptMode?: PromptMode;
  authorityMap?: ComponentAuthorityMap;
  originalComponents?: Record<ComponentKey, DetectedComponent>; // Immutable snapshot of original scan
  components: Record<ComponentKey, DetectedComponent>; // Current working state with user modifications
  cameraSettings?: CameraControlSettings;
  cameraReferenceState?: CameraReferenceAnalysisState;
  outputRatio: string;
  finalPrompt: string;
  negativePrompt?: string;
  targetModel: TargetModelType;
}

export interface PromptSafetyCheck {
  hasIssues: boolean;
  score: 'clean' | 'advisory' | 'attention';
  notices: {
    category: string;
    originalPhrase: string;
    suggestedPhrase: string;
    explanation: string;
  }[];
}

