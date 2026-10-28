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
    encode () { return String (this); },
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
