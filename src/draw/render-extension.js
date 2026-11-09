// Bylonder's extensions of Babylon's drawing toward what Blender's realtime views draw, each a render setting of the
// Scene: a panel of its own in Properties > Render, marked with the Bylonder icon and switched by its header's checkbox,
// on by default. Saved in the .blend as `scene.<id>.use`, a custom property desktop Blender keeps.
import { Observable } from '@babylonjs/core';
import { __class__, __kwargtrans__ } from '../bl_py/org.transcrypt.__runtime__.js';
import { defineAssignedProperties, idStruct, registerClass } from '../python/bpy_rna.js';

const extensions = [];
const kw = (keywords) => __kwargtrans__(keywords);
const types = () => globalThis.__py_modules['_bpy.types'];
const props = () => globalThis.__py_modules['_bpy.props'];

// id: the Scene property's name (bylonder_...); label; description (the checkbox's tooltip); detail: the panel's text;
// pull(scene, struct): reads what else of Blender's scene (its RNA struct) the extension follows, as the scene changes.
export function renderExtension({ id, label, description, detail, pull = () => {} }) {
  const values = new WeakMap(); // Babylon scene -> on
  const extension = {
    id, label, description, detail, pull,
    // Told with the Babylon scene whose setting changed.
    changed: new Observable(),
    enabled: (scene) => values.get(scene) ?? true,
    set(scene, value) {
      if (extension.enabled(scene) === value) return;
      values.set(scene, value);
      extension.changed.notifyObservers(scene);
    },
  };
  extensions.push(extension);
  return extension;
}

// Each extension's setting as Blender's scene (an ID pointer) holds it, for the Babylon scene drawing it.
export function pullRenderExtensions(scene, sce) {
  const struct = idStruct(sce);
  for (const extension of extensions) {
    extension.set(scene, struct[extension.id]?.use ?? true);
    extension.pull(scene, struct);
  }
}

// The extensions' properties and panels, once Blender's Python is loaded; `icon` is the Bylonder icon's icon_value.
export function registerRenderExtensions(icon) {
  for (const { id, label, description, detail } of extensions) {
    const Group = __class__(`BYLONDER_PG_${id.replace(/^bylonder_/, '')}`, [types().PropertyGroup], {
      __annotations__: { use: props().BoolProperty(kw({ name: label, description, default: true, options: new Set() })) },
    });
    registerClass(Group);
    types().Scene[id] = props().PointerProperty(kw({ type: Group, name: label, description }));
    registerClass(__class__(`RENDER_PT_${id}`, [types().Panel], {
      bl_label: label, bl_space_type: 'PROPERTIES', bl_region_type: 'WINDOW', bl_context: 'render',
      draw_header(context) {
        this.layout.prop(context.scene[id], 'use', kw({ text: '' }));
        this.layout.label(kw({ text: '', icon_value: icon }));
      },
      draw(context) {
        this.layout.active = context.scene[id].use;
        this.layout.label(kw({ text: detail, icon: 'INFO' }));
      },
    }));
  }
  defineAssignedProperties();
}
