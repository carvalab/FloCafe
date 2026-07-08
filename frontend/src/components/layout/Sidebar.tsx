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
  { href: '/pos', label: 'POS', icon: ShoppingCart, roles: ['owner', 'manager', 'cashier'], businessTypes: null },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner', 'manager', 'cashier'], businessTypes: null },
  { href: '/orders', label: 'Orders', icon: ClipboardList, roles: ['owner', 'manager', 'cashier'], businessTypes: null },
  { href: '/products', label: 'Products', icon: Package, roles: ['owner', 'manager'], businessTypes: null },
  { href: '/tables', label: 'Tables', icon: Grid3X3, roles: ['owner', 'manager'], businessTypes: ['restaurant'] },
  { href: '/customers', label: 'Customers', icon: Users, roles: ['owner', 'manager'], businessTypes: null },
  { href: '/staff', label: 'Staff', icon: UserCog, roles: ['owner', 'manager'], businessTypes: null },
  { href: '/settings', label: 'Settings', icon: Settings, roles: ['owner', 'manager'], businessTypes: null },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const { currentTenant, logout } = useAuthStore();
  const { tablesRequired, setTablesRequired } = usePosSettingsStore();
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };

  const role = currentTenant?.role || 'cashier';
  const businessType = currentTenant?.business_type || 'restaurant';
  const navItems = ALL_NAV_ITEMS.filter((item) => {
    if (item.href === '/tables' && !tablesRequired) return false;
    return item.roles.includes(role)
      && (item.businessTypes === null || item.businessTypes.includes(businessType));
  });
  const homeHref = getLandingPage(role, businessType);

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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
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
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                      <Link href={item.href} onClick={closeMobile}>
                        <item.icon />
                        <span>{item.label}</span>
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
