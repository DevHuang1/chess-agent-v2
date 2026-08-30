"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type SelectItemProps = {
  value: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
};

type SelectContextValue = {
  value: string;
  onValueChange?: (value: string) => void;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  labelMap: Map<string, string>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("Select compound components must be used within <Select>");
  return ctx;
}

function extractLabel(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractLabel).join("");
  if (React.isValidElement(children)) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>;
    return extractLabel(el.props.children);
  }
  return "";
}

function Select({ value: controlledValue, defaultValue = "", onValueChange, children }: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const value = controlledValue ?? internalValue;

  const handleValueChange = React.useCallback(
    (v: string) => {
      setInternalValue(v);
      onValueChange?.(v);
      setOpen(false);
    },
    [onValueChange],
  );

  // Build the value → label map by walking the whole child tree (through
  // <SelectContent>) so every <SelectItem> registers its label. A shallow
  // React.Children pass never reaches the items, leaving the trigger stuck
  // on "Select...".
  const labelMap = React.useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: React.ReactNode) => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;
        const el = child as React.ReactElement<SelectItemProps>;
        if (el.type === SelectItem && el.props && "value" in el.props) {
          map.set(el.props.value, extractLabel(el.props.children));
        }
        if (el.props && typeof el.props === "object" && "children" in el.props) {
          walk(el.props.children);
        }
      });
    };
    walk(children);
    return map;
  }, [children]);

  return (
    <SelectContext.Provider value={{ value, onValueChange: handleValueChange, open, setOpen, labelMap, triggerRef }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => {
  const { value, open, setOpen, labelMap, triggerRef } = useSelectContext();
  return (
    <button
      ref={(node) => {
        triggerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      type="button"
      role="combobox"
      aria-expanded={open}
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      {...props}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          !labelMap.get(value) && "text-muted-foreground",
        )}
      >
        {labelMap.get(value) || "Select..."}
      </span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("shrink-0 opacity-50 transition-transform", open && "rotate-180")}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

function SelectValue({ placeholder, className }: { placeholder?: string; className?: string }) {
  const { value, labelMap } = useSelectContext();
  const label = labelMap.get(value);
  return (
    <span className={cn("min-w-0 truncate", !label && "text-muted-foreground", className)}>
      {label || placeholder || "Select..."}
    </span>
  );
}

function SelectContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const { open, setOpen, value, onValueChange, triggerRef } = useSelectContext();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [contentStyle, setContentStyle] = React.useState<React.CSSProperties>({});

  // Rendered through a portal so the menu is never clipped by overflow-hidden
  // ancestors or trapped in a lower stacking context (the chessboard used to
  // paint above it and swallow clicks). Position is `fixed`, measured from the
  // trigger, flipped/clamped so it never opens off-screen.
  const CONTENT_MAX_H = 240; // matches max-h-60
  const VIEWPORT_MARGIN = 8;

  React.useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const update = () => {
      const rect = trigger.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < Math.min(CONTENT_MAX_H, 180) && rect.top > spaceBelow;
      const width = Math.max(rect.width, 120);
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
      );
      setContentStyle({
        position: "fixed",
        left,
        width,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, triggerRef]);

  React.useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        contentRef.current &&
        !contentRef.current.contains(target) &&
        !(trigger && trigger.contains(target))
      ) {
        setOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open, setOpen, triggerRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={contentRef}
      role="listbox"
      style={contentStyle}
      className={cn(
        "z-[9999] max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md",
        className,
      )}
    >
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return null;
        const el = child as React.ReactElement<SelectItemProps>;
        if (!el.props || typeof el.props !== "object" || !("value" in el.props)) return null;
        const itemValue = el.props.value as string;
        const selected = itemValue === value;
        return (
          <div
            key={itemValue}
            role="option"
            aria-selected={selected}
            className={cn(
              "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent-shadcn hover:text-accent-foreground",
              selected && "bg-accent-shadcn text-accent-foreground",
            )}
            onClick={() => onValueChange?.(itemValue)}
          >
            {selected && (
              <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
            )}
            {/* Render the item's children directly — rendering the <SelectItem>
                element itself would render null and produce an empty menu. */}
            <span className="min-w-0">{el.props.children}</span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

function SelectItem({ children }: SelectItemProps) {
  return null;
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
