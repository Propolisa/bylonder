// The app's scenes against a game run's (editors/space_game): the app's Babylon-wide extensions (material plugins,
// prototype overrides) apply to the app's scenes alone, so a game plays as its exported page does.
const gameEngines = new WeakSet();

/** Marks an engine a game draws on; gives it. */
export function gameEngine(engine) {
  gameEngines.add(engine);
  return engine;
}

/** Whether a scene is the app's, not a game run's. */
export const isAppScene = (scene) => !gameEngines.has(scene?.getEngine());
