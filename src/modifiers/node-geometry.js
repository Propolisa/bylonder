import { NodeGeometry } from '@babylonjs/core/Meshes/Node/nodeGeometry.js';
import { NodeGeometryBlock } from '@babylonjs/core/Meshes/Node/nodeGeometryBlock.js';
import { NodeGeometryBlockConnectionPointTypes as Type } from '@babylonjs/core/Meshes/Node/Enums/nodeGeometryConnectionPointTypes.js';
import { NodeGeometryContextualSources as Context } from '@babylonjs/core/Meshes/Node/Enums/nodeGeometryContextualSources.js';
import { GeometryOutputBlock } from '@babylonjs/core/Meshes/Node/Blocks/geometryOutputBlock.js';
import { GeometryInputBlock } from '@babylonjs/core/Meshes/Node/Blocks/geometryInputBlock.js';
import { InstantiateBlock } from '@babylonjs/core/Meshes/Node/Blocks/Instances/instantiateBlock.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { RegisterClass } from '@babylonjs/core/Misc/typeStore.js';
export class ModifierSourceBlock extends NodeGeometryBlock {
  constructor(name='Original Geometry'){super(name);this.data=null;this.registerOutput('geometry',Type.Geometry);}
  getClassName(){return 'ModifierSourceBlock';}
  get geometry(){return this._outputs[0];}
  _buildBlock(){this.geometry._storedValue=VertexData.Parse(structuredClone(this.data));}
  serialize(){return {...super.serialize(),data:this.data};}
  _deserialize(data){super._deserialize(data);this.data=data.data;}
}
export class ArrayTransformsBlock extends NodeGeometryBlock {
  constructor(name='Array Transforms'){super(name);this.matrices=[];this.registerOutput('matrix',Type.Matrix);}
  getClassName(){return 'ArrayTransformsBlock';}
  get matrix(){return this._outputs[0];}
  _buildBlock(){this.matrix._storedFunction=state=>this.matrices[state.getContextualValue(Context.InstanceID)]||Matrix.Identity();}
  serialize(){return {...super.serialize(),matrices:this.matrices.map(matrix=>Array.from(matrix.asArray()))};}
  _deserialize(data){super._deserialize(data);this.matrices=data.matrices.map(values=>Matrix.FromArray(values));}
}
RegisterClass('BABYLON.ModifierSourceBlock',ModifierSourceBlock);
RegisterClass('BABYLON.ArrayTransformsBlock',ArrayTransformsBlock);
export function instanceGraph(data,matrices){
  const graph=new NodeGeometry('Array'),source=new ModifierSourceBlock(),transforms=new ArrayTransformsBlock(),count=new GeometryInputBlock('Count',Type.Int),instances=new InstantiateBlock('Array Instances'),output=new GeometryOutputBlock('Evaluated Geometry');
  source.data=data;transforms.matrices=matrices;count.value=matrices.length;instances.evaluateContext=false;
  source.geometry.connectTo(instances.instance);transforms.matrix.connectTo(instances.matrix);count.output.connectTo(instances.count);instances.output.connectTo(output.geometry);graph.outputBlock=output;return graph;
}
export function evaluateInstances(data,matrices){
  const graph=instanceGraph(data,matrices);let built=false;graph.onBuildObservable.addOnce(()=>built=true);
  try{graph.build();if(!built||!graph.vertexData)throw Error('Node Geometry build did not complete.');return graph.vertexData.serialize();}finally{graph.dispose();}
}
