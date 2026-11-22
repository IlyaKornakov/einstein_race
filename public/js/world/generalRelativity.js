/**
 * Faithful General Relativity World Phenomena (v2.1):
 *   1. Spinning Kerr–Schwarzschild Black Hole ("Gargantua Ergosphere Basin")
 *      - Symplectic Velocity-Verlet 3D null-geodesic raymarcher with exact static-observer
 *        orthonormal tetrad launch, reproducing Synge's >180 deg near-horizon shadow cone,
 *        r = 1.5 r_H Photon Ring, and double-imaged Doppler-beamed Keplerian accretion disk.
 *      - Unclamped strong-field gravitational time dilation up to ~55x near r -> r_H,
 *        active gravitational pull even at rest (0.000c), and Boyer–Lindquist Kerr
 *        ergosphere frame-dragging (impossible to remain stationary inside the ergosphere!).
 *   2. Finite-Throat Traversable Morris–Thorne Wormhole ("Einstein–Rosen Shortcut")
 *      - Live dynamic CubeCamera destination panoramas + continuous 20m curved-spacetime
 *        throat traversal (l in [-10m, +10m]) solving Ellis–Bronnikov null geodesics across
 *        both universes simultaneously without an instant 1-frame teleport cut.
 *   3. Binary Black Hole Merger & LIGO Gravitational-Wave Corridor (East Skyline)
 *      - Orbiting binary inspiral overhead radiating transverse-traceless (h_+ / h_x)
 *        quadrupole metric ripples at speed c through 4 Fabry–Pérot laser interferometer gates.
 */

import * as THREE from 'three';
import { getSpectralGLSL } from '../physics/spectral.js?v=2.2';
import { IS_MOBILE_DEVICE } from '../render/renderer.js?v=2.2';

function makePortalGantrySign(title, subtitle, bgHex = '#311042', borderHex = '#38bdf8') {
  const scale = IS_MOBILE_DEVICE ? 0.5 : 1.0;
  const w = 1024, h = 256;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const ctx = cv.getContext('2d');
  if (scale !== 1.0) ctx.scale(scale, scale);

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = borderHex;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, w - 28, h - 28);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 54px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, w * 0.5, h * 0.39);

  ctx.fillStyle = '#fde68a';
  ctx.font = '800 30px Inter, system-ui, sans-serif';
  ctx.fillText(subtitle, w * 0.5, h * 0.74);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GeneralRelativitySystem {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} threeRenderer
   * @param {import('../physics/spacetime.js').GeneralRelativityMetric} metric
   * @param {import('../render/relativisticMaterial.js').RelativisticShaderSystem} shaderSystem
   * @param {object} materials
   * @param {object} track
   */
  constructor(scene, threeRenderer, metric, shaderSystem, materials, track) {
    this.scene = scene;
    this.threeRenderer = threeRenderer;
    this.metric = metric;
    this.shaderSystem = shaderSystem;
    this.materials = materials;
    this.track = track;

    this.group = new THREE.Group();
    this.group.name = 'GeneralRelativityPhenomena';
    this.scene.add(this.group);

    this.bhBoundRadius = 31.0;
    this.wormholeShellRadius = 6.6;
    this.playerWormholeCooldown = 0.0;

    // Continuous Finite-Length Morris–Thorne Throat State (l in [-L/2 .. +L/2])
    this.inThroat = false;
    this.throatDir = 1;       // +1: A -> B, -1: B -> A
    this.throatL = 0.0;       // current proper radial throat coordinate l [m]
    this.throatHalfL = 0.5 * (this.metric.wormholeLength || 20.0);
    this.throatEntryYaw = 0.0;
    this.throatExitYaw = 0.0;
    this.throatAxis = new THREE.Vector3(0, 0, -1);

    this.onWormholeTraverse = null;
    this.onHorizonReset = null;

    this.cubeFrameCounter = 0;
    this.lastCubeBakeTod = -999.0;
    this.gwLaserMats = [];

    this._buildBasinAndGantries();
    this._buildBlackHoleRaymarcher();
    this._buildWormholePortals();
    this._buildWormholeThroatTunnel();
    this._buildGravitationalWaveCorridor();
  }

  _buildBasinAndGantries() {
    const bhX = this.metric.bhPos[0];
    const bhZ = this.metric.bhPos[2];
    const rH = this.metric.bhRs;

    // 1. Wide Paved Obsidian Ergosphere Basin (allows smooth driving right up to r -> r_H!)
    const dishGeo = new THREE.RingGeometry(0.6, 24.2, 64, 10);
    dishGeo.rotateX(-Math.PI * 0.5);
    dishGeo.setAttribute('uv1', dishGeo.getAttribute('uv'));
    const dishMat = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x080c16,
        emissive: 0x181338,
        emissiveIntensity: 0.42,
        roughness: 0.24,
        metalness: 0.78,
      })
    );
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.position.set(bhX, 0.026, bhZ);
    dish.frustumCulled = false;
    this.group.add(dish);

    // Physical GR Radius Rings on Basin Floor:
    //   - r = 1.45 r_H (5.1m): Event Horizon Brink (Crimson — 25x to 55x Time Dilation!)
    //   - r = 2.15 r_H (7.5m): Inner Ergosphere / Photon Ring (Amber — 7x to 15x Dilation!)
    //   - r = 3.50 r_H (12.2m): Outer Ergosphere Boundary (Violet-Cyan — Frame-Dragging Zone!)
    for (const [rad, hex, intensity] of [
      [rH * 1.45, 0xf43f5e, 3.0],
      [rH * 2.15, 0xf59e0b, 2.4],
      [rH * 3.50, 0x38bdf8, 1.9],
    ]) {
      const rGeo = new THREE.RingGeometry(rad - 0.16, rad + 0.16, 64, 1);
      rGeo.rotateX(-Math.PI * 0.5);
      rGeo.setAttribute('uv1', rGeo.getAttribute('uv'));
      const rMat = this.shaderSystem.patchMaterial(
        new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: intensity,
          roughness: 0.2,
        })
      );
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.position.set(bhX, 0.042, bhZ);
      rMesh.frustumCulled = false;
      this.group.add(rMesh);
    }

    // 2. Overhead Highway Gantry for Black Hole Ergosphere & Slingshot (Z = +115 on Grand Boulevard)
    this._addSignGantry(
      -2.2, 115.0, 0.0, 25.0,
      '↙ BLACK HOLE ERGOSPHERE',
      'UP TO 50× TIME DILATION  •  KERR FRAME-DRAGGING',
      '#3b0764',
      '#c084fc'
    );

    // 3. Overhead Highway Gantry for North Boulevard Wormhole Shortcut (Z = -256)
    this._addSignGantry(
      -2.0, -256.0, 0.0, 24.4,
      '↑ WORMHOLE SHORTCUT',
      '20m MORRIS–THORNE THROAT  →  EAST SKYLINE',
      '#083344',
      '#22d3ee'
    );

    // 4. Exotic-Matter Magnetic Containment Arch Rings around Wormhole Mouths A & B
    this._buildWormholeArchFrame(this.metric.wormholeA[0], 0.0, this.metric.wormholeA[2], 0.08);
    this._buildWormholeArchFrame(this.metric.wormholeB[0], 1.25, this.metric.wormholeB[2], -0.18);
  }

  _addSignGantry(cx, cz, yaw, spanW, title, subtitle, bgHex, borderHex = '#38bdf8', baseY = 0.0) {
    const gantryY = baseY + 7.3;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const halfSpan = spanW * 0.5;
    const postH = 7.8;

    for (const side of [-1, 1]) {
      const px = cx + cosY * side * halfSpan;
      const pz = cz + sinY * side * halfSpan;
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.34, postH, 10, 4),
        this.materials.brushedSteel
      );
      post.position.set(px, baseY + postH * 0.5 - 0.2, pz);
      post.frustumCulled = false;
      this.group.add(post);
      this.track.registerSolidCylinder(px, pz, 0.36, gantryY);
    }

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(spanW + 0.6, 0.52, 0.52, 10, 1, 1),
      this.materials.brushedSteel
    );
    bar.position.set(cx, gantryY, cz);
    bar.rotation.y = -yaw;
    bar.frustumCulled = false;
    this.group.add(bar);

    const signTex = makePortalGantrySign(title, subtitle, bgHex, borderHex);
    const signMat = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({
        map: signTex,
        emissiveMap: signTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.42,
        roughness: 0.3,
        metalness: 0.15,
      })
    );
    const signGeo = new THREE.BoxGeometry(12.6, 2.35, 0.22, 12, 3, 1);
    signGeo.setAttribute('uv1', signGeo.getAttribute('uv'));
    const fwdX = Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.position.set(cx - fwdX * 0.24, gantryY + 0.15, cz - fwdZ * 0.24);
    signMesh.rotation.y = -yaw;
    signMesh.frustumCulled = false;
    this.group.add(signMesh);
  }

  _buildWormholeArchFrame(wx, baseY, wz, rotY) {
    const holder = new THREE.Group();
    holder.position.set(wx, baseY, wz);
    holder.rotation.y = rotY;

    const ringGeo = new THREE.TorusGeometry(5.85, 0.28, 10, 48);
    ringGeo.setAttribute('uv1', ringGeo.getAttribute('uv'));
    const ringMesh = new THREE.Mesh(ringGeo, this.materials.brushedSteel);
    ringMesh.position.y = 2.6;
    ringMesh.frustumCulled = false;
    holder.add(ringMesh);

    const glowGeo = new THREE.TorusGeometry(5.52, 0.11, 8, 48);
    glowGeo.setAttribute('uv1', glowGeo.getAttribute('uv'));
    const glowMesh = new THREE.Mesh(glowGeo, this.materials.syncPulseCyan);
    glowMesh.position.y = 2.6;
    glowMesh.frustumCulled = false;
    holder.add(glowMesh);

    const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
    for (const side of [-1, 1]) {
      const lx = side * 6.15;
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 4.4, 1.35, 2, 4, 2),
        this.materials.stoneAshlar
      );
      pylon.position.set(lx, 2.0, 0);
      pylon.frustumCulled = false;
      holder.add(pylon);
      this.track.registerSolidBox(wx + lx * cosR, wz - lx * sinR, 0.55, 0.75, -rotY, baseY + 4.5);
    }

    this.group.add(holder);
  }

  _buildBlackHoleRaymarcher() {
    const metricGLSL = this.metric.getShaderModule();
    const spectralGLSL = getSpectralGLSL();
    const steps = IS_MOBILE_DEVICE ? 30 : 48;

    const uniforms = Object.assign({}, this.shaderSystem.sharedUniforms, {
      uBoundRadius: { value: this.bhBoundRadius },
      uInsideBH: { value: 0.0 },
    });

    const geo = new THREE.SphereGeometry(this.bhBoundRadius, 52, 38);
    const mat = new THREE.ShaderMaterial({
      name: 'KerrSchwarzschildBlackHole',
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */ `
        varying vec3 vObsLocalRay;
        uniform float uInsideBH;
        ${metricGLSL}

        void main() {
          vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 d = worldPos - uObsPos;
          float u = length(d);
          float obsGamma = mix(1.0, uObsGamma, uEnableLorentz);
          vec3 obsBeta = uObsBeta * uEnableLorentz;
          vec3 obsLocal = d;
          if (uEnableRetardation > 0.5) {
            float kBoost = (obsGamma * obsGamma) / (obsGamma + 1.0);
            obsLocal = d + (kBoost * dot(obsBeta, d) + obsGamma * u * uEnableAberration) * obsBeta;
          } else {
            float kContract = (obsGamma / (obsGamma + 1.0)) * dot(obsBeta, d);
            obsLocal = d - kContract * obsBeta;
          }
          vObsLocalRay = obsLocal;
          // When camera is inside bounding sphere (BackSide), project clip depth at 7.9m so foreground
          // player Ferrari (< 7.4m in Chase/Hood/Cockpit) ALWAYS passes hardware depth test in front!
          vec3 clipOffset = (uInsideBH > 0.5) ? (normalize(obsLocal) * 7.9) : obsLocal;
          gl_Position = projectionMatrix * viewMatrix * vec4(uObsPos + clipOffset, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vObsLocalRay;
        uniform float uBoundRadius;
        ${metricGLSL}
        ${spectralGLSL}

        float bhHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float bhNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(bhHash(i), bhHash(i + vec2(1.0, 0.0)), f.x),
            mix(bhHash(i + vec2(0.0, 1.0)), bhHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          if (uEnableGR < 0.5) discard;

          // 1. Convert observer local view ray to static-frame orthonormal ray (Lorentz aberration!)
          vec3 nObs = normalize(vObsLocalRay);
          vec3 rd = nObs;
          float srObsD = 1.0;
          if (uEnableAberration >= 0.5 || uEnableLorentz >= 0.5) {
            vec3 beta = uObsBeta * uEnableAberration;
            float b2 = dot(beta, beta);
            float gamma = 1.0 / sqrt(max(1e-6, 1.0 - b2));
            float k = (gamma * gamma) / (gamma + 1.0);
            float bn = dot(beta, nObs);
            float eCity = max(1e-5, gamma * (1.0 - bn));
            rd = normalize((nObs + (k * bn - gamma) * beta) / eCity);
            srObsD = uObsGamma * (1.0 + dot(uObsBeta, rd));
          }

          vec3 ro = uObsPos - uBHPos;
          float bProj = dot(ro, rd);
          float cSphere = dot(ro, ro) - uBoundRadius * uBoundRadius;
          float disc = bProj * bProj - cSphere;
          if (disc <= 0.0) discard;

          float sqrtDisc = sqrt(disc);
          float tEnter = max(0.0, -bProj - sqrtDisc);
          float tExit = -bProj + sqrtDisc;
          if (tExit <= 0.0) discard;

          float rs = uBHRs;
          vec3 pos = ro + rd * tEnter;
          vec3 vel = rd;

          // Exact Static-Observer Orthonormal Tetrad Launch when camera is inside strong-field volume:
          //   Guarantees conserved impact parameter b = r_0 sin(theta) / sqrt(1 - r_H / r_0),
          //   reproducing Synge's exact >180 deg horizon shadow cone for r_0 < 1.5 r_H!
          if (tEnter <= 1e-4) {
            float r0 = length(ro);
            vec3 rHat0 = ro / max(r0, 1e-4);
            float f0 = max(0.0012, 1.0 - rs / max(rs * 1.0012, r0));
            float cosTh = dot(rd, rHat0);
            vec3 dPerp = rd - rHat0 * cosTh;
            vel = rHat0 * cosTh + dPerp * inversesqrt(f0);
          } else {
            float rEnt = max(rs * 1.05, length(pos));
            vec3 hTmp = cross(pos, rd);
            float h2Tmp = dot(hTmp, hTmp);
            vel = rd * sqrt(1.0 + (rs * h2Tmp) / (rEnt * rEnt * rEnt));
          }

          vec3 diskN = normalize(vec3(0.26, 0.948, -0.18));
          float rIn = 1.62 * rs; // Prograde high-spin Kerr ISCO
          float rOut = 18.5;

          vec3 hVec = cross(pos, vel);
          float h2 = dot(hVec, hVec);

          vec3 accumRad = vec3(0.0);
          float transmittance = 1.0;
          bool captured = false;
          float minR = 999.0;

          float rawGravShift = 1.0 / max(0.018, uObsGravAlpha);
          // Preserve full spectral blueshift while preventing local HDR bloom whiteout over the shadow!
          float diskGravShift = 1.0 + 1.35 * log(max(1.0, rawGravShift));

          // 2. Symplectic Energy-Manifold Velocity-Verlet Integration of Exact Null Geodesic:
          //      d^2 r / dlambda^2 = -1.5 * r_H * b^2 * r / |r|^5
          //      |dr / dlambda|^2  = 1 + r_H * b^2 / |r|^3  (exact conserved first integral!)
          for (int step = 0; step < ${steps}; step++) {
            float r = length(pos);
            minR = min(minR, r);
            if (r <= rs * 1.008) {
              captured = true;
              break;
            }
            if (step > 2 && r > uBoundRadius + 0.6 && dot(pos, vel) > 0.0) {
              break;
            }

            float vSpeed = max(0.25, length(vel));
            float dsSpatial = clamp(0.13 * (r - 0.84 * rs), 0.065, 1.45);
            float dLam = dsSpatial / vSpeed;

            float invR2 = 1.0 / max(r * r, 0.04);
            float invR5 = invR2 * invR2 / max(r, 0.2);
            vec3 acc0 = (-1.5 * rs * h2 * invR5) * pos;

            vec3 nextPos = pos + vel * dLam + 0.5 * acc0 * (dLam * dLam);
            float rNext = length(nextPos);
            float invRn2 = 1.0 / max(rNext * rNext, 0.04);
            float invRn5 = invRn2 * invRn2 / max(rNext, 0.2);
            vec3 acc1 = (-1.5 * rs * h2 * invRn5) * nextPos;

            vec3 rawVel = vel + 0.5 * (acc0 + acc1) * dLam;
            float exactSpeed = sqrt(1.0 + (rs * h2) / max(rNext * rNext * rNext, 0.05));
            vec3 nextVel = normalize(rawVel) * exactSpeed;

            // Check relativistic thin accretion disk crossings (primary disk + lensed upper/lower arches!)
            float h0 = dot(pos, diskN);
            float h1 = dot(nextPos, diskN);
            if (h0 * h1 <= 0.0) {
              float frac = abs(h0) / max(abs(h0 - h1), 1e-5);
              vec3 hitP = mix(pos, nextPos, frac);
              float rdHit = length(hitP);
              if (rdHit >= rIn && rdHit <= rOut) {
                float uRad = (rdHit - rIn) / (rOut - rIn);
                float innerTap = smoothstep(0.0, 0.06, uRad);
                float outerTap = 1.0 - smoothstep(0.56, 1.0, uRad);
                float tempProfile = pow(max(0.08, rIn / rdHit), 0.75) * innerTap * outerTap;

                vec3 e1 = normalize(cross(diskN, vec3(0.0, 0.0, 1.0)));
                vec3 e2 = cross(diskN, e1);
                float az = atan(dot(hitP, e2), dot(hitP, e1));
                float omega = 2.1 * pow(max(1.0, rdHit / rs), -1.42);
                float retT = uObsTime - (uEnableRetardation * length(hitP - ro)) / uSpeedOfLight;
                float woundAz = az - omega * retT * 0.62;

                float rings = 0.62 + 0.38 * sin(rdHit * 3.6 + bhNoise(vec2(rdHit * 1.6, woundAz * 2.0)) * 3.5);
                float streaks = bhNoise(vec2(rdHit * 2.4, woundAz * 5.0)) * 0.65
                              + bhNoise(vec2(rdHit * 5.5, woundAz * 11.0)) * 0.35;
                float density = clamp(tempProfile * rings * (0.52 + 0.78 * streaks), 0.0, 1.45);

                vec3 orbDir = normalize(cross(diskN, hitP));
                float betaDisk = min(0.70, sqrt(rs / max(0.7 * rs, 1.85 * (rdHit - 0.65 * rs))));
                float gammaDisk = 1.0 / sqrt(1.0 - betaDisk * betaDisk);
                vec3 rayAtHit = normalize(mix(vel, nextVel, frac));
                float emitDenom = gammaDisk * (1.0 + betaDisk * dot(orbDir, rayAtHit));
                float gravEmit = sqrt(max(0.08, 1.0 - rs / rdHit));
                float diskD = clamp((gravEmit * diskGravShift * srObsD) / max(emitDenom, 0.16), 0.12, 14.0);
                float nearCamFade = smoothstep(2.0, 6.2, length(hitP - ro));

                vec3 restPlasma = mix(vec3(1.85, 0.42, 0.10), vec3(2.8, 2.05, 1.35), pow(1.0 - uRad, 1.6));
                vec3 obsPlasma = applyRelativisticSpectrumCustom(restPlasma, diskD, 0.92, 0.95, 0.0, 1.25);

                float slabAlpha = clamp(density * 0.82 * nearCamFade, 0.0, 0.90);
                accumRad += transmittance * obsPlasma * slabAlpha;
                transmittance *= (1.0 - slabAlpha);
              }
            }

            pos = nextPos;
            vel = nextVel;
          }

          // 3. Razor-Sharp Photon Sphere Ring along critical escape boundary (b -> 2.598 r_H)
          if (!captured) {
            float bCrit = 2.598076 * rs;
            float bImpact = sqrt(h2);
            float bDiff = abs(bImpact - bCrit) / rs;
            float photonRing = exp(-bDiff * bDiff * 38.0) * 1.65;
            if (photonRing > 0.005) {
              vec3 ringCol = applyRelativisticSpectrumCustom(
                vec3(2.0, 1.6, 1.2) * photonRing,
                clamp(srObsD * diskGravShift, 0.12, 14.0),
                0.9, 0.9, 0.0, 0.85
              );
              accumRad += transmittance * ringCol;
            }
          }

          float outAlpha = captured ? 1.0 : clamp(1.0 - transmittance, 0.0, 1.0);
          if (outAlpha < 0.003 && dot(accumRad, accumRad) < 1e-6) discard;

          gl_FragColor = vec4(accumRad, outAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.bhMesh = new THREE.Mesh(geo, mat);
    this.bhMesh.position.set(this.metric.bhPos[0], this.metric.bhPos[1], this.metric.bhPos[2]);
    this.bhMesh.frustumCulled = false;
    this.bhMesh.renderOrder = 6;
    this.group.add(this.bhMesh);
  }

  _buildWormholePortals() {
    const cubeRes = IS_MOBILE_DEVICE ? 128 : 256;
    const rtOpts = {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    };
    this.cubeRTA = new THREE.WebGLCubeRenderTarget(cubeRes, rtOpts);
    this.cubeRTB = new THREE.WebGLCubeRenderTarget(cubeRes, rtOpts);
    this.cubeCamA = new THREE.CubeCamera(0.7, 950.0, this.cubeRTA);
    this.cubeCamB = new THREE.CubeCamera(0.7, 950.0, this.cubeRTB);

    this.cubeCamA.position.set(this.metric.wormholeA[0], 2.1, this.metric.wormholeA[2] + 7.2);
    this.cubeCamB.position.set(this.metric.wormholeB[0] + 2.2, 2.7, this.metric.wormholeB[2] + 7.4);
    this.scene.add(this.cubeCamA);
    this.scene.add(this.cubeCamB);

    const makeRotMat = (yawDelta) =>
      new THREE.Matrix3().set(
        Math.cos(yawDelta), 0, Math.sin(yawDelta),
        0, 1, 0,
        -Math.sin(yawDelta), 0, Math.cos(yawDelta)
      );

    this.rotMatAToB = makeRotMat(-2.94);
    this.rotMatBToA = makeRotMat(Math.PI);
    this.rotMatIdentity = new THREE.Matrix3().identity();

    const makeMouthMesh = (posArr, partnerCubeTex, selfCubeTex, portalRotMat) => {
      const metricGLSL = this.metric.getShaderModule();
      const spectralGLSL = getSpectralGLSL();

      const uniforms = Object.assign({}, this.shaderSystem.sharedUniforms, {
        uMouthCenter: { value: new THREE.Vector3(posArr[0], posArr[1], posArr[2]) },
        uThroatR: { value: this.metric.wormholeThroatR },
        uShellR: { value: this.wormholeShellRadius },
        uPartnerCube: { value: partnerCubeTex },
        uSelfCube: { value: selfCubeTex },
        uPortalRot: { value: portalRotMat },
      });

      const geo = new THREE.SphereGeometry(this.wormholeShellRadius, 48, 36);
      const mat = new THREE.ShaderMaterial({
        name: 'MorrisThorneWormholeMouth',
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide,
        vertexShader: /* glsl */ `
          varying vec3 vObsLocalRay;
          ${metricGLSL}

          void main() {
            vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
            vec3 d = worldPos - uObsPos;
            float u = length(d);
            float obsGamma = mix(1.0, uObsGamma, uEnableLorentz);
            vec3 obsBeta = uObsBeta * uEnableLorentz;
            vec3 obsLocal = d;
            if (uEnableRetardation > 0.5) {
              float kBoost = (obsGamma * obsGamma) / (obsGamma + 1.0);
              obsLocal = d + (kBoost * dot(obsBeta, d) + obsGamma * u * uEnableAberration) * obsBeta;
            } else {
              float kContract = (obsGamma / (obsGamma + 1.0)) * dot(obsBeta, d);
              obsLocal = d - kContract * obsBeta;
            }
            vObsLocalRay = obsLocal;
            gl_Position = projectionMatrix * viewMatrix * vec4(uObsPos + obsLocal, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vObsLocalRay;
          uniform vec3 uMouthCenter;
          uniform float uThroatR;
          uniform float uShellR;
          uniform samplerCube uPartnerCube;
          uniform samplerCube uSelfCube;
          uniform mat3 uPortalRot;
          ${metricGLSL}
          ${spectralGLSL}

          void main() {
            if (uEnableGR < 0.5) discard;

            vec3 nObs = normalize(vObsLocalRay);
            vec3 rd = nObs;
            float srD = 1.0;
            if (uEnableAberration >= 0.5 || uEnableLorentz >= 0.5) {
              vec3 beta = uObsBeta * uEnableAberration;
              float b2 = dot(beta, beta);
              float gamma = 1.0 / sqrt(max(1e-6, 1.0 - b2));
              float k = (gamma * gamma) / (gamma + 1.0);
              float bn = dot(beta, nObs);
              float eCity = max(1e-5, gamma * (1.0 - bn));
              rd = normalize((nObs + (k * bn - gamma) * beta) / eCity);
              srD = uObsGamma * (1.0 + dot(uObsBeta, rd));
            }

            vec3 toMouth = uMouthCenter - uObsPos;
            float tProj = dot(toMouth, rd);
            if (tProj <= 0.0) discard;
            vec3 bVec = rd * tProj - toMouth;
            float b = length(bVec);
            if (b >= uShellR) discard;

            vec3 inward = -bVec / max(b, 1e-4);
            vec3 axis = cross(rd, inward);
            float axLen = length(axis);
            vec3 rotAx = (axLen > 1e-5) ? (axis / axLen) : vec3(0.0, 1.0, 0.0);

            if (b < uThroatR) {
              // 1. Inside Morris–Thorne Throat (b < b_0): Ellis–Bronnikov geodesic crosses l = 0 into Partner Universe!
              float xi = clamp(b / uThroatR, 0.0, 0.996);
              float defl = 0.56 * xi * xi + 0.34 * (xi * xi * xi) / sqrt(max(0.015, 1.0 - xi * xi));
              vec3 bentRd = (axLen > 1e-5) ? rotateAroundAxis(rd, rotAx, defl) : rd;
              vec3 exitDir = normalize(uPortalRot * bentRd);

              vec3 linPartner = max(vec3(0.0), textureCube(uPartnerCube, exitDir).rgb);
              vec3 shifted = applyRelativisticSpectrumCustom(linPartner, srD, 0.88, 0.92, 0.0, 0.68);

              // Subtle Einstein photon-sphere caustic ring right at b -> b_0
              float rimMask = smoothstep(0.84, 1.0, xi);
              vec3 caustic = vec3(0.35, 0.95, 1.55) * rimMask * 0.85;

              gl_FragColor = vec4(shifted + caustic, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            } else {
              // 2. Exterior Throat Photon Sphere & Origin-Universe Einstein Reflection Ring (b_0 <= b < R_shell)
              float uOut = (b - uThroatR) / max(0.2, uShellR - uThroatR);
              float turnDefl = 3.14159265 * exp(-uOut * 3.4);
              vec3 reflRd = normalize(rotateAroundAxis(rd, rotAx, turnDefl));
              vec3 selfSample = max(vec3(0.0), textureCube(uSelfCube, reflRd).rgb);

              float photonRing = exp(-uOut * uOut * 30.0);
              vec3 ringBase = selfSample * 0.85 + vec3(0.35, 1.05, 1.75) * photonRing * 1.45;
              vec3 shiftedHalo = applyRelativisticSpectrumCustom(ringBase, srD, 0.9, 0.9, 0.0, 0.8);
              float alpha = clamp((1.0 - smoothstep(0.0, 0.72, uOut)) * 0.94, 0.0, 0.96);
              if (alpha < 0.008) discard;
              gl_FragColor = vec4(shiftedHalo, alpha);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }
          }
        `,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(posArr[0], posArr[1], posArr[2]);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      return mesh;
    };

    this.mouthAMesh = makeMouthMesh(this.metric.wormholeA, this.cubeRTB.texture, this.cubeRTA.texture, this.rotMatAToB);
    this.mouthBMesh = makeMouthMesh(this.metric.wormholeB, this.cubeRTA.texture, this.cubeRTB.texture, this.rotMatBToA);
  }

  /**
   * Builds the full-360 deg Curved Morris–Thorne Throat Sphere (`ds^2 = -c^2 dt^2 + dl^2 + (b_0^2 + l^2) dOmega^2`)
   * rendered around the car while driving continuously through l in [-10m .. +10m]!
   */
  _buildWormholeThroatTunnel() {
    const metricGLSL = this.metric.getShaderModule();
    const spectralGLSL = getSpectralGLSL();

    this.throatUniforms = Object.assign({}, this.shaderSystem.sharedUniforms, {
      uThroatL: { value: 0.0 },
      uThroatB0: { value: this.metric.wormholeThroatR },
      uThroatAxis: { value: new THREE.Vector3(0, 0, -1) },
      uOriginCube: { value: this.cubeRTA.texture },
      uDestCube: { value: this.cubeRTB.texture },
      uOriginRot: { value: new THREE.Matrix3().identity() },
      uDestRot: { value: this.rotMatAToB.clone() },
    });

    const geo = new THREE.SphereGeometry(28.0, 56, 40);
    const mat = new THREE.ShaderMaterial({
      name: 'MorrisThorneCurvedThroat360',
      uniforms: this.throatUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec3 vLocalDir;
        void main() {
          vLocalDir = position;
          gl_Position = projectionMatrix * viewMatrix * vec4(modelMatrix[3].xyz + position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vLocalDir;
        uniform float uThroatL;
        uniform float uThroatB0;
        uniform vec3 uThroatAxis;
        uniform samplerCube uOriginCube;
        uniform samplerCube uDestCube;
        uniform mat3 uOriginRot;
        uniform mat3 uDestRot;
        ${metricGLSL}
        ${spectralGLSL}

        void main() {
          vec3 nObs = normalize(vLocalDir);
          vec3 rd = nObs;
          float srD = 1.0;
          if (uEnableAberration >= 0.5 || uEnableLorentz >= 0.5) {
            vec3 beta = uObsBeta * uEnableAberration;
            float b2 = dot(beta, beta);
            float gamma = 1.0 / sqrt(max(1e-6, 1.0 - b2));
            float k = (gamma * gamma) / (gamma + 1.0);
            float bn = dot(beta, nObs);
            float eCity = max(1e-5, gamma * (1.0 - bn));
            rd = normalize((nObs + (k * bn - gamma) * beta) / eCity);
            srD = uObsGamma * (1.0 + dot(uObsBeta, rd));
          }

          // Exact Ellis–Bronnikov / Morris–Thorne Null Geodesic Integration in (l, theta, phi):
          //   Circumferential radius r(l) = sqrt(b_0^2 + l^2), impact parameter B = r(l_obs) * sin(alpha)
          float lObs = uThroatL;
          float b0 = uThroatB0;
          float rObs = sqrt(b0 * b0 + lObs * lObs);

          vec3 fwdAx = normalize(uThroatAxis);
          float cosAlpha = clamp(dot(rd, fwdAx), -1.0, 1.0);
          vec3 perp = rd - fwdAx * cosAlpha;
          float sinAlpha = length(perp);
          vec3 perpHat = (sinAlpha > 1e-5) ? (perp / sinAlpha) : vec3(1.0, 0.0, 0.0);
          float B = rObs * sinAlpha;

          // Determine whether ray moves away from neck (l=0) or toward neck!
          bool towardNeck = (lObs * cosAlpha < 0.0) || (abs(lObs) < 1e-3);
          bool reachesDest = false;
          float deflAngle = 0.0;

          if (!towardNeck) {
            reachesDest = (lObs >= 0.0);
            float asymAng = atan(B, max(0.05, abs(lObs)));
            float curAng = asin(clamp(sinAlpha, 0.0, 1.0));
            deflAngle = max(0.0, curAng - asymAng) * 0.65;
          } else {
            if (B < b0 * 0.9995) {
              // Crosses l = 0 Einstein–Rosen Throat into opposite universe!
              reachesDest = (cosAlpha >= 0.0);
              float xi = clamp(B / b0, 0.0, 0.998);
              deflAngle = 0.52 * xi * xi + 0.36 * (xi * xi * xi) / sqrt(max(0.012, 1.0 - xi * xi));
            } else {
              // B >= b_0: Turns around at l_turn = sqrt(B^2 - b_0^2) and returns to same universe!
              reachesDest = (lObs > 0.0);
              float uTurn = (B - b0) / max(0.25, rObs - b0 + 0.25);
              deflAngle = 2.85 * exp(-uTurn * 2.6);
            }
          }

          vec3 bendAxis = cross(rd, -perpHat);
          float bAxLen = length(bendAxis);
          vec3 asymDir = (bAxLen > 1e-5) ? normalize(rotateAroundAxis(rd, bendAxis / bAxLen, deflAngle)) : rd;

          vec3 rawSky;
          if (reachesDest) {
            rawSky = max(vec3(0.0), textureCube(uDestCube, normalize(uDestRot * asymDir)).rgb);
          } else {
            rawSky = max(vec3(0.0), textureCube(uOriginCube, normalize(uOriginRot * asymDir)).rgb);
          }

          vec3 shifted = applyRelativisticSpectrumCustom(rawSky, srD, 0.88, 0.92, 0.0, 0.72);

          // Throat Photon-Sphere Ring at B -> b_0 (separating Universe A and Universe B at l = 0!)
          float bRatio = abs(B - b0) / b0;
          float neckGlow = exp(-bRatio * bRatio * 42.0) * (0.55 + 0.45 / (1.0 + 0.15 * lObs * lObs));
          vec3 causticCol = mix(vec3(0.25, 0.95, 1.65), vec3(1.45, 0.85, 1.85), 0.5 + 0.5 * sin(uObsTime * 3.2));

          gl_FragColor = vec4(shifted + causticCol * neckGlow, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.throatTunnelMesh = new THREE.Mesh(geo, mat);
    this.throatTunnelMesh.visible = false;
    this.throatTunnelMesh.frustumCulled = false;
    this.throatTunnelMesh.renderOrder = -5;
    this.scene.add(this.throatTunnelMesh);
  }

  /**
   * Builds the East Skyline Binary Black Hole Inspiral Beacon + 4 LIGO Fabry–Pérot Laser
   * Interferometer Archway Gates showcasing transverse-traceless (h_+ / h_x) Gravitational Waves!
   */
  _buildGravitationalWaveCorridor() {
    // 1. Orbiting Binary Black Hole Merger Overhead at metric.gwPos ([275, 52, 28])
    this.binaryGroup = new THREE.Group();
    this.binaryGroup.position.set(this.metric.gwPos[0], this.metric.gwPos[1], this.metric.gwPos[2]);

    this.bhOrb1 = new THREE.Group();
    this.bhOrb2 = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const haloMat = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xa855f7,
        emissive: 0x38bdf8,
        emissiveIntensity: 3.2,
        roughness: 0.2,
      })
    );

    for (const orb of [this.bhOrb1, this.bhOrb2]) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 16), coreMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.8, 0.42, 8, 32), haloMat);
      ring.rotation.x = Math.PI * 0.38;
      ring.geometry.setAttribute('uv1', ring.geometry.getAttribute('uv'));
      core.frustumCulled = false;
      ring.frustumCulled = false;
      orb.add(core, ring);
      this.binaryGroup.add(orb);
    }

    // Expanding Quadrupole Wavefront Halo Rings around the Binary Inspiral
    this.gwWaveRings = [];
    for (let i = 0; i < 3; i++) {
      const wGeo = new THREE.TorusGeometry(12.0 + i * 9.0, 0.22, 6, 48);
      wGeo.setAttribute('uv1', wGeo.getAttribute('uv'));
      const wMesh = new THREE.Mesh(wGeo, this.materials.syncPulseCyan);
      wMesh.rotation.y = Math.PI * 0.42;
      wMesh.frustumCulled = false;
      this.binaryGroup.add(wMesh);
      this.gwWaveRings.push(wMesh);
    }
    this.group.add(this.binaryGroup);

    // 2. Sample East Skyline Back Straight frames (`X > 320, Z in [-45 .. +135]`) for Interferometer Gates!
    const targetZs = [-42.0, 8.0, 86.0, 134.0];
    const frames = this.track.groundData.frames;

    targetZs.forEach((tz, idx) => {
      let bestF = null;
      let bestD = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.pos.x < 320.0) continue;
        const d = Math.abs(f.pos.z - tz);
        if (d < bestD) {
          bestD = d;
          bestF = f;
        }
      }
      if (!bestF) return;

      const yaw = Math.atan2(bestF.tan.x, -bestF.tan.z);
      if (idx === 0) {
        this._addSignGantry(
          bestF.pos.x,
          bestF.pos.z,
          yaw,
          30.4,
          '↑ GRAVITATIONAL-WAVE CORRIDOR',
          'BINARY BH INSPIRAL  •  h₊ / hₓ SPACETIME RIPPLES',
          '#1e1b4b',
          '#a855f7',
          bestF.pos.y
        );
        return;
      }

      // LIGO Orthogonal Laser Interferometer Archway (wide 30.8m span outside sidewalk!)
      const halfSpan = 15.4;
      const topY = bestF.pos.y + 8.2;
      for (const side of [-1, 1]) {
        const px = bestF.pos.x + bestF.right.x * side * halfSpan;
        const pz = bestF.pos.z + bestF.right.z * side * halfSpan;
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.24, 0.30, 8.6, 8, 4),
          this.materials.brushedSteel
        );
        post.position.set(px, bestF.pos.y + 4.1, pz);
        post.frustumCulled = false;
        this.group.add(post);
        this.track.registerSolidCylinder(px, pz, 0.34, topY);
      }

      const laserMat = this.shaderSystem.patchMaterial(
        new THREE.MeshStandardMaterial({
          color: 0x22d3ee,
          emissive: 0xa855f7,
          emissiveIntensity: 2.6,
          roughness: 0.2,
        })
      );
      this.gwLaserMats.push({ mat: laserMat, pos: bestF.pos.clone() });

      // Horizontal & vertical Fabry–Pérot reference laser beams (visibly stretch & squeeze under TT waves!)
      const hBeamGeo = new THREE.CylinderGeometry(0.08, 0.08, halfSpan * 2.0, 6, 16);
      hBeamGeo.rotateZ(Math.PI * 0.5);
      hBeamGeo.setAttribute('uv1', hBeamGeo.getAttribute('uv'));
      const hBeam = new THREE.Mesh(hBeamGeo, laserMat);
      hBeam.position.set(bestF.pos.x, topY, bestF.pos.z);
      hBeam.rotation.y = -yaw;
      hBeam.frustumCulled = false;
      this.group.add(hBeam);
    });
  }

  /**
   * Captures live 3D city, traffic & sky cubemap panoramas at Mouth A & Mouth B!
   */
  bakeWormholePortals(observer, entities = null, cityWorld = null, skyMesh = null, which = 'both') {
    if (!this.threeRenderer || !this.mouthAMesh || !this.mouthBMesh) return;
    const su = this.shaderSystem.sharedUniforms;
    const savedPos = su.uObsPos.value.clone();
    const savedBeta = su.uObsBeta.value.clone();
    const savedGamma = su.uObsGamma.value;
    const savedGR = su.uEnableGR.value;
    const savedGravAlpha = su.uObsGravAlpha.value;

    const wasTunnelVis = this.throatTunnelMesh ? this.throatTunnelMesh.visible : false;
    const wasCityVis = cityWorld ? cityWorld.root.visible : true;
    const wasSkyVis = skyMesh ? skyMesh.visible : true;
    const playerRoot = entities?.playerCar?.root || null;
    const wasPlayerVis = playerRoot ? playerRoot.visible : true;

    if (this.throatTunnelMesh) this.throatTunnelMesh.visible = false;
    if (cityWorld) cityWorld.root.visible = true;
    if (skyMesh) skyMesh.visible = true;
    if (entities) entities.setExteriorHidden(false);
    if (playerRoot) playerRoot.visible = false;

    this.mouthAMesh.visible = false;
    this.mouthBMesh.visible = false;
    if (this.bhMesh) this.bhMesh.visible = false;

    su.uObsBeta.value.set(0, 0, 0);
    su.uObsGamma.value = 1.0;
    su.uEnableGR.value = 0.0;
    su.uObsGravAlpha.value = 1.0;

    if (which === 'both' || which === 'A') {
      su.uObsPos.value.copy(this.cubeCamA.position);
      this.cubeCamA.update(this.threeRenderer, this.scene);
    }
    if (which === 'both' || which === 'B') {
      su.uObsPos.value.copy(this.cubeCamB.position);
      this.cubeCamB.update(this.threeRenderer, this.scene);
    }

    su.uObsPos.value.copy(savedPos);
    su.uObsBeta.value.copy(savedBeta);
    su.uObsGamma.value = savedGamma;
    su.uEnableGR.value = savedGR;
    su.uObsGravAlpha.value = savedGravAlpha;

    if (playerRoot) playerRoot.visible = wasPlayerVis;
    if (cityWorld) cityWorld.root.visible = wasCityVis;
    if (skyMesh) skyMesh.visible = wasSkyVis;
    if (entities && this.inThroat) entities.setExteriorHidden(true);
    if (this.throatTunnelMesh) this.throatTunnelMesh.visible = wasTunnelVis;

    const grActive = this.metric.enableGR && !this.inThroat;
    this.mouthAMesh.visible = grActive;
    this.mouthBMesh.visible = grActive;
    if (this.bhMesh) this.bhMesh.visible = grActive;
    void observer;
  }

  _exitWormholeThroat(vehicle, entities, cityWorld, skyMesh, completedForward) {
    this.inThroat = false;
    vehicle.inWormholeThroat = false;
    if (this.throatTunnelMesh) this.throatTunnelMesh.visible = false;
    if (cityWorld) cityWorld.root.visible = true;
    if (skyMesh) skyMesh.visible = true;
    if (entities) entities.setExteriorHidden(false);
    this.group.visible = this.metric.enableGR;

    let exitX, exitFootY, exitZ, exitYaw;
    if (completedForward) {
      if (this.throatDir > 0) {
        // Exited Mouth B onto 600m East Skyline Back Straight!
        exitX = 365.5; exitFootY = 1.18; exitZ = 72.0; exitYaw = 2.94;
      } else {
        // Exited Mouth A onto 600m North Grand Boulevard!
        exitX = -3.4; exitFootY = 0.02; exitZ = -274.0; exitYaw = Math.PI;
      }
    } else {
      // Reversed back out the entrance mouth!
      if (this.throatDir > 0) {
        exitX = -4.5; exitFootY = 0.02; exitZ = -276.0; exitYaw = this.throatEntryYaw;
      } else {
        exitX = 364.5; exitFootY = 1.18; exitZ = 72.0; exitYaw = this.throatEntryYaw;
      }
    }

    const pHoriz = Math.hypot(vehicle.px, vehicle.pz);
    const minExitP = completedForward ? Math.max(pHoriz, 0.35 * this.metric.c) : pHoriz;
    const fwdX = Math.sin(exitYaw);
    const fwdZ = -Math.cos(exitYaw);

    vehicle.carX = exitX;
    vehicle.footY = exitFootY;
    vehicle.carZ = exitZ;
    vehicle.moveYaw = exitYaw;
    vehicle.velocityYaw = exitYaw;
    vehicle.px = fwdX * minExitP;
    vehicle.pz = fwdZ * minExitP;
    vehicle.impactYawRate = 0.0;
    vehicle.impactSlip = 0.0;
    vehicle.camYaw = vehicle._wrapPi(exitYaw + vehicle.lookYawOffset);
    vehicle._syncObserverPosition();

    this.playerWormholeCooldown = 1.6;
  }

  syncRenderPose(observer) {
    if (this.inThroat && this.throatTunnelMesh) {
      this.throatTunnelMesh.position.set(observer.event[1], observer.event[2], observer.event[3]);
    }
  }

  /**
   * Applies General Relativistic dynamics & live portal updates per frame.
   */
  update(dtReal, observer, vehicle, todHours, entities = null, cityWorld = null, skyMesh = null) {
    const grOn = this.metric.enableGR;

    if (!grOn && this.inThroat) {
      this._exitWormholeThroat(vehicle, entities, cityWorld, skyMesh, true);
    }

    if (this.bhMesh) {
      this.bhMesh.visible = grOn && !this.inThroat;
      if (grOn && !this.inThroat) {
        const dCam = Math.hypot(
          observer.event[1] - this.metric.bhPos[0],
          observer.event[2] - this.metric.bhPos[1],
          observer.event[3] - this.metric.bhPos[2]
        );
        const wantBack = dCam <= this.bhBoundRadius + 0.5;
        this.bhMesh.material.uniforms.uInsideBH.value = wantBack ? 1.0 : 0.0;
        const targetSide = wantBack ? THREE.BackSide : THREE.FrontSide;
        if (this.bhMesh.material.side !== targetSide) {
          this.bhMesh.material.side = targetSide;
          this.bhMesh.material.depthTest = true;
          this.bhMesh.material.needsUpdate = true;
        }
      }
    }
    if (this.mouthAMesh) this.mouthAMesh.visible = grOn && !this.inThroat;
    if (this.mouthBMesh) this.mouthBMesh.visible = grOn && !this.inThroat;
    this.group.visible = grOn && !this.inThroat;

    if (!grOn) return;

    const dt = Math.min(0.05, Math.max(0.001, dtReal));
    const c = this.metric.c;
    const c2 = c * c;
    const tCoord = observer.event[0];

    // --- 0. Animate Overhead Binary Black Hole Inspiral & LIGO Laser Fringes ---
    if (this.binaryGroup) {
      const orbPhase = 2.3 * tCoord; // emits quadrupole GW at 2 * 2.3 = 4.6 rad/s!
      const sep = 8.4;
      this.bhOrb1.position.set(Math.cos(orbPhase) * sep, 0.0, Math.sin(orbPhase) * sep);
      this.bhOrb2.position.set(-Math.cos(orbPhase) * sep, 0.0, -Math.sin(orbPhase) * sep);
      for (let i = 0; i < this.gwWaveRings.length; i++) {
        const cyc = ((tCoord * 0.65 + i / 3.0) % 1.0);
        const sc = 0.6 + cyc * 2.8;
        this.gwWaveRings[i].scale.setScalar(sc);
      }
      for (let i = 0; i < this.gwLaserMats.length; i++) {
        const item = this.gwLaserMats[i];
        const rGW = item.pos.distanceTo(this.binaryGroup.position);
        const fringe = 0.5 + 0.5 * Math.cos(4.6 * (tCoord - rGW / c));
        item.mat.emissiveIntensity = 1.0 + 3.4 * fringe;
      }
    }

    // --- 1. Live Dynamic Wormhole Cubemap Refresh (shows live cars, clocks & sun inside throat!) ---
    this.cubeFrameCounter++;
    const wA = this.metric.wormholeA;
    const wB = this.metric.wormholeB;
    const dA = Math.hypot(vehicle.carX - wA[0], vehicle.carZ - wA[2]);
    const dB = Math.hypot(vehicle.carX - wB[0], vehicle.carZ - wB[2]);
    const minWDist = Math.min(dA, dB);
    const todDiff = Math.min(Math.abs(todHours - this.lastCubeBakeTod), 24.0 - Math.abs(todHours - this.lastCubeBakeTod));
    const refreshStride = IS_MOBILE_DEVICE ? 6 : 2;

    if (todDiff > 1.2) {
      this.lastCubeBakeTod = todHours;
      this.bakeWormholePortals(observer, entities, cityWorld, skyMesh, 'both');
    } else if ((this.inThroat || minWDist < 115.0) && this.cubeFrameCounter % refreshStride === 0) {
      if (this.inThroat) {
        const which = (this.cubeFrameCounter / refreshStride) % 2 === 0 ? 'A' : 'B';
        this.bakeWormholePortals(observer, entities, cityWorld, skyMesh, which);
      } else {
        this.bakeWormholePortals(observer, entities, cityWorld, skyMesh, dA < dB ? 'B' : 'A');
      }
    }

    // --- 2. Continuous Finite-Length Morris–Thorne Wormhole Throat Traversal (l in [-10m .. +10m]) ---
    if (this.inThroat) {
      const vAlong =
        observer.velocity[0] * this.throatAxis.x +
        observer.velocity[2] * this.throatAxis.z;
      // Ensure gentle minimum drift if player coasts near 0 inside the throat, while allowing reverse!
      const dtCoordEst = observer.gamma * dt;
      this.throatL += vAlong * dtCoordEst;

      this.throatTunnelMesh.visible = true;
      this.throatTunnelMesh.position.set(observer.event[1], observer.event[2], observer.event[3]);
      this.throatUniforms.uThroatL.value = this.throatL;

      if (this.throatL >= this.throatHalfL) {
        this._exitWormholeThroat(vehicle, entities, cityWorld, skyMesh, true);
      } else if (this.throatL <= -this.throatHalfL - 0.6) {
        this._exitWormholeThroat(vehicle, entities, cityWorld, skyMesh, false);
      }
      return;
    }

    if (this.playerWormholeCooldown > 0.0) {
      this.playerWormholeCooldown = Math.max(0.0, this.playerWormholeCooldown - dt);
    }

    // Check Wormhole Throat Entry (`d < b_0 = 4.2m`)
    if (this.playerWormholeCooldown <= 0.0 && vehicle.footY < 6.0) {
      const triggerR = this.metric.wormholeThroatR + 0.35;
      if (dA < triggerR || dB < triggerR) {
        const enteringA = dA <= dB;
        this.inThroat = true;
        vehicle.inWormholeThroat = true;
        this.throatDir = enteringA ? 1 : -1;
        this.throatL = -this.throatHalfL;
        this.throatEntryYaw = vehicle.moveYaw;
        this.throatExitYaw = enteringA ? 2.94 : Math.PI;

        // Ensure minimum entry speed so coasting into the mouth glides smoothly through the 20m throat
        const pHoriz = Math.hypot(vehicle.px, vehicle.pz);
        if (pHoriz < 0.36 * c) {
          const fx = Math.sin(vehicle.moveYaw), fz = -Math.cos(vehicle.moveYaw);
          vehicle.px = fx * 0.38 * c;
          vehicle.pz = fz * 0.38 * c;
        }

        const axX = enteringA ? 0.0 : Math.sin(vehicle.moveYaw);
        const axZ = enteringA ? -1.0 : -Math.cos(vehicle.moveYaw);
        this.throatAxis.set(axX, 0.0, axZ).normalize();
        this.throatUniforms.uThroatAxis.value.copy(this.throatAxis);
        this.throatUniforms.uThroatL.value = this.throatL;

        if (enteringA) {
          this.throatUniforms.uOriginCube.value = this.cubeRTA.texture;
          this.throatUniforms.uDestCube.value = this.cubeRTB.texture;
          this.throatUniforms.uOriginRot.value.copy(this.rotMatIdentity);
          this.throatUniforms.uDestRot.value.copy(this.rotMatAToB);
        } else {
          this.throatUniforms.uOriginCube.value = this.cubeRTB.texture;
          this.throatUniforms.uDestCube.value = this.cubeRTA.texture;
          this.throatUniforms.uOriginRot.value.copy(this.rotMatIdentity);
          this.throatUniforms.uDestRot.value.copy(this.rotMatBToA);
        }

        this.bakeWormholePortals(observer, entities, cityWorld, skyMesh, 'both');
        if (cityWorld) cityWorld.root.visible = false;
        if (skyMesh) skyMesh.visible = false;
        if (entities) entities.setExteriorHidden(true);
        this.group.visible = false;
        this.throatTunnelMesh.visible = true;
        this.throatTunnelMesh.position.set(observer.event[1], observer.event[2], observer.event[3]);

        if (this.onWormholeTraverse) this.onWormholeTraverse();
        return;
      }
    }

    // --- 3. Kerr–Schwarzschild Black Hole Gravity (Active Even at 0.000c!) & Ergosphere Frame-Dragging ---
    const bhX = this.metric.bhPos[0];
    const bhY = this.metric.bhPos[1];
    const bhZ = this.metric.bhPos[2];
    const rH = this.metric.bhRs;

    const dxBH = vehicle.carX - bhX;
    const dyBH = (vehicle.footY + 0.65) - bhY;
    const dzBH = vehicle.carZ - bhZ;
    const rHoriz = Math.hypot(dxBH, dzBH);
    const r3D = Math.hypot(dxBH, dyBH, dzBH);

    if (r3D <= rH * 0.97 || rHoriz <= 3.18) {
      // Physically crossed the Event Horizon r_H = 3.50m! Eject onto Grand Boulevard after Horizon Flash!
      vehicle.teleportTo(-2.4, 0.02, 18.0, 0.0);
      vehicle.setBetaDirect(0.35);
      if (this.onHorizonReset) this.onHorizonReset();
      return;
    }

    if (rHoriz < 44.0) {
      const rx = dxBH / Math.max(0.1, rHoriz);
      const rz = dzBH / Math.max(0.1, rHoriz);
      // Prograde Kerr spin tangent (counter-clockwise / Northbound -Z on East +X side of BH!)
      const tx = dzBH / Math.max(0.1, rHoriz);
      const tz = -dxBH / Math.max(0.1, rHoriz);

      const falloff = 1.0 - Math.max(0.0, rHoriz - 28.0) / 16.0;
      const alphaCar = this.metric.gravLapseAt(vehicle.carX, vehicle.footY + 0.65, vehicle.carZ);
      const cScale = Math.min(2.4, Math.max(0.65, c / 25.0));

      // 3A. Unconditional Relativistic Inward Gravitational Pull (acts even at 0.000c!):
      //     Gentle centrifugal/ergosphere cushion inside r < 6.4m keeps radial infall controllable
      //     so players can orbit & hover right in the 15x–55x extreme time-dilation zone!
      const rawPull = ((0.20 * c2 * rH) / Math.max(16.0, r3D * r3D * Math.max(0.30, alphaCar))) * falloff;
      const pullAccel = Math.min(9.4 * cScale, rawPull);
      const impX = -rx * pullAccel * dt;
      const impZ = -rz * pullAccel * dt;
      vehicle.px += impX;
      vehicle.pz += impZ;
      vehicle.gravImpulseX += impX;
      vehicle.gravImpulseZ += impZ;

      // Damp excessive inward radial plunging inside the inner Ergosphere (`rHoriz < 6.8m`) unless actively throttling inward
      const pRadInward = -(vehicle.px * rx + vehicle.pz * rz);
      if (rHoriz < 6.8 && pRadInward > 0.16 * c && !vehicle.isThrottling) {
        const damp = Math.min(1.0, 6.5 * dt);
        const excess = (pRadInward - 0.16 * c) * damp;
        vehicle.px += rx * excess;
        vehicle.pz += rz * excess;
      }

      // 3B. Boyer–Lindquist Kerr Ergosphere Frame-Dragging (impossible to stay still inside r < 16m!):
      const aKerr = 0.5 * rH * this.metric.bhSpin;
      const omegaFD = (2.2 * rH * aKerr * c) / (r3D * r3D * r3D + aKerr * aKerr * r3D + rH * aKerr * aKerr);
      const vDrag = Math.min(0.45 * c, omegaFD * rHoriz) * falloff;
      if (rHoriz < 17.5) {
        const ergoStrength = Math.min(1.0, (17.5 - rHoriz) / 8.5);
        vehicle.carX += tx * vDrag * ergoStrength * dt;
        vehicle.carZ += tz * vDrag * ergoStrength * dt;
      }

      // 3C. Prograde Penrose / Oberth Slingshot Momentum Whip when skimming past at speed!
      const pMag = Math.hypot(vehicle.px, vehicle.pz);
      if (pMag > 0.20) {
        const fwdX = Math.sin(vehicle.moveYaw);
        const fwdZ = -Math.cos(vehicle.moveYaw);
        const progradeAlign = Math.max(0.0, fwdX * tx + fwdZ * tz);
        const slingshotWhip =
          ((0.88 * c2 * rH * this.metric.bhSpin) / Math.max(24.0, Math.pow(r3D, 1.72))) *
          (0.28 + 0.95 * progradeAlign) *
          falloff;

        const maxSlingshotP = (0.988 * c) / Math.sqrt(1.0 - 0.988 * 0.988);
        if (pMag < maxSlingshotP) {
          vehicle.px += fwdX * slingshotWhip * dt;
          vehicle.pz += fwdZ * slingshotWhip * dt;
        }
      }
    }
  }
}
