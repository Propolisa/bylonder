// Rough C++ to JS port of Blender functions, for a first draft to verify and fix by hand. It applies the port's
// conventions so every port reads the same:
// - BMesh elements are indices into bm's pools (-1 for none): `e->v1` is `bm.e.v1[e]`, `v->co` is `vco(bm, v)`.
// - Vectors are [x, y, z] arrays used as values: `copy_v3_v3(a, b)` is `a = [...b]`, `add_v3_v3v3(r, a, b)` is
//   `r = add_v3(a, b)`.
// - Out parameters (`r_*`, `**`, and vector parameters the function writes) are returned: alone for a void function
//   with one, the out or null for a bool function with one, else as [return value, ...outs] in parameter order.
// - Iterators are the arrays of bmesh-query.js: `BM_ITER_ELEM (e, &iter, v, BM_EDGES_OF_VERT)` is
//   `for (const e of BM_EDGES_OF_VERT(bm, v))`.
// Whatever it cannot map is marked `/*FIX*/`.
// Usage: node tools/blender-port/cc2js.mjs FILE.cc FIRST_LINE LAST_LINE
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Parser = require('web-tree-sitter');

const BM_TYPES = new Set(['BMVert', 'BMEdge', 'BMFace', 'BMLoop', 'BMElem', 'BMHeader']);
const BM_FIELDS = {
  BMVert: { e: 'BMEdge*', head: 'BMHeader' },
  BMEdge: { v1: 'BMVert*', v2: 'BMVert*', l: 'BMLoop*', head: 'BMHeader' },
  BMLoop: { v: 'BMVert*', e: 'BMEdge*', f: 'BMFace*', next: 'BMLoop*', prev: 'BMLoop*', radial_next: 'BMLoop*', radial_prev: 'BMLoop*', head: 'BMHeader' },
  BMFace: { len: 'int', l_first: 'BMLoop*', mat_nr: 'short', head: 'BMHeader' },
};
const POOL = { BMVert: 'v', BMEdge: 'e', BMFace: 'f', BMLoop: 'l' };
const VEC_FIELDS = { BMVert: { co: 'vco', no: 'vno' }, BMFace: { no: 'fno' } };

// fn(out, ...args) to `out = js(...args)`.
const OUT_FIRST = {
  copy_v3_v3: (a) => `[...${a[0]}]`, copy_v3_v3_db: (a) => `[...${a[0]}]`, copy_v2_v2: (a) => `[...${a[0]}]`,
  copy_v3_fl: (a) => `[${a[0]}, ${a[0]}, ${a[0]}]`, copy_v3_fl3: (a) => `[${a.join(', ')}]`,
  add_v3_v3v3: 'add_v3', sub_v3_v3v3: 'sub_v3', mul_v3_v3fl: 'mul_v3_fl', madd_v3_v3v3fl: 'madd', cross_v3_v3v3: 'cross_v3',
  interp_v3_v3v3: 'interp_v3', mid_v3_v3v3: 'mid_v3', negate_v3_v3: 'negate', normalize_v3_v3: 'normalize_v3',
  closest_to_line_segment_v3: 'closest_to_line_segment_v3', closest_to_plane_v3: 'closest_to_plane_v3',
  closest_to_line_v3: 'closest_to_line_v3', plane_from_point_normal_v3: 'plane_from_point_normal_v3',
  mul_v3_m4v3: 'mul_m4_v3', mul_v2_m3v3: 'mul_v2_m3v3', axis_dominant_v3_to_m3: 'axis_dominant_v3_to_m3',
  project_v3_v3v3: 'project_v3_v3v3', project_plane_normalized_v3_v3v3: 'project_plane_normalized_v3_v3v3',
  invert_m4_m4: 'invert_m4_m4', unit_m4: () => 'unit_m4()', zero_v3: () => '[0, 0, 0]', mul_v3_m3v3: 'mul_m3_v3',
};
// fn(inout, ...args) to `inout = js(inout, ...args)`.
const IN_OUT = {
  add_v3_v3: 'add_v3', sub_v3_v3: 'sub_v3', mul_v3_fl: 'mul_v3_fl', madd_v3_v3fl: 'madd', negate_v3: 'negate',
  normalize_v3: 'normalize_v3', mul_m4_v4: 'mul_m4_v4', mul_m4_v3: 'mul_m4_v3',
};
// Library functions with out parameters past the first, as their positions; they follow the same return rule.
const LIB_OUTS = {
  isect_line_line_v3: { ret: 'int', outs: [4, 5] }, isect_line_line_epsilon_v3: { ret: 'int', outs: [4, 5] },
  isect_line_plane_v3: { ret: 'bool', outs: [0] }, isect_ray_plane_v3: { ret: 'bool', outs: [2] },
};
const RENAME = {
  'std::min': 'Math.min', 'std::max': 'Math.max', 'std::abs': 'Math.abs', 'std::sqrt': 'Math.sqrt', 'math::min': 'Math.min', 'math::max': 'Math.max',
  dot_v3v3: 'dot_v3', len_v3: 'len_v3', len_squared_v3: 'len_squared_v3', fabsf: 'Math.abs', fabs: 'Math.abs', sqrtf: 'Math.sqrt',
  sqrt: 'Math.sqrt', cosf: 'Math.cos', sinf: 'Math.sin', tanf: 'Math.tan', acosf: 'Math.acos', asinf: 'Math.asin', atan2f: 'Math.atan2',
  powf: 'Math.pow', pow: 'Math.pow', floorf: 'Math.floor', ceilf: 'Math.ceil', min_ff: 'Math.min', max_ff: 'Math.max', min_ii: 'Math.min',
  max_ii: 'Math.max', min_dd: 'Math.min', max_dd: 'Math.max', fmaxf: 'Math.max', fminf: 'Math.min', expf: 'Math.exp', logf: 'Math.log',
  saacos: 'saacos', safe_acosf: 'saacos',
};
const SPECIAL = {
  len_v3v3: (a) => `len_v3(sub_v3(${a[0]}, ${a[1]}))`, len_squared_v3v3: (a) => `len_squared_v3(sub_v3(${a[0]}, ${a[1]}))`,
  compare_ff: (a) => `Math.abs(${a[0]} - ${a[1]}) <= ${a[2]}`, BLI_assert: () => null, UNUSED_VARS: () => null,
  BLI_array_alloca: (a) => `new Array(${a[1]})`, ELEM: (a) => `(${a.slice(1).map((x) => `${a[0]} === ${x}`).join(' || ')})`,
  float: (a) => a[0], double: (a) => a[0], int: (a) => `Math.trunc(${a[0]})`, bool: (a) => `!!(${a[0]})`, short: (a) => `Math.trunc(${a[0]})`,
  BM_elem_index_get: (a) => a[0],
};
const CONSTANTS = { M_PI: 'Math.PI', M_PI_2: 'Math.PI / 2', M_PI_4: 'Math.PI / 4', M_SQRT2: 'Math.SQRT2', M_SQRT1_2: 'Math.SQRT1_2', M_SQRT3: 'Math.sqrt(3)', M_SQRT1_3: 'Math.sqrt(1 / 3)', FLT_MAX: 'Number.MAX_VALUE', FLT_EPSILON: '1.1920929e-7', INT_MAX: '2147483647', nullptr: 'null', NULL: 'null', true: 'true', false: 'false' };
const VECTOR_METHODS = { append: 'push', size: 'length', is_empty: null, last: 'at(-1)', clear: null, data: null, first: '[0]', remove_last: 'pop', as_span: null };

const typeText = (node) => node.text.replace(/\bconst\b|\bstruct\b/g, '').replace(/\s+/g, '');
const baseType = (t) => t?.replace(/[*&]|\[.*$/g, '');
const isBM = (t) => !!t && BM_TYPES.has(baseType(t)) && /\*$/.test(t) && !/\*\*$/.test(t);
const isVec = (t) => !!t && (/^(float|double)\[/.test(t) || t === 'float*' || t === 'double*');
const isInt = (t) => /^(int|short|uint|char|bool|int\d+_t)$/.test(t ?? '');

// The declared name and C type of a (possibly nested) declarator.
function declName(decl, base) {
  let t = base, d = decl;
  for (;;) {
    if (!d) return [null, t];
    if (d.type === 'identifier' || d.type === 'field_identifier') return [d.text, t];
    if (d.type === 'pointer_declarator') { t += '*'; d = d.childForFieldName('declarator'); }
    else if (d.type === 'reference_declarator' || d.type === 'parenthesized_declarator') d = d.namedChildren[0];
    else if (d.type === 'array_declarator') {
      const sizes = [];
      while (d.type === 'array_declarator') { sizes.unshift(d.childForFieldName('size')?.text ?? ''); d = d.childForFieldName('declarator'); }
      const [name, inner] = declName(d, t);
      return [name, `${inner}[${sizes.join('][')}]`];
    } else if (d.type === 'init_declarator') d = d.childForFieldName('declarator');
    else if (d.type === 'function_declarator') d = d.childForFieldName('declarator');
    else return [d.text, t];
  }
}

function zeroValue(t, value) {
  const dims = (t.match(/\[(\w*)\]/g) ?? []).map((s) => s.slice(1, -1));
  if (dims.length === 1 && /^\d+$/.test(dims[0])) return `[${Array(+dims[0]).fill(value ?? 0).join(', ')}]`;
  if (dims.length === 2) return `Array.from({ length: ${dims[0] || 0} }, () => ${zeroValue(`f[${dims[1]}]`, value)})`;
  if (dims.length) return `new Array(${dims[0]})`;
  return null;
}

export function convert(src, first, last) {
  const lines = src.split('\n');
  const prepared = lines.map((line) => line
    .replace(/((?:\b[a-z_]\w*(?:->|\.))*\b[a-z_]\w*)\s<\s/g, '($1) < ')
    .replace(/\*\((\w+)\[(\w+)\]\)/g, '*$1[$2]')
    .replace(/BM_ITER_(?:ELEM|MESH)\s*\((\w+),\s*&?\w+,\s*bm,\s*(BM_\w+_OF_MESH)\)/g, 'for (auto $1 : $2(bm))')
    .replace(/BM_ITER_ELEM\s*\((\w+),\s*&?\w+,\s*([^,]+?),\s*(BM_\w+)\)/g, 'for (auto $1 : $3(bm, $2))')
    .replace(/BM_ITER_(?:ELEM|MESH)_INDEX\s*\((\w+),\s*&?\w+,\s*(\w+),\s*(BM_\w+),\s*(\w+)\)/g, 'for (auto $1 : $3(bm, $2)) /*FIX index $4*/'));
  const text = prepared.join('\n');
  const tree = parser.parse(text);
  const structs = collectStructs(tree.rootNode);
  const funcs = collectFunctions(tree.rootNode);
  const out = [];
  for (const fn of functionNodes(tree.rootNode)) new FunctionEmitter(fn, structs, funcs).emit();
  for (const fn of functionNodes(tree.rootNode)) {
    const line = fn.startPosition.row + 1;
    if (line < first || line > last) continue;
    out.push(new FunctionEmitter(fn, structs, funcs).emit());
  }
  return out.join('\n\n');
}

// The function definitions at file scope, inside namespaces too.
function functionNodes(root) {
  return root.namedChildren.flatMap((n) => (n.type === 'function_definition' ? [n] : n.type === 'namespace_definition' || n.type === 'declaration_list' || n.type === 'linkage_specification' ? functionNodes(n.childForFieldName('body') ?? n) : []));
}

function collectStructs(root) {
  const structs = {};
  const visit = (n) => {
    if ((n.type === 'struct_specifier' || n.type === 'class_specifier') && n.childForFieldName('body')) {
      const fields = {};
      for (const f of n.childForFieldName('body').namedChildren) {
        if (f.type !== 'field_declaration') continue;
        const base = typeText(f.childForFieldName('type'));
        for (const d of f.childrenForFieldName('declarator')) { const [name, t] = declName(d, base); if (name) fields[name] = t; }
      }
      structs[n.childForFieldName('name')?.text] = fields;
    }
    n.namedChildren.forEach(visit);
  };
  visit(root);
  return structs;
}

const WRITERS = [...Object.keys(OUT_FIRST), ...Object.keys(IN_OUT)].join('|');

// 'out' for a parameter the function only writes, 'inout' for one it reads first, null for an input. Outputs are
// r_* pointers and arrays, and vector arrays the function writes.
function outKind(p, body) {
  if (!/^\w+$/.test(p.name ?? '')) return null;
  const pointer = /[*\]]$/.test(p.type), named = /^(?:r|ret)_|^r$/.test(p.name);
  const write = new RegExp(`\\b(?:${WRITERS})\\(\\s*${p.name}\\b|(?:^|[^\\w.>])\\*?${p.name}(?:\\[[^\\]]+\\])?\\s*=[^=]`, 'm');
  if (!(named && pointer) && !(isVec(p.type) && write.test(body))) return null;
  const optionalTest = new RegExp(`(?:if \\(|&& |\\|\\| )!?${p.name}(?: != nullptr)?\\)?`, 'g');
  const uses = body.replace(optionalTest, '').split(new RegExp(`(?=\\b${p.name}\\b)`)).slice(1);
  if (!uses.length) return 'out';
  const before = body.replace(optionalTest, '').slice(0, body.replace(optionalTest, '').indexOf(uses[0]));
  const firstIsWrite = new RegExp(`(?:\\b(?:${Object.keys(OUT_FIRST).join('|')})\\(\\s*|\\*)${p.name}\\b|^\\s*\\*?${p.name}(?:\\[[^\\]]+\\])?\\s*=[^=]`, 'm').test(before.slice(-40).split('\n').at(-1) + uses[0].split('\n')[0]);
  return firstIsWrite || /^(?:r|ret)_/.test(p.name) && !/\*\*$/.test(p.type) ? 'out' : 'inout';
}

// Each function's return type and which parameters are outputs.
function collectFunctions(root) {
  const funcs = {};
  for (const [name, { ret, outs }] of Object.entries(LIB_OUTS)) {
    const params = Array.from({ length: Math.max(...outs) + 1 }, (_, i) => ({ name: `p${i}`, type: 'float*', out: outs.includes(i) ? 'out' : null }));
    funcs[name] = { ret, params, outs: params.filter((p) => p.out), lib: true };
  }
  for (const fn of functionNodes(root)) {
    let d = fn.childForFieldName('declarator'), ret = typeText(fn.childForFieldName('type'));
    while (d.type === 'pointer_declarator') { ret += '*'; d = d.childForFieldName('declarator'); }
    const name = d.childForFieldName('declarator').text;
    const params = d.childForFieldName('parameters').namedChildren.filter((p) => p.type === 'parameter_declaration' && !/mem_arena/.test(p.text)).map((p) => {
      const [pname, t] = declName(p.childForFieldName('declarator'), typeText(p.childForFieldName('type')));
      return { name: pname, type: t };
    });
    const body = fn.childForFieldName('body').text;
    for (const p of params) p.out = outKind(p, body);
    funcs[name] = { ret, params, outs: params.filter((p) => p.out) };
  }
  return funcs;
}

class FunctionEmitter {
  constructor(node, structs, funcs) {
    Object.assign(this, { node, structs, funcs, scopes: [{}], temps: 0 });
  }

  emit() {
    const d = this.node.childForFieldName('declarator');
    let fd = d;
    while (fd.type === 'pointer_declarator') fd = fd.childForFieldName('declarator');
    const name = fd.childForFieldName('declarator').text;
    this.sig = this.funcs[name];
    for (const p of this.sig.params) this.declare(p.name, p.type);
    const params = this.sig.params.filter((p) => p.out !== 'out').map((p) => p.name);
    const prologue = this.sig.params.filter((p) => p.out === 'out').map((p) => {
      const t = p.type.replace(/\*$/, '');
      const v = zeroValue(t) ?? (/\*$/.test(p.type) && !/\*\*$/.test(p.type) && !BM_TYPES.has(baseType(p.type)) ? '[]' : isBM(t) ? '-1' : null);
      return `let ${p.name}${v ? ` = ${v}` : ''};`;
    });
    let body = this.block(this.node.childForFieldName('body'), 1);
    body = foldDeclarations(body);
    if (this.sig.outs.length && this.sig.ret === 'void') body = body.replace(/\n}$/, `\n  ${this.returnOuts(null)};\n}`);
    if (/\bbm\b/.test(body) && !params.includes('bm')) {
      if (params.includes('bp')) prologue.unshift('const { bm } = bp;');
      else { params.unshift('bm'); this.sig.needsBm = true; }
    }
    body = body.replace(/^(\s*)(let|const) (\w+) = (.*) \/\*FIX alias\*\/;$/gm, (all, pad, kind, name, v) => (new RegExp(`\\b${name}\\s*=[^=]|\\b${name}\\[[^\\]]*\\]\\s*=[^=]`).test(body.slice(body.indexOf(all) + all.length)) ? all : `${pad}${kind} ${name} = ${v};`));
    body = body.replace(/(?<![\w\])])\(([\w.]+)\)(?= [<>=!]=? )/g, '$1');
    if (this.temps) prologue.push(`let ${Array.from({ length: this.temps }, (_, i) => `_r${i}`).join(', ')};`);
    if (prologue.length) body = body.replace('{\n', `{\n${prologue.map((s) => `  ${s}\n`).join('')}`);
    return `function ${name}(${params.join(', ')}) ${body}`;
  }

  returnOuts(value) {
    const outs = this.sig.outs.map((p) => p.name);
    if (this.sig.ret === 'void') return `return ${outs.length === 1 ? outs[0] : `[${outs.join(', ')}]`}`;
    if (this.sig.ret === 'bool' && outs.length === 1) return value === 'true' ? `return ${outs[0]}` : value === 'false' ? 'return null' : `return ${value} ? ${outs[0]} : null`;
    return `return [${value}, ${outs.join(', ')}]`;
  }

  declare(name, type) { this.scopes.at(-1)[name] = type; }
  lookup(name) { for (let i = this.scopes.length - 1; i >= 0; i--) if (name in this.scopes[i]) return this.scopes[i][name]; return undefined; }

  block(node, depth) {
    this.scopes.push({});
    const inner = node.namedChildren.map((s) => this.stmt(s, depth)).filter((s) => s != null);
    this.scopes.pop();
    return `{\n${inner.join('\n')}\n${'  '.repeat(depth - 1)}}`;
  }

  body(node, depth) {
    return node.type === 'compound_statement' ? this.block(node, depth + 1) : this.block({ namedChildren: [node] }, depth + 1);
  }

  stmt(n, depth) {
    const pad = '  '.repeat(depth);
    switch (n.type) {
      case 'comment': case 'preproc_ifdef': case 'preproc_call': case 'preproc_if': return null;
      case 'preproc_def': return `${pad}const ${n.childForFieldName('name').text} = ${n.childForFieldName('value')?.text.trim()};`;
      case 'compound_statement': return pad + this.block(n, depth + 1);
      case 'declaration': return this.declaration(n).map((s) => pad + s).join('\n') || null;
      case 'expression_statement': {
        const e = n.namedChildren[0];
        if (!e) return null;
        const s = this.exprStatement(e);
        return s == null ? null : `${pad}${s};`;
      }
      case 'return_statement': {
        const e = n.namedChildren[0];
        const v = e ? this.expr(e, this.sig.ret) : null;
        if (this.sig.outs.length) return `${pad}${this.returnOuts(v)};`;
        return `${pad}return${v != null ? ` ${v}` : ''};`;
      }
      case 'if_statement': {
        const cond = unparen(this.cond(n.childForFieldName('condition').namedChildren.at(-1)));
        let s = `${pad}if (${cond}) ${this.body(n.childForFieldName('consequence'), depth)}`;
        const alt = n.childForFieldName('alternative');
        if (alt) {
          const a = alt.type === 'else_clause' ? alt.namedChildren[0] : alt;
          s += a.type === 'if_statement' ? ` else ${this.stmt(a, depth).trimStart()}` : ` else ${this.body(a, depth)}`;
        }
        return s;
      }
      case 'for_statement': {
        this.scopes.push({});
        const init = n.childForFieldName('initializer');
        const initJs = !init ? '' : init.type === 'declaration' ? this.declaration(init, true).join(' ').replace(/;$/, '') : this.expr(init);
        const cond = n.childForFieldName('condition');
        const upd = n.childForFieldName('update');
        const s = `${pad}for (${initJs}; ${cond ? this.cond(cond) : ''}; ${upd ? this.expr(upd) : ''}) ${this.body(n.childForFieldName('body'), depth)}`;
        this.scopes.pop();
        return s;
      }
      case 'for_range_loop': {
        this.scopes.push({});
        const name = n.childForFieldName('declarator').text.replace(/[*&]/g, '');
        const right = n.childForFieldName('right');
        const m = /^(BM_(\w+)S?_OF_\w+)$/.exec(right.childForFieldName?.('function')?.text ?? '');
        this.declare(name, m ? { VERT: 'BMVert*', EDGE: 'BMEdge*', FACE: 'BMFace*', LOOP: 'BMLoop*' }[m[2].replace(/S$/, '')] : this.elemType(this.typeOf(right)));
        const s = `${pad}for (const ${name} of ${this.expr(right)}) ${this.body(n.childForFieldName('body'), depth)}`;
        this.scopes.pop();
        return s;
      }
      case 'while_statement': return `${pad}while (${this.cond(n.childForFieldName('condition').namedChildren.at(-1))}) ${this.body(n.childForFieldName('body'), depth)}`;
      case 'do_statement': return `${pad}do ${this.body(n.childForFieldName('body'), depth)} while (${this.cond(n.childForFieldName('condition').namedChildren.at(-1))});`;
      case 'break_statement': return `${pad}break;`;
      case 'continue_statement': return `${pad}continue;`;
      case 'switch_statement': {
        const cases = n.childForFieldName('body').namedChildren.filter((c) => c.type === 'case_statement').map((c) => {
          const v = c.childForFieldName('value');
          const head = v ? `case ${this.expr(v)}:` : 'default:';
          const stmts = c.namedChildren.filter((x) => x.startIndex !== v?.startIndex).map((x) => this.stmt(x, depth + 2)).filter((x) => x != null);
          return `${pad}  ${head}\n${stmts.join('\n')}`;
        });
        return `${pad}switch (${this.expr(n.childForFieldName('condition').namedChildren.at(-1))}) {\n${cases.join('\n')}\n${pad}}`;
      }
      default: return `${pad}/*FIX ${n.type}*/ ${n.text.replace(/\s+/g, ' ')}`;
    }
  }

  declaration(n, inFor = false) {
    const base = typeText(n.childForFieldName('type'));
    const out = [];
    if (/^(BMIter|MemArena\*?|BMOIter)$/.test(base)) return out;
    for (const d of n.childrenForFieldName('declarator')) {
      const [name, t] = declName(d, base);
      const value = d.type === 'init_declarator' ? d.childForFieldName('value') : null;
      this.declare(name, t);
      let v;
      if (value?.type === 'initializer_list') {
        const items = value.namedChildren.filter((x) => x.type !== 'comment').map((x) => this.expr(x));
        v = zeroValue(t, items.length === 1 ? items[0] : undefined) && items.length <= 1 ? zeroValue(t, items[0] ?? 0) : `[${items.join(', ')}]`;
      } else if (value) v = this.expr(value, t);
      else if (/^(Vector|Array|blender::Vector)/.test(t)) v = '[]';
      else v = zeroValue(t) ?? (isBM(t) ? '-1' : null);
      if (!inFor && t.endsWith('*') && value && /->|\./.test(value.text) && isVec(t)) v += ' /*FIX alias*/';
      out.push(`let ${name}${v != null ? ` = ${v}` : ''};`);
    }
    return out;
  }

  elemType(t) { return t?.replace(/^(?:blender::)?(?:Vector|Array|Span)<([^,>]+).*$/, '$1').replace(/\[\w*\]$/, '').replace(/\*$/, (s) => (t.includes('[') ? '' : s)); }

  typeOf(n) {
    switch (n.type) {
      case 'identifier': return this.lookup(n.text);
      case 'parenthesized_expression': return this.typeOf(n.namedChildren[0]);
      case 'field_expression': {
        const at = this.typeOf(n.childForFieldName('argument'));
        const st = baseType(at), f = n.childForFieldName('field').text;
        return (BM_FIELDS[st] ?? this.structs[st])?.[f] ?? (VEC_FIELDS[st]?.[f] ? 'float[3]' : undefined);
      }
      case 'subscript_expression': {
        const at = this.typeOf(n.childForFieldName('argument'));
        if (!at) return undefined;
        if (/\]$/.test(at)) return at.replace(/\[\w*\]$/, '');
        if (/^(?:blender::)?(?:Vector|Array|Span)</.test(at)) return this.elemType(at);
        return at.replace(/\*$/, '');
      }
      case 'pointer_expression': {
        const at = this.typeOf(n.childForFieldName('argument'));
        return n.child(0).type === '&' ? `${at}*` : at?.replace(/\*$/, '');
      }
      case 'call_expression': {
        const f = n.childForFieldName('function').text;
        if (this.funcs[f]) return this.funcs[f].ret;
        if (/^BM_\w+_(?:other_vert|share_vert|exists)/.test(f) || /_vert$/.test(f) && f.startsWith('BM_')) return 'BMVert*';
        if (/^BM_.*(?:edge_exists|_edge$)/.test(f)) return 'BMEdge*';
        if (/^BM_.*loop/.test(f)) return 'BMLoop*';
        if (/^BM_.*face(?:_create.*|_exists|_split)?$/.test(f)) return 'BMFace*';
        return undefined;
      }
      case 'number_literal': return /[.eE]/.test(n.text) && !/^0x/.test(n.text) ? 'float' : 'int';
      case 'binary_expression': {
        if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(n.child(1).type)) return 'bool';
        const a = this.typeOf(n.childForFieldName('left')), b = this.typeOf(n.childForFieldName('right'));
        return isInt(a) && isInt(b) ? 'int' : a === 'float' || b === 'float' ? 'float' : a ?? b;
      }
      default: return undefined;
    }
  }

  // The JS of n read as a condition: BMesh elements test against -1.
  cond(n) {
    const t = this.typeOf(n);
    if (n.type === 'unary_expression' && n.child(0).type === '!') {
      const a = n.childForFieldName('argument');
      if (isBM(this.typeOf(a))) return `${this.expr(a)} < 0`;
      return `!${this.wrap(this.cond(a), a)}`;
    }
    if (n.type === 'binary_expression' && ['&&', '||'].includes(n.child(1).type)) {
      const op = n.child(1).type;
      return `${this.wrapCond(n.childForFieldName('left'), op)} ${op} ${this.wrapCond(n.childForFieldName('right'), op)}`;
    }
    if (n.type === 'parenthesized_expression') return `(${this.cond(n.namedChildren[0])})`;
    if (isBM(t) && n.type !== 'assignment_expression') return `${this.expr(n)} >= 0`;
    if (n.type === 'assignment_expression' && isBM(t ?? this.typeOf(n.childForFieldName('left')))) return `(${this.expr(n)}) >= 0`;
    return this.expr(n);
  }
  wrapCond(n, op) {
    const s = this.cond(n);
    return n.type === 'binary_expression' && ['&&', '||'].includes(n.child(1).type) && n.child(1).type !== op ? `(${s})` : s;
  }
  wrap(s, n) { return ['identifier', 'field_expression', 'subscript_expression', 'call_expression', 'parenthesized_expression', 'number_literal'].includes(n.type) ? s : `(${s})`; }

  bmAccess(argNode, field) {
    const st = baseType(this.typeOf(argNode));
    const a = this.expr(argNode);
    if (VEC_FIELDS[st]?.[field]) return `${VEC_FIELDS[st][field]}(bm, ${a})`;
    if (field === 'head') return a;
    return `bm.${POOL[st]}.${field}[${a}]`;
  }

  // An assignment of the JS value v to the C lvalue n.
  assign(n, v) {
    if (n.type === 'field_expression' && isBM(this.typeOf(n.childForFieldName('argument')))) {
      const st = baseType(this.typeOf(n.childForFieldName('argument'))), f = n.childForFieldName('field').text;
      if (VEC_FIELDS[st]?.[f]) return `bm.${POOL[st]}.${f}.set(${v}, ${this.expr(n.childForFieldName('argument'))} * 3)`;
    }
    if (n.type === 'pointer_expression' && n.child(0).type === '&') return `${this.expr(n.childForFieldName('argument'))} = ${v}`;
    if (n.type === 'pointer_expression') return `${this.expr(n.childForFieldName('argument'))} = ${v}`;
    return `${this.expr(n)} = ${v}`;
  }

  exprStatement(e) {
    if (e.type === 'call_expression') {
      const f = e.childForFieldName('function').text;
      const args = e.childForFieldName('arguments').namedChildren.filter((x) => x.type !== 'comment');
      if (f in OUT_FIRST) {
        const m = OUT_FIRST[f];
        const rest = args.slice(1).map((x) => this.expr(x));
        if (m === null) return `/*FIX ${f}*/ ${e.text}`;
        return this.assign(args[0], typeof m === 'function' ? m(rest) : `${m}(${rest.join(', ')})`);
      }
      if (f in IN_OUT) {
        const m = IN_OUT[f];
        if (m === null) return `/*FIX ${f}*/ ${e.text}`;
        return this.assign(args[0], `${m}(${args.map((x) => this.expr(x)).join(', ')})`);
      }
      const sig = this.funcs[f];
      if (sig?.outs.length) {
        const targets = sig.outs.map((p) => args[sig.params.indexOf(p)]).map((a) => (a.type === 'pointer_expression' && a.child(0).type === '&' ? a.childForFieldName('argument') : a));
        this.statementCall = true;
        const call = this.call(e);
        this.statementCall = false;
        if (sig.ret === 'void' && targets.length === 1) return this.assign(targets[0], call);
        if (sig.ret === 'bool' && targets.length === 1) return this.assign(targets[0], call);
        const lhs = targets.map((t) => (/^(?:nullptr|NULL)$/.test(t.text) ? '' : this.expr(t)));
        return `[${sig.ret === 'void' ? '' : ', '}${lhs.join(', ')}] = ${call}`.replace(/,(?: ,)*\] =/, '] =');
      }
      if (f === 'BLI_assert' || f === 'UNUSED_VARS') return null;
    }
    if (e.type === 'assignment_expression' && e.child(1).type === '=') return this.assign(e.childForFieldName('left'), this.expr(e.childForFieldName('right'), this.typeOf(e.childForFieldName('left'))));
    return this.expr(e);
  }

  call(n, wantType) {
    const fnode = n.childForFieldName('function');
    const args = n.childForFieldName('arguments').namedChildren.filter((x) => x.type !== 'comment');
    if (fnode.type === 'field_expression') {
      const obj = fnode.childForFieldName('argument'), method = fnode.childForFieldName('field').text;
      const o = this.expr(obj);
      if (method in VECTOR_METHODS) {
        const a = args.map((x) => this.expr(x));
        if (method === 'is_empty') return `${o}.length === 0`;
        if (method === 'clear') return `${o}.length = 0`;
        if (method === 'data' || method === 'as_span') return o;
        if (method === 'size') return `${o}.length`;
        if (method === 'first') return `${o}[0]`;
        return `${o}.${VECTOR_METHODS[method].replace(/\(.*$/, '')}${VECTOR_METHODS[method].includes('(') ? VECTOR_METHODS[method].slice(VECTOR_METHODS[method].indexOf('(')) : `(${a.join(', ')})`}`;
      }
      return `${o}.${method}(${args.map((x) => this.expr(x)).join(', ')})`;
    }
    const f = fnode.text.replace(/^blender::/, '');
    if (/^(?:static|reinterpret|const)_cast</.test(f)) return this.expr(args[0], wantType);
    if (f === 'BLI_memarena_alloc' || f === 'BLI_memarena_calloc' || f === 'MEM_malloc_arrayN' || f === 'MEM_calloc_arrayN') {
      const m = /sizeof\((.*?)\)\s*\*\s*(.*)$/s.exec(args.at(-1).text) ?? /^(.*?)\s*\*\s*sizeof/s.exec(args.at(-1).text);
      return m ? `new Array(${m[2] ?? m[1]})` : '{}';
    }
    if (f === 'memcpy') return `${this.expr(args[0])} = ${this.expr(args[1])}.slice()`;
    if (f === 'normalize_v3' || f === 'normalize_v3_length') {
      const v = this.expr(args[0]), t = `_r${this.temps++}`;
      return `(${t} = len_v3(${v}), ${v} = normalize_v3(${v}), ${t})`;
    }
    if (SPECIAL[f]) return SPECIAL[f](args.map((x) => this.expr(x)));
    if (f in OUT_FIRST || f in IN_OUT) {
      const m = OUT_FIRST[f] ?? IN_OUT[f];
      const rest = (f in OUT_FIRST ? args.slice(1) : args).map((x) => this.expr(x));
      const v = typeof m === 'function' ? m(rest) : `${m}(${rest.join(', ')})`;
      return f in OUT_FIRST && f.startsWith('invert') ? `(${this.expr(args[0])} = ${v})` : `/*FIX ${f} as value*/ ${v}`;
    }
    const sig = this.funcs[f];
    const kept = (sig ? args.filter((_, i) => sig.params[i]?.out !== 'out') : args).filter((a) => !/mem_arena$/.test(a.text));
    const js = kept.map((a, i) => {
      if (a.type === 'pointer_expression' && a.child(0).type === '&') return this.expr(a.childForFieldName('argument'));
      return this.expr(a, sig?.params[i]?.type);
    });
    const name = RENAME[f] ?? f;
    if (sig?.outs.length && !this.statementCall) {
      const targets = sig.outs.map((p) => args[sig.params.indexOf(p)]).map((a) => (a.type === 'pointer_expression' && a.child(0).type === '&' ? a.childForFieldName('argument') : a)).map((t) => (/^(?:nullptr|NULL)$/.test(t.text) ? '' : this.expr(t)));
      const callJs = `${name}(${[...(sig.needsBm ? ['bm'] : []), ...js].join(', ')})`;
      if (targets.every((t) => !t)) return `${callJs}${sig.ret === 'void' ? '' : '[0]'}`;
      if (sig.ret === 'bool' && targets.length === 1) return `(${targets[0]} = ${callJs}) != null`;
      const tmp = `_r${this.temps++}`;
      return `(([${sig.ret === 'void' ? '' : `${tmp}, `}${targets.join(', ')}] = ${callJs}), ${tmp})`;
    }
    if (/^BM_|^BMO_|^bmesh_/.test(f) && !/_OF_/.test(f) && !this.funcs[f]) js.unshift(...this.bmArgs(f, args));
    if (/^MEM_(?:delete|freeN|SAFE_FREE)/.test(f)) return null;
    if (this.funcs[f]?.needsBm) js.unshift('bm');
    return `${name}(${js.join(', ')})`;
  }

  // Blender's BMesh API takes the element; the port's takes the mesh (and the pool for header flags) first.
  bmArgs(f, args) {
    if (/^BM_elem_flag_|^BMO_(?:elem_)?flag_/.test(f)) return [`bm.${POOL[baseType(this.typeOf(args[0]))] ?? '/*FIX pool*/'}`].map((p) => (f.startsWith('BMO_') ? `bm, ${p}` : p)).flatMap((s) => (s.startsWith('bm, ') ? ['bm', s.slice(4)] : [s]));
    return ['bm'];
  }

  expr(n, wantType) {
    switch (n.type) {
      case 'identifier': {
        if (n.text in CONSTANTS) return n.text === 'nullptr' || n.text === 'NULL' ? (isBM(wantType) ? '-1' : 'null') : CONSTANTS[n.text];
        return n.text;
      }
      case 'null': return isBM(wantType) ? '-1' : 'null';
      case 'number_literal': return n.text.replace(/(\d)[fFuUlL]+$/, '$1').replace(/^(\d+)\.$/, '$1').replace(/\.0+$/, '').replace(/^\./, '0.');
      case 'true': case 'false': case 'string_literal': case 'char_literal': return n.text;
      case 'parenthesized_expression': return `(${this.expr(n.namedChildren[0], wantType)})`;
      case 'field_expression': {
        const arg = n.childForFieldName('argument'), field = n.childForFieldName('field').text;
        if (isBM(this.typeOf(arg)) || BM_TYPES.has(baseType(this.typeOf(arg)) ?? '')) {
          if (field === 'index' || field === 'hflag') return `/*FIX head.${field}*/ ${this.expr(arg)}`;
          return this.bmAccess(arg, field);
        }
        if (arg.type === 'field_expression' && arg.childForFieldName('field').text === 'head') return `/*FIX head.${field}*/ ${this.expr(arg)}`;
        return `${this.expr(arg)}.${field}`;
      }
      case 'subscript_expression': {
        const idx = n.childForFieldName('indices') ?? n.childForFieldName('index');
        return `${this.expr(n.childForFieldName('argument'))}[${idx.namedChildren.map((x) => this.expr(x)).join('][')}]`;
      }
      case 'call_expression': return this.call(n, wantType);
      case 'pointer_expression': {
        const a = n.childForFieldName('argument');
        return this.expr(a);
      }
      case 'unary_expression': {
        const op = n.child(0).type, a = n.childForFieldName('argument');
        if (op === '!') return this.cond(n);
        return `${op}${this.wrap(this.expr(a), a)}`;
      }
      case 'update_expression': return n.text.replace(/\s+/g, '');
      case 'binary_expression': {
        const op = n.child(1).type, l = n.childForFieldName('left'), r = n.childForFieldName('right');
        if (op === '&&' || op === '||') return this.cond(n);
        const lt = this.typeOf(l), rt = this.typeOf(r);
        if ((op === '==' || op === '!=') && (r.type === 'null' || r.text === 'nullptr' || r.text === 'NULL')) {
          return isBM(lt) ? `${this.expr(l)} ${op === '==' ? '<' : '>='} 0` : `${this.expr(l)} ${op}= null`;
        }
        const jsOp = op === '==' ? '===' : op === '!=' ? '!==' : op;
        const s = `${this.expr(l)} ${jsOp} ${this.expr(r)}`;
        return op === '/' && isInt(lt) && isInt(rt) ? `Math.trunc(${s})` : s;
      }
      case 'assignment_expression': {
        const op = n.child(1).type, l = n.childForFieldName('left');
        if (op === '=') return this.assign(l, this.expr(n.childForFieldName('right'), this.typeOf(l)));
        return `${this.expr(l)} ${op} ${this.expr(n.childForFieldName('right'))}`;
      }
      case 'conditional_expression': return `${this.cond(n.childForFieldName('condition'))} ? ${this.expr(n.childForFieldName('consequence'), wantType)} : ${this.expr(n.childForFieldName('alternative'), wantType)}`;
      case 'cast_expression': return this.expr(n.childForFieldName('value'), wantType);
      case 'comma_expression': return `${this.expr(n.childForFieldName('left'))}, ${this.expr(n.childForFieldName('right'))}`;
      case 'initializer_list': return `[${n.namedChildren.filter((x) => x.type !== 'comment').map((x) => this.expr(x)).join(', ')}]`;
      case 'sizeof_expression': return `/*FIX sizeof*/ ${n.text}`;
      case 'qualified_identifier': return n.text.replace(/^(?:blender::)?(?:math::)?/, '');
      case 'this': return 'this';
      default: return `/*FIX ${n.type}*/ ${n.text.replace(/\s+/g, ' ')}`;
    }
  }
}

// `let x = [0, 0, 0];` whose next use is `x = value;` is declared there, as const when never reassigned.
// s without parentheses that wrap all of it.
function unparen(s) {
  if (s[0] !== '(' || s.at(-1) !== ')') return s;
  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) if ((depth += s[i] === '(' ? 1 : s[i] === ')' ? -1 : 0) === 0) return s;
  return unparen(s.slice(1, -1));
}

function foldDeclarations(body) {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)let (\w+)(?: = (?:\[[0, ]*\]|-1|null|Array\.from\(.*\)))?;$/.exec(lines[i]);
    if (!m) continue;
    const [, pad, name] = m, word = new RegExp(`\\b${name}\\b`);
    const j = lines.findIndex((l, k) => k > i && word.test(l));
    const a = j > 0 && new RegExp(`^${pad}${name} = (.*);$`).exec(lines[j]);
    if (a && !word.test(a[1])) { lines[j] = `${pad}let ${name} = ${a[1]};`; lines.splice(i--, 1); }
  }
  const text = lines.join('\n');
  return text.replace(/^(\s*)let (\w+)( = .*;)$/gm, (all, pad, name, rest) => {
    const assigned = new RegExp(`(?:^|[^.\\w])${name}\\s*(?:[-+*/%|&^]|<<|>>)?=(?!=)|\\b${name}(?:\\+\\+|--)|(?:\\+\\+|--)${name}\\b|^\\s*\\[[^\\]=]*\\b${name}\\b[^\\]=]*\\] =(?!=)`, 'gm');
    return (text.match(assigned) ?? []).length > 1 ? all : `${pad}const ${name}${rest}`;
  });
}

const parser = await (async () => {
  await Parser.init();
  const p = new Parser();
  p.setLanguage(await Parser.Language.load(require.resolve('tree-sitter-wasms/out/tree-sitter-cpp.wasm')));
  return p;
})();

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [file, first = 1, last = Infinity] = process.argv.slice(2);
  process.stdout.write(`${convert(readFileSync(file, 'utf8'), +first, +last)}\n`);
}
