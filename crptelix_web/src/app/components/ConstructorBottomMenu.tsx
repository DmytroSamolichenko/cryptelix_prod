import { LayoutGrid, Paintbrush, Type, Plus, LineChart, BarChart3, AreaChart, PieChart, Zap, Table, Wallet, X } from 'lucide-react';
import { WidgetType } from './DashboardWidget';
import { motion } from 'motion/react';
import { useState } from 'react';
import { BrushToolbar } from './BrushToolbar';
import type { DrawToolMode } from '../lib/drawingStorage';

interface ConstructorBottomMenuProps {
  onWidgetsToggle: () => void;
  onBrushToggle: () => void;
  onTextFieldAdd: () => void;
  onAddWidget: (type: WidgetType) => void;
  canvases: Array<{ id: string; name: string }>;
  activeCanvasId: string;
  onCanvasChange: (id: string) => void;
  onCanvasAdd: () => void;
  onCanvasRename: (id: string, newName: string) => void;
  onCanvasDelete: (id: string) => void;
  isWidgetsOpen: boolean;
  isBrushActive: boolean;
  drawToolMode: DrawToolMode;
  onDrawToolModeChange: (mode: DrawToolMode) => void;
  brushColor: string;
  onBrushColorChange: (color: string) => void;
}

export function ConstructorBottomMenu({
  onWidgetsToggle,
  onBrushToggle,
  onTextFieldAdd,
  onAddWidget,
  canvases,
  activeCanvasId,
  onCanvasChange,
  onCanvasAdd,
  onCanvasRename,
  onCanvasDelete,
  isWidgetsOpen,
  isBrushActive,
  drawToolMode,
  onDrawToolModeChange,
  brushColor,
  onBrushColorChange,
}: ConstructorBottomMenuProps) {
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const widgets = [
    { type: 'line-chart' as WidgetType, icon: LineChart, label: 'Price Chart' },
    { type: 'bar-chart' as WidgetType, icon: BarChart3, label: 'WvL' },
    { type: 'area-chart' as WidgetType, icon: AreaChart, label: 'TVL' },
    { type: 'pie-chart' as WidgetType, icon: PieChart, label: 'Portfolio' },
    { type: 'stats-card' as WidgetType, icon: Zap, label: 'Stats' },
    { type: 'table' as WidgetType, icon: Table, label: 'FTR' },
    { type: 'portfolio-widget' as WidgetType, icon: Wallet, label: 'Portfolio' },
  ];

  const handleStartEditing = (canvasId: string, currentName: string) => {
    setEditingCanvasId(canvasId);
    setEditingName(currentName);
  };

  const handleSaveEdit = () => {
    if (editingCanvasId && editingName.trim()) {
      onCanvasRename(editingCanvasId, editingName.trim());
    }
    setEditingCanvasId(null);
    setEditingName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      setEditingCanvasId(null);
      setEditingName('');
    }
  };

  return (
    <div className="relative z-30 overflow-visible border-t border-zinc-800/50 bg-zinc-950/80 backdrop-blur-md">
      <div className="flex flex-col gap-2 overflow-visible px-2 py-2 sm:min-h-[54px] sm:flex-row sm:items-center sm:justify-between sm:gap-0 sm:overflow-visible sm:px-3 sm:py-0">
        {/* Tools — top row on mobile, centered on desktop */}
        <div className="order-1 flex shrink-0 items-center justify-center gap-2 sm:absolute sm:left-1/2 sm:top-1/2 sm:z-10 sm:-translate-x-1/2 sm:-translate-y-1/2">
          <div className="relative">
            <motion.button
              onClick={onWidgetsToggle}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all sm:gap-2 sm:px-4 sm:text-sm ${
                isWidgetsOpen
                  ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                  : 'border-zinc-700/50 bg-zinc-900/40 text-gray-400 hover:border-yellow-500/40 hover:bg-zinc-800/40 hover:text-white'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Widgets"
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              <span className="hidden min-[380px]:inline">Widgets</span>
            </motion.button>

            {isWidgetsOpen && (
              <div className="absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 overflow-visible pt-6">
                <div className="flex items-center gap-2 overflow-visible">
                  {widgets.map((widget, index) => (
                    <motion.button
                      key={widget.type}
                      onClick={() => {
                        if (widget.label === 'Price Chart') {
                          console.log('Button Clicked: Price Chart');
                        }
                        onAddWidget(widget.type);
                      }}
                      className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-900 transition-all hover:border-zinc-500 hover:bg-zinc-800"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: index * 0.05,
                        type: 'spring',
                        stiffness: 400,
                        damping: 17,
                      }}
                      whileHover={{ scale: 1.1, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <widget.icon className="h-5 w-5 text-gray-400 transition-colors group-hover:text-white" />
                      <div className="pointer-events-none absolute bottom-full mb-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <div className="whitespace-nowrap rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
                          <span className="text-xs text-gray-300">{widget.label}</span>
                        </div>
                        <div className="absolute left-1/2 top-full -mt-px -translate-x-1/2">
                          <div className="border-4 border-transparent border-t-zinc-900" />
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <motion.button
              onClick={() => onBrushToggle()}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all sm:gap-2 sm:px-4 sm:text-sm ${
                isBrushActive
                  ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                  : 'border-zinc-700/50 bg-zinc-900/40 text-gray-400 hover:border-yellow-500/40 hover:bg-zinc-800/40 hover:text-white'
              }`}
              title={isBrushActive ? 'Disable draw tools' : 'Enable draw tools'}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Paintbrush className="h-4 w-4 shrink-0" />
              <span className="hidden min-[380px]:inline">Draw</span>
            </motion.button>

            {isBrushActive && (
              <div className="absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 overflow-visible">
                <BrushToolbar
                  toolMode={drawToolMode}
                  brushColor={brushColor}
                  onToolModeChange={onDrawToolModeChange}
                  onBrushColorChange={onBrushColorChange}
                />
              </div>
            )}
          </div>

          <motion.button
            type="button"
            onClick={onTextFieldAdd}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-all hover:border-yellow-500/40 hover:bg-zinc-800/40 hover:text-white sm:gap-2 sm:px-4 sm:text-sm"
            title="Add text field"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Type className="h-4 w-4 shrink-0" />
            <span className="hidden min-[380px]:inline">Text</span>
          </motion.button>
        </div>

        {/* Canvas tabs — scrollable row */}
        <div className="scrollbar-hidden order-2 flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5 sm:ml-1 sm:max-w-[38%] sm:py-1 lg:max-w-[42%]">
          {canvases.map((canvas) => {
            if (editingCanvasId === canvas.id) {
              return (
                <input
                  key={canvas.id}
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={handleSaveEdit}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="shrink-0 rounded-lg border-2 border-yellow-600 bg-yellow-500 px-3 py-1.5 text-xs font-medium text-black shadow-lg shadow-yellow-500/30 outline-none sm:px-4 sm:text-sm"
                />
              );
            }
            return (
              <div key={canvas.id} className="relative shrink-0">
                <button
                  onClick={() => onCanvasChange(canvas.id)}
                  onDoubleClick={() => handleStartEditing(canvas.id, canvas.name)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-transform duration-150 ease-out hover:scale-105 sm:gap-2 sm:px-4 sm:text-sm ${
                    activeCanvasId === canvas.id
                      ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/30'
                      : 'border border-zinc-700/50 bg-zinc-900/40 text-gray-400 hover:bg-zinc-800/40 hover:text-white'
                  }`}
                >
                  {canvas.name}
                  {canvases.length > 1 && activeCanvasId === canvas.id && (
                    <span
                      className="-mr-1 -mt-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-zinc-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCanvasDelete(canvas.id);
                      }}
                      title="Delete canvas"
                    >
                      <X className="h-2.5 w-2.5" />
                    </span>
                  )}
                </button>
              </div>
            );
          })}
          <motion.button
            onClick={onCanvasAdd}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-zinc-800/40 hover:text-yellow-400"
            title="Add new canvas"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
          >
            <Plus className="h-4 w-4" />
          </motion.button>
        </div>

        {/* Spacer balances centered tools on wide screens */}
        <div className="order-3 hidden shrink-0 sm:block sm:w-24 lg:w-32" aria-hidden />
      </div>
    </div>
  );
}