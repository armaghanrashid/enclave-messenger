import { useMemo, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { NoteGraph as GraphData } from '../lib/notes'

interface SimNode extends SimulationNodeDatum {
  id: string
  exists: boolean
  degree: number
}

interface Layout {
  nodes: SimNode[]
  links: { source: SimNode; target: SimNode }[]
  box: { x: number; y: number; w: number; h: number }
}

const TICKS = 320
const MIN_VIEW = { w: 1000, h: 640 }

/** Run the force layout to rest up front so the graph renders once, already settled. */
function layout(graph: GraphData): Layout {
  const degree = new Map<string, number>()
  for (const l of graph.links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
  }
  const nodes: SimNode[] = graph.nodes.map((n, i) => ({
    ...n,
    degree: degree.get(n.id) ?? 0,
    // deterministic start positions on a circle so the layout is stable between renders
    x: Math.cos((i / graph.nodes.length) * Math.PI * 2) * 120,
    y: Math.sin((i / graph.nodes.length) * Math.PI * 2) * 120,
  }))
  const links: SimulationLinkDatum<SimNode>[] = graph.links.map((l) => ({ ...l }))
  const sim = forceSimulation(nodes)
    .force('charge', forceManyBody().strength(-700))
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((d) => d.id).distance(150).strength(0.5))
    .force('center', forceCenter(0, 0))
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(0.06))
    .force('collide', forceCollide<SimNode>().radius((d) => 26 + d.degree * 2))
    .stop()
  sim.tick(TICKS)

  const xs = nodes.map((n) => n.x ?? 0)
  const ys = nodes.map((n) => n.y ?? 0)
  const pad = 90
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const maxX = Math.max(...xs) + pad
  const maxY = Math.max(...ys) + pad
  // Never zoom a small graph up to fill the pane: keep a minimum view size,
  // centred on the layout, so labels stay at a readable scale.
  const w = Math.max(maxX - minX, MIN_VIEW.w)
  const h = Math.max(maxY - minY, MIN_VIEW.h)
  return {
    nodes,
    links: links.map((l) => ({ source: l.source as SimNode, target: l.target as SimNode })),
    box: { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h },
  }
}

/** Link graph of the notes: d3-force layout rendered as SVG. */
export default function NoteGraph({
  graph,
  selected,
  onOpen,
}: {
  graph: GraphData
  selected: string | null
  onOpen: (title: string) => void
}) {
  const data = useMemo(() => layout(graph), [graph])
  const [hover, setHover] = useState<string | null>(null)
  const focus = hover ?? selected

  const neighbours = useMemo(() => {
    const set = new Set<string>()
    if (!focus) return set
    set.add(focus)
    for (const l of data.links) {
      if (l.source.id === focus) set.add(l.target.id)
      if (l.target.id === focus) set.add(l.source.id)
    }
    return set
  }, [data, focus])

  if (graph.nodes.length === 0) return <p className="empty-state">Nothing to draw yet. Link notes with [[double brackets]].</p>

  const { x, y, w, h } = data.box
  return (
    <div className="graph-wrap">
      <svg className="note-graph" viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label="Note link graph">
        {data.links.map((l, i) => {
          const active = focus ? l.source.id === focus || l.target.id === focus : false
          return (
            <line
              key={i}
              x1={l.source.x ?? 0}
              y1={l.source.y ?? 0}
              x2={l.target.x ?? 0}
              y2={l.target.y ?? 0}
              className={`graph-edge ${active ? 'active' : ''} ${focus && !active ? 'dim' : ''}`}
            />
          )
        })}
        {data.nodes.map((n) => {
          const r = n.exists ? 7 + Math.min(n.degree, 6) * 1.4 : 5
          const dim = focus && !neighbours.has(n.id)
          return (
            <g
              key={n.id}
              transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
              className={`graph-node ${n.exists ? '' : 'phantom'} ${n.id === selected ? 'selected' : ''} ${dim ? 'dim' : ''}`}
              onClick={() => onOpen(n.id)}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
            >
              <circle r={r} />
              <text dy={r + 15}>{n.id}</text>
            </g>
          )
        })}
      </svg>
      <div className="graph-legend">
        <span>
          <i className="dot solid" /> Note
        </span>
        <span>
          <i className="dot ring" /> Linked, not written yet
        </span>
      </div>
    </div>
  )
}
