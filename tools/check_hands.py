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
  const hands = [], arms = [];
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
    if (name.includes('hand')) hands.push(entry);
    else if (name.includes('arm') || name.includes('sleeve')) arms.push(entry);
  });
  return {hands, arms};
}"""


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
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--settle", type=float, default=7.0)
    parser.add_argument("--port", type=int, default=8642)
    args = parser.parse_args()

    names = args.names or models_with_hands()
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
            hidden = [h for h in result["hands"] if not h["inScene"]]
            invisible = [h for h in result["hands"]
                         if h["inScene"] and (h["opacity"] or 1) < 0.05]
            if hidden or invisible:
                failures += 1
                detail = ", ".join(h["name"] for h in hidden + invisible)
                print(f"[{index}/{len(names)}] FAIL {name:<18} "
                      f"{len(hidden)} hidden, {len(invisible)} transparent: {detail}")
            else:
                orders = sorted(h["order"] for h in result["hands"])
                arm_orders = sorted(a["order"] for a in result["arms"])
                print(f"[{index}/{len(names)}] ok   {name:<18} "
                      f"{len(result['hands'])} hand mesh(es) order={orders} "
                      f"arms={arm_orders[:4]}")
        browser.close()
    print(f"\n{len(names) - failures}/{len(names)} render their hands")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
