/**
 * Racing-Inspired 3D Spline Circuit & Multi-Level Skyway Builder
 * ==============================================================
 *
 * Inspired by Gran Turismo's Tokyo Expressway (Central Loop) & Grand Valley Highway:
 *   1. Flowing Urban Grand Prix Loop (`groundLoop`, ~960m closed 3D Catmull-Rom circuit)
 *      with banked high-speed sweepers, technical S-curves, FIA red/white apex kerbs,
 *      and wide granite cobblestone sidewalks.
 *   2. Effortless Y-Fork Multi-Level Skyway Interchange (`skywayLoop`, ~740m elevated
 *      viaduct rising smoothly from Grand Boulevard to Y = 11.5m and Y = 17.6m across
 *      a cable-stayed flyover before sweeping back to merge onto the main straightaway).
 *   3. Fast 2D Spatial Hash Grid (`16m x 16m` cells) for exact <0.03ms multi-deck
 *      elevation, slope, banking, and C1-smooth barrier collision queries.
 */

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Samples a 3D Catmull-Rom curve into dense frames with analytical tangents,
 * horizontal normals, curvature, and smooth banking (superelevation).
 */
function sampleRibbonFrames(curve, stepMeters = 1.25, isClosed = false, bankScale = 1.0, widthFn = null) {
  const totalLen = curve.getLength();
  const count = Math.max(32, Math.round(totalLen / stepMeters));
  const frames = [];

  for (let i = 0; i <= count; i++) {
    const u = (isClosed && i === count) ? 0.0 : i / count;
    const pos = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();

    // Horizontal right vector: tan x UP -> for tan=(0,0,-1), right=(1,0,0) (+X East)
    const right = new THREE.Vector3().crossVectors(tan, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();

    // Estimate signed horizontal curvature for realistic corner superelevation (banking)
    const du = 0.006;
    const uPrev = isClosed ? (u - du + 1.0) % 1.0 : Math.max(0.0, u - du);
    const uNext = isClosed ? (u + du) % 1.0 : Math.min(1.0, u + du);
    const tPrev = curve.getTangentAt(uPrev);
    const tNext = curve.getTangentAt(uNext);
    const dTan = new THREE.Vector3().subVectors(tNext, tPrev);
    const ds = Math.max(0.5, (uNext - uPrev + (uNext < uPrev ? 1.0 : 0.0)) * totalLen);
    const signedCurv = dTan.dot(right) / ds; // > 0 when turning right

    // Bank inward into fast corners (clamped to gentle realistic 4.5 deg max, zero on straightaways)
    const rawBank = THREE.MathUtils.clamp(signedCurv * 3.2 * bankScale, -0.078, 0.078);
    // Taper banking smoothly to 0 near open spline endpoints (smooth merge!)
    const endFade = isClosed
      ? 1.0
      : Math.min(1.0, Math.min(u * totalLen, (1.0 - u) * totalLen) / 28.0);
    const bank = rawBank * endFade;

    const bankedRight = right.clone().applyAxisAngle(tan, bank).normalize();
    const bankedUp = new THREE.Vector3().crossVectors(bankedRight, tan).normalize();

    const s = (i / count) * totalLen;
    const wInfo = widthFn ? widthFn(s, totalLen, pos) : { leftW: 8.0, rightW: 8.0 };

    frames.push({
      u,
      s,
      pos,
      tan,
      right,
      bankedRight,
      bankedUp,
      bank,
      signedCurv,
      leftW: wInfo.leftW,
      rightW: wInfo.rightW,
    });
  }

  return { frames, totalLen, isClosed };
}

/**
 * Builds a subdivided 3D strip BufferGeometry across lateral profile points `[latOffset, yOffset, uTex]`
 * so straight lines & lanes have dense vertices along `s` (`~1.25m`) AND across width (`<= 2.2m`)
 * for silky-smooth relativistic aberration curves!
 */
function buildProfileStripGeometry(frames, profilePts, vTexScale = 0.08) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const cols = profilePts.length;
  const rows = frames.length;

  for (let r = 0; r < rows; r++) {
    const f = frames[r];
    for (let c = 0; c < cols; c++) {
      const [lat, yOff, uCoord, nxLocal = 0, nyLocal = 1] = profilePts[c];
      const vx = f.pos.x + f.bankedRight.x * lat + f.bankedUp.x * yOff;
      const vy = f.pos.y + f.bankedRight.y * lat + f.bankedUp.y * yOff;
      const vz = f.pos.z + f.bankedRight.z * lat + f.bankedUp.z * yOff;
      positions.push(vx, vy, vz);

      const nrm = new THREE.Vector3()
        .addScaledVector(f.bankedRight, nxLocal)
        .addScaledVector(f.bankedUp, nyLocal)
        .normalize();
      normals.push(nrm.x, nrm.y, nrm.z);
      uvs.push(uCoord, f.s * vTexScale);
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices.push(a, b, d, b, e, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('uv1', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

export function createTrackSystem(materials, shaderSystem) {
  const group = new THREE.Group();
  group.name = 'RacingCircuitAndSkyway';

  // 1. Expanded High-Speed Urban Grand Prix Loop (~1,520m Closed 3D Catmull-Rom)
  //    Features a 350m unbroken Grand Boulevard Main Straightaway (Z = +222 -> -132)
  //    and a 310m East Skyline Back Straight + wide sweeping F1-radius curves!
  const groundPts = [
    new THREE.Vector3(0.0, 0.0, 222.0),    // South Straightaway start
    new THREE.Vector3(0.0, 0.0, 158.0),    // Starting Grid & Spawn Straight (facing -Z!)
    new THREE.Vector3(0.0, 0.0, 94.0),     // Start / Finish Gantry
    new THREE.Vector3(0.0, 0.0, 44.0),     // Y-Fork Skyway Interchange
    new THREE.Vector3(0.0, 0.0, -18.0),    // Grand Limestone Triumphal Arch
    new THREE.Vector3(0.0, 0.0, -78.0),    // Passing Clock Plaza & Bullet Train Viaduct
    new THREE.Vector3(0.0, 0.0, -132.0),   // End of 350m High-Speed Boulevard Straight!
    new THREE.Vector3(38.0, 0.2, -198.0),  // Turn 1 Wide Sweeper Entry
    new THREE.Vector3(114.0, 0.6, -228.0), // Turn 2 North High-Speed Apex
    new THREE.Vector3(190.0, 1.4, -182.0), // Turn 3 Skyline Sweeper
    new THREE.Vector3(218.0, 2.2, -98.0),  // East Skyline Back Straight North
    new THREE.Vector3(204.0, 1.4, 8.0),    // Gentle High-Speed S-Bend
    new THREE.Vector3(218.0, 0.6, 114.0),  // East Skyline Back Straight South
    new THREE.Vector3(186.0, 0.0, 204.0),  // South Sweeper Entry
    new THREE.Vector3(108.0, 0.0, 256.0),  // Banked South Return Curve
    new THREE.Vector3(24.0, 0.0, 246.0),   // Final Sweeper Alignment onto Main Straight
  ];
  const groundCurve = new THREE.CatmullRomCurve3(groundPts, true, 'centripetal', 0.45);

  // 2. Expanded Multi-Level Elevated Skyway Expressway (~980m Viaduct & Cable-Stayed Flyover)
  const skywayPts = [
    new THREE.Vector3(4.6, 0.01, 68.0),     // Seamless start in right lane of Grand Boulevard
    new THREE.Vector3(8.2, 0.04, 44.0),     // Effortless ~8 deg Y-fork split!
    new THREE.Vector3(16.2, 2.10, 12.0),    // Smooth 5.5 deg ascent past gore chevrons
    new THREE.Vector3(24.5, 7.60, -26.0),   // Viaduct climb east of Triumphal Arch
    new THREE.Vector3(25.0, 14.80, -74.0),  // Level 2 Panorama Viaduct (clears Y=6.8m Bullet Train!)
    new THREE.Vector3(-12.0, 16.80, -132.0),// High North Flyover
    new THREE.Vector3(-48.0, 17.60, -70.0), // Level 3 Cable-Stayed High Bridge (17.6m!)
    new THREE.Vector3(-34.0, 15.10, 14.0),  // West Skyline Overlook
    new THREE.Vector3(38.0, 12.80, 56.0),   // Soaring Crossover HIGH OVER Grand Boulevard!
    new THREE.Vector3(114.0, 9.20, 108.0),  // Wide Infield Sweeping Viaduct
    new THREE.Vector3(106.0, 4.80, 178.0),  // Scenic Curved Descent Ramp
    new THREE.Vector3(46.0, 1.25, 214.0),   // Smooth Merge Approach
    new THREE.Vector3(8.5, 0.05, 198.0),    // Forward Merge into Grand Boulevard right lane
    new THREE.Vector3(4.6, 0.01, 172.0),    // Aligned -Z on South Boulevard Straightaway!
  ];
  const skywayCurve = new THREE.CatmullRomCurve3(skywayPts, false, 'centripetal', 0.45);

  const groundData = sampleRibbonFrames(groundCurve, 1.25, true, 1.0);
  const skywayData = sampleRibbonFrames(skywayCurve, 1.20, false, 1.15);

  // --- Build Ground Grand Prix Road Mesh (16.0m wide, 9 lateral vertices for smooth aberration!) ---
  const roadProfile = [];
  const roadHalfW = 8.0;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const lat = -roadHalfW + t * (2.0 * roadHalfW);
    const crown = 0.04 * (1.0 - Math.pow((lat / roadHalfW), 2)); // subtle drainage crown
    roadProfile.push([lat, 0.01 + crown, t, 0, 1]);
  }
  const groundRoadMesh = new THREE.Mesh(
    buildProfileStripGeometry(groundData.frames, roadProfile, 0.055),
    materials.roadAsphalt
  );
  groundRoadMesh.receiveShadow = true;
  groundRoadMesh.frustumCulled = false;
  group.add(groundRoadMesh);

  // --- Build Raised Granite Cobblestone Sidewalks & Curbs along Ground Loop ---
  // Note: On the right side at the Y-Fork Interchange (Z in [12..68]) and Merge (Z in [114..150]),
  // we drop the right curb flush to y=0.01 so cars glide seamlessly between Boulevard and Skyway!
  const buildSidewalkSide = (sideSign) => {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const frames = groundData.frames;
    const cols = 6;

    for (let r = 0; r < frames.length; r++) {
      const f = frames[r];
      const z = f.pos.z;
      const x = f.pos.x;
      let curbH = 0.15;

      // Flush curb at Skyway On-Ramp Y-Fork & Off-Ramp Merge on East (+1) side of main straight
      if (sideSign > 0 && Math.abs(x) < 12.0) {
        if ((z >= 8.0 && z <= 72.0) || (z >= 166.0 && z <= 212.0)) {
          curbH = 0.005;
        }
      }
      // Flush / gentle curb at Clock Tower Plaza West (-1) entrance (Z in [-60..-18])
      if (sideSign < 0 && Math.abs(x) < 10.0 && z >= -60.0 && z <= -18.0) {
        curbH = 0.04;
      }

      const lats = sideSign > 0
        ? [8.0, 8.12, 10.2, 12.4, 12.62, 15.8]
        : [-15.8, -12.62, -12.4, -10.2, -8.12, -8.0];
      const ys = sideSign > 0
        ? [0.01, curbH, curbH + 0.02, curbH + 0.03, curbH - 0.05, -2.55]
        : [-2.55, curbH - 0.05, curbH + 0.03, curbH + 0.02, curbH, 0.01];
      const us = sideSign > 0
        ? [0.0, 0.08, 0.54, 1.0, 1.06, 1.85]
        : [1.85, 1.06, 1.0, 0.54, 0.08, 0.0];

      for (let c = 0; c < cols; c++) {
        const lat = lats[c];
        const yOff = ys[c];
        const isSlope = (sideSign > 0 && c >= 4) || (sideSign < 0 && c <= 1);
        const nxL = isSlope ? (sideSign * 0.65) : 0.0;
        const nyL = isSlope ? 0.76 : 1.0;
        positions.push(
          f.pos.x + f.bankedRight.x * lat + f.bankedUp.x * yOff,
          f.pos.y + f.bankedRight.y * lat + f.bankedUp.y * yOff,
          f.pos.z + f.bankedRight.z * lat + f.bankedUp.z * yOff
        );
        normals.push(
          f.bankedRight.x * nxL + f.bankedUp.x * nyL,
          f.bankedRight.y * nxL + f.bankedUp.y * nyL,
          f.bankedRight.z * nxL + f.bankedUp.z * nyL
        );
        uvs.push(us[c], f.s * 0.16);
      }
    }

    for (let r = 0; r < frames.length - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('uv1', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    const mesh = new THREE.Mesh(geom, materials.sidewalkCobble);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  buildSidewalkSide(1);
  buildSidewalkSide(-1);

  // --- Build FIA Red-and-White Racing Apex Kerbs on High-Curvature Corners ---
  const addCornerKerbs = () => {
    const frames = groundData.frames;
    let segStart = -1;
    let curSide = 0;

    const flushKerb = (i0, i1, side) => {
      if (i1 - i0 < 5) return;
      const sub = frames.slice(i0, i1 + 1);
      const inner = side > 0 ? 7.45 : -8.35;
      const outer = side > 0 ? 8.35 : -7.45;
      const prof = [
        [inner, 0.02, 0.0, 0, 1],
        [(inner + outer) * 0.5, 0.07, 0.5, 0, 1],
        [outer, 0.03, 1.0, 0, 1],
      ];
      const m = new THREE.Mesh(buildProfileStripGeometry(sub, prof, 0.38), materials.racingKerb);
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    };

    for (let i = 0; i < frames.length; i++) {
      const k = frames[i].signedCurv;
      const side = Math.abs(k) > 0.0085 ? Math.sign(k) : 0;
      if (side !== curSide) {
        if (curSide !== 0 && segStart >= 0) flushKerb(segStart, i - 1, curSide);
        segStart = side !== 0 ? i : -1;
        curSide = side;
      }
    }
    if (curSide !== 0 && segStart >= 0) flushKerb(segStart, frames.length - 1, curSide);
  };
  addCornerKerbs();

  // --- Build Painted Y-Fork Highway Gore Chevron Apron (Z = 22..54, X = 7.6..12.8) ---
  {
    const goreGeo = new THREE.PlaneGeometry(5.2, 28.0, 6, 24);
    goreGeo.rotateX(-Math.PI * 0.5);
    goreGeo.rotateY(-0.11);
    goreGeo.translate(9.6, 0.028, 36.0);
    goreGeo.setAttribute('uv1', goreGeo.getAttribute('uv'));
    const goreMesh = new THREE.Mesh(goreGeo, materials.highwayGore);
    goreMesh.receiveShadow = true;
    goreMesh.frustumCulled = false;
    group.add(goreMesh);
  }

  // --- Build Multi-Level Elevated Skyway Deck (12.4m Asphalt + Concrete Box Girder + Twin Jersey Barriers) ---
  const skyHalfW = 6.2;
  const skyAsphaltProf = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const lat = -skyHalfW + t * (2.0 * skyHalfW);
    skyAsphaltProf.push([lat, 0.03, t, 0, 1]);
  }
  const skyRoadMesh = new THREE.Mesh(
    buildProfileStripGeometry(skywayData.frames, skyAsphaltProf, 0.065),
    materials.highwayRoad
  );
  skyRoadMesh.receiveShadow = true;
  skyRoadMesh.castShadow = true;
  skyRoadMesh.frustumCulled = false;
  group.add(skyRoadMesh);

  // Concrete Box-Girder Underside & Twin Concrete Jersey Barriers (tapered smoothly at ground ends!)
  const buildSkywayStructure = () => {
    const frames = skywayData.frames;
    const totalS = skywayData.totalLen;

    // Filter frames so inner left barrier starts cleanly after the Y-fork gore split (s in [50 .. totalS - 50])
    const leftBarrierFrames = frames.filter((f) => f.s >= 50.0 && f.s <= totalS - 50.0);
    const rightBarrierFrames = frames.filter((f) => f.s >= 26.0 && f.s <= totalS - 26.0);

    // Left Jersey Barrier
    const leftBarrierProf = [
      [-6.85, -0.35, 0.0, -1, 0],
      [-6.85, 0.96, 0.25, -0.3, 0.95],
      [-6.35, 0.96, 0.50, 0.3, 0.95],
      [-6.12, 0.28, 0.78, 0.85, 0.5],
      [-6.05, 0.02, 1.0, 0.7, 0.7],
    ];
    // Right Jersey Barrier
    const rightBarrierProf = [
      [6.05, 0.02, 0.0, -0.7, 0.7],
      [6.12, 0.28, 0.22, -0.85, 0.5],
      [6.35, 0.96, 0.50, -0.3, 0.95],
      [6.85, 0.96, 0.75, 0.3, 0.95],
      [6.85, -0.35, 1.0, 1, 0],
    ];
    // Underside Box-Girder Spine (ordered +X -> -X so outward normals face downward -Y!)
    const girderFrames = frames.filter((f) => f.s >= 32.0 && f.s <= totalS - 32.0);
    const girderProf = [
      [6.85, -0.02, 0.0, 1, 0],
      [6.85, -0.48, 0.15, 0.6, -0.8],
      [4.20, -1.35, 0.35, 0.3, -0.95],
      [0.0, -1.42, 0.50, 0, -1],
      [-4.20, -1.35, 0.65, -0.3, -0.95],
      [-6.85, -0.48, 0.85, -0.6, -0.8],
      [-6.85, -0.02, 1.0, -1, 0],
    ];

    for (const [subFrames, prof] of [
      [leftBarrierFrames, leftBarrierProf],
      [rightBarrierFrames, rightBarrierProf],
      [girderFrames, girderProf],
    ]) {
      const m = new THREE.Mesh(
        buildProfileStripGeometry(subFrames, prof, 0.09),
        materials.highwayConcrete
      );
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    }
  };
  buildSkywayStructure();

  // --- Build Finely-Subdivided Zebra Crosswalks & Start-Line Road Markings (28x12 grid for texture warping!) ---
  {
    for (const [cz, lengthZ] of [
      [94.0, 5.2],
      [18.0, 4.6],
      [-48.0, 4.6],
    ]) {
      const cwGeo = new THREE.PlaneGeometry(15.2, lengthZ, 30, 12);
      cwGeo.rotateX(-Math.PI * 0.5);
      cwGeo.translate(0.0, 0.058, cz);
      cwGeo.setAttribute('uv1', cwGeo.getAttribute('uv'));
      const cwMesh = new THREE.Mesh(cwGeo, materials.roadCrosswalk);
      cwMesh.receiveShadow = true;
      cwMesh.frustumCulled = false;
      group.add(cwMesh);
    }
  }

  // --- Scenic Infield Reflecting Lagoons & Sand Traps (natural off-road shortcut hazards!) ---
  const lagoons = [
    { cx: 122.0, cz: -58.0, waterRX: 21.0, waterRZ: 28.0, sandRX: 27.5, sandRZ: 34.5 },
    { cx: 146.0, cz: 132.0, waterRX: 18.0, waterRZ: 23.0, sandRX: 24.0, sandRZ: 29.0 },
  ];

  // --- Spatial Hash Grid (`16m x 16m`) for Fast Exact Surface, Solid Obstacle & Skyway Barrier Queries ---
  const CELL_SIZE = 16.0;
  const grid = new Map();
  const solidGrid = new Map();
  const segments = [];

  const cellKey = (cx, cz) => `${cx},${cz}`;

  const insertSolidItem = (item, minX, maxX, minZ, maxZ) => {
    const c0x = Math.floor((minX - 1.5) / CELL_SIZE);
    const c1x = Math.floor((maxX + 1.5) / CELL_SIZE);
    const c0z = Math.floor((minZ - 1.5) / CELL_SIZE);
    const c1z = Math.floor((maxZ + 1.5) / CELL_SIZE);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const k = cellKey(cx, cz);
        let list = solidGrid.get(k);
        if (!list) {
          list = [];
          solidGrid.set(k, list);
        }
        list.push(item);
      }
    }
  };

  /**
   * Registers a real visible 3D Oriented Bounding Box obstacle (building, pier, plinth) for solid collision.
   */
  function registerSolidBox(cx, cz, halfW, halfD, yaw = 0.0, maxY = 60.0) {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    // Local axes matching our yaw convention: right = (cosY, sinY), fwd = (sinY, -cosY)
    const rx = cosY, rz = sinY;
    const fx = sinY, fz = -cosY;
    const extX = Math.abs(rx) * halfW + Math.abs(fx) * halfD;
    const extZ = Math.abs(rz) * halfW + Math.abs(fz) * halfD;
    insertSolidItem(
      { kind: 'box', cx, cz, halfW, halfD, rx, rz, fx, fz, maxY },
      cx - extX, cx + extX, cz - extZ, cz + extZ
    );
  }

  /**
   * Registers a real visible 3D Cylindrical obstacle (tree trunk, viaduct column, tower leg).
   */
  function registerSolidCylinder(cx, cz, radius, maxY = 40.0) {
    insertSolidItem(
      { kind: 'cyl', cx, cz, radius, maxY },
      cx - radius, cx + radius, cz - radius, cz + radius
    );
  }

  const registerRibbonSegments = (ribbonData, deckType) => {
    const { frames, totalLen } = ribbonData;
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      const ax = a.pos.x, az = a.pos.z;
      const bx = b.pos.x, bz = b.pos.z;

      let leftLimit = 12.4;
      let rightLimit = 12.4;
      let hasLeftWall = false;
      let hasRightWall = false;

      if (deckType === 'ground') {
        // Open Free-Roam! Zero invisible corridor walls along the ground circuit!
        leftLimit = 12.4;
        rightLimit = 12.4;
      } else if (deckType === 'skyway') {
        // Elevated Skyway has real physical concrete Jersey barriers where s in [18 .. totalLen - 18]
        leftLimit = 6.05;
        rightLimit = 6.05;
        if (a.s >= 18.0 && a.s <= totalLen - 18.0) {
          hasLeftWall = true;
          hasRightWall = true;
        } else {
          leftLimit = 8.5;
          rightLimit = 8.5;
        }
      }

      const seg = {
        deckType,
        s0: a.s,
        s1: b.s,
        ax, ay: a.pos.y, az,
        bx, by: b.pos.y, bz,
        rx: a.right.x, rz: a.right.z,
        bank: a.bank,
        leftLimit,
        rightLimit,
        hasLeftWall,
        hasRightWall,
      };
      segments.push(seg);

      const pad = Math.max(leftLimit, rightLimit) + 3.0;
      const minCX = Math.floor((Math.min(ax, bx) - pad) / CELL_SIZE);
      const maxCX = Math.floor((Math.max(ax, bx) + pad) / CELL_SIZE);
      const minCZ = Math.floor((Math.min(az, bz) - pad) / CELL_SIZE);
      const maxCZ = Math.floor((Math.max(az, bz) + pad) / CELL_SIZE);

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cz = minCZ; cz <= maxCZ; cz++) {
          const k = cellKey(cx, cz);
          let list = grid.get(k);
          if (!list) {
            list = [];
            grid.set(k, list);
          }
          list.push(seg);
        }
      }
    }
  };

  registerRibbonSegments(groundData, 'ground');
  registerRibbonSegments(skywayData, 'skyway');

  // Helper to check distance to Ground Loop centerline (used so Skyway piers & buildings never block roads!)
  function minDistToRibbon2D(x, z, targetDeck = null) {
    const cx = Math.floor(x / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);
    let bestD2 = Infinity;
    let bestSeg = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(cellKey(cx + dx, cz + dz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (targetDeck && s.deckType !== targetDeck) continue;
          const abx = s.bx - s.ax;
          const abz = s.bz - s.az;
          const len2 = abx * abx + abz * abz;
          const t = len2 > 1e-6 ? THREE.MathUtils.clamp(((x - s.ax) * abx + (z - s.az) * abz) / len2, 0, 1) : 0;
          const px = s.ax + abx * t;
          const pz = s.az + abz * t;
          const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
          if (d2 < bestD2) {
            bestD2 = d2;
            bestSeg = s;
          }
        }
      }
    }
    return { dist: Math.sqrt(bestD2), seg: bestSeg };
  }

  // --- Build Concrete Viaduct Piers & Tokyo-Expressway Portal Straddle Bents ---
  {
    const frames = skywayData.frames;
    let nextPierS = 38.0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.s < nextPierS || f.s > skywayData.totalLen - 34.0) continue;
      if (f.pos.y < 2.6) continue;
      nextPierS = f.s + 28.0;

      const groundCheck = minDistToRibbon2D(f.pos.x, f.pos.z, 'ground');
      const beamY = f.pos.y - 1.42;

      if (groundCheck.dist < 14.5) {
        // Straddle Portal Bent spanning wide outside any ground road below!
        const spanHalf = 14.8;
        const capGeo = new THREE.BoxGeometry(spanHalf * 2 + 2.2, 1.15, 2.2, 8, 1, 1);
        capGeo.setAttribute('uv1', capGeo.getAttribute('uv'));
        const cap = new THREE.Mesh(capGeo, materials.highwayConcrete);
        cap.position.set(f.pos.x, beamY - 0.55, f.pos.z);
        cap.rotation.y = Math.atan2(-f.tan.x, -f.tan.z);
        cap.castShadow = true;
        cap.receiveShadow = true;
        cap.frustumCulled = false;
        group.add(cap);

        for (const side of [-1, 1]) {
          const px = f.pos.x + f.right.x * side * spanHalf;
          const pz = f.pos.z + f.right.z * side * spanHalf;
          if (minDistToRibbon2D(px, pz, 'ground').dist < 10.5) continue;
          const colH = beamY;
          const colGeo = new THREE.BoxGeometry(1.75, colH, 1.95, 1, Math.max(2, Math.ceil(colH / 2.5)), 1);
          colGeo.setAttribute('uv1', colGeo.getAttribute('uv'));
          const col = new THREE.Mesh(colGeo, materials.highwayConcrete);
          col.position.set(px, colH * 0.5, pz);
          col.rotation.y = Math.atan2(-f.tan.x, -f.tan.z);
          col.castShadow = true;
          col.receiveShadow = true;
          col.frustumCulled = false;
          group.add(col);
          registerSolidBox(px, pz, 0.90, 1.00, Math.atan2(f.tan.x, -f.tan.z), colH);
        }
      } else {
        // Sculpted Hammerhead Concrete Highway Pier
        const capGeo = new THREE.BoxGeometry(11.6, 1.05, 2.1, 4, 1, 1);
        capGeo.setAttribute('uv1', capGeo.getAttribute('uv'));
        const cap = new THREE.Mesh(capGeo, materials.highwayConcrete);
        cap.position.set(f.pos.x, beamY - 0.45, f.pos.z);
        cap.rotation.y = Math.atan2(-f.tan.x, -f.tan.z);
        cap.castShadow = true;
        cap.receiveShadow = true;
        cap.frustumCulled = false;
        group.add(cap);

        const colH = Math.max(1.0, beamY - 0.8);
        const colGeo = new THREE.CylinderGeometry(1.15, 1.38, colH, 14, Math.max(2, Math.ceil(colH / 2.5)));
        colGeo.setAttribute('uv1', colGeo.getAttribute('uv'));
        const col = new THREE.Mesh(colGeo, materials.highwayConcrete);
        col.position.set(f.pos.x, colH * 0.5, f.pos.z);
        col.castShadow = true;
        col.receiveShadow = true;
        col.frustumCulled = false;
        group.add(col);
        registerSolidCylinder(f.pos.x, f.pos.z, 1.38, colH);
      }
    }
  }

  // --- Overhead Tokyo-Expressway Steel Highway Gantry at Y-Fork Entrance (Z = +62) ---
  {
    const gantryZ = 62.0;
    const spanW = 24.4;
    const gantryY = 7.4;

    for (const sx of [-11.4, 12.8]) {
      const postGeo = new THREE.CylinderGeometry(0.32, 0.38, gantryY + 1.0, 10, 4);
      const post = new THREE.Mesh(postGeo, materials.brushedSteel);
      post.position.set(sx, (gantryY + 1.0) * 0.5, gantryZ);
      post.castShadow = true;
      post.frustumCulled = false;
      group.add(post);
      registerSolidCylinder(sx, gantryZ, 0.38, gantryY);
    }

    const trussGeo = new THREE.BoxGeometry(spanW, 0.65, 0.65, 12, 1, 1);
    const truss = new THREE.Mesh(trussGeo, materials.brushedSteel);
    truss.position.set(0.7, gantryY, gantryZ);
    truss.castShadow = true;
    truss.frustumCulled = false;
    group.add(truss);

    const signGeoL = new THREE.BoxGeometry(9.6, 2.35, 0.18, 6, 2, 1);
    const signL = new THREE.Mesh(signGeoL, materials.signLoopLeft);
    signL.position.set(-4.3, gantryY + 0.25, gantryZ + 0.35);
    signL.frustumCulled = false;
    group.add(signL);

    const signGeoR = new THREE.BoxGeometry(9.8, 2.35, 0.18, 6, 2, 1);
    const signR = new THREE.Mesh(signGeoR, materials.signSkywayRight);
    signR.position.set(6.4, gantryY + 0.25, gantryZ + 0.35);
    signR.frustumCulled = false;
    group.add(signR);
  }

  // --- Cable-Stayed High Skyway Suspension Tower at West Peak (X = -48, Z = -70, Deck Y = 17.6m) ---
  {
    const towerCenter = new THREE.Vector3(-48.0, 0.0, -70.0);
    const towerH = 46.0;
    const legSpread = 9.2;

    for (const side of [-1, 1]) {
      const legGeo = new THREE.CylinderGeometry(0.75, 1.35, towerH, 12, 12);
      const leg = new THREE.Mesh(legGeo, materials.stayCableWhite);
      const lx = towerCenter.x + side * legSpread * 0.65;
      leg.position.set(lx, towerH * 0.5, towerCenter.z);
      leg.rotation.z = side * 0.09;
      leg.castShadow = true;
      leg.receiveShadow = true;
      leg.frustumCulled = false;
      group.add(leg);
      registerSolidCylinder(lx, towerCenter.z, 1.38, towerH);
    }

    for (const crossY of [15.5, 29.0, 41.5]) {
      const crossW = Math.max(4.5, legSpread * 1.4 * (1.0 - crossY / 95.0));
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(crossW, 1.3, 1.5, 6, 1, 1),
        materials.stayCableWhite
      );
      beam.position.set(towerCenter.x, crossY, towerCenter.z);
      beam.castShadow = true;
      beam.frustumCulled = false;
      group.add(beam);
    }

    // Taut steel stay cables fanning down to the Skyway viaduct (bend dramatically under aberration!)
    const anchorTop = new THREE.Vector3(towerCenter.x, 42.5, towerCenter.z);
    for (const ds of [-54, -40, -26, -14, 14, 26, 40, 54]) {
      const targetS = THREE.MathUtils.clamp(315.0 + ds, 40.0, skywayData.totalLen - 40.0);
      const u = targetS / skywayData.totalLen;
      const deckPt = skywayCurve.getPointAt(u);
      const tan = skywayCurve.getTangentAt(u);
      const right = new THREE.Vector3().crossVectors(tan, UP).normalize();

      for (const side of [-1, 1]) {
        const p0 = anchorTop.clone().add(new THREE.Vector3(side * 2.8, 0, 0));
        const p1 = deckPt.clone().addScaledVector(right, side * 6.5).add(new THREE.Vector3(0, 0.9, 0));
        const diff = new THREE.Vector3().subVectors(p1, p0);
        const len = diff.length();
        const cableGeo = new THREE.CylinderGeometry(0.065, 0.065, len, 6, 18);
        const cable = new THREE.Mesh(cableGeo, materials.stayCableWhite);
        cable.position.copy(p0).addScaledVector(diff, 0.5);
        cable.quaternion.setFromUnitVectors(UP, diff.clone().normalize());
        cable.frustumCulled = false;
        group.add(cable);
      }
    }
  }

  /**
   * Queries exact multi-level support surface (Ground Loop, Skyway Overpass, Clock Plaza Stairs,
   * Park Grass, Sand Trap, or Reflecting Lagoon Water) at `(x, footY, z)` in <0.02ms.
   */
  function getSupportSurface(x, footY, z) {
    let bestY = -0.08;
    let bestBank = 0.0;
    let bestDeck = 'ground_base';
    let bestTerrain = 'grass';
    let foundDeck = false;

    // 0. Check Infield Reflecting Lagoons & Sand Traps on base terrain
    for (let i = 0; i < lagoons.length; i++) {
      const lg = lagoons[i];
      const dx = x - lg.cx;
      const dz = z - lg.cz;
      const dWater = (dx * dx) / (lg.waterRX * lg.waterRX) + (dz * dz) / (lg.waterRZ * lg.waterRZ);
      if (dWater <= 1.0) {
        bestY = -0.11;
        bestTerrain = 'water';
        break;
      }
      const dSand = (dx * dx) / (lg.sandRX * lg.sandRX) + (dz * dz) / (lg.sandRZ * lg.sandRZ);
      if (dSand <= 1.0) {
        bestY = -0.068;
        bestTerrain = 'sand';
      }
    }

    // 1. Check Clock Tower Plaza & Walkable Grand Stone Staircase (X in [-42..-11], Z in [-62..-14])
    if (x >= -42.5 && x <= -10.5 && z >= -62.5 && z <= -14.0) {
      let plazaY = 0.16;
      // Walkable wide stone steps rising West from X = -19 (y=0.16) to X = -29 (y=2.80) for Z in [-48..-28]
      if (z >= -52.0 && z <= -24.0) {
        if (x <= -29.0 && x >= -41.5) {
          plazaY = 2.80; // Raised Observation Terrace!
        } else if (x < -19.0 && x > -29.0) {
          const frac = (-19.0 - x) / 10.0;
          const stepIdx = Math.floor(frac * 14.0);
          plazaY = 0.16 + (stepIdx / 14.0) * 2.64;
        }
      }
      if (plazaY <= footY + 1.35) {
        bestY = plazaY;
        bestDeck = 'plaza';
        bestTerrain = 'plaza';
        foundDeck = true;
      }
    }

    // 2. Check Ground Grand Prix Loop & Multi-Level Skyway via Spatial Hash Grid
    const cx = Math.floor(x / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(cellKey(cx + dx, cz + dz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          const abx = s.bx - s.ax;
          const abz = s.bz - s.az;
          const len2 = abx * abx + abz * abz;
          if (len2 < 1e-6) continue;
          const rawT = ((x - s.ax) * abx + (z - s.az) * abz) / len2;
          if (rawT < -0.15 || rawT > 1.15) continue;
          const t = THREE.MathUtils.clamp(rawT, 0.0, 1.0);
          const px = s.ax + abx * t;
          const pz = s.az + abz * t;
          const lat = (x - px) * s.rx + (z - pz) * s.rz;

          const maxW = s.deckType === 'skyway' ? 6.65 : 12.35;
          if (Math.abs(lat) > maxW) continue;

          let deckY = s.ay + (s.by - s.ay) * t - Math.sin(s.bank) * lat;
          let segTerrain = 'road';

          if (s.deckType === 'ground' && Math.abs(lat) > 8.08) {
            const isFlushRamp =
              (lat > 0 && Math.abs(px) < 13.0 && ((pz >= 8.0 && pz <= 72.0) || (pz >= 166.0 && pz <= 212.0)));
            if (!isFlushRamp) {
              deckY += 0.14;
              segTerrain = 'sidewalk';
            }
          }

          if (deckY <= footY + 1.45 && (!foundDeck || deckY > bestY)) {
            bestY = deckY;
            bestBank = s.bank;
            bestDeck = s.deckType;
            bestTerrain = segTerrain;
            foundDeck = true;
          }
        }
      }
    }

    return { y: bestY, bank: bestBank, deck: bestDeck, terrain: bestTerrain };
  }

  /**
   * Point-vs-world collision query (used by Chase Camera anti-clipping & AI disturbed slide).
   */
  function queryBarrierContact(x, footY, z) {
    if (x < -410.0) return { hit: true, pen: -410.0 - x, nx: 1, nz: 0 };
    if (x > 410.0) return { hit: true, pen: x - 410.0, nx: -1, nz: 0 };
    if (z < -410.0) return { hit: true, pen: -410.0 - z, nx: 0, nz: 1 };
    if (z > 410.0) return { hit: true, pen: z - 410.0, nx: 0, nz: -1 };

    const cx = Math.floor(x / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);
    const onElevatedSkyway = footY > 1.65;

    if (onElevatedSkyway) {
      let bestSeg = null;
      let bestSignedLat = 0.0;
      let bestDist2 = Infinity;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(cellKey(cx + dx, cz + dz));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (s.deckType !== 'skyway') continue;
            const abx = s.bx - s.ax;
            const abz = s.bz - s.az;
            const len2 = abx * abx + abz * abz;
            if (len2 < 1e-6) continue;
            const t = THREE.MathUtils.clamp(((x - s.ax) * abx + (z - s.az) * abz) / len2, 0.0, 1.0);
            const deckY = s.ay + (s.by - s.ay) * t;
            if (Math.abs(deckY - footY) > 2.6) continue;

            const px = s.ax + abx * t;
            const pz = s.az + abz * t;
            const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
            if (d2 < bestDist2) {
              bestDist2 = d2;
              bestSeg = s;
              bestSignedLat = (x - px) * s.rx + (z - pz) * s.rz;
            }
          }
        }
      }

      if (bestSeg) {
        if (bestSignedLat > 0 && bestSeg.hasRightWall && bestSignedLat > bestSeg.rightLimit) {
          return { hit: true, pen: bestSignedLat - bestSeg.rightLimit, nx: -bestSeg.rx, nz: -bestSeg.rz };
        }
        if (bestSignedLat < 0 && bestSeg.hasLeftWall && -bestSignedLat > bestSeg.leftLimit) {
          return { hit: true, pen: -bestSignedLat - bestSeg.leftLimit, nx: bestSeg.rx, nz: bestSeg.rz };
        }
      }
    }

    let deepestHit = null;
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const cellList = solidGrid.get(cellKey(cx + gx, cz + gz));
        if (!cellList) continue;
        for (let i = 0; i < cellList.length; i++) {
          const ob = cellList[i];
          if (footY > ob.maxY) continue;
          if (ob.kind === 'cyl') {
            const dx = x - ob.cx;
            const dz = z - ob.cz;
            const d2 = dx * dx + dz * dz;
            if (d2 < ob.radius * ob.radius) {
              const d = Math.sqrt(Math.max(1e-8, d2));
              const pen = ob.radius - d;
              if (!deepestHit || pen > deepestHit.pen) {
                deepestHit = { hit: true, pen, nx: dx / d, nz: dz / d };
              }
            }
          } else {
            const dx = x - ob.cx;
            const dz = z - ob.cz;
            const u = dx * ob.rx + dz * ob.rz;
            const v = dx * ob.fx + dz * ob.fz;
            const penU = ob.halfW - Math.abs(u);
            const penV = ob.halfD - Math.abs(v);
            if (penU > 0.0 && penV > 0.0) {
              let pen, nx, nz;
              if (penU < penV) {
                pen = penU;
                const sgn = u >= 0 ? 1.0 : -1.0;
                nx = ob.rx * sgn;
                nz = ob.rz * sgn;
              } else {
                pen = penV;
                const sgn = v >= 0 ? 1.0 : -1.0;
                nx = ob.fx * sgn;
                nz = ob.fz * sgn;
              }
              if (!deepestHit || pen > deepestHit.pen) {
                deepestHit = { hit: true, pen, nx, nz };
              }
            }
          }
        }
      }
    }

    return deepestHit || { hit: false, pen: 0, nx: 0, nz: 0 };
  }

  /**
   * Exact Solid 2D OBB-vs-Cylinder & OBB-vs-OBB SAT Vehicle Collision Query!
   * Prevents narrow columns/poles (`r < halfW`) from EVER slipping between bumper corners
   * or trapping/wedging the vehicle chassis!
   */
  const _seenSolids = new Set();
  function queryVehicleOBBContact(carX, footY, carZ, halfW, halfL, moveYaw) {
    const rx = Math.cos(moveYaw), rz = Math.sin(moveYaw);
    const fx = Math.sin(moveYaw), fz = -Math.cos(moveYaw);

    let deepest = null;
    const recordHit = (pen, nx, nz, wx, wz) => {
      if (pen > 0.0 && (!deepest || pen > deepest.pen)) {
        deepest = { hit: true, pen, nx, nz, wx, wz };
      }
    };

    // 1. Outer park safety boundary (`+/-410m`)
    const extX = Math.abs(rx) * halfW + Math.abs(fx) * halfL;
    const extZ = Math.abs(rz) * halfW + Math.abs(fz) * halfL;
    if (carX - extX < -410.0) recordHit(-410.0 - (carX - extX), 1, 0, -410.0, carZ);
    if (carX + extX > 410.0) recordHit((carX + extX) - 410.0, -1, 0, 410.0, carZ);
    if (carZ - extZ < -410.0) recordHit(-410.0 - (carZ - extZ), 0, 1, carX, -410.0);
    if (carZ + extZ > 410.0) recordHit((carZ + extZ) - 410.0, 0, -1, carX, 410.0);

    // 2. Elevated Skyway concrete Jersey barriers (test 4 OBB corners + side midpoints)
    if (footY > 1.65) {
      for (const [lu, lv] of [
        [-halfW, halfL], [halfW, halfL], [-halfW, -halfL], [halfW, -halfL], [-halfW, 0], [halfW, 0],
      ]) {
        const wx = carX + rx * lu + fx * lv;
        const wz = carZ + rz * lu + fz * lv;
        const bRes = queryBarrierContact(wx, footY, wz);
        if (bRes.hit) recordHit(bRes.pen, bRes.nx, bRes.nz, wx, wz);
      }
    }

    // 3. Exact Solid OBB vs. Cylinders & Oriented Boxes across 3x3 spatial hash neighborhood
    const cx = Math.floor(carX / CELL_SIZE);
    const cz = Math.floor(carZ / CELL_SIZE);
    _seenSolids.clear();

    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        const list = solidGrid.get(cellKey(cx + gx, cz + gz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const ob = list[i];
          if (_seenSolids.has(ob)) continue;
          _seenSolids.add(ob);
          if (footY > ob.maxY) continue;

          if (ob.kind === 'cyl') {
            // Vector from car center to cylinder center in car local frame (right, fwd)
            const dx = ob.cx - carX;
            const dz = ob.cz - carZ;
            const du = dx * rx + dz * rz;
            const dv = dx * fx + dz * fz;
            if (Math.abs(du) >= halfW + ob.radius || Math.abs(dv) >= halfL + ob.radius) continue;

            const cu = THREE.MathUtils.clamp(du, -halfW, halfW);
            const cv = THREE.MathUtils.clamp(dv, -halfL, halfL);
            const eu = cu - du; // points FROM cylinder center TO car closest point!
            const ev = cv - dv;
            const d2 = eu * eu + ev * ev;

            if (d2 > 1e-8) {
              if (d2 < ob.radius * ob.radius) {
                const d = Math.sqrt(d2);
                const pen = ob.radius - d;
                const nu = eu / d;
                const nv = ev / d;
                const nx = nu * rx + nv * fx;
                const nz = nu * rz + nv * fz;
                const wx = carX + cu * rx + cv * fx;
                const wz = carZ + cu * rz + cv * fz;
                recordHit(pen, nx, nz, wx, wz);
              }
            } else {
              // Cylinder center is strictly inside Car OBB -> eject cleanly out nearest face!
              const distU = halfW - Math.abs(du);
              const distV = halfL - Math.abs(dv);
              if (distU < distV) {
                const sgn = du <= 0.0 ? 1.0 : -1.0;
                recordHit(ob.radius + distU, rx * sgn, rz * sgn, ob.cx, ob.cz);
              } else {
                const sgn = dv <= 0.0 ? 1.0 : -1.0;
                recordHit(ob.radius + distV, fx * sgn, fz * sgn, ob.cx, ob.cz);
              }
            }
          } else {
            // 4-Axis Separating Axis Theorem (SAT) between Car OBB and Obstacle OBB
            const dx = carX - ob.cx; // points FROM obstacle TO car!
            const dz = carZ - ob.cz;
            const axes = [
              [rx, rz],
              [fx, fz],
              [ob.rx, ob.rz],
              [ob.fx, ob.fz],
            ];
            let minPen = Infinity;
            let bestNx = 0.0, bestNz = 0.0;
            let separated = false;

            for (let a = 0; a < 4; a++) {
              const ax = axes[a][0], az = axes[a][1];
              const projCar = halfW * Math.abs(ax * rx + az * rz) + halfL * Math.abs(ax * fx + az * fz);
              const projBox = ob.halfW * Math.abs(ax * ob.rx + az * ob.rz) + ob.halfD * Math.abs(ax * ob.fx + az * ob.fz);
              const dist = Math.abs(dx * ax + dz * az);
              const overlap = projCar + projBox - dist;
              if (overlap <= 0.0) {
                separated = true;
                break;
              }
              if (overlap < minPen) {
                minPen = overlap;
                const sgn = (dx * ax + dz * az) >= 0.0 ? 1.0 : -1.0;
                bestNx = ax * sgn;
                bestNz = az * sgn;
              }
            }

            if (!separated && minPen < Infinity) {
              // Contact point approximated on car perimeter facing obstacle
              const wx = carX - bestNx * Math.min(halfW, halfL);
              const wz = carZ - bestNz * Math.min(halfW, halfL);
              recordHit(minPen, bestNx, bestNz, wx, wz);
            }
          }
        }
      }
    }

    return deepest || { hit: false, pen: 0, nx: 0, nz: 0, wx: carX, wz: carZ };
  }

  /**
   * Samples exact 3D pose `(pos, yaw, pitch, bank, tangent)` along `'ground'` or `'skyway'`
   * at arc-length `s` and lateral lane offset `laneOffset` (+East/Right, -West/Left).
   */
  function sampleLanePose(trackName, sMeters, laneOffset = 0.0, reverseDir = false) {
    const isSky = trackName === 'skyway';
    const curve = isSky ? skywayCurve : groundCurve;
    const totalLen = isSky ? skywayData.totalLen : groundData.totalLen;

    let u;
    if (isSky) {
      u = THREE.MathUtils.clamp(sMeters / totalLen, 0.0, 1.0);
    } else {
      u = (((sMeters / totalLen) % 1.0) + 1.0) % 1.0;
    }

    const pos = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();
    const right = new THREE.Vector3().crossVectors(tan, UP).normalize();

    const outPos = pos.clone().addScaledVector(right, laneOffset);
    const dir = reverseDir ? tan.clone().negate() : tan;
    // Yaw convention: 0 = -Z (North), +pi/2 = +X (East) -> dir = (sin(yaw), dy, -cos(yaw))
    const yaw = Math.atan2(dir.x, -dir.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -0.6, 0.6));

    return {
      pos: outPos,
      tan: dir,
      right,
      yaw,
      pitch,
      totalLen,
    };
  }

  return {
    group,
    groundCurve,
    skywayCurve,
    groundData,
    skywayData,
    lagoons,
    registerSolidBox,
    registerSolidCylinder,
    getSupportSurface,
    queryBarrierContact,
    queryVehicleOBBContact,
    minDistToRibbon2D,
    sampleLanePose,
  };
}
