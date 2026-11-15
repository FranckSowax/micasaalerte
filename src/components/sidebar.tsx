"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Users,
  MessageSquare,
  Settings,
  LogOut,
  Menu,
  X,
  Database,
  UserCircle,
  Users2,
  UserCheck,
  Video,
  Map as MapIcon,
  ClipboardCheck,
  Wallet,
  Send,
  Flag,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/annonces", label: "Annonces", icon: Building2 },
  { href: "/carte", label: "Carte", icon: MapIcon },
  { href: "/groupes", label: "Groupes FB", icon: Users },
  { href: "/agents", label: "Agents immo", icon: UserCircle },
  { href: "/contributeurs", label: "Contributeurs", icon: UserCheck },
  { href: "/tiktok", label: "TikTok", icon: Video },
  { href: "/groupes/raw-posts", label: "Données brutes", icon: Database },
  { href: "/clients", label: "Clients", icon: Users2 },
  { href: "/paiements", label: "Paiements", icon: Wallet },
  { href: "/verifications", label: "À vérifier", icon: ClipboardCheck },
  { href: "/envois", label: "Envois", icon: Send },
  { href: "/avis", label: "Avis clients", icon: Flag },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageSquare },
  { href: "/settings", label: "Paramètres", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Paiements déclarés en attente de vérification : affichés à côté de « Paiements ».
  const [pendingPayments, setPendingPayments] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("subscription_payments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => {
        if (!cancelled) setPendingPayments(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
    // Recompté à chaque changement de page, par exemple après une validation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2 px-6 py-5 border-b border-border">
        <BrandLogo className="h-10 w-auto" priority />
      </div>

      {/* Défilement interne : sur un petit écran, le bouton Déconnexion reste visible en bas. */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="flex-1">{item.label}</span>
              {item.href === "/paiements" && pendingPayments > 0 && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-black" aria-label={`${pendingPayments} paiement${pendingPayments > 1 ? "s" : ""} à vérifier`}>
                  {pendingPayments}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground w-full transition-colors"
        >
          <LogOut className="h-5 w-5" />
          Déconnexion
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 lg:hidden"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-screen w-64 bg-card border-r border-border flex flex-col transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
