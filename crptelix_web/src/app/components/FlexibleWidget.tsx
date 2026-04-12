import { useState, useRef, useEffect } from 'react';
import { GripVertical, X, Maximize2, Minimize2 } from 'lucide-react';
import { Widget } from './DashboardWidget';
import { Card } from './ui/card';
import { motion, AnimatePresence } from 'motion/react';

interface FlexibleWidgetProps {
  widget: Widget;
  onRemove: (id: string) => void;
  onUpdatePosition: (id: string, position: { x: number; y: number }) => void;
  onUpdateSize: (id: string, size: { width: number; height: number }) => void;
  children: React.ReactNode;
}

export function FlexibleWidget({
  widget,
  onRemove,
  onUpdatePosition,
  onUpdateSize,
  children,
}: FlexibleWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const widgetRef = useRef<HTMLDivElement>(null);

  const position = widget.position || { x: 0, y: 0 };
  const size = widget.size || { width: 400, height: 320 };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        onUpdatePosition(widget.id, {
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      } else if (isResizing) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;
        onUpdateSize(widget.id, {
          width: Math.max(280, size.width + deltaX),
          height: Math.max(200, size.height + deltaY),
        });
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, widget.id, onUpdatePosition, onUpdateSize, size]);

  return (
    <motion.div
      ref={widgetRef}
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ 
        opacity: 1, 
        scale: isDragging ? 1.02 : 1,
        y: 0,
        rotateZ: isDragging ? 1 : 0
      }}
      exit={{ opacity: 0, scale: 0.9, y: -20 }}
      transition={{ duration: 0.2 }}
      className={`absolute group ${isDragging ? 'z-50 shadow-2xl' : 'z-10'} ${isResizing ? 'z-50' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
      }}
    >
      {widget.type === 'text-field' ? (
        // Text field without card background - invisible block
        <>
          {/* Drag Handle - only visible on hover */}
          <div
            className="absolute -top-6 left-0 h-6 cursor-move flex items-center px-2 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-zinc-900/80 rounded-t border border-b-0 border-zinc-700"
            onMouseDown={handleMouseDown}
          >
            <GripVertical className="w-3 h-3 text-gray-500" />
          </div>

          {/* Close Button */}
          <button
            onClick={() => onRemove(widget.id)}
            className="absolute -top-6 right-0 h-6 px-2 rounded-t hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-zinc-900/80 border border-b-0 border-zinc-700"
          >
            <X className="w-3 h-3 text-gray-500" />
          </button>

          {/* Content - just the text, no visible container */}
          <div className="h-full overflow-hidden">{children}</div>

          {/* Resize Handle */}
          <div
            className="resize-handle absolute bottom-0 right-0 w-6 h-6 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-20"
            onMouseDown={handleResizeStart}
          >
            <div className="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-gray-500"></div>
          </div>
        </>
      ) : (
        // Regular widgets with card background
        <Card className="h-full bg-zinc-900/95 border border-zinc-800 hover:border-zinc-700 transition-colors">
          {/* Drag Handle */}
          <div
            className="absolute top-0 left-0 right-0 h-10 cursor-move flex items-center px-3 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-gradient-to-b from-zinc-900/80 to-transparent"
            onMouseDown={handleMouseDown}
          >
            <GripVertical className="w-4 h-4 text-gray-500" />
          </div>

          {/* Close Button */}
          <button
            onClick={() => onRemove(widget.id)}
            className="absolute top-2 right-2 p-1 rounded hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-zinc-900/80"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>

          {/* Content */}
          <div className="p-4 h-full flex flex-col overflow-hidden min-h-0">
            <h3 className="font-semibold mb-3 text-white text-sm shrink-0">{widget.title}</h3>
            <div
              className={
                widget.type === 'line-chart' ||
                widget.type === 'bar-chart' ||
                widget.type === 'stats-card' ||
                widget.type === 'table'
                  ? 'flex-1 min-h-0 min-w-0 overflow-hidden'
                  : 'flex-1 overflow-auto'
              }
              style={
                widget.type === 'line-chart' ||
                widget.type === 'bar-chart' ||
                widget.type === 'stats-card' ||
                widget.type === 'table'
                  ? undefined
                  : { minHeight: '200px', minWidth: '200px' }
              }
            >
              {children}
            </div>
          </div>

          {/* Resize Handle */}
          <div
            className="resize-handle absolute bottom-0 right-0 w-6 h-6 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-20"
            onMouseDown={handleResizeStart}
          >
            <div className="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-gray-500"></div>
          </div>
        </Card>
      )}
    </motion.div>
  );
}