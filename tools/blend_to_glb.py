"""Turn the Blender Roadster (export/roadster_rdstr.blend, made by tools/build_roadster.py)
into models/roadster.glb for the game.

Run from the project folder:
    blender --background --factory-startup export/roadster_rdstr.blend --python tools/blend_to_glb.py

What it does before exporting:
- wing stowed (frame 1), animation dropped, hidden parts (retracted end plates) removed;
- the stage (floor, studio lights, cameras) left out;
- the plate text turned into a mesh;
- the procedural carbon (not supported by glTF) replaced by a flat dark carbon colour;
- emissive lights toned down for the game's bloom;
- the car turned to face -Y in Blender, which is +Z in glTF, the game's forward.
"""
import math
import os
import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(ROOT, "models", "roadster.glb")
MAX_EMISSION = 8.0  # the game's bloom picks up anything brighter than about 4

scene = bpy.context.scene
scene.frame_set(1)  # wing stowed

# Bake the current pose and drop all animation.
for ob in bpy.data.objects:
    ob.animation_data_clear()

# Remove the stage and anything hidden at this frame.
for ob in list(bpy.data.objects):
    in_stage = any(c.name == "Stage" for c in ob.users_collection)
    if in_stage or ob.type in {"CAMERA", "LIGHT"} or ob.hide_render:
        bpy.data.objects.remove(ob, do_unlink=True)

# Text -> mesh (keeps its parent and transform).
for ob in list(bpy.data.objects):
    if ob.type == "FONT":
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        mesh_ob = bpy.data.objects.new(ob.name, me)
        for c in ob.users_collection:
            c.objects.link(mesh_ob)
        mesh_ob.parent = ob.parent
        mesh_ob.matrix_world = ob.matrix_world.copy()
        bpy.data.objects.remove(ob, do_unlink=True)
        mesh_ob.name = "Plate_Text"

# Flat stand-ins for node setups glTF can't carry, and tamer emission.
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        continue
    if mat.name == "Carbon_Fiber":
        for link in list(bsdf.inputs["Base Color"].links) + list(bsdf.inputs["Roughness"].links):
            nt.links.remove(link)
        bsdf.inputs["Base Color"].default_value = (0.012, 0.012, 0.014, 1)
        bsdf.inputs["Roughness"].default_value = 0.42
    if "Emission Strength" in bsdf.inputs:
        s = bsdf.inputs["Emission Strength"]
        s.default_value = min(s.default_value, MAX_EMISSION)

# One root for the whole car, turned so the nose points to -Y (glTF +Z).
car = bpy.data.objects.new("TeslaRoadster_RDSTR", None)
scene.collection.objects.link(car)
for ob in list(bpy.data.objects):
    if ob is not car and ob.parent is None:
        ob.parent = car
car.rotation_euler = (0, 0, -math.pi / 2)

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    export_apply=True,       # bevels, subdivision
    export_yup=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)

tris = 0
dg = bpy.context.evaluated_depsgraph_get()
for ob in bpy.data.objects:
    if ob.type == "MESH":
        me = ob.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        ob.evaluated_get(dg).to_mesh_clear()
print(f"Exported {OUT_GLB} ({tris} triangles)")
