# Blender's key configurations (WindowManager.keyconfigs, rna_wm_api.cc and wm_keymap.cc): key configs holding
# keymaps holding items, which Blender's scripts fill (bl_keymap_utils) and the tool system extends.


class OperatorProperties:
    pass


class KeyMapItem:
    def __init__(self, idname, type, value, any=False, shift=0, ctrl=0, alt=0, oskey=0, hyper=0, key_modifier='NONE',
                 direction='ANY', repeat=False, map_type='KEYBOARD', propvalue='NONE'):
        self.idname, self.type, self.value, self.any = idname, type, value, any
        self.shift, self.ctrl, self.alt, self.oskey, self.hyper = shift, ctrl, alt, oskey, hyper
        self.key_modifier, self.direction, self.repeat, self.map_type, self.propvalue = key_modifier, direction, repeat, map_type, propvalue
        self.active, self.show_expanded, self.is_user_modified, self.is_user_defined = True, False, False, False
        self.properties = OperatorProperties()
        self.id = 0
        self.name = idname


class KeyMapItems:
    def __init__(self):
        self.items = []

    def __iter__(self):
        return iter(self.items)

    def __len__(self):
        return len(self.items)

    def __getitem__(self, index):
        return self.items[index]

    def _add(self, item, head):
        item.id = len(self.items) + 1
        if head:
            self.items.insert(0, item)
        else:
            self.items.append(item)
        return item

    def new(self, idname, type, value, head=False, **keywords):
        return self._add(KeyMapItem(idname, type, value, **keywords), head)

    def new_modal(self, propvalue, type, value, **keywords):
        return self._add(KeyMapItem('', type, value, propvalue=propvalue, **keywords), False)

    def new_from_item(self, item, head=False):
        copy = KeyMapItem(item.idname, item.type, item.value, item.any, item.shift, item.ctrl, item.alt, item.oskey, item.hyper,
                          item.key_modifier, item.direction, item.repeat, item.map_type, item.propvalue)
        copy.properties.__dict__.update(item.properties.__dict__)
        return self._add(copy, head)

    def remove(self, item):
        self.items.remove(item)

    def from_id(self, id):
        return next((item for item in self.items if item.id == id), None)

    def find_from_operator(self, idname, properties=None, include={'ACTIONZONE', 'KEYBOARD', 'MOUSE', 'NDOF', 'TEXTINPUT', 'TIMER', 'TWEAK'}, exclude=set()):
        return next((item for item in self.items if item.idname == idname and item.active), None)


class KeyMap:
    def __init__(self, name, space_type='EMPTY', region_type='WINDOW', modal=False, tool=False):
        self.name, self.space_type, self.region_type, self.is_modal = name, space_type, region_type, modal
        self.bl_owner_id = ''
        self.active, self.show_expanded_items, self.show_expanded_children = True, False, False
        self.is_user_modified = False
        self.keymap_items = KeyMapItems()
        self.modal_event_values = []

    def restore_to_default(self):
        pass

    def restore_item_to_default(self, item):
        pass


class KeyMaps:
    def __init__(self):
        self.keymaps = []

    def __iter__(self):
        return iter(self.keymaps)

    def __len__(self):
        return len(self.keymaps)

    def __getitem__(self, index):
        return self.keymaps[index] if isinstance(index, int) else self.get(index)

    def get(self, name, default=None):
        return next((km for km in self.keymaps if km.name == name), default)

    def find(self, name, space_type='EMPTY', region_type='WINDOW'):
        return next((km for km in self.keymaps if km.name == name and km.space_type == space_type and km.region_type == region_type), None)

    def find_match(self, keymap):
        return self.find(keymap.name, keymap.space_type, keymap.region_type)

    def find_modal(self, name):
        return next((km for km in self.keymaps if km.name == name and km.is_modal), None)

    def new(self, name, space_type='EMPTY', region_type='WINDOW', modal=False, tool=False):
        # WM_keymap_ensure: an existing keymap of the same name and region is returned.
        found = self.find(name, space_type, region_type)
        if found is None:
            found = KeyMap(name, space_type, region_type, modal, tool)
            self.keymaps.append(found)
        return found

    def remove(self, keymap):
        self.keymaps.remove(keymap)

    def clear(self):
        self.keymaps = []


class KeyConfig:
    def __init__(self, name):
        self.name, self.is_user_defined, self.is_removable = name, False, False
        self.keymaps = KeyMaps()
        self.preferences = None


class KeyConfigs:
    def __init__(self):
        self.default = KeyConfig('Blender')
        self.addon = KeyConfig('Blender addon')
        self.user = KeyConfig('Blender user')
        self.active = self.default
        self.configs = [self.default, self.addon, self.user]

    def __iter__(self):
        return iter(self.configs)

    def __len__(self):
        return len(self.configs)

    def __getitem__(self, index):
        return self.configs[index] if isinstance(index, int) else next((c for c in self.configs if c.name == index), None)

    def get(self, name, default=None):
        return next((c for c in self.configs if c.name == name), default)

    def new(self, name):
        config = self.get(name) or KeyConfig(name)
        if config not in self.configs:
            self.configs.append(config)
        return config

    def remove(self, config):
        self.configs.remove(config)

    def update(self, keep_properties=False):
        pass

    def find_item_from_operator(self, idname, context='INVOKE_DEFAULT', properties=None, include={'ACTIONZONE', 'KEYBOARD', 'MOUSE', 'NDOF', 'TEXTINPUT', 'TIMER', 'TWEAK'}, exclude=set()):
        for config in (self.user, self.addon, self.default):
            for keymap in config.keymaps:
                item = keymap.keymap_items.find_from_operator(idname, properties, include, exclude)
                if item is not None:
                    return keymap, item
        return None, None
