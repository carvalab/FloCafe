'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  Package,
  Grid3X3,
  Users,
  UserCog,
  Settings,
  LogOut,
  PanelLeft,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import { getLandingPage } from '@/components/layout/AuthGuard';
import api from '@/lib/api';
import { useI18n } from '@/hooks/useI18n';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

// null = show for all business types
const ALL_NAV_ITEMS = [
  { href: '/pos', key: 'nav.pos', icon: ShoppingCart, roles: ['owner', 'manager', 'cashier'], businessTypes: null },
  { href: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard, roles: ['owner'], businessTypes: null },
  { href: '/orders', key: 'nav.orders', icon: ClipboardList, roles: ['owner', 'manager', 'cashier'], businessTypes: null },
  { href: '/products', key: 'nav.products', icon: Package, roles: ['owner', 'manager'], businessTypes: null },
  { href: '/tables', key: 'nav.tables', icon: Grid3X3, roles: ['owner', 'manager'], businessTypes: ['restaurant'] },
  { href: '/customers', key: 'nav.customers', icon: Users, roles: ['owner', 'manager'], businessTypes: null },
  { href: '/staff', key: 'nav.staff', icon: UserCog, roles: ['owner', 'manager'], businessTypes: null },
  { href: '/settings', key: 'nav.settings', icon: Settings, roles: ['owner', 'manager'], businessTypes: null },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const { currentTenant, logout } = useAuthStore();
  const { tablesRequired, setTablesRequired } = usePosSettingsStore();
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const { t } = useI18n();
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };

  const role = currentTenant?.role || 'cashier';
  const businessType = currentTenant?.business_type || 'restaurant';
  const navItems = ALL_NAV_ITEMS.filter((item) => {
    if (item.href === '/tables' && !tablesRequired) return false;
    return item.roles.includes(role)
      && (item.businessTypes === null || item.businessTypes.includes(businessType));
  });
  const homeHref = getLandingPage();

  useEffect(() => {
    if (!currentTenant) return;
    api.get('/settings/business')
      .then((res) => {
        setTablesRequired(typeof res.data.tables_required === 'boolean' ? res.data.tables_required : true);
      })
      .catch(() => { });
  }, [currentTenant, setTablesRequired]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={homeHref}>
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-sidebar overflow-hidden">
                  { }
                  <img src="/logo.png" alt="Flo Cafe" className="w-6 h-6 object-contain" />
                </div>
                <div className="flex flex-col gap-0.5 min-w-0 leading-none">
                  <span className="font-semibold truncate">Flo Cafe</span>
                  {currentTenant && (
                    <span className="text-xs text-muted-foreground truncate">
                      {currentTenant.business_name}
                    </span>
                  )}
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                const label = t(item.key);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
                      <Link href={item.href} onClick={closeMobile}>
                        <item.icon />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleSidebar} tooltip="Toggle sidebar">
              <PanelLeft />
              <span>Collapse</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout} tooltip="Logout">
              <LogOut />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
