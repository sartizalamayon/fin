import { MobileTabBar, DesktopSidebar } from "@/components/nav/app-nav";

/**
 * Shell for every signed-in screen.
 *
 * Mobile is the primary target: content scrolls under a fixed bottom tab bar,
 * so the main region reserves bottom padding equal to the bar plus the device
 * safe area. Desktop swaps the bar for a side rail.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh w-full">
      <DesktopSidebar />
      <main className="min-w-0 flex-1">
        <div
          className="mx-auto w-full max-w-3xl px-4 pt-4 md:px-8 md:pt-8"
          style={{
            paddingBottom: "calc(5rem + env(safe-area-inset-bottom))",
          }}
        >
          {children}
        </div>
      </main>
      <MobileTabBar />
    </div>
  );
}
