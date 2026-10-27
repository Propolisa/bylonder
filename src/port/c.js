// C semantics the generated ports need at run time.

// An array of count structs made by make, as C allocates one. Each element knows its array and index, so a pointer
// to any of them supports pointer arithmetic: p + k is p.$a[p.$i + k]. The result is the pointer to element 0.
export function structs(count, make) {
  const array = new Array(count);
  for (let i = 0; i < count; i++) {
    const element = make();
    element.$a = array;
    element.$i = i;
    array[i] = element;
  }
  return count ? array[0] : null;
}

export const element_at = (pointer, offset) => pointer.$a[pointer.$i + offset];
