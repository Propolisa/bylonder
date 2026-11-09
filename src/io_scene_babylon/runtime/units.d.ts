/**
 * Registers `unit` for a type key (`modifier:BEVEL`), or for every key with a prefix (`driver:*`).
 * @template [I=Record<string, any>]
 * @param {string} type
 * @param {Unit<I>} unit
 */
export function register<I = Record<string, any>>(type: string, unit: Unit<I>): void;
/** @param {string} type */
export function unregister(type: string): void;
/**
 * The unit registered for a type key: its own, else the longest prefix key that covers it.
 * @param {string} type
 * @returns {Unit<any> | undefined}
 */
export function unitFor(type: string): Unit<any> | undefined;
/**
 * Runs a unit on an entity's resolved inputs, parsed with its schema when it has one.
 * @param {Unit<any>} unit
 * @param {Record<string, any>} inputs
 * @param {{ frame: number }} context
 * @param {string} key the entity's, named when its inputs do not fit
 */
export function runUnit(unit: Unit<any>, inputs: Record<string, any>, context: {
    frame: number;
}, key: string): Record<string, any> | Promise<Record<string, any>>;
/**
 * A unit takes an entity's inputs as plain values (numbers, arrays, an IR mesh) and gives its outputs by name; it may
 * answer later (a Promise). It never sees Blender's structures. With an `inputs` schema, its inputs are parsed with it
 * first: defaults filled, and an entity it cannot take reported by path.
 */
export type Unit<I = Record<string, any>> = {
    inputs?: z.ZodMiniType<I, any>;
    run(inputs: I, context: {
        frame: number;
    }): Record<string, any> | Promise<Record<string, any>>;
};
import * as z from './zod.js';
