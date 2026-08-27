"""Assert every model shows exactly one eye/brow/mouth layer and no overlays.

Usage: python tools/check_faces.py model_pl_150200 model_pl_360001 ...
"""
import sys
import time

from playwright.sync_api import sync_playwright

PROBE = """() => {
  const root = window.__modelDebug;
  if (!root) return {error: 'no model root'};
  const counts = {eye: [], eyebrow: [], mouth: [], overlay: []};
  root.traverse(node => {
    const part = node.userData && node.userData.facePart;
    if (part && node.visible) counts[part.kind].push(part.name);
  });
  const totals = {};
  root.traverse(node => {
    const part = node.userData && node.userData.facePart;
    if (part) totals[part.kind] = (totals[part.kind] || 0) + 1;
  });
  return {visible: counts, totals: totals};
}"""


def folder_for(name: str) -> str:
    if name.startswith("model_en_"):
        return "enemy"
    if name.startswith("wpn_"):
        return "weapon"
    return "player"


def main(names: list[str]) -> int:
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--enable-unsafe-swiftshader"])
        for name in names:
            page = browser.new_page(viewport={"width": 1100, "height": 900})
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(
                f"http://localhost:8642/models.html?debug=1#model/{folder_for(name)}/{name}.muast",
                wait_until="load",
                timeout=60000,
            )
            try:
                page.wait_for_selector("canvas", timeout=40000)
                time.sleep(12)
                result = page.evaluate(PROBE)
            except Exception as error:  # noqa: BLE001 - report and continue
                result = {"error": str(error)}
            page.close()

            if "error" in result:
                print(f"FAIL {name}: {result['error']}")
                failures += 1
                continue
            visible = result["visible"]
            totals = result["totals"]
            problems = []
            for kind in ("eye", "eyebrow", "mouth"):
                if totals.get(kind) and len(visible[kind]) != 1:
                    problems.append(f"{kind}={len(visible[kind])} of {totals.get(kind)}")
            if visible["overlay"]:
                problems.append("overlay=" + ",".join(visible["overlay"]))
            if errors:
                problems.append("pageerror=" + errors[0][:60])
            status = "FAIL" if problems else "ok  "
            if problems:
                failures += 1
            detail = "; ".join(problems) if problems else ",".join(
                visible["eye"] + visible["eyebrow"] + visible["mouth"]
            )
            print(f"{status} {name:<18} {detail}")
        browser.close()
    print(f"\n{len(names) - failures}/{len(names)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
