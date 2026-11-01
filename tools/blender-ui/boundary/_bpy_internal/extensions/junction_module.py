# Blender's extensions' junction module (_bpy_internal.extensions.junction_module), which holds the add-ons of extension
# repositories as submodules: Bylonder has no repositories, so it holds none.
class JunctionModuleHandle:
    def __init__(self, module_name):
        self._module_name = module_name

    def submodule_items(self):
        return []

    def register_module(self):
        return None

    def unregister_module(self):
        pass

    def register_submodule(self, submodule_name, dirpath):
        return None

    def unregister_submodule(self, submodule_name):
        pass

    def rename_submodule(self, submodule_name_src, submodule_name_dst):
        pass

    def rename_directory(self, submodule_name, dirpath):
        pass
