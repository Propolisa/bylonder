// Blender's scene.sequence_editor: the scene's video edit, document slice "sequenceEditor". It stores the
// sequencer engine's edit as is ({ engine, edit }); strips() gives a Blender-shaped, read-only view of it.
const BLENDER_TYPES = { video: 'MOVIE', audio: 'SOUND', image: 'IMAGE', text: 'TEXT', shape: 'COLOR', adjustment: 'ADJUSTMENT', composition: 'META', scene: 'SCENE' };

export function strips(record) {
  const timeline = record?.edit?.timeline;
  if (!timeline) return [];
  const order = [...(timeline.tracks || [])].sort((a, b) => b.order - a.order).map((t) => t.id);
  return (timeline.items || []).map((item) => ({
    name: item.id,
    type: BLENDER_TYPES[item.type] || item.type.toUpperCase(),
    channel: order.indexOf(item.trackId) + 1,
    frameStart: item.from,
    frameFinalDuration: item.durationInFrames,
    ...(item.type === 'scene' && { scene: item.scene, camera: item.camera, sceneFrameStart: item.sourceStart ?? 0 }),
  }));
}

export function createSequenceEditor({ commit = () => {} } = {}) {
  let state;
  const listeners = new Set();
  const emit = (source) => listeners.forEach((fn) => fn(source));
  return {
    get state() { return state; },
    set(next) { state = next; emit('edit'); commit(); },
    capture: () => state,
    apply(saved) {
      if (JSON.stringify(saved) === JSON.stringify(state)) return;
      state = saved;
      emit('apply');
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { listeners.clear(); },
  };
}
