// Ranks the children of one container by the imports between them: an item
// ranks one above the highest item it imports, so importers sit above what
// they import. Items in an import cycle share a rank.

// from id -> ids it imports.
export type ItemGraph = ReadonlyMap<string, ReadonlySet<string>>

export function rankItems(ids: readonly string[], graph: ItemGraph): Map<string, number> {
  // Tarjan's strongly connected components, iterative so that long import
  // chains cannot overflow the stack. Components come out sinks first, so
  // everything a component imports is ranked before it.
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const component = new Map<string, number>()
  const componentRank: number[] = []
  let counter = 0

  const known = new Set(ids)
  const successors = (id: string): string[] =>
    [...(graph.get(id) ?? [])].filter((next) => next !== id && known.has(next))

  for (const start of ids) {
    if (index.has(start)) continue
    const frames: { id: string; next: string[]; at: number }[] = []
    const open = (id: string) => {
      index.set(id, counter)
      low.set(id, counter)
      counter++
      stack.push(id)
      onStack.add(id)
      frames.push({ id, next: successors(id), at: 0 })
    }
    open(start)
    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as (typeof frames)[number]
      const next = frame.next[frame.at++]
      if (next !== undefined) {
        if (!index.has(next)) open(next)
        else if (onStack.has(next))
          low.set(frame.id, Math.min(low.get(frame.id) as number, index.get(next) as number))
        continue
      }
      frames.pop()
      const parent = frames[frames.length - 1]
      if (parent)
        low.set(parent.id, Math.min(low.get(parent.id) as number, low.get(frame.id) as number))
      if (low.get(frame.id) !== index.get(frame.id)) continue
      const members: string[] = []
      for (;;) {
        const member = stack.pop() as string
        onStack.delete(member)
        members.push(member)
        if (member === frame.id) break
      }
      const c = componentRank.length
      let rank = 0
      for (const member of members) component.set(member, c)
      for (const member of members) {
        for (const next of graph.get(member) ?? []) {
          const other = component.get(next)
          if (other !== undefined && other !== c)
            rank = Math.max(rank, (componentRank[other] as number) + 1)
        }
      }
      componentRank.push(rank)
    }
  }
  return new Map(ids.map((id) => [id, componentRank[component.get(id) as number] as number]))
}
