/**
 * The control panel of a scene, in the shadow root of its button (control-panel.js).
 * @param {ShadowRoot} shadow
 * @param {import('./blend-scene.js').BlendScene} blend
 * @param {import('./control-panel.js').PanelOptions & { button: HTMLButtonElement, place: () => DOMRect,
 *   viewer: () => Promise<ReturnType<import('./control-panel-camera.js').createNavigation>> }} options
 */
export function createPanel(shadow: ShadowRoot, blend: import("./blend-scene.js").BlendScene, { button, place, viewer, ...tools }: import("./control-panel.js").PanelOptions & {
    button: HTMLButtonElement;
    place: () => DOMRect;
    viewer: () => Promise<ReturnType<typeof import("./control-panel-camera.js").createNavigation>>;
}): {
    toggle: (open?: boolean) => void;
    dispose: () => void;
};
export type Row = import("./control-panel-model.js").Row;
export type Group = import("./control-panel-model.js").Group;
export type Section = import("./control-panel-model.js").Section;
export type Control = import("./blend-scene.js").Control;
export type Value = import("./blend-scene.js").Value;
