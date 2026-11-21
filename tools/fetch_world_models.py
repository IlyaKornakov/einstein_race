#!/usr/bin/env python3
"""
Downloads and packs real CC0 / MIT 3D glTF/GLB assets from Poly Haven, Three.js,
and BabylonJS into self-contained `.glb` files under `public/assets/models/`:
  - `broadleaf_tree.glb` (SpeedTree Broadleaf Desktop 3D trunk/branches + alpha leaf atlas)
  - `potted_plant.glb`, `horse_statue.glb`, `gothic_statue.glb`, `marble_bust.glb`
  - `street_lamp_modern.glb`, `old_tyre.glb`, `coffee_cart.glb`, `wall_clock.glb`
  - `traffic_cone.glb`, `Flamingo.glb`, `Stork.glb`, `Horse.glb`, `aerobatic_plane.glb`, `HVGirl.glb`
"""

from __future__ import annotations

import io
import json
import os
import struct
import urllib.request
from pathlib import Path
import numpy as np
from PIL import Image

OUT_DIR = Path("/home/ilyakor/antigravity/relativity/public/assets/models")
OUT_DIR.mkdir(parents=True, exist_ok=True)

UA = {"User-Agent": "Mozilla/5.0"}


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def pack_glb(gltf_json: dict, bin_blob: bytes, out_path: Path) -> None:
    """Writes a standard GLB v2 binary container."""
    json_bytes = json.dumps(gltf_json, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "
    while len(bin_blob) % 4 != 0:
        bin_blob += b"\x00"

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_blob)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        f.write(json_bytes)
        f.write(struct.pack("<I4s", len(bin_blob), b"BIN\x00"))
        f.write(bin_blob)


def download_and_pack_polyhaven(asset_id: str, out_name: str, max_tex_px: int = 512) -> None:
    out_path = OUT_DIR / out_name
    if out_path.exists() and out_path.stat().st_size > 10_000:
        print(f"[skip] {out_name} already exists ({out_path.stat().st_size // 1024} KB)")
        return

    meta = json.loads(fetch_bytes(f"https://api.polyhaven.com/files/{asset_id}").decode("utf-8"))
    info = meta["gltf"]["1k"]["gltf"]
    gltf_doc = json.loads(fetch_bytes(info["url"]).decode("utf-8"))
    includes = info.get("include", {})

    # Load primary binary buffer
    buf0_uri = gltf_doc["buffers"][0]["uri"]
    bin_data = bytearray(fetch_bytes(includes[buf0_uri]["url"]))
    del gltf_doc["buffers"][0]["uri"]

    buffer_views = gltf_doc.setdefault("bufferViews", [])

    # Embed all external images into bufferViews (resized to max_tex_px for fast GPU upload & 60 FPS)
    for img_def in gltf_doc.get("images", []):
        uri = img_def.get("uri")
        if not uri or uri not in includes:
            continue
        raw_img = fetch_bytes(includes[uri]["url"])
        pil = Image.open(io.BytesIO(raw_img))
        if max(pil.size) > max_tex_px:
            pil.thumbnail((max_tex_px, max_tex_px), Image.Resampling.LANCZOS)

        buf_io = io.BytesIO()
        has_alpha = pil.mode in ("RGBA", "LA")
        if has_alpha:
            pil.save(buf_io, format="PNG", optimize=True)
            mime = "image/png"
        else:
            pil.convert("RGB").save(buf_io, format="JPEG", quality=86)
            mime = "image/jpeg"

        encoded = buf_io.getvalue()
        while len(bin_data) % 4 != 0:
            bin_data.append(0)
        offset = len(bin_data)
        bin_data.extend(encoded)

        bv_idx = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(encoded),
        })
        del img_def["uri"]
        img_def["bufferView"] = bv_idx
        img_def["mimeType"] = mime

    gltf_doc["buffers"][0]["byteLength"] = len(bin_data)
    pack_glb(gltf_doc, bytes(bin_data), out_path)
    print(f"[packed PH] {out_name}: {out_path.stat().st_size // 1024} KB")


def build_speedtree_broadleaf_glb() -> None:
    out_path = OUT_DIR / "broadleaf_tree.glb"
    base_url = "https://raw.githubusercontent.com/BabylonJS/Assets/master/meshes/Trees"
    bdata = json.loads(fetch_bytes(f"{base_url}/rawtrees.babylon").decode("utf-8"))

    bark_jpg_raw = fetch_bytes(f"{base_url}/BroadleafBark.jpg")
    bark_nrm_raw = fetch_bytes(f"{base_url}/BroadleafBark_Normal.png")
    leaf_png_raw = fetch_bytes(f"{base_url}/Broadleaf_Desktop_Atlas.png")
    leaf_nrm_raw = fetch_bytes(f"{base_url}/Broadleaf_Desktop_Atlas_Normal.png")

    leaf_pil = Image.open(io.BytesIO(leaf_png_raw)).convert("RGBA")
    leaf_alpha = np.array(leaf_pil)[..., 3]
    H_a, W_a = leaf_alpha.shape

    mesh = [m for m in bdata["meshes"] if m.get("name") == "Tree1_LOD1"][0]
    raw_pos = np.array(mesh["positions"], dtype=np.float32).reshape(-1, 3)
    raw_nrm = np.array(mesh["normals"], dtype=np.float32).reshape(-1, 3)
    raw_uv = np.array(mesh["uvs"], dtype=np.float32).reshape(-1, 2)
    raw_idx = np.array(mesh["indices"], dtype=np.uint32)

    # Convert BabylonJS LHS (X, Y, Z) -> Three.js RHS (X, Y, -Z), ground at y=0, scale to ~7.6m tall!
    min_y = float(raw_pos[:, 1].min())
    max_y = float(raw_pos[:, 1].max())
    scale = 7.6 / (max_y - min_y)

    pos = np.empty_like(raw_pos)
    pos[:, 0] = raw_pos[:, 0] * scale
    pos[:, 1] = (raw_pos[:, 1] - min_y) * scale
    pos[:, 2] = -raw_pos[:, 2] * scale

    nrm = np.empty_like(raw_nrm)
    nrm[:, 0] = raw_nrm[:, 0]
    nrm[:, 1] = raw_nrm[:, 1]
    nrm[:, 2] = -raw_nrm[:, 2]
    nrm_len = np.maximum(1e-6, np.linalg.norm(nrm, axis=1, keepdims=True))
    nrm /= nrm_len

    # Auto-verify UV V-flip against actual leaf alpha channel!
    # SubMesh 4 (Leaves_3): indexStart 8760, count 4500
    leaf_tris = raw_idx[8760:8760 + 4500].reshape(-1, 3)
    tri_uv_mid = raw_uv[leaf_tris].mean(axis=1)
    u_px = np.clip((tri_uv_mid[:, 0] % 1.0 * W_a).astype(int), 0, W_a - 1)
    v_direct = np.clip((tri_uv_mid[:, 1] % 1.0 * H_a).astype(int), 0, H_a - 1)
    v_flipped = np.clip(((1.0 - (tri_uv_mid[:, 1] % 1.0)) * H_a).astype(int), 0, H_a - 1)
    hit_direct = float(leaf_alpha[v_direct, u_px].mean())
    hit_flipped = float(leaf_alpha[v_flipped, u_px].mean())
    print(f"SpeedTree UV check -> alpha mean direct={hit_direct:.1f}, v_flipped={hit_flipped:.1f}")

    uv = raw_uv.copy()
    if hit_flipped > hit_direct:
        uv[:, 1] = 1.0 - uv[:, 1]

    # Group submeshes into 2 clean primitives:
    #   Primitive 0 (Bark): subMeshes 1 & 3
    #   Primitive 1 (Leaves/Fronds): subMeshes 0, 2, 4
    subs = mesh["subMeshes"]
    bark_indices = []
    leaf_indices = []
    for sm_i, sm in enumerate(subs):
        seg = raw_idx[sm["indexStart"]: sm["indexStart"] + sm["indexCount"]].reshape(-1, 3)
        # Flip winding (0, 2, 1) because Z was negated (LHS -> RHS)!
        seg_rhs = seg[:, [0, 2, 1]].reshape(-1)
        if sm_i in (1, 3):
            bark_indices.append(seg_rhs)
        else:
            leaf_indices.append(seg_rhs)

    bark_idx_arr = np.concatenate(bark_indices).astype(np.uint16)
    leaf_idx_arr = np.concatenate(leaf_indices).astype(np.uint16)

    def encode_tex(raw_b: bytes, size: int, is_rgba: bool) -> tuple[bytes, str]:
        im = Image.open(io.BytesIO(raw_b))
        im = im.resize((size, size), Image.Resampling.LANCZOS)
        bio = io.BytesIO()
        if is_rgba:
            im.convert("RGBA").save(bio, format="PNG", optimize=True)
            return bio.getvalue(), "image/png"
        im.convert("RGB").save(bio, format="JPEG", quality=88)
        return bio.getvalue(), "image/jpeg"

    bark_col_b, bark_col_m = encode_tex(bark_jpg_raw, 512, False)
    bark_nrm_b, bark_nrm_m = encode_tex(bark_nrm_raw, 512, False)
    leaf_col_b, leaf_col_m = encode_tex(leaf_png_raw, 1024, True)
    leaf_nrm_b, leaf_nrm_m = encode_tex(leaf_nrm_raw, 512, False)

    bin_blob = bytearray()
    bvs = []

    def add_bv(data_bytes: bytes, target: int | None = None) -> int:
        while len(bin_blob) % 4 != 0:
            bin_blob.append(0)
        off = len(bin_blob)
        bin_blob.extend(data_bytes)
        entry = {"buffer": 0, "byteOffset": off, "byteLength": len(data_bytes)}
        if target is not None:
            entry["target"] = target
        bvs.append(entry)
        return len(bvs) - 1

    bv_pos = add_bv(pos.tobytes(), 34962)
    bv_nrm = add_bv(nrm.tobytes(), 34962)
    bv_uv = add_bv(uv.tobytes(), 34962)
    bv_idx_bark = add_bv(bark_idx_arr.tobytes(), 34963)
    bv_idx_leaf = add_bv(leaf_idx_arr.tobytes(), 34963)

    bv_img_bark_c = add_bv(bark_col_b)
    bv_img_bark_n = add_bv(bark_nrm_b)
    bv_img_leaf_c = add_bv(leaf_col_b)
    bv_img_leaf_n = add_bv(leaf_nrm_b)

    gltf = {
        "asset": {"version": "2.0", "generator": "RelativisticCity-SpeedTreePacker"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "SpeedTreeBroadleaf", "mesh": 0}],
        "buffers": [{"byteLength": len(bin_blob)}],
        "bufferViews": bvs,
        "accessors": [
            {
                "bufferView": bv_pos,
                "componentType": 5126,
                "count": len(pos),
                "type": "VEC3",
                "min": pos.min(axis=0).tolist(),
                "max": pos.max(axis=0).tolist(),
            },
            {
                "bufferView": bv_nrm,
                "componentType": 5126,
                "count": len(nrm),
                "type": "VEC3",
            },
            {
                "bufferView": bv_uv,
                "componentType": 5126,
                "count": len(uv),
                "type": "VEC2",
            },
            {
                "bufferView": bv_idx_bark,
                "componentType": 5123,
                "count": len(bark_idx_arr),
                "type": "SCALAR",
            },
            {
                "bufferView": bv_idx_leaf,
                "componentType": 5123,
                "count": len(leaf_idx_arr),
                "type": "SCALAR",
            },
        ],
        "images": [
            {"bufferView": bv_img_bark_c, "mimeType": bark_col_m},
            {"bufferView": bv_img_bark_n, "mimeType": bark_nrm_m},
            {"bufferView": bv_img_leaf_c, "mimeType": leaf_col_m},
            {"bufferView": bv_img_leaf_n, "mimeType": leaf_nrm_m},
        ],
        "textures": [
            {"source": 0},
            {"source": 1},
            {"source": 2},
            {"source": 3},
        ],
        "materials": [
            {
                "name": "SpeedTree_Bark",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.90,
                },
                "normalTexture": {"index": 1},
            },
            {
                "name": "SpeedTree_Leaves",
                "alphaMode": "MASK",
                "alphaCutoff": 0.42,
                "doubleSided": True,
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 2},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.72,
                },
                "normalTexture": {"index": 3},
            },
        ],
        "meshes": [
            {
                "name": "BroadleafTreeMesh",
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                        "indices": 3,
                        "material": 0,
                    },
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                        "indices": 4,
                        "material": 1,
                    },
                ],
            }
        ],
    }

    pack_glb(gltf, bytes(bin_blob), out_path)
    print(f"[built SpeedTree] broadleaf_tree.glb: {out_path.stat().st_size // 1024} KB")


def download_and_pack_traffic_cone() -> None:
    out_path = OUT_DIR / "traffic_cone.glb"
    if out_path.exists() and out_path.stat().st_size > 10_000:
        return
    base = "https://raw.githubusercontent.com/BabylonJS/Assets/master/meshes/TrafficCone"
    gltf_doc = json.loads(fetch_bytes(f"{base}/TrafficCone.gltf").decode("utf-8"))
    bin_data = bytearray(fetch_bytes(f"{base}/{gltf_doc['buffers'][0]['uri']}"))
    del gltf_doc["buffers"][0]["uri"]
    bvs = gltf_doc.setdefault("bufferViews", [])
    for img_def in gltf_doc.get("images", []):
        uri = img_def.get("uri")
        if not uri:
            continue
        raw_img = fetch_bytes(f"{base}/{uri}")
        pil = Image.open(io.BytesIO(raw_img))
        pil.thumbnail((512, 512), Image.Resampling.LANCZOS)
        bio = io.BytesIO()
        pil.convert("RGB").save(bio, format="JPEG", quality=86)
        enc = bio.getvalue()
        while len(bin_data) % 4 != 0:
            bin_data.append(0)
        off = len(bin_data)
        bin_data.extend(enc)
        bvs.append({"buffer": 0, "byteOffset": off, "byteLength": len(enc)})
        del img_def["uri"]
        img_def["bufferView"] = len(bvs) - 1
        img_def["mimeType"] = "image/jpeg"
    gltf_doc["buffers"][0]["byteLength"] = len(bin_data)
    pack_glb(gltf_doc, bytes(bin_data), out_path)
    print(f"[packed Babylon] traffic_cone.glb: {out_path.stat().st_size // 1024} KB")


def download_direct_glb(url: str, out_name: str) -> None:
    out_path = OUT_DIR / out_name
    if out_path.exists() and out_path.stat().st_size > 5_000:
        print(f"[skip] {out_name} already exists")
        return
    data = fetch_bytes(url)
    out_path.write_bytes(data)
    print(f"[downloaded] {out_name}: {len(data) // 1024} KB")


if __name__ == "__main__":
    build_speedtree_broadleaf_glb()
    download_and_pack_traffic_cone()

    ph_assets = [
        ("horse_statue_01", "horse_statue.glb", 512),
        ("gothic_statue", "gothic_statue.glb", 512),
        ("marble_bust_01", "marble_bust.glb", 512),
        ("street_lamp_02", "street_lamp_modern.glb", 512),
        ("old_tyre", "old_tyre.glb", 512),
        ("CoffeeCart_01", "coffee_cart.glb", 512),
        ("potted_plant_02", "potted_plant.glb", 512),
        ("wall_clock", "wall_clock.glb", 512),
        ("quiver_tree_01", "quiver_tree.glb", 512),
    ]
    for aid, oname, sz in ph_assets:
        download_and_pack_polyhaven(aid, oname, sz)

    direct_glbs = [
        ("https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/models/gltf/Flamingo.glb", "Flamingo.glb"),
        ("https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/models/gltf/Stork.glb", "Stork.glb"),
        ("https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/models/gltf/Horse.glb", "Horse.glb"),
        ("https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/models/gltf/LittlestTokyo.glb", "LittlestTokyo.glb"),
        ("https://raw.githubusercontent.com/BabylonJS/Assets/master/meshes/aerobatic_plane.glb", "aerobatic_plane.glb"),
        ("https://raw.githubusercontent.com/BabylonJS/Assets/master/meshes/HVGirl.glb", "HVGirl.glb"),
    ]
    for url, oname in direct_glbs:
        download_direct_glb(url, oname)
