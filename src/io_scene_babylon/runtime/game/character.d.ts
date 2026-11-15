declare const _default: import("./define.js").Behavior<{
    speed: {
        type: import("./define.js").PropType;
        default: any;
        options?: string[];
    } & import("./define.js").PropOptions & {
        default: number;
    };
    radius: {
        type: import("./define.js").PropType;
        default: any;
        options?: string[];
    } & import("./define.js").PropOptions & {
        default: number;
    };
    feet: {
        type: import("./define.js").PropType;
        default: any;
        options?: string[];
    } & import("./define.js").PropOptions & {
        default: boolean;
    };
    gaze: {
        type: import("./define.js").PropType;
        default: any;
        options?: string[];
    } & import("./define.js").PropOptions & {
        default: boolean;
    };
    lean: {
        type: import("./define.js").PropType;
        default: any;
        options?: string[];
    } & import("./define.js").PropOptions & {
        default: boolean;
    };
}, never, {
    update(dt: number): void;
    dispose(): void;
}>;
export default _default;
