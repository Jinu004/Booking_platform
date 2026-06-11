import { Navigate, Outlet } from 'react-router-dom'
import { getStoredStaff } from '../../services/auth.service'

export default function RoleRoute({ allowedRoles }) {
  const staff = getStoredStaff()
  if (!staff || !allowedRoles.includes(staff.role)) {
    return <Navigate to="/dashboard" replace />
  }
  return <Outlet />
}
