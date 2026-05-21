import { LayoutGrid, Paintbrush, Type, Plus, LineChart, BarChart3, AreaChart, PieChart, Zap, Table, Wallet, X } from 'lucide-react';
import { WidgetType } from './DashboardWidget';
import { motion, AnimatePresence } from 'motion/react';
import { useState, Fragment } from 'react';

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
    <div className="relative h-[62px] bg-zinc-950/80 backdrop-blur-md border-t border-zinc-800/50">
      <div className="h-full flex items-center justify-between px-4">
        {/* Left - Canvas Switcher */}
        <div className="ml-1 flex items-center gap-2 overflow-visible py-1">
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
                  className="px-4 py-1.5 rounded-lg text-sm font-medium bg-yellow-500 text-black shadow-lg shadow-yellow-500/30 outline-none border-2 border-yellow-600"
                />
              );
            }
            return (
              <div
                key={canvas.id}
                className="relative"
              >
                <button
                  onClick={() => onCanvasChange(canvas.id)}
                  onDoubleClick={() => handleStartEditing(canvas.id, canvas.name)}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-transform duration-150 ease-out hover:scale-105 ${
                    activeCanvasId === canvas.id
                      ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/30'
                      : 'bg-zinc-900/40 text-gray-400 hover:text-white hover:bg-zinc-800/40 border border-zinc-700/50'
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
            className="p-1.5 rounded-lg text-gray-400 hover:text-yellow-400 hover:bg-zinc-800/40 transition-colors"
            title="Add new canvas"
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
          >
            <Plus className="w-4 h-4" />
          </motion.button>
        </div>

        {/* Center - Tools (absolutely centered) */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
          {/* Widgets */}
          <div className="relative">
            <motion.button
              onClick={onWidgetsToggle}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-all flex items-center gap-2 ${
                isWidgetsOpen
                  ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400'
                  : 'bg-zinc-900/40 border-zinc-700/50 text-gray-400 hover:text-white hover:border-yellow-500/40 hover:bg-zinc-800/40'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <LayoutGrid className="w-4 h-4" />
              Widgets
            </motion.button>

            {/* Horizontal Widgets Popup Menu */}
            {isWidgetsOpen && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 animate-in slide-in-from-bottom-2 duration-200">
                <div className="flex items-center gap-2">
                  {widgets.map((widget, index) => (
                    <motion.button
                      key={widget.type}
                      onClick={() => {
                        if (widget.label === 'Price Chart') {
                          console.log('Button Clicked: Price Chart');
                        }
                        onAddWidget(widget.type);
                      }}
                      className="group relative flex items-center justify-center w-10 h-10 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded transition-all"
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ 
                        delay: index * 0.05,
                        type: "spring",
                        stiffness: 400,
                        damping: 17
                      }}
                      whileHover={{ scale: 1.1, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <widget.icon className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
                      
                      {/* Animated Tooltip */}
                      <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                        <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 whitespace-nowrap">
                          <span className="text-xs text-gray-300">{widget.label}</span>
                        </div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                          <div className="border-4 border-transparent border-t-zinc-900"></div>
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Brush Tool */}
          <motion.button
            onClick={onBrushToggle}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-all flex items-center gap-2 ${
              isBrushActive
                ? 'bg-yellow-500/10 border-yellow-500/50 text-yellow-400'
                : 'bg-zinc-900/40 border-zinc-700/50 text-gray-400 hover:text-white hover:border-yellow-500/40 hover:bg-zinc-800/40'
            }`}
            title="Drawing tool"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Paintbrush className="w-4 h-4" />
            Brush
          </motion.button>

          {/* Text Field */}
          <motion.button
            onClick={onTextFieldAdd}
            className="px-4 py-1.5 rounded-lg text-sm font-medium border bg-zinc-900/40 border-zinc-700/50 text-gray-400 hover:text-white hover:border-yellow-500/40 hover:bg-zinc-800/40 transition-all flex items-center gap-2"
            title="Add text field"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Type className="w-4 h-4" />
            Text
          </motion.button>
        </div>

        {/* Right - Empty space for balance */}
        <div className="w-32"></div>
      </div>
    </div>
  );
}