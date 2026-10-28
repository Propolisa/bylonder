// Python's str and list methods Blender's scripts call that Transcrypt's runtime lacks (transpile.py appends this).
const __str_methods__ = {
    casefold () { return this.toLowerCase (); },
    center (width, fill = ' ') { const pad = Math.max (0, width - this.length), left = Math.floor (pad / 2); return fill.repeat (left) + this + fill.repeat (pad - left); },
    count (sub) { return sub ? this.split (sub).length - 1 : this.length + 1; },
    expandtabs (size = 8) { return this.replace (/\t/g, ' '.repeat (size)); },
    index (sub, start) { const at = this.indexOf (sub, start); if (at < 0) throw ValueError ('substring not found'); return at; },
    rindex (sub) { const at = this.lastIndexOf (sub); if (at < 0) throw ValueError ('substring not found'); return at; },
    isascii () { return /^[\x00-\x7f]*$/.test (this); },
    isidentifier () { return /^[A-Za-z_][A-Za-z0-9_]*$/.test (this); },
    isprintable () { return !/[\x00-\x1f\x7f]/.test (this); },
    istitle () { return this.length > 0 && this == this.title (); },
    ljust (width, fill = ' ') { return this.padEnd (width, fill); },
    rjust (width, fill = ' ') { return this.padStart (width, fill); },
    zfill (width) { const sign = /^[+-]/.test (this) ? this [0] : ''; return sign + this.slice (sign.length).padStart (width - sign.length, '0'); },
    partition (sep) { const at = this.indexOf (sep); return at < 0 ? [String (this), '', ''] : [this.slice (0, at), sep, this.slice (at + sep.length)]; },
    rpartition (sep) { const at = this.lastIndexOf (sep); return at < 0 ? ['', '', String (this)] : [this.slice (0, at), sep, this.slice (at + sep.length)]; },
    removeprefix (prefix) { return this.startsWith (prefix) ? this.slice (prefix.length) : String (this); },
    removesuffix (suffix) { return suffix && this.endsWith (suffix) ? this.slice (0, -suffix.length) : String (this); },
    swapcase () { return [...this].map ((c) => (c == c.toUpperCase () ? c.toLowerCase () : c.toUpperCase ())).join (''); },
    title () { return this.toLowerCase ().replace (/(^|[^A-Za-z])([a-z])/g, (m, before, c) => before + c.toUpperCase ()); },
    translate (table) { return [...this].map ((c) => { const to = table [c.charCodeAt (0)]; return to === undefined ? c : to === null ? '' : typeof to == 'number' ? String.fromCharCode (to) : to; }).join (''); },
    // str stands in for bytes: encode and decode are identities.
    encode () { return String (this); },
    decode () { return String (this); },
};
const __list_methods__ = {
    clear () { this.length = 0; },
    copy () { return this.slice (); },
    count (item) { return this.filter ((x) => __eq__ (x, item)).length; },
};
for (const [methods, prototype] of [[__str_methods__, String.prototype], [__list_methods__, Array.prototype]]) {
    for (const [key, value] of Object.entries (methods)) {
        if (!(key in prototype)) Object.defineProperty (prototype, key, { value, writable: true, configurable: true });
    }
}
// A keyword argument's Python name, for **kwargs: Transcrypt renames those that collide with JS or its runtime.
export var __pyname__ = (key) => (key == 'py_metatype' ? 'type' : key.startsWith ('py_') ? key.slice (3) : key);
// A class's __dict__: its own attributes. Transcrypt copies its bases' onto it, so those still the bases' are left out.
Object.defineProperty (Function.prototype, '__dict__', { configurable: true, get () {
    const own = dict (), bases = this.__bases__ ?? [];
    for (const key of Object.keys (this)) {
        const mine = Object.getOwnPropertyDescriptor (this, key);
        const inherited = bases.some ((base) => { const theirs = Object.getOwnPropertyDescriptor (base, key); return theirs && theirs.value === mine.value && theirs.get === mine.get; });
        if (!inherited && !['__metaclass__', '__name__', '__bases__'].includes (key)) own [key] = this [key];
    }
    return own;
} });
// A module with a module-level __getattr__ (PEP 562, bpy.ops) as its importers see it: its names, then __getattr__ (also
// for the None tree.py's stub_boundary gives a name it imports: bpy.types' registered classes).
globalThis.__py_module_getattr__ = (module) => new Proxy (module, { get: (target, key) => (typeof key != 'string' || key.startsWith ('__') || (target [key] ?? null) !== null ? target [key] : target.__getattr__ (key) ?? target [key]) });
// A class attribute's descriptor that can be assigned: a method (a getter) is replaced by the value assigned, on the
// class or the instance assigned to.
function __settable__ (attrib, descrip) {
    if (descrip.get && !descrip.set) descrip.set = function (value) { Object.defineProperty (this, attrib, { value, writable: true, configurable: true, enumerable: true }); };
    return descrip;
}
