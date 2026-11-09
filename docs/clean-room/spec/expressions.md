# Driver simple expressions

Behavior of Blender's built-in evaluator for SCRIPTED driver expressions (the "simple expressions" subset in the
manual, Drivers Panel). Every rule below was confirmed against the oracle; the probe files are in `probes/`
(`eN.mjs` builds batch `eN`, `eN.req.json` is the request batch, `eN.res.json` the answers).

Outcomes of evaluating an expression string:

- **value**: a number.
- **python-only**: the evaluator rejects the expression at parse time (unknown name, unsupported syntax, wrong argument
  count). Blender would hand it to Python instead. Parsing is all-or-nothing: one bad token anywhere rejects the whole
  expression, even inside a branch that would not be taken.
- **error**: the expression parses, but evaluation yields a non-finite result. Blender keeps the driver's previous
  value (0 for a new driver).

## 1. Input string

- **Length limit.** Only the first 255 characters are used; the rest is silently dropped before parsing. Evidence
  (e7): `"2" + spaces + "+3"` of total length 255 gives 5, length 256 gives python-only (the text ends in `+`), 257+
  gives 2 (the text ends in spaces). `"2" + spaces + "9"` with the `9` at index 255 or later gives 2. This also
  explains e6: 400-digit literals truncate to a 255-digit literal; `(1000...` loses its `)` and is python-only.
- **Empty** string gives 0 (e1 `""`). Whitespace only is python-only (e10 `"   "`, `"\t\n"`), as are comments
  (`1 #comment`) and backslash line continuations (e10).
- **Whitespace** between tokens: space, tab, newline, carriage return, vertical tab, form feed (the C `isspace` set).
  A newline is just whitespace, unlike Python (e1 `"1\n+2"` = 3; e2 `\r`, `\v`, `\f` = 3). A non-ASCII space (U+00A0)
  is python-only (e2).
- Non-ASCII characters anywhere make it python-only (e4 `aé`, `é`).

## 2. Tokens

### Numbers

Grammar (all decimal): `digits [ "." [digits] ] [ exponent ]` or `"." digits [ exponent ]`, where
`exponent = ("e" | "E") ["+" | "-"] digits`.

- Accepted: `1`, `1.5`, `.5`, `5.`, `1e3`, `1E-2`, `1.e2`, `1.E5`, `1.5e+2`, `2.5e-3`, `0e0`, `1e0001`, `007.5`,
  `00`, `0` (e1, e2, e5, e6).
- Rejected (python-only): `1e`, `1e+`, `1.e`, `.e2`, `1e3e3`, `1..2`, `1.2.3`, `1e5.5`, `1e-5e`, hex/octal/binary
  (`0x10`, `0o7`, `0b1`), underscores (`1_000`), imaginary (`1j`).
- **Leading zeros**: an integer literal (no `.` and no exponent) with a leading zero followed by more digits is
  rejected unless all its digits are zero, as in Python: `007` python-only, `00` = 0, `007.5` = 7.5 (e1, e2).
- **A letter `e` or `E` right after a number starts an exponent.** `1if 1 else 2` = 1 and `1and 2` = 2 and `1or 0` = 1
  (no space needed before a keyword), but `1 if 1else 2` and `1if 1else 2` are python-only because `1else` reads as a
  malformed exponent (e5, e6).
- The value is the correctly rounded IEEE double of the decimal text (strtod): `0.1*3 == 0.30000000000000004` is 1,
  `0.30000000000000004 - 0.3` = 5.551115123125783e-17, `9007199254740993 == 9007199254740992` is 1 (e5, e6).
  A literal beyond double range becomes +inf (`1e400`, `1e309` give an error), one below the smallest subnormal
  becomes 0 (`1e-400` = 0).

### Names

`[A-Za-z_][A-Za-z0-9_]*`, case-sensitive. Reserved words (keywords): `and`, `or`, `not`, `if`, `else`. No other
Python keyword is special (e4: variables named `in`, `is`, `lambda`, `while`, `class`, `def`, `None` work).
A name is resolved in this order:

1. a driver variable of that name (variables shadow everything below, see section 5);
2. the built-in constants `pi`, `True`, `False`, and `frame`;
3. a function name, only when followed by `(`.

Any other name is python-only: `e`, `tau`, `inf`, `nan`, `None`, `Pi`, `PI`, `TRUE`, `And`, `math`, `bpy`, `self`,
`sinh`, `hypot`, `signum`, `noise`, `log10`, `log2`, `copysign`, `float`, `bool` (e1, e5).

### Operators and punctuation

`+ - * / ( ) ,` and comparisons `== != < <= > >=`. Everything else is python-only: `%`, `**`, `//`, `^`, `&`, `|`,
`~`, `<<`, `<>`, `is`, `in` (as operators), `=`, `[ ]`, quotes, `.` (attribute access), `lambda`, `:` (e1, e2).

## 3. Grammar and precedence

From lowest to highest binding (all confirmed, e1 e2 e5):

```
expr       := or_test [ "if" or_test "else" expr ]
or_test    := and_test { "or" and_test }
and_test   := not_test { "and" not_test }
not_test   := "not" not_test | comparison
comparison := sum { compop sum }
sum        := term { ("+" | "-") term }
term       := unary { ("*" | "/") unary }
unary      := ("+" | "-") unary | primary
primary    := number | name | name "(" expr { "," expr } ")" | "(" expr ")"
```

- Binary `+ - * /` are left-associative: `10-4-3` = 3, `100/10/5` = 2, `1-2+3` = 2.
- Unary signs stack: `--a`, `- -a`, `2--3` = 5, `2 - - - 3` = -1, `+-+1` = -1, `- 2 * - 3` = 6.
- `not` sits below comparisons and cannot follow a binary or unary operator: `not 1 == 2` = 1, `not 1 + 1` = 0,
  `not 1 < 2` = 0, `not(1)` = 0, `not-1` = 0; `1 + not 1`, `- not 1`, `1 < not 0` are python-only.
- Conditional: `1 if 1 else 2 + 10` = 1, `1 + 1 if 0 else 5` = 5, `1 or 0 if 0 else 7` = 7, `not 0 if 0 else 3` = 3;
  it nests to the right in the `else` part (`1 if 0 else 2 if 1 else 3` = 2); a conditional as the condition needs
  parentheses (`1 if 1 if 1 else 0 else 2` python-only, `1 if (0 if 1 else 1) else 2` = 2); `a if b` without `else` is
  python-only. A conditional is allowed as a function argument (`min(1 if 0 else 5, 3)` = 3).
- Function call: a function name, then `(`, then one or more comma-separated `expr`, then `)`. Whitespace may sit
  between the name and `(` (`sin (1)`). No trailing comma (`min(1,2,)` python-only), no keyword arguments, no empty
  call, no calling non-functions (`a()`, `pi()`, `frame()`, `True()`, `sin(1)(2)`, `(a)(b)`), no tuples or lists.
- Juxtaposition (`1 2`, `1 ()`), unbalanced parentheses, a trailing operator, `,` alone and `()` are python-only.

## 4. Semantics

All arithmetic is IEEE 754 double precision. Inputs (variables, `frame`) arrive as float32 values widened to double;
literals are full doubles. Only the final result is converted to float32 (see section 6).

- **Truth value**: a value is true when it is not equal to 0. NaN is true (`1 if sqrt(-1) else 2` = 1,
  `not sqrt(-1)` = 0) (e3).
- **Booleans** are the numbers 1 and 0. `True` = 1, `False` = 0, `True+1` = 2, `True == 1` = 1.
- **Comparisons** give 1 or 0, with IEEE rules (NaN compares unequal to everything, `sqrt(-1) != sqrt(-1)` = 1).
  They **chain** as in Python: `a op1 b op2 c` means `(a op1 b) and (b op2 c)`: `3>2>1` = 1, `1<3>2` = 1,
  `1<2==True` = 0, `2 == 2 == 1` = 0 while `(2 == 2) == 1` = 1 (e1, e5). Chaining stops at the first false link
  (`0 > 1 < 1/0` = 0).
- **`and` / `or`** short-circuit and return an operand, as in Python: `x and y` is `y` if `x` is true, else `x`;
  `x or y` is `x` if `x` is true, else `y`. `a and b` = b, `0 or 5` = 5, `3 or 5` = 3, `sqrt(-1) and 3` = 3,
  `sqrt(-1) or 3` = NaN (error) (e1, e3).
- **`not x`** is 1 if `x` is 0, else 0.
- **Conditional** `x if c else y` evaluates only the chosen branch (`1/0 if 0 else 2` = 2).
- **Division** is IEEE: `x/0` gives ±inf or NaN, which is not an error by itself: `(1/0) > 5` = 1,
  `1 < 2 < 1/0` = 1, `min(1/0, 3)` = 3, `atan(1/0)` = pi/2, `exp(-1/0)` = 0 (e3). Only a non-finite final result
  is an error (`1/0`, `0*(1/0)`, `1/0 - 1/0 == 0` = 0 because the comparison is false, not an error).

### Constants and frame

| name | value |
|---|---|
| `pi` | pi as a double (3.141592653589793). Evidence: `tan(pi/2)` = 1.633123935319537e16, which needs double pi. |
| `True`, `False` | 1, 0 |
| `frame` | the scene frame as float32, widened (frame 0.1 gives 0.10000000149011612; `frame == 0.1` = 0; e3) |

### Functions

Arity is exact; any other count is python-only (e2 tries 0 to 4 arguments for each).

| function | args | result (double math; C library semantics) |
|---|---|---|
| `min`, `max` | 1 or more (tested up to 10) | see NaN rule below |
| `radians(x)` | 1 | x * pi / 180 |
| `degrees(x)` | 1 | x * 180 / pi |
| `abs(x)`, `fabs(x)` | 1 | absolute value |
| `floor`, `ceil`, `trunc` | 1 | C floor, ceil, trunc |
| `int(x)` | 1 | same as trunc, as a double; no integer range limit (`int(1e20)` = 1e20, `int(2.5e9)` = 2.5e9) |
| `round(x)` | 1 | nearest integer, halves away from zero (C `round`): `round(0.5)` = 1, `round(2.5)` = 3, `round(-2.5)` = -3, `round(0.49999999999999994)` = 0. `round(x, n)` is python-only. |
| `sin cos tan asin acos atan exp sqrt` | 1 | C functions |
| `log(x)` | 1 | natural log |
| `log(x, b)` | 2 | ln(x) / ln(b) (`log(0.3,0.6)` = 2.3569154739, `log(2,1)` = +inf) |
| `atan2(y, x)` | 2 | C atan2, y first (`atan2(1,2)` = 0.4636476) |
| `pow(x, y)` | 2 | C pow (`pow(-2,3)` = -8, `pow(-8,1/3)` = NaN) |
| `fmod(x, y)` | 2 | C fmod, sign of x (`fmod(-7,3)` = -1, `fmod(7,-3)` = 1, `fmod(5, 1/0)` = 5, `fmod(1,0)` = NaN) |
| `lerp(a, b, t)` | 3 | a * (1 - t) + b * t (no clamping). The form matters: `lerp(1e16,1,1)` = 1, which a + (b - a) * t would not give (e8). |
| `clamp(x)` | 1 | `clamp(x, 0, 1)` |
| `clamp(x, lo, hi)` | 3 | if x < lo then lo, else if x > hi then hi, else x. The order matters when lo > hi: `clamp(-5,1,0)` = 1, `clamp(5,1,0)` = 0, `clamp(0.5,1,0)` = 1 (e2). NaN x passes through. |
| `smoothstep(e0, e1, x)` | 3 | t = (x - e0) / (e1 - e0); t clamped to [0, 1] with the clamp rule above (NaN passes through); result t * t * (3 - 2 t). Works for e0 > e1 (`smoothstep(1,0,0.25)` = 0.84375); e0 = e1 gives 1 for x > e0, 0 for x < e0, NaN (error) for x = e0 (e2, e3). |

**min/max with NaN** (e8, e9). With arguments a1 ... an, evaluate from the right: r = an, then for i = n-1 down to 1,
r = m(ai, r), where for min m(a, r) = r if r < a, else a; for max m(a, r) = r if r > a, else a. Without NaN this is the
ordinary minimum or maximum. Checked cases: `min(NaN,1)` = NaN, `min(1,NaN)` = 1, `min(1,NaN,0)` = 1,
`min(0,NaN,1)` = 0, `min(2,NaN,1,0)` = 2, `min(2,1,NaN,0)` = 1, `min(2,1,0,NaN)` = 0, `max(1,NaN,5)` = 1,
`max(0,1,NaN,5)` = 1, `max(0,5,NaN,1)` = 5.

Domain errors are not reported separately: `sqrt(-1)`, `log(0)`, `log(-1)`, `asin(2)`, `acos(2)`,
`pow(-2,0.5)`, `pow(0,-1)`, `exp(1000)`, `fmod(1,0)` yield the IEEE value (NaN or ±inf), which only becomes an
error if it reaches the final result (e1, e3: `exp(1000) > 0` = 1, `asin(2) == asin(2)` = 0, `log(0) < 0` = 1).

## 5. Variables

- A variable's value is stored as float32 first (`c = 0.1` gives 0.10000000149011612; `c == 0.1` = 0; e2, e3); a value
  beyond float32 range becomes inf (variable `a = 1e39` gives error, e4).
- Accepted names (usable in the evaluator): ASCII, start with a letter or `_`, then letters, digits, `_`, at most 63
  characters (63 works, 64 is python-only), and not one of `and`, `or`, `not`, `if`, `else` (e4). Names such as `1a`,
  `a b`, `a.b`, `a-b`, `aé` are python-only. Exception seen: a variable named `not` makes `not` alone python-only but
  `not + 1` gives 0, which is the keyword reading `not (+1)`; i.e. the keyword wins over the variable.
- A variable shadows a constant or a function name: variables named `frame`, `pi`, `True`, `False`, `sin`, `min`,
  `lerp`, `abs`, `clamp` read as the variable (`frame` var 7.25 at frame 3 gives 7.25); calling such a name
  (`sin(0.5)` with a variable `sin`) is python-only (e4).

## 6. Result

- The double result r is converted to float32 with round-to-nearest.
- If r is NaN or ±inf: **error** (previous value kept; 0 for a new driver).
- If r is finite but beyond float32 range, the result saturates to ±3.4028234663852886e38 (FLT_MAX), it does not
  become an error: `exp(89)`, `exp(709)`, `1e38*10`, `3.5e38`, `pow(10,39)` give FLT_MAX, `-1e39` gives -FLT_MAX,
  while `exp(710)` (double inf) is an error (e2, e6).
- Underflow follows float32 rounding with subnormals: `1e-39` = 1.0000002153053333e-39, `1e-45` = 1.4e-45,
  `1e-46` = 0 (e3).

## Open points

- Truncation at 255 characters was measured on ASCII. For non-ASCII input the expression is python-only anyway, so
  byte versus character counting does not change any outcome that matters.
- Whether `-0.0` is returned as -0 or +0: the oracle's JSON shows 0 for `-0.0`, `abs(-0.0)`, `round(-0.4)`; a sign of
  zero is not observable here.
- Variable naming rules come from the oracle's variable creation; Blender may additionally flag some names in its UI
  (for example Python keywords such as `class`), but they evaluate here.
