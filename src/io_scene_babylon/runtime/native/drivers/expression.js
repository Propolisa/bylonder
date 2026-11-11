// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Driver simple expressions (prior/drivers-spec/expressions.md), compiled to a JS function. The source is parsed into
// a tree and JS is generated from the tree only (numbers re-printed, names mapped to variable slots), so no user text
// reaches the generated code. An expression outside the subset is reported as python-only and never evaluated.
//
// compileExpression(text, variableNames) -> { ok: true, fn(vars, frame) -> number } | { ok: false, reason }
// fn returns the double result; driverResult() applies the spec's float32 rules (section 6).

const KEYWORDS = new Set(['and', 'or', 'not', 'if', 'else']);
const FUNCTIONS = {
  min: [1, Infinity], max: [1, Infinity], radians: [1, 1], degrees: [1, 1], abs: [1, 1], fabs: [1, 1],
  floor: [1, 1], ceil: [1, 1], trunc: [1, 1], int: [1, 1], round: [1, 1], sin: [1, 1], cos: [1, 1], tan: [1, 1],
  asin: [1, 1], acos: [1, 1], atan: [1, 1], exp: [1, 1], sqrt: [1, 1], log: [1, 2], atan2: [2, 2], pow: [2, 2],
  fmod: [2, 2], lerp: [3, 3], clamp: [1, 3], smoothstep: [3, 3],
};
const CONSTANTS = { pi: 'Math.PI', True: '1', False: '0' };
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export const isValidVariableName = (n) => VALID_NAME.test(n) && !KEYWORDS.has(n);

class PythonOnly extends Error {}
const reject = (why) => { throw new PythonOnly(why); };

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f';
  while (i < src.length) {
    const c = src[i];
    if (isSpace(c)) { i++; continue; }
    if (c.charCodeAt(0) > 127) reject('non-ASCII character');
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      const text = num[0];
      const next = src[i + text.length];
      // A letter e or E right after a number always starts an exponent; a malformed one is an error.
      if (next === 'e' || next === 'E' || next === '.') reject(`malformed number at ${i}`);
      if (/^0\d+$/.test(text) && !/^0+$/.test(text)) reject('leading zero');
      tokens.push({ t: 'num', v: Number(text) });
      i += text.length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (name) { tokens.push({ t: KEYWORDS.has(name[0]) ? name[0] : 'name', v: name[0] }); i += name[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>='].includes(two)) { tokens.push({ t: 'cmp', v: two }); i += 2; continue; }
    if (c === '<' || c === '>') { tokens.push({ t: 'cmp', v: c }); i++; continue; }
    if ('+-*/(),'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    reject(`unsupported character ${JSON.stringify(c)}`);
  }
  return tokens;
}

// Recursive descent over the grammar of expressions.md section 3, producing JS source with helper calls.
function parse(tokens, variables) {
  let p = 0;
  const peek = () => tokens[p];
  const take = (t) => (tokens[p]?.t === t ? tokens[p++] : null);
  const expect = (t) => take(t) ?? reject(`expected ${t}`);

  function expr() {
    const a = orTest();
    if (!take('if')) return a;
    const cond = orTest();
    expect('else');
    const b = expr();
    return `(T(${cond})?${a}:${b})`;
  }
  function orTest() {
    let a = andTest();
    while (take('or')) a = `OR(${a},()=>${andTest()})`;
    return a;
  }
  function andTest() {
    let a = notTest();
    while (take('and')) a = `AND(${a},()=>${notTest()})`;
    return a;
  }
  function notTest() {
    if (take('not')) return `(T(${notTest()})?0:1)`;
    return comparison();
  }
  function comparison() {
    const first = sum();
    if (peek()?.t !== 'cmp') return first;
    // Chained comparisons: a op1 b op2 c is (a op1 b) and (b op2 c), stopping at the first false link.
    const ops = [], operands = [first];
    while (peek()?.t === 'cmp') { ops.push(tokens[p++].v); operands.push(sum()); }
    return `CMP([${ops.map((o) => JSON.stringify(o)).join(',')}],[${operands.map((o) => `()=>${o}`).join(',')}])`;
  }
  function sum() {
    let a = term();
    for (let t; (t = take('+') ?? take('-'));) a = `(${a}${t.t}${term()})`;
    return a;
  }
  function term() {
    let a = unary();
    for (let t; (t = take('*') ?? take('/'));) a = `(${a}${t.t}${unary()})`;
    return a;
  }
  function unary() {
    if (take('+')) return `(+${unary()})`;
    if (take('-')) return `(-${unary()})`;
    return primary();
  }
  function primary() {
    const tok = tokens[p++] ?? reject('unexpected end');
    if (tok.t === 'num') return numberLiteral(tok.v);
    if (tok.t === '(') { const e = expr(); expect(')'); return `(${e})`; }
    if (tok.t !== 'name') reject(`unexpected ${tok.t}`);
    const n = tok.v;
    if (variables.has(n)) {
      if (peek()?.t === '(') reject('calling a variable');
      return `v[${variables.get(n)}]`;
    }
    if (n in CONSTANTS) { if (peek()?.t === '(') reject('calling a constant'); return CONSTANTS[n]; }
    if (n === 'frame') { if (peek()?.t === '(') reject('calling frame'); return 'frame'; }
    if (n in FUNCTIONS && take('(')) {
      const args = [expr()];
      while (take(',')) args.push(expr());
      expect(')');
      const [lo, hi] = FUNCTIONS[n];
      if (args.length < lo || args.length > hi) reject(`${n} takes ${lo}..${hi} arguments`);
      return `F.${n}${n === 'log' || n === 'clamp' ? args.length : ''}(${args.join(',')})`;
    }
    return reject(`unknown name ${n}`);
  }

  const out = expr();
  if (p !== tokens.length) reject('trailing tokens');
  return out;
}

const numberLiteral = (v) => (Number.isFinite(v) ? `(${String(v)})` : '(1/0)');

const minMax = (less) => (...a) => {
  let r = a[a.length - 1];
  for (let i = a.length - 2; i >= 0; i--) r = less(r, a[i]) ? r : a[i];
  return r;
};
const clampRule = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// The runtime helpers the generated code calls (expressions.md section 4).
const F = {
  min: minMax((r, a) => r < a), max: minMax((r, a) => r > a),
  radians: (x) => (x * Math.PI) / 180, degrees: (x) => (x * 180) / Math.PI,
  abs: Math.abs, fabs: Math.abs, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, int: Math.trunc,
  round: (x) => (x < 0 ? -Math.round(-x) : Math.round(x)),
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, exp: Math.exp,
  sqrt: Math.sqrt, log1: Math.log, log2: (x, b) => Math.log(x) / Math.log(b), atan2: Math.atan2, pow: Math.pow,
  fmod: (x, y) => x % y, lerp: (a, b, t) => a * (1 - t) + b * t,
  clamp1: (x) => clampRule(x, 0, 1), clamp3: clampRule,
  smoothstep: (e0, e1, x) => {
    const t = clampRule((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  },
};
const T = (x) => x !== 0;
const AND = (a, b) => (T(a) ? b() : a);
const OR = (a, b) => (T(a) ? a : b());
const COMPARE = {
  '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b,
  '>': (a, b) => a > b, '>=': (a, b) => a >= b,
};
function CMP(ops, operands) {
  let a = operands[0]();
  for (let i = 0; i < ops.length; i++) {
    const b = operands[i + 1]();
    if (!COMPARE[ops[i]](a, b)) return 0;
    a = b;
  }
  return 1;
}

export function compileExpression(text, variableNames = []) {
  const src = String(text).slice(0, 255);
  try {
    if (src === '') return { ok: true, fn: () => 0, source: '0' };
    const variables = new Map();
    variableNames.forEach((n, i) => { if (isValidVariableName(n)) variables.set(n, i); });
    const body = parse(tokenize(src), variables);
    // eslint-disable-next-line no-new-func
    const make = new Function('F', 'T', 'AND', 'OR', 'CMP', `return function(v, frame) { return ${body}; };`);
    return { ok: true, fn: make(F, T, AND, OR, CMP), source: body };
  } catch (e) {
    if (e instanceof PythonOnly) return { ok: false, reason: e.message };
    throw e;
  }
}

export const FLT_MAX = 3.4028234663852886e38;

// The driver's float32 value from a double result; null for an error (non-finite: keep the previous value).
export function driverResult(r) {
  if (!Number.isFinite(r)) return null;
  const f = Math.fround(r);
  return Number.isFinite(f) ? f : Math.sign(r) * FLT_MAX;
}
