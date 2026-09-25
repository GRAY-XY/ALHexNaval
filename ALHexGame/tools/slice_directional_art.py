import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "terrain" / "source-sheets"
OUTPUT_DIR = ROOT / "assets" / "terrain" / "directional"
DIRECTIONS = ("east", "southeast", "southwest", "west", "northwest", "northeast")
SHEETS = {
    "harbor": SOURCE_DIR / "watercolor-harbor-six-source.png",
    "mountain": SOURCE_DIR / "watercolor-mountain-six-source.png",
    "coast": SOURCE_DIR / "watercolor-coast-six-source.png",
}


def centered_subject(tile: Image.Image) -> Image.Image:
    mask = tile.getchannel("A").point(lambda alpha: 255 if alpha > 32 else 0)
    pixels = mask.load()
    seen = bytearray(mask.width * mask.height)
    components: list[tuple[int, tuple[int, int, int, int]]] = []
    for y in range(mask.height):
        for x in range(mask.width):
            offset = y * mask.width + x
            if not pixels[x, y] or seen[offset]:
                continue
            seen[offset] = 1
            pending = [(x, y)]
            count = 0
            left = right = x
            top = bottom = y
            while pending:
                px, py = pending.pop()
                count += 1
                left, right = min(left, px), max(right, px)
                top, bottom = min(top, py), max(bottom, py)
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if nx < 0 or ny < 0 or nx >= mask.width or ny >= mask.height:
                        continue
                    neighbor = ny * mask.width + nx
                    if pixels[nx, ny] and not seen[neighbor]:
                        seen[neighbor] = 1
                        pending.append((nx, ny))
            components.append((count, (left, top, right + 1, bottom + 1)))
    box = max(components, default=(0, None), key=lambda component: component[0])[1]
    if box is None:
        raise ValueError("directional source cell is empty")
    left, top, right, bottom = box
    margin = 28
    left, top = max(0, left - margin), max(0, top - margin)
    right, bottom = min(tile.width, right + margin), min(tile.height, bottom + margin)
    subject = tile.crop((left, top, right, bottom))
    scale = min(1.0, 496 / subject.width, 496 / subject.height)
    if scale < 1:
        subject = subject.resize((round(subject.width * scale), round(subject.height * scale)), Image.Resampling.LANCZOS)
    output = Image.new("RGBA", tile.size)
    output.alpha_composite(subject, ((tile.width - subject.width) // 2, (tile.height - subject.height) // 2))
    return output


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for kind, source in SHEETS.items():
        image = Image.open(source).convert("RGBA")
        if image.size != (1536, 1024):
            raise ValueError(f"{source.name}: expected 1536x1024, got {image.size}")
        for index, direction in enumerate(DIRECTIONS):
            col, row = index % 3, index // 3
            tile = image.crop((col * 512, row * 512, (col + 1) * 512, (row + 1) * 512))
            tile = centered_subject(tile)
            tile.save(OUTPUT_DIR / f"watercolor-{kind}-{index}-{direction}.png", optimize=True)
    contact = Image.new("RGBA", (1120, 610), "#173b4aff")
    draw = ImageDraw.Draw(contact)
    for index, direction in enumerate(DIRECTIONS):
        draw.text((130 + index * 160, 14), direction.upper(), fill="#f5e8c8ff", anchor="ma")
    for row, kind in enumerate(("harbor", "mountain", "coast")):
        y = 48 + row * 184
        draw.text((12, y + 78), kind.upper(), fill="#f5e8c8ff", anchor="lm")
        for index, direction in enumerate(DIRECTIONS):
            tile = Image.open(OUTPUT_DIR / f"watercolor-{kind}-{index}-{direction}.png").convert("RGBA").resize((152, 152), Image.Resampling.LANCZOS)
            contact.alpha_composite(tile, (54 + index * 176, y))
    contact_path = ROOT / "output" / "screenshots" / "directional-art-contact.png"
    contact_path.parent.mkdir(parents=True, exist_ok=True)
    contact.save(contact_path, optimize=True)
    def record(path: Path) -> dict[str, object]:
        with Image.open(path) as image:
            width, height = image.size
        return {
            "path": path.relative_to(ROOT).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "width": width,
            "height": height,
        }
    variants = []
    for kind in SHEETS:
        for index, direction in enumerate(DIRECTIONS):
            variants.append({"kind": kind, "index": index, "direction": direction, **record(OUTPUT_DIR / f"watercolor-{kind}-{index}-{direction}.png")})
    manifest = {
        "version": 1,
        "generatedAt": "2026-09-19",
        "generator": "OpenAI built-in image generation",
        "styleReference": "output/art-concepts/watercolor-maritime-fullscreen-v1.png",
        "promptRecord": "data/directional-art-prompts.md",
        "directionOrder": list(DIRECTIONS),
        "sourceSheets": [{"kind": kind, **record(path)} for kind, path in SHEETS.items()],
        "variants": variants,
    }
    (ROOT / "data" / "directional-art.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(SHEETS) * len(DIRECTIONS)} directional watercolor assets to {OUTPUT_DIR}")
    print(f"wrote contact sheet to {contact_path}")
    print(f"wrote manifest to {ROOT / 'data' / 'directional-art.json'}")


if __name__ == "__main__":
    main()
