import classes from './editor-classes.json';

const categories = [
  ['output', /Output/],
  ['input', /^(Input|NodeRenderGraphInput|GeometryInput|ParticleInput|Mesh|Contextual|SystemSource|Time|Random)Block$|Input|Source/],
  ['texture', /Texture|Image|Reflection|Refraction|Planar|Noise|Voronoi|Worley|Perlin/],
  ['shader', /PBR|Light|Sheen|ClearCoat|SubSurface|Anisotropy|Fragment|Shadow|Fog|Iridescence|Material/],
  ['filter', /PostProcess|Renderer|Bloom|Blur|Glow|Highlight|Layer|Clear|Copy|Mipmap|Culling|Taa|Ssao|Ssr/],
  ['particle', /Particle|Emitter|Update|Create|System|Shape/],
  ['geometry', /Geometry|Instantiate|Merge|Mapping|Box|Sphere|Plane|Cylinder|Torus|Capsule|Disc|Grid|Points|Mesh|Extrude|Subdivide|Boolean|Optimize|Collection/],
  ['color', /Color|Desaturate|Posterize|Gradient|Replace|Tone/],
  ['vector', /Transform|Vector|Normal|Cross|Dot|Length|Distance|Rotate|Translate|Scale|Matrix|Position|Reflect|Refract/],
  ['layout', /Elbow|Teleport|Frame|Debug|Comment/],
];
const categoryOf = name => categories.find(([, test]) => test.test(name))?.[0] || 'converter';

const sel = token => {
  const [module, name] = token.slice(1).split('.');
  const list = classes[module]?.[name] || [];
  return list.length ? ':is(' + list.map(c => '.' + c).join(',') + ')' : '.bl-missing-' + name;
};
const css = String.raw`
.node-editor-host{--node-body:#303030f2;--node-text:#e6e6e6;--node-select:#ffa733;--node-select-2:#ed5700;
  --cat-input:#83314a;--cat-output:#6b2433;--cat-shader:#2b652b;--cat-texture:#79461d;--cat-filter:#551a80;--cat-geometry:#1d725e;--cat-particle:#6c3d1a;--cat-color:#6c6a19;--cat-vector:#3c3c83;--cat-converter:#246283;--cat-layout:#3b3b3b}
.node-editor-host,.node-editor-host *{font-family:"Inter","DejaVu Sans",system-ui,sans-serif!important}
.node-editor-host #node-editor-graph-root,.node-editor-host [id$=-graph-root]{background:#1d1d1d!important;color:var(--node-text)!important;font-size:12px!important}
.node-editor-host #graph-canvas,.node-editor-host $graphCanvas.graph-canvas{background-color:#1d1d1d!important;background-image:radial-gradient(#ffffff14 1px,transparent 1.2px)!important}
.node-editor-host $graphNode.visual{background:var(--node-body)!important;border:0!important;border-radius:6px!important;box-shadow:0 2px 6px #0009,inset 0 0 0 1px #00000080!important;color:var(--node-text)!important;overflow:visible!important}
.node-editor-host $graphNode.visual$graphNode.selected,.node-editor-host $graphNode.visual .selection-border{border-radius:6px!important}
.node-editor-host $graphNode.visual$graphNode.selected{box-shadow:0 0 0 1.5px var(--node-select),0 2px 8px #000a!important}
.node-editor-host $graphNode.visual .selection-border{border-color:var(--node-select)!important}
.node-editor-host $graphNode.header-container{min-height:22px!important;border-radius:6px 6px 0 0!important;background:var(--cat,var(--cat-converter))!important;border:0!important}
.node-editor-host $graphNode.visual$graphNode.collapsed $graphNode.header-container{border-radius:6px!important}
.node-editor-host $graphNode.header{font-size:12px!important;font-weight:400!important;text-align:left!important;padding:0 8px!important;line-height:22px!important;color:#fff!important;text-shadow:0 1px 1px #0008}
.node-editor-host $graphNode.headerIcon img,.node-editor-host $graphNode.headerCollapse img{width:12px!important;height:12px!important;opacity:.75}
.node-editor-host $graphNode.connections{padding-bottom:4px!important}
.node-editor-host $common.portLine{height:22px!important}
.node-editor-host $common.port-label{font-size:12px!important;color:var(--node-text)!important}
.node-editor-host $common.port{width:10px!important;height:10px!important;border-radius:50%!important;box-shadow:0 0 0 1px #000!important}
.node-editor-host $common.port img{display:none!important}
.node-editor-host $common.inputsContainer $common.port{transform:translateX(-6px)!important}
.node-editor-host $common.outputsContainer $common.port{transform:translateX(6px)!important}
.node-editor-host $graphNode.content,.node-editor-host $graphNode.optionsContainer{color:var(--node-text)!important}
.node-editor-host $graphNode.visual input,.node-editor-host $graphNode.visual select{background:#545454!important;color:var(--node-text)!important;border:0!important;border-radius:4px!important;font-size:12px!important}
.node-editor-host $graphNode.comments{color:#a6a6a6!important;font-style:normal!important}
.node-editor-host $nodeLink.link{stroke-width:2px!important}
.node-editor-host $nodeLink.link$nodeLink.selected{stroke:#fff!important}
.node-editor-host $graphFrame.frame-box-border{border-radius:6px!important;border-color:#ffffff20!important}
.node-editor-host $graphFrame.frame-box-header{background:#3b3b3bcc!important;font-size:12px!important;color:var(--node-text)!important;border-radius:6px 6px 0 0!important}
.node-editor-host [data-bl-category=input]{--cat:var(--cat-input)}.node-editor-host [data-bl-category=output]{--cat:var(--cat-output)}.node-editor-host [data-bl-category=shader]{--cat:var(--cat-shader)}
.node-editor-host [data-bl-category=texture]{--cat:var(--cat-texture)}.node-editor-host [data-bl-category=filter]{--cat:var(--cat-filter)}.node-editor-host [data-bl-category=geometry]{--cat:var(--cat-geometry)}
.node-editor-host [data-bl-category=particle]{--cat:var(--cat-particle)}.node-editor-host [data-bl-category=color]{--cat:var(--cat-color)}.node-editor-host [data-bl-category=vector]{--cat:var(--cat-vector)}
.node-editor-host [data-bl-category=layout]{--cat:var(--cat-layout)}
.node-editor-host [id$=NodeList],.node-editor-host .node-list,.node-editor-host .nme-right-panel,.node-editor-host [class$=-right-panel],.node-editor-host #propertyTab{background:#303030!important;color:var(--node-text)!important}
.node-editor-host [id$=NodeList] .panes,.node-editor-host [id$=NodeList] .pane{background:#303030!important}
.node-editor-host .paneContainer{border:0!important;margin:0 4px 4px!important;background:#3d3d3d!important;border-radius:4px!important}
.node-editor-host .paneContainer .header,.node-editor-host #propertyTab .paneContainer .header{background:#3d3d3d!important;color:var(--node-text)!important;font-size:12px!important;height:24px!important;border-radius:4px!important}
.node-editor-host .paneContainer .header .title{padding-left:6px!important;font-size:12px!important;font-weight:400!important}
.node-editor-host .paneContainer-highlight-border{border-color:transparent!important}
.node-editor-host .draggableLine,.node-editor-host .nonDraggableLine{background:transparent!important;color:var(--node-text)!important;font-size:12px!important;border:0!important;height:22px!important;line-height:22px!important;margin:0 4px!important;border-radius:3px!important;padding-left:8px!important;text-align:left!important}
.node-editor-host .draggableLine:hover{background:#4772b3!important;color:#fff!important}
.node-editor-host .filter input,.node-editor-host [id$=NodeList] .filter input{background:#1d1d1d!important;color:var(--node-text)!important;border:0!important;border-radius:10px!important;height:20px!important;margin:6px 4px!important;padding:0 8px!important;box-shadow:inset 0 0 0 1px #3d3d3d!important}
.node-editor-host #propertyTab #header{background:#303030!important;font-size:13px!important;height:26px!important}
.node-editor-host #propertyTab #header #logo{display:none!important}
.node-editor-host #propertyTab .textLine,.node-editor-host #propertyTab .buttonLine,.node-editor-host #propertyTab .checkBoxLine,.node-editor-host #propertyTab .floatLine,.node-editor-host #propertyTab .sliderLine,.node-editor-host #propertyTab .listLine,.node-editor-host #propertyTab .color3Line,.node-editor-host #propertyTab .textInputLine{color:var(--node-text)!important;font-size:12px!important;min-height:22px!important}
.node-editor-host #propertyTab input,.node-editor-host #propertyTab select,.node-editor-host #propertyTab textarea{background:#545454!important;color:var(--node-text)!important;border:0!important;border-radius:4px!important;font-size:12px!important}
.node-editor-host #propertyTab .buttonLine button,.node-editor-host [class$=-right-panel] button{background:#545454!important;color:var(--node-text)!important;border:0!important;border-radius:4px!important;font-size:12px!important}
.node-editor-host #propertyTab .buttonLine button:hover{background:#656565!important}
.node-editor-host #propertyTab .range{accent-color:#4772b3;background:#545454!important}
.node-editor-host #nme-log-console,.node-editor-host [id$=log-console]{background:#1d1d1d!important;color:#a6a6a6!important;font-size:11px!important;border-top:2px solid #161616!important}
.node-editor-host .nme-preview-part,.node-editor-host [class*=preview-part]{background:#303030!important}
.node-editor-host #preview-config-bar,.node-editor-host #preview-mesh-bar{background:#303030!important;border-color:#1d1d1d!important}
.node-editor-host #preview-config-bar>div,.node-editor-host #preview-mesh-bar>div{background:transparent!important;border-radius:4px}
.node-editor-host #preview-config-bar>div.selected,.node-editor-host #preview-config-bar>div:hover{background:#4772b3!important}
.node-editor-host select{background:#282828!important;color:var(--node-text)!important;border:1px solid #3d3d3d!important;border-radius:4px!important}
.node-editor-host .split-container .splitter,.node-editor-host :is(${(classes.splitContainer?.splitter || []).map(c => '.' + c).join(',') || '.x'}){background:#161616!important}
.node-editor-host ::-webkit-scrollbar{width:8px;height:8px}.node-editor-host ::-webkit-scrollbar-thumb{background:#5a5a5a;border-radius:4px}.node-editor-host ::-webkit-scrollbar-track{background:transparent}
`.replace(/\$[A-Za-z]+\.[A-Za-z-]+/g, sel);

let installed = false;
export function installEditorTheme(host) {
  if (!installed) {
    document.head.append(Object.assign(document.createElement('style'), { id: 'bl-graph-editor-theme', textContent: css }));
    installed = true;
  }
  const visual = (classes.graphNode?.visual || []).map(c => '.' + c).join(',');
  const tag = root => {
    if (!visual) return;
    for (const node of root.querySelectorAll(visual)) {
      if (node.dataset.blCategory) continue;
      const name = [...node.classList].find(c => /Block$/.test(c)) || '';
      node.dataset.blCategory = categoryOf(name);
    }
  };
  const observer = new MutationObserver(() => tag(host));
  observer.observe(host, { childList: true, subtree: true });
  tag(host);
  return () => observer.disconnect();
}
