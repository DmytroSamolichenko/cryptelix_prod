import { useEffect, useRef, useState } from 'react';

export interface CanvasTextData {
  text?: string;
  fontSize?: number;
}

interface CanvasTextWidgetProps {
  text: string;
  fontSize: number;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onTextChange: (text: string) => void;
}

export function CanvasTextWidget({
  text,
  fontSize,
  isSelected,
  isEditing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onTextChange,
}: CanvasTextWidgetProps) {
  const editableRef = useRef<HTMLDivElement>(null);
  const [localText, setLocalText] = useState(text);

  useEffect(() => {
    if (!isEditing) setLocalText(text);
  }, [text, isEditing]);

  useEffect(() => {
    if (!isEditing || !editableRef.current) return;
    const el = editableRef.current;
    el.innerText = text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [isEditing]);

  const commitText = () => {
    const next = editableRef.current?.innerText ?? localText;
    const trimmed = next.replace(/\n$/, '');
    onTextChange(trimmed);
    onEndEdit();
  };

  const handleBlur = () => {
    if (!isEditing) return;
    commitText();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (editableRef.current) editableRef.current.innerText = text;
      onEndEdit();
    }
  };

  const displayText = text.trim() || 'Add text';

  return (
    <div
      className="relative h-full w-full select-none"
      onMouseDown={(e) => {
        if (isEditing) {
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onSelect();
        onStartEdit();
      }}
    >
      {isEditing ? (
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          className="h-full w-full overflow-hidden break-words text-white outline-none"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: 1.35,
            fontWeight: 500,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            caretColor: '#facc15',
          }}
        >
          {localText || ''}
        </div>
      ) : (
        <div
          className={`h-full w-full overflow-hidden break-words px-1 py-0.5 ${
            isSelected ? 'cursor-text' : 'cursor-default'
          } ${!text.trim() ? 'text-zinc-500' : 'text-white'}`}
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: 1.35,
            fontWeight: 500,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (isSelected) onStartEdit();
            else onSelect();
          }}
        >
          {displayText}
        </div>
      )}

      {isSelected && !isEditing && (
        <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800/95 px-2 py-0.5 text-[10px] text-zinc-400 border border-zinc-700">
          Double-click to edit
        </div>
      )}
    </div>
  );
}
