// Blender's Move to Collection and Link to Collection menus (object_edit.cc, move_to_collection_menu_draw), which
// object.move_to_collection and object.link_to_collection open (M, Shift M): New Collection, the collection, then its
// children, each with children a submenu of its own. Collections are named by `collection_uid`, their place in the
// scene's collections (0 is the Scene Collection).
import { menus } from '../../python/bpy_interface.js';
import { kw } from '../../windowmanager/wm-operators.js';

export function registerCollectionMenus(cols) {
  const ids = () => [cols.MASTER, ...cols.all().map((c) => c.id)];
  const uidOf = (id) => ids().indexOf(id);
  const menu = (idname, operator, bl_label) => Object.assign(() => ({
    draw(context) {
      const id = typeof context.collection === 'string' ? context.collection : cols.MASTER, layout = this.layout;
      const add = (text, icon, props) => Object.assign(layout.operator(operator, kw({ text, icon })), { collection_uid: uidOf(id), ...props });
      add('New Collection', 'ADD', { is_new: true });
      layout.separator();
      add(id === cols.MASTER ? 'Scene Collection' : cols.byId(id).name, id === cols.MASTER ? 'SCENE_DATA' : 'OUTLINER_COLLECTION');
      layout.separator();
      for (const child of cols.byId(id).children.filter((c) => cols.byId(c))) {
        const { name, children } = cols.byId(child);
        if (children.length) {
          layout.context_pointer_set('collection', child);
          layout.menu(idname, kw({ text: name, icon: 'OUTLINER_COLLECTION' }));
        } else Object.assign(layout.operator(operator, kw({ text: name, icon: 'OUTLINER_COLLECTION' })), { collection_uid: uidOf(child) });
      }
    },
  }), { bl_label });
  menus.OBJECT_MT_move_to_collection = menu('OBJECT_MT_move_to_collection', 'object.move_to_collection', 'Move to Collection');
  menus.OBJECT_MT_link_to_collection = menu('OBJECT_MT_link_to_collection', 'object.link_to_collection', 'Link to Collection');
  return { idOf: (uid) => ids()[uid] };
}
