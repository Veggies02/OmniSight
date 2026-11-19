"""Shared pytest fixtures: generated sample screenshots and an evidence factory."""
import struct
import zlib

import pytest

from schemas import EvidenceContext, ViewportConfig

MOBILE_WIDTH = 375
MOBILE_HEIGHT = 812


def _chunk(kind: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)


def make_png_bytes(width, height, rects, background=(255, 255, 255)) -> bytes:
    """Build a valid RGB PNG from filled rectangles, using only the stdlib.

    rects is a list of (x0, y0, x1, y1, (r, g, b)). Rectangles are clipped to
    the canvas, so one can extend past the edge to imitate a clipped control.
    """
    rows = [bytearray(bytes(background) * width) for _ in range(height)]
    for x0, y0, x1, y1, color in rects:
        x0, x1 = max(0, x0), min(width, x1)
        y0, y1 = max(0, y0), min(height, y1)
        if x0 >= x1:
            continue
        segment = bytes(color) * (x1 - x0)
        for y in range(y0, y1):
            rows[y][x0 * 3:x1 * 3] = segment

    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(raw))
        + _chunk(b"IEND", b"")
    )


_HEADER_BAR = (0, 0, MOBILE_WIDTH, 60, (30, 64, 175))

SCREENSHOT_SCENES = {
    # Everything sits inside the viewport.
    "clean": [_HEADER_BAR, (40, 400, 335, 450, (22, 163, 74))],
    # The button runs past the right edge, so it is clipped.
    "clipped_button": [_HEADER_BAR, (260, 400, 420, 450, (22, 163, 74))],
    # Two text blocks drawn on top of each other.
    "overlapping_text": [
        _HEADER_BAR,
        (40, 200, 300, 240, (156, 163, 175)),
        (150, 220, 340, 260, (55, 65, 81)),
    ],
}


@pytest.fixture(scope="session")
def screenshots(tmp_path_factory):
    """Write the sample screenshots once and return {name: path}."""
    folder = tmp_path_factory.mktemp("screenshots")
    paths = {}
    for name, rects in SCREENSHOT_SCENES.items():
        path = folder / f"{name}.png"
        path.write_bytes(make_png_bytes(MOBILE_WIDTH, MOBILE_HEIGHT, rects))
        paths[name] = str(path)
    return paths


@pytest.fixture
def make_evidence(screenshots):
    """Return a factory that builds an EvidenceContext for a named screenshot."""
    def _make(name="clean", **overrides):
        data = {
            "job_id": "scenario-job",
            "screenshot_path": screenshots[name],
            "url": "http://localhost:5174/products",
            "route": "/products",
            "viewport": ViewportConfig(width=MOBILE_WIDTH, height=MOBILE_HEIGHT, is_mobile=True),
        }
        data.update(overrides)
        return EvidenceContext(**data)
    return _make