export type CharacterGaitMode =
  | 'idle'
  | 'walk_forward'
  | 'run_forward'
  | 'walk_backward'
  | 'strafe_left'
  | 'strafe_right';

export type CharacterFacingMode = 'auto' | 'manual';

export interface ThirdPersonLocomotionState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  rot: number;
  targetRot: number;
  walkPhase: number;
  walkAmt: number;
  runBlend: number;
  /** -1 = full backward, 0 = lateral strafe, +1 = full forward */
  forwardBlend: number;
  /** -1 = full left strafe, 0 = forward/back, +1 = full right strafe */
  strafeBlend: number;
  gaitMode: CharacterGaitMode;
  /**
   * 'manual' = subject-relative movement where character maintains current facing angle unless turned via orange joystick.
   * 'auto' = optional opt-in camera-relative auto-facing mode.
   */
  facingMode: CharacterFacingMode;
  /** Smoothed angular turning rate in rad/sec (positive = CCW left, negative = CW right) */
  turnRateRadPerSec?: number;
  /** Phase for alternating foot lift during turn-in-place pivoting */
  turnPhase?: number;
  /** 0..1 blend of active turn-in-place foot stepping */
  turnStepAmt?: number;
  /** Subtle forward/backward body lean in radians during acceleration/movement */
  leanPitchRad?: number;
  /** Subtle lateral banking roll in radians during turning and strafing */
  leanRollRad?: number;
}

export interface LocomotionBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LocomotionStepOptions {
  /**
   * Optional opt-in legacy mode where movement is camera-relative and auto-rotates the character.
   * False by default: normal Playboard locomotion is strictly subject-relative and never auto-rotates.
   */
  autoFaceCameraMovement?: boolean;
  /**
   * When true, prevents walking through solid bedroom furniture obstacles (bed, desk, nightstand, chair, wardrobe, bench)
   * and slides smoothly along furniture edges while keeping the subject inside room walls.
   */
  enableFurnitureCollision?: boolean;
  /**
   * Subject collision cylinder radius in meters (default 0.20m).
   */
  subjectRadius?: number;
}

export interface SolidSceneObstacle {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const DEFAULT_ARENA_BOUNDS: LocomotionBounds = {
  minX: -2.35,
  maxX: 2.35,
  minZ: -2.25,
  maxZ: 2.35,
};

/**
 * Solid floor-level furniture footprints in the Studio Bedroom environment.
 * Used when `enableFurnitureCollision` is active during ground locomotion so the character
 * slides smoothly along furniture edges instead of walking through solid objects.
 */
export const BEDROOM_SOLID_OBSTACLES: SolidSceneObstacle[] = [
  { id: 'bed_frame', minX: 0.38, maxX: 2.12, minZ: -2.95, maxZ: -0.74 },
  { id: 'nightstand', minX: -0.36, maxX: 0.28, minZ: -2.95, maxZ: -2.38 },
  { id: 'right_nightstand', minX: 2.16, maxX: 2.78, minZ: -2.95, maxZ: -2.38 },
  { id: 'creator_desk', minX: -2.8, maxX: -1.92, minZ: -0.62, maxZ: 1.12 },
  { id: 'desk_chair', minX: -1.85, maxX: -1.25, minZ: -0.06, maxZ: 0.56 },
  { id: 'window_bench', minX: -2.82, maxX: -2.32, minZ: -2.35, maxZ: -1.35 },
  { id: 'bookshelf_left', minX: -2.95, maxX: -2.42, minZ: 1.25, maxZ: 2.48 },
  { id: 'wardrobe_shelf', minX: 2.22, maxX: 2.95, minZ: -1.25, maxZ: 1.65 },
];

/**
 * Resolves ground-plane `(nextX, nextZ)` movement against room boundary walls and solid bedroom furniture.
 * - If `(prevX, prevZ)` started outside an obstacle and `(nextX, nextZ)` penetrates it, slides smoothly
 *   along the unobstructed axis (X or Z) or pushes out along the minimum penetration normal.
 * - If `(prevX, prevZ)` was already inside an obstacle footprint (e.g. character was seated/lying on the bed or chair),
 *   allows moving freely so the character is never trapped inside furniture.
 */
export function resolveBedroomObstacleCollision(
  nextX: number,
  nextZ: number,
  prevX: number,
  prevZ: number,
  bounds: LocomotionBounds = DEFAULT_ARENA_BOUNDS,
  radius = 0.2
): { x: number; z: number; collidedObstacleId: string | null } {
  let x = Math.max(bounds.minX, Math.min(bounds.maxX, nextX));
  let z = Math.max(bounds.minZ, Math.min(bounds.maxZ, nextZ));
  let collidedObstacleId: string | null = null;

  for (const obs of BEDROOM_SOLID_OBSTACLES) {
    const infMinX = obs.minX - radius;
    const infMaxX = obs.maxX + radius;
    const infMinZ = obs.minZ - radius;
    const infMaxZ = obs.maxZ + radius;

    const wasInside =
      prevX > infMinX + 1e-4 &&
      prevX < infMaxX - 1e-4 &&
      prevZ > infMinZ + 1e-4 &&
      prevZ < infMaxZ - 1e-4;
    if (wasInside) {
      continue;
    }

    const isInside = x > infMinX && x < infMaxX && z > infMinZ && z < infMaxZ;
    if (!isInside) {
      continue;
    }

    collidedObstacleId = obs.id;

    // Try axis-separated sliding first (keep X if prevZ is safe, or keep Z if prevX is safe)
    const xOnlyHits = x > infMinX && x < infMaxX && prevZ > infMinZ && prevZ < infMaxZ;
    const zOnlyHits = prevX > infMinX && prevX < infMaxX && z > infMinZ && z < infMaxZ;

    if (!xOnlyHits) {
      z = prevZ <= (infMinZ + infMaxZ) * 0.5 ? infMinZ : infMaxZ;
    } else if (!zOnlyHits) {
      x = prevX <= (infMinX + infMaxX) * 0.5 ? infMinX : infMaxX;
    } else {
      // Push out along minimum penetration depth
      const penLeft = Math.abs(x - infMinX);
      const penRight = Math.abs(infMaxX - x);
      const penBack = Math.abs(z - infMinZ);
      const penFront = Math.abs(infMaxZ - z);
      const minPen = Math.min(penLeft, penRight, penBack, penFront);
      if (minPen === penLeft) x = infMinX;
      else if (minPen === penRight) x = infMaxX;
      else if (minPen === penBack) z = infMinZ;
      else z = infMaxZ;
    }
  }

  x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
  z = Math.max(bounds.minZ, Math.min(bounds.maxZ, z));
  return { x, z, collidedObstacleId };
}

/**
 * Normalizes an angle in radians to the range [-PI, PI].
 */
export function normalizeAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Computes the shortest signed angular difference from `current` to `target` in [-PI, PI].
 */
export function shortestAngleDiffRad(current: number, target: number): number {
  return normalizeAngleRad(target - current);
}

/**
 * Frame-rate independent shortest-arc angular damping in radians.
 */
export function dampAngleRad(
  current: number,
  target: number,
  lambda: number,
  dt: number
): number {
  const diff = shortestAngleDiffRad(current, target);
  const factor = 1 - Math.exp(-lambda * dt);
  return normalizeAngleRad(current + diff * factor);
}

/**
 * Frame-rate independent scalar damping.
 */
function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * Normalizes 2D joystick or WASD input so diagonal input never exceeds unit magnitude (1.0),
 * and applies a radial deadzone with smooth rescaling.
 */
export function normalizeJoystickInput(
  rawX: number,
  rawY: number,
  deadzone = 0.06
): { dirX: number; dirY: number; magnitude: number } {
  const rawMag = Math.hypot(rawX, rawY);
  if (rawMag <= deadzone) {
    return { dirX: 0, dirY: 0, magnitude: 0 };
  }
  const clampedMag = Math.min(1.0, rawMag);
  const normalizedMag = (clampedMag - deadzone) / (1.0 - deadzone);
  const invMag = 1.0 / rawMag;
  return {
    dirX: rawX * invMag,
    dirY: rawY * invMag,
    magnitude: Math.min(1.0, Math.max(0.0, normalizedMag)),
  };
}

/**
 * Normalizes horizontal turning joystick drag independently of any vertical pointer displacement.
 * Vertical pointer offset (dy) is ignored so dragging slightly up or down never weakens horizontal turning.
 */
export function normalizeTurnJoystickInput(
  dx: number,
  maxRadius: number,
  deadzone = 0.05
): { rawTurnX: number; normalizedTurn: number; clampedDx: number } {
  const safeMaxR = Math.max(1, maxRadius);
  const clampedDx = Math.max(-safeMaxR, Math.min(safeMaxR, dx));
  const rawTurnX = Math.max(-1, Math.min(1, dx / safeMaxR));
  const absX = Math.abs(rawTurnX);
  if (absX <= deadzone) {
    return { rawTurnX: 0, normalizedTurn: 0, clampedDx };
  }
  const sign = Math.sign(rawTurnX);
  const normalizedMag = Math.min(1, (absX - deadzone) / (1 - deadzone));
  return {
    rawTurnX,
    normalizedTurn: sign * normalizedMag,
    clampedDx,
  };
}

/**
 * Computes the subject's ground-plane movement basis vectors from the subject's current world-space yaw `facingRotRad`.
 *
 * Coordinate convention:
 * - World up is +Y.
 * - Default character faces world +Z (`facingRotRad = 0`).
 * - Positive character yaw rotates the character toward world +X:
 *   - Forward (+y stick): (sin(θ), 0, cos(θ))
 *   - Right (+x stick):   (cos(θ), 0, -sin(θ))
 *   - Left (-x stick):    (-cos(θ), 0, sin(θ))
 *   - Backward (-y stick): (-sin(θ), 0, -cos(θ))
 */
export function getSubjectGroundBasis(facingRotRad: number): {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
  leftX: number;
  leftZ: number;
  backwardX: number;
  backwardZ: number;
} {
  const sinYaw = Math.sin(facingRotRad);
  const cosYaw = Math.cos(facingRotRad);
  return {
    forwardX: sinYaw,
    forwardZ: cosYaw,
    rightX: cosYaw,
    rightZ: -sinYaw,
    leftX: -cosYaw,
    leftZ: sinYaw,
    backwardX: -sinYaw,
    backwardZ: -cosYaw,
  };
}

/**
 * Computes the camera's ground-plane forward and right unit vectors from the camera orbit yaw.
 *
 * In Playboard3DCanvas:
 * - Camera position is offset from target by `(sin(camYaw) * cos(pitch) * dist, ..., cos(camYaw) * cos(pitch) * dist)`
 * - Therefore the horizontal vector from the camera toward the look-target (camera-forward on the XZ plane)
 *   is `(-sin(camYaw), 0, -cos(camYaw))`.
 * - The camera-right unit vector on the XZ plane (`forward × up`, where `up = (0, 1, 0)`)
 *   is `(cos(camYaw), 0, -sin(camYaw))`.
 */
export function getCameraGroundBasis(camYawRad: number): {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
} {
  const forwardX = -Math.sin(camYawRad);
  const forwardZ = -Math.cos(camYawRad);
  const rightX = Math.cos(camYawRad);
  const rightZ = -Math.sin(camYawRad);
  return { forwardX, forwardZ, rightX, rightZ };
}

/**
 * Creates a fresh default locomotion state at the origin facing +Z (0 rad) in subject-relative ('manual') mode.
 */
export function createInitialLocomotionState(): ThirdPersonLocomotionState {
  return {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    rot: 0,
    targetRot: 0,
    walkPhase: 0,
    walkAmt: 0,
    runBlend: 0,
    forwardBlend: 1,
    strafeBlend: 0,
    gaitMode: 'idle',
    facingMode: 'manual',
    turnRateRadPerSec: 0,
    turnPhase: 0,
    turnStepAmt: 0,
    leanPitchRad: 0,
    leanRollRad: 0,
  };
}

/**
 * Projects world-space ground velocity `(vx, vz)` into the character's local coordinate frame
 * defined by `facingRotRad` (where 0 = +Z, positive yaw = toward +X) and classifies the gait mode.
 *
 * Local basis:
 * - `charFwd = (sin(θ), cos(θ))`
 * - `charRight = (cos(θ), -sin(θ))`
 */
export function classifyCharacterLocalGait(
  vx: number,
  vz: number,
  facingRotRad: number,
  speed: number,
  maxWalkSpeed: number,
  isRunning: boolean
): {
  gaitMode: CharacterGaitMode;
  forwardBlend: number;
  strafeBlend: number;
} {
  if (speed < 0.04) {
    return {
      gaitMode: 'idle',
      forwardBlend: 1,
      strafeBlend: 0,
    };
  }

  const charFwdX = Math.sin(facingRotRad);
  const charFwdZ = Math.cos(facingRotRad);
  const charRightX = Math.cos(facingRotRad);
  const charRightZ = -Math.sin(facingRotRad);

  const localFwd = vx * charFwdX + vz * charFwdZ;
  const localRight = vx * charRightX + vz * charRightZ;

  const forwardBlend = Math.max(-1, Math.min(1, localFwd / speed));
  const strafeBlend = Math.max(-1, Math.min(1, localRight / speed));

  let gaitMode: CharacterGaitMode = 'walk_forward';
  if (Math.abs(strafeBlend) > Math.abs(forwardBlend) && Math.abs(strafeBlend) > 0.35) {
    gaitMode = strafeBlend > 0 ? 'strafe_right' : 'strafe_left';
  } else if (forwardBlend < -0.25) {
    gaitMode = 'walk_backward';
  } else if (isRunning || speed > maxWalkSpeed * 1.15) {
    gaitMode = 'run_forward';
  } else {
    gaitMode = 'walk_forward';
  }

  return { gaitMode, forwardBlend, strafeBlend };
}

/**
 * Advances the character locomotion state by `dt` seconds.
 *
 * Key behavior:
 * 1. Subject-Relative Movement (default):
 *    - The blue joystick moves the subject relative to the subject's own current facing direction (`state.rot`):
 *      - Up (`+y`): forward along `(sin(rot), 0, cos(rot))`
 *      - Down (`-y`): backward along `(-sin(rot), 0, -cos(rot))`
 *      - Right (`+x`): strafe right along `(cos(rot), 0, -sin(rot))`
 *      - Left (`-x`): strafe left along `(-cos(rot), 0, sin(rot))`
 *      - Diagonal: normalized in local space so diagonal speed never exceeds straight-line maximum speed.
 *    - Moving with the blue joystick NEVER automatically rotates the subject.
 *    - Camera yaw (`camYawRad`) has zero effect on subject-relative movement direction or subject orientation.
 * 2. Independent Subject Turning (`rawTurnStickX`):
 *    - The orange joystick rotates the subject left (`rawTurnStickX < 0`) or right (`rawTurnStickX > 0`) in place.
 *    - Turning never translates the subject.
 *    - Drives `turnPhase` and `turnStepAmt` for realistic turn-in-place foot stepping without sliding.
 * 3. Smooth Deceleration, Foot-Slide Prevention & Body Lean:
 *    - Releasing the blue joystick smoothly decelerates velocity to idle with zero residual drift.
 *    - Subtle forward/backward pitch lean (`leanPitchRad`) and lateral banking lean (`leanRollRad`) respond to velocity and turning.
 */
export function stepThirdPersonLocomotion(
  state: ThirdPersonLocomotionState,
  rawStick: { x: number; y: number },
  camYawRad: number,
  dt: number,
  bounds: LocomotionBounds = DEFAULT_ARENA_BOUNDS,
  rawTurnStickX = 0,
  options?: LocomotionStepOptions
): ThirdPersonLocomotionState {
  const safeDt = Math.min(Math.max(dt, 0), 0.1);
  if (safeDt <= 0) return state;

  const prevRot = state.rot;
  const turnDeadzone = 0.05;
  const absTurn = Math.abs(rawTurnStickX);
  const hasTurnInput = absTurn > turnDeadzone;

  // 1. Apply independent horizontal turning from the orange joystick first
  let targetTurnRate = 0;
  if (hasTurnInput) {
    const turnSign = Math.sign(rawTurnStickX);
    const turnMag = Math.min(1, (absTurn - turnDeadzone) / (1 - turnDeadzone));
    const turnSpeedRadPerSec = 2.6;
    targetTurnRate = -turnSign * turnMag * turnSpeedRadPerSec;
    const deltaRot = targetTurnRate * safeDt;
    state.rot = normalizeAngleRad(state.rot + deltaRot);
    state.targetRot = state.rot;
    state.facingMode = 'manual';
  }

  // 2. Normalize blue movement joystick input (prevents diagonal speed boost)
  const stick = normalizeJoystickInput(rawStick.x, rawStick.y);

  // Speed constants (meters/second)
  const maxWalkSpeed = 1.45;
  const maxRunSpeed = 2.65;
  const runThreshold = 0.72;

  const useLegacyCameraAutoFace = options?.autoFaceCameraMovement === true && !hasTurnInput;

  if (stick.magnitude > 0) {
    let normWorldX = 0;
    let normWorldZ = 0;

    if (useLegacyCameraAutoFace) {
      state.facingMode = 'auto';
      const camBasis = getCameraGroundBasis(camYawRad);
      const worldDirX = camBasis.rightX * stick.dirX + camBasis.forwardX * stick.dirY;
      const worldDirZ = camBasis.rightZ * stick.dirX + camBasis.forwardZ * stick.dirY;
      const worldDirLen = Math.hypot(worldDirX, worldDirZ);
      normWorldX = worldDirLen > 1e-5 ? worldDirX / worldDirLen : 0;
      normWorldZ = worldDirLen > 1e-5 ? worldDirZ / worldDirLen : 0;

      const isBackingUp = stick.dirY < -0.25;
      const isPureStrafe = Math.abs(stick.dirX) > 0.75 && Math.abs(stick.dirY) < 0.45;
      if (isBackingUp || isPureStrafe) {
        const camForwardYaw = Math.atan2(camBasis.forwardX, camBasis.forwardZ);
        state.targetRot = camForwardYaw;
        state.rot = dampAngleRad(state.rot, state.targetRot, 10, safeDt);
      } else {
        const travelYaw = Math.atan2(normWorldX, normWorldZ);
        state.targetRot = travelYaw;
        state.rot = dampAngleRad(state.rot, state.targetRot, 14, safeDt);
      }
      targetTurnRate = shortestAngleDiffRad(prevRot, state.rot) / safeDt;
    } else {
      // Standard Subject-Relative Locomotion:
      // Move strictly in the character's own current facing basis without ever auto-rotating the character.
      state.facingMode = 'manual';
      const subjBasis = getSubjectGroundBasis(state.rot);
      const worldDirX = subjBasis.rightX * stick.dirX + subjBasis.forwardX * stick.dirY;
      const worldDirZ = subjBasis.rightZ * stick.dirX + subjBasis.forwardZ * stick.dirY;
      const worldDirLen = Math.hypot(worldDirX, worldDirZ);
      normWorldX = worldDirLen > 1e-5 ? worldDirX / worldDirLen : 0;
      normWorldZ = worldDirLen > 1e-5 ? worldDirZ / worldDirLen : 0;
      // Preserve exact subject orientation when only the blue movement joystick is used
      state.targetRot = state.rot;
    }

    // Determine target speed based on local movement direction and stick deflection
    const isBackingUp = stick.dirY < -0.25;
    const isStrafeDominant = Math.abs(stick.dirX) > Math.abs(stick.dirY) && Math.abs(stick.dirY) < 0.5;
    const isRunningInput = stick.magnitude >= runThreshold && stick.dirY >= -0.1 && !isStrafeDominant;

    let targetSpeed = 0;
    if (isBackingUp) {
      targetSpeed = stick.magnitude * (maxWalkSpeed * 0.78);
    } else if (isStrafeDominant) {
      targetSpeed = stick.magnitude * (maxWalkSpeed * 0.88);
    } else if (isRunningInput) {
      const runT = (stick.magnitude - runThreshold) / (1.0 - runThreshold);
      targetSpeed = maxWalkSpeed + runT * (maxRunSpeed - maxWalkSpeed);
    } else {
      targetSpeed = (stick.magnitude / runThreshold) * maxWalkSpeed;
    }

    const targetVx = normWorldX * targetSpeed;
    const targetVz = normWorldZ * targetSpeed;

    // Smooth acceleration
    const accelLambda = 15;
    state.vx = dampScalar(state.vx, targetVx, accelLambda, safeDt);
    state.vz = dampScalar(state.vz, targetVz, accelLambda, safeDt);

    // Integrate ground position and clamp to studio floor bounds / solid furniture obstacles
    const prevX = state.x;
    const prevZ = state.z;
    const candidateX = state.x + state.vx * safeDt;
    const candidateZ = state.z + state.vz * safeDt;
    if (options?.enableFurnitureCollision) {
      const resolved = resolveBedroomObstacleCollision(
        candidateX,
        candidateZ,
        prevX,
        prevZ,
        bounds,
        options.subjectRadius ?? 0.2
      );
      state.x = resolved.x;
      state.z = resolved.z;
    } else {
      state.x = Math.max(bounds.minX, Math.min(bounds.maxX, candidateX));
      state.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, candidateZ));
    }

    const currentSpeed = Math.hypot(state.vx, state.vz);
    const localGait = classifyCharacterLocalGait(
      state.vx,
      state.vz,
      state.rot,
      currentSpeed,
      maxWalkSpeed,
      isRunningInput
    );

    state.gaitMode = localGait.gaitMode;
    state.forwardBlend = dampScalar(state.forwardBlend, localGait.forwardBlend, 14, safeDt);
    state.strafeBlend = dampScalar(state.strafeBlend, localGait.strafeBlend, 14, safeDt);

    const targetRunBlend = localGait.gaitMode === 'run_forward' ? 1.0 : 0.0;
    // Scale walkAmt with actual velocity ratio to eliminate foot sliding during startup
    const speedRatio = Math.min(1.0, currentSpeed / maxWalkSpeed);
    const targetWalkAmt = Math.min(1.0, Math.max(speedRatio * 0.85, stick.magnitude * 0.95));
    state.walkAmt = dampScalar(state.walkAmt, targetWalkAmt, 14, safeDt);
    state.runBlend = dampScalar(state.runBlend, targetRunBlend, 12, safeDt);

    // Advance rhythmic gait cycle phase matched to actual ground speed to prevent foot sliding
    const stepFrequency = 4.6 + state.runBlend * 3.8 + currentSpeed * 1.45;
    const phaseSign = localGait.gaitMode === 'walk_backward' ? -1 : 1;
    state.walkPhase += safeDt * stepFrequency * phaseSign;
  } else {
    // Smooth deceleration to idle when joystick is released; preserve character facing direction
    const decelLambda = 18;
    state.vx = dampScalar(state.vx, 0, decelLambda, safeDt);
    state.vz = dampScalar(state.vz, 0, decelLambda, safeDt);

    const currentSpeed = Math.hypot(state.vx, state.vz);
    if (currentSpeed > 0.012) {
      const prevX = state.x;
      const prevZ = state.z;
      const candidateX = state.x + state.vx * safeDt;
      const candidateZ = state.z + state.vz * safeDt;
      if (options?.enableFurnitureCollision) {
        const resolved = resolveBedroomObstacleCollision(
          candidateX,
          candidateZ,
          prevX,
          prevZ,
          bounds,
          options.subjectRadius ?? 0.2
        );
        state.x = resolved.x;
        state.z = resolved.z;
      } else {
        state.x = Math.max(bounds.minX, Math.min(bounds.maxX, candidateX));
        state.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, candidateZ));
      }
      // Keep advancing phase slightly proportional to remaining speed so feet settle instead of skating
      const settlePhaseSign = state.forwardBlend < 0 ? -1 : 1;
      state.walkPhase += safeDt * currentSpeed * 3.2 * settlePhaseSign;
    } else {
      // Snap micro-velocity to exact zero to prevent unintended drift after releasing controls
      state.vx = 0;
      state.vz = 0;
    }

    state.walkAmt = dampScalar(state.walkAmt, 0, 16, safeDt);
    state.runBlend = dampScalar(state.runBlend, 0, 14, safeDt);
    state.forwardBlend = dampScalar(state.forwardBlend, 1, 10, safeDt);
    state.strafeBlend = dampScalar(state.strafeBlend, 0, 10, safeDt);

    if (state.walkAmt < 0.02 && currentSpeed < 0.015) {
      state.walkAmt = 0;
      state.runBlend = 0;
      state.vx = 0;
      state.vz = 0;
      state.gaitMode = 'idle';
    }
  }

  // 3. Update turn-in-place stepping and body lean dynamics
  const prevTurnRate = state.turnRateRadPerSec ?? 0;
  const smoothedTurnRate = dampScalar(prevTurnRate, targetTurnRate, 16, safeDt);
  state.turnRateRadPerSec = Math.abs(smoothedTurnRate) < 0.01 ? 0 : smoothedTurnRate;

  const isTurningInPlace = Math.abs(state.turnRateRadPerSec) > 0.08 && state.walkAmt < 0.25;
  const targetTurnStepAmt = isTurningInPlace
    ? Math.min(1.0, Math.abs(state.turnRateRadPerSec) / 2.2)
    : 0;
  state.turnStepAmt = dampScalar(state.turnStepAmt ?? 0, targetTurnStepAmt, 14, safeDt);
  if ((state.turnStepAmt ?? 0) < 0.015 && !hasTurnInput) {
    state.turnStepAmt = 0;
  } else if ((state.turnStepAmt ?? 0) > 0.01) {
    const turnCycleFreq = 4.8 + Math.abs(state.turnRateRadPerSec) * 1.4;
    state.turnPhase = (state.turnPhase ?? 0) + safeDt * turnCycleFreq * Math.sign(state.turnRateRadPerSec || 1);
  }

  // Subtle body lean: forward pitch with forward speed, lateral roll banking into turns & strafes
  const currentSpeed = Math.hypot(state.vx, state.vz);
  const normalizedSpeed = Math.min(1.0, currentSpeed / maxRunSpeed);
  const targetLeanPitch = state.forwardBlend * normalizedSpeed * (0.065 + state.runBlend * 0.075);
  const turnBankRoll = Math.max(-0.08, Math.min(0.08, -state.turnRateRadPerSec * 0.028 * (0.35 + normalizedSpeed * 0.65)));
  const strafeRoll = -state.strafeBlend * normalizedSpeed * 0.055;
  const targetLeanRoll = Math.max(-0.11, Math.min(0.11, turnBankRoll + strafeRoll));

  state.leanPitchRad = dampScalar(state.leanPitchRad ?? 0, targetLeanPitch, 12, safeDt);
  state.leanRollRad = dampScalar(state.leanRollRad ?? 0, targetLeanRoll, 12, safeDt);
  if (Math.abs(state.leanPitchRad) < 0.001 && currentSpeed === 0) state.leanPitchRad = 0;
  if (Math.abs(state.leanRollRad) < 0.001 && currentSpeed === 0 && state.turnRateRadPerSec === 0) state.leanRollRad = 0;

  return state;
}

/**
 * Rotates the character's body yaw in place from the right (orange) joystick horizontal axis (`rawTurnStickX`).
 *
 * - Horizontal left (`rawTurnStickX < 0`) rotates the character counter-clockwise (`+rot`, turning toward character's left).
 * - Horizontal right (`rawTurnStickX > 0`) rotates the character clockwise (`-rot`, turning toward character's right).
 * - Does not translate `(x, z)` or trigger walking gait.
 * - Updates `turnRateRadPerSec`, `turnPhase`, and `turnStepAmt` so the character pivots naturally with subtle foot placement.
 * - Releasing the joystick (`rawTurnStickX = 0`) stops rotation immediately and preserves the final orientation.
 */
export function stepCharacterTurnInPlace(
  state: ThirdPersonLocomotionState,
  rawTurnStickX: number,
  dt: number,
  deadzone = 0.05
): ThirdPersonLocomotionState {
  const safeDt = Math.min(Math.max(dt, 0), 0.1);
  if (safeDt <= 0) return state;

  const { normalizedTurn } = normalizeTurnJoystickInput(rawTurnStickX, 1.0, deadzone);
  if (normalizedTurn === 0) {
    state.turnRateRadPerSec = 0;
    state.turnStepAmt = dampScalar(state.turnStepAmt ?? 0, 0, 16, safeDt);
    if ((state.turnStepAmt ?? 0) < 0.015) state.turnStepAmt = 0;
    state.leanRollRad = dampScalar(state.leanRollRad ?? 0, 0, 14, safeDt);
    return state;
  }

  const turnSpeedRadPerSec = 2.6; // ~149 deg/sec at full stick deflection
  const turnRate = -normalizedTurn * turnSpeedRadPerSec;
  const deltaRot = turnRate * safeDt;

  state.rot = normalizeAngleRad(state.rot + deltaRot);
  state.targetRot = state.rot;
  state.facingMode = 'manual';
  state.turnRateRadPerSec = turnRate;
  state.turnStepAmt = dampScalar(state.turnStepAmt ?? 0, Math.min(1.0, Math.abs(normalizedTurn)), 14, safeDt);
  state.turnPhase = (state.turnPhase ?? 0) + safeDt * (4.8 + Math.abs(turnRate) * 1.4) * Math.sign(turnRate);
  state.leanRollRad = dampScalar(state.leanRollRad ?? 0, -turnRate * 0.015, 12, safeDt);
  return state;
}

export type PlayboardCameraMode = 'third_person' | 'free_orbit';

export interface FreeOrbitCameraState {
  yaw: number;
  pitch: number;
  dist: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  currYaw: number;
  currPitch: number;
  currDist: number;
  currTargetX: number;
  currTargetY: number;
  currTargetZ: number;
}

/**
 * Converts a live 3D camera world position and look-at target into a Free Orbit camera state
 * so switching from Third Person to Free Orbit produces zero positional or rotational jump.
 */
export function convertCameraPoseToFreeOrbitState(
  cameraWorldPos: { x: number; y: number; z: number },
  lookTargetWorldPos: { x: number; y: number; z: number }
): FreeOrbitCameraState {
  const dx = cameraWorldPos.x - lookTargetWorldPos.x;
  const dy = cameraWorldPos.y - lookTargetWorldPos.y;
  const dz = cameraWorldPos.z - lookTargetWorldPos.z;
  const rawDist = Math.hypot(dx, dy, dz);
  const dist = Math.max(0.8, Math.min(8.5, rawDist > 1e-4 ? rawDist : 2.8));
  const horiz = Math.hypot(dx, dz);
  const yaw = horiz > 1e-5 ? normalizeAngleRad(Math.atan2(dx, dz)) : 0;
  const pitch = Math.max(-0.42, Math.min(1.42, Math.atan2(dy, Math.max(1e-5, horiz))));

  return {
    yaw,
    pitch,
    dist,
    targetX: lookTargetWorldPos.x,
    targetY: lookTargetWorldPos.y,
    targetZ: lookTargetWorldPos.z,
    currYaw: yaw,
    currPitch: pitch,
    currDist: dist,
    currTargetX: lookTargetWorldPos.x,
    currTargetY: lookTargetWorldPos.y,
    currTargetZ: lookTargetWorldPos.z,
  };
}

/**
 * Computes the world-space camera position from a Free Orbit state.
 */
export function evaluateFreeOrbitCameraPosition(state: FreeOrbitCameraState): {
  cameraPos: { x: number; y: number; z: number };
  lookTarget: { x: number; y: number; z: number };
} {
  const horiz = Math.cos(state.currPitch) * state.currDist;
  const camX = state.currTargetX + Math.sin(state.currYaw) * horiz;
  const camY = Math.max(0.14, state.currTargetY + Math.sin(state.currPitch) * state.currDist);
  const camZ = state.currTargetZ + Math.cos(state.currYaw) * horiz;
  return {
    cameraPos: { x: camX, y: camY, z: camZ },
    lookTarget: { x: state.currTargetX, y: state.currTargetY, z: state.currTargetZ },
  };
}

/**
 * Converts the current Free Orbit camera pose into Third Person spherical parameters
 * relative to the active subject's focus point, preserving a sensible viewing angle, elevation, and distance.
 */
export function convertFreeOrbitToThirdPersonOrientation(
  cameraWorldPos: { x: number; y: number; z: number },
  subjectFocusPos: { x: number; y: number; z: number }
): {
  yawRad: number;
  pitchRad: number;
  distance: number;
  yawDeg: number;
  pitchDeg: number;
} {
  const dx = cameraWorldPos.x - subjectFocusPos.x;
  const dy = cameraWorldPos.y - subjectFocusPos.y;
  const dz = cameraWorldPos.z - subjectFocusPos.z;
  const rawDist = Math.hypot(dx, dy, dz);
  const distance = Number(Math.max(1.0, Math.min(6.5, rawDist > 1e-4 ? rawDist : 2.8)).toFixed(2));
  const horiz = Math.hypot(dx, dz);
  const yawRad = horiz > 1e-5 ? normalizeAngleRad(Math.atan2(dx, dz)) : 0;
  const pitchRad = Math.max(-0.436, Math.min(1.309, Math.atan2(dy, Math.max(1e-5, horiz))));

  const rawYawDeg = Math.round((yawRad * 180) / Math.PI);
  const normYawDeg = ((((rawYawDeg + 180) % 360) + 360) % 360) - 180;
  const yawDeg = normYawDeg === -180 ? 180 : normYawDeg;
  const pitchDeg = Math.max(-25, Math.min(75, Math.round((pitchRad * 180) / Math.PI)));

  return {
    yawRad,
    pitchRad,
    distance,
    yawDeg,
    pitchDeg,
  };
}

/**
 * Pans the Free Orbit target along the camera's local right and up vectors in screen space.
 */
export function panFreeOrbitTarget(
  state: FreeOrbitCameraState,
  deltaScreenX: number,
  deltaScreenY: number,
  viewportHeight = 600,
  fovDeg = 47
): FreeOrbitCameraState {
  const safeH = Math.max(120, viewportHeight);
  const fovRad = (fovDeg * Math.PI) / 180;
  const metersPerPixel = (2 * state.dist * Math.tan(fovRad * 0.5)) / safeH;

  // Camera right vector on ground plane: (cos(yaw), 0, -sin(yaw))
  const rightX = Math.cos(state.yaw);
  const rightZ = -Math.sin(state.yaw);

  // Camera up vector in 3D: (-sin(yaw)*sin(pitch), cos(pitch), -cos(yaw)*sin(pitch))
  const upX = -Math.sin(state.yaw) * Math.sin(state.pitch);
  const upY = Math.cos(state.pitch);
  const upZ = -Math.cos(state.yaw) * Math.sin(state.pitch);

  const panX = (-deltaScreenX * rightX + deltaScreenY * upX) * metersPerPixel;
  const panY = deltaScreenY * upY * metersPerPixel;
  const panZ = (-deltaScreenX * rightZ + deltaScreenY * upZ) * metersPerPixel;

  state.targetX = Math.max(-3.2, Math.min(3.2, state.targetX + panX));
  state.targetY = Math.max(0.15, Math.min(2.4, state.targetY + panY));
  state.targetZ = Math.max(-3.2, Math.min(3.2, state.targetZ + panZ));
  return state;
}

