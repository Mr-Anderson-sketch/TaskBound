// renderer/planner/Rail — the 200 px view rail (DESIGN.md "Planner"; Task 4.1 addendum
// ruling 2). Today/Upcoming/Inbox with open-task counts, "Lists" (every list but Inbox,
// by order, with counts) — with add/rename/delete (Task 4.3 addendum ruling 5) — "Tags"
// (every tag used by an open task, alphabetical, no counts), and "Logbook" with the done
// count. Plain `nav` + `button`s — arrow-key navigation is Task 4.2.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Data, List } from '../../core/types';
import { INBOX_ID } from '../../core/defaults';
import { tasksInList, upcomingGroups, logbook } from '../../core/select';
import type { ViewId } from './TaskList';
import type { ActionInput } from '../lib/useStore';

export interface RailProps {
  data: Data;
  view: ViewId;
  now: number;
  onSelect: (view: ViewId) => void;
  /** Task 4.3 addendum ruling 5: list add/rename/delete. Optional so existing callers
   * (and any test harness) that don't wire it just don't get list management UI. */
  dispatchOwn?: (action: ActionInput) => void;
}

// Minimal geometric glyph matching the rest of the app's flat, functional icon style
// (see strip/Panel.tsx's PlayIcon/PauseIcon) — DESIGN.md gives no explicit spec for a
// settings icon.
const GearIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4M12.5 12.5l-1.4-1.4M4.9 4.9 3.5 3.5" />
  </svg>
);

function openTagsSorted(data: Data): string[] {
  const set = new Set<string>();
  for (const t of data.tasks) {
    if (t.status !== 'open' || t.parentId !== undefined) continue;
    for (const tag of t.tags) set.add(tag);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

interface ListOptionsProps {
  list: List;
  lists: List[];
  onRename: () => void;
  onDelete: (moveTasksTo: string) => void;
  onClose: () => void;
}

/** The "…" menu's own inline body: Rename (hands off to the rail's inline-rename
 * input) and Delete, which itself expands into "Move N tasks to <select>" + confirm
 * (ruling 5). Kept as its own small component so the "deleting" sub-state resets
 * cleanly whenever a different list's menu opens (remounted via `key` at the call
 * site, same convention as PlannerApp's `TaskActionMenu`). */
function ListOptions({ list, lists, onRename, onDelete, onClose }: ListOptionsProps) {
  const [deleting, setDeleting] = useState(false);
  const others = lists.filter((l) => l.id !== list.id);
  const [moveTo, setMoveTo] = useState<string>(others.find((l) => l.id === INBOX_ID)?.id ?? INBOX_ID);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div ref={rootRef} className="menu list-options" role="menu" aria-label={`List options for ${list.name}`} onKeyDown={onKeyDown}>
      {!deleting ? (
        <>
          <button type="button" role="menuitem" className="mi" onClick={onRename}>
            Rename
          </button>
          <button type="button" role="menuitem" className="mi" onClick={() => setDeleting(true)}>
            Delete
          </button>
        </>
      ) : (
        <div className="list-delete-confirm">
          <label>
            Move tasks to
            <select aria-label={`Move tasks from ${list.name} to`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {(others.length > 0 ? others : lists.filter((l) => l.id === INBOX_ID)).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => onDelete(moveTo)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function Rail({ data, view, now, onSelect, dispatchOwn }: RailProps) {
  const todayOpenCount = data.tasks.filter((t) => t.today && t.status === 'open' && t.parentId === undefined).length;
  const upcomingCount = upcomingGroups(data, now, 14).reduce((n, g) => n + g.tasks.length, 0);
  const inboxCount = tasksInList(data, INBOX_ID).length;
  const lists = [...data.lists].filter((l) => l.id !== INBOX_ID).sort((a, b) => a.order - b.order);
  const tags = openTagsSorted(data);
  const logbookCount = logbook(data).length;

  // --- add list (ruling 5) ------------------------------------------------------
  const [adding, setAdding] = useState(false);
  const [addValue, setAddValue] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);
  const commitAdd = (): void => {
    const name = addValue.trim();
    if (name !== '') dispatchOwn?.({ type: 'list/add', id: crypto.randomUUID(), name });
    setAdding(false);
    setAddValue('');
  };

  // --- rename (double-click / F2) and "…" options -------------------------------
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renamingId !== undefined) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);
  const startRename = (list: List): void => {
    setRenamingId(list.id);
    setRenameValue(list.name);
    setOptionsForId(undefined);
  };
  const commitRename = (): void => {
    const id = renamingId;
    if (id === undefined) return;
    const name = renameValue.trim();
    setRenamingId(undefined);
    if (name !== '') dispatchOwn?.({ type: 'list/rename', id, name });
  };

  const [optionsForId, setOptionsForId] = useState<string | undefined>(undefined);

  const item = (id: ViewId, label: string, count?: number) => (
    <button key={id} type="button" className={view === id ? 'i sel' : 'i'} onClick={() => onSelect(id)}>
      <span>{label}</span>
      {count !== undefined && <span className="n">{count}</span>}
    </button>
  );

  const listItem = (l: List) => {
    if (renamingId === l.id) {
      return (
        <input
          key={l.id}
          ref={renameInputRef}
          type="text"
          className="rail-rename"
          aria-label={`Rename list ${l.name}`}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setRenamingId(undefined);
            }
          }}
        />
      );
    }
    const viewId: ViewId = `list:${l.id}`;
    return (
      <div key={l.id} className="rail-list-row">
        <button
          type="button"
          className={view === viewId ? 'i sel' : 'i'}
          onClick={() => onSelect(viewId)}
          onDoubleClick={() => startRename(l)}
          onKeyDown={(e) => {
            if (e.key === 'F2') {
              e.preventDefault();
              startRename(l);
            }
          }}
        >
          <span>{l.name}</span>
          <span className="n">{tasksInList(data, l.id).length}</span>
        </button>
        <button
          type="button"
          className="rail-list-opts"
          aria-label={`List options for ${l.name}`}
          onClick={(e) => {
            e.stopPropagation();
            setOptionsForId(l.id);
          }}
        >
          &hellip;
        </button>
        {optionsForId === l.id && (
          <ListOptions
            key={l.id}
            list={l}
            lists={data.lists}
            onRename={() => startRename(l)}
            onDelete={(moveTasksTo) => {
              dispatchOwn?.({ type: 'list/delete', id: l.id, moveTasksTo });
              setOptionsForId(undefined);
              if (view === viewId) onSelect('inbox');
            }}
            onClose={() => setOptionsForId(undefined)}
          />
        )}
      </div>
    );
  };

  return (
    <nav className="rail" aria-label="Views">
      {item('today', 'Today', todayOpenCount)}
      {item('upcoming', 'Upcoming', upcomingCount)}
      {item('inbox', 'Inbox', inboxCount)}
      <div className="g rail-g-lists">
        <span>Lists</span>
        <button type="button" className="rail-add" aria-label="Add list" onClick={() => setAdding(true)}>
          +
        </button>
      </div>
      {adding && (
        <input
          ref={addInputRef}
          type="text"
          className="rail-rename"
          aria-label="New list name"
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          onBlur={commitAdd}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitAdd();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setAdding(false);
              setAddValue('');
            }
          }}
        />
      )}
      {lists.map((l) => listItem(l))}
      {tags.length > 0 && (
        <>
          <div className="g">Tags</div>
          {tags.map((tag) => item(`tag:${tag}`, `#${tag}`))}
        </>
      )}
      <div className="g">Done</div>
      {item('logbook', 'Logbook', logbookCount)}
      <div className="foot">
        <button
          type="button"
          aria-label="Settings"
          className={view.startsWith('settings:') ? 'i sel' : 'i'}
          onClick={() => onSelect('settings:strip')}
        >
          {GearIcon}
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}
