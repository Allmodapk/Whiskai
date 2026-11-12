import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface BuiltPerspectiveScene {
  scene: THREE.Scene;
  subjectRoot: THREE.Group;
  roomRoot: THREE.Group;
  dispose: () => void;
}

/**
 * Generates a crisp procedural studio floor texture with subtle meter rings & cardinal direction cues
 * so horizontal camera azimuth and elevation changes are immediately legible.
 */
function createStudioFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Warm charcoal architectural studio slate floor
  ctx.fillStyle = '#181c26';
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;

  // Subtle floor tile grid (1m increments across 12m × 12m floor)
  const pxPerMeter = size / 12;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
  ctx.lineWidth = 1.5;
  for (let m = -6; m <= 6; m++) {
    const pos = cx + m * pxPerMeter;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
    ctx.stroke();
  }

  // Distance rings centered on subject origin (1m, 2m, 3m, 4m)
  for (let rMeters = 1; rMeters <= 4; rMeters++) {
    ctx.strokeStyle =
      rMeters === 2 ? 'rgba(245, 197, 24, 0.24)' : 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = rMeters === 2 ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rMeters * pxPerMeter, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(203, 213, 225, 0.55)';
    ctx.font = '600 18px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${rMeters}m`, cx, cy + rMeters * pxPerMeter - 8);
  }

  // Cardinal floor labels (Note canvas Y+ points toward +Z world front when rotated -PI/2 on X)
  ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = 'rgba(245, 197, 24, 0.72)';
  ctx.fillText('FRONT (0°)', cx, cy + 4.45 * pxPerMeter);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
  ctx.fillText('BACK (±180°)', cx, cy - 4.35 * pxPerMeter);
  ctx.fillText('CAM-RIGHT (+90°)', cx + 4.3 * pxPerMeter, cy + 6);
  ctx.fillText('CAM-LEFT (-90°)', cx - 4.3 * pxPerMeter, cy + 6);

  // Subtle facing chevron on floor pointing +Z
  ctx.strokeStyle = 'rgba(245, 197, 24, 0.65)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 18, cy + 0.68 * pxPerMeter);
  ctx.lineTo(cx, cy + 0.9 * pxPerMeter);
  ctx.lineTo(cx + 18, cy + 0.68 * pxPerMeter);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.needsUpdate = true;
  return texture;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.48
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.68)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds an articulated, unmistakably directional 12+ part studio mannequin subject
 * fixed at world origin (0, 0, 0) facing +Z.
 * Front, rear, left, and right sides are visually distinct via jacket lapels, nose/visor bridge,
 * spine seam, and toe orientation so the user always reads camera orientation clearly.
 */
function buildFixedReferenceSubject(
  trackDisposable: <T extends { dispose: () => void }>(item: T) => T
): THREE.Group {
  const subject = new THREE.Group();
  subject.name = 'FixedReferenceSubject';

  const skinMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xd9c7b6,
      roughness: 0.56,
      metalness: 0.04,
    })
  );

  const jacketMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x3b4860,
      roughness: 0.72,
      metalness: 0.08,
    })
  );

  const trouserMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x252c39,
      roughness: 0.78,
      metalness: 0.05,
    })
  );

  const accentBrassMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xe6b832,
      roughness: 0.28,
      metalness: 0.78,
    })
  );

  const darkTrimMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x161a24,
      roughness: 0.45,
      metalness: 0.25,
    })
  );

  const shoeMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x20242d,
      roughness: 0.48,
      metalness: 0.12,
    })
  );

  const addPart = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    pos: [number, number, number],
    rot: [number, number, number] = [0, 0, 0]
  ) => {
    trackDisposable(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    subject.add(mesh);
    return mesh;
  };

  // 1. Shoes / Feet grounded at y = 0 pointing toward +Z
  for (const side of [-1, 1]) {
    addPart(new THREE.BoxGeometry(0.1, 0.07, 0.24), shoeMat, [side * 0.105, 0.035, 0.04]);
    // White/brass sole heel stripe so forward toe direction (+Z) is unmistakable
    addPart(
      new THREE.BoxGeometry(0.104, 0.018, 0.07),
      accentBrassMat,
      [side * 0.105, 0.045, 0.12]
    );
  }

  // 2. Calves & Knee Joints
  for (const side of [-1, 1]) {
    addPart(new THREE.CapsuleGeometry(0.054, 0.34, 6, 14), trouserMat, [side * 0.105, 0.27, 0]);
    addPart(new THREE.SphereGeometry(0.058, 14, 12), trouserMat, [side * 0.105, 0.48, 0.01]);
  }

  // 3. Thighs & Pelvis
  for (const side of [-1, 1]) {
    addPart(new THREE.CapsuleGeometry(0.072, 0.34, 6, 14), trouserMat, [side * 0.105, 0.68, 0]);
  }
  addPart(new THREE.CapsuleGeometry(0.145, 0.14, 8, 16), trouserMat, [0, 0.9, 0], [0, 0, Math.PI / 2]);
  // Belt / waist indicator ring (brass front buckle at +Z)
  addPart(new THREE.BoxGeometry(0.32, 0.04, 0.21), darkTrimMat, [0, 0.96, 0]);
  addPart(new THREE.BoxGeometry(0.07, 0.044, 0.025), accentBrassMat, [0, 0.96, 0.105]);

  // 4. Sculpted Torso / Studio Jacket
  addPart(new THREE.CylinderGeometry(0.175, 0.138, 0.44, 18), jacketMat, [0, 1.19, 0]);
  // Front shirt placket & chest collar (+Z) so front vs rear is unmistakable
  addPart(new THREE.BoxGeometry(0.06, 0.32, 0.03), skinMat, [0, 1.24, 0.148]);
  addPart(new THREE.BoxGeometry(0.022, 0.36, 0.035), accentBrassMat, [0, 1.2, 0.158]);
  // Rear spine center seam (-Z)
  addPart(new THREE.BoxGeometry(0.018, 0.38, 0.02), darkTrimMat, [0, 1.19, -0.15]);

  // 5. Shoulders & Arms
  for (const side of [-1, 1]) {
    // Shoulder cap
    addPart(new THREE.SphereGeometry(0.068, 14, 12), jacketMat, [side * 0.215, 1.38, 0]);
    // Upper arm
    addPart(
      new THREE.CapsuleGeometry(0.048, 0.24, 6, 12),
      jacketMat,
      [side * 0.235, 1.22, 0],
      [0, 0, side * -0.07]
    );
    // Forearm
    addPart(
      new THREE.CapsuleGeometry(0.04, 0.22, 6, 12),
      skinMat,
      [side * 0.245, 0.97, 0.03],
      [0.14, 0, 0]
    );
    // Hand
    addPart(new THREE.SphereGeometry(0.042, 12, 10), skinMat, [side * 0.248, 0.82, 0.06]);
  }

  // 6. Neck, Head & Unmistakable Front-Facing Landmarks (+Z)
  addPart(new THREE.CylinderGeometry(0.052, 0.06, 0.11, 14), skinMat, [0, 1.45, 0]);
  // Cranium
  addPart(new THREE.SphereGeometry(0.112, 20, 18), skinMat, [0, 1.59, 0]);
  // Sculpted hair cap (covers top and back -Z so rear view looks distinctly like back of head)
  addPart(
    new THREE.SphereGeometry(0.116, 18, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
    darkTrimMat,
    [0, 1.605, -0.014],
    [-0.32, 0, 0]
  );
  // Subtle directional eye-line visor & nose bridge on +Z face
  addPart(new THREE.BoxGeometry(0.135, 0.024, 0.03), darkTrimMat, [0, 1.6, 0.102]);
  addPart(new THREE.BoxGeometry(0.022, 0.042, 0.036), skinMat, [0, 1.572, 0.114]);
  // Left & Right ear markers (distinct subtle color dots on ±X for left/right check)
  addPart(new THREE.SphereGeometry(0.022, 10, 8), skinMat, [0.112, 1.58, 0]);
  addPart(new THREE.SphereGeometry(0.022, 10, 8), skinMat, [-0.112, 1.58, 0]);

  // Freeze subject transform at world origin
  subject.position.set(0, 0, 0);
  subject.rotation.set(0, 0, 0);
  subject.scale.set(1, 1, 1);

  return subject;
}

/**
 * Builds the fixed studio environment + room props (chair/bench to camera-left, plant/lamp column to rear-right)
 * so the user always has intuitive architectural perspective landmarks when orbiting.
 */
function buildFixedStudioRoom(
  maxAnisotropy: number,
  trackDisposable: <T extends { dispose: () => void }>(item: T) => T
): THREE.Group {
  const room = new THREE.Group();
  room.name = 'FixedStudioRoom';

  // Studio floor
  const floorTex = trackDisposable(createStudioFloorTexture(maxAnisotropy));
  const floorGeo = trackDisposable(new THREE.PlaneGeometry(12, 12));
  const floorMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.78,
      metalness: 0.08,
    })
  );
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  room.add(floor);

  // Soft radial contact shadow under subject feet (offset y = 0.004 to prevent Z-fighting)
  const contactTex = trackDisposable(createContactShadowTexture());
  const contactGeo = trackDisposable(new THREE.PlaneGeometry(0.95, 0.95));
  const contactMat = trackDisposable(
    new THREE.MeshBasicMaterial({
      map: contactTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.65,
    })
  );
  const contactPlane = new THREE.Mesh(contactGeo, contactMat);
  contactPlane.rotation.x = -Math.PI / 2;
  contactPlane.position.y = 0.004;
  room.add(contactPlane);

  // Architectural rear studio wall & side panel cues (far enough away at r=5.6m to never block low-distance orbits)
  const wallMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x1c212d,
      roughness: 0.88,
      metalness: 0.04,
    })
  );
  const trimMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x2c3344,
      roughness: 0.65,
      metalness: 0.15,
    })
  );
  const woodMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x6b513d,
      roughness: 0.72,
      metalness: 0.05,
    })
  );

  // Back wall (-Z = -5.5)
  const backWall = new THREE.Mesh(trackDisposable(new THREE.BoxGeometry(12, 4.4, 0.16)), wallMat);
  backWall.position.set(0, 2.2, -5.5);
  backWall.receiveShadow = true;
  room.add(backWall);

  // Architectural vertical pilaster ribs along back wall for vanishing-point perspective clarity
  for (const x of [-3.6, -1.8, 1.8, 3.6]) {
    const pilaster = new THREE.Mesh(
      trackDisposable(new THREE.BoxGeometry(0.18, 4.4, 0.24)),
      trimMat
    );
    pilaster.position.set(x, 2.2, -5.42);
    pilaster.receiveShadow = true;
    room.add(pilaster);
  }

  // Left architectural studio bench (-X = -2.2, Z = -1.6) as spatial depth anchor
  const benchGroup = new THREE.Group();
  benchGroup.position.set(-2.2, 0, -1.6);
  const benchTop = new THREE.Mesh(
    trackDisposable(new THREE.BoxGeometry(1.3, 0.07, 0.5)),
    woodMat
  );
  benchTop.position.y = 0.45;
  benchTop.castShadow = true;
  benchTop.receiveShadow = true;
  benchGroup.add(benchTop);
  for (const lx of [-0.52, 0.52]) {
    const leg = new THREE.Mesh(trackDisposable(new THREE.BoxGeometry(0.06, 0.42, 0.42)), trimMat);
    leg.position.set(lx, 0.21, 0);
    leg.castShadow = true;
    benchGroup.add(leg);
  }
  room.add(benchGroup);

  // Right studio pedestal + minimalist lamp globe (+X = 2.3, Z = -1.8)
  const plinth = new THREE.Mesh(trackDisposable(new THREE.CylinderGeometry(0.28, 0.3, 0.9, 20)), trimMat);
  plinth.position.set(2.3, 0.45, -1.8);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  room.add(plinth);

  const globeMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xfff3d6,
      emissive: 0xffd28a,
      emissiveIntensity: 0.45,
      roughness: 0.35,
    })
  );
  const lampGlobe = new THREE.Mesh(trackDisposable(new THREE.SphereGeometry(0.19, 18, 14)), globeMat);
  lampGlobe.position.set(2.3, 1.09, -1.8);
  room.add(lampGlobe);

  return room;
}

export function buildPerspectivePlayboardScene(
  renderer: THREE.WebGLRenderer,
  isSoftwareGl: boolean
): BuiltPerspectiveScene {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1018);
  scene.fog = new THREE.FogExp2(0x0d1018, 0.042);

  // Studio environment reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  disposables.push(envTex);
  pmrem.dispose();

  // Balanced 3-point studio lighting rig
  const hemi = new THREE.HemisphereLight(0xcbdcff, 0x262129, 0.95);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.1);
  keyLight.position.set(3.2, 5.2, 3.8);
  keyLight.castShadow = !isSoftwareGl;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 16;
  const d = 4.2;
  keyLight.shadow.camera.left = -d;
  keyLight.shadow.camera.right = d;
  keyLight.shadow.camera.top = d;
  keyLight.shadow.camera.bottom = -d;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x8bb6ff, 0.85);
  rimLight.position.set(-3.4, 3.5, -3.6);
  scene.add(rimLight);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const roomRoot = buildFixedStudioRoom(maxAniso, track);
  scene.add(roomRoot);

  const subjectRoot = buildFixedReferenceSubject(track);
  scene.add(subjectRoot);

  return {
    scene,
    subjectRoot,
    roomRoot,
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
