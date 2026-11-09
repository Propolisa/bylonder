/**
 * Registers `unit` for a type key (`modifier:BEVEL`), or for every key with a prefix (`driver:*`).
 * @param {string} type
 * @param {Unit} unit
 */
export function register(type: string, unit: Unit): void;
/** @param {string} type */
export function unregister(type: string): void;
/**
 * The unit registered for a type key: its own, else the longest prefix key that covers it.
 * @param {string} type
 * @returns {Unit | undefined}
 */
export function unitFor(type: string): Unit | undefined;
/**
 * A unit takes an entity's inputs as plain values (numbers, arrays, an IR mesh) and gives its outputs by name; it may
 * answer later (a Promise). It never sees Blender's structures.
 */
export type Unit = {
    run(inputs: Record<string, any>, context: {
        frame: number;
    }): Record<string, any> | Promise<Record<string, any>>;
};
