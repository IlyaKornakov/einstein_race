/**
 * Three.js Photorealistic PBR Material & Signage Library
 * ======================================================
 *
 * Loads the 1024x1024 seamless PBR texture sets (`_albedo.jpg`, `_normal.jpg`, `_orm.png`,
 * `_emissive.jpg`) and synthesizes crisp vector-sharp racing kerbs, highway gore chevrons,
 * overhead Tokyo-Expressway gantry signage, skyscraper curtain-wall glass, and clock dials.
 */

import * as THREE from 'three';
import { IS_MOBILE_DEVICE } from './renderer.js?v=2.0';

function makeCanvasTexture(width, height, drawFn, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const scale = IS_MOBILE_DEVICE ? 0.5 : 1.0;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.round(width * scale));
  canvas.height = Math.max(64, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (scale !== 1.0) ctx.scale(scale, scale);
  drawFn(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

export async function buildPBRMaterialLibrary(threeRenderer, shaderSystem) {
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(
    IS_MOBILE_DEVICE ? 4 : 16,
    threeRenderer.capabilities.getMaxAnisotropy() || 4
  );

  const loadTex = (url, { srgb = false, repeat = true } = {}) =>
    new Promise((resolve, reject) => {
      loader.load(
        url,
        (tex) => {
          // On mobile browsers (e.g. Firefox Android), cap 1024px PBR maps to 512px before GPU upload
          // to save ~118 MB of uncompressed RGBA mipmap VRAM without losing crispness on phone screens!
          if (IS_MOBILE_DEVICE && tex.image && (tex.image.width > 512 || tex.image.height > 512)) {
            const s = 512 / Math.max(tex.image.width, tex.image.height);
            const cv = document.createElement('canvas');
            cv.width = Math.max(64, Math.round(tex.image.width * s));
            cv.height = Math.max(64, Math.round(tex.image.height * s));
            const c2d = cv.getContext('2d');
            c2d.drawImage(tex.image, 0, 0, cv.width, cv.height);
            tex.image = cv;
          }
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
          tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
          tex.anisotropy = maxAniso;
          resolve(tex);
        },
        undefined,
        reject
      );
    });

  const loadPBRSet = async (name, { repeat = true, hasEmissive = false } = {}) => {
    const base = `./assets/textures/${name}`;
    const promises = [
      loadTex(`${base}_albedo.jpg`, { srgb: true, repeat }),
      loadTex(`${base}_normal.jpg`, { srgb: false, repeat }),
      loadTex(`${base}_orm.png`, { srgb: false, repeat }),
    ];
    if (hasEmissive) {
      promises.push(loadTex(`${base}_emissive.jpg`, { srgb: true, repeat }));
    }
    const [map, normalMap, ormMap, emissiveMap] = await Promise.all(promises);
    return { map, normalMap, ormMap, emissiveMap: emissiveMap || null };
  };

  const [
    roadAsphaltSet,
    roadCrosswalkSet,
    highwayRoadSet,
    highwayConcreteSet,
    sidewalkCobbleSet,
    brickFacadeSet,
    stoneAshlarSet,
    roofTilesSet,
    windowAtlasSet,
  ] = await Promise.all([
    loadPBRSet('road_asphalt'),
    loadPBRSet('road_crosswalk'),
    loadPBRSet('highway_road'),
    loadPBRSet('highway_concrete'),
    loadPBRSet('sidewalk_cobble'),
    loadPBRSet('brick_facade'),
    loadPBRSet('stone_ashlar'),
    loadPBRSet('roof_tiles'),
    loadPBRSet('window_atlas', { repeat: false, hasEmissive: true }),
  ]);

  const makeStd = (name, set, params = {}, matOpts = {}) => {
    const mat = new THREE.MeshStandardMaterial({
      name,
      map: set.map,
      normalMap: set.normalMap,
      aoMap: set.ormMap,
      roughnessMap: set.ormMap,
      metalnessMap: set.ormMap,
      roughness: 1.0,
      metalness: 0.0,
      aoMapIntensity: 0.85,
      envMapIntensity: 0.75,
      ...params,
    });
    if (set.emissiveMap) {
      mat.emissiveMap = set.emissiveMap;
    }
    return shaderSystem.patchMaterial(mat, shaderSystem.staticEntityUniforms, matOpts);
  };

  const MatPhysOrStd = IS_MOBILE_DEVICE ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;

  // 1. Next-Gen Roads (Polished Racing Line + Specular Clearcoat Sheen), Sidewalks & Architecture
  const roadAsphalt = new MatPhysOrStd({
    name: 'RoadAsphalt',
    map: roadAsphaltSet.map,
    normalMap: roadAsphaltSet.normalMap,
    aoMap: roadAsphaltSet.ormMap,
    roughnessMap: roadAsphaltSet.ormMap,
    metalnessMap: roadAsphaltSet.ormMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughness: 0.88,
    metalness: 0.0,
    ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 0.28, clearcoatRoughness: 0.24 }),
    aoMapIntensity: 0.9,
    envMapIntensity: 1.25,
  });
  shaderSystem.patchMaterial(roadAsphalt, shaderSystem.staticEntityUniforms, {
    macroDetail: 0.55,
    roadPolish: 1.0,
  });

  const roadCrosswalk = makeStd('RoadCrosswalk', roadCrosswalkSet, {
    normalScale: new THREE.Vector2(0.85, 0.85),
    envMapIntensity: 0.95,
  }, { macroDetail: 0.35, roadPolish: 0.55 });

  const highwayRoad = new MatPhysOrStd({
    name: 'HighwayRoad',
    map: highwayRoadSet.map,
    normalMap: highwayRoadSet.normalMap,
    aoMap: highwayRoadSet.ormMap,
    roughnessMap: highwayRoadSet.ormMap,
    metalnessMap: highwayRoadSet.ormMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.85,
    metalness: 0.0,
    ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 0.26, clearcoatRoughness: 0.26 }),
    aoMapIntensity: 0.9,
    envMapIntensity: 1.2,
  });
  shaderSystem.patchMaterial(highwayRoad, shaderSystem.staticEntityUniforms, {
    macroDetail: 0.50,
    roadPolish: 0.90,
  });

  const highwayConcrete = makeStd('HighwayConcrete', highwayConcreteSet, {
    normalScale: new THREE.Vector2(0.95, 0.95),
    envMapIntensity: 0.65,
  }, { macroDetail: 0.55, groundAO: 0.85 });

  const sidewalkCobble = makeStd('SidewalkCobble', sidewalkCobbleSet, {
    normalScale: new THREE.Vector2(1.15, 1.15),
    envMapIntensity: 0.75,
  }, { macroDetail: 0.65 });

  const brickFacade = makeStd('BrickFacade', brickFacadeSet, {
    normalScale: new THREE.Vector2(1.2, 1.2),
    envMapIntensity: 0.55,
  }, { nirWeight: 0.95, macroDetail: 0.55, groundAO: 0.95 });

  // Warm Ochre / Terracotta Brick variant for neighborhood variety
  const brickWarm = makeStd('BrickWarm', brickFacadeSet, {
    color: new THREE.Color(1.06, 0.93, 0.84),
    normalScale: new THREE.Vector2(1.15, 1.15),
    envMapIntensity: 0.55,
  }, { nirWeight: 0.95, macroDetail: 0.55, groundAO: 0.95 });

  const stoneAshlar = makeStd('StoneAshlar', stoneAshlarSet, {
    normalScale: new THREE.Vector2(1.0, 1.0),
    envMapIntensity: 0.62,
  }, { macroDetail: 0.50, groundAO: 0.90 });

  const stoneCream = makeStd('StoneCream', stoneAshlarSet, {
    color: new THREE.Color(1.04, 1.0, 0.93),
    normalScale: new THREE.Vector2(0.95, 0.95),
    envMapIntensity: 0.62,
  }, { macroDetail: 0.48, groundAO: 0.90 });

  const roofTiles = makeStd('RoofTiles', roofTilesSet, {
    normalScale: new THREE.Vector2(1.15, 1.15),
    envMapIntensity: 0.65,
  }, { macroDetail: 0.60 });

  const windowAtlas = new MatPhysOrStd({
    name: 'WindowAtlas',
    map: windowAtlasSet.map,
    normalMap: windowAtlasSet.normalMap,
    aoMap: windowAtlasSet.ormMap,
    roughnessMap: windowAtlasSet.ormMap,
    metalnessMap: windowAtlasSet.ormMap,
    emissiveMap: windowAtlasSet.emissiveMap,
    emissive: new THREE.Color(1.0, 0.78, 0.46),
    emissiveIntensity: 0.35,
    roughness: 0.18,
    metalness: 0.05,
    ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 0.90, clearcoatRoughness: 0.05 }),
    envMapIntensity: 1.75,
  });
  shaderSystem.patchMaterial(windowAtlas, shaderSystem.staticEntityUniforms, {
    interiorRoom: 1.0,
  });

  // 2. FIA Red-and-White Racing Apex Kerbs
  const kerbTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e8ecf2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d92626';
    ctx.fillRect(0, 0, w, h * 0.5);
    // Subtle rubber tire marks along inner edge
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(20,22,26,0.32)');
    grad.addColorStop(0.35, 'rgba(20,22,26,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, { aniso: maxAniso });

  const racingKerb = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'RacingKerb',
      map: kerbTex,
      normalMap: highwayConcreteSet.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.72,
      metalness: 0.0,
    })
  );

  // 3. Highway Y-Fork Gore Chevron Asphalt Texture
  const goreTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#252930';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e5e9f0';
    ctx.lineWidth = 24;
    ctx.strokeRect(20, 0, w - 40, h);
    ctx.lineWidth = 28;
    for (let y = -h; y < h * 2; y += 128) {
      ctx.beginPath();
      ctx.moveTo(28, y + 95);
      ctx.lineTo(w * 0.5, y + 18);
      ctx.lineTo(w - 28, y + 95);
      ctx.stroke();
    }
  }, { aniso: maxAniso });

  const highwayGore = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'HighwayGore',
      map: goreTex,
      normalMap: roadAsphaltSet.normalMap,
      roughness: 0.78,
      metalness: 0.0,
    })
  );

  // 4. Reflective Overhead Expressway Gantry Signs
  const makeHighwaySignMat = (title, subtitle, accentColor = '#0b6b43', arrow = '') => {
    const signTex = makeCanvasTexture(1024, 256, (ctx, w, h) => {
      ctx.fillStyle = accentColor;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 10;
      ctx.strokeRect(14, 14, w - 28, h - 28);

      ctx.fillStyle = '#ffffff';
      ctx.font = '800 66px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(arrow ? `${title} ${arrow}` : title, w * 0.5, h * 0.40);

      ctx.fillStyle = '#d1fae5';
      ctx.font = '700 34px Inter, system-ui, sans-serif';
      ctx.fillText(subtitle, w * 0.5, h * 0.74);
    }, { repeat: false, aniso: maxAniso });

    return shaderSystem.patchMaterial(
      new THREE.MeshStandardMaterial({
        name: `Sign_${title}`,
        map: signTex,
        emissiveMap: signTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.28,
        roughness: 0.36,
        metalness: 0.15,
      })
    );
  };

  const signLoopLeft = makeHighwaySignMat('← GRAND PLAZA & ARCH', 'URBAN GP CIRCUIT  •  KEEP LEFT', '#14532d');
  const signSkywayRight = makeHighwaySignMat('SKYWAY EXPRESSWAY ↗', 'MULTI-LEVEL FLYOVER  •  EXIT RIGHT', '#0369a1');
  const signSkywayMerge = makeHighwaySignMat('↑ BOULEVARD STRAIGHT', 'MERGE AHEAD  •  HIGH SPEED ZONE', '#0f766e');
  const signIRDetector = makeHighwaySignMat('845nm INFRARED SPEED GATE', 'INVISIBLE AT REST  •  GLOWS ABOVE 0.22c', '#3b0764');

  // Grand Prix Chequered Start / Finish Banner
  const finishBannerTex = makeCanvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    // Chequered strips left & right
    const sq = 32;
    for (let r = 0; r < h / sq; r++) {
      for (let c = 0; c < 5; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#0f172a';
        ctx.fillRect(c * sq, r * sq, sq, sq);
        ctx.fillRect(w - (c + 1) * sq, r * sq, sq, sq);
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 58px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RELATIVISTIC GRAND PRIX', w * 0.5, h * 0.39);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '800 32px Inter, system-ui, sans-serif';
    ctx.fillText('START / FINISH  •  TWIN-PARADOX TIMING', w * 0.5, h * 0.74);
  }, { repeat: false, aniso: maxAniso });

  const signStartFinish = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'SignStartFinish',
      map: finishBannerTex,
      emissiveMap: finishBannerTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.35,
      roughness: 0.32,
      metalness: 0.2,
    })
  );

  // 5. Modern Glass Skyscraper Curtain-Wall Material
  const glassCurtainMap = makeCanvasTexture(512, 512, (ctx, w, h) => {
    const cols = 8;
    const rows = 8;
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const seed = Math.sin((r * 17 + c * 31) * 12.9898) * 43758.5453;
        const frac = seed - Math.floor(seed);
        const blueShift = Math.floor(frac * 24);
        ctx.fillStyle = `rgb(${26 + blueShift}, ${46 + blueShift}, ${68 + blueShift})`;
        ctx.fillRect(c * cw, r * ch, cw, ch);
        // Spandrel floor slab band
        ctx.fillStyle = '#141d29';
        ctx.fillRect(c * cw, r * ch, cw, ch * 0.18);
        // Dark aluminum mullions
        ctx.strokeStyle = '#0e141d';
        ctx.lineWidth = 4;
        ctx.strokeRect(c * cw, r * ch, cw, ch);
      }
    }
  }, { aniso: maxAniso });

  const glassCurtainEmissive = makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const cols = 8;
    const rows = 8;
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = Math.abs(Math.sin(r * 41.3 + c * 19.7));
        if (s > 0.62) {
          ctx.fillStyle = s > 0.82 ? '#ffe4b5' : '#bae6fd';
          ctx.fillRect(c * cw + 5, r * ch + ch * 0.22, cw - 10, ch * 0.70);
        }
      }
    }
  }, { aniso: maxAniso });

  const skyscraperGlass = shaderSystem.patchMaterial(
    new MatPhysOrStd({
      name: 'SkyscraperGlass',
      map: glassCurtainMap,
      emissiveMap: glassCurtainEmissive,
      emissive: new THREE.Color(1.0, 0.88, 0.68),
      emissiveIntensity: 0.25,
      roughness: 0.06,
      metalness: 0.25,
      ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 1.0, clearcoatRoughness: 0.03 }),
      envMapIntensity: 2.05,
    }),
    shaderSystem.staticEntityUniforms,
    { interiorRoom: 2.0 }
  );

  // 6. Clock Tower Illuminated Dial Texture
  const clockDialTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const r = w * 0.46;
    ctx.fillStyle = '#1e2430';
    ctx.fillRect(0, 0, w, h);

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fdfaf2';
    ctx.fill();
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#b48a3e';
    ctx.stroke();

    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * Math.PI * 2 - Math.PI * 0.5;
      const major = i % 5 === 0;
      const r0 = major ? r * 0.80 : r * 0.87;
      const r1 = r * 0.93;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = major ? 7 : 3;
      ctx.stroke();
    }

    const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 36px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    numerals.forEach((lbl, idx) => {
      const ang = (idx / 12) * Math.PI * 2 - Math.PI * 0.5;
      ctx.fillText(lbl, cx + Math.cos(ang) * r * 0.66, cy + Math.sin(ang) * r * 0.66);
    });
  }, { repeat: false, aniso: maxAniso });

  const clockDial = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'ClockDial',
      map: clockDialTex,
      emissiveMap: clockDialTex,
      emissive: new THREE.Color(1.0, 0.94, 0.80),
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.1,
    })
  );

  // 7. Architectural Metals, Foliage (Wood Effect High NIR!), Park Grass & Monochromatic Signals
  const darkIron = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'DarkCastIron',
      color: new THREE.Color(0x222933),
      roughness: 0.42,
      metalness: 0.82,
      envMapIntensity: 1.1,
    })
  );

  const brushedSteel = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'BrushedSteel',
      color: new THREE.Color(0xb8c4d0),
      roughness: 0.28,
      metalness: 0.88,
      envMapIntensity: 1.35,
    })
  );

  const stayCableWhite = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'StayCableWhite',
      color: new THREE.Color(0xeef2f7),
      roughness: 0.34,
      metalness: 0.35,
      envMapIntensity: 0.9,
    })
  );

  const brassGold = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'BrassGold',
      color: new THREE.Color(0xd4a64a),
      roughness: 0.25,
      metalness: 0.9,
      envMapIntensity: 1.4,
    })
  );

  // High Near-IR reflectance (1.65) so green boulevard trees glow bright silver-red when blueshifting/redshifting!
  const treeFoliage = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'TreeFoliage',
      color: new THREE.Color(0x3a6b2c),
      normalMap: roofTilesSet.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.84,
      metalness: 0.0,
    }),
    shaderSystem.staticEntityUniforms,
    { uvWeight: 0.18, nirWeight: 1.65 }
  );

  const treeBark = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'TreeBark',
      color: new THREE.Color(0x4b3a2c),
      normalMap: stoneAshlarSet.normalMap,
      roughness: 0.92,
      metalness: 0.0,
    })
  );

  const parkGrass = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'ParkGrass',
      color: new THREE.Color(0x36622c),
      normalMap: roadAsphaltSet.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.88,
      metalness: 0.0,
    }),
    shaderSystem.staticEntityUniforms,
    { uvWeight: 0.45, nirWeight: 1.55, macroDetail: 0.92 }
  );

  const awningRed = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'AwningRed',
      color: new THREE.Color(0x9f1d24),
      roughness: 0.82,
      metalness: 0.0,
    })
  );

  const awningNavy = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'AwningNavy',
      color: new THREE.Color(0x1e3a5f),
      roughness: 0.82,
      metalness: 0.0,
    })
  );

  // Monochromatic Spectral Traffic Signal Materials (632nm Red, 590nm Amber, 525nm Green)
  const signalRed632 = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'SignalRed632',
      color: new THREE.Color(0x220404),
      emissive: new THREE.Color(0xff1e14),
      emissiveIntensity: 3.4,
      roughness: 0.2,
    }),
    shaderSystem.staticEntityUniforms,
    { narrowBandNm: 632.0 }
  );

  const signalAmber590 = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'SignalAmber590',
      color: new THREE.Color(0x221602),
      emissive: new THREE.Color(0xffaa08),
      emissiveIntensity: 2.6,
      roughness: 0.2,
    }),
    shaderSystem.staticEntityUniforms,
    { narrowBandNm: 590.0 }
  );

  const signalGreen525 = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'SignalGreen525',
      color: new THREE.Color(0x03220c),
      emissive: new THREE.Color(0x14f068),
      emissiveIntensity: 2.8,
      roughness: 0.2,
    }),
    shaderSystem.staticEntityUniforms,
    { narrowBandNm: 525.0 }
  );

  // Pure 845nm Near-Infrared Beacon (Pitch-dark at 0c, lights up red -> green -> violet above 0.22c!)
  const signalIR845 = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'SignalIR845',
      color: new THREE.Color(0x09060d),
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 3.8,
      roughness: 0.15,
    }),
    shaderSystem.staticEntityUniforms,
    { narrowBandNm: 845.0 }
  );

  // Synchronized 0.75 Hz Optical Light-Wave Beacon (ripples at speed c across the city!)
  const syncPulseUniforms = shaderSystem.createEntityUniforms({
    isDynamic: false,
    pulseHz: 0.75,
  });
  const syncPulseCyan = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'SyncPulseCyan',
      color: new THREE.Color(0x082f49),
      emissive: new THREE.Color(0x38bdf8),
      emissiveIntensity: 2.2,
      roughness: 0.18,
    }),
    syncPulseUniforms,
    { narrowBandNm: 492.0 }
  );

  const warmLampBulb = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'WarmLampBulb',
      color: new THREE.Color(0xfff4d6),
      emissive: new THREE.Color(0xffb85c),
      emissiveIntensity: 1.2,
      roughness: 0.2,
    })
  );

  // 8. High-Contrast Trackside Relativistic Texture-Distortion Calibration Billboards!
  const terrellGridTex = makeCanvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0b1324';
    ctx.fillRect(0, 0, w, h);

    // Bold 64px Cartesian grid lines (visibly bend into hyperbolas & compress under aberration/Lorentz!)
    for (let x = 0; x <= w; x += 64) {
      ctx.strokeStyle = x % 256 === 0 ? '#38bdf8' : 'rgba(226,232,240,0.45)';
      ctx.lineWidth = x % 256 === 0 ? 5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 64) {
      ctx.strokeStyle = y % 256 === 0 ? '#fbbf24' : 'rgba(226,232,240,0.45)';
      ctx.lineWidth = y % 256 === 0 ? 5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Concentric reference circles (deform visibly into sheared ellipses/ovals when passing fast!)
    for (const cx of [192, w - 192]) {
      for (const r of [56, 112, 164]) {
        ctx.strokeStyle = r === 112 ? '#f43f5e' : '#f8fafc';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(cx, h * 0.5, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(11,19,36,0.84)';
    ctx.fillRect(w * 0.26, h * 0.34, w * 0.48, h * 0.32);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.strokeRect(w * 0.26, h * 0.34, w * 0.48, h * 0.32);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 42px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TERRELL OPTICAL GRID', w * 0.5, h * 0.45);
    ctx.fillStyle = '#fbbf24';
    ctx.font = '800 26px Inter, system-ui, sans-serif';
    ctx.fillText('WATCH GRID LINES BEND AT v → c', w * 0.5, h * 0.58);
  }, { repeat: false, aniso: maxAniso });

  const terrellGridBillboard = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'TerrellGridBillboard',
      map: terrellGridTex,
      emissiveMap: terrellGridTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.32,
      roughness: 0.32,
      metalness: 0.1,
    })
  );

  const gpPosterTex = makeCanvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(0, 0, w, h);
    // Bold diagonal racing stripes + chequered top/bottom border
    ctx.fillStyle = '#f59e0b';
    for (let x = -h; x < w + h; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 56, h);
      ctx.lineTo(x + 56 + h * 0.45, 0);
      ctx.lineTo(x + h * 0.45, 0);
      ctx.closePath();
      ctx.fill();
    }
    const sq = 32;
    for (let c = 0; c < w / sq; c++) {
      ctx.fillStyle = c % 2 === 0 ? '#f8fafc' : '#0f172a';
      ctx.fillRect(c * sq, 0, sq, sq);
      ctx.fillRect(c * sq, h - sq, sq, sq);
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
    ctx.fillRect(w * 0.14, h * 0.25, w * 0.72, h * 0.50);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 54px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LORENTZ MOTORSPORT', w * 0.5, h * 0.43);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '800 30px Inter, system-ui, sans-serif';
    ctx.fillText('SPEED LIMIT: c = 25.0 m/s  •  STAY ON TRACK', w * 0.5, h * 0.62);
  }, { repeat: false, aniso: maxAniso });

  const gpPosterBillboard = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'GPPosterBillboard',
      map: gpPosterTex,
      emissiveMap: gpPosterTex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.28,
      roughness: 0.34,
      metalness: 0.1,
    })
  );

  // Vivid Yellow/Black Hazard Side-Frame for 3D Billboards (makes Terrell rotation of side faces unmistakable!)
  const hazardSideTex = makeCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0f172a';
    for (let y = -w; y < h + w; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + w);
      ctx.lineTo(w, y + w + 32);
      ctx.lineTo(0, y + 32);
      ctx.closePath();
      ctx.fill();
    }
  }, { aniso: maxAniso });

  const hazardStripeSide = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'HazardStripeSide',
      map: hazardSideTex,
      roughness: 0.5,
      metalness: 0.1,
    })
  );

  // 9. Off-Road Infield Reflecting Lagoon Water & Sand Trap Materials
  const waterLagoon = shaderSystem.patchMaterial(
    new MatPhysOrStd({
      name: 'WaterLagoon',
      color: new THREE.Color(0x093a54),
      normalMap: roofTilesSet.normalMap,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughness: 0.05,
      metalness: 0.08,
      ...(IS_MOBILE_DEVICE ? {} : { clearcoat: 1.0, clearcoatRoughness: 0.03 }),
      envMapIntensity: 2.25,
    })
  );

  const sandBeach = shaderSystem.patchMaterial(
    new THREE.MeshStandardMaterial({
      name: 'SandBeach',
      color: new THREE.Color(0xd6be8a),
      normalMap: roadAsphaltSet.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.92,
      metalness: 0.0,
    })
  );

  return {
    roadAsphalt,
    roadCrosswalk,
    highwayRoad,
    highwayConcrete,
    sidewalkCobble,
    brickFacade,
    brickWarm,
    stoneAshlar,
    stoneCream,
    roofTiles,
    windowAtlas,
    racingKerb,
    highwayGore,
    signLoopLeft,
    signSkywayRight,
    signSkywayMerge,
    signIRDetector,
    signStartFinish,
    skyscraperGlass,
    clockDial,
    darkIron,
    brushedSteel,
    stayCableWhite,
    brassGold,
    treeFoliage,
    treeBark,
    parkGrass,
    awningRed,
    awningNavy,
    signalRed632,
    signalAmber590,
    signalGreen525,
    signalIR845,
    syncPulseCyan,
    warmLampBulb,
    terrellGridBillboard,
    gpPosterBillboard,
    hazardStripeSide,
    waterLagoon,
    sandBeach,
    // Dynamic time-of-day emissive materials whose intensity scales up at dusk/night
    emissiveNightMaterials: [
      { mat: windowAtlas, day: 0.12, night: 1.45 },
      { mat: skyscraperGlass, day: 0.08, night: 1.25 },
      { mat: warmLampBulb, day: 0.25, night: 4.2 },
      { mat: clockDial, day: 0.15, night: 1.15 },
    ],
  };
}
