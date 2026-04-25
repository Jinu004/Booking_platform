import { Navigate, Outlet } from 'react-router-dom'
import { isAuthenticated } from '../../services/auth.service'

export default function PrivateRoute() {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
