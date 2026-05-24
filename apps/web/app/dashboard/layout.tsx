import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Übersicht" },
  { href: "/dashboard/roster", label: "Roster" },
  { href: "/dashboard/raids", label: "Raids" },
  { href: "/dashboard/dkp", label: "DKP" },
  { href: "/dashboard/stats", label: "Statistiken" },
  { href: "/dashboard/compare", label: "Vergleich" },
  { href: "/dashboard/settings", label: "Einstellungen" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-zinc-900 border-r border-zinc-800 flex flex-col shrink-0">
        <div className="p-4 border-b border-zinc-800">
          <p className="font-bold text-zinc-100">Luna Wolves</p>
          <p className="text-xs text-zinc-500">Guild Companion</p>
        </div>
        <nav className="p-3 flex flex-col gap-1 flex-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-zinc-300 hover:text-white hover:bg-zinc-800 px-3 py-2 rounded-md text-sm transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-zinc-800">
          <a
            href="/auth/logout"
            className="text-zinc-500 hover:text-zinc-300 text-sm px-3 py-2 block transition-colors rounded-md"
          >
            Abmelden
          </a>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
