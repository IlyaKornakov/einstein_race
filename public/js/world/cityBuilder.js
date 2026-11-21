/**
 * AAA Architectural City World, glTF Botanical Foliage & Relativistic Landmarks
 * =============================================================================
 *
 * Constructs the 3D urban Grand Prix world with:
 *   - Real `.glb` botanical trees (`broadleaf_tree.glb` SpeedTree, `quiver_tree.glb`,
 *     `potted_plant.glb`) — ZERO icosahedron/Minecraft placeholder trees!
 *   - Real `.glb` street & racing props (`Lantern.glb`, `street_lamp_modern.glb`,
 *     `gothic_statue.glb`, `marble_bust.glb`, `horse_statue.glb`, `wall_clock.glb`,
 *     `old_tyre.glb`, `traffic_cone.glb`, `coffee_cart.glb`)
 *   - Generous Relativistic Roadside Artifacts:
 *       1. Grand Prix Start/Finish Chequered Gantry (Z = +94)
 *       2. 845nm Invisible-at-Rest Near-Infrared Speed Detector Gates (Boulevard & Skyway)
 *       3. Roadside Synchronized Clock & 0.75 Hz Optical Light-Wave Pylons (Loop & Skyway)
 *       4. Terrell-Rotation Classical Statue & Marble Bust Colonnades
 *       5. Giant 35m Rotating Observation Ferris Wheel (GPU-retarded spoke bending!)
 *       6. Twin 38m Skyline Wind Turbines (GPU-retarded blade curvature!)
 */

import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import { createTrackSystem } from './trackBuilder.js?v=1.4';
import { IS_MOBILE_DEVICE } from '../render/renderer.js?v=1.4';

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler();

function makeSubdividedBox(w, h, d, uvScale = 0.25, maxEdge = 1.6, uvRect = null) {
  const sx = Math.max(1, Math.ceil(w / maxEdge));
  const sy = Math.max(1, Math.ceil(h / maxEdge));
  const sz = Math.max(1, Math.ceil(d / maxEdge));
  const geo = new THREE.BoxGeometry(w, h, d, sx, sy, sz);

  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');

  if (uvRect) {
    const [u0, v0, u1, v1] = uvRect;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nrm.getX(i));
      const ny = Math.abs(nrm.getY(i));
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      if (ny > 0.7) {
        uv.setXY(i, (px + w * 0.5) * uvScale, (pz + d * 0.5) * uvScale);
      } else if (nx > 0.7) {
        uv.setXY(i, (pz + d * 0.5) * uvScale, (py + h * 0.5) * uvScale);
      } else {
        uv.setXY(i, (px + w * 0.5) * uvScale, (py + h * 0.5) * uvScale);
      }
    }
  }

  geo.setAttribute('uv1', uv.clone());
  return geo;
}

function pushTransformed(bucket, geo, x, y, z, yaw = 0, pitch = 0, roll = 0) {
  _euler.set(pitch, -yaw, roll, 'YXZ');
  _quat.setFromEuler(_euler);
  _pos.set(x, y, z);
  _mat4.compose(_pos, _quat, _scale);
  geo.applyMatrix4(_mat4);
  bucket.push(geo);
}

/**
 * Extracts meshes from a loaded glTF scene into geometry/material pairs ready for `InstancedMesh`.
 */
function extractGLBMeshes(gltf, shaderSystem, {
  scale = 1.0,
  rotX = 0.0,
  rotY = 0.0,
  offsetY = 0.0,
  filterFn = null,
  matOptsFn = null,
} = {}) {
  if (!gltf || !gltf.scene) return [];
  const list = [];
  const preMat = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ'));
  preMat.compose(new THREE.Vector3(0, offsetY, 0), q, new THREE.Vector3(scale, scale, scale));

  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((child) => {
    if (!child.isMesh) return;
    if (filterFn && !filterFn(child)) return;

    const g = child.geometry.clone();
    // Strip unused Blender shape keys & explicit tangents so InstancedMesh uses minimal varyings & no morphs!
    g.morphAttributes = {};
    g.morphTargetsRelative = false;
    if (g.attributes && g.attributes.tangent) {
      g.deleteAttribute('tangent');
    }
    g.applyMatrix4(child.matrixWorld);
    g.applyMatrix4(preMat);
    if (!g.getAttribute('uv1') && g.getAttribute('uv')) {
      g.setAttribute('uv1', g.getAttribute('uv'));
    }

    const srcMat = Array.isArray(child.material) ? child.material[0] : child.material;
    let m = srcMat.clone();
    // Avoid expensive full-scene 2nd renderTransmissionPass on small clock/lamp glass panes
    if (m.transmission && m.transmission > 0) {
      m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.35;
    }
    if (IS_MOBILE_DEVICE && m.isMeshPhysicalMaterial) {
      m = new THREE.MeshStandardMaterial({
        name: m.name,
        color: m.color,
        map: m.map,
        normalMap: m.normalMap,
        roughnessMap: m.roughnessMap,
        metalnessMap: m.metalnessMap,
        aoMap: m.aoMap,
        emissive: m.emissive,
        emissiveMap: m.emissiveMap,
        emissiveIntensity: m.emissiveIntensity,
        roughness: m.roughness,
        metalness: m.metalness,
        transparent: m.transparent,
        opacity: m.opacity,
        alphaTest: m.alphaTest,
        side: m.side,
      });
    }
    const matOpts = matOptsFn ? (matOptsFn(m, child) || {}) : {};
    shaderSystem.patchMaterial(m, shaderSystem.staticEntityUniforms, matOpts);
    list.push({ geo: g, mat: m });
  });
  return list;
}

function addInstancedGLB(root, meshPairs, poses, { castShadow = true, receiveShadow = true } = {}) {
  if (!meshPairs.length || !poses.length) return;
  for (const mp of meshPairs) {
    const inst = new THREE.InstancedMesh(mp.geo, mp.mat, poses.length);
    inst.castShadow = castShadow;
    inst.receiveShadow = receiveShadow;
    inst.frustumCulled = false;
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      _pos.set(p.x, p.y, p.z);
      _euler.set(p.pitch || 0, -(p.yaw || 0), p.roll || 0, 'YXZ');
      _quat.setFromEuler(_euler);
      const s = p.scale ?? 1.0;
      _scale.set(s, s, s);
      _mat4.compose(_pos, _quat, _scale);
      inst.setMatrixAt(i, _mat4);
    }
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);
  }
  _scale.set(1, 1, 1);
}

export function buildCityWorld(materials, shaderSystem) {
  const root = new THREE.Group();
  root.name = 'RelativisticCityWorld';

  // 1. Build Flowing Grand Prix Circuit & Multi-Level Skyway
  const track = createTrackSystem(materials, shaderSystem);
  root.add(track.group);

  // Surrounding Park Lawn Ground Plane (with sculpted basins for the Infield Reflecting Lagoons!)
  {
    const parkSegs = IS_MOBILE_DEVICE ? 84 : 160;
    const groundGeo = new THREE.PlaneGeometry(980, 980, parkSegs, parkSegs);
    groundGeo.rotateX(-Math.PI * 0.5);
    const pos = groundGeo.getAttribute('position');
    const uv = groundGeo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      let vy = 0.0;
      for (const lg of track.lagoons) {
        const dNorm = ((vx - lg.cx) / lg.sandRX) ** 2 + ((vz - lg.cz) / lg.sandRZ) ** 2;
        if (dNorm < 1.0) {
          vy = Math.min(vy, -0.32 * (1.0 - dNorm));
        }
      }
      pos.setY(i, vy);
      uv.setXY(i, uv.getX(i) * 120.0, uv.getY(i) * 120.0);
    }
    groundGeo.computeVertexNormals();
    groundGeo.setAttribute('uv1', uv.clone());
    const parkMesh = new THREE.Mesh(groundGeo, materials.parkGrass);
    parkMesh.position.y = -0.08;
    parkMesh.receiveShadow = true;
    parkMesh.frustumCulled = false;
    root.add(parkMesh);

    // Build Subdivided Sand-Trap Beaches & Shimmering Reflecting Water Lagoons
    const makeSubdividedEllipse = (rx, rz, rings = 14, segs = 48, uvScale = 0.14) => {
      const verts = [0, 0, 0];
      const nrms = [0, 1, 0];
      const uvsArr = [0.5, 0.5];
      const idxArr = [];
      for (let r = 1; r <= rings; r++) {
        const f = r / rings;
        for (let s = 0; s <= segs; s++) {
          const ang = (s / segs) * Math.PI * 2.0;
          const x = Math.cos(ang) * rx * f;
          const z = Math.sin(ang) * rz * f;
          verts.push(x, 0, z);
          nrms.push(0, 1, 0);
          uvsArr.push(x * uvScale, z * uvScale);
        }
      }
      const stride = segs + 1;
      for (let s = 0; s < segs; s++) {
        idxArr.push(0, 1 + s + 1, 1 + s);
      }
      for (let r = 1; r < rings; r++) {
        const base0 = 1 + (r - 1) * stride;
        const base1 = 1 + r * stride;
        for (let s = 0; s < segs; s++) {
          idxArr.push(base0 + s, base0 + s + 1, base1 + s);
          idxArr.push(base0 + s + 1, base1 + s + 1, base1 + s);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrms, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvsArr, 2));
      g.setAttribute('uv1', new THREE.Float32BufferAttribute(uvsArr, 2));
      g.setIndex(idxArr);
      return g;
    };

    for (const lg of track.lagoons) {
      const sandMesh = new THREE.Mesh(
        makeSubdividedEllipse(lg.sandRX, lg.sandRZ, 14, 48, 0.16),
        materials.sandBeach
      );
      sandMesh.position.set(lg.cx, -0.068, lg.cz);
      sandMesh.receiveShadow = true;
      sandMesh.frustumCulled = false;
      root.add(sandMesh);

      const waterMesh = new THREE.Mesh(
        makeSubdividedEllipse(lg.waterRX, lg.waterRZ, 16, 48, 0.10),
        materials.waterLagoon
      );
      waterMesh.position.set(lg.cx, -0.042, lg.cz);
      waterMesh.receiveShadow = true;
      waterMesh.frustumCulled = false;
      root.add(waterMesh);
    }
  }

  const buckets = {
    brickFacade: [],
    brickWarm: [],
    stoneAshlar: [],
    stoneCream: [],
    roofTiles: [],
    windowAtlas: [],
    skyscraperGlass: [],
    sidewalkCobble: [],
    highwayConcrete: [],
    darkIron: [],
    brushedSteel: [],
    stayCableWhite: [],
    brassGold: [],
    awningRed: [],
    awningNavy: [],
    signalRed632: [],
    signalAmber590: [],
    signalGreen525: [],
    signalIR845: [],
    syncPulseCyan: [],
    warmLampBulb: [],
  };

  function isFootprintClear(cx, cz, radius) {
    // Keep Clock Tower Plaza open
    if (cx > -46.0 - radius && cx < -8.0 + radius && cz > -66.0 - radius && cz < -12.0 + radius) {
      return false;
    }
    // Keep Ferris Wheel Plaza clear
    if (Math.hypot(cx - 52.0, cz - (-94.0)) < 16.0 + radius) {
      return false;
    }
    // Keep Cable-Stayed Bridge Tower pad clear
    if (Math.hypot(cx - (-48.0), cz - (-70.0)) < 13.5 + radius) {
      return false;
    }
    // Keep Infield Horse Meadow clear (`(56, 82)`)
    if (Math.hypot(cx - 56.0, cz - 82.0) < 19.5 + radius) {
      return false;
    }
    // Keep Infield Reflecting Lagoons & Sand Traps clear
    for (const lg of track.lagoons) {
      const rx = lg.sandRX + radius + 2.5;
      const rz = lg.sandRZ + radius + 2.5;
      if (((cx - lg.cx) / rx) ** 2 + ((cz - lg.cz) / rz) ** 2 < 1.0) {
        return false;
      }
    }
    // Keep Bullet Train Viaduct corridor (Z = -78) clear
    if (Math.abs(cz - (-78.0)) < 5.8 + radius) {
      return false;
    }
    if (track.minDistToRibbon2D(cx, cz, 'ground').dist < 12.8 + radius) return false;
    if (track.minDistToRibbon2D(cx, cz, 'skyway').dist < 8.6 + radius) return false;
    return true;
  }

  // --- 2. Haussmann & Glass Skyscraper Architecture ---
  const planterPoses = [];

  function addHaussmannBuilding(cx, cz, yaw, width, depth, floors, styleIdx) {
    const groundH = 4.2;
    const floorH = 3.45;
    const upperH = floors * floorH;
    const totalWallH = groundH + upperH;

    track.registerSolidBox(cx, cz, width * 0.5 + 0.15, depth * 0.5 + 0.15, yaw, totalWallH + 3.0);

    const wallBucket =
      styleIdx % 3 === 0 ? buckets.brickFacade :
      styleIdx % 3 === 1 ? buckets.stoneCream :
      buckets.brickWarm;
    const trimBucket = styleIdx % 2 === 0 ? buckets.stoneAshlar : buckets.stoneCream;

    pushTransformed(trimBucket, makeSubdividedBox(width, groundH, depth, 0.24, 1.7), cx, groundH * 0.5, cz, yaw);
    pushTransformed(wallBucket, makeSubdividedBox(width - 0.16, upperH, depth - 0.16, 0.28, 1.7), cx, groundH + upperH * 0.5, cz, yaw);

    for (const cy of [groundH, groundH + floorH * Math.min(2, floors - 1), totalWallH]) {
      pushTransformed(trimBucket, makeSubdividedBox(width + 0.55, 0.36, depth + 0.55, 0.3, 1.6), cx, cy, cz, yaw);
    }

    const fwdX = Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = Math.sin(yaw);

    // Sculpted vertical limestone corner pilasters (frames facades cleanly instead of raw box edges!)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = cx + rightX * (sx * (width * 0.5 - 0.18)) + fwdX * (sz * (depth * 0.5 - 0.18));
        const pz = cz + rightZ * (sx * (width * 0.5 - 0.18)) + fwdZ * (sz * (depth * 0.5 - 0.18));
        pushTransformed(trimBucket, makeSubdividedBox(0.62, totalWallH, 0.62, 0.25, 1.8), px, totalWallH * 0.5, pz, yaw);
      }
    }

    // Pitched Parisian Mansard Roof + Chimneys + Rooftop Skylight/HVAC details
    const roofH = 2.8;
    pushTransformed(buckets.roofTiles, makeSubdividedBox(width - 0.45, roofH * 0.55, depth - 0.45, 0.32, 1.7), cx, totalWallH + roofH * 0.275, cz, yaw);
    pushTransformed(buckets.roofTiles, makeSubdividedBox(width - 1.35, roofH * 0.45, depth - 1.35, 0.32, 1.7), cx, totalWallH + roofH * 0.775, cz, yaw);
    pushTransformed(trimBucket, makeSubdividedBox(width - 1.25, 0.18, depth - 1.25, 0.3, 1.6), cx, totalWallH + roofH + 0.08, cz, yaw);

    for (const chSide of [-1, 1]) {
      const chX = cx + rightX * (chSide * (width * 0.32));
      const chZ = cz + rightZ * (chSide * (width * 0.32));
      pushTransformed(wallBucket, makeSubdividedBox(0.95, 1.85, 0.75, 0.3, 1.2), chX, totalWallH + roofH + 0.85, chZ, yaw);
      pushTransformed(trimBucket, makeSubdividedBox(1.12, 0.16, 0.92, 0.3, 1.0), chX, totalWallH + roofH + 1.82, chZ, yaw);
    }

    const nCols = Math.max(2, Math.floor((width - 1.6) / 3.2));
    const colSpacing = (width - 2.2) / Math.max(1, nCols - 1);

    for (const faceSign of [1, -1]) {
      const faceDist = (depth * 0.5) * faceSign;
      const faceYaw = faceSign > 0 ? yaw : yaw + Math.PI;

      for (let c = 0; c < nCols; c++) {
        const lx = nCols === 1 ? 0 : -((width - 2.2) * 0.5) + c * colSpacing;
        const wx = cx + rightX * lx + fwdX * (faceDist + 0.04 * faceSign);
        const wz = cz + rightZ * lx + fwdZ * (faceDist + 0.04 * faceSign);

        const isDoor = c === Math.floor(nCols * 0.5);
        const rect = isDoor ? [0.52, 0.02, 0.98, 0.48] : [0.02, 0.02, 0.48, 0.48];
        pushTransformed(buckets.windowAtlas, makeSubdividedBox(isDoor ? 1.65 : 2.35, 2.95, 0.14, 1.0, 1.5, rect), wx, 1.58, wz, faceYaw);

        if (!isDoor && faceSign > 0 && (c + styleIdx) % 2 === 0) {
          const awnBucket = (styleIdx + c) % 2 === 0 ? buckets.awningRed : buckets.awningNavy;
          const ax = cx + rightX * lx + fwdX * (faceDist + 0.68);
          const az = cz + rightZ * lx + fwdZ * (faceDist + 0.68);
          pushTransformed(awnBucket, makeSubdividedBox(2.55, 0.24, 1.25, 0.5, 1.4), ax, 3.22, az, faceYaw, 0.28, 0);

          if (!IS_MOBILE_DEVICE && planterPoses.length < 24 && c === 0) {
            const ppx = cx + rightX * (lx - 1.15) + fwdX * (faceDist + 0.58);
            const ppz = cz + rightZ * (lx - 1.15) + fwdZ * (faceDist + 0.58);
            const ppy = track.getSupportSurface(ppx, 1.0, ppz).y - 0.01;
            planterPoses.push({
              x: ppx,
              y: ppy,
              z: ppz,
              yaw: faceYaw,
              scale: 1.15,
            });
          }
        }
      }

      for (let f = 0; f < floors; f++) {
        const wy = groundH + f * floorH + 1.72;
        for (let c = 0; c < nCols; c++) {
          const lx = nCols === 1 ? 0 : -((width - 2.2) * 0.5) + c * colSpacing;
          const wx = cx + rightX * lx + fwdX * (faceDist + 0.02 * faceSign);
          const wz = cz + rightZ * lx + fwdZ * (faceDist + 0.02 * faceSign);

          const hash = Math.abs(Math.sin(cx * 13.7 + cz * 7.3 + f * 19.1 + c * 31.7));
          const rect = hash > 0.56 ? [0.52, 0.52, 0.98, 0.98] : [0.02, 0.52, 0.48, 0.98];
          pushTransformed(buckets.windowAtlas, makeSubdividedBox(1.52, 2.15, 0.12, 1.0, 1.4, rect), wx, wy, wz, faceYaw);
          // Stone sill & upper lintel hood
          pushTransformed(trimBucket, makeSubdividedBox(1.82, 0.16, 0.30, 0.4, 1.2), wx + fwdX * 0.09 * faceSign, wy - 1.12, wz + fwdZ * 0.09 * faceSign, faceYaw);
          pushTransformed(trimBucket, makeSubdividedBox(1.86, 0.20, 0.28, 0.4, 1.2), wx + fwdX * 0.08 * faceSign, wy + 1.14, wz + fwdZ * 0.08 * faceSign, faceYaw);

          // Open Wrought-Iron Parisian Balcony (stone deck + slender iron handrail & balusters — NOT a solid black box!)
          if (faceSign > 0 && f === 1) {
            const bOut = 0.34;
            const bx = wx + fwdX * bOut;
            const bz = wz + fwdZ * bOut;
            pushTransformed(trimBucket, makeSubdividedBox(1.96, 0.14, 0.62, 0.4, 1.0), bx, wy - 1.12, bz, faceYaw);
            // Top & bottom iron rails
            const railFrontX = wx + fwdX * (bOut + 0.27);
            const railFrontZ = wz + fwdZ * (bOut + 0.27);
            pushTransformed(buckets.darkIron, makeSubdividedBox(1.94, 0.06, 0.06, 0.5, 1.0), railFrontX, wy - 0.26, railFrontZ, faceYaw);
            for (const postOff of [-0.88, -0.44, 0.0, 0.44, 0.88]) {
              pushTransformed(
                buckets.darkIron,
                makeSubdividedBox(0.05, 0.82, 0.05, 0.5, 1.0),
                railFrontX + rightX * postOff,
                wy - 0.68,
                railFrontZ + rightZ * postOff,
                faceYaw
              );
            }
          }
        }
      }
    }
  }

  function addGlassSkyscraper(cx, cz, yaw, width, depth, height) {
    track.registerSolidBox(cx, cz, (width + 1.2) * 0.5, (depth + 1.2) * 0.5, yaw, height + 12.0);
    pushTransformed(buckets.stoneAshlar, makeSubdividedBox(width + 1.2, 5.2, depth + 1.2, 0.22, 1.8), cx, 2.6, cz, yaw);
    const mainH = height - 5.2;
    pushTransformed(buckets.skyscraperGlass, makeSubdividedBox(width, mainH, depth, 0.075, 2.2), cx, 5.2 + mainH * 0.5, cz, yaw);
    pushTransformed(buckets.skyscraperGlass, makeSubdividedBox(width * 0.72, 5.5, depth * 0.72, 0.09, 2.0), cx, height + 2.75, cz, yaw);
    const spireGeo = new THREE.CylinderGeometry(0.12, 0.35, 11.0, 8, 6);
    spireGeo.setAttribute('uv1', spireGeo.getAttribute('uv'));
    pushTransformed(buckets.brushedSteel, spireGeo, cx, height + 11.0, cz, 0);
  }

  const placedCenters = [];
  const frames = track.groundData.frames;
  let styleCounter = 0;

  for (let i = 0; i < frames.length; i += 16) {
    const f = frames[i];
    for (const side of [-1, 1]) {
      const bWidth = 12.5 + ((styleCounter * 7) % 5) * 1.6;
      const bDepth = 11.5 + ((styleCounter * 3) % 4) * 1.4;
      const setback = 13.4 + bDepth * 0.5 + 1.2;

      const bx = f.pos.x + f.right.x * side * setback;
      const bz = f.pos.z + f.right.z * side * setback;
      const radius = Math.hypot(bWidth, bDepth) * 0.5;

      let tooClose = false;
      for (const prev of placedCenters) {
        if (Math.hypot(bx - prev.x, bz - prev.z) < radius + prev.r - 1.2) {
          tooClose = true;
          break;
        }
      }
      if (tooClose || !isFootprintClear(bx, bz, radius * 0.86)) continue;

      const toStreetX = -f.right.x * side;
      const toStreetZ = -f.right.z * side;
      const faceYaw = Math.atan2(toStreetX, -toStreetZ);

      if (bx > 92.0 && styleCounter % 2 === 0) {
        const towerH = 34.0 + (styleCounter % 4) * 9.5;
        addGlassSkyscraper(bx, bz, faceYaw, bWidth * 1.05, bDepth * 1.05, towerH);
      } else {
        const floors = 3 + (styleCounter % 3);
        addHaussmannBuilding(bx, bz, faceYaw, bWidth, bDepth, floors, styleCounter);
      }
      placedCenters.push({ x: bx, z: bz, r: radius });
      styleCounter++;
    }
  }

  for (const [tx, tz, tw, td, th] of [
    [62.0, -42.0, 17.5, 17.5, 50.0],
    [94.0, 8.0, 16.5, 16.5, 44.0],
    [54.0, 22.0, 15.5, 15.5, 38.0],
    [-28.0, 82.0, 16.0, 14.0, 40.0],
  ]) {
    if (isFootprintClear(tx, tz, Math.hypot(tw, td) * 0.5)) {
      addGlassSkyscraper(tx, tz, 0.25, tw, td, th);
    }
  }

  // --- 3. Grand Limestone Triumphal Arch (Z = -18, X = 0) ---
  {
    const archZ = -18.0;
    const pierX = 10.6;
    const pierW = 4.2, pierD = 6.2, pierH = 12.2;

    for (const sx of [-pierX, pierX]) {
      track.registerSolidBox(sx, archZ, pierW * 0.5 + 0.35, pierD * 0.5 + 0.35, 0.0, pierH);
      pushTransformed(buckets.stoneAshlar, makeSubdividedBox(pierW, pierH, pierD, 0.22, 1.2), sx, pierH * 0.5, archZ);
      for (const czOff of [-pierD * 0.5 - 0.35, pierD * 0.5 + 0.35]) {
        for (const cxOff of [-1.25, 1.25]) {
          const col = new THREE.CylinderGeometry(0.42, 0.48, pierH - 1.2, 12, 8);
          col.setAttribute('uv1', col.getAttribute('uv'));
          pushTransformed(buckets.stoneCream, col, sx + cxOff, (pierH - 1.2) * 0.5 + 0.6, archZ + czOff);
        }
      }
    }

    const spanW = (pierX + pierW * 0.5) * 2.0 + 0.8;
    pushTransformed(buckets.stoneCream, makeSubdividedBox(spanW, 2.4, pierD + 0.8, 0.22, 1.2), 0.0, pierH + 1.2, archZ);
    pushTransformed(buckets.stoneAshlar, makeSubdividedBox(spanW - 1.2, 3.0, pierD - 0.2, 0.22, 1.2), 0.0, pierH + 3.9, archZ);
    pushTransformed(buckets.stoneCream, makeSubdividedBox(spanW + 0.6, 0.55, pierD + 1.2, 0.25, 1.2), 0.0, pierH + 5.65, archZ);

    const archRadius = pierX - pierW * 0.5;
    for (let k = 0; k <= 12; k++) {
      const ang = (k / 12) * Math.PI;
      pushTransformed(
        buckets.stoneCream,
        makeSubdividedBox(1.8, 0.9, pierD - 0.3, 0.3, 1.1),
        Math.cos(ang) * (archRadius - 0.3),
        8.4 + Math.sin(ang) * 3.7,
        archZ,
        0, 0, ang - Math.PI * 0.5
      );
    }
  }

  // Helper to attach live GPU-retarded rotating clock hands onto any clock face in the city!
  function addRetardedClockHands(fx, fy, fz, nx, nz, rotY, radiusScale = 1.0) {
    const pivot = new THREE.Vector3(fx + nx * 0.07, fy, fz + nz * 0.07);
    const axis = new THREE.Vector3(-nx, 0, -nz);

    const secUniforms = shaderSystem.createEntityUniforms({
      isDynamic: false,
      clockSpinOmega: (2.0 * Math.PI) / 10.0, // 1 rev per 10s city time for unmistakable Doppler/dilation!
      clockPivot: pivot,
      clockAxis: axis,
    });
    const secMat = shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0xd92626, emissive: 0xff3322, emissiveIntensity: 0.9, roughness: 0.3 }),
      secUniforms
    );
    const secGeo = new THREE.BoxGeometry(0.09 * radiusScale, 1.65 * radiusScale, 0.05, 1, 4, 1);
    secGeo.translate(0, 0.68 * radiusScale, 0);
    const secMesh = new THREE.Mesh(secGeo, secMat);
    secMesh.position.copy(pivot);
    secMesh.rotation.y = rotY;
    secMesh.frustumCulled = false;
    root.add(secMesh);

    const minUniforms = shaderSystem.createEntityUniforms({
      isDynamic: false,
      clockSpinOmega: (2.0 * Math.PI) / 60.0,
      clockPivot: pivot,
      clockAxis: axis,
    });
    const minMat = shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.7 }),
      minUniforms
    );
    const minGeo = new THREE.BoxGeometry(0.14 * radiusScale, 1.22 * radiusScale, 0.06, 1, 3, 1);
    minGeo.translate(0, 0.48 * radiusScale, 0);
    const minMesh = new THREE.Mesh(minGeo, minMat);
    minMesh.position.copy(pivot).addScaledVector(new THREE.Vector3(nx, 0, nz), 0.03);
    minMesh.rotation.y = rotY;
    minMesh.frustumCulled = false;
    root.add(minMesh);
  }

  // --- 4. Clock Tower Plaza & Walkable 14-Step Grand Stone Staircase ---
  {
    pushTransformed(buckets.sidewalkCobble, makeSubdividedBox(33.0, 0.32, 48.0, 0.22, 1.8), -26.5, 0.0, -38.0);
    pushTransformed(buckets.stoneAshlar, makeSubdividedBox(12.5, 2.80, 30.0, 0.22, 1.5), -35.2, 1.40, -38.0);
    // Register vertical West/North/South 2.8m retaining walls of the raised Observation Terrace
    // (`maxY = 2.15` so ground cars bounce off the cliff while cars atop the 2.80m terrace drive freely!)
    track.registerSolidBox(-41.2, -38.0, 0.45, 15.1, 0.0, 2.15);
    track.registerSolidBox(-35.2, -52.8, 6.3, 0.45, 0.0, 2.15);
    track.registerSolidBox(-35.2, -23.2, 6.3, 0.45, 0.0, 2.15);

    const numSteps = 14;
    const stepRun = 10.0 / numSteps;
    for (let s = 0; s < numSteps; s++) {
      const topY = 0.16 + ((s + 1) / numSteps) * 2.64;
      pushTransformed(buckets.stoneCream, makeSubdividedBox(stepRun + 0.08, topY, 27.6, 0.28, 1.5), -19.0 - (s + 0.5) * stepRun, topY * 0.5, -38.0);
    }

    for (const bz of [-52.2, -23.8]) {
      track.registerSolidBox(-24.0, bz, 5.5, 0.45, 0.0, 3.2);
      pushTransformed(buckets.stoneAshlar, makeSubdividedBox(11.0, 1.25, 0.75, 0.3, 1.4), -24.0, 2.1, bz, 0, 0, 0.255);
    }

    // Monumental Plaza Plinth for Bronze Equestrian Horse Statue (`horse_statue.glb`)!
    track.registerSolidBox(-15.5, -23.5, 1.75, 1.25, 0.0, 4.5);
    pushTransformed(buckets.stoneCream, makeSubdividedBox(3.4, 1.85, 2.4, 0.3, 1.2), -15.5, 0.92, -23.5);
    pushTransformed(buckets.brassGold, makeSubdividedBox(2.9, 0.18, 1.9, 0.4, 1.0), -15.5, 1.90, -23.5);

    const cTx = -35.5, cTz = -55.0;
    track.registerSolidBox(cTx, cTz, 3.75, 3.75, 0.0, 42.0);
    pushTransformed(buckets.stoneAshlar, makeSubdividedBox(6.8, 28.0, 6.8, 0.22, 1.5), cTx, 14.0, cTz);
    pushTransformed(buckets.stoneCream, makeSubdividedBox(7.5, 5.6, 7.5, 0.24, 1.4), cTx, 29.8, cTz);
    const spire = new THREE.ConeGeometry(4.8, 8.5, 4, 6);
    spire.rotateY(Math.PI * 0.25);
    spire.setAttribute('uv1', spire.getAttribute('uv'));
    pushTransformed(buckets.roofTiles, spire, cTx, 36.8, cTz);

    for (const fc of [
      { nx: 1, nz: 0, rotY: Math.PI * 0.5 },
      { nx: -1, nz: 0, rotY: -Math.PI * 0.5 },
      { nx: 0, nz: 1, rotY: 0 },
      { nx: 0, nz: -1, rotY: Math.PI },
    ]) {
      const fx = cTx + fc.nx * 3.82;
      const fz = cTz + fc.nz * 3.82;
      const dialGeo = new THREE.PlaneGeometry(4.4, 4.4, 4, 4);
      dialGeo.setAttribute('uv1', dialGeo.getAttribute('uv'));
      const dialMesh = new THREE.Mesh(dialGeo, materials.clockDial);
      dialMesh.position.set(fx, 29.8, fz);
      dialMesh.rotation.y = fc.rotY;
      dialMesh.frustumCulled = false;
      root.add(dialMesh);
      addRetardedClockHands(fx, 29.8, fz, fc.nx, fc.nz, fc.rotY, 1.0);
    }
  }

  // --- 5. Grand Prix Chequered Start / Finish Timing Gantry (Z = +94) + 845nm Infrared Speed Gates! ---
  {
    // Start / Finish Gantry at Z = +94.0
    const sfZ = 94.0;
    for (const sx of [-10.2, 10.2]) {
      track.registerSolidCylinder(sx, sfZ, 0.36, 7.6);
      const col = new THREE.CylinderGeometry(0.28, 0.34, 7.6, 10, 4);
      col.setAttribute('uv1', col.getAttribute('uv'));
      pushTransformed(buckets.brushedSteel, col, sx, 3.8, sfZ);
    }
    pushTransformed(buckets.darkIron, makeSubdividedBox(21.2, 0.55, 0.55, 0.4, 1.5), 0.0, 7.2, sfZ);

    const banner = new THREE.Mesh(new THREE.BoxGeometry(14.5, 2.4, 0.22, 18, 4, 1), materials.signStartFinish);
    banner.position.set(0.0, 6.95, sfZ + 0.25);
    banner.frustumCulled = false;
    root.add(banner);

    // Start/Finish Gantry Race Lights (632nm Red, 590nm Amber, 525nm Green + Sync Beacons)
    for (const lx of [-5.2, -2.6, 2.6, 5.2]) {
      const rLens = new THREE.SphereGeometry(0.22, 10, 8);
      rLens.setAttribute('uv1', rLens.getAttribute('uv'));
      pushTransformed(buckets.signalRed632, rLens, lx, 5.45, sfZ + 0.24);
      const gLens = new THREE.SphereGeometry(0.20, 10, 8);
      gLens.setAttribute('uv1', gLens.getAttribute('uv'));
      pushTransformed(buckets.signalGreen525, gLens, lx, 4.95, sfZ + 0.24);
    }

    // 845nm Invisible-at-Rest Near-Infrared Relativistic Speed Gate at Z = +2.0 (Grand Boulevard)!
    const irZ = 2.0;
    for (const sx of [-10.0, 10.0]) {
      track.registerSolidCylinder(sx, irZ, 0.32, 7.2);
      const col = new THREE.CylinderGeometry(0.24, 0.30, 7.2, 10, 4);
      col.setAttribute('uv1', col.getAttribute('uv'));
      pushTransformed(buckets.darkIron, col, sx, 3.6, irZ);
    }
    pushTransformed(buckets.darkIron, makeSubdividedBox(20.6, 0.45, 0.45, 0.4, 1.5), 0.0, 6.8, irZ);
    const irSign = new THREE.Mesh(new THREE.BoxGeometry(12.6, 2.0, 0.20, 16, 4, 1), materials.signIRDetector);
    irSign.position.set(0.0, 6.85, irZ + 0.22);
    irSign.frustumCulled = false;
    root.add(irSign);

    for (const lx of [-6.8, -4.5, -2.2, 2.2, 4.5, 6.8]) {
      pushTransformed(buckets.darkIron, makeSubdividedBox(0.52, 0.52, 0.32, 0.5, 0.5), lx, 5.45, irZ);
      const irLens = new THREE.SphereGeometry(0.23, 10, 8);
      irLens.setAttribute('uv1', irLens.getAttribute('uv'));
      pushTransformed(buckets.signalIR845, irLens, lx, 5.45, irZ + 0.18);
    }
  }

  // --- 6. Giant 35m Rotating Observation Ferris Wheel ("Relativistic Wheel") at (X = +52, Z = -94) ---
  // Demonstrates GPU-retarded radial spoke bending (t_emit = t_obs - u/c) & limb Doppler shift!
  {
    const wx = 52.0, wy = 20.5, wz = -94.0;
    const wheelR = 17.2;

    // Static A-frame support legs & boarding platform
    track.registerSolidBox(wx, wz, 7.0, 5.0, 0.0, 22.0);
    pushTransformed(buckets.stoneCream, makeSubdividedBox(14.0, 1.2, 10.0, 0.25, 1.6), wx, 0.6, wz);
    for (const zSide of [-2.4, 2.4]) {
      for (const xLeg of [-1, 1]) {
        const legGeo = new THREE.CylinderGeometry(0.38, 0.58, 22.8, 10, 8);
        legGeo.setAttribute('uv1', legGeo.getAttribute('uv'));
        pushTransformed(buckets.stayCableWhite, legGeo, wx + xLeg * 5.2, 10.8, wz + zSide, 0, 0, -xLeg * 0.23);
      }
    }
    const axleGeo = new THREE.CylinderGeometry(0.75, 0.75, 5.6, 12, 2);
    axleGeo.rotateX(Math.PI * 0.5);
    axleGeo.setAttribute('uv1', axleGeo.getAttribute('uv'));
    pushTransformed(buckets.brushedSteel, axleGeo, wx, wy, wz);

    // Rotating Ferris Wheel Rim, 20 Tension Spokes & Gondola Beacons (retarded in GLSL via uClockSpinOmega!)
    const wheelPivot = new THREE.Vector3(wx, wy, wz);
    const wheelUniforms = shaderSystem.createEntityUniforms({
      isDynamic: false,
      clockSpinOmega: 0.42, // brisk relativistic demonstration spin
      clockPivot: wheelPivot,
      clockAxis: new THREE.Vector3(0, 0, 1),
    });

    const wheelSteelMat = shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.28, metalness: 0.8 }),
      wheelUniforms
    );
    const wheelNeonMat = shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x38bdf8, emissiveIntensity: 2.8, roughness: 0.2 }),
      wheelUniforms,
      { narrowBandNm: 515.0 }
    );

    const wheelParts = [];
    const neonParts = [];
    const nSpokes = 20;

    for (const zRim of [-1.35, 1.35]) {
      const torus = new THREE.TorusGeometry(wheelR, 0.28, 8, 56);
      torus.translate(wx, wy, wz + zRim);
      torus.setAttribute('uv1', torus.getAttribute('uv'));
      wheelParts.push(torus);

      const innerTorus = new THREE.TorusGeometry(wheelR * 0.72, 0.16, 6, 44);
      innerTorus.translate(wx, wy, wz + zRim);
      innerTorus.setAttribute('uv1', innerTorus.getAttribute('uv'));
      wheelParts.push(innerTorus);
    }

    for (let i = 0; i < nSpokes; i++) {
      const ang = (i / nSpokes) * Math.PI * 2.0;
      const cx = wx + Math.cos(ang) * wheelR;
      const cy = wy + Math.sin(ang) * wheelR;

      // Subdivided radial spoke (8 segments along radius so retarded spoke curvature is super smooth!)
      for (const zRim of [-1.35, 1.35]) {
        const spk = new THREE.CylinderGeometry(0.08, 0.08, wheelR, 6, 8);
        spk.translate(0, wheelR * 0.5, 0);
        spk.rotateZ(ang - Math.PI * 0.5);
        spk.translate(wx, wy, wz + zRim);
        spk.setAttribute('uv1', spk.getAttribute('uv'));
        wheelParts.push(spk);
      }

      // Crossbar & glowing gondola capsule at rim
      const pod = new THREE.CylinderGeometry(0.75, 0.75, 2.5, 10, 2);
      pod.rotateX(Math.PI * 0.5);
      pod.translate(cx, cy, wz);
      pod.setAttribute('uv1', pod.getAttribute('uv'));
      wheelParts.push(pod);

      const orb = new THREE.SphereGeometry(0.36, 8, 8);
      orb.translate(cx, cy, wz + 1.48);
      orb.setAttribute('uv1', orb.getAttribute('uv'));
      neonParts.push(orb);
    }

    const wMesh = new THREE.Mesh(mergeGeometries(wheelParts, false), wheelSteelMat);
    wMesh.castShadow = true;
    wMesh.frustumCulled = false;
    root.add(wMesh);

    const nMesh = new THREE.Mesh(mergeGeometries(neonParts, false), wheelNeonMat);
    nMesh.frustumCulled = false;
    root.add(nMesh);
  }

  // --- 7. Twin 38m Skyline 3-Blade Wind Turbines (GPU-Retarded Blade Bending!) ---
  for (const [tx, tz, rotY] of [
    [258.0, -90.0, -Math.PI * 0.5],
    [260.0, 56.0, -Math.PI * 0.5],
  ]) {
    const hubY = 36.0;
    track.registerSolidCylinder(tx, tz, 1.55, hubY);
    const tower = new THREE.CylinderGeometry(0.65, 1.55, hubY, 14, 10);
    tower.setAttribute('uv1', tower.getAttribute('uv'));
    pushTransformed(buckets.stayCableWhite, tower, tx, hubY * 0.5, tz);

    const nacelle = new THREE.CylinderGeometry(0.95, 0.85, 4.2, 12, 2);
    nacelle.rotateZ(Math.PI * 0.5);
    nacelle.setAttribute('uv1', nacelle.getAttribute('uv'));
    pushTransformed(buckets.stayCableWhite, nacelle, tx, hubY, tz);

    const hubPivot = new THREE.Vector3(tx - 2.2, hubY, tz);
    const turbUniforms = shaderSystem.createEntityUniforms({
      isDynamic: false,
      clockSpinOmega: 1.35,
      clockPivot: hubPivot,
      clockAxis: new THREE.Vector3(-1, 0, 0),
    });
    const bladeMat = shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.2 }),
      turbUniforms
    );

    const bladeParts = [];
    const bladeLen = 14.2;
    for (let b = 0; b < 3; b++) {
      const ang = (b / 3) * Math.PI * 2.0;
      const bg = new THREE.BoxGeometry(0.18, bladeLen, 0.95, 1, 12, 1);
      bg.translate(0, bladeLen * 0.5, 0);
      bg.rotateX(ang);
      bg.translate(hubPivot.x, hubPivot.y, hubPivot.z);
      bg.setAttribute('uv1', bg.getAttribute('uv'));
      bladeParts.push(bg);
    }
    const bMesh = new THREE.Mesh(mergeGeometries(bladeParts, false), bladeMat);
    bMesh.castShadow = true;
    bMesh.frustumCulled = false;
    root.add(bMesh);
    void rotY;
  }

  // --- 8. Roadside Synchronized Clock & Optical-Wave Pylons + Terrell Statue Plinths ---
  const statuePoses = [];
  const bustPoses = [];
  const wallClockPoses = [];
  const syncPylons = [];

  // Place Synchronized Clock Pylons every ~82m around the Ground Loop
  for (let i = 24; i < frames.length; i += 66) {
    const f = frames[i];
    const side = (i % 132 === 24) ? -1 : 1;
    if (side > 0 && Math.abs(f.pos.x) < 12.0 && ((f.pos.z >= 6.0 && f.pos.z <= 72.0) || (f.pos.z >= 166.0 && f.pos.z <= 214.0))) continue;
    if (side < 0 && Math.abs(f.pos.x) < 10.0 && f.pos.z >= -60.0 && f.pos.z <= -18.0) continue;

    const px = f.pos.x + f.right.x * side * 9.5;
    const pz = f.pos.z + f.right.z * side * 9.5;
    if (track.minDistToRibbon2D(px, pz, 'skyway').dist < 7.0) continue;
    const py = track.getSupportSurface(px, f.pos.y + 1.5, pz).y;

    syncPylons.push({ x: px, y: py + 4.65, z: pz });
    track.registerSolidCylinder(px, pz, 0.28, py + 4.8);

    const post = new THREE.CylinderGeometry(0.18, 0.24, 4.4, 10, 4);
    post.setAttribute('uv1', post.getAttribute('uv'));
    pushTransformed(buckets.darkIron, post, px, py + 2.2, pz);

    // Crowning 0.75 Hz Synchronized Optical Wave Beacon!
    const beacon = new THREE.SphereGeometry(0.28, 10, 8);
    beacon.setAttribute('uv1', beacon.getAttribute('uv'));
    pushTransformed(buckets.syncPulseCyan, beacon, px, py + 4.65, pz);

    // Face clock along road toward approaching drivers!
    const faceDirX = -f.tan.x;
    const faceDirZ = -f.tan.z;
    const rotY = Math.atan2(faceDirX, faceDirZ);
    const yawOur = Math.atan2(faceDirX, -faceDirZ);

    wallClockPoses.push({ x: px + faceDirX * 0.22, y: py + 3.45, z: pz + faceDirZ * 0.22, yaw: yawOur, scale: 4.8 });
    addRetardedClockHands(px + faceDirX * 0.28, py + 3.45, pz + faceDirZ * 0.28, faceDirX, faceDirZ, rotY, 0.42);
  }

  // Also place Synchronized Optical Beacons & IR-845nm Mileposts along the Multi-Level Skyway!
  const skyFrames = track.skywayData.frames;
  const skyLampPoses = [];
  for (let i = 45; i < skyFrames.length - 45; i += 36) {
    const sf = skyFrames[i];
    for (const side of [-1, 1]) {
      const bx = sf.pos.x + sf.right.x * side * 6.55;
      const by = sf.pos.y + 0.96;
      const bz = sf.pos.z + sf.right.z * side * 6.55;

      // Modern Skyway Light Pole + Cobra-head fixture slot
      const pole = new THREE.CylinderGeometry(0.10, 0.14, 5.2, 8, 4);
      pole.setAttribute('uv1', pole.getAttribute('uv'));
      pushTransformed(buckets.brushedSteel, pole, bx, by + 2.6, bz);

      const inwardYaw = Math.atan2(-sf.right.x * side, sf.right.z * side);
      skyLampPoses.push({ x: bx, y: by + 4.8, z: bz, yaw: inwardYaw, scale: 1.35 });

      // Alternating Synchronized Cyan Wave Beacons & 845nm Infrared Speed Bollards along Skyway!
      const lens = new THREE.SphereGeometry(0.21, 8, 8);
      lens.setAttribute('uv1', lens.getAttribute('uv'));
      pushTransformed(
        i % 72 === 45 ? buckets.syncPulseCyan : buckets.signalIR845,
        lens,
        bx, by + 0.25, bz
      );
    }
  }

  // Place Classical Terrell-Rotation Statue & Marble Bust Pedestals along Grand Boulevard & Sweeper!
  const colonnadeSpots = [
    [-9.6, 136.0, Math.PI * 0.5, 'statue'],
    [9.6, 136.0, -Math.PI * 0.5, 'bust'],
    [-9.6, 108.0, Math.PI * 0.5, 'statue'],
    [9.6, 108.0, -Math.PI * 0.5, 'bust'],
    [-9.6, 78.0, Math.PI * 0.5, 'bust'],
    [9.6, 78.0, -Math.PI * 0.5, 'statue'],
    [-9.6, -4.0, Math.PI * 0.5, 'statue'],
    [-9.6, -68.0, Math.PI * 0.5, 'bust'],
    [10.2, -102.0, -Math.PI * 0.5, 'statue'],
    [28.0, -206.0, 0.35, 'statue'],
  ];
  for (const [sx, sz, sYaw, kind] of colonnadeSpots) {
    if (track.minDistToRibbon2D(sx, sz, 'skyway').dist < 7.0) continue;
    const baseSurfY = track.getSupportSurface(sx, 1.0, sz).y;
    track.registerSolidBox(sx, sz, 0.92, 0.92, 0.0, baseSurfY + 4.0);
    pushTransformed(buckets.stoneCream, makeSubdividedBox(1.55, 1.70, 1.55, 0.35, 1.0), sx, baseSurfY + 0.75, sz);
    pushTransformed(buckets.stoneAshlar, makeSubdividedBox(1.85, 0.24, 1.85, 0.35, 1.0), sx, baseSurfY + 1.62, sz);
    if (kind === 'statue') {
      statuePoses.push({ x: sx, y: baseSurfY + 1.74, z: sz, yaw: sYaw, scale: 1.48 });
    } else {
      bustPoses.push({ x: sx, y: baseSurfY + 1.74, z: sz, yaw: sYaw, scale: 2.35 });
    }
  }

  // --- 9. Elevated Shinkansen Viaduct (Z = -78.0, Deck Y = 6.8m) ---
  {
    const trainZ = -78.0, deckY = 6.8;
    pushTransformed(buckets.highwayConcrete, makeSubdividedBox(470.0, 1.15, 6.4, 0.18, 2.0), 55.0, deckY - 0.58, trainZ);
    for (const zOff of [-3.05, 3.05]) {
      pushTransformed(buckets.stoneCream, makeSubdividedBox(470.0, 0.95, 0.32, 0.25, 2.0), 55.0, deckY + 0.45, trainZ + zOff);
    }
    for (let px = -165.0; px <= 265.0; px += 26.0) {
      if (track.minDistToRibbon2D(px, trainZ, 'ground').dist < 13.8) continue;
      if (track.minDistToRibbon2D(px, trainZ, 'skyway').dist < 9.0) continue;
      track.registerSolidCylinder(px, trainZ, 1.05, deckY);
      const col = new THREE.CylinderGeometry(0.85, 1.05, deckY - 1.0, 12, 4);
      col.setAttribute('uv1', col.getAttribute('uv'));
      pushTransformed(buckets.highwayConcrete, col, px, (deckY - 1.0) * 0.5, trainZ);
    }
  }

  // --- 10. Monochromatic Spectral Traffic Signal Gantries (Z = +12, -48) ---
  for (const gz of [12.0, -48.0]) {
    const postX = 9.4, barY = 5.85;
    for (const sx of [-postX, postX]) {
      track.registerSolidCylinder(sx, gz, 0.24, barY);
      const pGeo = new THREE.CylinderGeometry(0.16, 0.20, barY + 0.4, 8, 4);
      pGeo.setAttribute('uv1', pGeo.getAttribute('uv'));
      pushTransformed(buckets.darkIron, pGeo, sx, (barY + 0.4) * 0.5, gz);
    }
    pushTransformed(buckets.darkIron, makeSubdividedBox(postX * 2.0, 0.22, 0.22, 0.5, 1.4), 0.0, barY, gz);
    for (const headX of [-3.8, 3.8]) {
      pushTransformed(buckets.darkIron, makeSubdividedBox(0.58, 1.52, 0.38, 0.5, 1.0), headX, barY - 0.35, gz);
      for (const [bkt, dy] of [
        [buckets.signalRed632, 0.12],
        [buckets.signalAmber590, -0.35],
        [buckets.signalGreen525, -0.82],
      ]) {
        const lensGeo = new THREE.SphereGeometry(0.17, 10, 8);
        lensGeo.setAttribute('uv1', lensGeo.getAttribute('uv'));
        pushTransformed(bkt, lensGeo, headX, barY + dy, gz + 0.18);
      }
    }
  }

  // --- 10B. Finely-Subdivided (26x14 = 0.35m quads!) 3D Terrell-Grid & Lorentz-Motorsport Billboards ---
  // High-contrast Cartesian coordinate lines, circles, and bold text + 0.88m striped 3D side frames
  // make relativistic texture bending, shearing, and Penrose-Terrell side-face rotation unmistakable!
  {
    const billboardSpecs = [
      // [cx, baseY, cz, rotY, isTerrellGrid]
      [-11.8, 0.0, 82.0, 0.38, true],
      [13.6, 0.0, 52.0, -0.36, false],
      [-11.8, 0.0, 26.0, 0.42, true],
      [12.4, 0.0, -36.0, -0.40, false],
      [-11.8, 0.0, -108.0, 0.36, true],
      [152.0, 0.9, -212.0, -0.78, false],
      [230.0, 1.2, 48.0, -1.52, true],
      [33.2, 13.8, -52.0, -0.42, true], // Elevated Skyway Panorama Billboard!
    ];

    const bw = 9.2;
    const bh = 4.8;
    const bd = 0.88; // thick 3D box so Penrose-Terrell rotation exposes the striped side!

    for (const [bx, baseY, bz, rotY, useGrid] of billboardSpecs) {
      const boardCenterY = baseY + 4.35;
      const bbGroup = new THREE.Group();
      bbGroup.position.set(bx, boardCenterY, bz);
      bbGroup.rotation.y = rotY;

      // Finely subdivided front & back poster planes (26x14 grid = 0.35m quads!)
      const faceMat = useGrid ? materials.terrellGridBillboard : materials.gpPosterBillboard;
      const frontGeo = new THREE.PlaneGeometry(bw, bh, 26, 14);
      frontGeo.setAttribute('uv1', frontGeo.getAttribute('uv'));
      const frontMesh = new THREE.Mesh(frontGeo, faceMat);
      frontMesh.position.z = bd * 0.5 + 0.01;
      frontMesh.frustumCulled = false;
      bbGroup.add(frontMesh);

      const backGeo = new THREE.PlaneGeometry(bw, bh, 26, 14);
      backGeo.setAttribute('uv1', backGeo.getAttribute('uv'));
      const backMesh = new THREE.Mesh(backGeo, faceMat);
      backMesh.rotation.y = Math.PI;
      backMesh.position.z = -(bd * 0.5 + 0.01);
      backMesh.frustumCulled = false;
      bbGroup.add(backMesh);

      // Thick 0.88m 3D hazard-striped frame (rotates visibly into view under Terrell rotation!)
      const frameGeo = new THREE.BoxGeometry(bw + 0.24, bh + 0.24, bd, 18, 10, 3);
      frameGeo.setAttribute('uv1', frameGeo.getAttribute('uv'));
      const frameMesh = new THREE.Mesh(frameGeo, materials.hazardStripeSide);
      frameMesh.castShadow = true;
      frameMesh.receiveShadow = true;
      frameMesh.frustumCulled = false;
      bbGroup.add(frameMesh);
      root.add(bbGroup);

      // Twin support posts (ground billboards only — extend down into terrain at y = -0.30m)
      if (baseY < 3.0) {
        const cosR = Math.cos(rotY);
        const sinR = Math.sin(rotY);
        const postTopY = boardCenterY - bh * 0.5;
        const postBotY = -0.30;
        const postLen = Math.max(1.8, postTopY - postBotY);
        for (const lx of [-3.1, 3.1]) {
          const px = bx + lx * cosR;
          const pz = bz - lx * sinR;
          track.registerSolidCylinder(px, pz, 0.28, boardCenterY);
          const pGeo = new THREE.CylinderGeometry(0.22, 0.26, postLen, 8, 3);
          pGeo.setAttribute('uv1', pGeo.getAttribute('uv'));
          pushTransformed(buckets.brushedSteel, pGeo, px, 0.5 * (postTopY + postBotY), pz);
        }
      }
    }
  }

  // --- 11. Collect Placement Slots for Real `.glb` Trees, Lanterns, Tire Stacks & Cones ---
  const broadleafTreePoses = [];
  const quiverTreePoses = [];
  const lanternPoses = [];
  const tyrePoses = [];
  const conePoses = [];

  const propFrameStep = IS_MOBILE_DEVICE ? 20 : 10;
  for (let i = 0; i < frames.length; i += propFrameStep) {
    const f = frames[i];
    // Chicane tire stacks & cones on high-curvature outer shoulders!
    if (Math.abs(f.signedCurv) > 0.010 && i % propFrameStep === 0) {
      const outSide = -Math.sign(f.signedCurv);
      const tx = f.pos.x + f.right.x * outSide * 8.65;
      const tz = f.pos.z + f.right.z * outSide * 8.65;
      const ty = track.getSupportSurface(tx, f.pos.y + 1.5, tz).y;
      if (track.minDistToRibbon2D(tx, tz, 'skyway').dist > 7.5) {
        const stackCount = IS_MOBILE_DEVICE ? 2 : 3;
        for (let stack = 0; stack < stackCount; stack++) {
          tyrePoses.push({ x: tx, y: ty + 0.08 + stack * 0.17, z: tz, yaw: stack * 0.7, scale: 1.18 });
        }
        const cx = f.pos.x + f.right.x * outSide * 8.15;
        const cz = f.pos.z + f.right.z * outSide * 8.15;
        const cy = track.getSupportSurface(cx, f.pos.y + 1.5, cz).y;
        conePoses.push({ x: cx, y: cy + 0.02, z: cz, yaw: 0, scale: 1.15 });
      }
    }

    for (const side of [-1, 1]) {
      if (side > 0 && Math.abs(f.pos.x) < 12.5 && ((f.pos.z >= 6.0 && f.pos.z <= 72.0) || (f.pos.z >= 166.0 && f.pos.z <= 214.0))) {
        continue;
      }
      if (side < 0 && Math.abs(f.pos.x) < 10.5 && f.pos.z >= -60.0 && f.pos.z <= -18.0) {
        continue;
      }

      const lat = side * 10.15;
      const px = f.pos.x + f.right.x * lat;
      const pz = f.pos.z + f.right.z * lat;

      if (track.minDistToRibbon2D(px, pz, 'skyway').dist < 7.8) continue;

      // Exact banked sidewalk / terrain surface elevation so zero trees or lamps EVER float on banked turns!
      const surfY = track.getSupportSurface(px, f.pos.y + 1.5, pz).y;

      if (i % (propFrameStep * 2) === 0) {
        const inwardYaw = Math.atan2(-f.right.x * side, f.right.z * side);
        lanternPoses.push({ x: px, y: surfY - 0.03, z: pz, yaw: inwardYaw });
      } else {
        // Granite street-tree planter collar + recessed dark wrought-iron/mulch bed anchored solidly into sidewalk!
        const collarGeo = new THREE.CylinderGeometry(0.68, 0.74, 0.36, 10, 1);
        collarGeo.setAttribute('uv1', collarGeo.getAttribute('uv'));
        pushTransformed(buckets.stoneAshlar, collarGeo, px, surfY - 0.11, pz);

        const mulchGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.06, 10, 1);
        mulchGeo.setAttribute('uv1', mulchGeo.getAttribute('uv'));
        pushTransformed(buckets.darkIron, mulchGeo, px, surfY + 0.055, pz);

        broadleafTreePoses.push({
          x: px,
          y: surfY + 0.04,
          z: pz,
          yaw: (i * 1.9 + side) % (Math.PI * 2),
          scale: 0.88 + ((i * 13) % 5) * 0.08,
        });
      }
    }
  }

  // Park & Infield Botanical Grove (`broadleaf_tree.glb` & `quiver_tree.glb` — natural off-road obstacles!)
  const parkSpots = [
    [35, -35], [44, -18], [38, 12], [68, 42], [38, 92], [28, 62],
    [42, -72], [64, -84], [86, -118], [138, -124], [168, -42], [162, 42],
    [98, 58], [86, 158], [52, 186], [112, 188],
    [-22, 42], [-34, 18], [-26, -86], [-52, -32], [-48, 12],
    [242, -18], [244, 72], [228, 152],
  ];
  parkSpots.forEach(([gx, gz], idx) => {
    if (!isFootprintClear(gx, gz, 2.5)) return;
    if (IS_MOBILE_DEVICE && idx % 2 === 1) return;
    const gSurfY = track.getSupportSurface(gx, 0.5, gz).y;
    if (idx % 3 === 0 && (!IS_MOBILE_DEVICE || quiverTreePoses.length < 3)) {
      quiverTreePoses.push({ x: gx, y: gSurfY - 0.02, z: gz, yaw: idx * 1.3, scale: 1.75 });
    } else {
      broadleafTreePoses.push({ x: gx, y: gSurfY - 0.03, z: gz, yaw: idx * 2.1, scale: 1.04 + (idx % 3) * 0.14 });
    }
  });

  // Merge all static architectural buckets (including street-tree collars!) into batched single-draw-call Meshes
  for (const [matKey, geoList] of Object.entries(buckets)) {
    if (geoList.length === 0) continue;
    const merged = mergeGeometries(geoList, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, materials[matKey]);
    mesh.name = `Merged_${matKey}`;
    mesh.castShadow = !matKey.startsWith('signal') && matKey !== 'warmLampBulb' && matKey !== 'syncPulseCyan';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    geoList.forEach((g) => g.dispose());
  }

  // Register real tree trunks (`r = 0.42m`) in solid obstacle grid so off-road weaving hits real trunks!
  for (const tp of broadleafTreePoses) {
    track.registerSolidCylinder(tp.x, tp.z, 0.42, 8.0);
  }
  for (const qp of quiverTreePoses) {
    track.registerSolidCylinder(qp.x, qp.z, 0.45, 7.0);
  }

  /**
   * Instantiates all real `.glb` botanical trees, statues, clocks, streetlamps, tire stacks,
   * traffic cones, planters, and plaza café carts in batched `InstancedMesh` calls!
   */
  function populatePropsFromGLBs(glbs) {
    // 1. SpeedTree Broadleaf Trees (`broadleaf_tree.glb`) — sink hollow 0..0.72m stilt-root arch (-0.90m)
    //    completely underground so the solid flared cylindrical bark trunk emerges straight from soil/tree-pit!
    const treeMeshes = extractGLBMeshes(glbs.broadleafTree, shaderSystem, {
      offsetY: -0.90,
      matOptsFn: (mat) => {
        if ((mat.name || '').includes('Leaves')) {
          mat.alphaTest = 0.42;
          mat.side = THREE.DoubleSide;
          mat.transparent = false;
          return { uvWeight: 0.18, nirWeight: 1.65 };
        }
        return {};
      },
    });
    addInstancedGLB(root, treeMeshes, broadleafTreePoses);

    // 2. Sculptural Quiver Trees (`quiver_tree.glb`) — sink solid trunk base -0.26m firmly into terrain!
    const quiverMeshes = extractGLBMeshes(glbs.quiverTree, shaderSystem, {
      offsetY: -0.26,
      matOptsFn: () => ({ nirWeight: 1.4 }),
    });
    addInstancedGLB(root, quiverMeshes, quiverTreePoses);

    // 3. Ornate Victorian Boulevard Lanterns (`Lantern.glb`) + Warm Bulbs
    const lanternMeshes = extractGLBMeshes(glbs.lantern, shaderSystem, {
      scale: 0.215,
      rotY: -Math.PI * 0.5,
    });
    addInstancedGLB(root, lanternMeshes, lanternPoses);

    if (lanternPoses.length > 0) {
      const bulbGeo = new THREE.SphereGeometry(0.22, 8, 8);
      const bulbInst = new THREE.InstancedMesh(bulbGeo, materials.warmLampBulb, lanternPoses.length);
      bulbInst.frustumCulled = false;
      lanternPoses.forEach((lp, idx) => {
        const armX = Math.sin(lp.yaw) * 1.25;
        const armZ = -Math.cos(lp.yaw) * 1.25;
        _pos.set(lp.x + armX, lp.y + 4.45, lp.z + armZ);
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        bulbInst.setMatrixAt(idx, _mat4);
      });
      bulbInst.instanceMatrix.needsUpdate = true;
      root.add(bulbInst);
    }

    // 4. Modern Skyway Cobra-Head Lamps (`street_lamp_modern.glb`)
    const skyLampMeshes = extractGLBMeshes(glbs.streetLampModern, shaderSystem, {
      matOptsFn: (mat) => {
        if ((mat.name || '').includes('bulb')) {
          mat.emissive = new THREE.Color(0xffe4b5);
          mat.emissiveIntensity = 3.2;
        }
        return {};
      },
    });
    addInstancedGLB(root, skyLampMeshes, skyLampPoses, { castShadow: false });

    // 5. Classical Terrell-Rotation Statues (`gothic_statue.glb`), Busts (`marble_bust.glb`) & Bronze Horse (`horse_statue.glb`)
    addInstancedGLB(root, extractGLBMeshes(glbs.gothicStatue, shaderSystem), statuePoses);
    addInstancedGLB(root, extractGLBMeshes(glbs.marbleBust, shaderSystem), bustPoses);
    addInstancedGLB(root, extractGLBMeshes(glbs.horseStatue, shaderSystem, { scale: 14.5 }), [
      { x: -15.5, y: 1.99, z: -23.5, yaw: Math.PI * 0.35, scale: 1.0 },
    ]);

    // 6. Synchronized Roadside Station Clocks (`wall_clock.glb`)
    addInstancedGLB(root, extractGLBMeshes(glbs.wallClock, shaderSystem), wallClockPoses, { castShadow: false });

    // 7. Chicane Rubber Tire Stacks (`old_tyre.glb`, rotated flat!) & Reflective Cones (`traffic_cone.glb`)
    addInstancedGLB(root, extractGLBMeshes(glbs.oldTyre, shaderSystem, { rotX: Math.PI * 0.5 }), tyrePoses, { castShadow: false });
    const coneMeshes = extractGLBMeshes(glbs.trafficCone, shaderSystem, {
      filterFn: (child) => (child.name || '').includes('Cone_Normal') || (child.name || '').includes('ConeMesh'),
    });
    addInstancedGLB(root, coneMeshes, conePoses, { castShadow: false });

    // 8. Sidewalk Potted Plants (`potted_plant.glb`) & Plaza Espresso Coffee Carts (`coffee_cart.glb`)
    addInstancedGLB(root, extractGLBMeshes(glbs.pottedPlant, shaderSystem, {
      matOptsFn: () => ({ nirWeight: 1.4 }),
    }), planterPoses, { castShadow: false });

    addInstancedGLB(root, extractGLBMeshes(glbs.coffeeCart, shaderSystem), [
      { x: -14.8, y: 0.16, z: -46.5, yaw: Math.PI * 0.5, scale: 1.05 },
      { x: -14.8, y: 0.16, z: -30.5, yaw: Math.PI * 0.4, scale: 1.05 },
    ]);
  }

  return {
    root,
    track,
    syncPylons,
    getSupportSurface: track.getSupportSurface,
    queryBarrierContact: track.queryBarrierContact,
    queryVehicleOBBContact: track.queryVehicleOBBContact,
    sampleLanePose: track.sampleLanePose,
    populatePropsFromGLBs,
  };
}
