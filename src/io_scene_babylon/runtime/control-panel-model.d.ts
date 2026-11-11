/**
 * A path's parts: its ID (`objects`, `Cube`), the struct within it holding the property (`pose.bones["Arm"]`) with the
 * name and collection of the struct's last named step, the property (a custom property's key) and a vector's index.
 * @param {string} path
 */
export function parsePath(path: string): {
    collection: string;
    name: string;
    idPath: string;
    struct: string;
    structName: string | undefined;
    structKind: string | undefined;
    property: string;
    custom: boolean;
    index: number | undefined;
} | null;
/**
 * The panel's sections of these controls: custom properties first, then the materials, then the rest by kind.
 * `images`: a control setting an image (a URL of the package) as a choice of the package's images.
 * @param {Control[]} controls
 * @param {(control: Control) => boolean} [isImage]
 * @returns {Section[]}
 */
export function layout(controls: Control[], isImage?: (control: Control) => boolean): Section[];
/**
 * Whether a row matches a search: every word of it in the row's label, its group's titles or its path.
 * @param {Row} row
 * @param {string[]} titles
 * @param {string} query
 */
export function matches(row: Row, titles: string[], query: string): boolean;
/** A value as Blender's UI shows it: in degrees for a rotation, with its unit, to its precision. @param {Value} value @param {Control} control */
export function formatValue(value: Value, control: Control): string;
/**
 * A typed value: a number or arithmetic (`+ - * / ^`, parentheses, `pi`), with units (`cm`, `°`, `deg`), in the
 * control's own units (a rotation is typed in degrees, as Blender's field takes it, and set in radians). Null when it does
 * not read.
 * @param {string} text
 * @param {Control} control
 * @returns {number | null}
 */
export function parseValue(text: string, control: Control): number | null;
/** A value within the control's hard range, whole for an integer. @param {number} value @param {Control} control */
export function clamp(value: number, control: Control): number;
/** The control's soft range when it is a usable one (a slider's track), else null. @param {Control} control */
export function softRange(control: Control): number[] | null;
/**
 * How much a pixel of drag changes the control: a span of its soft range over a field's travel when the range is
 * small, else a step of its own (RNA's step is a hundredth of the value); a rotation by half a degree.
 * @param {Control} control
 */
export function dragScale(control: Control): number;
/**
 * How much a finger's swipe across a number field changes the control: a small soft range, half a turn for a rotation,
 * else the value's own size (at least 300 pixels of a mouse drag), so a swipe moves it usefully on a small screen.
 * @param {Control} control
 * @param {number} value
 */
export function touchSpan(control: Control, value: number): number;
/**
 * The increment Ctrl snaps a drag to: 5 degrees for a rotation (1 with Shift); by a small soft range's span a tenth,
 * 1 or 10, else RNA's step (its hundredths, a hundred pixels of drag); a tenth of it with Shift; at least 1 for an integer.
 * @param {Control} control
 * @param {boolean} fine
 */
export function snapStep(control: Control, fine: boolean): number;
/**
 * What each id of an ID pass covers (0 to 1) and the average colour it shows there (CSS), from the ID pass's pixels
 * (an id in the red and green bytes, 0 for none) and the frame's at the same size, RGBA bytes both.
 * @param {ArrayLike<number>} ids
 * @param {ArrayLike<number>} shown
 */
export function seen(ids: ArrayLike<number>, shown: ArrayLike<number>): Map<number, {
    share: number;
    colour: string;
}>;
/**
 * A material's main colour where it is not seen: its first Base Color row, else its first Color row.
 * @param {Group} group
 * @returns {Row | undefined}
 */
export function baseColor(group: Group): Row | undefined;
/** A displayed color's hue, saturation and value, each 0 to 1, as Blender's color picker has them. @param {number[]} rgb */
export function hsvOf([r, g, b]: number[]): number[];
/** A hue, saturation and value as a displayed color. @param {number[]} hsv */
export function rgbOfHsv([h, s, v]: number[]): number[];
export function labelOf(control: Control): string;
export function componentLabel(control: Control, index: number): string;
export function atDefault(row: Row, value: (path: string) => Value): boolean;
export function snapped(value: number, step: number): number;
export function toDisplay(v: number): number;
export function toLinear(v: number): number;
export function displayOf(v: number, gamma: boolean): number;
export function storedOf(v: number, gamma: boolean): number;
export function hexOf(rgb: number[], gamma: boolean): string;
export function rgbOf(hex: string, gamma: boolean): number[] | null;
export type Control = import("./blend-scene.js").Control;
export type Value = import("./blend-scene.js").Value;
export type Widget = "number" | "slider" | "color" | "check" | "text" | "enum";
export type Row = {
    /**
     * the property's path, a vector's without its index
     */
    key: string;
    label: string;
    /**
     * in component order
     */
    controls: Control[];
    widget: Widget;
    /**
     * an enum's choices
     */
    items?: string[] | undefined;
};
/**
 * An ID or a struct within one: its rows and its own groups.
 */
export type Group = {
    /**
     * its path
     */
    key: string;
    title: string;
    /**
     * what it is: the bpy.data collection of an ID, or the collection holding a struct (`nodes`)
     */
    kind?: string | undefined;
    rows: Row[];
    groups: Group[];
};
export type Section = {
    key: string;
    title: string;
    groups: Group[];
};
