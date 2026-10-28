/* GHOST's system paths, which Blender's appdir.cc asks for its directories: the module runs in a browser, which has no
 * installation, user or special directories, so there are none (Blender then uses its defaults). */
#include "GHOST_ISystemPaths.hh"

class BrowserSystemPaths : public GHOST_ISystemPaths {
 public:
  const char *getSystemDir(int /*version*/, const char * /*versionstr*/) const override { return nullptr; }
  const char *getUserDir(int /*version*/, const char * /*versionstr*/) const override { return nullptr; }
  std::optional<std::string> getUserSpecialDir(GHOST_TUserSpecialDirTypes /*type*/) const override { return std::nullopt; }
  const char *getBinaryDir() const override { return nullptr; }
  void addToSystemRecentFiles(const char * /*filepath*/) const override {}
};

GHOST_ISystemPaths *GHOST_ISystemPaths::system_paths_ = nullptr;

/* port-override: GHOST is past the seam; the browser's paths are none. */
GHOST_TSuccess GHOST_ISystemPaths::create()
{
  system_paths_ = system_paths_ ? system_paths_ : new BrowserSystemPaths();
  return GHOST_kSuccess;
}

GHOST_TSuccess GHOST_ISystemPaths::dispose()
{
  delete system_paths_;
  system_paths_ = nullptr;
  return GHOST_kSuccess;
}

GHOST_ISystemPaths *GHOST_ISystemPaths::get()
{
  create();
  return system_paths_;
}
