import { create } from 'zustand';
import { getStoredStaff } from '../services/auth.service';

const getStoredTenant = () => {
  try {
    const t = localStorage.getItem('tenant_data');
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
};

const useStore = create((set, get) => ({
  // AUTH SLICE
  staff: getStoredStaff() || null,
  tenant: getStoredTenant() || null,
  isAuthenticated: !!getStoredStaff(),
  isLoading: false,
  permissions: [],

  setStaff: (staff) => set({ staff, isAuthenticated: true }),
  setTenant: (tenant) => {
    try { localStorage.setItem('tenant_data', JSON.stringify(tenant)); } catch {}
    set({ tenant });
  },
  setPermissions: (permissions) => set({ permissions }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('staff_data');
    localStorage.removeItem('tenant_data');
    set({ staff: null, tenant: null, permissions: [], isAuthenticated: false });
  },
  clearAuth: () => {
    set({ staff: null, isAuthenticated: false });
    localStorage.removeItem('auth_token');
    localStorage.removeItem('staff_data');
    localStorage.removeItem('tenant_data');
  },
  hasPermission: (permission) => {
    const { permissions, staff } = get();
    if (staff?.role === 'super_admin') return true;
    return permissions.includes(permission);
  },

  // UI SLICE
  toasts: [],
  sidebarOpen: true,

  addToast: (message, type = 'info') => {
    const id = Date.now().toString() + Math.random().toString(36).substring(7);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, createdAt: Date.now() }]
    }));
    setTimeout(() => {
      get().removeToast(id);
    }, 3000);
  },

  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter(t => t.id !== id)
  })),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  pendingHandoffs: 0,
  incrementHandoffs: () => set((state) => ({ pendingHandoffs: state.pendingHandoffs + 1 })),
  clearHandoffs: () => set({ pendingHandoffs: 0 })
}));

export default useStore;
