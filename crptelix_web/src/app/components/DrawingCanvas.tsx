import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  clientToWorldPoint,
  eraseStrokesAlongPath,
  parseDrawingData,
  serializeDrawingData,
  WORLD_ERASER_WIDTH,
  WORLD_STROKE_WIDTH,
  type DrawToolMode,
  type DrawingDocument,
  type DrawingStroke,
} from '../lib/drawingStorage';

export const BRUSH_COLORS = [
  { value: '#ffffff', label: 'White' },
  { value: '#facc15', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#ef4444', label: 'Red' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#f97316', label: 'Orange' },
  { value: '#18181b', label: 'Black' },
] as const;

interface DrawingCanvasProps {
  isActive: boolean;
  toolMode: DrawToolMode;
  color?: string;
  canvasId?: string;
  worldSize: number;
  drawingData?: string;
  onDrawingChange?: (data: string) => void;
  worldRef: React.RefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
}

function pointsToPolyline(points: DrawingStroke['points']): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function StrokePath({ stroke }: { stroke: DrawingStroke }) {
  if (stroke.points.length < 2) return null;

  return (
    <polyline
      points={pointsToPolyline(stroke.points)}
      fill="none"
      stroke={stroke.color}
      strokeWidth={stroke.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function EraserPreviewPath({ points }: { points: DrawingStroke['points'] }) {
  if (points.length < 2) return null;

  return (
    <polyline
      points={pointsToPolyline(points)}
      fill="none"
      stroke="rgba(250, 250, 250, 0.45)"
      strokeWidth={WORLD_ERASER_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export function DrawingCanvas({
  isActive,
  toolMode,
  color = '#ffffff',
  canvasId,
  worldSize,
  drawingData,
  onDrawingChange,
  worldRef,
  zoomRef,
}: DrawingCanvasProps) {
  const [document, setDocument] = useState<DrawingDocument>(() => parseDrawingData(drawingData));
  const [liveStroke, setLiveStroke] = useState<DrawingStroke | null>(null);
  const liveStrokeRef = useRef<DrawingStroke | null>(null);
  const isDrawingRef = useRef(false);
  const restoredForCanvasRef = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const persistDocument = useCallback(
    (next: DrawingDocument) => {
      onDrawingChange?.(serializeDrawingData(next));
    },
    [onDrawingChange]
  );

  useEffect(() => {
    if (!canvasId) return;
    if (restoredForCanvasRef.current === canvasId) return;

    restoredForCanvasRef.current = canvasId;
    const parsed = parseDrawingData(drawingData);
    setDocument(parsed);
    liveStrokeRef.current = null;
    setLiveStroke(null);
    isDrawingRef.current = false;
  }, [canvasId, drawingData]);

  const getWorldPoint = useCallback(
    (clientX: number, clientY: number) => {
      const world = worldRef.current;
      if (!world) return null;
      return clientToWorldPoint(clientX, clientY, world, zoomRef.current);
    },
    [worldRef, zoomRef]
  );

  const startStroke = useCallback(
    (clientX: number, clientY: number) => {
      if (!isActive) return;
      const point = getWorldPoint(clientX, clientY);
      if (!point) return;

      const stroke: DrawingStroke = {
        id: `stroke-${Date.now()}`,
        color: toolMode === 'eraser' ? 'eraser' : color,
        width: toolMode === 'eraser' ? WORLD_ERASER_WIDTH : WORLD_STROKE_WIDTH,
        points: [point],
      };

      isDrawingRef.current = true;
      liveStrokeRef.current = stroke;
      setLiveStroke(stroke);
    },
    [color, getWorldPoint, isActive, toolMode]
  );

  const continueStroke = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDrawingRef.current) return;
      const point = getWorldPoint(clientX, clientY);
      if (!point) return;

      const current = liveStrokeRef.current;
      if (!current) return;

      const last = current.points[current.points.length - 1];
      if (last && last.x === point.x && last.y === point.y) return;

      const nextStroke = { ...current, points: [...current.points, point] };
      liveStrokeRef.current = nextStroke;
      setLiveStroke(nextStroke);
    },
    [getWorldPoint]
  );

  const endStroke = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const finished = liveStrokeRef.current;
    liveStrokeRef.current = null;
    setLiveStroke(null);

    if (!finished || finished.points.length === 0) return;

    setDocument((prev) => {
      let next: DrawingDocument;

      if (toolMode === 'eraser') {
        next = {
          version: 1,
          strokes: eraseStrokesAlongPath(prev.strokes, finished.points, WORLD_ERASER_WIDTH),
        };
      } else if (finished.points.length < 2) {
        return prev;
      } else {
        next = {
          version: 1,
          strokes: [...prev.strokes, { ...finished, color, width: WORLD_STROKE_WIDTH }],
        };
      }

      persistDocument(next);
      return next;
    });
  }, [color, persistDocument, toolMode]);

  useEffect(() => {
    if (!isActive) return;

    const svg = svgRef.current;
    if (!svg) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      startStroke(event.clientX, event.clientY);
    };

    svg.addEventListener('mousedown', handleMouseDown);
    return () => svg.removeEventListener('mousedown', handleMouseDown);
  }, [isActive, startStroke]);

  useEffect(() => {
    if (!liveStroke) return;

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      continueStroke(event.clientX, event.clientY);
    };
    const handleMouseUp = () => endStroke();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [liveStroke, continueStroke, endStroke]);

  const cursorClass =
    toolMode === 'eraser'
      ? 'cursor-cell'
      : 'cursor-crosshair';

  const showEraserPreview = toolMode === 'eraser' && liveStroke;

  return (
    <svg
      ref={svgRef}
      data-brush-layer
      aria-hidden
      className={`absolute left-0 top-0 z-[45] ${
        isActive ? `pointer-events-auto ${cursorClass}` : 'pointer-events-none'
      }`}
      width={worldSize}
      height={worldSize}
      viewBox={`0 0 ${worldSize} ${worldSize}`}
    >
      {document.strokes.map((stroke) => (
        <StrokePath key={stroke.id} stroke={stroke} />
      ))}
      {toolMode === 'brush' && liveStroke && <StrokePath stroke={{ ...liveStroke, color }} />}
      {showEraserPreview && <EraserPreviewPath points={liveStroke.points} />}
    </svg>
  );
}
