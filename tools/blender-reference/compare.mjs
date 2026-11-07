// Side-by-side and diff images of a Blender and a Bylonder screenshot, with mismatch scores, computed in a browser page.
// A pixel differs when its channels differ by more than 48 in sum, enough to ignore anti-aliasing and small color shifts.
// `areas`: rectangles ({ type, x, y, width, height }) to score each on its own.
export async function compare(page, blenderPng, bylonderPng, areas) {
  const result = await page.evaluate(async ([a, b, areas]) => {
    const load = async (base64) => createImageBitmap(await (await fetch("data:image/png;base64," + base64)).blob());
    const [left, right] = await Promise.all([load(a), load(b)]);
    const { width, height } = left;
    const pixels = (bitmap) => {
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, width, height);
    };
    const pa = pixels(left).data, pb = pixels(right).data;
    const diff = new ImageData(width, height), mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      const o = i * 4, d = Math.abs(pa[o] - pb[o]) + Math.abs(pa[o + 1] - pb[o + 1]) + Math.abs(pa[o + 2] - pb[o + 2]);
      const gray = (pa[o] + pa[o + 1] + pa[o + 2]) / 12;
      mask[i] = d > 48;
      diff.data.set(mask[i] ? [255, 40, 90, 255] : [gray, gray, gray, 255], o);
    }
    const score = (x0, y0, w, h) => {
      let n = 0;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) n += mask[y * width + x];
      return n / (w * h);
    };
    const png = async (draw, w) => {
      const canvas = new OffscreenCanvas(w, height);
      draw(canvas.getContext("2d"));
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      let text = "";
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    };
    return {
      mismatch: score(0, 0, width, height),
      editors: Object.fromEntries((areas || []).map((r) => [r.type, score(r.x, r.y, r.width, r.height)])),
      sideBySide: await png((ctx) => { ctx.drawImage(left, 0, 0); ctx.drawImage(right, width, 0); }, width * 2),
      diff: await png((ctx) => ctx.putImageData(diff, 0, 0), width),
    };
  }, [blenderPng.toString("base64"), bylonderPng.toString("base64"), areas]);
  return { ...result, sideBySide: Buffer.from(result.sideBySide, "base64"), diff: Buffer.from(result.diff, "base64") };
}
