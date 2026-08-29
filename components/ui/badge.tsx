import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-sm",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow-sm",
        outline: "text-foreground",
        accent:
          "border-transparent bg-accent text-primary-foreground",
        muted:
          "border-transparent bg-muted text-muted-foreground",
        success:
          "border-transparent bg-emerald-500/15 text-emerald-400",
        warning:
          "border-transparent bg-amber-500/15 text-amber-400",
        info:
          "border-transparent bg-sky-500/15 text-sky-400",
        /* Emotion spectrum */
        calm:
          "border-transparent bg-sky-500/15 text-emotion-calm",
        focused:
          "border-transparent bg-cyan-500/15 text-emotion-focused",
        neutral:
          "border-transparent bg-zinc-500/15 text-emotion-neutral",
        frustrated:
          "border-transparent bg-orange-500/15 text-emotion-frustrated",
        stressed:
          "border-transparent bg-red-500/15 text-emotion-stressed",
        confident:
          "border-transparent bg-emerald-500/15 text-emotion-confident",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
