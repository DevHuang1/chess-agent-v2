"use client";

import * as React from "react";
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
  setOpen: (open: boolean) => void;
  labelMap: Map<string, string>;
  setLabelMap: (map: Map<string, string>) => void;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("Select compound components must be used within <Select>");
  return ctx;
}

function extractLabel(children: React.ReactNode): string {
  if (typeof children === "string") return children;
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
  const [labelMap, setLabelMap] = React.useState<Map<string, string>>(new Map());
  const value = controlledValue ?? internalValue;

  const handleValueChange = React.useCallback(
    (v: string) => {
      setInternalValue(v);
      onValueChange?.(v);
      setOpen(false);
    },
    [onValueChange],
  );

  // Build label map from children
  React.useEffect(() => {
    const map = new Map<string, string>();
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child)) {
        const el = child as React.ReactElement<SelectItemProps>;
        if (el.props && typeof el.props === "object" && "value" in el.props && "children" in el.props) {
          map.set(el.props.value as string, extractLabel(el.props.children));
        }
      }
    });
    setLabelMap(map);
  }, [children]);

  return (
    <SelectContext.Provider value={{ value, onValueChange: handleValueChange, open, setOpen, labelMap, setLabelMap }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => {
  const { value, open, setOpen, labelMap } = useSelectContext();
  return (
    <button
      ref={ref}
      type="button"
      role="combobox"
      aria-expanded={open}
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onClick={() => setOpen(!open)}
      {...props}
    >
      <span className={cn(!labelMap.get(value) && "text-muted-foreground")}>
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
  return <span className={className}>{placeholder || "Select..."}</span>;
}

function SelectContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const { open, setOpen, value, onValueChange } = useSelectContext();
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={contentRef}
      className={cn(
        "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md",
        className,
      )}
    >
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return null;
        const el = child as React.ReactElement<SelectItemProps>;
        if (!el.props || typeof el.props !== "object" || !("value" in el.props)) return null;
        const itemValue = el.props.value as string;
        return (
          <div
            role="option"
            aria-selected={itemValue === value}
            className={cn(
              "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent-shadcn hover:text-accent-foreground",
              itemValue === value && "bg-accent-shadcn text-accent-foreground",
            )}
            onClick={() => onValueChange?.(itemValue)}
          >
            {itemValue === value && (
              <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
            )}
            {typeof el.props.children === "string" ? el.props.children : el}
          </div>
        );
      })}
    </div>
  );
}

function SelectItem({ children }: SelectItemProps) {
  return null;
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
