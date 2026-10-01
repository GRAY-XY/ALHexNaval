"""Remove the flat magenta chroma key from campaign landmark source art."""

from __future__ import annotations

from pathlib import Path
from statistics import median

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = (
    ("wwii-airfield-key.png", "assets/terrain/landmarks/wwii-airfield.png"),
    ("wwii-seaplane-station-key.png", "assets/terrain/landmarks/wwii-seaplane-station.png"),
    ("wwii-naval-yard-key.png", "assets/terrain/landmarks/wwii-naval-yard.png"),
    ("wwii-field-headquarters-key.png", "assets/terrain/landmarks/wwii-field-headquarters.png"),
)


def key_color(image: Image.Image) -> tuple[float, float, float]:
    pixels = image.load()
    points = []
    for x in range(image.width):
        points.extend((pixels[x, 0], pixels[x, image.height - 1]))
    for y in range(1, image.height - 1):
        points.extend((pixels[0, y], pixels[image.width - 1, y]))
    keyed = [pixel[:3] for pixel in points if pixel[0] > 180 and pixel[2] > 180 and pixel[1] < 90]
    if not keyed:
        raise ValueError("Could not find the magenta key color on the image border")
    return tuple(median(pixel[channel] for pixel in keyed) for channel in range(3))


def remove_key(source: Path, target: Path) -> None:
    image = Image.open(source).convert("RGB")
    key = key_color(image)
    key_signal = (key[0] + key[2]) / 2 - key[1]
    foreground_signal = -15.0
    pixels = image.load()
    output = Image.new("RGBA", image.size)
    result = output.load()

    for y in range(image.height):
        for x in range(image.width):
            red, green, blue = pixels[x, y]
            signal = (red + blue) / 2 - green
            key_like = (
                signal > 18
                and red - green > 24
                and blue - green > 24
                and abs(red - blue) < 115
                and (red + blue) / 2 > 110
            )
            alpha = 1.0
            if key_like:
                alpha = max(0.0, min(1.0, (key_signal - signal) / (key_signal - foreground_signal)))

            if alpha < 0.015:
                result[x, y] = (0, 0, 0, 0)
                continue

            # Remove the magenta mixed into anti-aliased edge pixels before scaling.
            inv_alpha = 1 / alpha
            clean = tuple(
                max(0, min(255, round((channel - (1 - alpha) * key[channel_index]) * inv_alpha)))
                for channel_index, channel in enumerate((red, green, blue))
            )
            result[x, y] = (*clean, round(alpha * 255))

    target.parent.mkdir(parents=True, exist_ok=True)
    output.save(target, optimize=True)
    print(f"{source.relative_to(ROOT)} -> {target.relative_to(ROOT)} ({image.width}x{image.height})")


if __name__ == "__main__":
    for source_name, target_name in ASSETS:
        remove_key(
            ROOT / "data" / "landmark-art-source" / source_name,
            ROOT / target_name,
        )
