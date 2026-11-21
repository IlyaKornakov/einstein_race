#!/usr/bin/env python3
"""
Photorealistic PBR Texture Baker
================================
Processes the generated high-resolution photographic architectural textures into
seamless 1024x1024 Albedo + Tangent-Space Normal + Roughness/Metallic/AO/Emissive
textures under public/assets/textures/.
"""

from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ARTIFACT_DIR = Path("/home/ilyakor/.gemini/antigravity/brain/78fab7a6-bcb2-4277-81f2-1740e5a525c5")
OUT_DIR = Path("/home/ilyakor/antigravity/relativity/public/assets/textures")
OUT_DIR.mkdir(parents=True, exist_ok=True)

RAW = {
    "brick": ARTIFACT_DIR / "brick_wall_1795282955696.jpg",
    "asphalt": ARTIFACT_DIR / "asphalt_road_1795282964427.jpg",
    "limestone": ARTIFACT_DIR / "limestone_ashlar_1795282973668.jpg",
    "cobble": ARTIFACT_DIR / "cobblestone_pavers_1795282983331.jpg",
    "roof": ARTIFACT_DIR / "roof_slates_1795282993084.jpg",
    "windows": ARTIFACT_DIR / "facade_windows_atlas_1795283025497.jpg",
}


def make_seamless(arr: np.ndarray, blend_frac: float = 0.10) -> np.ndarray:
    """Smooth toroidal edge cross-fade so tiled textures have zero hard seams."""
    h, w, c = arr.shape
    bw = max(4, int(w * blend_frac))
    bh = max(4, int(h * blend_frac))
    out = arr.astype(np.float32).copy()

    # Horizontal seam smoothing via rolled blend near borders
    rolled_x = np.roll(out, w // 2, axis=1)
    wx = np.ones((1, w, 1), dtype=np.float32)
    ramp_x = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, bw, dtype=np.float32))
    wx[0, :bw, 0] = ramp_x
    wx[0, -bw:, 0] = ramp_x[::-1]
    out = out * wx + rolled_x * (1.0 - wx)

    rolled_y = np.roll(out, h // 2, axis=0)
    wy = np.ones((h, 1, 1), dtype=np.float32)
    ramp_y = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, bh, dtype=np.float32))
    wy[:bh, 0, 0] = ramp_y
    wy[-bh:, 0, 0] = ramp_y[::-1]
    out = out * wy + rolled_y * (1.0 - wy)

    return np.clip(out, 0, 255).astype(np.uint8)


def height_to_normal_rgba(height01: np.ndarray, strength: float = 3.2) -> np.ndarray:
    """Computes wrapped Sobel tangent-space normal map RGBA8 from [0..1] heightfield."""
    h = height01.astype(np.float32)
    tl = np.roll(np.roll(h, 1, axis=0), 1, axis=1)
    tc = np.roll(h, 1, axis=0)
    tr = np.roll(np.roll(h, 1, axis=0), -1, axis=1)
    ml = np.roll(h, 1, axis=1)
    mr = np.roll(h, -1, axis=1)
    bl = np.roll(np.roll(h, -1, axis=0), 1, axis=1)
    bc = np.roll(h, -1, axis=0)
    br = np.roll(np.roll(h, -1, axis=0), -1, axis=1)

    dx = (tr + 2.0 * mr + br - (tl + 2.0 * ml + bl)) * strength
    dy = (bl + 2.0 * bc + br - (tl + 2.0 * tc + tr)) * strength

    nx = -dx
    ny = -dy
    nz = np.ones_like(h)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= norm
    ny /= norm
    nz /= norm

    out = np.zeros((*h.shape, 4), dtype=np.uint8)
    out[..., 0] = np.clip((nx * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    out[..., 1] = np.clip((ny * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    out[..., 2] = np.clip((nz * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(h * 255.0, 0, 255).astype(np.uint8)
    return out


def save_set(name: str, albedo_rgb: np.ndarray, normal_rgba: np.ndarray, pbr_rgba: np.ndarray):
    Image.fromarray(albedo_rgb, "RGB").save(OUT_DIR / f"{name}_albedo.jpg", quality=92, subsampling=0)
    Image.fromarray(normal_rgba[..., :3], "RGB").save(OUT_DIR / f"{name}_normal.jpg", quality=95, subsampling=0)

    # Resize each channel independently as grayscale 'L' to avoid Pillow RGBA alpha-premultiplication!
    ch_rough = np.array(Image.fromarray(pbr_rgba[..., 0], "L").resize((512, 512), Image.Resampling.BILINEAR))
    ch_metal = np.array(Image.fromarray(pbr_rgba[..., 1], "L").resize((512, 512), Image.Resampling.BILINEAR))
    ch_ao    = np.array(Image.fromarray(pbr_rgba[..., 2], "L").resize((512, 512), Image.Resampling.BILINEAR))
    ch_emis  = np.array(Image.fromarray(pbr_rgba[..., 3], "L").resize((512, 512), Image.Resampling.BILINEAR))

    # Standard Three.js / glTF ORM channel packing: R = AO, G = Roughness, B = Metalness
    orm_rgb = np.stack([ch_ao, ch_rough, ch_metal], axis=-1)
    Image.fromarray(orm_rgb, "RGB").save(OUT_DIR / f"{name}_orm.png", optimize=True)

    pbr_fixed = np.stack([ch_rough, ch_metal, ch_ao, ch_emis], axis=-1)
    Image.fromarray(pbr_fixed, "RGBA").save(OUT_DIR / f"{name}_pbr.png", optimize=True)

    if ch_emis.max() > 0:
        emis_full = pbr_rgba[..., 3].astype(np.float32)[..., None] / 255.0
        warm_rgb = np.clip(albedo_rgb.astype(np.float32) * emis_full * 1.15, 0, 255).astype(np.uint8)
        Image.fromarray(warm_rgb, "RGB").save(OUT_DIR / f"{name}_emissive.jpg", quality=92)

    print(
        f"Baked {name} ({albedo_rgb.shape[1]}x{albedo_rgb.shape[0]}): "
        f"mean_rough={ch_rough.mean()/255:.2f}, mean_ao={ch_ao.mean()/255:.2f}"
    )


def load_resized(path: Path, size: int = 1024) -> np.ndarray:
    img = Image.open(path).convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    return np.array(img)


def process_masonry(key: str, out_name: str, strength: float, base_rough: float, mortar_dark: bool):
    rgb = load_resized(RAW[key], 1024)
    # Note: brick/cobble/limestone/roof courses are already near-periodic horizontally;
    # apply gentle 3% border feather so courses stay crisp!
    rgb = make_seamless(rgb, 0.03)
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) / 255.0
    if not mortar_dark:
        # Light gray mortar on brick/limestone is recessed where saturation is low or seam is thin
        r_f, g_f, b_f = rgb[..., 0] / 255.0, rgb[..., 1] / 255.0, rgb[..., 2] / 255.0
        sat = np.maximum(np.maximum(r_f, g_f), b_f) - np.minimum(np.minimum(r_f, g_f), b_f)
        height = np.clip(0.35 + 0.45 * lum + 0.45 * sat, 0.0, 1.0)
    else:
        height = np.clip(lum * 1.15, 0.0, 1.0)

    normal = height_to_normal_rgba(height, strength=strength)
    pbr = np.zeros((*lum.shape, 4), dtype=np.uint8)
    rough = np.clip(base_rough + (0.5 - height) * 0.10, 0.72, 0.98)
    ao = np.clip(0.45 + 0.55 * height, 0.35, 1.0)
    pbr[..., 0] = (rough * 255).astype(np.uint8)
    pbr[..., 1] = 0
    pbr[..., 2] = (ao * 255).astype(np.uint8)
    pbr[..., 3] = 0
    save_set(out_name, rgb, normal, pbr)


def process_roads():
    base = make_seamless(load_resized(RAW["asphalt"], 1024), 0.12).astype(np.float32)
    # Darken slightly to rich realistic wet/dry street tarmac
    base = np.clip(base * 0.72, 0, 255)
    H, W, _ = base.shape
    u = np.linspace(0.0, 1.0, W, endpoint=False)[None, :]
    v = np.linspace(0.0, 1.0, H, endpoint=False)[:, None]

    lum = (0.299 * base[..., 0] + 0.587 * base[..., 1] + 0.114 * base[..., 2]) / 255.0

    # 1. Boulevard / Highway Road with realistic worn thermoplastic road markings & tire tracks
    road = base.copy()
    wear = (
        np.exp(-((u - 0.20) / 0.055) ** 2)
        + np.exp(-((u - 0.35) / 0.055) ** 2)
        + np.exp(-((u - 0.65) / 0.055) ** 2)
        + np.exp(-((u - 0.80) / 0.055) ** 2)
    )
    road *= (1.0 - 0.12 * wear[..., None])

    # Gutter AO darkening at curb edges u < 0.035 or u > 0.965
    curb_ao = np.clip(np.minimum(u, 1.0 - u) / 0.04, 0.45, 1.0)
    road *= curb_ao[..., None]

    # Thermoplastic paint wear modulated by real aggregate grain!
    grain_wear = np.clip(0.68 + 0.55 * lum, 0.55, 1.0)
    d_center = np.abs(u - 0.5)
    yellow_mask = ((d_center > 0.0055) & (d_center < 0.016)).astype(np.float32)
    d_lane = np.minimum(np.abs(u - 0.275), np.abs(u - 0.725))
    dash_phase = (v * 4.0) % 1.0
    white_dash = ((d_lane < 0.008) & (dash_phase < 0.40)).astype(np.float32)
    edge_line = (np.minimum(np.abs(u - 0.045), np.abs(u - 0.955)) < 0.0085).astype(np.float32)
    white_mask = np.maximum(white_dash, edge_line)

    yellow_col = np.array([224.0, 168.0, 32.0])[None, None, :] * grain_wear[..., None]
    white_col = np.array([222.0, 225.0, 230.0])[None, None, :] * grain_wear[..., None]

    road = road * (1.0 - yellow_mask[..., None]) + yellow_col * yellow_mask[..., None]
    road = road * (1.0 - white_mask[..., None]) + white_col * white_mask[..., None]

    paint_any = np.maximum(yellow_mask, white_mask)
    h_road = np.clip(lum * 1.4 + paint_any * 0.16, 0.0, 1.0)
    n_road = height_to_normal_rgba(h_road, strength=2.8)

    pbr_road = np.zeros((H, W, 4), dtype=np.uint8)
    rough_road = np.clip(0.88 - 0.14 * wear - 0.18 * paint_any + (lum - 0.3) * 0.12, 0.58, 0.96)
    pbr_road[..., 0] = (rough_road * 255).astype(np.uint8)
    pbr_road[..., 2] = (np.clip(curb_ao * (0.82 + 0.18 * lum / 0.5), 0.4, 1.0) * 255).astype(np.uint8)
    save_set("road_asphalt", np.clip(road, 0, 255).astype(np.uint8), n_road, pbr_road)

    # 2. Crosswalk Asphalt
    cw = base.copy()
    stripe_u = (u * 10.0) % 1.0
    in_zebra = ((v > 0.14) & (v < 0.86) & (stripe_u > 0.22) & (stripe_u < 0.74)).astype(np.float32)
    stop_bar = (((v > 0.03) & (v < 0.075)) | ((v > 0.925) & (v < 0.97))).astype(np.float32)
    cw_paint = np.maximum(in_zebra, stop_bar) * grain_wear
    cw = cw * (1.0 - cw_paint[..., None]) + np.array([226.0, 228.0, 232.0])[None, None, :] * cw_paint[..., None]
    h_cw = np.clip(lum * 1.4 + cw_paint * 0.15, 0.0, 1.0)
    pbr_cw = pbr_road.copy()
    pbr_cw[..., 0] = (np.clip(0.86 - 0.18 * cw_paint, 0.58, 0.95) * 255).astype(np.uint8)
    save_set("road_crosswalk", np.clip(cw, 0, 255).astype(np.uint8), height_to_normal_rgba(h_cw, 2.8), pbr_cw)

    # 3. Architectural Cast Concrete (for multi-level highway girders, piers & barriers!)
    lim = make_seamless(load_resized(RAW["limestone"], 1024), 0.06).astype(np.float32)
    # Desaturate & blend fine asphalt mineral grain to get realistic board-formed highway concrete!
    lim_gray = (0.299 * lim[..., 0] + 0.587 * lim[..., 1] + 0.114 * lim[..., 2])[..., None]
    conc = np.clip(lim_gray * 0.68 + base * 0.42 + np.array([18.0, 20.0, 23.0]), 0, 255).astype(np.uint8)
    h_conc = np.clip((0.5 * (lim_gray[..., 0] / 255.0) + 0.5 * lum), 0.0, 1.0)
    pbr_conc = np.zeros((H, W, 4), dtype=np.uint8)
    pbr_conc[..., 0] = 228  # rough = 0.89 matte concrete
    pbr_conc[..., 2] = (np.clip(0.60 + 0.40 * h_conc, 0.45, 1.0) * 255).astype(np.uint8)
    save_set("highway_concrete", conc, height_to_normal_rgba(h_conc, 3.0), pbr_conc)

    # 4. Elevated Highway 2-Lane Express Deck Asphalt (yellow left edge, dashed white center, white right edge)
    hwy = base.copy()
    hwy_wear = np.exp(-((u - 0.28) / 0.08) ** 2) + np.exp(-((u - 0.72) / 0.08) ** 2)
    hwy *= (1.0 - 0.14 * hwy_wear[..., None]) * curb_ao[..., None]
    y_edge = ((u > 0.05) & (u < 0.072)).astype(np.float32) * grain_wear
    w_edge = ((u > 0.928) & (u < 0.95)).astype(np.float32) * grain_wear
    w_mid = ((np.abs(u - 0.5) < 0.009) & (((v * 4.0) % 1.0) < 0.42)).astype(np.float32) * grain_wear
    w_tot = np.maximum(w_edge, w_mid)
    hwy = hwy * (1.0 - y_edge[..., None]) + np.array([232.0, 176.0, 32.0])[None, None, :] * y_edge[..., None]
    hwy = hwy * (1.0 - w_tot[..., None]) + np.array([228.0, 231.0, 236.0])[None, None, :] * w_tot[..., None]
    h_hwy = np.clip(lum * 1.4 + np.maximum(y_edge, w_tot) * 0.15, 0.0, 1.0)
    pbr_hwy = pbr_road.copy()
    pbr_hwy[..., 0] = (np.clip(0.87 - 0.15 * hwy_wear - 0.18 * np.maximum(y_edge, w_tot), 0.58, 0.96) * 255).astype(np.uint8)
    save_set("highway_road", np.clip(hwy, 0, 255).astype(np.uint8), height_to_normal_rgba(h_hwy, 2.8), pbr_hwy)


def process_windows_atlas():
    raw = Image.open(RAW["windows"]).convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    arr = np.array(raw)
    # Tight-crop each 512x512 quadrant to remove the plaster border around each frame!
    # Inspecting the generated 2x2 sheet:
    #   Q(0,0) sash dark: frame spans ~[28:476, 30:472]
    #   Q(1,0) sash lit : frame spans ~[542:994, 30:472]
    #   Q(0,1) shopfront: frame spans ~[24:486, 530:998]
    #   Q(1,1) oak door : frame spans ~[592:940, 520:1002]
    quads = [
        ((32, 32, 474, 472), (0, 0)),
        ((544, 32, 992, 472), (512, 0)),
        ((26, 530, 486, 998), (0, 512)),
        ((594, 520, 938, 1002), (512, 512)),
    ]
    atlas = np.zeros((1024, 1024, 3), dtype=np.uint8)
    for (x0, y0, x1, y1), (dx, dy) in quads:
        crop = Image.fromarray(arr[y0:y1, x0:x1]).resize((512, 512), Image.Resampling.LANCZOS)
        atlas[dy:dy + 512, dx:dx + 512] = np.array(crop)

    rf = atlas[..., 0].astype(np.float32) / 255.0
    gf = atlas[..., 1].astype(np.float32) / 255.0
    bf = atlas[..., 2].astype(np.float32) / 255.0
    lum = 0.299 * rf + 0.587 * gf + 0.114 * bf

    # Detect glass panes vs wood/stone frames per quadrant:
    rough = np.full((1024, 1024), 0.78, dtype=np.float32)
    metal = np.zeros((1024, 1024), dtype=np.float32)
    emissive = np.zeros((1024, 1024), dtype=np.float32)
    height = np.clip(0.35 + 0.65 * lum, 0.0, 1.0)

    # Top-Left (0:512, 0:512): White wood frame (lum > 0.78) vs dark glass & curtains (lum <= 0.74)
    tl_glass = lum[:512, :512] < 0.74
    rough[:512, :512][tl_glass] = 0.07
    height[:512, :512][tl_glass] = 0.20

    # Top-Right (512:1024, 0:512): White frame (rf>0.82 & gf>0.82 & bf>0.80) vs warm golden room!
    tr_frame = (rf[:512, 512:] > 0.80) & (bf[:512, 512:] > 0.76)
    tr_glass = ~tr_frame
    rough[:512, 512:][tr_glass] = 0.08
    emissive[:512, 512:][tr_glass] = np.clip((rf[:512, 512:][tr_glass] - bf[:512, 512:][tr_glass]) * 1.65 + 0.22, 0.0, 0.92)
    height[:512, 512:][tr_glass] = 0.20

    # Bottom-Left (0:512, 512:1024): Dark charcoal shopfront wood frame (lum < 0.30) vs warm glowing shop!
    bl_glass = (rf[512:, :512] > 0.42) & ((rf[512:, :512] - bf[512:, :512]) > 0.12)
    rough[512:, :512][bl_glass] = 0.08
    emissive[512:, :512][bl_glass] = np.clip(lum[512:, :512][bl_glass] * 0.88, 0.15, 0.88)
    height[512:, :512][bl_glass] = 0.22

    # Bottom-Right (512:1024, 512:1024): Carved oak door + top glass transom (y in 530..605) + brass handle
    br_transom = np.zeros((512, 512), dtype=bool)
    br_transom[28:92, 42:470] = lum[512 + 28:512 + 92, 512 + 42:512 + 470] < 0.38
    rough[512:, 512:][br_transom] = 0.09

    normal = height_to_normal_rgba(height, strength=3.2)
    pbr = np.zeros((1024, 1024, 4), dtype=np.uint8)
    pbr[..., 0] = (rough * 255).astype(np.uint8)
    pbr[..., 1] = (metal * 255).astype(np.uint8)
    pbr[..., 2] = (np.clip(0.58 + 0.42 * height, 0.45, 1.0) * 255).astype(np.uint8)
    pbr[..., 3] = (emissive * 255).astype(np.uint8)
    save_set("window_atlas", atlas, normal, pbr)


if __name__ == "__main__":
    process_masonry("brick", "brick_facade", strength=4.2, base_rough=0.89, mortar_dark=False)
    process_masonry("limestone", "stone_ashlar", strength=3.4, base_rough=0.85, mortar_dark=True)
    process_masonry("cobble", "sidewalk_cobble", strength=4.0, base_rough=0.86, mortar_dark=True)
    process_masonry("roof", "roof_tiles", strength=4.0, base_rough=0.84, mortar_dark=True)
    process_roads()
    process_windows_atlas()
