"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Upload, Receipt, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Activity", icon: Receipt },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function useIsActive(href: string) {
  const pathname = usePathname();
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  label,
  icon: Icon,
  variant,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  variant: "tab" | "rail";
}) {
  const active = useIsActive(href);

  if (variant === "tab") {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        // min-h-14 keeps every tab target comfortably above the 44px floor.
        className={cn(
          "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors",
          active
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden />
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

/** Phone: fixed bottom tab bar, sitting above the home indicator. */
export function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-sm md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-lg items-stretch gap-1 px-2 py-1">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} variant="tab" />
        ))}
      </div>
    </nav>
  );
}

/** Desktop: the same destinations as a persistent side rail. */
export function DesktopSidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r md:block">
      <div className="sticky top-0 flex h-dvh flex-col gap-6 p-4">
        <Link href="/dashboard" className="px-3 text-lg font-semibold tracking-tight">
          fin.
        </Link>
        <nav aria-label="Primary" className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} {...item} variant="rail" />
          ))}
        </nav>
      </div>
    </aside>
  );
}
