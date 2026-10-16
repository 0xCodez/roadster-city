"""
Tesla Roadster "RDSTR" (Thrust) — procedural Blender model.

Run:
  blender --background --factory-startup --python build_roadster.py -- --out <dir> [--render] [--samples 128] [--pct 100] [--cams Rear34,RearClose,Side]

Builds the car from named objects (body, glass, wheels, light bar, diffuser,
thrusters, active wing), saves roadster_rdstr.blend into <dir> and, with
--render, writes PNG previews into <dir>/renders.

Axes: +X = forward, +Y = car's left, +Z = up. 1 unit = 1 m.
Active aero: frame 1 = wing stowed, frame 48 = wing deployed.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Matrix, Vector

# ----------------------------------------------------------------------------
# args
# ----------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


OUT_DIR = os.path.abspath(arg("--out", os.path.dirname(os.path.abspath(__file__))))
DO_RENDER = "--render" in argv
SAMPLES = int(arg("--samples", "128"))
RES_PCT = int(arg("--pct", "100"))
CAMS = arg("--cams", "Rear34,RearClose,Side,Front34,FrontClose").split(",")

FRAME_STOWED, FRAME_DEPLOYED = 1, 48

# ----------------------------------------------------------------------------
# scene reset
# ----------------------------------------------------------------------------
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for coll in list(bpy.data.collections):
    bpy.data.collections.remove(coll)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
              bpy.data.lights, bpy.data.curves):
    for item in list(block):
        block.remove(item)

scene = bpy.context.scene
scene.unit_settings.system = "METRIC"


def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


COL_BODY = collection("Body")
COL_GLASS = collection("Glass")
COL_LIGHTS = collection("Lights_Car")
COL_REAR = collection("Rear_Diffuser_Thrusters")
COL_AERO = collection("Active_Aero_Wing")
COL_WHEELS = collection("Wheels")
COL_STAGE = collection("Stage")
COL_CUTTERS = bpy.data.collections.new("Cutters")  # not linked to scene

# ----------------------------------------------------------------------------
# materials
# ----------------------------------------------------------------------------


def principled(mat):
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        out.location = (300, 0)
        nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return nt, bsdf


def set_in(bsdf, name, value):
    if name in bsdf.inputs:
        bsdf.inputs[name].default_value = value


def make_mat(name, base, rough=0.5, metal=0.0, coat=0.0, coat_rough=0.05,
             emit=None, strength=0.0, spec=0.5):
    m = bpy.data.materials.new(name)
    nt, b = principled(m)
    set_in(b, "Base Color", (*base, 1.0))
    set_in(b, "Roughness", rough)
    set_in(b, "Metallic", metal)
    set_in(b, "Coat Weight", coat)
    set_in(b, "Coat Roughness", coat_rough)
    set_in(b, "Specular IOR Level", spec)
    if emit:
        set_in(b, "Emission Color", (*emit, 1.0))
        set_in(b, "Emission Strength", strength)
    m.diffuse_color = (*base, 1.0) if not emit else (*emit, 1.0)
    m.roughness = rough
    m.metallic = metal
    return m


MAT = {}
MAT["paint"] = make_mat("Paint_MatteWhite", (0.62, 0.63, 0.64), rough=0.38, coat=0.15, coat_rough=0.25)
MAT["glass"] = make_mat("Glass_Tinted", (0.009, 0.007, 0.005), rough=0.04, coat=0.4, coat_rough=0.02, spec=0.5)
MAT["black_gloss"] = make_mat("Trim_GlossBlack", (0.008, 0.008, 0.009), rough=0.12, coat=0.6)
MAT["light_red"] = make_mat("Light_Red_Emissive", (0.25, 0.0, 0.0), rough=0.3,
                             emit=(1.0, 0.015, 0.01), strength=28.0)
MAT["light_red_dim"] = make_mat("Thruster_RedGlow", (0.2, 0.0, 0.0), rough=0.3,
                                 emit=(1.0, 0.04, 0.02), strength=6.0)
MAT["light_white"] = make_mat("Light_White_Emissive", (0.8, 0.8, 0.8), rough=0.3,
                               emit=(0.85, 0.92, 1.0), strength=45.0)
MAT["light_amber"] = make_mat("Light_Amber_Emissive", (0.3, 0.12, 0.0), rough=0.3,
                               emit=(1.0, 0.42, 0.05), strength=12.0)
MAT["thruster"] = make_mat("Thruster_Metal", (0.78, 0.56, 0.40), rough=0.22, metal=1.0)
MAT["thruster_dark"] = make_mat("Thruster_Inner_Dark", (0.03, 0.025, 0.02), rough=0.4, metal=1.0)
MAT["tire"] = make_mat("Tire_Rubber", (0.018, 0.018, 0.018), rough=0.85, spec=0.3)
MAT["rim_dark"] = make_mat("Rim_DarkChrome", (0.22, 0.22, 0.23), rough=0.12, metal=1.0)
MAT["rim_disc"] = make_mat("Rim_AeroDisc_Silver", (0.72, 0.73, 0.75), rough=0.32, metal=0.85)
MAT["brake"] = make_mat("Brake_Disc", (0.35, 0.35, 0.36), rough=0.45, metal=1.0)
MAT["plate"] = make_mat("Plate_White", (0.85, 0.86, 0.87), rough=0.35)
MAT["plate_text"] = make_mat("Plate_Text", (0.35, 0.36, 0.38), rough=0.4)
MAT["floor"] = make_mat("Stage_Floor", (0.018, 0.018, 0.02), rough=0.32)


def make_carbon():
    m = bpy.data.materials.new("Carbon_Fiber")
    nt, b = principled(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    chk = nt.nodes.new("ShaderNodeTexChecker")
    chk.inputs["Scale"].default_value = 160.0
    chk.inputs["Color1"].default_value = (0.003, 0.003, 0.0035, 1)
    chk.inputs["Color2"].default_value = (0.011, 0.011, 0.012, 1)
    rmap = nt.nodes.new("ShaderNodeMapRange")
    rmap.inputs["To Min"].default_value = 0.55
    rmap.inputs["To Max"].default_value = 0.38
    nt.links.new(tc.outputs["Object"], chk.inputs["Vector"])
    nt.links.new(chk.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(chk.outputs["Fac"], rmap.inputs["Value"])
    nt.links.new(rmap.outputs["Result"], b.inputs["Roughness"])
    set_in(b, "Specular IOR Level", 0.25)
    set_in(b, "Coat Weight", 0.2)
    set_in(b, "Coat Roughness", 0.12)
    m.diffuse_color = (0.02, 0.02, 0.022, 1)
    return m


MAT["carbon"] = make_carbon()

# ----------------------------------------------------------------------------
# mesh helpers
# ----------------------------------------------------------------------------


def link(ob, coll):
    coll.objects.link(ob)
    return ob


def mesh_object(name, verts, faces, coll, mats=(), mat_idx=None, smooth=False,
                recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    if recalc:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    for m in mats:
        me.materials.append(m)
    if mat_idx is not None:
        for p, i in zip(me.polygons, mat_idx):
            p.material_index = i
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    return ob


def box(name, center, size, coll, mat, bevel=0.0, seg=2):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    v = [(cx + x * sx, cy + y * sy, cz + z * sz)
         for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    ob = mesh_object(name, v, f, coll, [mat])
    if bevel > 0:
        add_bevel(ob, bevel, seg, angle=None)
    return ob


def extrude_xz(name, poly, y0, y1, coll, mats, top_bottom_split=False):
    """Polygon in XZ plane extruded along Y from y0 to y1."""
    n = len(poly)
    verts = [(x, y0, z) for x, z in poly] + [(x, y1, z) for x, z in poly]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return mesh_object(name, verts, faces, coll, mats)


def extrude_xy(name, poly, z0, z1, coll, mats):
    n = len(poly)
    verts = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return mesh_object(name, verts, faces, coll, mats)


def extrude_yz(name, poly, x0, x1, coll, mats):
    n = len(poly)
    verts = [(x0, y, z) for y, z in poly] + [(x1, y, z) for y, z in poly]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return mesh_object(name, verts, faces, coll, mats)


def lathe(name, profile, coll, mats, segs=64, closed=True, mat_idx_fn=None,
          smooth=True):
    """Revolve (r, a) profile around local Y axis: point = (r cos t, a, r sin t)."""
    n = len(profile)
    verts = []
    for s in range(segs):
        t = 2 * math.pi * s / segs
        c, si = math.cos(t), math.sin(t)
        for r, a in profile:
            verts.append((r * c, a, r * si))
    faces, idx = [], []
    last = n if closed else n - 1
    for s in range(segs):
        s2 = (s + 1) % segs
        for i in range(last):
            j = (i + 1) % n
            faces.append((s * n + i, s * n + j, s2 * n + j, s2 * n + i))
            idx.append(mat_idx_fn(i) if mat_idx_fn else 0)
    return mesh_object(name, verts, faces, coll, mats, mat_idx=idx, smooth=smooth,
                       recalc=closed)


def polyline_tube(name, pts, r, coll, mat):
    """Square-section tube along a list of Vector points."""
    pts = [Vector(p) for p in pts]
    pts = [p for i, p in enumerate(pts) if i == 0 or (p - pts[i - 1]).length > 1e-5]
    verts, faces = [], []
    n = len(pts)
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        a = t.cross(up).normalized()
        b = t.cross(a).normalized()
        for u, v in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            verts.append(p + a * (u * r) + b * (v * r))
    for i in range(n - 1):
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append((i * 4 + k, i * 4 + k2, (i + 1) * 4 + k2, (i + 1) * 4 + k))
    faces += [(0, 1, 2, 3), tuple((n - 1) * 4 + k for k in (3, 2, 1, 0))]
    return mesh_object(name, verts, faces, coll, [mat])


def add_bevel(ob, width, seg=2, angle=30.0, harden=True):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = seg
    if angle is None:
        m.limit_method = "NONE"
    else:
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(angle)
    m.harden_normals = harden
    try:
        m.clamp_overlap = True
    except Exception:
        pass
    return m


def add_subsurf(ob, levels=1, render=2):
    m = ob.modifiers.new("Subdivision", "SUBSURF")
    m.levels = levels
    m.render_levels = render
    return m


def mark_sharp(ob, angle_deg):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(angle_deg))
    except Exception:
        bm = bmesh.new()
        bm.from_mesh(me)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle(0.0) < math.radians(angle_deg)
            else:
                e.smooth = False
        bm.to_mesh(me)
        bm.free()


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    new = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = new
    new.name = old.name
    bpy.data.meshes.remove(old)


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


# ----------------------------------------------------------------------------
# BODY — lofted from cross-sections (monotone cubic interpolation along X)
# ----------------------------------------------------------------------------
# station X (front -> rear) and half-section parameters
# Front end (photos of the nose): a thin sharp lip carrying the light bar, a flat
# trapezoidal hood sunk between two faceted fender crests that start as pointed
# corner tips and rise toward the A-pillars, black fascia receding under the lip.
# In front of the windshield point 2 is the hood edge; behind it, the A-pillar.
KX = [2.27, 2.20, 2.05, 1.75, 1.35, 1.05, 0.90, 0.60, 0.20, -0.20, -0.70, -1.30, -1.75, -2.00, -2.12]
KP = {
    #       lip   2.20  2.05  1.75  1.35  1.05  0.90  0.60  0.20  -0.2  -0.7  -1.3  -1.75 -2.0  -2.12
    "zb": [0.535, 0.16, 0.12, 0.115, 0.11, 0.11, 0.11, 0.10, 0.10, 0.10, 0.10, 0.11, 0.14, 0.20, 0.24],  # floor
    "ws": [0.62, 0.70, 0.76, 0.80, 0.80, 0.82, 0.82, 0.82, 0.82, 0.82, 0.82, 0.82, 0.80, 0.74, 0.70],  # floor half width
    "wl": [0.70, 0.82, 0.90, 0.93, 0.95, 0.94, 0.93, 0.92, 0.92, 0.92, 0.93, 0.97, 0.95, 0.88, 0.84],  # carbon line
    "zl": [0.54, 0.30, 0.26, 0.26, 0.27, 0.26, 0.26, 0.25, 0.25, 0.26, 0.30, 0.42, 0.52, 0.58, 0.60],
    "wm": [0.72, 0.86, 0.93, 0.96, 0.97, 0.955, 0.95, 0.94, 0.94, 0.95, 0.97, 1.00, 0.99, 0.97, 0.96],  # belt (widest)
    "zm": [0.545, 0.50, 0.53, 0.59, 0.64, 0.66, 0.66, 0.66, 0.67, 0.69, 0.73, 0.80, 0.82, 0.83, 0.84],
    "wg": [0.70, 0.84, 0.885, 0.89, 0.87, 0.85, 0.83, 0.82, 0.80, 0.79, 0.81, 0.86, 0.89, 0.91, 0.92],  # fender crest / glass sill
    "zg": [0.555, 0.58, 0.665, 0.775, 0.86, 0.845, 0.82, 0.80, 0.81, 0.83, 0.86, 0.88, 0.88, 0.88, 0.88],
    "wr": [0.45, 0.48, 0.52, 0.58, 0.62, 0.625, 0.645, 0.62, 0.56, 0.56, 0.58, 0.62, 0.66, 0.70, 0.72],  # hood edge / roof edge
    "zr": [0.56, 0.575, 0.60, 0.665, 0.74, 0.745, 0.81, 0.88, 1.00, 1.07, 1.04, 0.97, 0.925, 0.90, 0.89],
    "zt": [0.56, 0.575, 0.60, 0.66, 0.73, 0.745, 0.79, 0.90, 1.06, 1.13, 1.10, 1.01, 0.94, 0.91, 0.90],  # centre line
}
X_WINDSHIELD = 1.045  # hood rear edge / windshield base


class Pchip:
    def __init__(self, xs, ys):
        pts = sorted(zip(xs, ys))
        self.x = [p[0] for p in pts]
        self.y = [p[1] for p in pts]
        n = len(self.x)
        h = [self.x[i + 1] - self.x[i] for i in range(n - 1)]
        d = [(self.y[i + 1] - self.y[i]) / h[i] for i in range(n - 1)]
        m = [0.0] * n
        m[0], m[-1] = d[0], d[-1]
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                m[i] = 0.0
            else:
                w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        self.h, self.m = h, m

    def __call__(self, x):
        xs = self.x
        x = min(max(x, xs[0]), xs[-1])
        i = 0
        while i < len(xs) - 2 and x > xs[i + 1]:
            i += 1
        h = self.h[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * self.y[i] + (t3 - 2 * t2 + t) * h * self.m[i]
                + (-2 * t3 + 3 * t2) * self.y[i + 1] + (t3 - t2) * h * self.m[i + 1])


CURVE = {k: Pchip(KX, v) for k, v in KP.items()}


def half_section(x):
    """9 (y, z) points from roof centre down the left side to the floor centre."""
    p = {k: f(x) for k, f in CURVE.items()}
    crown = (p["wr"] * 0.55, p["zr"] + (p["zt"] - p["zr"]) * 0.78)
    dy, dz = p["wm"] - p["wg"], p["zm"] - p["zg"]
    ln = math.hypot(dy, dz) or 1.0
    mid = ((p["wg"] + p["wm"]) / 2 - dz / ln * 0.012, (p["zg"] + p["zm"]) / 2 + dy / ln * 0.012)
    return [
        (0.0, p["zt"]),          # 0 roof centre
        crown,                   # 1 roof crown
        (p["wr"], p["zr"]),      # 2 roof edge / A-pillar line
        (p["wg"], p["zg"]),      # 3 glass sill / fender top
        mid,                     # 4 upper side
        (p["wm"], p["zm"]),      # 5 belt crease (widest)
        (p["wl"], p["zl"]),      # 6 carbon line
        (p["ws"], p["zb"]),      # 7 floor edge
        (0.0, p["zb"]),          # 8 floor centre
    ]


def surface_point(x, s):
    """Point on the body surface: s = fractional index into half_section;
    negative s = mirrored (right) side."""
    sec = half_section(x)
    side = 1.0 if s >= 0 else -1.0
    s = abs(s)
    i = min(int(math.floor(s)), len(sec) - 2)
    t = s - i
    y = sec[i][0] * (1 - t) + sec[i + 1][0] * t
    z = sec[i][1] * (1 - t) + sec[i + 1][1] * t
    return Vector((x, side * y, z))


def surface_offset_point(x, s, off):
    p = surface_point(x, s)
    e = 1e-3
    du = surface_point(x + e, s) - surface_point(x - e, s)
    dv = surface_point(x, s + e) - surface_point(x, s - e)
    n = du.cross(dv)
    if n.length < 1e-9:
        return p
    n.normalize()
    if n.dot(Vector((0.0, p.y, p.z - 0.5))) < 0:
        n = -n
    return p + n * off


def build_body():
    x_front, x_rear = KX[0], KX[-1]
    # dense stations around the sharp nose, regular spacing elsewhere
    x_dense = 1.95
    xs = [x_front + (x_dense - x_front) * i / 26 for i in range(26)]
    xs += [x_dense + (x_rear - x_dense) * i / 110 for i in range(111)]
    n_st = len(xs)
    verts, faces, midx = [], [], []
    ring_n = 16
    for x in xs:
        sec = half_section(x)
        ring = [(x, y, z) for y, z in sec] + [(x, -y, z) for y, z in reversed(sec[1:8])]
        verts.extend(ring)
    carbon_segments = {6, 7, 8, 9}
    for i in range(n_st - 1):
        for k in range(ring_n):
            k2 = (k + 1) % ring_n
            a, b = i * ring_n + k, i * ring_n + k2
            c, d = (i + 1) * ring_n + k2, (i + 1) * ring_n + k
            faces.append((a, b, c, d))
            midx.append(1 if k in carbon_segments else 0)
    faces.append(tuple(range(ring_n)))                                   # nose cap
    faces.append(tuple((n_st - 1) * ring_n + k for k in range(ring_n)))  # tail panel
    midx += [0, 0]
    ob = mesh_object("Body", verts, faces, COL_BODY, [MAT["paint"], MAT["carbon"]], mat_idx=midx)

    # wheel arches: boolean against cylinders (cut faces take carbon material)
    cutters = []
    # (the front well starts further outboard so it stays under the sunken hood)
    for nm, (wx, wz, r, y_in) in {"Front": (1.35, 0.37, 0.39, 0.68), "Rear": (-1.30, 0.37, 0.405, 0.50)}.items():
        for side in (1, -1):
            prof = [(0.0, y_in), (r, y_in), (r, 1.35), (0.0, 1.35)]
            c = lathe(f"Cutter_Arch_{nm}_{'L' if side > 0 else 'R'}", prof, COL_CUTTERS,
                      [MAT["carbon"]], segs=72, smooth=False)
            c.location = (wx, 0.0, wz)
            if side < 0:
                c.scale = (1, -1, 1)
            cutters.append(c)
    scene.collection.children.link(COL_CUTTERS)
    bpy.context.view_layer.update()
    mod = ob.modifiers.new("WheelArches", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.operand_type = "COLLECTION"
    mod.collection = COL_CUTTERS
    try:
        mod.solver = "EXACT"
    except Exception:
        pass
    try:
        mod.material_mode = "TRANSFER"
    except Exception:
        pass
    apply_modifiers(ob)
    scene.collection.children.unlink(COL_CUTTERS)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    bpy.data.collections.remove(COL_CUTTERS)

    # gloss-black front fascia: forward-facing faces under the lip, between the fenders
    me = ob.data
    me.materials.append(MAT["black_gloss"])
    black = len(me.materials) - 1
    for p in me.polygons:
        if p.center.x > 2.05 and p.normal.x > 0.45 and abs(p.center.y) < 0.74 and p.center.z < 0.552:
            p.material_index = black

    mark_sharp(ob, 14)
    add_bevel(ob, 0.006, seg=2, angle=14)
    return ob


# ----------------------------------------------------------------------------
# GLASS — sampled on the body surface, offset outward
# ----------------------------------------------------------------------------


def surface_patch(name, x0, x1, s_lo_fn, s_hi_fn, coll, mat, nx=60, ns=28, off=0.004):
    verts, faces = [], []
    for i in range(nx):
        x = x0 + (x1 - x0) * i / (nx - 1)
        lo, hi = s_lo_fn(x), s_hi_fn(x)
        for j in range(ns):
            s = lo + (hi - lo) * j / (ns - 1)
            verts.append(surface_offset_point(x, s, off))
    for i in range(nx - 1):
        for j in range(ns - 1):
            a = i * ns + j
            faces.append((a, a + 1, a + ns + 1, a + ns))
    ob = mesh_object(name, verts, faces, coll, [mat], smooth=True, recalc=False)
    # make normals point outward
    me = ob.data
    p = me.polygons[len(me.polygons) // 2]
    c = p.center
    if p.normal.dot(Vector((0, c.y, c.z - 0.5))) < 0:
        me.flip_normals()
    return ob


def lerp(a, b, t):
    return a + (b - a) * max(0.0, min(1.0, t))


def build_glass():
    # windshield + roof glass in one piece, ending in a trapezoid on the rear deck
    def roof_hi(x):
        if x < -1.15:
            return lerp(1.88, 1.30, (-1.15 - x) / 0.55)
        return 1.88

    surface_patch("Glass_Windshield_Roof", X_WINDSHIELD - 0.005, -1.70, lambda x: -roof_hi(x), roof_hi,
                  COL_GLASS, MAT["glass"], nx=120, ns=40, off=0.006)

    # side windows: wedge-shaped DLO ending in a point toward the C-pillar
    def side_lo(x):
        return 2.08

    def side_hi(x):
        if x < -0.45:
            return lerp(2.94, 2.14, (-0.45 - x) / 0.80)
        if x > 0.70:
            return lerp(2.94, 2.20, (x - 0.70) / 0.28)
        return 2.94

    for side, nm in ((1, "L"), (-1, "R")):
        surface_patch(f"Glass_Side_{nm}", 0.98, -1.25,
                      (lambda x, sd=side: sd * side_lo(x)),
                      (lambda x, sd=side: sd * side_hi(x)),
                      COL_GLASS, MAT["glass"], nx=60, ns=12)

    # dark vent panels on the rear quarters, under the tail edge (ref photo 1)
    for side, nm in ((1, "L"), (-1, "R")):
        surface_patch(f"Rear_Quarter_Vent_{nm}", -1.80, -2.10,
                      (lambda x, sd=side: sd * 5.10),
                      (lambda x, sd=side: sd * lerp(5.85, 5.55, (-1.80 - x) / 0.3)),
                      COL_BODY, MAT["black_gloss"], nx=14, ns=8, off=0.003)


# ----------------------------------------------------------------------------
# LIGHTS on the car
# ----------------------------------------------------------------------------
TAIL_X = KX[-1]


def build_car_lights():
    # through-width red light bar under the tail edge, in a black housing
    box("TailLight_Housing", (TAIL_X - 0.008, 0, 0.815), (0.022, 1.98, 0.07), COL_LIGHTS,
        MAT["black_gloss"], bevel=0.003)
    box("TailLight_Bar", (TAIL_X - 0.021, 0, 0.822), (0.008, 1.90, 0.012), COL_LIGHTS,
        MAT["light_red"], bevel=0.002)
    # lower reflector/marker lights behind the rear wheels
    for side, nm in ((1, "L"), (-1, "R")):
        y = side * (CURVE["wl"](-1.78) + 0.004)
        box(f"Rear_Marker_{nm}", (-1.78, y, 0.50), (0.05, 0.01, 0.018), COL_LIGHTS,
            MAT["light_red"], bevel=0.003)
        y = side * (CURVE["wm"](1.92) + 0.002)
        box(f"Front_Marker_{nm}", (1.92, y, 0.565), (0.07, 0.01, 0.014), COL_LIGHTS,
            MAT["light_amber"], bevel=0.003)
    # front light bar: runs along the sharp hood lip, then turns up-and-back along
    # the leading edge of each fender crest (the "<" lamps at the corner tips)
    lip = half_section(KX[0])
    lip_z = max(z for _, z in lip[:4]) + 0.001
    crest_x = [KX[0] - 0.003 - 0.17 * i / 7 for i in range(8)]
    left = [surface_offset_point(x, 3.0, 0.004) for x in reversed(crest_x)]
    right = [surface_offset_point(x, -3.0, 0.004) for x in crest_x]
    w = lip[3][0] - 0.01
    across = [Vector((KX[0] + 0.001, w - 2 * w * i / 30, lip_z - 0.009)) for i in range(31)]
    polyline_tube("Headlight_Bar", left + across + right, 0.006, COL_LIGHTS, MAT["light_white"])
    # frunk-lid panel gaps along both hood edges
    for side, nm in ((1, "L"), (-1, "R")):
        gap = [surface_offset_point(KX[0] - 0.01 - (KX[0] - 0.01 - X_WINDSHIELD - 0.01) * i / 40, side * 2.0, 0.0005)
               for i in range(41)]
        polyline_tube(f"Hood_Gap_{nm}", gap, 0.0022, COL_BODY, MAT["black_gloss"])


# ----------------------------------------------------------------------------
# REAR: plate, carbon lower, diffuser, thrusters
# ----------------------------------------------------------------------------


def build_rear():
    # licence plate "RDSTR"
    box("License_Plate", (TAIL_X - 0.006, 0, 0.655), (0.012, 0.31, 0.15), COL_REAR,
        MAT["plate"], bevel=0.008, seg=3)
    cu = bpy.data.curves.new("Plate_Text", "FONT")
    cu.body = "RDSTR"
    cu.size = 0.078
    cu.extrude = 0.0015
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.space_character = 1.05
    cu.materials.append(MAT["plate_text"])
    txt = bpy.data.objects.new("Plate_Text", cu)
    txt.location = (TAIL_X - 0.0135, 0, 0.652)
    txt.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    link(txt, COL_REAR)
    # plate lamps
    for y in (-0.06, 0.06):
        box(f"Plate_Lamp_{'L' if y > 0 else 'R'}", (TAIL_X - 0.01, y, 0.75), (0.02, 0.025, 0.008),
            COL_REAR, MAT["light_white"])

    # carbon rear lower section (bumper area that holds thrusters)
    poly = [(-0.86, 0.16), (0.86, 0.16), (0.86, 0.50), (0.80, 0.555), (-0.80, 0.555), (-0.86, 0.50)]
    rl = extrude_yz("Rear_Lower_Carbon", poly, -1.90, TAIL_X - 0.012, COL_REAR, [MAT["carbon"]])
    add_bevel(rl, 0.006, seg=2, angle=30)
    # overhanging carbon shelf above the thrusters
    box("Rear_Shelf_Carbon", (TAIL_X - 0.04, 0, 0.51), (0.06, 1.62, 0.022), COL_REAR,
        MAT["carbon"], bevel=0.004)

    # diffuser ramp + vertical fins
    ramp = [(-1.50, 0.105), (-2.17, 0.27), (-2.17, 0.285), (-1.50, 0.12)]
    extrude_xz("Diffuser_Ramp", ramp, -0.72, 0.72, COL_REAR, [MAT["carbon"]])
    fins = []
    for y in (-0.56, -0.34, -0.12, 0.12, 0.34, 0.56):
        prof = [(-1.60, 0.115), (-2.19, 0.105), (-2.19, 0.28), (-1.60, 0.125)]
        fins.append(extrude_xz(f"Diffuser_Fin_{len(fins) + 1}", prof, y - 0.005, y + 0.005,
                               COL_REAR, [MAT["carbon"]]))
    for side, nm in ((1, "L"), (-1, "R")):
        prof = [(-1.80, 0.11), (-2.21, 0.095), (-2.21, 0.27), (-2.15, 0.40), (-1.95, 0.40)]
        y = side * 0.74
        st = extrude_xz(f"Diffuser_Strake_{nm}", prof, y - 0.007, y + 0.007, COL_REAR, [MAT["carbon"]])
        add_bevel(st, 0.003, seg=2, angle=30)

    # four acceleration thrusters
    for i, y in enumerate((0.48, 0.16, -0.16, -0.48)):
        z = 0.405
        tube_prof = [(0.050, 0.0), (0.060, 0.0), (0.060, 0.045), (0.056, 0.055),
                     (0.047, 0.055), (0.045, 0.0)]
        t = lathe(f"Thruster_{i + 1}_Nozzle", tube_prof, COL_REAR,
                  [MAT["thruster"], MAT["light_red_dim"]], segs=48,
                  mat_idx_fn=lambda k: 1 if k == 3 else 0)
        t.location = (TAIL_X - 0.008, y, z)
        t.rotation_euler = (0, 0, math.pi / 2)
        back = lathe(f"Thruster_{i + 1}_Core", [(0.0, 0.02), (0.046, 0.02), (0.046, 0.025), (0.0, 0.025)],
                     COL_REAR, [MAT["thruster_dark"]], segs=48)
        back.location = t.location
        back.rotation_euler = t.rotation_euler
        # heat-ring inside the nozzle
        ring = lathe(f"Thruster_{i + 1}_GlowRing", [(0.040, 0.03), (0.046, 0.03), (0.046, 0.036), (0.040, 0.036)],
                     COL_REAR, [MAT["light_red_dim"]], segs=48)
        ring.location = t.location
        ring.rotation_euler = t.rotation_euler


# ----------------------------------------------------------------------------
# ACTIVE AERO WING (Thrust)
# ----------------------------------------------------------------------------


def airfoil(chord, thick, n=14):
    """Simple cambered profile in (x, z); x goes rearward (negative)."""
    top, bot = [], []
    for i in range(n + 1):
        t = i / n
        xx = (1 - math.cos(math.pi * t)) / 2
        yt = 5 * thick * (0.2969 * math.sqrt(xx) - 0.126 * xx - 0.3516 * xx ** 2
                          + 0.2843 * xx ** 3 - 0.1036 * xx ** 4)
        camber = 0.05 * chord * math.sin(math.pi * xx) * 0.0 + (-0.02 * chord) * 4 * xx * (1 - xx)
        top.append((-xx * chord, camber + yt * chord))
        bot.append((-xx * chord, camber - yt * chord))
    pts = top + list(reversed(bot[1:-1]))
    return pts


WING_SWEEP = 0.07


def build_wing():
    rig = bpy.data.objects.new("ActiveAero_Rig", None)
    rig.empty_display_type = "ARROWS"
    rig.empty_display_size = 0.3
    rig.location = (-1.86, 0, 0.90)
    link(rig, COL_AERO)

    parts, endplates = [], []
    # main blade: white top (blends into deck when stowed), carbon underside
    prof = [(x - 1.86, z + 1.205) for x, z in airfoil(0.34, 0.11)]
    blade = extrude_xz("Wing_Blade", prof, -0.915, 0.915, COL_AERO, [MAT["paint"], MAT["carbon"]])
    for p in blade.data.polygons:
        p.material_index = 0 if p.normal.z > 0.25 else 1
    for v in blade.data.vertices:  # gull-wing sweep: tips rise into the end plates
        v.co.z += WING_SWEEP * (v.co.y / 0.915) ** 4
    add_bevel(blade, 0.004, seg=2, angle=40)
    mark_sharp(blade, 40)
    parts.append(blade)

    # end plates (white), slight outward cant
    plate = [(x, z + WING_SWEEP) for x, z in
             [(-1.80, 1.10), (-1.86, 1.03), (-2.17, 1.05), (-2.28, 1.42), (-2.10, 1.46), (-1.93, 1.34)]]
    for side, nm in ((1, "L"), (-1, "R")):
        y = side * 0.93
        ep = extrude_xz(f"Wing_Endplate_{nm}", plate, y - 0.008, y + 0.008, COL_AERO, [MAT["paint"]])
        add_bevel(ep, 0.004, seg=3, angle=None)
        parts.append(ep)
        endplates.append(ep)

    # swan-neck pylons + actuator struts (carbon / dark)
    pylon = [(-1.74, 0.80), (-1.80, 0.80), (-1.97, 1.19), (-1.91, 1.21), (-1.86, 1.16)]
    for side, nm in ((1, "L"), (-1, "R")):
        y = side * 0.34
        py = extrude_xz(f"Wing_Pylon_{nm}", pylon, y - 0.008, y + 0.008, COL_AERO, [MAT["carbon"]])
        add_bevel(py, 0.004, seg=2, angle=None)
        parts.append(py)
        strut = extrude_xz(f"Wing_Actuator_{nm}", [(-1.95, 0.80), (-1.97, 0.80), (-2.07, 1.17), (-2.05, 1.17)],
                           side * 0.56 - 0.009, side * 0.56 + 0.009, COL_AERO, [MAT["rim_dark"]])
        parts.append(strut)
    cross = box("Wing_CrossBeam", (-1.90, 0, 1.12), (0.03, 0.70, 0.02), COL_AERO, MAT["rim_dark"])
    parts.append(cross)

    for p in parts:
        p.parent = rig
        p.matrix_parent_inverse = Matrix.Translation(-rig.location)

    # stowed / deployed keys
    rig.location = (-1.76, 0, 0.90 - 0.335)  # stowed: blade top flush with the rear deck
    rig.rotation_euler = (0, 0, 0)
    rig.keyframe_insert("location", frame=FRAME_STOWED)
    rig.keyframe_insert("rotation_euler", frame=FRAME_STOWED)
    # end plates are retracted into the body while stowed
    for ep in endplates:
        for fr, hidden in ((FRAME_STOWED, True), (FRAME_STOWED + 6, False)):
            ep.hide_render = hidden
            ep.hide_viewport = hidden
            ep.keyframe_insert("hide_render", frame=fr)
            ep.keyframe_insert("hide_viewport", frame=fr)
    rig.location = (-1.86, 0, 0.90)
    rig.rotation_euler = (0, math.radians(7.0), 0)
    rig.keyframe_insert("location", frame=FRAME_DEPLOYED)
    rig.keyframe_insert("rotation_euler", frame=FRAME_DEPLOYED)
    return rig


# ----------------------------------------------------------------------------
# WHEELS
# ----------------------------------------------------------------------------
R_TIRE, R_RIM = 0.37, 0.285


def build_wheel(name, center, hw, side):
    root = bpy.data.objects.new(name, None)
    root.empty_display_type = "CIRCLE"
    root.empty_display_size = R_TIRE
    root.location = center
    root.rotation_euler = (0, 0, 0 if side > 0 else math.pi)
    link(root, COL_WHEELS)
    parts = []

    tire = [(R_RIM - 0.005, -hw * 0.88), (R_RIM + 0.03, -hw), (R_TIRE - 0.02, -hw * 0.97),
            (R_TIRE + 0.004, -hw * 0.78), (R_TIRE + 0.004, hw * 0.78), (R_TIRE - 0.02, hw * 0.97),
            (R_RIM + 0.03, hw), (R_RIM - 0.005, hw * 0.88)]
    t = lathe(f"{name}_Tire", tire, COL_WHEELS, [MAT["tire"]], segs=64)
    add_subsurf(t, 1, 2)
    parts.append(t)

    barrel = lathe(f"{name}_RimBarrel", [(R_RIM - 0.02, -hw * 0.85), (R_RIM, -hw * 0.85),
                                         (R_RIM, hw * 0.82), (R_RIM - 0.02, hw * 0.82)],
                   COL_WHEELS, [MAT["rim_dark"]], segs=64)
    parts.append(barrel)
    lip = lathe(f"{name}_RimLip", [(R_RIM - 0.012, hw * 0.80), (R_RIM + 0.004, hw * 0.80),
                                   (R_RIM + 0.004, hw * 0.88), (R_RIM - 0.012, hw * 0.86)],
                COL_WHEELS, [MAT["rim_disc"]], segs=64)
    parts.append(lip)
    # recessed light aero disc (the bright surface between the spokes)
    disc = lathe(f"{name}_AeroDisc", [(0.06, hw * 0.30), (R_RIM - 0.01, hw * 0.50),
                                      (R_RIM - 0.01, hw * 0.46), (0.06, hw * 0.26)],
                 COL_WHEELS, [MAT["rim_disc"]], segs=64)
    parts.append(disc)
    brake = lathe(f"{name}_BrakeDisc", [(0.07, -0.02), (0.20, -0.02), (0.20, 0.0), (0.07, 0.0)],
                  COL_WHEELS, [MAT["brake"]], segs=48)
    parts.append(brake)
    hub = lathe(f"{name}_HubCap", [(0.0, hw * 0.82), (0.045, hw * 0.80), (0.062, hw * 0.70),
                                   (0.062, hw * 0.40), (0.0, hw * 0.40)],
                COL_WHEELS, [MAT["rim_dark"]], segs=32)
    parts.append(hub)

    # thin crossing blade spokes: 5 pairs, each pair twisted in opposite directions
    verts, faces = [], []
    n_r = 14
    r0, r1 = 0.055, R_RIM - 0.006
    for arm in range(5):
        base = arm * 2 * math.pi / 5
        for k, (twist, a_off) in enumerate(((0.55, 0.0), (-0.55, 0.006))):
            start = len(verts)
            for i in range(n_r):
                u = i / (n_r - 1)
                r = r0 + (r1 - r0) * u
                th = base - twist / 2 + twist * u
                halfw = (0.011 - 0.005 * u) / r  # tapering blade, angular half-width
                a_front = hw * (0.80 - 0.18 * u) + a_off
                a_back = a_front - 0.028
                for dth in (-halfw, halfw):
                    for a in (a_front, a_back):
                        verts.append((r * math.cos(th + dth), a, r * math.sin(th + dth)))
            for i in range(n_r - 1):
                b0, b1 = start + i * 4, start + (i + 1) * 4
                # vertex order per ring: 0 (-w,front) 1 (-w,back) 2 (+w,front) 3 (+w,back)
                faces += [(b0 + 0, b0 + 2, b1 + 2, b1 + 0),  # front face
                          (b0 + 1, b1 + 1, b1 + 3, b0 + 3),  # back face
                          (b0 + 0, b1 + 0, b1 + 1, b0 + 1),  # side -
                          (b0 + 2, b0 + 3, b1 + 3, b1 + 2)]  # side +
            b0, b1 = start, start + (n_r - 1) * 4
            faces += [(b0 + 0, b0 + 1, b0 + 3, b0 + 2), (b1 + 0, b1 + 2, b1 + 3, b1 + 1)]
    sp = mesh_object(f"{name}_Spokes", verts, faces, COL_WHEELS, [MAT["rim_dark"]])
    mark_sharp(sp, 35)
    add_bevel(sp, 0.0015, seg=2, angle=35)
    parts.append(sp)

    for p in parts:
        p.parent = root
    return root


def build_wheels():
    build_wheel("Wheel_FL", (1.35, 0.82, R_TIRE), 0.13, 1)
    build_wheel("Wheel_FR", (1.35, -0.82, R_TIRE), 0.13, -1)
    build_wheel("Wheel_RL", (-1.30, 0.84, R_TIRE), 0.15, 1)
    build_wheel("Wheel_RR", (-1.30, -0.84, R_TIRE), 0.15, -1)


# ----------------------------------------------------------------------------
# misc body details
# ----------------------------------------------------------------------------


def build_details():
    # front carbon splitter
    sp = extrude_xy("Front_Splitter_Carbon",
                    [(2.25, -0.55), (2.25, 0.55), (2.12, 0.72), (1.85, 0.74), (1.85, -0.74), (2.12, -0.72)],
                    0.10, 0.118, COL_BODY, [MAT["carbon"]])
    add_bevel(sp, 0.004, seg=2, angle=30)
    # side sills (carbon blades under the doors)
    for side, nm in ((1, "L"), (-1, "R")):
        pts = []
        for i in range(24):
            x = 0.92 - (0.92 + 0.85) * i / 23
            pts.append((x, side * (CURVE["ws"](x) + 0.05)))
        pts += [(x, side * (CURVE["ws"](x) - 0.03)) for x, _ in reversed(pts)]
        sill = extrude_xy(f"Side_Sill_Carbon_{nm}", pts, 0.10, 0.125, COL_BODY, [MAT["carbon"]])
        add_bevel(sill, 0.004, seg=2, angle=30)


# ----------------------------------------------------------------------------
# stage, lights, cameras, render settings
# ----------------------------------------------------------------------------


def build_stage():
    floor = mesh_object("Stage_Floor", [(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)],
                        [(0, 1, 2, 3)], COL_STAGE, [MAT["floor"]])
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = (0.012, 0.012, 0.014, 1)
        bg.inputs["Strength"].default_value = 1.0

    def area(name, loc, target, size, power, sx=None, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = power
        ld.color = color
        ld.shape = "RECTANGLE"
        ld.size = size
        ld.size_y = sx if sx else size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        look_at(ob, target)
        link(ob, COL_STAGE)
        return ob

    top = area("Light_TopSoftbox", (0, 0, 5.5), (0, 0, 0), 6.0, 450, sx=3.0)
    try:
        top.visible_glossy = False  # keeps the tinted glass dark, like on the stage photos
    except Exception:
        pass
    area("Light_Key_RearLeft", (-6.0, 5.0, 3.2), (-0.5, 0, 0.6), 4.0, 2200)
    area("Light_Rim_RearRight", (-5.0, -6.0, 2.4), (-0.5, 0, 0.6), 3.0, 1400, color=(0.9, 0.95, 1.0))
    area("Light_Fill_Front", (6.0, 4.0, 3.0), (0, 0, 0.5), 4.0, 650)
    area("Light_Key_FrontRight", (5.0, -4.5, 2.2), (1.2, 0, 0.5), 3.0, 700, color=(0.92, 0.96, 1.0))
    area("Light_Rear_Low", (-6.5, 0.5, 1.4), (-2.1, 0, 0.7), 2.0, 260)

    def cam(name, loc, target, lens):
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        cd.clip_start = 0.05
        ob = bpy.data.objects.new(name, cd)
        ob.location = loc
        look_at(ob, target)
        link(ob, COL_STAGE)
        return ob

    cams = {
        "Rear34": (cam("CAM_Rear34", (-5.4, 4.0, 1.55), (-0.25, 0.0, 0.52), 42), FRAME_STOWED),
        "RearClose": (cam("CAM_RearClose", (-4.4, 1.75, 0.80), (-2.0, -0.12, 0.78), 38), FRAME_DEPLOYED),
        "Side": (cam("CAM_Side", (0.0, 9.5, 0.75), (0.0, 0.0, 0.58), 62), FRAME_DEPLOYED),
        "Front34": (cam("CAM_Front34", (5.6, 3.3, 1.05), (0.4, 0.0, 0.5), 42), FRAME_STOWED),
        "FrontClose": (cam("CAM_FrontClose", (4.6, 1.7, 1.55), (1.45, 0.15, 0.55), 35), FRAME_STOWED),
    }
    return cams


def setup_render():
    scene.render.engine = "CYCLES"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = RES_PCT
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.exposure = -0.3
    for attr, val in (("view_transform", "AgX"), ("look", "AgX - Medium High Contrast"), ("look", "Medium High Contrast")):
        try:
            setattr(scene.view_settings, attr, val)
        except Exception:
            pass
    print("Color:", scene.view_settings.view_transform, scene.view_settings.look)
    scene.frame_start, scene.frame_end = FRAME_STOWED, FRAME_DEPLOYED
    device = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dt in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                prefs.compute_device_type = dt
            except Exception:
                continue
            prefs.get_devices()
            devs = [d for d in prefs.devices if d.type == dt]
            if devs:
                for d in prefs.devices:
                    d.use = d.type == dt
                device = dt
                break
    except Exception as e:
        print("GPU setup failed:", e)
    scene.cycles.device = "GPU" if device != "CPU" else "CPU"
    print("Cycles device:", device)


# ----------------------------------------------------------------------------
# build
# ----------------------------------------------------------------------------
build_body()
build_glass()
build_car_lights()
build_rear()
build_wing()
build_wheels()
build_details()
CAMS_OBJ = build_stage()
setup_render()

os.makedirs(OUT_DIR, exist_ok=True)
scene.camera = CAMS_OBJ["Rear34"][0]
scene.frame_set(FRAME_DEPLOYED)
blend_path = os.path.join(OUT_DIR, "roadster_rdstr.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
print("Saved", blend_path)

if DO_RENDER:
    rdir = os.path.join(OUT_DIR, "renders")
    os.makedirs(rdir, exist_ok=True)
    for key in CAMS:
        if key not in CAMS_OBJ:
            continue
        cam_ob, frame = CAMS_OBJ[key]
        scene.camera = cam_ob
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(rdir, f"roadster_{key}.png")
        bpy.ops.render.render(write_still=True)
        print("Rendered", scene.render.filepath)
