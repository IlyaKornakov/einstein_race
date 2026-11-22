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

    // Bank inward into fast sweeping corners (up to 6.0 deg = 0.105 rad for effortless high-gamma cornering!)
    const rawBank = THREE.MathUtils.clamp(signedCurv * 11.5 * bankScale, -0.105, 0.105);
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

  // 1. High-Speed Relativistic Stadium-Expressway Circuit (~2,362m Closed 3D Catmull-Rom)
  //    Features TWO unbroken 600m straightaways (Grand Boulevard X=0 & East Skyline X=370)
  //    connected by constant-radius R = 185m banked parabolic sweepers (~3x gentler curvature)!
  const groundPts = [
    new THREE.Vector3(0.0, 0.0, 330.0),    // South Straightaway start (600m pure straight begins!)
    new THREE.Vector3(0.0, 0.0, 262.0),    // Skyway Off-Ramp Merge zone
    new THREE.Vector3(0.0, 0.0, 192.0),    // Starting Grid & Spawn Straight (facing -Z!)
    new THREE.Vector3(0.0, 0.0, 94.0),     // Start / Finish Gantry & Black Hole Bypass split
    new THREE.Vector3(0.0, 0.0, 12.0),     // Y-Fork Skyway Interchange & Triumphal Arch approach
    new THREE.Vector3(0.0, 0.0, -78.0),    // Clock Plaza & Bullet Train Viaduct
    new THREE.Vector3(0.0, 0.0, -174.0),   // High-Speed Relativistic Sprint Zone (0.94c+!)
    new THREE.Vector3(0.0, 0.0, -270.0),   // End of 600m Grand Boulevard Straight / Wormhole Mouth A
    // North R = 185m Constant-Radius Banked Sweeper (exact 36 deg arc increments!)
    new THREE.Vector3(35.3, 0.5, -378.7),
    new THREE.Vector3(127.8, 1.1, -445.9),
    new THREE.Vector3(242.2, 1.6, -445.9),
    new THREE.Vector3(334.7, 2.0, -378.7),
    // 600m Unbroken East Skyline Back Straight (X = 370.0, Z = -270 -> +330)
    new THREE.Vector3(370.0, 2.2, -270.0),
    new THREE.Vector3(370.0, 1.8, -120.0),
    new THREE.Vector3(370.0, 1.3, 30.0),   // Gravitational-Wave Corridor & Wormhole Mouth B merge
    new THREE.Vector3(370.0, 0.7, 180.0),
    new THREE.Vector3(370.0, 0.1, 330.0),
    // South R = 185m Constant-Radius Banked Return Sweeper (exact 36 deg arc increments!)
    new THREE.Vector3(334.7, 0.0, 438.7),
    new THREE.Vector3(242.2, 0.0, 505.9),
    new THREE.Vector3(127.8, 0.0, 505.9),
    new THREE.Vector3(35.3, 0.0, 438.7),
  ];
  const groundCurve = new THREE.CatmullRomCurve3(groundPts, true, 'centripetal', 0.45);

  // 2. Wide-Radius Multi-Level Elevated Skyway Expressway (~1,540m Viaduct & Cable-Stayed Flyover)
  const skywayPts = [
    new THREE.Vector3(5.4, 0.01, 68.0),     // Seamless start in right lane of Grand Boulevard
    new THREE.Vector3(9.6, 0.04, 42.0),     // Effortless ~8 deg Y-fork split!
    new THREE.Vector3(18.5, 2.20, 4.0),     // Smooth ascent past gore chevrons
    new THREE.Vector3(28.0, 8.20, -40.0),   // Viaduct climb east of Triumphal Arch
    new THREE.Vector3(32.0, 15.20, -92.0),  // Level 2 Panorama Viaduct (clears Y=6.8m Bullet Train!)
    new THREE.Vector3(-8.0, 17.20, -188.0), // Wide North-West Panorama Flyover
    new THREE.Vector3(-74.0, 18.00, -88.0), // Level 3 Cable-Stayed High Bridge (18.0m!)
    new THREE.Vector3(-54.0, 15.40, 22.0),  // West Overlook above Kerr Black Hole Basin!
    new THREE.Vector3(44.0, 12.80, 96.0),   // Soaring Crossover HIGH OVER Grand Boulevard!
    new THREE.Vector3(168.0, 9.50, 172.0),  // Wide Infield Sweeping Viaduct
    new THREE.Vector3(158.0, 5.00, 276.0),  // Gentle Curved Descent Ramp
    new THREE.Vector3(64.0, 1.35, 324.0),   // Smooth Merge Approach
    new THREE.Vector3(9.8, 0.05, 296.0),    // Forward Merge into Grand Boulevard right lane
    new THREE.Vector3(5.4, 0.01, 262.0),    // Aligned -Z well south of Starting Grid!
  ];
  const skywayCurve = new THREE.CatmullRomCurve3(skywayPts, false, 'centripetal', 0.45);

  const groundData = sampleRibbonFrames(groundCurve, 1.65, true, 1.0);
  const skywayData = sampleRibbonFrames(skywayCurve, 1.55, false, 1.15);

  // --- Build Ground Grand Prix Road Mesh (19.0m wide, 9 lateral vertices for generous high-speed playability!) ---
  const roadProfile = [];
  const roadHalfW = 9.5;
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
      if (sideSign > 0 && Math.abs(x) < 14.0) {
        if ((z >= 2.0 && z <= 72.0) || (z >= 254.0 && z <= 316.0)) {
          curbH = 0.005;
        }
      }
      // Flush / gentle curb at Clock Tower Plaza West (-1) entrance (Z in [-60..-18])
      // AND at the Black Hole Slingshot Bypass Lane West (-1) entrance/exit (Z in [4..112])!
      if (sideSign < 0 && Math.abs(x) < 12.5) {
        if (z >= -60.0 && z <= -18.0) curbH = 0.04;
        if (z >= 4.0 && z <= 112.0) curbH = 0.005;
      }
      // Flush curb at North Boulevard Wormhole Mouth A approach (Z in [-302..-248])
      // and East Skyline Wormhole Mouth B merge (X > 345, Z in [34..102])
      if (Math.abs(x) < 16.0 && z >= -302.0 && z <= -248.0) {
        curbH = 0.005;
      }
      if (sideSign > 0 && x > 345.0 && z >= 34.0 && z <= 102.0) {
        curbH = 0.005;
      }

      const lats = sideSign > 0
        ? [9.5, 9.62, 11.7, 13.9, 14.12, 17.4]
        : [-17.4, -14.12, -13.9, -11.7, -9.62, -9.5];
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
      const inner = side > 0 ? 8.95 : -9.85;
      const outer = side > 0 ? 9.85 : -8.95;
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
      const side = Math.abs(k) > 0.0040 ? Math.sign(k) : 0;
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

  // --- Build Multi-Level Elevated Skyway Deck (14.8m Asphalt + Concrete Box Girder + Twin Jersey Barriers) ---
  const skyHalfW = 7.4;
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
      [-8.05, -0.35, 0.0, -1, 0],
      [-8.05, 0.96, 0.25, -0.3, 0.95],
      [-7.55, 0.96, 0.50, 0.3, 0.95],
      [-7.32, 0.28, 0.78, 0.85, 0.5],
      [-7.25, 0.02, 1.0, 0.7, 0.7],
    ];
    // Right Jersey Barrier
    const rightBarrierProf = [
      [7.25, 0.02, 0.0, -0.7, 0.7],
      [7.32, 0.28, 0.22, -0.85, 0.5],
      [7.55, 0.96, 0.50, -0.3, 0.95],
      [8.05, 0.96, 0.75, 0.3, 0.95],
      [8.05, -0.35, 1.0, 1, 0],
    ];
    // Underside Box-Girder Spine (ordered +X -> -X so outward normals face downward -Y!)
    const girderFrames = frames.filter((f) => f.s >= 32.0 && f.s <= totalS - 32.0);
    const girderProf = [
      [8.05, -0.02, 0.0, 1, 0],
      [8.05, -0.48, 0.15, 0.6, -0.8],
      [4.95, -1.35, 0.35, 0.3, -0.95],
      [0.0, -1.42, 0.50, 0, -1],
      [-4.95, -1.35, 0.65, -0.3, -0.95],
      [-8.05, -0.48, 0.85, -0.6, -0.8],
      [-8.05, -0.02, 1.0, -1, 0],
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
      const cwGeo = new THREE.PlaneGeometry(18.2, lengthZ, 30, 12);
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
    { cx: 185.0, cz: -145.0, waterRX: 32.0, waterRZ: 44.0, sandRX: 41.0, sandRZ: 53.0 },
    { cx: 225.0, cz: 185.0, waterRX: 28.0, waterRZ: 38.0, sandRX: 36.0, sandRZ: 46.0 },
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
        leftLimit = 14.0;
        rightLimit = 14.0;
      } else if (deckType === 'skyway') {
        // Elevated Skyway has real physical concrete Jersey barriers where s in [18 .. totalLen - 18]
        leftLimit = 7.25;
        rightLimit = 7.25;
        if (a.s >= 18.0 && a.s <= totalLen - 18.0) {
          hasLeftWall = true;
          hasRightWall = true;
        } else {
          leftLimit = 9.5;
          rightLimit = 9.5;
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

      const pad = (deckType === 'ground' ? 18.0 : Math.max(leftLimit, rightLimit)) + 3.0;
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

  // --- Build General Relativity Paved Slingshot Bypass Loop & Wormhole Approach Pads (v2.0) ---
  const slingshotCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-4.8, 0.015, 108.0),
      new THREE.Vector3(-14.5, 0.02, 84.0),
      new THREE.Vector3(-20.2, 0.02, 54.0), // Periapsis ~15m from Black Hole (-34, 6.2, 54)!
      new THREE.Vector3(-14.5, 0.02, 24.0),
      new THREE.Vector3(-4.8, 0.015, 4.0),
    ],
    false,
    'centripetal',
    0.5
  );
  const slingshotData = sampleRibbonFrames(slingshotCurve, 1.4, false, 1.35);
  {
    const slProf = [
      [-5.2, 0.02, 0.0, 0, 1],
      [-2.6, 0.04, 0.25, 0, 1],
      [0.0, 0.05, 0.5, 0, 1],
      [2.6, 0.04, 0.75, 0, 1],
      [5.2, 0.02, 1.0, 0, 1],
    ];
    const slMesh = new THREE.Mesh(
      buildProfileStripGeometry(slingshotData.frames, slProf, 0.065),
      materials.highwayRoad
    );
    slMesh.receiveShadow = true;
    slMesh.frustumCulled = false;
    group.add(slMesh);
  }

  const wormholeACurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-1.8, 0.015, -254.0),
      new THREE.Vector3(-4.2, 0.02, -272.0),
      new THREE.Vector3(-5.5, 0.02, -296.0),
    ],
    false,
    'centripetal',
    0.5
  );
  const wormholeAData = sampleRibbonFrames(wormholeACurve, 1.5, false, 0.0);

  const wormholeBCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(360.0, 1.28, 48.0),
      new THREE.Vector3(364.2, 1.18, 68.0),
      new THREE.Vector3(369.0, 1.02, 98.0),
    ],
    false,
    'centripetal',
    0.5
  );
  const wormholeBData = sampleRibbonFrames(wormholeBCurve, 1.5, false, 0.0);

  for (const wData of [wormholeAData, wormholeBData]) {
    const wpProf = [
      [-5.6, 0.02, 0.0, 0, 1],
      [0.0, 0.04, 0.5, 0, 1],
      [5.6, 0.02, 1.0, 0, 1],
    ];
    const wpMesh = new THREE.Mesh(
      buildProfileStripGeometry(wData.frames, wpProf, 0.065),
      materials.highwayRoad
    );
    wpMesh.receiveShadow = true;
    wpMesh.frustumCulled = false;
    group.add(wpMesh);
  }

  registerRibbonSegments(groundData, 'ground');
  registerRibbonSegments(skywayData, 'skyway');
  registerRibbonSegments(slingshotData, 'slingshot');
  registerRibbonSegments(wormholeAData, 'wormhole_pad');
  registerRibbonSegments(wormholeBData, 'wormhole_pad');

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

  // Register low-clearance Skyway concrete ramp abutments (`0.85m <= f.pos.y < 3.15m`, where girder
  // underside has <1.7m headroom) as height-gated solid OBBs: cars ON the ramp (`footY > f.pos.y - 0.85`)
  // pass freely above `maxY`, while off-road grass cars (`footY = -0.08`) bounce cleanly off the abutment wall!
  {
    const sFrames = skywayData.frames;
    for (let i = 2; i < sFrames.length - 2; i += 3) {
      const sf = sFrames[i];
      if (sf.s < 28.0 || sf.s > skywayData.totalLen - 28.0) continue;
      if (sf.pos.y < 0.85 || sf.pos.y >= 3.15) continue;
      if (minDistToRibbon2D(sf.pos.x, sf.pos.z, 'ground').dist < 11.2) continue;
      const yaw = Math.atan2(sf.tan.x, -sf.tan.z);
      registerSolidBox(sf.pos.x, sf.pos.z, 8.05, 2.4, yaw, sf.pos.y - 0.85);
    }
  }

  // --- Build Concrete Viaduct Piers & Tokyo-Expressway Portal Straddle Bents ---
  {
    const frames = skywayData.frames;
    let nextPierS = 42.0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.s < nextPierS || f.s > skywayData.totalLen - 38.0) continue;
      if (f.pos.y < 2.6) continue;
      nextPierS = f.s + 32.0;

      const groundCheck = minDistToRibbon2D(f.pos.x, f.pos.z, 'ground');
      const beamY = f.pos.y - 1.42;

      if (groundCheck.dist < 16.5) {
        // Straddle Portal Bent spanning wide outside any ground road below!
        const spanHalf = 16.8;
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
          if (minDistToRibbon2D(px, pz, 'ground').dist < 12.2) continue;
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
    const spanW = 28.0;
    const gantryY = 7.4;

    for (const sx of [-13.2, 14.6]) {
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

  // --- Cable-Stayed High Skyway Suspension Tower at West Peak (X = -74, Z = -88, Deck Y = 18.0m) ---
  {
    const towerCenter = new THREE.Vector3(-74.0, 0.0, -88.0);
    const towerH = 48.0;
    const legSpread = 13.6;

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
      const crossW = Math.max(5.5, legSpread * 1.4 * (1.0 - crossY / 95.0));
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(crossW, 1.3, 1.5, 6, 1, 1),
        materials.stayCableWhite
      );
      beam.position.set(towerCenter.x, crossY, towerCenter.z);
      beam.castShadow = true;
      beam.frustumCulled = false;
      group.add(beam);
    }

    let towerS = 450.0;
    let bestTowerD2 = Infinity;
    for (const sf of skywayData.frames) {
      const d2 = (sf.pos.x - towerCenter.x) ** 2 + (sf.pos.z - towerCenter.z) ** 2;
      if (d2 < bestTowerD2) {
        bestTowerD2 = d2;
        towerS = sf.s;
      }
    }

    // Taut steel stay cables fanning down to the Skyway viaduct (bend dramatically under aberration!)
    const anchorTop = new THREE.Vector3(towerCenter.x, 44.0, towerCenter.z);
    for (const ds of [-58, -42, -28, -14, 14, 28, 42, 58]) {
      const targetS = THREE.MathUtils.clamp(towerS + ds, 40.0, skywayData.totalLen - 40.0);
      const u = targetS / skywayData.totalLen;
      const deckPt = skywayCurve.getPointAt(u);
      const tan = skywayCurve.getTangentAt(u);
      const right = new THREE.Vector3().crossVectors(tan, UP).normalize();

      for (const side of [-1, 1]) {
        const p0 = anchorTop.clone().add(new THREE.Vector3(side * 3.4, 0, 0));
        const p1 = deckPt.clone().addScaledVector(right, side * 7.6).add(new THREE.Vector3(0, 0.9, 0));
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
   * Principled Two-Layer Support Surface Solver:
   *   1. Unconditional Solid Ground Heightfield (`groundY`): combines Park Grass, Lagoons,
   *      Clock Plaza & Stairs, AND the Ground Grand Prix Loop + its continuous `12.62->15.8m`
   *      outer stone embankment WITHOUT any `footY` ceiling cutoff — solid earth has NO void
   *      underneath, so a car can NEVER end up under a ground road, sidewalk, or plaza!
   *   2. Elevated Viaduct Overpass (`skyway`): true hollow bridge deck supported on piers,
   *      active when on the low merge apron (`deckY <= groundY + 1.05m`) or when above the
   *      concrete box-girder underside (`footY >= deckY - 1.45m`).
   */
  function getSupportSurface(x, footY, z) {
    let groundY = -0.08;
    let groundBank = 0.0;
    let groundDeck = 'ground_base';
    let groundTerrain = 'grass';

    // 0. Check Infield Reflecting Lagoons & Sand Traps on base terrain
    for (let i = 0; i < lagoons.length; i++) {
      const lg = lagoons[i];
      const dx = x - lg.cx;
      const dz = z - lg.cz;
      const dWater = (dx * dx) / (lg.waterRX * lg.waterRX) + (dz * dz) / (lg.waterRZ * lg.waterRZ);
      if (dWater <= 1.0) {
        groundY = -0.11;
        groundTerrain = 'water';
        break;
      }
      const dSand = (dx * dx) / (lg.sandRX * lg.sandRX) + (dz * dz) / (lg.sandRZ * lg.sandRZ);
      if (dSand <= 1.0) {
        groundY = -0.068;
        groundTerrain = 'sand';
      }
    }

    // 1. Check Clock Tower Plaza & Walkable Grand Stone Staircase (solid earth — never hollow!)
    if (x >= -42.5 && x <= -10.5 && z >= -62.5 && z <= -14.0) {
      let plazaY = 0.16;
      if (z >= -52.8 && z <= -23.2) {
        if (x <= -29.0 && x >= -41.5) {
          plazaY = 2.80; // Raised Observation Terrace
        } else if (x < -19.0 && x > -29.0) {
          const frac = (-19.0 - x) / 10.0;
          const stepIdx = Math.floor(frac * 14.0);
          plazaY = 0.16 + (stepIdx / 14.0) * 2.64;
        }
      }
      if (plazaY > groundY) {
        groundY = plazaY;
        groundDeck = 'plaza';
        groundTerrain = 'plaza';
      }
    }

    // 1B. Black Hole Ergosphere Obsidian Apron (r <= 24m around (-36, 54)): full road traction right up to r_H!
    if (Math.hypot(x - (-36.0), z - 54.0) <= 24.0) {
      if (0.025 > groundY) {
        groundY = 0.025;
        groundDeck = 'ground';
        groundTerrain = 'road';
      }
    }

    // 2. Scan Ground Grand Prix Loop (unconditional solid earth + sloped embankment!) & Elevated Skyway
    const cx = Math.floor(x / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);

    let skyBestY = -Infinity;
    let skyBestBank = 0.0;
    let foundSkyway = false;

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
          const absLat = Math.abs(lat);

          if (s.deckType === 'ground') {
            if (absLat > 17.4) continue;
            const roadY = s.ay + (s.by - s.ay) * t - Math.sin(s.bank) * lat;
            let segY = roadY;
            let segTerrain = 'road';
            let segBank = s.bank;

            if (absLat > 9.58) {
              const isFlushRamp =
                (lat > 0 &&
                  Math.abs(px) < 14.5 &&
                  ((pz >= 2.0 && pz <= 72.0) || (pz >= 254.0 && pz <= 316.0))) ||
                (lat > 0 && px > 345.0 && pz >= 34.0 && pz <= 102.0) ||
                (lat < 0 && Math.abs(px) < 13.5 && pz >= 4.0 && pz <= 112.0) ||
                (Math.abs(px) < 16.0 && pz >= -302.0 && pz <= -248.0);
              const isPlazaEdge =
                lat < 0 && Math.abs(px) < 12.5 && pz >= -60.0 && pz <= -18.0;
              const curbH = isFlushRamp ? 0.005 : isPlazaEdge ? 0.04 : 0.15;

              if (absLat <= 14.12) {
                segY = roadY + (isFlushRamp ? 0.0 : curbH - 0.01);
                segTerrain = isFlushRamp ? 'road' : 'sidewalk';
              } else {
                // Continuous sloped outer stone embankment (`14.12m -> 17.4m`) matching `buildSidewalkSide`!
                const uSlope = (absLat - 14.12) / (17.4 - 14.12);
                const topEmbankY = roadY + curbH - 0.05;
                const botEmbankY = roadY - 2.55;
                segY = topEmbankY + (botEmbankY - topEmbankY) * uSlope;
                segTerrain = 'sidewalk';
                segBank = 0.0;
              }
            }

            if (segY > groundY) {
              groundY = segY;
              groundBank = segBank;
              groundDeck = 'ground';
              groundTerrain = segTerrain;
            }
          } else if (s.deckType === 'slingshot' || s.deckType === 'wormhole_pad') {
            const halfPadW = s.deckType === 'slingshot' ? 5.6 : 5.8;
            if (absLat > halfPadW) continue;
            const padY = s.ay + (s.by - s.ay) * t - Math.sin(s.bank) * lat + 0.02;
            if (padY >= groundY - 0.16) {
              groundY = Math.max(groundY, padY);
              groundBank = s.bank;
              groundDeck = 'ground';
              groundTerrain = 'road';
            }
          } else if (s.deckType === 'skyway') {
            if (absLat > 7.85) continue;
            const deckY = s.ay + (s.by - s.ay) * t - Math.sin(s.bank) * lat;
            if (deckY > skyBestY) {
              skyBestY = deckY;
              skyBestBank = s.bank;
              foundSkyway = true;
            }
          }
        }
      }
    }

    // Activate Elevated Skyway if it merges near ground level OR car is above the viaduct girder underside
    if (foundSkyway && skyBestY > groundY) {
      const isLowMergeApron = skyBestY <= groundY + 1.05;
      const isOnElevatedDeck = footY >= skyBestY - 1.45;
      if (isLowMergeApron || isOnElevatedDeck) {
        return { y: skyBestY, bank: skyBestBank, deck: 'skyway', terrain: 'road' };
      }
    }

    return { y: groundY, bank: groundBank, deck: groundDeck, terrain: groundTerrain };
  }

  /**
   * Point-vs-world collision query (used by Chase Camera anti-clipping & AI disturbed slide).
   */
  function queryBarrierContact(x, footY, z) {
    if (x < -680.0) return { hit: true, pen: -680.0 - x, nx: 1, nz: 0 };
    if (x > 680.0) return { hit: true, pen: x - 680.0, nx: -1, nz: 0 };
    if (z < -680.0) return { hit: true, pen: -680.0 - z, nx: 0, nz: 1 };
    if (z > 680.0) return { hit: true, pen: z - 680.0, nx: 0, nz: -1 };

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

    // 1. Outer park safety boundary (`+/-680m`)
    const extX = Math.abs(rx) * halfW + Math.abs(fx) * halfL;
    const extZ = Math.abs(rz) * halfW + Math.abs(fz) * halfL;
    if (carX - extX < -680.0) recordHit(-680.0 - (carX - extX), 1, 0, -680.0, carZ);
    if (carX + extX > 680.0) recordHit((carX + extX) - 680.0, -1, 0, 680.0, carZ);
    if (carZ - extZ < -680.0) recordHit(-680.0 - (carZ - extZ), 0, 1, carX, -680.0);
    if (carZ + extZ > 680.0) recordHit((carZ + extZ) - 680.0, 0, -1, carX, 680.0);

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
    slingshotCurve,
    groundData,
    skywayData,
    slingshotData,
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
