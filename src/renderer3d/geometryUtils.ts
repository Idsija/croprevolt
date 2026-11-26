import * as THREE from 'three';

/**
 * A mesh with a material array costs one draw call per geometry group, so a box with six
 * face materials costs six draws even when most faces share a material. This reorders the
 * index buffer so faces with the same material sit next to each other and returns a mesh
 * with one group (and one draw call) per distinct material. The picture is unchanged.
 */
export function compactMultiMaterialMesh(
  geometry: THREE.BufferGeometry,
  materials: THREE.Material[]
): THREE.Mesh {
  const index = geometry.getIndex();
  if (!index || geometry.groups.length === 0) return new THREE.Mesh(geometry, materials);

  const unique: THREE.Material[] = [];
  const buckets: number[][] = [];
  for (const group of geometry.groups) {
    const material = materials[group.materialIndex ?? 0];
    if (!material) continue;
    let slot = unique.indexOf(material);
    if (slot < 0) {
      slot = unique.length;
      unique.push(material);
      buckets.push([]);
    }
    for (let i = group.start; i < group.start + group.count; i++) buckets[slot].push(index.getX(i));
  }

  geometry.setIndex(buckets.flat());
  geometry.clearGroups();
  let start = 0;
  buckets.forEach((bucket, slot) => {
    geometry.addGroup(start, bucket.length, slot);
    start += bucket.length;
  });
  return unique.length === 1 ? new THREE.Mesh(geometry, unique[0]) : new THREE.Mesh(geometry, unique);
}
