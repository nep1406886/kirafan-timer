#!/usr/bin/env python3
"""Build a lazy-loadable GLB catalog from the public KiraFan asset index."""

from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from convert_kirafan_model import KirafanExporter


DATABASE_URL = "https://database.kirafan.cn/assetBundle.json"
ANIMATION_BUNDLES = (
    "anim/player/common_menu_body.muast",
    "anim/player/common_battle_body.muast",
    "anim/player/common_menu_head_0.muast",
    "anim/player/common_battle_head_0.muast",
)
HTTP_HEADERS = {"User-Agent": "kirafan-timer-model-builder/1.0"}


def open_url(url: str, timeout: int = 90):
    return urllib.request.urlopen(urllib.request.Request(url, headers=HTTP_HEADERS), timeout=timeout)


def download(url: str, destination: Path) -> Path:
    if destination.exists() and destination.stat().st_size:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    try:
        response = open_url(url)
    except urllib.error.HTTPError as error:
        if error.code != 404 or "-asset.kirafan.cn/" not in url:
            raise
        path = urllib.parse.urlsplit(url).path.lstrip("/")
        response = open_url(f"https://asset.kirafan.cn/{path}")
    with response, temporary.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)
    temporary.replace(destination)
    return destination


def asset_url(entry: dict[str, Any]) -> str:
    bucket = str(entry["path"])[-1]
    return f"https://bucket-{bucket}-asset.kirafan.cn/{entry['name']}"


def gzip_model(output: Path) -> Path:
    compressed = output.with_suffix(output.suffix + ".gz")
    temporary = compressed.with_suffix(compressed.suffix + ".part")
    with output.open("rb") as source, temporary.open("wb") as destination:
        with gzip.GzipFile(fileobj=destination, mode="wb", compresslevel=9, mtime=0) as archive:
            shutil.copyfileobj(source, archive, 1024 * 1024)
    temporary.replace(compressed)
    output.unlink()
    return compressed


def optimize_model(output: Path, gltfpack: Path) -> None:
    optimized = output.with_name(f"{output.stem}.meshopt{output.suffix}")
    try:
        result = subprocess.run(
            [
                str(gltfpack),
                "-i", str(output),
                "-o", str(optimized),
                "-c",
                "-noq",
                "-af", "0",
                "-ac",
                "-ke",
                "-kn",
                "-km",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()
            raise RuntimeError(f"gltfpack exited with {result.returncode}: {detail}")
        if not optimized.exists() or not optimized.stat().st_size:
            raise RuntimeError("gltfpack did not produce an output file")
        optimized.replace(output)
    finally:
        optimized.unlink(missing_ok=True)


def optimize_published_one(job: dict[str, str]) -> dict[str, Any]:
    compressed = Path(job["compressed_path"])
    output = compressed.with_suffix("")
    try:
        with gzip.open(compressed, "rb") as source, output.open("wb") as destination:
            shutil.copyfileobj(source, destination, 1024 * 1024)
        optimize_model(output, Path(job["gltfpack"]))
        published_output = gzip_model(output)
    except Exception as error:
        output.unlink(missing_ok=True)
        raise RuntimeError(f"{type(error).__name__}: {error}") from None
    return {
        "name": job["name"],
        "file": f"{published_output.relative_to(Path(job['site_root'])).as_posix()}?v={int(published_output.stat().st_mtime)}",
        "bytes": published_output.stat().st_size,
    }


def convert_one(job: dict[str, str]) -> dict[str, Any]:
    try:
        model_path = download(job["url"], Path(job["cache_path"]))
        output = Path(job["output_path"])
        exporter = KirafanExporter(model_path, Path(job["animation_dir"]))
        exporter.export(output)
        if job["gltfpack"]:
            optimize_model(output, Path(job["gltfpack"]))
        published_output = gzip_model(output) if job["storage"] == "gzip" else output
    except Exception as error:
        # HTTPError may retain an open response stream, which cannot cross a
        # ProcessPool boundary on Windows.  Preserve the actionable message.
        raise RuntimeError(f"{type(error).__name__}: {error}") from None
    mode = exporter.mode
    animation_count = len(exporter.builder.document["animations"])
    expression_count = sum(
        1 for node in exporter.builder.document["nodes"]
        if isinstance(node.get("extras"), dict) and node["extras"].get("facePart")
    )
    if mode == "player":
        label = "完整蒙皮 · 5 个游戏动作 · 表情随动作并可细调"
    elif mode == "skinned":
        label = "完整单骨架"
        if animation_count:
            label += f" · {animation_count} 个游戏动作"
        if expression_count:
            label += " · 表情可调"
    else:
        label = "完整静态网格"
    relative_file = published_output.relative_to(Path(job["site_root"])).as_posix()
    preview = {
        "file": f"{relative_file}?v={int(published_output.stat().st_mtime)}",
        "label": label,
        "animations": animation_count > 0,
        "expressions": expression_count > 0,
        "depthWrite": True,
    }
    if job["storage"] == "gzip":
        preview["compression"] = "gzip"
    if job["gltfpack"]:
        preview["meshopt"] = True
    return {
        "name": job["name"],
        "preview": preview,
        "bytes": published_output.stat().st_size,
        "mode": mode,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("all", "player", "enemy", "weapon", "shadow"), default="all")
    parser.add_argument("--match", help="Only convert names containing this text")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of selected models; zero means all")
    parser.add_argument("--workers", type=int, default=max(1, min(4, os.cpu_count() or 1)))
    parser.add_argument("--storage", choices=("gzip", "glb"), default="gzip")
    parser.add_argument("--site-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "kirafan-model-cache")
    parser.add_argument("--gltfpack", type=Path, help="Path to gltfpack; enables lossless Meshopt publishing")
    parser.add_argument(
        "--optimize-existing",
        action="store_true",
        help="Meshopt-compress files already listed in the manifest without reconverting Unity bundles",
    )
    return parser.parse_args()


def optimize_existing_catalog(
    manifest_path: Path,
    site_root: Path,
    gltfpack: Path,
    workers: int,
) -> None:
    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    models = manifest.get("models")
    if not isinstance(models, dict):
        raise SystemExit(f"Manifest has no model map: {manifest_path}")

    jobs = []
    for name, preview in models.items():
        if not isinstance(preview, dict) or preview.get("meshopt"):
            continue
        relative_file = str(preview.get("file", "")).split("?", 1)[0]
        compressed = (site_root / relative_file).resolve()
        try:
            compressed.relative_to(site_root)
        except ValueError:
            raise SystemExit(f"Manifest model path escapes the site root: {relative_file}") from None
        if compressed.is_file() and compressed.name.endswith(".glb.gz"):
            jobs.append(
                {
                    "name": name,
                    "compressed_path": str(compressed),
                    "site_root": str(site_root),
                    "gltfpack": str(gltfpack),
                }
            )

    failures = []
    completed = 0

    def record(job: dict[str, str], result: dict[str, Any] | None, error: Exception | None = None) -> None:
        nonlocal completed
        if error is not None:
            failures.append({"name": job["name"], "error": str(error)})
            print(f"FAILED {job['name']}: {error}")
            return
        assert result is not None
        preview = models[result["name"]]
        preview["file"] = result["file"]
        preview["compression"] = "gzip"
        preview["meshopt"] = True
        completed += 1
        if completed == 1 or completed % 25 == 0 or completed == len(jobs):
            print(f"[{completed}/{len(jobs)}] {result['name']} ({result['bytes']:,} bytes)")

    if workers == 1:
        for job in jobs:
            try:
                record(job, optimize_published_one(job))
            except Exception as error:
                record(job, None, error)
    else:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(optimize_published_one, job): job for job in jobs}
            for future in as_completed(futures):
                job = futures[future]
                try:
                    record(job, future.result())
                except Exception as error:
                    record(job, None, error)

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    failure_path = manifest_path.with_name("meshopt-failures.json")
    if failures:
        failure_path.write_text(json.dumps(failures, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise SystemExit(1)
    failure_path.unlink(missing_ok=True)
    print(f"Manifest: {manifest_path} · optimized {completed} · already optimized {len(models) - len(jobs)}")


def main() -> None:
    args = parse_args()
    site_root = args.site_root.resolve()
    output_dir = (args.output_dir or site_root / "asset" / "models").resolve()
    manifest_path = (args.manifest or output_dir / "manifest.json").resolve()
    gltfpack = args.gltfpack.resolve() if args.gltfpack else None
    if gltfpack and not gltfpack.is_file():
        raise SystemExit(f"gltfpack executable not found: {gltfpack}")
    if args.optimize_existing:
        if not gltfpack:
            raise SystemExit("--optimize-existing requires --gltfpack")
        optimize_existing_catalog(manifest_path, site_root, gltfpack, args.workers)
        return
    with open_url(DATABASE_URL) as response:
        entries = json.load(response)
    by_name = {entry["name"]: entry for entry in entries if isinstance(entry, dict) and "name" in entry}

    prefix = "model/" if args.kind == "all" else f"model/{args.kind}/"
    selected = [entry for entry in entries if str(entry.get("name", "")).startswith(prefix)]
    if args.match:
        selected = [entry for entry in selected if args.match.lower() in entry["name"].lower()]
    selected.sort(key=lambda entry: entry["name"])
    if args.limit:
        selected = selected[: args.limit]
    if not selected:
        raise SystemExit("No matching model bundles")

    animation_dir = args.cache_dir / "animations"
    if any(entry["name"].startswith("model/player/") for entry in selected):
        for name in ANIMATION_BUNDLES:
            entry = by_name.get(name)
            if entry is None:
                raise RuntimeError(f"Animation bundle missing from index: {name}")
            download(asset_url(entry), animation_dir / Path(name).name)
    for entry in selected:
        match = None
        if entry["name"].startswith("model/enemy/model_en_"):
            match = Path(entry["name"]).stem.removeprefix("model_en_")
        if not match:
            continue
        animation_name = f"anim/enemy/common_en_{match}.muast"
        animation_entry = by_name.get(animation_name)
        if animation_entry is not None:
            download(asset_url(animation_entry), animation_dir / Path(animation_name).name)

    jobs = []
    for entry in selected:
        stem = Path(entry["name"]).stem
        jobs.append(
            {
                "name": entry["name"],
                "url": asset_url(entry),
                "cache_path": str(args.cache_dir / "bundles" / Path(entry["name"]).name),
                "animation_dir": str(animation_dir),
                "output_path": str(output_dir / stem / "model.glb"),
                "site_root": str(site_root),
                "storage": args.storage,
                "gltfpack": str(gltfpack) if gltfpack else "",
            }
        )

    manifest: dict[str, Any] = {"version": 2, "models": {}}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.setdefault("models", {})
    manifest["version"] = 2
    failures = []
    completed = []
    def record(job: dict[str, str], result: dict[str, Any] | None, error: Exception | None = None) -> None:
        if error is not None:
            failures.append({"name": job["name"], "error": str(error)})
            print(f"FAILED {job['name']}: {error}")
            return
        assert result is not None
        manifest["models"][result["name"]] = result["preview"]
        completed.append(result)
        print(f"[{len(completed)}/{len(jobs)}] {result['name']} ({result['mode']}, {result['bytes']:,} bytes)")

    if args.workers == 1:
        for job in jobs:
            try:
                record(job, convert_one(job))
            except Exception as error:
                record(job, None, error)
    else:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(convert_one, job): job for job in jobs}
            for future in as_completed(futures):
                job = futures[future]
                try:
                    record(job, future.result())
                except Exception as error:
                    record(job, None, error)

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Manifest: {manifest_path} · completed {len(completed)} · failed {len(failures)}")
    if failures:
        failure_path = manifest_path.with_name("conversion-failures.json")
        failure_path.write_text(json.dumps(failures, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise SystemExit(1)
    manifest_path.with_name("conversion-failures.json").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
