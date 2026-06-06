import { Eraser, Paintbrush } from 'lucide-react';
import { BRUSH_COLORS } from './DrawingCanvas';
import type { DrawToolMode } from '../lib/drawingStorage';

interface BrushToolbarProps {
  toolMode: DrawToolMode;
  brushColor: string;
  onToolModeChange: (mode: DrawToolMode) => void;
  onBrushColorChange: (color: string) => void;
}

export function BrushToolbar({
  toolMode,
  brushColor,
  onToolModeChange,
  onBrushColorChange,
}: BrushToolbarProps) {
  return (
    <div className="animate-in slide-in-from-bottom-2 rounded-xl border border-zinc-700 bg-zinc-900 p-2.5 shadow-xl duration-200">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5">
          <button
            type="button"
            title="Brush"
            aria-label="Brush"
            onClick={() => onToolModeChange('brush')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              toolMode === 'brush'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <Paintbrush className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Eraser"
            aria-label="Eraser"
            onClick={() => onToolModeChange('eraser')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              toolMode === 'eraser'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <Eraser className="h-4 w-4" />
          </button>
        </div>

        <div className="mx-0.5 h-7 w-px bg-zinc-700" />

        <div className="flex items-center gap-1.5">
          {BRUSH_COLORS.map(({ value, label }) => {
            const isSelected = brushColor === value;
            const isEraser = toolMode === 'eraser';
            return (
              <button
                key={value}
                type="button"
                title={label}
                disabled={isEraser}
                onClick={() => onBrushColorChange(value)}
                className={`h-7 w-7 rounded-full border-2 transition-transform ${
                  isEraser
                    ? 'cursor-not-allowed opacity-35'
                    : 'hover:scale-110'
                } ${
                  isSelected && !isEraser
                    ? 'border-yellow-400 ring-2 ring-yellow-400/40'
                    : value === '#18181b'
                      ? 'border-zinc-600'
                      : 'border-transparent'
                }`}
                style={{ backgroundColor: value }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
