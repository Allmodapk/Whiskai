import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

export interface BuiltPerspectiveScene {
  scene: THREE.Scene;
  subjectRoot: THREE.Group;
  roomRoot: THREE.Group;
  dispose: () => void;
}

/**
 * Generates a fine procedural fabric twill roughness/bump CanvasTexture (linear data space)
 * so tailored jacket lapels and trousers catch directional studio key/rim highlights realistically.
 */
function createFabricWeaveTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const diag = ((x + y) % 8) < 4;
      const tone = diag ? 148 : 108;
      ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a crisp procedural architectural studio floor texture with subtle tile joints,
 * tonal concrete variation, 1m–4m distance rings, and cardinal camera cues.
 */
function createStudioFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Deep architectural slate radial gradient
  const cx = size / 2;
  const cy = size / 2;
  const bgGrad = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.56);
  bgGrad.addColorStop(0, '#1e2432');
  bgGrad.addColorStop(0.55, '#151924');
  bgGrad.addColorStop(1, '#0e1118');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // Subtle architectural tile grid (1m increments across 16m × 16m floor)
  const pxPerMeter = size / 16;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  ctx.lineWidth = 1.2;
  for (let m = -8; m <= 8; m++) {
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
      rMeters === 2 ? 'rgba(245, 197, 24, 0.28)' : 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = rMeters === 2 ? 2.2 : 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, rMeters * pxPerMeter, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(203, 213, 225, 0.58)';
    ctx.font = '600 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${rMeters}m`, cx, cy + rMeters * pxPerMeter - 7);
  }

  // Cardinal floor labels (canvas +Y maps toward +Z world front)
  ctx.font = '700 18px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = 'rgba(245, 197, 24, 0.78)';
  ctx.fillText('FRONT (0°)', cx, cy + 4.45 * pxPerMeter);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.56)';
  ctx.fillText('BACK (±180°)', cx, cy - 4.35 * pxPerMeter);
  ctx.fillText('CAM-RIGHT (+90°)', cx + 4.45 * pxPerMeter, cy + 5);
  ctx.fillText('CAM-LEFT (-90°)', cx - 4.45 * pxPerMeter, cy + 5);

  // Subtle facing chevron on floor pointing +Z
  ctx.strokeStyle = 'rgba(245, 197, 24, 0.7)';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(cx - 15, cy + 0.65 * pxPerMeter);
  ctx.lineTo(cx, cy + 0.88 * pxPerMeter);
  ctx.lineTo(cx + 15, cy + 0.65 * pxPerMeter);
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
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.52, 'rgba(0, 0, 0, 0.3)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds an anatomically proportioned, tailored studio figure anchored at world origin (0, 0, 0)
 * facing +Z, matching FIXED_SUBJECT_LANDMARKS (total standing height 1.72m, eyes at y=1.58, z=0.08).
 */
function buildFixedReferenceSubject(
  maxAnisotropy: number,
  trackDisposable: <T extends { dispose: () => void }>(item: T) => T
): THREE.Group {
  const subject = new THREE.Group();
  subject.name = 'FixedReferenceSubject';

  const weaveTex = trackDisposable(createFabricWeaveTexture(maxAnisotropy));

  // Calibrated PBR materials with >= 0.25 roughness contrast across adjacent elements
  const skinMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xdab8a0,
      roughness: 0.54,
      metalness: 0.02,
    })
  );

  const hairMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x1a171c,
      roughness: 0.42,
      metalness: 0.08,
    })
  );

  const shirtMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xd9dde6,
      roughness: 0.78,
      metalness: 0.02,
      bumpMap: weaveTex,
      bumpScale: 0.0025,
    })
  );

  const jacketMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x303b52,
      roughness: 0.8,
      metalness: 0.04,
      bumpMap: weaveTex,
      bumpScale: 0.004,
    })
  );

  const trouserMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x212633,
      roughness: 0.84,
      metalness: 0.03,
      bumpMap: weaveTex,
      bumpScale: 0.0035,
    })
  );

  const beltLeatherMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x16141a,
      roughness: 0.36,
      metalness: 0.12,
    })
  );

  const accentBrassMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xe6b832,
      roughness: 0.22,
      metalness: 0.86,
    })
  );

  const shoeUpperMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x262a34,
      roughness: 0.48,
      metalness: 0.1,
    })
  );

  const shoeSoleMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xc9ced6,
      roughness: 0.86,
      metalness: 0.02,
    })
  );

  const scleraMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xf4f5f7,
      roughness: 0.3,
      metalness: 0.0,
    })
  );

  const irisMat = trackDisposable(
    new THREE.MeshPhysicalMaterial({
      color: 0x1e2536,
      roughness: 0.14,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    })
  );

  const addPart = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    pos: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1]
  ) => {
    trackDisposable(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    subject.add(mesh);
    return mesh;
  };

  // Helper for smooth anatomical Lathe profiles (radii bottom-to-top)
  const buildLimbLathe = (
    profile: Array<[number, number]>,
    radialSegments = 20
  ): THREE.LatheGeometry => {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(pts, radialSegments);
    geo.computeVertexNormals();
    return geo;
  };

  // 1. Grounded Multi-Part Sneakers (y = 0.0 -> 0.075, pointing +Z)
  for (const side of [-1, 1]) {
    const x = side * 0.105;
    // White rubber outsole resting flush on y = 0
    const soleGeo = new THREE.BoxGeometry(0.098, 0.022, 0.245);
    addPart(soleGeo, shoeSoleMat, [x, 0.011, 0.036]);

    // Sculpted upper shoe body
    const upperShape = new THREE.Shape();
    upperShape.moveTo(-0.044, -0.105);
    upperShape.lineTo(0.044, -0.105);
    upperShape.quadraticCurveTo(0.048, 0.02, 0.04, 0.11);
    upperShape.quadraticCurveTo(0, 0.135, -0.04, 0.11);
    upperShape.quadraticCurveTo(-0.048, 0.02, -0.044, -0.105);
    const upperGeo = new THREE.ExtrudeGeometry(upperShape, {
      depth: 0.045,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.006,
      bevelSegments: 2,
    });
    upperGeo.rotateX(Math.PI / 2);
    upperGeo.computeVertexNormals();
    addPart(upperGeo, shoeUpperMat, [x, 0.068, 0.038]);

    // Forward brass lace/tongue accent (+Z direction cue)
    addPart(new THREE.BoxGeometry(0.032, 0.01, 0.048), accentBrassMat, [x, 0.078, 0.075], [0.22, 0, 0]);
  }

  // 2. Sculpted Calves, Knees & Thighs (Trousers from y=0.06 to y=0.92)
  const calfGeo = buildLimbLathe(
    [
      [0.044, 0.0],
      [0.046, 0.06],
      [0.061, 0.22],
      [0.056, 0.36],
      [0.054, 0.4],
    ],
    20
  );
  const thighGeo = buildLimbLathe(
    [
      [0.055, 0.0],
      [0.068, 0.14],
      [0.078, 0.3],
      [0.075, 0.4],
    ],
    20
  );

  for (const side of [-1, 1]) {
    const x = side * 0.105;
    addPart(calfGeo.clone(), trouserMat, [x, 0.068, -0.004]);
    addPart(new THREE.SphereGeometry(0.055, 16, 12), trouserMat, [x, 0.48, 0.008]);
    addPart(thighGeo.clone(), trouserMat, [x, 0.49, 0.0]);
  }
  calfGeo.dispose();
  thighGeo.dispose();

  // Tailored Pelvis & Hip Block (y = 0.85..0.98)
  addPart(new THREE.CapsuleGeometry(0.132, 0.14, 10, 18), trouserMat, [0, 0.9, 0], [0, 0, Math.PI / 2], [1, 1, 0.72]);
  // Waist Belt + Brushed Brass Front Buckle (+Z)
  addPart(new THREE.CylinderGeometry(0.146, 0.148, 0.038, 22), beltLeatherMat, [0, 0.975, 0], [0, 0, 0], [1, 1, 0.72]);
  addPart(new THREE.BoxGeometry(0.054, 0.044, 0.018), accentBrassMat, [0, 0.975, 0.105]);

  // 3. Anatomically Tapered Torso & Inner Shirt + Open Studio Blazer Jacket
  // Inner crew shirt core (y = 0.98..1.43)
  const torsoLathe = buildLimbLathe(
    [
      [0.136, 0.0],
      [0.144, 0.1],
      [0.168, 0.26],
      [0.178, 0.38],
      [0.135, 0.43],
      [0.062, 0.46],
    ],
    24
  );
  addPart(torsoLathe, shirtMat, [0, 0.985, 0], [0, 0, 0], [1.05, 1, 0.68]);

  // Sculpted blazer jacket shell wrapping sides and back (-Z), leaving chest placket visible (+Z)
  const jacketShell = new THREE.CylinderGeometry(0.186, 0.15, 0.44, 24, 1, false, Math.PI * 0.14, Math.PI * 1.72);
  jacketShell.rotateY(Math.PI); // Gap centered toward +Z front!
  jacketShell.scale(1.06, 1, 0.72);
  jacketShell.computeVertexNormals();
  addPart(jacketShell, jacketMat, [0, 1.195, -0.003]);

  // Structured Left & Right Beveled Lapels on +Z front
  for (const side of [-1, 1]) {
    const lapelShape = new THREE.Shape();
    lapelShape.moveTo(0, 0);
    lapelShape.lineTo(side * 0.052, 0.18);
    lapelShape.lineTo(side * 0.025, 0.34);
    lapelShape.lineTo(side * 0.075, 0.34);
    lapelShape.lineTo(side * 0.088, 0.16);
    lapelShape.lineTo(side * 0.02, -0.02);
    lapelShape.closePath();

    const lapelGeo = new THREE.ExtrudeGeometry(lapelShape, {
      depth: 0.02,
      bevelEnabled: true,
      bevelThickness: 0.005,
      bevelSize: 0.004,
      bevelSegments: 2,
    });
    lapelGeo.computeVertexNormals();
    addPart(lapelGeo, jacketMat, [side * 0.026, 1.07, 0.105], [0, side * -0.18, 0]);
  }

  // Brass chest clasp button (+Z) & Rear back vent seam (-Z)
  addPart(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 12), accentBrassMat, [0, 1.13, 0.122], [Math.PI / 2, 0, 0]);
  addPart(new THREE.BoxGeometry(0.014, 0.36, 0.018), beltLeatherMat, [0, 1.18, -0.128]);

  // 4. Articulated Shoulders, Sleeved Upper Arms, Exposed Forearms & Hands
  const upperArmGeo = buildLimbLathe(
    [
      [0.044, 0.0],
      [0.051, 0.12],
      [0.055, 0.24],
      [0.048, 0.27],
    ],
    18
  );
  const forearmGeo = buildLimbLathe(
    [
      [0.028, 0.0],
      [0.036, 0.12],
      [0.042, 0.24],
    ],
    18
  );

  for (const side of [-1, 1]) {
    // Structured shoulder cap (y = 1.40)
    addPart(new THREE.SphereGeometry(0.066, 16, 14), jacketMat, [side * 0.205, 1.385, 0], [0, 0, 0], [1, 0.9, 0.92]);
    // Sleeved upper arm
    addPart(upperArmGeo.clone(), jacketMat, [side * 0.222, 1.135, 0], [0, 0, side * 0.07]);
    // Tapered forearm angling slightly forward (+Z)
    addPart(forearmGeo.clone(), skinMat, [side * 0.242, 0.89, 0.038], [0.16, 0, side * -0.02]);
    // Articulated hand (palm + forward thumb)
    addPart(new THREE.BoxGeometry(0.032, 0.095, 0.058), skinMat, [side * 0.246, 0.825, 0.06], [0.14, 0, 0]);
    addPart(new THREE.CapsuleGeometry(0.01, 0.032, 4, 8), skinMat, [side * 0.23, 0.84, 0.088], [0.45, 0, side * -0.25]);
  }
  upperArmGeo.dispose();
  forearmGeo.dispose();

  // 5. Neck & Anatomically Sculpted Head (eyes at y = 1.58, z = 0.08; crown y = 1.72)
  addPart(new THREE.CylinderGeometry(0.046, 0.056, 0.115, 18), skinMat, [0, 1.455, 0.005]);

  // Cranium + tapered jaw silhouette
  addPart(new THREE.SphereGeometry(0.104, 24, 20), skinMat, [0, 1.605, -0.006], [0, 0, 0], [0.92, 1.08, 1.0]);
  addPart(new THREE.SphereGeometry(0.078, 18, 16), skinMat, [0, 1.532, 0.02], [0.18, 0, 0], [0.92, 0.96, 1.02]);

  // Brow ridge, sculpted nose bridge & subtle lip line on +Z face
  addPart(new THREE.BoxGeometry(0.112, 0.014, 0.03), skinMat, [0, 1.602, 0.082]);
  addPart(new THREE.BoxGeometry(0.018, 0.042, 0.032), skinMat, [0, 1.568, 0.102], [-0.24, 0, 0]);
  addPart(new THREE.BoxGeometry(0.04, 0.01, 0.018), skinMat, [0, 1.525, 0.096]);

  // Eyes (sclera + clearcoated iris at y = 1.58, z = 0.086)
  for (const side of [-1, 1]) {
    addPart(new THREE.SphereGeometry(0.014, 12, 10), scleraMat, [side * 0.034, 1.582, 0.084], [0, 0, 0], [1.15, 0.78, 0.7]);
    addPart(new THREE.SphereGeometry(0.0085, 12, 10), irisMat, [side * 0.034, 1.582, 0.093], [0, 0, 0], [1, 1, 0.6]);
    // Subtle dark eyebrow arch
    addPart(new THREE.BoxGeometry(0.034, 0.007, 0.01), hairMat, [side * 0.035, 1.604, 0.092], [0, 0, side * -0.06]);
  }

  // Ears (±X)
  for (const side of [-1, 1]) {
    addPart(new THREE.SphereGeometry(0.02, 12, 10), skinMat, [side * 0.096, 1.575, -0.006], [0, 0, 0], [0.42, 1.25, 0.75]);
  }

  // Swept Hair Crown & Rear Nape Cap (-Z) up to crown y = 1.72
  addPart(
    new THREE.SphereGeometry(0.109, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hairMat,
    [0, 1.615, -0.015],
    [-0.36, 0, 0],
    [0.95, 1.0, 1.03]
  );
  // Swept front hair crest
  addPart(new THREE.CapsuleGeometry(0.038, 0.09, 6, 12), hairMat, [0.01, 1.675, 0.038], [0.22, 0, 1.42], [0.75, 1.0, 0.85]);

  // Freeze subject transform at world origin (0, 0, 0)
  subject.position.set(0, 0, 0);
  subject.rotation.set(0, 0, 0);
  subject.scale.set(1, 1, 1);

  return subject;
}

/**
 * Builds the studio stage + architectural props (walnut bench on camera-left, minimalist softbox diffuser
 * light stand on rear-right, and a distant curved horizon backdrop beyond max orbit radius so rear angles
 * are never occluded).
 */
function buildFixedStudioRoom(
  maxAnisotropy: number,
  trackDisposable: <T extends { dispose: () => void }>(item: T) => T
): THREE.Group {
  const room = new THREE.Group();
  room.name = 'FixedStudioRoom';

  // Studio floor (16m × 16m seamless charcoal studio floor fading into horizon fog)
  const floorTex = trackDisposable(createStudioFloorTexture(maxAnisotropy));
  const floorGeo = trackDisposable(new THREE.PlaneGeometry(16, 16));
  const floorMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.76,
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
      opacity: 0.68,
    })
  );
  const contactPlane = new THREE.Mesh(contactGeo, contactMat);
  contactPlane.rotation.x = -Math.PI / 2;
  contactPlane.position.y = 0.004;
  room.add(contactPlane);

  const wallMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x171b26,
      roughness: 0.9,
      metalness: 0.04,
      side: THREE.FrontSide,
    })
  );
  const matteMetalMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x262c3b,
      roughness: 0.42,
      metalness: 0.65,
    })
  );
  const walnutMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x6b4e38,
      roughness: 0.68,
      metalness: 0.04,
    })
  );

  // Curved photography backdrop wall placed at z = -8.9 (outside CAMERA_LIMITS.maxDistanceMeters = 8.5)
  // so 180° rear camera orbits remain 100% unobstructed.
  const cycWallGeo = trackDisposable(
    new THREE.CylinderGeometry(9.2, 9.2, 4.8, 32, 1, true, Math.PI * 0.76, Math.PI * 0.48)
  );
  // Flip inward normals visually via BackSide since camera looks toward origin from inside arc
  const cycWallMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x181d29,
      roughness: 0.88,
      metalness: 0.04,
      side: THREE.BackSide,
    })
  );
  const cycWall = new THREE.Mesh(cycWallGeo, cycWallMat);
  cycWall.position.set(0, 2.4, 0);
  cycWall.receiveShadow = true;
  room.add(cycWall);

  // Subtle architectural vertical ribs along distant arc for perspective vanishing-point reads
  for (const deg of [-34, -17, 0, 17, 34]) {
    const rad = THREE.MathUtils.degToRad(deg);
    const r = 9.05;
    const pilaster = new THREE.Mesh(
      trackDisposable(new THREE.BoxGeometry(0.16, 4.8, 0.22)),
      wallMat
    );
    pilaster.position.set(Math.sin(rad) * r, 2.4, -Math.cos(rad) * r);
    pilaster.rotation.y = -rad;
    room.add(pilaster);
  }

  // Left architectural studio bench (-X = -2.2, Z = -1.6) as spatial depth & scale anchor
  const benchGroup = new THREE.Group();
  benchGroup.position.set(-2.2, 0, -1.6);
  const benchTop = new THREE.Mesh(
    trackDisposable(new THREE.BoxGeometry(1.32, 0.065, 0.5)),
    walnutMat
  );
  benchTop.position.y = 0.44;
  benchTop.castShadow = true;
  benchTop.receiveShadow = true;
  benchGroup.add(benchTop);
  for (const lx of [-0.52, 0.52]) {
    for (const lz of [-0.18, 0.18]) {
      const leg = new THREE.Mesh(
        trackDisposable(new THREE.CylinderGeometry(0.022, 0.016, 0.41, 10)),
        matteMetalMat
      );
      leg.position.set(lx, 0.205, lz);
      leg.castShadow = true;
      benchGroup.add(leg);
    }
  }
  room.add(benchGroup);

  // Right minimalist studio pedestal & diffuser lamp stand (+X = 2.3, Z = -1.8)
  const standGroup = new THREE.Group();
  standGroup.position.set(2.3, 0, -1.8);
  const plinth = new THREE.Mesh(
    trackDisposable(new THREE.CylinderGeometry(0.28, 0.31, 0.88, 24)),
    matteMetalMat
  );
  plinth.position.y = 0.44;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  standGroup.add(plinth);

  const brassCollar = new THREE.Mesh(
    trackDisposable(new THREE.CylinderGeometry(0.286, 0.286, 0.03, 24)),
    trackDisposable(
      new THREE.MeshStandardMaterial({
        color: 0xe6b832,
        roughness: 0.25,
        metalness: 0.85,
      })
    )
  );
  brassCollar.position.y = 0.87;
  standGroup.add(brassCollar);

  const globeMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xfff3d8,
      emissive: 0xffd594,
      emissiveIntensity: 0.42,
      roughness: 0.32,
      metalness: 0.05,
    })
  );
  const lampGlobe = new THREE.Mesh(
    trackDisposable(new THREE.SphereGeometry(0.185, 22, 16)),
    globeMat
  );
  lampGlobe.position.y = 1.06;
  standGroup.add(lampGlobe);
  room.add(standGroup);

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
  scene.background = new THREE.Color(0x0b0e16);
  scene.fog = new THREE.FogExp2(0x0b0e16, 0.036);

  // Studio environment reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  disposables.push(envTex);
  pmrem.dispose();

  // Balanced 3-point studio lighting rig
  const hemi = new THREE.HemisphereLight(0xd2e1ff, 0x26212a, 0.92);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.05);
  keyLight.position.set(3.1, 5.0, 3.6);
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

  const rimLight = new THREE.DirectionalLight(0x8bb6ff, 0.9);
  rimLight.position.set(-3.4, 3.5, -3.6);
  scene.add(rimLight);

  // Soft studio fill light bar (skipped on software WebGL for performance)
  if (!isSoftwareGl) {
    RectAreaLightUniformsLib.init();
    const fillPanel = new THREE.RectAreaLight(0xe4edff, 1.8, 2.2, 2.4);
    fillPanel.position.set(-2.6, 2.1, 2.8);
    fillPanel.lookAt(0, 1.15, 0);
    scene.add(fillPanel);
  }

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const roomRoot = buildFixedStudioRoom(maxAniso, track);
  scene.add(roomRoot);

  const subjectRoot = buildFixedReferenceSubject(maxAniso, track);
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
