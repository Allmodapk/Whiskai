import * as THREE from 'three';
import type {
  AspectRatioOption,
  CameraStateSnapshot,
  ShotSizeLabel,
  SubjectFrameBounds,
} from './types';

/** 35mm full-frame vertical sensor height in millimeters. */
export const FULL_FRAME_SENSOR_HEIGHT_MM = 24;

export const ASPECT_RATIO_VALUES: Record<AspectRatioOption, number> = {
  '3:4': 3 / 4,
  '4:5': 4 / 5,
  '2:3': 2 / 3,
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

export interface SubjectLandmarkPoint {
  id: 'headTop' | 'eyes' | 'shoulders' | 'waist' | 'hips' | 'knees' | 'feet';
  label: string;
  worldPoint: THREE.Vector3;
}

/**
 * Landmark points matching the fixed 1.72m tall reference mannequin anchored at (0, 0, 0).
 */
export const FIXED_SUBJECT_LANDMARKS: SubjectLandmarkPoint[] = [
  { id: 'headTop', label: 'Head crown', worldPoint: new THREE.Vector3(0, 1.72, 0) },
  { id: 'eyes', label: 'Eye line', worldPoint: new THREE.Vector3(0, 1.58, 0.08) },
  { id: 'shoulders', label: 'Shoulders', worldPoint: new THREE.Vector3(0, 1.4, 0) },
  { id: 'waist', label: 'Waist', worldPoint: new THREE.Vector3(0, 1.04, 0) },
  { id: 'hips', label: 'Hips', worldPoint: new THREE.Vector3(0, 0.88, 0) },
  { id: 'knees', label: 'Knees', worldPoint: new THREE.Vector3(0, 0.48, 0) },
  { id: 'feet', label: 'Feet / Floor', worldPoint: new THREE.Vector3(0, 0.02, 0) },
];

/**
 * Sample bounding points around the 3D subject's body volume (~0.52m wide × 1.72m tall × 0.34m deep)
 * so viewport projection accurately reflects bounding width/height from any angle.
 */
const SUBJECT_VOLUME_SAMPLES: THREE.Vector3[] = [
  new THREE.Vector3(-0.26, 0.0, -0.16),
  new THREE.Vector3(0.26, 0.0, -0.16),
  new THREE.Vector3(-0.26, 0.0, 0.16),
  new THREE.Vector3(0.26, 0.0, 0.16),
  new THREE.Vector3(-0.26, 1.42, -0.16),
  new THREE.Vector3(0.26, 1.42, -0.16),
  new THREE.Vector3(-0.26, 1.42, 0.16),
  new THREE.Vector3(0.26, 1.42, 0.16),
  new THREE.Vector3(-0.11, 1.72, -0.11),
  new THREE.Vector3(0.11, 1.72, 0.11),
  new THREE.Vector3(0, 0.88, 0),
];

const _offsetVec = new THREE.Vector3();
const _projVec = new THREE.Vector3();

function roundTo(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export function fovDegToFocalLengthMm(fovDeg: number): number {
  const clampedFov = THREE.MathUtils.clamp(fovDeg, 5, 130);
  const halfRad = THREE.MathUtils.degToRad(clampedFov / 2);
  const focal = FULL_FRAME_SENSOR_HEIGHT_MM / (2 * Math.tan(halfRad));
  return Math.round(focal);
}

export function focalLengthMmToFovDeg(focalLengthMm: number): number {
  const clampedMm = THREE.MathUtils.clamp(focalLengthMm, 12, 200);
  const halfRad = Math.atan(FULL_FRAME_SENSOR_HEIGHT_MM / (2 * clampedMm));
  return roundTo(THREE.MathUtils.radToDeg(halfRad * 2), 2);
}

export function describeAzimuth(azimuthDeg: number): string {
  const abs = Math.abs(azimuthDeg);
  const side = azimuthDeg >= 0 ? 'camera-right' : 'camera-left';
  if (abs <= 15) return 'Front-facing view';
  if (abs <= 65) return `Front three-quarter view (${side})`;
  if (abs <= 115) return `Side profile view (${side})`;
  if (abs <= 165) return `Rear three-quarter view (${side})`;
  return 'Rear view';
}

export function describeElevation(elevationDeg: number): string {
  if (elevationDeg >= 65) return "Overhead / bird's-eye angle";
  if (elevationDeg >= 25) return 'High-angle downward view';
  if (elevationDeg >= 8) return 'Slightly elevated high-angle view';
  if (elevationDeg > -8) return 'Eye-level / horizon-level view';
  if (elevationDeg > -28) return 'Slightly low upward view';
  return "Low-angle / worm's-eye upward view";
}

export function describeFocalLength(focalLengthMm: number): string {
  if (focalLengthMm <= 24) return 'Ultra-wide perspective';
  if (focalLengthMm <= 38) return 'Wide-angle perspective';
  if (focalLengthMm <= 62) return 'Natural normal-lens perspective';
  if (focalLengthMm <= 95) return 'Short telephoto portrait compression';
  return 'Telephoto compressed perspective';
}

export function describeSubjectPlacement(centerNdcX: number, centerNdcY: number): string {
  const horiz =
    centerNdcX < -0.22
      ? 'left third'
      : centerNdcX > 0.22
      ? 'right third'
      : 'horizontally centered';
  const vert =
    centerNdcY > 0.22
      ? 'upper frame'
      : centerNdcY < -0.22
      ? 'lower frame'
      : 'vertically centered';

  if (horiz === 'horizontally centered' && vert === 'vertically centered') {
    return 'Centered in frame';
  }
  return `Positioned in ${vert}, ${horiz}`;
}

export function classifyShotSize(
  subjectHeightPct: number,
  visibleLandmarks: string[],
  distanceMeters: number
): ShotSizeLabel {
  const hasHeadTop = visibleLandmarks.includes('headTop');
  const hasFeet = visibleLandmarks.includes('feet');
  const hasKnees = visibleLandmarks.includes('knees');
  const hasWaist = visibleLandmarks.includes('waist');
  const hasShoulders = visibleLandmarks.includes('shoulders');
  const hasEyes = visibleLandmarks.includes('eyes');

  if (distanceMeters < 1.35 && hasEyes && !hasWaist && subjectHeightPct >= 85) {
    return 'Extreme Close-Up (ECU)';
  }
  if (!hasWaist && hasShoulders && subjectHeightPct >= 70) {
    return 'Close-Up (CU)';
  }
  if (!hasWaist && hasShoulders && subjectHeightPct >= 52) {
    return 'Medium Close-Up (MCU)';
  }
  if (hasHeadTop && hasWaist && !hasKnees) {
    return 'Waist-Up Medium Shot';
  }
  if (hasHeadTop && hasKnees && !hasFeet) {
    return 'Three-Quarter Shot';
  }
  if (hasHeadTop && hasFeet && subjectHeightPct >= 52) {
    return 'Full-Body Shot';
  }
  if (hasHeadTop && hasFeet && subjectHeightPct < 52) {
    return 'Wide Environmental Shot';
  }
  if (subjectHeightPct > 90 && !hasFeet) {
    return 'Medium Close-Up (MCU)';
  }
  if (subjectHeightPct < 48) {
    return 'Wide Environmental Shot';
  }
  return 'Full-Body Shot';
}

export function computeProjectedSubjectBounds(
  camera: THREE.PerspectiveCamera
): { bounds: SubjectFrameBounds; rawHeightSpan: number } {
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const pt of SUBJECT_VOLUME_SAMPLES) {
    _projVec.copy(pt).project(camera);
    // Only consider points in front of near clipping plane (z <= 1 in NDC)
    if (_projVec.z <= 1) {
      minX = Math.min(minX, _projVec.x);
      maxX = Math.max(maxX, _projVec.x);
      minY = Math.min(minY, _projVec.y);
      maxY = Math.max(maxY, _projVec.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return {
      rawHeightSpan: 0,
      bounds: {
        minNdcX: 0,
        maxNdcX: 0,
        minNdcY: 0,
        maxNdcY: 0,
        widthPct: 0,
        heightPct: 0,
        centerNdcX: 0,
        centerNdcY: 0,
        placementLabel: 'Subject outside camera view',
        visibleLandmarks: [],
        croppedEdges: ['top', 'bottom', 'left', 'right'],
      },
    };
  }

  const croppedEdges: Array<'top' | 'bottom' | 'left' | 'right'> = [];
  if (maxY > 0.98) croppedEdges.push('top');
  if (minY < -0.98) croppedEdges.push('bottom');
  if (minX < -0.98) croppedEdges.push('left');
  if (maxX > 0.98) croppedEdges.push('right');

  const clampedMinX = THREE.MathUtils.clamp(minX, -1, 1);
  const clampedMaxX = THREE.MathUtils.clamp(maxX, -1, 1);
  const clampedMinY = THREE.MathUtils.clamp(minY, -1, 1);
  const clampedMaxY = THREE.MathUtils.clamp(maxY, -1, 1);

  const rawHeightSpan = ((maxY - minY) / 2) * 100;
  const heightPct = roundTo(((clampedMaxY - clampedMinY) / 2) * 100, 1);
  const widthPct = roundTo(((clampedMaxX - clampedMinX) / 2) * 100, 1);
  const centerNdcX = roundTo((clampedMinX + clampedMaxX) / 2, 2);
  const centerNdcY = roundTo((clampedMinY + clampedMaxY) / 2, 2);

  const visibleLandmarks: string[] = [];
  for (const lm of FIXED_SUBJECT_LANDMARKS) {
    _projVec.copy(lm.worldPoint).project(camera);
    if (
      _projVec.z >= -1 &&
      _projVec.z <= 1 &&
      _projVec.x >= -0.98 &&
      _projVec.x <= 0.98 &&
      _projVec.y >= -0.98 &&
      _projVec.y <= 0.98
    ) {
      visibleLandmarks.push(lm.id);
    }
  }

  return {
    rawHeightSpan,
    bounds: {
      minNdcX: roundTo(clampedMinX, 3),
      maxNdcX: roundTo(clampedMaxX, 3),
      minNdcY: roundTo(clampedMinY, 3),
      maxNdcY: roundTo(clampedMaxY, 3),
      widthPct,
      heightPct,
      centerNdcX,
      centerNdcY,
      placementLabel: describeSubjectPlacement(centerNdcX, centerNdcY),
      visibleLandmarks,
      croppedEdges,
    },
  };
}

/**
 * Extracts the complete, deterministic CameraStateSnapshot directly from the live
 * Three.js camera, target point, roll angle, aspect ratio, and viewport dimensions.
 * Display readouts and the prompt compiler consume this exact snapshot object.
 */
export function extractCameraStateFromThree(params: {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  rollDeg: number;
  aspectRatio: AspectRatioOption;
  viewportWidth: number;
  viewportHeight: number;
}): CameraStateSnapshot {
  const { camera, target, rollDeg, aspectRatio, viewportWidth, viewportHeight } = params;

  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  _offsetVec.subVectors(camera.position, target);
  const distanceMeters = Math.max(0.01, _offsetVec.length());

  const horizontalDist = Math.hypot(_offsetVec.x, _offsetVec.z);
  const azimuthRad = Math.atan2(_offsetVec.x, _offsetVec.z);
  const azimuthDeg = roundTo(THREE.MathUtils.radToDeg(azimuthRad), 1);

  const elevationRad = Math.atan2(_offsetVec.y, horizontalDist);
  const elevationDeg = roundTo(THREE.MathUtils.radToDeg(elevationRad), 1);
  const pitchDeg = roundTo(-elevationDeg, 1);

  const fovDeg = roundTo(camera.fov, 2);
  const focalLengthMm = fovDegToFocalLengthMm(fovDeg);

  const { bounds, rawHeightSpan } = computeProjectedSubjectBounds(camera);
  const shotSize = classifyShotSize(
    rawHeightSpan,
    bounds.visibleLandmarks,
    distanceMeters
  );

  return {
    azimuthDeg,
    azimuthLabel: describeAzimuth(azimuthDeg),
    elevationDeg,
    elevationLabel: describeElevation(elevationDeg),
    pitchDeg,
    distanceMeters: roundTo(distanceMeters, 2),
    worldPosition: {
      x: roundTo(camera.position.x, 2),
      y: roundTo(camera.position.y, 2),
      z: roundTo(camera.position.z, 2),
    },
    targetPosition: {
      x: roundTo(target.x, 2),
      y: roundTo(target.y, 2),
      z: roundTo(target.z, 2),
    },
    rollDeg: roundTo(rollDeg, 1),
    fovDeg,
    focalLengthMm,
    lensCategoryLabel: describeFocalLength(focalLengthMm),
    aspectRatio,
    aspectRatioNumeric: roundTo(ASPECT_RATIO_VALUES[aspectRatio], 3),
    viewportDimensions: {
      width: Math.round(viewportWidth),
      height: Math.round(viewportHeight),
    },
    shotSize,
    subjectBounds: bounds,
    projectionType: 'perspective',
    capturedAt: Date.now(),
  };
}
