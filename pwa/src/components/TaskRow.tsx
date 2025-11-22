import type { Task } from '../../shared/types';
import { formatSeconds } from '../utils/time';

interface TaskRowProps {
  task: Task;
  index: number;
  isActive: boolean;
  isSelected?: boolean;
  onEdit: (task: Task) => void;
  onSelect?: (task: Task) => void;
}

const statusTone: Record<Task['status'], string> = {
  pending: 'text-brand-ice',
  in_progress: 'text-brand-aqua',
  completed: 'text-brand-teal/70',
  struck: 'text-brand-ice/50'
};

const statusDecoration: Record<Task['status'], string> = {
  pending: '',
  in_progress: '',
  completed: 'line-through',
  struck: 'line-through'
};

export function TaskRow(props: TaskRowProps) {
  const { task, index, isActive, isSelected = false, onEdit, onSelect } = props;
  const time = formatSeconds(task.remainingSeconds ?? task.timeAssignedSeconds);
  const displayIndex = index + 1;
    const containerClasses = [
      'flex items-center justify-between rounded-lg border border-brand-ice/10 bg-brand-dusk/70 px-3 py-2 transition-colors shadow-sm cursor-grab select-none focus:outline-none focus:ring-2 focus:ring-brand-coral/60 focus:ring-offset-2 focus:ring-offset-brand-navy active:cursor-grabbing',
    isActive ? 'border-brand-teal/60 bg-brand-teal/20 shadow-md' : '',
    isSelected && !isActive ? 'border-brand-coral/60 bg-brand-coral/10 shadow-md' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const titleClasses = [
    'flex-1 truncate pl-3 text-sm font-medium',
    statusTone[task.status],
    statusDecoration[task.status]
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={containerClasses}
      onClick={() => onSelect?.(task)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit(task);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit(task);
        }
      }}
      role="button"
      tabIndex={0}
      title="Click to select, double-click to edit"
    >
  <span className="text-xs font-semibold tracking-wide text-brand-aqua/80">{displayIndex.toString().padStart(2, '0')}</span>
  <span className="w-20 text-xs font-mono text-brand-aqua/70">[{time}]</span>
      <span className={titleClasses}>{task.title}</span>
    </div>
  );
}
