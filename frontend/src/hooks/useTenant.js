import { useState, useEffect } from 'react';
import useStore from '../store/useStore';
import { getTenantConfigs, updateTenantConfig, getTenantById } from '../services/tenant.service';

const useTenant = () => {
  const { tenant, setTenant, addToast } = useStore();
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadConfigs = async (tenantId) => {
    setLoading(true);
    try {
      const dbConfigs = await getTenantConfigs(tenantId);
      setConfigs(dbConfigs || {});
      setError(null);
    } catch (err) {
      setError(err?.error || 'Failed to load configurations');
      addToast(err?.error || 'Failed to load configurations', 'error');
    } finally {
      setLoading(false);
    }
  };

  const refreshTenant = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    try {
      const t = await getTenantById(tenant.id);
      if (t) setTenant(t);
      await loadConfigs(tenant.id);
      setError(null);
    } catch (err) {
      setError(err?.error || 'Failed to refresh tenant');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenant?.id) {
      loadConfigs(tenant.id);
    }
  }, [tenant?.id]);

  const updateConfig = async (key, value) => {
    if (!tenant?.id) {
      addToast('No tenant selected', 'error');
      return false;
    }
    
    try {
      await updateTenantConfig(tenant.id, key, String(value));
      await loadConfigs(tenant.id);
      return true;
    } catch (err) {
      addToast(err?.error || `Failed to update ${key}`, 'error');
      return false;
    }
  };

  return {
    tenant,
    configs,
    loading,
    error,
    updateConfig,
    refreshTenant
  };
};

export default useTenant;
