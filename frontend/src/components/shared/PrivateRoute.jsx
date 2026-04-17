import { Navigate, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LoadingScreen from './LoadingScreen'

export default function PrivateRoute({ children }) {
  const [ready, setReady] = useState(false)
  const bypassAuth = import.meta.env.VITE_BYPASS_AUTH === 'true'

  useEffect(() => {
    if (bypassAuth) {
      setReady(true)
      return
    }
    // Production Clerk auth check here
    setReady(true)
  }, [])

  if (!ready) return <LoadingScreen />

  return children ? children : <Outlet />
}
