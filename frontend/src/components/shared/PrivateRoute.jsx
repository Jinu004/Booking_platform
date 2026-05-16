import { Navigate, Outlet } from 'react-router-dom'
import { isAuthenticated, getStoredStaff } from '../../services/auth.service'

export default function PrivateRoute() {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }

  const staff = getStoredStaff()
  if (staff?.tenantStatus === 'pending') {
    return <Navigate to="/pending" replace />
  }

  return <Outlet />
}
