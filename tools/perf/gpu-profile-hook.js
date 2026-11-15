// The GPU profiler's page side, run in every frame of a page before its own scripts (tools/perf/gpu-profile.mjs adds it
// with addInitScript). It sits under Babylon at the WebGPU API: each render and compute pass gets begin and end
// timestamps (timestamp-query), labelled by the pass's label, the debug groups open around it (Babylon's GPU debug
// markers, Bylonder's own dispatch labels) and the shaders it ran. It also counts per frame what a frame should not
// repeat: pipelines, shader modules, bind groups and buffers created, bytes written, submits. A pass that already has
// timestamps (Babylon's own GPU timing) keeps them and is counted without a time. Results: globalThis.__gpuProfile.
(() => {
  if (!globalThis.GPUDevice || globalThis.__gpuProfile) return;
  const QUERIES = 4096, KEEP = 240;
  // `pipelines`: each pipeline made, in order, with its shaders and their code sizes (a pipeline whose shader the GPU
  // compiles for long shows in a Chrome trace as DeviceBase::APICreateRenderPipeline, in the same order); `code`: each
  // shader's source by name, kept when the page sets __gpuProfileCode.
  const profile = (globalThis.__gpuProfile = { frames: [], pipelines: [], code: {}, timestamps: 'unknown' });
  const newFrame = () => ({ document: location.pathname, at: performance.now(), rafs: 0, passes: [], pending: 0, counts: { submits: 0, bindGroups: 0, buffers: 0, bufferBytes: 0, writes: 0, writeBytes: 0, pipelines: 0, shaderModules: 0, mapAsync: 0 } });
  let frame = newFrame(), lastRaf = -1;
  // An animation frame that encoded no pass is merged into the next one (`rafs` counts them), so what a stall created
  // stays on record.
  const rotate = () => {
    frame.rafs++;
    if (!frame.passes.length) return;
    profile.frames.push(frame);
    if (profile.frames.length > KEEP) profile.frames.shift();
    frame = newFrame();
  };
  // A frame is what one animation frame encoded, closed when the next one starts.
  const raf = globalThis.requestAnimationFrame.bind(globalThis);
  globalThis.requestAnimationFrame = (callback) => raf((time) => {
    if (time !== lastRaf) { lastRaf = time; rotate(); }
    callback(time);
  });

  const wrap = (proto, name, after) => {
    const original = proto?.[name];
    if (!original) return;
    proto[name] = function (...args) { return after.call(this, original, args); };
  };
  const fnv1a = (text) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  // A shader's name: its module's label unless that is generic, else its bindings' names (a compute kernel reads as
  // compute(src,dst,joints,idx,wgt)) or a hash of its code.
  const moduleNames = new WeakMap(), moduleSizes = new WeakMap(), pipelineNames = new WeakMap();
  const shaderName = (desc) => {
    const code = desc.code ?? '', vars = [...code.matchAll(/var<storage[^>]*>\s*(\w+)/g)].map((m) => m[1]);
    if (desc.label && !/^(vertex|fragment|compute)$/i.test(desc.label)) return desc.label;
    return vars.length && /@compute/.test(code) ? `compute(${vars.join(',')})` : `${desc.label ?? 'shader'}#${fnv1a(code)}`;
  };
  const stageName = (stage) => stage && `${moduleNames.get(stage.module) ?? '?'}${stage.entryPoint && stage.entryPoint !== 'main' ? `:${stage.entryPoint}` : ''}`;
  const computeName = (desc) => desc.label ?? stageName(desc.compute);
  const renderName = (desc) => (desc.label && !desc.label.startsWith('RenderPipeline_') ? desc.label : stageName(desc.fragment) ?? stageName(desc.vertex));

  wrap(globalThis.GPUAdapter?.prototype, 'requestDevice', function (original, [desc = {}]) {
    const wanted = new Set(desc.requiredFeatures ?? []);
    if (this.features.has('timestamp-query')) wanted.add('timestamp-query');
    return original.call(this, { ...desc, requiredFeatures: [...wanted] });
  });
  const D = GPUDevice.prototype;
  wrap(D, 'createShaderModule', function (original, [desc]) {
    frame.counts.shaderModules++;
    const module = original.call(this, desc), name = shaderName(desc);
    moduleNames.set(module, name);
    moduleSizes.set(module, desc.code?.length ?? 0);
    if (globalThis.__gpuProfileCode) profile.code[name] = desc.code;
    return module;
  });
  const made = (desc, kind) => {
    frame.counts.pipelines++;
    const stages = [desc.compute, desc.vertex, desc.fragment].filter(Boolean);
    profile.pipelines.push({ kind, at: performance.now(), label: desc.label ?? '', shaders: stages.map((s) => moduleNames.get(s.module)), sizes: stages.map((s) => moduleSizes.get(s.module)) });
  };
  for (const [name, label, kind] of [['createComputePipeline', computeName, 'compute'], ['createRenderPipeline', renderName, 'render']]) {
    wrap(D, name, function (original, [desc]) { made(desc, kind); const p = original.call(this, desc); pipelineNames.set(p, label(desc)); return p; });
    wrap(D, `${name}Async`, function (original, [desc]) { made(desc, kind); return original.call(this, desc).then((p) => { pipelineNames.set(p, label(desc)); return p; }); });
  }
  wrap(D, 'createBindGroup', function (original, args) { frame.counts.bindGroups++; return original.apply(this, args); });
  wrap(D, 'createBuffer', function (original, [desc]) { frame.counts.buffers++; frame.counts.bufferBytes += desc.size; return original.call(this, desc); });
  const mapAsync = GPUBuffer.prototype.mapAsync;
  wrap(globalThis.GPUBuffer?.prototype, 'mapAsync', function (original, args) { frame.counts.mapAsync++; return original.apply(this, args); });
  wrap(globalThis.GPUQueue?.prototype, 'writeBuffer', function (original, args) {
    frame.counts.writes++;
    frame.counts.writeBytes += args[4] ?? (args[2].byteLength ?? args[2].length) - (args[3] ?? 0);
    return original.apply(this, args);
  });

  // Query sets with their resolve and read buffers, per device, reused once read.
  const pools = new WeakMap(), encoders = new WeakMap(), passes = new WeakMap(), buffers = new WeakMap(), devices = new WeakMap();
  const slotFor = (device) => {
    if (!device.features.has('timestamp-query')) { profile.timestamps = 'not granted'; return null; }
    profile.timestamps = 'on';
    const pool = pools.get(device) ?? pools.set(device, []).get(device);
    return pool.pop() ?? {
      device,
      set: device.createQuerySet({ label: 'gpu-profile', type: 'timestamp', count: QUERIES }),
      resolve: device.createBuffer({ label: 'gpu-profile resolve', size: QUERIES * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
      read: device.createBuffer({ label: 'gpu-profile read', size: QUERIES * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    };
  };
  wrap(D, 'createCommandEncoder', function (original, args) {
    const encoder = original.apply(this, args);
    encoders.set(encoder, { device: this, groups: [], passes: [], slot: null, used: 0, frame });
    return encoder;
  });
  const E = GPUCommandEncoder.prototype;
  wrap(E, 'pushDebugGroup', function (original, [label]) { encoders.get(this)?.groups.push(label); return original.call(this, label); });
  wrap(E, 'popDebugGroup', function (original) { encoders.get(this)?.groups.pop(); return original.call(this); });
  for (const [name, kind] of [['beginRenderPass', 'render'], ['beginComputePass', 'compute']]) {
    wrap(E, name, function (original, [desc = {}]) {
      const state = encoders.get(this);
      const record = { kind, label: desc.label ?? '', target: targetOf(desc), group: state?.groups.join(' / ') ?? '', shaders: {}, dispatches: 0, workgroups: 0, draws: 0, ms: null };
      let timed = desc;
      if (state && !desc.timestampWrites && state.used + 2 <= QUERIES && (state.slot ??= slotFor(state.device))) {
        record.query = state.used;
        timed = { ...desc, timestampWrites: { querySet: state.slot.set, beginningOfPassWriteIndex: state.used, endOfPassWriteIndex: state.used + 1 } };
        state.used += 2;
      }
      state?.passes.push(record);
      (state?.frame ?? frame).passes.push(record);
      const pass = original.call(this, timed);
      passes.set(pass, record);
      return pass;
    });
  }
  // A render pass's target: its first attachment's texture, by label and size (the canvas a pass draws for).
  const views = new WeakMap();
  wrap(globalThis.GPUTexture?.prototype, 'createView', function (original, args) { const view = original.apply(this, args); views.set(view, `${this.label || 'texture'} ${this.width}x${this.height}`); return view; });
  wrap(globalThis.GPUCanvasContext?.prototype, 'getCurrentTexture', function (original, args) { const texture = original.apply(this, args); texture.label ||= `canvas ${this.canvas.id || this.canvas.className || ''}`.trim(); return texture; });
  const targetOf = (desc) => { const a = desc.colorAttachments?.find(Boolean) ?? desc.depthStencilAttachment; return a ? views.get(a.view) ?? '' : ''; };
  const shader = (record, pipeline) => { record.current = pipelineNames.get(pipeline) ?? 'unnamed pipeline'; record.shaders[record.current] ??= { dispatches: 0, workgroups: 0, draws: 0 }; };
  const R = GPURenderPassEncoder.prototype, C = GPUComputePassEncoder.prototype;
  wrap(C, 'setPipeline', function (original, [p]) { const r = passes.get(this); if (r) shader(r, p); return original.call(this, p); });
  wrap(R, 'setPipeline', function (original, [p]) { const r = passes.get(this); if (r) shader(r, p); return original.call(this, p); });
  const dispatched = (r, groups) => { r.dispatches++; r.workgroups += groups; const s = r.shaders[r.current]; if (s) { s.dispatches++; s.workgroups += groups; } };
  wrap(C, 'dispatchWorkgroups', function (original, args) { const r = passes.get(this); if (r) dispatched(r, (args[0] ?? 1) * (args[1] ?? 1) * (args[2] ?? 1)); return original.apply(this, args); });
  wrap(C, 'dispatchWorkgroupsIndirect', function (original, args) { const r = passes.get(this); if (r) dispatched(r, 0); return original.apply(this, args); });
  for (const name of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) {
    wrap(R, name, function (original, args) { const r = passes.get(this); if (r) { r.draws++; const s = r.shaders[r.current]; if (s) s.draws++; } return original.apply(this, args); });
  }
  // Render bundles: their draws count where a pass executes them.
  const bundles = new WeakMap(), B = globalThis.GPURenderBundleEncoder?.prototype;
  wrap(D, 'createRenderBundleEncoder', function (original, args) { const e = original.apply(this, args); passes.set(e, { shaders: {}, draws: 0 }); return e; });
  wrap(B, 'setPipeline', function (original, [p]) { const r = passes.get(this); if (r) shader(r, p); return original.call(this, p); });
  for (const name of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) {
    wrap(B, name, function (original, args) { const r = passes.get(this); if (r) { r.draws++; const s = r.shaders[r.current]; if (s) s.draws++; } return original.apply(this, args); });
  }
  wrap(B, 'finish', function (original, args) { const bundle = original.apply(this, args); bundles.set(bundle, passes.get(this)); return bundle; });
  wrap(R, 'executeBundles', function (original, [list]) {
    const r = passes.get(this);
    for (const b of r ? list : []) {
      const recorded = bundles.get(b);
      r.bundles = (r.bundles ?? 0) + 1;
      if (!recorded) continue;
      r.draws += recorded.draws;
      for (const [name, s] of Object.entries(recorded.shaders)) { r.shaders[name] ??= { dispatches: 0, workgroups: 0, draws: 0 }; r.shaders[name].draws += s.draws; }
    }
    return original.call(this, list);
  });
  wrap(E, 'finish', function (original, args) {
    const state = encoders.get(this);
    if (state?.slot && state.used) {
      this.resolveQuerySet(state.slot.set, 0, state.used, state.slot.resolve, 0);
      this.copyBufferToBuffer(state.slot.resolve, 0, state.slot.read, 0, state.used * 8);
    }
    const buffer = original.apply(this, args);
    if (state) { buffers.set(buffer, state); devices.set(buffer, state.device); }
    return buffer;
  });
  wrap(GPUQueue.prototype, 'submit', function (original, [list]) {
    frame.counts.submits++;
    const result = original.call(this, list);
    for (const buffer of list) {
      const state = buffers.get(buffer);
      if (!state?.slot || !state.used) continue;
      const { slot, used } = state;
      state.frame.pending++;
      mapAsync.call(slot.read, GPUMapMode.READ, 0, used * 8).then(() => {
        const t = new BigInt64Array(slot.read.getMappedRange(0, used * 8));
        for (const record of state.passes) if (record.query !== undefined) record.ms = Number(t[record.query + 1] - t[record.query]) / 1e6;
        slot.read.unmap();
        pools.get(slot.device).push(slot);
      }, () => {}).finally(() => { state.frame.pending--; });
    }
    return result;
  });
})();
