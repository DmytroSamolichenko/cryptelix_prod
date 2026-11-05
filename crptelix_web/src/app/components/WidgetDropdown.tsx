import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type DropdownOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
};

/** Custom dropdown; the menu is portaled so the widget's overflow clipping can't cut it off. */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  title,
  prefix,
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (next: T) => void;
  title: string;
  prefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  const menuHeight = Math.min(options.length * 36 + 8, 248);
  const flip = rect != null && rect.bottom + menuHeight + 12 > window.innerHeight;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className={`inline-flex min-w-0 shrink items-center gap-2 rounded-xl border bg-zinc-950 px-3 py-1.5 text-[13px] font-medium text-[#e8e4d9] outline-none transition-colors ${
          open ? 'border-yellow-500/60' : 'border-zinc-800 hover:border-zinc-700'
        } focus-visible:border-yellow-500/60`}
      >
        {prefix && <span className="font-normal text-zinc-500">{prefix}</span>}
        <span className="truncate">{current?.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180 text-yellow-400' : ''}`}
        />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={title}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: rect.left,
              minWidth: Math.max(rect.width, 150),
              maxHeight: 248,
              ...(flip ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
            }}
            className="z-[9999] overflow-y-auto rounded-xl border border-yellow-900/40 bg-[#0c0c0c] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
          >
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={o.disabled}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected
                      ? 'bg-yellow-400/10 text-yellow-400'
                      : 'text-zinc-300 hover:bg-white/5 hover:text-white disabled:hover:bg-transparent'
                  }`}
                >
                  <span className="flex-1 font-medium">{o.label}</span>
                  {o.hint && (
                    <span className="rounded-md border border-zinc-800 px-1.5 text-[10px] text-zinc-500">
                      {o.hint}
                    </span>
                  )}
                  <Check className={`h-3.5 w-3.5 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
