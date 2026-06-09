import type { Widget } from '../components/DashboardWidget';
import { scalePx, scaleSize } from './uiScale';

export interface StoredCanvas {
  id: string;
  name: string;
  widgets: Widget[];
}

export interface ConstructorPersistedState {
  version: 1;
  canvases: StoredCanvas[];
  activeCanvasId: string;
  drawingsByCanvasId: Record<string, string>;
  brushColor: string;
}

const STORAGE_KEY = 'cryptelix-constructor-state';

export function getDefaultCanvases(): StoredCanvas[] {
  return [
    {
      id: 'canvas-1',
      name: 'Dashboard 1',
      widgets: [
        {
          id: 'widget-1',
          type: 'table',
          title: 'Full Trading Report',
          position: { x: scalePx(50), y: scalePx(50) },
          size: scaleSize(600, 500),
        },
        {
          id: 'widget-2',
          type: 'stats-card',
          title: 'Key Metrics',
          position: { x: scalePx(700), y: scalePx(50) },
          size: scaleSize(450, 320),
        },
        {
          id: 'widget-3',
          type: 'line-chart',
          title: 'Profit Trend',
          position: { x: scalePx(50), y: scalePx(600) },
          size: scaleSize(500, 300),
        },
        {
          id: 'widget-4',
          type: 'bar-chart',
          title: 'Wins vs Losses',
          position: { x: scalePx(600), y: scalePx(600) },
          size: scaleSize(500, 300),
        },
      ],
    },
  ];
}

function getDefaultState(): Omit<ConstructorPersistedState, 'version'> {
  return {
    canvases: getDefaultCanvases(),
    activeCanvasId: 'canvas-1',
    drawingsByCanvasId: {},
    brushColor: '#ffffff',
  };
}

function isValidCanvases(value: unknown): value is StoredCanvas[] {
  return (
    Array.isArray(value) &&
    value.every(
      (c) =>
        c &&
        typeof c === 'object' &&
        typeof c.id === 'string' &&
        typeof c.name === 'string' &&
        Array.isArray(c.widgets)
    )
  );
}

export function loadConstructorState(): Omit<ConstructorPersistedState, 'version'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();

    const parsed = JSON.parse(raw) as Partial<ConstructorPersistedState>;
    if (parsed.version !== 1 || !isValidCanvases(parsed.canvases)) {
      return getDefaultState();
    }

    const activeCanvasId =
      typeof parsed.activeCanvasId === 'string' &&
      parsed.canvases.some((c) => c.id === parsed.activeCanvasId)
        ? parsed.activeCanvasId
        : parsed.canvases[0].id;

    return {
      canvases: parsed.canvases,
      activeCanvasId,
      drawingsByCanvasId:
        parsed.drawingsByCanvasId && typeof parsed.drawingsByCanvasId === 'object'
          ? parsed.drawingsByCanvasId
          : {},
      brushColor:
        typeof parsed.brushColor === 'string' ? parsed.brushColor : '#ffffff',
    };
  } catch {
    return getDefaultState();
  }
}

export function saveConstructorState(
  state: Omit<ConstructorPersistedState, 'version'>
): void {
  const payload: ConstructorPersistedState = { version: 1, ...state };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return;
  } catch {
    // Legacy bitmap drawings are ignored after switching to vector format.
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...payload, drawingsByCanvasId: {} })
      );
    } catch (error) {
      console.warn('Failed to persist constructor state', error);
    }
  }
}
