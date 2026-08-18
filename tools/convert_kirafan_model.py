#!/usr/bin/env python3
"""Convert a Kirara Fantasia Unity model bundle to an animated GLB.

The game stores the body and head as two skinned hierarchies.  This exporter
keeps both skeletons, selects one head direction/expression, combines the RGB
and alpha atlases, and merges matching body/head AnimationClips.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import struct
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import UnityPy
from PIL import Image
from UnityPy.helpers.MeshHelper import MeshHandler


COMPONENT_FLOAT = 5126
COMPONENT_UNSIGNED_SHORT = 5123
COMPONENT_UNSIGNED_INT = 5125
TARGET_ARRAY_BUFFER = 34962
TARGET_ELEMENT_ARRAY_BUFFER = 34963


def pptr_id(value: Any) -> int:
    return int(getattr(value, "path_id", getattr(value, "m_PathID", 0)) or 0)


def vec3(value: Any, reflect_x: bool = False) -> list[float]:
    x = float(value.x)
    return [-x if reflect_x else x, float(value.y), float(value.z)]


def quat(value: Any) -> list[float]:
    # C * R * C, where C reflects Unity's left-handed X axis.
    return [float(value.x), -float(value.y), -float(value.z), float(value.w)]


def curve_vec3(value: dict[str, float]) -> list[float]:
    return [-float(value["x"]), float(value["y"]), float(value["z"])]


def curve_quat(value: dict[str, float], normalize: bool = False) -> list[float]:
    result = [float(value["x"]), -float(value["y"]), -float(value["z"]), float(value["w"])]
    if normalize:
        length = math.sqrt(sum(component * component for component in result))
        if length:
            result = [component / length for component in result]
    return result


def matrix4(value: Any) -> np.ndarray:
    matrix = np.array(
        [[getattr(value, f"e{row}{column}") for column in range(4)] for row in range(4)],
        dtype=np.float32,
    )
    conversion = np.diag([-1.0, 1.0, 1.0, 1.0]).astype(np.float32)
    return conversion @ matrix @ conversion


class GlbBuilder:
    def __init__(self) -> None:
        self.binary = bytearray()
        self.document: dict[str, Any] = {
            "asset": {"version": "2.0", "generator": "kirafan UnityPy GLB exporter"},
            "scene": 0,
            "scenes": [{"nodes": []}],
            "nodes": [],
            "meshes": [],
            "skins": [],
            "materials": [],
            "textures": [],
            "images": [],
            "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
            "animations": [],
            "bufferViews": [],
            "accessors": [],
            "extensionsUsed": ["KHR_materials_unlit"],
        }
        self.accessor_cache: dict[tuple[Any, ...], int] = {}
        self.image_cache: dict[bytes, int] = {}

    def align(self, alignment: int = 4) -> None:
        while len(self.binary) % alignment:
            self.binary.append(0)

    def add_view(self, payload: bytes, target: int | None = None) -> int:
        self.align()
        offset = len(self.binary)
        self.binary.extend(payload)
        view: dict[str, Any] = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        self.document["bufferViews"].append(view)
        return len(self.document["bufferViews"]) - 1

    def add_accessor(
        self,
        values: np.ndarray,
        component_type: int,
        accessor_type: str,
        target: int | None = None,
        include_bounds: bool = False,
    ) -> int:
        values = np.ascontiguousarray(values)
        payload = values.tobytes()
        cache_key = (
            component_type,
            accessor_type,
            target,
            include_bounds,
            int(values.shape[0]),
            hashlib.blake2b(payload, digest_size=16).digest(),
        )
        cached = self.accessor_cache.get(cache_key)
        if cached is not None:
            return cached
        view = self.add_view(payload, target)
        accessor: dict[str, Any] = {
            "bufferView": view,
            "componentType": component_type,
            "count": int(values.shape[0]),
            "type": accessor_type,
        }
        if include_bounds:
            shaped = values.reshape(values.shape[0], -1)
            accessor["min"] = shaped.min(axis=0).astype(float).tolist()
            accessor["max"] = shaped.max(axis=0).astype(float).tolist()
        self.document["accessors"].append(accessor)
        accessor_index = len(self.document["accessors"]) - 1
        self.accessor_cache[cache_key] = accessor_index
        return accessor_index

    def add_png(self, image: Image.Image, name: str) -> int:
        stream = io.BytesIO()
        image.save(stream, format="PNG", optimize=True)
        payload = stream.getvalue()
        image_key = hashlib.blake2b(payload, digest_size=16).digest()
        cached = self.image_cache.get(image_key)
        if cached is not None:
            return cached
        view = self.add_view(payload)
        self.document["images"].append({"name": name, "mimeType": "image/png", "bufferView": view})
        image_index = len(self.document["images"]) - 1
        self.document["textures"].append({"sampler": 0, "source": image_index})
        texture_index = len(self.document["textures"]) - 1
        self.image_cache[image_key] = texture_index
        return texture_index

    def write(self, output: Path) -> None:
        self.align()
        self.document["buffers"] = [{"byteLength": len(self.binary)}]
        json_payload = json.dumps(self.document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        while len(json_payload) % 4:
            json_payload += b" "
        binary_payload = bytes(self.binary)
        total_length = 12 + 8 + len(json_payload) + 8 + len(binary_payload)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("wb") as handle:
            handle.write(struct.pack("<4sII", b"glTF", 2, total_length))
            handle.write(struct.pack("<I4s", len(json_payload), b"JSON"))
            handle.write(json_payload)
            handle.write(struct.pack("<I4s", len(binary_payload), b"BIN\0"))
            handle.write(binary_payload)


class KirafanExporter:
    ACTIONS = {
        "room_idle_L": ("common_menu_body.muast", "common_menu_head_0.muast"),
        "battle_run": ("common_battle_body.muast", "common_battle_head_0.muast"),
        "damage": ("common_battle_body.muast", "common_battle_head_0.muast"),
        "kirarajump_0": ("common_battle_body.muast", "common_battle_head_0.muast"),
        "win_st_0": ("common_battle_body.muast", "common_battle_head_0.muast"),
    }

    def __init__(self, model_bundle: Path, animation_dir: Path) -> None:
        self.environment = UnityPy.load(str(model_bundle))
        self.animation_dir = animation_dir
        self.builder = GlbBuilder()
        self.transforms = {
            item.path_id: item.read() for item in self.environment.objects if item.type.name == "Transform"
        }
        self.transform_for_game_object = {
            pptr_id(transform.m_GameObject): transform for transform in self.transforms.values()
        }
        self.node_for_transform: dict[int, int] = {}
        self.path_maps: dict[str, dict[str, int]] = {"body": {}, "head": {}}
        self.skin_cache: dict[tuple[Any, ...], int] = {}
        self.render_orders = self.read_render_orders()
        root_names = [self.object_name(transform).lower() for transform in self.transforms.values()]
        texture_names = [
            item.read().m_Name.lower()
            for item in self.environment.objects
            if item.type.name == "Texture2D"
        ]
        has_player_atlases = all(
            any(name.endswith(suffix) for name in texture_names)
            for suffix in ("_body_rgb", "_body_a", "_head_rgb", "_head_a")
        )
        if (
            has_player_atlases
            and any("_body" in name for name in root_names)
            and any("_head" in name for name in root_names)
        ):
            self.mode = "player"
        elif any(item.type.name == "SkinnedMeshRenderer" for item in self.environment.objects):
            self.mode = "skinned"
        else:
            self.mode = "static"

    @staticmethod
    def object_name(transform: Any) -> str:
        return transform.m_GameObject.read().m_Name

    def hierarchy_kind(self, transform: Any) -> str | None:
        current = transform
        while current is not None:
            name = self.object_name(current).lower()
            if "_body" in name:
                return "body"
            if "_head" in name:
                return "head"
            current = self.transforms.get(pptr_id(current.m_Father))
        return None

    def read_render_orders(self) -> dict[str, int]:
        result: dict[str, int] = {}
        for item in self.environment.objects:
            if item.type.name != "MonoBehaviour":
                continue
            try:
                behaviour = item.read()
                if behaviour.m_Script.read().m_Name != "MsbHandler":
                    continue
                for entry in item.read_typetree().get("m_MsbObjectHandlerArray", []):
                    # Msb renders lower orders first and uses the hierarchy index
                    # as the stable order for pieces sharing the same layer.  The
                    # latter matters for overlapping hands, sleeves, and clothing.
                    render_order = int(entry["m_Src"]["m_RenderOrder"])
                    hierarchy_index = max(0, int(entry.get("m_HieIndex", 0)))
                    result[entry["m_Name"]] = render_order * 1000 + hierarchy_index
            except Exception:
                continue
        return result

    def add_hierarchy(self) -> None:
        for transform_id, transform in self.transforms.items():
            node = {
                "name": self.object_name(transform),
                "translation": vec3(transform.m_LocalPosition, reflect_x=True),
                "rotation": quat(transform.m_LocalRotation),
                "scale": vec3(transform.m_LocalScale),
            }
            self.builder.document["nodes"].append(node)
            self.node_for_transform[transform_id] = len(self.builder.document["nodes"]) - 1

        for transform_id, transform in self.transforms.items():
            node = self.builder.document["nodes"][self.node_for_transform[transform_id]]
            children = [self.node_for_transform[pptr_id(child)] for child in transform.m_Children if pptr_id(child) in self.node_for_transform]
            if children:
                node["children"] = children
            if not pptr_id(transform.m_Father):
                self.builder.document["scenes"][0]["nodes"].append(self.node_for_transform[transform_id])

        for kind, anchor_name in (("body", "root"), ("head", "Head_root")):
            anchors = [
                transform for transform in self.transforms.values()
                if self.object_name(transform) == anchor_name and self.hierarchy_kind(transform) == kind
            ]
            if anchors:
                self.collect_animation_paths(kind, anchors[0], anchor_name)

    def collect_animation_paths(self, kind: str, transform: Any, path: str) -> None:
        transform_id = transform.object_reader.path_id
        self.path_maps[kind][path] = self.node_for_transform[transform_id]
        for child_ref in transform.m_Children:
            child = self.transforms.get(pptr_id(child_ref))
            if child is not None:
                self.collect_animation_paths(kind, child, f"{path}/{self.object_name(child)}")

    def add_materials(self) -> dict[str, int]:
        textures: dict[str, Image.Image] = {}
        for item in self.environment.objects:
            if item.type.name == "Texture2D":
                texture = item.read()
                textures[texture.m_Name] = texture.image

        result: dict[str, int] = {}
        for kind in ("body", "head"):
            rgb_name = next(name for name in textures if name.endswith(f"_{kind}_rgb"))
            alpha_name = next(name for name in textures if name.endswith(f"_{kind}_a"))
            rgb = textures[rgb_name].convert("RGB")
            alpha = textures[alpha_name].getchannel("A")
            combined = rgb.copy()
            combined.putalpha(alpha)
            texture_index = self.builder.add_png(combined, f"{kind}_atlas")
            material = {
                "name": f"kirafan_{kind}",
                # Reflected and mirrored sprite planes do not keep a uniform
                # winding direction after conversion, so preserve both faces.
                "doubleSided": True,
                "alphaMode": "BLEND",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": texture_index},
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
                "extensions": {"KHR_materials_unlit": {}},
            }
            self.builder.document["materials"].append(material)
            result[kind] = len(self.builder.document["materials"]) - 1
        return result

    def add_generic_materials(self) -> dict[int, int]:
        result: dict[int, int] = {}
        for item in self.environment.objects:
            if item.type.name != "Material":
                continue
            material = item.read()
            texture_entries: dict[str, Any] = {}
            for key, texture_environment in material.m_SavedProperties.m_TexEnvs:
                key_name = key if isinstance(key, str) else key.name
                if texture_environment.m_Texture:
                    try:
                        texture_entries[key_name] = texture_environment.m_Texture.read()
                    except Exception:
                        continue
            rgb_texture = texture_entries.get("_Texture_Albedo")
            if rgb_texture is None and texture_entries:
                rgb_texture = next(iter(texture_entries.values()))
            if rgb_texture is None:
                image = Image.new("RGBA", (2, 2), (255, 255, 255, 255))
            else:
                image = rgb_texture.image.convert("RGBA")
            alpha_texture = texture_entries.get("_Texture_AlbedoLayer")
            if alpha_texture is not None:
                alpha = alpha_texture.image.getchannel("A")
                if alpha.size != image.size:
                    alpha = alpha.resize(image.size, Image.Resampling.NEAREST)
                image.putalpha(alpha)
            texture_index = self.builder.add_png(image, material.m_Name)
            self.builder.document["materials"].append(
                {
                    "name": material.m_Name,
                    "doubleSided": True,
                    "alphaMode": "BLEND",
                    "pbrMetallicRoughness": {
                        "baseColorTexture": {"index": texture_index},
                        "metallicFactor": 0,
                        "roughnessFactor": 1,
                    },
                    "extensions": {"KHR_materials_unlit": {}},
                }
            )
            result[item.path_id] = len(self.builder.document["materials"]) - 1
        return result

    @staticmethod
    def include_head_renderer(name: str) -> bool:
        return name.startswith("L30_")

    @staticmethod
    def face_part(name: str) -> dict[str, str] | None:
        if not name.startswith("L30_"):
            return None
        part = name[4:]
        if part.startswith("eye_"):
            return {"kind": "eye", "name": part}
        if part.startswith("eyebrrow_"):
            return {"kind": "eyebrow", "name": part}
        if part.startswith("mouth_"):
            return {"kind": "mouth", "name": part}
        if part == "cry" or part.startswith("tere_"):
            return {"kind": "overlay", "name": part}
        return None

    def add_meshes(self, materials: dict[str, int]) -> None:
        for item in self.environment.objects:
            if item.type.name != "SkinnedMeshRenderer":
                continue
            renderer = item.read()
            transform = self.transform_for_game_object.get(pptr_id(renderer.m_GameObject))
            if transform is None:
                continue
            kind = self.hierarchy_kind(transform)
            name = renderer.m_GameObject.read().m_Name
            if kind not in {"body", "head"} or (kind == "head" and not self.include_head_renderer(name)):
                continue
            self.add_skinned_renderer(renderer, transform, kind, materials[kind])

    @staticmethod
    def include_generic_renderer(name: str) -> bool:
        lowered = name.lower()
        return not any(marker in lowered for marker in ("damage", "abnormal", "flash"))

    def renderer_material(self, renderer: Any, materials: dict[int, int]) -> int:
        if renderer.m_Materials:
            material_id = pptr_id(renderer.m_Materials[0])
            if material_id in materials:
                return materials[material_id]
        return next(iter(materials.values()))

    def add_generic_meshes(self, materials: dict[int, int]) -> None:
        for item in self.environment.objects:
            if item.type.name == "SkinnedMeshRenderer":
                renderer = item.read()
                transform = self.transform_for_game_object.get(pptr_id(renderer.m_GameObject))
                if transform is None or not self.include_generic_renderer(renderer.m_GameObject.read().m_Name):
                    continue
                self.add_skinned_renderer(renderer, transform, "generic", self.renderer_material(renderer, materials))
            elif item.type.name == "MeshRenderer":
                renderer = item.read()
                transform = self.transform_for_game_object.get(pptr_id(renderer.m_GameObject))
                if transform is not None:
                    self.add_static_renderer(renderer, transform, self.renderer_material(renderer, materials))

    def add_static_renderer(self, renderer: Any, transform: Any, material: int) -> None:
        mesh = None
        game_object = renderer.m_GameObject.read()
        for component in game_object.m_Component:
            try:
                candidate = component.component.read()
            except Exception:
                continue
            if hasattr(candidate, "m_Mesh") and candidate.m_Mesh:
                mesh = candidate.m_Mesh.read()
                break
        if mesh is None:
            return
        handler = MeshHandler(mesh)
        handler.process()
        if not handler.m_Vertices:
            return
        positions = np.asarray([(-x, y, z) for x, y, z in handler.m_Vertices], dtype=np.float32)
        attributes = {
            "POSITION": self.builder.add_accessor(positions, COMPONENT_FLOAT, "VEC3", TARGET_ARRAY_BUFFER, True)
        }
        if handler.m_Normals:
            normals = np.asarray([(-x, y, z) for x, y, z in handler.m_Normals], dtype=np.float32)
            attributes["NORMAL"] = self.builder.add_accessor(normals, COMPONENT_FLOAT, "VEC3", TARGET_ARRAY_BUFFER)
        if handler.m_UV0:
            uvs = np.asarray([(u, 1.0 - v) for u, v in handler.m_UV0], dtype=np.float32)
            attributes["TEXCOORD_0"] = self.builder.add_accessor(uvs, COMPONENT_FLOAT, "VEC2", TARGET_ARRAY_BUFFER)
        triangles = handler.get_triangles()[0]
        index_dtype = np.uint16 if len(positions) <= 65535 else np.uint32
        index_component = COMPONENT_UNSIGNED_SHORT if index_dtype == np.uint16 else COMPONENT_UNSIGNED_INT
        indices = np.asarray([(c, b, a) for a, b, c in triangles], dtype=index_dtype).reshape(-1)
        index_accessor = self.builder.add_accessor(indices, index_component, "SCALAR", TARGET_ELEMENT_ARRAY_BUFFER)
        self.builder.document["meshes"].append(
            {
                "name": mesh.m_Name,
                "primitives": [{"attributes": attributes, "indices": index_accessor, "material": material}],
                "extras": {"renderOrder": self.render_orders.get(mesh.m_Name, 0)},
            }
        )
        node = self.builder.document["nodes"][self.node_for_transform[transform.object_reader.path_id]]
        node["mesh"] = len(self.builder.document["meshes"]) - 1
        node["extras"] = {"renderOrder": self.render_orders.get(mesh.m_Name, 0)}

    def add_skinned_renderer(self, renderer: Any, transform: Any, kind: str, material: int) -> None:
        if not pptr_id(renderer.m_Mesh):
            return
        mesh = renderer.m_Mesh.read()
        handler = MeshHandler(mesh)
        handler.process()
        if not handler.m_Vertices:
            return

        positions = np.asarray([(-x, y, z) for x, y, z in handler.m_Vertices], dtype=np.float32)
        normals = np.asarray([(-x, y, z) for x, y, z in handler.m_Normals], dtype=np.float32)
        uvs = np.asarray([(u, 1.0 - v) for u, v in handler.m_UV0], dtype=np.float32)
        joints = np.asarray(handler.m_BoneIndices, dtype=np.uint16)
        weights = np.asarray(handler.m_BoneWeights, dtype=np.float32)

        position_accessor = self.builder.add_accessor(positions, COMPONENT_FLOAT, "VEC3", TARGET_ARRAY_BUFFER, True)
        normal_accessor = self.builder.add_accessor(normals, COMPONENT_FLOAT, "VEC3", TARGET_ARRAY_BUFFER)
        uv_accessor = self.builder.add_accessor(uvs, COMPONENT_FLOAT, "VEC2", TARGET_ARRAY_BUFFER)
        joint_accessor = self.builder.add_accessor(joints, COMPONENT_UNSIGNED_SHORT, "VEC4", TARGET_ARRAY_BUFFER)
        weight_accessor = self.builder.add_accessor(weights, COMPONENT_FLOAT, "VEC4", TARGET_ARRAY_BUFFER)

        triangles = handler.get_triangles()[0]
        index_dtype = np.uint16 if len(positions) <= 65535 else np.uint32
        index_component = COMPONENT_UNSIGNED_SHORT if index_dtype == np.uint16 else COMPONENT_UNSIGNED_INT
        indices = np.asarray([(c, b, a) for a, b, c in triangles], dtype=index_dtype).reshape(-1)
        index_accessor = self.builder.add_accessor(indices, index_component, "SCALAR", TARGET_ELEMENT_ARRAY_BUFFER)
        primitive = {
            "attributes": {
                "POSITION": position_accessor,
                "NORMAL": normal_accessor,
                "TEXCOORD_0": uv_accessor,
                "JOINTS_0": joint_accessor,
                "WEIGHTS_0": weight_accessor,
            },
            "indices": index_accessor,
            "material": material,
        }
        self.builder.document["meshes"].append(
            {"name": mesh.m_Name, "primitives": [primitive], "extras": {"renderOrder": self.render_orders.get(mesh.m_Name, 0)}}
        )
        mesh_index = len(self.builder.document["meshes"]) - 1

        bone_nodes = [self.node_for_transform[pptr_id(bone)] for bone in renderer.m_Bones]
        bind_matrices = np.asarray(
            [matrix4(bind_pose).T.reshape(-1) for bind_pose in mesh.m_BindPose], dtype=np.float32
        )
        bind_accessor = self.builder.add_accessor(bind_matrices, COMPONENT_FLOAT, "MAT4")
        skin: dict[str, Any] = {"joints": bone_nodes, "inverseBindMatrices": bind_accessor}
        root_bone_id = pptr_id(renderer.m_RootBone)
        if root_bone_id in self.node_for_transform:
            skin["skeleton"] = self.node_for_transform[root_bone_id]
        skin_key = (tuple(bone_nodes), bind_accessor, skin.get("skeleton"))
        skin_index = self.skin_cache.get(skin_key)
        if skin_index is None:
            self.builder.document["skins"].append(skin)
            skin_index = len(self.builder.document["skins"]) - 1
            self.skin_cache[skin_key] = skin_index

        node = self.builder.document["nodes"][self.node_for_transform[transform.object_reader.path_id]]
        node["mesh"] = mesh_index
        node["skin"] = skin_index
        node["extras"] = {"renderOrder": self.render_orders.get(mesh.m_Name, 0)}
        face_part = self.face_part(renderer.m_GameObject.read().m_Name) if kind == "head" else None
        if face_part:
            node["extras"]["facePart"] = face_part

    def load_clips(self, bundle_name: str) -> dict[str, dict[str, Any]]:
        environment = UnityPy.load(str(self.animation_dir / bundle_name))
        result = {}
        for item in environment.objects:
            if item.type.name == "AnimationClip":
                tree = item.read_typetree()
                result[tree["m_Name"].split("@", 1)[-1]] = tree
        return result

    def add_animations(self) -> None:
        cache: dict[str, dict[str, dict[str, Any]]] = {}
        for action, (body_bundle, head_bundle) in self.ACTIONS.items():
            cache.setdefault(body_bundle, self.load_clips(body_bundle))
            cache.setdefault(head_bundle, self.load_clips(head_bundle))
            animation = {"name": action, "samplers": [], "channels": []}
            self.add_clip_channels(animation, cache[body_bundle][action], "body")
            self.add_clip_channels(animation, cache[head_bundle][action], "head")
            if animation["channels"]:
                self.builder.document["animations"].append(animation)

    def add_clip_channels(self, animation: dict[str, Any], clip: dict[str, Any], kind: str) -> None:
        for curves, target_path, width in (
            (clip["m_PositionCurves"], "translation", 3),
            (clip["m_RotationCurves"], "rotation", 4),
            (clip["m_ScaleCurves"], "scale", 3),
        ):
            for entry in curves:
                node = self.path_maps[kind].get(entry["path"])
                keys = entry["curve"]["m_Curve"]
                if node is None or not keys:
                    continue
                times = np.asarray([key["time"] for key in keys], dtype=np.float32)
                output: list[list[float]] = []
                for key in keys:
                    if width == 4:
                        output.extend(
                            [curve_quat(key["inSlope"]), curve_quat(key["value"], True), curve_quat(key["outSlope"])]
                        )
                    else:
                        convert = curve_vec3 if target_path == "translation" else lambda value: [float(value[k]) for k in ("x", "y", "z")]
                        output.extend([convert(key["inSlope"]), convert(key["value"]), convert(key["outSlope"])])
                input_accessor = self.builder.add_accessor(times, COMPONENT_FLOAT, "SCALAR", include_bounds=True)
                output_accessor = self.builder.add_accessor(
                    np.asarray(output, dtype=np.float32), COMPONENT_FLOAT, f"VEC{width}"
                )
                animation["samplers"].append(
                    {"input": input_accessor, "output": output_accessor, "interpolation": "CUBICSPLINE"}
                )
                animation["channels"].append(
                    {"sampler": len(animation["samplers"]) - 1, "target": {"node": node, "path": target_path}}
                )

    def export(self, output: Path) -> None:
        self.add_hierarchy()
        if self.mode == "player":
            materials = self.add_materials()
            self.add_meshes(materials)
            self.add_animations()
        else:
            materials = self.add_generic_materials()
            self.add_generic_meshes(materials)
        self.builder.write(output)
        print(
            f"Wrote {output} ({output.stat().st_size:,} bytes, {self.mode}, "
            f"{len(self.builder.document['meshes'])} meshes, "
            f"{len(self.builder.document['animations'])} animations)"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("model_bundle", type=Path)
    parser.add_argument("animation_dir", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    exporter = KirafanExporter(args.model_bundle, args.animation_dir)
    exporter.export(args.output)


if __name__ == "__main__":
    main()
