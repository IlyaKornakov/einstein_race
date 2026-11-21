/**
 * Physical Relativistic Rigid-Body Vehicle Dynamics & Racing Camera Controller
 * ============================================================================
 *
 * Replaces simplified 1D scalar speed/rapidity steering with true 3D relativistic
 * momentum-impulse rigid-body dynamics:
 *   1. Translational state is spatial relativistic momentum per unit rest mass:
 *        p_tilde = gamma * v = (px, py, pz)   [m/s]
 *      guaranteeing exact subluminal speed |v| = |p_tilde| / sqrt(1 + |p_tilde|^2 / c^2) < c
 *      for any engine thrust or collision impulse!
 *   2. Independent chassis heading `moveYaw` (psi) and angular velocity `impactYawRate`
 *      so off-center barrier or car-to-car impacts transfer realistic linear rebound,
 *      lateral tire slip/drift, and Newton-Euler yaw spin torque (tau = rx*Jz - rz*Jx).
 *   3. 4-corner Oriented Bounding Box (OBB) barrier collision solver with restitution
 *      (e = 0.34), Coulomb wall friction, and spark emission callback.
 *   4. Three racing camera views (`chase` default, `cockpit` inside the Ferrari 458,
 *      and `bumper`) with coupled steering follow + manual free-look override.
 */

export class VehicleController {
  /**
   * @param {import('./spacetime.js').ObserverState} observer
   * @param {import('./spacetime.js').MinkowskiMetric} metric
   */
  constructor(observer, metric) {
    this.observer = observer;
    this.metric = metric;

    // Ferrari 458 Italia physical parameters
    this.mass = 1480.0;       // [kg]
    this.inertiaY = 2450.0;   // [kg * m^2]
    this.halfW = 1.06;        // [m] half-width
    this.halfL = 2.22;        // [m] half-length
    this.wheelbase = 2.65;    // [m]

    // Spawn on expanded 350m Grand Boulevard Straightaway facing North (-Z)!
    this.carX = 2.6;
    this.footY = 0.01;
    this.carZ = 158.0;
    this.verticalVel = 0.0;

    // 3D spatial relativistic momentum per unit mass: p_tilde = gamma * v [m/s]
    this.px = 0.0;
    this.py = 0.0;
    this.pz = 0.0;

    /** Chassis heading yaw (0 = -Z North, +pi/2 = +X East) */
    this.moveYaw = 0.0;
    /** Velocity vector horizontal yaw (matches moveYaw under grip, diverges during collision skid!) */
    this.velocityYaw = 0.0;
    this.movePitch = 0.0;
    this.roadBank = 0.0;

    /** Post-collision angular yaw velocity [rad/s proper] & temporary tire slip factor [0..1] */
    this.impactYawRate = 0.0;
    this.impactSlip = 0.0;
    this.cameraShake = 0.0;

    /** Front wheel steering angle [-maxSteerRad .. +maxSteerRad] */
    this.steerAngle = 0.0;
    this.maxSteerRad = (33.0 * Math.PI) / 180.0;
    this.wheelSpinAngle = 0.0;
    this.isBraking = false;

    /** Maximum lateral proper tire grip [m/s^2] (~2.45g GT Aero Slick grip for fast sweepers!) */
    this.maxLateralProperAccel = 24.0;

    /** Instantaneous proper G-forces felt in chassis & active terrain surface */
    this.properLongG = 0.0;
    this.properLatG = 0.0;
    this.chassisRoll = 0.0;
    this.chassisPitchJolt = 0.0;
    this.currentTerrain = 'road';
    this.rumblePhase = 0.0;
    this.splashAccum = 0.0;
    this.isThrottling = false;
    this.onCollisionAudio = null;

    /** Signed forward rapidity kept in sync for HUD & preset compatibility */
    this.rapidity = 0.0;
    this.maxBeta = 0.992;

    /** Photon Thruster Boost reservoir [0..1] & Race start gate */
    this.boostEnergy = 1.0;
    this.isBoosting = false;
    this.canDrive = true;
    this.onRecoverRequest = null;

    /** Cruise control */
    this.cruiseControl = false;
    this.cruiseRapidity = 0.0;

    /** Coupled racing camera (`camYaw = moveYaw + lookYawOffset`) */
    this.lookYawOffset = 0.0;
    this.camPitch = -0.075;
    this.recenteringView = false;
    this.camYaw = 0.0;

    /** Camera mode: 'chase' | 'cockpit' | 'bumper' */
    this.viewMode = 'chase';
    this.baseEyeHeight = 1.08;
    this.fovDeg = 72.0;
    this.onViewModeChange = null;

    /** Input state */
    this.keys = new Set();
    this.virtualKeys = new Set();
    /** Continuous analog steering input [-1..+1] from touch steering slider or phone gyro tilt */
    this.analogSteer = 0.0;
    /** Mobile TouchDrive-style Auto-Accelerate (enabled automatically on touch screens, toggleable) */
    this.autoThrottle = false;
    this.pointerLocked = false;
    this.isDraggingLook = false;
    this.activeTouchLookId = null;
    this.lastTapMs = 0;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.brakeZeroHoldTimer = 0.0;

    /** World & entity collision hooks */
    this.getSupportSurface = (_x, _footY, _z) => ({ y: 0.0, bank: 0.0, deck: 'ground' });
    this.queryBarrierContact = (_x, _footY, _z) => ({ hit: false, pen: 0, nx: 0, nz: 0 });
    this.queryVehicleOBBContact = null;
    this.resolveVehicleCollisions = (_vehicle, _dtCoord) => {};
    this.onCollisionSpark = null;

    this._syncObserverPosition();
  }

  setViewMode(mode) {
    if (!['chase', 'cockpit', 'bumper'].includes(mode)) return;
    this.viewMode = mode;
    this.camPitch = mode === 'chase' ? -0.075 : 0.015;
    this._syncObserverPosition();
    if (this.onViewModeChange) this.onViewModeChange(mode);
  }

  cycleViewMode() {
    const order = ['chase', 'cockpit', 'bumper'];
    const next = order[(order.indexOf(this.viewMode) + 1) % order.length];
    this.setViewMode(next);
  }

  bindInputs(canvas) {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const code = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
        e.preventDefault();
      }
      this.keys.add(code);

      if (code === 'KeyC') {
        this.toggleCruiseControl();
      } else if (code === 'KeyR') {
        this.recenteringView = true;
        if (this.onRecoverRequest) {
          this.onRecoverRequest();
        }
      } else if (code === 'KeyV') {
        this.cycleViewMode();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.virtualKeys.clear();
      this.isDraggingLook = false;
      this.activeTouchLookId = null;
    });

    // Touch-drag free-look on WebGL canvas + double-tap canvas to recenter camera
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.changedTouches.length === 0) return;
        const now = performance.now();
        if (now - this.lastTapMs < 280) {
          this.recenteringView = true;
          this.lastTapMs = 0;
          return;
        }
        this.lastTapMs = now;
        if (this.activeTouchLookId !== null) return;
        const t = e.changedTouches[0];
        this.activeTouchLookId = t.identifier;
        this.recenteringView = false;
        this.lastPointerX = t.clientX;
        this.lastPointerY = t.clientY;
      },
      { passive: true }
    );

    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (this.activeTouchLookId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.activeTouchLookId) {
            const dx = t.clientX - this.lastPointerX;
            const dy = t.clientY - this.lastPointerY;
            this.lastPointerX = t.clientX;
            this.lastPointerY = t.clientY;
            const sens = 0.0042;
            this.lookYawOffset = this._wrapPi(this.lookYawOffset + dx * sens);
            this.camPitch = Math.max(-1.25, Math.min(1.25, this.camPitch - dy * sens));
            break;
          }
        }
      },
      { passive: true }
    );

    const endTouchLook = (e) => {
      if (this.activeTouchLookId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.activeTouchLookId) {
          this.activeTouchLookId = null;
          break;
        }
      }
    };
    window.addEventListener('touchend', endTouchLook, { passive: true });
    window.addEventListener('touchcancel', endTouchLook, { passive: true });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        this.recenteringView = true;
        return;
      }
      if (e.button !== 0) return;
      this.isDraggingLook = true;
      this.recenteringView = false;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('dblclick', () => {
      if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });

    window.addEventListener('mouseup', () => {
      this.isDraggingLook = false;
    });

    window.addEventListener('mousemove', (e) => {
      const sens = 0.0025;
      if (this.pointerLocked) {
        this.recenteringView = false;
        this.lookYawOffset = this._wrapPi(this.lookYawOffset + e.movementX * sens);
        this.camPitch = Math.max(-1.25, Math.min(1.25, this.camPitch - e.movementY * sens));
      } else if (this.isDraggingLook) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.lookYawOffset = this._wrapPi(this.lookYawOffset + dx * sens * 1.35);
        this.camPitch = Math.max(-1.25, Math.min(1.25, this.camPitch - dy * sens * 1.35));
      }
    });

    canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  _wrapPi(a) {
    let r = (a + Math.PI) % (2.0 * Math.PI);
    if (r < 0) r += 2.0 * Math.PI;
    return r - Math.PI;
  }

  resetCameraOffset() {
    this.lookYawOffset = 0.0;
    this.camPitch = this.viewMode === 'chase' ? -0.075 : 0.015;
    this.recenteringView = false;
    this.camYaw = this.moveYaw;
  }

  teleportTo(x, footY, z, yaw = 0.0) {
    this.carX = x;
    this.footY = footY;
    this.carZ = z;
    this.verticalVel = 0.0;
    this.px = 0.0;
    this.py = 0.0;
    this.pz = 0.0;
    this.rapidity = 0.0;
    this.impactYawRate = 0.0;
    this.impactSlip = 0.0;
    this.cameraShake = 0.0;
    this.moveYaw = yaw;
    this.velocityYaw = yaw;
    this.movePitch = 0.0;
    this.cruiseControl = false;
    this.resetCameraOffset();
    this.observer.velocity.fill(0);
    this.observer.beta.fill(0);
    this.observer.gamma = 1.0;
    this.observer.properAcceleration.fill(0);
    this.observer.thomasPrecessionRad = 0.0;
    this._syncObserverPosition();
  }

  toggleCruiseControl(forceState = undefined) {
    this.cruiseControl = forceState !== undefined ? forceState : !this.cruiseControl;
    if (this.cruiseControl) {
      this.cruiseRapidity = Math.max(0.0, this.rapidity);
    }
  }

  setBetaDirect(targetBeta) {
    const c = this.metric.c;
    const clamped = Math.max(-0.32, Math.min(this.maxBeta, targetBeta));
    this.rapidity = Math.atanh(clamped);
    const gamma = 1.0 / Math.sqrt(Math.max(1e-6, 1.0 - clamped * clamped));
    const pMag = gamma * clamped * c;
    const fwdX = Math.sin(this.moveYaw);
    const fwdZ = -Math.cos(this.moveYaw);
    this.px = pMag * fwdX * Math.cos(this.movePitch);
    this.py = pMag * Math.sin(this.movePitch);
    this.pz = pMag * fwdZ * Math.cos(this.movePitch);
    this.impactYawRate = 0.0;
    this.impactSlip = 0.0;
    if (this.cruiseControl) {
      this.cruiseRapidity = Math.max(0.0, this.rapidity);
    }
  }

  adjustTargetBeta(deltaBeta) {
    const curBeta = Math.tanh(this.rapidity);
    const nextBeta = Math.max(0.0, Math.min(this.maxBeta, curBeta + deltaBeta));
    this.setBetaDirect(nextBeta);
    this.cruiseControl = nextBeta > 0.002;
    this.cruiseRapidity = this.rapidity;
  }

  /**
   * Applies a physical 2D horizontal collision impulse `J = (Jx, Jz)` [N*s = kg*m/s]
   * at world contact point `(cpx, cpz)`.
   */
  applyRigidBodyImpulse(Jx, Jz, cpx, cpz) {
    const dPx = Jx / this.mass;
    const dPz = Jz / this.mass;
    const dvMag = Math.hypot(dPx, dPz);

    this.px += dPx;
    this.pz += dPz;

    // Lever arm from car center of mass -> exact yaw torque tau = rx * Jz - rz * Jx
    const rx = cpx - this.carX;
    const rz = cpz - this.carZ;
    const torqueY = rx * Jz - rz * Jx;
    const dOmega = Math.max(-3.6, Math.min(3.6, torqueY / this.inertiaY));
    this.impactYawRate = Math.max(-4.5, Math.min(4.5, this.impactYawRate + dOmega));

    // Break tire grip momentarily proportional to impact severity so the car physically rebounds/skids!
    const slipAdd = Math.min(0.92, dvMag / Math.max(4.0, this.metric.c * 0.28));
    this.impactSlip = Math.max(this.impactSlip, slipAdd);
    this.cameraShake = Math.min(0.28, this.cameraShake + dvMag * 0.016);
    this.chassisPitchJolt = Math.max(-0.06, Math.min(0.06, -dvMag * 0.006));

    // Disengage cruise control on significant impact so the car doesn't re-ram automatically
    if (dvMag > 1.8 && this.cruiseControl) {
      this.cruiseControl = false;
    }
    if (this.onCollisionAudio && dvMag > 0.6) {
      this.onCollisionAudio(Math.min(1.0, dvMag / Math.max(4.0, this.metric.c * 0.32)));
    }
  }

  setVirtualKey(code, pressed) {
    if (pressed) {
      this.virtualKeys.add(code);
    } else {
      this.virtualKeys.delete(code);
    }
  }

  _hasInput(code) {
    return this.keys.has(code) || this.virtualKeys.has(code);
  }

  update(dtProper) {
    const dt = Math.min(0.05, Math.max(0.0001, dtProper));
    const c = this.metric.c;
    const c2 = c * c;

    const brake = this.canDrive && (this._hasInput('KeyS') || this._hasInput('ArrowDown'));
    const handbrake = this._hasInput('Space');
    const wantBoost = this.canDrive && (this._hasInput('ShiftLeft') || this._hasInput('ShiftRight'));
    const manualThrottle = this._hasInput('KeyW') || this._hasInput('ArrowUp') || wantBoost;
    const throttle = this.canDrive && (manualThrottle || (this.autoThrottle && !brake && !handbrake));
    const steerLeft = this.canDrive && (this._hasInput('KeyA') || this._hasInput('ArrowLeft'));
    const steerRight = this.canDrive && (this._hasInput('KeyD') || this._hasInput('ArrowRight'));
    this.isBraking = brake || handbrake;

    if (wantBoost && throttle && this.boostEnergy > 0.02) {
      this.isBoosting = true;
      this.boostEnergy = Math.max(0.0, this.boostEnergy - 0.19 * dt);
    } else {
      this.isBoosting = false;
      this.boostEnergy = Math.min(1.0, this.boostEnergy + (handbrake ? 0.45 : 0.26) * dt);
    }
    const boost = this.isBoosting;

    // Free-look camera offset controls
    const keyLookSpeed = 1.75 * dt;
    if (this.keys.has('KeyJ') || this.keys.has('KeyQ')) {
      this.recenteringView = false;
      this.lookYawOffset = this._wrapPi(this.lookYawOffset - keyLookSpeed);
    }
    if (this.keys.has('KeyL') || this.keys.has('KeyE')) {
      this.recenteringView = false;
      this.lookYawOffset = this._wrapPi(this.lookYawOffset + keyLookSpeed);
    }
    if (this.keys.has('KeyI')) {
      this.recenteringView = false;
      this.camPitch = Math.min(1.25, this.camPitch + keyLookSpeed * 0.8);
    }
    if (this.keys.has('KeyK')) {
      this.recenteringView = false;
      this.camPitch = Math.max(-1.25, this.camPitch - keyLookSpeed * 0.8);
    }

    const defaultPitch = this.viewMode === 'chase' ? -0.075 : 0.015;
    if (this.recenteringView) {
      const kSnap = Math.min(1.0, 10.0 * dt);
      this.lookYawOffset *= 1.0 - kSnap;
      this.camPitch += (defaultPitch - this.camPitch) * kSnap;
      if (Math.abs(this.lookYawOffset) < 0.003 && Math.abs(this.camPitch - defaultPitch) < 0.003) {
        this.lookYawOffset = 0.0;
        this.camPitch = defaultPitch;
        this.recenteringView = false;
      }
    }

    // Sample active terrain surface (`'road' | 'sidewalk' | 'plaza' | 'grass' | 'sand' | 'water'`)
    const preSurf = this.getSupportSurface(this.carX, this.footY, this.carZ);
    this.currentTerrain = preSurf.terrain || 'road';

    let terrainExtraDrag = 0.0;
    let terrainTraction = 1.0;
    let terrainLatGrip = 1.0;
    let terrainRumbleAmp = 0.0;

    if (this.currentTerrain === 'sidewalk' || this.currentTerrain === 'plaza') {
      terrainExtraDrag = 0.06;
      terrainTraction = 0.94;
      terrainLatGrip = 0.92;
      terrainRumbleAmp = 0.003;
    } else if (this.currentTerrain === 'grass') {
      terrainExtraDrag = 0.88;
      terrainTraction = 0.58;
      terrainLatGrip = 0.66;
      terrainRumbleAmp = 0.011;
    } else if (this.currentTerrain === 'sand') {
      terrainExtraDrag = 1.45;
      terrainTraction = 0.48;
      terrainLatGrip = 0.52;
      terrainRumbleAmp = 0.015;
    } else if (this.currentTerrain === 'water') {
      terrainExtraDrag = 2.35;
      terrainTraction = 0.40;
      terrainLatGrip = 0.45;
      terrainRumbleAmp = 0.018;
    }

    this.isThrottling = throttle;

    // Current chassis horizontal basis
    let fwdX = Math.sin(this.moveYaw);
    let fwdZ = -Math.cos(this.moveYaw);
    let rightX = Math.cos(this.moveYaw);
    let rightZ = Math.sin(this.moveYaw);

    // Decompose horizontal relativistic momentum per unit mass into chassis forward & lateral
    let pFwd = this.px * fwdX + this.pz * fwdZ;
    let pLat = this.px * rightX + this.pz * rightZ;
    const prevPFwd = pFwd;

    // 1. Brisk Relativistic GT Supercar Thrust (~1.17g normal, ~1.88g Boost) & Carbon-Ceramic Braking (~1.84g)
    //    Reaches 0.85c-0.94c well along the 350m straightaway without instant 14g snap!
    const cScale = Math.min(2.4, Math.max(0.65, c / 25.0));
    const engineProperAccel = (boost ? 18.5 : 11.5) * cScale * terrainTraction;
    const brakeProperDecel = 18.0 * cScale * (0.68 + 0.32 * terrainTraction);
    const maxBetaClamped = Math.min(0.992, this.maxBeta);
    const maxPFwd = (maxBetaClamped * c) / Math.sqrt(1.0 - maxBetaClamped * maxBetaClamped);
    const minPFwd = -(0.32 * c) / Math.sqrt(1.0 - 0.10);

    if (handbrake) {
      this.cruiseControl = false;
      pFwd *= Math.exp(-3.6 * dt);
      pLat *= Math.exp(-2.2 * dt);
      if (Math.abs(pFwd) < 0.04) pFwd = 0.0;
    } else if (throttle) {
      this.brakeZeroHoldTimer = 0.0;
      if (pFwd < 0.0) {
        pFwd = Math.min(0.0, pFwd + brakeProperDecel * 1.45 * dt);
      } else {
        pFwd += engineProperAccel * dt;
        pFwd *= Math.exp(-(0.028 + terrainExtraDrag) * dt);
      }
      pFwd = Math.min(maxPFwd, pFwd);
      if (this.cruiseControl) {
        const bCur = (pFwd / Math.sqrt(c2 + pFwd * pFwd));
        this.cruiseRapidity = Math.atanh(Math.max(0.0, Math.min(maxBetaClamped, bCur)));
      }
    } else if (brake) {
      if (pFwd > 0.08) {
        pFwd = Math.max(0.0, pFwd - brakeProperDecel * dt);
        this.brakeZeroHoldTimer = 0.0;
      } else {
        this.brakeZeroHoldTimer += dt;
        if (this.brakeZeroHoldTimer > 0.22) {
          this.cruiseControl = false;
          pFwd = Math.max(minPFwd, pFwd - 7.5 * cScale * terrainTraction * dt);
        } else {
          pFwd = 0.0;
        }
      }
      if (terrainExtraDrag > 0.0) {
        pFwd *= Math.exp(-terrainExtraDrag * dt);
      }
      if (this.cruiseControl) {
        const bCur = Math.max(0.0, pFwd / Math.sqrt(c2 + pFwd * pFwd));
        this.cruiseRapidity = Math.atanh(Math.min(maxBetaClamped, bCur));
      }
    } else if (this.cruiseControl) {
      this.brakeZeroHoldTimer = 0.0;
      const targetBeta = Math.tanh(this.cruiseRapidity);
      const targetP = (targetBeta * c) / Math.sqrt(Math.max(1e-6, 1.0 - targetBeta * targetBeta));
      pFwd += (targetP - pFwd) * Math.min(1.0, 4.5 * terrainTraction * dt);
      if (terrainExtraDrag > 0.0) {
        pFwd *= Math.exp(-terrainExtraDrag * dt);
      }
    } else {
      this.brakeZeroHoldTimer = 0.0;
      // Rolling resistance + aerodynamic drag + off-road turf/sand/water drag
      pFwd *= Math.exp(-(0.20 + terrainExtraDrag) * dt);
      if (Math.abs(pFwd) < 0.025) pFwd = 0.0;
    }

    pFwd = Math.max(minPFwd, Math.min(maxPFwd, pFwd));

    // 2. Relativistic Ackerman + Tire-Grip Steering (supports smooth analog mobile touch/tilt!)
    const keySteer = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
    const analogClamped = this.canDrive ? Math.max(-1.0, Math.min(1.0, this.analogSteer)) : 0.0;
    const rawSteer = keySteer !== 0
      ? keySteer
      : Math.sign(analogClamped) * Math.pow(Math.abs(analogClamped), 1.28);
    const targetSteerAngle = rawSteer * this.maxSteerRad;
    this.steerAngle += (targetSteerAngle - this.steerAngle) * Math.min(1.0, 14.0 * dt);

    const gammaHoriz = Math.sqrt(1.0 + (pFwd * pFwd + pLat * pLat) / c2);
    const vFwd = pFwd / gammaHoriz;
    const absSpeed = Math.abs(vFwd);

    const effectiveMaxLatAccel = this.maxLateralProperAccel * terrainLatGrip;
    let steerYawRate = 0.0;
    if (absSpeed > 0.05 && Math.abs(this.steerAngle) > 1e-4) {
      const kinProperRate = (gammaHoriz * absSpeed / this.wheelbase) * Math.abs(Math.tan(this.steerAngle));
      const gripMaxProperRate = effectiveMaxLatAccel / Math.max(0.25, gammaHoriz * absSpeed);
      const magRate = Math.min(kinProperRate, gripMaxProperRate);
      // Reverse steering yaw direction cleanly when backing up in reverse gear, consistent in forward gear
      const revSign = vFwd < -0.15 ? -1.0 : 1.0;
      steerYawRate = Math.sign(this.steerAngle) * magRate * revSign;
    }

    // Decay post-collision angular spin & tire slip via physical tire scrub damping
    this.impactYawRate *= Math.exp(-4.8 * dt);
    if (Math.abs(this.impactYawRate) < 0.005) this.impactYawRate = 0.0;
    this.impactSlip = Math.max(0.0, this.impactSlip - 1.85 * terrainLatGrip * dt);
    this.cameraShake *= Math.exp(-9.0 * dt);
    this.chassisPitchJolt *= Math.exp(-8.0 * dt);

    const gripFraction = (1.0 - 0.82 * this.impactSlip) * (0.35 + 0.65 * terrainLatGrip);
    const totalYawRate = steerYawRate * (1.0 - 0.82 * this.impactSlip) + this.impactYawRate;
    const dYaw = totalYawRate * dt;

    // Update chassis heading
    this.moveYaw = this._wrapPi(this.moveYaw + dYaw);
    fwdX = Math.sin(this.moveYaw);
    fwdZ = -Math.cos(this.moveYaw);
    rightX = Math.cos(this.moveYaw);
    rightZ = Math.sin(this.moveYaw);

    // Under tire grip, steering turns the momentum vector with the chassis; during impact slip,
    // momentum stays in world space and tires scrub lateral slip `pLat` down via Coulomb friction!
    const oldWorldPx = pFwd * Math.sin(this.moveYaw - dYaw) + pLat * Math.cos(this.moveYaw - dYaw);
    const oldWorldPz = -pFwd * Math.cos(this.moveYaw - dYaw) + pLat * Math.sin(this.moveYaw - dYaw);

    const turnedPx = pFwd * fwdX + pLat * rightX;
    const turnedPz = pFwd * fwdZ + pLat * rightZ;

    this.px = oldWorldPx * (1.0 - gripFraction) + turnedPx * gripFraction;
    this.pz = oldWorldPz * (1.0 - gripFraction) + turnedPz * gripFraction;

    // Apply physical lateral tire scrub friction against remaining lateral slip velocity
    const curPLat = this.px * rightX + this.pz * rightZ;
    const maxLatImpulsePerMass = effectiveMaxLatAccel * (0.55 + 0.45 * gripFraction) * dt;
    const latCorrection = Math.max(-maxLatImpulsePerMass, Math.min(maxLatImpulsePerMass, -curPLat * Math.min(1.0, 12.0 * dt)));
    this.px += rightX * latCorrection;
    this.pz += rightZ * latCorrection;

    // 3. 3D Spline Elevation, Slope & Banking Tracking
    const surfNow = this.getSupportSurface(this.carX, this.footY, this.carZ);
    const surfAhead = this.getSupportSurface(this.carX + fwdX * 1.8, this.footY + 0.65, this.carZ + fwdZ * 1.8);

    let rampSlope = 0.0;
    if (Math.abs(surfAhead.y - surfNow.y) < 2.2) {
      rampSlope = Math.max(-0.78, Math.min(0.78, (surfAhead.y - surfNow.y) / 1.8));
    }
    this.movePitch += (rampSlope - this.movePitch) * Math.min(1.0, 14.0 * dt);
    this.roadBank += ((surfNow.bank || 0.0) - this.roadBank) * Math.min(1.0, 10.0 * dt);

    const pHorizMag = Math.hypot(this.px, this.pz);
    const pSignedFwd = this.px * fwdX + this.pz * fwdZ;
    const deckGap = this.footY - surfNow.y;

    if (deckGap > 0.22) {
      this.verticalVel -= 9.81 * dt;
      this.py = this.verticalVel * gammaHoriz;
    } else {
      this.verticalVel = 0.0;
      this.py = pSignedFwd * Math.tan(this.movePitch);
    }

    // Recover exact subluminal coordinate velocity v = p_tilde / sqrt(1 + |p_tilde|^2 / c^2)
    const pTotal2 = this.px * this.px + this.py * this.py + this.pz * this.pz;
    const gammaExact = Math.sqrt(1.0 + pTotal2 / c2);
    this.observer.velocity[0] = this.px / gammaExact;
    this.observer.velocity[1] = this.py / gammaExact;
    this.observer.velocity[2] = this.pz / gammaExact;

    // Advance clocks & observer tetrad via SpacetimeMetric
    const prevObsX = this.observer.event[1];
    const prevObsY = this.observer.event[2];
    const prevObsZ = this.observer.event[3];
    const dtCoord = this.metric.stepObserver(this.observer, dt);

    // Advance car rigid-body world position by the exact coordinate displacement
    this.carX += this.observer.event[1] - prevObsX;
    this.footY += this.observer.event[2] - prevObsY;
    this.carZ += this.observer.event[3] - prevObsZ;

    // Spin wheels proportionally to proper forward distance traveled (radius ~ 0.358m)
    const vFwdCoord = this.observer.velocity[0] * fwdX + this.observer.velocity[2] * fwdZ;
    this.wheelSpinAngle = (this.wheelSpinAngle + (vFwdCoord * dtCoord) / 0.358) % (Math.PI * 200.0);

    // Emit splash / sand spray particles when driving rapidly through Lagoon water or Sand traps!
    if ((this.currentTerrain === 'water' || this.currentTerrain === 'sand') && Math.abs(vFwdCoord) > 1.2) {
      this.splashAccum += dt;
      if (this.splashAccum > 0.045 && this.onCollisionSpark) {
        this.splashAccum = 0.0;
        this.onCollisionSpark(
          this.carX - fwdX * 1.1,
          this.footY + 0.25,
          this.carZ - fwdZ * 1.1,
          0.0,
          1.0,
          this.currentTerrain === 'water' ? 0.55 : 0.30
        );
      }
    }

    // 4. Physical 4-Corner OBB Highway Barrier & Solid World Obstacle Solver
    this._solveBarrierCollisions();

    // 5. Physical OBB Car-to-Car Relativistic COM Momentum-Impulse Solver
    this.resolveVehicleCollisions(this, dtCoord);

    // Recompute observer velocity & beta after any collision impulses so frame shaders match!
    const postP2 = this.px * this.px + this.py * this.py + this.pz * this.pz;
    const postGamma = Math.sqrt(1.0 + postP2 / c2);
    this.observer.velocity[0] = this.px / postGamma;
    this.observer.velocity[1] = this.py / postGamma;
    this.observer.velocity[2] = this.pz / postGamma;
    this.observer.beta[0] = this.observer.velocity[0] / c;
    this.observer.beta[1] = this.observer.velocity[1] / c;
    this.observer.beta[2] = this.observer.velocity[2] / c;
    this.observer.gamma = postGamma;

    // Sync signed forward rapidity & velocityYaw for HUD telemetry
    const postPFwd = this.px * fwdX + this.pz * fwdZ;
    const signedBeta = Math.max(-0.995, Math.min(0.995, (postPFwd / postGamma) / c));
    this.rapidity = Math.atanh(signedBeta);

    if (pHorizMag > 0.15) {
      this.velocityYaw = Math.atan2(this.px, -this.pz);
    } else {
      this.velocityYaw = this.moveYaw;
    }

    // Exact 3D Proper Acceleration Vector `a' = a_long * fwd + (p_fwd * dpsi/dtau) * right`
    // Feeds Einstein Equivalence-Principle / Rindler optics during turns, braking, and thruster boost!
    const rawALong = Math.max(-2.6 * c, Math.min(2.6 * c, (postPFwd - prevPFwd) / dt));
    const rawALat = Math.max(-2.8 * c, Math.min(2.8 * c, postPFwd * totalYawRate));
    const targetAx = fwdX * rawALong + rightX * rawALat;
    const targetAz = fwdZ * rawALong + rightZ * rawALat;
    const accelSmooth = Math.min(1.0, 11.0 * dt);
    this.observer.properAcceleration[0] += (targetAx - this.observer.properAcceleration[0]) * accelSmooth;
    this.observer.properAcceleration[1] += (0.0 - this.observer.properAcceleration[1]) * accelSmooth;
    this.observer.properAcceleration[2] += (targetAz - this.observer.properAcceleration[2]) * accelSmooth;

    // Accumulate Thomas Precession `dtheta_T = (gamma - 1) * dpsi` during relativistic cornering!
    this.observer.thomasPrecessionRad += (postGamma - 1.0) * dYaw;

    // G-forces, off-road turf rumble & suspension roll
    this.properLongG = rawALong / 9.81;
    this.properLatG = rawALat / 9.81;
    if (terrainRumbleAmp > 0.0 && Math.abs(vFwdCoord) > 0.4) {
      this.rumblePhase = (this.rumblePhase + Math.abs(vFwdCoord) * dt * 5.2) % (Math.PI * 20.0);
    }
    const rumbleRoll = terrainRumbleAmp * Math.sin(this.rumblePhase * 2.3) * Math.min(1.0, Math.abs(vFwdCoord) / 4.0);
    const targetRoll = Math.max(-0.065, Math.min(0.065, -this.properLatG * 0.011)) + this.roadBank + rumbleRoll;
    this.chassisRoll += (targetRoll - this.chassisRoll) * Math.min(1.0, 10.0 * dt);

    // Settle vertical foot height onto active track/terrain deck with strict non-penetration invariant!
    const finalSurf = this.getSupportSurface(this.carX, this.footY, this.carZ);
    this.currentTerrain = finalSurf.terrain || this.currentTerrain;
    const rumbleY = terrainRumbleAmp * 1.6 * Math.abs(Math.sin(this.rumblePhase * 3.1)) * Math.min(1.0, Math.abs(vFwdCoord) / 4.0);
    const targetFootY = finalSurf.y + rumbleY;
    if (this.footY < targetFootY) {
      // Hard solid-earth floor invariant: vehicle can NEVER sink below active support surface!
      this.footY = targetFootY;
      this.verticalVel = Math.max(0.0, this.verticalVel);
    } else if (this.footY <= targetFootY + 0.28) {
      this.footY += (targetFootY - this.footY) * Math.min(1.0, 22.0 * dt);
      this.verticalVel = 0.0;
    }

    // Coupled racing camera yaw + subtle collision shake
    this.camYaw = this._wrapPi(this.moveYaw + this.lookYawOffset);
    this._syncObserverPosition();
  }

  _solveBarrierCollisions() {
    const c = this.metric.c;
    const c2 = c * c;

    // Run up to 4 Gauss-Seidel solid-OBB depenetration passes per frame so narrow columns,
    // tight corners, or pier edges can NEVER trap or wedge the vehicle!
    for (let iter = 0; iter < 4; iter++) {
      let deepest = null;

      if (this.queryVehicleOBBContact) {
        const res = this.queryVehicleOBBContact(
          this.carX,
          this.footY,
          this.carZ,
          this.halfW,
          this.halfL,
          this.moveYaw
        );
        if (res.hit) deepest = res;
      } else {
        const fwdX = Math.sin(this.moveYaw), fwdZ = -Math.cos(this.moveYaw);
        const rightX = Math.cos(this.moveYaw), rightZ = Math.sin(this.moveYaw);
        for (const [lx, lz] of [
          [-this.halfW, -this.halfL], [this.halfW, -this.halfL], [0.0, -this.halfL],
          [-this.halfW, this.halfL], [this.halfW, this.halfL], [0.0, this.halfL],
          [-this.halfW, 0.0], [this.halfW, 0.0], [0.0, 0.0],
        ]) {
          const wx = this.carX + rightX * lx - fwdX * lz;
          const wz = this.carZ + rightZ * lx - fwdZ * lz;
          const res = this.queryBarrierContact(wx, this.footY, wz);
          if (res.hit && (!deepest || res.pen > deepest.pen)) {
            deepest = { ...res, wx, wz };
          }
        }
      }

      if (!deepest) break;

      const { pen, nx, nz, wx, wz } = deepest;
      // 1. Clean positional depenetration completely outside solid obstacle
      const push = pen + 0.025;
      this.carX += nx * push;
      this.carZ += nz * push;

      // 2. Relativistic rigid-body wall impulse with low scrape friction (`0.06`) so car slides smoothly along columns/walls!
      const p2 = this.px * this.px + this.py * this.py + this.pz * this.pz;
      const gamma = Math.sqrt(1.0 + p2 / c2);
      const vx = this.px / gamma;
      const vz = this.pz / gamma;

      const rx = wx - this.carX;
      const rz = wz - this.carZ;
      const vPtX = vx - rz * this.impactYawRate;
      const vPtZ = vz + rx * this.impactYawRate;

      const vRelN = vPtX * nx + vPtZ * nz;
      if (vRelN >= 0.0) continue; // Already separating from obstacle

      const restitution = iter === 0 ? 0.36 : 0.05;
      const frictionMu = 0.06;
      const rCrossN = rx * nz - rz * nx;
      const invEffMass = 1.0 / (this.mass * gamma) + (rCrossN * rCrossN) / (this.inertiaY * gamma);
      const Jn = (-(1.0 + restitution) * vRelN) / invEffMass;

      let tx = vPtX - vRelN * nx;
      let tz = vPtZ - vRelN * nz;
      const tMag = Math.hypot(tx, tz);
      let Jt = 0.0;
      if (tMag > 1e-4) {
        tx /= tMag;
        tz /= tMag;
        const vRelT = vPtX * tx + vPtZ * tz;
        const JtMax = frictionMu * Jn;
        Jt = Math.max(-JtMax, Math.min(JtMax, -vRelT / invEffMass));
      }

      const Jx = Jn * nx + Jt * tx;
      const Jz = Jn * nz + Jt * tz;
      this.applyRigidBodyImpulse(Jx, Jz, wx, wz);

      if (iter === 0 && this.onCollisionSpark && Jn / this.mass > 0.85) {
        this.onCollisionSpark(wx, this.footY + 0.55, wz, nx, nz, Math.min(1.0, (Jn / this.mass) / 6.0));
      }
    }
  }

  /**
   * Synchronizes `observer.event[1..3]` (camera world eye position) from `carPos` and `viewMode`.
   */
  _syncObserverPosition() {
    const fwdX = Math.sin(this.moveYaw);
    const fwdZ = -Math.cos(this.moveYaw);
    const rightX = Math.cos(this.moveYaw);
    const rightZ = Math.sin(this.moveYaw);

    const shakeX = this.cameraShake > 1e-4 ? (Math.random() - 0.5) * this.cameraShake : 0.0;
    const shakeY = this.cameraShake > 1e-4 ? (Math.random() - 0.5) * this.cameraShake * 0.7 : 0.0;

    if (this.viewMode === 'cockpit') {
      // Exact left-hand driver eye position inside `ferrari.glb` (-0.346, 1.07, 0.06)
      const lx = -0.346 + shakeX * 0.25;
      const ly = 1.07 + shakeY * 0.25;
      const lz = 0.06;
      this.observer.event[1] = this.carX + rightX * lx - fwdX * lz;
      this.observer.event[2] = this.footY + ly;
      this.observer.event[3] = this.carZ + rightZ * lx - fwdZ * lz;
    } else if (this.viewMode === 'bumper') {
      const lz = -1.75;
      this.observer.event[1] = this.carX - fwdX * lz + shakeX * 0.25;
      this.observer.event[2] = this.footY + 1.05 + shakeY * 0.25;
      this.observer.event[3] = this.carZ - fwdZ * lz;
    } else {
      // Dynamic GT Racing Chase View behind the Ferrari (clamped inside road barriers!)
      const camFwdX = Math.sin(this.camYaw);
      const camFwdZ = -Math.cos(this.camYaw);
      const chaseDist = 5.15;
      const chaseHeight = 1.82;
      let cx = this.carX - camFwdX * chaseDist;
      let cz = this.carZ - camFwdZ * chaseDist;
      const bCam = this.queryBarrierContact(cx, this.footY, cz);
      if (bCam.hit) {
        cx += bCam.nx * (bCam.pen + 0.35);
        cz += bCam.nz * (bCam.pen + 0.35);
      }
      const camSurf = this.getSupportSurface(cx, this.footY, cz);
      this.observer.event[1] = cx + shakeX;
      this.observer.event[2] = Math.max(camSurf.y + 0.58, this.footY + chaseHeight) + shakeY;
      this.observer.event[3] = cz;
    }
  }
}
