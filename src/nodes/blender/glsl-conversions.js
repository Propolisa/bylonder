// GLSL's implicit conversions written out, for GLSL ES, which has none: Blender writes desktop GLSL (4.3), where an int
// meets a float as a float (i + 0.5, radius == 0, color /= count, a float parameter given an int). A shader's text is
// read with the types of its variables, parameters, struct members and functions, and each int or uint operand,
// assigned value, argument or returned value that GLSL 4 converts to a float type is wrapped in that type's
// constructor (float(i), vec2(texel)). What it cannot type is left as it is.

const TOKEN = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?[fF]?|\d+[eE][+-]?\d+[fF]?|0[xX][0-9a-fA-F]+[uU]?|\d+[uU]?|[A-Za-z_]\w*|<<=|>>=|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|[-+*/%&|^]=|[^]/g;
const QUALIFIERS = new Set(['const', 'in', 'out', 'inout', 'uniform', 'highp', 'mediump', 'lowp', 'flat', 'smooth', 'centroid', 'invariant', 'precise']);
const SCALARS = { float: 'f', int: 'i', uint: 'u', bool: 'b' };
const VECTORS = { vec: 'f', ivec: 'i', uvec: 'u', bvec: 'b' };
const BASE = { f: 'float', i: 'int', u: 'uint', b: 'bool' };
const PREFIX = { f: 'vec', i: 'ivec', u: 'uvec', b: 'bvec' };

// A type's component kind (f, i, u, b), its size (1 to 4, columns for a matrix) and whether it is a matrix.
function shape(type) {
  if (!type) return null;
  if (SCALARS[type]) return { kind: SCALARS[type], size: 1 };
  const vector = /^([iub]?vec)([234])$/.exec(type);
  if (vector) return { kind: VECTORS[vector[1]], size: Number(vector[2]) };
  const matrix = /^mat([234])(?:x([234]))?$/.exec(type);
  if (matrix) return { kind: 'f', size: Number(matrix[2] ?? matrix[1]), matrix: true, columns: Number(matrix[1]) };
  return null;
}
const typeOf = (kind, size) => (size === 1 ? BASE[kind] : PREFIX[kind] + size);
const isType = (name, structs) => !!shape(name) || structs.has(name) || /^[iu]?sampler\w+$/.test(name) || name === 'void';

// Built-in functions whose float arguments make int ones floats (genType parameters), and the type they return.
const GENTYPE = new Set(['min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'pow', 'mod', 'atan', 'distance', 'dot', 'cross', 'reflect',
  'refract', 'faceforward', 'fma']);
const FLOAT_OF = new Set(['length', 'distance', 'dot', 'determinant']);
const BOOL_VECTOR = new Set(['lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual']);
// Built-in functions returning their (widest) genType argument's type.
const GENTYPE_RESULT = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'exp2', 'log2', 'sqrt',
  'inversesqrt', 'floor', 'ceil', 'fract', 'round', 'roundEven', 'trunc', 'radians', 'degrees', 'normalize', 'pow', 'mod', 'step', 'smoothstep',
  'mix', 'reflect', 'refract', 'faceforward', 'cross', 'dFdx', 'dFdy', 'fwidth', 'transpose', 'inverse', 'abs', 'sign', 'min', 'max', 'clamp']);
const widest = (values) => values.map((v) => v.type).reduce((a, b) => ((shape(b)?.size ?? 0) > (shape(a)?.size ?? 0) ? b : a), values[0]?.type ?? '?');

export function implicitConversions(source) {
  const tokens = source.match(TOKEN) ?? [];
  const significant = tokens.map((t, i) => (/^\s|^\/[/*]/.test(t) ? -1 : i)).filter((i) => i >= 0);
  const before = new Map(), after = new Map();
  const wrap = (value, type) => {
    before.set(value.start, `${type}(` + (before.get(value.start) ?? ''));
    after.set(value.end, (after.get(value.end) ?? '') + ')');
  };
  // The value as the component kind it is used as, by GLSL 4.60's implicit conversions (4.1.10): int to uint, int and
  // uint to float, and their vectors alike (ivecN to uvecN, ivecN and uvecN to vecN).
  const IMPLICIT = { i: ['u', 'f'], u: ['f'] };
  const toKind = (value, kind) => {
    const s = shape(value.type);
    if (!s || s.matrix || !IMPLICIT[s.kind]?.includes(kind)) return value;
    wrap(value, typeOf(kind, s.size));
    return { ...value, type: typeOf(kind, s.size) };
  };
  // Two operands of different kinds, the one that converts to the other's kind converted.
  const common = (a, b) => {
    const ka = shape(a.type)?.kind, kb = shape(b.type)?.kind;
    if (!ka || !kb || ka === kb) return [a, b];
    return IMPLICIT[ka]?.includes(kb) ? [toKind(a, kb), b] : [a, toKind(b, ka)];
  };

  let p = 0;
  const at = (k = 0) => tokens[significant[p + k]];
  const next = () => tokens[significant[p++]];
  const expect = (t) => { if (at() !== t) throw Error(`expected ${t}, found ${at()}`); return next(); };
  const structs = new Map(), functions = new Map(), scopes = [new Map()];
  const lookup = (name) => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name); return null; };
  const declare = (name, type) => scopes.at(-1).set(name, type);

  // A type as written (qualifiers before it skipped), with an array suffix ([3] or []) as `[]`.
  const readType = () => {
    while (QUALIFIERS.has(at())) next();
    let type = next();
    if (at() === '[') { skipBalanced('[', ']'); type += '[]'; }
    return type;
  };
  const skipBalanced = (open, close) => {
    let depth = 0;
    do {
      const t = next();
      if (t === open) depth++;
      else if (t === close) depth--;
    } while (depth > 0 && p < significant.length);
  };
  const startsDeclaration = () => {
    let k = 0;
    while (QUALIFIERS.has(at(k))) k++;
    if (!isType(at(k) ?? '', structs)) return false;
    k++;
    if (at(k) === '[') { let depth = 0; do { if (at(k) === '[') depth++; else if (at(k) === ']') depth--; k++; } while (depth > 0); }
    return /^[A-Za-z_]\w*$/.test(at(k) ?? '') && at(k + 1) !== '(';
  };

  // Expressions, by precedence; each gives { type, start, end } (token indices), `literal` for a literal.
  const BINARY = [['||'], ['^^'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=']);
  const expression = () => {
    let value = assignment();
    while (at() === ',') { next(); value = assignment(); }
    return value;
  };
  const assignment = () => {
    const left = conditional();
    if (ASSIGN.has(at())) {
      const op = next(), right = assignment(), l = shape(left.type);
      if (l && !['<<=', '>>=', '&=', '|=', '^=', '%='].includes(op)) toKind(right, l.kind);
      return { ...left, end: right.end };
    }
    return left;
  };
  const conditional = () => {
    const condition = binary(0);
    if (at() !== '?') return condition;
    next();
    let a = assignment();
    expect(':');
    let b = assignment();
    [a, b] = common(a, b);
    return { type: a.type, start: condition.start, end: b.end };
  };
  const binary = (level) => {
    if (level === BINARY.length) return unary();
    let left = binary(level + 1);
    while (BINARY[level].includes(at())) {
      const op = next();
      let right = binary(level + 1);
      const l = shape(left.type), r = shape(right.type);
      let type = '?';
      if (['||', '^^', '&&'].includes(op)) type = 'bool';
      else if (l && r) {
        if (!['<<', '>>', '&', '|', '^', '%'].includes(op)) [left, right] = common(left, right);
        const L = shape(left.type), R = shape(right.type);
        if (['==', '!=', '<', '>', '<=', '>='].includes(op)) type = 'bool';
        else if (L.matrix && R.matrix) type = left.type;
        else if (L.matrix) type = R.size > 1 ? typeOf('f', L.size) : left.type;
        else if (R.matrix) type = L.size > 1 ? typeOf('f', R.columns) : right.type;
        else type = L.size >= R.size ? left.type : right.type;
      }
      left = { type, start: left.start, end: right.end };
    }
    return left;
  };
  const unary = () => {
    if (['-', '+', '!', '~', '++', '--'].includes(at())) {
      const start = significant[p], op = next();
      const value = unary();
      return { ...value, type: op === '!' ? 'bool' : value.type, start };
    }
    return postfix(primary());
  };
  const postfix = (value) => {
    for (;;) {
      if (at() === '.') {
        next();
        const field = next(), s = shape(value.type);
        const type = structs.get(value.type)?.get(field) ?? (s && /^[xyzwrgbastpq]{1,4}$/.test(field) ? typeOf(s.kind, field.length) : '?');
        value = { type, start: value.start, end: significant[p - 1] };
      } else if (at() === '[') {
        next();
        expression();
        expect(']');
        const s = shape(value.type);
        const type = value.type.endsWith('[]') ? value.type.slice(0, -2) : s?.matrix ? typeOf('f', s.size) : s && s.size > 1 ? BASE[s.kind] : '?';
        value = { type, start: value.start, end: significant[p - 1] };
      } else if (at() === '++' || at() === '--') {
        next();
        value = { ...value, end: significant[p - 1] };
      } else return value;
    }
  };
  const primary = () => {
    const start = significant[p], t = next();
    if (t === '(') {
      const value = expression();
      expect(')');
      return { type: value.type, start, end: significant[p - 1] };
    }
    if (/^(\d|\.\d)/.test(t)) {
      const type = /[.eE]/.test(t) && !/^0[xX]/.test(t) ? 'float' : /[uU]$/.test(t) ? 'uint' : 'int';
      return { type, start, end: start, literal: true };
    }
    if (t === 'true' || t === 'false') return { type: 'bool', start, end: start, literal: true };
    const array = at() === '[' && isType(t, structs);
    if (array) skipBalanced('[', ']');
    if (at() === '(') return call(array ? `${t}[]` : t, start);
    return { type: lookup(t) ?? '?', start, end: start };
  };
  const call = (name, start) => {
    next();
    const args = [];
    while (at() !== ')') {
      args.push(assignment());
      if (at() === ',') next();
    }
    next();
    const end = significant[p - 1];
    if (isType(name.replace(/\[\]$/, ''), structs)) return { type: name, start, end };
    const overloads = functions.get(name);
    if (overloads) {
      const kinds = args.map((a) => shape(a.type));
      const fits = (params, convert) => params.length === args.length && params.every((param, i) => {
        if (param.type === args[i].type || args[i].type === '?') return true;
        const ps = shape(param.type), as = kinds[i];
        return convert && ps && as && ps.size === as.size && !ps.matrix && IMPLICIT[as.kind]?.includes(ps.kind) && param.qualifier !== 'out' && param.qualifier !== 'inout';
      });
      const chosen = overloads.find((o) => fits(o.params, false)) ?? overloads.find((o) => fits(o.params, true));
      if (chosen) {
        chosen.params.forEach((param, i) => { if (shape(param.type) && !['out', 'inout'].includes(param.qualifier)) toKind(args[i], shape(param.type).kind); });
        return { type: chosen.type, start, end };
      }
      return { type: '?', start, end };
    }
    const shapes = args.map((a) => shape(a.type)), firstFloat = args.find((a, i) => shapes[i]?.kind === 'f');
    if (GENTYPE.has(name) && firstFloat) args.forEach((a) => toKind(a, 'f'));
    if (FLOAT_OF.has(name)) return { type: 'float', start, end };
    if (BOOL_VECTOR.has(name)) return { type: typeOf('b', shapes[0]?.size ?? 1), start, end };
    if (name === 'any' || name === 'all' || name === 'isnan' || name === 'isinf') return { type: shapes[0]?.size > 1 && (name === 'isnan' || name === 'isinf') ? typeOf('b', shapes[0].size) : 'bool', start, end };
    if (GENTYPE_RESULT.has(name)) return { type: widest(firstFloat ? args.filter((a, i) => shapes[i]?.kind === 'f') : args), start, end };
    if (name === 'texture' || name === 'texelFetch' || name === 'textureLod' || name === 'textureGrad' || name === 'textureOffset' || name === 'texelFetchOffset') {
      const sampler = args[0]?.type ?? '';
      return { type: sampler.startsWith('isampler') ? 'ivec4' : sampler.startsWith('usampler') ? 'uvec4' : 'vec4', start, end };
    }
    if (name === 'textureSize') return { type: /3D|Array/.test(args[0]?.type ?? '') ? 'ivec3' : 'ivec2', start, end };
    if (name === 'floatBitsToInt') return { type: typeOf('i', shapes[0]?.size ?? 1), start, end };
    if (name === 'floatBitsToUint') return { type: typeOf('u', shapes[0]?.size ?? 1), start, end };
    if (name === 'intBitsToFloat' || name === 'uintBitsToFloat') return { type: typeOf('f', shapes[0]?.size ?? 1), start, end };
    return { type: '?', start, end };
  };

  // Statements of a function body, with the function's return type.
  const statement = (returns) => {
    const t = at();
    if (t === '{') { block(returns); return; }
    if (t === ';') { next(); return; }
    if (t === 'if' || t === 'while' || t === 'switch') {
      next(); expect('('); expression(); expect(')');
      if (t === 'switch') { block(returns); return; }
      statement(returns);
      if (t === 'if' && at() === 'else') { next(); statement(returns); }
      return;
    }
    if (t === 'for') {
      next(); expect('(');
      scopes.push(new Map());
      if (startsDeclaration()) declaration(); else { if (at() !== ';') expression(); expect(';'); }
      if (at() !== ';') expression();
      expect(';');
      if (at() !== ')') expression();
      expect(')');
      statement(returns);
      scopes.pop();
      return;
    }
    if (t === 'do') { next(); statement(returns); expect('while'); expect('('); expression(); expect(')'); expect(';'); return; }
    if (t === 'case') { next(); expression(); expect(':'); return; }
    if (t === 'default') { next(); expect(':'); return; }
    if (t === 'return') {
      next();
      if (at() !== ';') { const value = expression(), s = shape(returns); if (s) toKind(value, s.kind); }
      expect(';');
      return;
    }
    if (t === 'break' || t === 'continue' || t === 'discard') { next(); expect(';'); return; }
    if (startsDeclaration()) { declaration(); return; }
    expression();
    expect(';');
  };
  const block = (returns) => {
    expect('{');
    scopes.push(new Map());
    while (at() !== '}' && p < significant.length) statement(returns);
    scopes.pop();
    expect('}');
  };
  // A variable declaration (`T a = x, b[2];`), each initializer given the declared type.
  const declaration = () => {
    const type = readType();
    for (;;) {
      const name = next();
      let own = type;
      if (at() === '[') { skipBalanced('[', ']'); own = type.endsWith('[]') ? type : type + '[]'; }
      declare(name, own);
      if (at() === '=') {
        next();
        const value = assignment(), s = shape(own);
        if (s) toKind(value, s.kind);
      }
      if (at() !== ',') break;
      next();
    }
    expect(';');
  };

  // Top level: precision statements, structs, globals and functions.
  const parameters = () => {
    const params = [];
    expect('(');
    while (at() !== ')') {
      let qualifier = 'in';
      while (QUALIFIERS.has(at())) { const q = next(); if (q === 'out' || q === 'inout') qualifier = q; }
      let type = next();
      if (type === 'void' && at() === ')') break;
      const name = /^[A-Za-z_]\w*$/.test(at()) ? next() : null;
      if (at() === '[') { skipBalanced('[', ']'); type += '[]'; }
      params.push({ type, name, qualifier });
      if (at() === ',') next();
    }
    next();
    return params;
  };
  while (p < significant.length) {
    const t = at();
    if (t === 'precision') { while (next() !== ';'); continue; }
    if (t === 'struct') {
      next();
      const name = next(), members = new Map();
      expect('{');
      while (at() !== '}') {
        const type = readType();
        for (;;) {
          const member = next();
          members.set(member, at() === '[' ? (skipBalanced('[', ']'), type + '[]') : type);
          if (at() !== ',') break;
          next();
        }
        expect(';');
      }
      next();
      structs.set(name, members);
      while (at() !== ';') next();
      next();
      continue;
    }
    const save = p;
    let k = 0;
    while (QUALIFIERS.has(at(k))) k++;
    if (/^[A-Za-z_]\w*$/.test(at(k) ?? '') && /^[A-Za-z_]\w*$/.test(at(k + 1) ?? '') && at(k + 2) === '(') {
      const type = readType(), name = next(), params = parameters();
      if (!functions.has(name)) functions.set(name, []);
      if (!functions.get(name).some((o) => o.params.map((x) => x.type).join() === params.map((x) => x.type).join())) functions.get(name).push({ type, params });
      if (at() === ';') { next(); continue; }
      scopes.push(new Map(params.filter((x) => x.name).map((x) => [x.name, x.type])));
      try { block(type); } catch { skipTo(save); }
      scopes.length = 1;
      continue;
    }
    if (startsDeclaration()) { try { declaration(); } catch { while (p < significant.length && next() !== ';'); } continue; }
    next();
  }
  function skipTo(from) {
    // A function the reader could not follow is left as written: to its closing brace.
    p = from;
    while (at() !== '{') next();
    skipBalanced('{', '}');
  }
  return tokens.map((t, i) => (before.get(i) ?? '') + t + (after.get(i) ?? '')).join('');
}
