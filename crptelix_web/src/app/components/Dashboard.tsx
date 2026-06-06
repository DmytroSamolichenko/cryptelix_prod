import { useCallback, useRef, useState } from 'react';
import { CanvasTextElement, type TextElementState, DEFAULT_FONT_SIZE } from './CanvasTextElement';

const CANVAS_SIZE = 10000;
const CANVAS_ORIGIN = CANVAS_SIZE / 2;

const INITIAL_TEXT_ELEMENTS: TextElementState[] = [
  {
    id: 'text-1',
    text: 'Hello, Canva!',
    html: 'Hello, Canva!',
    fontSize: DEFAULT_FONT_SIZE,
    x: 120,
    y: 80,
    width: 280,
    height: 120,
  },
];

export function Dashboard() {
  const [textElements, setTextElements] = useState<TextElementState[]>(INITIAL_TEXT_ELEMENTS);
  const [selectedId, setSelectedId] = useState<string | null>('text-1');
  const [editingId, setEditingId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleUpdate = useCallback((updated: TextElementState) => {
    setTextElements((prev) => prev.map((el) => (el.id === updated.id ? updated : el)));
  }, []);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    setSelectedId(null);
    setEditingId(null);
  };

  const addTextElement = () => {
    const id = `text-${Date.now()}`;
    const newElement: TextElementState = {
      id,
      text: '',
      html: '',
      fontSize: DEFAULT_FONT_SIZE,
      x: 100 + Math.floor(Math.random() * 200),
      y: 100 + Math.floor(Math.random() * 200),
      width: 280,
      height: 120,
    };
    setTextElements((prev) => [...prev, newElement]);
    setSelectedId(id);
    setEditingId(id);
  };

  const removeTextElement = (id: string) => {
    setTextElements((prev) => prev.filter((el) => el.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
        <button
          type="button"
          onClick={addTextElement}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:border-yellow-500/50"
        >
          Add text
        </button>
        <span className="text-xs text-zinc-500">
          {textElements.length} element{textElements.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="relative flex-1 overflow-auto">
        <div
          ref={canvasRef}
          className="relative origin-top-left"
          onMouseDown={handleCanvasMouseDown}
          style={{
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            backgroundColor: '#09090b',
            backgroundImage: `
              radial-gradient(circle, rgba(250, 204, 21, 0.08) 1px, transparent 1px),
              linear-gradient(rgba(250, 204, 21, 0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(250, 204, 21, 0.02) 1px, transparent 1px)
            `,
            backgroundSize: '24px 24px, 48px 48px, 48px 48px',
          }}
        >
          {textElements.map((element) => (
            <CanvasTextElement
              key={element.id}
              element={element}
              isSelected={selectedId === element.id}
              isEditing={editingId === element.id}
              canvasOrigin={{ x: CANVAS_ORIGIN, y: CANVAS_ORIGIN }}
              onSelect={() => {
                setSelectedId(element.id);
                setEditingId(null);
              }}
              onStartEdit={() => {
                setSelectedId(element.id);
                setEditingId(element.id);
              }}
              onEndEdit={() => setEditingId(null)}
              onUpdate={handleUpdate}
              onRemove={removeTextElement}
            />
          ))}
        </div>
      </div>

      {/* Debug panel — shows parent always owns full state */}
      <pre className="max-h-32 overflow-auto border-t border-zinc-800 bg-zinc-900/80 p-3 text-[10px] text-zinc-400">
        {JSON.stringify(textElements, null, 2)}
      </pre>
    </div>
  );
}
