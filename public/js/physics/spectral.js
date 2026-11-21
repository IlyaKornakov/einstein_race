/**
 * Physically-Based Relativistic Spectral Colorimetry
 * ==================================================
 *
 * Implements exact closed-form Gaussian convolution between a multi-band surface
 * emission/reflectance spectrum (UV + R/G/B basis + Near-IR bands, plus optional
 * narrow-band monochromatic lines for traffic lights / neon) and CIE 1931 XYZ
 * color-matching Gaussians, converted to linear Rec.709 / sRGB.
 *
 * Calibrates the 3x3 visible RGB -> spectral weight matrix at startup so that
 * at Doppler factor D = 1.0, any linear RGB color maps back to itself with
 * floating-point identity precision, while smoothly Doppler-shifting across
 * UV <-> Visible <-> Near-IR for all D != 1.0.
 */

// Analytic Gaussian lobes approximating CIE 1931 2-deg XYZ color matching functions
// Each entry: [amplitude, center_nm, sigma_nm]
export const CIE_X_LOBES = [
  [1.056, 599.8, 37.9],
  [0.362, 442.0, 16.0],
  [-0.065, 501.1, 20.4],
];

export const CIE_Y_LOBES = [
  [0.821, 568.8, 46.9],
  [0.286, 530.9, 23.3],
];

export const CIE_Z_LOBES = [
  [1.217, 437.0, 11.8],
  [0.681, 459.0, 26.0],
];

// Visible RGB spectral basis Gaussians [center_nm, sigma_nm]
export const RGB_BASIS_BANDS = [
  [612.0, 36.0], // Red band
  [542.0, 32.0], // Green band
  [454.0, 25.0], // Blue band
];

// Standard CIE XYZ (D65) -> Linear Rec.709 / sRGB row-major 3x3
export const XYZ_TO_LINEAR_SRGB = [
   3.2404542, -1.5371385, -0.4985314,
  -0.9692660,  1.8760108,  0.0415560,
   0.0556434, -0.2040259,  1.0572252,
];

const SQRT_2PI = Math.sqrt(2.0 * Math.PI);

/**
 * Exact integral over (-inf, +inf) of:
 *   A * exp(-(x - muA)^2 / (2 * sigA^2)) * exp(-(x - muB)^2 / (2 * sigB^2))
 */
export function gaussianOverlapIntegral(ampA, muA, sigA, muB, sigB) {
  const varSum = sigA * sigA + sigB * sigB;
  const diff = muA - muB;
  return (
    ampA *
    SQRT_2PI *
    ((sigA * sigB) / Math.sqrt(varSum)) *
    Math.exp(-(diff * diff) / (2.0 * varSum))
  );
}

/**
 * Integrates a single Doppler-shifted Gaussian emission lobe (muEmit, sigEmit)
 * at Doppler factor D = nu_obs / nu_emit (so lambda_obs = lambda_emit / D)
 * against CIE XYZ -> Linear sRGB (without the bolometric D^4 factor).
 */
export function integrateShiftedGaussianToLinearRGB(muEmit, sigEmit, D) {
  const invD = 1.0 / Math.max(D, 1e-4);
  const muObs = muEmit * invD;
  const sigObs = sigEmit * invD;
  // Normalize by D so pure spectral integral without beaming preserves photon count scaling cleanly;
  // bolometric D^4 beaming is applied explicitly so it can be toggled/inspected cleanly.
  let X = 0.0;
  let Y = 0.0;
  let Z = 0.0;
  for (const [amp, mu, sig] of CIE_X_LOBES) X += gaussianOverlapIntegral(amp, mu, sig, muObs, sigObs);
  for (const [amp, mu, sig] of CIE_Y_LOBES) Y += gaussianOverlapIntegral(amp, mu, sig, muObs, sigObs);
  for (const [amp, mu, sig] of CIE_Z_LOBES) Z += gaussianOverlapIntegral(amp, mu, sig, muObs, sigObs);

  X *= D;
  Y *= D;
  Z *= D;

  const M = XYZ_TO_LINEAR_SRGB;
  return [
    M[0] * X + M[1] * Y + M[2] * Z,
    M[3] * X + M[4] * Y + M[5] * Z,
    M[6] * X + M[7] * Y + M[8] * Z,
  ];
}

function invert3x3RowMajor(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  const invDet = 1.0 / det;
  return [
    A * invDet, D * invDet, G * invDet,
    B * invDet, E * invDet, H * invDet,
    C * invDet, F * invDet, I * invDet,
  ];
}

/**
 * Computes column-major Float32Array(9) for WebGL `uniform mat3 uRgbToSpectralWeights`
 * guaranteeing exact linear-RGB preservation at D = 1.0.
 */
export function computeCalibratedSpectralMatrix() {
  // Columns of forward matrix F are responses of R, G, B basis lobes at D = 1.0
  const colR = integrateShiftedGaussianToLinearRGB(RGB_BASIS_BANDS[0][0], RGB_BASIS_BANDS[0][1], 1.0);
  const colG = integrateShiftedGaussianToLinearRGB(RGB_BASIS_BANDS[1][0], RGB_BASIS_BANDS[1][1], 1.0);
  const colB = integrateShiftedGaussianToLinearRGB(RGB_BASIS_BANDS[2][0], RGB_BASIS_BANDS[2][1], 1.0);

  const forwardRowMajor = [
    colR[0], colG[0], colB[0],
    colR[1], colG[1], colB[1],
    colR[2], colG[2], colB[2],
  ];
  const invRowMajor = invert3x3RowMajor(forwardRowMajor);

  // Convert row-major to WebGL column-major mat3
  return new Float32Array([
    invRowMajor[0], invRowMajor[3], invRowMajor[6],
    invRowMajor[1], invRowMajor[4], invRowMajor[7],
    invRowMajor[2], invRowMajor[5], invRowMajor[8],
  ]);
}

/**
 * CPU helper to preview how a monochromatic wavelength (e.g. 632nm Red traffic light)
 * looks in sRGB at a given Doppler factor D (used in HUD telemetry bar).
 */
export function wavelengthToDisplaySRGB(wavelengthNm, D = 1.0) {
  const lin = integrateShiftedGaussianToLinearRGB(wavelengthNm, 12.0, D);
  const peak = Math.max(lin[0], lin[1], lin[2], 0.02);
  return lin.map((v) => {
    const norm = Math.max(0.0, Math.min(1.0, v / peak));
    return Math.round(Math.pow(norm, 1.0 / 2.2) * 255);
  });
}

/**
 * GLSL spectral shift module to inject into fragment shaders.
 */
export function getSpectralGLSL() {
  return /* glsl */ `
    uniform mat3 uRgbToSpectralWeights;
    uniform float uEnableDoppler;
    uniform float uEnableBeaming;
    uniform float uBeamingExponent; // 3.5 - 4.0 physical bolometric, adjustable

    const float SQRT_2PI = 2.50662827463;

    float gaussOverlap(float ampA, float muA, float sigA, float muB, float sigB) {
      float varSum = sigA * sigA + sigB * sigB;
      float diff = muA - muB;
      return ampA * SQRT_2PI * ((sigA * sigB) * inversesqrt(varSum)) * exp(-(diff * diff) / (2.0 * varSum));
    }

    vec3 evalLobeLinearRGB(float muEmit, float sigEmit, float D) {
      float invD = 1.0 / D;
      float muObs = muEmit * invD;
      float sigObs = sigEmit * invD;

      // Quick range reject outside visible [350nm, 760nm] +/- 3.5*sigObs
      float margin = 3.6 * sigObs + 110.0;
      if (muObs < 360.0 - margin || muObs > 730.0 + margin) {
        return vec3(0.0);
      }

      float X = gaussOverlap( 1.056, 599.8, 37.9, muObs, sigObs)
              + gaussOverlap( 0.362, 442.0, 16.0, muObs, sigObs)
              + gaussOverlap(-0.065, 501.1, 20.4, muObs, sigObs);

      float Y = gaussOverlap( 0.821, 568.8, 46.9, muObs, sigObs)
              + gaussOverlap( 0.286, 530.9, 23.3, muObs, sigObs);

      float Z = gaussOverlap( 1.217, 437.0, 11.8, muObs, sigObs)
              + gaussOverlap( 0.681, 459.0, 26.0, muObs, sigObs);

      vec3 xyz = vec3(X, Y, Z) * D;

      // CIE XYZ -> Linear Rec.709 / sRGB
      return vec3(
         3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
        -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
         0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z
      );
    }

    /**
     * Applies full relativistic Doppler spectral shift + relativistic beaming
     * to a rest-frame linear RGB radiance, augmented with physical UV and Near-IR
     * spectral tails:
     *   uvWeight  : UV reflectance/emission relative weight (~315nm & ~215nm)
     *   nirWeight : Near-IR reflectance/emission weight (~810nm & ~1180nm, e.g. high on foliage!)
     *   narrowNm  : If > 0, treats emission as a narrow-band spectral line (traffic lights / neon)
     */
    vec3 applyRelativisticSpectrumCustom(
      vec3 restLinearRGB,
      float D_raw,
      float uvWeight,
      float nirWeight,
      float narrowNm,
      float beamExp
    ) {
      float D = mix(1.0, D_raw, uEnableDoppler);
      float beamD = mix(1.0, D_raw, uEnableBeaming);
      float beamFactor = pow(clamp(beamD, 0.08, 16.0), beamExp);

      if (abs(D - 1.0) < 1e-4 && narrowNm <= 0.0) {
        return max(vec3(0.0), restLinearRGB * beamFactor);
      }

      vec3 shifted;
      if (narrowNm > 0.0) {
        float lum = max(restLinearRGB.r, max(restLinearRGB.g, restLinearRGB.b));
        vec3 refAt1 = evalLobeLinearRGB(narrowNm, 11.0, 1.0);
        float refPeak = max(0.05, max(refAt1.r, max(refAt1.g, refAt1.b)));
        shifted = (lum / refPeak) * evalLobeLinearRGB(narrowNm, 11.0, D);
      } else {
        vec3 w = uRgbToSpectralWeights * restLinearRGB;
        shifted = w.x * evalLobeLinearRGB(612.0, 36.0, D)
                + w.y * evalLobeLinearRGB(542.0, 32.0, D)
                + w.z * evalLobeLinearRGB(454.0, 25.0, D);

        // Scale UV & Near-IR continuum tails by surface radiance energy so 3D PBR shading,
        // cast shadows, and dark sign/brick textures preserve crisp contrast at all speeds!
        float reflEnergy = max(0.0, dot(restLinearRGB, vec3(0.2126, 0.7152, 0.0722)));

        float uvBlend = (1.0 - smoothstep(0.86, 1.00, D)) * uvWeight * reflEnergy;
        if (uvBlend > 1e-5) {
          vec3 uvSum = 0.0095 * evalLobeLinearRGB(368.0, 34.0, D)
                     + 0.0110 * evalLobeLinearRGB(292.0, 32.0, D)
                     + 0.0125 * evalLobeLinearRGB(226.0, 28.0, D)
                     + 0.0135 * evalLobeLinearRGB(172.0, 24.0, D)
                     + 0.0145 * evalLobeLinearRGB(130.0, 20.0, D);
          shifted += uvBlend * uvSum * vec3(1.12, 0.94, 0.80);
        }

        float nirBlend = smoothstep(1.00, 1.14, D) * nirWeight * reflEnergy;
        if (nirBlend > 1e-5) {
          vec3 nirSum = 0.0068 * evalLobeLinearRGB(735.0,  62.0,  D)
                      + 0.0052 * evalLobeLinearRGB(920.0,  90.0,  D)
                      + 0.0039 * evalLobeLinearRGB(1180.0, 125.0, D)
                      + 0.0029 * evalLobeLinearRGB(1540.0, 170.0, D)
                      + 0.0021 * evalLobeLinearRGB(2020.0, 230.0, D)
                      + 0.0015 * evalLobeLinearRGB(2680.0, 310.0, D)
                      + 0.0011 * evalLobeLinearRGB(3600.0, 420.0, D)
                      + 0.0008 * evalLobeLinearRGB(4900.0, 580.0, D);
          vec3 blueTint = mix(vec3(0.92, 0.98, 1.10), vec3(0.68, 0.95, 1.38), smoothstep(1.25, 3.4, D));
          shifted += nirBlend * nirSum * blueTint;
        }
      }

      return max(vec3(0.0), shifted * beamFactor);
    }

    vec3 applyRelativisticSpectrum(
      vec3 restLinearRGB,
      float D_raw,
      float uvWeight,
      float nirWeight,
      float narrowNm
    ) {
      return applyRelativisticSpectrumCustom(restLinearRGB, D_raw, uvWeight, nirWeight, narrowNm, uBeamingExponent);
    }
  `;
}
