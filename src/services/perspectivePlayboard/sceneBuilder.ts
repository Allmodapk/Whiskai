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
 * Generates a fine procedural twill / denim weave CanvasTexture (linear data space)
 * so overshirt fabric and denim catch directional studio key/rim highlights realistically.
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
      const diag = (x + y) % 8 < 4;
      const tone = diag ? 150 : 106;
      ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.anisotropy = Math.min(4, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a subtle photography cyclorama floor texture with clean studio radial lighting,
 * understated turntable ring & delicate cardinal cues, keeping the subject silhouette prominent.
 */
function createStudioFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const bgGrad = ctx.createRadialGradient(cx, cy, size * 0.03, cx, cy, size * 0.56);
  bgGrad.addColorStop(0, '#363d4d');
  bgGrad.addColorStop(0.32, '#272d3a');
  bgGrad.addColorStop(0.68, '#1b202b');
  bgGrad.addColorStop(1, '#121620');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // Subtle architectural tile grid (1m increments across 16m × 16m floor)
  const pxPerMeter = size / 16;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  ctx.lineWidth = 1.1;
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

  // Signature subtle studio turntable ring (0.9m radius) & 2m/3m camera orbit tracks
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.arc(cx, cy, 0.9 * pxPerMeter, 0, Math.PI * 2);
  ctx.stroke();

  // Inner faint quarter lines inside studio disc
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.1)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 0.85 * pxPerMeter, cy);
  ctx.lineTo(cx + 0.85 * pxPerMeter, cy);
  ctx.moveTo(cx, cy - 0.85 * pxPerMeter);
  ctx.lineTo(cx, cy + 0.85 * pxPerMeter);
  ctx.stroke();

  for (const rMeters of [2, 3, 4]) {
    ctx.strokeStyle =
      rMeters === 2 ? 'rgba(34, 211, 238, 0.26)' : 'rgba(148, 163, 184, 0.13)';
    ctx.lineWidth = rMeters === 2 ? 1.8 : 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, rMeters * pxPerMeter, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(203, 213, 225, 0.52)';
    ctx.font = '600 15px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${rMeters}m`, cx, cy + rMeters * pxPerMeter - 7);
  }

  // Cardinal camera orientation labels (+Z front)
  ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = 'rgba(34, 211, 238, 0.78)';
  ctx.fillText('FRONT (0°)', cx, cy + 4.45 * pxPerMeter);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.52)';
  ctx.fillText('BACK (±180°)', cx, cy - 4.35 * pxPerMeter);
  ctx.fillText('CAM-RIGHT (+90°)', cx + 4.45 * pxPerMeter, cy + 5);
  ctx.fillText('CAM-LEFT (-90°)', cx - 4.45 * pxPerMeter, cy + 5);

  // Subtle facing chevron on floor pointing +Z
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.72)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy + 0.62 * pxPerMeter);
  ctx.lineTo(cx, cy + 0.84 * pxPerMeter);
  ctx.lineTo(cx + 14, cy + 0.62 * pxPerMeter);
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
  grad.addColorStop(0.54, 'rgba(0, 0, 0, 0.28)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds an anatomically proportioned studio figure anchored at world origin (0, 0, 0)
 * facing +Z, matching FIXED_SUBJECT_LANDMARKS (total standing height 1.72m, eyes at y=1.58, z=0.08).
 * Styled with an olive field jacket over a clean white crew-neck tee, dark indigo denim, and white sneakers.
 */
function buildFixedReferenceSubject(
  maxAnisotropy: number,
  trackDisposable: <T extends { dispose: () => void }>(item: T) => T
): THREE.Group {
  const subject = new THREE.Group();
  subject.name = 'FixedReferenceSubject';

  const weaveTex = trackDisposable(createFabricWeaveTexture(maxAnisotropy));

  const skinMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xdfb9a0,
      roughness: 0.56,
      metalness: 0.01,
    })
  );

  const lipMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xc28a7b,
      roughness: 0.48,
      metalness: 0.02,
    })
  );

  const hairMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x241c19,
      roughness: 0.44,
      metalness: 0.06,
    })
  );

  const shirtMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xe6e8ee,
      roughness: 0.82,
      metalness: 0.01,
      bumpMap: weaveTex,
      bumpScale: 0.002,
    })
  );

  const jacketMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x55603e,
      roughness: 0.78,
      metalness: 0.04,
      bumpMap: weaveTex,
      bumpScale: 0.0045,
    })
  );

  const denimMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x1b2338,
      roughness: 0.84,
      metalness: 0.03,
      bumpMap: weaveTex,
      bumpScale: 0.004,
    })
  );

  const beltLeatherMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x191518,
      roughness: 0.36,
      metalness: 0.1,
    })
  );

  const snapMetalMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xc9b489,
      roughness: 0.28,
      metalness: 0.82,
    })
  );

  const shoeUpperMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xe8eaef,
      roughness: 0.52,
      metalness: 0.04,
    })
  );

  const shoeSoleMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xd0d4dc,
      roughness: 0.86,
      metalness: 0.02,
    })
  );

  const scleraMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xf6f7f9,
      roughness: 0.28,
      metalness: 0.0,
    })
  );

  const irisMat = trackDisposable(
    new THREE.MeshPhysicalMaterial({
      color: 0x2a2420,
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

  const buildLimbLathe = (
    profile: Array<[number, number]>,
    radialSegments = 22
  ): THREE.LatheGeometry => {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(pts, radialSegments);
    geo.computeVertexNormals();
    return geo;
  };

  // 1. Clean Off-White Studio Court Sneakers (flush at y = 0.0, pointing +Z)
  for (const side of [-1, 1]) {
    const x = side * 0.105;
    const soleGeo = new THREE.BoxGeometry(0.098, 0.022, 0.245);
    addPart(soleGeo, shoeSoleMat, [x, 0.011, 0.036]);

    const upperShape = new THREE.Shape();
    upperShape.moveTo(-0.044, -0.105);
    upperShape.lineTo(0.044, -0.105);
    upperShape.quadraticCurveTo(0.048, 0.02, 0.04, 0.11);
    upperShape.quadraticCurveTo(0, 0.135, -0.04, 0.11);
    upperShape.quadraticCurveTo(-0.048, 0.02, -0.044, -0.105);
    const upperGeo = new THREE.ExtrudeGeometry(upperShape, {
      depth: 0.046,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.006,
      bevelSegments: 2,
    });
    upperGeo.rotateX(Math.PI / 2);
    upperGeo.computeVertexNormals();
    addPart(upperGeo, shoeUpperMat, [x, 0.068, 0.038]);

    // Lace tongue strip (+Z forward cue)
    addPart(
      new THREE.BoxGeometry(0.032, 0.012, 0.052),
      shoeSoleMat,
      [x, 0.078, 0.072],
      [0.22, 0, 0]
    );
  }

  // 2. Dark Indigo Denim Jeans (calves, knees, thighs, y = 0.068 -> 0.92)
  const calfGeo = buildLimbLathe([
    [0.048, 0.0],
    [0.051, 0.06],
    [0.063, 0.22],
    [0.058, 0.36],
    [0.056, 0.4],
  ]);
  const thighGeo = buildLimbLathe([
    [0.057, 0.0],
    [0.071, 0.14],
    [0.081, 0.3],
    [0.078, 0.4],
  ]);

  for (const side of [-1, 1]) {
    const x = side * 0.105;
    addPart(calfGeo.clone(), denimMat, [x, 0.068, -0.004]);
    addPart(new THREE.SphereGeometry(0.057, 18, 12), denimMat, [x, 0.48, 0.008]);
    addPart(thighGeo.clone(), denimMat, [x, 0.49, 0.0]);
  }
  calfGeo.dispose();
  thighGeo.dispose();

  // Pelvis & Belt
  addPart(
    new THREE.CapsuleGeometry(0.135, 0.14, 10, 18),
    denimMat,
    [0, 0.9, 0],
    [0, 0, Math.PI / 2],
    [1, 1, 0.72]
  );
  addPart(
    new THREE.CylinderGeometry(0.148, 0.15, 0.036, 22),
    beltLeatherMat,
    [0, 0.975, 0],
    [0, 0, 0],
    [1, 1, 0.72]
  );
  addPart(new THREE.BoxGeometry(0.048, 0.042, 0.016), snapMetalMat, [0, 0.975, 0.107]);

  // 3. Layered White Crew-Neck Tee + Open Olive Utility Jacket (y = 0.98..1.43)
  const torsoLathe = buildLimbLathe(
    [
      [0.136, 0.0],
      [0.144, 0.1],
      [0.168, 0.26],
      [0.178, 0.38],
      [0.135, 0.43],
      [0.062, 0.455],
    ],
    24
  );
  addPart(torsoLathe, shirtMat, [0, 0.985, 0], [0, 0, 0], [1.05, 1, 0.68]);

  // Open olive overshirt jacket shell wrapping back & sides, open down front chest (+Z)
  const jacketShell = new THREE.CylinderGeometry(
    0.188,
    0.155,
    0.45,
    24,
    1,
    false,
    Math.PI * 0.15,
    Math.PI * 1.7
  );
  jacketShell.rotateY(Math.PI);
  jacketShell.scale(1.07, 1, 0.73);
  jacketShell.computeVertexNormals();
  addPart(jacketShell, jacketMat, [0, 1.195, -0.003]);

  // Jacket Collar + Front Panels + Twin Buttoned Utility Chest Pockets (+Z)
  addPart(
    new THREE.CylinderGeometry(0.088, 0.105, 0.05, 18, 1, false, Math.PI * 0.22, Math.PI * 1.56),
    jacketMat,
    [0, 1.415, -0.006],
    [0, Math.PI, 0],
    [1.06, 1, 0.85]
  );

  for (const side of [-1, 1]) {
    // Front jacket panel with subtle fold
    const panelShape = new THREE.Shape();
    panelShape.moveTo(0, 0);
    panelShape.lineTo(side * 0.068, 0);
    panelShape.lineTo(side * 0.084, 0.22);
    panelShape.lineTo(side * 0.068, 0.38);
    panelShape.lineTo(side * 0.02, 0.39);
    panelShape.lineTo(0, 0.24);
    panelShape.closePath();

    const panelGeo = new THREE.ExtrudeGeometry(panelShape, {
      depth: 0.018,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 2,
    });
    panelGeo.computeVertexNormals();
    addPart(panelGeo, jacketMat, [side * 0.028, 1.0, 0.104], [0, side * -0.16, 0]);

    // Utility chest flap pocket
    addPart(
      new THREE.BoxGeometry(0.052, 0.062, 0.014),
      jacketMat,
      [side * 0.082, 1.245, 0.118],
      [0, side * -0.18, 0]
    );
    addPart(
      new THREE.CylinderGeometry(0.006, 0.006, 0.008, 10),
      snapMetalMat,
      [side * 0.082, 1.262, 0.126],
      [Math.PI / 2, 0, 0]
    );
  }

  // Rear jacket shoulder yoke seam (-Z)
  addPart(new THREE.BoxGeometry(0.29, 0.012, 0.014), jacketMat, [0, 1.33, -0.128]);

  // 4. Articulated Jacket Sleeves, Cuffs, Forearms & Natural Hands
  const upperArmGeo = buildLimbLathe([
    [0.048, 0.0],
    [0.056, 0.12],
    [0.059, 0.24],
    [0.052, 0.27],
  ]);
  const sleeveForearmGeo = buildLimbLathe([
    [0.04, 0.0],
    [0.045, 0.12],
    [0.05, 0.24],
  ]);

  for (const side of [-1, 1]) {
    addPart(
      new THREE.SphereGeometry(0.068, 16, 14),
      jacketMat,
      [side * 0.206, 1.385, 0],
      [0, 0, 0],
      [1, 0.9, 0.92]
    );
    addPart(upperArmGeo.clone(), jacketMat, [side * 0.224, 1.135, 0], [0, 0, side * 0.07]);
    // Full jacket sleeve extending to wrist cuff
    addPart(
      sleeveForearmGeo.clone(),
      jacketMat,
      [side * 0.242, 0.895, 0.032],
      [0.14, 0, side * -0.02]
    );
    // Natural hand & fingers
    addPart(
      new THREE.BoxGeometry(0.031, 0.092, 0.055),
      skinMat,
      [side * 0.246, 0.822, 0.055],
      [0.12, 0, 0]
    );
    addPart(
      new THREE.CapsuleGeometry(0.009, 0.03, 4, 8),
      skinMat,
      [side * 0.232, 0.84, 0.082],
      [0.4, 0, side * -0.22]
    );
  }
  upperArmGeo.dispose();
  sleeveForearmGeo.dispose();

  // 5. Neck & Anatomically Sculpted Head (eyes at y = 1.58, z = 0.08; crown y = 1.72)
  addPart(new THREE.CylinderGeometry(0.045, 0.055, 0.115, 18), skinMat, [0, 1.455, 0.005]);

  // Cranium + sculpted jawline
  addPart(
    new THREE.SphereGeometry(0.102, 24, 20),
    skinMat,
    [0, 1.604, -0.005],
    [0, 0, 0],
    [0.91, 1.08, 1.0]
  );
  addPart(
    new THREE.SphereGeometry(0.076, 20, 16),
    skinMat,
    [0, 1.532, 0.02],
    [0.18, 0, 0],
    [0.9, 0.95, 1.02]
  );

  // Subtle nose bridge, brow & lips on +Z face
  addPart(new THREE.BoxGeometry(0.104, 0.013, 0.026), skinMat, [0, 1.602, 0.082]);
  addPart(
    new THREE.CapsuleGeometry(0.0085, 0.026, 4, 8),
    skinMat,
    [0, 1.565, 0.098],
    [-0.22, 0, 0]
  );
  addPart(new THREE.BoxGeometry(0.036, 0.009, 0.015), lipMat, [0, 1.525, 0.094]);

  // Eyes (sclera + clearcoated iris at y = 1.58, z = 0.086)
  for (const side of [-1, 1]) {
    addPart(
      new THREE.SphereGeometry(0.0135, 12, 10),
      scleraMat,
      [side * 0.033, 1.582, 0.084],
      [0, 0, 0],
      [1.15, 0.78, 0.7]
    );
    addPart(
      new THREE.SphereGeometry(0.008, 12, 10),
      irisMat,
      [side * 0.033, 1.582, 0.093],
      [0, 0, 0],
      [1, 1, 0.6]
    );
    addPart(
      new THREE.BoxGeometry(0.034, 0.007, 0.01),
      hairMat,
      [side * 0.034, 1.603, 0.092],
      [0, 0, side * -0.05]
    );
  }

  // Ears (±X)
  for (const side of [-1, 1]) {
    addPart(
      new THREE.SphereGeometry(0.019, 12, 10),
      skinMat,
      [side * 0.094, 1.574, -0.006],
      [0, 0, 0],
      [0.42, 1.25, 0.75]
    );
  }

  // Layered Swept Hair Crown up to y = 1.72
  addPart(
    new THREE.SphereGeometry(0.107, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hairMat,
    [0, 1.616, -0.015],
    [-0.36, 0, 0],
    [0.94, 1.0, 1.03]
  );
  addPart(
    new THREE.CapsuleGeometry(0.036, 0.092, 6, 12),
    hairMat,
    [0.01, 1.676, 0.038],
    [0.2, 0, 1.44],
    [0.74, 1.0, 0.84]
  );

  // Anchor rigidly at world origin (0, 0, 0)
  subject.position.set(0, 0, 0);
  subject.rotation.set(0, 0, 0);
  subject.scale.set(1, 1, 1);

  return subject;
}

/**
 * Builds a realistic photography studio softbox light stand for directional framing cues.
 */
function buildStudioSoftboxStand(
  x: number,
  z: number,
  aimX: number,
  aimY: number,
  aimZ: number,
  metalMat: THREE.Material,
  scrimMat: THREE.Material,
  housingMat: THREE.Material,
  trackDisposable: <T extends { dispose: () => void }>(item: T) => T
): THREE.Group {
  const stand = new THREE.Group();
  stand.position.set(x, 0, z);

  // Center telescopic column
  const pole = new THREE.Mesh(
    trackDisposable(new THREE.CylinderGeometry(0.016, 0.02, 1.55, 10)),
    metalMat
  );
  pole.position.y = 0.78;
  pole.castShadow = true;
  stand.add(pole);

  // 3 Tripod legs
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3 + 0.35;
    const leg = new THREE.Mesh(
      trackDisposable(new THREE.CylinderGeometry(0.011, 0.009, 0.62, 8)),
      metalMat
    );
    leg.position.set(Math.sin(angle) * 0.22, 0.16, Math.cos(angle) * 0.22);
    leg.rotation.set(-Math.cos(angle) * 0.75, 0, Math.sin(angle) * 0.75);
    stand.add(leg);
  }

  // Softbox head aimed cleanly at subject torso
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.62, 0);
  headGroup.lookAt(aimX, aimY, aimZ);

  const housing = new THREE.Mesh(
    trackDisposable(new THREE.BoxGeometry(0.68, 0.88, 0.28)),
    housingMat
  );
  housing.position.z = -0.14;
  headGroup.add(housing);

  const scrim = new THREE.Mesh(
    trackDisposable(new THREE.PlaneGeometry(0.62, 0.82)),
    scrimMat
  );
  scrim.position.z = 0.005;
  headGroup.add(scrim);

  stand.add(headGroup);
  return stand;
}

/**
 * Builds the calibrated neutral studio cyclorama stage + twin studio softbox diffuser stands.
 */
function buildFixedStudioRoom(
  maxAnisotropy: number,
  trackDisposable: <T extends { dispose: () => void }>(item: T) => T
): THREE.Group {
  const room = new THREE.Group();
  room.name = 'FixedStudioRoom';

  const floorTex = trackDisposable(createStudioFloorTexture(maxAnisotropy));
  const floorGeo = trackDisposable(new THREE.PlaneGeometry(16, 16));
  const floorMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.74,
      metalness: 0.06,
    })
  );
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  room.add(floor);

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

  const matteMetalMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x1e2430,
      roughness: 0.42,
      metalness: 0.68,
    })
  );

  const softboxHousingMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x161a24,
      roughness: 0.72,
      metalness: 0.18,
    })
  );

  const softboxScrimMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0xf8fbff,
      emissive: 0xe6f2ff,
      emissiveIntensity: 1.1,
      roughness: 0.35,
      metalness: 0.0,
    })
  );

  // Seamless curved studio cyclorama backdrop behind max orbit distance (z = -9.1)
  const cycWallGeo = trackDisposable(
    new THREE.CylinderGeometry(9.2, 9.2, 5.4, 36, 1, true, Math.PI * 0.72, Math.PI * 0.56)
  );
  const cycWallMat = trackDisposable(
    new THREE.MeshStandardMaterial({
      color: 0x262c38,
      roughness: 0.88,
      metalness: 0.03,
      side: THREE.BackSide,
    })
  );
  const cycWall = new THREE.Mesh(cycWallGeo, cycWallMat);
  cycWall.position.set(0, 2.7, 0);
  cycWall.receiveShadow = true;
  room.add(cycWall);

  // Twin Photography Softboxes framing left & right background studio corners
  const leftSoftbox = buildStudioSoftboxStand(
    -2.55,
    -2.2,
    0,
    1.15,
    0,
    matteMetalMat,
    softboxScrimMat,
    softboxHousingMat,
    trackDisposable
  );
  room.add(leftSoftbox);

  const rightSoftbox = buildStudioSoftboxStand(
    2.55,
    -2.2,
    0,
    1.15,
    0,
    matteMetalMat,
    softboxScrimMat,
    softboxHousingMat,
    trackDisposable
  );
  room.add(rightSoftbox);

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
  scene.background = new THREE.Color(0x1f242f);
  scene.fog = new THREE.FogExp2(0x1f242f, 0.032);

  // Studio environment reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  disposables.push(envTex);
  pmrem.dispose();

  // Balanced 3-point studio lighting rig
  const hemi = new THREE.HemisphereLight(0xe4ecff, 0x2a2f3a, 1.05);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff5e8, 2.15);
  keyLight.position.set(3.0, 5.2, 3.8);
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

  const rimLight = new THREE.DirectionalLight(0xa5d8ff, 0.95);
  rimLight.position.set(-3.4, 3.5, -3.6);
  scene.add(rimLight);

  if (!isSoftwareGl) {
    RectAreaLightUniformsLib.init();
    const fillPanel = new THREE.RectAreaLight(0xeaf2ff, 1.9, 2.4, 2.6);
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
