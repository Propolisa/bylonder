// Syntax highlighting as the Text Editor formats lines (text_format.cc, text_format_py.cc): each character of a
// line with tabs expanded (flatten_string) gets a format type, and a line hands its open string on to the next.
import { TXT_TABSIZE } from '../../blenkernel/texts.js';

export const FMT = { WHITESPACE: '_', COMMENT: '#', SYMBOL: '!', NUMERAL: 'n', STRING: 'l', DIRECTIVE: 'd', SPECIAL: 'v', RESERVED: 'r', KEYWORD: 'b', DEFAULT: 'q' };
const CONT = { NOP: 0, QUOTESINGLE: 1, QUOTEDOUBLE: 2, TRIPLE: 4 };

const KEYWORDS = ['and', 'as', 'assert', 'async', 'await', 'break', 'case', 'continue', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from',
  'global', 'if', 'import', 'in', 'is', 'lambda', 'match', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'];
const SPECIALS = ['class', 'def'];
const BOOLS = ['False', 'None', 'True'];

const isIdentifier = (ch) => !!ch && (/[A-Za-z0-9_]/.test(ch) || ch.charCodeAt(0) >= 0x80);
const isDigit = (ch) => !!ch && ch >= '0' && ch <= '9';
const isDelim = (ch) => !!ch && '():"\' ~!%^&*-+=[]{};/<>|.#\t,@'.includes(ch);

// text_format_string_literal_find: the length of the literal the string starts with, unless an identifier goes on.
const literal = (words, s) => {
  const word = words.find((w) => s.startsWith(w));
  return word && !isIdentifier(s[word.length]) ? word.length : -1;
};
const decorator = (s) => {
  if (s[0] !== '@' || !isIdentifier(s[1])) return -1;
  let i = 1;
  while (isIdentifier(s[i])) i++;
  return i;
};
const count = (s, test) => { let i = 0; while (test(s[i])) i++; return i; };
const decimal = (c) => isDigit(c) || c === '_';
function numeralInner(s) {
  if (!s) return -1;
  const [first, second] = s;
  if (first === '.') { if (isDigit(second)) return 1 + count(s.slice(1), decimal); }
  else if (first === '0') {
    if ('xX'.includes(second ?? '-')) return 2 + count(s.slice(2), (c) => !!c && /[0-9a-fA-F_]/.test(c));
    if ('oO'.includes(second ?? '-')) return 2 + count(s.slice(2), (c) => !!c && /[0-7_]/.test(c));
    if ('bB'.includes(second ?? '-')) return 2 + count(s.slice(2), (c) => c === '0' || c === '1' || c === '_');
    if (second === '0' || second === '_') return 2 + count(s.slice(2), (c) => c === '0' || c === '_');
  } else if (first > '0' && first <= '9') return 1 + count(s.slice(1), decimal);
  return first === '0' ? 1 : 0;
}
function literalNumeral(s, prev) {
  if (!s) return -1;
  const [first, second] = s;
  if (prev === FMT.NUMERAL) {
    if ('eE'.includes(first) && (isDigit(second) || second === '-')) return 1 + numeralInner(s.slice(1));
    if (first === '.') return numeralInner(s);
    if ('jJ'.includes(first) && !isDigit(second)) return 1;
  } else if (prev !== FMT.DEFAULT && (isDigit(first) || (first === '.' && isDigit(second)))) return numeralInner(s);
  return 0;
}

// flatten_string: tabs as spaces to the next tab stop.
export function flatten(line, tabSize = TXT_TABSIZE) {
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(tabSize - (out.length % tabSize)) : ch;
  return out;
}

// txtfmt_py_format_line: the format of a flattened line, given the continuation the previous line left open; returns
// { format, cont }.
export function formatPythonLine(str, cont = CONT.NOP) {
  const fmt = [];
  let prev = cont & (CONT.QUOTEDOUBLE | CONT.QUOTESINGLE | CONT.TRIPLE) ? FMT.STRING : ' ';
  const fill = (type, n) => { for (let k = 0; k < n; k++) fmt.push(type); };
  for (let i = 0; i < str.length;) {
    const ch = str[i];
    if (ch === '\\') {
      fill(prev, Math.min(2, str.length - i));
      i += 2;
      continue;
    }
    if (cont) {
      const find = cont & CONT.QUOTEDOUBLE ? '"' : '\'';
      if (cont & CONT.TRIPLE) {
        if (str.startsWith(find.repeat(3), i)) { fill(FMT.STRING, 2); i += 2; cont = CONT.NOP; }
      } else if (ch === find) cont = CONT.NOP;
      fmt.push(FMT.STRING);
      prev = FMT.STRING;
      i++;
      continue;
    }
    const rest = str.slice(i);
    // A string opening at `at` (after a prefix), its triple quotes included.
    const open = (at) => {
      const quote = str[at];
      cont = quote === '"' ? CONT.QUOTEDOUBLE : CONT.QUOTESINGLE;
      let n = at - i + 1;
      if (str[at + 1] === quote && str[at + 2] === quote) { n += 2; cont |= CONT.TRIPLE; }
      fill(FMT.STRING, n);
      i += n;
      prev = FMT.STRING;
    };
    if (ch === '#') { fill(FMT.COMMENT, str.length - i); break; }
    if (ch === '"' || ch === '\'') { open(i); continue; }
    if ('fFrRuU'.includes(ch) && '"\''.includes(str[i + 1] ?? '-')) { open(i + 1); continue; }
    if ((('fF'.includes(ch) && 'rR'.includes(str[i + 1] ?? '-')) || ('rR'.includes(ch) && 'fF'.includes(str[i + 1] ?? '-'))) && '"\''.includes(str[i + 2] ?? '-')) { open(i + 2); continue; }
    let type, n = 1, found;
    if (ch === ' ') type = FMT.WHITESPACE;
    else if ((found = literalNumeral(rest, prev)) > 0) { type = FMT.NUMERAL; n = found; }
    else if (prev !== FMT.DEFAULT && (found = literal(BOOLS, rest)) !== -1) { type = found > 0 ? FMT.NUMERAL : FMT.DEFAULT; n = Math.max(1, found); }
    else if (ch !== '@' && isDelim(ch)) type = FMT.SYMBOL;
    else if (prev === FMT.DEFAULT) type = FMT.DEFAULT;
    else if ((found = literal(SPECIALS, rest)) > 0) { type = FMT.SPECIAL; n = found; }
    else if ((found = literal(KEYWORDS, rest)) > 0) { type = FMT.KEYWORD; n = found; }
    else if ((found = decorator(rest)) > 0) { type = FMT.DIRECTIVE; n = found; }
    else type = FMT.DEFAULT;
    fill(type, n);
    prev = type;
    i += n;
  }
  return { format: fmt.join(''), cont };
}

// ED_text_is_syntax_highlight_supported: Python texts and texts without an extension (Text, Text.001).
export const isSyntaxHighlightSupported = (text) => {
  if (!text) return false;
  const ext = text.name.match(/\.([^./]*)$/)?.[1];
  return ext === undefined || /^\d+$/.test(ext) || ext.toLowerCase() === 'py';
};
export const commentPrefix = () => '#';

// The format of every line of a text, as runs of { text, type } per line.
export function formatText(lines, tabSize) {
  let cont = CONT.NOP;
  return lines.map((line) => {
    const flat = flatten(line, tabSize), result = formatPythonLine(flat, cont);
    cont = result.cont;
    const runs = [];
    for (let i = 0; i < flat.length; i++) {
      const type = result.format[i] ?? FMT.DEFAULT;
      if (runs.at(-1)?.type === type) runs.at(-1).text += flat[i];
      else runs.push({ text: flat[i], type });
    }
    return runs;
  });
}
