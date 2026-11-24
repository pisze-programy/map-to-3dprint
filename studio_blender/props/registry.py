"""Declarative composable scale-prop registry, spec parser, and edge-relative placer."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .cad_props import CAD_PROP_BUILDERS
from .cc0_props import build_cc0_prop, build_custom_prop


@dataclass(frozen=True)
class PropPlacement:
    """Declarative scale-prop placement relative to outer frame edges or world origin.

    anchor options:
      - "back_left":   (-outer_w/2 + x_mm, +outer_h/2 + y_mm)
      - "back_right":  (+outer_w/2 + x_mm, +outer_h/2 + y_mm)
      - "left":        (-outer_w/2 + x_mm, y_mm)
      - "right":       (+outer_w/2 + x_mm, y_mm)
      - "front_left":  (-outer_w/2 + x_mm, -outer_h/2 + y_mm)
      - "front_right": (+outer_w/2 + x_mm, -outer_h/2 + y_mm)
      - "back":        (x_mm, +outer_h/2 + y_mm)
      - "absolute":    (x_mm, y_mm) directly in world millimeters
    """

    prop_id: str
    x_mm: float = 0.0
    y_mm: float = 0.0
    yaw_deg: float = 0.0
    scale: float = 1.0
    anchor: str = "back_right"
    custom_path: Optional[str] = None


PROP_CATALOG: Dict[str, Dict[str, Any]] = {
    "espresso_cup": {
        "kind": "cad",
        "size_mm": "114 x 114 x 58",
        "description": "Porcelain espresso demitasse cup with hazelnut crema and matching saucer",
        "default_anchor": "back_right",
        "default_offset_mm": (78.0, 48.0),
    },
    "coffee_mug": {
        "kind": "cad",
        "size_mm": "78 x 102 x 86",
        "description": "Minimalist matte stoneware architect coffee mug",
        "default_anchor": "back_right",
        "default_offset_mm": (82.0, 52.0),
    },
    "glass_tumbler": {
        "kind": "cad",
        "size_mm": "76 x 76 x 96",
        "description": "Thin-walled tapered clear optical tumbler half-filled with water",
        "default_anchor": "back_right",
        "default_offset_mm": (76.0, 62.0),
    },
    "crystal_glass": {
        "kind": "cad",
        "size_mm": "78 x 78 x 88",
        "description": "Heavy-base faceted cut-crystal lowball glass with warm amber spirit",
        "default_anchor": "back_right",
        "default_offset_mm": (76.0, 54.0),
    },
    "arch_book": {
        "kind": "cad",
        "size_mm": "185 x 235 x 25",
        "description": "Woven-linen hardcover architectural monograph with cream stacked pages",
        "default_anchor": "back_left",
        "default_offset_mm": (-122.0, 42.0),
    },
    "monograph_stack": {
        "kind": "cad",
        "size_mm": "195 x 245 x 45",
        "description": "Two stacked linen-bound architectural coffee-table monographs",
        "default_anchor": "back_left",
        "default_offset_mm": (-128.0, 42.0),
    },
    "leather_notebook": {
        "kind": "cad",
        "size_mm": "145 x 210 x 17",
        "description": "Stitched espresso-cognac leather architect journal with elastic band",
        "default_anchor": "left",
        "default_offset_mm": (-124.0, -6.0),
    },
    "ceramic_vessel": {
        "kind": "cc0",
        "asset_id": "ceramic_vase_01",
        "target_height_m": 0.160,
        "size_mm": "82 x 82 x 160",
        "description": "Sculptural CC0 photogrammetry matte oatmeal stoneware ceramic vessel",
        "default_anchor": "back_left",
        "default_offset_mm": (-76.0, 72.0),
    },
    "ceramic_vessel_low": {
        "kind": "cc0",
        "asset_id": "ceramic_vase_02",
        "target_height_m": 0.115,
        "size_mm": "82 x 82 x 115",
        "description": "Sculptural CC0 bulbous bisque stoneware vessel",
        "default_anchor": "back_left",
        "default_offset_mm": (-126.0, 54.0),
    },
    "ceramic_vessel_tall": {
        "kind": "cc0",
        "asset_id": "ceramic_vase_03",
        "target_height_m": 0.195,
        "size_mm": "54 x 54 x 195",
        "description": "Tall slender CC0 stoneware architectural bottle vase",
        "default_anchor": "back_left",
        "default_offset_mm": (-86.0, 74.0),
    },
    "potted_plant": {
        "kind": "cc0",
        "asset_id": "potted_plant_04",
        "target_height_m": 0.225,
        "size_mm": "142 x 156 x 225",
        "description": "Real CC0 photogrammetry tabletop ceramic potted greenery",
        "default_anchor": "back_left",
        "default_offset_mm": (-78.0, 108.0),
    },
    "potted_plant_tall": {
        "kind": "cc0",
        "asset_id": "potted_plant_02",
        "target_height_m": 0.360,
        "size_mm": "290 x 280 x 360",
        "description": "Real CC0 photogrammetry sculptural architectural corner plant",
        "default_anchor": "back_right",
        "default_offset_mm": (155.0, 145.0),
    },
    "wooden_bowl": {
        "kind": "cc0",
        "asset_id": "wooden_bowl_01",
        "target_height_m": 0.048,
        "size_mm": "158 x 156 x 48",
        "description": "Turned natural timber CC0 catch-all architectural bowl",
        "default_anchor": "back_right",
        "default_offset_mm": (108.0, 68.0),
    },
    "laptop_corner": {
        "kind": "cad",
        "size_mm": "312 x 221 x 225",
        "description": "CNC anodized silver 14-inch aluminum laptop positioned for corner scale cue",
        "default_anchor": "back_left",
        "default_offset_mm": (-168.0, 128.0),
    },
    "desk_mat_laptop": {
        "kind": "cad",
        "size_mm": "460 x 285 x 228",
        "description": "Beveled charcoal wool-felt desk pad with straight-aligned 14-inch aluminum laptop",
        "default_anchor": "back_left",
        "default_offset_mm": (-195.0, 86.0),
    },
    "smartphone": {
        "kind": "cad",
        "size_mm": "71.5 x 147.6 x 7.8",
        "description": "Matte-black anodized smartphone resting flat as optional scale anchor",
        "default_anchor": "right",
        "default_offset_mm": (64.0, -8.0),
    },
    "architect_pen": {
        "kind": "cad",
        "size_mm": "140 x 10 x 10",
        "description": "Machined matte-black anodized architectural drafting pen with steel clip",
        "default_anchor": "right",
        "default_offset_mm": (46.0, -22.0),
    },
    "steel_ruler": {
        "kind": "cad",
        "size_mm": "180 x 18 x 15",
        "description": "Optional 180 mm triangular brushed stainless-steel architectural scale ruler",
        "default_anchor": "right",
        "default_offset_mm": (62.0, 10.0),
    },
    "desk_lamp_edge": {
        "kind": "cc0",
        "asset_id": "desk_lamp_arm_01",
        "target_height_m": 0.29,
        "size_mm": "110 x 195 x 290",
        "description": "Dieter-Rams matte-black and brass architectural desk lamp with warm bulb",
        "default_anchor": "back_left",
        "default_offset_mm": (-42.0, 124.0),
    },
}


def list_available_props() -> Dict[str, Dict[str, Any]]:
    """Return metadata dictionary of all built-in scale props for CLI and MCP discovery."""
    out: Dict[str, Dict[str, Any]] = {}
    for pid, meta in PROP_CATALOG.items():
        out[pid] = {
            "id": pid,
            "kind": meta["kind"],
            "size_mm": meta["size_mm"],
            "description": meta["description"],
        }
    return out


def parse_prop_spec(spec_str: str) -> PropPlacement:
    """Parse CLI/MCP --add-prop spec into a PropPlacement.

    Supported formats:
      - "espresso_cup" -> uses catalog default anchor and offset
      - "espresso_cup@110,60" -> absolute world (x_mm, y_mm)
      - "espresso_cup@110,60,25,1.0" -> absolute (x_mm, y_mm, yaw_deg, scale)
      - "/abs/path/item.glb@-120,75,15,1.0" -> custom external 3D file
    """
    raw = str(spec_str).strip()
    if "@" in raw:
        head, tail = raw.split("@", 1)
        head = head.strip()
        parts = [p.strip() for p in tail.split(",") if p.strip()]
        x_mm = float(parts[0]) if len(parts) >= 1 else 100.0
        y_mm = float(parts[1]) if len(parts) >= 2 else 60.0
        yaw_deg = float(parts[2]) if len(parts) >= 3 else 0.0
        scale = float(parts[3]) if len(parts) >= 4 else 1.0
        anchor = "absolute"
    else:
        head = raw
        meta = PROP_CATALOG.get(head)
        if meta is not None:
            x_mm, y_mm = meta["default_offset_mm"]
            anchor = str(meta["default_anchor"])
        else:
            x_mm, y_mm = (120.0, 80.0)
            anchor = "back_right"
        yaw_deg = 0.0
        scale = 1.0

    if head in PROP_CATALOG:
        return PropPlacement(prop_id=head, x_mm=x_mm, y_mm=y_mm, yaw_deg=yaw_deg, scale=scale, anchor=anchor)

    p = Path(head).expanduser()
    pid = p.stem[:24] if p.stem else "custom_prop"
    return PropPlacement(
        prop_id=pid,
        x_mm=x_mm,
        y_mm=y_mm,
        yaw_deg=yaw_deg,
        scale=scale,
        anchor=anchor,
        custom_path=str(p),
    )


def resolve_prop_placements(
    default_props: Sequence[PropPlacement],
    add_props: Optional[Sequence[Any]] = None,
    remove_props: Optional[Sequence[str]] = None,
    clear_props: bool = False,
) -> List[PropPlacement]:
    """Merge environment default props with CLI/MCP clear, remove, and add overrides."""
    remove_set = {str(r).strip().lower() for r in (remove_props or []) if str(r).strip()}
    items: List[PropPlacement] = []
    if not clear_props:
        for prop in default_props:
            if prop.prop_id.lower() not in remove_set:
                items.append(prop)

    for entry in (add_props or []):
        if isinstance(entry, PropPlacement):
            items.append(entry)
        elif isinstance(entry, dict):
            items.append(
                PropPlacement(
                    prop_id=str(entry.get("prop_id", "custom_prop")),
                    x_mm=float(entry.get("x_mm", 0.0)),
                    y_mm=float(entry.get("y_mm", 0.0)),
                    yaw_deg=float(entry.get("yaw_deg", 0.0)),
                    scale=float(entry.get("scale", 1.0)),
                    anchor=str(entry.get("anchor", "absolute")),
                    custom_path=entry.get("custom_path"),
                )
            )
        elif isinstance(entry, str) and entry.strip():
            items.append(parse_prop_spec(entry))
    return items


def _resolve_world_xy(prop: PropPlacement, outer_w_m: float, outer_h_m: float) -> Tuple[float, float]:
    hx = outer_w_m * 0.5
    hy = outer_h_m * 0.5
    ox = prop.x_mm * 0.001
    oy = prop.y_mm * 0.001
    anc = (prop.anchor or "absolute").lower()

    if anc == "back_left":
        return (-hx + ox, hy + oy)
    if anc == "back_right":
        return (hx + ox, hy + oy)
    if anc == "left":
        return (-hx + ox, oy)
    if anc == "right":
        return (hx + ox, oy)
    if anc == "front_left":
        return (-hx + ox, -hy + oy)
    if anc == "front_right":
        return (hx + ox, -hy + oy)
    if anc == "back":
        return (ox, hy + oy)
    return (ox, oy)


def place_props(
    placements: Sequence[PropPlacement],
    collection: Any,
    outer_width_m: float,
    outer_height_m: float,
    surface_z: float,
) -> Tuple[List[Any], List[Dict[str, Any]]]:
    """Instantiate and ground all resolved props cleanly onto surface_z."""
    all_objs: List[Any] = []
    placed_meta: List[Dict[str, Any]] = []

    for prop in placements:
        wx, wy = _resolve_world_xy(prop, outer_width_m, outer_height_m)
        loc = (wx, wy, surface_z)
        objs: List[Any] = []

        if prop.custom_path:
            objs = build_custom_prop(
                filepath=prop.custom_path,
                collection=collection,
                location=loc,
                yaw_deg=prop.yaw_deg,
                scale=prop.scale,
            )
        elif prop.prop_id in CAD_PROP_BUILDERS:
            objs = CAD_PROP_BUILDERS[prop.prop_id](collection, loc, prop.yaw_deg, prop.scale)
        elif prop.prop_id in PROP_CATALOG and PROP_CATALOG[prop.prop_id]["kind"] == "cc0":
            meta = PROP_CATALOG[prop.prop_id]
            objs = build_cc0_prop(
                prop_id=prop.prop_id,
                asset_id=str(meta["asset_id"]),
                target_height_m=float(meta["target_height_m"]),
                collection=collection,
                location=loc,
                yaw_deg=prop.yaw_deg,
                scale=prop.scale,
            )

        if objs:
            all_objs.extend(objs)
            placed_meta.append(
                {
                    "prop_id": prop.prop_id,
                    "x_m": round(wx, 4),
                    "y_m": round(wy, 4),
                    "z_m": round(surface_z, 4),
                    "yaw_deg": prop.yaw_deg,
                    "scale": prop.scale,
                    "anchor": prop.anchor,
                }
            )

    return all_objs, placed_meta
