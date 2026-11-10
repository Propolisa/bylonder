/**
 * Adds the control panel of a loaded scene to the page; it goes with the scene.
 * @param {import('./blend-scene.js').BlendScene} blend
 * @param {PanelOptions} [options]
 */
export function controlPanel(blend: import("./blend-scene.js").BlendScene, options?: PanelOptions): {
    open: () => Promise<void>;
    close: () => Promise<void | undefined>;
    dispose: () => Promise<void>;
} | null;
export const TOKENS: "--bl-font-family:\"Inter\",\"DejaVu Sans\",system-ui,-apple-system,\"Segoe UI\",sans-serif;\n--bl-text:#e6e6e6;--bl-text-dim:#a6a6a6;--bl-text-off:#7a7a7a;--bl-link:#71a8ff;--bl-select:#4772b3;--bl-hover:#ffffff14;--bl-header:#303030;\n--bl-panel-back:#3d3d3d;--bl-panel-sub-back:#0000001f;--bl-panel-outline:#ffffff11;--bl-panel-title:#e6e6e6;--bl-region:#303030;\n--bl-wcol-outline:#3d3d3d;--bl-wcol-emboss:#00000026;--bl-wcol-hover:#ffffff17;--bl-wcol-num:#545454;--bl-wcol-num-sel:#222222;--bl-wcol-num-item:#4772b3;\n--bl-wcol-option:#545454;--bl-wcol-option-sel:#4772b3;--bl-wcol-option-item:#ffffff;--bl-wcol-text:#1d1d1d;--bl-wcol-text-cursor:#71a8ff;--bl-wcol-menu:#282828;--bl-wcol-menu-item:#d9d9d9;\n--bl-shadow-menu:0 3px 6px #0003;--bl-shadow-popup:0 10px 40px #000a;--bl-tooltip:#1d1d1d;--bl-tooltip-text:#d9d9d9;--bl-split-label:40%;\n--bl-icon-object:#e19658;--bl-icon-object-data:#00d4a3;--bl-icon-modifier:#74a2ff;--bl-icon-shading:#cc6670;--bl-icon-scene:#cccccc;\n--cp-font-size:11px;--cp-row:20px;--cp-radius:4px;--cp-gap:2px";
/**
 * Where the editors the panel links to load from: Babylon's CDN, or the package's `bylonder-dev-tools/`.
 * How the viewer moves the view (control-panel-camera.js): the mode the page starts in, and those the panel offers.
 */
export type PanelOptions = {
    tools?: "CDN" | "PACKAGE" | undefined;
    /**
     * the package's URL
     */
    root?: string | undefined;
    navigation?: import("./control-panel-camera.js").Navigation | undefined;
    offer?: import("./control-panel-camera.js").Navigation[] | undefined;
};
