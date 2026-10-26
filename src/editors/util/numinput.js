// Typing values into modal operators (numinput.cc): G 2, R 90, S -1, Tab to the next component, Backspace, - to
// negate, / to invert, = or * for expressions with units ("2*pi", "10cm"), Ctrl = or Ctrl * back to simple input.
// Events are window manager events; the typed character comes from the DOM key.
import { parse, format } from '../../blenkernel/unit.js';

// NumInput.flag and val_flag (ED_numinput.hh, plus numinput.cc's private bits).
export const NUM_AFFECT_ALL = 1 << 0;
export const NUM_NULL_ONE = 1 << 0, NUM_NO_NEGATIVE = 1 << 1, NUM_NO_ZERO = 1 << 2, NUM_NO_FRACTION = 1 << 3;
const NUM_EDITED = 1 << 9, NUM_INVALID = 1 << 10, NUM_NEGATE = 1 << 11, NUM_INVERSE = 1 << 12;
const NUM_EDIT_FULL = 1 << 9, NUM_FAKE_EDITED = 1 << 10;
const UNIT = { LENGTH: 'length', ROTATION: 'angle', NONE: null };

// initNumInput. `unit_type` per component: 'LENGTH', 'ROTATION' or 'NONE'.
export function initNumInput({ idx_max = 0, flag = 0, val_flag = 0, unit_type = 'NONE', val_inc = 1 } = {}) {
  return {
    idx_max, flag, idx: 0, str: '', str_cur: 0,
    val_flag: [val_flag, val_flag, val_flag], val: [0, 0, 0], val_org: [0, 0, 0], val_inc: [val_inc, val_inc, val_inc],
    unit_type: [unit_type, unit_type, unit_type],
  };
}

export function hasNumInput(n) {
  if (n.flag & NUM_FAKE_EDITED) return true;
  for (let i = 0; i <= n.idx_max; i++) if (n.val_flag[i] & NUM_EDITED) return true;
  return false;
}

// applyNumInput: writes the typed values into `vec` and returns true, or records `vec` as the values to edit from.
export function applyNumInput(n, vec) {
  if (hasNumInput(n)) {
    for (let j = 0; j <= n.idx_max; j++) {
      if (n.flag & NUM_FAKE_EDITED) { vec[j] = n.val[j]; continue; }
      const i = n.flag & NUM_AFFECT_ALL && n.idx !== j && !(n.val_flag[j] & NUM_EDITED) ? 0 : j;
      let val = !(n.val_flag[i] & NUM_EDITED) && n.val_flag[i] & NUM_NULL_ONE ? 1 : n.val[i];
      if (n.val_flag[i] & NUM_NO_NEGATIVE && val < 0) val = 0;
      if (n.val_flag[i] & NUM_NO_FRACTION && val !== Math.floor(val)) {
        val = Math.floor(val + 0.5);
        if (n.val_flag[i] & NUM_NO_ZERO && val === 0) val = 1;
      } else if (n.val_flag[i] & NUM_NO_ZERO && val === 0) val = 0.0001;
      vec[j] = val;
    }
    n.flag &= ~NUM_FAKE_EDITED;
    return true;
  }
  for (let j = 0; j <= n.idx_max; j++) n.val[j] = n.val_org[j] = vec[j];
  return false;
}

const valueText = (n, i, precision) => (n.unit_type[i] === 'NONE' ? String(Number(n.val[i].toFixed(precision))) : format(n.val[i], UNIT[n.unit_type[i]]));

// outputNumInput: one string per component, "[2|] = 2 m" for the one being typed.
export function outputNumInput(n) {
  const out = [];
  for (let j = 0; j <= n.idx_max; j++) {
    const i = n.flag & NUM_AFFECT_ALL && n.idx !== j && !(n.val_flag[j] & NUM_EDITED) ? 0 : j;
    const cur = i === n.idx ? '|' : '';
    if (!(n.val_flag[i] & NUM_EDITED)) { out.push(`${cur}NONE${cur}`); continue; }
    if (i !== n.idx) { out.push(`${cur}${valueText(n, i, 2)}${cur}`); continue; }
    const negate = n.val_flag[i] & NUM_NEGATE, inverse = n.val_flag[i] & NUM_INVERSE;
    const heading = negate ? (inverse ? '-1/(' : '-(') : inverse ? '1/(' : '', trailing = negate || inverse ? ')' : '';
    const val = n.val_flag[i] & NUM_INVALID ? 'Invalid' : valueText(n, i, 2);
    out.push(`[${heading}${n.str.slice(0, n.str_cur)}|${n.str.slice(n.str_cur)}${trailing}] = ${val}`);
  }
  return out;
}

const value_to_editstr = (n, idx) => { n.str = n.unit_type[idx] === 'NONE' ? String(Number(n.val[idx].toFixed(6))) : format(n.val[idx], UNIT[n.unit_type[idx]]); n.str_cur = n.str.length; };
const insertAtCursor = (n, text) => { n.str = n.str.slice(0, n.str_cur) + text + n.str.slice(n.str_cur); n.str_cur += text.length; };

// The next cursor position from `cur` in direction `dir` (-1 or 1); with `delim`, a whole word (BLI_str_cursor_step).
function cursorStep(str, cur, dir, delim) {
  if (!delim) return Math.max(0, Math.min(str.length, cur + dir));
  const word = (c) => /[\w.]/.test(c);
  let i = cur;
  if (dir < 0) { while (i > 0 && !word(str[i - 1])) i--; while (i > 0 && word(str[i - 1])) i--; }
  else { while (i < str.length && !word(str[i])) i++; while (i < str.length && word(str[i])) i++; }
  return i;
}

// user_string_to_number: arithmetic with units, as Blender's Python evaluation does.
function user_string_to_number(str, unit_type) {
  try { return parse(str, UNIT[unit_type]); } catch { return null; }
}

// handleNumInput: returns whether the event changed the input.
export function handleNumInput(n, event) {
  const ascii = event.native?.key?.length === 1 ? event.native.key : '';
  const ctrl = event.ctrl, idx = n.idx;
  let updated = false, text = '';

  // '=' and '*' switch to full editing (expressions); with Ctrl, back to simple input.
  if (ascii === '=' || ascii === '*') {
    if (!(n.flag & NUM_EDIT_FULL)) { n.flag |= NUM_EDIT_FULL; n.val_flag[idx] |= NUM_EDITED; return true; }
    if (ctrl) { n.flag &= ~NUM_EDIT_FULL; return true; }
  }
  switch (event.type) {
    case 'back_space':
      if (!(n.val_flag[idx] & NUM_EDITED)) {
        n.val = [...n.val_org];
        for (let i = 0; i < 3; i++) n.val_flag[i] &= ~NUM_EDITED;
        n.flag |= NUM_FAKE_EDITED;
        return true;
      }
      if (event.shift || !n.str) {
        n.val[idx] = n.val_org[idx];
        n.val_flag[idx] &= ~NUM_EDITED;
        n.str = '';
        n.str_cur = 0;
        return true;
      }
    // falls through: Backspace removes before the cursor, Delete after it.
    case 'del': {
      if (!(n.val_flag[idx] & NUM_EDITED) || !n.str) return false;
      const dir = event.type === 'back_space' ? -1 : 1;
      let a = n.str_cur, b = cursorStep(n.str, n.str_cur, dir, ctrl);
      if (b !== a) {
        if (b < a) [a, b] = [b, a];
        n.str = n.str.slice(0, a) + n.str.slice(b);
        n.str_cur = a;
        updated = true;
      }
      if (!n.str) n.val[idx] = n.val_org[idx];
      break;
    }
    case 'left_arrow':
    case 'right_arrow': {
      const cur = cursorStep(n.str, n.str_cur, event.type === 'left_arrow' ? -1 : 1, ctrl);
      if (cur === n.str_cur) return false;
      n.str_cur = cur;
      return true;
    }
    case 'home': if (!n.str) return false; n.str_cur = 0; return true;
    case 'end': if (!n.str) return false; n.str_cur = n.str.length; return true;
    case 'tab': {
      n.val_flag[idx] &= ~(NUM_NEGATE | NUM_INVERSE);
      n.idx = (idx + n.idx_max + (ctrl ? 0 : 2)) % (n.idx_max + 1);
      if (n.val_flag[n.idx] & NUM_EDITED) value_to_editstr(n, n.idx);
      else { n.str = ''; n.str_cur = 0; }
      return true;
    }
    case 'period':
    case 'numpad_period':
      // A period even where the keyboard types a comma (#37992).
      text = '.';
      break;
    case 'minus':
    case 'numpad_minus':
      if (ctrl || !(n.flag & NUM_EDIT_FULL)) { n.val_flag[idx] ^= NUM_NEGATE; updated = true; }
      break;
    case 'slash':
    case 'numpad_slash':
      if (ctrl || !(n.flag & NUM_EDIT_FULL)) { n.val_flag[idx] ^= NUM_INVERSE; updated = true; }
      break;
    case 'c':
      if (ctrl) { navigator.clipboard?.writeText(n.str); updated = true; }
      break;
    default:
  }
  if (!updated && !text && ascii) text = ascii;
  // Ctrl shortcuts stay with the modal operator.
  if (!updated && ctrl) return false;
  if (text) {
    if (!(n.flag & NUM_EDIT_FULL) && !/[0-9.]/.test(text[0])) return false;
    insertAtCursor(n, text);
    n.val_flag[idx] |= NUM_EDITED;
  } else if (!updated) return false;

  if (n.str) {
    const prev = n.val[idx];
    const value = user_string_to_number(n.str, n.unit_type[idx]);
    if (value === null) n.val_flag[idx] |= NUM_INVALID;
    else { n.val[idx] = value; n.val_flag[idx] &= ~NUM_INVALID; }
    if (n.val_flag[idx] & NUM_NEGATE) n.val[idx] = -n.val[idx];
    if (n.val_flag[idx] & NUM_INVERSE) {
      let val = n.val[idx];
      if (n.unit_type[idx] === 'ROTATION') val = (val * 180) / Math.PI;
      val = 1 / val;
      if (n.unit_type[idx] === 'ROTATION') val = (val * Math.PI) / 180;
      n.val[idx] = val;
    }
    if (!Number.isFinite(n.val[idx])) { n.val[idx] = prev; n.val_flag[idx] |= NUM_INVALID; }
  }
  return true;
}
