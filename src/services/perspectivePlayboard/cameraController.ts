import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AspectRatioOption, CameraPresetSpec, Vec3 } from './types';
import { focalLengthMmToFovDeg } from './cameraExtractor';

export const DEFAULT_CAMERA_CONFIG = {
  azimuthDeg: 0,
  elevationDeg: 6,
  distanceMeters: 3.1,
  focalLengthMm: 50,
  targetOffset: { x: 0, y: 1.02, z: 0 } as Vec3,
  rollDeg: 0,
  aspectRatio: '3:4' as AspectRatioOption,
};

export const CAMERA_LIMITS = {
  minAzimuthDeg: -180,
  maxAzimuthDeg: 180,
  minElevationDeg: -60,
  maxElevationDeg: 85,
  minDistanceMeters: 1.0,
  maxDistanceMeters: 8.5,
  minFocalLengthMm: 16,
  maxFocalLengthMm: 135,
  minRollDeg: -45,
  maxRollDeg: 45,
  minTargetY: 0.25,
  maxTargetY: 1.75,
  minTargetX: -0.9,
  maxTargetX: 0.9,
};

export const CAMERA_PRESETS: CameraPresetSpec[] = [
  {
    id: 'front_eye',
    label: 'Front Eye-Level',
    description: 'Neutral eye-level portrait directly facing subject (+Z).',
    azimuthDeg: 0,
    elevationDeg: 6,
    distanceMeters: 3.1,
    focalLengthMm: 50,
    targetOffset: { x: 0, y: 1.02, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'three_quarter_right',
    label: '3/4 Camera-Right',
    description: 'Classic 40° three-quarter perspective from camera-right.',
    azimuthDeg: 40,
    elevationDeg: 8,
    distanceMeters: 2.9,
    focalLengthMm: 55,
    targetOffset: { x: 0, y: 1.08, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'three_quarter_left',
    label: '3/4 Camera-Left',
    description: 'Classic -40° three-quarter perspective from camera-left.',
    azimuthDeg: -40,
    elevationDeg: 8,
    distanceMeters: 2.9,
    focalLengthMm: 55,
    targetOffset: { x: 0, y: 1.08, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'side_profile',
    label: 'Side Profile',
    description: '90° perpendicular profile view showing depth silhouette.',
    azimuthDeg: 90,
    elevationDeg: 4,
    distanceMeters: 3.0,
    focalLengthMm: 60,
    targetOffset: { x: 0, y: 1.02, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'rear_three_quarter',
    label: 'Rear 3/4',
    description: 'Over-the-shoulder / rear three-quarter angle behind subject.',
    azimuthDeg: 140,
    elevationDeg: 14,
    distanceMeters: 3.1,
    focalLengthMm: 50,
    targetOffset: { x: 0, y: 1.06, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'rear_view',
    label: 'Rear View',
    description: '180° directly behind the subject looking forward into room.',
    azimuthDeg: 180,
    elevationDeg: 10,
    distanceMeters: 3.2,
    focalLengthMm: 50,
    targetOffset: { x: 0, y: 1.02, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'high_angle',
    label: 'High Angle',
    description: 'Elevated 38° downward perspective showing floor plane.',
    azimuthDeg: 25,
    elevationDeg: 38,
    distanceMeters: 3.2,
    focalLengthMm: 35,
    targetOffset: { x: 0, y: 0.92, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'overhead',
    label: 'Overhead',
    description: "Steep 76° bird's-eye camera looking sharply downward.",
    azimuthDeg: 0,
    elevationDeg: 76,
    distanceMeters: 3.4,
    focalLengthMm: 28,
    targetOffset: { x: 0, y: 0.78, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'low_angle',
    label: 'Low Angle Hero',
    description: 'Low -22° camera looking upward to emphasize stature.',
    azimuthDeg: -18,
    elevationDeg: -22,
    distanceMeters: 2.8,
    focalLengthMm: 32,
    targetOffset: { x: 0, y: 1.12, z: 0 },
    rollDeg: 0,
  },
  {
    id: 'closeup_headshot',
    label: 'Close-Up Portrait',
    description: 'Tight 85mm framing focused on head, neck, and upper shoulders.',
    azimuthDeg: 12,
    elevationDeg: 2,
    distanceMeters: 1.35,
    focalLengthMm: 85,
    targetOffset: { x: 0, y: 1.48, z: 0 },
    rollDeg: 0,
  },
];

const _localZAxis = new THREE.Vector3(0, 0, 1);
const _rollQuat = new THREE.Quaternion();

/**
 * Computes world-space camera position from spherical coordinates around a target point.
 * Consistent with extractCameraStateFromThree:
 *   dx = dist * cos(el) * sin(az)
 *   dy = dist * sin(el)
 *   dz = dist * cos(el) * cos(az)
 */
export function sphericalToWorldPosition(
  azimuthDeg: number,
  elevationDeg: number,
  distanceMeters: number,
  target: Vec3
): THREE.Vector3 {
  const azRad = THREE.MathUtils.degToRad(azimuthDeg);
  const elRad = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(elevationDeg, CAMERA_LIMITS.minElevationDeg, CAMERA_LIMITS.maxElevationDeg)
  );
  const r = THREE.MathUtils.clamp(
    distanceMeters,
    CAMERA_LIMITS.minDistanceMeters,
    CAMERA_LIMITS.maxDistanceMeters
  );

  const horiz = r * Math.cos(elRad);
  const x = target.x + horiz * Math.sin(azRad);
  const y = Math.max(0.12, target.y + r * Math.sin(elRad));
  const z = target.z + horiz * Math.cos(azRad);

  return new THREE.Vector3(x, y, z);
}

/**
 * Applies camera orientation toward target, followed by roll rotation around the camera's optical Z axis.
 * Note: OrbitControls.update() resets camera.up-aligned lookAt, so roll is applied immediately after
 * controls.update() or manual lookAt before rendering.
 */
export function applyCameraRollToCamera(camera: THREE.PerspectiveCamera, rollDeg: number): void {
  if (Math.abs(rollDeg) < 0.01) return;
  const rollRad = THREE.MathUtils.degToRad(-rollDeg);
  _rollQuat.setFromAxisAngle(_localZAxis, rollRad);
  camera.quaternion.multiply(_rollQuat);
  camera.updateMatrixWorld();
}

export interface CameraTransitionTarget {
  azimuthDeg: number;
  elevationDeg: number;
  distanceMeters: number;
  focalLengthMm: number;
  targetOffset: Vec3;
  rollDeg: number;
}

export class PerspectiveCameraController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly controls: OrbitControls;
  public rollDeg = DEFAULT_CAMERA_CONFIG.rollDeg;
  public activeTransition: CameraTransitionTarget | null = null;
  public isLocked = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    isSoftwareGl: boolean
  ) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = !isSoftwareGl;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.78;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.65;
    this.controls.minDistance = CAMERA_LIMITS.minDistanceMeters;
    this.controls.maxDistance = CAMERA_LIMITS.maxDistanceMeters;
    // Allow full freedom from overhead (~5° from zenith) down to low angle (~150° polar = -60° elevation)
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(5);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(150);

    // Cancel any scripted transition immediately if the user grabs the canvas
    this.controls.addEventListener('start', () => {
      this.activeTransition = null;
    });

    this.applyImmediate(DEFAULT_CAMERA_CONFIG);
  }

  public setLocked(locked: boolean): void {
    this.isLocked = locked;
    this.controls.enabled = !locked;
    if (locked) {
      this.activeTransition = null;
    }
  }

  public setFocalLengthMm(focalLengthMm: number): void {
    const fov = focalLengthMmToFovDeg(focalLengthMm);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  public applyImmediate(cfg: {
    azimuthDeg: number;
    elevationDeg: number;
    distanceMeters: number;
    focalLengthMm: number;
    targetOffset: Vec3;
    rollDeg: number;
  }): void {
    this.activeTransition = null;
    const clampedTarget: Vec3 = {
      x: THREE.MathUtils.clamp(cfg.targetOffset.x, CAMERA_LIMITS.minTargetX, CAMERA_LIMITS.maxTargetX),
      y: THREE.MathUtils.clamp(cfg.targetOffset.y, CAMERA_LIMITS.minTargetY, CAMERA_LIMITS.maxTargetY),
      z: THREE.MathUtils.clamp(cfg.targetOffset.z, -0.5, 0.5),
    };

    this.controls.target.set(clampedTarget.x, clampedTarget.y, clampedTarget.z);
    const pos = sphericalToWorldPosition(
      cfg.azimuthDeg,
      cfg.elevationDeg,
      cfg.distanceMeters,
      clampedTarget
    );
    this.camera.position.copy(pos);
    this.setFocalLengthMm(cfg.focalLengthMm);
    this.rollDeg = THREE.MathUtils.clamp(cfg.rollDeg, CAMERA_LIMITS.minRollDeg, CAMERA_LIMITS.maxRollDeg);
    this.controls.update();
    this.camera.lookAt(this.controls.target);
    applyCameraRollToCamera(this.camera, this.rollDeg);
  }

  public animateTo(target: CameraTransitionTarget): void {
    if (this.isLocked) return;
    this.activeTransition = { ...target };
  }

  /**
   * Advances damping or active preset transition by delta seconds.
   * Returns true if the camera moved and requires another frame.
   */
  public step(deltaSec: number): boolean {
    const dt = Math.min(Math.max(deltaSec, 0.001), 0.1);
    let needsMoreFrames = false;

    if (this.activeTransition && !this.isLocked) {
      const tr = this.activeTransition;
      const offset = this.camera.position.clone().sub(this.controls.target);
      const curDist = Math.max(0.01, offset.length());
      const curAz = THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
      const curEl = THREE.MathUtils.radToDeg(
        Math.atan2(offset.y, Math.hypot(offset.x, offset.z))
      );

      // Shortest angular path for azimuth
      let deltaAz = ((tr.azimuthDeg - curAz + 540) % 360) - 180;
      const nextAz = curAz + deltaAz * (1 - Math.exp(-9 * dt));
      const nextEl = THREE.MathUtils.damp(curEl, tr.elevationDeg, 9, dt);
      const nextDist = THREE.MathUtils.damp(curDist, tr.distanceMeters, 9, dt);
      const nextTx = THREE.MathUtils.damp(this.controls.target.x, tr.targetOffset.x, 9, dt);
      const nextTy = THREE.MathUtils.damp(this.controls.target.y, tr.targetOffset.y, 9, dt);
      const nextTz = THREE.MathUtils.damp(this.controls.target.z, tr.targetOffset.z, 9, dt);
      const nextRoll = THREE.MathUtils.damp(this.rollDeg, tr.rollDeg, 9, dt);
      const targetFov = focalLengthMmToFovDeg(tr.focalLengthMm);
      const nextFov = THREE.MathUtils.damp(this.camera.fov, targetFov, 9, dt);

      this.controls.target.set(nextTx, nextTy, nextTz);
      const pos = sphericalToWorldPosition(nextAz, nextEl, nextDist, {
        x: nextTx,
        y: nextTy,
        z: nextTz,
      });
      this.camera.position.copy(pos);
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
      this.rollDeg = nextRoll;

      this.camera.lookAt(this.controls.target);
      applyCameraRollToCamera(this.camera, this.rollDeg);

      const settled =
        Math.abs(deltaAz) < 0.25 &&
        Math.abs(tr.elevationDeg - nextEl) < 0.25 &&
        Math.abs(tr.distanceMeters - nextDist) < 0.015 &&
        Math.abs(targetFov - nextFov) < 0.1 &&
        Math.abs(tr.rollDeg - nextRoll) < 0.2 &&
        Math.abs(tr.targetOffset.y - nextTy) < 0.01;

      if (settled) {
        this.applyImmediate(tr);
      } else {
        needsMoreFrames = true;
      }
      return needsMoreFrames;
    }

    // Clamp target within safe studio bounds so user never pans underground or out of room
    this.controls.target.x = THREE.MathUtils.clamp(
      this.controls.target.x,
      CAMERA_LIMITS.minTargetX,
      CAMERA_LIMITS.maxTargetX
    );
    this.controls.target.y = THREE.MathUtils.clamp(
      this.controls.target.y,
      CAMERA_LIMITS.minTargetY,
      CAMERA_LIMITS.maxTargetY
    );
    this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, -0.5, 0.5);

    const updated = this.controls.update();
    // Prevent camera from dipping below the studio floor plane
    if (this.camera.position.y < 0.12) {
      this.camera.position.y = 0.12;
    }
    this.camera.lookAt(this.controls.target);
    applyCameraRollToCamera(this.camera, this.rollDeg);
    return Boolean(updated);
  }

  public dispose(): void {
    this.controls.dispose();
  }
}
