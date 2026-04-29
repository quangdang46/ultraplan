// src/server/suggest/rankingProvider.ts
// File ranking/scoring for suggestions

import { basename } from 'node:path'

export function scoreFile(file: string, query: string): number {
  if (!query) return file.split('/').length
  const f = file.toLowerCase()
  const q = query.toLowerCase()
  if (f === q) return 0
  if (f.startsWith(q)) return 5
  if (basename(f).startsWith(q)) return 10
  const idx = f.indexOf(q)
  if (idx >= 0) return 40 + idx
  return 1000
}