import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { MobileTabBar, DesktopSidebar, NAV_ITEMS } from "./app-nav";

/**
 * The nav lives behind auth, so E2E cannot reach it signed out. These tests
 * cover what E2E would have: every destination is present, and the active route
 * is announced to assistive tech rather than only shown by colour.
 */

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn(() => "/dashboard") }));

vi.mock("next/navigation", () => ({ usePathname }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  usePathname.mockReturnValue("/dashboard");
});

describe("MobileTabBar", () => {
  it("renders every primary destination", () => {
    render(<MobileTabBar />);
    const nav = screen.getByRole("navigation", { name: "Primary" });

    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.href,
      );
    }
  });

  it("marks the current route with aria-current", () => {
    render(<MobileTabBar />);
    const nav = screen.getByRole("navigation", { name: "Primary" });

    expect(within(nav).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Upload" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("treats a nested route as inside its section", () => {
    // /transactions?document=… and /transactions/123 must both light Activity.
    usePathname.mockReturnValue("/transactions/abc");
    render(<MobileTabBar />);

    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not mark a sibling route whose path merely shares a prefix", () => {
    usePathname.mockReturnValue("/settings-export");
    render(<MobileTabBar />);

    expect(
      screen.getByRole("link", { name: "Settings" }),
    ).not.toHaveAttribute("aria-current");
  });
});

describe("DesktopSidebar", () => {
  it("offers the same destinations as the mobile bar", () => {
    render(<DesktopSidebar />);
    const nav = screen.getByRole("navigation", { name: "Primary" });

    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(hrefs).toEqual(NAV_ITEMS.map((item) => item.href));
  });
});
