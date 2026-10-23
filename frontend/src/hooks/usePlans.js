import { useEffect, useState } from 'react';
import api from '../utils/api';

const FALLBACK = ['starter', 'growth', 'pro'];
let cache = null;

// Plan ids for super admin selects, from the plans table (falls back to the built-in ids while loading)
export function usePlanIds() {
  const [ids, setIds] = useState(cache || FALLBACK);
  useEffect(() => {
    if (cache) return;
    api.get('/superadmin/billing/plans')
      .then(res => { cache = res.data.map(p => p.id); setIds(cache); })
      .catch(() => {});
  }, []);
  return ids;
}
