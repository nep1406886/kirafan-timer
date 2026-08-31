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
import re
import struct
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import UnityPy
from PIL import Image, ImageChops
from UnityPy.helpers.MeshHelper import MeshHandler


COMPONENT_FLOAT = 5126
COMPONENT_UNSIGNED_SHORT = 5123
COMPONENT_UNSIGNED_INT = 5125
TARGET_ARRAY_BUFFER = 34962
TARGET_ELEMENT_ARRAY_BUFFER = 34963
# MsbMaterialHandler.MsbMaterialParam.m_AlphaTestRefValue, which every bundle
# sampled so far leaves at its 0.01f default.
ALPHA_TEST_REF = 0.01
# Six enemies ship no anim bundle of their own and none under the family-base name
# either, yet still draw several pose sets at once.  Each borrows from the bundle
# below, and every entry is a measurement rather than a naming guess:
#
#   4300 <- 1700   all 122 nodes match name *and* (vertices, triangles); it is en_1700
#                  recoloured.  Was the fleet's worst model at 10 twin pairs and 8
#                  coincident pairs, its L_* and R_* pose sets both on screen.
#   7700 <- 5700   41/41 exact.  Fixes Serif_1_obj against Serif_2_obj at IoU 1.0.
#   8100 <- 5600   30/30 exact.  Fixes arm_R_A_under_obj against arm_R_under_B_obj.
#   8400 <- 8300   51/51 exact.
#   6300 <- 3800   25 of 26 exact, head_obj alone differs -- same body, different face.
#  13300 <- 13200  41 shared names all topology-identical, and common_en_13200 carries
#                  tracks for en_13300's *own* Ax_hand_open_* nodes, so the bundle was
#                  authored for both weapon variants.  Fixes arm_R_obj against
#                  Slash1_arm_R_obj at IoU 1.0 across 13300-13305.
#
# Rejected candidates are as informative: the remaining tableless enemies scored at or
# below 0.65 weighted coverage of their switchable names, or tied between bundles that
# disagreed on what to hide.  Borrowing on a coin flip risks deleting a real part, and
# the ones refused are all small rigs the fleet audit found clean anyway.
ENEMY_VISIBILITY_DONORS = {
    "4300": "common_en_1700.muast",
    "6300": "common_en_3800.muast",
    "7700": "common_en_5700.muast",
    "8100": "common_en_5600.muast",
    "8400": "common_en_8300.muast",
    "13300": "common_en_13200.muast",
}

# MeigeAnimClip.m_AnimNodeHandlerArray[].m_Target.m_TargetType.  9 is the
# GameObject-visibility track; the transform tracks stay in the Unity
# AnimationClip beside it.  Same constant as build_visibility_table.py.
TARGET_TYPE_VISIBILITY = 9


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
    CLASS_ACTIONS = ("idle", "attack", "class_skill_1", "class_skill_2", "class_skill_3")

    def __init__(
        self,
        model_bundle: Path,
        animation_dir: Path,
        class_animation_bundle: Path | None = None,
        class_head_animation_bundle: Path | None = None,
        include_common_animations: bool = True,
        animation_only: bool = False,
        extra_animation_bundles: dict[str, Path] | None = None,
    ) -> None:
        self.model_bundle = model_bundle
        self.environment = UnityPy.load(str(model_bundle))
        self.animation_dir = animation_dir
        self.class_animation_bundle = class_animation_bundle
        self.class_head_animation_bundle = class_head_animation_bundle
        # {exported clip name: bundle holding its body and head clips}
        self.extra_animation_bundles = extra_animation_bundles or {}
        self.published_bundle_animations: list[str] = []
        self.include_common_animations = include_common_animations
        self.animation_only = animation_only
        self.builder = GlbBuilder()
        self.transforms = {
            item.path_id: item.read() for item in self.environment.objects if item.type.name == "Transform"
        }
        self.transform_for_game_object = {
            pptr_id(transform.m_GameObject): transform for transform in self.transforms.values()
        }
        self.node_for_transform: dict[int, int] = {}
        self.path_maps: dict[str, dict[str, int]] = {"body": {}, "head": {}, "generic": {}}
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
        # Enemy animation bundles address a single hierarchy rooted at `root`.
        # Keep a separate map so their clips cannot collide with player head/body paths.
        generic_anchor_names = {"root", "Head_root", "LOC_overhead", "LOC_WPN_8200"}
        for transform in self.transforms.values():
            name = self.object_name(transform)
            if name in generic_anchor_names or name.startswith("LOC_WPN_"):
                self.collect_animation_paths("generic", transform, name)

    def collect_animation_paths(self, kind: str, transform: Any, path: str) -> None:
        transform_id = transform.object_reader.path_id
        self.path_maps[kind][path] = self.node_for_transform[transform_id]
        for child_ref in transform.m_Children:
            child = self.transforms.get(pptr_id(child_ref))
            if child is not None:
                self.collect_animation_paths(kind, child, f"{path}/{self.object_name(child)}")

    @staticmethod
    def fit_alpha(alpha: Image.Image, size: tuple[int, int]) -> Image.Image:
        """Resize an alpha layer onto the colour map's grid.

        Enemies ship the alpha layer at half the colour map's resolution
        (model_en_7000: 256x256 against a 512x512 atlas), so this is a 2x
        upscale on most of them and a no-op on players.

        It has to be BILINEAR.  NEAREST turns every source texel into a hard
        2x2 block -- measured on model_en_7000, 100.0% of the 2x2 blocks in the
        edge band come out perfectly flat, against 0.6% for BILINEAR -- which
        replaces the authored 1-texel anti-aliased ramp with a staircase locked
        to the 256 grid.  The viewer then magnifies that ~3x (one atlas texel
        covers 2.75-3.40 device pixels), so each block becomes a ~6 pixel square
        step.  That staircase is baked into the texture, which is why no amount
        of MSAA or supersampling in the viewer could remove it.

        LANCZOS is not used: it keeps the gradient as steep as NEAREST (0.2228
        vs 0.2140, against BILINEAR's 0.1686) because it rings, and ringing on
        an alpha matte punches pinholes and haloes.

        The upscale is then gated on the source matte.  Interpolating outward
        from a source texel the artist left at alpha 0 lifts its neighbours above
        the 0.01 cutoff, and alphaMode MASK draws every surviving texel at full
        strength -- so those texels show whatever filler the colour atlas happens
        to hold outside the painted area.  Measured on model_en_7000's main
        atlas, the ungated upscale invents 13481 such texels (5.1% of the atlas):
        mean luminance 29.6 against 196.7 for the opaque body beside them, 12413
        of them darker than that body by more than 24 levels.  At this viewer's
        magnification (one atlas texel spans 2.75-3.40 device pixels) a
        one-texel band is a three-pixel black outline, which is what "黑边很重"
        reported.  Gating restores NEAREST's silhouette (157030 kept texels
        against 155968) while keeping BILINEAR's ramp: gradient over the painted
        edge band is 0.1873, against BILINEAR's 0.1810 and NEAREST's 0.2071.  Of
        the texels it drops, only 569 were within 24 levels of the body colour,
        so it is filler that goes, not authored detail (.codex-tmp/gate_sim.py).

        The darkness that remains inside the painted ramp is authored -- 71529
        texels here, and rgb/alpha does not recover the body colour from them
        (residual 96-143, .codex-tmp/premul.py), so the atlas is not simply
        premultiplied.  That band is repaired at load time instead; see
        core/texture-fringe.js.

        The gate only applies when the alpha layer is being magnified.  Some
        materials pair a tiny colour map with the full-size alpha atlas
        (model_en_7000's _flash is 4x4 RGB against 256x256 alpha), and there
        NEAREST is not a matte at all -- it point-samples 16 of 65536 texels, so
        gating on it zeroed 6 of the 16 for no reason.
        """
        if alpha.size == size:
            return alpha
        smooth = alpha.resize(size, Image.Resampling.BILINEAR)
        if size[0] <= alpha.size[0] and size[1] <= alpha.size[1]:
            return smooth
        matte = alpha.resize(size, Image.Resampling.NEAREST)
        return ImageChops.multiply(smooth, matte.point(lambda v: 255 if v else 0))

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
            alpha = self.fit_alpha(textures[alpha_name].getchannel("A"), rgb.size)
            combined = rgb.copy()
            combined.putalpha(alpha)
            texture_index = self.builder.add_png(combined, f"{kind}_atlas")
            material = {
                "name": f"kirafan_{kind}",
                # Reflected and mirrored sprite planes do not keep a uniform
                # winding direction after conversion, so preserve both faces.
                "doubleSided": True,
                # The source materials do not blend: their Unity floats read
                # _Mode=0 (opaque), _SrcBlend=One/_DstBlend=Zero, _ZWrite=1,
                # and MsbHandler supplies m_AlphaTestRefValue=0.01.  Blending
                # them made the first-drawn layer blend its anti-aliased edge
                # against the background and then write depth, leaving a dark
                # seam wherever a later layer sat behind it.
                "alphaMode": "MASK",
                "alphaCutoff": ALPHA_TEST_REF,
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

    @staticmethod
    def material_floats(material: Any) -> dict[str, float]:
        floats: dict[str, float] = {}
        for key, value in material.m_SavedProperties.m_Floats:
            floats[key if isinstance(key, str) else key.name] = float(value)
        return floats

    @classmethod
    def alpha_state(cls, material: Any) -> dict[str, Any]:
        """Translate a Unity material's blend floats into glTF alpha state.

        The main character materials read _Mode=0 with _SrcBlend=One and
        _DstBlend=Zero, meaning no blending at all -- they only cut fully
        transparent texels away, at MsbHandler's m_AlphaTestRefValue.  The
        "_outline" materials read _Mode=3 with _DstBlend=OneMinusSrcAlpha and
        _ZWrite=0, and those really are translucent.
        """
        floats = cls.material_floats(material)
        mode = floats.get("_Mode", 0.0)
        dst = floats.get("_DstBlend", 0.0)
        z_write = floats.get("_ZWrite", 1.0)
        # UnityEngine.Rendering.BlendMode.Zero is 0; anything else blends.
        blends = mode >= 2.0 or dst != 0.0
        if blends:
            return {"alphaMode": "BLEND", "extras": {"depthWrite": z_write != 0.0}}
        cutoff = floats.get("_AlphaTestRefValue", floats.get("_Cutoff", ALPHA_TEST_REF))
        # _Cutoff defaults to 0.5, which would eat the anti-aliased sprite edge.
        if cutoff >= 0.5:
            cutoff = ALPHA_TEST_REF
        return {
            "alphaMode": "MASK",
            "alphaCutoff": cutoff,
            "extras": {"depthWrite": z_write != 0.0},
        }

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
                image.putalpha(self.fit_alpha(
                    alpha_texture.image.getchannel("A"), image.size))
            texture_index = self.builder.add_png(image, material.m_Name)
            entry = {
                "name": material.m_Name,
                "doubleSided": True,
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": texture_index},
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
                "extensions": {"KHR_materials_unlit": {}},
            }
            entry.update(self.alpha_state(material))
            self.builder.document["materials"].append(entry)
            result[item.path_id] = len(self.builder.document["materials"]) - 1
        return result

    @staticmethod
    def include_head_renderer(name: str) -> bool:
        return name.startswith("L30_")

    # Switchable face layers, matched case-insensitively against the part name.
    #
    # The vocabulary is the game's, typos included: "eyebrrow" outnumbers the
    # correct spelling, and "bule" appears for "blue".  Nine models (the newgame
    # and sakura sets) capitalise theirs -- Eye_A, Eyebrrow_C, Eye_D2 -- so
    # matching has to fold case or every one of their eye variants stays
    # classified as head base and renders stacked on top of each other.
    #
    # A layer may also arrive with no variant suffix at all (bare "cheek",
    # "sen", "eyebrrow"), or with a digit welded straight on ("Eye_A2" rather
    # than "Eye_A_2"), so each pattern allows an optional suffix instead of
    # anchoring on a trailing underscore.
    #
    # Anything absent here is head base -- hair, face, backhead, and the
    # permanent decorations "hokuro" (a mole), "black", "backhair", "ribon" and
    # "head_accessory", none of which any of the 238 authored facial tables ever
    # switches.  Glasses are deliberately absent too: a handful of tables do
    # switch them, but the models without a table must keep wearing them, so
    # they stay visible by default rather than being hidden as an overlay.
    # Order matters: "eyelid" and "eyebrrow" both start with "eye", so the
    # narrower patterns have to be tried before the bare eye one.
    FACE_PATTERNS = (
        ("overlay", re.compile(r"^eyelid(?:[_-]?\w+)?$", re.I)),
        # Three spellings in the wild: "eyebrow", "eyebrrow" (the commonest) and
        # "eyeblow".  Miss one and its layers fall through to the bare eye rule
        # below, where the brows then compete with the eyes as eye variants.
        ("eyebrow", re.compile(r"^eye(?:br+|bl)ow(?:[_-]?\w+)?$", re.I)),
        ("eye", re.compile(r"^eye(?:[_-]?\w+)?$", re.I)),
        ("mouth", re.compile(r"^(?:mouth|kuchi)(?:[_-]?\w+)?$", re.I)),
        # The emotion words are short and English, so an open \w+ suffix here
        # would swallow any permanent mesh that merely starts with one and hide
        # it for good.  Across the corpus their real suffixes are only ever a
        # letter and/or a digit, optionally behind "_face", so spell that out.
        # Keep this list in step with FACE_OVERLAY_PART in models.js: that one is
        # the fallback used whenever these extras are missing, and if the two
        # disagree a layer changes behaviour depending on which path ran.
        ("overlay", re.compile(
            r"^(?:cry|namida|tere|che+c?k|sen|shade|shadow|blue|bule|aozame|pale|"
            r"red|black|angry|sad|shy|question|text)"
            r"(?:_face)?(?:_?[A-Za-z](?:_?\d)?|_?\d)?$", re.I)),
    )

    @classmethod
    def face_part(cls, name: str) -> dict[str, str] | None:
        if not name[:4].lower() == "l30_":
            return None
        part = name[4:]
        # Glasses read as "eye..." to the eye pattern, so take them out first.
        # They are worn rather than switched: the few tables that do toggle them
        # address them by name, and every model without a table has to keep
        # them on, so they must not become a competing eye variant.
        if re.match(r"^(?:eye)?glass(?:es)?(?:[_-]?\w+)?$", part, re.I):
            return None
        for kind, pattern in cls.FACE_PATTERNS:
            if pattern.match(part):
                # Keep the original spelling: the manual expression picker
                # compares against it, and the labels should read like the asset.
                return {"kind": kind, "name": part}
        return None

    def add_meshes(self, materials: dict[int, int]) -> None:
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
            self.add_skinned_renderer(renderer, transform, kind, self.renderer_material(renderer, materials))

    @staticmethod
    def include_generic_renderer(name: str) -> bool:
        lowered = name.lower()
        if any(marker in lowered for marker in ("damage", "abnormal", "flash", "blur")):
            return False
        # Unity exports several camera-facing variants.  L30 is the front-facing
        # layer used by the viewer; keeping all variants causes duplicated limbs
        # and face layers in the bind pose.
        direction = re.search(r"(?:^|_)(?:l|r)?(30|60)(?:_|$)", lowered)
        return direction is None or direction.group(1) == "30"

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
                name = renderer.m_GameObject.read().m_Name
                if transform is not None and self.include_generic_renderer(name):
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
        face_part = self.face_part(renderer.m_GameObject.read().m_Name)
        if face_part:
            node["extras"]["facePart"] = face_part

    def load_clips(self, bundle_name: str) -> dict[str, dict[str, Any]]:
        return self.load_clips_from_path(self.animation_dir / bundle_name)

    @staticmethod
    def load_clips_from_path(bundle: Path) -> dict[str, dict[str, Any]]:
        environment = UnityPy.load(str(bundle))
        result = {}
        for item in environment.objects:
            if item.type.name == "AnimationClip":
                tree = item.read_typetree()
                result[tree["m_Name"].split("@", 1)[-1]] = tree
        return result

    @staticmethod
    def load_clips_by_rig(bundle: Path) -> dict[str, dict[str, dict[str, Any]]]:
        """{"body"|"head": {clip name: clip}} for a bundle holding both rigs.

        The skill bundles ship the body and head clips together and name them
        owner_body@skill / owner_head@skill, so keying on the part after the "@"
        the way load_clips_from_path does makes the two collide and one silently
        replaces the other.  The rig is in the part before it.
        """
        result: dict[str, dict[str, dict[str, Any]]] = {"body": {}, "head": {}}
        environment = UnityPy.load(str(bundle))
        for item in environment.objects:
            if item.type.name != "AnimationClip":
                continue
            tree = item.read_typetree()
            owner, _, action = tree["m_Name"].partition("@")
            lowered = owner.lower()
            if lowered.endswith("head"):
                rig = "head"
            elif lowered.endswith("body"):
                rig = "body"
            else:
                # The unique-skill bundles also carry the effect scene's own clip
                # (UniqueSkill@Take 001), which drives the particles and the
                # camera rather than the character. It targets US_effect_set/*,
                # nothing the model has, so it is skipped rather than exported.
                continue
            result[rig][action or tree["m_Name"]] = tree
        return result

    def add_bundle_animations(self, bundles: dict[str, Path]) -> list[str]:
        """Publish one clip per {exported name: bundle}, body and head together."""
        published = []
        for name, bundle in bundles.items():
            if not bundle.is_file():
                continue
            clips = self.load_clips_by_rig(bundle)
            animation = {"name": name, "samplers": [], "channels": []}
            for rig in ("body", "head"):
                for clip in clips[rig].values():
                    self.add_clip_channels(animation, clip, rig)
            if animation["channels"]:
                self.builder.document["animations"].append(animation)
                published.append(name)
        return published

    def add_class_animations(self) -> None:
        if not self.class_animation_bundle or not self.class_animation_bundle.is_file():
            return
        body_clips = self.load_clips_from_path(self.class_animation_bundle)
        head_clips = (
            self.load_clips_from_path(self.class_head_animation_bundle)
            if self.class_head_animation_bundle and self.class_head_animation_bundle.is_file()
            else {}
        )
        for action in self.CLASS_ACTIONS:
            body_clip = body_clips.get(action)
            if not body_clip:
                continue
            animation = {"name": action, "samplers": [], "channels": []}
            self.add_clip_channels(animation, body_clip, "body")
            head_clip = head_clips.get(action)
            if head_clip:
                self.add_clip_channels(animation, head_clip, "head")
            if animation["channels"]:
                self.builder.document["animations"].append(animation)

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

    def add_generic_animations(self) -> None:
        match = re.search(r"model_en_(\d+)\.muast$", self.model_bundle.name, re.IGNORECASE)
        if not match:
            return
        identifier = match.group(1)
        bundle = self.animation_dir / f"common_en_{identifier}.muast"
        if bundle.is_file():
            clips = self.load_clips(bundle.name)
            for clip_name, clip in clips.items():
                animation = {"name": clip_name, "samplers": [], "channels": []}
                self.add_clip_channels(animation, clip, "generic")
                if animation["channels"]:
                    self.builder.document["animations"].append(animation)
        # 465 of the 604 enemies are rank/recolour variants with no anim bundle of
        # their own (10001..10005 sit off 10000), and the viewer already borrows
        # their *clips* from the base model at runtime (enemyBaseActionSource).  The
        # visibility tracks address nodes by name and 361 of 451 variants have a node
        # set identical to their base, 49 a subset, and the remaining 41 differ only
        # by an authoring typo (era_L_obj against ear_L_obj), so the base's tracks
        # apply unchanged -- add_generic_visibility keeps only names this GLB has, so
        # a name the variant lacks is simply not switched.
        source = bundle if bundle.is_file() else self.enemy_base_animation_bundle(identifier)
        if source is None:
            donor = ENEMY_VISIBILITY_DONORS.get(identifier)
            if donor:
                candidate = self.animation_dir / donor
                source = candidate if candidate.is_file() else None
        if source is not None:
            self.add_generic_visibility(source)

    def enemy_base_animation_bundle(self, identifier: str) -> Path | None:
        """The same-family base bundle, matching models.js enemyBaseActionSource."""
        if len(identifier) <= 2:
            return None
        base = identifier[:-2] + "00"
        if base == identifier:
            return None
        candidate = self.animation_dir / f"common_en_{base}.muast"
        if candidate.is_file():
            return candidate
        donor = ENEMY_VISIBILITY_DONORS.get(base)
        if donor:
            candidate = self.animation_dir / donor
            if candidate.is_file():
                return candidate
        return None

    # Enemy bundles ship every mesh with m_IsActive true and carry no clips of
    # their own, so a straight export puts every alternate shell on screen at
    # once.  model_en_6000 draws five complete pose sets simultaneously -- five
    # arms out of one shoulder, three weapons across the torso -- and en_14405
    # stacks arm_L_1 on arm_L_2.
    #
    # The switch is in the anim bundle this method already opened for the
    # transform curves: MeigeAnimClip.m_AnimNodeHandlerArray, target type 9, the
    # same GameObject-visibility track build_visibility_table.py publishes for
    # players.  en_6000's idle clip carries a track for all 120 mesh nodes and
    # holds pose1_shoulder_ribon_L_obj at 0 from frame 0 to frame 64.
    #
    # This is worth insisting on because the alternative was guessing from names,
    # and a census over all 604 enemies showed names cannot decide it: the tokens
    # that mark a variant (`slash1`, `flip`, `copy`, `eye_angry`) are shaped
    # exactly like the tokens that mark a real part (`body_back`, `nose_ring`,
    # `tail_tip`, `chest_line`), and the numbered suffix is ambiguous in both
    # directions -- en_14405's arm_L_1/arm_L_2 are stacked alternates 0.001 of a
    # diagonal apart, while en_13703's kazehear_2..6 are five separate wind-hair
    # strands spread over 0.264.  Geometry cannot separate a 3-layer shoulder pad
    # from 3 alternate shoulder pads either.  The clip can, because it is what the
    # game itself plays.
    #
    # glTF has no node-visibility channel, so the tracks ride in the animation's
    # own extras: {node name: 0 | 1 | [[frame, value], ...]}.  A constant curve
    # collapses to one number, which is the common case.  Stepped keys
    # (m_CtrlType 2) hold the last value, so the viewer must not interpolate.
    def add_generic_visibility(self, bundle: Path) -> None:
        tracks = self.load_visibility_tracks(bundle)
        if not tracks:
            return
        # Mesh-bearing nodes only.  Restricting to these keeps a bone that happens
        # to share a mesh's name out of the table, and the viewer only ever applies
        # the table to meshes anyway.
        known = {str(node.get("name") or "")
                 for node in self.builder.document.get("nodes", [])
                 if "mesh" in node}
        published: dict[str, dict[str, Any]] = {}
        for clip_name, clip in tracks.items():
            # Only nodes this GLB actually has: the clip also addresses effect
            # objects (EN_flash, blur_1) the export drops, and a borrowed base
            # bundle names parts the variant renamed (ear_L_obj against era_L_obj).
            kept = {name: value for name, value in clip.items() if name in known}
            if kept:
                published[clip_name] = kept
        if not published:
            return
        # The table goes on asset.extras, keyed by clip name, rather than on each
        # animation's extras.  The 465 variant enemies carry no animations of their
        # own -- they borrow the base model's clips at runtime -- so per-animation
        # extras would have nothing to attach to and the variant would get no table
        # at all.  Keyed by clip name it works either way, because a borrowed clip
        # keeps the donor's name.
        asset_extras = self.builder.document["asset"].setdefault("extras", {})
        asset_extras["visibility"] = {
            "source": ("MeigeAnimClip.m_AnimNodeHandlerArray target type 9; "
                       "value 1 = visible, keys are stepped, hold the last key"),
            "bundle": bundle.name,
            "clips": published,
        }

    @staticmethod
    def load_visibility_tracks(bundle: Path) -> dict[str, dict[str, Any]]:
        """{exported clip name: {node: 0 | 1 | [[frame, value], ...]}}."""
        environment = UnityPy.load(str(bundle))
        clips: dict[str, dict[str, Any]] = {}
        for item in environment.objects:
            if item.type.name != "MonoBehaviour":
                continue
            try:
                tree = item.read_typetree()
            except Exception:
                continue
            meige = tree.get("m_MeigeAnimClip")
            if not isinstance(meige, dict):
                continue
            handlers = meige.get("m_AnimNodeHandlerArray") or []
            tracks: dict[str, Any] = {}
            for handler in handlers:
                target = handler.get("m_Target") or {}
                if target.get("m_TargetType") != TARGET_TYPE_VISIBILITY:
                    continue
                name = str(target.get("m_TargetName") or "")
                if not name:
                    continue
                keys: list[list[float]] = []
                for curve in handler.get("m_Curves") or []:
                    for component in curve.get("m_ComponentCurves") or []:
                        for key in component.get("m_KeyDatas") or []:
                            keys.append([
                                round(float(key["m_Frame"]), 3),
                                1 if float(key["m_Value"]) >= 0.5 else 0,
                            ])
                if not keys:
                    continue
                keys.sort(key=lambda item: item[0])
                values = {value for _, value in keys}
                tracks[name] = keys[0][1] if len(values) == 1 else keys
            if not tracks:
                continue
            clip_name = str(meige.get("m_Name") or "")
            exported = clip_name.split("@", 1)[-1] if "@" in clip_name else clip_name
            clips.setdefault(exported, {}).update(tracks)
        return clips

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
                # A curve that never moves needs one key, not one per frame. The
                # skill clips are mostly this: 124 of owner_body@skill's 143
                # translation curves hold still while the rig rotates, and each
                # one was costing three CUBICSPLINE values per frame for nothing.
                # Interpolation is irrelevant to a single key, so it is written as
                # LINEAR rather than relying on how a reader treats a lone
                # CUBICSPLINE key.
                values = {tuple(key["value"].values()) for key in keys}
                if len(values) == 1:
                    convert = (curve_quat if width == 4
                               else curve_vec3 if target_path == "translation"
                               else lambda value: [float(value[k]) for k in ("x", "y", "z")])
                    single = (convert(keys[0]["value"], True) if width == 4
                              else convert(keys[0]["value"]))
                    input_accessor = self.builder.add_accessor(
                        np.asarray([keys[0]["time"]], dtype=np.float32),
                        COMPONENT_FLOAT, "SCALAR", include_bounds=True)
                    output_accessor = self.builder.add_accessor(
                        np.asarray([single], dtype=np.float32), COMPONENT_FLOAT, f"VEC{width}")
                    animation["samplers"].append({"input": input_accessor,
                                                  "output": output_accessor,
                                                  "interpolation": "LINEAR"})
                    animation["channels"].append(
                        {"sampler": len(animation["samplers"]) - 1,
                         "target": {"node": node, "path": target_path}})
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
            # Player renderers reference distinct body/head/outline materials.
            # Using the source material map preserves the opaque outline atlas
            # used by hands and shoes instead of forcing every renderer through
            # the body alpha atlas.
            if not self.animation_only:
                materials = self.add_generic_materials()
                self.add_meshes(materials)
            if self.include_common_animations:
                self.add_animations()
            self.add_class_animations()
            self.published_bundle_animations = self.add_bundle_animations(self.extra_animation_bundles)
        else:
            materials = self.add_generic_materials()
            self.add_generic_meshes(materials)
            self.add_generic_animations()
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
    parser.add_argument("--class-animation-bundle", type=Path)
    parser.add_argument("--class-head-animation-bundle", type=Path)
    parser.add_argument("--class-actions-only", action="store_true")
    parser.add_argument("--animation-only", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    exporter = KirafanExporter(
        args.model_bundle,
        args.animation_dir,
        args.class_animation_bundle,
        args.class_head_animation_bundle,
        not args.class_actions_only,
        args.animation_only,
    )
    exporter.export(args.output)


if __name__ == "__main__":
    main()
