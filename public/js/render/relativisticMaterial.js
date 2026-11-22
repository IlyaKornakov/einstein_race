/**
 * Relativistic PBR Material Injector & Sky Shader System
 * ======================================================
 *
 * Bridges the spacetime metric's past-light-cone GLSL module (`SpacetimeMetric.getShaderModule()`)
 * and calibrated CIE 1931 spectral Doppler convolution (`getSpectralGLSL()`) into Three.js
 * `MeshStandardMaterial` and `MeshPhysicalMaterial` (supporting static world geometry,
 * `InstancedMesh`, `.glb` vehicle hierarchies with clearcoat/transmission, and `SkinnedMesh`
 * motion-captured pedestrians) while keeping Three.js `PCFSoftShadowMap` in rest-frame city space.
 */

import * as THREE from 'three';
import { computeCalibratedSpectralMatrix, buildSpectralLUTData, getSpectralGLSL } from '../physics/spectral.js?v=2.1';

function createSpectralLUTTexture() {
  const { width, height, floats } = buildSpectralLUTData();
  const halfData = new Uint16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    halfData[i] = THREE.DataUtils.toHalfFloat(floats[i]);
  }
  const tex = new THREE.DataTexture(halfData, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class RelativisticShaderSystem {
  /**
   * @param {import('../physics/spacetime.js').SpacetimeMetric} metric
   */
  constructor(metric) {
    this.metric = metric;

    const spectralMat3 = new THREE.Matrix3().fromArray(computeCalibratedSpectralMatrix());
    const spectralLUT = createSpectralLUTTexture();

    this.sharedUniforms = {
      uObsPos: { value: new THREE.Vector3(0, 1.5, 0) },
      uObsTime: { value: 0.0 },
      uObsBeta: { value: new THREE.Vector3(0, 0, 0) },
      uObsGamma: { value: 1.0 },
      uSpeedOfLight: { value: metric.c },

      uEnableRetardation: { value: 1.0 },
      uEnableLorentz: { value: 1.0 },
      uEnableAberration: { value: 1.0 },
      uEnableDoppler: { value: 1.0 },
      uEnableBeaming: { value: 1.0 },
      uEnableAccelEquiv: { value: 1.0 },
      uObsProperAccel: { value: new THREE.Vector3(0, 0, 0) },
      uBeamingExponent: { value: 3.2 },
      uRgbToSpectralWeights: { value: spectralMat3 },
      uSpectralLUT: { value: spectralLUT },

      // General Relativity (v2.1) Shared Uniforms
      uEnableGR: { value: 1.0 },
      uBHPos: { value: new THREE.Vector3(-36.0, 1.90, 54.0) },
      uBHRs: { value: 3.50 },
      uObsGravAlpha: { value: 1.0 },
      uWormholeAPos: { value: new THREE.Vector3(-5.0, 2.55, -150.0) },
      uWormholeBPos: { value: new THREE.Vector3(201.0, 3.45, 54.0) },
      uWormholeR: { value: 4.2 },
      uGWPos: { value: new THREE.Vector3(275.0, 52.0, 28.0) },

      // Atmospheric / Time-of-Day uniforms shared with Sky & PMREM env cubemap
      uSunDir: { value: new THREE.Vector3(0.45, 0.72, 0.52).normalize() },
      uSunRadiance: { value: new THREE.Vector3(10.0, 9.6, 8.9) },
      uSkyZenith: { value: new THREE.Vector3(0.055, 0.19, 0.56) },
      uSkyHorizon: { value: new THREE.Vector3(0.36, 0.54, 0.80) },
      uNightFactor: { value: 0.0 },
      uCloudDrift: { value: 0.0 },
    };

    this.staticEntityUniforms = this.createEntityUniforms({ isDynamic: false, isCoMoving: false });
  }

  /**
   * Creates a per-entity uniform bundle shared across all sub-materials of a dynamic entity
   * (vehicle, train, or skinned pedestrian) or static clock hand.
   */
  createEntityUniforms({
    isDynamic = false,
    isCoMoving = false,
    clockSpinOmega = 0.0,
    clockPivot = null,
    clockAxis = null,
    pulseHz = 0.0,
  } = {}) {
    return {
      uIsDynamic: { value: isDynamic ? 1.0 : 0.0 },
      uIsCoMoving: { value: isCoMoving ? 1.0 : 0.0 },
      uEntityPosNow: { value: new THREE.Vector3() },
      uEntityBeta: { value: new THREE.Vector3() },
      uEntityGamma: { value: 1.0 },
      uClockSpinOmega: { value: clockSpinOmega },
      uClockPivot: { value: clockPivot ? clockPivot.clone() : new THREE.Vector3() },
      uClockAxis: { value: clockAxis ? clockAxis.clone() : new THREE.Vector3(0, 0, 1) },
      uPulseHz: { value: pulseHz },
    };
  }

  /**
   * Updates global observer & physics toggle uniforms once per frame in O(1) time.
   */
  updateObserverUniforms(observer, settings) {
    const su = this.sharedUniforms;
    su.uObsTime.value = observer.event[0];
    su.uObsPos.value.set(observer.event[1], observer.event[2], observer.event[3]);
    su.uObsBeta.value.set(observer.beta[0], observer.beta[1], observer.beta[2]);
    su.uObsGamma.value = observer.gamma;
    su.uSpeedOfLight.value = this.metric.c;

    su.uEnableRetardation.value = settings.enableRetardation ? 1.0 : 0.0;
    su.uEnableLorentz.value = settings.enableLorentz ? 1.0 : 0.0;
    su.uEnableAberration.value = settings.enableAberration ? 1.0 : 0.0;
    su.uEnableDoppler.value = settings.enableDoppler ? 1.0 : 0.0;
    su.uEnableBeaming.value = settings.enableBeaming ? 1.0 : 0.0;
    su.uEnableAccelEquiv.value = (settings.enableAccelEquiv ?? true) ? 1.0 : 0.0;
    const grOn = (settings.enableGR ?? true);
    su.uEnableGR.value = grOn ? 1.0 : 0.0;
    su.uObsGravAlpha.value = grOn ? (observer.gravAlpha ?? 1.0) : 1.0;
    if (this.metric && 'enableGR' in this.metric) {
      this.metric.enableGR = grOn;
      if (this.metric.bhPos) {
        su.uBHPos.value.set(this.metric.bhPos[0], this.metric.bhPos[1], this.metric.bhPos[2]);
        su.uBHRs.value = this.metric.bhRs;
        su.uWormholeAPos.value.set(this.metric.wormholeA[0], this.metric.wormholeA[1], this.metric.wormholeA[2]);
        su.uWormholeBPos.value.set(this.metric.wormholeB[0], this.metric.wormholeB[1], this.metric.wormholeB[2]);
        su.uWormholeR.value = this.metric.wormholeThroatR;
      }
      if (this.metric.gwPos) {
        su.uGWPos.value.set(this.metric.gwPos[0], this.metric.gwPos[1], this.metric.gwPos[2]);
      }
    }
    su.uObsProperAccel.value.set(
      observer.properAcceleration[0],
      observer.properAcceleration[1],
      observer.properAcceleration[2]
    );
    su.uCloudDrift.value = observer.event[0] * 0.008;
  }

  /**
   * Injects exact past-light-cone vertex projection and CIE spectral Doppler shift
   * into any Three.js MeshStandardMaterial or MeshPhysicalMaterial.
   * Uses a stable `customProgramCacheKey` so cloned entity materials compile only once on GPU.
   */
  patchMaterial(material, entityUniforms = this.staticEntityUniforms, matOpts = {}) {
    if (!material || material.userData?.isRelativisticPatched) {
      return material;
    }

    const uvWeight = matOpts.uvWeight ?? 0.86;
    const nirWeight = matOpts.nirWeight ?? 0.92;
    const narrowBandNm = matOpts.narrowBandNm ?? 0.0;
    const macroDetail = matOpts.macroDetail ?? 0.0;
    const groundAO = matOpts.groundAO ?? 0.0;
    const roadPolish = matOpts.roadPolish ?? 0.0;
    const interiorRoom = matOpts.interiorRoom ?? 0.0;
    const shared = this.sharedUniforms;
    const metricGLSL = this.metric.getShaderModule();
    const spectralGLSL = getSpectralGLSL();

    const cacheTag = `rel_gr_v22_${material.type}`;
    material.customProgramCacheKey = () => cacheTag;

    material.onBeforeCompile = (shader) => {
      // Bind global shared uniform references
      Object.assign(shader.uniforms, shared);
      // Bind per-entity uniform references
      Object.assign(shader.uniforms, entityUniforms);
      // Bind per-material spectral & AAA surface detail parameters
      shader.uniforms.uSpectralUV = { value: uvWeight };
      shader.uniforms.uSpectralNIR = { value: nirWeight };
      shader.uniforms.uNarrowBandNm = { value: narrowBandNm };
      shader.uniforms.uMacroDetail = { value: macroDetail };
      shader.uniforms.uGroundAO = { value: groundAO };
      shader.uniforms.uRoadPolish = { value: roadPolish };
      shader.uniforms.uInteriorRoom = { value: interiorRoom };

      // 1. Vertex Shader Injection (packed into 4 vec4 varyings so mobile MAX_VARYING_VECTORS=15 never overflows!)
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        /* glsl */ `
        varying vec4 vRelEmitAndD;
        varying vec4 vRelLocalAndT;
        varying vec4 vRelRestPosU;
        varying vec4 vRelRestNrmV;
        uniform float uIsDynamic;
        uniform float uIsCoMoving;
        uniform vec3 uEntityPosNow;
        uniform vec3 uEntityBeta;
        uniform vec3 uClockPivot;
        uniform vec3 uClockAxis;
        uniform float uEntityGamma;
        uniform float uClockSpinOmega;
        ${metricGLSL}

        void main() {
          vec2 relSurfUV = uv;
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 relWorld4 = vec4( transformed, 1.0 );
        vec3 relNrmLocal = vec3( 0.0, 1.0, 0.0 );
        #ifdef OBJECTSPACE_NORMALMAP
          relNrmLocal = normal;
        #else
          relNrmLocal = objectNormal;
        #endif
        #ifdef USE_BATCHING
          relWorld4 = batchingMatrix * relWorld4;
        #endif
        #ifdef USE_INSTANCING
          relWorld4 = instanceMatrix * relWorld4;
          relNrmLocal = mat3( instanceMatrix ) * relNrmLocal;
        #endif
        relWorld4 = modelMatrix * relWorld4;
        vec3 relUncontractedWorld = relWorld4.xyz;
        vec3 relRestWorldNrm = normalize( mat3( modelMatrix ) * relNrmLocal );

        // Optional static clock-hand retarded coordinate-time rotation
        if ( abs( uClockSpinOmega ) > 1e-6 ) {
          vec3 pIter = relUncontractedWorld;
          float tEmit = uObsTime;
          for ( int it = 0; it < 3; it ++ ) {
            float distIt = length( pIter - uObsPos );
            tEmit = uObsTime - ( uEnableRetardation * distIt ) / uSpeedOfLight;
            pIter = uClockPivot + rotateAroundAxis( relUncontractedWorld - uClockPivot, uClockAxis, uClockSpinOmega * tEmit );
          }
          relUncontractedWorld = pIter;
        }
        vRelRestPosU = vec4( relUncontractedWorld, relSurfUV.x );
        vRelRestNrmV = vec4( relRestWorldNrm, relSurfUV.y );

        RelativisticObservation relObs;
        vec3 relDummyNormal;
        if ( uIsCoMoving > 0.5 ) {
          relObs.observerLocalPos = relUncontractedWorld - uObsPos;
          relObs.cityEmitOffset = relObs.observerLocalPos;
          relObs.cityEmitPos = relUncontractedWorld;
          relObs.lightTravelDist = length( relObs.observerLocalPos );
          relObs.emitCoordTime = uObsTime;
          relObs.emitProperTime = uObsTime;
          relObs.restViewDir = vec3( 0.0, 0.0, 1.0 );
          relObs.dopplerFactor = 1.0;
        } else if ( uIsDynamic > 0.5 ) {
          vec3 r0 = relUncontractedWorld - uEntityPosNow;
          relObs = projectPastLightCone(
            r0,
            vec3( 0.0, 1.0, 0.0 ),
            true,
            uEntityPosNow,
            vec3( 0.0 ),
            mat3( 1.0 ),
            uEntityBeta,
            uEntityGamma,
            uObsTime,
            vec3( 0.0 ),
            vec3( 0.0, 1.0, 0.0 ),
            0.0,
            0.0,
            relDummyNormal
          );
        } else {
          relObs = projectPastLightCone(
            relUncontractedWorld,
            vec3( 0.0, 1.0, 0.0 ),
            false,
            vec3( 0.0 ),
            vec3( 0.0 ),
            mat3( 1.0 ),
            vec3( 0.0 ),
            1.0,
            uObsTime,
            vec3( 0.0 ),
            vec3( 0.0, 1.0, 0.0 ),
            0.0,
            0.0,
            relDummyNormal
          );
        }

        vRelEmitAndD = vec4( relObs.cityEmitOffset, relObs.dopplerFactor );
        vRelLocalAndT = vec4( relObs.observerLocalPos, relObs.emitCoordTime );
        vec4 mvPosition = viewMatrix * vec4( uObsPos + relObs.observerLocalPos, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
          vec4 worldPosition = vec4( relObs.cityEmitPos, 1.0 );
        #endif
        `
      );

      // 2. Fragment Shader Injection (unpacks the 4 packed vec4 varyings)
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        /* glsl */ `
        varying vec4 vRelEmitAndD;
        varying vec4 vRelLocalAndT;
        varying vec4 vRelRestPosU;
        varying vec4 vRelRestNrmV;
        #define vCityEmitOffset (vRelEmitAndD.xyz)
        #define vRelDoppler (vRelEmitAndD.w)
        #define vObsLocalPos (vRelLocalAndT.xyz)
        #define vRelEmitCoordTime (vRelLocalAndT.w)
        #define vRestWorldPos (vRelRestPosU.xyz)
        #define vRestWorldNormal (vRelRestNrmV.xyz)
        #define vSurfUV (vec2(vRelRestPosU.w, vRelRestNrmV.w))
        uniform float uIsDynamic;
        uniform float uIsCoMoving;
        uniform vec3 uEntityBeta;
        uniform float uEntityGamma;
        uniform vec3 uObsPos;
        uniform float uObsTime;
        uniform vec3 uObsBeta;
        uniform float uObsGamma;
        uniform float uSpeedOfLight;
        uniform float uEnableRetardation;
        uniform vec3 uObsProperAccel;
        uniform float uEnableAccelEquiv;
        uniform float uEnableGR;
        uniform vec3 uBHPos;
        uniform float uBHRs;
        uniform float uObsGravAlpha;
        uniform float uSpectralUV;
        uniform float uSpectralNIR;
        uniform float uNarrowBandNm;
        uniform float uPulseHz;
        uniform float uMacroDetail;
        uniform float uGroundAO;
        uniform float uRoadPolish;
        uniform float uInteriorRoom;
        uniform vec3 uSkyHorizon;
        uniform float uNightFactor;
        ${spectralGLSL}

        float relHash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float relNoise2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(relHash12(i), relHash12(i + vec2(1.0, 0.0)), f.x),
            mix(relHash12(i + vec2(0.0, 1.0)), relHash12(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        float evalFragRindler(vec3 locPos) {
          if (uEnableAccelEquiv < 0.5) return 1.0;
          float c2 = max(4.0, uSpeedOfLight * uSpeedOfLight);
          float r = length(locPos);
          vec3 eff = (r > 65.0) ? (locPos * (65.0 / r)) : locPos;
          return clamp(1.0 + 0.68 * dot(uObsProperAccel, eff) / c2, 0.22, 3.8);
        }

        float evalFragGravDoppler(vec3 emitWorld) {
          if (uEnableGR < 0.5 || uBHRs <= 0.01) return 1.0;
          float rEmit = length(emitWorld - uBHPos);
          float alphaEmit = 1.0;
          if (rEmit < 105.0) {
            float rSafe = max(uBHRs * 1.0005, rEmit);
            float u = uBHRs / rSafe;
            float u2 = u * u;
            float rawA = pow(max(0.0, 1.0 - u), 1.15) / (1.0 + 6.5 * u2 + 12.0 * u2 * u2);
            float fade = clamp((105.0 - rEmit) / 40.0, 0.0, 1.0);
            alphaEmit = clamp(1.0 - (1.0 - rawA) * fade, 0.018, 1.0);
          }
          return clamp(alphaEmit / max(0.018, uObsGravAlpha), 0.02, 55.0);
        }

        // True Ray-Box 3D Parallax Interior Mapping for Apartment & Skyscraper Windows
        vec3 sampleParallaxInterior(vec3 worldP, vec3 worldN, vec2 paneUV, float style, out float glassMask) {
          glassMask = 0.0;
          if (abs(worldN.y) > 0.45) return vec3(0.0);

          // Mullion / window-frame border mask so stone/aluminum mullions stay solid!
          vec2 cellUV = (style > 1.5) ? fract(paneUV * 8.0) : fract(paneUV * 2.0);
          float frameX = smoothstep(0.06, 0.11, cellUV.x) * (1.0 - smoothstep(0.89, 0.94, cellUV.x));
          float frameY = smoothstep(0.16, 0.22, cellUV.y) * (1.0 - smoothstep(0.90, 0.95, cellUV.y));
          glassMask = frameX * frameY;
          if (glassMask < 0.02) return vec3(0.0);

          vec3 N = normalize(vec3(worldN.x, 0.0, worldN.z));
          vec3 T = vec3(-N.z, 0.0, N.x);
          float roomW = (style > 1.5) ? 3.4 : 2.9;
          float roomH = (style > 1.5) ? 3.5 : 3.45;

          float uCoord = dot(worldP, T) / roomW;
          float vCoord = worldP.y / roomH;
          vec2 roomId = floor(vec2(uCoord, vCoord));
          vec2 roomFrac = fract(vec2(uCoord, vCoord)) - 0.5;

          vec3 viewRay = normalize(worldP - uObsPos);
          vec3 rd = vec3(dot(viewRay, T), viewRay.y, max(0.10, dot(viewRay, -N)));

          float tBack = 0.88 / rd.z;
          float tSide = ((rd.x >= 0.0 ? 0.5 : -0.5) - roomFrac.x) / (abs(rd.x) < 1e-4 ? 1e-4 : rd.x);
          float tVert = ((rd.y >= 0.0 ? 0.5 : -0.5) - roomFrac.y) / (abs(rd.y) < 1e-4 ? 1e-4 : rd.y);
          float tHit = min(tBack, min(tSide > 0.0 ? tSide : 99.0, tVert > 0.0 ? tVert : 99.0));
          vec3 hit = vec3(roomFrac, 0.0) + rd * tHit;

          float rnd = relHash12(roomId + vec2(style * 13.7, dot(floor(worldP.xz * 0.05), vec2(7.1, 3.3))));
          float litProb = mix(0.32, 0.76, uNightFactor);
          bool isLit = rnd < litProb;

          vec3 warmTone = mix(vec3(1.0, 0.74, 0.42), vec3(0.76, 0.90, 1.0), step(0.66, fract(rnd * 17.3)));
          float depthAtten = exp(-hit.z * 1.15);

          // Ceiling light fixture glow + back-wall furniture/blind silhouette
          float ceilMask = smoothstep(0.46, 0.495, hit.y);
          float fixture = smoothstep(0.28, 0.06, length(vec2(hit.x * 1.2, (hit.z - 0.42) * 1.3)));
          float blinds = 0.82 + 0.18 * sin(hit.y * 42.0);
          float backShelf = 0.65 + 0.35 * step(0.35, fract(hit.x * 4.0 + hit.y * 2.0));

          vec3 wallBase = mix(vec3(0.04, 0.05, 0.07), warmTone * 0.42, isLit ? 1.0 : 0.18);
          vec3 roomRad = wallBase * blinds * backShelf * depthAtten;
          if (isLit) {
            roomRad += warmTone * (ceilMask * fixture * 1.85 + 0.22 * depthAtten);
          }
          return roomRad * (isLit ? mix(0.55, 1.55, uNightFactor) : 0.35);
        }

        void main() {
        `
      );

      // Inject Macro Anti-Tiling & Ground Contact AO into diffuseColor
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>
        if ( uMacroDetail > 0.01 ) {
          float nMacro = relNoise2D( vRestWorldPos.xz * 0.032 + vec2( vRestWorldPos.y * 0.05 ) );
          float nMid = relNoise2D( vRestWorldPos.xz * 0.16 - vec2( vRestWorldPos.y * 0.11 ) );
          float modShade = mix( 1.0, 0.80 + 0.36 * ( 0.65 * nMacro + 0.35 * nMid ), uMacroDetail );
          diffuseColor.rgb *= modShade;
        }
        if ( uGroundAO > 0.01 ) {
          float gAO = mix( 1.0 - 0.38 * uGroundAO, 1.0, smoothstep( -0.05, 2.1, vRestWorldPos.y ) );
          float corniceStreak = 0.93 + 0.07 * sin( vRestWorldPos.x * 2.4 + vRestWorldPos.z * 2.4 );
          diffuseColor.rgb *= gAO * corniceStreak;
        }
        if ( uRoadPolish > 0.01 ) {
          // Darken tire-worn racing wheelpaths slightly like real rubbered-in Grand Prix tarmac!
          float laneL = exp( -pow( ( vSurfUV.x - 0.28 ) * 8.5, 2.0 ) );
          float laneR = exp( -pow( ( vSurfUV.x - 0.72 ) * 8.5, 2.0 ) );
          float rubberMask = clamp( laneL + laneR, 0.0, 1.0 );
          diffuseColor.rgb *= ( 1.0 - 0.18 * uRoadPolish * rubberMask );
        }
        `
      );

      // Inject Specular Racing-Line Roughness & Damp Sheen into roughnessFactor
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        if ( uMacroDetail > 0.01 ) {
          float rNoise = relNoise2D( vRestWorldPos.xz * 0.09 );
          roughnessFactor = clamp( roughnessFactor + ( rNoise - 0.5 ) * 0.14 * uMacroDetail, 0.08, 0.98 );
        }
        if ( uRoadPolish > 0.01 ) {
          float wL1 = exp( -pow( ( vSurfUV.x - 0.23 ) * 14.0, 2.0 ) );
          float wL2 = exp( -pow( ( vSurfUV.x - 0.35 ) * 14.0, 2.0 ) );
          float wR1 = exp( -pow( ( vSurfUV.x - 0.65 ) * 14.0, 2.0 ) );
          float wR2 = exp( -pow( ( vSurfUV.x - 0.77 ) * 14.0, 2.0 ) );
          float wheelTrack = clamp( wL1 + wL2 + wR1 + wR2, 0.0, 1.0 );
          float microSheen = smoothstep( 0.60, 0.86, relNoise2D( vRestWorldPos.xz * 0.065 ) );
          roughnessFactor = mix( roughnessFactor, 0.28, uRoadPolish * clamp( 0.68 * wheelTrack + 0.45 * microSheen, 0.0, 0.85 ) );
        }
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          // Add 3D Parallax Interior Room radiance behind architectural window glass!
          if ( uInteriorRoom > 0.5 ) {
            float glassMask = 0.0;
            vec3 roomCol = sampleParallaxInterior( vRestWorldPos, vRestWorldNormal, vSurfUV, uInteriorRoom, glassMask );
            if ( glassMask > 0.02 ) {
              vec3 vDir = normalize( uObsPos - vRestWorldPos );
              float fresnel = 0.08 + 0.88 * pow( 1.0 - clamp( abs( dot( vDir, normalize( vRestWorldNormal ) ) ), 0.0, 1.0 ), 4.2 );
              vec3 extRefl = max( vec3( 0.0 ), outgoingLight - totalEmissiveRadiance );
              outgoingLight = mix( outgoingLight, extRefl * ( 0.45 + 1.15 * fresnel ) + roomCol * ( 1.0 - 0.55 * fresnel ), glassMask * 0.88 );
              totalEmissiveRadiance = mix( totalEmissiveRadiance, roomCol * ( 1.0 - 0.55 * fresnel ), glassMask * 0.88 );
            }
          }

          float fragDoppler = vRelDoppler;
          float fragEmitTime = vRelEmitCoordTime;
          float dPx = max( length( vCityEmitOffset ), 1e-5 );
          if ( uIsCoMoving < 0.5 ) {
            vec3 photonDirPx = -vCityEmitOffset / dPx;
            float numDPx = uObsGamma * ( 1.0 - dot( uObsBeta, photonDirPx ) );
            float denDPx = ( uIsDynamic > 0.5 ) ? ( uEntityGamma * ( 1.0 - dot( uEntityBeta, photonDirPx ) ) ) : 1.0;
            float grDPx = evalFragGravDoppler( uObsPos + vCityEmitOffset );
            fragDoppler = clamp( ( numDPx / max( denDPx, 1e-4 ) ) * grDPx * evalFragRindler( vObsLocalPos ), 0.02, 60.0 );
            if ( uIsDynamic < 0.5 ) {
              fragEmitTime = uObsTime - ( uEnableRetardation * dPx ) / uSpeedOfLight;
            }
          }

          vec3 relReflected = max( vec3( 0.0 ), outgoingLight - totalEmissiveRadiance );
          vec3 relEmissive = max( vec3( 0.0 ), totalEmissiveRadiance );
          if ( uPulseHz > 1e-4 ) {
            float wave = 0.5 + 0.5 * cos( 6.2831853 * uPulseHz * fragEmitTime );
            relEmissive *= ( 0.18 + 2.4 * pow( wave, 6.0 ) );
          }
          vec3 shiftedRefl = applyRelativisticSpectrumCustom(
            relReflected,
            fragDoppler,
            uSpectralUV,
            uSpectralNIR,
            0.0,
            0.46
          );
          vec3 shiftedEmis = vec3( 0.0 );
          if ( dot( relEmissive, relEmissive ) > 1e-8 ) {
            shiftedEmis = applyRelativisticSpectrumCustom(
              relEmissive,
              fragDoppler,
              0.55,
              0.65,
              uNarrowBandNm,
              1.95
            );
          }
          vec3 finalRad = shiftedRefl + shiftedEmis;

          // Relativistic Aerial Perspective (Atmospheric Distance Scattering matching shifted sky!)
          if ( uIsCoMoving < 0.5 && diffuseColor.a > 0.98 && dPx > 38.0 ) {
            float heightFalloff = exp( -max( 0.0, vRestWorldPos.y ) * 0.020 );
            float fogAmt = clamp( ( 1.0 - exp( -max( 0.0, dPx - 38.0 ) * 0.0022 ) ) * heightFalloff, 0.0, 0.62 );
            vec3 restHaze = uSkyHorizon * mix( 0.88, 0.25, uNightFactor );
            vec3 shiftedHaze = applyRelativisticHazeSpectrum( restHaze, fragDoppler );
            finalRad = mix( finalRad, shiftedHaze, fogAmt );
          }

          outgoingLight = finalRad;
        }
        #include <opaque_fragment>
        `
      );
    };

    material.userData = material.userData || {};
    material.userData.isRelativisticPatched = true;
    material.needsUpdate = true;
    return material;
  }

  /**
   * Clones and patches all materials inside a loaded `.glb` Object3D hierarchy
   * so the instance gets its own per-entity relativistic uniforms while sharing
   * compiled GPU shader programs across instances, and disables Euclidean frustum culling.
   */
  patchHierarchy(root, entityUniforms, {
    castShadow = true,
    receiveShadow = true,
    materialOverrideFn = null,
    forceStandardOnMobile = false,
  } = {}) {
    const clonedMap = new Map();
    root.traverse((obj) => {
      obj.frustumCulled = false;
      if (!obj.isMesh) return;
      obj.castShadow = castShadow;
      obj.receiveShadow = receiveShadow;
      if (obj.geometry && obj.geometry.attributes && obj.geometry.attributes.tangent) {
        obj.geometry.deleteAttribute('tangent');
      }

      const processMat = (origMat) => {
        if (!origMat) return origMat;
        if (clonedMap.has(origMat)) return clonedMap.get(origMat);
        let m = origMat.clone();
        if (m.transmission && m.transmission > 0) {
          m.transmission = 0;
          m.transparent = true;
          m.opacity = 0.42;
        }
        let matOpts = {};
        if (materialOverrideFn) {
          const res = materialOverrideFn(m, obj);
          if (res && res.material) m = res.material;
          if (res && res.matOpts) matOpts = res.matOpts;
        }
        // Convert remaining MeshPhysicalMaterials (e.g. GLB iridescence/clearcoat) to lean MeshStandardMaterial on mobile!
        if (forceStandardOnMobile && m.isMeshPhysicalMaterial) {
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
        this.patchMaterial(m, entityUniforms, matOpts);
        clonedMap.set(origMat, m);
        return m;
      };

      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(processMat);
      } else if (obj.material) {
        obj.material = processMat(obj.material);
      }
    });
    return root;
  }

  /**
   * Creates the physical Rayleigh/Mie + Sunset/Starfield Sky ShaderMaterial.
   * When `isEnvCapture` is true, renders rest-frame sky + ground bounce into `PMREMGenerator`
   * for cubemap clearcoat reflections; when false, applies relativistic aberration & Starbow!
   */
  createSkyMaterial(isEnvCapture = false) {
    const metricGLSL = this.metric.getShaderModule();
    const spectralGLSL = getSpectralGLSL();

    const uniforms = {};
    Object.assign(uniforms, this.sharedUniforms);
    uniforms.uIsEnvCapture = { value: isEnvCapture ? 1.0 : 0.0 };

    return new THREE.ShaderMaterial({
      name: isEnvCapture ? 'EnvCaptureSky' : 'RelativisticSkyDome',
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: !isEnvCapture,
      depthFunc: THREE.LessEqualDepth,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vLocalDir;
        uniform float uIsEnvCapture;
        void main() {
          vLocalDir = position;
          vec4 clipPos = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
          gl_Position = ( uIsEnvCapture > 0.5 ) ? clipPos : clipPos.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vLocalDir;
        uniform float uIsEnvCapture;
        uniform vec3 uSunDir;
        uniform vec3 uSunRadiance;
        uniform vec3 uSkyZenith;
        uniform vec3 uSkyHorizon;
        uniform float uNightFactor;
        uniform float uCloudDrift;

        ${metricGLSL}
        ${spectralGLSL}

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float valueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash12(i);
          float b = hash12(i + vec2(1.0, 0.0));
          float c = hash12(i + vec2(0.0, 1.0));
          float d = hash12(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbmClouds(vec2 uv) {
          float s = 0.0;
          float amp = 0.52;
          for (int i = 0; i < 4; i++) {
            s += amp * valueNoise(uv);
            uv = uv * 2.07 + vec2(13.1, 7.7);
            amp *= 0.48;
          }
          return s;
        }

        void main() {
          vec3 rayObs = normalize(vLocalDir);
          float skyD = 1.0;
          vec3 nCity = (uIsEnvCapture > 0.5)
            ? rayObs
            : mapObserverRayToSky(rayObs, skyD);

          float sunElev = uSunDir.y;
          float up = clamp(nCity.y, 0.0, 1.0);
          float horizonBand = pow(1.0 - up, 3.6);

          // Base Rayleigh sky gradient
          vec3 skyCol = mix(uSkyZenith, uSkyHorizon, pow(1.0 - up, 2.2));

          // Golden / Crimson Sunset & Sunrise azimuth glow near solar horizon
          float sunsetWeight = smoothstep(0.36, -0.06, abs(sunElev - 0.05));
          float sunCos = dot(nCity, normalize(uSunDir));
          float mieHalo = pow(max(0.0, sunCos), 7.0) * (0.35 + 0.65 * horizonBand);
          vec3 sunsetGlow = vec3(1.15, 0.36, 0.10) * sunsetWeight * horizonBand * (0.45 + 0.95 * max(0.0, sunCos));
          skyCol += sunsetGlow + uSunRadiance * 0.032 * mieHalo;

          // Multi-layered self-shadowed Cumulus + Cirrus Cloud Deck with solar silver-lining!
          float cloudAlpha = 0.0;
          if (nCity.y > 0.015) {
            vec2 cloudUV = (nCity.xz / (nCity.y + 0.14)) * 0.66 + vec2(uCloudDrift, uCloudDrift * 0.35);
            float nBase = fbmClouds(cloudUV);
            // Sample slightly toward sun direction for self-shadowed 3D cumulus volume!
            float nSun = fbmClouds(cloudUV + normalize(uSunDir.xz + vec2(1e-4)) * 0.14);
            float thickness = clamp(nBase - 0.44, 0.0, 0.56) / 0.56;
            float selfLit = clamp(0.58 + 1.35 * (nBase - nSun), 0.18, 1.15);

            cloudAlpha = smoothstep(0.46, 0.78, nBase) * smoothstep(0.015, 0.16, nCity.y);
            float silverLining = pow(max(0.0, sunCos), 12.0) * (1.0 - thickness * 0.55) * 1.45;
            vec3 shadowTint = uSkyZenith * 0.55 + uSkyHorizon * 0.42;
            vec3 brightTop = uSunRadiance * 0.19 + vec3(0.58, 0.60, 0.64);
            vec3 cloudLit = mix(shadowTint, brightTop, selfLit * (0.45 + 0.55 * max(0.0, sunElev + 0.25)));
            cloudLit += uSunRadiance * 0.14 * silverLining;

            if (uNightFactor > 0.25) {
              cloudLit = mix(cloudLit, vec3(0.028, 0.042, 0.070), uNightFactor * 0.88);
            }
            skyCol = mix(skyCol, cloudLit, cloudAlpha * 0.86);

            // High-altitude wispy cirrus layer
            vec2 cirrusUV = (nCity.xz / (nCity.y + 0.28)) * vec2(1.4, 0.45) - vec2(uCloudDrift * 0.4, 0.0);
            float cirrus = smoothstep(0.62, 0.88, fbmClouds(cirrusUV * 1.8)) * smoothstep(0.08, 0.35, nCity.y) * (1.0 - cloudAlpha);
            skyCol = mix(skyCol, brightTop * (1.0 - 0.82 * uNightFactor), cirrus * 0.28);
          }

          // Distant atmospheric mountain & skyline silhouette along horizon (grounds world edge!)
          if (nCity.y > -0.02 && nCity.y < 0.058) {
            float az = atan(nCity.z, nCity.x);
            float ridge = 0.014 + 0.016 * valueNoise(vec2(az * 5.5, 2.3)) + 0.008 * valueNoise(vec2(az * 16.0, 9.1));
            float silMask = smoothstep(ridge + 0.004, ridge - 0.002, nCity.y) * smoothstep(-0.02, 0.002, nCity.y);
            vec3 silCol = mix(uSkyHorizon * 0.64, vec3(0.018, 0.026, 0.044), 0.35 + 0.55 * uNightFactor);
            skyCol = mix(skyCol, silCol, silMask * 0.72);
          }

          // Crisp solar disc above horizon
          if (sunElev > -0.05 && nCity.y > -0.02) {
            float sunDisc = smoothstep(0.99935, 0.99982, sunCos);
            float sunCorona = pow(max(0.0, sunCos), 180.0) * 0.45;
            skyCol += uSunRadiance * (sunDisc * 2.4 + sunCorona) * (1.0 - cloudAlpha * 0.78);
          }

          // Pinpoint Starfield at Night (strictly dusk-gated and occluded behind clouds!)
          float starVis = smoothstep(0.35, 0.85, uNightFactor) * smoothstep(0.04, 0.25, nCity.y) * (1.0 - cloudAlpha);
          if (starVis > 0.005 && uIsEnvCapture < 0.5) {
            vec2 starSphere = vec2(atan(nCity.z, nCity.x), asin(clamp(nCity.y, -1.0, 1.0))) * 78.0;
            vec2 cell = floor(starSphere);
            vec2 gv = fract(starSphere) - 0.5;
            float rnd = hash12(cell);
            if (rnd > 0.968) {
              vec2 jitter = (vec2(hash12(cell + 9.1), hash12(cell + 27.3)) - 0.5) * 0.55;
              float dStar = length(gv - jitter);
              float pinpoint = exp(-dStar * dStar * 95.0);
              vec3 starTint = mix(vec3(0.75, 0.86, 1.0), vec3(1.0, 0.88, 0.72), hash12(cell + 4.4));
              skyCol += starTint * pinpoint * starVis * (1.4 + 2.2 * hash12(cell + 17.0));
            }
          }

          // Lower hemisphere bounce (important for realistic car clearcoat door/fender reflections!)
          if (nCity.y < 0.0) {
            float down = clamp(-nCity.y, 0.0, 1.0);
            vec3 asphaltBounce = mix(uSkyHorizon * 0.42, vec3(0.045, 0.05, 0.06) * (1.2 - 0.8 * uNightFactor), smoothstep(0.0, 0.35, down));
            skyCol = mix(skyCol, asphaltBounce, smoothstep(-0.02, 0.09, down));
          }

          if (uIsEnvCapture < 0.5) {
            skyCol = applyRelativisticSpectrumCustom(skyCol, skyD, 0.90, 0.96, 0.0, 0.42);
          }

          gl_FragColor = vec4(max(vec3(0.0), skyCol), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
  }
}
