// Override of Babylon's PBRMetallicRoughnessMaterial and PBRSpecularGlossinessMaterial serialize: the serialized material keeps its uniqueId, which their own serialize leaves out, so meshes find it by materialUniqueId; goes when Babylon serializes it.
import { PBRMetallicRoughnessMaterial, PBRSpecularGlossinessMaterial } from '@babylonjs/core';

for (const type of [PBRMetallicRoughnessMaterial, PBRSpecularGlossinessMaterial]) {
  const serialize = type.prototype.serialize;
  type.prototype.serialize = function () { return { ...serialize.call(this), uniqueId: this.uniqueId }; };
}
