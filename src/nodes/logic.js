import { blockFactory, FlowGraphBlockNames, FlowGraphCoordinator, FlowGraphEventBlock, FlowGraphExecutionBlock, GetDataOutConnectionByUniqueId, GetSignalInConnectionByUniqueId, ParseBlockAsync } from '@babylonjs/core';

const configs = {
  FlowGraphConstantBlock: { value: 0 },
  FlowGraphSequenceBlock: { outputSignalCount: 2 },
  FlowGraphWaitAllBlock: { inputSignalCount: 2 },
  FlowGraphSwitchBlock: { cases: [0, 1] },
  FlowGraphDataSwitchBlock: { cases: [0, 1] },
  FlowGraphGetVariableBlock: { variable: 'value' },
  FlowGraphSetVariableBlock: { variable: 'value' },
  FlowGraphSendCustomEventBlock: { eventId: 'event', eventData: {} },
  FlowGraphReceiveCustomEventBlock: { eventId: 'event', eventData: {} },
  FlowGraphGetPropertyBlock: { propertyName: 'position', resetToDefaultValue: false },
  FlowGraphSetPropertyBlock: { propertyName: 'position' },
};
const groups = [
  ['Event', /Event/], ['Flow', /Branch|Sequence|Switch|WaitAll|Throttle|DoN|ForLoop|WhileLoop|FlipFlop|Debounce|MultiGate|Cancel|SetDelay|Counter|Cache/],
  ['Animation', /Animation|Interpolation|Easing|Bezier/], ['Debug', /Log|Debug/],
  ['Data', /Property|Variable|Asset|Constant|Json|Context|Conditional|DataSwitch|Index|Transform|Cast/],
  ['Vector', /Vector|Matrix|Quaternion|Combine|Extract|Dot|Cross|Length|Normalize|Rotate|Transpose|Determinant|Invert/],
  ['Math', /./],
];
export const blockGroup = name => groups.find(([, test]) => test.test(name))[0];
export const blockLabel = name => name.replace(/^FlowGraph/, '').replace(/Block$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
const unsupported = new Set(['FlowGraphJsonPointerParserBlock', 'FlowGraphGetAssetBlock']);

export function createLogic(world, { commit = () => {}, notify = console.warn } = {}) {
  const { scene } = world;
  let coordinator = null, blocks = [], positions = new Map(), running = true, revision = 0;
  const listeners = new Set();
  const emit = () => { revision++; listeners.forEach(fn => fn()); };
  const available = (async () => {
    const result = [];
    for (const name of Object.values(FlowGraphBlockNames)) {
      if (unsupported.has(name)) continue;
      try { const Block = await blockFactory(name)(); new Block(configs[name]); result.push(name); } catch {}
    }
    return result;
  })();
  const restart = () => {
    coordinator?.dispose();
    coordinator = new FlowGraphCoordinator({ scene });
    const graph = coordinator.createGraph();
    graph.createContext();
    for (const block of blocks) if (block instanceof FlowGraphEventBlock) graph.addEventBlock(block);
    if (running && blocks.length) try { coordinator.start(); } catch (error) { notify('Logic: ' + error.message); }
  };
  const serializeBlock = block => { const json = {}; block.serialize(json); return json; };
  const api = {
    get blocks() { return blocks; },
    get running() { return running; },
    get revision() { return revision; },
    available: () => available,
    position: block => positions.get(block) || { x: 0, y: 0 },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async add(name, at = { x: 0, y: 0 }) {
      try {
        const Block = await blockFactory(name)();
        const block = new Block(configs[name] ? structuredClone(configs[name]) : undefined);
        blocks.push(block);
        positions.set(block, at);
        restart(); commit(); emit();
        return block;
      } catch (error) { notify('Logic: ' + error.message); }
    },
    remove(list) {
      for (const block of list) {
        for (const c of [...block.dataInputs, ...block.dataOutputs, ...(block.signalInputs || []), ...(block.signalOutputs || [])]) c.disconnectFromAll();
        positions.delete(block);
      }
      blocks = blocks.filter(b => !list.includes(b));
      restart(); commit(); emit();
    },
    move(block, at, record = false) { positions.set(block, at); if (record) commit(); emit(); },
    connect(output, input) {
      if (input.connectionType === output.connectionType || input._ownerBlock === output._ownerBlock) return false;
      if (input.isConnected?.() && 'richType' in input) input.disconnectFromAll();
      output.connectTo(input);
      restart(); commit(); emit();
      return true;
    },
    disconnect(connection) { connection.disconnectFromAll(); restart(); commit(); emit(); },
    setDefault(input, value) { input._defaultValue = value; restart(); commit(); emit(); },
    setRunning(value) { running = value; restart(); emit(); },
    capture: () => ({ blocks: blocks.map(serializeBlock), positions: Object.fromEntries(blocks.map(b => [b.uniqueId, positions.get(b)])), running }),
    async apply(state = {}) {
      const list = state.blocks || [];
      if (JSON.stringify(list) === JSON.stringify(blocks.map(serializeBlock)) && (state.running ?? true) === running) return;
      const parsed = [];
      for (const json of list) {
        try { parsed.push(await ParseBlockAsync(json, { scene, assetsContainer: scene, valueParseFunction: undefined })); } catch (error) { notify('Logic: ' + error.message); }
      }
      for (const block of parsed) {
        for (const input of block.dataInputs) for (const id of input.connectedPointIds || []) { const out = GetDataOutConnectionByUniqueId(parsed, id); if (out) input.connectTo(out); }
        if (block instanceof FlowGraphExecutionBlock) for (const out of block.signalOutputs) for (const id of out.connectedPointIds || []) { const input = GetSignalInConnectionByUniqueId(parsed, id); if (input) out.connectTo(input); }
      }
      blocks = parsed;
      positions = new Map(parsed.map(b => [b, state.positions?.[b.uniqueId] || { x: 0, y: 0 }]));
      running = state.running ?? true;
      restart(); emit();
    },
    dispose() { coordinator?.dispose(); listeners.clear(); },
  };
  return api;
}
