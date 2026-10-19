"""SOURCE stage (local AI): image -> raw mesh with Hunyuan3D-2 shape generation, on the P100.

Runs in the project venv (not Blender):

    source tools/env.sh
    python assets/pipeline/ai_shapegen.py [id ...]      # default: every prop in content/props/ai_props.json

Writes assets/source/ai/<asset_id>.glb (raw, untextured,
gitignored) plus <asset_id>_cutout.png (the background-removed input). Colour comes later from the
reference image + palette (stylize.py), so only shape is generated here.

Needs tools/ai/src/Hunyuan3D-2 (Tencent Hunyuan non-commercial licence; fine for this project).
fp16 + PyTorch SDPA attention only: the P100 has no bf16 / flash-attention.
"""
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "ai" / "src" / "Hunyuan3D-2"))
OUT = REPO / "assets" / "source" / "ai"
SPECS = REPO / "content" / "props" / "ai_props.json"
IMAGES = REPO / "Gen Images"

import torch  # noqa: E402
from PIL import Image  # noqa: E402

from hy3dgen.rembg import BackgroundRemover  # noqa: E402
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline  # noqa: E402
from hy3dgen.shapegen.postprocessors import DegenerateFaceRemover, FloaterRemover  # noqa: E402

MODEL = "tencent/Hunyuan3D-2"
SUBFOLDER = "hunyuan3d-dit-v2-0"


def cutout(path, rembg):
    img = Image.open(path).convert("RGB")
    return rembg(img)  # RGBA, background alpha = 0


def main(pairs):
    OUT.mkdir(parents=True, exist_ok=True)
    rembg = BackgroundRemover()
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        MODEL, subfolder=SUBFOLDER, variant="fp16", dtype=torch.float16, device="cuda"
    )
    for image_path, asset_id in pairs:
        t = time.time()
        img = cutout(image_path, rembg)
        img.save(OUT / f"{asset_id}_cutout.png")
        mesh = pipe(
            image=img,
            num_inference_steps=50,
            octree_resolution=384,
            generator=torch.manual_seed(1234),
        )[0]
        mesh = FloaterRemover()(mesh)
        mesh = DegenerateFaceRemover()(mesh)
        mesh.export(OUT / f"{asset_id}.glb")
        print(f"{asset_id}: {len(mesh.faces)} faces, {time.time() - t:.0f}s, "
              f"peak VRAM {torch.cuda.max_memory_allocated() / 2**30:.1f} GB", flush=True)


if __name__ == "__main__":
    want = set(sys.argv[1:])
    props = json.loads(SPECS.read_text())["props"]
    main([(IMAGES / p["image"], p["id"]) for p in props if not want or p["id"] in want])
