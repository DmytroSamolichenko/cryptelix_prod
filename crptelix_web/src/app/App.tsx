import { useState } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { AiBot } from './components/AiBot';
import { DashboardCanvas } from './components/DashboardCanvas';
import { Widget } from './components/DashboardWidget';
import { TopBar } from './components/TopBar';
import { DataBase } from './components/DataBase';
import { ConstructorBottomMenu } from './components/ConstructorBottomMenu';

interface Canvas {
  id: string;
  name: string;
  widgets: Widget[];
}

function App() {
  const [canvases, setCanvases] = useState<Canvas[]>([
    {
      id: 'canvas-1',
      name: 'Dashboard 1',
      widgets: [
        {
          id: 'widget-1',
          type: 'table',
          title: 'Full Trading Report',
          position: { x: 50, y: 50 },
          size: { width: 600, height: 500 },
        },
        {
          id: 'widget-2',
          type: 'stats-card',
          title: 'Key Metrics',
          position: { x: 700, y: 50 },
          size: { width: 450, height: 320 },
        },
        {
          id: 'widget-3',
          type: 'line-chart',
          title: 'Profit Trend',
          position: { x: 50, y: 600 },
          size: { width: 500, height: 300 },
        },
        {
          id: 'widget-4',
          type: 'bar-chart',
          title: 'Wins vs Losses',
          position: { x: 600, y: 600 },
          size: { width: 500, height: 300 },
        },
      ],
    },
  ]);

  const [activeCanvasId, setActiveCanvasId] = useState('canvas-1');
  const [currentView, setCurrentView] = useState<'constructor' | 'database'>('constructor');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isWidgetsOpen, setIsWidgetsOpen] = useState(false);
  const [isBrushActive, setIsBrushActive] = useState(false);

  const activeCanvas = canvases.find((c) => c.id === activeCanvasId);
  const widgets = activeCanvas?.widgets || [];

  const addCanvas = () => {
    const newCanvas: Canvas = {
      id: `canvas-${Date.now()}`,
      name: `Dashboard ${canvases.length + 1}`,
      widgets: [],
    };
    setCanvases((prev) => [...prev, newCanvas]);
    setActiveCanvasId(newCanvas.id);
  };

  const renameCanvas = (id: string, newName: string) => {
    setCanvases((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: newName } : c))
    );
  };

  const deleteCanvas = (id: string) => {
    if (canvases.length <= 1) return; // Don't delete if it's the last canvas
    
    setCanvases((prev) => prev.filter((c) => c.id !== id));
    
    // If deleting the active canvas, switch to the first remaining canvas
    if (id === activeCanvasId) {
      const remainingCanvases = canvases.filter((c) => c.id !== id);
      if (remainingCanvases.length > 0) {
        setActiveCanvasId(remainingCanvases[0].id);
      }
    }
  };

  const handleAddWidget = (widget: Widget) => {
    setCanvases((prev) =>
      prev.map((c) =>
        c.id === activeCanvasId ? { ...c, widgets: [...c.widgets, widget] } : c
      )
    );
  };

  const handleRemoveWidget = (id: string) => {
    setCanvases((prev) =>
      prev.map((c) =>
        c.id === activeCanvasId ? { ...c, widgets: c.widgets.filter((w) => w.id !== id) } : c
      )
    );
  };

  const handleUpdatePosition = (id: string, position: { x: number; y: number }) => {
    setCanvases((prev) =>
      prev.map((c) =>
        c.id === activeCanvasId
          ? {
              ...c,
              widgets: c.widgets.map((w) => (w.id === id ? { ...w, position } : w)),
            }
          : c
      )
    );
  };

  const handleUpdateSize = (id: string, size: { width: number; height: number }) => {
    setCanvases((prev) =>
      prev.map((c) =>
        c.id === activeCanvasId
          ? {
              ...c,
              widgets: c.widgets.map((w) => (w.id === id ? { ...w, size } : w)),
            }
          : c
      )
    );
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-screen flex flex-col overflow-hidden bg-black">
        {/* Top Bar */}
        <TopBar
          currentView={currentView}
          onViewChange={setCurrentView}
          onWidgetsToggle={() => setIsWidgetsOpen(!isWidgetsOpen)}
          onChatToggle={() => setIsChatOpen(!isChatOpen)}
          isChatOpen={isChatOpen}
          isWidgetsOpen={isWidgetsOpen}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Workspace - Constructor, Database, or Portfolio */}
          <div className="flex-1 min-w-0">
            {currentView === 'constructor' ? (
              <DashboardCanvas
                widgets={widgets}
                onAddWidget={handleAddWidget}
                onRemoveWidget={handleRemoveWidget}
                onUpdateWidgetPosition={handleUpdatePosition}
                onUpdateWidgetSize={handleUpdateSize}
                isWidgetsOpen={isWidgetsOpen}
                isBrushActive={isBrushActive}
              />
            ) : (
              <DataBase />
            )}
          </div>

          {/* Right Sidebar - AI Bot (Collapsible) */}
          {isChatOpen && (
            <div className="w-96 flex-shrink-0 animate-in slide-in-from-right duration-300">
              <AiBot />
            </div>
          )}
        </div>

        {/* Constructor Bottom Menu */}
        {currentView === 'constructor' && (
          <ConstructorBottomMenu
            onWidgetsToggle={() => setIsWidgetsOpen(!isWidgetsOpen)}
            onBrushToggle={() => setIsBrushActive(!isBrushActive)}
            onTextFieldAdd={() => {
              // Add a text field widget
              const newTextField = {
                id: `text-${Date.now()}`,
                type: 'text-field' as const,
                title: 'Text Field',
                position: { x: 100, y: 100 },
                size: { width: 300, height: 100 },
              };
              handleAddWidget(newTextField);
            }}
            onAddWidget={(type) => {
              // Add widget by type
              const widgetTitles: Record<string, string> = {
                'line-chart': 'Profit Trend',
                'bar-chart': 'Wins vs Losses',
                'pie-chart': 'Portfolio Mix',
                'area-chart': 'Cumulative P&L',
                'stats-card': 'Key Metrics',
                'table': 'Full Trading Report',
                'portfolio-widget': 'Portfolio Analytics',
              };
              const newWidget = {
                id: `widget-${Date.now()}-${Math.random()}`,
                type,
                title: widgetTitles[type] || 'Widget',
                position: { x: Math.floor(Math.random() * 400) + 50, y: Math.floor(Math.random() * 200) + 50 },
                size: type === 'table' 
                  ? { width: 600, height: 500 } 
                  : type === 'portfolio-widget'
                  ? { width: 800, height: 600 }
                  : { width: 400, height: 320 },
              };
              handleAddWidget(newWidget);
            }}
            canvases={canvases}
            activeCanvasId={activeCanvasId}
            onCanvasChange={setActiveCanvasId}
            onCanvasAdd={addCanvas}
            onCanvasRename={renameCanvas}
            onCanvasDelete={deleteCanvas}
            isWidgetsOpen={isWidgetsOpen}
            isBrushActive={isBrushActive}
          />
        )}
      </div>
    </DndProvider>
  );
}

export default App;