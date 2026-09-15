// renderer/planner/SubTasks — the detail pane's sub-task list (Task 4.3 addendum ruling
// 3): each child gets a radio (complete/uncomplete), an inline-renameable title, and a
// delete button; an "Add sub-task" input appends a new child via `task/add`. Only one
// level — `parent.parentId !== undefined` means the caller (Detail.tsx) doesn't even
// mount this for a sub-task, but this component also refuses to render its own "Add
// sub-task" input in that case as a second line of defence.
import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Task } from '../../core/types';
import type { ActionInput } from '../lib/useStore';

export interface SubTasksProps {
  parent: Task;
  childTasks: Task[]; // childrenOf(data, parent.id) — open and done, already ordered
  dispatchOwn: (action: ActionInput) => void;
}

function SubTaskRow({ task, dispatchOwn }: { task: Task; dispatchOwn: (action: ActionInput) => void }) {
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);

  const commit = (): void => {
    const trimmed = title.trim();
    if (trimmed !== '' && trimmed !== task.title) dispatchOwn({ type: 'task/edit', id: task.id, patch: { title: trimmed } });
    else setTitle(task.title);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setTitle(task.title);
      (e.target as HTMLInputElement).blur();
    }
  };

  const done = task.status === 'done';

  return (
    <div className="subtask">
      <button
        type="button"
        className="cb"
        aria-label={done ? `Mark "${task.title}" not done` : `Complete "${task.title}"`}
        onClick={() =>
          dispatchOwn(
            done ? { type: 'task/uncomplete', id: task.id } : { type: 'task/complete', id: task.id, by: 'user', spawnId: crypto.randomUUID() }
          )
        }
      />
      <input
        type="text"
        className={done ? 'subtask-title done' : 'subtask-title'}
        aria-label="Sub-task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
      <button type="button" className="subtask-del" aria-label={`Delete "${task.title}"`} onClick={() => dispatchOwn({ type: 'task/delete', id: task.id })}>
        ×
      </button>
    </div>
  );
}

export function SubTasks({ parent, childTasks, dispatchOwn }: SubTasksProps) {
  const [newTitle, setNewTitle] = useState('');
  const canAdd = parent.parentId === undefined;

  const addSubTask = (): void => {
    const title = newTitle.trim();
    if (title === '') return;
    dispatchOwn({ type: 'task/add', id: crypto.randomUUID(), title, parentId: parent.id, listId: parent.listId, today: false });
    setNewTitle('');
  };

  return (
    <div className="subtasks">
      <div className="sec">Sub-tasks</div>
      {childTasks.map((child) => (
        <SubTaskRow key={child.id} task={child} dispatchOwn={dispatchOwn} />
      ))}
      {canAdd && (
        <input
          type="text"
          className="subtask-add"
          aria-label="Add sub-task"
          placeholder="Add sub-task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addSubTask();
            }
          }}
        />
      )}
    </div>
  );
}
