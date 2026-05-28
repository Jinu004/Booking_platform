import { useMemo } from 'react';
import useStore from '../store/useStore';
import { getIndustryConfig } from '../config/industryConfig';

export function useIndustry() {
  const tenant = useStore((state) => state.tenant);
  const industry = tenant?.industry || 'clinic';
  return useMemo(() => ({
    industry,
    ...getIndustryConfig(industry)
  }), [industry]);
}
