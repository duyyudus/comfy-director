/** "What differs" between attempts (Compare view). */

export interface DiffRow {
  key: string
  label: string
  cells: string[]
  differsFromFirst: boolean[]
}

export interface ValueDiff {
  rows: DiffRow[]
  same: string[]
}

export interface DiffColumn {
  values: Record<string, unknown>
}

export function diffValues(columns: DiffColumn[], labels: Record<string, string>, format: (key: string, v: unknown) => string): ValueDiff {
  const keys: string[] = []
  for (const c of columns) for (const k of Object.keys(c.values)) if (!keys.includes(k)) keys.push(k)
  const rows: DiffRow[] = []
  const same: string[] = []
  for (const key of keys) {
    const cells = columns.map((c) => format(key, c.values[key]))
    const raw = columns.map((c) => JSON.stringify(c.values[key] ?? null))
    const differsFromFirst = raw.map((r) => r !== raw[0])
    if (differsFromFirst.some(Boolean)) rows.push({ key, label: labels[key] ?? key, cells, differsFromFirst })
    else same.push(labels[key] ?? key)
  }
  return { rows, same }
}
