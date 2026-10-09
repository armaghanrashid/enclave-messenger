import { Fragment, useState, type ReactNode } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import NoteGraph from '../components/NoteGraph'
import { IconGraph, IconList, IconNotes, IconPlus, IconSearch } from '../components/icons'
import { backlinksTo, buildGraph, collectNotes, createNotesRoom, findNotesRoom, saveNote } from '../lib/notes'
import { useMatrixTick } from '../lib/useMatrixTick'

/** Inline text with [[wikilinks]] rendered as clickable chips. */
function renderInline(text: string, open: (title: string) => void): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(/\[\[([^\][]+)\]\]/g)) {
    out.push(text.slice(last, m.index))
    const title = m[1].trim()
    out.push(
      <button key={`${m.index}`} className="wikilink" onClick={() => open(title)}>
        {title}
      </button>,
    )
    last = m.index! + m[0].length
  }
  out.push(text.slice(last))
  return out
}

/** Paragraphs and "- " bullet lists; everything else is plain text. */
function NoteBody({ body, open }: { body: string; open: (title: string) => void }) {
  const blocks = body.split(/\n{2,}/).filter((b) => b.trim())
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        if (lines.every((l) => l.trimStart().startsWith('- '))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.trimStart().slice(2), open)}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(l, open)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}

/** Linked notes: list, editor, backlinks and a graph view. */
export default function Notes({ client }: { client: MatrixClient }) {
  useMatrixTick(client)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<'note' | 'graph'>('note')
  const [busy, setBusy] = useState(false)

  const room = findNotesRoom(client)
  const notes = room ? collectNotes(room) : new Map()
  const note = selected ? notes.get(selected) : undefined

  function open(title: string) {
    setSelected(title)
    setView('note')
    if (!notes.has(title)) {
      setDraftTitle(title)
      setDraftBody('')
      setEditing(true)
    } else {
      setEditing(false)
    }
  }

  function startNew() {
    setSelected(null)
    setView('note')
    setDraftTitle('')
    setDraftBody('')
    setEditing(true)
  }

  async function save() {
    if (!room || !draftTitle.trim()) return
    setBusy(true)
    try {
      const title = draftTitle.trim()
      await saveNote(client, room.roomId, title, draftBody)
      setSelected(title)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  if (!room) {
    return (
      <main className="empty-pane full">
        <IconNotes width={30} height={30} />
        <h2>Notes</h2>
        <p>There is no shared notes space yet. Notes link to each other with [[double brackets]].</p>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await createNotesRoom(client)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Creating...' : 'Create the notes space'}
        </button>
      </main>
    )
  }

  const q = filter.trim().toLowerCase()
  const list = [...notes.values()]
    .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title))
  const backlinks = note ? backlinksTo(notes, note.title) : []

  return (
    <div className="split">
      <aside className="list-pane notes-list">
        <header className="pane-head">
          <h2>Notes</h2>
          <button className="iconbtn" onClick={startNew} title="New note" aria-label="New note">
            <IconPlus />
          </button>
        </header>
        <div className="searchbox">
          <IconSearch width={15} height={15} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
        </div>
        <div className="list-scroll">
          {list.length === 0 && <p className="empty">No notes yet.</p>}
          {list.map((n) => (
            <button key={n.title} className={`row ${n.title === selected && view === 'note' ? 'active' : ''}`} onClick={() => open(n.title)}>
              <span className="row-main">
                <span className="row-title">{n.title}</span>
                <span className="row-sub">
                  {n.sender} · {new Date(n.ts).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="main-pane">
        <header className="pane-head">
          <h2>{view === 'graph' ? 'Graph' : (note?.title ?? (editing ? 'New note' : 'Notes'))}</h2>
          <div className="segmented small" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'note'} onClick={() => setView('note')}>
              <IconList width={14} height={14} /> Note
            </button>
            <button role="tab" aria-selected={view === 'graph'} onClick={() => setView('graph')}>
              <IconGraph width={14} height={14} /> Graph
            </button>
          </div>
        </header>

        {view === 'graph' ? (
          <NoteGraph graph={buildGraph(notes)} selected={selected} onOpen={open} />
        ) : editing ? (
          <div className="note-editor">
            <input
              className="note-title-input"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Note title"
              aria-label="Note title"
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Write something. Link other notes with [[double brackets]]."
              aria-label="Note body"
            />
            <div className="edit-actions">
              <button className="primary" onClick={save} disabled={busy || !draftTitle.trim()}>
                {busy ? 'Saving...' : 'Save note'}
              </button>
              <button className="ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : note ? (
          <article className="note-view">
            <div className="note-meta">
              <span className="dim">
                {note.sender} · {new Date(note.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                className="ghost small"
                onClick={() => {
                  setDraftTitle(note.title)
                  setDraftBody(note.body)
                  setEditing(true)
                }}
              >
                Edit
              </button>
            </div>
            <div className="note-body">
              <NoteBody body={note.body} open={open} />
            </div>
            {backlinks.length > 0 && (
              <footer className="backlinks">
                <h3>Linked from</h3>
                <div>
                  {backlinks.map((b) => (
                    <button key={b.title} className="wikilink" onClick={() => open(b.title)}>
                      {b.title}
                    </button>
                  ))}
                </div>
              </footer>
            )}
          </article>
        ) : (
          <div className="empty-pane">
            <IconNotes width={30} height={30} />
            <p>Select a note, write a new one, or open the graph.</p>
          </div>
        )}
      </section>
    </div>
  )
}
