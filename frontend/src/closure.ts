// "Closed" means what the tracker needs. mr-linac-iowa reads each object as
// scipy's binary_fill_holes(arr == obj_id): flood the background 4-connected in from the
// border and keep whatever the flood cannot reach. An outline with a gap lets the flood
// in, the fill adds nothing, and the tracker is seeded with a thin line instead of a
// region -- with no error anywhere. This is the same test, so an outline is accepted
// here exactly when it will work there, plus one stricter rule (isOnePiece).
// backend/imaging.find_unclosed_objects mirrors both for the save, and the two must agree.

// Which pixels of `ids` belong to `objectId` once its holes are filled: the outline plus
// every pixel the outside cannot reach. Pixels of other objects count as background.
export function filledObject(
  ids: Uint8Array,
  width: number,
  height: number,
  objectId: number
): Uint8Array {
  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const enter = (p: number) => {
    if (outside[p] || ids[p] === objectId) return;
    outside[p] = 1;
    queue[tail++] = p;
  };

  for (let x = 0; x < width; x++) {
    enter(x);
    enter((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    enter(y * width);
    enter(y * width + width - 1);
  }

  while (head < tail) {
    const p = queue[head++]!;
    const x = p % width;
    const y = (p - x) / width;
    if (x > 0) enter(p - 1);
    if (x < width - 1) enter(p + 1);
    if (y > 0) enter(p - width);
    if (y < height - 1) enter(p + width);
  }

  const filled = new Uint8Array(width * height);
  for (let p = 0; p < filled.length; p++) filled[p] = outside[p] ? 0 : 1;
  return filled;
}

function count(a: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) n++;
  return n;
}

// Whether the object's outline encloses any area.
export function isClosed(
  ids: Uint8Array,
  width: number,
  height: number,
  objectId: number
): boolean {
  let outline = 0;
  for (let p = 0; p < ids.length; p++) if (ids[p] === objectId) outline++;
  if (outline === 0) return true; // nothing drawn, nothing to be open
  return count(filledObject(ids, width, height, objectId)) > outline;
}

// Whether the object's pixels are one 8-connected piece. The tool draws each object as a
// single polygon, so more than one piece means another object's outline cut through it.
// Enclosing an area is not enough on its own: a cut-up outline can still have one piece
// that happens to enclose a pocket, and the tracker would be seeded with just that.
export function isOnePiece(
  ids: Uint8Array,
  width: number,
  height: number,
  objectId: number
): boolean {
  let first = -1;
  let total = 0;
  for (let p = 0; p < ids.length; p++) {
    if (ids[p] === objectId) {
      total++;
      if (first < 0) first = p;
    }
  }
  if (total === 0) return true;

  const seen = new Uint8Array(ids.length);
  const stack = [first];
  seen[first] = 1;
  let reached = 0;
  while (stack.length) {
    const p = stack.pop()!;
    reached++;
    const x = p % width;
    const y = (p - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const q = ny * width + nx;
        if (!seen[q] && ids[q] === objectId) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
  }
  return reached === total;
}

// Ids of every drawn object on the frame whose outline is not one closed loop.
export function unclosedObjects(ids: Uint8Array, width: number, height: number): number[] {
  const present = new Set<number>();
  for (let p = 0; p < ids.length; p++) if (ids[p]) present.add(ids[p]!);
  return [...present]
    .sort((a, b) => a - b)
    .filter((id) => !isClosed(ids, width, height, id) || !isOnePiece(ids, width, height, id));
}
