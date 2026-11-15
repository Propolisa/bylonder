/** @type {{ module?: (path: string) => Promise<any> }} */
export const packageHost: {
    module?: (path: string) => Promise<any>;
};
export function packageModule(path: string, root: string): Promise<any>;
