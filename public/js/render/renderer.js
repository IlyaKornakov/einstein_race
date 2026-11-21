/**
 * Three.js AAA Relativistic PBR Renderer, Dynamic PMREM Reflections & Post-Processing
 * ===================================================================================
 *
 * Orchestrates:
 *   - WebGL2 PBR rendering with `PCFSoftShadowMap` (2048x2048 texel-snapped sun cascade)
 *   - Dynamic `PMREMGenerator` HDR environment cubemap so curved Ferrari clearcoat paint,
 *     concept cars, and glass skyscrapers reflect the live Sunrise / Day / Sunset / Night sky
 *   - 4x MSAA HalfFloat `EffectComposer` with `RenderPass`, high-threshold `UnrealBloomPass`,
 *     and `ACESFilmicToneMapping` `OutputPass`
 *   - Relativistic perceptual eye-adaptation exposure control
 */

import * as THREE from 'three';
import { EffectComposer } from '../../vendor/EffectComposer.js';
import { RenderPass } from '../../vendor/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/OutputPass.js';
import { ShaderPass } from '../../vendor/ShaderPass.js';

export const IS_MOBILE_DEVICE =
  typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') ||
    (navigator.maxTouchPoints > 1 &&
      typeof window !== 'undefined' &&
      Math.min(window.innerWidth, window.innerHeight) < 920));

export const IS_FIREFOX_BROWSER =
  typeof navigator !== 'undefined' && /Firefox/i.test(navigator.userAgent || '');

const ModernGameGradeShader = {
  name: 'ModernGameGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uSharpness: { value: 0.34 },
    uBetaMag: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexelSize;
    uniform float uSharpness;
    uniform float uBetaMag;
    varying vec2 vUv;

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);

      // Subtle high-beta peripheral lens dispersion (>0.65c)
      float disp = max(0.0, uBetaMag - 0.55) * 0.0042 * r2;
      vec2 dir = centered;

      vec3 cCenter = texture2D(tDiffuse, vUv).rgb;
      if (disp > 1e-5) {
        cCenter.r = texture2D(tDiffuse, vUv + dir * disp).r;
        cCenter.b = texture2D(tDiffuse, vUv - dir * disp).b;
      }

      // Lightweight Contrast-Adaptive Sharpening (CAS) cross neighborhood
      vec3 cN = texture2D(tDiffuse, vUv + vec2(0.0, uTexelSize.y)).rgb;
      vec3 cS = texture2D(tDiffuse, vUv - vec2(0.0, uTexelSize.y)).rgb;
      vec3 cE = texture2D(tDiffuse, vUv + vec2(uTexelSize.x, 0.0)).rgb;
      vec3 cW = texture2D(tDiffuse, vUv - vec2(uTexelSize.x, 0.0)).rgb;

      vec3 minCol = min(cCenter, min(min(cN, cS), min(cE, cW)));
      vec3 maxCol = max(cCenter, max(max(cN, cS), max(cE, cW)));
      vec3 contrast = clamp(min(minCol, 1.0 - maxCol) / max(maxCol, vec3(1e-4)), 0.0, 1.0);
      vec3 w = -0.14 * sqrt(contrast) * uSharpness;
      vec3 sharpened = clamp((cCenter + (cN + cS + cE + cW) * w) / (1.0 + 4.0 * w), 0.0, 1.0);

      // Subtle optical camera vignette + micro S-curve contrast
      float vig = 1.0 - 0.22 * r2;
      vec3 graded = sharpened * vig;
      graded = mix(graded, smoothstep(0.0, 1.0, graded), 0.07);

      gl_FragColor = vec4(graded, 1.0);
    }
  `,
};

export class RelativisticRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../physics/spacetime.js').MinkowskiMetric} metric
   * @param {import('./relativisticMaterial.js').RelativisticShaderSystem} shaderSystem
   */
  constructor(canvas, metric, shaderSystem) {
    this.canvas = canvas;
    this.metric = metric;
    this.shaderSystem = shaderSystem;
    this.materials = null;

    this.settings = {
      enableRetardation: true,
      enableLorentz: true,
      enableAberration: true,
      enableDoppler: true,
      enableBeaming: true,
      enableAccelEquiv: true,
      autoExposure: true,
      timeOfDayHours: 16.35,
      autoDayCycle: true,
    };

    // 1. WebGLRenderer setup (memory-safe profile on Mobile & Firefox Android!)
    this.isMobile = IS_MOBILE_DEVICE;
    this.contextLost = false;

    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        this.contextLost = true;
      },
      false
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.contextLost = false;
        this.updateTimeOfDayLighting(true);
      },
      false
    );

    this.threeRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: this.isMobile ? 'default' : 'high-performance',
      stencil: false,
    });
    const maxDpr = this.isMobile ? 1.25 : 1.5;
    this.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.threeRenderer.setSize(window.innerWidth, window.innerHeight, false);
    this.threeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.threeRenderer.toneMappingExposure = 1.0;
    // Disable full-scene shadow depth pass on mobile TBDR GPUs (cars already have relativistic
    // contact shadows & facades have vertical uGroundAO — halves triangle binning & frees 1 varying!)
    this.threeRenderer.shadowMap.enabled = !this.isMobile;
    this.threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const gl = this.threeRenderer.getContext();
    const hasFloatFBO = !!(
      gl &&
      (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
    );
    this.useComposer = !this.isMobile && hasFloatFBO;

    // 2. Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      72.0,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.15,
      16000.0
    );
    this.camera.rotation.order = 'YXZ';

    // 3. Relativistic Sky Dome (follows observer every frame)
    const skyGeo = new THREE.SphereGeometry(540.0, this.isMobile ? 32 : 48, this.isMobile ? 20 : 32);
    this.skyMat = this.shaderSystem.createSkyMaterial(false);
    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -10;
    this.scene.add(this.skyMesh);

    // 4. Separate unwarped HDR Sky Scene for `PMREMGenerator` cubemap reflections!
    this.pmremGenerator = new THREE.PMREMGenerator(this.threeRenderer);
    this.pmremGenerator.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    const envSkyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(80.0, 24, 16),
      this.shaderSystem.createSkyMaterial(true)
    );
    this.envScene.add(envSkyMesh);
    this.envRT = null;
    this.lastEnvBakedTod = -999.0;
    this.lastEnvBakeRealMs = -9999.0;

    // 5. Directional Sun / Moon Shadow Light + Hemisphere Fill
    this.sunLight = new THREE.DirectionalLight(0xfff6e8, 3.2);
    this.sunLight.castShadow = !this.isMobile;
    const shadowRes = this.isMobile ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    const dShadow = this.isMobile ? 76 : 92;
    this.sunLight.shadow.camera.left = -dShadow;
    this.sunLight.shadow.camera.right = dShadow;
    this.sunLight.shadow.camera.top = dShadow;
    this.sunLight.shadow.camera.bottom = -dShadow;
    this.sunLight.shadow.camera.near = 2.0;
    this.sunLight.shadow.camera.far = 260.0;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.045;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x9ec5ff, 0x3b352d, 0.92);
    this.scene.add(this.hemiLight);

    // Secondary sky-bounce fill light (non-shadow-casting) to lift dark shadowed facades naturally
    this.bounceLight = new THREE.DirectionalLight(0x9cc4ff, 0.46);
    this.bounceLight.position.set(-45, 32, -45);
    this.scene.add(this.bounceLight);

    // 6. Desktop HDR Post-Processing Composer; on Mobile / non-Float-FBO GPUs, render direct
    //    single-pass hardware ACES to avoid HalfFloat MSAA FBO failures & 160MB VRAM spikes!
    this.composer = null;
    this.bloomPass = null;
    this.gradePass = null;

    if (this.useComposer) {
      const size = this.threeRenderer.getDrawingBufferSize(new THREE.Vector2());
      const maxHwSamples = (gl && gl.getParameter(gl.MAX_SAMPLES)) || 0;
      const targetSamples = Math.min(IS_FIREFOX_BROWSER ? 2 : 4, maxHwSamples);
      const msaaTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
        samples: targetSamples,
      });

      this.composer = new EffectComposer(this.threeRenderer, msaaTarget);
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        0.16,
        0.36,
        1.52
      );
      this.composer.addPass(this.bloomPass);

      this.outputPass = new OutputPass();
      this.composer.addPass(this.outputPass);

      this.gradePass = new ShaderPass(ModernGameGradeShader);
      this.gradePass.uniforms.uTexelSize.value.set(1.0 / Math.max(1, size.x), 1.0 / Math.max(1, size.y));
      this.composer.addPass(this.gradePass);
    }

    this.currentExposure = 1.0;
    this.baseTodExposure = 1.0;

    window.addEventListener('resize', () => this._onResize());
  }

  attachWorld(materials, cityWorld) {
    this.materials = materials;
    this.scene.add(cityWorld.root);
    this.updateTimeOfDayLighting(true);
  }

  _onResize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const maxDpr = this.isMobile ? 1.25 : 1.5;
    this.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.threeRenderer.setSize(w, h, false);
    if (this.composer) {
      const drawSize = this.threeRenderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(drawSize.x, drawSize.y);
      if (this.bloomPass) this.bloomPass.resolution.set(drawSize.x, drawSize.y);
      if (this.gradePass) {
        this.gradePass.uniforms.uTexelSize.value.set(1.0 / Math.max(1, drawSize.x), 1.0 / Math.max(1, drawSize.y));
      }
    }
  }

  /**
   * Computes solar ephemeris, sky palette, shadow direction, night window/lamp glow,
   * and rebakes the HDR PMREM cubemap reflection environment when `forceEnvBake` is true
   * or Time of Day has shifted meaningfully.
   */
  updateTimeOfDayLighting(forceEnvBake = false) {
    const h = (((this.settings.timeOfDayHours % 24.0) + 24.0) % 24.0);
    // Solar elevation peaks at 12:30 (~64 deg), crosses horizon at ~06:15 and ~18:30
    const phase = ((h - 6.25) / 24.0) * Math.PI * 2.0;
    const rawSin = Math.sin(phase);
    const sunElevRad = rawSin * 1.12;
    const sunAzimuth = ((h - 12.25) / 12.0) * Math.PI * 0.85;

    const sy = Math.sin(sunElevRad);
    const horiz = Math.cos(sunElevRad);
    const sx = Math.sin(sunAzimuth) * horiz;
    const sz = Math.cos(sunAzimuth) * horiz;

    const sunDir = this.shaderSystem.sharedUniforms.uSunDir.value;
    sunDir.set(sx, sy, sz).normalize();

    const dayFactor = THREE.MathUtils.smoothstep(sy, -0.08, 0.28);
    const twilightFactor =
      THREE.MathUtils.smoothstep(sy, -0.18, 0.04) *
      (1.0 - THREE.MathUtils.smoothstep(sy, 0.06, 0.34));
    const nightFactor = 1.0 - THREE.MathUtils.smoothstep(sy, -0.14, 0.05);

    const su = this.shaderSystem.sharedUniforms;
    su.uNightFactor.value = nightFactor;

    // Sky zenith & horizon colors across Day -> Crimson Sunset/Sunrise -> Deep Starry Night
    const zenithDay = new THREE.Vector3(0.048, 0.175, 0.54);
    const zenithSunset = new THREE.Vector3(0.065, 0.095, 0.28);
    const zenithNight = new THREE.Vector3(0.004, 0.008, 0.022);

    const horizDay = new THREE.Vector3(0.35, 0.54, 0.80);
    const horizSunset = new THREE.Vector3(0.88, 0.34, 0.14);
    const horizNight = new THREE.Vector3(0.014, 0.024, 0.052);

    const zCol = zenithNight.clone().lerp(zenithDay, dayFactor).lerp(zenithSunset, twilightFactor * 0.78);
    const hCol = horizNight.clone().lerp(horizDay, dayFactor).lerp(horizSunset, twilightFactor * 0.88);
    su.uSkyZenith.value.copy(zCol);
    su.uSkyHorizon.value.copy(hCol);

    // Solar / Lunar direct directional light
    if (sy > -0.06) {
      const sunWarm = new THREE.Color(0xff7235).lerp(new THREE.Color(0xfff7ea), THREE.MathUtils.smoothstep(sy, 0.0, 0.38));
      this.sunLight.color.copy(sunWarm);
      this.sunLight.intensity = THREE.MathUtils.lerp(0.35, 3.35, THREE.MathUtils.smoothstep(sy, -0.05, 0.32));
      su.uSunRadiance.value.set(
        sunWarm.r * (4.0 + 7.0 * dayFactor),
        sunWarm.g * (4.0 + 7.0 * dayFactor),
        sunWarm.b * (4.0 + 7.0 * dayFactor)
      );
      this._lightDir = sunDir.clone();
      if (this._lightDir.y < 0.08) {
        this._lightDir.y = 0.08;
        this._lightDir.normalize();
      }
    } else {
      // Cool crisp moonlight at night so 3D roads, Ferraris & buildings still cast subtle shadows!
      this.sunLight.color.setHex(0x8ab4f8);
      this.sunLight.intensity = 0.52;
      su.uSunRadiance.value.set(0.0, 0.0, 0.0);
      this._lightDir = new THREE.Vector3(-0.38, 0.64, -0.45).normalize();
    }

    this.hemiLight.color.setRGB(
      THREE.MathUtils.clamp(hCol.x * 1.15 + 0.08, 0.12, 1.0),
      THREE.MathUtils.clamp(hCol.y * 1.15 + 0.08, 0.14, 1.0),
      THREE.MathUtils.clamp(hCol.z * 1.15 + 0.12, 0.22, 1.0)
    );
    this.hemiLight.groundColor.setRGB(
      0.16 * dayFactor + 0.05,
      0.15 * dayFactor + 0.045,
      0.14 * dayFactor + 0.05
    );
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.55, 1.05, dayFactor) + twilightFactor * 0.25;

    this.baseTodExposure = THREE.MathUtils.lerp(1.22, 0.96, dayFactor);

    // Scale warm interior windows & boulevard streetlamp bulbs up smoothly at Sunset & Night!
    if (this.materials && this.materials.emissiveNightMaterials) {
      const lampBlend = THREE.MathUtils.smoothstep(sy, 0.22, -0.06);
      for (const item of this.materials.emissiveNightMaterials) {
        item.mat.emissiveIntensity = THREE.MathUtils.lerp(item.day, item.night, lampBlend);
      }
    }

    // Rebake HDR PMREM Cubemap Reflections so car clearcoat & skyscrapers reflect live Sunset/Day/Night!
    const nowMs = performance.now();
    const minBakeIntervalMs = this.isMobile ? 2400.0 : 320.0;
    const minTodStep = this.isMobile ? 1.15 : 0.42;
    const todDiff = Math.min(Math.abs(h - this.lastEnvBakedTod), 24.0 - Math.abs(h - this.lastEnvBakedTod));
    if (!this.contextLost && (forceEnvBake || (todDiff > minTodStep && nowMs - this.lastEnvBakeRealMs > minBakeIntervalMs))) {
      this.lastEnvBakedTod = h;
      this.lastEnvBakeRealMs = nowMs;
      const nextEnv = this.pmremGenerator.fromScene(this.envScene, 0.015);
      if (this.envRT) this.envRT.dispose();
      this.envRT = nextEnv;
      this.scene.environment = this.envRT.texture;
    }
  }

  renderFrame(observer, vehicle, entities, dtReal, dtCoord) {
    if (this.contextLost) return;
    if (this.settings.autoDayCycle) {
      // 1 full 24h solar day per 80s of city coordinate time — accelerates visibly by Lorentz gamma!
      this.settings.timeOfDayHours = (this.settings.timeOfDayHours + (dtCoord / 80.0) * 24.0) % 24.0;
      this.updateTimeOfDayLighting(false);
    }

    // 1. Update global observer & spacetime uniforms
    this.shaderSystem.updateObserverUniforms(observer, this.settings);

    // 2. Position Camera & Sky Dome at exact Observer Event spatial coordinates
    const ox = observer.event[1];
    const oy = observer.event[2];
    const oz = observer.event[3];

    this.camera.position.set(ox, oy, oz);
    // Note: vehicle.camYaw uses +yaw = East (+X), which is -rotation.y in Three.js RHS!
    this.camera.rotation.set(vehicle.camPitch, -vehicle.camYaw, -vehicle.chassisRoll * 0.65, 'YXZ');
    this.skyMesh.position.set(ox, oy, oz);

    // 3. Snap Sun Shadow Camera in 4m increments around player to eliminate shadow-edge shimmer
    const snapX = Math.round(vehicle.carX / 4.0) * 4.0;
    const snapZ = Math.round(vehicle.carZ / 4.0) * 4.0;
    const lDir = this._lightDir || new THREE.Vector3(0.4, 0.75, 0.5);
    this.sunLight.target.position.set(snapX, vehicle.footY, snapZ);
    this.sunLight.position.set(
      snapX + lDir.x * 125.0,
      vehicle.footY + lDir.y * 125.0,
      snapZ + lDir.z * 125.0
    );

    // 4. Relativistic HDR Perceptual Eye Adaptation (prevents over-exposure at 0.92c+ forward beaming)
    const betaMag = Math.hypot(observer.beta[0], observer.beta[1], observer.beta[2]);
    if (this.gradePass) {
      this.gradePass.uniforms.uBetaMag.value = betaMag;
    }
    if (this.bounceLight) {
      this.bounceLight.position.set(snapX - lDir.x * 65.0, vehicle.footY + 38.0, snapZ - lDir.z * 65.0);
    }
    let targetExp = this.baseTodExposure;
    if (this.settings.autoExposure && this.settings.enableBeaming) {
      if (betaMag > 0.25) {
        const fwdD = Math.sqrt((1.0 + betaMag) / Math.max(0.005, 1.0 - betaMag));
        const adapt = 1.0 / Math.pow(Math.max(1.0, fwdD), 0.44);
        targetExp *= THREE.MathUtils.clamp(adapt, 0.42, 1.0);
      }
    }
    this.currentExposure += (targetExp - this.currentExposure) * Math.min(1.0, 5.0 * dtReal);
    this.threeRenderer.toneMappingExposure = this.currentExposure;

    // 5. Render Scene (Desktop HDR MSAA Composer or Mobile Direct Single-Pass Hardware ACES)
    if (this.composer) {
      this.composer.render(dtReal);
    } else {
      this.threeRenderer.render(this.scene, this.camera);
    }
  }
}
