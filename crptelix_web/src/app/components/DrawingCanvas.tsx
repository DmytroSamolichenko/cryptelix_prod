import { useRef, useEffect, useState, useCallback } from 'react';

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
  color?: string;
  canvasId?: string;
  drawingDataUrl?: string;
  onDrawingChange?: (dataUrl: string) => void;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  worldRef?: React.RefObject<HTMLDivElement | null>;
}

export function DrawingCanvas({
  isActive,
  color = '#ffffff',
  canvasId,
  drawingDataUrl,
  onDrawingChange,
  viewportRef,
  worldRef,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const restoredForCanvasRef = useRef<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const persistDrawing = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onDrawingChange) return;
    onDrawingChange(canvas.toDataURL());
  }, [onDrawingChange]);

  const restoreDrawing = useCallback(
    (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, dataUrl: string) => {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = dataUrl;
    },
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    contextRef.current = ctx;

    const updateCanvasSize = () => {
      const parent = viewportRef?.current ?? canvas.parentElement;
      if (!parent) return;

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w <= 0 || h <= 0) return;

      const snapshot =
        canvas.width > 0 && canvas.height > 0 ? canvas.toDataURL() : null;

      canvas.width = w;
      canvas.height = h;

      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;

      if (snapshot) {
        restoreDrawing(ctx, canvas, snapshot);
      }
    };

    updateCanvasSize();

    const parent = viewportRef?.current ?? canvas.parentElement;
    const ro = parent ? new ResizeObserver(updateCanvasSize) : null;
    ro?.observe(parent);
    window.addEventListener('resize', updateCanvasSize);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [viewportRef, restoreDrawing, color]);

  useEffect(() => {
    if (!canvasId) return;
    if (restoredForCanvasRef.current === canvasId) return;

    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx || canvas.width === 0) return;

    restoredForCanvasRef.current = canvasId;
    if (drawingDataUrl) {
      restoreDrawing(ctx, canvas, drawingDataUrl);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [canvasId, drawingDataUrl, restoreDrawing]);

  useEffect(() => {
    const ctx = contextRef.current;
    if (ctx) ctx.strokeStyle = color;
  }, [color]);

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const startStroke = useCallback(
    (clientX: number, clientY: number) => {
      if (!isActive) return;
      const ctx = contextRef.current;
      const point = getCanvasPoint(clientX, clientY);
      if (!ctx || !point) return;

      isDrawingRef.current = true;
      setIsDrawing(true);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    },
    [color, getCanvasPoint, isActive]
  );

  const continueStroke = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDrawingRef.current) return;
      const ctx = contextRef.current;
      const point = getCanvasPoint(clientX, clientY);
      if (!ctx || !point) return;

      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    },
    [getCanvasPoint]
  );

  const endStroke = useCallback(() => {
    const ctx = contextRef.current;
    if (!ctx || !isDrawingRef.current) return;
    isDrawingRef.current = false;
    setIsDrawing(false);
    ctx.closePath();
    persistDrawing();
  }, [persistDrawing]);

  useEffect(() => {
    const world = worldRef?.current;
    if (!world || !isActive) return;

    const handleWorldMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (e.target !== world) return;
      e.preventDefault();
      startStroke(e.clientX, e.clientY);
    };

    world.addEventListener('mousedown', handleWorldMouseDown);
    return () => world.removeEventListener('mousedown', handleWorldMouseDown);
  }, [worldRef, startStroke, isActive]);

  useEffect(() => {
    if (!isDrawing) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      continueStroke(e.clientX, e.clientY);
    };
    const handleMouseUp = () => endStroke();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDrawing, continueStroke, endStroke]);

  return (
    <canvas
      ref={canvasRef}
      data-brush-canvas
      className="pointer-events-none absolute inset-0 z-[35]"
      style={{ cursor: isActive && isDrawing ? 'crosshair' : 'default' }}
    />
  );
}
