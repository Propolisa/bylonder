// A shader repeat zone as a GLSL loop, as EEVEE keeps one (gpu_material.cc inlines the tree with
// allow_preserving_repeat_zones): the Repeat Input is a loop block whose items are variables declared before the loop,
// read by the zone's nodes inside it, the Repeat Output writes them back at the end of each iteration, and the loop's
// results are read after it. Babylon builds the zone's nodes inside the loop (its loop blocks' scheme, LoopBlock and
// StorageWriteBlock): what they read from outside the zone is built before the loop opens.
import {
  NodeMaterialBlock, NodeMaterialBlockConnectionPointTypes as T, NodeMaterialBlockTargets as Targets, NodeMaterialConnectionPointCustomObject,
  RegisterClass,
} from '@babylonjs/core';
import { convert, glslType, glslValue, kindOf, socketType } from './sockets.js';

// A repeat item's socket type as its GPU stack passes it.
const itemSocket = (type) => socketType(type === 'FLOAT' ? 'VALUE' : type);
const RESULT = 'Result ';

// The value an input gives: its link converted to `kind`, else its value.
const inputValue = (point, value, kind) => (point.isConnected ? convert(point.associatedVariableName, kindOf(point.connectedPoint.type), kind) : glslValue(value ?? 0, kind));

export class BlenderRepeatZoneBlock extends NodeMaterialBlock {
  // `items`: the zone's repeat items, [{ identifier, type }] (NodeRepeatItem's socket_type).
  constructor(name, items = []) {
    super(name, Targets.Fragment);
    this._isLoop = true;
    this.items = items;
    this.values = {};
    this.registerInput('Iterations', T.Float, true, Targets.Fragment);
    this.registerOutput('Iteration', T.Float, Targets.Fragment);
    for (const { identifier, type } of items) {
      this.registerInput(identifier, itemSocket(type).babylon, true, Targets.Fragment);
      this.registerOutput(identifier, itemSocket(type).babylon, Targets.Fragment);
      this.registerOutput(RESULT + identifier, itemSocket(type).babylon, Targets.Fragment);
      this.getOutputByName(RESULT + identifier)._forPostBuild = true;
    }
    this.registerOutput('loopID', T.Object, undefined, new NodeMaterialConnectionPointCustomObject('loopID', this, 1, BlenderRepeatZoneBlock, 'BlenderRepeatZoneBlock'));
  }

  getClassName() { return 'BlenderRepeatZoneBlock'; }
  get loopID() { return this.getOutputByName('loopID'); }
  // The Repeat Output's output of an item: the loop's result.
  result(identifier) { return this.getOutputByName(RESULT + identifier); }
  kind(identifier) { return itemSocket(this.items.find((item) => item.identifier === identifier).type).kind; }

  // The zone's nodes: those its inner outputs reach, up to the Repeat Output.
  _zone() {
    const zone = new Set(), visit = (block) => {
      if (zone.has(block) || block === this) return;
      zone.add(block);
      if (!(block instanceof BlenderRepeatWriteBlock)) for (const output of block.outputs) for (const endpoint of output.endpoints) visit(endpoint.ownerBlock);
    };
    for (const output of this.outputs) if (!output._forPostBuild) for (const endpoint of output.endpoints) visit(endpoint.ownerBlock);
    return zone;
  }

  _customBuildStep(state, activeBlocks) {
    super._customBuildStep(state, activeBlocks);
    const zone = this._zone();
    for (const block of zone) for (const input of block.inputs) {
      const from = input.connectedPoint?.ownerBlock;
      if (from && from !== this && !zone.has(from)) this._processBuild(from, state, input, activeBlocks);
    }
  }

  _buildBlock(state) {
    super._buildBlock(state);
    for (const { identifier } of this.items) {
      const kind = this.kind(identifier), output = this.getOutputByName(identifier);
      state.compilationString += `${glslType(kind)} ${output.associatedVariableName} = ${inputValue(this.getInputByName(identifier), this.values[identifier], kind)};\n`;
    }
    const index = state._getFreeVariableName('index');
    state.compilationString += `for (int ${index} = 0; ${index} < int(${inputValue(this.getInputByName('Iterations'), this.values.Iterations, 'float')}); ${index}++) {\n`;
    state.compilationString += `float ${this.getOutputByName('Iteration').associatedVariableName} = float(${index});\n`;
    return this;
  }

  _postBuildBlock(state) {
    super._postBuildBlock(state);
    state.compilationString += '}\n';
    for (const { identifier } of this.items) {
      state.compilationString += `${glslType(this.kind(identifier))} ${this.result(identifier).associatedVariableName} = ${this.getOutputByName(identifier).associatedVariableName};\n`;
    }
    return this;
  }

  serialize() { return { ...super.serialize(), items: this.items, values: this.values }; }
  _deserialize(serializationObject, scene, rootUrl) {
    super._deserialize(serializationObject, scene, rootUrl);
    Object.assign(this.values, serializationObject.values);
  }
}
RegisterClass('BABYLON.BlenderRepeatZoneBlock', BlenderRepeatZoneBlock);

// The Repeat Output: the items' values at the end of an iteration, written to the loop's variables.
export class BlenderRepeatWriteBlock extends NodeMaterialBlock {
  constructor(name, items = []) {
    super(name, Targets.Fragment);
    this.items = items;
    this.values = {};
    this.registerInput('loopID', T.Object, false, undefined, new NodeMaterialConnectionPointCustomObject('loopID', this, 0, BlenderRepeatZoneBlock, 'BlenderRepeatZoneBlock'));
    for (const { identifier, type } of items) this.registerInput(identifier, itemSocket(type).babylon, true, Targets.Fragment);
  }

  getClassName() { return 'BlenderRepeatWriteBlock'; }
  get zone() { return this.getInputByName('loopID').connectedPoint?.ownerBlock ?? null; }

  _buildBlock(state) {
    super._buildBlock(state);
    const zone = this.zone;
    if (!zone) return this;
    for (const { identifier } of this.items) {
      const kind = zone.kind(identifier);
      state.compilationString += `${zone.getOutputByName(identifier).associatedVariableName} = ${inputValue(this.getInputByName(identifier), this.values[identifier], kind)};\n`;
    }
    return this;
  }

  serialize() { return { ...super.serialize(), items: this.items, values: this.values }; }
  _deserialize(serializationObject, scene, rootUrl) {
    super._deserialize(serializationObject, scene, rootUrl);
    Object.assign(this.values, serializationObject.values);
  }
}
RegisterClass('BABYLON.BlenderRepeatWriteBlock', BlenderRepeatWriteBlock);

// A Repeat Input and its Repeat Output (`paired`, its node, with its `repeat_items`) as the loop's two blocks, linked.
export function repeatZoneBlocks(input, output) {
  const identifiers = Object.keys(output.values ?? {}).filter((id) => id.startsWith('Item_'));
  const items = (output.properties?.repeat_items ?? []).map(({ socket_type: type }, i) => ({ identifier: identifiers[i], type }));
  const zone = new BlenderRepeatZoneBlock(input.name, items), write = new BlenderRepeatWriteBlock(output.name, items);
  zone.loopID.connectTo(write.getInputByName('loopID'));
  for (const [block, node] of [[zone, input], [write, output]]) {
    for (const [id, value] of Object.entries(node.values ?? {})) if (value !== null && block.getInputByName(id)) block.values[id] = value;
  }
  return { zone, write };
}
