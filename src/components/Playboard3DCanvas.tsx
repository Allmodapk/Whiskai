import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  Camera3DSettings,
  CharacterPose3DSettings,
  PlayboardEnvironment,
  PlayboardLightingPreset,
  PlayboardInteractiveHandleId,
  PlayboardSupportSurfaceId,
  SceneInteractionPresetId,
  PosePreset,
  LensFocalLength,
  FocusDof,
  HandGesture,
  GazeDirection,
  FacialExpression,
  PlayboardVisualGuidesConfig,
} from '../types/cameraPlayboard';
import {
  ThirdPersonLocomotionState,
  createInitialLocomotionState,
  stepThirdPersonLocomotion,
  normalizeJoystickInput,
  normalizeTurnJoystickInput,
  dampAngleRad,
  normalizeAngleRad,
  shortestAngleDiffRad,
  PlayboardCameraMode,
  FreeOrbitCameraState,
  convertCameraPoseToFreeOrbitState,
  evaluateFreeOrbitCameraPosition,
  convertFreeOrbitToThirdPersonOrientation,
  panFreeOrbitTarget,
} from '../services/thirdPersonLocomotion';
import {
  analyzePlayboardFraming,
  computePlayboardCameraTransform,
  computePlayboardVisualGuidesGeometry,
  getEffectiveVerticalFovDeg,
  parseOutputAspectRatio,
  resolveSemanticCharacterRigPose,
  getHandGestureTargets,
  applySurfaceContactIKToRigPose,
  createPoseTransitionState,
  getPosePresetTransitionSignature,
  stepPoseTransition,
  PoseTransitionState,
  createSecondaryMotionState,
  stepSecondaryMotionAndGaze,
  SecondaryMotionState,
  querySupportSurfaceAt,
  STUDIO_BEDROOM_SUPPORT_SURFACES,
  CANONICAL_POSE_PRESET_VALUES,
  PELVIS_SEATED_GLUTE_CLEARANCE_M,
  PELVIS_LYING_BACK_CLEARANCE_M,
} from '../services/framingAnalyzer';
import {
  SCENE_INTERACTION_PRESETS,
  SceneInteractionPreset,
  getInteractionPresetById,
  clampPosePlacementToSupportBounds,
  inferActiveSupportSurface,
} from '../services/sceneInteractionPresets';
import {
  FURNITURE_ANCHOR_HOTSPOTS,
  FurnitureAnchorHotspot,
  evaluateMagneticAnchorSnap,
} from '../services/poseKinematicsEngine';

export const DEFAULT_VISUAL_GUIDES: PlayboardVisualGuidesConfig = {
  groundGrid: false,
  worldAxes: false,
  subjectOriginAndFacing: false,
  movementDirection: true,
  cameraGizmoAndTarget: false,
  headAndGazeVectors: false,
  ruleOfThirdsOverlay: false,
  safeFramingGuides: false,
};

interface Playboard3DCanvasProps {
  cameraSettings: Camera3DSettings;
  poseSettings: CharacterPose3DSettings;
  environment: PlayboardEnvironment;
  onCameraChange: (updates: Partial<Camera3DSettings>) => void;
  onPoseChange?: (updates: Partial<CharacterPose3DSettings>) => void;
  onCharacterTransformChange?: (updates: {
    characterYawDeg: number;
    characterPosX: number;
    characterPosZ: number;
  }) => void;
  showJoysticks?: boolean;
  animationPaused?: boolean;
  onToggleAnimationPause?: () => void;
  ikEnabled?: boolean;
  customGlbUrl?: string | null;
  visualGuides?: PlayboardVisualGuidesConfig;
  onVisualGuidesChange?: (updates: Partial<PlayboardVisualGuidesConfig>) => void;
  lightingPreset?: PlayboardLightingPreset;
  onLightingPresetChange?: (preset: PlayboardLightingPreset) => void;
  instantPoseTransitions?: boolean;
  onToggleInstantPoseTransitions?: () => void;
  onSelectSceneInteractionPreset?: (preset: SceneInteractionPreset) => void;
  ghostPoseSettings?: CharacterPose3DSettings | null;
  ghostLabel?: string | null;
  showGhostPose?: boolean;
  ghostOpacity?: number;
  onToggleGhostPose?: () => void;
  onGhostOpacityChange?: (opacity: number) => void;
  onCaptureGhostReference?: () => void;
}

const FOCAL_TO_FOV: Record<LensFocalLength, number> = {
  '16mm_ultra_wide': 95,
  '24mm_wide': 84,
  '35mm_moderate_wide': 63,
  '50mm_standard_normal': 47,
  '85mm_portrait_telephoto': 28,
  '135mm_telephoto': 18,
};

/**
 * Computes physically calibrated BokehPass parameters (aperture & maxblur) from
 * the Playboard's lens focal length and focusDof aperture setting.
 */
export function computeOpticalBokehParams(
  focalLength: LensFocalLength,
  focusDof: FocusDof,
  focusDistanceM: number
): {
  focus: number;
  focusDistance: number;
  aperture: number;
  maxblur: number;
  maxBlur: number;
} {
  const focalFactorMap: Record<LensFocalLength, number> = {
    '16mm_ultra_wide': 0.42,
    '24mm_wide': 0.58,
    '35mm_moderate_wide': 0.78,
    '50mm_standard_normal': 1.0,
    '85mm_portrait_telephoto': 1.48,
    '135mm_telephoto': 1.92,
  };
  const dofBaseMap: Record<FocusDof, { aperture: number; maxblur: number }> = {
    shallow_f1_4: { aperture: 0.00018, maxblur: 0.0046 },
    moderate_f4_0: { aperture: 0.000075, maxblur: 0.0022 },
    deep_f11: { aperture: 0, maxblur: 0 },
  };
  const focalFactor = focalFactorMap[focalLength] ?? 1.0;
  const dofBase = dofBaseMap[focusDof] ?? dofBaseMap.moderate_f4_0;
  const clampedFocus = Math.max(0.45, Math.min(9.5, focusDistanceM));
  const computedAperture = Number((dofBase.aperture * focalFactor).toFixed(6));
  const computedMaxBlur =
    dofBase.maxblur === 0
      ? 0
      : Number(Math.min(0.0068, dofBase.maxblur * (0.75 + focalFactor * 0.25)).toFixed(5));
  return {
    focus: clampedFocus,
    focusDistance: clampedFocus,
    aperture: computedAperture,
    maxblur: computedMaxBlur,
    maxBlur: computedMaxBlur,
  };
}

// Reusable math objects outside render loop (Zero GC)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _camTarget = new THREE.Vector3(0, 1.05, 0);
const _pipCamTarget = new THREE.Vector3(0, 1.05, 0);
const _eyeWorldPos = new THREE.Vector3();
const _eyeToCamLocal = new THREE.Vector3();
const _headWorldQuatInv = new THREE.Quaternion();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _planeIntersect = new THREE.Vector3();
const _ankleWorldL = new THREE.Vector3();
const _ankleWorldR = new THREE.Vector3();

interface FingerRig {
  proximal: THREE.Bone;
  distal: THREE.Bone;
}

interface HandRig {
  wrist: THREE.Bone;
  palm: THREE.Group;
  thumb: FingerRig;
  index: FingerRig;
  middle: FingerRig;
  ring: FingerRig;
  pinky: FingerRig;
}

interface ArmRig {
  clavicle: THREE.Bone;
  shoulder: THREE.Bone;
  elbow: THREE.Bone;
  hand: HandRig;
}

interface LegRig {
  hip: THREE.Bone;
  knee: THREE.Bone;
  ankle: THREE.Bone;
  toe: THREE.Bone;
}

interface StylizedHumanRig {
  root: THREE.Group;
  skeleton: THREE.Skeleton;
  pelvis: THREE.Bone;
  spine: THREE.Bone;
  chest: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  leftArm: ArmRig;
  rightArm: ArmRig;
  leftLeg: LegRig;
  rightLeg: LegRig;
  // Facial rig nodes
  leftEye: THREE.Group;
  rightEye: THREE.Group;
  leftPupil: THREE.Mesh;
  rightPupil: THREE.Mesh;
  leftEyelid: THREE.Mesh;
  rightEyelid: THREE.Mesh;
  leftBrow: THREE.Mesh;
  rightBrow: THREE.Mesh;
  mouthGroup: THREE.Group;
  upperLip: THREE.Mesh;
  lowerLip: THREE.Mesh;
  contactShadow: THREE.Mesh;
  cushionIndentMesh: THREE.Mesh;
  leftFootShadow: THREE.Mesh;
  rightFootShadow: THREE.Mesh;
}

interface LightingRigRefs {
  hemiLight: THREE.HemisphereLight;
  keyLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  deskLampLight: THREE.PointLight;
  windowAreaLight: THREE.RectAreaLight | null;
  ceilingSoftboxLight: THREE.RectAreaLight | null;
  windowGoboMat: THREE.MeshBasicMaterial | null;
  skyPanes: THREE.MeshBasicMaterial[];
  stringBulbMaterials: THREE.MeshStandardMaterial[];
}

export const Playboard3DCanvas: React.FC<Playboard3DCanvasProps> = ({
  cameraSettings,
  poseSettings,
  environment,
  onCameraChange,
  onPoseChange,
  onCharacterTransformChange,
  showJoysticks = true,
  animationPaused = false,
  onToggleAnimationPause,
  ikEnabled = true,
  customGlbUrl = null,
  visualGuides,
  onVisualGuidesChange,
  lightingPreset,
  onLightingPresetChange,
  instantPoseTransitions,
  onToggleInstantPoseTransitions,
  onSelectSceneInteractionPreset,
  ghostPoseSettings,
  ghostLabel,
  showGhostPose,
  ghostOpacity,
  onToggleGhostPose,
  onGhostOpacityChange,
  onCaptureGhostReference,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rigRef = useRef<StylizedHumanRig | null>(null);
  const ghostRigRef = useRef<StylizedHumanRig | null>(null);
  const customModelGroupRef = useRef<THREE.Group | null>(null);
  const gltfMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const lightingRigRef = useRef<LightingRigRefs | null>(null);

  const bedroomGroupRef = useRef<THREE.Group | null>(null);
  const minimalGroupRef = useRef<THREE.Group | null>(null);
  const cyberGroupRef = useRef<THREE.Group | null>(null);
  const moveKnobRef = useRef<HTMLDivElement>(null);
  const lookKnobRef = useRef<HTMLDivElement>(null);

  const [selectedJointBadge, setSelectedJointBadge] = useState<string | null>(null);
  const [internalGuides, setInternalGuides] = useState<PlayboardVisualGuidesConfig>(DEFAULT_VISUAL_GUIDES);
  const [showGuidesMenu, setShowGuidesMenu] = useState(false);
  const [internalLighting, setInternalLighting] = useState<PlayboardLightingPreset>('daylight_warm');
  const [internalInstantPose, setInternalInstantPose] = useState(false);
  const [showDirectHandles, setShowDirectHandles] = useState(false);
  const [studioRealismMode, setStudioRealismMode] = useState(true);
  const [isFreeOrbitView, setIsFreeOrbitView] = useState(false);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<PlayboardSupportSurfaceId | null>(null);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [hoveredHotspotLabel, setHoveredHotspotLabel] = useState<string | null>(null);
  const [showFurnitureHotspots, setShowFurnitureHotspots] = useState(true);
  const [showShotPreviewPip, setShowShotPreviewPip] = useState(false);
  const [pinShotCamera, setPinShotCamera] = useState(true);
  const [pipLargeSize, setPipLargeSize] = useState(false);
  const [pipThirdsGrid, setPipThirdsGrid] = useState(true);
  const [walkGaitOnMove, setWalkGaitOnMove] = useState(false);
  const [internalShowGhost, setInternalShowGhost] = useState(false);
  const [internalGhostOpacity, setInternalGhostOpacity] = useState(0.32);
  const [internalGhostPose, setInternalGhostPose] = useState<CharacterPose3DSettings | null>(null);
  const [viewportDimensions, setViewportDimensions] = useState({ width: 800, height: 600 });

  const effectiveLighting = lightingPreset || internalLighting;
  const effectiveLightingRef = useRef<PlayboardLightingPreset>(effectiveLighting);
  effectiveLightingRef.current = effectiveLighting;
  const studioRealismModeRef = useRef<boolean>(studioRealismMode);
  studioRealismModeRef.current = studioRealismMode;
  const effectiveInstantTransitions = instantPoseTransitions ?? internalInstantPose;
  const effectiveShowGhost = showGhostPose ?? internalShowGhost;
  const effectiveGhostOpacity = ghostOpacity ?? internalGhostOpacity;
  const effectiveGhostPose = ghostPoseSettings ?? internalGhostPose;
  const effectiveGhostLabel = ghostLabel || (internalGhostPose ? 'Captured Reference Pose' : 'Reference Pose');
  const isPipActive = isFreeOrbitView || showShotPreviewPip;
  const activeCameraMode: PlayboardCameraMode = isFreeOrbitView ? 'free_orbit' : 'third_person';

  const effectiveGuides = visualGuides || internalGuides;
  const visualGuidesRef = useRef<PlayboardVisualGuidesConfig>(effectiveGuides);
  visualGuidesRef.current = effectiveGuides;

  const showDirectHandlesRef = useRef(showDirectHandles);
  showDirectHandlesRef.current = showDirectHandles;

  const isFreeOrbitViewRef = useRef(isFreeOrbitView);
  isFreeOrbitViewRef.current = isFreeOrbitView;

  const pinShotCameraRef = useRef(pinShotCamera);
  pinShotCameraRef.current = pinShotCamera;

  const walkGaitOnMoveRef = useRef(walkGaitOnMove);
  walkGaitOnMoveRef.current = walkGaitOnMove;

  const showFurnitureHotspotsRef = useRef(showFurnitureHotspots);
  showFurnitureHotspotsRef.current = showFurnitureHotspots;

  const selectedHotspotIdRef = useRef<string | null>(selectedHotspotId);
  selectedHotspotIdRef.current = selectedHotspotId;

  const hoveredHotspotIdRef = useRef<string | null>(null);

  const isPipActiveRef = useRef(isPipActive);
  isPipActiveRef.current = isPipActive;

  const showGhostPoseRef = useRef(effectiveShowGhost);
  showGhostPoseRef.current = effectiveShowGhost;

  const ghostOpacityRef = useRef(effectiveGhostOpacity);
  ghostOpacityRef.current = effectiveGhostOpacity;

  const ghostPoseRef = useRef<CharacterPose3DSettings | null>(effectiveGhostPose);
  ghostPoseRef.current = effectiveGhostPose;

  // Compute exact Picture-in-Picture (PiP) Shot Camera rectangle in CSS pixels
  const pipRect = useMemo(() => {
    const aspect = parseOutputAspectRatio(cameraSettings.outputRatio).numericAspect;
    const maxBase = pipLargeSize ? 210 : 152;
    let w = maxBase;
    let h = Math.round(maxBase / aspect);
    if (h > maxBase * 1.35) {
      h = Math.round(maxBase * 1.35);
      w = Math.round(h * aspect);
    }
    w = Math.max(96, Math.min(w, Math.floor(viewportDimensions.width * 0.42)));
    h = Math.max(84, Math.min(h, Math.floor(viewportDimensions.height * 0.42)));
    const rightMargin = 12;
    const bottomMargin = showJoysticks ? 156 : 52;
    const left = Math.max(8, viewportDimensions.width - w - rightMargin);
    const top = Math.max(8, viewportDimensions.height - h - bottomMargin);
    return {
      width: w,
      height: h,
      right: rightMargin,
      bottom: bottomMargin,
      left,
      top,
    };
  }, [
    cameraSettings.outputRatio,
    cameraSettings.orientation,
    pipLargeSize,
    viewportDimensions.width,
    viewportDimensions.height,
    showJoysticks,
  ]);
  const pipRectRef = useRef(pipRect);
  pipRectRef.current = pipRect;

  const freeOrbitStateRef = useRef<FreeOrbitCameraState>({
    yaw: 0,
    pitch: 0.14,
    dist: 2.8,
    targetX: 0,
    targetY: 1.0,
    targetZ: 0,
    currYaw: 0,
    currPitch: 0.14,
    currDist: 2.8,
    currTargetX: 0,
    currTargetY: 1.0,
    currTargetZ: 0,
  });

  // Tracks the live main camera look-at target on every frame for seamless mode conversion
  const activeLookTargetRef = useRef(new THREE.Vector3(0, 1.0, 0));
  // Smoothly decays any positional/target delta when switching from Free Orbit back to Third Person
  const tpTransitionCamOffsetRef = useRef(new THREE.Vector3(0, 0, 0));
  const tpTransitionLookOffsetRef = useRef(new THREE.Vector3(0, 0, 0));

  // Independent pinned Shot Camera state for PiP preview
  const pinnedShotCameraRef = useRef({
    yawDeg: cameraSettings.yawDeg,
    pitchDeg: cameraSettings.pitchDeg,
    distance: cameraSettings.distance,
    height: cameraSettings.height,
    rollDeg: cameraSettings.rollDeg,
  });

  const selectedSurfaceIdRef = useRef<PlayboardSupportSurfaceId | null>(selectedSurfaceId);
  selectedSurfaceIdRef.current = selectedSurfaceId;

  const environmentRef = useRef<PlayboardEnvironment>(environment);
  environmentRef.current = environment;

  const instantTransitionsRef = useRef<boolean>(effectiveInstantTransitions);
  instantTransitionsRef.current = effectiveInstantTransitions;

  const handleToggleGuide = (key: keyof PlayboardVisualGuidesConfig) => {
    const nextVal = !effectiveGuides[key];
    if (onVisualGuidesChange) {
      onVisualGuidesChange({ [key]: nextVal });
    } else {
      setInternalGuides((prev) => ({ ...prev, [key]: nextVal }));
    }
  };

  const handleChangeLighting = (preset: PlayboardLightingPreset) => {
    if (onLightingPresetChange) {
      onLightingPresetChange(preset);
    } else {
      setInternalLighting(preset);
    }
  };

  const handleToggleInstantPose = () => {
    if (onToggleInstantPoseTransitions) {
      onToggleInstantPoseTransitions();
    } else {
      setInternalInstantPose((v) => !v);
    }
  };

  const handleToggleGhost = () => {
    if (onToggleGhostPose) {
      onToggleGhostPose();
    } else {
      if (!internalShowGhost && !internalGhostPose) {
        setInternalGhostPose({ ...poseStateRef.current });
      }
      setInternalShowGhost((v) => !v);
    }
  };

  const handleCaptureGhost = () => {
    if (onCaptureGhostReference) {
      onCaptureGhostReference();
    } else {
      setInternalGhostPose({ ...poseStateRef.current });
      setInternalShowGhost(true);
    }
  };

  const handleGhostOpacity = (val: number) => {
    if (onGhostOpacityChange) {
      onGhostOpacityChange(val);
    } else {
      setInternalGhostOpacity(val);
    }
  };

  const onSelectSceneInteractionPresetRef = useRef(onSelectSceneInteractionPreset);
  onSelectSceneInteractionPresetRef.current = onSelectSceneInteractionPreset;

  const activateHotspotAnchor = (hotspot: FurnitureAnchorHotspot) => {
    setSelectedHotspotId(hotspot.id);
    setSelectedSurfaceId(hotspot.surfaceId as PlayboardSupportSurfaceId);
    if (hotspot.defaultInteractionPresetId) {
      const preset = getInteractionPresetById(hotspot.defaultInteractionPresetId);
      if (preset && onSelectSceneInteractionPresetRef.current) {
        onSelectSceneInteractionPresetRef.current(preset);
        return;
      }
    }
    // Fallback for surfaces without a named interactionPresetId (e.g. Window Seat Bench or Center Rug)
    const canon =
      CANONICAL_POSE_PRESET_VALUES[hotspot.defaultPose] ||
      CANONICAL_POSE_PRESET_VALUES.natural_standing;
    const isSeated = hotspot.defaultPose === 'casual_sitting';
    const isLying =
      hotspot.defaultPose === 'reclined_lying' || hotspot.defaultPose === 'side_lying_open';
    const seatHeightY =
      hotspot.topY > 0.15
        ? Number(
            (
              hotspot.topY +
              (isSeated
                ? PELVIS_SEATED_GLUTE_CLEARANCE_M
                : isLying
                ? PELVIS_LYING_BACK_CLEARANCE_M
                : 0)
            ).toFixed(3)
          )
        : null;
    playerPosRef.current.x = hotspot.x;
    playerPosRef.current.z = hotspot.z;
    playerPosRef.current.rot = THREE.MathUtils.degToRad(hotspot.facingDeg);
    playerPosRef.current.targetRot = playerPosRef.current.rot;
    onCharacterTransformChangeRef.current?.({
      characterPosX: hotspot.x,
      characterPosZ: hotspot.z,
      characterYawDeg: hotspot.facingDeg,
    });
    onPoseChangeRef.current?.({
      ...canon,
      basePose: hotspot.defaultPose,
      interactionPresetId: null,
      seatHeightY,
      characterPosX: hotspot.x,
      characterPosZ: hotspot.z,
      characterYawDeg: hotspot.facingDeg,
    });
  };
  const activateHotspotAnchorRef = useRef(activateHotspotAnchor);
  activateHotspotAnchorRef.current = activateHotspotAnchor;

  // Target and smoothed camera state refs
  const camTargetStateRef = useRef({
    yaw: THREE.MathUtils.degToRad(cameraSettings.yawDeg),
    pitch: THREE.MathUtils.degToRad(cameraSettings.pitchDeg),
    dist: cameraSettings.distance,
    height: cameraSettings.height,
    roll: THREE.MathUtils.degToRad(cameraSettings.rollDeg),
  });

  const camCurrentStateRef = useRef({
    yaw: THREE.MathUtils.degToRad(cameraSettings.yawDeg),
    pitch: THREE.MathUtils.degToRad(cameraSettings.pitchDeg),
    dist: cameraSettings.distance,
    height: cameraSettings.height,
    roll: THREE.MathUtils.degToRad(cameraSettings.rollDeg),
  });

  const camSettingsRef = useRef(cameraSettings);
  camSettingsRef.current = cameraSettings;

  const poseStateRef = useRef(poseSettings);
  poseStateRef.current = poseSettings;

  const liveFramingAnalysis = useMemo(
    () => analyzePlayboardFraming(cameraSettings, poseSettings),
    [cameraSettings, poseSettings]
  );

  const animPausedRef = useRef(animationPaused);
  animPausedRef.current = animationPaused;

  const ikEnabledRef = useRef(ikEnabled);
  ikEnabledRef.current = ikEnabled;

  const showJoysticksRef = useRef(showJoysticks);
  showJoysticksRef.current = showJoysticks;

  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;

  const onPoseChangeRef = useRef(onPoseChange);
  onPoseChangeRef.current = onPoseChange;

  const onCharacterTransformChangeRef = useRef(onCharacterTransformChange);
  onCharacterTransformChangeRef.current = onCharacterTransformChange;

  // Joystick, Turn Buttons, UI Pointer Ownership & Keyboard state refs
  const moveStickRef = useRef({ x: 0, y: 0 });
  const lookStickRef = useRef({ x: 0, y: 0 });
  const charTurnInputRef = useRef<number>(0);
  const keyMoveRef = useRef({ w: false, a: false, s: false, d: false, q: false, e: false });
  const ownedUiPointerIdsRef = useRef<Set<number>>(new Set());

  const resetAllControlInputs = () => {
    moveStickRef.current = { x: 0, y: 0 };
    lookStickRef.current = { x: 0, y: 0 };
    charTurnInputRef.current = 0;
    keyMoveRef.current = { w: false, a: false, s: false, d: false, q: false, e: false };
    ownedUiPointerIdsRef.current.clear();
    if (moveKnobRef.current) {
      moveKnobRef.current.style.transform = 'translate(0px, 0px)';
    }
    if (lookKnobRef.current) {
      lookKnobRef.current.style.transform = 'translate(0px, 0px)';
    }
  };

  /**
   * Switches between Third Person and Free Orbit camera modes without any positional or rotational jump.
   */
  const handleSwitchCameraMode = (nextMode: PlayboardCameraMode) => {
    const currentIsFree = isFreeOrbitViewRef.current;
    const targetIsFree = nextMode === 'free_orbit';
    if (currentIsFree === targetIsFree) return;

    const cam = cameraRef.current;
    const currLook = activeLookTargetRef.current;

    if (targetIsFree) {
      // Pin current Shot Camera before entering Free Orbit
      pinnedShotCameraRef.current = {
        yawDeg: Math.round(THREE.MathUtils.radToDeg(camCurrentStateRef.current.yaw)),
        pitchDeg: Math.round(THREE.MathUtils.radToDeg(camCurrentStateRef.current.pitch)),
        distance: Number(camCurrentStateRef.current.dist.toFixed(2)),
        height: Number(camCurrentStateRef.current.height.toFixed(2)),
        rollDeg: Math.round(THREE.MathUtils.radToDeg(camCurrentStateRef.current.roll)),
      };
      if (cam) {
        freeOrbitStateRef.current = convertCameraPoseToFreeOrbitState(
          { x: cam.position.x, y: cam.position.y, z: cam.position.z },
          { x: currLook.x, y: currLook.y, z: currLook.z }
        );
      }
      isFreeOrbitViewRef.current = true;
      setIsFreeOrbitView(true);
    } else {
      // Convert Free Orbit camera pose back into Third Person orientation around the active subject
      const subjX = rigRef.current ? rigRef.current.root.position.x : playerPosRef.current.x;
      const subjZ = rigRef.current ? rigRef.current.root.position.z : playerPosRef.current.z;
      const pelvisY = rigRef.current ? rigRef.current.pelvis.position.y : 0.885;
      const subjLookY = Math.max(0.45, pelvisY + (camSettingsRef.current.height - 1.25) + 0.14);

      if (cam) {
        const converted = convertFreeOrbitToThirdPersonOrientation(
          { x: cam.position.x, y: cam.position.y, z: cam.position.z },
          { x: subjX, y: subjLookY, z: subjZ }
        );

        camTargetStateRef.current.yaw = converted.yawRad;
        camTargetStateRef.current.pitch = converted.pitchRad;
        camTargetStateRef.current.dist = converted.distance;

        camCurrentStateRef.current.yaw = converted.yawRad;
        camCurrentStateRef.current.pitch = converted.pitchRad;
        camCurrentStateRef.current.dist = converted.distance;

        // Compute exact Third Person destination and record residual offset so frame 0 has 0.000m jump
        const destTp = computePlayboardCameraTransform(
          {
            ...camSettingsRef.current,
            targetMode: 'track_subject',
            yawDeg: converted.yawDeg,
            pitchDeg: converted.pitchDeg,
            distance: converted.distance,
            height: camCurrentStateRef.current.height,
            rollDeg: THREE.MathUtils.radToDeg(camCurrentStateRef.current.roll),
          },
          {
            ...poseStateRef.current,
            characterPosX: subjX,
            characterPosZ: subjZ,
          },
          cam.aspect,
          pelvisY
        );

        tpTransitionCamOffsetRef.current.subVectors(cam.position, destTp.cameraPos);
        tpTransitionLookOffsetRef.current.subVectors(currLook, destTp.lookTarget);

        if (!pinShotCameraRef.current || !showShotPreviewPip) {
          onCameraChangeRef.current({
            yawDeg: converted.yawDeg,
            pitchDeg: converted.pitchDeg,
            distance: converted.distance,
          });
        }
      }
      isFreeOrbitViewRef.current = false;
      setIsFreeOrbitView(false);
    }
  };

  const handleRecenterFreeOrbitOnSubject = () => {
    const fo = freeOrbitStateRef.current;
    const subjX = rigRef.current ? rigRef.current.root.position.x : playerPosRef.current.x;
    const subjZ = rigRef.current ? rigRef.current.root.position.z : playerPosRef.current.z;
    const pelvisY = rigRef.current ? rigRef.current.pelvis.position.y : 0.885;
    fo.targetX = subjX;
    fo.targetY = Math.max(0.55, pelvisY + 0.14);
    fo.targetZ = subjZ;
  };

  // Player position, velocity, orientation & locomotion gait state
  const playerPosRef = useRef<ThirdPersonLocomotionState>({
    ...createInitialLocomotionState(),
    x: poseSettings.characterPosX ?? 0,
    z: poseSettings.characterPosZ ?? 0,
    rot: THREE.MathUtils.degToRad(poseSettings.characterYawDeg ?? 0),
    targetRot: THREE.MathUtils.degToRad(poseSettings.characterYawDeg ?? 0),
  });

  const lastReportedTransformRef = useRef({
    yawDeg: poseSettings.characterYawDeg ?? 0,
    posX: poseSettings.characterPosX ?? 0,
    posZ: poseSettings.characterPosZ ?? 0,
  });

  const lastSyncedPoseKeyRef = useRef(
    `${poseSettings.basePose}:${poseSettings.interactionPresetId ?? ''}`
  );
  // Only snap on initial mount or when instantPoseTransitions is enabled;
  // preset changes smoothly transition via PoseTransitionState
  const snapRigNextFrameRef = useRef<boolean>(true);

  const poseTransitionRef = useRef<PoseTransitionState>(
    createPoseTransitionState(
      resolveSemanticCharacterRigPose(poseSettings, ikEnabled),
      getPosePresetTransitionSignature(poseSettings)
    )
  );
  const secondaryMotionRef = useRef<SecondaryMotionState>(createSecondaryMotionState());

  // Sync external reset / preset / blueprint load of character position, orientation & pose family
  useEffect(() => {
    const extYawDeg = poseSettings.characterYawDeg ?? 0;
    const extPosX = poseSettings.characterPosX ?? 0;
    const extPosZ = poseSettings.characterPosZ ?? 0;
    const p = playerPosRef.current;

    const extRad = normalizeAngleRad(THREE.MathUtils.degToRad(extYawDeg));
    const repRad = normalizeAngleRad(
      THREE.MathUtils.degToRad(lastReportedTransformRef.current.yawDeg)
    );
    const yawChanged = Math.abs(shortestAngleDiffRad(repRad, extRad)) > THREE.MathUtils.degToRad(0.5);
    const posChanged =
      Math.abs(extPosX - lastReportedTransformRef.current.posX) > 0.01 ||
      Math.abs(extPosZ - lastReportedTransformRef.current.posZ) > 0.01;
    const nextPoseKey = `${poseSettings.basePose}:${poseSettings.interactionPresetId ?? ''}`;
    const poseFamilyChanged = nextPoseKey !== lastSyncedPoseKeyRef.current;
    lastSyncedPoseKeyRef.current = nextPoseKey;

    if (poseFamilyChanged && instantTransitionsRef.current) {
      snapRigNextFrameRef.current = true;
    }

    if (yawChanged || posChanged || poseFamilyChanged) {
      p.x = extPosX;
      p.z = extPosZ;
      p.vx = 0;
      p.vz = 0;
      p.rot = extRad;
      p.targetRot = extRad;
      p.walkAmt = 0;
      p.runBlend = 0;
      p.forwardBlend = 1;
      p.strafeBlend = 0;
      p.turnRateRadPerSec = 0;
      p.turnStepAmt = 0;
      p.leanPitchRad = 0;
      p.leanRollRad = 0;
      p.gaitMode = 'idle';
      p.facingMode = 'manual';

      // Clear any stale joystick or keyboard vectors on external reset/preset/blueprint sync
      resetAllControlInputs();

      lastReportedTransformRef.current = {
        yawDeg: extYawDeg,
        posX: extPosX,
        posZ: extPosZ,
      };

      if (instantTransitionsRef.current) {
        if (rigRef.current) {
          rigRef.current.root.position.set(extPosX, 0, extPosZ);
          rigRef.current.root.rotation.y = extRad;
        }
        if (customModelGroupRef.current) {
          customModelGroupRef.current.position.set(extPosX, 0, extPosZ);
          customModelGroupRef.current.rotation.y = extRad;
        }
      }
    }
  }, [
    poseSettings.characterYawDeg,
    poseSettings.characterPosX,
    poseSettings.characterPosZ,
    poseSettings.basePose,
    poseSettings.interactionPresetId,
  ]);

  // Clear active joystick inputs if joysticks are hidden
  useEffect(() => {
    if (!showJoysticks) {
      resetAllControlInputs();
    }
  }, [showJoysticks]);

  // Update target camera state and pinned shot camera when external cameraSettings props change
  useEffect(() => {
    camTargetStateRef.current.yaw = THREE.MathUtils.degToRad(cameraSettings.yawDeg);
    camTargetStateRef.current.pitch = THREE.MathUtils.degToRad(cameraSettings.pitchDeg);
    camTargetStateRef.current.dist = cameraSettings.distance;
    camTargetStateRef.current.height = cameraSettings.height;
    camTargetStateRef.current.roll = THREE.MathUtils.degToRad(cameraSettings.rollDeg);

    pinnedShotCameraRef.current = {
      yawDeg: cameraSettings.yawDeg,
      pitchDeg: cameraSettings.pitchDeg,
      distance: cameraSettings.distance,
      height: cameraSettings.height,
      rollDeg: cameraSettings.rollDeg,
    };

    if (cameraRef.current) {
      const parsedRatio = parseOutputAspectRatio(cameraSettings.outputRatio);
      const targetFov = getEffectiveVerticalFovDeg(
        cameraSettings.focalLength,
        parsedRatio.numericAspect
      );
      if (Math.abs(cameraRef.current.fov - targetFov) > 0.1) {
        cameraRef.current.fov = targetFov;
        cameraRef.current.updateProjectionMatrix();
      }
    }
  }, [cameraSettings]);

  const syncSceneLightingAndBackground = (
    targetEnv: PlayboardEnvironment,
    targetLighting: PlayboardLightingPreset
  ) => {
    if (bedroomGroupRef.current) {
      bedroomGroupRef.current.visible = targetEnv === 'studio_bedroom';
    }
    if (minimalGroupRef.current) {
      minimalGroupRef.current.visible = targetEnv === 'minimal_neutral';
    }
    if (cyberGroupRef.current) {
      cyberGroupRef.current.visible = targetEnv === 'cyber_grid';
    }
    const lRig = lightingRigRef.current;
    if (sceneRef.current) {
      if (targetEnv === 'cyber_grid') {
        sceneRef.current.background = new THREE.Color(0x0c0e16);
      } else if (targetEnv === 'minimal_neutral') {
        sceneRef.current.background = new THREE.Color(0x1a1d24);
      } else {
        if (targetLighting === 'golden_hour') {
          sceneRef.current.background = new THREE.Color(0xcab6a3);
        } else if (targetLighting === 'cozy_evening') {
          sceneRef.current.background = new THREE.Color(0x181f2e);
        } else if (targetLighting === 'studio_neutral') {
          sceneRef.current.background = new THREE.Color(0xcfd6de);
        } else {
          sceneRef.current.background = new THREE.Color(0xcbd3dc);
        }
      }
    }
    if (lRig) {
      if (targetLighting === 'golden_hour') {
        lRig.hemiLight.color.setHex(0xffe0b5);
        lRig.hemiLight.groundColor.setHex(0x4a3628);
        lRig.hemiLight.intensity = 0.28;
        lRig.keyLight.color.setHex(0xffab5e);
        lRig.keyLight.intensity = 1.72;
        lRig.keyLight.position.set(-4.8, 3.6, 2.8);
        lRig.fillLight.color.setHex(0xc7d2fe);
        lRig.fillLight.intensity = 0.22;
        lRig.rimLight.color.setHex(0xfdba74);
        lRig.rimLight.intensity = 0.44;
        lRig.deskLampLight.intensity = 0.88;
        if (lRig.windowAreaLight) {
          lRig.windowAreaLight.color.setHex(0xffb76b);
          lRig.windowAreaLight.intensity = 0.72;
        }
        if (lRig.ceilingSoftboxLight) {
          lRig.ceilingSoftboxLight.color.setHex(0xffe4c4);
          lRig.ceilingSoftboxLight.intensity = 0.2;
        }
        if (lRig.windowGoboMat) {
          lRig.windowGoboMat.color.setHex(0xffb366);
          lRig.windowGoboMat.opacity = 0.08;
        }
        lRig.skyPanes.forEach((m) => m.color.setHex(0xffd8ab));
        lRig.stringBulbMaterials.forEach((m) => {
          m.emissiveIntensity = 1.1;
        });
      } else if (targetLighting === 'cozy_evening') {
        lRig.hemiLight.color.setHex(0x93c5fd);
        lRig.hemiLight.groundColor.setHex(0x1f2836);
        lRig.hemiLight.intensity = 0.22;
        lRig.keyLight.color.setHex(0x93c5fd);
        lRig.keyLight.intensity = 0.68;
        lRig.keyLight.position.set(-4.2, 5.0, 3.0);
        lRig.fillLight.color.setHex(0xfde68a);
        lRig.fillLight.intensity = 0.28;
        lRig.rimLight.color.setHex(0xf59e0b);
        lRig.rimLight.intensity = 0.48;
        lRig.deskLampLight.intensity = 1.55;
        if (lRig.windowAreaLight) {
          lRig.windowAreaLight.color.setHex(0x60a5fa);
          lRig.windowAreaLight.intensity = 0.35;
        }
        if (lRig.ceilingSoftboxLight) {
          lRig.ceilingSoftboxLight.color.setHex(0xfde68a);
          lRig.ceilingSoftboxLight.intensity = 0.18;
        }
        if (lRig.windowGoboMat) {
          lRig.windowGoboMat.color.setHex(0x60a5fa);
          lRig.windowGoboMat.opacity = 0.03;
        }
        lRig.skyPanes.forEach((m) => m.color.setHex(0x33496b));
        lRig.stringBulbMaterials.forEach((m) => {
          m.emissiveIntensity = 1.85;
        });
      } else if (targetLighting === 'studio_neutral') {
        lRig.hemiLight.color.setHex(0xfafcff);
        lRig.hemiLight.groundColor.setHex(0x525d6b);
        lRig.hemiLight.intensity = 0.32;
        lRig.keyLight.color.setHex(0xffffff);
        lRig.keyLight.intensity = 1.54;
        lRig.keyLight.position.set(-3.8, 5.4, 3.5);
        lRig.fillLight.color.setHex(0xdbe4ef);
        lRig.fillLight.intensity = 0.26;
        lRig.rimLight.color.setHex(0xf1f5f9);
        lRig.rimLight.intensity = 0.34;
        lRig.deskLampLight.intensity = 0.42;
        if (lRig.windowAreaLight) {
          lRig.windowAreaLight.color.setHex(0xf8fafc);
          lRig.windowAreaLight.intensity = 0.55;
        }
        if (lRig.ceilingSoftboxLight) {
          lRig.ceilingSoftboxLight.color.setHex(0xffffff);
          lRig.ceilingSoftboxLight.intensity = 0.25;
        }
        if (lRig.windowGoboMat) {
          lRig.windowGoboMat.color.setHex(0xffffff);
          lRig.windowGoboMat.opacity = 0.04;
        }
        lRig.skyPanes.forEach((m) => m.color.setHex(0xeef2f6));
        lRig.stringBulbMaterials.forEach((m) => {
          m.emissiveIntensity = 0.45;
        });
      } else {
        // daylight_warm (default calibrated high-contrast architectural daylight)
        lRig.hemiLight.color.setHex(0xfff6eb);
        lRig.hemiLight.groundColor.setHex(0x52453a);
        lRig.hemiLight.intensity = 0.28;
        lRig.keyLight.color.setHex(0xfff1dc);
        lRig.keyLight.intensity = 1.65;
        lRig.keyLight.position.set(-4.2, 5.2, 3.2);
        lRig.fillLight.color.setHex(0xdbeafe);
        lRig.fillLight.intensity = 0.22;
        lRig.rimLight.color.setHex(0xfde68a);
        lRig.rimLight.intensity = 0.34;
        lRig.deskLampLight.intensity = 0.65;
        if (lRig.windowAreaLight) {
          lRig.windowAreaLight.color.setHex(0xfff3df);
          lRig.windowAreaLight.intensity = 0.62;
        }
        if (lRig.ceilingSoftboxLight) {
          lRig.ceilingSoftboxLight.color.setHex(0xfffaf2);
          lRig.ceilingSoftboxLight.intensity = 0.2;
        }
        if (lRig.windowGoboMat) {
          lRig.windowGoboMat.color.setHex(0xfff2d6);
          lRig.windowGoboMat.opacity = 0.055;
        }
        lRig.skyPanes.forEach((m) => m.color.setHex(0xf7efe0));
        lRig.stringBulbMaterials.forEach((m) => {
          m.emissiveIntensity = 0.85;
        });
      }
    }
  };

  // Environment visibility & lighting tone (Phase 3 lighting presets + environments)
  useEffect(() => {
    syncSceneLightingAndBackground(environment, effectiveLighting);
  }, [environment, effectiveLighting]);

  // Optional custom GLB/GLTF model loading
  useEffect(() => {
    const customGroup = customModelGroupRef.current;
    const builtInRig = rigRef.current;
    if (!customGroup || !builtInRig) return;

    if (!customGlbUrl) {
      customGroup.clear();
      customGroup.visible = false;
      builtInRig.root.visible = true;
      gltfMixerRef.current = null;
      if (poseStateRef.current.customModelBounds && onPoseChangeRef.current) {
        onPoseChangeRef.current({ customModelBounds: null });
      }
      return;
    }

    const loader = new GLTFLoader();
    loader.load(
      customGlbUrl,
      (gltf) => {
        customGroup.clear();
        const model = gltf.scene;
        // Auto-normalize scale and ground pivot
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const scale = 1.68 / maxDim;
        model.scale.setScalar(scale);

        const scaledBox = new THREE.Box3().setFromObject(model);
        const center = scaledBox.getCenter(new THREE.Vector3());
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= scaledBox.min.y;

        let hasSkeleton = false;
        let boneCount = 0;
        let handBoneCount = 0;
        let hasHeadBone = false;
        model.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
            hasSkeleton = true;
          }
          if ((obj as THREE.Bone).isBone) {
            boneCount++;
            const bName = (obj.name || '').toLowerCase();
            if (/thumb|index|middle|ring|pinky|finger|hand|wrist/.test(bName)) {
              handBoneCount++;
            }
            if (/head|neck|eye|jaw/.test(bName)) {
              hasHeadBone = true;
            }
          }
          if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });

        const normalizedBox = new THREE.Box3().setFromObject(model);
        const normalizedSize = normalizedBox.getSize(new THREE.Vector3());
        const prevBounds = poseStateRef.current.customModelBounds;
        if (onPoseChangeRef.current) {
          onPoseChangeRef.current({
            customModelBounds: {
              minY: Number(normalizedBox.min.y.toFixed(3)),
              maxY: Number(normalizedBox.max.y.toFixed(3)),
              height: Number(Math.max(0.2, normalizedSize.y).toFixed(3)),
              width: Number(Math.max(0.15, normalizedSize.x).toFixed(3)),
              depth: Number(Math.max(0.12, normalizedSize.z).toFixed(3)),
              centerX: 0,
              centerZ: 0,
              hasSkeleton,
              boneCount,
              handBoneCount,
              hasHeadBone,
              scaleMultiplier: prevBounds?.scaleMultiplier ?? 1,
              offsetY: prevBounds?.offsetY ?? 0,
              yawOffsetDeg: prevBounds?.yawOffsetDeg ?? 0,
            },
          });
        }

        customGroup.add(model);
        customGroup.visible = true;
        builtInRig.root.visible = false;

        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          gltfMixerRef.current = mixer;
          const action = mixer.clipAction(gltf.animations[0]);
          action.play();
        }
      },
      undefined,
      () => {
        // Fallback cleanly to built-in rigged character if custom GLB fails
        customGroup.clear();
        customGroup.visible = false;
        builtInRig.root.visible = true;
        if (poseStateRef.current.customModelBounds && onPoseChangeRef.current) {
          onPoseChangeRef.current({ customModelBounds: null });
        }
      }
    );
  }, [customGlbUrl]);

  // Main Three.js Setup & Animation Loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Software WebGL detection per Three.js skill directive
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    setViewportDimensions({ width, height });

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(
      environment === 'cyber_grid'
        ? 0x0c0e16
        : environment === 'minimal_neutral'
        ? 0x1a1d24
        : 0xd8dfe5
    );

    const camera = new THREE.PerspectiveCamera(
      FOCAL_TO_FOV[cameraSettings.focalLength] || 47,
      width / height,
      0.1,
      100
    );
    cameraRef.current = camera;

    // Dedicated Shot-Camera for Picture-in-Picture (PiP) live composition preview
    const shotPreviewCamera = new THREE.PerspectiveCamera(
      FOCAL_TO_FOV[cameraSettings.focalLength] || 47,
      1,
      0.1,
      100
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    rendererRef.current = renderer;
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    container.appendChild(renderer.domElement);

    // Studio Environment reflection texture (calibrated environmentIntensity preserves deep shadow contrast)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    (scene as unknown as { environmentIntensity?: number }).environmentIntensity = 0.16;
    pmremGenerator.dispose();

    // ==========================================
    // Studio 3-Point + Architectural Window & RectAreaLight Softbox Lighting Rig
    // ==========================================
    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
    }

    const hemiLight = new THREE.HemisphereLight(0xfff6eb, 0x52453a, 0.28);
    hemiLight.position.set(0, 6, 0);
    scene.add(hemiLight);

    // Primary Key Light (Sunlit Window + Studio Softbox — Dominant Shadow-Casting Source)
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.65);
    keyLight.position.set(-4.2, 5.2, 3.2);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(isSoftwareGl ? 512 : 2048, isSoftwareGl ? 512 : 2048);
    keyLight.shadow.camera.left = -3.4;
    keyLight.shadow.camera.right = 3.4;
    keyLight.shadow.camera.top = 3.4;
    keyLight.shadow.camera.bottom = -3.4;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 15;
    keyLight.shadow.bias = -0.0002;
    keyLight.shadow.normalBias = 0.012;
    scene.add(keyLight);

    // Cool Fill Light from opposite side
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.22);
    fillLight.position.set(4.5, 3.0, 2.0);
    scene.add(fillLight);

    // Subtle Warm Rim / Backlight for character silhouette separation
    const rimLight = new THREE.DirectionalLight(0xfde68a, 0.34);
    rimLight.position.set(0.5, 3.8, -4.2);
    scene.add(rimLight);

    // Warm Practical Desk Lamp Point Light
    const deskLampLight = new THREE.PointLight(0xffb76b, 0.65, 3.6, 1.6);
    deskLampLight.position.set(-2.28, 1.05, -0.36);
    scene.add(deskLampLight);

    // Studio Area Softboxes (RectAreaLight at Casement Window + Overhead Fill Softbox)
    let windowAreaLight: THREE.RectAreaLight | null = null;
    let ceilingSoftboxLight: THREE.RectAreaLight | null = null;
    if (!isSoftwareGl) {
      windowAreaLight = new THREE.RectAreaLight(0xfff3df, 0.62, 1.85, 1.85);
      windowAreaLight.position.set(-2.88, 1.66, -0.05);
      windowAreaLight.lookAt(0.6, 1.05, -0.45);
      scene.add(windowAreaLight);

      ceilingSoftboxLight = new THREE.RectAreaLight(0xfffaf2, 0.2, 2.4, 2.4);
      ceilingSoftboxLight.position.set(0.2, 2.95, 0.2);
      ceilingSoftboxLight.lookAt(0.2, 0.0, -0.4);
      scene.add(ceilingSoftboxLight);
    }

    // ==========================================
    // Procedural Micro-Detail Normal Maps (Zero External Dependencies)
    // ==========================================
    // 1. Woven Linen / Bouclé Fabric Normal Map (for bedding, pillows, upholstery, curtains)
    const createFabricWeaveNormalMap = (repeatX = 14, repeatY = 14) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(128, 128);
        const data = img.data;
        for (let y = 0; y < 128; y++) {
          for (let x = 0; x < 128; x++) {
            const idx = (y * 128 + x) * 4;
            const warp = Math.sin((x / 4) * Math.PI * 2);
            const weft = Math.sin((y / 4) * Math.PI * 2);
            const micro = (((x * 17 + y * 31) % 13) - 6) * 0.8;
            data[idx] = Math.max(0, Math.min(255, Math.round(128 + warp * 18 + micro)));
            data[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + weft * 18 + micro)));
            data[idx + 2] = 248;
            data[idx + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      return tex;
    };

    // 2. Human Epidermal Micro-Pore Normal Map (for realistic skin subsurface & specular breakup)
    const createSkinMicroDetailNormalMap = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(128, 128);
        const data = img.data;
        for (let y = 0; y < 128; y++) {
          for (let x = 0; x < 128; x++) {
            const idx = (y * 128 + x) * 4;
            const cellX = Math.sin(x * 0.85 + Math.cos(y * 0.45) * 1.5);
            const cellY = Math.cos(y * 0.85 + Math.sin(x * 0.45) * 1.5);
            const pore = ((x * 23 + y * 47 + x * y) % 19) - 9;
            data[idx] = Math.max(0, Math.min(255, Math.round(128 + cellX * 9 + pore * 0.7)));
            data[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + cellY * 9 + pore * 0.7)));
            data[idx + 2] = 252;
            data[idx + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(8, 8);
      return tex;
    };

    // 3. Ribbed Cotton Knit Normal Map (for subject's camisole crop top & jogger cuffs)
    const createRibbedKnitNormalMap = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(128, 128);
        const data = img.data;
        for (let y = 0; y < 128; y++) {
          for (let x = 0; x < 128; x++) {
            const idx = (y * 128 + x) * 4;
            const rib = Math.cos((x / 3) * Math.PI * 2) * 26;
            const stitch = Math.sin((y / 2) * Math.PI * 2) * 8;
            data[idx] = Math.max(0, Math.min(255, Math.round(128 + rib)));
            data[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + stitch)));
            data[idx + 2] = 246;
            data[idx + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(14, 10);
      return tex;
    };

    // 4. Anisotropic Hair Strand Normal Map
    const createHairStrandNormalMap = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(128, 128);
        const data = img.data;
        for (let y = 0; y < 128; y++) {
          for (let x = 0; x < 128; x++) {
            const idx = (y * 128 + x) * 4;
            const strand =
              Math.sin(x * 1.15 + Math.sin(y * 0.12) * 2.0) * 22 +
              Math.cos(x * 2.7) * 10;
            data[idx] = Math.max(0, Math.min(255, Math.round(128 + strand)));
            data[idx + 1] = 128;
            data[idx + 2] = 246;
            data[idx + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(6, 4);
      return tex;
    };

    const fabricWeaveNormalTex = createFabricWeaveNormalMap(14, 14);
    const skinNormalTex = createSkinMicroDetailNormalMap();
    const ribbedKnitNormalTex = createRibbedKnitNormalMap();
    const hairStrandNormalTex = createHairStrandNormalMap();

    // 5. High-Definition Procedural Albedo & Bump Textures for Wood, Upholstery, Plaster, Skin, Hair & Knitwear
    const createWoodGrainAlbedoTexture = (
      baseHex: string,
      grainHex: string,
      darkHex: string,
      repeatX = 2,
      repeatY = 2
    ) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = baseHex;
        ctx.fillRect(0, 0, 256, 256);
        for (let y = 0; y < 256; y++) {
          const wave = Math.sin(y * 0.14) * 6 + Math.cos(y * 0.37) * 3;
          ctx.fillStyle = y % 5 === 0 ? darkHex : grainHex;
          ctx.globalAlpha = 0.16 + ((y * 13) % 10) * 0.015;
          ctx.fillRect(0, y, 256, 1 + (y % 2));
          if (y % 9 === 0) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(85, y + wave, 170, y - wave, 256, y);
            ctx.strokeStyle = darkHex;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1.0;
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      return tex;
    };

    const createWovenTextileAlbedoTexture = (
      baseRgb: [number, number, number],
      variation = 14,
      repeatX = 8,
      repeatY = 8,
      ribbed = false
    ) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(128, 128);
        const d = img.data;
        for (let y = 0; y < 128; y++) {
          for (let x = 0; x < 128; x++) {
            const idx = (y * 128 + x) * 4;
            const pattern = ribbed
              ? Math.cos((x / 3) * Math.PI * 2) * variation + (((x * 19 + y * 37) % 9) - 4)
              : Math.sin((x / 2) * Math.PI) * (variation * 0.55) +
                Math.cos((y / 2) * Math.PI) * (variation * 0.55) +
                (((x * 13 + y * 29) % 11) - 5);
            d[idx] = Math.max(0, Math.min(255, Math.round(baseRgb[0] + pattern)));
            d[idx + 1] = Math.max(0, Math.min(255, Math.round(baseRgb[1] + pattern)));
            d[idx + 2] = Math.max(0, Math.min(255, Math.round(baseRgb[2] + pattern)));
            d[idx + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      return tex;
    };

    const createSubsurfaceSkinAlbedoTexture = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      if (ctx) {
        // Warm lifelike dermal gradient with subtle rosy vascularity and micro-pore variation
        const g = ctx.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0.0, '#e6bda6');
        g.addColorStop(0.35, '#ecc5af');
        g.addColorStop(0.68, '#e7bca5');
        g.addColorStop(1.0, '#deb098');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 256);

        const img = ctx.getImageData(0, 0, 256, 256);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const px = (i / 4) % 256;
          const py = Math.floor(i / 4 / 256);
          const micro = (((px * 23 + py * 41 + px * py) % 11) - 5) * 0.9;
          d[i] = Math.max(0, Math.min(255, Math.round(d[i] + micro)));
          d[i + 1] = Math.max(0, Math.min(255, Math.round(d[i + 1] + micro * 0.8)));
          d[i + 2] = Math.max(0, Math.min(255, Math.round(d[i + 2] + micro * 0.7)));
        }
        ctx.putImageData(img, 0, 0);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const createHairStrandAlbedoTexture = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#261b16';
        ctx.fillRect(0, 0, 256, 256);
        for (let x = 0; x < 256; x += 2) {
          const highlight = (x * 17) % 23;
          ctx.fillStyle =
            highlight < 4
              ? 'rgba(128, 88, 62, 0.55)'
              : highlight < 10
              ? 'rgba(82, 56, 40, 0.45)'
              : 'rgba(24, 16, 12, 0.55)';
          ctx.fillRect(x, 0, 2, 256);
        }
        // Subtle anisotropic sheen band across mid-shaft
        const sheenGrad = ctx.createLinearGradient(0, 40, 0, 190);
        sheenGrad.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
        sheenGrad.addColorStop(0.45, 'rgba(165, 118, 86, 0.28)');
        sheenGrad.addColorStop(0.55, 'rgba(185, 134, 98, 0.32)');
        sheenGrad.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
        ctx.fillStyle = sheenGrad;
        ctx.fillRect(0, 0, 256, 256);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const oakWoodTex = createWoodGrainAlbedoTexture('#b5885e', '#9e7149', '#7d5636', 2, 2);
    const walnutWoodTex = createWoodGrainAlbedoTexture('#6b4c35', '#583d29', '#3f2a1b', 2, 2);
    const plasterWallTex = createWovenTextileAlbedoTexture([218, 210, 198], 7, 6, 4, false);
    const upholsteryWeaveTex = createWovenTextileAlbedoTexture([206, 194, 178], 13, 10, 10, false);
    const upholsteryDarkWeaveTex = createWovenTextileAlbedoTexture([180, 166, 148], 14, 10, 10, false);
    const duvetWeaveTex = createWovenTextileAlbedoTexture([120, 140, 156], 12, 10, 10, false);
    const throwKnitTex = createWovenTextileAlbedoTexture([182, 108, 82], 18, 14, 14, true);
    const skinAlbedoTex = createSubsurfaceSkinAlbedoTexture();
    const hairAlbedoTex = createHairStrandAlbedoTexture();
    const ribbedTopTex = createWovenTextileAlbedoTexture([234, 227, 217], 14, 14, 10, true);
    const terryPantsTex = createWovenTextileAlbedoTexture([132, 124, 116], 13, 10, 12, false);

    // Material factory helpers
    const stdMat = (
      color: number,
      roughness = 0.65,
      metalness = 0.0,
      extra?: Partial<THREE.MeshStandardMaterialParameters>
    ) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        ...extra,
      });

    const physMat = (
      color: number,
      roughness = 0.5,
      metalness = 0.0,
      clearcoat = 0.15,
      extra?: Partial<THREE.MeshPhysicalMaterialParameters>
    ) =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness,
        metalness,
        clearcoat,
        clearcoatRoughness: 0.25,
        ...extra,
      });

    const addShadowMesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = !isSoftwareGl;
      m.receiveShadow = !isSoftwareGl;
      parent.add(m);
      return m;
    };

    // Helper for soft furniture contact shadow blobs
    const furnitureShadowCanvas = document.createElement('canvas');
    furnitureShadowCanvas.width = furnitureShadowCanvas.height = 128;
    const fsCtx = furnitureShadowCanvas.getContext('2d');
    if (fsCtx) {
      const grad = fsCtx.createRadialGradient(64, 64, 8, 64, 64, 62);
      grad.addColorStop(0, 'rgba(18, 14, 10, 0.48)');
      grad.addColorStop(0.65, 'rgba(18, 14, 10, 0.20)');
      grad.addColorStop(1, 'rgba(18, 14, 10, 0)');
      fsCtx.fillStyle = grad;
      fsCtx.fillRect(0, 0, 128, 128);
    }
    const furnitureShadowTex = new THREE.CanvasTexture(furnitureShadowCanvas);
    const addContactShadowPlane = (
      parent: THREE.Object3D,
      w: number,
      d: number,
      x: number,
      y: number,
      z: number,
      opacity = 0.72
    ) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({
          map: furnitureShadowTex,
          transparent: true,
          opacity,
          depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };

    // Helper for rounded-bevel box profiles using Capsule/Cylinder/Box composites
    const createRoundedPillow = (w: number, h: number, d: number, mat: THREE.Material) => {
      const g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 22, 18), mat);
      core.scale.set(w, h, d);
      core.castShadow = !isSoftwareGl;
      core.receiveShadow = !isSoftwareGl;
      g.add(core);
      const seam = new THREE.Mesh(
        new THREE.TorusGeometry(0.47, 0.025, 8, 28),
        mat
      );
      seam.rotation.x = Math.PI / 2;
      seam.scale.set(w, d, h * 0.65);
      g.add(seam);
      return g;
    };

    // ==========================================
    // 1. Multi-View Architectural Studio Bedroom Reconstruction
    // ==========================================
    const bedroomGroup = new THREE.Group();
    bedroomGroupRef.current = bedroomGroup;
    scene.add(bedroomGroup);

    // Procedural Bleached / Warm Architectural Oak Wide-Plank Floor Texture (with plank seams & micro-grain)
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = floorCanvas.height = 1024;
    const fctx = floorCanvas.getContext('2d');
    if (fctx) {
      fctx.fillStyle = '#b58b61';
      fctx.fillRect(0, 0, 1024, 1024);

      const plankCols = 10;
      const plankW = 1024 / plankCols;
      const plankTones = ['#bc9268', '#ae845b', '#c2986e', '#a67c53', '#b78d63', '#c69d74'];
      for (let c = 0; c < plankCols; c++) {
        const rows = 4;
        const stagger = (c % 3) * 86;
        for (let r = -1; r < rows + 1; r++) {
          const y0 = r * 256 + stagger;
          fctx.fillStyle = plankTones[(c * 3 + r + 5) % plankTones.length];
          fctx.fillRect(c * plankW + 1.5, y0 + 1.5, plankW - 3, 253);

          // Subtle architectural wood grain streaks
          fctx.fillStyle = 'rgba(78, 52, 30, 0.11)';
          for (let g = 0; g < 6; g++) {
            const gx = c * plankW + 10 + ((g * 19) % (plankW - 20));
            fctx.fillRect(gx, y0 + 4, 2, 246);
          }

          // Crisp V-groove plank seam
          fctx.strokeStyle = 'rgba(68, 45, 25, 0.42)';
          fctx.lineWidth = 2.2;
          fctx.strokeRect(c * plankW + 1, y0 + 1, plankW - 2, 254);
        }
      }
    }
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // Thick cutaway architectural floor slab
    const floorSlab = addShadowMesh(
      bedroomGroup,
      new THREE.BoxGeometry(6.36, 0.2, 6.36),
      stdMat(0x7c5c41, 0.72)
    );
    floorSlab.position.set(0, -0.1, 0);

    // Satin Clearcoated Architectural Oak Floor Surface (catches realistic window light reflections)
    const floorSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(6.16, 6.16),
      new THREE.MeshPhysicalMaterial({
        map: floorTex,
        bumpMap: floorTex,
        bumpScale: 0.006,
        roughness: 0.45,
        metalness: 0.02,
        clearcoat: 0.38,
        clearcoatRoughness: 0.28,
        anisotropy: 0.25,
      })
    );
    floorSurface.rotation.x = -Math.PI / 2;
    floorSurface.position.y = 0.002;
    floorSurface.receiveShadow = !isSoftwareGl;
    bedroomGroup.add(floorSurface);

    // Projected Divided-Light Window Sunbeam Gobo across Floor & Rug
    const goboCanvas = document.createElement('canvas');
    goboCanvas.width = goboCanvas.height = 256;
    const gCtx = goboCanvas.getContext('2d');
    if (gCtx) {
      gCtx.clearRect(0, 0, 256, 256);
      // 2 columns x 4 rows of soft sunlit window panes matching the left casement window muntin grid
      for (let col = 0; col < 2; col++) {
        for (let row = 0; row < 4; row++) {
          const px = 22 + col * 108;
          const py = 18 + row * 56;
          const pGrad = gCtx.createRadialGradient(px + 46, py + 22, 6, px + 46, py + 22, 58);
          pGrad.addColorStop(0, 'rgba(255, 250, 238, 0.85)');
          pGrad.addColorStop(0.75, 'rgba(255, 246, 225, 0.42)');
          pGrad.addColorStop(1, 'rgba(255, 246, 225, 0)');
          gCtx.fillStyle = pGrad;
          gCtx.fillRect(px, py, 94, 44);
        }
      }
    }
    const windowGoboTex = new THREE.CanvasTexture(goboCanvas);
    windowGoboTex.colorSpace = THREE.SRGBColorSpace;
    const windowGoboMat = new THREE.MeshBasicMaterial({
      map: windowGoboTex,
      color: 0xfff2d6,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const windowGoboMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.3), windowGoboMat);
    windowGoboMesh.rotation.x = -Math.PI / 2;
    windowGoboMesh.rotation.z = -0.12;
    windowGoboMesh.position.set(-0.95, 0.022, 0.15);
    bedroomGroup.add(windowGoboMesh);

    // High-Pile Woven Architectural Area Rug (with procedural wool weave + sheen)
    const rugCanvas = document.createElement('canvas');
    rugCanvas.width = rugCanvas.height = 512;
    const rCtx = rugCanvas.getContext('2d');
    if (rCtx) {
      rCtx.fillStyle = '#ddd3c4';
      rCtx.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y += 4) {
        for (let x = 0; x < 512; x += 4) {
          const v = ((x * 13 + y * 29) % 17) - 8;
          const base = 210 + v;
          rCtx.fillStyle = `rgb(${base + 6}, ${base - 1}, ${base - 12})`;
          rCtx.fillRect(x, y, 3, 3);
        }
      }
      rCtx.strokeStyle = 'rgba(130, 112, 92, 0.65)';
      rCtx.lineWidth = 14;
      rCtx.strokeRect(10, 10, 492, 492);
    }
    const rugTex = new THREE.CanvasTexture(rugCanvas);
    rugTex.colorSpace = THREE.SRGBColorSpace;

    const rugGroup = new THREE.Group();
    rugGroup.position.set(-0.05, 0.006, -0.25);
    bedroomGroup.add(rugGroup);
    addContactShadowPlane(rugGroup, 3.35, 3.75, 0, -0.003, 0, 0.42);

    const rugOuter = addShadowMesh(
      rugGroup,
      new THREE.BoxGeometry(3.08, 0.011, 3.48),
      physMat(0xa89882, 0.88, 0, 0, {
        sheen: 0.72,
        sheenRoughness: 0.82,
        sheenColor: new THREE.Color(0xd5c8b6),
      })
    );
    rugOuter.castShadow = false;

    const rugInner = addShadowMesh(
      rugGroup,
      new THREE.BoxGeometry(2.96, 0.014, 3.36),
      new THREE.MeshPhysicalMaterial({
        map: rugTex,
        bumpMap: rugTex,
        bumpScale: 0.009,
        normalMap: fabricWeaveNormalTex,
        normalScale: new THREE.Vector2(0.08, 0.08),
        roughness: 0.86,
        metalness: 0.0,
        sheen: 0.82,
        sheenRoughness: 0.78,
        sheenColor: new THREE.Color(0xf5efe6),
      })
    );
    rugInner.position.y = 0.002;
    rugInner.castShadow = false;

    // Coordinated Architectural Materials (Venetian Plaster Walls, Grain-Textured Oak & Walnut, Bouclé Textiles, Ceramic, Anisotropic Brushed Bronze)
    const backWallPlasterMat = stdMat(0xdfd7cb, 0.88, 0, {
      map: plasterWallTex,
      bumpMap: plasterWallTex,
      bumpScale: 0.003,
      transparent: true,
      opacity: 1,
    });
    const leftWallPlasterMat = stdMat(0xe4ddd2, 0.88, 0, {
      map: plasterWallTex,
      bumpMap: plasterWallTex,
      bumpScale: 0.003,
      transparent: true,
      opacity: 1,
    });
    const rightWallPlasterMat = stdMat(0xdad1c5, 0.88, 0, {
      map: plasterWallTex,
      bumpMap: plasterWallTex,
      bumpScale: 0.003,
      transparent: true,
      opacity: 1,
    });
    const wallTrimMat = stdMat(0xc4b8a8, 0.68);
    const baseboardMat = stdMat(0xb3a796, 0.62);

    const oakWoodMat = physMat(0xffffff, 0.44, 0.02, 0.32, {
      map: oakWoodTex,
      bumpMap: oakWoodTex,
      bumpScale: 0.006,
      clearcoatRoughness: 0.28,
      anisotropy: 0.38,
    });
    const darkWoodMat = physMat(0xffffff, 0.42, 0.02, 0.36, {
      map: walnutWoodTex,
      bumpMap: walnutWoodTex,
      bumpScale: 0.006,
      clearcoatRoughness: 0.24,
      anisotropy: 0.42,
    });
    const frameMat = physMat(0x523d2e, 0.38, 0.16, 0.28, {
      map: walnutWoodTex,
    });
    const brushedMetalMat = physMat(0x6e6358, 0.26, 0.86, 0.25, {
      anisotropy: 0.78,
      anisotropyRotation: Math.PI * 0.25,
    });
    const ceramicMat = physMat(0xe8dfd3, 0.32, 0.02, 0.36);
    const ceramicAccentMat = physMat(0x8fa392, 0.38, 0.02, 0.28);
    const curtainMat = physMat(0xdcd3c6, 0.84, 0, 0.02, {
      map: upholsteryWeaveTex,
      normalMap: fabricWeaveNormalTex,
      normalScale: new THREE.Vector2(0.12, 0.12),
      sheen: 0.78,
      sheenRoughness: 0.72,
      sheenColor: new THREE.Color(0xf5efe6),
    });
    const curtainAccentMat = physMat(0xc4b8a8, 0.84, 0, 0.02, {
      map: upholsteryDarkWeaveTex,
      normalMap: fabricWeaveNormalTex,
      normalScale: new THREE.Vector2(0.12, 0.12),
      sheen: 0.75,
      sheenRoughness: 0.74,
      sheenColor: new THREE.Color(0xe8dfd3),
    });
    const upholsteryMat = physMat(0xffffff, 0.82, 0, 0.03, {
      map: upholsteryWeaveTex,
      bumpMap: upholsteryWeaveTex,
      bumpScale: 0.007,
      normalMap: fabricWeaveNormalTex,
      normalScale: new THREE.Vector2(0.14, 0.14),
      sheen: 0.86,
      sheenRoughness: 0.68,
      sheenColor: new THREE.Color(0xf7f2ea),
    });
    const upholsterySecondaryMat = physMat(0xffffff, 0.84, 0, 0.02, {
      map: upholsteryDarkWeaveTex,
      bumpMap: upholsteryDarkWeaveTex,
      bumpScale: 0.007,
      normalMap: fabricWeaveNormalTex,
      normalScale: new THREE.Vector2(0.14, 0.14),
      sheen: 0.82,
      sheenRoughness: 0.72,
      sheenColor: new THREE.Color(0xe6ddd0),
    });

    const backWallGroup = new THREE.Group();
    bedroomGroup.add(backWallGroup);
    const leftWallGroup = new THREE.Group();
    bedroomGroup.add(leftWallGroup);
    const rightWallGroup = new THREE.Group();
    bedroomGroup.add(rightWallGroup);

    // Helper to build classical recessed rectangular wall molding frames (seen across all 6 reference views)
    const addWallMoldingFrame = (
      parent: THREE.Object3D,
      w: number,
      h: number,
      x: number,
      y: number,
      z: number,
      axis: 'z' | 'x',
      mat: THREE.Material
    ) => {
      const stripT = 0.022;
      const stripD = 0.024;
      const fGroup = new THREE.Group();
      fGroup.position.set(x, y, z);
      if (axis === 'x') fGroup.rotation.y = Math.PI / 2;
      parent.add(fGroup);

      addShadowMesh(fGroup, new THREE.BoxGeometry(w, stripT, stripD), mat).position.set(0, h / 2, 0);
      addShadowMesh(fGroup, new THREE.BoxGeometry(w, stripT, stripD), mat).position.set(0, -h / 2, 0);
      addShadowMesh(fGroup, new THREE.BoxGeometry(stripT, h, stripD), mat).position.set(-w / 2, 0, 0);
      addShadowMesh(fGroup, new THREE.BoxGeometry(stripT, h, stripD), mat).position.set(w / 2, 0, 0);
    };

    // ==========================================
    // A. Back Wall (Z = -3.09) — Molding Panels, Door, Artwork & Geometric Relief
    // ==========================================
    const backWallMain = addShadowMesh(
      backWallGroup,
      new THREE.BoxGeometry(6.18, 3.12, 0.16),
      backWallPlasterMat
    );
    backWallMain.position.set(0, 1.56, -3.09);

    // Stepped Crown Molding & Fluted Baseboard on Back Wall
    addShadowMesh(backWallGroup, new THREE.BoxGeometry(6.24, 0.06, 0.22), wallTrimMat).position.set(0, 3.09, -3.06);
    addShadowMesh(backWallGroup, new THREE.BoxGeometry(6.2, 0.04, 0.19), wallTrimMat).position.set(0, 3.03, -3.07);
    addShadowMesh(backWallGroup, new THREE.BoxGeometry(6.14, 0.13, 0.035), baseboardMat).position.set(0, 0.065, -2.995);
    // Dado / Chair Rail
    addShadowMesh(backWallGroup, new THREE.BoxGeometry(6.14, 0.026, 0.028), backWallPlasterMat).position.set(
      0,
      0.86,
      -2.998
    );

    // Back Wall Classical Recessed Molding Frames (Left Bay, Center Headboard Bay, Right Bay)
    addWallMoldingFrame(backWallGroup, 1.12, 1.88, -2.32, 1.92, -2.998, 'z', backWallPlasterMat);
    addWallMoldingFrame(backWallGroup, 1.12, 0.56, -2.32, 0.48, -2.998, 'z', backWallPlasterMat);
    addWallMoldingFrame(backWallGroup, 2.28, 1.88, 1.25, 1.92, -2.998, 'z', backWallPlasterMat);
    addWallMoldingFrame(backWallGroup, 0.62, 1.88, 2.74, 1.92, -2.998, 'z', backWallPlasterMat);

    // Classical 2-Panel Architectural Interior Door on Back Wall (X = -1.08, Z = -2.99)
    const doorGroup = new THREE.Group();
    doorGroup.position.set(-1.08, 0, -2.99);
    backWallGroup.add(doorGroup);
    // Outer Architrave Casing
    addShadowMesh(doorGroup, new THREE.BoxGeometry(0.96, 2.18, 0.036), wallTrimMat).position.set(0, 1.09, 0);
    // Door Leaf
    addShadowMesh(doorGroup, new THREE.BoxGeometry(0.84, 2.1, 0.042), stdMat(0xdcd7cf, 0.72)).position.set(
      0,
      1.05,
      0.008
    );
    // Upper & Lower Recessed Door Panels
    addWallMoldingFrame(doorGroup, 0.62, 0.98, 0, 1.42, 0.032, 'z', wallTrimMat);
    addWallMoldingFrame(doorGroup, 0.62, 0.56, 0, 0.48, 0.032, 'z', wallTrimMat);
    // Brushed Metal Lever Handle & Rosette
    addShadowMesh(doorGroup, new THREE.CylinderGeometry(0.022, 0.022, 0.016, 14), brushedMetalMat)
      .rotateX(Math.PI / 2)
      .position.set(0.33, 1.02, 0.036);
    addShadowMesh(doorGroup, new THREE.BoxGeometry(0.11, 0.016, 0.022), brushedMetalMat).position.set(
      0.285,
      1.02,
      0.052
    );

    // Sculpted Landscape Painting Canvas Helper
    const createMinimalistArtTexture = (wPx: number, hPx: number, variant: 'horizon' | 'dunes') => {
      const c = document.createElement('canvas');
      c.width = wPx;
      c.height = hPx;
      const ctx = c.getContext('2d');
      if (ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, hPx);
        g.addColorStop(0, '#dedad2');
        g.addColorStop(0.54, '#c8c2b8');
        g.addColorStop(0.58, '#a69f94');
        g.addColorStop(1, '#bab3a8');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, wPx, hPx);

        // Soft tonal horizon ridges matching reference artwork
        ctx.fillStyle = 'rgba(130, 122, 112, 0.35)';
        ctx.beginPath();
        ctx.moveTo(0, hPx * 0.62);
        ctx.quadraticCurveTo(wPx * 0.35, hPx * 0.54, wPx * 0.7, hPx * 0.64);
        ctx.quadraticCurveTo(wPx * 0.88, hPx * 0.68, wPx, hPx * 0.6);
        ctx.lineTo(wPx, hPx);
        ctx.lineTo(0, hPx);
        ctx.fill();

        if (variant === 'dunes') {
          ctx.strokeStyle = 'rgba(245, 242, 236, 0.55)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(wPx * 0.12, hPx * 0.72);
          ctx.quadraticCurveTo(wPx * 0.5, hPx * 0.65, wPx * 0.88, hPx * 0.74);
          ctx.stroke();
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const mainArtTex = createMinimalistArtTexture(512, 320, 'horizon');
    const sideArtTex = createMinimalistArtTexture(256, 320, 'dunes');

    // Framed Landscape Painting + Companion Portrait Frame Above Bed Headboard (Images 2, 3, 4)
    const headArtGroup = new THREE.Group();
    headArtGroup.position.set(1.02, 2.02, -2.985);
    backWallGroup.add(headArtGroup);
    addShadowMesh(headArtGroup, new THREE.BoxGeometry(1.18, 0.74, 0.032), frameMat);
    addShadowMesh(headArtGroup, new THREE.BoxGeometry(1.1, 0.66, 0.036), stdMat(0xebe6de, 0.88));
    const mainArtPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.02, 0.58),
      new THREE.MeshStandardMaterial({ map: mainArtTex, roughness: 0.75 })
    );
    mainArtPlane.position.z = 0.02;
    headArtGroup.add(mainArtPlane);

    // Companion Portrait Frame to the right of main landscape frame
    const companionArtGroup = new THREE.Group();
    companionArtGroup.position.set(1.92, 1.98, -2.985);
    backWallGroup.add(companionArtGroup);
    addShadowMesh(companionArtGroup, new THREE.BoxGeometry(0.44, 0.56, 0.032), frameMat);
    addShadowMesh(companionArtGroup, new THREE.BoxGeometry(0.38, 0.5, 0.036), stdMat(0xebe6de, 0.88));
    const sideArtPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.33, 0.44),
      new THREE.MeshStandardMaterial({ map: sideArtTex, roughness: 0.75 })
    );
    sideArtPlane.position.z = 0.02;
    companionArtGroup.add(sideArtPlane);

    // Three Sculptural Interlocking Geometric Relief Medallions along Upper Frieze (Images 5 & 6)
    [0.58, 1.25, 1.92].forEach((gx) => {
      const geoRelief = new THREE.Group();
      geoRelief.position.set(gx, 2.64, -2.99);
      backWallGroup.add(geoRelief);
      [
        [-0.09, 0.09],
        [0.09, 0.09],
        [-0.09, -0.09],
        [0.09, -0.09],
      ].forEach(([ox, oy]) => {
        addWallMoldingFrame(geoRelief, 0.14, 0.14, ox, oy, 0, 'z', ceramicMat);
      });
      addWallMoldingFrame(geoRelief, 0.11, 0.11, 0, 0, 0.008, 'z', wallTrimMat);
    });

    // ==========================================
    // B. Left Wall (X = -3.09) — Tall Casement Window, Floor-to-Ceiling Pleated Curtains & Wall Frames
    // ==========================================
    const leftWallBottom = addShadowMesh(
      leftWallGroup,
      new THREE.BoxGeometry(0.16, 0.72, 6.16),
      leftWallPlasterMat
    );
    leftWallBottom.position.set(-3.09, 0.36, 0);

    const leftWallTop = addShadowMesh(
      leftWallGroup,
      new THREE.BoxGeometry(0.16, 0.52, 6.16),
      leftWallPlasterMat
    );
    leftWallTop.position.set(-3.09, 2.86, 0);

    const leftWallBackPillar = addShadowMesh(
      leftWallGroup,
      new THREE.BoxGeometry(0.16, 1.88, 2.08),
      leftWallPlasterMat
    );
    leftWallBackPillar.position.set(-3.09, 1.66, -2.04);

    const leftWallFrontPillar = addShadowMesh(
      leftWallGroup,
      new THREE.BoxGeometry(0.16, 1.88, 2.18),
      leftWallPlasterMat
    );
    leftWallFrontPillar.position.set(-3.09, 1.66, 1.99);

    // Crown Molding & Baseboard on Left Wall
    addShadowMesh(leftWallGroup, new THREE.BoxGeometry(0.22, 0.06, 6.24), wallTrimMat).position.set(-3.06, 3.09, 0);
    addShadowMesh(leftWallGroup, new THREE.BoxGeometry(0.035, 0.13, 6.14), baseboardMat).position.set(-2.995, 0.065, 0);

    // Framed Vertical Wall Panel on Left Wall beside Window (seen in Images 5 & 6)
    addWallMoldingFrame(leftWallGroup, 0.74, 1.12, -2.995, 1.78, -2.05, 'x', wallTrimMat);
    addWallMoldingFrame(leftWallGroup, 1.24, 1.88, -2.995, 1.88, 1.95, 'x', leftWallPlasterMat);

    // Tall Multi-Pane Casement Window (Z from -1.0 to +0.9, Y from 0.72 to 2.60)
    const windowGroup = new THREE.Group();
    windowGroup.position.set(-3.04, 1.66, -0.05);
    leftWallGroup.add(windowGroup);

    // Deep Architectural Window Sill + Outer Casing + Divided-Light Muntin Grid (2 cols × 4 rows)
    addShadowMesh(windowGroup, new THREE.BoxGeometry(0.28, 0.055, 2.02), wallTrimMat).position.set(0.04, -0.94, 0);
    addShadowMesh(windowGroup, new THREE.BoxGeometry(0.14, 0.055, 1.96), wallTrimMat).position.set(0, 0.94, 0);
    addShadowMesh(windowGroup, new THREE.BoxGeometry(0.14, 1.92, 0.055), wallTrimMat).position.set(0, 0, -0.95);
    addShadowMesh(windowGroup, new THREE.BoxGeometry(0.14, 1.92, 0.055), wallTrimMat).position.set(0, 0, 0.95);
    // Central Vertical Casement Stile + Sub-mullions
    addShadowMesh(windowGroup, new THREE.BoxGeometry(0.1, 1.88, 0.045), frameMat).position.set(0, 0, 0);
    addShadowMesh(windowGroup, new THREE.BoxGeometry(0.08, 1.88, 0.024), frameMat).position.set(0, 0, -0.47);
    addShadowMesh(windowGroup, new THREE.BoxGeometry(0.08, 1.88, 0.024), frameMat).position.set(0, 0, 0.47);
    // Horizontal Muntin Bars
    [-0.46, 0.0, 0.46].forEach((my) => {
      addShadowMesh(windowGroup, new THREE.BoxGeometry(0.08, 0.026, 1.88), frameMat).position.set(0, my, 0);
    });

    const leftSkyMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0, side: THREE.DoubleSide });
    const backSkyMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0, side: THREE.DoubleSide });
    const skyPane = new THREE.Mesh(new THREE.PlaneGeometry(1.88, 1.86), leftSkyMat);
    skyPane.rotation.y = Math.PI / 2;
    skyPane.position.set(-0.02, 0, 0);
    windowGroup.add(skyPane);

    // Full-Height Architectural Curtain Track & Floor-to-Ceiling Pleated Drapery Panels
    const curtainRod = addShadowMesh(
      windowGroup,
      new THREE.CylinderGeometry(0.018, 0.018, 2.52, 16),
      brushedMetalMat
    );
    curtainRod.rotation.x = Math.PI / 2;
    curtainRod.position.set(0.12, 1.16, 0);

    [-1.04, 1.04].forEach((cz) => {
      const drapeGroup = new THREE.Group();
      drapeGroup.position.set(0.11, -0.24, cz);
      windowGroup.add(drapeGroup);
      // 6 vertical pleated folds per curtain panel reaching floor-to-ceiling (2.82m tall)
      for (let f = 0; f < 6; f++) {
        const oz = (f - 2.5) * 0.058;
        const ox = (f % 2 === 0 ? 1 : -1) * 0.014;
        const fold = addShadowMesh(
          drapeGroup,
          new THREE.CylinderGeometry(0.036, 0.042, 2.82, 14),
          f % 2 === 0 ? curtainMat : curtainAccentMat
        );
        fold.scale.set(0.72, 1.0, 1.15);
        fold.position.set(ox, 0, oz);
      }
    });

    // ==========================================
    // C. Right Wall (X = +3.09) — Classical Paneling (Auto-fades when camera orbits right)
    // ==========================================
    const rightWallMain = addShadowMesh(
      rightWallGroup,
      new THREE.BoxGeometry(0.16, 3.12, 6.18),
      rightWallPlasterMat
    );
    rightWallMain.position.set(3.09, 1.56, 0);
    addShadowMesh(rightWallGroup, new THREE.BoxGeometry(0.22, 0.06, 6.24), wallTrimMat).position.set(3.06, 3.09, 0);
    addShadowMesh(rightWallGroup, new THREE.BoxGeometry(0.035, 0.13, 6.14), baseboardMat).position.set(2.995, 0.065, 0);
    addShadowMesh(rightWallGroup, new THREE.BoxGeometry(0.028, 0.026, 6.14), rightWallPlasterMat).position.set(
      2.998,
      0.86,
      0
    );

    // Classical Recessed Molding Panels on Right Wall (matching Image 1 & Image 4)
    [-2.05, -0.28, 1.55].forEach((pz) => {
      addWallMoldingFrame(rightWallGroup, 1.48, 1.88, 2.995, 1.92, pz, 'x', rightWallPlasterMat);
      addWallMoldingFrame(rightWallGroup, 1.48, 0.56, 2.995, 0.48, pz, 'x', rightWallPlasterMat);
    });

    // Framed Vertical Minimalist Painting on Right Wall above Dresser Console (Image 1 & Image 4)
    const rightWallArt = new THREE.Group();
    rightWallArt.position.set(2.98, 1.76, -0.28);
    rightWallArt.rotation.y = -Math.PI / 2;
    rightWallGroup.add(rightWallArt);
    addShadowMesh(rightWallArt, new THREE.BoxGeometry(0.88, 1.08, 0.032), frameMat);
    addShadowMesh(rightWallArt, new THREE.BoxGeometry(0.8, 1.0, 0.036), stdMat(0xebe6de, 0.88));
    const rightArtPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.74, 0.92),
      new THREE.MeshStandardMaterial({ map: sideArtTex, roughness: 0.76 })
    );
    rightArtPlane.position.z = 0.02;
    rightWallArt.add(rightArtPlane);

    // ==========================================
    // D. Architectural Upholstered Platform Bed, Channel-Tufted Headboard & Foot Bench (X = 1.25, Z = -1.85)
    // ==========================================
    const bedGroup = new THREE.Group();
    bedGroup.position.set(1.25, 0, -1.85);
    bedroomGroup.add(bedGroup);
    addContactShadowPlane(bedGroup, 1.96, 2.38, 0, 0.004, 0, 0.68);

    const mattressMat = physMat(0xefe9de, 0.8, 0, 0.02, {
      map: upholsteryWeaveTex,
      bumpMap: upholsteryWeaveTex,
      bumpScale: 0.005,
      normalMap: fabricWeaveNormalTex,
      normalScale: new THREE.Vector2(0.12, 0.12),
      sheen: 0.78,
      sheenRoughness: 0.72,
      sheenColor: new THREE.Color(0xfcf9f2),
    });
    const duvetMat = physMat(0xffffff, 0.82, 0, 0.03, {
      map: duvetWeaveTex,
      bumpMap: duvetWeaveTex,
      bumpScale: 0.008,
      normalMap: fabricWeaveNormalTex,
      normalScale: new THREE.Vector2(0.14, 0.14),
      sheen: 0.88,
      sheenRoughness: 0.66,
      sheenColor: new THREE.Color(0xb4c6d4),
    });
    const throwBlanketMat = physMat(0xffffff, 0.86, 0, 0.02, {
      map: throwKnitTex,
      bumpMap: throwKnitTex,
      bumpScale: 0.01,
      normalMap: ribbedKnitNormalTex,
      normalScale: new THREE.Vector2(0.18, 0.18),
      sheen: 0.92,
      sheenRoughness: 0.74,
      sheenColor: new THREE.Color(0xe69f85),
    });
    const creamSheetMat = physMat(0xf5efe6, 0.76, 0, 0.04, {
      map: ribbedTopTex,
      normalMap: fabricWeaveNormalTex,
      normalScale: new THREE.Vector2(0.1, 0.1),
      sheen: 0.84,
      sheenRoughness: 0.62,
      sheenColor: new THREE.Color(0xffffff),
    });

    // Upholstered Beveled Platform Bed Base & Low Block Feet
    addShadowMesh(bedGroup, new THREE.BoxGeometry(1.7, 0.24, 2.14), upholsterySecondaryMat).position.set(0, 0.15, 0);
    // Soft rounded side & foot rails
    [-0.84, 0.84].forEach((rx) => {
      const sideRail = addShadowMesh(
        bedGroup,
        new THREE.CapsuleGeometry(0.032, 2.08, 8, 14),
        upholsterySecondaryMat
      );
      sideRail.rotation.x = Math.PI / 2;
      sideRail.position.set(rx, 0.25, 0);
    });
    const footRail = addShadowMesh(
      bedGroup,
      new THREE.CapsuleGeometry(0.032, 1.64, 8, 14),
      upholsterySecondaryMat
    );
    footRail.rotation.z = Math.PI / 2;
    footRail.position.set(0, 0.25, 1.05);

    [
      [-0.78, -0.98],
      [0.78, -0.98],
      [-0.78, 0.98],
      [0.78, 0.98],
    ].forEach(([fx, fz]) => {
      addShadowMesh(bedGroup, new THREE.BoxGeometry(0.09, 0.06, 0.09), darkWoodMat).position.set(fx, 0.03, fz);
    });

    // Padded 5-Panel Channel-Tufted Headboard with Wing Border Frame (Images 1–6)
    addShadowMesh(bedGroup, new THREE.BoxGeometry(1.76, 1.24, 0.11), upholsterySecondaryMat).position.set(
      0,
      0.66,
      -1.04
    );
    // Left, Right & Top Upholstered Headboard Border Frame
    [-0.84, 0.84].forEach((hx) => {
      addShadowMesh(bedGroup, new THREE.CapsuleGeometry(0.048, 1.16, 10, 14), upholsteryMat).position.set(
        hx,
        0.66,
        -1.01
      );
    });
    const hbTopRail = addShadowMesh(
      bedGroup,
      new THREE.CapsuleGeometry(0.046, 1.66, 10, 14),
      upholsteryMat
    );
    hbTopRail.rotation.z = Math.PI / 2;
    hbTopRail.position.set(0, 1.25, -1.01);

    // 5 Channel-Tufted Padded Vertical Panels
    for (let p = 0; p < 5; p++) {
      const px = (p - 2) * 0.315;
      const panel = addShadowMesh(
        bedGroup,
        new THREE.CapsuleGeometry(0.145, 0.86, 10, 16),
        upholsteryMat
      );
      panel.scale.set(1.02, 1.0, 0.32);
      panel.position.set(px, 0.72, -0.975);
    }

    // Fitted Mattress Base (Top surface at exact Y = 0.49m for IK & preset parity)
    addShadowMesh(bedGroup, new THREE.BoxGeometry(1.58, 0.23, 1.98), mattressMat).position.set(0, 0.365, 0.01);
    const mattressTopPad = addShadowMesh(
      bedGroup,
      new THREE.CapsuleGeometry(0.77, 0.46, 12, 20),
      mattressMat
    );
    mattressTopPad.rotation.x = Math.PI / 2;
    mattressTopPad.scale.set(1.0, 1.0, 0.075);
    mattressTopPad.position.set(0, 0.462, 0.01);

    // Plush Draped Duvet with Side Overhang Folds + Folded Top Sheet Cuff
    addShadowMesh(bedGroup, new THREE.BoxGeometry(1.62, 0.245, 1.44), duvetMat).position.set(0, 0.37, 0.28);
    // Soft draped duvet overhang bolsters along left, right & front edges
    [-0.81, 0.81].forEach((dx) => {
      const sideDrape = addShadowMesh(
        bedGroup,
        new THREE.CapsuleGeometry(0.055, 1.38, 10, 14),
        duvetMat
      );
      sideDrape.rotation.x = Math.PI / 2;
      sideDrape.scale.set(0.65, 1.0, 1.35);
      sideDrape.position.set(dx, 0.34, 0.28);
    });
    const foldedSheetCuff = addShadowMesh(
      bedGroup,
      new THREE.CapsuleGeometry(0.1, 1.52, 10, 16),
      creamSheetMat
    );
    foldedSheetCuff.rotation.z = Math.PI / 2;
    foldedSheetCuff.scale.set(0.36, 1.0, 1.28);
    foldedSheetCuff.position.set(0, 0.486, -0.36);

    // Textured Foot Throw Blanket with Ribbed Folds (Images 1–6)
    addShadowMesh(bedGroup, new THREE.BoxGeometry(1.65, 0.255, 0.48), throwBlanketMat).position.set(0, 0.374, 0.74);
    [-0.58, 0.72, 0.86].forEach((fz) => {
      const foldRidge = addShadowMesh(
        bedGroup,
        new THREE.CapsuleGeometry(0.022, 1.58, 8, 12),
        throwBlanketMat
      );
      foldRidge.rotation.z = Math.PI / 2;
      foldRidge.position.set(0, 0.494, fz);
    });

    // 5 Sculpted Plump Layered Pillows (2 Rear Euro Pillows, 2 Mid Sleeping Pillows, 1 Center Lumbar Pillow; topY = 0.56m)
    const pillowBackL = createRoundedPillow(0.68, 0.2, 0.38, creamSheetMat);
    pillowBackL.position.set(-0.4, 0.58, -0.78);
    pillowBackL.rotation.x = 0.34;
    bedGroup.add(pillowBackL);

    const pillowBackR = createRoundedPillow(0.68, 0.2, 0.38, creamSheetMat);
    pillowBackR.position.set(0.4, 0.58, -0.78);
    pillowBackR.rotation.x = 0.34;
    bedGroup.add(pillowBackR);

    const pillowMidL = createRoundedPillow(0.58, 0.17, 0.34, duvetMat);
    pillowMidL.position.set(-0.37, 0.555, -0.56);
    pillowMidL.rotation.x = 0.2;
    pillowMidL.rotation.y = 0.04;
    bedGroup.add(pillowMidL);

    const pillowMidR = createRoundedPillow(0.58, 0.17, 0.34, duvetMat);
    pillowMidR.position.set(0.37, 0.555, -0.56);
    pillowMidR.rotation.x = 0.2;
    pillowMidR.rotation.y = -0.04;
    bedGroup.add(pillowMidR);

    const pillowCenterLumbar = createRoundedPillow(0.44, 0.14, 0.26, throwBlanketMat);
    pillowCenterLumbar.position.set(0, 0.545, -0.39);
    pillowCenterLumbar.rotation.x = 0.14;
    bedGroup.add(pillowCenterLumbar);

    // Upholstered Foot-of-Bed Bench with Draped Throw Blanket (Images 5 & 6)
    const footBenchGroup = new THREE.Group();
    footBenchGroup.position.set(0, 0, 1.32); // World Z = -0.53
    bedGroup.add(footBenchGroup);
    addContactShadowPlane(footBenchGroup, 1.36, 0.56, 0, 0.004, 0, 0.52);
    // Waterfall side legs + upholstered seat cushion
    [-0.54, 0.54].forEach((bx) => {
      addShadowMesh(footBenchGroup, new THREE.BoxGeometry(0.14, 0.36, 0.44), upholsterySecondaryMat).position.set(
        bx,
        0.18,
        0
      );
    });
    addShadowMesh(footBenchGroup, new THREE.BoxGeometry(1.24, 0.12, 0.46), upholsteryMat).position.set(0, 0.37, 0);
    // Draped throw over bench right half
    addShadowMesh(footBenchGroup, new THREE.BoxGeometry(0.42, 0.135, 0.48), throwBlanketMat).position.set(
      0.22,
      0.372,
      0
    );
    addShadowMesh(footBenchGroup, new THREE.BoxGeometry(0.4, 0.24, 0.035), throwBlanketMat).position.set(
      0.22,
      0.24,
      0.235
    );

    // ==========================================
    // E. Matching Pair of 2-Drawer Nightstands & Ceramic Table Lamps (Left & Right of Bed)
    // ==========================================
    const stringBulbMaterials: THREE.MeshStandardMaterial[] = [];
    const buildNightstandWithLamp = (nx: number, nz: number, isLeft: boolean) => {
      const nsGroup = new THREE.Group();
      nsGroup.position.set(nx, 0, nz);
      bedroomGroup.add(nsGroup);
      addContactShadowPlane(nsGroup, 0.64, 0.52, 0, 0.004, 0, 0.55);

      // Cabinet Body (W = 0.54m, H = 0.52m, D = 0.42m) on 4 short tapered feet
      addShadowMesh(nsGroup, new THREE.BoxGeometry(0.54, 0.46, 0.42), oakWoodMat).position.set(0, 0.29, 0);
      [
        [-0.22, -0.16],
        [0.22, -0.16],
        [-0.22, 0.16],
        [0.22, 0.16],
      ].forEach(([fx, fz]) => {
        addShadowMesh(nsGroup, new THREE.CylinderGeometry(0.018, 0.012, 0.06, 10), darkWoodMat).position.set(
          fx,
          0.03,
          fz
        );
      });

      // 2 Recessed Drawer Fronts + Brushed Metal Pulls
      [0.19, 0.39].forEach((dy) => {
        addShadowMesh(nsGroup, new THREE.BoxGeometry(0.48, 0.175, 0.018), upholsterySecondaryMat).position.set(
          0,
          dy,
          0.212
        );
        addShadowMesh(nsGroup, new THREE.BoxGeometry(0.11, 0.014, 0.025), brushedMetalMat).position.set(
          0,
          dy + 0.055,
          0.224
        );
      });

      // Sculpted Ceramic Urn Table Lamp + Glowing Warm Linen Drum Shade
      const lampBaseGeo = new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, 0.0),
          new THREE.Vector2(0.065, 0.0),
          new THREE.Vector2(0.095, 0.06),
          new THREE.Vector2(0.105, 0.13),
          new THREE.Vector2(0.072, 0.2),
          new THREE.Vector2(0.028, 0.24),
        ],
        20
      );
      const lampX = isLeft ? -0.06 : 0.06;
      addShadowMesh(nsGroup, lampBaseGeo, ceramicMat).position.set(lampX, 0.52, -0.02);

      const shadeMat = new THREE.MeshStandardMaterial({
        color: 0xf5efe6,
        emissive: 0xffd8a8,
        emissiveIntensity: 0.55,
        roughness: 0.72,
        side: THREE.DoubleSide,
      });
      stringBulbMaterials.push(shadeMat);
      const shadeMesh = addShadowMesh(
        nsGroup,
        new THREE.CylinderGeometry(0.135, 0.155, 0.2, 24, 1, true),
        shadeMat
      );
      shadeMesh.position.set(lampX, 0.84, -0.02);

      // Small Ceramic Vase / Book Accents on Nightstand
      const vaseX = isLeft ? 0.14 : -0.14;
      const nsVaseBody = addShadowMesh(
        nsGroup,
        new THREE.SphereGeometry(0.048, 14, 12),
        ceramicAccentMat
      );
      nsVaseBody.scale.set(0.85, 1.18, 0.85);
      nsVaseBody.position.set(vaseX, 0.57, 0.04);
      addShadowMesh(nsGroup, new THREE.CylinderGeometry(0.018, 0.024, 0.05, 12), ceramicAccentMat).position.set(
        vaseX,
        0.63,
        0.04
      );
    };

    buildNightstandWithLamp(0.08, -2.68, true);
    buildNightstandWithLamp(2.42, -2.68, false);

    // ==========================================
    // F. Window Seat Bench Nook (X = -2.74, Z = -1.85, topY = 0.44m)
    // ==========================================
    const windowBenchGroup = new THREE.Group();
    windowBenchGroup.position.set(-2.74, 0, -1.85);
    bedroomGroup.add(windowBenchGroup);
    addContactShadowPlane(windowBenchGroup, 0.56, 1.48, 0, 0.004, 0, 0.52);
    addShadowMesh(windowBenchGroup, new THREE.BoxGeometry(0.46, 0.36, 1.38), oakWoodMat).position.set(0, 0.18, 0);
    const benchCushion = addShadowMesh(
      windowBenchGroup,
      new THREE.CapsuleGeometry(0.21, 0.96, 10, 16),
      upholsteryMat
    );
    benchCushion.rotation.x = Math.PI / 2;
    benchCushion.scale.set(1.05, 1.0, 0.32);
    benchCushion.position.set(0, 0.39, 0);
    const benchPillow = createRoundedPillow(0.32, 0.24, 0.14, throwBlanketMat);
    benchPillow.position.set(-0.06, 0.52, -0.44);
    benchPillow.rotation.z = -0.25;
    benchPillow.rotation.y = 0.35;
    windowBenchGroup.add(benchPillow);

    // ==========================================
    // G. Seating Area & Architectural Console Table (Chair at X = -1.55, Z = 0.25, topY = 0.47m; Console at X = -2.35, Z = 0.25, topY = 0.76m)
    // ==========================================
    // 1. Architectural Console / Studio Table with Interlocking Ring Sculptural Base (X = -2.35, Z = 0.25, topY = 0.76m)
    const deskGroup = new THREE.Group();
    deskGroup.position.set(-2.35, 0, 0.25);
    bedroomGroup.add(deskGroup);
    addContactShadowPlane(deskGroup, 0.92, 1.72, 0, 0.004, 0, 0.56);

    // Beveled Architectural Tabletop (topY = 0.76m)
    addShadowMesh(deskGroup, new THREE.BoxGeometry(0.74, 0.052, 1.56), oakWoodMat).position.set(0, 0.734, 0);
    // Base Plinth
    addShadowMesh(deskGroup, new THREE.BoxGeometry(0.56, 0.04, 1.32), darkWoodMat).position.set(0, 0.02, 0);

    // Interlocking Sculptural Ring Supports beneath Tabletop (Inspired by Reference Images 5 & 6)
    [-0.44, 0.0, 0.44].forEach((rz, idx) => {
      const ringSupport = addShadowMesh(
        deskGroup,
        new THREE.TorusGeometry(0.31, 0.038, 14, 32),
        idx === 1 ? ceramicAccentMat : oakWoodMat
      );
      ringSupport.rotation.y = Math.PI / 2;
      ringSupport.position.set(0, 0.38, rz);
    });

    // Console Styling: Stacked Art Books, Ceramic Vessel with Botanical Stems & Warm Architectural Lamp
    addShadowMesh(deskGroup, new THREE.BoxGeometry(0.26, 0.036, 0.34), upholsteryMat).position.set(0.04, 0.778, 0.32);
    addShadowMesh(deskGroup, new THREE.BoxGeometry(0.22, 0.032, 0.29), throwBlanketMat).position.set(
      0.04,
      0.812,
      0.32
    );

    const consoleVaseGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.055, 0),
        new THREE.Vector2(0.082, 0.08),
        new THREE.Vector2(0.068, 0.17),
        new THREE.Vector2(0.032, 0.22),
      ],
      18
    );
    addShadowMesh(deskGroup, consoleVaseGeo, ceramicMat).position.set(-0.06, 0.76, -0.05);

    // Console Warm Lamp (Left-back of console)
    const consoleLampGroup = new THREE.Group();
    consoleLampGroup.position.set(-0.08, 0.76, -0.52);
    deskGroup.add(consoleLampGroup);
    addShadowMesh(consoleLampGroup, new THREE.CylinderGeometry(0.055, 0.07, 0.18, 16), ceramicAccentMat).position.set(
      0,
      0.09,
      0
    );
    const consoleShadeMat = new THREE.MeshStandardMaterial({
      color: 0xf5efe6,
      emissive: 0xffd8a8,
      emissiveIntensity: 0.65,
      roughness: 0.7,
    });
    stringBulbMaterials.push(consoleShadeMat);
    addShadowMesh(consoleLampGroup, new THREE.CylinderGeometry(0.11, 0.13, 0.16, 20), consoleShadeMat).position.set(
      0,
      0.26,
      0
    );

    // 2. Upholstered Architectural Club Armchair (X = -1.55, Z = 0.25, seat topY = 0.47m)
    const buildUpholsteredArmchair = (
      cx: number,
      cz: number,
      rotY: number,
      style: 'club_box' | 'curved_tub'
    ) => {
      const chair = new THREE.Group();
      chair.position.set(cx, 0, cz);
      chair.rotation.y = rotY;
      bedroomGroup.add(chair);
      addContactShadowPlane(chair, 0.78, 0.78, 0, 0.004, 0, 0.56);

      // Base Frame & 4 Tapered Block Legs
      addShadowMesh(chair, new THREE.BoxGeometry(0.64, 0.18, 0.62), upholsterySecondaryMat).position.set(0, 0.19, 0);
      [
        [-0.26, -0.25],
        [0.26, -0.25],
        [-0.26, 0.25],
        [0.26, 0.25],
      ].forEach(([lx, lz]) => {
        addShadowMesh(chair, new THREE.CylinderGeometry(0.026, 0.018, 0.1, 12), darkWoodMat).position.set(
          lx,
          0.05,
          lz
        );
      });

      // Plush Boxed Seat Cushion (topY = 0.47m)
      addShadowMesh(chair, new THREE.BoxGeometry(0.54, 0.16, 0.56), upholsteryMat).position.set(0, 0.36, 0.02);
      const seatTopPad = addShadowMesh(
        chair,
        new THREE.CapsuleGeometry(0.25, 0.08, 10, 16),
        upholsteryMat
      );
      seatTopPad.rotation.z = Math.PI / 2;
      seatTopPad.scale.set(0.24, 1.0, 1.04);
      seatTopPad.position.set(0, 0.415, 0.02);

      if (style === 'club_box') {
        // Angled Upholstered Backrest Cushion (Images 5 & 6)
        const backRest = addShadowMesh(chair, new THREE.BoxGeometry(0.56, 0.44, 0.14), upholsteryMat);
        backRest.position.set(0, 0.62, -0.23);
        backRest.rotation.x = -0.12;
        // Track Armrests
        [-0.31, 0.31].forEach((ax) => {
          addShadowMesh(chair, new THREE.BoxGeometry(0.11, 0.46, 0.62), upholsterySecondaryMat).position.set(
            ax,
            0.39,
            0
          );
        });
      } else {
        // Curved Barrel / Tub Armchair + Sculpted Pedestal Side Table (Images 2 & 4)
        const barrelBack = addShadowMesh(
          chair,
          new THREE.CylinderGeometry(0.36, 0.34, 0.52, 24, 1, true, Math.PI * 0.65, Math.PI * 1.7),
          upholsterySecondaryMat
        );
        barrelBack.position.set(0, 0.48, -0.02);
        const backPillow = createRoundedPillow(0.46, 0.32, 0.16, upholsteryMat);
        backPillow.position.set(0, 0.56, -0.18);
        backPillow.rotation.x = -0.15;
        chair.add(backPillow);
      }
      return chair;
    };

    // Primary Poseable Chair at (-1.55, 0.25) facing Console / Room
    buildUpholsteredArmchair(-1.55, 0.25, -Math.PI / 2, 'club_box');

    // Foreground Seating Corner Barrel Lounge Chair & Sculpted Turn-Lathe Side Table (Images 2 & 4)
    buildUpholsteredArmchair(-1.95, 1.55, Math.PI * 0.28, 'curved_tub');
    const pedestalTableGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.14, 0),
        new THREE.Vector2(0.11, 0.12),
        new THREE.Vector2(0.145, 0.22),
        new THREE.Vector2(0.095, 0.34),
        new THREE.Vector2(0.125, 0.44),
        new THREE.Vector2(0.185, 0.48),
        new THREE.Vector2(0.185, 0.51),
        new THREE.Vector2(0, 0.51),
      ],
      24
    );
    const pedestalTable = addShadowMesh(bedroomGroup, pedestalTableGeo, ceramicMat);
    pedestalTable.position.set(-1.38, 0, 1.36);
    addContactShadowPlane(bedroomGroup, 0.44, 0.44, -1.38, 0.004, 1.36, 0.48);

    // ==========================================
    // H. Open 5-Tier Architectural Ladder Bookshelf on Left Wall (X = -2.74, Z = 1.88)
    // ==========================================
    const bookcaseGroup = new THREE.Group();
    bookcaseGroup.position.set(-2.74, 0, 1.88);
    bookcaseGroup.rotation.y = Math.PI / 2;
    bedroomGroup.add(bookcaseGroup);
    addContactShadowPlane(bookcaseGroup, 1.18, 0.46, 0, 0.004, 0, 0.54);

    // 4 Vertical Ladder Uprights (Front & Back Stiles)
    [
      [-0.46, -0.14],
      [0.46, -0.14],
      [-0.46, 0.14],
      [0.46, 0.14],
    ].forEach(([sx, sz]) => {
      addShadowMesh(bookcaseGroup, new THREE.BoxGeometry(0.042, 2.18, 0.042), oakWoodMat).position.set(sx, 1.09, sz);
    });

    // 5 Open Horizontal Shelves + Curated Architectural Books & Ceramic Vases
    const bookTones = [0xd8d2c8, 0xc4bdb2, 0xb2aba0, 0xe4dfd6, 0x9e968b, 0xcdc6bc];
    [0.24, 0.68, 1.12, 1.56, 2.0].forEach((sy, shelfIdx) => {
      addShadowMesh(bookcaseGroup, new THREE.BoxGeometry(1.06, 0.036, 0.34), oakWoodMat).position.set(0, sy, 0);
      // Standing book cluster on left of shelf
      for (let b = 0; b < 6; b++) {
        const bh = 0.24 - (b % 3) * 0.025;
        addShadowMesh(
          bookcaseGroup,
          new THREE.BoxGeometry(0.038, bh, 0.21),
          stdMat(bookTones[(shelfIdx * 3 + b) % bookTones.length], 0.76)
        ).position.set(-0.36 + b * 0.042, sy + 0.018 + bh / 2, 0);
      }
      // Horizontal book stack or sculptural ceramic vessel on right of shelf
      if (shelfIdx % 2 === 0) {
        addShadowMesh(bookcaseGroup, new THREE.BoxGeometry(0.24, 0.035, 0.19), upholsteryMat).position.set(
          0.24,
          sy + 0.036,
          0
        );
        addShadowMesh(bookcaseGroup, new THREE.BoxGeometry(0.21, 0.032, 0.17), throwBlanketMat).position.set(
          0.24,
          sy + 0.07,
          0
        );
      } else {
        const shelfVase = addShadowMesh(
          bookcaseGroup,
          new THREE.SphereGeometry(0.085, 16, 14),
          ceramicMat
        );
        shelfVase.scale.set(0.95, 1.15, 0.95);
        shelfVase.position.set(0.22, sy + 0.11, 0);
      }
    });

    // ==========================================
    // I. Right Wall 9-Drawer Architectural Dresser Console & Full-Length Rounded-Arch Mirror
    // ==========================================
    // 1. 9-Drawer Dresser Console (X = 2.64, Z = -0.28, topY = 0.82m) (Images 1, 4, 5, 6)
    const dresserGroup = new THREE.Group();
    dresserGroup.position.set(2.64, 0, -0.28);
    dresserGroup.rotation.y = -Math.PI / 2;
    bedroomGroup.add(dresserGroup);
    addContactShadowPlane(dresserGroup, 1.78, 0.58, 0, 0.004, 0, 0.58);

    addShadowMesh(dresserGroup, new THREE.BoxGeometry(1.66, 0.74, 0.48), oakWoodMat).position.set(0, 0.43, 0);
    // 4 Short Block Feet
    [
      [-0.76, -0.19],
      [0.76, -0.19],
      [-0.76, 0.19],
      [0.76, 0.19],
    ].forEach(([fx, fz]) => {
      addShadowMesh(dresserGroup, new THREE.BoxGeometry(0.06, 0.06, 0.06), darkWoodMat).position.set(fx, 0.03, fz);
    });

    // 3 Columns × 3 Rows of Recessed Drawer Fronts
    [-0.52, 0, 0.52].forEach((dx) => {
      [0.2, 0.43, 0.66].forEach((dy) => {
        addShadowMesh(dresserGroup, new THREE.BoxGeometry(0.5, 0.21, 0.018), upholsterySecondaryMat).position.set(
          dx,
          dy,
          0.242
        );
        addShadowMesh(dresserGroup, new THREE.BoxGeometry(0.09, 0.012, 0.024), brushedMetalMat).position.set(
          dx,
          dy + 0.075,
          0.252
        );
      });
    });

    // Dresser Top Decor: Round Ceramic Vase with Branches, Stacked Hardcover Books & 3 Nested Bowls (Image 1)
    const dresserVase = addShadowMesh(
      dresserGroup,
      new THREE.SphereGeometry(0.11, 18, 16),
      ceramicMat
    );
    dresserVase.scale.set(0.95, 1.12, 0.95);
    dresserVase.position.set(-0.56, 0.91, 0);
    addShadowMesh(dresserGroup, new THREE.CylinderGeometry(0.035, 0.048, 0.07, 14), ceramicMat).position.set(
      -0.56,
      1.03,
      0
    );
    // Stacked books in center-left of dresser
    addShadowMesh(dresserGroup, new THREE.BoxGeometry(0.28, 0.034, 0.21), upholsteryMat).position.set(-0.18, 0.817, 0.02);
    addShadowMesh(dresserGroup, new THREE.BoxGeometry(0.25, 0.03, 0.19), throwBlanketMat).position.set(-0.18, 0.85, 0.02);
    // Decorative bowls on right side of dresser
    [
      [0.26, 0.055],
      [0.42, 0.045],
      [0.58, 0.075],
    ].forEach(([bx, br]) => {
      const bowl = addShadowMesh(
        dresserGroup,
        new THREE.SphereGeometry(br, 16, 12, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55),
        ceramicAccentMat
      );
      bowl.position.set(bx, 0.8 + br * 0.85, 0.02);
    });

    // 2. Full-Length Rounded-Arch Floor Mirror Leaning on Right Wall (X = 2.78, Z = 1.28) (Images 1 & 4)
    const mirrorGroup = new THREE.Group();
    mirrorGroup.position.set(2.78, 0, 1.28);
    mirrorGroup.rotation.y = -Math.PI / 2;
    mirrorGroup.rotation.x = -0.075; // Subtle realistic wall lean
    bedroomGroup.add(mirrorGroup);
    addContactShadowPlane(mirrorGroup, 0.86, 0.28, 0, 0.004, 0, 0.5);

    // Mirror Backing & Reflective Glass Surface
    addShadowMesh(mirrorGroup, new THREE.BoxGeometry(0.78, 1.88, 0.036), frameMat).position.set(0, 0.94, 0);
    const mirrorGlassMat = physMat(0xdce2e8, 0.05, 0.92, 1.0);
    const mirrorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.82), mirrorGlassMat);
    mirrorGlass.position.set(0, 0.94, 0.02);
    mirrorGroup.add(mirrorGlass);
    // Top Rounded Arch Header
    const mirrorArch = addShadowMesh(
      mirrorGroup,
      new THREE.TorusGeometry(0.37, 0.024, 10, 28, Math.PI),
      brushedMetalMat
    );
    mirrorArch.scale.set(1.04, 0.35, 1.0);
    mirrorArch.position.set(0, 1.86, 0.01);

    // ==========================================
    // J. Sculpted Potted Indoor Plants (Window Corner & Front-Right Mirror Corner)
    // ==========================================
    const buildArchitecturalPlant = (px: number, pz: number, scale = 1, tieredPot = false) => {
      const pGroup = new THREE.Group();
      pGroup.position.set(px, 0, pz);
      pGroup.scale.setScalar(scale);
      bedroomGroup.add(pGroup);
      addContactShadowPlane(pGroup, 0.52, 0.52, 0, 0.004, 0, 0.5);

      if (tieredPot) {
        const potGeo = new THREE.LatheGeometry(
          [
            new THREE.Vector2(0, 0),
            new THREE.Vector2(0.14, 0),
            new THREE.Vector2(0.15, 0.16),
            new THREE.Vector2(0.21, 0.2),
            new THREE.Vector2(0.22, 0.44),
            new THREE.Vector2(0.19, 0.44),
          ],
          20
        );
        addShadowMesh(pGroup, potGeo, ceramicMat);
      } else {
        addShadowMesh(pGroup, new THREE.CylinderGeometry(0.21, 0.18, 0.4, 22), ceramicMat).position.set(0, 0.2, 0);
      }
      addShadowMesh(pGroup, new THREE.CylinderGeometry(0.18, 0.18, 0.03, 16), stdMat(0x6e6256, 0.95)).position.set(
        0,
        0.4,
        0
      );

      const leafMat = stdMat(0x4f7d58, 0.62); // Rich natural botanical sage-forest foliage tone
      const stemMat = stdMat(0x5c4938, 0.78);
      for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.2;
        const branch = new THREE.Group();
        branch.position.set(0, 0.4, 0);
        branch.rotation.y = angle;
        pGroup.add(branch);

        const stemH = 0.34 + (i % 4) * 0.14;
        const spread = 0.08 + (i % 3) * 0.055;
        const stem = addShadowMesh(branch, new THREE.CylinderGeometry(0.006, 0.009, stemH, 6), stemMat);
        stem.position.set(0, stemH * 0.5, spread * 0.45);
        stem.rotation.x = 0.24 + (i % 3) * 0.12;

        const leaf = addShadowMesh(branch, new THREE.SphereGeometry(0.085, 10, 8), leafMat);
        leaf.scale.set(0.58, 1.48, 0.16);
        leaf.position.set(0, stemH, spread);
        leaf.rotation.x = 0.48 + (i % 2) * 0.22;
      }
    };

    // Plant 1: Left Window / Bookshelf Corner (Images 2, 4, 5, 6)
    buildArchitecturalPlant(-2.62, -1.08, 0.96, true);
    // Plant 2: Front-Right Corner beside Floor Mirror (Images 1 & 4)
    buildArchitecturalPlant(2.64, 2.18, 0.92, false);

    lightingRigRef.current = {
      hemiLight,
      keyLight,
      fillLight,
      rimLight,
      deskLampLight,
      windowAreaLight,
      ceilingSoftboxLight,
      windowGoboMat,
      skyPanes: [leftSkyMat, backSkyMat],
      stringBulbMaterials,
    };

    // Immediately apply the active lighting preset on mount so the bedroom appearance is 100% consistent
    syncSceneLightingAndBackground(environmentRef.current, effectiveLightingRef.current);

    // ==========================================
    // Explicit Support Surface Colliders, Raycast Meshes & 3D Furniture Hotspots (Phase 2B & Phase 5)
    // ==========================================
    const supportCollidersGroup = new THREE.Group();
    bedroomGroup.add(supportCollidersGroup);
    const supportHighlightMeshes = new Map<PlayboardSupportSurfaceId, THREE.Mesh>();
    const furnitureRaycastMeshes: THREE.Object3D[] = [];

    STUDIO_BEDROOM_SUPPORT_SURFACES.forEach((surf) => {
      if (surf.id === 'floor') return;
      const w = surf.maxX - surf.minX;
      const d = surf.maxZ - surf.minZ;
      const cx = (surf.minX + surf.maxX) * 0.5;
      const cz = (surf.minZ + surf.maxZ) * 0.5;
      const ringMat = new THREE.MeshBasicMaterial({
        color:
          surf.id === 'bed_mattress' || surf.id === 'bed_pillow'
            ? 0x10b981
            : surf.id === 'chair_seat'
            ? 0xf59e0b
            : 0x38bdf8,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const highlightPlane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ringMat);
      highlightPlane.rotation.x = -Math.PI / 2;
      highlightPlane.position.set(cx, surf.topY + 0.006, cz);
      highlightPlane.userData = {
        supportSurfaceId: surf.id,
        surfaceId: surf.id,
        supportSurfaceLabel: surf.label,
      };
      supportCollidersGroup.add(highlightPlane);
      supportHighlightMeshes.set(surf.id, highlightPlane);
      furnitureRaycastMeshes.push(highlightPlane);
    });

    // Visible, Discoverable 3D Furniture Anchor Hotspot Markers
    const hotspotMarkersGroup = new THREE.Group();
    bedroomGroup.add(hotspotMarkersGroup);
    const hotspotHitMeshes: THREE.Mesh[] = [];
    const hotspotVisualNodes: {
      hotspot: FurnitureAnchorHotspot;
      group: THREE.Group;
      ringMat: THREE.MeshBasicMaterial;
      diamondMat: THREE.MeshBasicMaterial;
      diamondMesh: THREE.Mesh;
      baseColor: number;
    }[] = [];

    FURNITURE_ANCHOR_HOTSPOTS.forEach((hotspot) => {
      const hGroup = new THREE.Group();
      hGroup.position.set(hotspot.x, hotspot.topY + 0.012, hotspot.z);
      hotspotMarkersGroup.add(hGroup);

      const baseColor =
        hotspot.surfaceId === 'bed_mattress' || hotspot.surfaceId === 'bed_pillow'
          ? 0x10b981
          : hotspot.surfaceId === 'chair_seat' || hotspot.surfaceId === 'window_bench'
          ? 0xf59e0b
          : 0x38bdf8;

      const ringMat = new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.085, 0.125, 28), ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      hGroup.add(ringMesh);

      const diamondMat = new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.88,
      });
      const diamondMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.036, 0), diamondMat);
      diamondMesh.position.y = 0.065;
      diamondMesh.scale.set(0.85, 1.35, 0.85);
      hGroup.add(diamondMesh);

      // Invisible generous hit-sphere for reliable mouse & touch selection
      const hitMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 10, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitMesh.position.y = 0.05;
      hitMesh.userData = {
        hotspotId: hotspot.id,
        hotspotLabel: hotspot.label,
        supportSurfaceId: hotspot.surfaceId,
        surfaceId: hotspot.surfaceId,
        hotspotData: hotspot,
      };
      hGroup.add(hitMesh);
      hotspotHitMeshes.push(hitMesh);

      hotspotVisualNodes.push({
        hotspot,
        group: hGroup,
        ringMat,
        diamondMat,
        diamondMesh,
        baseColor,
      });
    });

    // ==========================================
    // 2. Minimal Studio Environment
    // ==========================================
    const minimalGroup = new THREE.Group();
    minimalGroupRef.current = minimalGroup;
    scene.add(minimalGroup);
    minimalGroup.visible = environment === 'minimal_neutral';

    const studioFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      stdMat(0x20232a, 0.65)
    );
    studioFloor.rotation.x = -Math.PI / 2;
    studioFloor.receiveShadow = !isSoftwareGl;
    minimalGroup.add(studioFloor);

    const studioTurntable = addShadowMesh(
      minimalGroup,
      new THREE.CylinderGeometry(1.75, 1.85, 0.06, 48),
      stdMat(0x2c313c, 0.4, 0.25)
    );
    studioTurntable.position.y = 0.03;

    const turntableRing = new THREE.Mesh(
      new THREE.RingGeometry(1.68, 1.72, 48),
      new THREE.MeshBasicMaterial({ color: 0x6366f1, side: THREE.DoubleSide })
    );
    turntableRing.rotation.x = -Math.PI / 2;
    turntableRing.position.y = 0.062;
    minimalGroup.add(turntableRing);

    // ==========================================
    // 3. Cyber Grid Environment
    // ==========================================
    const cyberGroup = new THREE.Group();
    cyberGroupRef.current = cyberGroup;
    scene.add(cyberGroup);
    cyberGroup.visible = environment === 'cyber_grid';

    const gridHelper = new THREE.GridHelper(12, 24, 0x38bdf8, 0x1e293b);
    gridHelper.position.y = 0.005;
    cyberGroup.add(gridHelper);

    const cyberPedestal = addShadowMesh(
      cyberGroup,
      new THREE.CylinderGeometry(1.5, 1.58, 0.04, 48),
      stdMat(0x0f172a, 0.25, 0.75)
    );
    cyberPedestal.position.y = 0.02;

    // ==========================================
    // 4. Sculpted Stylized Humanoid Rig (Phase 4 Upgrade: LatheGeometry & Capsule Silhouettes)
    // ==========================================
    const buildLatheSegment = (
      profile: [number, number][],
      scaleX: number,
      scaleZ: number,
      segments = 24
    ) => {
      const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
      const geo = new THREE.LatheGeometry(pts, segments);
      geo.scale(scaleX, 1, scaleZ);
      geo.computeVertexNormals();
      return geo;
    };

    // Procedural Radial Iris Albedo Map (Limbal Ring + Radial Stroma Fibers + Collarette + Pupil)
    const createIrisDetailTexture = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      if (ctx) {
        const cx = 64;
        const cy = 64;
        // Base hazel-amber gradient with dark outer limbal ring
        const rad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 62);
        rad.addColorStop(0.0, '#070606');
        rad.addColorStop(0.32, '#0b0909');
        rad.addColorStop(0.38, '#8a5a32');
        rad.addColorStop(0.66, '#5c3d24');
        rad.addColorStop(0.86, '#382516');
        rad.addColorStop(0.96, '#1c120b');
        rad.addColorStop(1.0, '#120b07');
        ctx.fillStyle = rad;
        ctx.fillRect(0, 0, 128, 128);

        // Radial iris stroma fibers
        for (let i = 0; i < 72; i++) {
          const ang = (i / 72) * Math.PI * 2;
          const rIn = 22 + (i % 3) * 2;
          const rOut = 56 - (i % 4) * 2;
          ctx.strokeStyle =
            i % 2 === 0 ? 'rgba(212, 158, 98, 0.34)' : 'rgba(42, 26, 14, 0.38)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn);
          ctx.lineTo(cx + Math.cos(ang) * rOut, cy + Math.sin(ang) * rOut);
          ctx.stroke();
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const irisDetailTex = createIrisDetailTexture();

    const buildStylizedHumanRig = (
      isGhost = false,
      ghostMaterial?: THREE.Material
    ): StylizedHumanRig => {
      const root = new THREE.Group();
      scene.add(root);

      // Soft multi-lobe radial contact shadow beneath character (elevates dynamically to bed/chair surface)
      const shadowCanvas = document.createElement('canvas');
      shadowCanvas.width = shadowCanvas.height = 128;
      const sctx = shadowCanvas.getContext('2d');
      if (sctx) {
        const grad = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
        grad.addColorStop(0, isGhost ? 'rgba(56,189,248,0.24)' : 'rgba(12,9,6,0.54)');
        grad.addColorStop(0.42, isGhost ? 'rgba(56,189,248,0.12)' : 'rgba(12,9,6,0.28)');
        grad.addColorStop(0.75, isGhost ? 'rgba(56,189,248,0.04)' : 'rgba(12,9,6,0.09)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = grad;
        sctx.fillRect(0, 0, 128, 128);
      }
      const contactShadowTex = new THREE.CanvasTexture(shadowCanvas);
      const contactShadow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.96, 0.96),
        new THREE.MeshBasicMaterial({
          map: contactShadowTex,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      );
      contactShadow.rotation.x = -Math.PI / 2;
      contactShadow.position.y = 0.012;
      root.add(contactShadow);

      // Dynamic Furniture Cushion / Mattress Weight Indentation Ring (visible when seated or lying on soft furniture)
      const indentCanvas = document.createElement('canvas');
      indentCanvas.width = indentCanvas.height = 128;
      const iCtx = indentCanvas.getContext('2d');
      if (iCtx) {
        const iGrad = iCtx.createRadialGradient(64, 64, 8, 64, 64, 60);
        iGrad.addColorStop(0.0, 'rgba(28, 22, 16, 0.42)');
        iGrad.addColorStop(0.52, 'rgba(42, 34, 25, 0.24)');
        iGrad.addColorStop(0.78, 'rgba(255, 250, 242, 0.14)'); // Subtle crease rim highlight around compressed fabric
        iGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        iCtx.fillStyle = iGrad;
        iCtx.fillRect(0, 0, 128, 128);
      }
      const indentTex = new THREE.CanvasTexture(indentCanvas);
      const cushionIndentMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.64, 0.58),
        new THREE.MeshBasicMaterial({
          map: indentTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      );
      cushionIndentMesh.rotation.x = -Math.PI / 2;
      cushionIndentMesh.position.y = 0.014;
      cushionIndentMesh.visible = !isGhost;
      root.add(cushionIndentMesh);

      // Dedicated Left & Right Foot Grounding Contact Shadow Discs
      const createFootShadowMesh = () => {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.28, 0.34),
          new THREE.MeshBasicMaterial({
            map: contactShadowTex,
            transparent: true,
            opacity: isGhost ? 0 : 0.48,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.005;
        m.visible = !isGhost;
        root.add(m);
        return m;
      };
      const leftFootShadow = createFootShadowMesh();
      const rightFootShadow = createFootShadowMesh();

      // Next-Gen Photorealistic Character Materials (Subsurface Skin Albedo + Normal, Corneal Eyes, Anisotropic Multi-Tone Hair, Ribbed Knit & Terry Textiles)
      const skinMat =
        ghostMaterial ||
        physMat(0xffffff, 0.42, 0.0, 0.18, {
          map: skinAlbedoTex,
          bumpMap: skinAlbedoTex,
          bumpScale: 0.0025,
          clearcoatRoughness: 0.32,
          ior: 1.42,
          sheen: 0.42,
          sheenRoughness: 0.42,
          sheenColor: new THREE.Color(0xf48b72), // Subsurface dermal warm blood backscatter
          specularIntensity: 0.9,
          specularColor: new THREE.Color(0xfff5ec),
          normalMap: skinNormalTex,
          normalScale: new THREE.Vector2(0.12, 0.12),
        });
      const lipMat =
        ghostMaterial ||
        physMat(0xc96b63, 0.28, 0.0, 0.52, {
          clearcoatRoughness: 0.18,
          sheen: 0.32,
          sheenRoughness: 0.32,
          sheenColor: new THREE.Color(0xf29c94),
          normalMap: skinNormalTex,
          normalScale: new THREE.Vector2(0.08, 0.08),
        });
      const nailMat =
        ghostMaterial ||
        physMat(0xf3dad0, 0.18, 0.0, 0.85, {
          clearcoatRoughness: 0.1,
          ior: 1.48,
        });
      const hairMat =
        ghostMaterial ||
        physMat(0xffffff, 0.44, 0.05, 0.32, {
          map: hairAlbedoTex,
          bumpMap: hairAlbedoTex,
          bumpScale: 0.006,
          clearcoatRoughness: 0.28,
          anisotropy: 0.78,
          anisotropyRotation: Math.PI * 0.5,
          sheen: 0.48,
          sheenRoughness: 0.44,
          sheenColor: new THREE.Color(0x825b44),
          normalMap: hairStrandNormalTex,
          normalScale: new THREE.Vector2(0.22, 0.22),
        });
      const browMat =
        ghostMaterial ||
        physMat(0x281d19, 0.68, 0.0, 0.1, {
          sheen: 0.3,
          sheenColor: new THREE.Color(0x4a3730),
        });
      const eyeWhiteMat =
        ghostMaterial ||
        physMat(0xfcfaf7, 0.08, 0.0, 0.88, {
          clearcoatRoughness: 0.04,
          ior: 1.38,
          sheen: 0.18,
          sheenColor: new THREE.Color(0xfce4de),
        });
      const irisMat =
        ghostMaterial ||
        new THREE.MeshPhysicalMaterial({
          map: irisDetailTex,
          roughness: 0.12,
          metalness: 0.0,
          clearcoat: 0.95,
          clearcoatRoughness: 0.03,
          ior: 1.4,
        });
      const lashMat = ghostMaterial || stdMat(0x1c1410, 0.65);
      // Warm Alabaster Ribbed Camisole Crop Top & Warm Stone French-Terry Lounge Joggers
      const topMat =
        ghostMaterial ||
        physMat(0xffffff, 0.72, 0.0, 0.04, {
          map: ribbedTopTex,
          bumpMap: ribbedTopTex,
          bumpScale: 0.006,
          normalMap: ribbedKnitNormalTex,
          normalScale: new THREE.Vector2(0.2, 0.2),
          sheen: 0.72,
          sheenRoughness: 0.62,
          sheenColor: new THREE.Color(0xfaf6f0),
        });
      const accentTrimMat =
        ghostMaterial ||
        physMat(0xd8cfc4, 0.74, 0.01, 0.04, {
          map: ribbedTopTex,
          normalMap: ribbedKnitNormalTex,
          normalScale: new THREE.Vector2(0.16, 0.16),
          sheen: 0.62,
          sheenRoughness: 0.68,
          sheenColor: new THREE.Color(0xf2ece4),
        });
      const pantsMat =
        ghostMaterial ||
        physMat(0xffffff, 0.76, 0.01, 0.03, {
          map: terryPantsTex,
          bumpMap: terryPantsTex,
          bumpScale: 0.007,
          normalMap: fabricWeaveNormalTex,
          normalScale: new THREE.Vector2(0.18, 0.18),
          sheen: 0.78,
          sheenRoughness: 0.72,
          sheenColor: new THREE.Color(0xb8afa6),
        });
      const pantsCuffMat =
        ghostMaterial ||
        physMat(0x787069, 0.78, 0.01, 0.03, {
          map: terryPantsTex,
          normalMap: ribbedKnitNormalTex,
          normalScale: new THREE.Vector2(0.18, 0.18),
          sheen: 0.7,
          sheenRoughness: 0.78,
          sheenColor: new THREE.Color(0xa69e95),
        });
      const shoeWhiteMat =
        ghostMaterial ||
        physMat(0xe5dfd7, 0.44, 0.02, 0.22, {
          sheen: 0.35,
          sheenColor: new THREE.Color(0xf7f4ef),
        });
      const shoeSoleMat = ghostMaterial || stdMat(0xb8afa4, 0.68);

      const bones: THREE.Bone[] = [];
      const createBone = (name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
        const b = new THREE.Bone();
        b.name = name;
        b.position.set(x, y, z);
        parent.add(b);
        bones.push(b);
        return b;
      };

      // --- Core Spine Hierarchy (Exact Bone Offsets Preserved for Landmark & Solver Parity) ---
      const pelvis = createBone('Pelvis', root, 0, 0.88, 0);
      const spine = createBone('Spine', pelvis, 0, 0.12, 0);
      const chest = createBone('Chest', spine, 0, 0.18, 0);
      const neck = createBone('Neck', chest, 0, 0.24, 0);
      const head = createBone('Head', neck, 0, 0.09, 0);

      // Sculpted Pelvis & High-Waisted Lounge Pants Hips (Smooth Lathe + Gluteal Contours)
      const pelvisGeo = buildLatheSegment(
        [
          [0.09, -0.055],
          [0.136, -0.025],
          [0.152, 0.015],
          [0.148, 0.065],
          [0.128, 0.115],
          [0.12, 0.138],
        ],
        1.0,
        0.75,
        28
      );
      addShadowMesh(pelvis, pelvisGeo, pantsMat);

      // Subtle Sculpted Hip/Glute Spheres for smooth profile in side/all-fours poses
      [-1, 1].forEach((side) => {
        const hipCurve = addShadowMesh(
          pelvis,
          new THREE.SphereGeometry(0.084, 20, 18),
          pantsMat
        );
        hipCurve.scale.set(0.94, 1.08, 0.98);
        hipCurve.position.set(side * 0.064, 0.005, -0.024);
      });

      // High-Waisted Gathered Elastic Lounge Waistband + Bow-Tied Drawstring (Reference Images 2, 3, 5, 6)
      const beltMesh = addShadowMesh(
        pelvis,
        new THREE.CylinderGeometry(0.126, 0.134, 0.036, 28),
        pantsCuffMat
      );
      beltMesh.scale.set(1.01, 1.0, 0.75);
      beltMesh.position.set(0, 0.112, 0);

      // Drawstring knot, bow loops & hanging cords at center front of waistband
      const knotMesh = addShadowMesh(pelvis, new THREE.SphereGeometry(0.011, 10, 10), accentTrimMat);
      knotMesh.position.set(0, 0.112, 0.098);
      [-1, 1].forEach((side) => {
        const bowLoop = addShadowMesh(
          pelvis,
          new THREE.TorusGeometry(0.014, 0.0038, 8, 14),
          accentTrimMat
        );
        bowLoop.scale.set(1.2, 0.72, 0.65);
        bowLoop.rotation.z = side * 0.35;
        bowLoop.position.set(side * 0.016, 0.114, 0.099);

        const cord = addShadowMesh(
          pelvis,
          new THREE.CapsuleGeometry(0.0036, 0.055, 6, 8),
          accentTrimMat
        );
        cord.position.set(side * 0.012, 0.078, 0.101);
        cord.rotation.z = side * 0.14;
        cord.rotation.x = 0.08;
      });

      // Sculpted Exposed Midriff & Natural Waist (Smooth inward waist taper into lower ribcage)
      const waistGeo = buildLatheSegment(
        [
          [0.122, -0.015],
          [0.113, 0.045],
          [0.117, 0.105],
          [0.132, 0.165],
          [0.136, 0.195],
        ],
        1.0,
        0.7,
        28
      );
      addShadowMesh(spine, waistGeo, skinMat);

      // Subtle anatomical navel & oblique abdominal contour on exposed midriff
      const navelIndent = addShadowMesh(
        spine,
        new THREE.SphereGeometry(0.0055, 10, 10),
        skinMat
      );
      navelIndent.scale.set(0.85, 1.35, 0.45);
      navelIndent.position.set(0, 0.036, 0.079);

      // Sculpted Upper Back, Neck Base & Clavicle Region (Natural Skin above Scooped Camisole)
      const upperChestSkinGeo = buildLatheSegment(
        [
          [0.148, 0.135],
          [0.158, 0.175],
          [0.138, 0.215],
          [0.07, 0.242],
        ],
        1.0,
        0.72,
        28
      );
      addShadowMesh(chest, upperChestSkinGeo, skinMat);

      // Anatomical Collarbones (Clavicle Ridges) & Subtle Upper-Back Scapulae
      [-1, 1].forEach((side) => {
        const clavicleRidge = addShadowMesh(
          chest,
          new THREE.CapsuleGeometry(0.0075, 0.082, 8, 12),
          skinMat
        );
        clavicleRidge.rotation.z = Math.PI / 2 + side * -0.14;
        clavicleRidge.rotation.y = side * -0.22;
        clavicleRidge.position.set(side * 0.052, 0.196, 0.068);

        const scapula = addShadowMesh(
          chest,
          new THREE.SphereGeometry(0.046, 14, 12),
          skinMat
        );
        scapula.scale.set(0.75, 1.18, 0.36);
        scapula.position.set(side * 0.056, 0.142, -0.078);
      });

      // Fitted Scooped-Neck Camisole Crop Top Bodice (Lower edge at ribcage, scooped neckline)
      const camisoleBodiceGeo = buildLatheSegment(
        [
          [0.135, -0.008],
          [0.147, 0.052],
          [0.16, 0.118],
          [0.155, 0.152],
        ],
        1.01,
        0.74,
        28
      );
      addShadowMesh(chest, camisoleBodiceGeo, topMat);

      // Ribbed bottom hem band of the camisole crop top
      const cropHemRing = addShadowMesh(
        chest,
        new THREE.CylinderGeometry(0.138, 0.135, 0.018, 28),
        accentTrimMat
      );
      cropHemRing.scale.set(1.01, 1.0, 0.74);
      cropHemRing.position.set(0, 0.002, 0);

      // Natural Sculpted Female Bust Drape in Fitted Camisole Top (Seamless Continuous Bridge — No Floating Spheres)
      const bustBridge = addShadowMesh(
        chest,
        new THREE.CapsuleGeometry(0.052, 0.086, 14, 20),
        topMat
      );
      bustBridge.rotation.z = Math.PI / 2;
      bustBridge.scale.set(0.86, 1.0, 0.62);
      bustBridge.position.set(0, 0.106, 0.044);

      [-1, 1].forEach((side) => {
        const chestContour = addShadowMesh(
          chest,
          new THREE.SphereGeometry(0.068, 22, 20),
          topMat
        );
        chestContour.scale.set(1.04, 0.88, 0.72);
        chestContour.position.set(side * 0.052, 0.106, 0.036);

        // Over-the-shoulder camisole straps connecting front bodice to back bodice
        const frontStrap = addShadowMesh(
          chest,
          new THREE.CapsuleGeometry(0.0085, 0.078, 8, 12),
          topMat
        );
        frontStrap.scale.set(1.35, 1.0, 0.48);
        frontStrap.position.set(side * 0.074, 0.176, 0.058);
        frontStrap.rotation.x = -0.52;
        frontStrap.rotation.z = side * -0.12;

        const topShoulderStrap = addShadowMesh(
          chest,
          new THREE.CapsuleGeometry(0.0085, 0.058, 8, 12),
          topMat
        );
        topShoulderStrap.scale.set(1.35, 1.0, 0.48);
        topShoulderStrap.rotation.x = Math.PI / 2;
        topShoulderStrap.position.set(side * 0.082, 0.214, 0.004);

        const backStrap = addShadowMesh(
          chest,
          new THREE.CapsuleGeometry(0.0085, 0.074, 8, 12),
          topMat
        );
        backStrap.scale.set(1.35, 1.0, 0.48);
        backStrap.position.set(side * 0.074, 0.174, -0.056);
        backStrap.rotation.x = 0.48;
        backStrap.rotation.z = side * -0.1;
      });

      // Smooth Clavicle & Trapezius Shoulder Bridge (Natural Skin)
      const shoulderYoke = addShadowMesh(
        chest,
        new THREE.CapsuleGeometry(0.066, 0.24, 16, 22),
        skinMat
      );
      shoulderYoke.rotation.z = Math.PI / 2;
      shoulderYoke.scale.set(0.92, 1.0, 0.84);
      shoulderYoke.position.set(0, 0.195, -0.004);

      // Scooped Camisole Front Neckline Trim
      const collarRing = addShadowMesh(
        chest,
        new THREE.TorusGeometry(0.078, 0.0075, 10, 26, Math.PI),
        accentTrimMat
      );
      collarRing.rotation.x = Math.PI + 0.35;
      collarRing.scale.set(1.05, 0.55, 0.85);
      collarRing.position.set(0, 0.156, 0.088);

      // Graceful Tapered Neck with Sternocleidomastoid Transition
      const neckGeo = buildLatheSegment(
        [
          [0.056, -0.015],
          [0.048, 0.035],
          [0.045, 0.085],
          [0.047, 0.115],
        ],
        1.0,
        0.92,
        24
      );
      addShadowMesh(neck, neckGeo, skinMat);

      // --- Sculpted Head, Wavy Shoulder-Skimming Hair, Corneal Gaze Eyes & Expression Rig ---
      const craniumGroup = new THREE.Group();
      craniumGroup.position.set(0, 0.105, 0);
      head.add(craniumGroup);

      // Cranium + Sculpted Cheekbones + Tapered Jaw/Chin Composite
      const skull = addShadowMesh(
        craniumGroup,
        new THREE.SphereGeometry(0.112, 32, 28),
        skinMat
      );
      skull.scale.set(0.92, 1.06, 0.97);
      skull.position.set(0, 0.01, -0.004);

      const faceMask = addShadowMesh(
        craniumGroup,
        new THREE.CapsuleGeometry(0.073, 0.052, 18, 24),
        skinMat
      );
      faceMask.position.set(0, -0.028, 0.018);
      faceMask.scale.set(0.95, 0.94, 0.92);

      // Subtle Zygomatic Cheekbone Contours for realistic portrait lighting falloff
      [-1, 1].forEach((side) => {
        const cheekbone = addShadowMesh(
          craniumGroup,
          new THREE.SphereGeometry(0.036, 16, 14),
          skinMat
        );
        cheekbone.scale.set(0.95, 0.74, 0.85);
        cheekbone.position.set(side * 0.052, -0.014, 0.068);
      });

      const chin = addShadowMesh(
        craniumGroup,
        new THREE.SphereGeometry(0.043, 18, 16),
        skinMat
      );
      chin.scale.set(0.86, 0.82, 0.92);
      chin.position.set(0, -0.068, 0.042);

      // Delicate Sculpted Ears with Helix Rim
      [-1, 1].forEach((side) => {
        const ear = addShadowMesh(
          craniumGroup,
          new THREE.SphereGeometry(0.023, 14, 12),
          skinMat
        );
        ear.scale.set(0.42, 1.12, 0.72);
        ear.position.set(side * 0.103, -0.008, -0.004);
        ear.rotation.y = side * -0.22;
      });

      // Sculpted Nose Bridge, Soft Nose Tip & Alar Wings
      const noseBridge = addShadowMesh(
        craniumGroup,
        new THREE.CapsuleGeometry(0.0105, 0.028, 10, 14),
        skinMat
      );
      noseBridge.position.set(0, -0.004, 0.108);
      noseBridge.rotation.x = -0.32;

      const noseTip = addShadowMesh(
        craniumGroup,
        new THREE.SphereGeometry(0.0128, 14, 12),
        skinMat
      );
      noseTip.scale.set(1.04, 0.88, 1.1);
      noseTip.position.set(0, -0.018, 0.118);

      [-1, 1].forEach((side) => {
        const nostrilWing = addShadowMesh(
          craniumGroup,
          new THREE.SphereGeometry(0.0068, 10, 8),
          skinMat
        );
        nostrilWing.scale.set(1.0, 0.78, 0.9);
        nostrilWing.position.set(side * 0.0095, -0.02, 0.112);
      });

      // Sculpted Wavy Shoulder-Length Hair with Anisotropic Sheen (Crown + Side-Parted Waves Framing Face Without Covering Forehead/Eyes)
      const hairGroup = new THREE.Group();
      craniumGroup.add(hairGroup);

      // Crown & back wavy volume (thetaLength = 0.45*PI and tilted backward -0.58 rad so forehead & eyes are 100% clear)
      const hairCrown = addShadowMesh(
        hairGroup,
        new THREE.SphereGeometry(0.118, 28, 24, 0, Math.PI * 2, 0, Math.PI * 0.45),
        hairMat
      );
      hairCrown.scale.set(1.02, 1.06, 1.04);
      hairCrown.position.set(0, 0.026, -0.018);
      hairCrown.rotation.x = -0.58;

      // Parted top hair waves & layered side locks framing the temples and jawline
      [-1, 1].forEach((side) => {
        const topWave = addShadowMesh(
          hairGroup,
          new THREE.CapsuleGeometry(0.048, 0.082, 14, 18),
          hairMat
        );
        topWave.rotation.z = Math.PI / 2 + side * -0.22;
        topWave.rotation.y = side * -0.18;
        topWave.position.set(side * 0.044, 0.098, 0.008);

        // Soft temple & outer cheekbone wave locks framing the sides of the face
        const faceWaveUpper = addShadowMesh(
          hairGroup,
          new THREE.CapsuleGeometry(0.034, 0.108, 12, 16),
          hairMat
        );
        faceWaveUpper.scale.set(0.65, 1.0, 1.08);
        faceWaveUpper.position.set(side * 0.104, 0.018, -0.004);
        faceWaveUpper.rotation.z = side * 0.08;
        faceWaveUpper.rotation.x = 0.1;

        // Lower jaw-to-shoulder wavy lock
        const faceWaveLower = addShadowMesh(
          hairGroup,
          new THREE.CapsuleGeometry(0.038, 0.145, 14, 18),
          hairMat
        );
        faceWaveLower.scale.set(0.64, 1.0, 1.14);
        faceWaveLower.position.set(side * 0.106, -0.052, -0.012);
        faceWaveLower.rotation.z = side * -0.06;
        faceWaveLower.rotation.x = 0.05;
      });

      // Full back wavy cascade resting toward upper shoulders
      const hairNape = addShadowMesh(
        hairGroup,
        new THREE.CapsuleGeometry(0.068, 0.14, 14, 18),
        hairMat
      );
      hairNape.rotation.z = Math.PI / 2;
      hairNape.scale.set(0.95, 1.0, 0.78);
      hairNape.position.set(0, -0.056, -0.076);

      // Multi-Layer Photorealistic Eyes (Glossy Sclera + Planar-UV Radial Iris/Pupil Disc + Dual Catchlights + Upper Lash Margin)
      const buildEye = (side: -1 | 1) => {
        const eyeHolder = new THREE.Group();
        eyeHolder.position.set(side * 0.041, 0.008, 0.098);
        craniumGroup.add(eyeHolder);

        const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.0175, 18, 16), eyeWhiteMat);
        sclera.scale.set(1.08, 0.92, 0.65);
        eyeHolder.add(sclera);

        // Inner tear-duct caruncle detail
        const tearDuct = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 8), lipMat);
        tearDuct.position.set(side * -0.0145, -0.001, 0.0085);
        eyeHolder.add(tearDuct);

        // Front-facing curved Iris & Pupil assembly (CircleGeometry maps irisDetailTex 1:1 radially without pole distortion)
        const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.0086, 24), irisMat);
        pupil.position.set(0, 0, 0.0118);
        eyeHolder.add(pupil);

        // Primary Window Softbox Catchlight + Secondary Warm Fill Catchlight on Front of Cornea (+Z)
        const catchlightPrimary = new THREE.Mesh(
          new THREE.CircleGeometry(0.0022, 12),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        catchlightPrimary.position.set(-0.0024, 0.0024, 0.0008);
        pupil.add(catchlightPrimary);

        const catchlightSecondary = new THREE.Mesh(
          new THREE.CircleGeometry(0.0013, 10),
          new THREE.MeshBasicMaterial({ color: 0xffe4c4 })
        );
        catchlightSecondary.position.set(0.0024, -0.002, 0.0008);
        pupil.add(catchlightSecondary);

        const eyelid = new THREE.Mesh(
          new THREE.SphereGeometry(0.019, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
          skinMat
        );
        eyelid.scale.set(1.08, 0.95, 0.7);
        eyelid.rotation.x = -0.35;
        eyeHolder.add(eyelid);

        // Delicate Upper Eyelash Margin along upper eyelid rim
        const lashRim = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.0014, 0.022, 6, 10),
          lashMat
        );
        lashRim.rotation.z = Math.PI / 2 + side * -0.05;
        lashRim.position.set(0, 0.001, 0.0175);
        eyelid.add(lashRim);

        return { eyeHolder, pupil, eyelid };
      };

      const leftEyeObj = buildEye(-1);
      const rightEyeObj = buildEye(1);

      // Tapered Arched Eyebrows
      const buildBrow = (side: -1 | 1) => {
        const brow = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.0046, 0.029, 8, 12),
          browMat
        );
        brow.rotation.z = Math.PI / 2 + side * -0.07;
        brow.position.set(side * 0.041, 0.033, 0.105);
        craniumGroup.add(brow);
        return brow;
      };
      const leftBrow = buildBrow(-1);
      const rightBrow = buildBrow(1);

      // Expressive Sculpted Cupid's-Bow Lips & Mouth Rig
      const mouthGroup = new THREE.Group();
      mouthGroup.position.set(0, -0.045, 0.104);
      craniumGroup.add(mouthGroup);

      const upperLip = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0056, 0.025, 8, 12),
        lipMat
      );
      upperLip.rotation.z = Math.PI / 2;
      upperLip.position.set(0, 0.003, 0);
      mouthGroup.add(upperLip);

      const lowerLip = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0064, 0.023, 8, 12),
        lipMat
      );
      lowerLip.rotation.z = Math.PI / 2;
      lowerLip.position.set(0, -0.004, 0);
      mouthGroup.add(lowerLip);

      // --- Sculpted Arms + 5-Finger Articulated Hands with Manicured Fingernails ---
      const buildArm = (side: -1 | 1): ArmRig => {
        const sideLabel = side === -1 ? 'Left' : 'Right';
        const clavicle = createBone(`${sideLabel}Clavicle`, chest, side * 0.06, 0.19, 0);
        const shoulder = createBone(`${sideLabel}Shoulder`, clavicle, side * 0.135, 0, 0);
        const elbow = createBone(`${sideLabel}Elbow`, shoulder, 0, -0.26, 0);
        const wrist = createBone(`${sideLabel}Wrist`, elbow, 0, -0.23, 0);

        // Smooth Deltoid Cap & Tapered Upper Arm (LatheGeometry eliminates harsh cylinder seams)
        addShadowMesh(shoulder, new THREE.SphereGeometry(0.051, 18, 16), skinMat);

        const upperArmGeo = buildLatheSegment(
          [
            [0.037, -0.255],
            [0.04, -0.19],
            [0.045, -0.11],
            [0.05, -0.03],
            [0.047, 0.01],
          ],
          0.96,
          0.98,
          22
        );
        addShadowMesh(shoulder, upperArmGeo, skinMat);

        // Seamless Elbow Joint & Sculpted Tapered Forearm
        addShadowMesh(elbow, new THREE.SphereGeometry(0.038, 16, 14), skinMat);

        const forearmGeo = buildLatheSegment(
          [
            [0.026, -0.225],
            [0.031, -0.16],
            [0.037, -0.07],
            [0.038, -0.01],
            [0.035, 0.01],
          ],
          0.95,
          1.02,
          22
        );
        addShadowMesh(elbow, forearmGeo, skinMat);

        // Wrist Joint Sphere
        addShadowMesh(wrist, new THREE.SphereGeometry(0.026, 14, 12), skinMat);

        // Sculpted Rounded Palm + 5 Articulated Fingers + Fingernails
        const palm = new THREE.Group();
        palm.position.set(0, -0.034, 0);
        wrist.add(palm);

        const palmMesh = addShadowMesh(
          palm,
          new THREE.CapsuleGeometry(0.026, 0.022, 12, 16),
          skinMat
        );
        palmMesh.scale.set(1.12, 1.05, 0.52);
        palmMesh.position.set(0, -0.004, 0);

        const buildFinger = (
          fName: string,
          ox: number,
          oy: number,
          oz: number,
          len1: number,
          len2: number,
          radius: number
        ): FingerRig => {
          const prox = createBone(`${sideLabel}${fName}Prox`, palm, ox, oy, oz);
          const m1 = addShadowMesh(
            prox,
            new THREE.CapsuleGeometry(radius, len1, 8, 10),
            skinMat
          );
          m1.position.set(0, -len1 * 0.55, 0);

          const dist = createBone(`${sideLabel}${fName}Dist`, prox, 0, -len1 - radius * 0.55, 0);
          const m2 = addShadowMesh(
            dist,
            new THREE.CapsuleGeometry(radius * 0.84, len2, 8, 10),
            skinMat
          );
          m2.position.set(0, -len2 * 0.55, 0);

          // Glossy manicured fingernail plate on dorsal tip of distal phalanx
          const nail = new THREE.Mesh(
            new THREE.SphereGeometry(radius * 0.72, 8, 6),
            nailMat
          );
          nail.scale.set(0.88, 1.25, 0.28);
          nail.position.set(0, -len2 * 0.85, -radius * 0.65);
          dist.add(nail);

          return { proximal: prox, distal: dist };
        };

        const thumb = buildFinger('Thumb', side * -0.028, -0.005, 0.009, 0.022, 0.017, 0.008);
        const index = buildFinger('Index', side * -0.02, -0.035, 0, 0.026, 0.019, 0.0068);
        const middle = buildFinger('Middle', side * -0.007, -0.037, 0, 0.028, 0.021, 0.007);
        const ring = buildFinger('Ring', side * 0.007, -0.035, 0, 0.025, 0.019, 0.0066);
        const pinky = buildFinger('Pinky', side * 0.02, -0.032, 0, 0.02, 0.015, 0.0058);

        return {
          clavicle,
          shoulder,
          elbow,
          hand: { wrist, palm, thumb, index, middle, ring, pinky },
        };
      };

      const leftArm = buildArm(-1);
      const rightArm = buildArm(1);

      // --- Sculpted Lounge Jogger Legs (Relaxed Taper + Ribbed Ankle Cuffs) & Slide Slippers ---
      const buildLeg = (side: -1 | 1): LegRig => {
        const sideLabel = side === -1 ? 'Left' : 'Right';
        const hip = createBone(`${sideLabel}Hip`, pelvis, side * 0.095, -0.01, 0);
        const knee = createBone(`${sideLabel}Knee`, hip, 0, -0.41, 0);
        const ankle = createBone(`${sideLabel}Ankle`, knee, 0, -0.39, 0);
        const toe = createBone(`${sideLabel}Toe`, ankle, 0, -0.055, 0.11);

        // Seamless Hip Joint Sphere
        addShadowMesh(hip, new THREE.SphereGeometry(0.08, 20, 18), pantsMat);

        // Sculpted Lounge Jogger Thigh with soft fabric drape
        const thighGeo = buildLatheSegment(
          [
            [0.062, -0.405],
            [0.068, -0.31],
            [0.079, -0.18],
            [0.084, -0.07],
            [0.079, 0.01],
          ],
          0.98,
          1.04,
          24
        );
        addShadowMesh(hip, thighGeo, pantsMat);

        // Rounded Knee / Lounge Pant Knee Drape
        addShadowMesh(knee, new THREE.SphereGeometry(0.06, 18, 16), pantsMat);

        // Sculpted Lounge Jogger Calf tapering into gathered ankle cuff
        const calfGeo = buildLatheSegment(
          [
            [0.044, -0.335],
            [0.054, -0.25],
            [0.064, -0.14],
            [0.059, -0.04],
            [0.058, 0.01],
          ],
          0.97,
          1.04,
          24
        );
        addShadowMesh(knee, calfGeo, pantsMat);

        // Ribbed Jogger Ankle Cuff (Reference Images 2, 3, 5, 6)
        const ankleCuff = addShadowMesh(
          knee,
          new THREE.CylinderGeometry(0.045, 0.039, 0.048, 20),
          pantsCuffMat
        );
        ankleCuff.position.set(0, -0.352, 0);

        // Bare Ankle & Sculpted Heel/Instep inside Slide Slipper
        addShadowMesh(ankle, new THREE.CylinderGeometry(0.033, 0.035, 0.06, 16), skinMat).position.set(
          0,
          -0.01,
          0
        );

        const footInstep = addShadowMesh(
          ankle,
          new THREE.CapsuleGeometry(0.034, 0.068, 12, 16),
          skinMat
        );
        footInstep.rotation.x = Math.PI / 2 + 0.14;
        footInstep.scale.set(1.04, 1.0, 0.66);
        footInstep.position.set(0, -0.042, 0.026);

        // Sculpted House Slide Slipper: Contoured Cushion Sole + Wide Arch Strap (Reference Images 2, 3, 5, 6)
        const heelSole = addShadowMesh(
          ankle,
          new THREE.BoxGeometry(0.094, 0.022, 0.155),
          shoeSoleMat
        );
        heelSole.position.set(0, -0.071, 0.025);

        const slideArchStrap = addShadowMesh(
          ankle,
          new THREE.CylinderGeometry(0.046, 0.048, 0.068, 20, 1, true, -Math.PI * 0.52, Math.PI * 1.04),
          shoeWhiteMat
        );
        slideArchStrap.rotation.x = Math.PI / 2;
        slideArchStrap.rotation.y = Math.PI / 2;
        slideArchStrap.scale.set(0.75, 1.0, 1.06);
        slideArchStrap.position.set(0, -0.048, 0.045);

        // Sculpted Forefoot & Bare Toes on Slide Footbed
        const toeBox = addShadowMesh(
          toe,
          new THREE.CapsuleGeometry(0.038, 0.032, 12, 16),
          skinMat
        );
        toeBox.rotation.z = Math.PI / 2;
        toeBox.scale.set(0.56, 1.0, 1.15);
        toeBox.position.set(0, 0.008, 0.016);

        const toeSole = addShadowMesh(
          toe,
          new THREE.BoxGeometry(0.09, 0.02, 0.082),
          shoeSoleMat
        );
        toeSole.position.set(0, -0.017, 0.018);

        return { hip, knee, ankle, toe };
      };

      const leftLeg = buildLeg(-1);
      const rightLeg = buildLeg(1);

      const skeleton = new THREE.Skeleton(bones);

      return {
        root,
        skeleton,
        pelvis,
        spine,
        chest,
        neck,
        head,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        leftEye: leftEyeObj.eyeHolder,
        rightEye: rightEyeObj.eyeHolder,
        leftPupil: leftEyeObj.pupil,
        rightPupil: rightEyeObj.pupil,
        leftEyelid: leftEyeObj.eyelid,
        rightEyelid: rightEyeObj.eyelid,
        leftBrow,
        rightBrow,
        mouthGroup,
        upperLip,
        lowerLip,
        contactShadow,
        cushionIndentMesh,
        leftFootShadow,
        rightFootShadow,
      };
    };

    const rig = buildStylizedHumanRig();
    rigRef.current = rig;

    // Translucent Reference Ghost Silhouette for Pose Comparison (Phase 5)
    const ghostMaterial = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.32,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: ghostOpacityRef.current,
      depthWrite: false,
    });
    const ghostRig = buildStylizedHumanRig(true, ghostMaterial);
    ghostRig.root.visible = false;
    ghostRigRef.current = ghostRig;

    // Container for optional custom loaded GLB character
    const customModelGroup = new THREE.Group();
    customModelGroup.visible = false;
    scene.add(customModelGroup);
    customModelGroupRef.current = customModelGroup;

    // ==========================================
    // 5. 3D Visual Scene Gizmos & Direct Manipulation Handles
    // ==========================================
    const gizmosRoot = new THREE.Group();
    scene.add(gizmosRoot);

    const groundGridGizmo = new THREE.GridHelper(8, 16, 0x6366f1, 0x334155);
    groundGridGizmo.position.y = 0.008;
    groundGridGizmo.visible = false;
    gizmosRoot.add(groundGridGizmo);

    const worldAxesGizmo = new THREE.AxesHelper(1.2);
    worldAxesGizmo.position.set(0, 0.012, 0);
    worldAxesGizmo.visible = false;
    gizmosRoot.add(worldAxesGizmo);

    // Subject Origin Ring + Facing Arrow (Emerald) + Right Basis Arrow (Sky)
    const subjectOriginGroup = new THREE.Group();
    gizmosRoot.add(subjectOriginGroup);

    const subjectOriginRing = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.36, 36),
      new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide })
    );
    subjectOriginRing.rotation.x = -Math.PI / 2;
    subjectOriginRing.position.y = 0.015;
    subjectOriginGroup.add(subjectOriginRing);

    const subjectFacingArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0.025, 0),
      0.85,
      0x10b981,
      0.18,
      0.11
    );
    subjectOriginGroup.add(subjectFacingArrow);

    const subjectRightArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0.025, 0),
      0.52,
      0x38bdf8,
      0.12,
      0.08
    );
    subjectOriginGroup.add(subjectRightArrow);

    // Active Movement Direction Arrow (Indigo)
    const movementArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0.045, 0),
      0.95,
      0x818cf8,
      0.2,
      0.12
    );
    movementArrow.visible = false;
    gizmosRoot.add(movementArrow);

    // Camera Look-Target Sphere + Anchor Marker + Sightline + Shot Camera Frustum (Amber)
    const cameraGizmoGroup = new THREE.Group();
    cameraGizmoGroup.visible = false;
    gizmosRoot.add(cameraGizmoGroup);

    const camLookTargetSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b })
    );
    cameraGizmoGroup.add(camLookTargetSphere);

    const fixedAnchorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.22, 24),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide })
    );
    fixedAnchorRing.rotation.x = -Math.PI / 2;
    fixedAnchorRing.position.y = 0.016;
    cameraGizmoGroup.add(fixedAnchorRing);

    const sightlineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 1, 2),
      new THREE.Vector3(0, 1, 0),
    ]);
    const sightlineLine = new THREE.Line(
      sightlineGeom,
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.65 })
    );
    cameraGizmoGroup.add(sightlineLine);

    // Shot Camera Body & Frustum Cone (visible when Free-Orbit View is active or camera gizmo enabled)
    const shotCameraMarkerGroup = new THREE.Group();
    cameraGizmoGroup.add(shotCameraMarkerGroup);
    const shotCamBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.1, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3, metalness: 0.5 })
    );
    shotCameraMarkerGroup.add(shotCamBody);
    const shotCamLens = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.18, 4),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true })
    );
    shotCamLens.rotation.x = -Math.PI / 2;
    shotCamLens.rotation.z = Math.PI / 4;
    shotCamLens.position.z = -0.16;
    shotCameraMarkerGroup.add(shotCamLens);

    // Head-Forward Ray (Violet) & Eye-Gaze Ray (Cyan)
    const headAndGazeGroup = new THREE.Group();
    headAndGazeGroup.visible = false;
    gizmosRoot.add(headAndGazeGroup);

    const headForwardArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1.5, 0),
      0.72,
      0xa855f7,
      0.14,
      0.08
    );
    headAndGazeGroup.add(headForwardArrow);

    const eyeGazeArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1.5, 0),
      0.92,
      0x22d3ee,
      0.16,
      0.09
    );
    headAndGazeGroup.add(eyeGazeArrow);

    // ==========================================
    // 5B. Interactive 3D Joint & Root Manipulation Handles (Phase 5)
    // ==========================================
    const interactiveHandlesGroup = new THREE.Group();
    gizmosRoot.add(interactiveHandlesGroup);

    const handleMeshes: THREE.Mesh[] = [];
    const makeJointHandle = (
      handleId: Exclude<PlayboardInteractiveHandleId, null>,
      label: string,
      colorHex: number,
      radius = 0.048
    ) => {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.78,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 14), mat);
      mesh.renderOrder = 10;
      mesh.userData = { handleId, handleLabel: label, defaultColor: colorHex };
      interactiveHandlesGroup.add(mesh);
      handleMeshes.push(mesh);
      return mesh;
    };

    // Root Ground Translation Ring Handle
    const rootRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const rootRingHandle = new THREE.Mesh(new THREE.RingGeometry(0.37, 0.44, 40), rootRingMat);
    rootRingHandle.rotation.x = -Math.PI / 2;
    rootRingHandle.position.y = 0.018;
    rootRingHandle.userData = {
      handleId: 'root_ring' as PlayboardInteractiveHandleId,
      handleLabel: 'Root Position (Drag on Floor)',
      defaultColor: 0x38bdf8,
    };
    interactiveHandlesGroup.add(rootRingHandle);
    handleMeshes.push(rootRingHandle);

    // Yaw Rotation Front Knob Handle on Ring
    const yawKnobHandle = makeJointHandle(
      'yaw_ring',
      'Subject Facing Yaw (Drag to Rotate)',
      0xf59e0b,
      0.032
    );

    const headHandle = makeJointHandle('head', 'Head & Gaze Tilt', 0xa855f7, 0.028);
    const pelvisHandle = makeJointHandle('pelvis', 'Pelvis & Torso Posture', 0x10b981, 0.03);
    const leftWristHandle = makeJointHandle('left_wrist', 'Left Arm & Wrist', 0x38bdf8, 0.026);
    const rightWristHandle = makeJointHandle('right_wrist', 'Right Arm & Wrist', 0x38bdf8, 0.026);
    const leftKneeHandle = makeJointHandle('left_knee', 'Left Leg & Knee', 0xf43f5e, 0.026);
    const rightKneeHandle = makeJointHandle('right_knee', 'Right Leg & Knee', 0xf43f5e, 0.026);

    // ==========================================
    // 5C. Cinema Post-Processing Pipeline (4x MSAA Optical Bokeh DOF + Subtle Halation Bloom + OutputPass)
    // ==========================================
    let composer: EffectComposer | null = null;
    let bokehPass: BokehPass | null = null;
    let bloomPass: UnrealBloomPass | null = null;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);

      const pixelRatio = renderer.getPixelRatio();
      const msaaRenderTarget = new THREE.WebGLRenderTarget(
        Math.max(1, Math.round(width * pixelRatio)),
        Math.max(1, Math.round(height * pixelRatio)),
        {
          type: THREE.HalfFloatType,
          samples: 4,
        }
      );

      composer = new EffectComposer(renderer, msaaRenderTarget);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);

      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      bokehPass = new BokehPass(scene, camera, {
        focus: 2.35,
        aperture: 0.00018,
        maxblur: 0.0045,
      });

      // BokehPass renders scene depth using scene.overrideMaterial = _materialDepth.
      // Temporarily hide non-depth-writing helper/shadow/gizmo meshes and cutaway walls during the depth pass
      // so they never write solid rectangles into the Bokeh depth buffer while remaining visible in the color pass.
      const origBokehRender = bokehPass.render.bind(bokehPass);
      bokehPass.render = (
        r: THREE.WebGLRenderer,
        writeBuffer: THREE.WebGLRenderTarget,
        readBuffer: THREE.WebGLRenderTarget,
        deltaTime?: number,
        maskActive?: boolean
      ) => {
        const prevGizmos = gizmosRoot.visible;
        const prevHotspots = hotspotMarkersGroup.visible;
        const prevSupport = supportCollidersGroup.visible;
        const prevGobo = windowGoboMesh.visible;
        const prevContactShadow = rig.contactShadow.visible;
        const prevCushionIndent = rig.cushionIndentMesh.visible;
        const prevLFootShadow = rig.leftFootShadow.visible;
        const prevRFootShadow = rig.rightFootShadow.visible;
        const prevGhost = ghostRigRef.current ? ghostRigRef.current.root.visible : false;
        const prevBackWall = backWallGroup.visible;
        const prevLeftWall = leftWallGroup.visible;
        const prevRightWall = rightWallGroup.visible;

        gizmosRoot.visible = false;
        hotspotMarkersGroup.visible = false;
        supportCollidersGroup.visible = false;
        windowGoboMesh.visible = false;
        rig.contactShadow.visible = false;
        rig.cushionIndentMesh.visible = false;
        rig.leftFootShadow.visible = false;
        rig.rightFootShadow.visible = false;
        if (ghostRigRef.current) ghostRigRef.current.root.visible = false;
        if (backWallPlasterMat.opacity < 0.5) backWallGroup.visible = false;
        if (leftWallPlasterMat.opacity < 0.5) leftWallGroup.visible = false;
        if (rightWallPlasterMat.opacity < 0.5) rightWallGroup.visible = false;

        origBokehRender(r, writeBuffer, readBuffer, deltaTime ?? 0.016, maskActive ?? false);

        gizmosRoot.visible = prevGizmos;
        hotspotMarkersGroup.visible = prevHotspots;
        supportCollidersGroup.visible = prevSupport;
        windowGoboMesh.visible = prevGobo;
        rig.contactShadow.visible = prevContactShadow;
        rig.cushionIndentMesh.visible = prevCushionIndent;
        rig.leftFootShadow.visible = prevLFootShadow;
        rig.rightFootShadow.visible = prevRFootShadow;
        if (ghostRigRef.current) ghostRigRef.current.root.visible = prevGhost;
        backWallGroup.visible = prevBackWall;
        leftWallGroup.visible = prevLeftWall;
        rightWallGroup.visible = prevRightWall;
      };
      composer.addPass(bokehPass);

      bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.12, 0.42, 0.88);
      composer.addPass(bloomPass);

      const outputPass = new OutputPass();
      composer.addPass(outputPass);
    }

    // ==========================================
    // Pointer Interaction (Orbit, Pan, Pinch Zoom, Direct Handle Drag & Surface Selection)
    // ==========================================
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';
    const activePointers = new Map<number, { x: number; y: number }>();
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const groundDragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const groundIntersectPt = new THREE.Vector3();
    let draggingHandle: PlayboardInteractiveHandleId = null;
    let canvasGestureType: 'none' | 'handle' | 'orbit' | 'pan' | 'multitouch' = 'none';
    let wasMultiTouchGesture = false;
    let pointerDownPos = { x: 0, y: 0 };
    let pointerMovedDistance = 0;

    const updatePointerNdc = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onPointerDown = (e: PointerEvent) => {
      // Ignore any pointer owned by UI joysticks, buttons, or overlays
      if (ownedUiPointerIdsRef.current.has(e.pointerId) || e.target !== canvas) {
        return;
      }

      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      // If a second finger touches down, immediately switch to multitouch (pinch zoom / 2-finger pan)
      // and cancel any single-finger handle drag or tap selection
      if (activePointers.size >= 2) {
        wasMultiTouchGesture = true;
        canvasGestureType = 'multitouch';
        if (draggingHandle) {
          draggingHandle = null;
          setSelectedJointBadge(null);
        }
        return;
      }

      wasMultiTouchGesture = false;
      pointerDownPos = { x: e.clientX, y: e.clientY };
      pointerMovedDistance = 0;

      if (activePointers.size === 1) {
        updatePointerNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);

        // 1. Check interactive 3D joint/root handles first when visible (only on primary button / touch)
        if (interactiveHandlesGroup.visible && (e.button === 0 || e.pointerType === 'touch')) {
          const handleHits = raycaster.intersectObjects(handleMeshes, false);
          if (handleHits.length > 0) {
            const hitMesh = handleHits[0].object as THREE.Mesh;
            const hId = hitMesh.userData.handleId as PlayboardInteractiveHandleId;
            const hLabel = hitMesh.userData.handleLabel as string;
            if (hId) {
              draggingHandle = hId;
              canvasGestureType = 'handle';
              setSelectedJointBadge(hLabel || `Direct Posing: ${hId}`);
              return;
            }
          }
        }

        // 2. Fallback: Shift-click directly on character mesh for quick limb posing
        if (e.shiftKey && onPoseChangeRef.current && rigRef.current) {
          const hits = raycaster.intersectObjects(rigRef.current.root.children, true);
          if (hits.length > 0) {
            const hitY = hits[0].point.y;
            const hitX = hits[0].point.x;
            if (hitY > 1.38) {
              draggingHandle = 'head';
              setSelectedJointBadge('Direct Posing: Head');
            } else if (hitX < -0.14 && hitY > 0.85) {
              draggingHandle = 'left_wrist';
              setSelectedJointBadge('Direct Posing: Left Arm');
            } else if (hitX > 0.14 && hitY > 0.85) {
              draggingHandle = 'right_wrist';
              setSelectedJointBadge('Direct Posing: Right Arm');
            } else if (hitY < 0.65) {
              draggingHandle = hitX < 0 ? 'left_knee' : 'right_knee';
              setSelectedJointBadge(
                draggingHandle === 'left_knee' ? 'Direct Posing: Left Leg' : 'Direct Posing: Right Leg'
              );
            } else {
              draggingHandle = 'pelvis';
              setSelectedJointBadge('Direct Posing: Pelvis & Torso');
            }
            canvasGestureType = 'handle';
            return;
          }
        }

        // 3. Determine whether unobstructed canvas drag is Pan (Right/Middle mouse or Shift+drag in Free Orbit) or Orbit
        if (
          isFreeOrbitViewRef.current &&
          (e.button === 2 || e.button === 1 || (e.shiftKey && e.button === 0))
        ) {
          canvasGestureType = 'pan';
        } else {
          canvasGestureType = 'orbit';
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (ownedUiPointerIdsRef.current.has(e.pointerId)) {
        return;
      }

      const current = activePointers.get(e.pointerId);
      if (!current) {
        // Hover detection for 3D furniture hotspots when no pointer button is pressed
        if (environmentRef.current === 'studio_bedroom' && hotspotMarkersGroup.visible) {
          updatePointerNdc(e.clientX, e.clientY);
          raycaster.setFromCamera(pointerNdc, camera);
          const hHits = raycaster.intersectObjects(hotspotHitMeshes, false);
          if (hHits.length > 0) {
            const hData = hHits[0].object.userData.hotspotData as FurnitureAnchorHotspot | undefined;
            if (hData && hoveredHotspotIdRef.current !== hData.id) {
              hoveredHotspotIdRef.current = hData.id;
              setHoveredHotspotLabel(`${hData.label} (${hData.surfaceId.replace('_', ' ')})`);
              canvas.style.cursor = 'pointer';
            }
          } else if (hoveredHotspotIdRef.current !== null) {
            hoveredHotspotIdRef.current = null;
            setHoveredHotspotLabel(null);
            canvas.style.cursor = '';
          }
        }
        return;
      }

      const stepDx = e.clientX - current.x;
      const stepDy = e.clientY - current.y;
      pointerMovedDistance += Math.hypot(stepDx, stepDy);

      // Multitouch (2-finger pinch zoom + 2-finger Free Orbit pan) takes strict precedence over single-finger handle drags
      if (activePointers.size >= 2 || canvasGestureType === 'multitouch') {
        wasMultiTouchGesture = true;
        if (draggingHandle) {
          draggingHandle = null;
          setSelectedJointBadge(null);
        }
        const entries = Array.from(activePointers.entries());
        const otherEntry = entries.find(([id]) => id !== e.pointerId);
        if (otherEntry) {
          const other = otherEntry[1];
          const prevDist = Math.hypot(current.x - other.x, current.y - other.y);
          const nextDist = Math.hypot(e.clientX - other.x, e.clientY - other.y);
          const prevMidX = (current.x + other.x) * 0.5;
          const prevMidY = (current.y + other.y) * 0.5;
          const nextMidX = (e.clientX + other.x) * 0.5;
          const nextMidY = (e.clientY + other.y) * 0.5;
          const midDx = nextMidX - prevMidX;
          const midDy = nextMidY - prevMidY;

          const isFreeOrbit = isFreeOrbitViewRef.current;
          const cTarget = camTargetStateRef.current;

          if (prevDist > 8 && nextDist > 8) {
            const zoomFactor = prevDist / nextDist;
            if (isFreeOrbit) {
              freeOrbitStateRef.current.dist = Math.max(
                0.9,
                Math.min(8.5, freeOrbitStateRef.current.dist * zoomFactor)
              );
            } else {
              cTarget.dist = Math.max(1.0, Math.min(6.5, cTarget.dist * zoomFactor));
              camCurrentStateRef.current.dist = cTarget.dist;
              if (!pinShotCameraRef.current || !isPipActiveRef.current) {
                onCameraChangeRef.current({
                  distance: Number(cTarget.dist.toFixed(2)),
                });
              }
            }
          }

          if (isFreeOrbit && (Math.abs(midDx) > 0.2 || Math.abs(midDy) > 0.2)) {
            panFreeOrbitTarget(
              freeOrbitStateRef.current,
              midDx,
              midDy,
              canvas.clientHeight || 600,
              camera.fov
            );
          }
        }
        current.x = e.clientX;
        current.y = e.clientY;
        return;
      }

      // Direct handle manipulation (does NOT orbit or pan camera)
      if (canvasGestureType === 'handle' && draggingHandle) {
        const p = poseStateRef.current;
        if (draggingHandle === 'root_ring') {
          updatePointerNdc(e.clientX, e.clientY);
          raycaster.setFromCamera(pointerNdc, camera);
          const surfaceY = rigRef.current ? rigRef.current.contactShadow.position.y : 0;
          groundDragPlane.constant = -surfaceY;
          if (raycaster.ray.intersectPlane(groundDragPlane, groundIntersectPt)) {
            let clampedX = THREE.MathUtils.clamp(
              Number(groundIntersectPt.x.toFixed(2)),
              -2.25,
              2.25
            );
            let clampedZ = THREE.MathUtils.clamp(
              Number(groundIntersectPt.z.toFixed(2)),
              -2.05,
              2.25
            );
            let nextYawDeg = Math.round(
              ((((THREE.MathUtils.radToDeg(playerPosRef.current.rot) + 180) % 360) + 360) % 360) -
                180
            );
            if (environmentRef.current === 'studio_bedroom') {
              const snapRes = evaluateMagneticAnchorSnap(
                clampedX,
                clampedZ,
                environmentRef.current,
                true
              );
              if (snapRes.snappedAnchor) {
                clampedX = Number(snapRes.x.toFixed(2));
                clampedZ = Number(snapRes.z.toFixed(2));
                setSelectedHotspotId(snapRes.snappedAnchor.id);
                setSelectedSurfaceId(snapRes.snappedAnchor.surfaceId);
              }
            }
            playerPosRef.current.x = clampedX;
            playerPosRef.current.z = clampedZ;
            onCharacterTransformChangeRef.current?.({
              characterYawDeg: nextYawDeg,
              characterPosX: clampedX,
              characterPosZ: clampedZ,
            });
          }
        } else if (draggingHandle === 'yaw_ring') {
          const nextRot = normalizeAngleRad(playerPosRef.current.rot + stepDx * 0.014);
          playerPosRef.current.rot = nextRot;
          const degYaw = Math.round(
            ((((THREE.MathUtils.radToDeg(nextRot) + 180) % 360) + 360) % 360) - 180
          );
          onCharacterTransformChangeRef.current?.({
            characterYawDeg: degYaw === -180 ? 180 : degYaw,
            characterPosX: Number(playerPosRef.current.x.toFixed(2)),
            characterPosZ: Number(playerPosRef.current.z.toFixed(2)),
          });
        } else if (onPoseChangeRef.current) {
          if (draggingHandle === 'head') {
            onPoseChangeRef.current({
              headRotationDeg: THREE.MathUtils.clamp(
                Math.round(p.headRotationDeg + stepDx * 0.45),
                -75,
                75
              ),
              headTiltDeg: THREE.MathUtils.clamp(
                Math.round(p.headTiltDeg - stepDy * 0.35),
                -35,
                35
              ),
            });
          } else if (draggingHandle === 'left_wrist') {
            onPoseChangeRef.current({
              leftArmShoulderForwardDeg: THREE.MathUtils.clamp(
                Math.round(p.leftArmShoulderForwardDeg - stepDy * 0.5),
                -45,
                110
              ),
              leftArmShoulderOutDeg: THREE.MathUtils.clamp(
                Math.round(p.leftArmShoulderOutDeg - stepDx * 0.4),
                0,
                90
              ),
            });
          } else if (draggingHandle === 'right_wrist') {
            onPoseChangeRef.current({
              rightArmShoulderForwardDeg: THREE.MathUtils.clamp(
                Math.round(p.rightArmShoulderForwardDeg - stepDy * 0.5),
                -45,
                110
              ),
              rightArmShoulderOutDeg: THREE.MathUtils.clamp(
                Math.round(p.rightArmShoulderOutDeg + stepDx * 0.4),
                0,
                90
              ),
            });
          } else if (draggingHandle === 'pelvis') {
            onPoseChangeRef.current({
              torsoTwistDeg: THREE.MathUtils.clamp(
                Math.round(p.torsoTwistDeg + stepDx * 0.35),
                -40,
                40
              ),
              torsoLeanDeg: THREE.MathUtils.clamp(
                Math.round(p.torsoLeanDeg + stepDy * 0.3),
                -25,
                35
              ),
            });
          } else if (draggingHandle === 'left_knee') {
            onPoseChangeRef.current({
              leftLegHipForwardDeg: THREE.MathUtils.clamp(
                Math.round(p.leftLegHipForwardDeg - stepDy * 0.45),
                -35,
                105
              ),
              leftLegKneeBendDeg: THREE.MathUtils.clamp(
                Math.round(p.leftLegKneeBendDeg + stepDx * 0.45),
                0,
                130
              ),
            });
          } else if (draggingHandle === 'right_knee') {
            onPoseChangeRef.current({
              rightLegHipForwardDeg: THREE.MathUtils.clamp(
                Math.round(p.rightLegHipForwardDeg - stepDy * 0.45),
                -35,
                105
              ),
              rightLegKneeBendDeg: THREE.MathUtils.clamp(
                Math.round(p.rightLegKneeBendDeg + stepDx * 0.45),
                0,
                130
              ),
            });
          }
        }
        current.x = e.clientX;
        current.y = e.clientY;
        return;
      }

      const cTarget = camTargetStateRef.current;
      const isFreeOrbit = isFreeOrbitViewRef.current;

      if (activePointers.size === 1) {
        if (isFreeOrbit && canvasGestureType === 'pan') {
          panFreeOrbitTarget(
            freeOrbitStateRef.current,
            stepDx,
            stepDy,
            canvas.clientHeight || 600,
            camera.fov
          );
        } else if (isFreeOrbit) {
          freeOrbitStateRef.current.yaw = normalizeAngleRad(
            freeOrbitStateRef.current.yaw + stepDx * 0.007
          );
          freeOrbitStateRef.current.pitch = Math.max(
            -0.42,
            Math.min(1.42, freeOrbitStateRef.current.pitch - stepDy * 0.006)
          );
        } else {
          cTarget.yaw = normalizeAngleRad(cTarget.yaw + stepDx * 0.007);
          cTarget.pitch = Math.max(-0.436, Math.min(1.309, cTarget.pitch - stepDy * 0.006));

          // Update current immediately during active drag for responsive feel
          camCurrentStateRef.current.yaw = cTarget.yaw;
          camCurrentStateRef.current.pitch = cTarget.pitch;

          const degYaw = Math.round(THREE.MathUtils.radToDeg(cTarget.yaw));
          const normalizedYaw = ((((degYaw + 180) % 360) + 360) % 360) - 180;
          const degPitch = Math.round(THREE.MathUtils.radToDeg(cTarget.pitch));

          if (!pinShotCameraRef.current || !isPipActiveRef.current) {
            onCameraChangeRef.current({
              yawDeg: normalizedYaw === -180 ? 180 : normalizedYaw,
              pitchDeg: degPitch,
            });
          }
        }
      }

      current.x = e.clientX;
      current.y = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasTracked = activePointers.has(e.pointerId);
      activePointers.delete(e.pointerId);

      if (draggingHandle) {
        draggingHandle = null;
        setSelectedJointBadge(null);
      } else if (
        wasTracked &&
        !wasMultiTouchGesture &&
        activePointers.size === 0 &&
        pointerMovedDistance < 6 &&
        environmentRef.current === 'studio_bedroom' &&
        Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) < 6
      ) {
        // Short single-finger click/tap in bedroom: check 3D Furniture Hotspots first, then Surface Highlight Planes
        updatePointerNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);

        if (hotspotMarkersGroup.visible) {
          const hotspotHits = raycaster.intersectObjects(hotspotHitMeshes, false);
          if (hotspotHits.length > 0) {
            const clickedHotspot = hotspotHits[0].object.userData
              .hotspotData as FurnitureAnchorHotspot | undefined;
            if (clickedHotspot) {
              activateHotspotAnchorRef.current(clickedHotspot);
              try {
                canvas.releasePointerCapture(e.pointerId);
              } catch {
                // ignore
              }
              wasMultiTouchGesture = false;
              canvasGestureType = 'none';
              return;
            }
          }
        }

        const surfMeshes = Array.from(supportHighlightMeshes.values());
        const surfHits = raycaster.intersectObjects(surfMeshes, false);
        if (surfHits.length > 0) {
          const clickedSurfId = (surfHits[0].object.userData.supportSurfaceId ||
            surfHits[0].object.userData.surfaceId) as PlayboardSupportSurfaceId;
          if (clickedSurfId) {
            setSelectedHotspotId(null);
            setSelectedSurfaceId((prev) => (prev === clickedSurfId ? null : clickedSurfId));
          }
        }
      }

      if (activePointers.size === 0) {
        wasMultiTouchGesture = false;
        canvasGestureType = 'none';
      }

      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isFreeOrbitViewRef.current) {
        freeOrbitStateRef.current.dist = Math.max(
          0.9,
          Math.min(8.5, freeOrbitStateRef.current.dist + e.deltaY * 0.003)
        );
        return;
      }
      const cTarget = camTargetStateRef.current;
      cTarget.dist = Math.max(1.0, Math.min(6.5, cTarget.dist + e.deltaY * 0.003));
      if (!pinShotCameraRef.current || !isPipActiveRef.current) {
        onCameraChangeRef.current({
          distance: Number(cTarget.dist.toFixed(2)),
        });
      }
    };

    // Keyboard WASD / Arrow keys support for locomotion & Q/E for character turning
    const isEditableElement = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableElement(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') keyMoveRef.current.w = true;
      if (k === 's' || e.key === 'ArrowDown') keyMoveRef.current.s = true;
      if (k === 'a' || e.key === 'ArrowLeft') keyMoveRef.current.a = true;
      if (k === 'd' || e.key === 'ArrowRight') keyMoveRef.current.d = true;
      if (k === 'q') keyMoveRef.current.q = true;
      if (k === 'e') keyMoveRef.current.e = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') keyMoveRef.current.w = false;
      if (k === 's' || e.key === 'ArrowDown') keyMoveRef.current.s = false;
      if (k === 'a' || e.key === 'ArrowLeft') keyMoveRef.current.a = false;
      if (k === 'd' || e.key === 'ArrowRight') keyMoveRef.current.d = false;
      if (k === 'q') keyMoveRef.current.q = false;
      if (k === 'e') keyMoveRef.current.e = false;
    };

    const onWindowBlurOrHide = () => {
      activePointers.clear();
      draggingHandle = null;
      wasMultiTouchGesture = false;
      canvasGestureType = 'none';
      setSelectedJointBadge(null);
      resetAllControlInputs();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlurOrHide);
    document.addEventListener('visibilitychange', onWindowBlurOrHide);

    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('lostpointercapture', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Responsive ResizeObserver
    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      if (w <= 0 || h <= 0) return;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h, false);
      if (composer) {
        composer.setSize(w, h);
      }
      if (bloomPass) {
        bloomPass.resolution.set(w, h);
      }
      setViewportDimensions({ width: w, height: h });
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);

    // ==========================================
    // Software WebGL Pacing + Smooth Animation & Kinematics Loop
    // ==========================================
    let frameId = 0;
    const clock = new THREE.Clock();
    let animTime = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    const damp = (curr: number, target: number, lambda: number, dt: number) =>
      THREE.MathUtils.damp(curr, target, lambda, dt);

    const applyHandGestureDamped = (
      handRig: HandRig,
      gesture: HandGesture,
      wristDeg: number,
      wristSupportPitchRad: number | null,
      fingerRelaxDeltaRad: number,
      side: -1 | 1,
      t: number,
      dt: number
    ) => {
      const g = getHandGestureTargets(gesture, side, t);
      const speed = 14;
      const isFlatFloorPalm =
        wristSupportPitchRad !== null &&
        (gesture === 'open_palm' || gesture === 'relaxed_natural');

      // Micro-relaxation applies only when in relaxed_natural and not bearing weight on the floor
      const relaxCurlOffset =
        gesture === 'relaxed_natural' && !isFlatFloorPalm ? fingerRelaxDeltaRad : 0;

      // Wrist orientation (combines floor-support palm extension when grounded + user wrist slider + gesture natural pitch/roll)
      const userWristRad = THREE.MathUtils.degToRad(wristDeg);
      const targetWristPitch =
        wristSupportPitchRad !== null
          ? gesture === 'open_palm' || gesture === 'relaxed_natural'
            ? wristSupportPitchRad
            : gesture === 'fist'
            ? 0
            : wristSupportPitchRad * 0.65 + g.wristPitch
          : g.wristPitch;
      handRig.wrist.rotation.x = damp(handRig.wrist.rotation.x, targetWristPitch, speed, dt);
      handRig.wrist.rotation.y = damp(handRig.wrist.rotation.y, userWristRad * 0.8, speed, dt);
      handRig.wrist.rotation.z = damp(handRig.wrist.rotation.z, g.wristRoll + userWristRad * 0.4, speed, dt);

      // Thumb articulation (flattened when palm supports body weight on the floor)
      const thumbCurlScale = isFlatFloorPalm ? 0.15 : 1.0;
      handRig.thumb.proximal.rotation.x = damp(
        handRig.thumb.proximal.rotation.x,
        (g.thumbCurl + relaxCurlOffset * 0.5) * 0.6 * thumbCurlScale,
        speed,
        dt
      );
      handRig.thumb.proximal.rotation.z = damp(
        handRig.thumb.proximal.rotation.z,
        side * -g.thumbSpread,
        speed,
        dt
      );
      handRig.thumb.distal.rotation.x = damp(
        handRig.thumb.distal.rotation.x,
        (g.thumbCurl + relaxCurlOffset * 0.5) * 0.85 * thumbCurlScale,
        speed,
        dt
      );

      // 4 Fingers (Index, Middle, Ring, Pinky)
      const fingerCurlScale = isFlatFloorPalm ? 0.12 : 1.0;
      const fingers: [FingerRig, number, number][] = [
        [handRig.index, (g.indexCurl + relaxCurlOffset * 0.7) * fingerCurlScale, -1.5],
        [handRig.middle, (g.middleCurl + relaxCurlOffset * 0.9) * fingerCurlScale, -0.5],
        [handRig.ring, (g.ringCurl + relaxCurlOffset * 1.1) * fingerCurlScale, 0.5],
        [handRig.pinky, (g.pinkyCurl + relaxCurlOffset * 1.25) * fingerCurlScale, 1.5],
      ];

      for (const [fRig, curl, spreadIdx] of fingers) {
        fRig.proximal.rotation.x = damp(fRig.proximal.rotation.x, curl * 0.95, speed, dt);
        fRig.proximal.rotation.z = damp(
          fRig.proximal.rotation.z,
          side * spreadIdx * g.fingerSpread,
          speed,
          dt
        );
        fRig.distal.rotation.x = damp(fRig.distal.rotation.x, curl * 1.1, speed, dt);
      }
    };

    const applyGazeAndExpression = (
      r: StylizedHumanRig,
      gaze: GazeDirection,
      expression: FacialExpression,
      cameraWorldPos: THREE.Vector3,
      secMotion: SecondaryMotionState,
      t: number,
      dt: number
    ) => {
      const speed = 14;
      let gazeX = secMotion.eyeLeadYawRad * 0.065;
      let gazeY = -secMotion.eyeLeadPitchRad * 0.065;
      let eyelidRotX = -0.38;

      switch (gaze) {
        case 'looking_camera_left':
        case 'looking_camera_right':
          break;
        case 'looking_upward':
          eyelidRotX = -0.52;
          break;
        case 'looking_downward':
          eyelidRotX = 0.05;
          break;
        case 'soft_off_camera':
          break;
        case 'eyes_closed':
          gazeX = 0;
          gazeY = 0;
          eyelidRotX = 0.55;
          break;
        case 'direct_at_camera':
        default: {
          r.head.updateWorldMatrix(true, false);
          _eyeWorldPos.set(0, 0.113, 0.098).applyMatrix4(r.head.matrixWorld);
          r.head.getWorldQuaternion(_headWorldQuatInv).invert();
          _eyeToCamLocal
            .subVectors(cameraWorldPos, _eyeWorldPos)
            .applyQuaternion(_headWorldQuatInv)
            .normalize();

          if (_eyeToCamLocal.z > -0.15) {
            const localYawRad = Math.atan2(_eyeToCamLocal.x, Math.max(0.001, _eyeToCamLocal.z));
            const horizMag = Math.hypot(_eyeToCamLocal.x, Math.max(0.001, _eyeToCamLocal.z));
            const localPitchRad = Math.atan2(_eyeToCamLocal.y, Math.max(0.001, horizMag));

            const maxYawRad = THREE.MathUtils.degToRad(38);
            const maxPitchRad = THREE.MathUtils.degToRad(32);

            const clampedYaw = THREE.MathUtils.clamp(localYawRad, -maxYawRad, maxYawRad);
            const clampedPitch = THREE.MathUtils.clamp(localPitchRad, -maxPitchRad, maxPitchRad);

            const absYawDeg = THREE.MathUtils.radToDeg(Math.abs(localYawRad));
            const rearFade =
              absYawDeg <= 65 ? 1 : Math.max(0, 1 - (absYawDeg - 65) / 33);

            gazeX = (clampedYaw / maxYawRad) * 0.0056 * rearFade;
            gazeY = (clampedPitch / maxPitchRad) * 0.0046 * rearFade;
            eyelidRotX = THREE.MathUtils.clamp(
              -0.38 - (clampedPitch / maxPitchRad) * 0.34 * rearFade,
              -0.56,
              0.08
            );
          } else {
            gazeX = 0;
            gazeY = 0;
            eyelidRotX = -0.38;
          }
          break;
        }
      }

      if (gaze !== 'eyes_closed' && Math.sin(t * 1.7) > 0.985) {
        eyelidRotX = 0.52;
      }

      r.leftPupil.position.x = damp(r.leftPupil.position.x, gazeX, speed, dt);
      r.leftPupil.position.y = damp(r.leftPupil.position.y, gazeY, speed, dt);
      r.rightPupil.position.x = damp(r.rightPupil.position.x, gazeX, speed, dt);
      r.rightPupil.position.y = damp(r.rightPupil.position.y, gazeY, speed, dt);

      r.leftEyelid.rotation.x = damp(r.leftEyelid.rotation.x, eyelidRotX, speed * 1.4, dt);
      r.rightEyelid.rotation.x = damp(r.rightEyelid.rotation.x, eyelidRotX, speed * 1.4, dt);

      // Facial Expressions (Brows & Mouth)
      let browLift = 0.034;
      let browTilt = -0.08;
      let mouthScaleX = 1.0;
      let lowerLipDrop = -0.004;
      let mouthCurve = 0;

      switch (expression) {
        case 'gentle_smile':
          browLift = 0.036;
          browTilt = -0.05;
          mouthScaleX = 1.18;
          mouthCurve = 0.08;
          break;
        case 'expressive_laugh':
          browLift = 0.039;
          browTilt = -0.04;
          mouthScaleX = 1.26;
          lowerLipDrop = -0.012;
          mouthCurve = 0.12;
          break;
        case 'confident_focused':
          browLift = 0.032;
          browTilt = 0.08;
          mouthScaleX = 1.06;
          break;
        case 'determined_intense':
          browLift = 0.029;
          browTilt = 0.18;
          mouthScaleX = 0.94;
          break;
        case 'thoughtful_pensive':
          browLift = 0.035;
          browTilt = -0.14;
          mouthScaleX = 0.88;
          break;
        case 'serious_editorial':
          browLift = 0.031;
          browTilt = 0.04;
          mouthScaleX = 0.92;
          break;
        case 'open_mouth_shock':
          browLift = 0.042;
          browTilt = -0.06;
          mouthScaleX = 1.05;
          lowerLipDrop = -0.022;
          mouthCurve = -0.04;
          break;
        case 'intense_open_mouth':
          browLift = 0.038;
          browTilt = 0.12;
          mouthScaleX = 1.15;
          lowerLipDrop = -0.025;
          mouthCurve = 0.02;
          break;
        case 'gasping_open':
          browLift = 0.039;
          browTilt = -0.08;
          mouthScaleX = 0.96;
          lowerLipDrop = -0.018;
          mouthCurve = -0.02;
          break;
        case 'neutral_relaxed':
        default:
          break;
      }

      r.leftBrow.position.y = damp(r.leftBrow.position.y, browLift, speed, dt);
      r.rightBrow.position.y = damp(r.rightBrow.position.y, browLift, speed, dt);
      r.leftBrow.rotation.z = damp(r.leftBrow.rotation.z, Math.PI / 2 - browTilt, speed, dt);
      r.rightBrow.rotation.z = damp(r.rightBrow.rotation.z, Math.PI / 2 + browTilt, speed, dt);

      r.mouthGroup.scale.x = damp(r.mouthGroup.scale.x, mouthScaleX, speed, dt);
      r.lowerLip.position.y = damp(r.lowerLip.position.y, lowerLipDrop, speed, dt);
      r.upperLip.rotation.z = damp(r.upperLip.rotation.z, Math.PI / 2 + mouthCurve, speed, dt);
    };

    const _wristWorldL = new THREE.Vector3();
    const _wristWorldR = new THREE.Vector3();
    const _kneeWorldL = new THREE.Vector3();
    const _kneeWorldR = new THREE.Vector3();
    const _ankleWorldL = new THREE.Vector3();
    const _ankleWorldR = new THREE.Vector3();
    const _headWorld = new THREE.Vector3();
    const _pelvisWorld = new THREE.Vector3();

    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const isPaused = animPausedRef.current;
      if (!isPaused) {
        animTime += dt;
      }

      const pState = poseStateRef.current;
      const cTarget = camTargetStateRef.current;
      const cCurr = camCurrentStateRef.current;

      // Update optional GLTF mixer if active
      if (gltfMixerRef.current && !isPaused) {
        gltfMixerRef.current.update(dt);
      }

      // Combine Left Movement Joystick & Keyboard WASD for Character Movement
      const mv = moveStickRef.current;
      const km = keyMoveRef.current;
      const keyX = (km.d ? 1 : 0) - (km.a ? 1 : 0);
      const keyY = (km.w ? 1 : 0) - (km.s ? 1 : 0);
      const activeStick = {
        x: Math.abs(mv.x) > 0.01 || Math.abs(mv.y) > 0.01 ? mv.x : keyX,
        y: Math.abs(mv.x) > 0.01 || Math.abs(mv.y) > 0.01 ? mv.y : keyY,
      };

      // Dedicated in-place character turning from Turn buttons or Q/E keys (separate from Camera Joystick)
      const keyTurn = (km.e ? 1 : 0) - (km.q ? 1 : 0);
      const turnStickX =
        Math.abs(charTurnInputRef.current) > 0.01 ? charTurnInputRef.current : keyTurn;

      // Apply Right Camera Joystick (controls camera rotation only; character remains stationary)
      const camStick = normalizeJoystickInput(lookStickRef.current.x, lookStickRef.current.y, 0.05);
      if (camStick.magnitude > 0) {
        const yawDelta = camStick.dirX * camStick.magnitude * 1.85 * dt;
        const pitchDelta = -camStick.dirY * camStick.magnitude * 1.25 * dt;
        if (isFreeOrbitViewRef.current) {
          freeOrbitStateRef.current.yaw = normalizeAngleRad(
            freeOrbitStateRef.current.yaw + yawDelta
          );
          freeOrbitStateRef.current.pitch = Math.max(
            -0.42,
            Math.min(1.42, freeOrbitStateRef.current.pitch + pitchDelta)
          );
        } else {
          cTarget.yaw = normalizeAngleRad(cTarget.yaw + yawDelta);
          cTarget.pitch = Math.max(-0.436, Math.min(1.309, cTarget.pitch + pitchDelta));
          const degYaw = Math.round(THREE.MathUtils.radToDeg(cTarget.yaw));
          const normalizedYaw = ((((degYaw + 180) % 360) + 360) % 360) - 180;
          const degPitch = Math.round(THREE.MathUtils.radToDeg(cTarget.pitch));
          if (!pinShotCameraRef.current || !isPipActiveRef.current) {
            onCameraChangeRef.current({
              yawDeg: normalizedYaw === -180 ? 180 : normalizedYaw,
              pitchDeg: degPitch,
            });
          }
        }
      }

      // Resolve base semantic rig pose first so we know if the character is on the floor or elevated support
      const rawSolvedPose = resolveSemanticCharacterRigPose(pState, ikEnabledRef.current);
      const isOnElevatedSupport = pState.seatHeightY !== null;
      const enableFloorCollision =
        environmentRef.current === 'studio_bedroom' &&
        !isOnElevatedSupport &&
        !pState.interactionPresetId &&
        rawSolvedPose.poseFamily === 'standing';

      // Step subject-relative Pose Placement (X/Z horizontal translation) + independent in-place character turning
      const activeControlYaw = isFreeOrbitViewRef.current
        ? freeOrbitStateRef.current.yaw
        : cCurr.yaw;
      stepThirdPersonLocomotion(
        playerPosRef.current,
        activeStick,
        activeControlYaw,
        dt,
        undefined,
        turnStickX,
        { enableFurnitureCollision: enableFloorCollision }
      );

      // When seated/lying on elevated furniture (bed, chair, window bench, foot bench), safely clamp X/Z
      // within that support surface so the subject never falls off or loses their pose when nudged
      if (isOnElevatedSupport && (Math.abs(activeStick.x) > 0.001 || Math.abs(activeStick.y) > 0.001)) {
        const clamped = clampPosePlacementToSupportBounds(
          pState,
          playerPosRef.current.x,
          playerPosRef.current.z,
          environmentRef.current
        );
        playerPosRef.current.x = clamped.x;
        playerPosRef.current.z = clamped.z;
      }

      // Report updated character orientation & ground position so prompt generation stays 100% synced
      const pRoot = playerPosRef.current;
      const currentCharYawDeg = Math.round(
        ((((THREE.MathUtils.radToDeg(pRoot.rot) + 180) % 360) + 360) % 360) - 180
      );
      const currentPosX = Number(pRoot.x.toFixed(2));
      const currentPosZ = Number(pRoot.z.toFixed(2));
      const lastRep = lastReportedTransformRef.current;
      if (
        onCharacterTransformChangeRef.current &&
        (Math.abs(currentCharYawDeg - lastRep.yawDeg) >= 1 ||
          Math.abs(currentPosX - lastRep.posX) >= 0.01 ||
          Math.abs(currentPosZ - lastRep.posZ) >= 0.01)
      ) {
        lastReportedTransformRef.current = {
          yawDeg: currentCharYawDeg,
          posX: currentPosX,
          posZ: currentPosZ,
        };
        onCharacterTransformChangeRef.current({
          characterYawDeg: currentCharYawDeg,
          characterPosX: currentPosX,
          characterPosZ: currentPosZ,
        });
      }

      const snapPoseNow = snapRigNextFrameRef.current || instantTransitionsRef.current;
      if (snapRigNextFrameRef.current) {
        snapRigNextFrameRef.current = false;
      }
      const rootDt = snapPoseNow ? 1 : dt;

      // Update character root position FIRST so Third Person camera following tracks the rendered root with zero jitter
      if (rig) {
        rig.root.position.x = damp(rig.root.position.x, pRoot.x, snapPoseNow ? 1000 : 18, rootDt);
        rig.root.position.z = damp(rig.root.position.z, pRoot.z, snapPoseNow ? 1000 : 18, rootDt);
        rig.root.rotation.y = dampAngleRad(
          rig.root.rotation.y,
          pRoot.rot,
          snapPoseNow ? 1000 : 16,
          rootDt
        );
      }

      // ==========================================
      // Smooth Camera Orbit, Framing & Composition (Third Person vs Free Orbit)
      // ==========================================
      const camSpeed = 14;
      cCurr.yaw = dampAngleRad(cCurr.yaw, cTarget.yaw, camSpeed, dt);
      cCurr.pitch = damp(cCurr.pitch, cTarget.pitch, camSpeed, dt);
      cCurr.dist = damp(cCurr.dist, cTarget.dist, camSpeed, dt);
      cCurr.height = damp(cCurr.height, cTarget.height, camSpeed, dt);
      cCurr.roll = dampAngleRad(cCurr.roll, cTarget.roll, camSpeed, dt);

      const liveCamSettings = camSettingsRef.current;
      const currentPelvisY = rig ? rig.pelvis.position.y : 0.885;
      const renderedSubjX = rig ? rig.root.position.x : pRoot.x;
      const renderedSubjZ = rig ? rig.root.position.z : pRoot.z;

      const computedShotCam = computePlayboardCameraTransform(
        {
          ...liveCamSettings,
          yawDeg: THREE.MathUtils.radToDeg(cCurr.yaw),
          pitchDeg: THREE.MathUtils.radToDeg(cCurr.pitch),
          distance: cCurr.dist,
          height: cCurr.height,
          rollDeg: THREE.MathUtils.radToDeg(cCurr.roll),
        },
        {
          ...pState,
          characterPosX: renderedSubjX,
          characterPosZ: renderedSubjZ,
        },
        camera.aspect,
        currentPelvisY
      );

      // Apply either Free Orbit Camera (independent target) or Third Person Follow Camera
      if (isFreeOrbitViewRef.current) {
        const fo = freeOrbitStateRef.current;
        const foSpeed = 18;
        fo.currYaw = dampAngleRad(fo.currYaw, fo.yaw, foSpeed, dt);
        fo.currPitch = damp(fo.currPitch, fo.pitch, foSpeed, dt);
        fo.currDist = damp(fo.currDist, fo.dist, foSpeed, dt);
        fo.currTargetX = damp(fo.currTargetX, fo.targetX, foSpeed, dt);
        fo.currTargetY = damp(fo.currTargetY, fo.targetY, foSpeed, dt);
        fo.currTargetZ = damp(fo.currTargetZ, fo.targetZ, foSpeed, dt);

        const evalFo = evaluateFreeOrbitCameraPosition(fo);
        camera.position.set(evalFo.cameraPos.x, evalFo.cameraPos.y, evalFo.cameraPos.z);
        _camTarget.set(evalFo.lookTarget.x, evalFo.lookTarget.y, evalFo.lookTarget.z);
        activeLookTargetRef.current.copy(_camTarget);
        camera.lookAt(_camTarget);
      } else {
        // In Third Person mode, ensure the main camera always follows the active subject smoothly
        const tpCam =
          liveCamSettings.targetMode === 'fixed_composition'
            ? computePlayboardCameraTransform(
                {
                  ...liveCamSettings,
                  targetMode: 'track_subject',
                  yawDeg: THREE.MathUtils.radToDeg(cCurr.yaw),
                  pitchDeg: THREE.MathUtils.radToDeg(cCurr.pitch),
                  distance: cCurr.dist,
                  height: cCurr.height,
                  rollDeg: THREE.MathUtils.radToDeg(cCurr.roll),
                },
                {
                  ...pState,
                  characterPosX: renderedSubjX,
                  characterPosZ: renderedSubjZ,
                },
                camera.aspect,
                currentPelvisY
              )
            : computedShotCam;

        // Smoothly decay any residual mode-transition offset from Free Orbit -> Third Person
        const transDecay = 12;
        tpTransitionCamOffsetRef.current.x = damp(
          tpTransitionCamOffsetRef.current.x,
          0,
          transDecay,
          dt
        );
        tpTransitionCamOffsetRef.current.y = damp(
          tpTransitionCamOffsetRef.current.y,
          0,
          transDecay,
          dt
        );
        tpTransitionCamOffsetRef.current.z = damp(
          tpTransitionCamOffsetRef.current.z,
          0,
          transDecay,
          dt
        );
        tpTransitionLookOffsetRef.current.x = damp(
          tpTransitionLookOffsetRef.current.x,
          0,
          transDecay,
          dt
        );
        tpTransitionLookOffsetRef.current.y = damp(
          tpTransitionLookOffsetRef.current.y,
          0,
          transDecay,
          dt
        );
        tpTransitionLookOffsetRef.current.z = damp(
          tpTransitionLookOffsetRef.current.z,
          0,
          transDecay,
          dt
        );

        _camTarget.copy(tpCam.lookTarget).add(tpTransitionLookOffsetRef.current);
        camera.position.copy(tpCam.cameraPos).add(tpTransitionCamOffsetRef.current);
        activeLookTargetRef.current.copy(_camTarget);
        camera.lookAt(_camTarget);
        camera.rotation.z += tpCam.rollRad;
      }

      // ==========================================
      // Smart Camera-Obstruction Wall Cutaway (Phase 3)
      // ==========================================
      if (environmentRef.current === 'studio_bedroom') {
        const backWallTargetOpacity =
          camera.position.z < -2.25
            ? THREE.MathUtils.clamp((camera.position.z + 2.95) / 0.7, 0.12, 1.0)
            : 1.0;
        const leftWallTargetOpacity =
          camera.position.x < -2.25
            ? THREE.MathUtils.clamp((camera.position.x + 2.95) / 0.7, 0.12, 1.0)
            : 1.0;
        const rightWallTargetOpacity =
          camera.position.x > 2.25
            ? THREE.MathUtils.clamp((2.95 - camera.position.x) / 0.7, 0.12, 1.0)
            : 1.0;
        backWallPlasterMat.opacity = damp(backWallPlasterMat.opacity, backWallTargetOpacity, 14, dt);
        leftWallPlasterMat.opacity = damp(leftWallPlasterMat.opacity, leftWallTargetOpacity, 14, dt);
        rightWallPlasterMat.opacity = damp(rightWallPlasterMat.opacity, rightWallTargetOpacity, 14, dt);
      } else {
        backWallPlasterMat.opacity = 1.0;
        leftWallPlasterMat.opacity = 1.0;
        rightWallPlasterMat.opacity = 1.0;
      }

      // ==========================================
      // Update Stylized Human Rig Kinematics, Transitions, Surface IK & Secondary Motion
      // ==========================================
      if (rig) {
        if (customModelGroupRef.current) {
          const cal = pState.customModelBounds;
          const scaleMult = cal?.scaleMultiplier ?? 1;
          const offY = cal?.offsetY ?? 0;
          const yawOffRad = THREE.MathUtils.degToRad(cal?.yawOffsetDeg ?? 0);
          customModelGroupRef.current.position.set(
            rig.root.position.x,
            rig.root.position.y + offY,
            rig.root.position.z
          );
          customModelGroupRef.current.rotation.set(0, rig.root.rotation.y + yawOffRad, 0);
          customModelGroupRef.current.scale.setScalar(scaleMult);
        }

        // 2. Apply cooperative Surface-Aware Two-Bone IK & Contact (Phase 2B)
        const livePoseWithPos: CharacterPose3DSettings = {
          ...pState,
          characterPosX: pRoot.x,
          characterPosZ: pRoot.z,
          characterYawDeg: THREE.MathUtils.radToDeg(pRoot.rot),
        };
        const ikSolvedPose = applySurfaceContactIKToRigPose(
          rawSolvedPose,
          livePoseWithPos,
          environmentRef.current,
          ikEnabledRef.current && !customGlbUrl,
          furnitureRaycastMeshes
        );

        // 3. Step smooth pose-to-pose transition with coordinated pelvis arc & retargeting (Phase 2A)
        const solvedPose = stepPoseTransition(
          poseTransitionRef.current,
          ikSolvedPose,
          getPosePresetTransitionSignature(pState),
          dt,
          snapPoseNow
        );

        // Determine active locomotion gait blend:
        // Only apply procedural standing walk/run gait when the character is in a standing pose
        // AND walkGaitOnMove is enabled, so non-standing poses (sitting, lying, kneeling, all-fours)
        // or locked poses are never overwritten when translating the character with the left joystick.
        const isPresetLocomotion = pState.isWalking && !isPaused;
        const isPresetRunning = pState.basePose === 'dynamic_running';
        const locoFreq = isPresetRunning ? 10.5 : 6.4;
        const locoPhase = pRoot.walkAmt > 0.03 ? pRoot.walkPhase : animTime * locoFreq;
        const canApplyWalkGait =
          solvedPose.poseFamily === 'standing' &&
          (walkGaitOnMoveRef.current || isPresetLocomotion);
        const locoWeight = canApplyWalkGait
          ? Math.max(pRoot.walkAmt, isPresetLocomotion ? 1 : 0)
          : 0;
        const runWeight = pRoot.walkAmt > 0.03 ? pRoot.runBlend : isPresetRunning ? 1 : 0;
        const strafeWeight = pRoot.walkAmt > 0.03 ? pRoot.strafeBlend : 0;
        const absStrafe = Math.abs(strafeWeight);
        const backWeight = pRoot.walkAmt > 0.03 ? Math.max(0, -pRoot.forwardBlend) : 0;

        // Query active surface under character root for contact shadow & furniture highlight
        const activeRootSurface = querySupportSurfaceAt(
          pRoot.x,
          pRoot.z,
          environmentRef.current,
          typeof pState.seatHeightY === 'number' ? pState.seatHeightY + 0.15 : solvedPose.pelvisY + 0.15,
          furnitureRaycastMeshes
        );
        const shadowTargetY =
          locoWeight > 0.25 ? 0.004 : Math.max(0.003, activeRootSurface.topY + 0.004);
        rig.contactShadow.position.y = damp(rig.contactShadow.position.y, shadowTargetY, 16, dt);

        // Highlight active furniture surface in bedroom
        supportHighlightMeshes.forEach((mesh, sId) => {
          const isSelected = selectedSurfaceIdRef.current === sId;
          const isActiveContact =
            activeRootSurface.id === sId && sId !== 'floor' && locoWeight < 0.2;
          const mat = mesh.material as THREE.MeshBasicMaterial;
          if (isSelected) {
            mat.color.setHex(0x38bdf8);
            mat.opacity = 0.28 + Math.sin(animTime * 4) * 0.06;
          } else if (isActiveContact) {
            mat.color.setHex(0x10b981);
            mat.opacity = 0.16;
          } else {
            mat.opacity = 0;
          }
        });

        // Animate 3D Furniture Anchor Hotspots (hover, selected, and active states)
        hotspotMarkersGroup.visible =
          environmentRef.current === 'studio_bedroom' && showFurnitureHotspotsRef.current;
        if (hotspotMarkersGroup.visible) {
          hotspotVisualNodes.forEach(
            ({ group, ringMat, diamondMat, diamondMesh, baseColor, hotspot }) => {
              const isHovered = hoveredHotspotIdRef.current === hotspot.id;
              const isSelected = selectedHotspotIdRef.current === hotspot.id;
              const isNearSubject =
                Math.hypot(pRoot.x - hotspot.x, pRoot.z - hotspot.z) < 0.36 && locoWeight < 0.2;

              diamondMesh.position.y = 0.095 + Math.sin(animTime * 3.2 + hotspot.x) * 0.014;
              diamondMesh.rotation.y = animTime * 1.4;

              if (isHovered) {
                ringMat.color.setHex(0xf59e0b);
                ringMat.opacity = 0.98;
                diamondMat.color.setHex(0xf59e0b);
                diamondMat.opacity = 0.95;
                group.scale.setScalar(1.22);
              } else if (isSelected || isNearSubject) {
                ringMat.color.setHex(0x10b981);
                ringMat.opacity = 0.92;
                diamondMat.color.setHex(0x10b981);
                diamondMat.opacity = 0.9;
                group.scale.setScalar(1.1);
              } else {
                ringMat.color.setHex(baseColor);
                ringMat.opacity = 0.72;
                diamondMat.color.setHex(baseColor);
                diamondMat.opacity = 0.85;
                group.scale.setScalar(1.0);
              }
            }
          );
        }

        // 4. Step subtle secondary motion & eye-lead gaze response (Phase 2C)
        const secMotion = stepSecondaryMotionAndGaze(
          secondaryMotionRef.current,
          pState.gaze,
          dt,
          isPaused
        );

        let lHipFwdRad = solvedPose.leftHipPitchRad;
        let lHipOutRad = solvedPose.leftHipRollRad;
        let lKneeRad = solvedPose.leftKneePitchRad;
        let lAnklePitchRad = solvedPose.leftAnklePitchRad;

        let rHipFwdRad = solvedPose.rightHipPitchRad;
        let rHipOutRad = solvedPose.rightHipRollRad;
        let rKneeRad = solvedPose.rightKneePitchRad;
        let rAnklePitchRad = solvedPose.rightAnklePitchRad;

        let lShFwdRad = solvedPose.leftShoulderPitchRad;
        let lShOutRad = solvedPose.leftShoulderRollRad;
        let lElbRad = solvedPose.leftElbowPitchRad;

        let rShFwdRad = solvedPose.rightShoulderPitchRad;
        let rShOutRad = solvedPose.rightShoulderRollRad;
        let rElbRad = solvedPose.rightElbowPitchRad;
        let rElbWaveZ = 0;

        let pelvisYaw = 0;
        let pelvisRoll = 0;
        let pelvisLateralX = 0;
        let locoBobY = 0;
        let locoLeanOffsetRad = canApplyWalkGait ? pRoot.leanPitchRad ?? 0 : 0;
        let locoTiltOffsetRad = canApplyWalkGait ? pRoot.leanRollRad ?? 0 : 0;

        // Turn-in-Place Foot Stepping when rotating on the spot (Phase 2D)
        const turnStepAmt = pRoot.turnStepAmt ?? 0;
        const turnPhase = pRoot.turnPhase ?? 0;
        if (
          turnStepAmt > 0.02 &&
          locoWeight < 0.12 &&
          solvedPose.poseFamily === 'standing'
        ) {
          const lTurnLift = Math.max(0, Math.sin(turnPhase)) * turnStepAmt;
          const rTurnLift = Math.max(0, -Math.sin(turnPhase)) * turnStepAmt;
          lHipFwdRad += lTurnLift * 0.22;
          lKneeRad += lTurnLift * 0.42;
          lAnklePitchRad -= lTurnLift * 0.18;

          rHipFwdRad += rTurnLift * 0.22;
          rKneeRad += rTurnLift * 0.42;
          rAnklePitchRad -= rTurnLift * 0.18;

          pelvisYaw += Math.sin(turnPhase) * 0.05 * turnStepAmt;
          locoBobY += Math.abs(Math.sin(turnPhase)) * 0.012 * turnStepAmt;
        }

        // Multi-harmonic Natural Locomotion Cycle (Walk, Run, Backward Walk, Side-Step Strafe)
        if (locoWeight > 0.01) {
          const strideAmp =
            THREE.MathUtils.lerp(0.52, 0.84, runWeight) *
            (1 - backWeight * 0.18) *
            (1 - absStrafe * 0.65);
          const kneeAmp =
            THREE.MathUtils.lerp(0.78, 1.28, runWeight) * (1 - backWeight * 0.14);
          const armSwingAmp =
            THREE.MathUtils.lerp(0.44, 0.78, runWeight) *
            (1 - backWeight * 0.25) *
            (1 - absStrafe * 0.45);

          const s = Math.sin(locoPhase);
          const c = Math.cos(locoPhase);

          // Preserve manually edited leg poses if the user customized leg sliders away from the standing baseline
          const canonicalBase =
            CANONICAL_POSE_PRESET_VALUES[pState.basePose] ||
            CANONICAL_POSE_PRESET_VALUES.natural_standing;
          const lLegManuallyPosed =
            !isPresetLocomotion &&
            (Math.abs(pState.leftLegHipForwardDeg - (canonicalBase.leftLegHipForwardDeg ?? 0)) >= 12 ||
              Math.abs(pState.leftLegKneeBendDeg - (canonicalBase.leftLegKneeBendDeg ?? 0)) >= 15);
          const rLegManuallyPosed =
            !isPresetLocomotion &&
            (Math.abs(pState.rightLegHipForwardDeg - (canonicalBase.rightLegHipForwardDeg ?? 0)) >= 12 ||
              Math.abs(pState.rightLegKneeBendDeg - (canonicalBase.rightLegKneeBendDeg ?? 0)) >= 15);

          if (!lLegManuallyPosed) {
            lHipFwdRad = THREE.MathUtils.lerp(lHipFwdRad, -s * strideAmp, locoWeight);
            if (absStrafe > 0.05) {
              const lStrafeOut =
                -Math.max(0, s) * 0.34 * absStrafe - (strafeWeight < 0 ? 0.1 : 0.03) * absStrafe;
              lHipOutRad = THREE.MathUtils.lerp(lHipOutRad, lStrafeOut, locoWeight * absStrafe);
            }
            const baseKneeLift = THREE.MathUtils.lerp(0.08, 0.28, runWeight);
            const lSwingKnee = Math.max(0, c) * kneeAmp + baseKneeLift;
            lKneeRad = THREE.MathUtils.lerp(lKneeRad, lSwingKnee, locoWeight);
            lAnklePitchRad = THREE.MathUtils.lerp(
              lAnklePitchRad,
              Math.sin(locoPhase - 0.6) * 0.28,
              locoWeight
            );
          }

          if (!rLegManuallyPosed) {
            rHipFwdRad = THREE.MathUtils.lerp(rHipFwdRad, s * strideAmp, locoWeight);
            if (absStrafe > 0.05) {
              const rStrafeOut =
                Math.max(0, -s) * 0.34 * absStrafe + (strafeWeight > 0 ? 0.1 : 0.03) * absStrafe;
              rHipOutRad = THREE.MathUtils.lerp(rHipOutRad, rStrafeOut, locoWeight * absStrafe);
            }
            const baseKneeLift = THREE.MathUtils.lerp(0.08, 0.28, runWeight);
            const rSwingKnee = Math.max(0, -c) * kneeAmp + baseKneeLift;
            rKneeRad = THREE.MathUtils.lerp(rKneeRad, rSwingKnee, locoWeight);
            rAnklePitchRad = THREE.MathUtils.lerp(
              rAnklePitchRad,
              -Math.sin(locoPhase - 0.6) * 0.28,
              locoWeight
            );
          }

          // Preserve manually configured upper-body arm poses during standing locomotion
          const lArmManuallyPosed =
            !isPresetLocomotion &&
            solvedPose.poseFamily === 'standing' &&
            (Math.abs(pState.leftArmShoulderForwardDeg) >= 20 ||
              pState.leftArmShoulderOutDeg >= 28 ||
              pState.leftArmElbowBendDeg >= 40 ||
              pState.leftHandGesture !== 'relaxed_natural');
          const rArmManuallyPosed =
            pState.isWaving ||
            (!isPresetLocomotion &&
              solvedPose.poseFamily === 'standing' &&
              (Math.abs(pState.rightArmShoulderForwardDeg) >= 20 ||
                pState.rightArmShoulderOutDeg >= 28 ||
                pState.rightArmElbowBendDeg >= 40 ||
                pState.rightHandGesture !== 'relaxed_natural'));

          if (!lArmManuallyPosed) {
            lShFwdRad = THREE.MathUtils.lerp(lShFwdRad, -s * armSwingAmp, locoWeight);
            lElbRad = THREE.MathUtils.lerp(
              lElbRad,
              -THREE.MathUtils.lerp(0.38 + Math.max(0, s) * 0.35, 1.25, runWeight),
              locoWeight
            );
          }

          if (!rArmManuallyPosed) {
            rShFwdRad = THREE.MathUtils.lerp(rShFwdRad, s * armSwingAmp, locoWeight);
            rElbRad = THREE.MathUtils.lerp(
              rElbRad,
              -THREE.MathUtils.lerp(0.38 + Math.max(0, -s) * 0.35, 1.25, runWeight),
              locoWeight
            );
          }

          // Pelvic weight shift, counter-rotation & double-frequency vertical bounce
          pelvisYaw = -s * 0.11 * (1 - absStrafe * 0.5) * locoWeight;
          pelvisRoll = c * 0.045 * locoWeight;
          pelvisLateralX = s * 0.022 * locoWeight;
          locoBobY =
            Math.abs(Math.cos(locoPhase)) *
            THREE.MathUtils.lerp(0.028, 0.056, runWeight) *
            locoWeight;
          locoLeanOffsetRad += (runWeight * 0.14 - backWeight * 0.04) * locoWeight;
          locoTiltOffsetRad += -strafeWeight * 0.05 * locoWeight;
        }

        // Welcoming Wave Animation
        if (pState.isWaving) {
          rShFwdRad = -0.35;
          rShOutRad = 1.32;
          rElbRad = -1.45;
          rElbWaveZ = isPaused ? 0 : Math.sin(animTime * 8.5) * 0.36;
        }

        const jointDt = snapPoseNow ? 1 : dt;

        const posePelvisWeight = 1 - locoWeight;
        const targetPelvisRoll = solvedPose.pelvisRollRad * posePelvisWeight + pelvisRoll;
        const targetPelvisPitch = solvedPose.pelvisPitchRad * posePelvisWeight;
        const targetPelvisZ = solvedPose.pelvisZOffset * posePelvisWeight;

        // Counter-compensate spine/chest breathing pitch on floor-supported hands so palms stay planted on the floor
        if (solvedPose.requiresFloorHandContact && locoWeight < 0.05) {
          const breathPitchComp = secMotion.chestBreathPitchRad * 1.75 * posePelvisWeight;
          lShFwdRad -= breathPitchComp;
          rShFwdRad -= breathPitchComp;
        }

        // Apply solvedPose directly (stepPoseTransition already performs quaternion SLERP + smoothstep interpolation)
        rig.pelvis.rotation.y = pelvisYaw;
        rig.pelvis.rotation.z = targetPelvisRoll;
        rig.pelvis.rotation.x = targetPelvisPitch;
        rig.pelvis.position.x = pelvisLateralX;
        rig.pelvis.position.z = targetPelvisZ;

        rig.spine.rotation.x =
          solvedPose.spinePitchRad * posePelvisWeight +
          locoLeanOffsetRad * 0.45 +
          secMotion.chestBreathPitchRad * 0.75;
        rig.spine.rotation.y = solvedPose.spineYawRad - pelvisYaw * 0.36;
        rig.spine.rotation.z = solvedPose.spineRollRad + locoTiltOffsetRad * 0.45;

        rig.chest.rotation.x =
          solvedPose.chestPitchRad * posePelvisWeight +
          locoLeanOffsetRad * 0.55 +
          secMotion.chestBreathPitchRad;
        rig.chest.rotation.y =
          solvedPose.chestYawRad - pelvisYaw * 0.44 + secMotion.chestFollowYawRad;
        rig.chest.rotation.z = solvedPose.chestRollRad + locoTiltOffsetRad * 0.55;

        // Subtle clavicle breathing lift (suppressed when hands bear weight on the floor)
        const clavicleBreathRoll =
          solvedPose.requiresFloorHandContact && locoWeight < 0.05
            ? 0
            : secMotion.shoulderBreathRollRad;
        rig.leftArm.clavicle.rotation.z = -clavicleBreathRoll;
        rig.rightArm.clavicle.rotation.z = clavicleBreathRoll;

        // Neck & Head Rotation + subtle gaze follow & breathing counterbalance
        rig.neck.rotation.y = solvedPose.neckYawRad + secMotion.headFollowYawRad * 0.35;
        rig.neck.rotation.x =
          solvedPose.neckPitchRad +
          secMotion.neckCounterPitchRad * 0.5 +
          secMotion.headFollowPitchRad * 0.35;
        rig.head.rotation.y = solvedPose.headYawRad + secMotion.headFollowYawRad * 0.65;
        rig.head.rotation.x =
          solvedPose.headPitchRad +
          secMotion.neckCounterPitchRad * 0.5 +
          secMotion.headFollowPitchRad * 0.65;

        // Left Arm Bones
        rig.leftArm.shoulder.rotation.x = lShFwdRad;
        rig.leftArm.shoulder.rotation.z = lShOutRad;
        rig.leftArm.elbow.rotation.x = lElbRad;

        // Right Arm Bones
        rig.rightArm.shoulder.rotation.x = rShFwdRad;
        rig.rightArm.shoulder.rotation.z = rShOutRad;
        rig.rightArm.elbow.rotation.x = rElbRad;
        rig.rightArm.elbow.rotation.z = rElbWaveZ;

        // Hand Gestures & 5-Finger Articulation (with floor-support palm orientation & subtle finger micro-relaxation)
        const leftWristSupport = locoWeight > 0.2 ? null : solvedPose.leftWristSupportPitchRad;
        const rightWristSupport = locoWeight > 0.2 ? null : solvedPose.rightWristSupportPitchRad;
        applyHandGestureDamped(
          rig.leftArm.hand,
          pState.leftHandGesture,
          pState.leftArmWristDeg,
          leftWristSupport,
          secMotion.fingerRelaxWaveRad,
          -1,
          animTime,
          jointDt
        );
        applyHandGestureDamped(
          rig.rightArm.hand,
          pState.rightHandGesture,
          pState.rightArmWristDeg,
          rightWristSupport,
          secMotion.fingerRelaxWaveRad,
          1,
          animTime,
          jointDt
        );

        // Left Leg Bones
        rig.leftLeg.hip.rotation.x = lHipFwdRad;
        rig.leftLeg.hip.rotation.z = lHipOutRad;
        rig.leftLeg.knee.rotation.x = lKneeRad;
        rig.leftLeg.ankle.rotation.x = lAnklePitchRad;
        rig.leftLeg.ankle.rotation.y = solvedPose.leftAnkleYawRad;

        // Right Leg Bones
        rig.rightLeg.hip.rotation.x = rHipFwdRad;
        rig.rightLeg.hip.rotation.z = rHipOutRad;
        rig.rightLeg.knee.rotation.x = rKneeRad;
        rig.rightLeg.ankle.rotation.x = rAnklePitchRad;
        rig.rightLeg.ankle.rotation.y = solvedPose.rightAnkleYawRad;

        // Ground-Contact Pelvis Height: solvedPose.pelvisY when stationary, blending to standing during locomotion
        const standingPelvisY = 0.885;
        const targetPelvisY = THREE.MathUtils.lerp(
          solvedPose.pelvisY,
          standingPelvisY,
          locoWeight
        );
        rig.pelvis.position.y = targetPelvisY + locoBobY;

        // Apply Eye-Lead Gaze & Facial Expression
        applyGazeAndExpression(
          rig,
          pState.gaze,
          pState.expression,
          computedShotCam.cameraPos,
          secMotion,
          animTime,
          dt
        );

        // Update Dynamic Furniture Cushion Weight-Indentation Ring & Foot Contact Shadows
        rig.root.updateWorldMatrix(true, true);
        const isSoftFurnitureSurface =
          activeRootSurface.id === 'bed_mattress' ||
          activeRootSurface.id === 'bed_pillow' ||
          activeRootSurface.id === 'chair_seat' ||
          activeRootSurface.id === 'window_bench';
        const targetIndentOpacity =
          isSoftFurnitureSurface && locoWeight < 0.2
            ? 0.54
            : activeRootSurface.id === 'rug' &&
              locoWeight < 0.2 &&
              solvedPose.poseFamily !== 'standing'
            ? 0.36
            : 0;
        const indentMat = rig.cushionIndentMesh.material as THREE.MeshBasicMaterial;
        indentMat.opacity = damp(indentMat.opacity, targetIndentOpacity, 12, dt);
        rig.cushionIndentMesh.position.set(
          rig.pelvis.position.x,
          shadowTargetY + 0.002,
          rig.pelvis.position.z
        );
        const isLyingFamily =
          solvedPose.poseFamily === 'supine_reclined' ||
          solvedPose.poseFamily === 'side_lying' ||
          solvedPose.poseFamily === 'prone';
        const indentScaleZ = isLyingFamily ? 1.48 : 1.0;
        rig.cushionIndentMesh.scale.set(1.05, indentScaleZ, 1);

        // Track Left & Right Foot Contact Shadows
        rig.leftLeg.ankle.getWorldPosition(_ankleWorldL);
        const lFootGroundY = _ankleWorldL.y - 0.074;
        const lSurfY =
          Math.abs(lFootGroundY - activeRootSurface.topY) < Math.abs(lFootGroundY)
            ? activeRootSurface.topY
            : 0;
        const lFootDist = Math.max(0, lFootGroundY - lSurfY);
        rig.root.worldToLocal(_ankleWorldL);
        rig.leftFootShadow.position.set(_ankleWorldL.x, lSurfY + 0.003, _ankleWorldL.z + 0.02);
        (rig.leftFootShadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(
          0.48 * (1 - lFootDist / 0.28),
          0,
          0.48
        );

        rig.rightLeg.ankle.getWorldPosition(_ankleWorldR);
        const rFootGroundY = _ankleWorldR.y - 0.074;
        const rSurfY =
          Math.abs(rFootGroundY - activeRootSurface.topY) < Math.abs(rFootGroundY)
            ? activeRootSurface.topY
            : 0;
        const rFootDist = Math.max(0, rFootGroundY - rSurfY);
        rig.root.worldToLocal(_ankleWorldR);
        rig.rightFootShadow.position.set(_ankleWorldR.x, rSurfY + 0.003, _ankleWorldR.z + 0.02);
        (rig.rightFootShadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(
          0.48 * (1 - rFootDist / 0.28),
          0,
          0.48
        );

        // Update 3D Direct Manipulation Handles positions
        interactiveHandlesGroup.visible = showDirectHandlesRef.current && !customGlbUrl;
        if (interactiveHandlesGroup.visible) {
          rig.root.updateWorldMatrix(true, true);
          const surfaceY = rig.contactShadow.position.y;
          rootRingHandle.position.set(rig.root.position.x, surfaceY + 0.012, rig.root.position.z);
          yawKnobHandle.position.set(
            rig.root.position.x + Math.sin(rig.root.rotation.y) * 0.42,
            surfaceY + 0.032,
            rig.root.position.z + Math.cos(rig.root.rotation.y) * 0.42
          );

          rig.head.getWorldPosition(_headWorld);
          headHandle.position.set(_headWorld.x, _headWorld.y + 0.2, _headWorld.z);

          rig.pelvis.getWorldPosition(_pelvisWorld);
          pelvisHandle.position.set(
            _pelvisWorld.x + Math.sin(rig.root.rotation.y) * 0.14,
            _pelvisWorld.y,
            _pelvisWorld.z + Math.cos(rig.root.rotation.y) * 0.14
          );

          rig.leftArm.hand.wrist.getWorldPosition(_wristWorldL);
          leftWristHandle.position.copy(_wristWorldL);

          rig.rightArm.hand.wrist.getWorldPosition(_wristWorldR);
          rightWristHandle.position.copy(_wristWorldR);

          rig.leftLeg.knee.getWorldPosition(_kneeWorldL);
          leftKneeHandle.position.set(
            _kneeWorldL.x + Math.sin(rig.root.rotation.y) * 0.06,
            _kneeWorldL.y,
            _kneeWorldL.z + Math.cos(rig.root.rotation.y) * 0.06
          );

          rig.rightLeg.knee.getWorldPosition(_kneeWorldR);
          rightKneeHandle.position.set(
            _kneeWorldR.x + Math.sin(rig.root.rotation.y) * 0.06,
            _kneeWorldR.y,
            _kneeWorldR.z + Math.cos(rig.root.rotation.y) * 0.06
          );

          // Highlight active dragged handle
          for (const hm of handleMeshes) {
            const mat = hm.material as THREE.MeshBasicMaterial;
            if (hm.userData.handleId === draggingHandle) {
              mat.color.setHex(0xffffff);
              mat.opacity = 0.98;
            } else {
              mat.color.setHex(hm.userData.defaultColor);
              mat.opacity = hm === rootRingHandle ? 0.55 : 0.76;
            }
          }
        }
        // Update Translucent Ghost-Pose Reference Silhouette when active
        const gRig = ghostRigRef.current;
        const gPose = ghostPoseRef.current;
        if (gRig) {
          const shouldShowGhost = Boolean(showGhostPoseRef.current && gPose && !customGlbUrl);
          gRig.root.visible = shouldShowGhost;
          if (shouldShowGhost && gPose) {
            ghostMaterial.opacity = ghostOpacityRef.current;
            gRig.root.position.set(gPose.characterPosX ?? 0, 0, gPose.characterPosZ ?? 0);
            gRig.root.rotation.y = THREE.MathUtils.degToRad(gPose.characterYawDeg ?? 0);

            const gRaw = resolveSemanticCharacterRigPose(gPose, ikEnabledRef.current);
            const gSolved = applySurfaceContactIKToRigPose(
              gRaw,
              gPose,
              environmentRef.current,
              ikEnabledRef.current,
              furnitureRaycastMeshes
            );
            gRig.pelvis.position.set(0, gSolved.pelvisY, gSolved.pelvisZOffset);
            gRig.pelvis.rotation.set(gSolved.pelvisPitchRad, 0, gSolved.pelvisRollRad);
            gRig.spine.rotation.set(
              gSolved.spinePitchRad,
              gSolved.spineYawRad,
              gSolved.spineRollRad
            );
            gRig.chest.rotation.set(
              gSolved.chestPitchRad,
              gSolved.chestYawRad,
              gSolved.chestRollRad
            );
            gRig.neck.rotation.set(gSolved.neckPitchRad, gSolved.neckYawRad, 0);
            gRig.head.rotation.set(gSolved.headPitchRad, gSolved.headYawRad, 0);

            gRig.leftArm.shoulder.rotation.set(
              gSolved.leftShoulderPitchRad,
              0,
              gSolved.leftShoulderRollRad
            );
            gRig.leftArm.elbow.rotation.set(gSolved.leftElbowPitchRad, 0, 0);
            gRig.rightArm.shoulder.rotation.set(
              gSolved.rightShoulderPitchRad,
              0,
              gSolved.rightShoulderRollRad
            );
            gRig.rightArm.elbow.rotation.set(gSolved.rightElbowPitchRad, 0, 0);

            gRig.leftLeg.hip.rotation.set(gSolved.leftHipPitchRad, 0, gSolved.leftHipRollRad);
            gRig.leftLeg.knee.rotation.set(gSolved.leftKneePitchRad, 0, 0);
            gRig.leftLeg.ankle.rotation.set(
              gSolved.leftAnklePitchRad,
              gSolved.leftAnkleYawRad,
              0
            );
            gRig.rightLeg.hip.rotation.set(gSolved.rightHipPitchRad, 0, gSolved.rightHipRollRad);
            gRig.rightLeg.knee.rotation.set(gSolved.rightKneePitchRad, 0, 0);
            gRig.rightLeg.ankle.rotation.set(
              gSolved.rightAnklePitchRad,
              gSolved.rightAnkleYawRad,
              0
            );
          }
        }
      }

      // Update 3D Visual Scene Gizmos
      const guidesCfg = visualGuidesRef.current;
      const showCamGizmo =
        guidesCfg.cameraGizmoAndTarget || isFreeOrbitViewRef.current;
      groundGridGizmo.visible = guidesCfg.groundGrid;
      worldAxesGizmo.visible = guidesCfg.worldAxes;
      subjectOriginGroup.visible = guidesCfg.subjectOriginAndFacing;

      if (
        guidesCfg.subjectOriginAndFacing ||
        guidesCfg.movementDirection ||
        showCamGizmo ||
        guidesCfg.headAndGazeVectors
      ) {
        const liveGuideGeom = computePlayboardVisualGuidesGeometry(
          {
            ...liveCamSettings,
            yawDeg: THREE.MathUtils.radToDeg(cCurr.yaw),
            pitchDeg: THREE.MathUtils.radToDeg(cCurr.pitch),
            distance: cCurr.dist,
            height: cCurr.height,
            rollDeg: THREE.MathUtils.radToDeg(cCurr.roll),
          },
          {
            ...pState,
            characterPosX: pRoot.x,
            characterPosZ: pRoot.z,
            characterYawDeg: THREE.MathUtils.radToDeg(pRoot.rot),
          },
          activeStick,
          camera.aspect
        );

        if (guidesCfg.subjectOriginAndFacing) {
          subjectOriginGroup.position.set(
            liveGuideGeom.subjectOrigin.x,
            0,
            liveGuideGeom.subjectOrigin.z
          );
          subjectFacingArrow.setDirection(liveGuideGeom.subjectFacingVector);
          subjectRightArrow.setDirection(liveGuideGeom.subjectRightVector);
        }

        if (guidesCfg.movementDirection && liveGuideGeom.hasMovementInput) {
          movementArrow.visible = true;
          movementArrow.position.set(
            liveGuideGeom.subjectOrigin.x,
            0.045,
            liveGuideGeom.subjectOrigin.z
          );
          movementArrow.setDirection(liveGuideGeom.movementWorldVector);
        } else {
          movementArrow.visible = false;
        }

        cameraGizmoGroup.visible = showCamGizmo;
        if (showCamGizmo) {
          camLookTargetSphere.position.copy(liveGuideGeom.cameraLookTarget);
          fixedAnchorRing.visible = liveCamSettings.targetMode === 'fixed_composition';
          fixedAnchorRing.position.set(
            liveGuideGeom.cameraLookTarget.x,
            0.016,
            liveGuideGeom.cameraLookTarget.z
          );
          shotCameraMarkerGroup.visible = isFreeOrbitViewRef.current;
          if (shotCameraMarkerGroup.visible) {
            shotCameraMarkerGroup.position.copy(liveGuideGeom.cameraPosition);
            shotCameraMarkerGroup.lookAt(liveGuideGeom.cameraLookTarget);
          }
          const posAttr = sightlineGeom.getAttribute('position') as THREE.BufferAttribute;
          posAttr.setXYZ(
            0,
            liveGuideGeom.cameraPosition.x,
            liveGuideGeom.cameraPosition.y,
            liveGuideGeom.cameraPosition.z
          );
          posAttr.setXYZ(
            1,
            liveGuideGeom.cameraLookTarget.x,
            liveGuideGeom.cameraLookTarget.y,
            liveGuideGeom.cameraLookTarget.z
          );
          posAttr.needsUpdate = true;
        }

        headAndGazeGroup.visible = guidesCfg.headAndGazeVectors;
        if (guidesCfg.headAndGazeVectors) {
          headForwardArrow.position.copy(liveGuideGeom.eyeMidpoint);
          headForwardArrow.setDirection(liveGuideGeom.headForwardVector);
          eyeGazeArrow.position.copy(liveGuideGeom.eyeMidpoint);
          eyeGazeArrow.setDirection(liveGuideGeom.eyeGazeVector);
        }
      } else {
        movementArrow.visible = false;
        cameraGizmoGroup.visible = false;
        headAndGazeGroup.visible = false;
      }

      const fullW = mountRef.current?.clientWidth || canvas.clientWidth || 1;
      const fullH = mountRef.current?.clientHeight || canvas.clientHeight || 1;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, fullW, fullH);

      if (composer && bokehPass && studioRealismModeRef.current) {
        let focusDist = camera.position.distanceTo(activeLookTargetRef.current);
        if (rig && !customGlbUrl) {
          rig.head.getWorldPosition(_headWorld);
          _headWorld.y += 0.11;
          focusDist = camera.position.distanceTo(_headWorld);
        }
        const dofParams = computeOpticalBokehParams(
          liveCamSettings.focalLength,
          liveCamSettings.focusDof,
          focusDist
        );
        const uniforms = bokehPass.uniforms as Record<string, { value: number }>;
        if (uniforms['focus']) uniforms['focus'].value = dofParams.focusDistance;
        if (uniforms['aperture']) uniforms['aperture'].value = dofParams.aperture;
        if (uniforms['maxblur']) uniforms['maxblur'].value = dofParams.maxBlur;
        bokehPass.enabled = dofParams.maxBlur > 0.0002;
        composer.render(dt);
      } else {
        renderer.render(scene, camera);
      }

      // ==========================================
      // Live Shot-Camera Picture-in-Picture (PiP) Render Pass
      // ==========================================
      if (isPipActiveRef.current) {
        const pip = pipRectRef.current;
        const pipAspect = pip.width / Math.max(1, pip.height);
        const pipCam = shotPreviewCamera;
        pipCam.aspect = pipAspect;
        pipCam.updateProjectionMatrix();

        // When Shot Camera is pinned (or in Free Orbit mode), render from pinned Shot Camera parameters
        // so orbiting/inspecting with the main camera never alters the Shot Camera preview
        const usePinnedShot = isFreeOrbitViewRef.current || pinShotCameraRef.current;
        const pinned = pinnedShotCameraRef.current;
        const pipShotTransform = computePlayboardCameraTransform(
          {
            ...liveCamSettings,
            yawDeg: usePinnedShot ? pinned.yawDeg : THREE.MathUtils.radToDeg(cCurr.yaw),
            pitchDeg: usePinnedShot ? pinned.pitchDeg : THREE.MathUtils.radToDeg(cCurr.pitch),
            distance: usePinnedShot ? pinned.distance : cCurr.dist,
            height: usePinnedShot ? pinned.height : cCurr.height,
            rollDeg: usePinnedShot ? pinned.rollDeg : THREE.MathUtils.radToDeg(cCurr.roll),
          },
          {
            ...pState,
            characterPosX: renderedSubjX,
            characterPosZ: renderedSubjZ,
          },
          pipAspect,
          currentPelvisY
        );
        pipCam.position.copy(pipShotTransform.cameraPos);
        pipCam.lookAt(pipShotTransform.lookTarget);
        pipCam.rotation.z += pipShotTransform.rollRad;

        // Temporarily hide editor-only 3D gizmos, handles, and hotspot markers so PiP shows clean final shot
        const prevGizmosVis = gizmosRoot.visible;
        const prevHotspotsVis = hotspotMarkersGroup.visible;
        const prevSupportVis = supportCollidersGroup.visible;
        const prevGhostVis = ghostRigRef.current ? ghostRigRef.current.root.visible : false;
        gizmosRoot.visible = false;
        hotspotMarkersGroup.visible = false;
        supportCollidersGroup.visible = false;
        if (ghostRigRef.current) ghostRigRef.current.root.visible = false;

        // Update wall cutaway for the actual shot camera position during PiP render
        const savedBackOpacity = backWallPlasterMat.opacity;
        const savedLeftOpacity = leftWallPlasterMat.opacity;
        if (environmentRef.current === 'studio_bedroom') {
          backWallPlasterMat.opacity =
            pipCam.position.z < -1.78
              ? THREE.MathUtils.clamp((pipCam.position.z + 2.35) / 0.57, 0.12, 1.0)
              : 1.0;
          leftWallPlasterMat.opacity =
            pipCam.position.x < -2.28
              ? THREE.MathUtils.clamp((pipCam.position.x + 2.85) / 0.57, 0.12, 1.0)
              : 1.0;
        }

        const glY = Math.max(0, fullH - pip.top - pip.height);
        renderer.setScissorTest(true);
        renderer.setViewport(pip.left, glY, pip.width, pip.height);
        renderer.setScissor(pip.left, glY, pip.width, pip.height);
        renderer.render(scene, pipCam);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, fullW, fullH);

        // Restore editor visibility and wall opacity
        gizmosRoot.visible = prevGizmosVis;
        hotspotMarkersGroup.visible = prevHotspotsVis;
        supportCollidersGroup.visible = prevSupportVis;
        if (ghostRigRef.current) ghostRigRef.current.root.visible = prevGhostVis;
        backWallPlasterMat.opacity = savedBackOpacity;
        leftWallPlasterMat.opacity = savedLeftOpacity;
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);

    // Cleanup
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlurOrHide);
      document.removeEventListener('visibilitychange', onWindowBlurOrHide);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('lostpointercapture', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);

      composer?.dispose();
      renderer.dispose();
      scene.clear();
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };
  }, []);

  const handleStepZoom = (factor: number) => {
    if (isFreeOrbitViewRef.current) {
      freeOrbitStateRef.current.dist = Math.max(
        0.9,
        Math.min(8.5, Number((freeOrbitStateRef.current.dist * factor).toFixed(2)))
      );
      return;
    }
    const c = camTargetStateRef.current;
    c.dist = Math.max(1.0, Math.min(6.5, Number((c.dist * factor).toFixed(2))));
    if (!pinShotCameraRef.current || !isPipActiveRef.current) {
      onCameraChangeRef.current({ distance: c.dist });
    }
  };

  const activeHotspot = useMemo(() => {
    if (!selectedHotspotId) return null;
    return FURNITURE_ANCHOR_HOTSPOTS.find((h) => h.id === selectedHotspotId) ?? null;
  }, [selectedHotspotId]);

  // Presets matching the currently selected bedroom furniture hotspot or surface
  const surfaceQuickPresets = useMemo(() => {
    if (environment !== 'studio_bedroom') return [];
    if (activeHotspot) {
      const byIds = SCENE_INTERACTION_PRESETS.filter((p) =>
        activeHotspot.recommendedPresets.includes(p.id)
      );
      if (byIds.length > 0) return byIds;
    }
    if (!selectedSurfaceId) return [];
    const targetMap: Record<PlayboardSupportSurfaceId, string[]> = {
      floor: ['floor'],
      rug: ['floor'],
      bed_mattress: ['bed'],
      bed_pillow: ['bed'],
      chair_seat: ['chair', 'desk'],
      desk_top: ['desk', 'chair'],
      window_bench: ['wall', 'floor'],
    };
    const allowedTargets = targetMap[selectedSurfaceId] || [];
    return SCENE_INTERACTION_PRESETS.filter((p) =>
      allowedTargets.includes(p.furnitureTarget)
    ).slice(0, 6);
  }, [activeHotspot, selectedSurfaceId, environment]);

  const activeSurfaceLabel = useMemo(() => {
    if (activeHotspot) return activeHotspot.label;
    if (!selectedSurfaceId) return null;
    const found = STUDIO_BEDROOM_SUPPORT_SURFACES.find((s) => s.id === selectedSurfaceId);
    return found?.label ?? selectedSurfaceId;
  }, [activeHotspot, selectedSurfaceId]);

  const applyHotspotPoseOption = (poseKey: PosePreset) => {
    if (!onPoseChangeRef.current) return;
    const canonical = CANONICAL_POSE_PRESET_VALUES[poseKey];
    if (!canonical) return;
    const targetHotspot = activeHotspot;
    const targetSurf = STUDIO_BEDROOM_SUPPORT_SURFACES.find(
      (s) => s.id === (targetHotspot?.surfaceId ?? selectedSurfaceId ?? 'floor')
    );
    const surfTopY = targetHotspot?.topY ?? targetSurf?.topY ?? 0;
    const isSeatedPose =
      poseKey === 'casual_sitting' || poseKey === 'floor_seated_cross_legged';
    const isLyingPose =
      poseKey === 'reclined_lying' ||
      poseKey === 'side_lying_open' ||
      poseKey === 'prone_hip_elevated';
    const nextSeatHeightY =
      surfTopY > 0.05
        ? isSeatedPose
          ? Number((surfTopY + PELVIS_SEATED_GLUTE_CLEARANCE_M).toFixed(3))
          : isLyingPose
          ? Number((surfTopY + PELVIS_LYING_BACK_CLEARANCE_M).toFixed(3))
          : null
        : null;

    onPoseChangeRef.current({
      ...canonical,
      basePose: poseKey,
      interactionPresetId: null,
      seatHeightY: nextSeatHeightY,
    });
  };

  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-slate-950">
      {/* 3D WebGL Canvas Mount Container */}
      <div ref={mountRef} className="w-full h-full touch-none select-none" />

      {/* Top-Left Telemetry Readout & Explicit Camera Mode Switcher */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-2.5 left-2.5 flex flex-wrap items-center gap-1.5 z-20 max-w-[calc(100%-64px)] pointer-events-auto"
      >
        {/* Explicit Camera Mode Segmented Control (Requirement 2: Third Person vs Free Orbit) */}
        <div
          data-testid="camera-mode-switcher"
          className="inline-flex items-center rounded-lg bg-slate-900/95 p-0.5 border border-slate-700/80 shadow-md"
        >
          <button
            type="button"
            data-testid="camera-mode-third-person"
            onClick={() => handleSwitchCameraMode('third_person')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold transition cursor-pointer touch-manipulation ${
              activeCameraMode === 'third_person'
                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
            title="Third Person Mode: Camera smoothly follows the active subject as it moves"
          >
            🚶 Third Person
          </button>
          <button
            type="button"
            data-testid="camera-mode-free-orbit"
            onClick={() => handleSwitchCameraMode('free_orbit')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold transition cursor-pointer touch-manipulation ${
              activeCameraMode === 'free_orbit'
                ? 'bg-amber-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
            title="Free Orbit Mode: Orbit, zoom, and pan independently without snapping back when the character moves"
          >
            🌐 Free Orbit
          </button>
        </div>

        {isFreeOrbitView && (
          <button
            type="button"
            data-testid="free-orbit-center-subject-btn"
            onClick={handleRecenterFreeOrbitOnSubject}
            className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-md bg-slate-900/90 hover:bg-slate-800 text-amber-300 border border-amber-500/50 shadow-sm cursor-pointer touch-manipulation"
            title="Center Free Orbit target on active subject"
          >
            🎯 Center Target
          </button>
        )}

        <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-slate-900/90 text-emerald-400 border border-slate-700/70 shadow-sm pointer-events-none">
          {cameraSettings.yawDeg >= 0 ? `+${cameraSettings.yawDeg}` : cameraSettings.yawDeg}° Yaw ·{' '}
          {cameraSettings.pitchDeg >= 0 ? `+${cameraSettings.pitchDeg}` : cameraSettings.pitchDeg}° Pitch
        </span>
        <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-slate-900/90 text-amber-300 border border-slate-700/70 shadow-sm pointer-events-none">
          {cameraSettings.distance}m · {cameraSettings.height}m H
        </span>
        <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-slate-900/90 text-sky-400 border border-slate-700/70 shadow-sm pointer-events-none">
          {cameraSettings.focalLength.split('_')[0]} · {liveFramingAnalysis.shotSizeLabel} ·{' '}
          {cameraSettings.outputRatio}
        </span>
        {hoveredHotspotLabel && (
          <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-amber-400 text-slate-950 border border-amber-200 shadow-sm pointer-events-none">
            📍 Click Hotspot: {hoveredHotspotLabel}
          </span>
        )}
        {selectedJointBadge && (
          <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-indigo-600 text-white border border-indigo-400 shadow-sm pointer-events-none">
            {selectedJointBadge}
          </span>
        )}
      </div>

      {/* Contextual Bedroom Furniture Hotspot & Surface Quick-Pose Bar (Phase 5) */}
      {environment === 'studio_bedroom' &&
        (selectedHotspotId || selectedSurfaceId) &&
        (surfaceQuickPresets.length > 0 || (activeHotspot?.recommendedPoses.length ?? 0) > 0) && (
          <div
            data-testid="surface-quick-pose-bar"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-11 left-2.5 z-20 flex flex-wrap items-center gap-1.5 bg-slate-900/95 border border-sky-500/50 rounded-xl px-2.5 py-1.5 shadow-2xl max-w-[calc(100%-70px)]"
          >
            <span className="text-[11px] font-semibold text-sky-300 mr-1">
              📍 {activeSurfaceLabel}:
            </span>
            {surfaceQuickPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectSceneInteractionPreset?.(preset)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                  poseSettings.interactionPresetId === preset.id
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
            {activeHotspot &&
              activeHotspot.recommendedPoses.map((poseKey) => (
                <button
                  key={poseKey}
                  type="button"
                  onClick={() => applyHotspotPoseOption(poseKey)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-mono transition cursor-pointer ${
                    poseSettings.basePose === poseKey && !poseSettings.interactionPresetId
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'bg-slate-800/80 hover:bg-slate-700 text-emerald-300 border border-emerald-700/50'
                  }`}
                  title={`Transition into ${poseKey.replace(/_/g, ' ')} at ${activeHotspot.label}`}
                >
                  pose: {poseKey.replace(/_/g, ' ')}
                </button>
              ))}
            <button
              type="button"
              onClick={() => {
                setSelectedHotspotId(null);
                setSelectedSurfaceId(null);
              }}
              className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              title="Dismiss hotspot bar"
            >
              ✕
            </button>
          </div>
        )}

      {/* Live Picture-in-Picture (PiP) Shot-Camera Preview Window Overlay */}
      {isPipActive && (
        <div
          data-testid="live-shot-pip-preview"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            left: `${pipRect.left}px`,
            top: `${pipRect.top}px`,
            width: `${pipRect.width}px`,
            height: `${pipRect.height}px`,
          }}
          className="absolute z-20 rounded-xl border-2 border-amber-400/90 shadow-2xl pointer-events-none overflow-hidden flex flex-col justify-between"
        >
          {/* Top Header Bar inside PiP */}
          <div className="flex items-center justify-between gap-1 bg-slate-950/85 px-2 py-1 border-b border-amber-400/40 pointer-events-auto">
            <span className="text-[10px] font-mono font-bold text-amber-300 truncate">
              🎬 SHOT CAM · {cameraSettings.outputRatio}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="pip-pin-shot-btn"
                onClick={() => {
                  const nextPin = !pinShotCamera;
                  setPinShotCamera(nextPin);
                  if (nextPin) {
                    pinnedShotCameraRef.current = {
                      yawDeg: Math.round(THREE.MathUtils.radToDeg(camCurrentStateRef.current.yaw)),
                      pitchDeg: Math.round(THREE.MathUtils.radToDeg(camCurrentStateRef.current.pitch)),
                      distance: Number(camCurrentStateRef.current.dist.toFixed(2)),
                      height: Number(camCurrentStateRef.current.height.toFixed(2)),
                      rollDeg: Math.round(THREE.MathUtils.radToDeg(camCurrentStateRef.current.roll)),
                    };
                  }
                }}
                className={`px-1 py-0.5 rounded text-[9px] font-mono cursor-pointer ${
                  pinShotCamera || isFreeOrbitView
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title={
                  pinShotCamera || isFreeOrbitView
                    ? 'Shot Camera Pinned (independent of main viewport camera)'
                    : 'Pin Shot Camera independently of main camera'
                }
              >
                {pinShotCamera || isFreeOrbitView ? '🔒' : '🔓'}
              </button>
              <button
                type="button"
                onClick={() => setPipThirdsGrid((v) => !v)}
                className={`px-1 py-0.5 rounded text-[9px] font-mono cursor-pointer ${
                  pipThirdsGrid
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Toggle Rule-of-Thirds Grid in Shot Preview"
              >
                #
              </button>
              <button
                type="button"
                onClick={() => setPipLargeSize((v) => !v)}
                className="px-1 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer"
                title={pipLargeSize ? 'Compact PiP Size' : 'Expand PiP Size'}
              >
                {pipLargeSize ? '−' : '⤢'}
              </button>
              <button
                type="button"
                onClick={() => setShowShotPreviewPip(false)}
                className="px-1 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                title="Hide Live Shot Preview"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Optional Rule-of-Thirds Grid inside PiP */}
          {pipThirdsGrid && (
            <div className="flex-1 grid grid-cols-3 grid-rows-3 pointer-events-none">
              {Array.from({ length: 9 }).map((_, idx) => (
                <div key={idx} className="border border-white/20" />
              ))}
            </div>
          )}

          {/* Bottom Telemetry Strip inside PiP */}
          <div className="bg-slate-950/80 px-2 py-0.5 text-[9px] font-mono text-sky-300 flex justify-between items-center border-t border-slate-800/80">
            <span>{liveFramingAnalysis.shotSizeLabel}</span>
            <span>{cameraSettings.focalLength.split('_')[0]}</span>
          </div>
        </div>
      )}

      {/* 2D Rule-of-Thirds Grid Overlay */}
      {effectiveGuides.ruleOfThirdsOverlay && (
        <div
          data-testid="rule-of-thirds-overlay"
          className="absolute inset-0 pointer-events-none z-10"
        >
          <div className="w-full h-full grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, idx) => (
              <div key={idx} className="border border-white/20" />
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 border border-amber-400/70 rounded-full" />
          </div>
        </div>
      )}

      {/* 2D Safe Framing & Aspect Crop Overlay */}
      {effectiveGuides.safeFramingGuides && (
        <div
          data-testid="safe-framing-overlay"
          className="absolute inset-4 border-2 border-dashed border-sky-400/55 rounded-lg pointer-events-none z-10 flex flex-col justify-between p-2"
        >
          <div className="flex justify-between items-center text-[10px] font-mono text-sky-300/90 bg-slate-950/75 px-1.5 py-0.5 rounded self-start">
            <span>
              REQ: {cameraSettings.framing.replace(/_/g, ' ').toUpperCase()} · MEASURED:{' '}
              {liveFramingAnalysis.shotSizeLabel.toUpperCase()}
            </span>
          </div>
          <div className="flex justify-between items-center text-[10px] font-mono text-amber-300/90 bg-slate-950/75 px-1.5 py-0.5 rounded self-end">
            <span>
              MODE: {activeCameraMode === 'free_orbit' ? 'FREE ORBIT' : 'THIRD PERSON'} ·{' '}
              {cameraSettings.outputRatio}
            </span>
          </div>
        </div>
      )}

      {/* Top-Right Zoom, View Mode, Handles, Lighting, & Guides Buttons */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-2.5 right-2.5 flex flex-col gap-1.5 z-20 items-end"
      >
        <button
          type="button"
          onClick={() => handleStepZoom(0.84)}
          className="w-9 h-9 rounded-xl bg-slate-900/90 hover:bg-slate-800 active:bg-indigo-600 text-white font-bold text-lg leading-none border border-slate-700/80 shadow-md flex items-center justify-center cursor-pointer touch-manipulation"
          aria-label="Zoom in"
          title="Zoom In"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => handleStepZoom(1.18)}
          className="w-9 h-9 rounded-xl bg-slate-900/90 hover:bg-slate-800 active:bg-indigo-600 text-white font-bold text-lg leading-none border border-slate-700/80 shadow-md flex items-center justify-center cursor-pointer touch-manipulation"
          aria-label="Zoom out"
          title="Zoom Out"
        >
          −
        </button>
        <button
          type="button"
          data-testid="toggle-view-mode-btn"
          onClick={() =>
            handleSwitchCameraMode(isFreeOrbitView ? 'third_person' : 'free_orbit')
          }
          className={`w-9 h-9 rounded-xl text-[11px] font-mono font-bold border shadow-md flex items-center justify-center cursor-pointer touch-manipulation ${
            isFreeOrbitView
              ? 'bg-amber-500 text-slate-950 border-amber-300'
              : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-slate-700/80'
          }`}
          title={
            !isFreeOrbitView
              ? 'Switch to Free Orbit Camera Mode (keeps Shot Camera pinned)'
              : 'Return to Third Person Follow Camera Mode'
          }
        >
          🎥
        </button>
        <button
          type="button"
          data-testid="toggle-shot-pip-btn"
          onClick={() => setShowShotPreviewPip((prev) => !prev)}
          className={`w-9 h-9 rounded-xl text-[11px] font-mono font-bold border shadow-md flex items-center justify-center cursor-pointer touch-manipulation ${
            isPipActive
              ? 'bg-amber-500 text-slate-950 border-amber-300'
              : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-slate-700/80'
          }`}
          title="Toggle Live Picture-in-Picture (PiP) Shot Camera Preview"
        >
          🖼️
        </button>
        <button
          type="button"
          data-testid="toggle-direct-handles-btn"
          onClick={() => setShowDirectHandles((prev) => !prev)}
          className={`w-9 h-9 rounded-xl text-[11px] font-mono font-bold border shadow-md flex items-center justify-center cursor-pointer touch-manipulation ${
            showDirectHandles
              ? 'bg-sky-600 text-white border-sky-400'
              : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-700/80'
          }`}
          title="Toggle 3D Joint & Root Manipulation Handles"
        >
          🎯
        </button>
        {ghostPoseSettings && (
          <button
            type="button"
            data-testid="toggle-ghost-pose-btn"
            onClick={() => handleToggleGhost()}
            className={`w-9 h-9 rounded-xl text-[11px] font-mono font-bold border shadow-md flex items-center justify-center cursor-pointer touch-manipulation ${
              effectiveShowGhost
                ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-700/80'
            }`}
            title={`Toggle Ghost Reference Silhouette (${effectiveGhostLabel})`}
          >
            👻
          </button>
        )}
        {onToggleAnimationPause && (
          <button
            type="button"
            onClick={onToggleAnimationPause}
            className={`w-9 h-9 rounded-xl text-xs font-bold border shadow-md flex items-center justify-center cursor-pointer touch-manipulation ${
              animationPaused
                ? 'bg-amber-500 text-slate-950 border-amber-400'
                : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-slate-700/80'
            }`}
            title={
              animationPaused
                ? 'Resume Character Animation'
                : 'Freeze / Pause Secondary Motion for Deterministic I2I Posing'
            }
          >
            {animationPaused ? '▶' : '⏸'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowGuidesMenu((v) => !v)}
          className={`w-9 h-9 rounded-xl text-[11px] font-mono font-bold border shadow-md flex items-center justify-center cursor-pointer touch-manipulation ${
            showGuidesMenu ||
            effectiveGuides.headAndGazeVectors ||
            effectiveGuides.cameraGizmoAndTarget ||
            effectiveGuides.ruleOfThirdsOverlay ||
            effectiveGuides.safeFramingGuides
              ? 'bg-indigo-600 text-white border-indigo-400'
              : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-slate-700/80'
          }`}
          title="Toggle 3D & 2D Visual Guides, Lighting & Motion Settings"
        >
          📐
        </button>
        {showGuidesMenu && (
          <div className="mt-1 w-64 rounded-xl bg-slate-900/95 border border-slate-700/90 p-2.5 shadow-2xl text-[11px] text-slate-200 space-y-1.5 max-h-[70vh] overflow-y-auto">
            <div className="font-semibold text-slate-300 border-b border-slate-800 pb-1 mb-1 flex justify-between items-center">
              <span>Viewport & Studio Options</span>
              <button
                type="button"
                onClick={() => setShowGuidesMenu(false)}
                className="text-slate-400 hover:text-white px-1"
              >
                ✕
              </button>
            </div>

            <div className="pb-1.5 border-b border-slate-800">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Bedroom Lighting Preset
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(
                  [
                    ['daylight_warm', '☀️ Daylight'],
                    ['golden_hour', '🌇 Golden Hour'],
                    ['cozy_evening', '🌙 Cozy Lamp'],
                    ['studio_neutral', '💡 Neutral'],
                  ] as [PlayboardLightingPreset, string][]
                ).map(([presetId, label]) => (
                  <button
                    key={presetId}
                    type="button"
                    onClick={() => handleChangeLighting(presetId)}
                    className={`px-2 py-1 rounded text-[10px] font-medium text-left cursor-pointer ${
                      effectiveLighting === presetId
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/70 px-1.5 py-1 rounded border-b border-slate-800/80">
              <span className="font-semibold text-amber-300">
                ✨ Studio Realism (Optical DOF & Bloom)
              </span>
              <input
                type="checkbox"
                data-testid="toggle-studio-realism-checkbox"
                checked={studioRealismMode}
                onChange={() => setStudioRealismMode((v) => !v)}
                className="accent-amber-400 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/70 px-1.5 py-1 rounded border-b border-slate-800/80">
              <span>Instant Pose Snap (Reduced Motion)</span>
              <input
                type="checkbox"
                checked={effectiveInstantTransitions}
                onChange={handleToggleInstantPose}
                className="accent-indigo-500 rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/70 px-1.5 py-1 rounded border-b border-slate-800/80">
              <span>Walk Gait Cycle on Move</span>
              <input
                type="checkbox"
                checked={walkGaitOnMove}
                onChange={() => setWalkGaitOnMove((v) => !v)}
                className="accent-indigo-500 rounded cursor-pointer"
              />
            </label>

            {environment === 'studio_bedroom' && (
              <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/70 px-1.5 py-1 rounded border-b border-slate-800/80">
                <span>3D Furniture Hotspots (8 Pins)</span>
                <input
                  type="checkbox"
                  checked={showFurnitureHotspots}
                  onChange={() => setShowFurnitureHotspots((v) => !v)}
                  className="accent-indigo-500 rounded cursor-pointer"
                />
              </label>
            )}

            <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/70 px-1.5 py-1 rounded border-b border-slate-800/80">
              <span>Live Shot-Camera PiP Preview</span>
              <input
                type="checkbox"
                checked={isPipActive}
                onChange={() => setShowShotPreviewPip((v) => !v)}
                className="accent-indigo-500 rounded cursor-pointer"
              />
            </label>

            <div className="pb-1.5 border-b border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                  👻 Ghost Pose Overlay
                </span>
                <button
                  type="button"
                  onClick={handleCaptureGhost}
                  className="px-1.5 py-0.5 rounded bg-cyan-900/60 hover:bg-cyan-800 text-cyan-200 text-[9px] font-semibold border border-cyan-700/60 cursor-pointer"
                  title="Snapshot current pose as Ghost Reference Silhouette"
                >
                  Snapshot Pose
                </button>
              </div>
              {effectiveGhostPose ? (
                <>
                  <label className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/70 px-1.5 py-0.5 rounded">
                    <span className="truncate text-[10px] text-slate-300">
                      Show ({effectiveGhostLabel})
                    </span>
                    <input
                      type="checkbox"
                      checked={effectiveShowGhost}
                      onChange={() => handleToggleGhost()}
                      className="accent-cyan-400 rounded cursor-pointer"
                    />
                  </label>
                  {effectiveShowGhost && (
                    <div className="flex items-center gap-2 px-1.5">
                      <span className="text-[9px] text-slate-400">Opacity</span>
                      <input
                        type="range"
                        min={0.1}
                        max={0.75}
                        step={0.05}
                        value={effectiveGhostOpacity}
                        onChange={(e) => handleGhostOpacity(Number(e.target.value))}
                        className="flex-1 accent-cyan-400 cursor-pointer"
                      />
                      <span className="text-[9px] font-mono text-cyan-300">
                        {Math.round(effectiveGhostOpacity * 100)}%
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[10px] text-slate-400 px-1">
                  Save a checkpoint or click Snapshot Pose to compare silhouettes.
                </div>
              )}
            </div>

            {(
              [
                ['subjectOriginAndFacing', 'Subject Origin & Facing (Green)'],
                ['movementDirection', 'Movement Basis Vector (Indigo)'],
                ['headAndGazeVectors', 'Head (Violet) & Gaze (Cyan) Rays'],
                ['cameraGizmoAndTarget', 'Camera Look-Target & Sightline'],
                ['ruleOfThirdsOverlay', 'Rule-of-Thirds Grid (2D)'],
                ['safeFramingGuides', 'Safe Framing & Aspect Guide'],
                ['groundGrid', '3D Floor Reference Grid'],
                ['worldAxes', 'World Origin Axes (+X/+Y/+Z)'],
              ] as [keyof PlayboardVisualGuidesConfig, string][]
            ).map(([k, label]) => (
              <label
                key={k}
                className="flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/70 px-1.5 py-1 rounded"
              >
                <span className="truncate">{label}</span>
                <input
                  type="checkbox"
                  checked={effectiveGuides[k]}
                  onChange={() => handleToggleGuide(k)}
                  className="accent-indigo-500 rounded cursor-pointer"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* On-Screen Joysticks: Left = Character Move Only, Center = Turn Character, Right = Camera Rotate Only */}
      {showJoysticks && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute bottom-14 left-3 right-3 flex items-end justify-between pointer-events-none z-20"
        >
          {/* Left Blue Joystick: Pose Placement Joystick (Horizontal X/Z Pose Repositioning Without Walking) */}
          <div className="flex flex-col items-start gap-1.5 pointer-events-auto">
            <div className="flex items-center gap-1 bg-slate-950/90 border border-indigo-500/50 rounded-lg px-2 py-0.5 shadow-md">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-indigo-200">
                Pose Placement · X/Z
              </span>
              <button
                type="button"
                data-testid="reset-pose-placement-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  const activeSupport = inferActiveSupportSurface(poseStateRef.current);
                  const activePreset = getInteractionPresetById(poseStateRef.current.interactionPresetId);
                  const targetX = activePreset ? activePreset.anchorX : activeSupport.anchorX;
                  const targetZ = activePreset ? activePreset.anchorZ : activeSupport.anchorZ;
                  playerPosRef.current.x = targetX;
                  playerPosRef.current.z = targetZ;
                  playerPosRef.current.vx = 0;
                  playerPosRef.current.vz = 0;
                  snapRigNextFrameRef.current = true;
                  if (onPoseChangeRef.current) {
                    onPoseChangeRef.current({
                      characterPosX: targetX,
                      characterPosZ: targetZ,
                      anchorPosX: targetX,
                      anchorPosZ: targetZ,
                    });
                  }
                }}
                title="Center / Reset subject placement to the active support surface anchor"
                className="ml-1 px-1.5 py-0.5 rounded bg-indigo-600/80 hover:bg-indigo-500 text-[8px] font-mono font-bold text-white cursor-pointer"
              >
                Center
              </button>
            </div>
            <div
              data-testid="left-move-joystick"
              title="Pose Placement Joystick: Slide the stationary pose smoothly across the floor or active support surface (X/Z) without walking"
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-slate-900/85 border-2 border-indigo-500/80 flex items-center justify-center relative touch-none select-none shadow-xl pointer-events-auto"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const activePointerId = e.pointerId;
                ownedUiPointerIdsRef.current.add(activePointerId);
                const target = e.currentTarget;
                try {
                  target.setPointerCapture(activePointerId);
                } catch {
                  // ignore
                }
                const updateKnob = (ev: PointerEvent) => {
                  if (ev.pointerId !== activePointerId) return;
                  const rect = target.getBoundingClientRect();
                  const cx = rect.left + rect.width / 2;
                  const cy = rect.top + rect.height / 2;
                  let dx = ev.clientX - cx;
                  let dy = ev.clientY - cy;
                  const maxR = Math.max(12, rect.width / 2 - 18);
                  const dist = Math.hypot(dx, dy);
                  if (dist > maxR) {
                    dx = (dx / dist) * maxR;
                    dy = (dy / dist) * maxR;
                  }
                  if (moveKnobRef.current) {
                    moveKnobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
                  }
                  moveStickRef.current = { x: dx / maxR, y: -dy / maxR };
                };
                updateKnob(e.nativeEvent);
                const onMove = (ev: PointerEvent) => updateKnob(ev);
                const onUp = (ev: PointerEvent) => {
                  if (ev.pointerId !== activePointerId) return;
                  ownedUiPointerIdsRef.current.delete(activePointerId);
                  moveStickRef.current = { x: 0, y: 0 };
                  if (moveKnobRef.current) {
                    moveKnobRef.current.style.transform = 'translate(0px, 0px)';
                  }
                  try {
                    target.releasePointerCapture(activePointerId);
                  } catch {
                    // ignore
                  }
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                  window.removeEventListener('pointercancel', onUp);
                  target.removeEventListener('lostpointercapture', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
                target.addEventListener('lostpointercapture', onUp);
              }}
            >
              <div
                ref={moveKnobRef}
                className="w-10 h-10 rounded-full bg-indigo-500 shadow-md pointer-events-none border border-white/30"
              />
              <span className="absolute -bottom-5 text-[10px] font-mono font-bold text-indigo-300 drop-shadow">
                POSE PLACE
              </span>
            </div>
          </div>

          {/* Center-Bottom Dedicated Character In-Place Turn Controls */}
          <div className="flex items-center gap-1.5 mb-1 pointer-events-auto">
            <button
              type="button"
              data-testid="turn-char-left-btn"
              title="Hold to rotate character counter-clockwise in place (or press Q)"
              className="px-2.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 active:bg-emerald-500 active:text-slate-950 text-[11px] font-mono font-bold text-emerald-300 border border-slate-700/80 shadow-lg touch-none select-none cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const pid = e.pointerId;
                ownedUiPointerIdsRef.current.add(pid);
                charTurnInputRef.current = -1;
                const stopTurn = (ev: PointerEvent) => {
                  if (ev.pointerId !== pid) return;
                  ownedUiPointerIdsRef.current.delete(pid);
                  charTurnInputRef.current = 0;
                  window.removeEventListener('pointerup', stopTurn);
                  window.removeEventListener('pointercancel', stopTurn);
                };
                window.addEventListener('pointerup', stopTurn);
                window.addEventListener('pointercancel', stopTurn);
              }}
            >
              ↺ Turn L
            </button>
            <button
              type="button"
              data-testid="turn-char-right-btn"
              title="Hold to rotate character clockwise in place (or press E)"
              className="px-2.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 active:bg-emerald-500 active:text-slate-950 text-[11px] font-mono font-bold text-emerald-300 border border-slate-700/80 shadow-lg touch-none select-none cursor-pointer"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const pid = e.pointerId;
                ownedUiPointerIdsRef.current.add(pid);
                charTurnInputRef.current = 1;
                const stopTurn = (ev: PointerEvent) => {
                  if (ev.pointerId !== pid) return;
                  ownedUiPointerIdsRef.current.delete(pid);
                  charTurnInputRef.current = 0;
                  window.removeEventListener('pointerup', stopTurn);
                  window.removeEventListener('pointercancel', stopTurn);
                };
                window.addEventListener('pointerup', stopTurn);
                window.addEventListener('pointercancel', stopTurn);
              }}
            >
              Turn R ↻
            </button>
          </div>

          {/* Right Joystick: Camera Rotation Only (Yaw & Pitch Orbit) */}
          <div
            data-testid="right-look-joystick"
            title="Camera Joystick: Drag to rotate camera yaw and pitch around target"
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-slate-900/85 border-2 border-amber-500/70 flex items-center justify-center relative touch-none select-none shadow-xl pointer-events-auto"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const activePointerId = e.pointerId;
              ownedUiPointerIdsRef.current.add(activePointerId);
              const target = e.currentTarget;
              try {
                target.setPointerCapture(activePointerId);
              } catch {
                // ignore
              }
              const updateKnob = (ev: PointerEvent) => {
                if (ev.pointerId !== activePointerId) return;
                const rect = target.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                let dx = ev.clientX - cx;
                let dy = ev.clientY - cy;
                const maxR = Math.max(12, rect.width / 2 - 18);
                const dist = Math.hypot(dx, dy);
                if (dist > maxR) {
                  dx = (dx / dist) * maxR;
                  dy = (dy / dist) * maxR;
                }
                if (lookKnobRef.current) {
                  lookKnobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
                }
                lookStickRef.current = { x: dx / maxR, y: -dy / maxR };
              };
              updateKnob(e.nativeEvent);
              const onMove = (ev: PointerEvent) => updateKnob(ev);
              const onUp = (ev: PointerEvent) => {
                if (ev.pointerId !== activePointerId) return;
                ownedUiPointerIdsRef.current.delete(activePointerId);
                lookStickRef.current = { x: 0, y: 0 };
                if (lookKnobRef.current) {
                  lookKnobRef.current.style.transform = 'translate(0px, 0px)';
                }
                try {
                  target.releasePointerCapture(activePointerId);
                } catch {
                  // ignore
                }
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                target.removeEventListener('lostpointercapture', onUp);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
              window.addEventListener('pointercancel', onUp);
              target.addEventListener('lostpointercapture', onUp);
            }}
          >
            <div
              ref={lookKnobRef}
              className="w-10 h-10 rounded-full bg-amber-500 shadow-md pointer-events-none border border-white/30"
            />
            <span className="absolute -bottom-5 text-[10px] font-mono font-bold text-amber-300 drop-shadow">
              CAMERA
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

