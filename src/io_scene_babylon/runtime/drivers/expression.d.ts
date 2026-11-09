/**
 * @param {string} expression
 * @param {Iterable<string>} variableNames names of the driver's variables (keys of the evaluator's `variables`)
 * @returns {Evaluator | typeof PYTHON_ONLY}
 */
export function compile(expression: string, variableNames?: Iterable<string>): Evaluator | typeof PYTHON_ONLY;
/** Returned by `compile` when the expression needs a full Python interpreter. */
export const PYTHON_ONLY: Readonly<{
    pythonOnly: true;
}>;
export const FLT_MAX: 3.4028234663852886e+38;
export function isValidVariableName(name: string): boolean;
export function storedVariableName(name: string): string;
export type Scope = {
    vars: Map<string, number>;
    frame: number;
};
export type Node = (scope: Scope) => number;
/**
 * Returns the float32 result, or null when evaluation fails (the driver keeps its previous value).
 */
export type Evaluator = (variables: Record<string, number>, frame?: number) => number | null;
export type Token = {
    kind: "number";
    value: number;
} | {
    kind: "name";
    value: string;
} | {
    kind: "op";
    value: string;
} | {
    kind: "end";
    value: "";
};
