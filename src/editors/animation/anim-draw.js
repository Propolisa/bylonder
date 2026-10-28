// Drawing the animation editors' regions on a canvas as Blender draws them (view2d_draw.cc, time_scrub_ui.cc,
// anim_channels_defines.cc, graph_draw.cc, keyframes_draw.cc), from what the module lists (anim-area.js) and Blender's
// default theme (theme-default.json). Coordinates: `r` maps a region's Blender pixels (y up) to the canvas.
import theme from '../interface/theme-default.json' with { type: 'json' };
import { iconUrl } from '../interface/icon.js';
import { ACHANNEL_SETTING } from './anim-area.js';

const { anim, curves } = theme.common;
const css = (c, alpha = c[3] ?? 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;
const shade = (c, amount) => c.map((v, i) => (i < 3 ? Math.max(0, Math.min(1, v + amount / 255)) : v));
export const FONT = '11px "Inter","DejaVu Sans",system-ui,sans-serif';

// Icons as images, loaded once.
const images = new Map();
function iconImage(name, onload) {
  if (!images.has(name)) {
    const image = new Image();
    image.onload = onload;
    image.src = iconUrl(name);
    images.set(name, image);
  }
  const image = images.get(name);
  return image.complete && image.naturalWidth ? image : null;
}

// A region's canvas and its mapping from Blender's region pixels (origin bottom left) to the canvas.
export function regionCanvas(canvas, width, height) {
  const ratio = globalThis.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.font = FONT;
  return { ctx, width, height, y: (y) => height - y };
}

// view2d_draw.cc's grid: major lines at least U.v2d_min_gridsize pixels and a label apart, as a multiple or a
// division (by 2, 3 or 5) of a base (the frame rate for frames, 10 for values); fractions only where the editor
// shows subframes.
const MIN_MAJOR_LINE_DISTANCE = 45, SUBFRAME_RANGE = 100;
function divisor(distance) {
  const divisors = [2, 3, 5];
  return divisors.find((d) => distance % d === 0 && distance / d === 2) ?? divisors.find((d) => distance % d === 0) ?? distance;
}
function gridStep(base, pixels, span, minDistance) {
  if (span === 0) return 1;
  const perUnit = pixels / span;
  let distance = Math.max(base, 1);
  if (perUnit * distance > minDistance) {
    while (distance > 1) {
      const result = Math.trunc(distance / divisor(distance));
      if (perUnit * result < minDistance) break;
      distance = result;
    }
  } else while (perUnit * distance < minDistance && distance < 2 ** 30) distance *= 2;
  return distance;
}
function gridStepFractions(base, pixels, span, minDistance) {
  const distance = gridStep(base, pixels, span, minDistance);
  return distance > 1 ? distance : gridStep(SUBFRAME_RANGE, pixels, span * SUBFRAME_RANGE, minDistance) / SUBFRAME_RANGE;
}
// The frames' major step: no closer than the widest label at the view's ends (get_min_line_distance_x).
function frameStep(view, v2d, { fps, fractions }) {
  const { cur } = v2d, label = (f) => view.ctx.measureText(Math.abs(f).toFixed(3)).width + 6;
  const minDistance = Math.max(MIN_MAJOR_LINE_DISTANCE, label(cur.xmin), label(cur.xmax));
  return (fractions ? gridStepFractions : gridStep)(Math.round(fps), view.width, cur.xmax - cur.xmin, minDistance);
}
const valueStep = (view, v2d) => gridStepFractions(10, view.height, v2d.cur.ymax - v2d.cur.ymin, MIN_MAJOR_LINE_DISTANCE);

// Parallel lines every `distance` across the view (draw_parallel_lines), vertical at frames or horizontal at values.
function drawLines(view, v2d, distance, color, vertical) {
  const { ctx, width, height } = view, { cur } = v2d, [lo, hi] = vertical ? [cur.xmin, cur.xmax] : [cur.ymin, cur.ymax];
  const start = Math.ceil(lo / distance) * distance, steps = start <= hi ? Math.floor((hi - start) / distance) + 1 : 0;
  if (!steps || steps >= (vertical ? width : height)) return;
  ctx.strokeStyle = css(color);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < steps; i++) {
    const at = start + i * distance;
    if (vertical) { const x = Math.round(v2d.toRegion(at, 0)[0]) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    else { const y = view.y(Math.round(v2d.toRegion(0, at)[1])) + 0.5; ctx.moveTo(0, y); ctx.lineTo(width, y); }
  }
  ctx.stroke();
}
// Minor lines (the grid color shaded by 16) between major ones where they stay apart (view2d_draw_lines).
function drawMajorMinor(view, v2d, grid, major, vertical, minor = true) {
  if (minor) {
    const distance = major > 1 ? Math.round(major) : Math.round(major * SUBFRAME_RANGE), lineDistance = major / divisor(distance);
    if ((view.width / (v2d.cur.xmax - v2d.cur.xmin)) * lineDistance > MIN_MAJOR_LINE_DISTANCE / 5) drawLines(view, v2d, lineDistance, shade(grid, 16), vertical);
  }
  drawLines(view, v2d, major, grid, vertical);
}

// The region's grid as the Dope Sheet (frames) or the Graph Editor (subframes and values) draws it.
export function drawGrid(view, v2d, grid, { values = false, fps = 24 } = {}) {
  const major = frameStep(view, v2d, { fps, fractions: values });
  drawMajorMinor(view, v2d, grid, major, true, values || major > 1);
  if (values) drawMajorMinor(view, v2d, grid, valueStep(view, v2d), false);
}

// The scene's range outside the frame range darkened, and the preview range's shading (ANIM_draw_framerange,
// ANIM_draw_previewrange).
export function drawFrameRange(view, v2d, { start, end, previewStart, previewEnd, preview }) {
  const { ctx, height, width } = view;
  const [a, b] = preview ? [previewStart, previewEnd] : [start, end];
  const left = v2d.toRegion(a, 0)[0], right = v2d.toRegion(b, 0)[0];
  ctx.fillStyle = css(preview ? anim.preview_range : [0, 0, 0], preview ? anim.preview_range[3] : 0.4 * 0.5);
  if (left > 0) ctx.fillRect(0, 0, left, height);
  if (right < width) ctx.fillRect(right, 0, width - right, height);
}

// A frame's label, with as many decimals as the step needs (frame_to_string).
const frameLabel = (f, step) => (step >= 1 ? String(Math.trunc(f)) : f.toFixed(step >= 0.5 ? 1 : step >= 0.01 ? 2 : 3));

// The time scrubbing area at the region's top: its band, frame numbers and the current frame's box; and the playhead
// down the region (time_scrub_ui.cc).
export function drawScrubbing(view, v2d, frame, scrubHeight, { seconds = false, fps = 24, fractions = false } = {}) {
  const { ctx, width, height } = view, top = 0;
  ctx.fillStyle = css(theme.regions.scrubbing.back);
  ctx.fillRect(0, top, width, scrubHeight);
  const step = frameStep(view, v2d, { fps, fractions }), { cur } = v2d;
  ctx.fillStyle = css(theme.regions.scrubbing.text);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const first = Math.ceil(cur.xmin / step);
  for (let i = first; i * step <= cur.xmax; i++) {
    const f = i * step;
    ctx.fillText(seconds ? `${Math.floor(f / fps)}+${f % fps}` : frameLabel(f, step), v2d.toRegion(f, 0)[0], top + scrubHeight / 2);
  }
  const x = v2d.toRegion(frame, 0)[0];
  ctx.fillStyle = css(anim.playhead);
  ctx.fillRect(Math.round(x) - 1, scrubHeight, 2, height - scrubHeight);
  const label = String(Math.round(frame)), boxWidth = Math.max(ctx.measureText(label).width + 10, 24), boxHeight = scrubHeight - 4;
  ctx.beginPath();
  ctx.roundRect(x - boxWidth / 2, top + 2, boxWidth, boxHeight, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x, top + scrubHeight / 2);
}

// A channel row's backdrop, as each channel type's get_backdrop_color gives it.
const ANIMTYPE = { SUMMARY: 3, SCENE: 4, OBJECT: 5, GROUP: 6, FCURVE: 7 };
function backdrop(channel) {
  if (channel.type === ANIMTYPE.SUMMARY) return theme.dopesheet_editor.summary;
  if (channel.type === ANIMTYPE.GROUP) return channel.values & (1 << ACHANNEL_SETTING.SELECT) ? anim.channel_group_active : anim.channel_group;
  if (channel.type === ANIMTYPE.SCENE || channel.type === ANIMTYPE.OBJECT) return anim.channels;
  if (channel.type === ANIMTYPE.FCURVE) return anim.channel;
  return anim.channels_sub;
}
const has = (channel, setting) => !!(channel.settings & (1 << ACHANNEL_SETTING[setting]));
const on = (channel, setting) => !!(channel.values & (1 << ACHANNEL_SETTING[setting]));

// Where a channel row is in a region's view, and its toggles (expand, visibility, mute, lock) by x in region pixels,
// for drawing and for clicks.
export function channelRows(channels, v2d, metrics) {
  return channels.map((channel, i) => {
    const ymax = metrics.firstChannelTop - i * metrics.channelStep, ymin = ymax - metrics.channelHeight;
    return { channel, ymin, ymax };
  });
}
export function channelToggles(channel, width, { graph }) {
  const toggles = [];
  let x = channel.offset;
  if (has(channel, 'EXPAND')) { toggles.push({ setting: 'EXPAND', x }); x += 16; }
  else if (channel.type !== ANIMTYPE.FCURVE) x += 4;
  const icon = x;
  x += 16;
  if (graph && has(channel, 'VISIBLE')) { toggles.push({ setting: 'VISIBLE', x: x + (channel.type === ANIMTYPE.FCURVE ? 4 : 0) }); x += 16 + (channel.type === ANIMTYPE.FCURVE ? 4 : 0); }
  let right = width - (graph && [ANIMTYPE.FCURVE, ANIMTYPE.GROUP].includes(channel.type) ? 11 : 0);
  for (const setting of ['PROTECT', 'MUTE']) if (has(channel, setting)) { right -= 18; toggles.push({ setting, x: right }); }
  return { toggles, icon, name: x + 3 };
}

const TOGGLE_ICONS = {
  EXPAND: (v) => (v ? 'DOWNARROW_HLT' : 'RIGHTARROW'), VISIBLE: (v) => (v ? 'HIDE_OFF' : 'HIDE_ON'),
  MUTE: (v) => (v ? 'CHECKBOX_DEHLT' : 'CHECKBOX_HLT'), PROTECT: (v) => (v ? 'LOCKED' : 'UNLOCKED'),
};

function drawIcon(ctx, name, x, y, redraw, alpha = 1) {
  const image = iconImage(name, redraw);
  if (!image) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, x, y, 16, 16);
  ctx.globalAlpha = 1;
}

// The channel list (ANIM_channel_draw): backdrops, expanders, icons, the F-Curves' color bands, names and toggles.
export function drawChannels(view, v2d, channels, metrics, { graph, redraw }) {
  const { ctx, width } = view;
  ctx.fillStyle = css(theme.regions.channels.back);
  ctx.fillRect(0, 0, width, view.height);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const { channel, ymin, ymax } of channelRows(channels, v2d, metrics)) {
    const top = view.y(v2d.toRegion(0, ymax)[1]), bottom = view.y(v2d.toRegion(0, ymin)[1]);
    if (bottom < metrics.scrubHeight || top > view.height) continue;
    const mid = (top + bottom) / 2, selected = on(channel, 'SELECT');
    ctx.fillStyle = css(backdrop(channel));
    ctx.fillRect(channel.offset, top, width - channel.offset, bottom - top);
    const { toggles, icon, name } = channelToggles(channel, width, { graph });
    if (channel.icon !== 'NONE') drawIcon(ctx, channel.icon, icon, mid - 8, redraw);
    if (graph && channel.type === ANIMTYPE.FCURVE) {
      ctx.fillStyle = css(channel.color, on(channel, 'VISIBLE') ? 1 : 0.3);
      ctx.fillRect(icon + 16, top, 4, bottom - top);
    }
    for (const { setting, x } of toggles) drawIcon(ctx, TOGGLE_ICONS[setting](on(channel, setting)), x, mid - 8, redraw, 0.8);
    ctx.fillStyle = css(selected ? theme.regions.channels.text_selected : theme.regions.channels.text);
    ctx.fillText(channel.name, name, mid);
  }
}

// Keyframe diamonds and holds of each channel row (draw_keylist_blocks, draw_keylist_keys).
const KEY_COLORS = ['keyframe', 'keyframe_extreme', 'keyframe_breakdown', 'keyframe_jitter', 'keyframe_moving_hold', 'keyframe_generated'];
const KEY_SIZES = [1, 1.2, 0.85, 0.8, 0.925, 0.75];
const ACTKEYBLOCK_FLAG_STATIC_HOLD = 1 << 1, WIDGET_UNIT = 20;
const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); ctx.fill(); };
// The Timeline draws no channel backdrops (action_draw.cc draws them for the Dope Sheet's modes), and a collapsed
// summary has none.
export function drawKeyRows(view, v2d, rows, metrics, { backdrops }) {
  const { ctx, width } = view;
  for (const { channel, ymin, ymax, keys } of rows) {
    const top = view.y(v2d.toRegion(0, ymax)[1]), bottom = view.y(v2d.toRegion(0, ymin)[1]);
    if (bottom < metrics.scrubHeight || top > view.height) continue;
    const mid = (top + bottom) / 2;
    if (backdrops && !(channel.type === ANIMTYPE.SUMMARY && !on(channel, 'EXPAND'))) {
      ctx.fillStyle = css(backdrop(channel), channel.type === ANIMTYPE.FCURVE ? 0.3 : backdrop(channel)[3]);
      ctx.fillRect(0, top, width, bottom - top);
    }
    const iconSize = 0.5 * WIDGET_UNIT * metrics.keyframeScale, barHeight = Math.trunc(0.45 * iconSize) * 2 - 1;
    keys.forEach((key, i) => {
      const next = keys[i + 1];
      if (!next || !key.hold) return;
      const x0 = v2d.toRegion(key.frame, 0)[0], x1 = v2d.toRegion(next.frame, 0)[0];
      const color = anim[key.block_select ? 'long_key_selected' : 'long_key'];
      if (key.hold & ACTKEYBLOCK_FLAG_STATIC_HOLD) {
        ctx.fillStyle = css(color);
        const y0 = Math.round(mid - barHeight / 2);
        roundRect(ctx, x0, y0, x1 - x0, barHeight, 3);
      } else {
        ctx.fillStyle = css(color, color[3] * 0.8);
        roundRect(ctx, x0, mid - 0.35 * iconSize, x1 - x0, 0.7 * iconSize, 3);
      }
    });
    for (const key of keys) {
      const x = v2d.toRegion(key.frame, 0)[0], size = 0.5 * iconSize * (KEY_SIZES[key.key_type] ?? 1);
      if (x < -size || x > width + size) continue;
      const name = KEY_COLORS[key.key_type] ?? 'keyframe';
      ctx.beginPath();
      ctx.moveTo(x, mid - size); ctx.lineTo(x + size, mid); ctx.lineTo(x, mid + size); ctx.lineTo(x - size, mid); ctx.closePath();
      ctx.fillStyle = css(anim[key.select ? `${name}_selected` : name]);
      ctx.fill();
      ctx.strokeStyle = css(theme.dopesheet_editor[key.select ? 'keyframe_border_selected' : 'keyframe_border']);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// The Graph Editor's curves, handles and keys (graph_draw.cc's draw_fcurve).
const HANDLE_COLORS = { FREE: 'free', AUTO: 'auto', VECTOR: 'vect', ALIGNED: 'align', AUTO_CLAMPED: 'auto_clamped' };
const SELECTED = 1 << 1, ACTIVE = 1 << 2, PROTECTED = 1 << 3, MUTED = 1 << 4;
export function drawCurves(view, v2d, list, { showHandles, onlySelectedHandles, inactiveAlpha = 0.25 }) {
  const { ctx, width } = view, { cur } = v2d;
  const point = (x, y, curve) => {
    const [rx, ry] = v2d.toRegion(x, (y + curve.offset) * curve.factor);
    return [rx, view.y(ry)];
  };
  for (const curve of list) {
    const { fcurve } = curve, flag = fcurve.flag, alpha = flag & SELECTED ? 1 : inactiveAlpha;
    if (!fcurve.length) continue;
    const samples = Math.max(2, Math.ceil(width)), step = (cur.xmax - cur.xmin) / (samples - 1), values = fcurve.sample(cur.xmin, step, samples);
    ctx.beginPath();
    values.forEach((v, i) => {
      const [x, y] = point(cur.xmin + i * step, v, curve);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.lineWidth = flag & ACTIVE && !(flag & PROTECTED) ? 2.5 : 1;
    ctx.strokeStyle = flag & MUTED ? css(shade(theme.graph_editor.space.header, 50)) : css(fcurve.color, alpha);
    ctx.setLineDash(flag & PROTECTED ? [16 * 0.65, 16 * 0.35] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    const keys = fcurve.keys, handles = showHandles && !(flag & PROTECTED);
    ctx.lineWidth = 1;
    if (handles) {
      for (const sel of [false, true]) {
        keys.forEach((k, i) => {
          if (onlySelectedHandles && !k.select.some(Boolean)) return;
          const prev = keys[i - 1], left = (!prev && k.interpolation === 'BEZIER') || prev?.interpolation === 'BEZIER', right = k.interpolation === 'BEZIER';
          const color = (type) => css(curves[`handle_${sel ? 'sel_' : ''}${HANDLE_COLORS[type]}`], alpha);
          const line = (from, to, type) => { ctx.strokeStyle = color(type); ctx.beginPath(); ctx.moveTo(...point(...from, curve)); ctx.lineTo(...point(...to, curve)); ctx.stroke(); };
          if (k.select[1] === sel) {
            if (left) line(k.handle_left, k.co, k.handle_left_type);
            if (right) line(k.co, k.handle_right, k.handle_right_type);
          } else {
            if (k.select[0] === sel && left) line(k.handle_left, k.co, k.handle_left_type);
            if (k.select[2] === sel && right) line(k.co, k.handle_right, k.handle_right_type);
          }
        });
      }
      const size = 1.4 * curves.handle_vertex_size;
      for (const sel of [false, true]) {
        ctx.strokeStyle = css(sel ? curves.handle_vertex_select : curves.handle_vertex);
        ctx.lineWidth = 1.5;
        keys.forEach((k, i) => {
          if (onlySelectedHandles && !k.select.some(Boolean)) return;
          const prev = keys[i - 1];
          const ends = [];
          if (((!prev && k.interpolation === 'BEZIER') || prev?.interpolation === 'BEZIER') && k.select[0] === sel) ends.push(k.handle_left);
          if (k.interpolation === 'BEZIER' && k.select[2] === sel) ends.push(k.handle_right);
          for (const end of ends) { ctx.beginPath(); ctx.arc(...point(...end, curve), size / 2, 0, Math.PI * 2); ctx.stroke(); }
        });
      }
    }
    const size = theme.graph_editor.vertex_size * (flag & PROTECTED ? 0.8 : 1);
    for (const sel of [false, true]) {
      ctx.fillStyle = css(sel ? theme.graph_editor.vertex_select : theme.graph_editor.vertex, Math.max(0.2, Math.min(1, 1 - (1 - alpha) * 0.5)));
      for (const k of keys) {
        if (k.select[1] !== sel) continue;
        ctx.beginPath(); ctx.arc(...point(...k.co, curve), size / 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

// A gesture's outline in region pixels: a box, a circle or a lasso path (wm_gesture_draw.cc).
export function drawGesture(view, gesture) {
  const { ctx } = view;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  if (gesture.type === 'BOX' && gesture.start) {
    const [x0, y0] = gesture.start, [x1, y1] = gesture.end ?? gesture.start;
    ctx.rect(Math.min(x0, x1), view.y(Math.max(y0, y1)), Math.abs(x1 - x0), Math.abs(y1 - y0));
  } else if (gesture.type === 'CIRCLE') {
    ctx.arc(gesture.end[0], view.y(gesture.end[1]), gesture.radius, 0, Math.PI * 2);
  } else if (gesture.type === 'LASSO' && gesture.path.length) {
    gesture.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, view.y(y)) : ctx.moveTo(x, view.y(y))));
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
