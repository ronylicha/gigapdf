"use client";

import { useSession, signOut } from "@/lib/auth-client";
import { useTranslations } from "next-intl";
import { Button } from "@giga-pdf/ui";
import { FileText, Home, Settings, CreditCard, LogOut, Menu, Building2, Share2, Code2, Trash2, ScanSearch, Combine } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeSwitcher } from "@/components/theme-switcher";

// Auth par cookies + locale par cookie → rendu dynamique obligatoire.
// Explicite depuis le retrait du force-dynamic global du root layout.
export const dynamic = "force-dynamic";

export default function DashboardLayout(props: { children?: React.ReactNode }) {
  const { children } = props;
  const t = useTranslations("nav");
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navItems = [
    { name: t("dashboard"), href: "/dashboard", icon: Home },
    { name: t("documents"), href: "/documents", icon: FileText },
    { name: t("universalMerge"), href: "/merge", icon: Combine },
    { name: t("semanticSearch"), href: "/search", icon: ScanSearch },
    { name: t("sharedWithMe"), href: "/shared", icon: Share2 },
    { name: t("trash"), href: "/trash", icon: Trash2 },
    { name: t("organization"), href: "/organization", icon: Building2 },
    { name: t("settings"), href: "/settings", icon: Settings },
    { name: t("developers"), href: "/developers", icon: Code2 },
    { name: t("billing"), href: "/billing", icon: CreditCard },
  ];

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-64 transform border-r bg-background transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex h-16 items-center border-b px-6">
            <Logo href="/dashboard" size="sm" />
          </div>
          <nav className="space-y-1 p-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <div className="flex flex-1 flex-col">
          {/* Header */}
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background px-6">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <Menu className="h-6 w-6" />
            </Button>
            <div className="flex items-center gap-4 ml-auto">
              <NotificationBell />
              <ThemeSwitcher />
              <LanguageSwitcher />
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="text-sm font-medium">{session?.user?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {session?.user?.email}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={handleSignOut} title={t("signOut")}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 p-6">{children}</main>
        </div>

        {/* Overlay for mobile sidebar */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </div>
    </AuthGuard>
  );
}
