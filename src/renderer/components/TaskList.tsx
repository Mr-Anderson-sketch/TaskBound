import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../../shared/types';
import { formatSeconds } from '../utils/time';
import { IconCheck, IconPencil } from './Icons';

export interface RowHandlers {
  onSelect: (task: Task, event: ReactMouseEvent) => void;
  onEdit: (task: Task) => void;
  onContextMenu: (task: Task, x: number, y: number) => void;
}

interface RowProps extends RowHandlers {
  task: Task;
  label: string;
  selected: boolean;
  sortable: boolean;
}

function RowBody({ task, label, selected, onSelect, onEdit, onContextMenu, dragging }: Omit<RowProps, 'sortable'> & { dragging?: boolean }) {
  const done = task.status === 'completed' || task.status === 'struck';
  const seconds = task.remainingSeconds ?? task.timeAssignedSeconds;
  return (
    <div
      className={`row${done ? ' done' : ''}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
      onClick={(event) => onSelect(task, event)}
      onDoubleClick={() => onEdit(task)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(task, event.clientX, event.clientY);
      }}
    >
      <span className="idx mono">{label}</span>
      <span className="name" title={task.title}>
        {task.title}
      </span>
      {done ? (
        task.status === 'completed' ? (
          <span className="check" aria-label="Completed">
            <IconCheck size={14} />
          </span>
        ) : (
          <span className="expired">time’s up</span>
        )
      ) : (
        <>
          <button
            type="button"
            className="icon-btn edit"
            aria-label={`Edit ${task.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onEdit(task);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <IconPencil size={13} />
          </button>
          <span className={`dur mono${seconds === undefined ? ' none' : ''}`}>{seconds === undefined ? 'no time' : formatSeconds(seconds)}</span>
        </>
      )}
    </div>
  );
}

function SortableRow(props: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 2 : undefined };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} aria-roledescription="Draggable task">
      <RowBody {...props} dragging={isDragging} />
    </div>
  );
}

interface TaskListProps extends RowHandlers {
  upNext: Task[];
  doneToday: Task[];
  selectedIds: Set<string>;
  onReorder: (orderedIds: string[]) => void;
}

const PREVIEW_COUNT = 6;

export function TaskList({ upNext, doneToday, selectedIds, onReorder, ...handlers }: TaskListProps) {
  const [showAll, setShowAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const visible = showAll ? upNext : upNext.slice(0, PREVIEW_COUNT);
  const hidden = upNext.length - visible.length;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return;
    }
    const ids = upNext.map((task) => task.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from !== -1 && to !== -1) {
      onReorder(arrayMove(ids, from, to));
    }
  };

  return (
    <>
      {upNext.length > 0 ? (
        <section aria-label="Up next">
          <div className="section-head">
            <span>Up next</span>
            {upNext.length > PREVIEW_COUNT ? (
              <button type="button" className="link-btn" onClick={() => setShowAll((value) => !value)}>
                {showAll ? 'Show less' : `${hidden} more`}
              </button>
            ) : null}
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={handleDragEnd}>
            <SortableContext items={visible.map((task) => task.id)} strategy={verticalListSortingStrategy}>
              <div className="rows cards">
                {visible.map((task, index) => (
                  <SortableRow
                    key={task.id}
                    task={task}
                    label={String(index + 2).padStart(2, '0')}
                    selected={selectedIds.has(task.id)}
                    sortable
                    {...handlers}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>
      ) : null}

      {doneToday.length > 0 ? (
        <section aria-label="Done today">
          <div className="section-head">
            <span>Done today · {doneToday.length}</span>
            <button type="button" className="link-btn" onClick={() => setShowDone((value) => !value)} aria-expanded={showDone}>
              {showDone ? 'Hide' : 'Show'}
            </button>
          </div>
          {showDone ? (
            <div className="rows">
              {doneToday.map((task) => (
                <RowBody key={task.id} task={task} label="" selected={selectedIds.has(task.id)} {...handlers} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function PopupMenu({ x, y, items, onClose }: { x: number; y: number; items: Array<MenuItem | 'sep'>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({
        left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
      });
      el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [x, y, onClose]);

  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.left, top: pos.top }}>
      {items.map((item, index) =>
        item === 'sep' ? (
          <div key={`sep-${index}`} className="sep" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.danger ? 'danger' : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            <span>{item.label}</span>
            {item.checked !== undefined ? <span className="tick">{item.checked ? '✓' : ''}</span> : item.hint ? <span className="kbd">{item.hint}</span> : null}
          </button>
        )
      )}
    </div>
  );
}
