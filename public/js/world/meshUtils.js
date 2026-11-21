/**
 * Relativistic Subdivided Mesh Builder
 * ====================================
 *
 * Automatically tessellates quads, boxes, roofs, stairs, arches, and cylinders
 * so triangle edges remain smaller than `maxEdge` meters. Because relativistic
 * aberration and past-light-cone retardation map straight city lines into smooth
 * hyperbolas, fine mesh subdivision guarantees silky-smooth curved edges without
 * polygon kinks or frustum-clipping artifacts.
 *
 * Interleaved Vertex Layout (16 floats = 64 bytes, cache-line aligned):
 *   0..2  : aPos      (vec3)
 *   3..5  : aNormal   (vec3)
 *   6..9  : aTangent  (vec4, xyz + handedness w)
 *   10..11: aUV       (vec2)
 *   12..15: aColorAO  (vec4, rgb linear tint + a ambient occlusion)
 */

export const VERTEX_FLOATS = 16;
export const VERTEX_STRIDE_BYTES = 64;

export class MeshBuilder {
  constructor(defaultMaxEdge = 1.1) {
    this.defaultMaxEdge = defaultMaxEdge;
    /** @type {number[]} */
    this.verts = [];
    /** @type {number[]} */
    this.indices = [];
    this.vertexCount = 0;
  }

  pushVertex(px, py, pz, nx, ny, nz, tx, ty, tz, tw, u, v, r, g, b, ao) {
    this.verts.push(px, py, pz, nx, ny, nz, tx, ty, tz, tw, u, v, r, g, b, ao);
    return this.vertexCount++;
  }

  /**
   * Adds a bilinearly subdivided quad (p00 -> p10 -> p11 -> p01 counter-clockwise)
   * with automatic normal & UV-aligned tangent computation.
   *
   * @param {number[]} p00 Bottom-left [x, y, z]
   * @param {number[]} p10 Bottom-right [x, y, z]
   * @param {number[]} p11 Top-right [x, y, z]
   * @param {number[]} p01 Top-left [x, y, z]
   * @param {number[]} uvRect [u0, v0, u1, v1]
   * @param {number[]} color [r, g, b] linear tint
   * @param {number[]|number} aoCorners Either scalar AO or [ao00, ao10, ao11, ao01]
   * @param {number} [maxEdge] Max world-space segment length
   */
  addQuad(p00, p10, p11, p01, uvRect = [0, 0, 1, 1], color = [1, 1, 1], aoCorners = 1.0, maxEdge = this.defaultMaxEdge) {
    const eUX = p10[0] - p00[0], eUY = p10[1] - p00[1], eUZ = p10[2] - p00[2];
    const eVX = p01[0] - p00[0], eVY = p01[1] - p00[1], eVZ = p01[2] - p00[2];
    const eUX2 = p11[0] - p01[0], eUY2 = p11[1] - p01[1], eUZ2 = p11[2] - p01[2];
    const eVX2 = p11[0] - p10[0], eVY2 = p11[1] - p10[1], eVZ2 = p11[2] - p10[2];

    const lenU = Math.max(Math.hypot(eUX, eUY, eUZ), Math.hypot(eUX2, eUY2, eUZ2));
    const lenV = Math.max(Math.hypot(eVX, eVY, eVZ), Math.hypot(eVX2, eVY2, eVZ2));

    const segU = Math.max(1, Math.min(48, Math.ceil(lenU / maxEdge)));
    const segV = Math.max(1, Math.min(48, Math.ceil(lenV / maxEdge)));

    // Face normal = normalize(eU x eV)
    let nx = eUY * eVZ - eUZ * eVY;
    let ny = eUZ * eVX - eUX * eVZ;
    let nz = eUX * eVY - eUY * eVX;
    const nLen = Math.hypot(nx, ny, nz) || 1.0;
    nx /= nLen; ny /= nLen; nz /= nLen;

    // Tangent aligned with +U edge
    let tx = eUX, ty = eUY, tz = eUZ;
    const tLen = Math.hypot(tx, ty, tz) || 1.0;
    tx /= tLen; ty /= tLen; tz /= tLen;

    const [u0, v0, u1, v1] = uvRect;
    const [cr, cg, cb] = color;
    const ao4 = Array.isArray(aoCorners) ? aoCorners : [aoCorners, aoCorners, aoCorners, aoCorners];

    const baseIdx = this.vertexCount;
    const cols = segU + 1;

    for (let j = 0; j <= segV; j++) {
      const tv = j / segV;
      for (let i = 0; i <= segU; i++) {
        const tu = i / segU;
        const w00 = (1 - tu) * (1 - tv);
        const w10 = tu * (1 - tv);
        const w11 = tu * tv;
        const w01 = (1 - tu) * tv;

        const px = w00 * p00[0] + w10 * p10[0] + w11 * p11[0] + w01 * p01[0];
        const py = w00 * p00[1] + w10 * p10[1] + w11 * p11[1] + w01 * p01[1];
        const pz = w00 * p00[2] + w10 * p10[2] + w11 * p11[2] + w01 * p01[2];

        const u = u0 + (u1 - u0) * tu;
        const v = v1 + (v0 - v1) * tv; // v=0 top of texture, v=1 bottom
        const ao = w00 * ao4[0] + w10 * ao4[1] + w11 * ao4[2] + w01 * ao4[3];

        this.pushVertex(px, py, pz, nx, ny, nz, tx, ty, tz, 1.0, u, v, cr, cg, cb, ao);
      }
    }

    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const i00 = baseIdx + j * cols + i;
        const i10 = i00 + 1;
        const i01 = i00 + cols;
        const i11 = i01 + 1;
        this.indices.push(i00, i10, i11, i00, i11, i01);
      }
    }
  }

  /**
   * Adds an axis-aligned or yaw-rotated box centered horizontally at (cx, cz),
   * extending vertically from yMin to yMax, with world-space UV tiling and AO gradient.
   */
  addBox(cx, yMin, cz, sx, sy, sz, opts = {}) {
    const yaw = opts.yaw ?? 0.0;
    const color = opts.color ?? [1, 1, 1];
    const uvScale = opts.uvScale ?? 0.35; // repeats per meter
    const uvRectOverride = opts.uvRect ?? null;
    const aoBottom = opts.aoBottom ?? 0.68;
    const aoTop = opts.aoTop ?? 1.0;
    const includeTop = opts.top !== false;
    const includeBottom = opts.bottom === true;
    const maxEdge = opts.maxEdge ?? this.defaultMaxEdge;

    const hx = sx * 0.5;
    const hz = sz * 0.5;
    const y0 = yMin;
    const y1 = yMin + sy;
    const cy = Math.cos(yaw);
    const syaw = Math.sin(yaw);

    const rot = (lx, ly, lz) => [
      cx + lx * cy + lz * syaw,
      ly,
      cz - lx * syaw + lz * cy,
    ];

    const p000 = rot(-hx, y0,  hz);
    const p100 = rot( hx, y0,  hz);
    const p110 = rot( hx, y1,  hz);
    const p010 = rot(-hx, y1,  hz);

    const p001 = rot(-hx, y0, -hz);
    const p101 = rot( hx, y0, -hz);
    const p111 = rot( hx, y1, -hz);
    const p011 = rot(-hx, y1, -hz);

    const aoSide = [aoBottom, aoBottom, aoTop, aoTop];
    const uvX = uvRectOverride || [0, 0, sx * uvScale, sy * uvScale];
    const uvZ = uvRectOverride || [0, 0, sz * uvScale, sy * uvScale];
    const uvTop = uvRectOverride || [0, 0, sx * uvScale, sz * uvScale];

    // Front (+Z), Back (-Z), Right (+X), Left (-X)
    this.addQuad(p000, p100, p110, p010, uvX, color, aoSide, maxEdge);
    this.addQuad(p101, p001, p011, p111, uvX, color, aoSide, maxEdge);
    this.addQuad(p100, p101, p111, p110, uvZ, color, aoSide, maxEdge);
    this.addQuad(p001, p000, p010, p011, uvZ, color, aoSide, maxEdge);

    if (includeTop) {
      this.addQuad(p010, p110, p111, p011, uvTop, color, aoTop, maxEdge);
    }
    if (includeBottom) {
      this.addQuad(p001, p101, p100, p000, uvTop, color, aoBottom * 0.75, maxEdge);
    }
  }

  /**
   * Adds a pitched gable roof with eave overhangs (ridge along local X or local Z).
   */
  addGableRoof(cx, yBase, cz, sx, ridgeHeight, sz, gableBuilder, opts = {}) {
    const yaw = opts.yaw ?? 0.0;
    const ridgeAlongX = opts.ridgeAlongX !== false;
    const color = opts.color ?? [1, 1, 1];
    const gableColor = opts.gableColor ?? [1, 1, 1];
    const uvScale = opts.uvScale ?? 0.42;
    const maxEdge = opts.maxEdge ?? this.defaultMaxEdge;
    const overhang = opts.overhang ?? 0.38;

    const cy = Math.cos(yaw);
    const syaw = Math.sin(yaw);
    const rot = (lx, ly, lz) => [
      cx + lx * cy + lz * syaw,
      ly,
      cz - lx * syaw + lz * cy,
    ];

    const hx = sx * 0.5 + overhang;
    const hz = sz * 0.5 + overhang;
    const yPeak = yBase + ridgeHeight;

    if (ridgeAlongX) {
      const slopeLen = Math.hypot(hz, ridgeHeight);
      const uvSlope = [0, 0, hx * 2 * uvScale, slopeLen * uvScale];
      // Front slope (+Z)
      this.addQuad(
        rot(-hx, yBase, hz),
        rot(hx, yBase, hz),
        rot(hx, yPeak, 0),
        rot(-hx, yPeak, 0),
        uvSlope,
        color,
        [0.85, 0.85, 1.0, 1.0],
        maxEdge
      );
      // Back slope (-Z)
      this.addQuad(
        rot(hx, yBase, -hz),
        rot(-hx, yBase, -hz),
        rot(-hx, yPeak, 0),
        rot(hx, yPeak, 0),
        uvSlope,
        color,
        [0.85, 0.85, 1.0, 1.0],
        maxEdge
      );
      // Gable triangular end walls (on main wall footprint sx*0.5, sz*0.5)
      if (gableBuilder) {
        const wx = sx * 0.5;
        const wz = sz * 0.5;
        // +X gable
        gableBuilder.addTriangleSubdivided(
          rot(wx, yBase, wz),
          rot(wx, yBase, -wz),
          rot(wx, yPeak, 0),
          gableColor,
          uvScale,
          maxEdge
        );
        // -X gable
        gableBuilder.addTriangleSubdivided(
          rot(-wx, yBase, -wz),
          rot(-wx, yBase, wz),
          rot(-wx, yPeak, 0),
          gableColor,
          uvScale,
          maxEdge
        );
      }
    } else {
      const slopeLen = Math.hypot(hx, ridgeHeight);
      const uvSlope = [0, 0, hz * 2 * uvScale, slopeLen * uvScale];
      // +X slope
      this.addQuad(
        rot(hx, yBase, hz),
        rot(hx, yBase, -hz),
        rot(0, yPeak, -hz),
        rot(0, yPeak, hz),
        uvSlope,
        color,
        [0.85, 0.85, 1.0, 1.0],
        maxEdge
      );
      // -X slope
      this.addQuad(
        rot(-hx, yBase, -hz),
        rot(-hx, yBase, hz),
        rot(0, yPeak, hz),
        rot(0, yPeak, -hz),
        uvSlope,
        color,
        [0.85, 0.85, 1.0, 1.0],
        maxEdge
      );
      if (gableBuilder) {
        const wx = sx * 0.5;
        const wz = sz * 0.5;
        gableBuilder.addTriangleSubdivided(
          rot(-wx, yBase, wz),
          rot(wx, yBase, wz),
          rot(0, yPeak, wz),
          gableColor,
          uvScale,
          maxEdge
        );
        gableBuilder.addTriangleSubdivided(
          rot(wx, yBase, -wz),
          rot(-wx, yBase, -wz),
          rot(0, yPeak, -wz),
          gableColor,
          uvScale,
          maxEdge
        );
      }
    }
  }

  /**
   * Subdivides a triangle (p0, p1, p2) via degenerate-safe barycentric rows.
   */
  addTriangleSubdivided(p0, p1, p2, color = [1, 1, 1], uvScale = 0.35, maxEdge = this.defaultMaxEdge) {
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const maxL = Math.max(
      Math.hypot(...e1),
      Math.hypot(...e2),
      Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
    );
    const N = Math.max(1, Math.min(24, Math.ceil(maxL / maxEdge)));

    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nL = Math.hypot(nx, ny, nz) || 1.0;
    nx /= nL; ny /= nL; nz /= nL;

    const tL = Math.hypot(...e1) || 1.0;
    const tx = e1[0] / tL, ty = e1[1] / tL, tz = e1[2] / tL;
    const [cr, cg, cb] = color;

    const rowStarts = [];
    for (let j = 0; j <= N; j++) {
      rowStarts.push(this.vertexCount);
      const count = N - j;
      for (let i = 0; i <= count; i++) {
        const w1 = i / N;
        const w2 = j / N;
        const w0 = 1.0 - w1 - w2;
        const px = w0 * p0[0] + w1 * p1[0] + w2 * p2[0];
        const py = w0 * p0[1] + w1 * p1[1] + w2 * p2[1];
        const pz = w0 * p0[2] + w1 * p1[2] + w2 * p2[2];
        const u = (w1 * tL) * uvScale;
        const v = (py - p0[1]) * uvScale;
        this.pushVertex(px, py, pz, nx, ny, nz, tx, ty, tz, 1.0, u, v, cr, cg, cb, 0.92);
      }
    }

    for (let j = 0; j < N; j++) {
      const r0 = rowStarts[j];
      const r1 = rowStarts[j + 1];
      const cols = N - j;
      for (let i = 0; i < cols; i++) {
        this.indices.push(r0 + i, r0 + i + 1, r1 + i);
        if (i + 1 < cols) {
          this.indices.push(r0 + i + 1, r1 + i + 1, r1 + i);
        }
      }
    }
  }

  /**
   * Builds a detailed stone staircase with individual risers, treads, side cheek walls,
   * and iron/stone handrails!
   * Ascends from (cx, yBottom, cz) along local -Z (rotated by `yaw`) over `totalRun` & `totalRise`.
   */
  addStaircase(cx, yBottom, cz, width, totalRise, totalRun, numSteps, railBuilder, opts = {}) {
    const yaw = opts.yaw ?? 0.0;
    const color = opts.color ?? [1, 1, 1];
    const maxEdge = opts.maxEdge ?? 0.75;
    const stepH = totalRise / numSteps;
    const stepD = totalRun / numSteps;
    const cy = Math.cos(yaw);
    const syaw = Math.sin(yaw);

    const rot = (lx, ly, lz) => [
      cx + lx * cy + lz * syaw,
      ly,
      cz - lx * syaw + lz * cy,
    ];

    const hw = width * 0.5;
    for (let s = 0; s < numSteps; s++) {
      const y0 = yBottom + s * stepH;
      const y1 = y0 + stepH;
      const zFront = -(s * stepD);
      const zBack = -((s + 1) * stepD);
      const nosing = zFront + 0.03; // subtle stone bullnose lip

      // Riser (vertical front face of step, facing +Z at yaw=0)
      this.addQuad(
        rot(-hw, y0, zFront),
        rot(hw, y0, zFront),
        rot(hw, y1, nosing),
        rot(-hw, y1, nosing),
        [0, 0, width * 0.45, stepH * 0.6],
        color,
        [0.58, 0.58, 0.92, 0.92], // dark AO in step crease!
        maxEdge
      );

      // Tread (horizontal top face of step)
      this.addQuad(
        rot(-hw, y1, nosing),
        rot(hw, y1, nosing),
        rot(hw, y1, zBack),
        rot(-hw, y1, zBack),
        [0, 0, width * 0.45, stepD * 0.5],
        color,
        [0.98, 0.98, 0.68, 0.68],
        maxEdge
      );
    }

    // Side stringer / balustrade cheek walls
    const cheekW = 0.24;
    for (const side of [-1, 1]) {
      const lx = side * (hw + cheekW * 0.5);
      // Sloped stone stringer block approximated by stepped/sloped quads
      this.addQuad(
        rot(lx - cheekW * 0.5, yBottom, 0),
        rot(lx + cheekW * 0.5, yBottom, 0),
        rot(lx + cheekW * 0.5, yBottom + 0.48, 0),
        rot(lx - cheekW * 0.5, yBottom + 0.48, 0),
        [0, 0, 0.2, 0.3],
        color,
        0.9,
        maxEdge
      );
      // Outer & inner sloped stringer faces
      const pBotFrontOut = rot(lx + side * cheekW * 0.5, yBottom, 0);
      const pTopBackOut = rot(lx + side * cheekW * 0.5, yBottom + totalRise, -totalRun);
      const pTopRailOut = rot(lx + side * cheekW * 0.5, yBottom + totalRise + 0.48, -totalRun);
      const pBotRailOut = rot(lx + side * cheekW * 0.5, yBottom + 0.48, 0);

      const pBotFrontIn = rot(lx - side * cheekW * 0.5, yBottom, 0);
      const pTopBackIn = rot(lx - side * cheekW * 0.5, yBottom + totalRise, -totalRun);
      const pTopRailIn = rot(lx - side * cheekW * 0.5, yBottom + totalRise + 0.48, -totalRun);
      const pBotRailIn = rot(lx - side * cheekW * 0.5, yBottom + 0.48, 0);

      if (side > 0) {
        this.addQuad(pBotFrontOut, pTopBackOut, pTopRailOut, pBotRailOut, [0, 0, totalRun * 0.35, 0.4], color, 0.92, maxEdge);
        this.addQuad(pTopBackIn, pBotFrontIn, pBotRailIn, pTopRailIn, [0, 0, totalRun * 0.35, 0.4], color, 0.85, maxEdge);
      } else {
        this.addQuad(pTopBackOut, pBotFrontOut, pBotRailOut, pTopRailOut, [0, 0, totalRun * 0.35, 0.4], color, 0.92, maxEdge);
        this.addQuad(pBotFrontIn, pTopBackIn, pTopRailIn, pBotRailIn, [0, 0, totalRun * 0.35, 0.4], color, 0.85, maxEdge);
      }
      // Sloped stone cap rail
      this.addQuad(
        rot(lx - cheekW * 0.5, yBottom + 0.48, 0),
        rot(lx + cheekW * 0.5, yBottom + 0.48, 0),
        rot(lx + cheekW * 0.5, yBottom + totalRise + 0.48, -totalRun),
        rot(lx - cheekW * 0.5, yBottom + totalRise + 0.48, -totalRun),
        [0, 0, 0.2, totalRun * 0.4],
        color,
        1.0,
        maxEdge
      );

      // Wrought-iron handrail posts + top rail if railBuilder supplied
      if (railBuilder) {
        const postCount = Math.max(2, Math.floor(numSteps / 3) + 1);
        for (let p = 0; p < postCount; p++) {
          const t = p / (postCount - 1);
          const pz = -t * totalRun;
          const py = yBottom + t * totalRise + 0.48;
          const worldP = rot(lx, py, pz);
          railBuilder.addBox(worldP[0], worldP[1], worldP[2], 0.06, 0.46, 0.06, {
            yaw,
            color: [0.16, 0.17, 0.20],
            uvRect: [0.55, 0.05, 0.95, 0.45],
            maxEdge: 0.5,
          });
        }
      }
    }
  }

  /**
   * Adds a vertical cylinder / column / pole / trunk.
   */
  addCylinder(cx, yMin, cz, radiusBottom, radiusTop, height, radialSegs = 10, opts = {}) {
    const color = opts.color ?? [1, 1, 1];
    const uvRect = opts.uvRect ?? [0, 0, 2.0, height * 0.5];
    const maxEdge = opts.maxEdge ?? this.defaultMaxEdge;
    const heightSegs = Math.max(1, Math.min(24, Math.ceil(height / maxEdge)));

    const baseIdx = this.vertexCount;
    const cols = radialSegs + 1;

    for (let j = 0; j <= heightSegs; j++) {
      const tv = j / heightSegs;
      const y = yMin + tv * height;
      const rad = radiusBottom + (radiusTop - radiusBottom) * tv;
      const ao = (opts.aoBottom ?? 0.72) + ((opts.aoTop ?? 1.0) - (opts.aoBottom ?? 0.72)) * tv;

      for (let i = 0; i <= radialSegs; i++) {
        const tu = i / radialSegs;
        const ang = tu * Math.PI * 2.0;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);

        const px = cx + rad * ca;
        const pz = cz + rad * sa;
        const tx = -sa, ty = 0.0, tz = ca;
        const u = uvRect[0] + (uvRect[2] - uvRect[0]) * tu;
        const v = uvRect[3] + (uvRect[1] - uvRect[3]) * tv;

        this.pushVertex(px, y, pz, ca, 0.0, sa, tx, ty, tz, 1.0, u, v, color[0], color[1], color[2], ao);
      }
    }

    for (let j = 0; j < heightSegs; j++) {
      for (let i = 0; i < radialSegs; i++) {
        const i00 = baseIdx + j * cols + i;
        const i10 = i00 + 1;
        const i01 = i00 + cols;
        const i11 = i01 + 1;
        this.indices.push(i00, i01, i11, i00, i11, i10);
      }
    }

    if (opts.capTop) {
      const centerIdx = this.pushVertex(
        cx, yMin + height, cz,
        0, 1, 0, 1, 0, 0, 1,
        0.25, 0.25,
        color[0], color[1], color[2], 1.0
      );
      const ringStart = this.vertexCount;
      for (let i = 0; i <= radialSegs; i++) {
        const ang = (i / radialSegs) * Math.PI * 2.0;
        this.pushVertex(
          cx + radiusTop * Math.cos(ang), yMin + height, cz + radiusTop * Math.sin(ang),
          0, 1, 0, 1, 0, 0, 1,
          0.25 + 0.2 * Math.cos(ang), 0.25 + 0.2 * Math.sin(ang),
          color[0], color[1], color[2], 1.0
        );
      }
      for (let i = 0; i < radialSegs; i++) {
        this.indices.push(centerIdx, ringStart + i + 1, ringStart + i);
      }
    }
  }

  /**
   * Adds a smooth UV-tessellated ellipsoid / sphere (with optional organic canopy wobble).
   */
  addEllipsoid(cx, cy, cz, rx, ry, rz, latSegs = 10, lonSegs = 14, opts = {}) {
    const color = opts.color ?? [1, 1, 1];
    const uvScale = opts.uvScale ?? 1.8;
    const uvRect = opts.uvRect ?? null;
    const aoBottom = opts.aoBottom ?? 0.45;
    const aoTop = opts.aoTop ?? 1.0;
    const wobble = opts.wobble ?? 0.0;

    const baseIdx = this.vertexCount;
    const cols = lonSegs + 1;

    for (let j = 0; j <= latSegs; j++) {
      const tv = j / latSegs;
      const theta = tv * Math.PI; // 0 (top +Y) -> pi (bottom -Y)
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const ao = aoBottom + (aoTop - aoBottom) * (cosT * 0.5 + 0.5);

      for (let i = 0; i <= lonSegs; i++) {
        const tu = i / lonSegs;
        const phi = tu * Math.PI * 2.0;
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);

        const disp = wobble > 0.0
          ? 1.0 + wobble * Math.sin(phi * 3.0 + theta * 4.0) * Math.cos(phi * 2.0 - theta * 3.0)
          : 1.0;

        const nx = sinT * cosP;
        const ny = cosT;
        const nz = sinT * sinP;

        const px = cx + rx * nx * disp;
        const py = cy + ry * ny * disp;
        const pz = cz + rz * nz * disp;

        // Tangent along +phi
        const tx = -sinP, ty = 0.0, tz = cosP;
        const u = uvRect ? uvRect[0] + (uvRect[2] - uvRect[0]) * tu : tu * uvScale;
        const v = uvRect ? uvRect[1] + (uvRect[3] - uvRect[1]) * tv : tv * uvScale;

        this.pushVertex(px, py, pz, nx, ny, nz, tx, ty, tz, 1.0, u, v, color[0], color[1], color[2], ao);
      }
    }

    for (let j = 0; j < latSegs; j++) {
      for (let i = 0; i < lonSegs; i++) {
        const i00 = baseIdx + j * cols + i;
        const i10 = i00 + 1;
        const i01 = i00 + cols;
        const i11 = i01 + 1;
        this.indices.push(i00, i10, i11, i00, i11, i01);
      }
    }
  }

  /**
   * Builds a smooth organic lathe / lofted tube mesh from bottom-to-top cross-sections:
   *   rings: Array of [y, rx, rz, zOffset = 0, xOffset = 0] ordered with increasing y!
   * Computes smooth Gouraud/Phong radial+slope normals so characters & organic props
   * have zero blocky facets.
   */
  addLatheProfile(cx, cy, cz, rings, radialSegs = 12, opts = {}) {
    if (rings.length < 2) return;
    const color = opts.color ?? [1, 1, 1];
    const uvRect = opts.uvRect ?? [0.55, 0.05, 0.95, 0.45]; // defaults to matte fabric/skin!
    const aoBottom = opts.aoBottom ?? 0.72;
    const aoTop = opts.aoTop ?? 1.0;

    const baseIdx = this.vertexCount;
    const cols = radialSegs + 1;
    const R = rings.length;

    for (let j = 0; j < R; j++) {
      const [y, rx, rz, zOff = 0, xOff = 0] = rings[j];
      const prev = rings[Math.max(0, j - 1)];
      const next = rings[Math.min(R - 1, j + 1)];
      const dy = Math.max(1e-4, next[0] - prev[0]);
      const dr = 0.5 * ((next[1] - prev[1]) + (next[2] - prev[2]));
      const nySlope = -dr / Math.hypot(dy, dr);
      const nrScale = dy / Math.hypot(dy, dr);

      const tv = j / (R - 1);
      const ao = aoBottom + (aoTop - aoBottom) * tv;

      for (let i = 0; i <= radialSegs; i++) {
        const tu = i / radialSegs;
        const ang = tu * Math.PI * 2.0;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);

        const px = cx + xOff + rx * ca;
        const py = cy + y;
        const pz = cz + zOff + rz * sa;

        let nx = (ca / Math.max(rx, 0.01)) * nrScale;
        let ny = nySlope;
        let nz = (sa / Math.max(rz, 0.01)) * nrScale;
        const nL = Math.hypot(nx, ny, nz) || 1.0;
        nx /= nL; ny /= nL; nz /= nL;

        const tx = -sa, ty = 0.0, tz = ca;
        const u = uvRect[0] + (uvRect[2] - uvRect[0]) * tu;
        const v = uvRect[3] + (uvRect[1] - uvRect[3]) * tv;

        this.pushVertex(px, py, pz, nx, ny, nz, tx, ty, tz, 1.0, u, v, color[0], color[1], color[2], ao);
      }
    }

    for (let j = 0; j < R - 1; j++) {
      for (let i = 0; i < radialSegs; i++) {
        const i00 = baseIdx + j * cols + i;
        const i10 = i00 + 1;
        const i01 = i00 + cols;
        const i11 = i01 + 1;
        this.indices.push(i00, i01, i11, i00, i11, i10);
      }
    }

    // Optional rounded top/bottom caps
    if (opts.capEnds !== false) {
      const [yb, rxb, rzb, zbOff = 0, xbOff = 0] = rings[0];
      if (rxb > 0.005 && rzb > 0.005) {
        const cBot = this.pushVertex(cx + xbOff, cy + yb, cz + zbOff, 0, -1, 0, 1, 0, 0, 1, uvRect[0], uvRect[1], color[0], color[1], color[2], aoBottom);
        for (let i = 0; i < radialSegs; i++) {
          this.indices.push(cBot, baseIdx + i, baseIdx + i + 1);
        }
      }
      const [yt, rxt, rzt, ztOff = 0, xtOff = 0] = rings[R - 1];
      if (rxt > 0.005 && rzt > 0.005) {
        const topRow = baseIdx + (R - 1) * cols;
        const cTop = this.pushVertex(cx + xtOff, cy + yt, cz + ztOff, 0, 1, 0, 1, 0, 0, 1, uvRect[0], uvRect[1], color[0], color[1], color[2], aoTop);
        for (let i = 0; i < radialSegs; i++) {
          this.indices.push(cTop, topRow + i + 1, topRow + i);
        }
      }
    }
  }

  /**
   * Builds a carved semicircular Roman arch span across X (from -archRadius to +archRadius)
   * with front/back spandrel masonry walls up to yTop and a curved barrel-vault soffit!
   */
  addRomanArchVault(cx, ySpring, yTop, cz, archRadius, depth, archSegs = 18, opts = {}) {
    const color = opts.color ?? [1, 1, 1];
    const uvScale = opts.uvScale ?? 0.34;
    const maxEdge = opts.maxEdge ?? 0.75;
    const zF = cz + depth * 0.5;
    const zB = cz - depth * 0.5;

    for (let s = 0; s < archSegs; s++) {
      const a0 = Math.PI * (1.0 - s / archSegs);
      const a1 = Math.PI * (1.0 - (s + 1) / archSegs);

      const x0 = cx + archRadius * Math.cos(a0);
      const y0 = ySpring + archRadius * Math.sin(a0);
      const x1 = cx + archRadius * Math.cos(a1);
      const y1 = ySpring + archRadius * Math.sin(a1);

      const dx = Math.abs(x1 - x0);
      const arcLen = archRadius * Math.abs(a0 - a1);

      // Front spandrel wall (+Z)
      this.addQuad(
        [x0, y0, zF],
        [x1, y1, zF],
        [x1, yTop, zF],
        [x0, yTop, zF],
        [0, 0, dx * uvScale, (yTop - 0.5 * (y0 + y1)) * uvScale],
        color,
        [0.86, 0.86, 0.98, 0.98],
        maxEdge
      );

      // Back spandrel wall (-Z)
      this.addQuad(
        [x1, y1, zB],
        [x0, y0, zB],
        [x0, yTop, zB],
        [x1, yTop, zB],
        [0, 0, dx * uvScale, (yTop - 0.5 * (y0 + y1)) * uvScale],
        color,
        [0.86, 0.86, 0.98, 0.98],
        maxEdge
      );

      // Curved barrel-vault underside soffit
      this.addQuad(
        [x0, y0, zF],
        [x0, y0, zB],
        [x1, y1, zB],
        [x1, y1, zF],
        [0, 0, depth * uvScale, arcLen * uvScale],
        color,
        0.68, // rich vault AO!
        maxEdge
      );
    }

    // Top flat deck across the arch span
    this.addQuad(
      [cx - archRadius, yTop, zF],
      [cx + archRadius, yTop, zF],
      [cx + archRadius, yTop, zB],
      [cx - archRadius, yTop, zB],
      [0, 0, archRadius * 2 * uvScale, depth * uvScale],
      color,
      1.0,
      maxEdge
    );
  }

  /**
   * Builds a Haussmann-style steep dark-slate Mansard roof with flat zinc top deck.
   */
  addMansardRoof(cx, yBase, cz, sx, mansardH, sz, opts = {}) {
    const yaw = opts.yaw ?? 0.0;
    const slopeColor = opts.slopeColor ?? [0.34, 0.37, 0.43]; // Parisian dark zinc-slate
    const inset = opts.inset ?? 1.05;
    const overhang = opts.overhang ?? 0.28;
    const maxEdge = opts.maxEdge ?? 1.05;
    const uvScale = opts.uvScale ?? 0.45;

    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const rot = (lx, ly, lz) => [
      cx + lx * cy + lz * sy,
      ly,
      cz - lx * sy + lz * cy,
    ];

    const bx = sx * 0.5 + overhang;
    const bz = sz * 0.5 + overhang;
    const tx = Math.max(0.8, sx * 0.5 - inset);
    const tz = Math.max(0.8, sz * 0.5 - inset);
    const yTop = yBase + mansardH;

    // 4 steep Mansard slopes (+Z, -Z, +X, -X)
    this.addQuad(rot(-bx, yBase, bz), rot(bx, yBase, bz), rot(tx, yTop, tz), rot(-tx, yTop, tz), [0, 0, bx * 2 * uvScale, mansardH * uvScale], slopeColor, [0.85, 0.85, 1, 1], maxEdge);
    this.addQuad(rot(bx, yBase, -bz), rot(-bx, yBase, -bz), rot(-tx, yTop, -tz), rot(tx, yTop, -tz), [0, 0, bx * 2 * uvScale, mansardH * uvScale], slopeColor, [0.85, 0.85, 1, 1], maxEdge);
    this.addQuad(rot(bx, yBase, bz), rot(bx, yBase, -bz), rot(tx, yTop, -tz), rot(tx, yTop, tz), [0, 0, bz * 2 * uvScale, mansardH * uvScale], slopeColor, [0.85, 0.85, 1, 1], maxEdge);
    this.addQuad(rot(-bx, yBase, -bz), rot(-bx, yBase, bz), rot(-tx, yTop, tz), rot(-tx, yTop, -tz), [0, 0, bz * 2 * uvScale, mansardH * uvScale], slopeColor, [0.85, 0.85, 1, 1], maxEdge);

    // Top zinc deck
    this.addQuad(rot(-tx, yTop, tz), rot(tx, yTop, tz), rot(tx, yTop, -tz), rot(-tx, yTop, -tz), [0, 0, tx * uvScale, tz * uvScale], slopeColor, 0.96, maxEdge);
  }

  /**
   * Builds a 3D reinforced-concrete elevated highway / inclined ramp segment from
   * (x0, y0, z0) to (x1, y1, z1) with:
   *   - 2-lane highway asphalt road deck (`this`)
   *   - Concrete box-girder fascia, underside soffit & Jersey side barriers (`concreteBuilder`)
   *   - Brushed steel W-beam top guardrails (`railBuilder`)
   */
  addHighwaySegment(x0, y0, z0, x1, y1, z1, width, concreteBuilder, railBuilder, opts = {}) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const horizLen = Math.hypot(dx, dz) || 1.0;
    const segLen3D = Math.hypot(horizLen, dy);
    const fx = dx / horizLen;
    const fz = dz / horizLen;
    // Right unit vector R = F x Up = (-fz, 0, fx)
    const rx = -fz;
    const rz = fx;

    const hw = width * 0.5;
    const maxEdge = opts.maxEdge ?? 1.05;
    const girderH = opts.girderH ?? 0.95;
    const leftBarrier = opts.leftBarrier !== false;
    const rightBarrier = opts.rightBarrier !== false;

    const pt = (t, lat, dyOff) => [
      x0 + dx * t + rx * lat,
      y0 + dy * t + dyOff,
      z0 + dz * t + rz * lat,
    ];

    // 1. Top Highway Roadway Deck
    this.addQuad(
      pt(0, -hw, 0),
      pt(0,  hw, 0),
      pt(1,  hw, 0),
      pt(1, -hw, 0),
      [0, 0, 1.0, segLen3D / 14.0],
      [1, 1, 1],
      1.0,
      maxEdge
    );

    if (concreteBuilder) {
      const bw = hw + 0.34;
      // Underside box-girder soffit (if elevated above ground)
      if (Math.max(y0, y1) > 0.3) {
        const yBot0 = Math.max(0.0, y0 - girderH);
        const yBot1 = Math.max(0.0, y1 - girderH);
        const ptBot = (t, lat) => [
          x0 + dx * t + rx * lat,
          t < 0.5 ? yBot0 : yBot1,
          z0 + dz * t + rz * lat,
        ];
        // Underside facing down
        concreteBuilder.addQuad(
          ptBot(0,  bw * 0.88),
          ptBot(0, -bw * 0.88),
          ptBot(1, -bw * 0.88),
          ptBot(1,  bw * 0.88),
          [0, 0, 1.5, segLen3D * 0.25],
          [0.86, 0.87, 0.89],
          0.52,
          maxEdge * 1.2
        );
        // Outer concrete fascia beams (Right +hw & Left -hw)
        concreteBuilder.addQuad(
          ptBot(0, bw), ptBot(1, bw), pt(1, bw, 0.02), pt(0, bw, 0.02),
          [0, 0, segLen3D * 0.28, 0.35], [0.94, 0.94, 0.96], [0.68, 0.68, 0.96, 0.96], maxEdge
        );
        concreteBuilder.addQuad(
          ptBot(1, -bw), ptBot(0, -bw), pt(0, -bw, 0.02), pt(1, -bw, 0.02),
          [0, 0, segLen3D * 0.28, 0.35], [0.94, 0.94, 0.96], [0.68, 0.68, 0.96, 0.96], maxEdge
        );
      }

      // Concrete Jersey Side Barriers (0.64m high) + Steel W-Beam Guardrails!
      const barH = 0.64;
      const sides = [];
      if (leftBarrier) sides.push(-1);
      if (rightBarrier) sides.push(1);

      for (const s of sides) {
        const latIn = s * hw;
        const latOut = s * (hw + 0.34);
        if (s > 0) {
          // Right barrier: inner face (-R), top cap (+Y), outer face (+R)
          concreteBuilder.addQuad(pt(1, latIn, 0), pt(0, latIn, 0), pt(0, latIn + 0.08, barH), pt(1, latIn + 0.08, barH), [0, 0, segLen3D * 0.3, 0.25], [0.92, 0.92, 0.94], [0.66, 0.66, 0.98, 0.98], maxEdge);
          concreteBuilder.addQuad(pt(0, latIn + 0.08, barH), pt(0, latOut, barH), pt(1, latOut, barH), pt(1, latIn + 0.08, barH), [0, 0, 0.15, segLen3D * 0.3], [0.96, 0.96, 0.98], 1.0, maxEdge);
          concreteBuilder.addQuad(pt(0, latOut, 0), pt(1, latOut, 0), pt(1, latOut, barH), pt(0, latOut, barH), [0, 0, segLen3D * 0.3, 0.25], [0.90, 0.91, 0.93], 0.92, maxEdge);
        } else {
          // Left barrier: inner face (+R), top cap (+Y), outer face (-R)
          concreteBuilder.addQuad(pt(0, latIn, 0), pt(1, latIn, 0), pt(1, latIn - 0.08, barH), pt(0, latIn - 0.08, barH), [0, 0, segLen3D * 0.3, 0.25], [0.92, 0.92, 0.94], [0.66, 0.66, 0.98, 0.98], maxEdge);
          concreteBuilder.addQuad(pt(0, latOut, barH), pt(0, latIn - 0.08, barH), pt(1, latIn - 0.08, barH), pt(1, latOut, barH), [0, 0, 0.15, segLen3D * 0.3], [0.96, 0.96, 0.98], 1.0, maxEdge);
          concreteBuilder.addQuad(pt(1, latOut, 0), pt(0, latOut, 0), pt(0, latOut, barH), pt(1, latOut, barH), [0, 0, segLen3D * 0.3, 0.25], [0.90, 0.91, 0.93], 0.92, maxEdge);
        }

        // Brushed galvanized steel top safety rail above Jersey barrier
        if (railBuilder) {
          const latMid = s * (hw + 0.20);
          const rY0 = barH + 0.22, rY1 = barH + 0.34;
          if (s > 0) {
            railBuilder.addQuad(pt(1, latMid, rY0), pt(0, latMid, rY0), pt(0, latMid, rY1), pt(1, latMid, rY1), [0.28, 0.55, 0.46, 0.95], [0.78, 0.81, 0.85], 0.96, maxEdge);
          } else {
            railBuilder.addQuad(pt(0, latMid, rY0), pt(1, latMid, rY0), pt(1, latMid, rY1), pt(0, latMid, rY1), [0.28, 0.55, 0.46, 0.95], [0.78, 0.81, 0.85], 0.96, maxEdge);
          }
        }
      }
    }
  }

  /**
   * Uploads mesh buffers into a WebGL2 Vertex Array Object (VAO).
   */
  uploadToGPU(gl) {
    if (this.indices.length === 0) return null;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.verts), gl.STATIC_DRAW);

    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.indices), gl.STATIC_DRAW);

    // 0: aPos (vec3)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 0);
    // 1: aNormal (vec3)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 12);
    // 2: aTangent (vec4)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 24);
    // 3: aUV (vec2)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 40);
    // 4: aColorAO (vec4)
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, VERTEX_STRIDE_BYTES, 48);

    gl.bindVertexArray(null);
    return {
      vao,
      vbo,
      ebo,
      indexCount: this.indices.length,
      vertexCount: this.vertexCount,
    };
  }
}
