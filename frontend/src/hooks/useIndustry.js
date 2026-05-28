import { useMemo } from 'react';
import useStore from '../store/useStore';
import { getIndustryConfig } from '../config/industryConfig';
import { getStoredStaff } from '../services/auth.service';

export function useIndustry() {
  const tenant = useStore((state) => state.tenant);
  const industry = tenant?.industry || getStoredStaff()?.tenantIndustry || 'clinic';
  return useMemo(() => ({
    industry,
    ...getIndustryConfig(industry)
  }), [industry]);
}
