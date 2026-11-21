#!/usr/bin/env python3
"""
Simplifies over-tessellated photogrammetry / CAD static .glb props using fast spatial
vertex clustering while preserving UVs, normals, materials, and exact bounding boxes.
"""

import json
import struct
import numpy as np
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "public" / "assets" / "models"

COMP_DTYPE = {
    5120: np.int8,
    5121: np.uint8,
    5122: np.int16,
    5123: np.uint16,
    5125: np.uint32,
    5126: np.float32,
}
TYPE_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_accessor(gltf: dict, blob: bytes, acc_idx: int) -> np.ndarray:
    acc = gltf["accessors"][acc_idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    dtype = COMP_DTYPE[acc["componentType"]]
    nc = TYPE_NC[acc["type"]]
    cnt = acc["count"]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    elem_bytes = np.dtype(dtype).itemsize * nc
    stride = bv.get("byteStride", elem_bytes)
    if stride == elem_bytes:
        arr = np.frombuffer(blob, dtype=dtype, count=cnt * nc, offset=off).reshape(cnt, nc).copy()
    else:
        arr = np.empty((cnt, nc), dtype=dtype)
        for i in range(cnt):
            arr[i] = np.frombuffer(blob, dtype=dtype, count=nc, offset=off + i * stride)
    return arr


def cluster_decimate(pos: np.ndarray, nrm: np.ndarray | None, uv: np.ndarray | None, tris: np.ndarray, grid_res: int):
    mn = pos.min(axis=0)
    mx = pos.max(axis=0)
    span = np.maximum(mx - mn, 1e-6)
    max_span = float(span.max())
    cell_size = max_span / float(grid_res)

    # Quantize 3D position + rough UV bucket (4x4) so UV seams don't smear wildly
    q_pos = np.floor((pos - mn) / cell_size).astype(np.int64)
    if uv is not None:
        q_uv = np.floor(np.mod(uv, 1.0) * 6.0).astype(np.int64)
        keys = (
            q_pos[:, 0] * 1_000_000_000
            + q_pos[:, 1] * 1_000_000
            + q_pos[:, 2] * 1_000
            + q_uv[:, 0] * 16
            + q_uv[:, 1]
        )
    else:
        keys = q_pos[:, 0] * 1_000_000 + q_pos[:, 1] * 1_000 + q_pos[:, 2]

    _, inv = np.unique(keys, return_inverse=True)
    n_clusters = int(inv.max()) + 1

    # Average vertex attributes per cluster
    counts = np.bincount(inv, minlength=n_clusters).astype(np.float32)[:, None]
    new_pos = np.zeros((n_clusters, 3), dtype=np.float32)
    np.add.at(new_pos, inv, pos)
    new_pos /= counts

    new_nrm = None
    if nrm is not None:
        new_nrm = np.zeros((n_clusters, 3), dtype=np.float32)
        np.add.at(new_nrm, inv, nrm)
        lens = np.linalg.norm(new_nrm, axis=1, keepdims=True)
        new_nrm /= np.maximum(lens, 1e-6)

    new_uv = None
    if uv is not None:
        new_uv = np.zeros((n_clusters, 2), dtype=np.float32)
        np.add.at(new_uv, inv, uv)
        new_uv /= counts

    # Remap triangles & drop degenerate collapsed faces
    mapped_tris = inv[tris]
    non_deg = (
        (mapped_tris[:, 0] != mapped_tris[:, 1])
        & (mapped_tris[:, 1] != mapped_tris[:, 2])
        & (mapped_tris[:, 2] != mapped_tris[:, 0])
    )
    mapped_tris = mapped_tris[non_deg]

    # Deduplicate identical triangles
    if len(mapped_tris) > 0:
        sorted_t = np.sort(mapped_tris, axis=1)
        _, uniq_idx = np.unique(sorted_t, axis=0, return_index=True)
        mapped_tris = mapped_tris[np.sort(uniq_idx)]

    # Compact unused vertices
    used_v, compact_map = np.unique(mapped_tris, return_inverse=True)
    mapped_tris = compact_map.reshape(-1, 3).astype(np.uint32)
    new_pos = new_pos[used_v]
    if new_nrm is not None:
        new_nrm = new_nrm[used_v]
    if new_uv is not None:
        new_uv = new_uv[used_v]

    return new_pos, new_nrm, new_uv, mapped_tris


def simplify_glb(fname: str, grid_res: int, drop_mesh_names: set[str] | None = None) -> None:
    p = MODELS_DIR / fname
    if not p.exists():
        return
    raw = p.read_bytes()
    jlen = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20 : 20 + jlen].decode("utf-8"))
    blob = raw[20 + jlen + 8 :]

    if "KHR_draco_mesh_compression" in gltf.get("extensionsUsed", []):
        print(f"Skipping Draco GLB {fname}")
        return

    old_tris = 0
    new_tris_total = 0

    # Preserve all image bufferViews first
    img_bv_indices = {im["bufferView"] for im in gltf.get("images", []) if "bufferView" in im}
    new_bvs = []
    new_accs = []
    new_bin = bytearray()
    bv_remap = {}

    def append_bv(data_bytes: bytes, target: int | None = None) -> int:
        while len(new_bin) % 4 != 0:
            new_bin.append(0)
        bv = {"buffer": 0, "byteOffset": len(new_bin), "byteLength": len(data_bytes)}
        if target is not None:
            bv["target"] = target
        idx = len(new_bvs)
        new_bvs.append(bv)
        new_bin.extend(data_bytes)
        return idx

    for old_bv_i in sorted(img_bv_indices):
        bv = gltf["bufferViews"][old_bv_i]
        off = bv.get("byteOffset", 0)
        chunk = blob[off : off + bv["byteLength"]]
        bv_remap[old_bv_i] = append_bv(chunk)

    for im in gltf.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = bv_remap[im["bufferView"]]

    # Rebuild mesh primitives cleanly
    kept_meshes = []
    mesh_remap = {}
    for mi, m in enumerate(gltf.get("meshes", [])):
        mname = m.get("name") or ""
        if drop_mesh_names and mname in drop_mesh_names:
            for pr in m["primitives"]:
                if "indices" in pr:
                    old_tris += gltf["accessors"][pr["indices"]]["count"] // 3
            continue

        new_prims = []
        for pr in m["primitives"]:
            attrs = pr["attributes"]
            if "POSITION" not in attrs:
                continue
            pos = read_accessor(gltf, blob, attrs["POSITION"]).astype(np.float32)
            nrm = read_accessor(gltf, blob, attrs["NORMAL"]).astype(np.float32) if "NORMAL" in attrs else None
            uv = read_accessor(gltf, blob, attrs["TEXCOORD_0"]).astype(np.float32) if "TEXCOORD_0" in attrs else None

            if "indices" in pr:
                idx = read_accessor(gltf, blob, pr["indices"]).reshape(-1, 3).astype(np.int64)
            else:
                idx = np.arange(len(pos), dtype=np.int64).reshape(-1, 3)

            old_tris += len(idx)
            if len(idx) > 600:
                npos, nnrm, nuv, ntris = cluster_decimate(pos, nrm, uv, idx, grid_res)
                # Fallback if overly aggressive on tiny part
                if len(ntris) < 12:
                    npos, nnrm, nuv, ntris = pos, nrm, uv, idx.astype(np.uint32)
            else:
                npos, nnrm, nuv, ntris = pos, nrm, uv, idx.astype(np.uint32)

            new_tris_total += len(ntris)

            new_attr_dict = {}
            pos_bv = append_bv(npos.astype(np.float32).tobytes(), 34962)
            pos_acc = {
                "bufferView": pos_bv,
                "componentType": 5126,
                "count": len(npos),
                "type": "VEC3",
                "min": npos.min(axis=0).tolist(),
                "max": npos.max(axis=0).tolist(),
            }
            new_attr_dict["POSITION"] = len(new_accs)
            new_accs.append(pos_acc)

            if nnrm is not None:
                nrm_bv = append_bv(nnrm.astype(np.float32).tobytes(), 34962)
                new_attr_dict["NORMAL"] = len(new_accs)
                new_accs.append({"bufferView": nrm_bv, "componentType": 5126, "count": len(nnrm), "type": "VEC3"})

            if nuv is not None:
                uv_bv = append_bv(nuv.astype(np.float32).tobytes(), 34962)
                new_attr_dict["TEXCOORD_0"] = len(new_accs)
                new_accs.append({"bufferView": uv_bv, "componentType": 5126, "count": len(nuv), "type": "VEC2"})

            use_u16 = len(npos) < 65535
            idx_bytes = ntris.astype(np.uint16 if use_u16 else np.uint32).reshape(-1).tobytes()
            idx_bv = append_bv(idx_bytes, 34963)
            idx_acc_i = len(new_accs)
            new_accs.append({
                "bufferView": idx_bv,
                "componentType": 5123 if use_u16 else 5125,
                "count": int(ntris.size),
                "type": "SCALAR",
            })

            out_prim = {"attributes": new_attr_dict, "indices": idx_acc_i}
            if "material" in pr:
                out_prim["material"] = pr["material"]
            if "mode" in pr:
                out_prim["mode"] = pr["mode"]
            new_prims.append(out_prim)

        if new_prims:
            mesh_remap[mi] = len(kept_meshes)
            kept_meshes.append({"name": mname, "primitives": new_prims})

    # Update nodes referencing meshes
    for node in gltf.get("nodes", []):
        if "mesh" in node:
            if node["mesh"] in mesh_remap:
                node["mesh"] = mesh_remap[node["mesh"]]
            else:
                del node["mesh"]

    while len(new_bin) % 4 != 0:
        new_bin.append(0)

    gltf["meshes"] = kept_meshes
    gltf["bufferViews"] = new_bvs
    gltf["accessors"] = new_accs
    gltf["buffers"] = [{"byteLength": len(new_bin)}]

    json_bytes = bytearray(json.dumps(gltf, separators=(",", ":")).encode("utf-8"))
    while len(json_bytes) % 4 != 0:
        json_bytes.append(0x20)

    out_glb = bytearray()
    total_len = 12 + 8 + len(json_bytes) + 8 + len(new_bin)
    out_glb.extend(struct.pack("<III", 0x46546C67, 2, total_len))
    out_glb.extend(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    out_glb.extend(json_bytes)
    out_glb.extend(struct.pack("<II", len(new_bin), 0x004E4942))
    out_glb.extend(new_bin)
    p.write_bytes(out_glb)
    print(f"{fname:24s}: {old_tris:7,d} -> {new_tris_total:6,d} tris ({len(raw)/1e6:.2f} -> {len(out_glb)/1e6:.2f} MB)")


if __name__ == "__main__":
    simplify_glb("potted_plant.glb", grid_res=26, drop_mesh_names={"low.008"})
    simplify_glb("quiver_tree.glb", grid_res=48)
    simplify_glb("street_lamp_modern.glb", grid_res=42)
    simplify_glb("traffic_cone.glb", grid_res=26)
    simplify_glb("gothic_statue.glb", grid_res=52)
    simplify_glb("marble_bust.glb", grid_res=46)
    simplify_glb("horse_statue.glb", grid_res=52)
    simplify_glb("coffee_cart.glb", grid_res=48)
