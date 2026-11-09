// SPDX-License-Identifier: MIT OR Apache-2.0
// @ts-check
// Driver simple expressions: a small Python-like language evaluated in double precision, with a float32 result.

/** Returned by `compile` when the expression needs a full Python interpreter. */
export const PYTHON_ONLY = Object.freeze({ pythonOnly: true });

export const FLT_MAX = 3.4028234663852886e38;
const MAX_LENGTH = 255;
const MAX_NAME_LENGTH = 63;
const KEYWORDS = new Set(['and', 'or', 'not', 'if', 'else']);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @typedef {{ vars: Map<string, number>, frame: number }} Scope
 * @typedef {(scope: Scope) => number} Node
 * @typedef {(variables: Record<string, number>, frame?: number) => number | null} Evaluator
 *   Returns the float32 result, or null when evaluation fails (the driver keeps its previous value).
 */

/** @param {string} name */
export const isValidVariableName = (name) => NAME.test(name) && !KEYWORDS.has(name);

/** Blender keeps the first 63 characters of a variable name. @param {string} name */
export const storedVariableName = (name) => name.slice(0, MAX_NAME_LENGTH);

/**
 * @param {string} expression
 * @param {Iterable<string>} variableNames names of the driver's variables (keys of the evaluator's `variables`)
 * @returns {Evaluator | typeof PYTHON_ONLY}
 */
export function compile(expression, variableNames = []) {
  const text = expression.slice(0, MAX_LENGTH);
  if (text === '') return () => 0;
  /** @type {Map<string, string>} stored name to the caller's key */
  const keys = new Map();
  for (const key of variableNames) {
    const name = storedVariableName(key);
    if (isValidVariableName(name) && !keys.has(name)) keys.set(name, key);
  }
  const names = new Set(keys.keys());
  let node;
  try {
    node = new Parser(tokenize(text), names).parseAll();
  } catch (error) {
    if (error instanceof SyntaxError) return PYTHON_ONLY;
    throw error;
  }
  return (variables, frame = 1) => {
    const vars = new Map();
    for (const [name, key] of keys) vars.set(name, Math.fround(variables[key] ?? 0));
    return toFloat32Result(node({ vars, frame: Math.fround(frame) }));
  };
}

/** @param {number} value */
function toFloat32Result(value) {
  if (!Number.isFinite(value)) return null;
  const single = Math.fround(value);
  return Number.isFinite(single) ? single : Math.sign(value) * FLT_MAX;
}

// Tokens

/** @typedef {{ kind: 'number', value: number } | { kind: 'name', value: string } | { kind: 'op', value: string } | { kind: 'end', value: '' }} Token */

const SPACE = /[ \t\n\r\v\f]/;
const DIGIT = /[0-9]/;
const OPERATORS = ['==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '(', ')', ','];

/** @param {string} text @returns {Token[]} */
function tokenize(text) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (SPACE.test(ch)) i++;
    else if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] ?? ''))) {
      const end = scanNumber(text, i);
      tokens.push({ kind: 'number', value: Number(text.slice(i, end)) });
      i = end;
    } else if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end++;
      tokens.push({ kind: 'name', value: text.slice(i, end) });
      i = end;
    } else {
      const op = OPERATORS.find((candidate) => text.startsWith(candidate, i));
      if (!op) throw new SyntaxError(`unexpected ${ch}`);
      tokens.push({ kind: 'op', value: op });
      i += op.length;
    }
  }
  if (tokens.length === 0) throw new SyntaxError('no tokens');
  tokens.push({ kind: 'end', value: '' });
  return tokens;
}

/** @param {string} text @param {number} start @returns {number} end of the number literal */
function scanNumber(text, start) {
  const digitsFrom = (/** @type {number} */ i) => {
    while (i < text.length && DIGIT.test(text[i])) i++;
    return i;
  };
  let i = digitsFrom(start);
  const integerPart = text.slice(start, i);
  let plainInteger = true;
  if (text[i] === '.') {
    plainInteger = false;
    i = digitsFrom(i + 1);
  }
  if (text[i] === 'e' || text[i] === 'E') {
    plainInteger = false;
    let j = i + 1;
    if (text[j] === '+' || text[j] === '-') j++;
    const end = digitsFrom(j);
    if (end === j) throw new SyntaxError('malformed exponent');
    i = end;
  }
  if (plainInteger && /^0[0-9]*[1-9]/.test(integerPart)) throw new SyntaxError('leading zero');
  return i;
}

// Functions: each entry lists the accepted argument counts (-1 for one or more).

/** @param {(a: number, r: number) => boolean} keepRight */
const fold = (keepRight) => (/** @type {number[]} */ ...args) => {
  let result = args[args.length - 1];
  for (let i = args.length - 2; i >= 0; i--) result = keepRight(args[i], result) ? result : args[i];
  return result;
};

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** C round: halves away from zero. */
const roundHalfAway = (/** @type {number} */ x) => {
  const whole = Math.trunc(x);
  return Math.abs(x - whole) >= 0.5 ? whole + Math.sign(x) : whole;
};

/** C pow, where 1 to any power and -1 to an infinite power are 1. */
const cPow = (/** @type {number} */ x, /** @type {number} */ y) =>
  x === 1 || (x === -1 && !Number.isFinite(y) && !Number.isNaN(y)) ? 1 : Math.pow(x, y);

const smoothstep = (/** @type {number} */ e0, /** @type {number} */ e1, /** @type {number} */ x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** @type {Record<string, { arity: number[], fn: (...args: number[]) => number }>} */
const FUNCTIONS = {
  min: { arity: [-1], fn: fold((a, r) => r < a) },
  max: { arity: [-1], fn: fold((a, r) => r > a) },
  radians: { arity: [1], fn: (x) => (x * Math.PI) / 180 },
  degrees: { arity: [1], fn: (x) => (x * 180) / Math.PI },
  abs: { arity: [1], fn: Math.abs },
  fabs: { arity: [1], fn: Math.abs },
  floor: { arity: [1], fn: Math.floor },
  ceil: { arity: [1], fn: Math.ceil },
  trunc: { arity: [1], fn: Math.trunc },
  int: { arity: [1], fn: Math.trunc },
  round: { arity: [1], fn: roundHalfAway },
  sin: { arity: [1], fn: Math.sin },
  cos: { arity: [1], fn: Math.cos },
  tan: { arity: [1], fn: Math.tan },
  asin: { arity: [1], fn: Math.asin },
  acos: { arity: [1], fn: Math.acos },
  atan: { arity: [1], fn: Math.atan },
  exp: { arity: [1], fn: Math.exp },
  sqrt: { arity: [1], fn: Math.sqrt },
  log: { arity: [1, 2], fn: (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)) },
  atan2: { arity: [2], fn: Math.atan2 },
  pow: { arity: [2], fn: cPow },
  fmod: { arity: [2], fn: (x, y) => x % y },
  lerp: { arity: [3], fn: (a, b, t) => a * (1 - t) + b * t },
  clamp: { arity: [1, 3], fn: (x, lo = 0, hi = 1) => clamp(x, lo, hi) },
  smoothstep: { arity: [3], fn: smoothstep },
};

/** @type {Record<string, (scope: Scope) => number>} */
const CONSTANTS = {
  pi: () => Math.PI,
  True: () => 1,
  False: () => 0,
  frame: (scope) => scope.frame,
};

const truthy = (/** @type {number} */ x) => x !== 0;

/** @type {Record<string, (a: number, b: number) => boolean>} */
const COMPARISONS = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
};

// Grammar, lowest binding first:
//   expr := or [ "if" or "else" expr ]   or := and { "or" and }   and := not { "and" not }
//   not := "not" not | comparison        comparison := sum { op sum }
//   sum := term { +- term }   term := unary { */ unary }   unary := +- unary | primary
class Parser {
  /** @param {Token[]} tokens @param {Set<string>} variables */
  constructor(tokens, variables) {
    this.tokens = tokens;
    this.variables = variables;
    this.at = 0;
  }

  get token() {
    return this.tokens[this.at];
  }

  /** @param {string} value */
  isOp(value) {
    return this.token.kind === 'op' && this.token.value === value;
  }

  /** @param {string} word */
  isKeyword(word) {
    return this.token.kind === 'name' && this.token.value === word;
  }

  /** @param {string} value */
  expectOp(value) {
    if (!this.isOp(value)) throw new SyntaxError(`expected ${value}`);
    this.at++;
  }

  /** @returns {Node} */
  parseAll() {
    const node = this.expr();
    if (this.token.kind !== 'end') throw new SyntaxError('trailing input');
    return node;
  }

  /** @returns {Node} */
  expr() {
    const value = this.or();
    if (!this.isKeyword('if')) return value;
    this.at++;
    const condition = this.or();
    if (!this.isKeyword('else')) throw new SyntaxError('expected else');
    this.at++;
    const otherwise = this.expr();
    return (s) => (truthy(condition(s)) ? value(s) : otherwise(s));
  }

  /** @returns {Node} */
  or() {
    let left = this.and();
    while (this.isKeyword('or')) {
      this.at++;
      const a = left, b = this.and();
      left = (s) => {
        const x = a(s);
        return truthy(x) ? x : b(s);
      };
    }
    return left;
  }

  /** @returns {Node} */
  and() {
    let left = this.not();
    while (this.isKeyword('and')) {
      this.at++;
      const a = left, b = this.not();
      left = (s) => {
        const x = a(s);
        return truthy(x) ? b(s) : x;
      };
    }
    return left;
  }

  /** @returns {Node} */
  not() {
    if (!this.isKeyword('not')) return this.comparison();
    this.at++;
    const operand = this.not();
    return (s) => (truthy(operand(s)) ? 0 : 1);
  }

  /** @returns {Node} */
  comparison() {
    const first = this.sum();
    /** @type {[(a: number, b: number) => boolean, Node][]} */
    const links = [];
    while (this.token.kind === 'op' && Object.hasOwn(COMPARISONS, this.token.value)) {
      const compare = COMPARISONS[this.token.value];
      this.at++;
      links.push([compare, this.sum()]);
    }
    if (links.length === 0) return first;
    return (s) => {
      let left = first(s);
      for (const [compare, operand] of links) {
        const right = operand(s);
        if (!compare(left, right)) return 0;
        left = right;
      }
      return 1;
    };
  }

  /** @returns {Node} */
  sum() {
    let left = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const minus = this.token.value === '-';
      this.at++;
      const a = left, b = this.term();
      left = minus ? (s) => a(s) - b(s) : (s) => a(s) + b(s);
    }
    return left;
  }

  /** @returns {Node} */
  term() {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const divide = this.token.value === '/';
      this.at++;
      const a = left, b = this.unary();
      left = divide ? (s) => a(s) / b(s) : (s) => a(s) * b(s);
    }
    return left;
  }

  /** @returns {Node} */
  unary() {
    if (this.isOp('+')) {
      this.at++;
      return this.unary();
    }
    if (this.isOp('-')) {
      this.at++;
      const operand = this.unary();
      return (s) => -operand(s);
    }
    return this.primary();
  }

  /** @returns {Node} */
  primary() {
    const token = this.token;
    this.at++;
    if (token.kind === 'number') {
      const value = token.value;
      return () => value;
    }
    if (token.kind === 'op' && token.value === '(') {
      const inner = this.expr();
      this.expectOp(')');
      return inner;
    }
    if (token.kind !== 'name' || KEYWORDS.has(token.value)) throw new SyntaxError('expected a value');
    const name = token.value;
    if (this.variables.has(name)) return (s) => /** @type {number} */ (s.vars.get(name));
    if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name];
    if (Object.hasOwn(FUNCTIONS, name) && this.isOp('(')) return this.call(FUNCTIONS[name]);
    throw new SyntaxError(`unknown name ${name}`);
  }

  /** @param {{ arity: number[], fn: (...args: number[]) => number }} entry @returns {Node} */
  call({ arity, fn }) {
    this.expectOp('(');
    const args = [this.expr()];
    while (this.isOp(',')) {
      this.at++;
      args.push(this.expr());
    }
    this.expectOp(')');
    if (!arity.includes(args.length) && !(arity[0] === -1)) throw new SyntaxError('wrong argument count');
    return (s) => fn(...args.map((arg) => arg(s)));
  }
}
