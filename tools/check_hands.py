"""Find models whose hand geometry exists but does not reach the screen.

"Some hands are not rendered" can mean two very different things: the costume has
no hands modelled (long sleeves ending in a cuff, which is authentic and common --
788 of 1255 player models carry no hand mesh at all), or the hands are in the
bundle and something hides or depth-rejects them.  Only the second is a bug, and
telling them apart needs the live scene, because visibility is decided at load.

For every model carrying a mesh whose name mentions a hand, this reports whether
that mesh survived to visible, what draw order it got, and whether the arm it
belongs to sits in front of it.

Usage:
  python tools/check_hands.py                     # every model with hand geometry
  python tools/check_hands.py --limit 60
  python tools/check_hands.py model_pl_100001
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from audit_models import read_gltf_json  # noqa: E402

PROBE = """() => {
  const root = window.__modelDebug;
  if (!root) return {error: 'no model root'};
  const hands = [], arms = [], all = [];
  root.traverse(node => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const raw = (node.name || '');
    const name = raw.toLowerCase();
    // Skip the duplicate side-facing set and the non-exported head directions:
    // those are meant to be suppressed and would read as false positives.
    if (/^side_/.test(name) || /^(l60|r30|r60)_/.test(name)) return;
    const material = node.material || {};
    const entry = {
      name: raw,
      visible: node.visible,
      // visible is per-node; a hidden ancestor still removes it from the frame.
      inScene: (() => { let n = node; while (n) { if (!n.visible) return false; n = n.parent; } return true; })(),
      order: node.renderOrder,
      opacity: material.opacity,
      transparent: !!material.transparent,
      alphaTest: material.alphaTest,
      depthWrite: !!material.depthWrite
    };
    // "hand" has to sit on a word boundary: weapon_handle_obj is a weapon handle,
    // not a hand, and a substring test counts it as one and then reports it missing.
    if (/(?:^|_)hand(?:_|$)|(?:^|_)finger(?:_|$)/.test(name)) hands.push(entry);
    else if (name.includes('arm') || name.includes('sleeve')) arms.push(entry);
    // Every mesh name, so the caller can prove the viewer mounted the model it
    // asked for rather than falling back to its default one.
    all.push(raw);
  });
  return {hands, arms, all};
}"""


def expected_meshes(name: str) -> set[str]:
    """The mesh names the GLB on disk actually contains, minus the sets the probe skips.

    Used to prove the viewer mounted the requested model.  A name the viewer cannot
    resolve leaves it showing its default startup model, and probing that reports a
    cheerful pass for a model that was never loaded -- which is how a 120-model
    sweep once came back 120/120 with every single entry reporting the same two
    arm meshes.
    """
    path = ROOT / "asset" / "models" / name / "model.glb.gz"
    if not path.is_file():
        return set()
    try:
        document = read_gltf_json(path)
    except Exception:  # noqa: BLE001
        return set()
    skip = re.compile(r"^(?:side|l60|r30|r60)_", re.I)
    return {node["name"] for node in document.get("nodes", [])
            if "mesh" in node and node.get("name") and not skip.match(node["name"])}


def normalise(name: str) -> str:
    """Accept a manifest key, a bundle path or a bare id and return the bare id.

    Manifest keys are bundle paths ("model/player/model_pl_100001.muast"), so a list
    built from them has to be reshaped before it can go into the URL, or the folder
    and suffix get applied twice.
    """
    return Path(name).stem


def folder_for(name: str) -> str:
    if name.startswith("model_en_"):
        return "enemy"
    if name.startswith("wpn_"):
        return "weapon"
    return "player"


def models_with_hands() -> list[str]:
    manifest = json.loads((ROOT / "asset" / "models" / "manifest.json")
                          .read_text(encoding="utf-8"))
    found = []
    for key, preview in manifest["models"].items():
        path = ROOT / str(preview.get("file", "")).split("?", 1)[0]
        if not path.is_file():
            continue
        try:
            document = read_gltf_json(path)
        except Exception:
            continue
        for node in document.get("nodes", []):
            name = (node.get("name") or "").lower()
            if "mesh" in node and "hand" in name and not name.startswith("side_"):
                found.append(Path(key).stem)
                break
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("names", nargs="*")
    parser.add_argument("--from", dest="from_file", type=Path,
                        help="read names from this file, one per line; manifest keys "
                             "and bare ids are both accepted")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--settle", type=float, default=7.0)
    parser.add_argument("--port", type=int, default=8642)
    args = parser.parse_args()

    names = [normalise(name) for name in args.names] or models_with_hands()
    if args.from_file:
        names = [normalise(line.strip())
                 for line in args.from_file.read_text(encoding="utf-8").splitlines()
                 if line.strip() and not line.startswith("#")]
    if args.limit:
        names = names[:args.limit]
    print(f"checking {len(names)} models that carry hand geometry\n")

    failures = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            args=["--enable-unsafe-swiftshader", "--use-gl=swiftshader"])
        for index, name in enumerate(names, 1):
            page = browser.new_page(viewport={"width": 900, "height": 700})
            try:
                page.goto(f"http://localhost:{args.port}/models.html?debug=1"
                          f"#model/{folder_for(name)}/{name}.muast",
                          wait_until="load", timeout=60000)
                page.wait_for_function("() => !!window.__modelDebug", timeout=40000)
                time.sleep(args.settle)
                result = page.evaluate(PROBE)
            except Exception as error:  # noqa: BLE001
                result = {"error": f"{type(error).__name__}: {error}"}
            page.close()

            if "error" in result:
                print(f"[{index}/{len(names)}] FAIL {name}: {result['error']}")
                failures += 1
                continue
            # Prove the right model is on screen before believing anything about it.
            wanted = expected_meshes(name)
            if not wanted:
                # No GLB on disk under this name, so there is nothing to compare
                # against and the viewer is showing its fallback.  Treat it as a
                # failure rather than probing whatever happens to be mounted.
                print(f"[{index}/{len(names)}] FAIL {name:<18} "
                      f"no model.glb.gz on disk for this name")
                failures += 1
                continue
            if wanted:
                got = set(result.get("all") or [])
                # three.js appends a disambiguating "_1" when two nodes would
                # otherwise share a name, so match on the stem rather than exactly:
                # the GLB's WPN_1002200_R arrives in the scene as WPN_1002200_R_1.
                stems = {re.sub(r"_\d+$", "", scene_name) for scene_name in got}
                if not (wanted & got or wanted & stems):
                    print(f"[{index}/{len(names)}] FAIL {name:<18} "
                          f"wrong model mounted: expected meshes like "
                          f"{sorted(wanted)[:2]}, got {sorted(got)[:2]}")
                    failures += 1
                    continue
            # Hands come in alternates just as face layers do -- model_en_13503 ships
            # hand_L_obj and hand_L_2_obj, model_en_13703 adds hand_drumming_L_obj
            # and finger_open_L_obj -- and only one of each set is meant to show.
            # So the test is not "every hand mesh is visible", which fails on every
            # correctly authored model; it is "each side that has hand geometry
            # renders at least one of it".
            def side_of(mesh_name: str) -> str:
                lowered = mesh_name.lower()
                if re.search(r"(?:^|_)l(?:_|$)|_l_", lowered):
                    return "L"
                if re.search(r"(?:^|_)r(?:_|$)|_r_", lowered):
                    return "R"
                return "?"

            by_side: dict[str, list[dict]] = {}
            for entry in result["hands"]:
                by_side.setdefault(side_of(entry["name"]), []).append(entry)
            dark = []
            for side, entries in sorted(by_side.items()):
                lit = [e for e in entries
                       if e["inScene"] and (e["opacity"] if e["opacity"] is not None else 1) >= 0.05]
                if not lit:
                    dark.append(f"{side}({', '.join(e['name'] for e in entries)})")
            if dark:
                failures += 1
                print(f"[{index}/{len(names)}] FAIL {name:<18} "
                      f"no visible hand on side(s): {'; '.join(dark)}")
            else:
                shown = sum(1 for h in result["hands"] if h["inScene"])
                sides = "".join(sorted(s for s in by_side if s != "?"))
                print(f"[{index}/{len(names)}] ok   {name:<18} "
                      f"{shown}/{len(result['hands'])} hand mesh(es) visible"
                      f"{f' sides={sides}' if sides else ''}")
        browser.close()
    print(f"\n{len(names) - failures}/{len(names)} render their hands")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
