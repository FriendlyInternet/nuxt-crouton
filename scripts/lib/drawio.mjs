// layer: harness
/**
 * draw.io (diagrams.net) emitter — same graph, same layout as the Excalidraw path, but as a
 * draw.io mxGraphModel. The point of draw.io: its GitHub mode opens/edits/SAVES files straight
 * back to the repo (native commit-back), so the human edits on their phone and Save commits —
 * no export/attach/importer. Spike for #502.
 *
 * Diagram content is left UNCOMPRESSED (raw <mxGraphModel> inside <diagram>) — draw.io reads
 * that directly, so we avoid the deflate/base64 dance.
 */
import { layout, STATUS } from './excalidraw.mjs'

const xmlAttr = (s) =>
  String(s)
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    .replace(/\n/g, '&#10;')

function vertex(id, x, y, w, h, value, style) {
  return `        <mxCell id="${id}" value="${xmlAttr(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/></mxCell>`
}
function edge(id, source, target) {
  return `        <mxCell id="${id}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=#868e96;strokeWidth=2;" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`
}

const boxStyle = (c) =>
  `rounded=1;arcSize=10;whiteSpace=wrap;html=1;fillColor=${c.bg};strokeColor=${c.stroke};fontColor=#1e1e1e;fontSize=13;align=center;verticalAlign=middle;`

export function toDrawioXml(graph) {
  const { placed, goal, edges, canvasW, canvasH } = layout(graph)
  const W = Math.round(canvasW)
  const H = Math.round(canvasH)
  const cells = []

  // title
  cells.push(
    vertex('title', 40, 10, W - 80, 30, `Epic #${graph.epic ?? ''} — ${graph.title || graph.slug || ''}`,
      'text;html=1;fontSize=22;fontStyle=1;align=left;verticalAlign=middle;strokeColor=none;fillColor=none;fontColor=#111827;'),
  )

  // nodes
  for (const [id, box] of placed) {
    const c = STATUS[box.node.status] || STATUS.pending
    const label = `${box.node.ref ?? `#${id}`}\n${box.node.title || ''}`
    cells.push(vertex(`n${id}`, box.x, box.y, box.w, box.h, label, boxStyle(c)))
  }
  if (goal) cells.push(vertex('ngoal', goal.x, goal.y, goal.w, goal.h, `🎯 ${goal.label}`, boxStyle(STATUS.goal)))

  // edges (blocker → dependent), then terminals → goal
  for (const e of edges) cells.push(edge(`e_${e.from}_${e.to}`, `n${e.from}`, `n${e.to}`))
  if (goal) {
    const hasOut = new Set(edges.map((e) => e.from))
    for (const id of placed.keys()) if (!hasOut.has(id)) cells.push(edge(`e_${id}_goal`, `n${id}`, 'ngoal'))
  }

  return `<mxfile host="app.diagrams.net" type="device">
  <diagram id="ticket-diagram" name="Epic ${graph.epic ?? ''}">
    <mxGraphModel dx="${W}" dy="${H}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${W}" pageHeight="${H}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`
}
