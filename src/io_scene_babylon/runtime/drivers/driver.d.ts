/** @param {ObjectData} o @param {string} path @param {(ref: ObjectRef) => ObjectData} resolve */
export function readProperty(o: ObjectData, path: string, resolve: (ref: ObjectRef) => ObjectData): number;
/** @param {Variable} variable @param {(ref: ObjectRef) => ObjectData} resolve @returns {{ value: number, valid: boolean }} */
export function evaluateVariable(variable: Variable, resolve: (ref: ObjectRef) => ObjectData): {
    value: number;
    valid: boolean;
};
/** @param {Driver} driver @param {Context} context @returns {DriverResult} */
export function evaluateDriver(driver: Driver, context?: Context): DriverResult;
/**
 * rows of a 3x3 matrix acting on column vectors
 */
export type Mat3 = number[][];
export type Affine = {
    linear: Mat3;
    translation: number[];
};
/**
 * an Empty, as plain data; every field optional
 */
export type ObjectData = {
    location?: number[];
    rotation_mode?: string;
    rotation_euler?: number[];
    rotation_quaternion?: number[];
    rotation_axis_angle?: number[];
    scale?: number[];
    delta_location?: number[];
    delta_rotation_euler?: number[];
    delta_rotation_quaternion?: number[];
    delta_scale?: number[];
    parent?: ObjectRef;
    matrix_parent_inverse?: number[][];
    properties?: Record<string, number | number[]>;
};
/**
 * an object, or the name of one in the driver's `objects`
 */
export type ObjectRef = ObjectData | string;
/**
 * `value` stands in for a SINGLE_PROP read when the caller resolves the property itself
 */
export type Target = {
    object?: ObjectRef;
    value?: number;
    data_path?: string;
    transform_type?: string;
    transform_space?: string;
    rotation_mode?: string;
};
export type Variable = {
    name?: string;
    type?: string;
    targets?: Target[];
};
export type Driver = {
    type?: string;
    expression?: string;
    variables?: Variable[];
};
export type Context = {
    frame?: number;
    objects?: Record<string, ObjectData>;
    previousValue?: number;
};
export type DriverResult = {
    value: number;
    valid: boolean;
    pythonOnly?: boolean;
};
/** @param {Mat3} a @returns {Mat3} each column divided by its length */
export function normalizeColumns(a: Mat3): Mat3;
/** @param {ObjectData} o @param {(ref: ObjectRef) => ObjectData} resolve @returns {Affine} */
export function worldMatrix(o: ObjectData, resolve: (ref: ObjectRef) => ObjectData): Affine;
/** @param {ObjectData} o @param {(ref: ObjectRef) => ObjectData} resolve @param {string} space @returns {Affine} */
export function spaceMatrix(o: ObjectData, resolve: (ref: ObjectRef) => ObjectData, space: string): Affine;
