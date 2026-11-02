/* GHOST's system paths, which Blender's appdir.cc asks for its directories: the module runs in a browser, which has no
 * installation, user or special directories. Its system directory is SYSTEM_DIR in the module's file system, where the
 * app puts Blender's datafiles (tools/blender-port/datafiles.py: the Essentials asset libraries), and its user directory
 * is under USER_DIR, which the page keeps in the browser's storage (windowmanager/wm-userdef.js): the Preferences. */
#include <string>

#include "GHOST_ISystemPaths.hh"

static constexpr const char *SYSTEM_DIR = "/blender";
static constexpr const char *USER_DIR = "/user/";

class BrowserSystemPaths : public GHOST_ISystemPaths {
 public:
  const char *getSystemDir(int /*version*/, const char * /*versionstr*/) const override { return SYSTEM_DIR; }
  /* port-override: the browser has no home directory; the user directory is the module file system's, kept by the page. */
  const char *getUserDir(int /*version*/, const char *versionstr) const override
  {
    static std::string dir;
    dir = std::string(USER_DIR) + versionstr;
    return dir.c_str();
  }
  std::optional<std::string> getUserSpecialDir(GHOST_TUserSpecialDirTypes /*type*/) const override { return std::nullopt; }
  const char *getBinaryDir() const override { return nullptr; }
  void addToSystemRecentFiles(const char * /*filepath*/) const override {}
};

GHOST_ISystemPaths *GHOST_ISystemPaths::system_paths_ = nullptr;

/* port-override: GHOST is past the seam; the browser's paths are the module's file system's. */
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
