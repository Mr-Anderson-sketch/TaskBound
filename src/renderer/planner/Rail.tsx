// renderer/planner/Rail — the 200 px view rail (DESIGN.md "Planner"; Task 4.1 addendum
// ruling 2). Today/Upcoming/Inbox with open-task counts, "Lists" (every list but Inbox,
// by order, with counts), "Tags" (every tag used by an open task, alphabetical, no
// counts), and "Logbook" with the done count. Plain `nav` + `button`s — arrow-key
// navigation is Task 4.2.
import type { Data } from '../../core/types';
import { INBOX_ID } from '../../core/defaults';
import { tasksInList, upcomingGroups, logbook } from '../../core/select';
import type { ViewId } from './TaskList';

export interface RailProps {
  data: Data;
  view: ViewId;
  now: number;
  onSelect: (view: ViewId) => void;
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

export function Rail({ data, view, now, onSelect }: RailProps) {
  const todayOpenCount = data.tasks.filter((t) => t.today && t.status === 'open' && t.parentId === undefined).length;
  const upcomingCount = upcomingGroups(data, now, 14).reduce((n, g) => n + g.tasks.length, 0);
  const inboxCount = tasksInList(data, INBOX_ID).length;
  const lists = [...data.lists].filter((l) => l.id !== INBOX_ID).sort((a, b) => a.order - b.order);
  const tags = openTagsSorted(data);
  const logbookCount = logbook(data).length;

  const item = (id: ViewId, label: string, count?: number) => (
    <button key={id} type="button" className={view === id ? 'i sel' : 'i'} onClick={() => onSelect(id)}>
      <span>{label}</span>
      {count !== undefined && <span className="n">{count}</span>}
    </button>
  );

  return (
    <nav className="rail" aria-label="Views">
      {item('today', 'Today', todayOpenCount)}
      {item('upcoming', 'Upcoming', upcomingCount)}
      {item('inbox', 'Inbox', inboxCount)}
      {lists.length > 0 && (
        <>
          <div className="g">Lists</div>
          {lists.map((l) => item(`list:${l.id}`, l.name, tasksInList(data, l.id).length))}
        </>
      )}
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
