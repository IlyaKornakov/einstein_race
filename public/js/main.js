/**
 * Relativistic Grand Prix — Main Game Loop, Rest-Frame Radar & Twin-Paradox Race Manager
 */

import { ObserverState, GeneralRelativityMetric } from './physics/spacetime.js?v=2.1';
import { wavelengthToDisplaySRGB } from './physics/spectral.js?v=2.1';
import { VehicleController } from './physics/vehicle.js?v=2.1';
import { RelativisticShaderSystem } from './render/relativisticMaterial.js?v=2.1';
import { buildPBRMaterialLibrary } from './render/textures.js?v=2.1';
import { buildCityWorld } from './world/cityBuilder.js?v=2.1';
import { EntityManager } from './world/entities.js?v=2.1';
import { GeneralRelativitySystem } from './world/generalRelativity.js?v=2.1';
import { RelativisticRenderer } from './render/renderer.js?v=2.1';
import { RelativisticAudioEngine } from './audio/relativisticAudio.js?v=2.1';

function formatClock(seconds) {
  const s = Math.max(0, seconds);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
}

function formatTimeOfDay(hoursFloat) {
  const hNorm = ((hoursFloat % 24.0) + 24.0) % 24.0;
  const hh = Math.floor(hNorm);
  const mm = Math.floor((hNorm - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function ordinalPlace(n) {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * Builds the Observer Instantaneous Rest-Frame Relativistic Radar (`#minimapCanvas`).
 *
 * In `Viewer` mode (default), every world displacement dx = x - x_obs is Lorentz-contracted
 * along the viewer's instantaneous velocity direction beta_hat by 1/gamma:
 *   dx' = dx - (1 - 1/gamma) * (dx . beta_hat) * beta_hat
 * and rotated so the viewer's gaze (`camYaw`) points UP!
 */
function createRelativisticRadar(canvas, titleEl, toggleBtn, cityWorld, metric) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  let viewerFrame = true;
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      viewerFrame = !viewerFrame;
      toggleBtn.textContent = viewerFrame ? 'Viewer' : 'City';
    });
  }

  // Downsample track polylines slightly (every 2nd frame) for ~0.04ms crisp 60Hz Lorentz projection
  const groundPts = cityWorld.track.groundData.frames.filter((_, i) => i % 2 === 0).map((f) => [f.pos.x, f.pos.z]);
  const skywayPts = cityWorld.track.skywayData.frames.filter((_, i) => i % 2 === 0).map((f) => [f.pos.x, f.pos.z]);
  const slingshotPts = (cityWorld.track.slingshotData?.frames || []).map((f) => [f.pos.x, f.pos.z]);

  // Bounds for static City-frame comparison mode
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of [...groundPts, ...skywayPts]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const worldCX = 0.5 * (minX + maxX);
  const worldCZ = 0.5 * (minZ + maxZ);
  const cityScale = (W - 28) / Math.max(maxX - minX + 30, maxZ - minZ + 30);

  return function renderRadar(observer, vehicle, entities) {
    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // Circular radar clip
    ctx.beginPath();
    ctx.arc(W * 0.5, H * 0.5, W * 0.5 - 1, 0, Math.PI * 2);
    ctx.clip();

    const gamma = observer.gamma;
    const invGamma = 1.0 / Math.max(1.0, gamma);

    if (titleEl) {
      titleEl.textContent = viewerFrame
        ? `VIEWER FRAME (${invGamma.toFixed(2)}×)`
        : 'CITY REST FRAME';
    }

    const ox = vehicle.carX;
    const oz = vehicle.carZ;
    const bx = observer.beta[0];
    const bz = observer.beta[2];
    const bHoriz = Math.hypot(bx, bz);
    const bHatX = bHoriz > 1e-4 ? bx / bHoriz : 0.0;
    const bHatZ = bHoriz > 1e-4 ? bz / bHoriz : -1.0;
    const contractK = viewerFrame && bHoriz > 1e-4 ? (1.0 - invGamma) : 0.0;

    const psi = vehicle.camYaw;
    const cosPsi = Math.cos(psi);
    const sinPsi = Math.sin(psi);

    const radarCX = W * 0.5;
    const radarCY = viewerFrame ? H * 0.58 : H * 0.5;
    const viewerScale = 0.40; // pixels per rest-frame meter

    const projectPt = (wx, wz) => {
      if (!viewerFrame) {
        return [
          W * 0.5 + (wx - worldCX) * cityScale,
          H * 0.5 + (wz - worldCZ) * cityScale,
        ];
      }
      let dx = wx - ox;
      let dz = wz - oz;
      if (contractK > 0.0) {
        const dotB = dx * bHatX + dz * bHatZ;
        dx -= contractK * dotB * bHatX;
        dz -= contractK * dotB * bHatZ;
      }
      // Rotate into viewer gaze-up coordinates: fwd=(sinPsi, -cosPsi) -> +upY, right=(cosPsi, sinPsi) -> +rightX
      const rx = dx * cosPsi + dz * sinPsi;
      const upY = dx * sinPsi - dz * cosPsi;
      return [radarCX + rx * viewerScale, radarCY - upY * viewerScale];
    };

    // Rest-frame metric range rings (60m & 120m in observer's rest frame!) + FOV wedge
    if (viewerFrame) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.13)';
      ctx.lineWidth = 1;
      for (const rMeters of [60, 120]) {
        ctx.beginPath();
        ctx.arc(radarCX, radarCY, rMeters * viewerScale, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Viewer rest-frame FOV cone
      ctx.fillStyle = 'rgba(56, 189, 248, 0.09)';
      ctx.beginPath();
      ctx.moveTo(radarCX, radarCY);
      ctx.arc(radarCX, radarCY, 155, -Math.PI * 0.5 - 0.62, -Math.PI * 0.5 + 0.62);
      ctx.closePath();
      ctx.fill();
    }

    // Draw Ground Grand Prix Loop (Lorentz-contracted in real time!)
    const strokePoly = (pts, closed, outerCol, outerW, innerCol, innerW) => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = projectPt(pts[i][0], pts[i][1]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (closed) ctx.closePath();
      ctx.strokeStyle = outerCol;
      ctx.lineWidth = outerW;
      ctx.stroke();
      ctx.strokeStyle = innerCol;
      ctx.lineWidth = innerW;
      ctx.stroke();
    };

    // Draw Infield Reflecting Lagoons (Lorentz-contracted in real time!)
    if (cityWorld.track.lagoons) {
      for (const lg of cityWorld.track.lagoons) {
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) {
          const ang = (k / 24) * Math.PI * 2.0;
          const [lx, ly] = projectPt(lg.cx + Math.cos(ang) * lg.waterRX, lg.cz + Math.sin(ang) * lg.waterRZ);
          if (k === 0) ctx.moveTo(lx, ly);
          else ctx.lineTo(lx, ly);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(14, 165, 233, 0.35)';
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
        ctx.lineWidth = 1.1;
        ctx.fill();
        ctx.stroke();
      }
    }

    strokePoly(groundPts, true, 'rgba(15, 23, 42, 0.95)', 7.5, 'rgba(226, 232, 240, 0.80)', 3.6);
    if (slingshotPts.length > 0 && metric?.enableGR) {
      strokePoly(slingshotPts, false, 'rgba(59, 7, 100, 0.95)', 5.2, '#c084fc', 2.4);
    }
    strokePoly(skywayPts, false, 'rgba(8, 47, 73, 0.95)', 6.0, '#38bdf8', 2.8);

    // Draw General Relativity Landmarks: Black Hole Singularity & Wormhole Shortcut (A <-> B)
    if (metric?.enableGR) {
      const [wAx, wAy] = projectPt(metric.wormholeA[0], metric.wormholeA[2]);
      const [wBx, wBy] = projectPt(metric.wormholeB[0], metric.wormholeB[2]);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(wAx, wAy);
      ctx.lineTo(wBx, wBy);
      ctx.stroke();
      ctx.restore();

      for (const [wx, wy] of [[wAx, wAy], [wBx, wBy]]) {
        ctx.strokeStyle = '#22d3ee';
        ctx.fillStyle = 'rgba(8, 51, 68, 0.95)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(wx, wy, 4.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      const [bhX, bhY] = projectPt(metric.bhPos[0], metric.bhPos[2]);
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(bhX, bhY, 8.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = '#f97316';
      ctx.fillStyle = '#000000';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(bhX, bhY, 5.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Gravitational-Wave Corridor wavefront arcs on East Skyline
      if (metric.gwPos) {
        const [gwX, gwY] = projectPt(212.0, 38.0);
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.58)';
        ctx.lineWidth = 1.4;
        for (const rArc of [5.5, 9.5]) {
          ctx.beginPath();
          ctx.arc(gwX, gwY, rArc, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Start / Finish Chequered Line Bar at Z = +94, X in [-8..+8]
    const [sfLx, sfLy] = projectPt(-8.5, 94.0);
    const [sfRx, sfRy] = projectPt(8.5, 94.0);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(sfLx, sfLy);
    ctx.lineTo(sfRx, sfRy);
    ctx.stroke();

    // Ambient Trucks (small slate dots) & Named AI Grand Prix Opponents (colored halo dots!)
    for (let i = 0; i < entities.cars.length; i++) {
      const c = entities.cars[i];
      const [mx, my] = projectPt(c.x, c.z);
      if (c.isOpponent) {
        ctx.fillStyle = c.racerCss;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(mx, my, 4.0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.beginPath();
        ctx.arc(mx, my, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player Ferrari Chevron
    const [px, py] = viewerFrame ? [radarCX, radarCY] : projectPt(ox, oz);
    const arrowRot = viewerFrame ? (vehicle.moveYaw - vehicle.camYaw) : vehicle.moveYaw;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(arrowRot);
    ctx.fillStyle = '#ef4444';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -6.8);
    ctx.lineTo(4.8, 5.0);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-4.8, 5.0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  };
}

async function init() {
  const canvas = document.getElementById('glCanvas');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingStatus = document.getElementById('loadingStatus');
  const loadingBar = document.getElementById('loadingBar');

  const setProgress = (pct, msg) => {
    if (loadingBar) loadingBar.style.width = `${pct}%`;
    if (loadingStatus) loadingStatus.textContent = msg;
  };

  setProgress(10, 'Initializing General Relativity curved spacetime metric & physics…');
  await new Promise((r) => requestAnimationFrame(r));

  const metric = new GeneralRelativityMetric(25.0);
  const observer = new ObserverState();
  const vehicle = new VehicleController(observer, metric);
  const shaderSystem = new RelativisticShaderSystem(metric);
  const renderer = new RelativisticRenderer(canvas, metric, shaderSystem);

  setProgress(26, 'Loading photorealistic PBR textures & ORM maps…');
  await new Promise((r) => requestAnimationFrame(r));
  const materials = await buildPBRMaterialLibrary(renderer.threeRenderer, shaderSystem);

  setProgress(44, 'Constructing Grand Prix circuit, Skyway, Black Hole & Wormhole…');
  await new Promise((r) => requestAnimationFrame(r));
  const cityWorld = buildCityWorld(materials, shaderSystem);
  renderer.attachWorld(materials, cityWorld);

  const grSystem = new GeneralRelativitySystem(
    renderer.scene,
    renderer.threeRenderer,
    metric,
    shaderSystem,
    materials,
    cityWorld.track
  );

  setProgress(58, 'Loading SpeedTree foliage, glTF supercars, statues & rigged humans…');
  const entities = new EntityManager(renderer.scene, cityWorld, metric, shaderSystem);
  await entities.loadAssets((frac, key) => {
    setProgress(Math.round(58 + frac * 36), `Loading 3D asset: ${key}…`);
  });

  // Bake live 3D destination cubemaps for Morris–Thorne Wormhole Mouths A & B!
  setProgress(95, 'Synthesizing Morris–Thorne wormhole panoramas & Kerr geodesics…');
  await new Promise((r) => requestAnimationFrame(r));
  grSystem.bakeWormholePortals(observer, entities, cityWorld, renderer.skyMesh, 'both');

  const audio = new RelativisticAudioEngine(metric, cityWorld);
  const grBanner = document.getElementById('grEventBanner');
  let grBannerTimer = null;
  const flashGRBanner = (text) => {
    if (!grBanner) return;
    grBanner.textContent = text;
    grBanner.classList.remove('hidden');
    if (grBannerTimer) clearTimeout(grBannerTimer);
    grBannerTimer = setTimeout(() => grBanner.classList.add('hidden'), 2400);
  };
  grSystem.onWormholeTraverse = () => {
    audio.triggerWormholeWarp();
    flashGRBanner('◎ ENTERING 20m MORRIS–THORNE WORMHOLE THROAT');
  };
  grSystem.onHorizonReset = () => {
    audio.triggerCollision(0.95);
    flashGRBanner('● EVENT HORIZON CROSSED (r ≤ r_H) • TIDAL EJECTION');
  };

  vehicle.getSupportSurface = cityWorld.getSupportSurface;
  vehicle.queryBarrierContact = cityWorld.queryBarrierContact;
  vehicle.queryVehicleOBBContact = cityWorld.queryVehicleOBBContact;
  vehicle.resolveVehicleCollisions = (v, dtC) => entities.resolveVehicleCollisions(v, dtC);
  vehicle.onCollisionSpark = (x, y, z, nx, nz, intensity) =>
    entities.spawnCollisionSparks(x, y, z, nx, nz, intensity);
  vehicle.onCollisionAudio = (sev) => audio.triggerCollision(sev);

  // Smart `R` Track Recovery: resets car upright onto nearest road centerline!
  vehicle.onRecoverRequest = () => {
    if (grSystem.inThroat) {
      grSystem._exitWormholeThroat(vehicle, entities, cityWorld, renderer.skyMesh, true);
    }
    const isSky = vehicle.footY > 2.0;
    const ribbon = isSky ? cityWorld.track.skywayData : cityWorld.track.groundData;
    let bestD2 = Infinity;
    let bestF = ribbon.frames[0];
    for (const f of ribbon.frames) {
      const d2 = (f.pos.x - vehicle.carX) ** 2 + (f.pos.z - vehicle.carZ) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestF = f;
      }
    }
    const yaw = Math.atan2(bestF.tan.x, -bestF.tan.z);
    vehicle.teleportTo(bestF.pos.x, bestF.pos.y + 0.03, bestF.pos.z, yaw);
  };

  vehicle.bindInputs(canvas);

  // --- 3-Lap Relativistic Grand Prix State ---
  const raceState = {
    totalLaps: 3,
    mode: 'racing',       // 'countdown' | 'racing' | 'finished' | 'freeroam'
    countdownLeft: 0.0,
    startCoordTime: 0.0,
    startProperTime: 0.0,
    playerLap: 0,
    playerPassedMidpoint: false,
    playerFinished: false,
    playerFinishCoord: 0.0,
    playerFinishProper: 0.0,
    playerFinishRank: 1,
  };

  const countdownBanner = document.getElementById('countdownBanner');
  const finishModal = document.getElementById('finishModal');

  function startNewGrandPrix(withCountdown = true) {
    finishModal?.classList.add('hidden');
    if (grSystem.inThroat) {
      grSystem._exitWormholeThroat(vehicle, entities, cityWorld, renderer.skyMesh, false);
    }
    observer.event[0] = 0.0;
    observer.properTime = 0.0;
    vehicle.boostEnergy = 1.0;
    vehicle.teleportTo(2.4, 0.02, 158.0, 0.0);
    entities.resetOpponentsForNewRace();

    raceState.startCoordTime = observer.event[0];
    raceState.startProperTime = observer.properTime;
    raceState.playerLap = 0;
    raceState.playerHasCrossedStart = false;
    raceState.playerPassedMidpoint = false;
    raceState.playerFinished = false;

    if (withCountdown) {
      raceState.mode = 'countdown';
      raceState.countdownLeft = 2.4;
      vehicle.canDrive = false;
      entities.canRace = false;
      if (countdownBanner) {
        countdownBanner.textContent = '3';
        countdownBanner.classList.remove('hidden');
      }
    } else {
      raceState.mode = 'racing';
      vehicle.canDrive = true;
      entities.canRace = true;
    }
  }

  // Start immediately ready to drive & race on initial load so controls respond from t=0!
  startNewGrandPrix(false);

  bindUI(metric, vehicle, entities, renderer, audio, startNewGrandPrix, raceState, finishModal);

  const renderRadar = createRelativisticRadar(
    document.getElementById('minimapCanvas'),
    document.getElementById('minimapTitle'),
    document.getElementById('btnToggleMapFrame'),
    cityWorld,
    metric
  );

  // Staggered GPU shader compilation & warmup so mobile GPU watchdogs never time out
  setProgress(97, 'Compiling relativistic past-light-cone PBR shaders…');
  await new Promise((r) => requestAnimationFrame(r));
  entities.update(0.016, 0.016, observer, vehicle, 0.0);
  try {
    renderer.threeRenderer.compile(renderer.scene, renderer.camera);
  } catch (compileErr) {
    console.warn('Shader pre-compile warning:', compileErr);
  }
  await new Promise((r) => requestAnimationFrame(r));
  renderer.renderFrame(observer, vehicle, entities, 0.016, 0.016);

  setProgress(100, 'Ready!');
  loadingOverlay?.classList.add('hidden');

  window.__relativityApp = {
    metric,
    observer,
    vehicle,
    entities,
    renderer,
    cityWorld,
    grSystem,
    shaderSystem,
    audio,
    raceState,
    startNewGrandPrix,
    fps: 60,
  };

  const elBeta = document.getElementById('betaReadout');
  const elGearBadge = document.getElementById('gearBadge');
  const elTerrainBadge = document.getElementById('terrainBadge');
  const elBetaBar = document.getElementById('betaBarFill');
  const elBoostFill = document.getElementById('boostBarFill');
  const elMps = document.getElementById('mpsReadout');
  const elGamma = document.getElementById('gammaReadout');
  const elAlt = document.getElementById('altReadout');
  const elGForce = document.getElementById('gForceReadout');
  const elProper = document.getElementById('properClock');
  const elCoord = document.getElementById('coordClock');
  const elSolarBadge = document.getElementById('solarClockBadge');
  const elTodLabel = document.getElementById('todLabel');
  const elSwatch = document.getElementById('redLightSwatch');
  const elSwatchText = document.getElementById('redLightLabel');
  const elFps = document.getElementById('fpsReadout');
  const elRacePos = document.getElementById('racePosReadout');
  const elRaceLap = document.getElementById('raceLapReadout');
  const elLeaderboard = document.getElementById('leaderboardList');

  let lastTimeMs = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let uiTick = 0;

  function showFinishModal(standings) {
    if (!finishModal) return;
    const rank = raceState.playerFinishRank;
    document.getElementById('finishHeadline').textContent = `${ordinalPlace(rank)} PLACE!`;
    document.getElementById('finishProperTime').textContent = formatClock(raceState.playerFinishProper);
    document.getElementById('finishCityTime').textContent = formatClock(raceState.playerFinishCoord);
    const saved = Math.max(0.0, raceState.playerFinishCoord - raceState.playerFinishProper);
    document.getElementById('finishTimeSaved').textContent = `${saved.toFixed(2)}s younger (SR + GR)!`;

    const listEl = document.getElementById('finishStandings');
    if (listEl) {
      listEl.innerHTML = standings
        .map(
          (r, idx) => `
          <div class="lb-row ${r.isPlayer ? 'is-player' : ''}">
            <span class="lb-rank">${idx + 1}</span>
            <span class="lb-swatch" style="background:${r.css}"></span>
            <span class="lb-name">${r.name}</span>
            <span class="lb-beta">${r.statusText}</span>
          </div>`
        )
        .join('');
    }
    finishModal.classList.remove('hidden');
  }

  function frame(nowMs) {
    const dtReal = Math.min(0.05, Math.max(0.001, (nowMs - lastTimeMs) * 0.001));
    lastTimeMs = nowMs;

    // Countdown handling
    if (raceState.mode === 'countdown') {
      raceState.countdownLeft -= dtReal;
      if (raceState.countdownLeft <= 0.0) {
        raceState.mode = 'racing';
        raceState.startCoordTime = observer.event[0];
        raceState.startProperTime = observer.properTime;
        vehicle.canDrive = true;
        entities.canRace = true;
        if (countdownBanner) {
          countdownBanner.textContent = 'GO!';
          setTimeout(() => countdownBanner.classList.add('hidden'), 650);
        }
      } else if (countdownBanner) {
        countdownBanner.textContent = String(Math.ceil(raceState.countdownLeft * 1.25));
      }
    }

    const prevCoordTime = observer.event[0];
    const prevCarZ = vehicle.carZ;
    grSystem.update(dtReal, observer, vehicle, renderer.settings.timeOfDayHours, entities, cityWorld, renderer.skyMesh);
    vehicle.update(dtReal);
    grSystem.syncRenderPose(observer);
    const dtCoord = observer.event[0] - prevCoordTime;

    const raceCoordElapsed = Math.max(0.0, observer.event[0] - raceState.startCoordTime);
    const raceProperElapsed = Math.max(0.0, observer.properTime - raceState.startProperTime);

    entities.update(dtCoord, dtReal, observer, vehicle, raceCoordElapsed);
    renderer.renderFrame(observer, vehicle, entities, dtReal, dtCoord);
    renderRadar(observer, vehicle, entities);
    audio.update(dtReal, observer, vehicle, entities, renderer.settings);

    // Check Player Lap Progression across Start/Finish (Z = +94, including Black Hole Slingshot Bypass lane!)
    if (!raceState.playerHasCrossedStart && vehicle.footY < 2.5 && vehicle.carX > -17.5 && vehicle.carX < 12.5 && prevCarZ > 94.0 && vehicle.carZ <= 94.0) {
      raceState.playerHasCrossedStart = true;
    }
    if (vehicle.carZ < -35.0 || vehicle.footY > 8.0) {
      raceState.playerPassedMidpoint = true;
      raceState.playerHasCrossedStart = true;
    }
    if (
      raceState.mode === 'racing' &&
      raceState.playerPassedMidpoint &&
      vehicle.footY < 2.5 &&
      vehicle.carX > -17.5 &&
      vehicle.carX < 12.5 &&
      prevCarZ > 94.0 &&
      vehicle.carZ <= 94.0
    ) {
      raceState.playerLap++;
      raceState.playerPassedMidpoint = false;
      if (raceState.playerLap >= raceState.totalLaps && !raceState.playerFinished) {
        raceState.playerFinished = true;
        raceState.mode = 'finished';
        raceState.playerFinishCoord = raceCoordElapsed;
        raceState.playerFinishProper = raceProperElapsed;
      }
    }

    // Compute live 6-car Grand Prix Standings
    const pFrac = entities.computeLapFraction(vehicle.carX, vehicle.footY, vehicle.carZ);
    const playerScore = (!raceState.playerHasCrossedStart && pFrac > 0.85)
      ? (pFrac - 1.0)
      : (raceState.playerLap + pFrac);
    const betaMag = Math.hypot(observer.beta[0], observer.beta[1], observer.beta[2]);

    const entries = [
      {
        name: 'YOU (Ferrari 458)',
        css: '#ef4444',
        isPlayer: true,
        score: raceState.playerFinished ? 100.0 - raceState.playerFinishCoord * 0.001 : playerScore,
        beta: betaMag,
        statusText: raceState.playerFinished
          ? `t=${formatClock(raceState.playerFinishCoord)}`
          : `${betaMag.toFixed(2)}c`,
      },
      ...entities.opponents.map((o) => ({
        name: o.racerName,
        css: o.racerCss,
        isPlayer: false,
        score: o.finished ? 100.0 - o.finishCoordTime * 0.001 : o.raceScore,
        beta: o.curBeta,
        statusText: o.finished ? `t=${formatClock(o.finishCoordTime)}` : `${o.curBeta.toFixed(2)}c`,
      })),
    ].sort((a, b) => b.score - a.score);

    const playerRank = entries.findIndex((e) => e.isPlayer) + 1;
    if (raceState.mode === 'finished' && finishModal?.classList.contains('hidden')) {
      raceState.playerFinishRank = playerRank;
      showFinishModal(entries);
    }

    uiTick = (uiTick + 1) % 4;
    if (uiTick === 0) {
      const dispLap = Math.min(raceState.totalLaps, raceState.playerLap + 1);
      if (elRacePos) elRacePos.innerHTML = `${playerRank}<span>/6</span>`;
      if (elRaceLap) elRaceLap.innerHTML = `${dispLap}<span>/${raceState.totalLaps}</span>`;
      if (elLeaderboard) {
        elLeaderboard.innerHTML = entries
          .map(
            (e, idx) => `
            <div class="lb-row ${e.isPlayer ? 'is-player' : ''}">
              <span class="lb-rank">${idx + 1}</span>
              <span class="lb-swatch" style="background:${e.css}"></span>
              <span class="lb-name">${e.name}</span>
              <span class="lb-beta">${e.statusText}</span>
            </div>`
          )
          .join('');
      }
    }

    // FPS Readout
    fpsAccum += dtReal;
    fpsFrames++;
    if (fpsAccum >= 0.4) {
      const fps = Math.round(fpsFrames / fpsAccum);
      window.__relativityApp.fps = fps;
      if (elFps) elFps.textContent = `${fps} FPS`;
      fpsAccum = 0;
      fpsFrames = 0;
    }

    // Telemetry Readouts
    const signedBeta = Math.tanh(vehicle.rapidity);
    const isReversing = signedBeta < -0.006;

    elBeta.textContent = (isReversing ? '-' : '') + betaMag.toFixed(3);
    elGearBadge?.classList.toggle('hidden', !isReversing);
    if (elTerrainBadge) {
      const terr = vehicle.currentTerrain;
      if (terr === 'grass' || terr === 'sand' || terr === 'water') {
        elTerrainBadge.textContent = terr === 'grass' ? 'TURF' : terr === 'sand' ? 'SAND' : 'WATER';
        elTerrainBadge.className = `terrain-badge ${terr === 'grass' ? '' : terr}`;
      } else {
        elTerrainBadge.classList.add('hidden');
      }
    }
    const elGravBadge = document.getElementById('gravBadge');
    if (elGravBadge) {
      const gAlpha = observer.gravAlpha ?? 1.0;
      if (metric.enableGR && grSystem.inThroat) {
        const sgn = grSystem.throatL >= 0 ? '+' : '';
        elGravBadge.textContent = `THROAT l=${sgn}${grSystem.throatL.toFixed(1)}m`;
        elGravBadge.classList.remove('hidden');
        elGravBadge.classList.add('extreme');
      } else if (metric.enableGR && gAlpha < 0.975) {
        const grFac = 1.0 / gAlpha;
        elGravBadge.textContent = `GR ${grFac >= 10.0 ? grFac.toFixed(1) : grFac.toFixed(2)}×`;
        elGravBadge.classList.remove('hidden');
        elGravBadge.classList.toggle('extreme', grFac >= 3.0);
      } else {
        elGravBadge.classList.add('hidden');
        elGravBadge.classList.remove('extreme');
      }
    }
    elBetaBar.style.width = `${Math.min(100, betaMag * 100).toFixed(1)}%`;
    if (elBoostFill) elBoostFill.style.width = `${Math.round(vehicle.boostEnergy * 100)}%`;
    elMps.textContent = (betaMag * metric.c).toFixed(1);
    elGamma.textContent = (observer.totalTimeDilation || observer.gamma).toFixed(3);
    if (elAlt) elAlt.textContent = `${Math.max(0, vehicle.footY).toFixed(1)}m`;
    if (elGForce) elGForce.textContent = `${Math.hypot(vehicle.properLongG, vehicle.properLatG).toFixed(1)}g`;

    elProper.textContent = formatClock(raceProperElapsed);
    elCoord.textContent = formatClock(raceCoordElapsed);

    // Live Solar Clock (advances faster by Lorentz gamma * GR time dilation as the Sun races across the sky!)
    const todHrs = renderer.settings.timeOfDayHours;
    const todStr = formatTimeOfDay(todHrs);
    const isNight = todHrs < 6.0 || todHrs > 18.6;
    if (elSolarBadge) elSolarBadge.textContent = `${isNight ? '☾' : '☀'} ${todStr}`;
    if (elTodLabel) elTodLabel.textContent = todStr;

    const fwdD = signedBeta >= 0
      ? Math.sqrt((1 + betaMag) / Math.max(1e-5, 1 - betaMag))
      : Math.sqrt(Math.max(0, 1 - betaMag) / (1 + betaMag));
    const gravBlueshift = metric.enableGR ? (1.0 / Math.max(0.018, observer.gravAlpha ?? 1.0)) : 1.0;
    const effD = (renderer.settings.enableDoppler ? fwdD : 1.0) * gravBlueshift;
    const obsNm = Math.max(12, Math.round(632.0 / effD));
    const [sr, sg, sb] = wavelengthToDisplaySRGB(632.0, effD);
    const rgbCss = `rgb(${sr}, ${sg}, ${sb})`;
    elSwatch.style.background = rgbCss;
    elSwatch.style.boxShadow = `0 0 9px ${rgbCss}`;
    elSwatchText.textContent = `632→${obsNm}nm`;

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function bindUI(metric, vehicle, entities, renderer, audio, startNewGrandPrix, raceState, finishModal) {
  const togglePhysicsBtn = document.getElementById('togglePhysicsBtn');
  const physicsDrawer = document.getElementById('physicsDrawer');
  const cSlider = document.getElementById('cSlider');
  const cValueLabel = document.getElementById('cValueLabel');
  const chkAutoDayCycle = document.getElementById('chkAutoDayCycle');
  const btnToggleSound = document.getElementById('btnToggleSound');
  const btnToggleMusic = document.getElementById('btnToggleMusic');
  const chkEnvAudio = document.getElementById('chkEnvAudio');
  const chkCarMusic = document.getElementById('chkCarMusic');

  const syncAudioButtons = (st) => {
    if (btnToggleSound) {
      btnToggleSound.textContent = st.masterEnabled ? '🔊' : '🔇';
      btnToggleSound.classList.toggle('active', st.masterEnabled);
      btnToggleSound.classList.toggle('muted', !st.masterEnabled);
    }
    if (btnToggleMusic) {
      btnToggleMusic.classList.toggle('active', st.masterEnabled && st.musicEnabled);
      btnToggleMusic.classList.toggle('muted', !st.masterEnabled || !st.musicEnabled);
    }
    if (chkCarMusic) chkCarMusic.checked = st.musicEnabled;
    if (chkEnvAudio) chkEnvAudio.checked = st.envEnabled;
  };
  audio.onStateChange = syncAudioButtons;
  syncAudioButtons(audio.getStatus());

  btnToggleSound?.addEventListener('click', () => audio.toggleMaster());
  btnToggleMusic?.addEventListener('click', () => audio.toggleMusic());
  chkEnvAudio?.addEventListener('change', () => audio.setEnvEnabled(chkEnvAudio.checked));
  chkCarMusic?.addEventListener('change', () => audio.setMusicEnabled(chkCarMusic.checked));

  togglePhysicsBtn?.addEventListener('click', () => {
    const hidden = physicsDrawer.classList.toggle('hidden');
    togglePhysicsBtn.classList.toggle('active', !hidden);
  });

  cSlider?.addEventListener('input', () => {
    const val = parseFloat(cSlider.value);
    metric.setSpeedOfLight(val);
    cValueLabel.textContent = `${val.toFixed(1)} m/s`;
  });

  document.querySelectorAll('.tod-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hrs = parseFloat(btn.dataset.tod || '15.2');
      renderer.settings.timeOfDayHours = hrs;
      renderer.updateTimeOfDayLighting(true);
    });
  });

  chkAutoDayCycle?.addEventListener('change', () => {
    renderer.settings.autoDayCycle = chkAutoDayCycle.checked;
  });

  // Camera View Mode Pills (`Chase`, `Cockpit`, `Hood`) synced with `V` key
  const camBtns = Array.from(document.querySelectorAll('.cam-btn'));
  const syncCamButtons = (mode) => {
    camBtns.forEach((b) => b.classList.toggle('active', b.dataset.cam === mode));
  };
  camBtns.forEach((btn) => {
    btn.addEventListener('click', () => vehicle.setViewMode(btn.dataset.cam));
  });
  vehicle.onViewModeChange = syncCamButtons;
  syncCamButtons(vehicle.viewMode);

  const bindCheck = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      renderer.settings[key] = el.checked;
    });
  };
  bindCheck('chkGeneralRel', 'enableGR');
  bindCheck('chkRetardation', 'enableRetardation');
  bindCheck('chkLorentz', 'enableLorentz');
  bindCheck('chkAberration', 'enableAberration');
  bindCheck('chkDoppler', 'enableDoppler');
  bindCheck('chkBeaming', 'enableBeaming');
  bindCheck('chkAccelEquiv', 'enableAccelEquiv');

  document.getElementById('btnJumpBH')?.addEventListener('click', () => {
    if (window.__relativityApp?.grSystem?.inThroat) {
      window.__relativityApp.grSystem._exitWormholeThroat(vehicle, entities, window.__relativityApp.cityWorld, renderer.skyMesh, false);
    }
    vehicle.teleportTo(-18.5, 0.03, 74.0, -0.72);
    physicsDrawer?.classList.add('hidden');
    togglePhysicsBtn?.classList.remove('active');
  });

  document.getElementById('btnJumpWormhole')?.addEventListener('click', () => {
    if (window.__relativityApp?.grSystem?.inThroat) {
      window.__relativityApp.grSystem._exitWormholeThroat(vehicle, entities, window.__relativityApp.cityWorld, renderer.skyMesh, false);
    }
    vehicle.teleportTo(-2.2, 0.02, -116.0, -0.082);
    physicsDrawer?.classList.add('hidden');
    togglePhysicsBtn?.classList.remove('active');
  });

  document.getElementById('btnJumpGW')?.addEventListener('click', () => {
    const cw = window.__relativityApp?.cityWorld;
    if (window.__relativityApp?.grSystem?.inThroat) {
      window.__relativityApp.grSystem._exitWormholeThroat(vehicle, entities, cw, renderer.skyMesh, false);
    }
    let gx = 209.5, gy = 1.72, gz = -34.0, gyaw = -3.01;
    if (cw?.track?.groundData?.frames) {
      let bestD = Infinity;
      for (const f of cw.track.groundData.frames) {
        if (f.pos.x < 180.0) continue;
        const d = Math.abs(f.pos.z - (-34.0));
        if (d < bestD) {
          bestD = d;
          gx = f.pos.x; gy = f.pos.y + 0.03; gz = f.pos.z;
          gyaw = Math.atan2(f.tan.x, -f.tan.z);
        }
      }
    }
    vehicle.teleportTo(gx, gy, gz, gyaw);
    physicsDrawer?.classList.add('hidden');
    togglePhysicsBtn?.classList.remove('active');
  });

  document.getElementById('btnNewRace')?.addEventListener('click', () => {
    startNewGrandPrix(true);
  });

  document.getElementById('btnRaceAgain')?.addEventListener('click', () => {
    startNewGrandPrix(true);
  });

  document.getElementById('btnContinueRoam')?.addEventListener('click', () => {
    raceState.mode = 'freeroam';
    finishModal?.classList.add('hidden');
  });

  // Bind AAA Mobile Racing Controls:
  //   1) TouchDrive-style Auto-Gas (ON by default on coarse-pointer touch screens, toggleable!)
  //   2) Continuous Analog Steering Slider (`#touchSteerTrack`) + Optional Gyroscope Tilt Steering!
  //   3) Dedicated BRAKE / BOOST / Recover pedals
  const isTouchScreen =
    typeof window !== 'undefined' &&
    ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1);

  const btnAutoGas = document.getElementById('btnToggleAutoGas');
  const btnMobileGas = document.getElementById('btnMobileGas');
  const btnTiltSteer = document.getElementById('btnToggleTiltSteer');
  const steerTrack = document.getElementById('touchSteerTrack');
  const steerPuck = document.getElementById('touchSteerPuck');
  const tiltHint = document.getElementById('tiltSteerHint');

  const applyAutoGasState = (enabled) => {
    vehicle.autoThrottle = enabled;
    if (btnAutoGas) {
      btnAutoGas.textContent = enabled ? 'Auto-Gas: ON' : 'Auto-Gas: OFF';
      btnAutoGas.classList.toggle('active', enabled);
    }
    if (btnMobileGas) {
      btnMobileGas.classList.toggle('hidden', enabled);
    }
  };
  // Default Auto-Gas OFF everywhere so the car stays at rest (0.000c) until GAS is pressed!
  applyAutoGasState(false);
  void isTouchScreen;
  btnAutoGas?.addEventListener('click', (e) => {
    e.preventDefault();
    applyAutoGasState(!vehicle.autoThrottle);
  });

  // Analog Touch Steering Track (`[-1..+1]` proportional steering)
  let steerPointerId = null;
  let tiltModeEnabled = false;

  const updateAnalogSteerFromClientX = (clientX) => {
    if (!steerTrack) return;
    const rect = steerTrack.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const maxSpan = Math.max(36, rect.width * 0.34);
    let norm = (clientX - cx) / maxSpan;
    norm = Math.max(-1.0, Math.min(1.0, norm));
    if (Math.abs(norm) < 0.05) norm = 0.0;
    vehicle.analogSteer = norm;
    if (steerPuck) {
      steerPuck.style.transform = `translateX(${(norm * maxSpan).toFixed(1)}px)`;
    }
  };

  const resetAnalogSteer = () => {
    steerPointerId = null;
    if (!tiltModeEnabled) vehicle.analogSteer = 0.0;
    steerTrack?.classList.remove('dragging');
    if (steerPuck) steerPuck.style.transform = 'translateX(0px)';
  };

  if (steerTrack) {
    steerTrack.addEventListener('pointerdown', (e) => {
      if (tiltModeEnabled) return;
      if (e.cancelable) e.preventDefault();
      steerPointerId = e.pointerId;
      steerTrack.classList.add('dragging');
      if (steerTrack.setPointerCapture) {
        try { steerTrack.setPointerCapture(e.pointerId); } catch (_) {}
      }
      updateAnalogSteerFromClientX(e.clientX);
    });
    steerTrack.addEventListener('pointermove', (e) => {
      if (e.pointerId !== steerPointerId || tiltModeEnabled) return;
      if (e.cancelable) e.preventDefault();
      updateAnalogSteerFromClientX(e.clientX);
    });
    steerTrack.addEventListener('pointerup', (e) => {
      if (e.pointerId === steerPointerId) resetAnalogSteer();
    });
    steerTrack.addEventListener('pointercancel', (e) => {
      if (e.pointerId === steerPointerId) resetAnalogSteer();
    });
    steerTrack.addEventListener('lostpointercapture', resetAnalogSteer);
    steerTrack.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Optional Phone Gyroscope Tilt Steering (`deviceorientation`)
  const onDeviceOrientation = (e) => {
    if (!tiltModeEnabled) return;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let tiltDeg = 0.0;
    if (angle === 90) {
      tiltDeg = e.beta || 0.0;
    } else if (angle === -90 || angle === 270) {
      tiltDeg = -(e.beta || 0.0);
    } else {
      tiltDeg = e.gamma || 0.0;
    }
    let norm = Math.max(-1.0, Math.min(1.0, tiltDeg / 24.0));
    if (Math.abs(norm) < 0.06) norm = 0.0;
    vehicle.analogSteer = norm;
  };

  btnTiltSteer?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!tiltModeEnabled) {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        try {
          const perm = await DeviceOrientationEvent.requestPermission();
          if (perm !== 'granted') return;
        } catch (_) {
          return;
        }
      }
      tiltModeEnabled = true;
      window.addEventListener('deviceorientation', onDeviceOrientation, true);
    } else {
      tiltModeEnabled = false;
      vehicle.analogSteer = 0.0;
      window.removeEventListener('deviceorientation', onDeviceOrientation, true);
    }
    btnTiltSteer.textContent = tiltModeEnabled ? 'Steer: Tilt' : 'Steer: Touch';
    btnTiltSteer.classList.toggle('active', tiltModeEnabled);
    steerTrack?.classList.toggle('hidden', tiltModeEnabled);
    tiltHint?.classList.toggle('hidden', !tiltModeEnabled);
  });

  // Bind Mobile Right-Thumb Pedals (`BRAKE`, `BOOST`, optional manual `GAS`)
  document.querySelectorAll('.touch-btn[data-vkey]').forEach((btn) => {
    const code = btn.dataset.vkey;
    const setPressed = (pressed, ev) => {
      if (ev && ev.cancelable) ev.preventDefault();
      btn.classList.toggle('active', pressed);
      vehicle.setVirtualKey(code, pressed);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (btn.setPointerCapture) {
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      }
      setPressed(true, e);
    });
    btn.addEventListener('pointerup', (e) => setPressed(false, e));
    btn.addEventListener('pointercancel', (e) => setPressed(false, e));
    btn.addEventListener('lostpointercapture', () => setPressed(false, null));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  document.getElementById('btnMobileRecover')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (vehicle.onRecoverRequest) vehicle.onRecoverRequest();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'KeyH') {
      document.body.classList.toggle('hud-hidden');
    } else if (e.code === 'KeyM') {
      audio.toggleMusic();
    }
  });
}

init().catch((err) => {
  console.error('Failed to start Relativistic Grand Prix:', err);
  const st = document.getElementById('loadingStatus');
  if (st) st.textContent = `Startup Error: ${err.message}`;
});
