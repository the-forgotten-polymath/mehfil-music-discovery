"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

/**
 * The breadcrumb and the two tabs, in one control.
 *
 * They are real routes rather than a tab state, so either half of this page is
 * linkable and each gets its own title. The trail on the left says where you
 * are; the pair on the right is how you cross.
 */
const TABS = [
  { href: "/curious/design", label: "Design system" },
  { href: "/curious/architecture", label: "Architecture" },
] as const;

export function CuriousTabs() {
  const pathname = usePathname();
  const current = TABS.find((tab) => tab.href === pathname);

  return (
    <div className="pb-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/" className="transition hover:text-foreground">
          Mehfil
        </Link>
        <ChevronRight aria-hidden className="size-3 opacity-50" />
        <span>For the curious</span>
        {current && (
          <>
            <ChevronRight aria-hidden className="size-3 opacity-50" />
            <span className="text-foreground">{current.label}</span>
          </>
        )}
      </nav>

      <div className="mt-4 flex gap-1 border-b border-white/[0.07]">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              // The underline sits on the tab rather than under the row, so the
              // active one interrupts the divider instead of floating above it.
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
