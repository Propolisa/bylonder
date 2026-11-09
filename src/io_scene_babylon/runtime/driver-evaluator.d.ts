/**
 * A driver's value, through its F-Curve when it has keys.
 * @param {Record<string, any>} inputs
 * @param {{ frame: number }} context
 * @param {object} entity
 */
export function run({ driver, curve, objects, frame }: Record<string, any>, context: {
    frame: number;
}, entity: object): {
    value: number;
};
