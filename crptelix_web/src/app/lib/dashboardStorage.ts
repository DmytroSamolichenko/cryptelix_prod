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

export interface ConstructorBoardCache {
  revision: number;
  state: Omit<ConstructorPersistedState, 'version'>;
}

const LEGACY_STORAGE_KEY = 'cryptelix-constructor-state';
export const MAX_CONSTRUCTOR_CANVASES = 5;

function storageKey(userId: number | string): string {
  return `cryptelix-constructor-state:${userId}`;
}

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
          layer: 0,
        },
        {
          id: 'widget-2',
          type: 'stats-card',
          title: 'Key Metrics',
          position: { x: scalePx(700), y: scalePx(50) },
          size: scaleSize(450, 320),
          layer: 0,
        },
        {
          id: 'widget-3',
          type: 'line-chart',
          title: 'Price Chart',
          position: { x: scalePx(50), y: scalePx(600) },
          size: scaleSize(500, 300),
          layer: 0,
        },
        {
          id: 'widget-4',
          type: 'bar-chart',
          title: 'Wins vs Losses',
          position: { x: scalePx(600), y: scalePx(600) },
          size: scaleSize(500, 300),
          layer: 0,
        },
      ],
    },
  ];
}

export function getDefaultState(): Omit<ConstructorPersistedState, 'version'> {
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

function normalizeWidgetLayers(
  state: Omit<ConstructorPersistedState, 'version'>
): Omit<ConstructorPersistedState, 'version'> {
  return {
    ...state,
    canvases: state.canvases.map((c) => ({
      ...c,
      widgets: c.widgets.map((w) => ({
        ...w,
        layer: typeof w.layer === 'number' && Number.isFinite(w.layer) ? w.layer : 0,
      })),
    })),
  };
}

function parseStoredState(raw: string | null): Omit<ConstructorPersistedState, 'version'> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConstructorPersistedState> & {
      revision?: number;
      state?: Omit<ConstructorPersistedState, 'version'>;
    };

    // New cache shape: { revision, state: {...} } or full document with version
    if (parsed.state && isValidCanvases(parsed.state.canvases)) {
      const activeCanvasId =
        typeof parsed.state.activeCanvasId === 'string' &&
        parsed.state.canvases.some((c) => c.id === parsed.state!.activeCanvasId)
          ? parsed.state.activeCanvasId
          : parsed.state.canvases[0].id;
      return normalizeWidgetLayers({
        canvases: parsed.state.canvases,
        activeCanvasId,
        drawingsByCanvasId:
          parsed.state.drawingsByCanvasId && typeof parsed.state.drawingsByCanvasId === 'object'
            ? parsed.state.drawingsByCanvasId
            : {},
        brushColor:
          typeof parsed.state.brushColor === 'string' ? parsed.state.brushColor : '#ffffff',
      });
    }

    if (parsed.version !== 1 || !isValidCanvases(parsed.canvases)) {
      return null;
    }

    const activeCanvasId =
      typeof parsed.activeCanvasId === 'string' &&
      parsed.canvases.some((c) => c.id === parsed.activeCanvasId)
        ? parsed.activeCanvasId
        : parsed.canvases[0].id;

    return normalizeWidgetLayers({
      canvases: parsed.canvases,
      activeCanvasId,
      drawingsByCanvasId:
        parsed.drawingsByCanvasId && typeof parsed.drawingsByCanvasId === 'object'
          ? parsed.drawingsByCanvasId
          : {},
      brushColor: typeof parsed.brushColor === 'string' ? parsed.brushColor : '#ffffff',
    });
  } catch {
    return null;
  }
}

function parseRevision(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { revision?: number };
    const r = Number(parsed.revision);
    return Number.isFinite(r) && r >= 0 ? r : 0;
  } catch {
    return 0;
  }
}

/** Migrate legacy unscoped key into user-scoped cache (once). */
function migrateLegacyKey(userId: number | string): void {
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return;
    const key = storageKey(userId);
    if (!localStorage.getItem(key)) {
      const state = parseStoredState(legacy);
      if (state) {
        const cache: ConstructorBoardCache = { revision: 0, state };
        localStorage.setItem(key, JSON.stringify(cache));
      }
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function loadConstructorState(
  userId?: number | string | null
): Omit<ConstructorPersistedState, 'version'> {
  if (userId == null) {
    return getDefaultState();
  }
  migrateLegacyKey(userId);
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return parseStoredState(raw) ?? getDefaultState();
  } catch {
    return getDefaultState();
  }
}

export function loadConstructorRevision(userId: number | string): number {
  migrateLegacyKey(userId);
  try {
    return parseRevision(localStorage.getItem(storageKey(userId)));
  } catch {
    return 0;
  }
}

export function saveConstructorState(
  userId: number | string,
  state: Omit<ConstructorPersistedState, 'version'>,
  revision = 0
): void {
  const normalized = normalizeWidgetLayers(state);
  const cache: ConstructorBoardCache = {
    revision,
    state: normalized,
  };
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(cache));
    return;
  } catch {
    try {
      localStorage.setItem(
        storageKey(userId),
        JSON.stringify({
          ...cache,
          state: { ...normalized, drawingsByCanvasId: {} },
        })
      );
    } catch (error) {
      console.warn('Failed to persist constructor state', error);
    }
  }
}

export function payloadFromState(
  state: Omit<ConstructorPersistedState, 'version'>
): ConstructorPersistedState {
  return { version: 1, ...normalizeWidgetLayers(state) };
}

export function stateFromPayload(
  payload: unknown
): Omit<ConstructorPersistedState, 'version'> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Partial<ConstructorPersistedState>;
  if (!isValidCanvases(p.canvases)) return null;
  const activeCanvasId =
    typeof p.activeCanvasId === 'string' &&
    p.canvases.some((c) => c.id === p.activeCanvasId)
      ? p.activeCanvasId
      : p.canvases[0].id;
  return normalizeWidgetLayers({
    canvases: p.canvases,
    activeCanvasId,
    drawingsByCanvasId:
      p.drawingsByCanvasId && typeof p.drawingsByCanvasId === 'object'
        ? (p.drawingsByCanvasId as Record<string, string>)
        : {},
    brushColor: typeof p.brushColor === 'string' ? p.brushColor : '#ffffff',
  });
}
