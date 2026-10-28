export function starfield(scene, count) {
  const sps = new BABYLON.PointsCloudSystem('Stars', 2, scene);
  sps.addPoints(count, particle => {
    const d = BABYLON.Vector3.Random(-1, 1).normalize().scale(80 + Math.random() * 40);
    particle.position = d;
    const b = 0.6 + Math.random() * 0.4;
    particle.color = new BABYLON.Color4(b, b, b + 0.1, 1);
  });
  return sps.buildMeshAsync().then(mesh => { mesh.isPickable = false; mesh.metadata = { editable: false }; return mesh; });
}
