import ts from 'typescript';
import {writeFile} from 'node:fs/promises';
const file='node_modules/@babylonjs/core/Meshes/meshBuilder.d.ts';
const program=ts.createProgram([file],{skipLibCheck:true});const checker=program.getTypeChecker();const source=program.getSourceFile(file);const symbol=checker.getExportsOfModule(checker.getSymbolAtLocation(source)).find(s=>s.name==='MeshBuilder');
const type=checker.getTypeOfSymbolAtLocation(symbol,source);const catalog={};
for(const member of type.getProperties()){
 const fn=checker.getTypeOfSymbolAtLocation(member,source).getCallSignatures()[0];if(!fn)continue;const options=fn.parameters.find(p=>p.name==='options');if(!options)continue;
 const fields={};for(const field of checker.getTypeOfSymbolAtLocation(options,source).getProperties()){const t=checker.typeToString(checker.getTypeOfSymbolAtLocation(field,source));fields[field.name]={type:t,required:!(field.flags&ts.SymbolFlags.Optional)}}
 catalog[member.name]={parameters:fn.parameters.map(p=>p.name),fields};
}
await writeFile('src/objects/builder-schema.json',JSON.stringify(catalog,null,2)+'\n');
