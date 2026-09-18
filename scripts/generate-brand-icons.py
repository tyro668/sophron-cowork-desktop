#!/usr/bin/env python3
"""Export the approved Jiusi mark to every app and web icon format.

Requires Pillow. Run from any directory with:
    python3 scripts/generate-brand-icons.py

The two generated design sources in design/brand are the only editable visual
inputs. Keep all derived icons in sync by running this script after a change.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ICON_SOURCE = ROOT / "design/brand/jiusi-logo-source.png"
TRAY_SOURCE = ROOT / "design/brand/jiusi-tray-mark-source.png"
MINT = (234, 246, 238)
PINE = (23, 110, 77)
APP_ICON_SIZE = 1024
MAC_ICON_SCALE = 0.94
RESAMPLE = Image.Resampling.LANCZOS


def mark_coverage(red: int) -> float:
    # Snap the interior of each shape to a single brand color. Only pixels
    # between the mark and its background retain antialias interpolation.
    return max(0.0, min(1.0, (215 - red) / 165))


def flatten_approved_palette(source: Image.Image) -> Image.Image:
    """Remove ImageGen's sub-pixel color noise without changing its silhouette."""
    source = source.convert("RGBA")
    result = Image.new("RGBA", source.size)
    input_pixels = source.load()
    output_pixels = result.load()
    for y in range(source.height):
        for x in range(source.width):
            red, _green, _blue, alpha = input_pixels[x, y]
            if alpha < 8:
                continue
            # The approved source is a pine mark over a light tile. Retain
            # antialiased edges by interpolating only between those two tones.
            coverage = mark_coverage(red)
            color = tuple(
                round(base * (1 - coverage) + pine * coverage)
                for base, pine in zip(MINT, PINE)
            )
            output_pixels[x, y] = (*color, 255 if alpha >= 250 else alpha)
    return result


def extract_transparent_mark(source: Image.Image) -> Image.Image:
    """Use the same approved silhouette without any baked-in tile color."""
    source = source.convert("RGBA")
    result = Image.new("RGBA", source.size, (*PINE, 0))
    input_pixels = source.load()
    output_pixels = result.load()
    for y in range(source.height):
        for x in range(source.width):
            red, _green, _blue, alpha = input_pixels[x, y]
            if alpha < 128:
                continue
            coverage = mark_coverage(red)
            output_pixels[x, y] = (*PINE, round(alpha * coverage))
    return result


def inset_mac_icon(icon: Image.Image) -> Image.Image:
    """Match the visible Dock size of neighboring macOS app icons."""
    scaled_size = round(APP_ICON_SIZE * MAC_ICON_SCALE)
    inset = (APP_ICON_SIZE - scaled_size) // 2
    canvas = Image.new("RGBA", (APP_ICON_SIZE, APP_ICON_SIZE), (0, 0, 0, 0))
    canvas.paste(icon.resize((scaled_size, scaled_size), RESAMPLE), (inset, inset))
    return canvas


def save_png(image: Image.Image, relative_path: str, size: int) -> None:
    destination = ROOT / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), RESAMPLE).save(destination, format="PNG", optimize=True)


def find_font(bold: bool) -> str:
    candidates = (
        [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "C:/Windows/Fonts/arialbd.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
        if bold
        else [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/Library/Fonts/Arial.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    )
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
    raise FileNotFoundError("Arial or DejaVu Sans is required to export the social preview")


def save_social_preview(icon: Image.Image) -> None:
    # This is a deterministic composition of the approved logo and exact
    # existing website text, not a separate hand-drawn variation of the mark.
    preview = Image.new("RGB", (1280, 640), (248, 253, 250))
    tile = icon.resize((360, 360), RESAMPLE)
    preview.paste(tile, (140, 140), tile)
    draw = ImageDraw.Draw(preview)
    title_font = ImageFont.truetype(find_font(bold=True), 74)
    subtitle_font = ImageFont.truetype(find_font(bold=False), 33)
    draw.text((575, 248), "Metis Cowork", fill=(36, 54, 46), font=title_font)
    draw.text(
        (579, 348), "Local data agent workspace", fill=(82, 103, 93), font=subtitle_font
    )
    preview.save(ROOT / "website/public/og-image.png", format="PNG", optimize=True)


def main() -> None:
    source = Image.open(ICON_SOURCE)
    icon = flatten_approved_palette(source).resize((APP_ICON_SIZE, APP_ICON_SIZE), RESAMPLE)
    ui_mark = extract_transparent_mark(source).resize(
        (APP_ICON_SIZE, APP_ICON_SIZE), RESAMPLE
    )
    mac_icon = inset_mac_icon(icon)
    for path in (
        "resources/icon.png",
        "resources/logo.png",
        "public/logo.png",
        "website/public/logo.png",
    ):
        save_png(icon, path, APP_ICON_SIZE)
    save_png(ui_mark, "src/renderer/assets/logo.png", APP_ICON_SIZE)
    save_png(mac_icon, "resources/icon-mac.png", APP_ICON_SIZE)
    save_png(icon, "public/favicon.png", 32)

    iconset_sizes = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for name, size in iconset_sizes.items():
        save_png(mac_icon, f"resources/icon.iconset/{name}", size)
    mac_icon.save(ROOT / "resources/icon.icns", format="ICNS")
    icon.save(
        ROOT / "resources/icon.ico",
        format="ICO",
        sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)],
    )

    # macOS will tint a Template image to match light/dark menu bars. Windows
    # and Linux use the colored app tile at their notification-area sizes.
    tray_source = Image.open(TRAY_SOURCE).convert("RGBA")
    tray_alpha = tray_source.getchannel("A")
    tray_mark = Image.new("RGBA", tray_source.size, (0, 0, 0, 0))
    tray_mark.putalpha(tray_alpha)
    save_png(tray_mark, "resources/tray-iconTemplate.png", 32)
    save_png(icon, "resources/tray-icon.png", 32)
    icon.save(
        ROOT / "resources/tray-icon.ico",
        format="ICO",
        sizes=[(size, size) for size in (16, 24, 32, 48, 64)],
    )

    save_social_preview(icon)


if __name__ == "__main__":
    main()
