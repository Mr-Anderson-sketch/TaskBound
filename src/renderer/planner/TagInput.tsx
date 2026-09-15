// renderer/planner/TagInput — the detail pane's tag chip input (Task 4.3 addendum
// ruling 3): type then Enter or comma adds a tag; Backspace on an empty field removes
// the last chip; each chip has its own remove button. Dispatch is the caller's job
// (Detail.tsx) — this component only reports the desired next `tags` array so every
// change goes through the same `task/edit { tags }` the reducer already normalizes
// (lowercase, dedupe, cap 20).
import { useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Task 4.3 addendum ruling 6: clicking a chip's text (not its remove button)
   * navigates to that tag's view. */
  onTagClick?: (tag: string) => void;
}

export function TagInput({ tags, onChange, onTagClick }: TagInputProps) {
  const [value, setValue] = useState('');

  const commit = (): void => {
    const tag = value.trim();
    if (tag !== '') onChange([...tags, tag]);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && value === '' && tags.length > 0) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="tag-input">
      {tags.map((tag) => (
        <span
          className={onTagClick ? 'chip clickable' : 'chip'}
          key={tag}
          onClick={onTagClick ? () => onTagClick(tag) : undefined}
        >
          #{tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(tags.filter((t) => t !== tag));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        aria-label="Add tag"
        placeholder={tags.length === 0 ? 'Add a tag…' : ''}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    </div>
  );
}
