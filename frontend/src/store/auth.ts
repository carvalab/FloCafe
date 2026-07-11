import { create } from 'zustand';
import api from '@/lib/api';
import type { User, Tenant } from '@/lib/types';

interface AuthState {
  user: User | null;
  token: string | null;
  tenants: Tenant[];
  currentTenant: Tenant | null;
  loading: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  selectTenant: (tenantId: number) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
  updateCurrentTenant: (updates: Partial<Tenant>) => void;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  business_name: string;
  business_type: string;
  country: string;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  tenants: [],
  currentTenant: null,
  loading: true,

  login: async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.access_token);
    set({
      user: data.user,
      token: data.access_token,
      tenants: data.tenants,
    });
  },

  register: async (registerData: RegisterData) => {
    const { data } = await api.post('/auth/register', registerData);
    localStorage.setItem('token', data.access_token);
    set({
      user: data.user,
      token: data.access_token,
      tenants: [data.tenant],
    });
  },

  selectTenant: async (tenantId: number) => {
    const { data } = await api.post('/auth/tenants/select', { tenant_id: tenantId });
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('tenant', JSON.stringify(data.tenant));
    set({
      token: data.access_token,
      currentTenant: data.tenant,
    });
  },

  logout: () => {
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('tenant');
    set({ user: null, token: null, tenants: [], currentTenant: null });
  },

  updateCurrentTenant: (updates) => {
    set((state) => {
      if (!state.currentTenant) return state;
      const updated = { ...state.currentTenant, ...updates };
      localStorage.setItem('tenant', JSON.stringify(updated));
      return { currentTenant: updated };
    });
  },

  loadFromStorage: () => {
    if (typeof window === 'undefined') {
      set({ loading: false });
      return;
    }
    const token = localStorage.getItem('token');
    const tenantStr = localStorage.getItem('tenant');
    const currentTenant = tenantStr ? JSON.parse(tenantStr) : null;

    if (token) {
      // Fetch user data
      api.get('/auth/me')
        .then(({ data }) => {
          set({
            user: data.user,
            token,
            tenants: data.tenants,
            currentTenant,
            loading: false,
          });
        })
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('tenant');
          set({ loading: false });
        });
    } else {
      set({ loading: false });
    }
  },
}));
