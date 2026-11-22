/**
 * Modular WebGL2 GLSL Shader Library
 * ==================================
 *
 * Includes:
 *   1. City Shadow-Map pass (Sun by day, Moon by night)
 *   2. Physically-Based Cook-Torrance GGX + Roughness-Attenuated Fresnel (zero plastic shine!)
 *      + Retarded Headlights/Shadows + Pulsing Relativistic Beacons + Dusk/Night Lighting
 *   3. Dynamic Day / Sunrise / Sunset / Starry Night Relativistic Sky Dome ("Starbow")
 *   4. High-Threshold Dual-Kawase HDR Bloom + Eye-Adapted ACES Filmic Tonemapping
 */

import { getSpectralGLSL } from '../physics/spectral.js?v=2.0';

export const SHADOW_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
uniform mat4 uLightViewProj;

void main() {
  gl_Position = uLightViewProj * vec4(aPos, 1.0);
}
`;

export const SHADOW_FRAG = /* glsl */ `#version 300 es
precision highp float;
void main() {
}
`;

export function createWorldVertexShader(metricShaderModule) {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aTangent;
layout(location = 3) in vec2 aUV;
layout(location = 4) in vec4 aColorAO;

uniform mat4 uProj;
uniform mat4 uObserverView;

// Entity worldline uniforms
uniform bool uIsDynamic;
uniform vec3 uEntityPosNow;
uniform vec3 uEntityRestOffset;
uniform mat3 uEntityRot;
uniform vec3 uEntityBeta;
uniform float uEntityGamma;
uniform float uEntityProperTimeNow;
uniform vec3 uSpinPivot;
uniform vec3 uSpinAxis;
uniform float uSpinOmega;
uniform float uSwingAmp;
uniform vec3 uEntityTint;

${metricShaderModule}

out vec3 vCityEmitPos;
out vec3 vCityEmitOffset;
out vec3 vRestViewDir;
out vec3 vWorldNormal;
out vec4 vWorldTangent;
out vec2 vUV;
out vec4 vColorAO;
out float vEmitCoordTime;
out float vEmitProperTime;

void main() {
  vec3 worldNrm;
  RelativisticObservation obs = projectPastLightCone(
    aPos,
    aNormal,
    uIsDynamic,
    uEntityPosNow,
    uEntityRestOffset,
    uEntityRot,
    uEntityBeta,
    uEntityGamma,
    uEntityProperTimeNow,
    uSpinPivot,
    uSpinAxis,
    uSpinOmega,
    uSwingAmp,
    worldNrm
  );

  vec3 worldTan = uIsDynamic ? normalize(uEntityRot * aTangent.xyz) : aTangent.xyz;

  vCityEmitPos = obs.cityEmitPos;
  vCityEmitOffset = obs.cityEmitOffset;
  vRestViewDir = obs.restViewDir;
  vWorldNormal = worldNrm;
  vWorldTangent = vec4(worldTan, aTangent.w);
  vUV = aUV;
  vColorAO = vec4(aColorAO.rgb * uEntityTint, aColorAO.a);
  vEmitCoordTime = obs.emitCoordTime;
  vEmitProperTime = obs.emitProperTime;

  vec4 viewPos = uObserverView * vec4(obs.observerLocalPos, 1.0);
  gl_Position = uProj * viewPos;
}
`;
}

export function createWorldFragmentShader() {
  const spectralGLSL = getSpectralGLSL();
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;

in vec3 vCityEmitPos;
in vec3 vCityEmitOffset;
in vec3 vRestViewDir;
in vec3 vWorldNormal;
in vec4 vWorldTangent;
in vec2 vUV;
in vec4 vColorAO;
in float vEmitCoordTime;
in float vEmitProperTime;

uniform sampler2D uAlbedoMap;
uniform sampler2D uNormalMap;
uniform sampler2D uPbrMap;
uniform sampler2DShadow uShadowMap;

uniform mat4 uLightViewProj;
uniform vec3 uKeyLightDir;      // Unit vector toward active shadow caster (Sun by day, Moon at night)
uniform vec3 uKeyLightRadiance; // Solar or Lunar linear RGB irradiance
uniform vec3 uSkyZenithAmb;     // Time-of-day sky hemisphere top ambient
uniform vec3 uSkyGroundAmb;     // Time-of-day ground bounce ambient
uniform vec3 uHazeColor;        // Time-of-day horizon atmospheric haze
uniform float uNightFactor;     // 0.0 midday -> 1.0 night (boosts streetlamps, headlights & warm windows)

// Observer & Entity velocity uniforms for per-pixel Doppler precision
uniform vec3 uObsBeta;
uniform float uObsGamma;
uniform float uObsTime;
uniform bool uIsDynamic;
uniform vec3 uEntityBeta;
uniform float uEntityGamma;
uniform float uPulseFreqHz;     // >0 for retarded proper-time pulsing beacons!

// Material spectral tail properties
uniform float uMatUV;
uniform float uMatNIR;
uniform float uMatNarrowNm;

// Nearest streetlamp point lights [x, y, z, intensity]
uniform int uNumStreetLights;
uniform vec4 uStreetLights[14];

// Moving vehicles for causal retarded headlights, taillights & under-car contact shadows
uniform int uNumVehicles;
uniform vec4 uVehiclePosYaw[16];
uniform vec4 uVehicleVelMeta[16];

uniform float uInlineTonemap;

${spectralGLSL}

const float PI = 3.14159265359;

vec3 srgbToLinear(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.2));
}

float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * denom * denom, 1e-5);
}

float geometrySchlickGGX(float NdotV, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotV / max(NdotV * (1.0 - k) + k, 1e-5);
}

float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  return geometrySchlickGGX(max(dot(N, V), 0.0), roughness)
       * geometrySchlickGGX(max(dot(N, L), 0.0), roughness);
}

// Roughness-attenuated Schlick Fresnel (Lagarde): prevents rough matte surfaces
// (roads, bricks, cloth, skin) from glaring with specular shine at grazing angles!
vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
  return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

float sampleCityShadow(vec3 worldPos, vec3 N, int shadowRes) {
  vec3 biasedPos = worldPos + N * 0.14;
  vec4 ls = uLightViewProj * vec4(biasedPos, 1.0);
  vec3 proj = ls.xyz / ls.w;
  proj = proj * 0.5 + 0.5;
  if (proj.x <= 0.01 || proj.x >= 0.99 || proj.y <= 0.01 || proj.y >= 0.99 || proj.z >= 0.995) {
    return 1.0;
  }

  const vec2 poisson[9] = vec2[](
    vec2( 0.00,  0.00),
    vec2(-0.70, -0.45),
    vec2( 0.65, -0.52),
    vec2(-0.42,  0.74),
    vec2( 0.78,  0.48),
    vec2(-0.92,  0.12),
    vec2( 0.14, -0.94),
    vec2( 0.18,  0.90),
    vec2(-0.22, -0.28)
  );

  float texel = 1.35 / float(shadowRes);
  float bias = 0.0006;
  float sum = 0.0;
  for (int i = 0; i < 9; i++) {
    sum += texture(uShadowMap, vec3(proj.xy + poisson[i] * texel, proj.z - bias));
  }
  return sum / 9.0;
}

out vec4 fragColor;

void main() {
  vec4 texSample = texture(uAlbedoMap, vUV);
  vec3 albedo = srgbToLinear(texSample.rgb) * vColorAO.rgb;

  vec4 pbrSample = texture(uPbrMap, vUV);
  float roughness = clamp(pbrSample.r, 0.06, 0.99);
  float metallic = pbrSample.g;
  float ao = pbrSample.b * vColorAO.a;
  float emissiveMask = pbrSample.a;

  // Tangent-space normal mapping
  vec3 nMap = texture(uNormalMap, vUV).xyz * 2.0 - 1.0;
  vec3 N0 = normalize(vWorldNormal);
  vec3 T0 = normalize(vWorldTangent.xyz - N0 * dot(N0, vWorldTangent.xyz));
  vec3 B0 = cross(N0, T0) * vWorldTangent.w;
  vec3 N = normalize(T0 * nMap.x + B0 * nMap.y + N0 * nMap.z);

  vec3 V = normalize(vRestViewDir);
  float NdotV = max(dot(N, V), 1e-4);
  vec3 F0 = mix(vec3(0.035), albedo, metallic);

  // 1. Direct Sunlight / Moonlight + Soft PCF Shadow
  vec3 Lkey = normalize(uKeyLightDir);
  float NdotL = max(dot(N, Lkey), 0.0);
  float shadow = NdotL > 0.0 ? sampleCityShadow(vCityEmitPos, N0, 3072) : 0.0;

  // Causal Retarded Under-Car Contact Shadow & Moving Headlight/Taillight Illumination!
  float carContactAO = 1.0;
  vec3 vehicleLightContrib = vec3(0.0);
  float headlightScale = 0.65 + 1.55 * uNightFactor;

  float distEmitSq = dot(vCityEmitOffset, vCityEmitOffset);
  if (!uIsDynamic && vCityEmitPos.y < 3.4 && distEmitSq < 9000.0) {
    float dtRetard = vEmitCoordTime - uObsTime;
    for (int i = 0; i < 16; i++) {
      if (i >= uNumVehicles) break;
      vec4 py = uVehiclePosYaw[i];
      vec4 vm = uVehicleVelMeta[i];
      vec2 carXZ = py.xy + vm.xy * dtRetard;
      vec2 rel = vCityEmitPos.xz - carXZ;
      if (abs(rel.x) > 30.0 || abs(rel.y) > 30.0) continue;

      float cosY = py.z, sinY = py.w;
      float localRight = rel.x * cosY + rel.y * sinY;
      float localFwd   = rel.x * sinY - rel.y * cosY;

      float halfL = vm.z;
      float halfW = vm.w;

      if (vCityEmitPos.y < 0.25) {
        vec2 boxDist = abs(vec2(localRight, localFwd)) - vec2(halfW, halfL);
        float dOut = length(max(boxDist, vec2(0.0))) + min(max(boxDist.x, boxDist.y), 0.0);
        float underMask = 1.0 - smoothstep(-0.15, 0.55, dOut);
        carContactAO *= (1.0 - 0.80 * underMask);
      }

      if (localFwd > halfL - 0.2 && localFwd < 26.0) {
        float fwdDist = localFwd - halfL + 0.4;
        float coneSpread = 0.55 + fwdDist * 0.25;
        float latFalloff = exp(-(localRight * localRight) / (coneSpread * coneSpread));
        float distAtten = 1.0 / (1.0 + 0.065 * fwdDist * fwdDist);
        vec3 hLightDir = normalize(vec3(-rel.x, 0.65 - vCityEmitPos.y, -rel.y));
        float hNdotL = max(dot(N, hLightDir), 0.20);
        vehicleLightContrib += vec3(1.65, 1.55, 1.35) * (headlightScale * latFalloff * distAtten * hNdotL);
      } else if (localFwd < -halfL + 0.2 && localFwd > -8.5) {
        float backDist = -localFwd - halfL + 0.3;
        float spread = 0.7 + backDist * 0.35;
        float latFall = exp(-(localRight * localRight) / (spread * spread));
        float atten = 1.0 / (1.0 + 0.30 * backDist * backDist);
        vehicleLightContrib += vec3(0.85, 0.05, 0.03) * (headlightScale * latFall * atten);
      }
    }
  }

  shadow *= carContactAO;
  ao *= carContactAO;

  vec3 hSum = V + Lkey;
  vec3 Hkey = dot(hSum, hSum) > 1e-6 ? normalize(hSum) : N;
  float D_ggx = distributionGGX(N, Hkey, roughness);
  float G_ggx = geometrySmith(N, V, Lkey, roughness);
  vec3 F_ggx = fresnelSchlickRoughness(max(dot(Hkey, V), 0.0), F0, roughness);

  vec3 kD_sun = (vec3(1.0) - F_ggx) * (1.0 - metallic);
  float roughSpecFade = (1.0 - roughness * 0.65);
  vec3 specKey = NdotL > 0.0
    ? ((D_ggx * G_ggx * F_ggx) / max(4.0 * NdotV * NdotL, 1e-4)) * roughSpecFade
    : vec3(0.0);
  vec3 directLight = (kD_sun * albedo / PI + specKey) * uKeyLightRadiance * NdotL * shadow;

  // 2. Time-of-Day Hemisphere Diffuse GI + Roughness-Squared Environment Specular
  vec3 F_env = fresnelSchlickRoughness(NdotV, F0, roughness);
  vec3 kD_amb = (vec3(1.0) - F_env) * (1.0 - metallic);
  float skyUp = N.y * 0.5 + 0.5;
  vec3 skyIrradiance = mix(uSkyGroundAmb, uSkyZenithAmb, skyUp);
  vec3 ambientDiff = kD_amb * albedo * skyIrradiance * ao;

  vec3 R = reflect(-V, N);
  float smoothness = 1.0 - roughness;
  float envSpecWeight = smoothness * smoothness;
  vec3 envColor = mix(uSkyGroundAmb * 0.85, uSkyZenithAmb * 1.45, clamp(R.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 ambientSpec = envColor * F_env * envSpecWeight * ao;

  // 3. Warm Streetlamp Point Lights (subtle by day, warm glowing pools at sunset/night!)
  vec3 lampContrib = vec3(0.0);
  float lampDayNightScale = 0.25 + 1.55 * uNightFactor;
  for (int i = 0; i < 14; i++) {
    if (i >= uNumStreetLights) break;
    vec3 lVec = uStreetLights[i].xyz - vCityEmitPos;
    float d2 = dot(lVec, lVec);
    if (d2 > 520.0) continue;
    float invD = inversesqrt(max(d2, 0.3));
    vec3 L = lVec * invD;
    float atten = (uStreetLights[i].w * lampDayNightScale) / (1.0 + 0.095 * d2 + 0.0032 * d2 * d2);
    float nl = max(dot(N, L), 0.0);
    if (nl > 0.0) {
      vec3 hlSum = V + L;
      vec3 H = dot(hlSum, hlSum) > 1e-6 ? normalize(hlSum) : N;
      float spec = pow(max(dot(N, H), 0.0), mix(96.0, 4.0, roughness)) * envSpecWeight;
      lampContrib += (kD_amb * albedo / PI + F0 * spec * 1.8) * vec3(1.65, 1.12, 0.52) * (nl * atten);
    }
  }

  // 4. Emissive Surfaces (windows & streetlamps brighten automatically at dusk/night;
  //    beacons modulate at exact retarded proper time vEmitProperTime!)
  float pulseMod = 1.0;
  if (uPulseFreqHz > 0.01) {
    float wave = 0.5 + 0.5 * sin(6.2831853 * uPulseFreqHz * vEmitProperTime);
    pulseMod = 0.12 + 2.4 * wave * wave * wave;
  }
  float emStrength = (1.35 + 1.85 * uNightFactor) * pulseMod;
  vec3 emissive = albedo * (emissiveMask * emStrength);

  vec3 restReflected = directLight + ambientDiff + ambientSpec + lampContrib + vehicleLightContrib * albedo;

  // Subtle distance haze on reflected surfaces
  float distEmit = length(vCityEmitOffset);
  float fogFactor = 1.0 - exp(-0.0000028 * distEmit * distEmit);
  restReflected = mix(restReflected, uHazeColor, clamp(fogFactor, 0.0, 0.35));

  // 5. Per-Pixel Relativistic Doppler Factor D & Spectral Shift
  //    Separate reflected surfaces (tone-preserving beaming so moving cars retain crisp
  //    3D shading & windows) from self-luminous sources (full D^3.3 headlight beaming!)
  vec3 photonDirCity = -vCityEmitOffset / max(distEmit, 1e-5);
  float numD = uObsGamma * (1.0 - dot(uObsBeta, photonDirCity));
  float denD = uIsDynamic ? (uEntityGamma * (1.0 - dot(uEntityBeta, photonDirCity))) : 1.0;
  float D = clamp(numD / max(denD, 1e-4), 0.03, 35.0);

  float uvW = uMatUV * (0.4 + 0.6 * albedo.b);
  float nirW = uMatNIR * (0.35 + 0.65 * max(albedo.r, albedo.g));
  float reflBeamExp = uIsDynamic ? (uBeamingExponent * 0.36) : (uBeamingExponent * 0.85);

  vec3 observedHDR = applyRelativisticSpectrumCustom(
    restReflected,
    D,
    uvW,
    nirW,
    0.0,
    reflBeamExp
  );
  if (emissiveMask > 0.002) {
    observedHDR += applyRelativisticSpectrumCustom(
      emissive,
      D,
      uvW * 0.3,
      nirW * 0.5,
      uMatNarrowNm,
      uBeamingExponent
    );
  }

  if (uInlineTonemap > 0.5) {
    vec3 x = observedHDR * 0.85;
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    fragColor = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
  } else {
    fragColor = vec4(min(observedHDR, vec3(120.0)), 1.0);
  }
}
`;
}

export function createSkyShaders(metricShaderModule) {
  const spectralGLSL = getSpectralGLSL();

  const vert = /* glsl */ `#version 300 es
precision highp float;

out vec2 vNDC;

void main() {
  vec2 pos[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0)
  );
  vNDC = pos[gl_VertexID];
  gl_Position = vec4(vNDC, 1.0, 1.0);
}
`;

  const frag = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec2 vNDC;

uniform mat3 uCamToObsRot;
uniform vec2 uTanHalfFov;
uniform vec3 uSunDir;      // True solar vector (may be below horizon at sunset/night!)
uniform vec3 uMoonDir;     // Lunar vector opposite Sun
uniform float uInlineTonemap;

${metricShaderModule}
${spectralGLSL}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float cloudFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * valueNoise(p);
    p = p * 2.03 + vec2(13.7, 7.1);
    a *= 0.5;
  }
  return s;
}

// Isotropic 3D pinpoint astronomical starfield on S^2 (forms true Relativistic Starbow at night!)
vec3 evalStarfield(vec3 dir, float visibility) {
  if (visibility <= 0.002 || dir.y < 0.0) return vec3(0.0);
  float scale = 185.0;
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  vec3 rnd = hash33(cell);
  if (rnd.z < 0.86) return vec3(0.0);

  vec3 starCenter = normalize(cell + 0.22 + 0.56 * rnd);
  float angDist = length(dir - starCenter) * scale;
  float spot = exp(-angDist * angDist * 145.0);

  // Stellar Planck color tint (blue-white O/B, white A, gold G, orange-red K/M)
  vec3 starTint = mix(vec3(1.0, 0.72, 0.48), vec3(0.68, 0.82, 1.0), rnd.x);
  float mag = (0.35 + 1.55 * pow(rnd.y, 4.0)) * smoothstep(0.0, 0.16, dir.y);
  return starTint * (spot * mag * visibility);
}

out vec4 fragColor;

void main() {
  vec3 rayCam = normalize(vec3(vNDC.x * uTanHalfFov.x, vNDC.y * uTanHalfFov.y, -1.0));
  vec3 rayObs = uCamToObsRot * rayCam;

  float skyDoppler;
  vec3 nCity = mapObserverRayToSky(rayObs, skyDoppler);

  vec3 sunDir = normalize(uSunDir);
  vec3 moonDir = normalize(uMoonDir);
  float sunElev = sunDir.y;
  float muSun = dot(nCity, sunDir);
  float muMoon = dot(nCity, moonDir);
  float elev = nCity.y;

  // Smooth Day / Golden-Hour Sunset / Twilight / Night blending weights
  float dayAmt = smoothstep(-0.04, 0.24, sunElev);
  float twilightAmt = smoothstep(-0.22, 0.02, sunElev) * (1.0 - smoothstep(0.02, 0.28, sunElev));
  float nightAmt = 1.0 - smoothstep(-0.18, 0.05, sunElev);

  vec3 zenithDay = vec3(0.055, 0.19, 0.66);
  vec3 horizDay  = vec3(0.34, 0.54, 0.84);

  vec3 zenithSunset = vec3(0.045, 0.075, 0.26);
  vec3 horizSunset  = mix(vec3(0.18, 0.16, 0.34), vec3(1.35, 0.44, 0.12), pow(max(muSun * 0.5 + 0.5, 0.0), 2.4));

  vec3 zenithNight = vec3(0.007, 0.012, 0.032);
  vec3 horizNight  = vec3(0.022, 0.034, 0.072);

  vec3 zenithCol = zenithNight * nightAmt + zenithSunset * twilightAmt + zenithDay * dayAmt;
  vec3 horizonCol = horizNight * nightAmt + horizSunset * twilightAmt + horizDay * dayAmt;

  float zenithT = clamp(elev, 0.0, 1.0);
  vec3 groundBelow = mix(vec3(0.02, 0.025, 0.035), vec3(0.14, 0.16, 0.19), dayAmt);
  vec3 sky = elev >= 0.0
    ? mix(horizonCol, zenithCol, pow(zenithT, 0.52))
    : mix(horizonCol * 0.6, groundBelow, clamp(-elev * 6.0, 0.0, 1.0));

  // Solar Mie aureole + Sunset fiery glow + Crisp Solar Disk
  float sunVis = smoothstep(-0.12, 0.06, sunElev);
  if (sunVis > 0.001) {
    vec3 mieCol = mix(vec3(1.85, 0.52, 0.14), vec3(1.0, 0.84, 0.60), dayAmt);
    float mie = pow(max(muSun, 0.0), 6.0) * (0.35 + 0.55 * twilightAmt) + pow(max(muSun, 0.0), 64.0) * 0.95;
    sky += mieCol * mie * sunVis * smoothstep(-0.08, 0.10, elev);

    float sunDisk = smoothstep(0.99935, 0.99975, muSun) * step(-0.01, elev);
    vec3 diskCol = mix(vec3(16.0, 5.2, 1.4), vec3(18.0, 15.5, 11.5), dayAmt);
    sky += diskCol * sunDisk * sunVis;
  }

  // Nighttime Starfield + Crisp Silver Moon Disk (occluded behind clouds, only after nautical dusk!)
  float cloudMask = 0.0;
  vec3 cloudCol = vec3(0.0);
  if (elev > 0.025) {
    vec2 cloudUV = nCity.xz / (elev + 0.18) * 1.15 + vec2(uObsTime * 0.0035, 0.0);
    float cVal = cloudFbm(cloudUV);
    cloudMask = smoothstep(0.52, 0.80, cVal) * smoothstep(0.025, 0.16, elev);
    float cloudLit = 0.55 + 0.45 * valueNoise(cloudUV * 2.5 + sunDir.xz * 0.6);

    vec3 dayCloud    = mix(vec3(0.52, 0.58, 0.68), vec3(1.08, 1.06, 1.02), cloudLit);
    vec3 sunsetCloud = mix(vec3(0.18, 0.13, 0.25), vec3(1.42, 0.48, 0.16), cloudLit);
    vec3 nightCloud  = mix(vec3(0.012, 0.018, 0.036), vec3(0.042, 0.056, 0.095), cloudLit);

    cloudCol = nightCloud * nightAmt + sunsetCloud * twilightAmt + dayCloud * dayAmt;
  }

  float starVis = (1.0 - smoothstep(-0.24, -0.04, sunElev)) * (1.0 - cloudMask * 0.96);
  sky += evalStarfield(nCity, starVis);
  if (moonDir.y > -0.05 && starVis > 0.02) {
    float moonGlow = pow(max(muMoon, 0.0), 48.0) * 0.18;
    float moonDisk = smoothstep(0.99945, 0.99978, muMoon) * step(0.0, elev);
    sky += vec3(0.45, 0.56, 0.78) * moonGlow * starVis;
    sky += vec3(4.5, 4.8, 5.4) * moonDisk * starVis;
  }

  if (cloudMask > 0.001) {
    sky = mix(sky, cloudCol, cloudMask * 0.84);
  }

  float uvTail = 0.95 * dayAmt + 0.35 * nightAmt;
  float nirTail = 0.75 + 0.85 * twilightAmt;
  vec3 hdrSky = applyRelativisticSpectrum(sky, skyDoppler, uvTail, nirTail, 0.0);

  if (uInlineTonemap > 0.5) {
    vec3 x = hdrSky * 0.85;
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    fragColor = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
  } else {
    fragColor = vec4(min(hdrSky, vec3(120.0)), 1.0);
  }
}
`;

  return { vert, frag };
}

export const POST_QUAD_VERT = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 pos[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0)
  );
  vec2 p = pos[gl_VertexID];
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const BLOOM_PREFILTER_DOWNSAMPLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrcTex;
uniform vec2 uTexelSize;
uniform bool uIsFirstPass;
uniform float uThreshold;
out vec4 fragColor;

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float knee = 0.35;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = (soft * soft) / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * max(0.0, contrib);
}

void main() {
  vec2 d = uTexelSize;
  vec3 c0 = texture(uSrcTex, vUV).rgb;
  vec3 c1 = texture(uSrcTex, vUV + vec2(-d.x, -d.y)).rgb;
  vec3 c2 = texture(uSrcTex, vUV + vec2( d.x, -d.y)).rgb;
  vec3 c3 = texture(uSrcTex, vUV + vec2(-d.x,  d.y)).rgb;
  vec3 c4 = texture(uSrcTex, vUV + vec2( d.x,  d.y)).rgb;
  vec3 avg = c0 * 0.5 + (c1 + c2 + c3 + c4) * 0.125;
  fragColor = vec4(uIsFirstPass ? prefilter(avg) : avg, 1.0);
}
`;

export const BLOOM_UPSAMPLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uLowMipTex;
uniform sampler2D uBaseMipTex;
uniform vec2 uTexelSize;
out vec4 fragColor;

void main() {
  vec2 d = uTexelSize * 1.25;
  vec3 s = texture(uLowMipTex, vUV + vec2(-d.x, 0.0)).rgb * 2.0
         + texture(uLowMipTex, vUV + vec2( d.x, 0.0)).rgb * 2.0
         + texture(uLowMipTex, vUV + vec2(0.0, -d.y)).rgb * 2.0
         + texture(uLowMipTex, vUV + vec2(0.0,  d.y)).rgb * 2.0
         + texture(uLowMipTex, vUV + vec2(-d.x, -d.y)).rgb
         + texture(uLowMipTex, vUV + vec2( d.x, -d.y)).rgb
         + texture(uLowMipTex, vUV + vec2(-d.x,  d.y)).rgb
         + texture(uLowMipTex, vUV + vec2( d.x,  d.y)).rgb;
  vec3 base = texture(uBaseMipTex, vUV).rgb;
  fragColor = vec4(base + (s / 12.0) * 0.72, 1.0);
}
`;

export const SSAO_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;
uniform sampler2D uDepthTex;
uniform vec2 uTanHalfFov;
uniform vec2 uResolution;
out vec4 fragColor;

const float NEAR_P = 0.14;
const float FAR_P  = 30000.0;

float linearizeDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * NEAR_P * FAR_P) / max(1e-5, FAR_P + NEAR_P - z * (FAR_P - NEAR_P));
}

vec3 reconstructViewPos(vec2 uv, float linZ) {
  return vec3((uv * 2.0 - 1.0) * uTanHalfFov * linZ, -linZ);
}

void main() {
  float rawD = texture(uDepthTex, vUV).r;
  if (rawD >= 0.99995) {
    fragColor = vec4(1.0);
    return;
  }

  float centerZ = linearizeDepth(rawD);
  if (centerZ > 220.0) {
    fragColor = vec4(1.0);
    return;
  }

  vec3 P = reconstructViewPos(vUV, centerZ);
  vec3 dPdx = dFdx(P);
  vec3 dPdy = dFdy(P);
  vec3 N = normalize(cross(dPdx, dPdy));

  // Per-pixel golden-ratio rotation jitter
  vec2 pix = floor(vUV * uResolution);
  float rotAng = fract(52.9829189 * fract(dot(pix, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float screenRadius = clamp(0.68 / centerZ, 0.003, 0.042);
  vec2 aspectFix = vec2(uResolution.y / max(1.0, uResolution.x), 1.0);

  float occ = 0.0;
  const int SAMPLES = 8;
  for (int i = 0; i < SAMPLES; i++) {
    float frac = (float(i) + 0.5) / float(SAMPLES);
    float ang = rotAng + float(i) * 2.3999632;
    vec2 suv = vUV + vec2(cos(ang), sin(ang)) * aspectFix * (screenRadius * sqrt(frac));
    float sd = texture(uDepthTex, suv).r;
    if (sd >= 0.99995) continue;
    float sLinZ = linearizeDepth(sd);
    vec3 S = reconstructViewPos(suv, sLinZ);
    vec3 V = S - P;
    float vv = dot(V, V) + 1e-4;
    float vn = dot(V, N) - 0.05;
    float rangeFade = smoothstep(0.0, 1.0, 1.25 / max(0.18, abs(centerZ - sLinZ)));
    occ += max(0.0, vn * inversesqrt(vv)) * rangeFade * (1.0 / (1.0 + 0.65 * vv));
  }

  float ao = clamp(1.0 - (occ / float(SAMPLES)) * 1.35, 0.58, 1.0);
  ao = mix(ao, 1.0, smoothstep(95.0, 190.0, centerZ));
  fragColor = vec4(ao, ao, ao, 1.0);
}
`;

export const COMPOSITE_TONEMAP_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;

uniform sampler2D uHdrScene;
uniform sampler2D uBloomTex;
uniform sampler2D uSsaoTex;
uniform vec2 uSsaoTexelSize;
uniform float uEnableSsao;
uniform float uExposure;
uniform float uBloomStrength;

out vec4 fragColor;

vec3 acesTonemap(vec3 x) {
  float lum = dot(x, vec3(0.2126, 0.7152, 0.0722));
  vec3 desat = mix(x, vec3(lum), clamp((lum - 1.6) / (lum + 5.0), 0.0, 0.60));
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((desat * (a * desat + b)) / (desat * (c * desat + d) + e), 0.0, 1.0);
}

void main() {
  vec3 hdr = texture(uHdrScene, vUV).rgb;
  vec3 bloom = texture(uBloomTex, vUV).rgb;

  // Fast 4-tap bilinear SSAO filter
  float ssao = 1.0;
  if (uEnableSsao > 0.5) {
    vec2 h = uSsaoTexelSize * 0.5;
    float s = texture(uSsaoTex, vUV + vec2(-h.x, -h.y)).r
            + texture(uSsaoTex, vUV + vec2( h.x, -h.y)).r
            + texture(uSsaoTex, vUV + vec2(-h.x,  h.y)).r
            + texture(uSsaoTex, vUV + vec2( h.x,  h.y)).r;
    ssao = s * 0.25;
    float hdrLum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    float emissiveBypass = clamp((hdrLum * uExposure - 0.85) * 0.8, 0.0, 1.0);
    ssao = mix(ssao, 1.0, emissiveBypass);
  }

  vec3 combined = (hdr * ssao + bloom * uBloomStrength) * uExposure;
  vec3 mapped = acesTonemap(combined);

  vec2 centered = vUV * 2.0 - 1.0;
  float vig = 1.0 - 0.11 * dot(centered, centered);
  mapped *= vig;

  vec3 srgb = pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2));
  fragColor = vec4(srgb, 1.0);
}
`;
