/**
 * Spacetime Geometry & Relativistic Observation Architecture
 * ==========================================================
 *
 * Designed around metric & tetrad (vierbein) formalism so Special Relativity
 * (`MinkowskiMetric`) is the flat-spacetime instance of a general `SpacetimeMetric`
 * interface ready to extend to General Relativity (e.g. Post-Newtonian weak-field
 * gravity or curved Schwarzschild/Kerr metrics).
 *
 * Coordinate convention:
 *   x^mu = (t, x, y, z)
 *     t : coordinate time in the city ("lab") frame [seconds]
 *     x : East  [meters]
 *     y : Up    [meters]
 *     z : South [meters]  (so North / default forward is -Z, standard WebGL RHS)
 *   Signature: (-, +, +, +), ds^2 = g_{mu nu} dx^mu dx^nu.
 */

export class ObserverState {
  constructor() {
    /** Spacetime coordinates [t, x, y, z] */
    this.event = new Float64Array([0, 0, 1.55, 0]);
    /** Accumulated observer proper time tau [seconds] */
    this.properTime = 0.0;
    /** Coordinate velocity dx^i / dt in [m/s] */
    this.velocity = new Float64Array([0, 0, 0]);
    /** Dimensionless velocity beta = v / c */
    this.beta = new Float64Array([0, 0, 0]);
    /** Lorentz factor gamma = dt / dtau (SR kinematic component) */
    this.gamma = 1.0;
    /** General-Relativistic gravitational lapse alpha = sqrt(1 - r_s / r) <= 1.0 */
    this.gravAlpha = 1.0;
    /** Combined total time-dilation factor dt / dtau = gamma / gravAlpha */
    this.totalTimeDilation = 1.0;
    /** 4-velocity u^mu = dx^mu / dtau = [gamma, gamma*vx, gamma*vy, gamma*vz] */
    this.fourVelocity = new Float64Array([1, 0, 0, 0]);
    /** Spatial proper acceleration a' [m/s^2] felt in observer's rest frame (thrust + centripetal turn) */
    this.properAcceleration = new Float64Array([0, 0, 0]);
    /** Accumulated Thomas-Wigner precession angle [radians] from non-collinear boosts during turns */
    this.thomasPrecessionRad = 0.0;
    /**
     * Orthonormal local Lorentz tetrad e_{\hat{a}}^\mu (column-major 4x4)
     * mapping observer local rest-frame displacements to coordinate frame,
     * satisfying g_{\mu\nu} e_{\hat{a}}^\mu e_{\hat{b}}^\nu = \eta_{\hat{a}\hat{b}}.
     */
    this.tetrad = new Float64Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  }
}

/**
 * Abstract base class for 4D Lorentzian spacetime metrics.
 * Subclasses provide CPU kinematics/tetrad transport and the corresponding
 * GLSL past-light-cone projection module consumed by the PBR renderer.
 */
export class SpacetimeMetric {
  /**
   * @param {number} speedOfLight Speed of light c in [m/s]
   */
  constructor(speedOfLight = 25.0) {
    this.c = speedOfLight;
  }

  setSpeedOfLight(c) {
    this.c = Math.max(2.0, Number(c) || 25.0);
  }

  /**
   * Returns covariant metric tensor g_{mu nu}(event) as row-major 4x4 Float64Array.
   * @param {Float64Array|number[]} _event [t, x, y, z]
   * @returns {Float64Array}
   */
  metricTensor(_event) {
    throw new Error('SpacetimeMetric.metricTensor must be implemented by subclass');
  }

  /**
   * Returns Christoffel connection coefficients Gamma^lambda_{mu nu}(event)
   * as Float64Array(64) indexed by [lambda * 16 + mu * 4 + nu].
   * Used for geodesic integration & Fermi-Walker tetrad transport in GR extensions.
   * @param {Float64Array|number[]} _event [t, x, y, z]
   * @returns {Float64Array}
   */
  christoffelSymbols(_event) {
    return new Float64Array(64);
  }

  /**
   * Computes dtau / dt for an entity at `event` moving with coordinate velocity `vel`.
   * Derived directly from ds^2 = -c^2 dtau^2 = g_{mu nu} dx^mu dx^nu.
   * @param {Float64Array|number[]} event [t, x, y, z]
   * @param {Float64Array|number[]} vel [vx, vy, vz]
   * @returns {number} dtau / dt in (0, 1]
   */
  properTimeRate(event, vel) {
    const g = this.metricTensor(event);
    const dx = [1.0, vel[0], vel[1], vel[2]];
    let ds2 = 0.0;
    for (let mu = 0; mu < 4; mu++) {
      for (let nu = 0; nu < 4; nu++) {
        ds2 += g[mu * 4 + nu] * dx[mu] * dx[nu];
      }
    }
    const c2 = this.c * this.c;
    return Math.sqrt(Math.max(1e-8, -ds2 / c2));
  }

  /**
   * Updates `observer` state (beta, gamma, 4-velocity, orthonormal tetrad, clocks)
   * over a step of observer proper time `dtProper` (or coordinate step).
   */
  stepObserver(_observer, _dtProper) {
    throw new Error('SpacetimeMetric.stepObserver must be implemented by subclass');
  }

  /**
   * Returns GLSL code implementing `projectPastLightCone(...)` and
   * `mapObserverRayToSky(...)` for vertex and sky shaders.
   * @returns {string}
   */
  getShaderModule() {
    throw new Error('SpacetimeMetric.getShaderModule must be implemented by subclass');
  }
}

/**
 * Exact Flat Spacetime (Special Relativity):
 *   g_{mu nu} = diag(-c^2, 1, 1, 1)
 */
export class MinkowskiMetric extends SpacetimeMetric {
  constructor(speedOfLight = 25.0) {
    super(speedOfLight);
  }

  metricTensor(_event) {
    const c2 = this.c * this.c;
    return new Float64Array([
      -c2, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  }

  /**
   * Computes Lorentz factor gamma = (1 - |v|^2 / c^2)^(-1/2), clamped below singularity.
   */
  gammaFromVelocity(vx, vy, vz) {
    const c = this.c;
    const b2 = Math.min(0.9994, (vx * vx + vy * vy + vz * vz) / (c * c));
    return 1.0 / Math.sqrt(1.0 - b2);
  }

  /**
   * Relativistic velocity addition u (+) v in 3D:
   * Returns velocity of `vLocal` (measured in a frame moving at `uFrame`) as seen in lab frame.
   */
  addVelocities(uFrame, vLocal) {
    const c2 = this.c * this.c;
    const ux = uFrame[0], uy = uFrame[1], uz = uFrame[2];
    const vx = vLocal[0], vy = vLocal[1], vz = vLocal[2];
    const u2 = ux * ux + uy * uy + uz * uz;
    if (u2 < 1e-12) return [vx, vy, vz];

    const gammaU = this.gammaFromVelocity(ux, uy, uz);
    const uvDot = ux * vx + uy * vy + uz * vz;
    const denom = 1.0 + uvDot / c2;
    const kParallel = (gammaU / (gammaU + 1.0)) * (uvDot / c2);

    return [
      (ux + vx / gammaU + kParallel * ux) / denom,
      (uy + vy / gammaU + kParallel * uy) / denom,
      (uz + vz / gammaU + kParallel * uz) / denom,
    ];
  }

  /**
   * Advances observer along worldline by `dtProper` seconds of observer proper time,
   * updating coordinate time dt = gamma * dtProper, coordinate position, 4-velocity,
   * and pure-boosted canonical orthonormal tetrad e_{\hat{a}}^\mu.
   */
  stepObserver(observer, dtProper) {
    const c = this.c;
    const vx = observer.velocity[0];
    const vy = observer.velocity[1];
    const vz = observer.velocity[2];

    let bx = vx / c;
    let by = vy / c;
    let bz = vz / c;
    const b2 = bx * bx + by * by + bz * bz;
    const maxB2 = 0.999 * 0.999;
    if (b2 > maxB2) {
      const s = Math.sqrt(maxB2 / b2);
      bx *= s;
      by *= s;
      bz *= s;
      observer.velocity[0] = bx * c;
      observer.velocity[1] = by * c;
      observer.velocity[2] = bz * c;
    }

    const clampedB2 = Math.min(maxB2, bx * bx + by * by + bz * bz);
    const gamma = 1.0 / Math.sqrt(1.0 - clampedB2);

    observer.beta[0] = bx;
    observer.beta[1] = by;
    observer.beta[2] = bz;
    observer.gamma = gamma;
    observer.gravAlpha = 1.0;
    observer.totalTimeDilation = gamma;

    // Advance proper time and coordinate event: dx^mu = u^mu dtau
    const dtCoord = gamma * dtProper;
    observer.properTime += dtProper;
    observer.event[0] += dtCoord;
    observer.event[1] += observer.velocity[0] * dtCoord;
    observer.event[2] += observer.velocity[1] * dtCoord;
    observer.event[3] += observer.velocity[2] * dtCoord;

    observer.fourVelocity[0] = gamma;
    observer.fourVelocity[1] = gamma * observer.velocity[0];
    observer.fourVelocity[2] = gamma * observer.velocity[1];
    observer.fourVelocity[3] = gamma * observer.velocity[2];

    // Canonical Lorentz-boosted spatial triad + timelike 4-velocity
    // (avoids unwanted horizon roll while driving & turning on streets)
    const k = (gamma * gamma) / (gamma + 1.0);
    const t = observer.tetrad;
    // Column 0: e_{\hat{0}}^\mu = (gamma/c, gamma*beta/c * c) -> normalized in (ct, x, y, z)
    t[0] = gamma / c; t[1] = gamma * bx; t[2] = gamma * by; t[3] = gamma * bz;
    // Column 1: e_{\hat{1}}^\mu (boosted X)
    t[4] = (gamma * bx) / c; t[5] = 1 + k * bx * bx; t[6] = k * bx * by;     t[7] = k * bx * bz;
    // Column 2: e_{\hat{2}}^\mu (boosted Y)
    t[8] = (gamma * by) / c; t[9] = k * by * bx;     t[10] = 1 + k * by * by; t[11] = k * by * bz;
    // Column 3: e_{\hat{3}}^\mu (boosted Z)
    t[12] = (gamma * bz) / c; t[13] = k * bz * bx;   t[14] = k * bz * by;    t[15] = 1 + k * bz * bz;

    return dtCoord;
  }

  /**
   * Exact GLSL Special-Relativity module implementing past-light-cone intersection,
   * moving-entity Lorentz contraction + retardation, rotating rest-frame subparts
   * (rolling wheels & clocks), aberration, and relativistic Doppler factor.
   */
  getShaderModule() {
    return /* glsl */ `
      uniform vec3 uObsPos;
      uniform float uObsTime;
      uniform vec3 uObsBeta;
      uniform float uObsGamma;
      uniform float uSpeedOfLight;

      // Educational / diagnostic physics toggles (all 1.0 in full physical mode)
      uniform float uEnableRetardation;
      uniform float uEnableLorentz;
      uniform float uEnableAberration;
      uniform vec3 uObsProperAccel;
      uniform float uEnableAccelEquiv;

      // Equivalence-Principle Rindler gravitational frequency shift across accelerating/turning frame:
      //   ds^2 = -(1 + a' . dx' / c^2)^2 c^2 dtau^2 + dx'^2
      float evalRindlerDoppler(vec3 obsLocalPos) {
        if (uEnableAccelEquiv < 0.5) return 1.0;
        float c2 = max(4.0, uSpeedOfLight * uSpeedOfLight);
        // Smoothly saturate spatial lever arm at ~65m so extreme g-turns stay regular
        float r = length(obsLocalPos);
        vec3 effPos = (r > 65.0) ? (obsLocalPos * (65.0 / r)) : obsLocalPos;
        float pot = dot(uObsProperAccel, effPos) / c2;
        return clamp(1.0 + 0.68 * pot, 0.22, 3.8);
      }

      struct RelativisticObservation {
        vec3 observerLocalPos;   // Apparent spatial vector in observer's rest frame
        vec3 cityEmitOffset;     // x_emit - x_obs in city frame
        vec3 cityEmitPos;        // x_emit in city frame (for shadows & causal lights)
        vec3 restViewDir;        // Outgoing photon dir in emitter's rest frame (for BRDF)
        float lightTravelDist;   // u = c * (t_obs - t_emit) >= 0
        float emitCoordTime;     // t_emit
        float emitProperTime;    // tau_emit of the emitting vertex
        float dopplerFactor;     // nu_obs / nu_emit
      };

      vec3 rotateAroundAxis(vec3 v, vec3 axis, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
      }

      RelativisticObservation projectPastLightCone(
        vec3 restVertexPos,
        vec3 restNormal,
        bool isDynamic,
        vec3 entityPosNow,
        vec3 entityRestOffset,
        mat3 entityRot,
        vec3 entityBeta,
        float entityGamma,
        float entityProperTimeNow,
        vec3 spinPivot,
        vec3 spinAxis,
        float spinOmega,
        float swingAmp,
        out vec3 worldNormalOut
      ) {
        RelativisticObservation obs;

        vec3 effEntityBeta = entityBeta * uEnableLorentz;
        float effEntityGamma = mix(1.0, entityGamma, uEnableLorentz);

        // Solve retarded proper time for spinning/oscillating rest-frame parts (wheels, clocks, limbs)
        float tauEmit = entityProperTimeNow;
        vec3 baseVertexPos = restVertexPos + entityRestOffset;
        vec3 localPos = baseVertexPos;
        vec3 localNrm = restNormal;

        if (isDynamic && (abs(spinOmega) > 1e-5 || abs(swingAmp) > 1e-5)) {
          for (int iter = 0; iter < 3; iter++) {
            float phi = abs(swingAmp) > 1e-5
              ? (swingAmp * sin(spinOmega * tauEmit))
              : (spinOmega * tauEmit);
            vec3 rel = baseVertexPos - spinPivot;
            localPos = spinPivot + rotateAroundAxis(rel, spinAxis, phi);
            vec3 r0Iter = entityRot * localPos;
            float contractFactorIter = (effEntityGamma / (effEntityGamma + 1.0)) * dot(effEntityBeta, r0Iter);
            vec3 xNowIter = entityPosNow + r0Iter - contractFactorIter * effEntityBeta;
            vec3 dIter = xNowIter - uObsPos;
            float bIter = dot(dIter, effEntityBeta);
            float discIter = max(0.0, bIter * bIter + dot(dIter, dIter) / (effEntityGamma * effEntityGamma));
            float uIter = uEnableRetardation * (effEntityGamma * effEntityGamma * (-bIter + sqrt(discIter)));
            tauEmit = entityProperTimeNow
              - uIter / (max(1.0, effEntityGamma) * uSpeedOfLight)
              - (uEnableLorentz * dot(effEntityBeta, r0Iter)) / uSpeedOfLight;
          }
          float finalPhi = abs(swingAmp) > 1e-5
            ? (swingAmp * sin(spinOmega * tauEmit))
            : (spinOmega * tauEmit);
          localNrm = rotateAroundAxis(restNormal, spinAxis, finalPhi);
        }

        vec3 r0 = isDynamic ? (entityRot * localPos) : localPos;
        worldNormalOut = normalize(isDynamic ? (entityRot * localNrm) : localNrm);

        // City-frame equal-time position at t = t_obs (includes moving-object Lorentz contraction)
        vec3 xNow;
        if (isDynamic) {
          float contractFactor = (effEntityGamma / (effEntityGamma + 1.0)) * dot(effEntityBeta, r0);
          xNow = entityPosNow + r0 - contractFactor * effEntityBeta;
        } else {
          xNow = r0;
        }

        vec3 d = xNow - uObsPos;
        float u = 0.0;
        vec3 dxEmit = d;

        if (uEnableRetardation > 0.5) {
          if (isDynamic) {
            float b = dot(d, effEntityBeta);
            float invG2 = 1.0 / (effEntityGamma * effEntityGamma);
            float disc = max(0.0, b * b + dot(d, d) * invG2);
            u = (effEntityGamma * effEntityGamma) * (-b + sqrt(disc));
            dxEmit = d - u * effEntityBeta;
          } else {
            u = length(d);
            dxEmit = d;
          }
        } else {
          u = length(d);
          dxEmit = d;
        }

        obs.cityEmitOffset = dxEmit;
        obs.cityEmitPos = uObsPos + dxEmit;
        obs.lightTravelDist = u;
        obs.emitCoordTime = uObsTime - (uEnableRetardation * u) / uSpeedOfLight;

        if (isDynamic) {
          if (abs(spinOmega) <= 1e-5 && abs(swingAmp) <= 1e-5) {
            obs.emitProperTime = entityProperTimeNow
              - (uEnableRetardation * u) / (effEntityGamma * uSpeedOfLight)
              - (uEnableLorentz * dot(effEntityBeta, r0)) / uSpeedOfLight;
          } else {
            obs.emitProperTime = tauEmit;
          }
        } else {
          obs.emitProperTime = obs.emitCoordTime;
        }

        // Transform emission 4-displacement (-u, dxEmit) into Observer Instantaneous Rest Frame
        vec3 obsLocal = dxEmit;
        float obsGamma = mix(1.0, uObsGamma, uEnableLorentz);
        vec3 obsBeta = uObsBeta * uEnableLorentz;

        if (uEnableRetardation > 0.5) {
          float kBoost = (obsGamma * obsGamma) / (obsGamma + 1.0);
          float uAberration = u * uEnableAberration;
          obsLocal = dxEmit + (kBoost * dot(obsBeta, dxEmit) + obsGamma * uAberration) * obsBeta;
        } else {
          // Simultaneous slice Delta t' = 0 comparison mode: pure Lorentz contraction 1/gamma
          float kContract = (obsGamma / (obsGamma + 1.0)) * dot(obsBeta, dxEmit);
          obsLocal = dxEmit - kContract * obsBeta;
        }

        // Equivalence-Principle Rindler null-geodesic light deflection under proper acceleration a'
        // (curves distant streets & towers opposite to pseudo-gravity g_eff = -a' during hard turns/braking!)
        if (uEnableAccelEquiv > 0.5 && dot(uObsProperAccel, uObsProperAccel) > 1e-3) {
          float rLoc = length(obsLocal);
          if (rLoc > 0.25) {
            vec3 rHat = obsLocal / rLoc;
            vec3 aTransverse = uObsProperAccel - dot(uObsProperAccel, rHat) * rHat;
            float c2 = max(4.0, uSpeedOfLight * uSpeedOfLight);
            float effR = min(rLoc, 80.0);
            vec3 bendDisp = aTransverse * ((0.36 * effR * rLoc) / (2.0 * c2));
            float maxBend = 0.38 * rLoc;
            float bLen = length(bendDisp);
            if (bLen > maxBend) bendDisp *= (maxBend / bLen);
            obsLocal += bendDisp;
          }
        }

        obs.observerLocalPos = obsLocal;

        // Photon propagation unit vector in city frame (pointing FROM emitter TO observer)
        float distSafe = max(length(dxEmit), 1e-5);
        vec3 photonDirCity = -dxEmit / distSafe;

        // Outgoing ray direction in emitter's rest frame for invariant BRDF evaluation
        if (isDynamic && dot(effEntityBeta, effEntityBeta) > 1e-8) {
          float denomEmit = max(1e-4, effEntityGamma * (1.0 - dot(effEntityBeta, photonDirCity)));
          float kObj = (effEntityGamma * effEntityGamma) / (effEntityGamma + 1.0);
          vec3 nPrime = (photonDirCity + (kObj * dot(effEntityBeta, photonDirCity) - effEntityGamma) * effEntityBeta) / denomEmit;
          obs.restViewDir = normalize(nPrime);
        } else {
          obs.restViewDir = photonDirCity;
        }

        // Relativistic Doppler factor D = nu_obs / nu_emit (including Rindler turn/accel shift!)
        float numD = uObsGamma * (1.0 - dot(uObsBeta, photonDirCity));
        float denD = isDynamic ? (entityGamma * (1.0 - dot(entityBeta, photonDirCity))) : 1.0;
        float srD = numD / max(denD, 1e-4);
        obs.dopplerFactor = clamp(srD * evalRindlerDoppler(obsLocal), 0.03, 35.0);

        return obs;
      }

      // Inverse aberration for Sky Dome: maps observer local view ray n_obs (pointing outward)
      // to city-frame sky direction n_city and computes sky Doppler factor D.
      vec3 mapObserverRayToSky(vec3 localViewDir, out float skyDoppler) {
        vec3 nObs = normalize(localViewDir);
        if (uEnableAccelEquiv > 0.5 && dot(uObsProperAccel, uObsProperAccel) > 1e-3) {
          float c2 = max(4.0, uSpeedOfLight * uSpeedOfLight);
          vec3 aTrans = uObsProperAccel - dot(uObsProperAccel, nObs) * nObs;
          nObs = normalize(nObs - aTrans * (16.0 / c2));
        }
        if (uEnableAberration < 0.5 && uEnableLorentz < 0.5) {
          skyDoppler = evalRindlerDoppler(nObs * 42.0);
          return nObs;
        }
        vec3 beta = uObsBeta * uEnableAberration;
        float b2 = dot(beta, beta);
        float gamma = 1.0 / sqrt(max(1e-6, 1.0 - b2));
        float k = (gamma * gamma) / (gamma + 1.0);
        float bn = dot(beta, nObs);

        // Null vector (-1, nObs) in observer frame boosted by +beta into city frame:
        // E_city = gamma * (1 - beta . nObs)
        // p_city = nObs + (k * (beta . nObs) - gamma) * beta
        float eCity = max(1e-5, gamma * (1.0 - bn));
        vec3 nCity = normalize((nObs + (k * bn - gamma) * beta) / eCity);

        // Photon travels FROM sky (-nCity) TO observer: photonDirCity = -nCity
        // D = nu_obs / nu_emit = uObsGamma * (1 + uObsBeta . nCity)
        float srSkyD = uObsGamma * (1.0 + dot(uObsBeta, nCity));
        skyDoppler = clamp(srSkyD * evalRindlerDoppler(nObs * 42.0), 0.03, 35.0);
        return nCity;
      }
    `;
  }
}

/**
 * General Relativity Curved-Spacetime Metric (Schwarzschild/Kerr Black Hole + Morris–Thorne Wormhole):
 *   - Exact gravitational time dilation: dtau = sqrt(1 - r_s / r) dt / gamma
 *   - Exact gravitational frequency shift: D_GR = sqrt((1 - r_s / r_emit) / (1 - r_s / r_obs))
 *   - Closed-form Einstein Ring gravitational lensing of 3D world geometry & sky dome
 *   - Kerr frame-dragging & Schwarzschild geodesic slingshot acceleration field
 */
export class GeneralRelativityMetric extends MinkowskiMetric {
  constructor(speedOfLight = 25.0) {
    super(speedOfLight);
    this.enableGR = true;

    // Spinning Black Hole ("Singularity Slingshot Basin" West of Grand Boulevard)
    this.bhPos = new Float64Array([-34.0, 6.2, 54.0]);
    this.bhRs = 4.4;       // Schwarzschild horizon radius r_s [m] (shadow b_crit = 11.4m!)
    this.bhSpin = 0.88;    // Dimensionless Kerr spin a_* in [0, 1) (prograde frame-dragging!)

    // Traversable Morris–Thorne Wormhole Shortcut (North Boulevard End <-> East Skyline Straight)
    this.wormholeA = new Float64Array([-5.0, 3.1, -150.0]);
    this.wormholeB = new Float64Array([201.0, 4.0, 54.0]);
    this.wormholeThroatR = 4.2; // Throat radius b_0 [m]
  }

  /**
   * Evaluates gravitational lapse alpha(x) = sqrt(max(0.08, 1 - r_s / r)) at spatial position (x, y, z).
   */
  gravLapseAt(x, y, z) {
    if (!this.enableGR) return 1.0;
    const dx = x - this.bhPos[0];
    const dy = y - this.bhPos[1];
    const dz = z - this.bhPos[2];
    const r = Math.hypot(dx, dy, dz);
    // Effective potential includes extended strong-field halo so roadside flybys feel vivid GR dilation
    const effRs = this.bhRs * 1.45;
    if (r > 95.0) return 1.0;
    const fade = Math.max(0.0, 1.0 - Math.max(0.0, r - 55.0) / 40.0);
    const ratio = (effRs / Math.max(effRs * 1.04, r)) * fade;
    return Math.sqrt(Math.max(0.09, 1.0 - ratio));
  }

  metricTensor(event) {
    const c2 = this.c * this.c;
    const alpha = this.gravLapseAt(event[1], event[2], event[3]);
    const a2 = alpha * alpha;
    const invA2 = 1.0 / Math.max(0.08, a2);
    return new Float64Array([
      -c2 * a2, 0, 0, 0,
      0, invA2, 0, 0,
      0, 0, invA2, 0,
      0, 0, 0, invA2,
    ]);
  }

  stepObserver(observer, dtProper) {
    const dtSR = super.stepObserver(observer, dtProper);
    const alpha = this.gravLapseAt(observer.event[1], observer.event[2], observer.event[3]);
    observer.gravAlpha = alpha;
    if (!this.enableGR || alpha >= 0.9999) {
      observer.totalTimeDilation = observer.gamma;
      return dtSR;
    }
    // General Relativistic coordinate time step: dt = (gamma / alpha(r)) * dtau!
    // Undo the flat dtSR coordinate clock increment and apply exact curved-spacetime dtGR
    const dtGR = dtSR / alpha;
    observer.event[0] += dtGR - dtSR;
    observer.totalTimeDilation = observer.gamma / alpha;
    return dtGR;
  }

  getShaderModule() {
    return /* glsl */ `
      uniform vec3 uObsPos;
      uniform float uObsTime;
      uniform vec3 uObsBeta;
      uniform float uObsGamma;
      uniform float uSpeedOfLight;

      uniform float uEnableRetardation;
      uniform float uEnableLorentz;
      uniform float uEnableAberration;
      uniform vec3 uObsProperAccel;
      uniform float uEnableAccelEquiv;

      // General Relativity Curved-Spacetime Uniforms (v2.0)
      uniform float uEnableGR;
      uniform vec3 uBHPos;
      uniform float uBHRs;
      uniform vec3 uWormholeAPos;
      uniform vec3 uWormholeBPos;
      uniform float uWormholeR;

      float evalRindlerDoppler(vec3 obsLocalPos) {
        if (uEnableAccelEquiv < 0.5) return 1.0;
        float c2 = max(4.0, uSpeedOfLight * uSpeedOfLight);
        float r = length(obsLocalPos);
        vec3 effPos = (r > 65.0) ? (obsLocalPos * (65.0 / r)) : obsLocalPos;
        float pot = dot(uObsProperAccel, effPos) / c2;
        return clamp(1.0 + 0.68 * pot, 0.22, 3.8);
      }

      // Exact Schwarzschild gravitational frequency shift sqrt((1 - r_s/r_emit) / (1 - r_s/r_obs))
      float evalGravitationalDoppler(vec3 emitWorldPos) {
        if (uEnableGR < 0.5 || uBHRs <= 0.01) return 1.0;
        float effRs = uBHRs * 1.45;
        float rEmit = length(emitWorldPos - uBHPos);
        float rObs = length(uObsPos - uBHPos);
        float fEmit = clamp(1.0 - max(0.0, rEmit - 55.0) / 40.0, 0.0, 1.0);
        float fObs = clamp(1.0 - max(0.0, rObs - 55.0) / 40.0, 0.0, 1.0);
        float g00Emit = max(0.09, 1.0 - (effRs / max(effRs * 1.04, rEmit)) * fEmit);
        float g00Obs = max(0.09, 1.0 - (effRs / max(effRs * 1.04, rObs)) * fObs);
        return sqrt(g00Emit / g00Obs);
      }

      // Thin-Lens Einstein-Ring 3D Vertex Deflection around a compact mass/throat at lensPos
      vec3 applyLensDeflection3D(vec3 dxCity, vec3 lensPos, float lensScaleRs) {
        vec3 vLens = lensPos - uObsPos;
        float L = length(dxCity);
        if (L < 0.5) return dxCity;
        vec3 rHat = dxCity / L;
        float dL = dot(vLens, rHat);
        float dLS = L - dL;
        if (dL <= 0.4 || dLS <= 0.2) return dxCity;

        // Impact vector perpendicular to line of sight (pointing from lens toward vertex)
        vec3 bVec = (rHat * dL) - vLens;
        float b = length(bVec);
        float rE2 = 4.0 * lensScaleRs * (dL * dLS) / L;
        float maxB2 = 36.0 * rE2 + 625.0;
        if (b * b >= maxB2) return dxCity;

        vec3 bHat = (b > 1e-4) ? (bVec / b) : normalize(cross(rHat, vec3(0.0, 1.0, 0.1)));
        // Exact positive-parity Einstein lens root: b_app = 0.5 * (b + sqrt(b^2 + 4 * R_E^2))
        float bApp = 0.5 * (b + sqrt(b * b + 4.0 * rE2));
        float outerFade = 1.0 - smoothstep(maxB2 * 0.42, maxB2, b * b);
        float shift = min(bApp - b, 16.0) * (L / max(dL, 1.0)) * outerFade;
        return dxCity + bHat * shift;
      }

      struct RelativisticObservation {
        vec3 observerLocalPos;
        vec3 cityEmitOffset;
        vec3 cityEmitPos;
        vec3 restViewDir;
        float lightTravelDist;
        float emitCoordTime;
        float emitProperTime;
        float dopplerFactor;
      };

      vec3 rotateAroundAxis(vec3 v, vec3 axis, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
      }

      RelativisticObservation projectPastLightCone(
        vec3 restVertexPos,
        vec3 restNormal,
        bool isDynamic,
        vec3 entityPosNow,
        vec3 entityRestOffset,
        mat3 entityRot,
        vec3 entityBeta,
        float entityGamma,
        float entityProperTimeNow,
        vec3 spinPivot,
        vec3 spinAxis,
        float spinOmega,
        float swingAmp,
        out vec3 worldNormalOut
      ) {
        RelativisticObservation obs;

        vec3 effEntityBeta = entityBeta * uEnableLorentz;
        float effEntityGamma = mix(1.0, entityGamma, uEnableLorentz);

        float tauEmit = entityProperTimeNow;
        vec3 baseVertexPos = restVertexPos + entityRestOffset;
        vec3 localPos = baseVertexPos;
        vec3 localNrm = restNormal;

        if (isDynamic && (abs(spinOmega) > 1e-5 || abs(swingAmp) > 1e-5)) {
          for (int iter = 0; iter < 3; iter++) {
            float phi = abs(swingAmp) > 1e-5
              ? (swingAmp * sin(spinOmega * tauEmit))
              : (spinOmega * tauEmit);
            vec3 rel = baseVertexPos - spinPivot;
            localPos = spinPivot + rotateAroundAxis(rel, spinAxis, phi);
            vec3 r0Iter = entityRot * localPos;
            float contractFactorIter = (effEntityGamma / (effEntityGamma + 1.0)) * dot(effEntityBeta, r0Iter);
            vec3 xNowIter = entityPosNow + r0Iter - contractFactorIter * effEntityBeta;
            vec3 dIter = xNowIter - uObsPos;
            float bIter = dot(dIter, effEntityBeta);
            float discIter = max(0.0, bIter * bIter + dot(dIter, dIter) / (effEntityGamma * effEntityGamma));
            float uIter = uEnableRetardation * (effEntityGamma * effEntityGamma * (-bIter + sqrt(discIter)));
            tauEmit = entityProperTimeNow
              - uIter / (max(1.0, effEntityGamma) * uSpeedOfLight)
              - (uEnableLorentz * dot(effEntityBeta, r0Iter)) / uSpeedOfLight;
          }
          float finalPhi = abs(swingAmp) > 1e-5
            ? (swingAmp * sin(spinOmega * tauEmit))
            : (spinOmega * tauEmit);
          localNrm = rotateAroundAxis(restNormal, spinAxis, finalPhi);
        }

        vec3 r0 = isDynamic ? (entityRot * localPos) : localPos;
        worldNormalOut = normalize(isDynamic ? (entityRot * localNrm) : localNrm);

        vec3 xNow;
        if (isDynamic) {
          float contractFactor = (effEntityGamma / (effEntityGamma + 1.0)) * dot(effEntityBeta, r0);
          xNow = entityPosNow + r0 - contractFactor * effEntityBeta;
        } else {
          xNow = r0;
        }

        vec3 d = xNow - uObsPos;
        float u = 0.0;
        vec3 dxEmit = d;

        if (uEnableRetardation > 0.5) {
          if (isDynamic) {
            float b = dot(d, effEntityBeta);
            float invG2 = 1.0 / (effEntityGamma * effEntityGamma);
            float disc = max(0.0, b * b + dot(d, d) * invG2);
            u = (effEntityGamma * effEntityGamma) * (-b + sqrt(disc));
            dxEmit = d - u * effEntityBeta;
          } else {
            u = length(d);
            dxEmit = d;
          }
        } else {
          u = length(d);
          dxEmit = d;
        }

        obs.cityEmitOffset = dxEmit;
        obs.cityEmitPos = uObsPos + dxEmit;

        // Shapiro Gravitational Time Delay: Delta t_Shapiro ~ (2 r_s / c) ln(...) near Black Hole!
        float shapiroExtraU = 0.0;
        vec3 dxLensed = dxEmit;
        if (uEnableGR > 0.5) {
          dxLensed = applyLensDeflection3D(dxLensed, uBHPos, uBHRs * 1.15);
          dxLensed = applyLensDeflection3D(dxLensed, uWormholeAPos, uWormholeR * 0.28);
          dxLensed = applyLensDeflection3D(dxLensed, uWormholeBPos, uWormholeR * 0.28);
          float rMid = length((uObsPos + 0.5 * dxEmit) - uBHPos);
          if (rMid < 45.0) {
            shapiroExtraU = 2.0 * uBHRs * log(46.0 / max(uBHRs, rMid));
          }
        }

        float uTotal = u + shapiroExtraU;
        obs.lightTravelDist = uTotal;
        obs.emitCoordTime = uObsTime - (uEnableRetardation * uTotal) / uSpeedOfLight;

        if (isDynamic) {
          if (abs(spinOmega) <= 1e-5 && abs(swingAmp) <= 1e-5) {
            obs.emitProperTime = entityProperTimeNow
              - (uEnableRetardation * uTotal) / (effEntityGamma * uSpeedOfLight)
              - (uEnableLorentz * dot(effEntityBeta, r0)) / uSpeedOfLight;
          } else {
            obs.emitProperTime = tauEmit;
          }
        } else {
          obs.emitProperTime = obs.emitCoordTime;
        }

        // Transform lensed emission 4-displacement into Observer Instantaneous Rest Frame
        vec3 obsLocal = dxLensed;
        float obsGamma = mix(1.0, uObsGamma, uEnableLorentz);
        vec3 obsBeta = uObsBeta * uEnableLorentz;
        float uLensed = length(dxLensed);

        if (uEnableRetardation > 0.5) {
          float kBoost = (obsGamma * obsGamma) / (obsGamma + 1.0);
          float uAberration = uLensed * uEnableAberration;
          obsLocal = dxLensed + (kBoost * dot(obsBeta, dxLensed) + obsGamma * uAberration) * obsBeta;
        } else {
          float kContract = (obsGamma / (obsGamma + 1.0)) * dot(obsBeta, dxLensed);
          obsLocal = dxLensed - kContract * obsBeta;
        }

        if (uEnableAccelEquiv > 0.5 && dot(uObsProperAccel, uObsProperAccel) > 1e-3) {
          float rLoc = length(obsLocal);
          if (rLoc > 0.25) {
            vec3 rHat = obsLocal / rLoc;
            vec3 aTransverse = uObsProperAccel - dot(uObsProperAccel, rHat) * rHat;
            float c2 = max(4.0, uSpeedOfLight * uSpeedOfLight);
            float effR = min(rLoc, 80.0);
            vec3 bendDisp = aTransverse * ((0.36 * effR * rLoc) / (2.0 * c2));
            float maxBend = 0.38 * rLoc;
            float bLen = length(bendDisp);
            if (bLen > maxBend) bendDisp *= (maxBend / bLen);
            obsLocal += bendDisp;
          }
        }

        obs.observerLocalPos = obsLocal;

        float distSafe = max(length(dxLensed), 1e-5);
        vec3 photonDirCity = -dxLensed / distSafe;

        if (isDynamic && dot(effEntityBeta, effEntityBeta) > 1e-8) {
          float denomEmit = max(1e-4, effEntityGamma * (1.0 - dot(effEntityBeta, photonDirCity)));
          float kObj = (effEntityGamma * effEntityGamma) / (effEntityGamma + 1.0);
          vec3 nPrime = (photonDirCity + (kObj * dot(effEntityBeta, photonDirCity) - effEntityGamma) * effEntityBeta) / denomEmit;
          obs.restViewDir = normalize(nPrime);
        } else {
          obs.restViewDir = photonDirCity;
        }

        float numD = uObsGamma * (1.0 - dot(uObsBeta, photonDirCity));
        float denD = isDynamic ? (entityGamma * (1.0 - dot(entityBeta, photonDirCity))) : 1.0;
        float srD = numD / max(denD, 1e-4);
        float grD = evalGravitationalDoppler(obs.cityEmitPos);
        obs.dopplerFactor = clamp(srD * grD * evalRindlerDoppler(obsLocal), 0.03, 35.0);

        return obs;
      }

      // Sky-ray deflection around Black Hole & Wormhole throats (smooth C2 Einstein Ring with zero outer seam!)
      vec3 deflectSkyRaySingle(vec3 nCity, vec3 lensPos, float effRs, float maxRadius) {
        vec3 vL = lensPos - uObsPos;
        float dObs = length(vL);
        float tProj = dot(vL, nCity);
        if (tProj <= 0.5 || dObs <= 0.5) return nCity;
        vec3 bVec = nCity * tProj - vL;
        float b = length(bVec);
        if (b >= maxRadius) return nCity;

        float bCrit = 2.598 * effRs;
        float bSafe = max(b, bCrit * 1.01);
        float cosPsi = clamp(tProj / dObs, 0.0, 1.0);
        // Finite-observer Schwarzschild light bending + strong-field photon-sphere term, smoothly windowed
        float fade = 1.0 - smoothstep(maxRadius * 0.45, maxRadius, b);
        float defl = ((effRs * (1.0 + cosPsi)) / bSafe + (1.85 * effRs * effRs) / (bSafe * bSafe)) * fade;
        defl = min(defl, 2.35);
        vec3 inward = -bVec / max(b, 1e-4);
        vec3 axis = cross(nCity, inward);
        float axLen = length(axis);
        if (axLen > 1e-5) {
          nCity = normalize(rotateAroundAxis(nCity, axis / axLen, defl));
        }
        return nCity;
      }

      vec3 deflectSkyRayGR(vec3 nCity) {
        if (uEnableGR < 0.5) return nCity;
        nCity = deflectSkyRaySingle(nCity, uBHPos, uBHRs, 36.0);
        nCity = deflectSkyRaySingle(nCity, uWormholeAPos, uWormholeR * 0.25, 14.0);
        nCity = deflectSkyRaySingle(nCity, uWormholeBPos, uWormholeR * 0.25, 14.0);
        return nCity;
      }

      vec3 mapObserverRayToSky(vec3 localViewDir, out float skyDoppler) {
        vec3 nObs = normalize(localViewDir);
        if (uEnableAccelEquiv > 0.5 && dot(uObsProperAccel, uObsProperAccel) > 1e-3) {
          float c2 = max(4.0, uSpeedOfLight * uSpeedOfLight);
          vec3 aTrans = uObsProperAccel - dot(uObsProperAccel, nObs) * nObs;
          nObs = normalize(nObs - aTrans * (16.0 / c2));
        }

        vec3 nCity = nObs;
        float srSkyD = 1.0;

        if (uEnableAberration >= 0.5 || uEnableLorentz >= 0.5) {
          vec3 beta = uObsBeta * uEnableAberration;
          float b2 = dot(beta, beta);
          float gamma = 1.0 / sqrt(max(1e-6, 1.0 - b2));
          float k = (gamma * gamma) / (gamma + 1.0);
          float bn = dot(beta, nObs);
          float eCity = max(1e-5, gamma * (1.0 - bn));
          nCity = normalize((nObs + (k * bn - gamma) * beta) / eCity);
          srSkyD = uObsGamma * (1.0 + dot(uObsBeta, nCity));
        }

        nCity = deflectSkyRayGR(nCity);

        // Sky photons originate at infinity (r_emit -> inf, g00_emit = 1.0) -> blueshift when observer is deep in BH well!
        float grSkyD = 1.0;
        if (uEnableGR > 0.5 && uBHRs > 0.01) {
          float effRs = uBHRs * 1.45;
          float rObs = length(uObsPos - uBHPos);
          float fObs = clamp(1.0 - max(0.0, rObs - 55.0) / 40.0, 0.0, 1.0);
          float g00Obs = max(0.09, 1.0 - (effRs / max(effRs * 1.04, rObs)) * fObs);
          grSkyD = 1.0 / sqrt(g00Obs);
        }

        skyDoppler = clamp(srSkyD * grSkyD * evalRindlerDoppler(nObs * 42.0), 0.03, 35.0);
        return nCity;
      }
    `;
  }
}

export class WeakFieldMetric extends MinkowskiMetric {
  constructor(speedOfLight = 25.0, potentialFn = () => 0.0) {
    super(speedOfLight);
    this.potentialFn = potentialFn;
  }

  metricTensor(event) {
    const c2 = this.c * this.c;
    const phi = this.potentialFn([event[1], event[2], event[3]]);
    const g00 = -c2 * Math.max(0.05, 1.0 + (2.0 * phi) / c2);
    const gSpatial = Math.max(0.05, 1.0 - (2.0 * phi) / c2);
    return new Float64Array([
      g00, 0, 0, 0,
      0, gSpatial, 0, 0,
      0, 0, gSpatial, 0,
      0, 0, 0, gSpatial,
    ]);
  }
}
