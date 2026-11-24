"""CAD & CC0 props for Lawyer (14) and Executive Study (17) personas."""

from __future__ import annotations

import math
from typing import Any, List, Tuple

from mathutils import Euler, Vector

from .. import assets_cc0, materials
from ..envs.common import (
    Vec3,
    add_bevel,
    create_area_light,
    create_mesh_object,
    make_box_bm,
    make_lathe_bm,
    parent_objects_to_empty,
)
from ..materials_core import get_or_create_material
from ..materials_personas import make_leather_spine_material, make_polished_gold_material
from .spine_text import add_spine_label


def build_law_volumes_row(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Five standing classic dark-leather law volumes with brushed-gold bands (ZERO text)."""
    mat_gold = make_polished_gold_material("LawBookSpineGoldBand")
    mat_pages = materials.make_book_pages_material("LawBookPages")
    palette = (
        ("LawVolEspresso", (0.075, 0.036, 0.020)),
        ("LawVolOxblood", (0.120, 0.024, 0.020)),
        ("LawVolCharcoal", (0.042, 0.040, 0.042)),
        ("LawVolMahogany", (0.105, 0.046, 0.024)),
        ("LawVolObsidian", (0.035, 0.036, 0.044)),
    )
    vols = (
        (0.036, 0.232, 0.168, 0, "CODEX\nI"),
        (0.039, 0.242, 0.172, 1, "CODEX\nII"),
        (0.035, 0.236, 0.168, 2, "CODEX\nIII"),
        (0.040, 0.244, 0.172, 3, "LEX\nCIVIS"),
        (0.037, 0.234, 0.168, 4, "CODEX\nIV"),
    )
    total_w = sum(v[0] + 0.002 for v in vols)
    cur_x = -total_w * 0.5
    objs: List[Any] = []

    for idx, (thick, height, depth, pidx, title) in enumerate(vols):
        cx = cur_x + thick * 0.5
        cur_x += thick + 0.002
        m_name, tint = palette[pidx]
        mat_cov = make_leather_spine_material(m_name, tint)

        body = create_mesh_object(f"Prop_LawVol_{idx}", make_box_bm(thick, depth, height, (cx, 0.0, height * 0.5)), collection, mat_cov, False)
        add_bevel(body, width=0.0024, segments=3)
        pages = create_mesh_object(f"Prop_LawVolPages_{idx}", make_box_bm(thick - 0.006, depth - 0.006, height - 0.008, (cx, 0.003, height * 0.5)), collection, mat_pages, False)
        objs.extend([body, pages])

        for bz_frac in (0.16, 0.20, 0.78, 0.82):
            band = create_mesh_object(
                f"Prop_LawVolBand_{idx}_{int(bz_frac * 100)}",
                make_box_bm(thick + 0.0012, 0.0045, 0.0036, (cx, -depth * 0.5 - 0.0005, height * bz_frac)),
                collection, mat_gold, False,
            )
            add_bevel(band, width=0.0006, segments=2)
            objs.append(band)

        # Crisp subtle 18k gold-foil classical Roman volume title centered between bands
        objs.append(
            add_spine_label(
                f"Prop_LawVolTitle_{idx}",
                title,
                collection,
                location=(cx, -depth * 0.5 - 0.0009, height * 0.62),
                facing="-Y",
                font_size_m=0.0080,
                font_style="serif",
                foil="gold",
                letter_spacing=1.10,
            )
        )

    root = parent_objects_to_empty("Prop_law_volumes_row_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_leather_desk_folio(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Thick executive stitched espresso-leather legal desk folio with brass corner trim (zero text)."""
    mat_leather = materials.make_surface_material("stitched_espresso_leather", name="LawyerDeskFolioLeather")
    mat_pages = materials.make_book_pages_material("LawyerDeskFolioPages")
    mat_brass = make_polished_gold_material("LawyerFolioBrassTrim")

    bw, bd, bh = 0.175, 0.238, 0.024
    bt = 0.0034
    bot = create_mesh_object("Prop_FolioBot", make_box_bm(bw, bd, bt, (0.0, 0.0, bt * 0.5)), collection, mat_leather, False)
    top = create_mesh_object("Prop_FolioTop", make_box_bm(bw, bd, bt, (0.0, 0.0, bh - bt * 0.5)), collection, mat_leather, False)
    spine = create_mesh_object("Prop_FolioSpine", make_box_bm(bt * 2.0, bd, bh, (-bw * 0.5 + bt * 0.8, 0.0, bh * 0.5)), collection, mat_leather, True)
    for part in (bot, top, spine):
        add_bevel(part, width=0.0016, segments=3)

    pages = create_mesh_object("Prop_FolioPages", make_box_bm(bw - 0.008, bd - 0.008, bh - 2.0 * bt, (0.002, 0.0, bh * 0.5)), collection, mat_pages, False)
    c1 = create_mesh_object("Prop_FolioCorner1", make_box_bm(0.016, 0.016, 0.0044, (bw * 0.5 - 0.006, -bd * 0.5 + 0.006, bh - bt * 0.4)), collection, mat_brass, False)
    c2 = create_mesh_object("Prop_FolioCorner2", make_box_bm(0.016, 0.016, 0.0044, (bw * 0.5 - 0.006, bd * 0.5 - 0.006, bh - bt * 0.4)), collection, mat_brass, False)
    add_bevel(c1, width=0.0005, segments=2)
    add_bevel(c2, width=0.0005, segments=2)

    objs = [bot, top, spine, pages, c1, c2]
    root = parent_objects_to_empty("Prop_leather_desk_folio_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_gold_fountain_pen(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Sleek jet-black lacquer and 18k gold executive fountain pen (144 mm x 12 mm)."""
    mat_lacq = materials.make_dark_screen_glass_material("ExecFountainLacquer")
    mat_gold = make_polished_gold_material("ExecFountainGold")

    rad = 0.0060
    rot_flat = (0.0, math.pi * 0.5, 0.0)
    body_prof = [
        (0.0036, -0.052), (0.0052, -0.036), (0.0060, -0.012),
        (0.0060, 0.048), (0.0052, 0.064), (0.0034, 0.072),
    ]
    barrel = create_mesh_object("Prop_FountainBarrel", make_lathe_bm(body_prof, 32, True, True), collection, mat_lacq, True, (0.0, 0.0, rad), rot_flat)
    nib_prof = [(0.0004, -0.072), (0.0019, -0.064), (0.0032, -0.056), (0.0038, -0.050)]
    nib = create_mesh_object("Prop_FountainNib", make_lathe_bm(nib_prof, 24, True, True), collection, mat_gold, True, (0.0, 0.0, rad), rot_flat)
    ring_a = create_mesh_object("Prop_FountainRingA", make_lathe_bm([(0.0062, -0.015), (0.0062, -0.010)], 32, True, True), collection, mat_gold, True, (0.0, 0.0, rad), rot_flat)
    ring_b = create_mesh_object("Prop_FountainRingB", make_lathe_bm([(0.0061, -0.007), (0.0061, -0.004)], 32, True, True), collection, mat_gold, True, (0.0, 0.0, rad), rot_flat)
    clip = create_mesh_object("Prop_FountainClip", make_box_bm(0.044, 0.0028, 0.0018, (0.032, 0.0, rad * 2.0 + 0.0012)), collection, mat_gold, False)
    add_bevel(clip, width=0.0004, segments=2)

    objs = [barrel, nib, ring_a, ring_b, clip]
    root = parent_objects_to_empty("Prop_gold_fountain_pen_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def build_brass_dome_lamp(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Mid-century spun brushed-brass dome desk lamp casting a warm 2600K pool of light."""
    mat_brass = materials.make_brass_metal_material("ExecBrassDomeMetal")
    mat_bulb, nt, _, out = get_or_create_material("ExecBrassDomeBulb2600K")
    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (180, 0)
    em.inputs["Color"].default_value = (1.0, 0.72, 0.36, 1.0)
    em.inputs["Strength"].default_value = 18.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])

    base_prof = [
        (0.062, 0.000), (0.062, 0.010), (0.058, 0.014),
        (0.020, 0.016), (0.013, 0.026), (0.0070, 0.034),
        (0.0064, 0.210), (0.011, 0.214), (0.011, 0.226),
    ]
    base = create_mesh_object("Prop_BrassDomeBase", make_lathe_bm(base_prof, 56, True, True), collection, mat_brass, True)

    dome_r, dome_z0 = 0.094, 0.172
    dome_prof: List[Tuple[float, float]] = [
        (max(0.005, dome_r * math.cos(i / 17.0 * math.pi * 0.5)), dome_z0 + dome_r * 0.96 * math.sin(i / 17.0 * math.pi * 0.5))
        for i in range(18)
    ]
    dome_prof.extend([(0.016, dome_z0 + dome_r * 0.97), (0.016, dome_z0 + dome_r * 1.03), (0.004, dome_z0 + dome_r * 1.05)])
    dome_prof.extend(
        (max(0.004, (dome_r - 0.003) * math.cos(i / 17.0 * math.pi * 0.5)), dome_z0 + (dome_r - 0.003) * 0.95 * math.sin(i / 17.0 * math.pi * 0.5))
        for i in range(17, -1, -1)
    )
    shade = create_mesh_object("Prop_BrassDomeShade", make_lathe_bm(dome_prof, 64, False, True), collection, mat_brass, True)

    bulb_prof = [(0.001, dome_z0 + 0.012), (0.022, dome_z0 + 0.020), (0.026, dome_z0 + 0.036), (0.016, dome_z0 + 0.056), (0.001, dome_z0 + 0.060)]
    bulb = create_mesh_object("Prop_BrassDomeBulb", make_lathe_bm(bulb_prof, 28, True, True), collection, mat_bulb, True)

    pool = create_area_light(
        name="Light_BrassDomePool", collection=collection,
        location=(0.0, 0.0, dome_z0 + 0.006), target=(-0.10, -0.06, 0.0),
        energy=4.2, color=(1.0, 0.74, 0.42), size_x=0.14, size_y=0.14, spread_deg=95.0, visible_camera=False,
    )
    objs = [base, shade, bulb, pool]
    root = parent_objects_to_empty("Prop_brass_dome_lamp_Root", objs, collection, location, yaw_deg, scale)
    return [root] + objs


def _make_museum_picture_glass(name: str = "ExecArtFrameMuseumGlass") -> Any:
    """Anti-reflective thin museum picture glass (zero black occlusion of artwork)."""
    mat, nt, _, out = get_or_create_material(name)
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    transp.location = (60, 120)
    transp.inputs["Color"].default_value = (0.99, 0.99, 0.99, 1.0)
    glossy = nt.nodes.new("ShaderNodeBsdfGlossy")
    glossy.location = (60, -80)
    glossy.inputs["Color"].default_value = (1.0, 0.99, 0.97, 1.0)
    glossy.inputs["Roughness"].default_value = 0.04
    mix_sh = nt.nodes.new("ShaderNodeMixShader")
    mix_sh.location = (320, 40)
    mix_sh.inputs["Fac"].default_value = 0.07
    nt.links.new(transp.outputs["BSDF"], mix_sh.inputs[1])
    nt.links.new(glossy.outputs["BSDF"], mix_sh.inputs[2])
    nt.links.new(mix_sh.outputs["Shader"], out.inputs["Surface"])
    return mat


def build_brass_arch_print_frame(
    collection: Any,
    location: Vec3,
    yaw_deg: float = 0.0,
    scale: float = 1.0,
) -> List[Any]:
    """Minimalist brushed-brass tabletop frame displaying real CC0 monochrome architectural print."""
    gltf_path = assets_cc0.ensure_gltf_model("standing_picture_frame_01", resolution="1k")
    if gltf_path is None:
        return []
    root, meshes = assets_cc0.import_external_prop(
        filepath=gltf_path, collection=collection,
        name_prefix="Prop_BrassArchFrame", target_height_m=0.172, scale_factor=scale,
    )
    if root is None:
        return []

    mat_brass = materials.make_brass_metal_material("ExecArtFrameBrass")
    mat_glass = _make_museum_picture_glass("ExecArtFrameMuseumGlass")
    for mobj in meshes:
        if mobj.data is None:
            continue
        for idx, mat in enumerate(mobj.data.materials):
            if mat is None:
                continue
            if "glass" in mat.name.lower():
                mobj.data.materials[idx] = mat_glass
            elif mat.name.startswith("standing_picture_frame_01") and "artwork" not in mat.name.lower():
                mobj.data.materials[idx] = mat_brass

    root.location = Vector(location)
    root.rotation_euler = Euler((0.0, 0.0, math.radians(yaw_deg - 90.0)), "XYZ")
    return [root] + meshes
