// A Blender modifier's panel as Blender lays it out: the tree its panel_draw records in the module (modifierPanel),
// drawn with Bylonder's rows and panels. Inactive layouts are greyed and disabled ones locked, as Blender draws them.
import { h } from 'vue';
import { modifierPanel } from '../../modifiers/blender.js';

const NO_TEXT = undefined;

export function blenderModifierContent({ id, modifier, definition, field, panel }) {
  const prop = (node, disabled) => {
    const paths = definition.schema[node.prop] ? [node.prop]
      : Object.keys(definition.schema).filter((path) => path.startsWith(node.prop + '[') && (node.index < 0 || path === `${node.prop}[${node.index}]`));
    return paths.map((path, i) => field(path, {
      ...(node.text !== NO_TEXT && i === 0 && { label: node.text || definition.schema[path].label }),
      ...(disabled && { disabled: () => true }),
    }));
  };
  const draw = (node, disabled = false) => {
    disabled ||= node.enabled === false;
    const children = () => node.children.flatMap((child) => draw(child, disabled));
    switch (node.kind) {
      case 'prop': return prop(node, disabled);
      case 'label': return node.text ? [h('div', { class: 'bl-label' }, node.text)] : [];
      case 'separator': return [h('div', { class: 'bl-separator' })];
      case 'panel': return [subpanel(node, disabled)];
      case 'column': case 'row': case 'box': case 'split': case 'body':
        return [h('div', { class: [`bl-layout bl-layout-${node.kind}`, { 'bl-inactive': node.active === false }] }, [
          ...(node.heading ? [h('div', { class: 'bl-label' }, node.heading)] : []), ...children()])];
      default: return []; // Operators, searches and menus that need other data blocks come later.
    }
  };
  // A sub-panel: its header's checkbox (if any) beside the title, its body and its own sub-panels inside.
  const subpanel = (node, disabled) => {
    const header = node.children.find((c) => c.kind === 'header'), check = header?.children.find((c) => c.kind === 'prop');
    const title = node.text || header?.children.find((c) => c.kind === 'label')?.text || '';
    const actions = check && definition.schema[check.prop] ? () => [field(check.prop, { label: '', disabled: disabled ? () => true : undefined })] : undefined;
    return panel(`${id}.${node.prop}`, title, () => node.children.filter((c) => c !== header).flatMap((c) => draw(c, disabled)),
      { subpanel: true, actions, defaultClosed: true });
  };
  const [root] = modifierPanel(modifier).children;
  return root ? root.children.flatMap((node) => draw(node)) : [];
}
