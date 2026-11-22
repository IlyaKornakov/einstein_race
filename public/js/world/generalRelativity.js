/**
 * General Relativity World Phenomena (v2.0):
 *   1. Spinning Kerr–Schwarzschild Black Hole ("Gargantua Slingshot Basin")
 *      - Real-time 3D null-geodesic ray-marched Event Horizon shadow (b_crit = 2.598 r_s),
 *        Photon Ring (r = 1.5 r_s), and double-imaged gravitationally lensed Keplerian
 *        accretion disk with exact relativistic orbital Doppler beaming (D^4) & spectral shift.
 *      - Geodesic gravity-assist & Kerr frame-dragging slingshot impulse + strong-field
 *        Schwarzschild gravitational time dilation.
 *   2. Traversable Morris–Thorne Wormhole Shortcut ("Einstein–Rosen Throat")
 *      - 3D spherical curved-spacetime throat connecting North Grand Boulevard (-5, -150)
 *        directly to the East Skyline Back Straight (201, +54), saving ~450m per lap!
 *      - Live 3D CubeCamera destination panorama refracted through Morris–Thorne null
 *        geodesics + exterior Einstein lensing halo & exotic-matter containment rings.
 */

import * as THREE from 'three';
import { getSpectralGLSL } from '../physics/spectral.js?v=2.0';
import { IS_MOBILE_DEVICE } from '../render/renderer.js?v=2.0';

function makePortalGantrySign(title, subtitle, bgHex = '#311042') {
  const scale = IS_MOBILE_DEVICE ? 0.5 : 1.0;
  const w = 1024, h = 256;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const ctx = cv.getContext('2d');
  if (scale !== 1.0) ctx.scale(scale, scale);

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, w - 28, h - 28);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 58px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, w * 0.5, h * 0.39);

  ctx.fillStyle = '#fde68a';
  ctx.font = '800 31px Inter, system-ui, sans-serif';
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

    this.bhBoundRadius = 26.5;
    this.wormholeShellRadius = 6.6;
    this.playerWormholeCooldown = 0.0;
    this.onWormholeTraverse = null;
    this.onHorizonReset = null;

    this._buildBasinAndGantries();
    this._buildBlackHoleRaymarcher();
    this._buildWormholePortals();

    this.lastCubeBakeTod = -999.0;
  }

  _buildBasinAndGantries() {
    const bhX = this.metric.bhPos[0];
    const bhZ = this.metric.bhPos[2];

    // 1. Sculpted Dark Accretion Gravity-Well Dish underneath the Black Hole
    const dishGeo = new THREE.RingGeometry(1.5, 16.5, 48, 8);
    dishGeo.rotateX(-Math.PI * 0.5);
    dishGeo.setAttribute('uv1', dishGeo.getAttribute('uv'));
    const dishMat = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x090d16,
        emissive: 0x1e1b4b,
        emissiveIntensity: 0.45,
        roughness: 0.25,
        metalness: 0.8,
      })
    );
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.position.set(bhX, 0.03, bhZ);
    dish.frustumCulled = false;
    this.group.add(dish);

    // Warning Horizon Ring Markers on ground at r = 7.5m & r = 12.5m
    for (const [rad, hex] of [[7.2, 0xf43f5e], [12.4, 0xf59e0b]]) {
      const rGeo = new THREE.RingGeometry(rad - 0.16, rad + 0.16, 56, 1);
      rGeo.rotateX(-Math.PI * 0.5);
      rGeo.setAttribute('uv1', rGeo.getAttribute('uv'));
      const rMat = this.shaderSystem.patchMaterial(
        new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 2.2,
          roughness: 0.2,
        })
      );
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.position.set(bhX, 0.045, bhZ);
      rMesh.frustumCulled = false;
      this.group.add(rMesh);
    }

    // 2. Overhead Highway Gantry for Black Hole Slingshot Split (Z = +115 on Grand Boulevard)
    this._addSignGantry(
      -2.2, 115.0, 0.0, 21.5,
      '↙ BLACK HOLE SLINGSHOT',
      'KERR GRAVITY ASSIST  •  STRONG TIME DILATION',
      '#3b0764'
    );

    // 3. Overhead Highway Gantry for North Boulevard Wormhole Shortcut (Z = -125)
    this._addSignGantry(
      -2.0, -125.0, 0.0, 20.0,
      '↑ WORMHOLE SHORTCUT',
      'MORRIS–THORNE THROAT  →  EAST SKYLINE',
      '#083344'
    );

    // 4. Exotic-Matter Magnetic Containment Arch Rings around Wormhole Mouths A & B
    this._buildWormholeArchFrame(this.metric.wormholeA[0], 0.0, this.metric.wormholeA[2], 0.08);
    this._buildWormholeArchFrame(this.metric.wormholeB[0], 1.05, this.metric.wormholeB[2], -0.22);
  }

  _addSignGantry(cx, cz, yaw, spanW, title, subtitle, bgHex) {
    const gantryY = 7.3;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const halfSpan = spanW * 0.5;

    for (const side of [-1, 1]) {
      const px = cx + cosY * side * halfSpan;
      const pz = cz + sinY * side * halfSpan;
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.34, gantryY + 0.8, 10, 4),
        this.materials.brushedSteel
      );
      post.position.set(px, (gantryY + 0.8) * 0.5, pz);
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

    const signTex = makePortalGantrySign(title, subtitle, bgHex);
    const signMat = this.shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({
        map: signTex,
        emissiveMap: signTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.38,
        roughness: 0.3,
        metalness: 0.15,
      })
    );
    const signGeo = new THREE.BoxGeometry(12.2, 2.35, 0.20, 12, 3, 1);
    signGeo.setAttribute('uv1', signGeo.getAttribute('uv'));
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.position.set(cx, gantryY + 0.15, cz + 0.22);
    signMesh.rotation.y = -yaw;
    signMesh.frustumCulled = false;
    this.group.add(signMesh);
  }

  _buildWormholeArchFrame(wx, baseY, wz, rotY) {
    const holder = new THREE.Group();
    holder.position.set(wx, baseY, wz);
    holder.rotation.y = rotY;

    // Outer exotic-matter stabilizer torus (wide 5.85m radius so 4.2m throat is completely clear!)
    const ringGeo = new THREE.TorusGeometry(5.85, 0.28, 10, 48);
    ringGeo.setAttribute('uv1', ringGeo.getAttribute('uv'));
    const ringMesh = new THREE.Mesh(ringGeo, this.materials.brushedSteel);
    ringMesh.position.y = 3.0;
    ringMesh.frustumCulled = false;
    holder.add(ringMesh);

    const glowGeo = new THREE.TorusGeometry(5.52, 0.11, 8, 48);
    glowGeo.setAttribute('uv1', glowGeo.getAttribute('uv'));
    const glowMesh = new THREE.Mesh(glowGeo, this.materials.syncPulseCyan);
    glowMesh.position.y = 3.0;
    glowMesh.frustumCulled = false;
    holder.add(glowMesh);

    // Side anchor pylons outside the 5.85m ring so cars pass cleanly through the middle
    const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
    for (const side of [-1, 1]) {
      const lx = side * 6.15;
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 4.4, 1.35, 2, 4, 2),
        this.materials.stoneAshlar
      );
      pylon.position.set(lx, 2.1, 0);
      pylon.frustumCulled = false;
      holder.add(pylon);
      this.track.registerSolidBox(wx + lx * cosR, wz - lx * sinR, 0.55, 0.75, -rotY, baseY + 4.5);
    }

    this.group.add(holder);
  }

  _buildBlackHoleRaymarcher() {
    const metricGLSL = this.metric.getShaderModule();
    const spectralGLSL = getSpectralGLSL();
    const steps = IS_MOBILE_DEVICE ? 20 : 30;

    const uniforms = Object.assign({}, this.shaderSystem.sharedUniforms, {
      uBoundRadius: { value: this.bhBoundRadius },
    });

    const geo = new THREE.SphereGeometry(this.bhBoundRadius, 48, 36);
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
        ${metricGLSL}

        void main() {
          vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 dummyN;
          // Project bounding sphere vertices through SR aberration (without self-lensing!)
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

          // 1. Convert observer local view ray to un-deflected city-frame ray (Lorentz aberration!)
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

          // Ray origin relative to Black Hole center uBHPos
          vec3 ro = uObsPos - uBHPos;
          float bProj = dot(ro, rd);
          float cSphere = dot(ro, ro) - uBoundRadius * uBoundRadius;
          float disc = bProj * bProj - cSphere;
          if (disc <= 0.0) discard;

          float sqrtDisc = sqrt(disc);
          float tEnter = max(0.0, -bProj - sqrtDisc);
          float tExit = -bProj + sqrtDisc;
          if (tExit <= 0.0) discard;

          vec3 pos = ro + rd * tEnter;
          vec3 vel = rd;
          float rs = uBHRs;

          // Tilted prograde Kerr accretion disk plane normal (tilted toward Grand Boulevard for 3D drama!)
          vec3 diskN = normalize(vec3(0.28, 0.942, -0.185));
          float rIn = 2.05 * rs;       // Prograde Kerr ISCO
          float rOut = uBoundRadius - 1.6;

          // Conserved photon specific angular momentum squared h^2 = |r x v|^2
          vec3 hVec = cross(pos, vel);
          float h2 = dot(hVec, hVec);

          vec3 accumRad = vec3(0.0);
          float transmittance = 1.0;
          bool captured = false;
          float minR = 999.0;

          // Observer gravitational blueshift factor 1 / sqrt(1 - r_s / r_obs)
          float rObsBH = length(ro);
          float g00Obs = max(0.09, 1.0 - (rs * 1.45) / max(rs * 1.52, rObsBH));
          float obsGravShift = 1.0 / sqrt(g00Obs);

          // 2. Velocity-Verlet Integration of Exact Schwarzschild Null Geodesic:
          //      d^2 r / dlambda^2 = -1.5 * r_s * h^2 * r / |r|^5
          for (int step = 0; step < ${steps}; step++) {
            float r = length(pos);
            minR = min(minR, r);
            if (r <= rs * 1.01) {
              captured = true;
              break;
            }
            if (step > 2 && r > uBoundRadius + 0.6 && dot(pos, vel) > 0.0) {
              break;
            }

            float ds = clamp(0.18 * (r - 0.80 * rs), 0.14, 1.65);
            float invR2 = 1.0 / max(r * r, 0.04);
            float invR5 = invR2 * invR2 / max(r, 0.2);
            vec3 acc0 = (-1.5 * rs * h2 * invR5) * pos;

            vec3 nextPos = pos + vel * ds + 0.5 * acc0 * (ds * ds);
            float rNext = length(nextPos);
            float invRn2 = 1.0 / max(rNext * rNext, 0.04);
            float invRn5 = invRn2 * invRn2 / max(rNext, 0.2);
            vec3 acc1 = (-1.5 * rs * h2 * invRn5) * nextPos;
            vec3 nextVel = normalize(vel + 0.5 * (acc0 + acc1) * ds);

            // Check equatorial accretion disk plane crossing (captures primary front disk + lensed back arches!)
            float h0 = dot(pos, diskN);
            float h1 = dot(nextPos, diskN);
            if (h0 * h1 <= 0.0) {
              float frac = abs(h0) / max(abs(h0 - h1), 1e-5);
              vec3 hitP = mix(pos, nextPos, frac);
              float rdHit = length(hitP);
              if (rdHit >= rIn && rdHit <= rOut) {
                float uRad = (rdHit - rIn) / (rOut - rIn);
                // Novikov-Thorne relativistic thin-disk radial emissivity profile
                float innerTap = smoothstep(0.0, 0.07, uRad);
                float outerTap = 1.0 - smoothstep(0.58, 1.0, uRad);
                float tempProfile = pow(max(0.08, rIn / rdHit), 0.72) * innerTap * outerTap;

                // Differential Keplerian shear spiral filaments (MRI turbulence)
                vec3 e1 = normalize(cross(diskN, vec3(0.0, 0.0, 1.0)));
                vec3 e2 = cross(diskN, e1);
                float az = atan(dot(hitP, e2), dot(hitP, e1));
                float omega = 1.85 * pow(max(1.0, rdHit / rs), -1.4);
                float retT = uObsTime - (uEnableRetardation * length(hitP - ro)) / uSpeedOfLight;
                float woundAz = az - omega * retT * 0.55;

                float rings = 0.62 + 0.38 * sin(rdHit * 3.8 + bhNoise(vec2(rdHit * 1.6, woundAz * 2.0)) * 3.5);
                float streaks = bhNoise(vec2(rdHit * 2.4, woundAz * 5.0)) * 0.65
                              + bhNoise(vec2(rdHit * 5.5, woundAz * 11.0)) * 0.35;
                float density = clamp(tempProfile * rings * (0.52 + 0.78 * streaks), 0.0, 1.4);

                // Prograde relativistic Keplerian orbital velocity & exact Doppler + Gravitational Redshift!
                vec3 orbDir = normalize(cross(diskN, hitP));
                float betaDisk = min(0.66, sqrt(rs / max(0.8 * rs, 2.0 * (rdHit - 0.75 * rs))));
                float gammaDisk = 1.0 / sqrt(1.0 - betaDisk * betaDisk);
                vec3 rayAtHit = normalize(mix(vel, nextVel, frac));
                // Photon travels along -rayAtHit toward observer
                float emitDenom = gammaDisk * (1.0 + betaDisk * dot(orbDir, rayAtHit));
                float gravEmit = sqrt(max(0.08, 1.0 - rs / rdHit));
                float diskD = clamp((gravEmit * obsGravShift * srObsD) / max(emitDenom, 0.12), 0.08, 18.0);

                // Rest-frame thermal blackbody plasma color (hot golden-white inner ISCO -> fiery orange outer rim)
                vec3 restPlasma = mix(vec3(2.8, 0.62, 0.14), vec3(4.6, 3.4, 2.3), pow(1.0 - uRad, 1.6));
                vec3 obsPlasma = applyRelativisticSpectrumCustom(restPlasma, diskD, 0.92, 0.95, 0.0, 2.65);

                float slabAlpha = clamp(density * 0.88, 0.0, 0.94);
                accumRad += transmittance * obsPlasma * slabAlpha;
                transmittance *= (1.0 - slabAlpha);
              }
            }

            pos = nextPos;
            vel = nextVel;
          }

          // 3. Razor-Sharp Photon Sphere Ring at r_min -> 1.5 * r_s (b -> 2.598 * r_s)
          if (!captured) {
            float pDist = max(0.0, minR - 1.48 * rs) / rs;
            float photonRing = exp(-pDist * pDist * 26.0) * 1.9;
            if (photonRing > 0.005) {
              vec3 ringCol = applyRelativisticSpectrumCustom(
                vec3(2.4, 1.95, 1.45) * photonRing,
                clamp(srObsD * obsGravShift, 0.1, 14.0),
                0.9, 0.9, 0.0, 1.2
              );
              accumRad += transmittance * ringCol;
            }
          }

          float outAlpha = captured ? 1.0 : clamp(1.0 - transmittance, 0.0, 1.0);
          if (outAlpha < 0.003 && dot(accumRad, accumRad) < 1e-6) discard;

          // Apply scene tone-mapping & sRGB encoding so premultiplied alpha matches both Composer & Mobile Direct!
          vec3 mapped = accumRad;
          gl_FragColor = vec4(mapped, outAlpha);
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
    this.cubeCamA = new THREE.CubeCamera(0.8, 950.0, this.cubeRTA);
    this.cubeCamB = new THREE.CubeCamera(0.8, 950.0, this.cubeRTB);

    // Position CubeCameras right at the exit views of Mouth A and Mouth B!
    this.cubeCamA.position.set(this.metric.wormholeA[0], 2.2, this.metric.wormholeA[2] + 6.8);
    this.cubeCamB.position.set(this.metric.wormholeB[0] + 1.5, 2.8, this.metric.wormholeB[2] + 7.0);
    this.scene.add(this.cubeCamA);
    this.scene.add(this.cubeCamB);

    const makeMouthMesh = (posArr, partnerCubeTex, yawDelta) => {
      const metricGLSL = this.metric.getShaderModule();
      const spectralGLSL = getSpectralGLSL();
      const rotMat = new THREE.Matrix3().set(
        Math.cos(yawDelta), 0, Math.sin(yawDelta),
        0, 1, 0,
        -Math.sin(yawDelta), 0, Math.cos(yawDelta)
      );

      const uniforms = Object.assign({}, this.shaderSystem.sharedUniforms, {
        uMouthCenter: { value: new THREE.Vector3(posArr[0], posArr[1], posArr[2]) },
        uThroatR: { value: this.metric.wormholeThroatR },
        uShellR: { value: this.wormholeShellRadius },
        uPartnerCube: { value: partnerCubeTex },
        uPortalRot: { value: rotMat },
      });

      const geo = new THREE.SphereGeometry(this.wormholeShellRadius, 44, 32);
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

            // Impact parameter b of photon relative to Spherical Morris–Thorne Throat center
            vec3 toMouth = uMouthCenter - uObsPos;
            float tProj = dot(toMouth, rd);
            if (tProj <= 0.0) discard;
            vec3 bVec = rd * tProj - toMouth;
            float b = length(bVec);
            if (b >= uShellR) discard;

            if (b < uThroatR) {
              // 1. Inside Morris–Thorne Throat (b < b_0):
              //    Exact Ellis–Bronnikov curved-throat angular deflection as ray crosses l = 0 into Partner Mouth!
              float xi = clamp(b / uThroatR, 0.0, 0.996);
              float defl = 0.52 * xi * xi + 0.28 * (xi * xi * xi) / sqrt(max(0.02, 1.0 - xi * xi));
              vec3 axis = cross(rd, -bVec / max(b, 1e-4));
              float axLen = length(axis);
              vec3 bentRd = (axLen > 1e-5) ? rotateAroundAxis(rd, axis / axLen, defl) : rd;
              vec3 exitDir = normalize(uPortalRot * bentRd);

              vec4 partnerSample = textureCube(uPartnerCube, exitDir);
              vec3 linPartner = max(vec3(0.0), partnerSample.rgb);
              vec3 shifted = applyRelativisticSpectrumCustom(linPartner, srD, 0.88, 0.92, 0.0, 0.65);

              float rimRim = smoothstep(0.76, 1.0, xi);
              float ripple = 0.5 + 0.5 * sin(22.0 * xi - uObsTime * 3.8);
              vec3 casimirGlow = vec3(0.22, 0.82, 1.35) * rimRim * (0.45 + 0.55 * ripple);

              gl_FragColor = vec4(shifted + casimirGlow, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            } else {
              // 2. Throat Photon Sphere & Exterior Exotic-Matter Lensing Rim (b_0 <= b < R_shell)
              float uOut = (b - uThroatR) / max(0.2, uShellR - uThroatR);
              float photonRing = exp(-uOut * uOut * 28.0);
              float az = atan(bVec.y, bVec.x + bVec.z);
              float swirl = 0.65 + 0.35 * sin(az * 6.0 + uObsTime * 2.8 - uOut * 10.0);
              vec3 haloBase = mix(vec3(0.35, 0.95, 1.6), vec3(0.75, 0.35, 1.55), uOut) * photonRing * swirl * 1.65;
              vec3 shiftedHalo = applyRelativisticSpectrumCustom(haloBase, srD, 0.9, 0.9, 0.0, 0.8);
              float alpha = clamp(photonRing * 0.92 * (1.0 - uOut), 0.0, 0.95);
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

    // Mouth A (-Z North Boulevard) -> looks out Mouth B (+Z South-East Skyline, exitYaw = +2.82 rad)
    this.mouthAMesh = makeMouthMesh(this.metric.wormholeA, this.cubeRTB.texture, -2.82);
    // Mouth B (East Skyline) -> looks out Mouth A (+Z South down Grand Boulevard, exitYaw = pi rad)
    this.mouthBMesh = makeMouthMesh(this.metric.wormholeB, this.cubeRTA.texture, Math.PI);
  }

  /**
   * Captures live 3D city & sky cubemap panoramas at Mouth A & Mouth B so peering into either
   * spherical Morris–Thorne throat reveals the real 3D destination street!
   */
  bakeWormholePortals(observer) {
    if (!this.threeRenderer || !this.mouthAMesh || !this.mouthBMesh) return;
    // Temporarily evaluate rest-frame city view (`beta = 0`) for clean destination cubemap capture
    const su = this.shaderSystem.sharedUniforms;
    const savedPos = su.uObsPos.value.clone();
    const savedBeta = su.uObsBeta.value.clone();
    const savedGamma = su.uObsGamma.value;
    const savedGR = su.uEnableGR.value;

    this.mouthAMesh.visible = false;
    this.mouthBMesh.visible = false;
    if (this.bhMesh) this.bhMesh.visible = false;

    su.uObsBeta.value.set(0, 0, 0);
    su.uObsGamma.value = 1.0;
    su.uEnableGR.value = 0.0;

    su.uObsPos.value.copy(this.cubeCamA.position);
    this.cubeCamA.update(this.threeRenderer, this.scene);

    su.uObsPos.value.copy(this.cubeCamB.position);
    this.cubeCamB.update(this.threeRenderer, this.scene);

    su.uObsPos.value.copy(savedPos);
    su.uObsBeta.value.copy(savedBeta);
    su.uObsGamma.value = savedGamma;
    su.uEnableGR.value = savedGR;

    const grActive = this.metric.enableGR;
    this.mouthAMesh.visible = grActive;
    this.mouthBMesh.visible = grActive;
    if (this.bhMesh) this.bhMesh.visible = grActive;
    void observer;
  }

  /**
   * Applies General Relativistic physics per frame:
   *   1. Schwarzschild geodesic pull + prograde Kerr frame-dragging / Oberth gravity-assist slingshot!
   *   2. Event-Horizon tidal capture safety reset if `r_horiz < 4.5m`.
   *   3. Seamless bidirectional Morris–Thorne Wormhole Shortcut traversal (`Mouth A <-> Mouth B`)!
   */
  update(dtReal, observer, vehicle, todHours) {
    const grOn = this.metric.enableGR;
    if (this.bhMesh) {
      this.bhMesh.visible = grOn;
      if (grOn) {
        const dCam = Math.hypot(
          observer.event[1] - this.metric.bhPos[0],
          observer.event[2] - this.metric.bhPos[1],
          observer.event[3] - this.metric.bhPos[2]
        );
        const wantBack = dCam <= this.bhBoundRadius + 0.4;
        const targetSide = wantBack ? THREE.BackSide : THREE.FrontSide;
        if (this.bhMesh.material.side !== targetSide) {
          this.bhMesh.material.side = targetSide;
          this.bhMesh.material.depthTest = !wantBack;
          this.bhMesh.material.needsUpdate = true;
        }
      }
    }
    if (this.mouthAMesh) this.mouthAMesh.visible = grOn;
    if (this.mouthBMesh) this.mouthBMesh.visible = grOn;

    if (!grOn) return;

    // Refresh wormhole destination cubemaps if solar Time of Day shifted meaningfully
    const todDiff = Math.min(Math.abs(todHours - this.lastCubeBakeTod), 24.0 - Math.abs(todHours - this.lastCubeBakeTod));
    if (todDiff > 1.8) {
      this.lastCubeBakeTod = todHours;
      this.bakeWormholePortals(observer);
    }

    if (this.playerWormholeCooldown > 0.0) {
      this.playerWormholeCooldown = Math.max(0.0, this.playerWormholeCooldown - dtReal);
    }

    const dt = Math.min(0.05, Math.max(0.001, dtReal));
    const c = this.metric.c;
    const c2 = c * c;

    // --- 1. Kerr–Schwarzschild Black Hole Gravity-Assist Slingshot & Tidal Horizon ---
    const bhX = this.metric.bhPos[0];
    const bhZ = this.metric.bhPos[2];
    const dxBH = vehicle.carX - bhX;
    const dzBH = vehicle.carZ - bhZ;
    const rHoriz = Math.hypot(dxBH, dzBH);

    if (rHoriz < 4.55) {
      // Crossed Event Horizon / Tidal Disruption Radius -> safely eject back onto Grand Boulevard!
      vehicle.teleportTo(-2.4, 0.02, 18.0, 0.0);
      vehicle.setBetaDirect(0.35);
      if (this.onHorizonReset) this.onHorizonReset();
      return;
    }

    if (rHoriz < 38.0) {
      const rx = dxBH / rHoriz;
      const rz = dzBH / rHoriz;
      // Prograde Kerr frame-dragging tangent (aligned with Northbound -Z Slingshot Bypass at X > bhX!)
      const tx = dzBH / rHoriz;
      const tz = -dxBH / rHoriz;

      const r3D = Math.hypot(dxBH, (vehicle.footY + 0.6) - this.metric.bhPos[1], dzBH);
      const rs = this.metric.bhRs;
      const falloff = 1.0 - Math.max(0.0, rHoriz - 24.0) / 14.0;

      // Radial geodesic inward pull (gently bends trajectory around the Black Hole!)
      const pMag = Math.hypot(vehicle.px, vehicle.pz);
      if (pMag > 0.25) {
        const pullAccel = Math.min(18.0, (0.38 * c2 * rs) / Math.max(36.0, r3D * r3D)) * falloff;
        vehicle.px -= rx * pullAccel * dt;
        vehicle.pz -= rz * pullAccel * dt;

        // Prograde Kerr Ergosphere Frame-Dragging + Relativistic Oberth Slingshot Boost!
        // Driving prograde past the Black Hole whips spatial momentum forward up to ~0.97c!
        const fwdX = Math.sin(vehicle.moveYaw);
        const fwdZ = -Math.cos(vehicle.moveYaw);
        const progradeAlign = Math.max(0.0, fwdX * tx + fwdZ * tz);
        const slingshotWhip =
          (0.85 * c2 * rs * this.metric.bhSpin) / Math.max(28.0, Math.pow(r3D, 1.75)) *
          (0.35 + 0.95 * progradeAlign) *
          falloff;

        const maxSlingshotP = (0.985 * c) / Math.sqrt(1.0 - 0.985 * 0.985);
        if (pMag < maxSlingshotP) {
          vehicle.px += fwdX * slingshotWhip * dt;
          vehicle.pz += fwdZ * slingshotWhip * dt;
        }
      }
    }

    // --- 2. Traversable Morris–Thorne Wormhole Shortcut (`Mouth A <-> Mouth B`) ---
    if (this.playerWormholeCooldown <= 0.0 && vehicle.footY < 6.0) {
      const wA = this.metric.wormholeA;
      const wB = this.metric.wormholeB;
      const dA = Math.hypot(vehicle.carX - wA[0], vehicle.carZ - wA[2]);
      const dB = Math.hypot(vehicle.carX - wB[0], vehicle.carZ - wB[2]);
      const triggerR = this.metric.wormholeThroatR + 0.65;

      if (dA < triggerR) {
        // Traverse Mouth A (North Boulevard) -> Emerge from Mouth B onto East Skyline Back Straight (Southbound)!
        this._traversePortal(vehicle, 203.5, 1.06, 62.5, 2.82);
      } else if (dB < triggerR) {
        // Traverse Mouth B (East Skyline) -> Emerge from Mouth A onto North Grand Boulevard (Southbound)!
        this._traversePortal(vehicle, -3.2, 0.02, -139.0, Math.PI);
      }
    }
  }

  _traversePortal(vehicle, exitX, exitFootY, exitZ, exitYaw) {
    const pHoriz = Math.hypot(vehicle.px, vehicle.pz);
    const minExitP = Math.max(pHoriz, 0.42 * this.metric.c);
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

    this.playerWormholeCooldown = 1.8;
    if (this.onWormholeTraverse) this.onWormholeTraverse();
  }
}
