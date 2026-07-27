import { cn } from "@/lib/utils";

/**
 * Bottom action bar.
 *
 * On a phone the primary action belongs under the thumb, not at the top of a
 * scrolled page, so this sticks to the bottom of the viewport. Inside the app
 * shell it has to clear the fixed tab bar (56px row + 8px padding) and the home
 * indicator, hence the calc offset. On desktop it relaxes back into the flow.
 */
export function ThumbZone({
  className,
  aboveTabBar = true,
  children,
}: {
  className?: string;
  /** False on standalone screens like onboarding, which have no tab bar. */
  aboveTabBar?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="thumb-zone"
      className={cn(
        "sticky z-30 -mx-4 mt-6 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur",
        "md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none",
        className,
      )}
      style={{
        bottom: aboveTabBar
          ? "calc(4rem + env(safe-area-inset-bottom))"
          : "env(safe-area-inset-bottom)",
      }}
    >
      {children}
    </div>
  );
}
