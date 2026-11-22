/**
 * Grand Prix AI Supercar Racers, glTF Pedestrians, Sky Birds, Train & OBB Collisions
 * ==================================================================================
 *
 * Loads and simulates all dynamic 3D glTF entities:
 *   - Player Rosso Corsa Ferrari 458 Italia (`ferrari.glb`)
 *   - 5 Competitive Named AI Grand Prix Opponents (`H. Lorentz`, `A. Einstein`,
 *     `E. Noether`, `R. Penrose`, `H. Minkowski`) in clearcoat Ferraris & Concept GTs
 *     with corner-curvature braking, Skyway joker-route selection, and full rigid-body recoil
 *   - Ambient commercial `CesiumMilkTruck.glb` traffic
 *   - 18 Skeletal rigged pedestrians (`Xbot.glb`, `CesiumMan.glb`, `Soldier.glb`,
 *     `HVGirl.glb`, and plaza performer `Michelle.glb`)
 *   - Animated flying bird flock (`Flamingo.glb`, `Stork.glb`) & park horses (`Horse.glb`)
 *   - Elevated Shinkansen Bullet Train & GPU collision spark bursts
 */

import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/DRACOLoader.js';
import { clone as cloneSkeleton } from '../../vendor/SkeletonUtils.js';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import { IS_MOBILE_DEVICE } from '../render/renderer.js?v=2.0';

/**
 * Merges static child submeshes sharing identical Material & vertex attribute layout inside a
 * glTF hierarchy (skipping named animated subtrees like wheels/steering) — cuts vehicle WebGL
 * draw calls by ~5x with 100% identical vertex-for-vertex visual quality!
 */
function batchStaticSubmeshesByMaterial(sceneRoot, protectedNodeNames = new Set()) {
  sceneRoot.updateMatrixWorld(true);
  const invRoot = sceneRoot.matrixWorld.clone().invert();

  const isInsideProtected = (obj) => {
    let cur = obj;
    while (cur && cur !== sceneRoot) {
      if (protectedNodeNames.has(cur.name)) return true;
      cur = cur.parent;
    }
    return false;
  };

  const groups = new Map();
  const toRemove = [];

  sceneRoot.traverse((obj) => {
    if (!obj.isMesh || obj.isSkinnedMesh || !obj.geometry || Array.isArray(obj.material)) return;
    if (isInsideProtected(obj)) return;
    const g = obj.geometry;
    const attrSig = Object.keys(g.attributes).sort().join(',');
    const key = `${obj.material.uuid}|${attrSig}|${!!g.index}`;
    let list = groups.get(key);
    if (!list) {
      list = { mat: obj.material, geos: [], meshes: [] };
      groups.set(key, list);
    }
    const clonedGeo = g.clone();
    const relMat = new THREE.Matrix4().multiplyMatrices(invRoot, obj.matrixWorld);
    clonedGeo.applyMatrix4(relMat);
    list.geos.push(clonedGeo);
    list.meshes.push(obj);
  });

  for (const { mat, geos, meshes } of groups.values()) {
    if (geos.length < 2) {
      geos.forEach((cg) => cg.dispose());
      continue;
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((cg) => cg.dispose());
    if (!merged) continue;
    if (!merged.getAttribute('uv1') && merged.getAttribute('uv')) {
      merged.setAttribute('uv1', merged.getAttribute('uv'));
    }
    const batchedMesh = new THREE.Mesh(merged, mat);
    batchedMesh.name = `Batched_${mat.name || 'Part'}`;
    sceneRoot.add(batchedMesh);
    for (const m of meshes) toRemove.push(m);
  }

  for (const m of toRemove) {
    if (m.parent) m.parent.remove(m);
  }
}

export const RACER_ROSTER = [
  { name: 'H. Lorentz',   hex: 0x2563eb, css: '#3b82f6', kind: 'ferrari', topBeta: 0.82, skywayMod: 2 },
  { name: 'A. Einstein',  hex: 0xeab308, css: '#eab308', kind: 'ferrari', topBeta: 0.84, skywayMod: 0 },
  { name: 'E. Noether',   hex: 0xdb2777, css: '#ec4899', kind: 'concept', topBeta: 0.79, skywayMod: 1 },
  { name: 'R. Penrose',   hex: 0x059669, css: '#10b981', kind: 'ferrari', topBeta: 0.76, skywayMod: 2 },
  { name: 'H. Minkowski', hex: 0xcbd5e1, css: '#cbd5e1', kind: 'concept', topBeta: 0.73, skywayMod: 0 },
];

const PEDESTRIAN_TINTS = [0x3b82f6, 0xd97706, 0x10b981, 0xe11d48, 0x8b5cf6, 0x64748b, 0x0ea5e9];

// Truly hidden inner-wheel brake caliper & lug-nut submeshes on AI opponent Ferraris
// (never remove cockpit/leather/steering — Ferrari 458 Spider is an open-top roadster!)
const FERRARI_AI_HIDDEN_WHEEL_PARTS = new Set([
  'brakes',
  'brake',
  'nuts',
  'wipers',
]);

/**
 * Exact 2D Oriented Bounding Box Separating Axis Theorem (SAT) intersection test.
 */
export function intersectOBB2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const maxR = a.halfL + b.halfL + a.halfW + b.halfW;
  if (dx * dx + dz * dz > maxR * maxR) return null;

  const afx = Math.sin(a.yaw), afz = -Math.cos(a.yaw);
  const arx = Math.cos(a.yaw), arz = Math.sin(a.yaw);
  const bfx = Math.sin(b.yaw), bfz = -Math.cos(b.yaw);
  const brx = Math.cos(b.yaw), brz = Math.sin(b.yaw);

  const axes = [
    [arx, arz],
    [afx, afz],
    [brx, brz],
    [bfx, bfz],
  ];

  let minPen = Infinity;
  let bestNx = 0.0;
  let bestNz = 0.0;

  for (let i = 0; i < 4; i++) {
    const ax = axes[i][0];
    const az = axes[i][1];
    const projA =
      Math.abs(ax * arx + az * arz) * a.halfW +
      Math.abs(ax * afx + az * afz) * a.halfL;
    const projB =
      Math.abs(ax * brx + az * brz) * b.halfW +
      Math.abs(ax * bfx + az * bfz) * b.halfL;
    const centerDist = dx * ax + dz * az;
    const overlap = projA + projB - Math.abs(centerDist);
    if (overlap <= 0.0) return null;

    if (overlap < minPen) {
      minPen = overlap;
      const sign = centerDist >= 0.0 ? 1.0 : -1.0;
      bestNx = ax * sign;
      bestNz = az * sign;
    }
  }

  const cornersOf = (box, rx, rz, fx, fz) => [
    [box.x - rx * box.halfW - fx * box.halfL, box.z - rz * box.halfW - fz * box.halfL],
    [box.x + rx * box.halfW - fx * box.halfL, box.z + rz * box.halfW - fz * box.halfL],
    [box.x + rx * box.halfW + fx * box.halfL, box.z + rz * box.halfW + fz * box.halfL],
    [box.x - rx * box.halfW + fx * box.halfL, box.z - rz * box.halfW + fz * box.halfL],
  ];

  const insideBox = (px, pz, box, rx, rz, fx, fz, pad = 0.08) => {
    const lx = (px - box.x) * rx + (pz - box.z) * rz;
    const lz = (px - box.x) * fx + (pz - box.z) * fz;
    return Math.abs(lx) <= box.halfW + pad && Math.abs(lz) <= box.halfL + pad;
  };

  const cA = cornersOf(a, arx, arz, afx, afz);
  const cB = cornersOf(b, brx, brz, bfx, bfz);
  let sumX = 0.0, sumZ = 0.0, cnt = 0;

  for (const [px, pz] of cA) {
    if (insideBox(px, pz, b, brx, brz, bfx, bfz, minPen + 0.06)) {
      sumX += px; sumZ += pz; cnt++;
    }
  }
  for (const [px, pz] of cB) {
    if (insideBox(px, pz, a, arx, arz, afx, afz, minPen + 0.06)) {
      sumX += px; sumZ += pz; cnt++;
    }
  }

  return {
    pen: minPen,
    nx: bestNx,
    nz: bestNz,
    cpx: cnt > 0 ? sumX / cnt : 0.5 * (a.x + b.x),
    cpz: cnt > 0 ? sumZ / cnt : 0.5 * (a.z + b.z),
  };
}

export class EntityManager {
  constructor(scene, cityWorld, metric, shaderSystem) {
    this.scene = scene;
    this.cityWorld = cityWorld;
    this.metric = metric;
    this.shaderSystem = shaderSystem;

    this.trafficSpeedScale = 1.0;
    this.canRace = true;

    this.cars = [];       // All dynamic vehicles (5 AI Racers + ambient trucks)
    this.opponents = [];  // Subset: the 5 Named AI Grand Prix Opponents
    this.pedestrians = [];
    this.birds = [];
    this.horses = [];
    this.playerCar = null;
    this.train = null;

    // Precompute exact arc-length `s` along `groundData` for Start/Finish (Z=94), Skyway Split (Z=68), and Merge (Z=172)
    this.sFinishLine = this._findGroundS(0.0, 94.0);
    this.sSkywaySplit = this._findGroundS(4.6, 68.0);
    this.sSkywayMerge = this._findGroundS(4.6, 172.0);

    this.group = new THREE.Group();
    this.group.name = 'DynamicRelativisticEntities';
    this.scene.add(this.group);

    this._initSparkSystem();
    this._buildBulletTrain();
  }

  _findGroundS(x, z) {
    let bestD2 = Infinity;
    let bestS = 0.0;
    for (const f of this.cityWorld.track.groundData.frames) {
      const d2 = (f.pos.x - x) ** 2 + (f.pos.z - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestS = f.s;
      }
    }
    return bestS;
  }

  /**
   * Projects arbitrary `(x, footY, z)` onto `[0..1)` lap progress past Start/Finish (`Z=94`).
   */
  computeLapFraction(x, footY, z) {
    const gLen = this.cityWorld.track.groundData.totalLen;
    if (footY > 1.8) {
      // On Elevated Skyway: map [0 .. skyLen] smoothly onto [splitFrac .. mergeFrac]!
      const skyFrames = this.cityWorld.track.skywayData.frames;
      let bestD2 = Infinity;
      let bestU = 0.0;
      for (let i = 0; i < skyFrames.length; i += 2) {
        const f = skyFrames[i];
        const d2 = (f.pos.x - x) ** 2 + (f.pos.z - z) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestU = f.u;
        }
      }
      const splitFrac = ((this.sSkywaySplit - this.sFinishLine + gLen) % gLen) / gLen;
      const mergeFrac = ((this.sSkywayMerge - this.sFinishLine + gLen) % gLen) / gLen;
      const span = mergeFrac > splitFrac ? (mergeFrac - splitFrac) : (mergeFrac + 1.0 - splitFrac);
      return (splitFrac + bestU * span) % 1.0;
    }

    const sNow = this._findGroundS(x, z);
    return ((sNow - this.sFinishLine + gLen) % gLen) / gLen;
  }

  async loadAssets(onProgress = null) {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('./vendor/draco/');
    dracoLoader.setWorkerLimit(IS_MOBILE_DEVICE ? 1 : 2);

    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);
    const texLoader = new THREE.TextureLoader();

    const downscaleGLBTexturesOnMobile = (gltf) => {
      if (!IS_MOBILE_DEVICE || !gltf || !gltf.scene) return;
      const seen = new Set();
      gltf.scene.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          for (const prop of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
            const t = m[prop];
            if (!t || seen.has(t) || !t.image) continue;
            seen.add(t);
            const w = t.image.width || 0;
            const h = t.image.height || 0;
            if (w > 512 || h > 512) {
              const s = 512 / Math.max(w, h);
              const cv = document.createElement('canvas');
              cv.width = Math.max(32, Math.round(w * s));
              cv.height = Math.max(32, Math.round(h * s));
              const c2d = cv.getContext('2d');
              c2d.drawImage(t.image, 0, 0, cv.width, cv.height);
              t.image = cv;
              t.needsUpdate = true;
            }
          }
        }
      });
    };

    const loadGLB = (url) =>
      new Promise((resolve, reject) => {
        gltfLoader.load(
          url,
          (gltf) => {
            downscaleGLBTexturesOnMobile(gltf);
            resolve(gltf);
          },
          undefined,
          reject
        );
      });

    const loadTex = (url) =>
      new Promise((resolve) => {
        texLoader.load(url, resolve, undefined, () => resolve(null));
      });

    const manifest = [
      ['ferrari', './assets/models/ferrari.glb?v=2.0'],
      ['concept', './assets/models/CarConcept.glb?v=2.0'],
      ['truck', './assets/models/CesiumMilkTruck.glb?v=2.0'],
      ['soldier', './assets/models/Soldier.glb?v=2.0'],
      ['cesiumMan', './assets/models/CesiumMan.glb?v=2.0'],
      ['hvGirl', './assets/models/HVGirl.glb?v=2.0'],
      ['broadleafTree', './assets/models/broadleaf_tree.glb?v=2.0'],
      ['quiverTree', './assets/models/quiver_tree.glb?v=2.0'],
      ['lantern', './assets/models/Lantern.glb?v=2.0'],
      ['streetLampModern', './assets/models/street_lamp_modern.glb?v=2.0'],
      ['gothicStatue', './assets/models/gothic_statue.glb?v=2.0'],
      ['marbleBust', './assets/models/marble_bust.glb?v=2.0'],
      ['horseStatue', './assets/models/horse_statue.glb?v=2.0'],
      ['wallClock', './assets/models/wall_clock.glb?v=2.0'],
      ['oldTyre', './assets/models/old_tyre.glb?v=2.0'],
      ['trafficCone', './assets/models/traffic_cone.glb?v=2.0'],
      ['pottedPlant', './assets/models/potted_plant.glb?v=2.0'],
      ['coffeeCart', './assets/models/coffee_cart.glb?v=2.0'],
      ...(IS_MOBILE_DEVICE
        ? []
        : [
            ['xbot', './assets/models/Xbot.glb?v=2.0'],
            ['michelle', './assets/models/Michelle.glb?v=2.0'],
            ['flamingo', './assets/models/Flamingo.glb?v=2.0'],
            ['stork', './assets/models/Stork.glb?v=2.0'],
            ['horse', './assets/models/Horse.glb?v=2.0'],
          ]),
    ];

    // Load GLBs with bounded concurrency (2 on mobile, 4 on desktop) so Firefox Android
    // never suffers a 23-file parallel ArrayBuffer + WASM Draco heap spike!
    let done = 0;
    let cursor = 0;
    const entries = new Array(manifest.length);
    const concurrency = IS_MOBILE_DEVICE ? 2 : 4;

    const worker = async () => {
      while (cursor < manifest.length) {
        const idx = cursor++;
        const [key, url] = manifest[idx];
        const gltf = await loadGLB(url);
        entries[idx] = [key, gltf];
        done++;
        if (onProgress) onProgress(done / manifest.length, key);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const glbs = Object.fromEntries(entries);
    const ferrariAOTex = await loadTex('./assets/models/ferrari_ao.png');

    // Batch static car submeshes by material once on the loaded templates (~300 draw calls -> ~45!)
    if (glbs.ferrari?.scene) {
      batchStaticSubmeshesByMaterial(
        glbs.ferrari.scene,
        new Set(['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'steering_wheel', 'brakes', 'brake', 'nuts', 'wipers'])
      );
    }
    if (glbs.concept?.scene) {
      batchStaticSubmeshesByMaterial(glbs.concept.scene);
    }

    // 1. Populate all botanical SpeedTrees, statues, clocks, tire stacks & café carts in CityWorld!
    this.cityWorld.populatePropsFromGLBs(glbs);

    // 2. Instantiate Player Rosso Corsa Ferrari 458 Italia (100% pristine showroom geometry!)
    this.playerCar = this._instantiateFerrari(glbs.ferrari, ferrariAOTex, 0xd41218, { isCoMoving: true });
    this.group.add(this.playerCar.root);

    // 3. Spawn 5 Competitive AI Grand Prix Supercars + Ambient Commercial Trucks
    this._spawnGrandPrixAndTraffic(glbs.ferrari, ferrariAOTex, glbs.concept, glbs.truck);

    // 4. Spawn Skeletal Animated Pedestrians + Plaza Performer
    this._spawnPedestrians(glbs.soldier, glbs.xbot, glbs.cesiumMan, glbs.hvGirl, glbs.michelle);

    // 5. Spawn Animated Sky Bird Flocks & Galloping Park Horses (desktop only — avoids WebGL2 sampler2DArray morph driver bug on mobile)
    if (!IS_MOBILE_DEVICE) {
      this._spawnSkyBirdsAndHorses(glbs.flamingo, glbs.stork, glbs.horse);
    }

    dracoLoader.dispose();
  }

  _getContactShadowAlphaTex() {
    if (this._contactShadowAlphaTex) return this._contactShadowAlphaTex;
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 128, 256);
    ctx.save();
    ctx.translate(64, 128);
    ctx.scale(1.0, 2.0);
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 58);
    g.addColorStop(0.0, 'rgba(255,255,255,0.88)');
    g.addColorStop(0.58, 'rgba(255,255,255,0.62)');
    g.addColorStop(0.84, 'rgba(255,255,255,0.20)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const tex = new THREE.CanvasTexture(cv);
    this._contactShadowAlphaTex = tex;
    return tex;
  }

  _attachRelativisticContactShadow(root, uniforms, w = 2.35, len = 4.65) {
    const alphaTex = this._getContactShadowAlphaTex();
    if (!alphaTex) return;
    const geo = new THREE.PlaneGeometry(w, len, 4, 8);
    geo.rotateX(-Math.PI * 0.5);
    geo.setAttribute('uv1', geo.getAttribute('uv'));
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      alphaMap: alphaTex,
      transparent: true,
      opacity: 0.78,
      roughness: 1.0,
      metalness: 0.0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.shaderSystem.patchMaterial(mat, uniforms);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.022;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);
  }

  _instantiateFerrari(ferrariGltf, aoTex, bodyHex, { isCoMoving = false } = {}) {
    const root = new THREE.Group();
    const model = ferrariGltf.scene.clone(true);
    // On AI Ferraris, omit only inner-hub brake calipers & lug nuts; keep 100% of body, cockpit, seats & steering!
    if (!isCoMoving) {
      const hidden = [];
      model.traverse((obj) => {
        if (obj.isMesh && FERRARI_AI_HIDDEN_WHEEL_PARTS.has((obj.name || '').toLowerCase())) {
          hidden.push(obj);
        }
      });
      hidden.forEach((o) => o.parent && o.parent.remove(o));
    }
    root.add(model);

    const uniforms = this.shaderSystem.createEntityUniforms({
      isDynamic: !isCoMoving,
      isCoMoving,
    });

    const CarBodyMat = IS_MOBILE_DEVICE ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
    const brakeMaterials = [];
    this.shaderSystem.patchHierarchy(model, uniforms, {
      castShadow: !IS_MOBILE_DEVICE,
      receiveShadow: !IS_MOBILE_DEVICE,
      forceStandardOnMobile: IS_MOBILE_DEVICE,
      materialOverrideFn: (mat) => {
        const nm = (mat.name || '').toLowerCase();
        if (nm === 'body_color') {
          return {
            material: new CarBodyMat({
              name: 'FerrariClearcoatPaint',
              color: new THREE.Color(bodyHex),
              metalness: 0.58,
              roughness: 0.15,
              ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 1.0, clearcoatRoughness: 0.03 }),
              envMapIntensity: 1.85,
            }),
            matOpts: { uvWeight: 0.68, nirWeight: 0.55 },
          };
        }
        if (nm.includes('glass') && !nm.includes('taillight') && !nm.includes('projector')) {
          return {
            material: new CarBodyMat({
              name: 'FerrariGlass',
              color: new THREE.Color(0x111822),
              metalness: 0.1,
              roughness: 0.04,
              transparent: true,
              opacity: 0.44,
              ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 1.0, clearcoatRoughness: 0.02 }),
              envMapIntensity: 2.1,
            }),
          };
        }
        if (nm.includes('taillight')) {
          mat.color.setHex(0x550404);
          mat.emissive = new THREE.Color(0xff1410);
          mat.emissiveIntensity = 1.6;
          brakeMaterials.push(mat);
          return { material: mat, matOpts: { narrowBandNm: 635.0 } };
        }
        if (nm.includes('projector') || nm.includes('turn_signal')) {
          mat.emissive = new THREE.Color(0xfff5dc);
          mat.emissiveIntensity = 2.8;
          return { material: mat };
        }
        if (nm.includes('chrome') || nm.includes('metal')) {
          mat.metalness = 0.92;
          mat.roughness = 0.18;
          mat.envMapIntensity = 1.6;
        }
        return { material: mat };
      },
    });

    if (aoTex && isCoMoving) {
      const aoGeo = new THREE.PlaneGeometry(2.55, 4.95);
      aoGeo.rotateX(-Math.PI * 0.5);
      const aoMat = new THREE.MeshBasicMaterial({
        map: aoTex,
        blending: THREE.MultiplyBlending,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      });
      const aoMesh = new THREE.Mesh(aoGeo, aoMat);
      aoMesh.position.y = 0.025;
      aoMesh.frustumCulled = false;
      root.add(aoMesh);
    } else if (!isCoMoving) {
      this._attachRelativisticContactShadow(root, uniforms, 2.35, 4.75);
    }

    const wheelFL = model.getObjectByName('wheel_fl');
    const wheelFR = model.getObjectByName('wheel_fr');
    const wheelRL = model.getObjectByName('wheel_rl');
    const wheelRR = model.getObjectByName('wheel_rr');
    const steeringWheel = model.getObjectByName('steering_wheel');

    for (const w of [wheelFL, wheelFR, wheelRL, wheelRR]) {
      if (w) w.rotation.order = 'YXZ';
    }

    return {
      root,
      model,
      uniforms,
      wheelFL,
      wheelFR,
      wheelRL,
      wheelRR,
      steeringWheel,
      brakeMaterials,
      wheelRadius: 0.358,
    };
  }

  _instantiateConceptCar(conceptGltf, bodyHex) {
    const root = new THREE.Group();
    const model = conceptGltf.scene.clone(true);
    model.rotation.y = Math.PI;
    model.position.y = 0.159 * 0.92;
    model.scale.setScalar(0.92);
    root.add(model);

    const CarBodyMat = IS_MOBILE_DEVICE ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
    const uniforms = this.shaderSystem.createEntityUniforms({ isDynamic: true });
    this.shaderSystem.patchHierarchy(model, uniforms, {
      castShadow: !IS_MOBILE_DEVICE,
      receiveShadow: !IS_MOBILE_DEVICE,
      forceStandardOnMobile: IS_MOBILE_DEVICE,
      materialOverrideFn: (mat) => {
        const nm = (mat.name || '').toLowerCase();
        if (nm.includes('paint 1')) {
          return {
            material: new CarBodyMat({
              color: new THREE.Color(bodyHex),
              metalness: 0.65,
              roughness: 0.15,
              ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 1.0, clearcoatRoughness: 0.03 }),
              envMapIntensity: 1.85,
            }),
            matOpts: { uvWeight: 0.68, nirWeight: 0.55 },
          };
        }
        if (nm === 'glass') {
          return {
            material: new CarBodyMat({
              color: new THREE.Color(0x101824),
              roughness: 0.05,
              metalness: 0.1,
              transparent: true,
              opacity: 0.5,
              ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 1.0 }),
              envMapIntensity: 2.0,
            }),
          };
        }
        if (nm.includes('headlight')) {
          mat.emissive = new THREE.Color(0xfff6e0);
          mat.emissiveIntensity = 3.0;
        } else if (nm.includes('brakelight')) {
          mat.emissive = new THREE.Color(0xff1812);
          mat.emissiveIntensity = 2.0;
        }
        return { material: mat };
      },
    });

    this._attachRelativisticContactShadow(root, uniforms, 2.35, 4.65);
    return { root, uniforms, wheelRadius: 0.36 };
  }

  _instantiateMilkTruck(truckGltf) {
    const root = new THREE.Group();
    const model = truckGltf.scene.clone(true);
    model.rotation.y = Math.PI;
    model.position.y = 0.065 * 0.92;
    model.scale.setScalar(0.92);
    root.add(model);

    const uniforms = this.shaderSystem.createEntityUniforms({ isDynamic: true });
    this.shaderSystem.patchHierarchy(model, uniforms, {
      castShadow: true,
      receiveShadow: true,
      materialOverrideFn: (mat) => {
        mat.envMapIntensity = 1.1;
        return { material: mat };
      },
    });

    this._attachRelativisticContactShadow(root, uniforms, 2.65, 5.10);
    const w0 = model.getObjectByName('Wheels');
    const w1 = model.getObjectByName('Wheels.001');
    return { root, uniforms, truckWheels: [w0, w1].filter(Boolean), wheelRadius: 0.40 };
  }

  _spawnGrandPrixAndTraffic(ferrariGltf, ferrariAOTex, conceptGltf, truckGltf) {
    const gLen = this.cityWorld.track.groundData.totalLen;
    const sLen = this.cityWorld.track.skywayData.totalLen;

    // 1. Spawn 5 Competitive AI Supercar Racers on the Staggered Starting Grid behind Start/Finish (Z=94)!
    RACER_ROSTER.forEach((spec, idx) => {
      const inst = spec.kind === 'ferrari'
        ? this._instantiateFerrari(ferrariGltf, ferrariAOTex, spec.hex, { isCoMoving: false })
        : this._instantiateConceptCar(conceptGltf, spec.hex);

      const gridRowZ = 122.0 + idx * 6.5; // Staggered from Z=122..148 ahead of Player at Z=158!
      const gridLane = idx % 2 === 0 ? -2.35 : 2.35;
      const sGrid = this._findGroundS(0.0, gridRowZ);
      const pose = this.cityWorld.sampleLanePose('ground', sGrid, gridLane, false);

      const opp = {
        ...inst,
        isOpponent: true,
        racerName: spec.name,
        racerCss: spec.css,
        topBeta: spec.topBeta,
        skywayMod: spec.skywayMod,
        curBeta: 0.0,
        track: 'ground',
        totalLen: gLen,
        s: sGrid,
        gridS: sGrid,
        lane: gridLane,
        targetLane: gridLane,
        rev: false,
        lap: 0,
        hasCrossedStart: false,
        passedMidpoint: false,
        finished: false,
        finishCoordTime: 0.0,
        finishProperTime: 0.0,
        properTime: 0.0,
        raceScore: -0.01 * (idx + 1),
        mass: spec.kind === 'ferrari' ? 1480.0 : 1650.0,
        inertiaY: 2550.0,
        halfW: 1.06,
        halfL: 2.20,
        x: pose.pos.x,
        y: pose.pos.y,
        z: pose.pos.z,
        yaw: pose.yaw,
        pitch: pose.pitch,
        px: 0.0,
        pz: 0.0,
        yawRate: 0.0,
        disturbedTimer: 0.0,
        hopY: 0.0,
        hopVelY: 0.0,
        rollAngle: 0.0,
        rollVel: 0.0,
        pitchJolt: 0.0,
        wheelSpin: 0.0,
      };

      opp.root.position.set(opp.x, opp.y, opp.z);
      opp.root.rotation.set(opp.pitch, -opp.yaw, 0, 'YXZ');
      this.group.add(opp.root);
      this.cars.push(opp);
      this.opponents.push(opp);
    });

    // 2. Spawn 4 Ambient Commercial Delivery Trucks (`4200 kg` dynamic traffic obstacles!)
    const truckSpecs = [
      { track: 'ground', sFrac: 0.34, lane: 5.4, rev: false, beta: 0.26 },
      { track: 'ground', sFrac: 0.72, lane: 5.4, rev: false, beta: 0.28 },
      { track: 'ground', sFrac: 0.52, lane: -5.4, rev: true, beta: 0.30 },
      { track: 'skyway', sFrac: 0.62, lane: -3.1, rev: true, beta: 0.32 },
    ];

    for (const ts of truckSpecs) {
      const inst = this._instantiateMilkTruck(truckGltf);
      const tLen = ts.track === 'skyway' ? sLen : gLen;
      const sInit = ts.sFrac * tLen;
      const pose = this.cityWorld.sampleLanePose(ts.track, sInit, ts.lane, ts.rev);

      const truck = {
        ...inst,
        isOpponent: false,
        track: ts.track,
        totalLen: tLen,
        s: sInit,
        lane: ts.lane,
        rev: ts.rev,
        baseBeta: ts.beta,
        curBeta: ts.beta,
        mass: 4200.0,
        inertiaY: 8900.0,
        halfW: 1.24,
        halfL: 2.28,
        x: pose.pos.x,
        y: pose.pos.y,
        z: pose.pos.z,
        yaw: pose.yaw,
        pitch: pose.pitch,
        px: 0.0,
        pz: 0.0,
        yawRate: 0.0,
        disturbedTimer: 0.0,
        hopY: 0.0,
        hopVelY: 0.0,
        rollAngle: 0.0,
        rollVel: 0.0,
        pitchJolt: 0.0,
        wheelSpin: 0.0,
      };
      truck.root.position.set(truck.x, truck.y, truck.z);
      truck.root.rotation.set(truck.pitch, -truck.yaw, 0, 'YXZ');
      this.group.add(truck.root);
      this.cars.push(truck);
    }
  }

  /**
   * Resets all 5 AI Opponent Supercars back onto the Starting Grid for a fresh 3-Lap Grand Prix.
   */
  resetOpponentsForNewRace() {
    const gLen = this.cityWorld.track.groundData.totalLen;
    this.opponents.forEach((opp, idx) => {
      opp.track = 'ground';
      opp.totalLen = gLen;
      opp.s = opp.gridS;
      opp.lane = idx % 2 === 0 ? -2.35 : 2.35;
      opp.targetLane = opp.lane;
      opp.curBeta = 0.0;
      opp.lap = 0;
      opp.hasCrossedStart = false;
      opp.passedMidpoint = false;
      opp.finished = false;
      opp.finishCoordTime = 0.0;
      opp.finishProperTime = 0.0;
      opp.properTime = 0.0;
      opp.px = 0.0;
      opp.pz = 0.0;
      opp.yawRate = 0.0;
      opp.disturbedTimer = 0.0;
      opp.hopY = 0.0;
      opp.hopVelY = 0.0;
      opp.rollAngle = 0.0;
      opp.rollVel = 0.0;
      opp.pitchJolt = 0.0;

      const pose = this.cityWorld.sampleLanePose('ground', opp.s, opp.lane, false);
      opp.x = pose.pos.x;
      opp.y = pose.pos.y;
      opp.z = pose.pos.z;
      opp.yaw = pose.yaw;
      opp.pitch = pose.pitch;
      opp.root.position.set(opp.x, opp.y, opp.z);
      opp.root.rotation.set(opp.pitch, -opp.yaw, 0, 'YXZ');
    });
  }

  _spawnPedestrians(soldierGltf, xbotGltf, cesiumManGltf, hvGirlGltf, michelleGltf) {
    const groundLen = this.cityWorld.track.groundData.totalLen;

    if (michelleGltf && michelleGltf.animations.length > 0) {
      const root = new THREE.Group();
      const cloned = cloneSkeleton(michelleGltf.scene);
      root.add(cloned);
      const uniforms = this.shaderSystem.createEntityUniforms({ isDynamic: true });
      this.shaderSystem.patchHierarchy(cloned, uniforms);
      const mixer = new THREE.AnimationMixer(cloned);
      mixer.clipAction(michelleGltf.animations[0]).play();

      const px = -16.8, py = 0.17, pz = -31.5;
      root.position.set(px, py, pz);
      root.rotation.y = Math.PI * 0.45;
      uniforms.uEntityPosNow.value.set(px, py + 0.85, pz);
      this.group.add(root);
      this.pedestrians.push({ root, mixer, uniforms, isStaticPerformer: true, x: px, y: py, z: pz });
    }

    const numWalkers = IS_MOBILE_DEVICE ? 9 : 17;
    for (let i = 0; i < numWalkers; i++) {
      const choice = i % 4;
      let srcGltf, rotOffset = 0.0, scale = 1.0, walkClip = null;

      if (choice === 0 && xbotGltf) {
        srcGltf = xbotGltf; rotOffset = Math.PI; scale = 1.0;
        walkClip = xbotGltf.animations.find((a) => a.name.toLowerCase().includes('walk')) || xbotGltf.animations[0];
      } else if (choice === 1 && cesiumManGltf) {
        srcGltf = cesiumManGltf; rotOffset = Math.PI; scale = 1.12;
        walkClip = cesiumManGltf.animations[0];
      } else if (choice === 2 && hvGirlGltf) {
        srcGltf = hvGirlGltf; rotOffset = Math.PI; scale = 0.145;
        walkClip = hvGirlGltf.animations.find((a) => a.name.toLowerCase() === 'walking') || hvGirlGltf.animations[0];
      } else {
        srcGltf = soldierGltf; rotOffset = 0.0; scale = 0.96;
        walkClip = soldierGltf.animations.find((a) => a.name.toLowerCase().includes('walk')) || soldierGltf.animations[0];
      }

      const root = new THREE.Group();
      const inner = cloneSkeleton(srcGltf.scene);
      inner.rotation.y = rotOffset;
      inner.scale.setScalar(scale);
      root.add(inner);

      const tintHex = PEDESTRIAN_TINTS[i % PEDESTRIAN_TINTS.length];
      const uniforms = this.shaderSystem.createEntityUniforms({ isDynamic: true });
      this.shaderSystem.patchHierarchy(inner, uniforms, {
        materialOverrideFn: (mat) => {
          if (choice === 0 && (mat.name || '').includes('Limbs')) {
            mat.color = new THREE.Color(tintHex);
            mat.roughness = 0.68;
          }
          return { material: mat };
        },
      });

      const mixer = new THREE.AnimationMixer(inner);
      if (walkClip) {
        const act = mixer.clipAction(walkClip);
        act.time = (i * 0.37) % Math.max(0.5, walkClip.duration);
        act.play();
      }

      const side = i % 2 === 0 ? -1 : 1;
      this.group.add(root);
      this.pedestrians.push({
        root,
        mixer,
        uniforms,
        isStaticPerformer: false,
        s: ((i / numWalkers) * groundLen + 15.0) % groundLen,
        totalLen: groundLen,
        lane: side * (10.75 + (i % 3) * 0.35),
        rev: i % 3 === 0,
        walkSpeedMps: 1.38 + (i % 4) * 0.16,
      });
    }
  }

  _spawnSkyBirdsAndHorses(flamingoGltf, storkGltf, horseGltf) {
    // 1. 8 Morph-Animated Flying Birds (`Flamingo.glb` & `Stork.glb`) soaring at Y = 26..34m!
    for (let i = 0; i < 8; i++) {
      const src = i % 2 === 0 ? flamingoGltf : storkGltf;
      if (!src) continue;
      const root = new THREE.Group();
      const model = src.scene.clone(true);
      model.scale.setScalar(0.015);
      root.add(model);

      const uniforms = this.shaderSystem.createEntityUniforms({ isDynamic: true });
      this.shaderSystem.patchHierarchy(model, uniforms, { castShadow: false, receiveShadow: false });

      const mixer = new THREE.AnimationMixer(model);
      if (src.animations[0]) {
        const act = mixer.clipAction(src.animations[0]);
        act.time = (i * 0.21) % Math.max(0.2, src.animations[0].duration);
        act.play();
      }

      this.group.add(root);
      this.birds.push({
        root,
        mixer,
        uniforms,
        cx: 18.0,
        cz: -15.0,
        rx: 68.0 + (i % 3) * 14.0,
        rz: 92.0 + (i % 2) * 18.0,
        alt: 25.0 + (i % 4) * 2.6,
        phase: (i / 8) * Math.PI * 2.0,
        omega: 0.14 + (i % 3) * 0.02,
      });
    }

    // 2. 2 Morph-Animated Thoroughbred Horses (`Horse.glb`) galloping around the Infield Park Meadow!
    if (horseGltf && horseGltf.animations[0]) {
      for (let h = 0; h < 2; h++) {
        const root = new THREE.Group();
        const model = horseGltf.scene.clone(true);
        model.scale.setScalar(0.0105);
        root.add(model);

        const uniforms = this.shaderSystem.createEntityUniforms({ isDynamic: true });
        this.shaderSystem.patchHierarchy(model, uniforms);

        const mixer = new THREE.AnimationMixer(model);
        const act = mixer.clipAction(horseGltf.animations[0]);
        act.time = h * 0.4;
        act.play();

        this.group.add(root);
        this.horses.push({
          root,
          mixer,
          uniforms,
          cx: 56.0,
          cz: 82.0,
          radius: 13.5 + h * 3.0,
          phase: h * 0.65,
          omega: 0.42,
        });
      }
    }
  }

  _buildBulletTrain() {
    const root = new THREE.Group();
    const uniforms = this.shaderSystem.createEntityUniforms({ isDynamic: true });

    const TrainBodyMat = IS_MOBILE_DEVICE ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
    const bodyWhite = this.shaderSystem.patchMaterial(
      new TrainBodyMat({
        color: 0xf4f7fb,
        roughness: 0.16,
        metalness: 0.25,
        ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 0.92, clearcoatRoughness: 0.04 }),
        envMapIntensity: 1.55,
      }),
      uniforms
    );
    const stripeBlue = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.26, metalness: 0.5 }),
      uniforms
    );
    const darkUnder = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.7 }),
      uniforms
    );
    const winGlow = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0xfff0c2, emissiveIntensity: 2.2, roughness: 0.08 }),
      uniforms
    );
    const headBeam = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8e7, emissiveIntensity: 4.5 }),
      uniforms
    );

    // Rounded extruded cylindrical-arch Shinkansen coaches + bogies + roof pantographs!
    const carLen = 14.0, gap = 0.55;
    for (let cIdx = -1; cIdx <= 1; cIdx++) {
      const cx = cIdx * (carLen + gap);
      // Rounded aerodynamic upper fuselage
      const tube = new THREE.CylinderGeometry(1.58, 1.58, carLen, 18, 10);
      tube.rotateZ(Math.PI * 0.5);
      tube.scale(1.0, 0.96, 0.98);
      const body = new THREE.Mesh(tube, bodyWhite);
      body.position.set(cx, 1.85, 0);
      body.castShadow = true;
      body.frustumCulled = false;
      root.add(body);

      const bogie = new THREE.Mesh(new THREE.BoxGeometry(carLen - 1.2, 0.65, 2.45, 8, 1, 1), darkUnder);
      bogie.position.set(cx, 0.48, 0);
      bogie.frustumCulled = false;
      root.add(bogie);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(carLen + 0.02, 0.32, 3.14, 10, 1, 1), stripeBlue);
      stripe.position.set(cx, 1.42, 0);
      stripe.frustumCulled = false;
      root.add(stripe);

      const windows = new THREE.Mesh(new THREE.BoxGeometry(carLen - 1.8, 0.58, 3.12, 10, 1, 1), winGlow);
      windows.position.set(cx, 2.12, 0);
      windows.frustumCulled = false;
      root.add(windows);
    }

    // Streamlined duckbill Shinkansen Lathe nose cones at both ends!
    const nosePts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 1.56 * Math.pow(1.0 - t, 0.58);
      nosePts.push(new THREE.Vector2(r, t * 7.2));
    }
    for (const endSign of [-1, 1]) {
      const lathe = new THREE.LatheGeometry(nosePts, 18);
      lathe.rotateZ(-endSign * Math.PI * 0.5);
      lathe.scale(1.0, 0.94, 0.98);
      const nose = new THREE.Mesh(lathe, bodyWhite);
      nose.position.set(endSign * (1.5 * carLen + gap), 1.82, 0);
      nose.castShadow = true;
      nose.frustumCulled = false;
      root.add(nose);

      for (const lz of [-0.62, 0.62]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), headBeam);
        lamp.position.set(endSign * (1.5 * carLen + gap + 5.6), 1.52, lz);
        lamp.frustumCulled = false;
        root.add(lamp);
      }
    }

    root.position.set(-120.0, 6.82, -78.0);
    this.group.add(root);
    this.train = { root, uniforms, x: -120.0, y: 6.82, z: -78.0, dir: 1.0, baseBeta: 0.68 };
  }

  _initSparkSystem() {
    this.maxSparks = 140;
    this.sparks = [];
    const positions = new Float32Array(this.maxSparks * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    let sparkTex = null;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 64;
      const ctx = cv.getContext('2d');
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
      grad.addColorStop(0.28, 'rgba(255, 210, 120, 0.92)');
      grad.addColorStop(0.65, 'rgba(255, 130, 30, 0.35)');
      grad.addColorStop(1.0, 'rgba(255, 90, 10, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
      sparkTex = new THREE.CanvasTexture(cv);
    }

    const mat = new THREE.PointsMaterial({
      color: 0xffd27d,
      map: sparkTex,
      size: 0.15,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparkPoints = new THREE.Points(geo, mat);
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);
  }

  spawnCollisionSparks(x, y, z, nx, nz, intensity = 1.0) {
    const count = Math.min(36, Math.round(14 + 22 * intensity));
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= this.maxSparks) this.sparks.shift();
      const spread = 5.5 + 8.0 * intensity;
      const tangX = -nz, tangZ = nx;
      const tRand = (Math.random() - 0.5) * 2.2;
      this.sparks.push({
        x: x + (Math.random() - 0.5) * 0.35,
        y: y + (Math.random() - 0.3) * 0.25,
        z: z + (Math.random() - 0.5) * 0.35,
        vx: (nx * (0.4 + Math.random() * 0.8) + tangX * tRand) * spread,
        vy: 2.2 + Math.random() * 5.2 * intensity,
        vz: (nz * (0.4 + Math.random() * 0.8) + tangZ * tRand) * spread,
        life: 0.22 + Math.random() * 0.32,
      });
    }
  }

  _updateSparks(dtReal) {
    const attr = this.sparkPoints.geometry.getAttribute('position');
    const arr = attr.array;
    let writeIdx = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dtReal;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.vy -= 14.0 * dtReal;
      s.x += s.vx * dtReal;
      s.y += s.vy * dtReal;
      s.z += s.vz * dtReal;
      arr[writeIdx * 3 + 0] = s.x;
      arr[writeIdx * 3 + 1] = s.y;
      arr[writeIdx * 3 + 2] = s.z;
      writeIdx++;
    }
    for (let k = writeIdx; k < this.maxSparks; k++) {
      arr[k * 3 + 0] = 0; arr[k * 3 + 1] = -9999; arr[k * 3 + 2] = 0;
    }
    this.sparkPoints.geometry.setDrawRange(0, writeIdx);
    attr.needsUpdate = true;
  }

  /**
   * Exact Special-Relativistic 2-Body Center-of-Momentum (COM) Collision Solver.
   * Lorentz-boosts both vehicles into their Zero-Momentum frame, reflects COM 3-momentum
   * with restitution `e` and Coulomb friction `mu`, and boosts the resulting 4-velocities
   * back to the city frame — guaranteeing lively, momentum-accurate separation even at 0.98c!
   */
  _solveRelativistic2Body(m1, p1x, p1z, m2, p2x, p2z, nx, nz, restitution = 0.72, frictionMu = 0.18) {
    const c = this.metric.c;
    const c2 = c * c;

    const g1 = Math.sqrt(1.0 + (p1x * p1x + p1z * p1z) / c2);
    const g2 = Math.sqrt(1.0 + (p2x * p2x + p2z * p2z) / c2);

    const P1x = m1 * p1x, P1z = m1 * p1z, E1c = m1 * g1 * c;
    const P2x = m2 * p2x, P2z = m2 * p2z, E2c = m2 * g2 * c;

    const EtotC = E1c + E2c;
    const bcmX = (P1x + P2x) / EtotC;
    const bcmZ = (P1z + P2z) / EtotC;
    const bcm2 = Math.min(0.998, bcmX * bcmX + bcmZ * bcmZ);
    const gcm = 1.0 / Math.sqrt(1.0 - bcm2);
    const kcm = bcm2 > 1e-10 ? (gcm - 1.0) / bcm2 : 0.5;

    // Boost Car 1 into COM frame (where P1* + P2* = 0)
    const P1DotB = P1x * bcmX + P1z * bcmZ;
    const P1sX = P1x + (kcm * P1DotB - gcm * E1c) * bcmX;
    const P1sZ = P1z + (kcm * P1DotB - gcm * E1c) * bcmZ;

    // Normal points from Car 2 -> Car 1, so approaching means PnStar < 0
    const PnStar = P1sX * nx + P1sZ * nz;
    if (PnStar >= -1e-4) return null;

    const PtStarX = P1sX - PnStar * nx;
    const PtStarZ = P1sZ - PnStar * nz;
    const PtMag = Math.hypot(PtStarX, PtStarZ);

    const PnAfter = -restitution * PnStar;
    const dPn = -(1.0 + restitution) * PnStar;
    const newPtMag = Math.max(0.0, PtMag - frictionMu * dPn);
    const scaleT = PtMag > 1e-6 ? newPtMag / PtMag : 0.0;

    const P1sAfterX = PnAfter * nx + PtStarX * scaleT;
    const P1sAfterZ = PnAfter * nz + PtStarZ * scaleT;
    const P1sAfter2 = P1sAfterX * P1sAfterX + P1sAfterZ * P1sAfterZ;

    const E1sAfterC = Math.sqrt((m1 * c) * (m1 * c) + P1sAfter2);
    const E2sAfterC = Math.sqrt((m2 * c) * (m2 * c) + P1sAfter2);

    // Boost post-impact 4-velocities back to the city frame
    const P1aDotB = P1sAfterX * bcmX + P1sAfterZ * bcmZ;
    const P1AfterX = P1sAfterX + (kcm * P1aDotB + gcm * E1sAfterC) * bcmX;
    const P1AfterZ = P1sAfterZ + (kcm * P1aDotB + gcm * E1sAfterC) * bcmZ;

    const P2AfterX = -P1sAfterX + (kcm * (-P1aDotB) + gcm * E2sAfterC) * bcmX;
    const P2AfterZ = -P1sAfterZ + (kcm * (-P1aDotB) + gcm * E2sAfterC) * bcmZ;

    return {
      p1AfterX: P1AfterX / m1,
      p1AfterZ: P1AfterZ / m1,
      p2AfterX: P2AfterX / m2,
      p2AfterZ: P2AfterZ / m2,
      Jx1: P1AfterX - P1x,
      Jz1: P1AfterZ - P1z,
      Jx2: P2AfterX - P2x,
      Jz2: P2AfterZ - P2z,
      JnMag: dPn,
    };
  }

  resolveVehicleCollisions(vehicle, _dtCoord) {
    const c = this.metric.c;
    const c2 = c * c;

    const playerBox = {
      x: vehicle.carX,
      z: vehicle.carZ,
      yaw: vehicle.moveYaw,
      halfW: vehicle.halfW,
      halfL: vehicle.halfL,
    };

    // 1. Player <-> AI Supercars & Trucks
    for (let i = 0; i < this.cars.length; i++) {
      const npc = this.cars[i];
      if (Math.abs(vehicle.footY - npc.y) > 2.1) continue;

      let hit = intersectOBB2D(playerBox, npc);

      // Also check past-light-cone retarded visual position when close so physical impact
      // aligns cleanly with the visual bumper the player sees!
      if (!hit) {
        const dx = npc.x - vehicle.carX;
        const dz = npc.z - vehicle.carZ;
        const dApprox = Math.hypot(dx, dz);
        if (dApprox < 10.5) {
          const gNpc = Math.sqrt(1.0 + (npc.px * npc.px + npc.pz * npc.pz) / c2);
          const uEst = dApprox;
          const retBox = {
            x: npc.x - (uEst * (npc.px / gNpc)) / c,
            z: npc.z - (uEst * (npc.pz / gNpc)) / c,
            yaw: npc.yaw,
            halfW: npc.halfW,
            halfL: npc.halfL,
          };
          hit = intersectOBB2D(playerBox, retBox);
        }
      }
      if (!hit) continue;

      const { pen, nx, nz, cpx, cpz } = hit;
      const g1 = Math.sqrt(1.0 + (vehicle.px * vehicle.px + vehicle.py * vehicle.py + vehicle.pz * vehicle.pz) / c2);
      const g2 = Math.sqrt(1.0 + (npc.px * npc.px + npc.pz * npc.pz) / c2);

      // Weight positional separation by rest-mass ratio so equal-mass cars share push-out cleanly
      const invM1 = 1.0 / vehicle.mass;
      const invM2 = 1.0 / npc.mass;
      const invSum = invM1 + invM2;

      const totalPush = pen + 0.05;
      vehicle.carX += nx * totalPush * (invM1 / invSum);
      vehicle.carZ += nz * totalPush * (invM1 / invSum);
      playerBox.x = vehicle.carX;
      playerBox.z = vehicle.carZ;

      npc.x -= nx * totalPush * (invM2 / invSum);
      npc.z -= nz * totalPush * (invM2 / invSum);

      const sol = this._solveRelativistic2Body(
        vehicle.mass, vehicle.px, vehicle.pz,
        npc.mass, npc.px, npc.pz,
        nx, nz,
        0.74, // lively racing bumper restitution
        0.18
      );

      // Switch struck car into free rigid-body ballistic slide (ZERO emergency braking!)
      npc.disturbedTimer = Math.max(npc.disturbedTimer, 1.35);

      if (sol) {
        // Apply exact relativistic COM momentum impulse + lever-arm yaw spin to Player
        vehicle.applyRigidBodyImpulse(sol.Jx1, sol.Jz1, cpx, cpz);
        vehicle.px = sol.p1AfterX;
        vehicle.pz = sol.p1AfterZ;

        // Apply exact post-impact relativistic momentum + spin + 3D suspension hop/roll to struck NPC!
        npc.px = sol.p2AfterX;
        npc.pz = sol.p2AfterZ;

        const r2x = cpx - npc.x;
        const r2z = cpz - npc.z;
        const torque2 = r2x * sol.Jz2 - r2z * sol.Jx2;
        npc.yawRate = Math.max(-5.2, Math.min(5.2, npc.yawRate + (torque2 / npc.inertiaY) * 1.45));

        const dv2 = Math.hypot(sol.Jx2, sol.Jz2) / npc.mass;
        const severity = Math.min(1.0, dv2 / Math.max(4.0, 0.35 * c));
        npc.hopVelY = Math.min(1.45, Math.max(npc.hopVelY, 0.65 + 0.80 * severity));
        const right2X = Math.cos(npc.yaw), right2Z = Math.sin(npc.yaw);
        const latJ = (sol.Jx2 * right2X + sol.Jz2 * right2Z) / npc.mass;
        npc.rollVel = Math.max(-3.2, Math.min(3.2, npc.rollVel - latJ * 0.15));
        npc.pitchJolt = Math.max(-0.08, Math.min(0.08, -severity * 0.07));

        this.spawnCollisionSparks(
          cpx,
          Math.max(vehicle.footY, npc.y) + 0.58,
          cpz,
          nx,
          nz,
          Math.max(0.35, severity)
        );
      }
    }

    // 2. NPC <-> NPC Chain-Reaction Collisions (knocking one car into another!)
    for (let i = 0; i < this.cars.length; i++) {
      const a = this.cars[i];
      for (let j = i + 1; j < this.cars.length; j++) {
        const b = this.cars[j];
        if (a.disturbedTimer <= 0.0 && b.disturbedTimer <= 0.0) continue;
        if (Math.abs(a.y - b.y) > 2.0) continue;
        const dx = a.x - b.x, dz = a.z - b.z;
        if (dx * dx + dz * dz > 26.0) continue;

        const hit = intersectOBB2D(a, b);
        if (!hit) continue;
        const { pen, nx, nz, cpx, cpz } = hit;
        const wA = b.mass / (a.mass + b.mass);
        const wB = 1.0 - wA;
        a.x += nx * (pen + 0.04) * wA;
        a.z += nz * (pen + 0.04) * wA;
        b.x -= nx * (pen + 0.04) * wB;
        b.z -= nz * (pen + 0.04) * wB;

        const sol = this._solveRelativistic2Body(a.mass, a.px, a.pz, b.mass, b.px, b.pz, nx, nz, 0.68, 0.18);
        a.disturbedTimer = Math.max(a.disturbedTimer, 1.2);
        b.disturbedTimer = Math.max(b.disturbedTimer, 1.2);
        if (sol) {
          a.px = sol.p1AfterX; a.pz = sol.p1AfterZ;
          b.px = sol.p2AfterX; b.pz = sol.p2AfterZ;
          a.yawRate = Math.max(-4.8, Math.min(4.8, a.yawRate + ((cpx - a.x) * sol.Jz1 - (cpz - a.z) * sol.Jx1) / a.inertiaY));
          b.yawRate = Math.max(-4.8, Math.min(4.8, b.yawRate + ((cpx - b.x) * sol.Jz2 - (cpz - b.z) * sol.Jx2) / b.inertiaY));
          a.hopVelY = Math.min(1.3, Math.max(a.hopVelY, 0.85));
          b.hopVelY = Math.min(1.3, Math.max(b.hopVelY, 0.85));
          this.spawnCollisionSparks(cpx, Math.max(a.y, b.y) + 0.55, cpz, nx, nz, 0.65);
        }
      }
    }
  }

  update(dtCoord, dtReal, observer, vehicle, raceCoordElapsed = 0.0) {
    const dtC = Math.min(0.15, Math.max(0.0, dtCoord));
    const c = this.metric.c;
    const c2 = c * c;
    const gLen = this.cityWorld.track.groundData.totalLen;
    const sLen = this.cityWorld.track.skywayData.totalLen;

    // 1. Update Player Ferrari 458
    if (this.playerCar && vehicle) {
      const pc = this.playerCar;
      pc.root.visible = vehicle.viewMode !== 'bumper';
      pc.root.position.set(vehicle.carX, vehicle.footY, vehicle.carZ);
      pc.root.rotation.set(vehicle.movePitch + vehicle.chassisPitchJolt, -vehicle.moveYaw, vehicle.chassisRoll, 'YXZ');

      const spin = -vehicle.wheelSpinAngle;
      const steer = -vehicle.steerAngle;
      if (pc.wheelFL) { pc.wheelFL.rotation.y = steer; pc.wheelFL.rotation.x = spin; }
      if (pc.wheelFR) { pc.wheelFR.rotation.y = steer; pc.wheelFR.rotation.x = spin; }
      if (pc.wheelRL) pc.wheelRL.rotation.x = spin;
      if (pc.wheelRR) pc.wheelRR.rotation.x = spin;
      if (pc.steeringWheel) pc.steeringWheel.rotation.z = -vehicle.steerAngle * 2.35;

      const brakeGlow = vehicle.isBraking ? 6.5 : 1.5;
      for (const bm of pc.brakeMaterials) bm.emissiveIntensity = brakeGlow;
    }

    // 2. Update AI Grand Prix Opponents & Ambient Trucks
    const groundFrames = this.cityWorld.track.groundData.frames;

    for (let i = 0; i < this.cars.length; i++) {
      const npc = this.cars[i];
      const prevZ = npc.z;

      if (npc.disturbedTimer > 0.0) {
        const dtStep = Math.max(dtReal, 0.008);
        npc.disturbedTimer = Math.max(0.0, npc.disturbedTimer - dtStep);
        const g = Math.sqrt(1.0 + (npc.px * npc.px + npc.pz * npc.pz) / c2);
        npc.x += (npc.px / g) * dtC;
        npc.z += (npc.pz / g) * dtC;
        npc.yaw += npc.yawRate * dtStep;

        // Low free-rolling coasting resistance (NO invisible emergency braking!)
        // + gentle lateral tire scrub so struck cars visibly launch away and slide!
        const surf = this.cityWorld.getSupportSurface(npc.x, npc.y, npc.z);
        const surfDrag = surf.terrain === 'water' ? 3.2 : surf.terrain === 'sand' ? 2.0 : surf.terrain === 'grass' ? 1.1 : 0.24;
        const damp = Math.exp(-surfDrag * dtStep);
        npc.px *= damp;
        npc.pz *= damp;
        npc.yawRate *= Math.exp(-2.8 * dtStep);

        const bHit = this.cityWorld.queryBarrierContact(npc.x, npc.y, npc.z);
        if (bHit.hit) {
          npc.x += bHit.nx * (bHit.pen + 0.03);
          npc.z += bHit.nz * (bHit.pen + 0.03);
          const pDotN = npc.px * bHit.nx + npc.pz * bHit.nz;
          if (pDotN < 0) {
            npc.px -= 1.45 * pDotN * bHit.nx;
            npc.pz -= 1.45 * pDotN * bHit.nz;
            npc.yawRate = Math.max(-4.5, Math.min(4.5, npc.yawRate + (Math.random() - 0.5) * 1.4));
          }
        }
        npc.y = surf.y;

        if (npc.disturbedTimer <= 0.001) {
          const ribbon = npc.track === 'skyway'
            ? this.cityWorld.track.skywayData
            : this.cityWorld.track.groundData;
          let bestD2 = Infinity;
          let bestFrame = ribbon.frames[0];
          for (let k = 0; k < ribbon.frames.length; k += 2) {
            const f = ribbon.frames[k];
            const d2 = (npc.x - f.pos.x) ** 2 + (npc.z - f.pos.z) ** 2;
            if (d2 < bestD2) {
              bestD2 = d2;
              bestFrame = f;
            }
          }
          npc.s = bestFrame.s;
          const latNow = (npc.x - bestFrame.pos.x) * bestFrame.right.x + (npc.z - bestFrame.pos.z) * bestFrame.right.z;
          npc.lane = THREE.MathUtils.clamp(latNow, -7.2, 7.2);
          const gRec = Math.sqrt(1.0 + (npc.px * npc.px + npc.pz * npc.pz) / c2);
          const vRec = Math.hypot(npc.px, npc.pz) / gRec;
          npc.curBeta = THREE.MathUtils.clamp(vRec / c, 0.05, 0.92);
        }
      } else if (npc.isOpponent) {
        // Competitive Grand Prix Racing AI!
        if (!this.canRace) {
          npc.curBeta = 0.0;
          npc.px = 0.0;
          npc.pz = 0.0;
        } else {
          // Corner curvature lookahead (24m ahead) -> realistic corner braking!
          let lookCurv = 0.0;
          if (npc.track === 'ground') {
            const lookIdx = Math.floor((((npc.s + 24.0) % gLen) / gLen) * (groundFrames.length - 1));
            lookCurv = Math.abs(groundFrames[lookIdx]?.signedCurv || 0.0);
          }
          const cornerCap = lookCurv > 0.013 ? 0.56 : lookCurv > 0.008 ? 0.68 : npc.topBeta;
          const desiredBeta = Math.min(0.90, cornerCap * this.trafficSpeedScale);
          // Brisk GT launch & corner exit rate (~0.55/s) matching the expanded 1,520m high-speed circuit!
          npc.curBeta += (desiredBeta - npc.curBeta) * Math.min(1.0, 0.55 * Math.max(dtReal, 0.016));

          const speedMps = npc.curBeta * c;
          const prevS = npc.s;
          npc.s += speedMps * dtC;

          // Skyway joker-route branch decision at Z=68 split!
          if (
            npc.track === 'ground' &&
            npc.skywayMod > 0 &&
            (npc.lap % npc.skywayMod === 0) &&
            prevS < this.sSkywaySplit &&
            npc.s >= this.sSkywaySplit
          ) {
            npc.track = 'skyway';
            npc.totalLen = sLen;
            npc.s = 2.0;
            npc.targetLane = 2.4;
          } else if (npc.track === 'skyway' && npc.s >= sLen - 4.0) {
            // Seamless merge back onto Grand Boulevard Straightaway!
            npc.track = 'ground';
            npc.totalLen = gLen;
            npc.s = this.sSkywayMerge;
            npc.targetLane = 2.4;
          } else if (npc.track === 'ground') {
            npc.s = ((npc.s % gLen) + gLen) % gLen;
          }

          npc.lane += (npc.targetLane - npc.lane) * Math.min(1.0, 3.0 * dtReal);
          const pose = this.cityWorld.sampleLanePose(npc.track, npc.s, npc.lane, false);
          const blend = Math.min(1.0, 10.0 * Math.max(dtReal, 0.016));
          npc.x += (pose.pos.x - npc.x) * blend;
          npc.y = pose.pos.y;
          npc.z += (pose.pos.z - npc.z) * blend;

          let dYaw = ((pose.yaw - npc.yaw + Math.PI) % (2 * Math.PI));
          if (dYaw < 0) dYaw += 2 * Math.PI;
          dYaw -= Math.PI;
          npc.yaw += dYaw * blend;
          npc.pitch = pose.pitch;

          const gAi = 1.0 / Math.sqrt(Math.max(1e-5, 1.0 - npc.curBeta * npc.curBeta));
          npc.px = gAi * speedMps * pose.tan.x;
          npc.pz = gAi * speedMps * pose.tan.z;
          npc.properTime += dtC / gAi;
        }
      } else {
        // Ambient Truck Cruise
        const targetBeta = Math.min(0.75, npc.baseBeta * this.trafficSpeedScale);
        npc.curBeta = targetBeta;
        const speedMps = targetBeta * c;
        const dirSign = npc.rev ? -1.0 : 1.0;
        npc.s = (((npc.s + dirSign * speedMps * dtC) % npc.totalLen) + npc.totalLen) % npc.totalLen;

        const pose = this.cityWorld.sampleLanePose(npc.track, npc.s, npc.lane, npc.rev);
        npc.x = pose.pos.x;
        npc.y = pose.pos.y;
        npc.z = pose.pos.z;
        npc.yaw = pose.yaw;
        npc.pitch = pose.pitch;

        const gTrk = 1.0 / Math.sqrt(Math.max(1e-5, 1.0 - targetBeta * targetBeta));
        npc.px = gTrk * speedMps * pose.tan.x;
        npc.pz = gTrk * speedMps * pose.tan.z;
      }

      // Track AI Opponent Lap Counting & Monotonic Race Score!
      if (npc.isOpponent) {
        if (!npc.hasCrossedStart && npc.y < 2.5 && Math.abs(npc.x) < 12.5 && prevZ > 94.0 && npc.z <= 94.0) {
          npc.hasCrossedStart = true;
        }
        if (npc.z < -35.0 || npc.y > 8.0) {
          npc.passedMidpoint = true;
          npc.hasCrossedStart = true;
        }
        if (npc.passedMidpoint && npc.y < 2.5 && Math.abs(npc.x) < 12.5 && prevZ > 94.0 && npc.z <= 94.0) {
          npc.lap++;
          npc.passedMidpoint = false;
          if (npc.lap >= 3 && !npc.finished) {
            npc.finished = true;
            npc.finishCoordTime = raceCoordElapsed;
            npc.finishProperTime = npc.properTime;
          }
        }
        const frac = this.computeLapFraction(npc.x, npc.y, npc.z);
        npc.raceScore = (!npc.hasCrossedStart && frac > 0.85) ? (frac - 1.0) : (npc.lap + frac);
      }

      // Shader uniforms & wheel spin
      const gNpc = Math.sqrt(1.0 + (npc.px * npc.px + npc.pz * npc.pz) / c2);
      const vxNpc = npc.px / gNpc;
      const vzNpc = npc.pz / gNpc;
      if (npc.disturbedTimer > 0.0) {
        npc.curBeta = THREE.MathUtils.clamp(Math.hypot(vxNpc, vzNpc) / c, 0.0, 0.96);
      }
      const vyNpc = Math.hypot(vxNpc, vzNpc) * Math.sin(npc.pitch);
      const bx = THREE.MathUtils.clamp(vxNpc / c, -0.96, 0.96);
      const by = THREE.MathUtils.clamp(vyNpc / c, -0.96, 0.96);
      const bz = THREE.MathUtils.clamp(vzNpc / c, -0.96, 0.96);
      const gammaFinal = 1.0 / Math.sqrt(1.0 - Math.min(0.95, bx * bx + by * by + bz * bz));

      // Spring-damper suspension hop, body roll & pitch jolt after impacts!
      const dtSusp = Math.max(dtReal, 0.008);
      if (npc.hopY > 0.0 || npc.hopVelY !== 0.0) {
        npc.hopVelY -= 20.0 * dtSusp;
        npc.hopY = Math.min(0.16, npc.hopY + npc.hopVelY * dtSusp);
        if (npc.hopY <= 0.0) {
          npc.hopY = 0.0;
          npc.hopVelY = Math.abs(npc.hopVelY) > 0.5 ? -npc.hopVelY * 0.22 : 0.0;
        }
      }
      npc.rollVel -= 42.0 * npc.rollAngle * dtSusp;
      npc.rollVel *= Math.exp(-7.5 * dtSusp);
      npc.rollAngle += npc.rollVel * dtSusp;
      npc.pitchJolt *= Math.exp(-7.0 * dtSusp);

      npc.root.position.set(npc.x, npc.y + npc.hopY, npc.z);
      npc.root.rotation.set(npc.pitch + npc.pitchJolt, -npc.yaw, npc.rollAngle, 'YXZ');
      if (IS_MOBILE_DEVICE) {
        const dxObs = npc.x - vehicle.carX;
        const dzObs = npc.z - vehicle.carZ;
        npc.root.visible = (dxObs * dxObs + dzObs * dzObs) < 250.0 * 250.0;
      }
      npc.uniforms.uEntityPosNow.value.set(npc.x, npc.y + npc.hopY + 0.55, npc.z);
      npc.uniforms.uEntityBeta.value.set(bx, by, bz);
      npc.uniforms.uEntityGamma.value = gammaFinal;

      const fwdSpeed = vxNpc * Math.sin(npc.yaw) - vzNpc * Math.cos(npc.yaw);
      npc.wheelSpin = (npc.wheelSpin + (fwdSpeed * dtC) / npc.wheelRadius) % (Math.PI * 200.0);
      if (npc.wheelFL) npc.wheelFL.rotation.x = -npc.wheelSpin;
      if (npc.wheelFR) npc.wheelFR.rotation.x = -npc.wheelSpin;
      if (npc.wheelRL) npc.wheelRL.rotation.x = -npc.wheelSpin;
      if (npc.wheelRR) npc.wheelRR.rotation.x = -npc.wheelSpin;
      if (npc.truckWheels) {
        for (const tw of npc.truckWheels) tw.rotation.y = npc.wheelSpin;
      }
    }

    // 3. Update Elevated Shinkansen Bullet Train
    if (this.train) {
      const tr = this.train;
      const trainBeta = Math.min(0.88, tr.baseBeta * this.trafficSpeedScale);
      tr.x += tr.dir * trainBeta * c * dtC;
      if (tr.x > 265.0) tr.x = -265.0;
      if (tr.x < -265.0) tr.x = 265.0;
      tr.root.position.set(tr.x, tr.y, tr.z);
      const gTrain = 1.0 / Math.sqrt(Math.max(1e-5, 1.0 - trainBeta * trainBeta));
      tr.uniforms.uEntityPosNow.value.set(tr.x, tr.y + 1.6, tr.z);
      tr.uniforms.uEntityBeta.value.set(tr.dir * trainBeta, 0.0, 0.0);
      tr.uniforms.uEntityGamma.value = gTrain;
    }

    // 4. Update Skeletal Pedestrians
    for (let i = 0; i < this.pedestrians.length; i++) {
      const p = this.pedestrians[i];
      if (IS_MOBILE_DEVICE && p.x !== undefined) {
        const dxP = p.x - vehicle.carX;
        const dzP = p.z - vehicle.carZ;
        p.root.visible = (dxP * dxP + dzP * dzP) < 175.0 * 175.0;
        if (!p.root.visible && !p.isStaticPerformer) continue;
      }
      if (p.mixer) p.mixer.update(Math.min(0.10, dtC));
      if (p.isStaticPerformer) continue;

      const walkV = Math.min(0.45 * c, p.walkSpeedMps);
      const sign = p.rev ? -1.0 : 1.0;
      p.s = (((p.s + sign * walkV * dtC) % p.totalLen) + p.totalLen) % p.totalLen;
      const pose = this.cityWorld.sampleLanePose('ground', p.s, p.lane, p.rev);
      const footSurf = this.cityWorld.getSupportSurface(pose.pos.x, pose.pos.y + 0.3, pose.pos.z);

      p.root.position.set(pose.pos.x, footSurf.y, pose.pos.z);
      p.root.rotation.set(0, -pose.yaw, 0);

      const bx = THREE.MathUtils.clamp((walkV * pose.tan.x) / c, -0.8, 0.8);
      const bz = THREE.MathUtils.clamp((walkV * pose.tan.z) / c, -0.8, 0.8);
      p.uniforms.uEntityPosNow.value.set(pose.pos.x, footSurf.y + 0.9, pose.pos.z);
      p.uniforms.uEntityBeta.value.set(bx, 0.0, bz);
      p.uniforms.uEntityGamma.value = 1.0 / Math.sqrt(Math.max(1e-5, 1.0 - (bx * bx + bz * bz)));
    }

    // 5. Update Morph-Animated Sky Birds (`Flamingo.glb`, `Stork.glb`)
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      b.mixer.update(Math.min(0.12, dtC * 1.1));
      b.phase = (b.phase + b.omega * dtC) % (Math.PI * 2.0);
      const x = b.cx + Math.cos(b.phase) * b.rx;
      const z = b.cz + Math.sin(b.phase) * b.rz;
      const vx = -Math.sin(b.phase) * b.rx * b.omega;
      const vz = Math.cos(b.phase) * b.rz * b.omega;

      b.root.position.set(x, b.alt, z);
      b.root.rotation.y = Math.atan2(vx, vz); // Flamingo/Stork models face +Z

      const bx = THREE.MathUtils.clamp(vx / c, -0.75, 0.75);
      const bz = THREE.MathUtils.clamp(vz / c, -0.75, 0.75);
      b.uniforms.uEntityPosNow.value.set(x, b.alt, z);
      b.uniforms.uEntityBeta.value.set(bx, 0.0, bz);
      b.uniforms.uEntityGamma.value = 1.0 / Math.sqrt(Math.max(1e-5, 1.0 - (bx * bx + bz * bz)));
    }

    // 6. Update Galloping Park Horses (`Horse.glb`)
    for (let i = 0; i < this.horses.length; i++) {
      const h = this.horses[i];
      h.mixer.update(Math.min(0.12, dtC * 1.15));
      h.phase = (h.phase + h.omega * dtC) % (Math.PI * 2.0);
      const x = h.cx + Math.cos(h.phase) * h.radius;
      const z = h.cz + Math.sin(h.phase) * h.radius;
      const vx = -Math.sin(h.phase) * h.radius * h.omega;
      const vz = Math.cos(h.phase) * h.radius * h.omega;

      const hSurfY = this.cityWorld.getSupportSurface(x, 0.5, z).y;
      h.root.position.set(x, hSurfY - 0.03, z);
      h.root.rotation.y = Math.atan2(vx, vz);

      const bx = THREE.MathUtils.clamp(vx / c, -0.75, 0.75);
      const bz = THREE.MathUtils.clamp(vz / c, -0.75, 0.75);
      h.uniforms.uEntityPosNow.value.set(x, 0.9, z);
      h.uniforms.uEntityBeta.value.set(bx, 0.0, bz);
      h.uniforms.uEntityGamma.value = 1.0 / Math.sqrt(Math.max(1e-5, 1.0 - (bx * bx + bz * bz)));
    }

    this._updateSparks(dtReal);
  }
}
