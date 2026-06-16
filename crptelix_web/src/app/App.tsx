import { useCallback, useEffect, useState } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { AiBot } from './components/AiBot';
import { AuthGate } from './components/auth/AuthGate';
import { DashboardCanvas } from './components/DashboardCanvas';
import { Widget } from './components/DashboardWidget';
import { TopBar } from './components/TopBar';
import { DataBase } from './components/DataBase';
import { ConstructorBottomMenu } from './components/ConstructorBottomMenu';
import { loadConstructorState, saveConstructorState } from './lib/dashboardStorage';
import { DEFAULT_FONT_SIZE } from './components/CanvasTextElement';
import { scalePx, scaleSize } from './lib/uiScale';

interface Canvas {
  id: string;
  name: string;
  widgets: Widget[];
}

function App() {
  const [initialState] = useState(() => loadConstructorState());
  const [canvases, setCanvases] = useState<Canvas[]>(initialState.canvases);
  const [activeCanvasId, setActiveCanvasId] = useState(initialState.activeCanvasId);
  const [currentView, setCurrentView] = useState<'constructor' | 'database'>('constructor');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isWidgetsOpen, setIsWidgetsOpen] = useState(false);
  const [isBrushActive, setIsBrushActive] = useState(false);
  const [drawToolMode, setDrawToolMode] = useState<'brush' | 'eraser'>('brush');
  const [brushColor, setBrushColor] = useState(initialState.brushColor);
  const [drawingsByCanvasId, setDrawingsByCanvasId] = useState<Record<string, string>>(
    initialState.drawingsByCanvasId
  );

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
    setDrawingsByCanvasId((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    
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

  const handleUpdatePosition = useCallback((id: string, position: { x: number; y: number }) => {
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
  }, [activeCanvasId]);

  const handleUpdateSize = useCallback((id: string, size: { width: number; height: number }) => {
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
  }, [activeCanvasId]);

  const handleUpdateWidgetData = (id: string, data: Record<string, unknown>) => {
    setCanvases((prev) =>
      prev.map((c) =>
        c.id === activeCanvasId
          ? {
              ...c,
              widgets: c.widgets.map((w) =>
                w.id === id ? { ...w, data: { ...(w.data ?? {}), ...data } } : w
              ),
            }
          : c
      )
    );
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      saveConstructorState({
        canvases,
        activeCanvasId,
        drawingsByCanvasId,
        brushColor,
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [canvases, activeCanvasId, drawingsByCanvasId, brushColor]);

  return (
    <AuthGate>
      {(user, logout) => (
    <DndProvider backend={HTML5Backend}>
      <div className="flex h-screen min-h-0 flex-col bg-black">
        {/* Top Bar */}
        <TopBar
          userEmail={user.email}
          userSignedInAt={user.signedInAt}
          onLogout={logout}
          currentView={currentView}
          onViewChange={setCurrentView}
          onWidgetsToggle={() => setIsWidgetsOpen(!isWidgetsOpen)}
          onChatToggle={() => setIsChatOpen(!isChatOpen)}
          isChatOpen={isChatOpen}
          isWidgetsOpen={isWidgetsOpen}
        />

        {/* Main Content Area */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Workspace - Constructor, Database, or Portfolio */}
          <div className="flex-1 min-w-0">
            {currentView === 'constructor' ? (
              <DashboardCanvas
                widgets={widgets}
                onAddWidget={handleAddWidget}
                onRemoveWidget={handleRemoveWidget}
                onUpdateWidgetPosition={handleUpdatePosition}
                onUpdateWidgetSize={handleUpdateSize}
                onUpdateWidgetData={handleUpdateWidgetData}
                isWidgetsOpen={isWidgetsOpen}
                isBrushActive={isBrushActive}
                drawToolMode={drawToolMode}
                brushColor={brushColor}
                canvasId={activeCanvasId}
                drawingDataUrl={drawingsByCanvasId[activeCanvasId]}
                onDrawingChange={(dataUrl) =>
                  setDrawingsByCanvasId((prev) => ({ ...prev, [activeCanvasId]: dataUrl }))
                }
              />
            ) : (
              <DataBase />
            )}
          </div>

          {/* Right Sidebar - AI Bot (overlay on narrow screens) */}
          {isChatOpen && (
            <div className="absolute inset-y-0 right-0 z-40 w-full max-w-sm animate-in shadow-2xl slide-in-from-right duration-300 sm:relative sm:inset-auto sm:z-auto sm:w-80 sm:max-w-none sm:flex-shrink-0 sm:shadow-none">
              <AiBot />
            </div>
          )}
        </div>

        {/* Constructor Bottom Menu */}
        {currentView === 'constructor' && (
          <div className="relative z-30 shrink-0 overflow-visible">
          <ConstructorBottomMenu
            onWidgetsToggle={() => setIsWidgetsOpen(!isWidgetsOpen)}
            onBrushToggle={() => setIsBrushActive((active) => !active)}
            isBrushActive={isBrushActive}
            drawToolMode={drawToolMode}
            onDrawToolModeChange={setDrawToolMode}
            brushColor={brushColor}
            onBrushColorChange={setBrushColor}
            onTextFieldAdd={() => {
              const newTextField = {
                id: `text-${Date.now()}`,
                type: 'text-field' as const,
                title: 'Text',
                position: { x: scalePx(100), y: scalePx(100) },
                size: scaleSize(280, 120),
                data: { text: '', html: '', fontSize: DEFAULT_FONT_SIZE },
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
                position: { x: Math.floor(Math.random() * scalePx(400)) + scalePx(50), y: Math.floor(Math.random() * scalePx(200)) + scalePx(50) },
                size: type === 'table'
                  ? scaleSize(600, 500)
                  : type === 'portfolio-widget'
                  ? scaleSize(800, 600)
                  : scaleSize(400, 320),
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
          />
          </div>
        )}
      </div>
    </DndProvider>
      )}
    </AuthGate>
  );
}

export default App;