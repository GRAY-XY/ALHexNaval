from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/terrain/source-sheets/watercolor-land-decoration-six-source.png"
OUTPUT = ROOT / "assets/terrain/land-details"
NAMES = [
    "dense-forest",
    "sparse-grove",
    "rocky-grassland",
    "meadow-trail",
    "forest-boulders",
    "woodland-thicket",
]


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    if image.size != (1536, 1024):
        raise SystemExit(f"unexpected source size: {image.size}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(NAMES):
        col, row = index % 3, index // 3
        tile = image.crop((col * 512, row * 512, (col + 1) * 512, (row + 1) * 512))
        alpha = tile.getchannel("A").point(lambda value: 0 if value < 10 else value)
        tile.putalpha(alpha)
        tile.save(OUTPUT / f"watercolor-land-detail-{index}-{name}.png", optimize=True)
    print(f"wrote {len(NAMES)} land-detail sprites to {OUTPUT}")


if __name__ == "__main__":
    main()
