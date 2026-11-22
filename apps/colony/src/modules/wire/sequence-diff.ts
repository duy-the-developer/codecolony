import type { Splice } from '../world/world-types.ts'

// An edit script between two lists of keys, as splices: the server diffs
// world versions with it and the page applies the splices. It is a patience
// diff: keys that occur once in each list anchor the match, so it runs in
// O(N log N) and stays small for the local changes a commit makes, though it
// is not always the shortest script.

// Replace deleteCount items at index `at` of the old list with the items
// b[insertStart, insertStart + insertCount) of the new one. Edits are in
// increasing order of `at` and do not overlap.
export interface SequenceEdit {
  at: number
  deleteCount: number
  insertStart: number
  insertCount: number
}

// The edits that turn a into b, or undefined when they would delete and
// insert more than maxEdits items in all.
export function diffSequences(
  a: readonly string[],
  b: readonly string[],
  maxEdits: number,
): SequenceEdit[] | undefined {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let aEnd = a.length
  let bEnd = b.length
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--
    bEnd--
  }

  const edits: SequenceEdit[] = []
  let size = 0
  // Matched runs, in order; each gap between them becomes one edit.
  let x = start
  let y = start
  for (const [anchorX, anchorY] of listAnchors(a, b, start, aEnd, bEnd)) {
    if (anchorX < x || anchorY < y) continue
    // Grow the anchor backwards over equal keys, then emit the gap before it.
    let fromX = anchorX
    let fromY = anchorY
    while (fromX > x && fromY > y && a[fromX - 1] === b[fromY - 1]) {
      fromX--
      fromY--
    }
    if (fromX > x || fromY > y) {
      edits.push({ at: x, deleteCount: fromX - x, insertStart: y, insertCount: fromY - y })
      size += fromX - x + fromY - y
      if (size > maxEdits) return undefined
    }
    x = anchorX + 1
    y = anchorY + 1
    while (x < aEnd && y < bEnd && a[x] === b[y]) {
      x++
      y++
    }
  }
  if (x < aEnd || y < bEnd) {
    edits.push({ at: x, deleteCount: aEnd - x, insertStart: y, insertCount: bEnd - y })
    size += aEnd - x + bEnd - y
  }
  return size > maxEdits ? undefined : edits
}

// Pairs [x, y] with a[x] === b[y] for keys found once in a[start, aEnd) and
// once in b[start, bEnd), keeping the longest run increasing in both.
function listAnchors(
  a: readonly string[],
  b: readonly string[],
  start: number,
  aEnd: number,
  bEnd: number,
): [number, number][] {
  // Position in b, or -1 once the key is seen twice.
  const inB = new Map<string, number>()
  for (let y = start; y < bEnd; y++) {
    const key = b[y] as string
    inB.set(key, inB.has(key) ? -1 : y)
  }
  const inA = new Map<string, number>()
  for (let x = start; x < aEnd; x++) {
    const key = a[x] as string
    inA.set(key, inA.has(key) ? -1 : x)
  }
  const pairs: [number, number][] = []
  for (let x = start; x < aEnd; x++) {
    const key = a[x] as string
    const y = inB.get(key)
    if (y !== undefined && y >= 0 && inA.get(key) === x) pairs.push([x, y])
  }
  return longestIncreasing(pairs)
}

// The longest subsequence of pairs (already increasing in x) that also
// increases in y, by patience sorting.
function longestIncreasing(pairs: [number, number][]): [number, number][] {
  // tails[k]: index into pairs of the smallest y ending a run of length k + 1.
  const tails: number[] = []
  const previous = new Int32Array(pairs.length)
  for (let i = 0; i < pairs.length; i++) {
    const y = (pairs[i] as [number, number])[1]
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (((pairs[tails[mid] as number] as [number, number])[1] as number) < y) lo = mid + 1
      else hi = mid
    }
    previous[i] = lo > 0 ? (tails[lo - 1] as number) : -1
    tails[lo] = i
  }
  const run: [number, number][] = []
  for (
    let i = tails.length > 0 ? (tails.at(-1) as number) : -1;
    i >= 0;
    i = previous[i] as number
  ) {
    run.push(pairs[i] as [number, number])
  }
  return run.reverse()
}

// Builds the new list from the old one: kept items as they are, inserted ones
// converted from the splices' items.
export function applySplices<T, I>(
  base: readonly T[],
  splices: readonly Splice<I>[],
  convert: (item: I, index: number) => T,
): T[] {
  const next: T[] = []
  let copied = 0
  for (const [at, deleteCount, items] of splices) {
    for (let i = copied; i < at; i++) next.push(base[i] as T)
    for (const item of items) next.push(convert(item, next.length))
    copied = at + deleteCount
  }
  for (let i = copied; i < base.length; i++) next.push(base[i] as T)
  return next
}
