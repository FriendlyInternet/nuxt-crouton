import { connectDevframe } from 'devframe/client'

function table(rows: unknown): string {
  const list = Array.isArray(rows) ? rows : (rows as any)?.operations ?? (rows as any)?.collections ?? []
  if (!list.length) return '<em>none</em>'
  const cols = [...new Set(list.flatMap((r: any) => Object.keys(r ?? {})))] as string[]
  const esc = (s: unknown) => String(typeof s === 'object' ? JSON.stringify(s) : s ?? '').replace(/</g, '&lt;')
  return `<table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${
    list.map((r: any) => `<tr>${cols.map(c => `<td>${esc(r?.[c])}</td>`).join('')}</tr>`).join('')}</table>`
}

const rpc = await connectDevframe()
const call = rpc.call as (name: string, ...args: unknown[]) => Promise<unknown>
document.getElementById('collections')!.innerHTML = table(await call('crouton-df:list-collections'))
document.getElementById('operations')!.innerHTML = table(await call('crouton-df:list-operations', {}))
