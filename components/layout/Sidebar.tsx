"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  DollarSign,
  RefreshCw,
  FileText,
  Users,
  Store,
  Calendar,
  Table,
  Wrench,
  History,
  Calculator,
  SlidersHorizontal,
  User,
} from "lucide-react"

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Unassigned Events", href: "/residuals/unassigned", icon: FileText },
  {
    name: "Payouts",
    href: "/residuals/payouts",
    icon: DollarSign,
    children: [
      { name: "By Participant", href: "/residuals/payouts/by-participant", icon: Users },
      { name: "By Merchant", href: "/residuals/payouts/by-merchant", icon: Store },
      { name: "By Month", href: "/residuals/payouts/by-month", icon: Calendar },
      { name: "Detailed View", href: "/residuals/payouts/detailed", icon: Table },
    ],
  },
  {
    name: "Tools",
    href: "/tools",
    icon: Wrench,
    children: [
      { name: "History & Logs", href: "/tools/history", icon: History },
      { name: "Calculator", href: "/tools/calculator", icon: Calculator },
      { name: "Adjustments", href: "/tools/adjustments", icon: SlidersHorizontal },
      { name: "Airtable Sync", href: "/residuals/sync", icon: RefreshCw },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card text-card-foreground">
      <div className="p-6">
        <h1 className="text-xl font-bold tracking-tight">Residuals Engine</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <nav className="space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href))
            const hasChildren = "children" in item && item.children

            return (
              <div key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive && !hasChildren
                      ? "bg-primary text-primary-foreground"
                      : isActive && hasChildren
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>

                {hasChildren && (
                  <div className="ml-4 mt-1 space-y-1">
                    {item.children.map((child, index) => {
                      const isChildActive = pathname === child.href
                      const isLastChild = index === item.children.length - 1

                      return (
                        <Link
                          key={child.name}
                          href={child.href}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors relative",
                            isChildActive
                              ? "bg-slate-200 text-slate-900 font-medium dark:bg-slate-700 dark:text-slate-100"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span className="text-muted-foreground/50 text-xs font-mono">{isLastChild ? "└" : "├"}</span>
                          <child.icon className="h-3.5 w-3.5" />
                          {child.name}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </div>
      <div className="p-4 border-t">
        <div className="flex items-center gap-3 px-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
              <User className="h-4 w-4 text-primary" />
            </div>
            <span className="text-xs text-muted-foreground">Dev Mode</span>
          </div>
        </div>
      </div>
    </div>
  )
}
