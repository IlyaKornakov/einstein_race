#!/usr/bin/env python3
"""
Downscales oversized embedded textures (e.g. 2048x2048 -> 512x512 / 1024x1024) inside .glb assets
while preserving valid glTF 2.0 4-byte chunk alignment. Dramatically reduces GPU VRAM & download size
for mobile browsers (Firefox Android / iOS Safari) and GitHub Pages.
"""

import io
import json
import struct
from pathlib import Path
from PIL import Image

MODELS_DIR = Path(__file__).resolve().parent.parent / "public" / "assets" / "models"

# Target max dimension per GLB model (Lantern & Truck are small street props -> 512px; CarConcept -> 1024px)
TARGETS = {
    "Lantern.glb": 512,
    "CesiumMilkTruck.glb": 512,
    "CarConcept.glb": 1024,
}


def optimize_glb(glb_path: Path, max_dim: int) -> None:
    raw = glb_path.read_bytes()
    magic, version, total_len = struct.unpack_from("<III", raw, 0)
    assert magic == 0x46546C67 and version == 2, f"Invalid GLB header in {glb_path}"

    json_len, json_type = struct.unpack_from("<II", raw, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(raw[20 : 20 + json_len].decode("utf-8"))

    bin_chunk_hdr = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", raw, bin_chunk_hdr)
    assert bin_type == 0x004E4942
    old_bin = raw[bin_chunk_hdr + 8 : bin_chunk_hdr + 8 + bin_len]

    image_bvs = {}
    for img_idx, img in enumerate(gltf.get("images", [])):
        if "bufferView" in img:
            image_bvs[img["bufferView"]] = (img_idx, img)

    new_bin = bytearray()
    changed = 0

    for bv_idx, bv in enumerate(gltf.get("bufferViews", [])):
        old_off = bv.get("byteOffset", 0)
        old_size = bv["byteLength"]
        chunk = old_bin[old_off : old_off + old_size]

        if bv_idx in image_bvs:
            _, img_meta = image_bvs[bv_idx]
            with Image.open(io.BytesIO(chunk)) as im:
                w, h = im.size
                if max(w, h) > max_dim:
                    scale = max_dim / float(max(w, h))
                    nw = max(1, int(round(w * scale)))
                    nh = max(1, int(round(h * scale)))
                    resized = im.resize((nw, nh), Image.LANCZOS)
                    out = io.BytesIO()
                    has_alpha = resized.mode in ("RGBA", "LA") or ("transparency" in resized.info)
                    if has_alpha:
                        # Check if alpha channel is actually non-opaque
                        rgba = resized.convert("RGBA")
                        amin, _ = rgba.getextrema()[3]
                        if amin < 250:
                            rgba.save(out, format="PNG", optimize=True)
                            img_meta["mimeType"] = "image/png"
                        else:
                            rgba.convert("RGB").save(out, format="JPEG", quality=86, optimize=True)
                            img_meta["mimeType"] = "image/jpeg"
                    else:
                        resized.convert("RGB").save(out, format="JPEG", quality=86, optimize=True)
                        img_meta["mimeType"] = "image/jpeg"
                    chunk = out.getvalue()
                    changed += 1

        # Pad start of each bufferView to 4-byte boundary
        while len(new_bin) % 4 != 0:
            new_bin.append(0)
        bv["byteOffset"] = len(new_bin)
        bv["byteLength"] = len(chunk)
        new_bin.extend(chunk)

    if changed == 0:
        print(f"{glb_path.name}: already <= {max_dim}px, untouched.")
        return

    while len(new_bin) % 4 != 0:
        new_bin.append(0)

    gltf["buffers"][0]["byteLength"] = len(new_bin)
    json_bytes = bytearray(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    while len(json_bytes) % 4 != 0:
        json_bytes.append(0x20)  # space padding per glTF 2.0 spec

    out_glb = bytearray()
    total_size = 12 + 8 + len(json_bytes) + 8 + len(new_bin)
    out_glb.extend(struct.pack("<III", 0x46546C67, 2, total_size))
    out_glb.extend(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    out_glb.extend(json_bytes)
    out_glb.extend(struct.pack("<II", len(new_bin), 0x004E4942))
    out_glb.extend(new_bin)

    glb_path.write_bytes(out_glb)
    print(f"{glb_path.name}: resized {changed} textures -> {len(raw)/1e6:.2f} MB -> {len(out_glb)/1e6:.2f} MB")


if __name__ == "__main__":
    for fname, max_d in TARGETS.items():
        p = MODELS_DIR / fname
        if p.exists():
            optimize_glb(p, max_d)
