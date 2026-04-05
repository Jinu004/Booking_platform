import { create } from 'zustand';

const useStore = create((set, get) => ({
  // AUTH SLICE
  staff: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: false,
  permissions: [],

  setStaff: (staff) => set({ staff, isAuthenticated: true }),
  setTenant: (tenant) => set({ tenant }),
  setPermissions: (permissions) => set({ permissions }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => {
    localStorage.removeItem('auth_token');
    set({ staff: null, tenant: null, permissions: [], isAuthenticated: false });
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

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen }))
}));

export default useStore;
