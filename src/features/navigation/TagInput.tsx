import { useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { filterTagPaths } from './TagTree';

export type TagInputProps = {
  id: string;
  value: string;
  allTags: readonly string[];
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
};

function currentTag(value: string) {
  return value.match(/\S+$/)?.[0] || '';
}

export function tagSuggestions(allTags: readonly string[], value: string) {
  const query = currentTag(value);
  if (!query) return [];
  const prefix = value.slice(0, -query.length).trim();
  const selected = new Set(prefix ? prefix.split(/\s+/).map(tag => tag.toLowerCase()) : []);
  return filterTagPaths(allTags, query).filter(tag => !selected.has(tag.toLowerCase()));
}

export function completeTagValue(value: string, tag: string) {
  const query = currentTag(value);
  return `${query ? value.slice(0, -query.length) : value}${tag} `;
}

export function TagInput({ id, value, allTags, disabled, placeholder, ariaLabel = '标签', onChange }: TagInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = tagSuggestions(allTags, value);
  const visible = open && suggestions.length > 0;
  const listId = `${id}Suggestions`;

  const selectTag = (tag: string) => {
    onChange(completeTagValue(value, tag));
    setOpen(false);
    setActiveIndex(0);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    onChange(next);
    setOpen(Boolean(currentTag(next)));
    setActiveIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && visible) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => open ? (index + 1) % suggestions.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => open ? (index - 1 + suggestions.length) % suggestions.length : suggestions.length - 1);
    } else if (open && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      selectTag(suggestions[Math.min(activeIndex, suggestions.length - 1)]);
    }
  };

  return (
    <div className="tag-autocomplete">
      <input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={visible}
        aria-activedescendant={visible ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        onChange={handleChange}
        onFocus={() => setOpen(Boolean(currentTag(value)))}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {visible && (
        <div className="tag-suggestions" id={listId} role="listbox" aria-label="标签建议">
          {suggestions.map((tag, index) => (
            <button
              className={`tag-suggestion${index === activeIndex ? ' is-active' : ''}`}
              id={`${listId}-${index}`}
              key={tag}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={event => {
                event.preventDefault();
                selectTag(tag);
              }}
              onClick={() => selectTag(tag)}
            >{tag}</button>
          ))}
        </div>
      )}
    </div>
  );
}
