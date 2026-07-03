import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Sheet — a side drawer built on @radix-ui/react-dialog (shadcn-style).
 *
 * NOTE (same constraint as dialog.tsx): this package is consumed pre-bundled,
 * so the consumer's Tailwind does NOT scan its source. Every layout-critical
 * style (positioning, size, slide transform) is therefore expressed as INLINE
 * styles; only theme/utility classes already emitted by the consuming apps
 * (bg-background, border, shadow-lg, …) are used as classNames.
 */

type SheetSide = "left" | "right" | "bottom";

const Sheet = DialogPrimitive.Root;

const SheetTrigger = DialogPrimitive.Trigger;

const SheetClose = DialogPrimitive.Close;

const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    // Inline positioning: scan-independent (see file header note).
    style={{ position: "fixed", inset: 0, zIndex: 50, ...style }}
    className={cn("bg-background/80 backdrop-blur-sm", className)}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

/** Anchoring box per side (inline, scan-independent). */
const SIDE_BASE: Record<SheetSide, React.CSSProperties> = {
  left: { top: 0, bottom: 0, left: 0, maxWidth: "85vw" },
  right: { top: 0, bottom: 0, right: 0, maxWidth: "85vw" },
  bottom: { left: 0, right: 0, bottom: 0, maxHeight: "85vh" },
};

/** Off-canvas transform per side (start of the slide-in transition). */
const SIDE_HIDDEN_TRANSFORM: Record<SheetSide, string> = {
  left: "translateX(-100%)",
  right: "translateX(100%)",
  bottom: "translateY(100%)",
};

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Edge the sheet slides in from. Default: "right". */
  side?: SheetSide;
  /** Render the built-in top-right close button. Default: true. */
  showClose?: boolean;
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = "right", showClose = true, className, style, children, ...props }, ref) => {
  // Enter transition: the content mounts off-canvas, then slides in on the
  // next frame (200ms). Radix unmounts the content on close, so the state
  // resets for each open. Kept as a rAF toggle (no keyframe classes) so the
  // animation never depends on the consumer's Tailwind content scan.
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-side={side}
        style={{
          position: "fixed",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          ...SIDE_BASE[side],
          transform: entered ? "none" : SIDE_HIDDEN_TRANSFORM[side],
          transition: "transform 200ms ease-out",
          ...style,
        }}
        className={cn("border bg-background shadow-lg", className)}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            // 44×44 inline hit area: touch-target compliant regardless of the
            // consumer's Tailwind scan (pointer-coarse utilities may not be
            // generated for package-only classes).
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none cursor-pointer"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = "SheetContent";

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-left", className)}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
