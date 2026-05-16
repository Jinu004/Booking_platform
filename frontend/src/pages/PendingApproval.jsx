import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../utils/api'

export default function PendingApproval() {
  const navigate = useNavigate()

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const data = await api.get('/auth/me')
        if (data?.data?.tenant?.status === 'active') {
          const staff = JSON.parse(localStorage.getItem('staff_data') || '{}')
          staff.tenantStatus = 'active'
          localStorage.setItem('staff_data', JSON.stringify(staff))
          navigate('/dashboard')
        }
      } catch { }
    }
    checkStatus()
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('staff_data')
    navigate('/login')
  }
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-10 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-yellow-50 rounded-full flex items-center justify-center">
            <svg className="w-10 h-10 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Account Pending Approval</h1>
        <p className="text-gray-500 text-sm mb-6">
          Your clinic account is currently under review. We'll activate it shortly and notify you once it's ready.
        </p>

        <div className="bg-slate-50 rounded-xl p-4 text-left mb-8 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-green-500 mt-0.5">✓</span>
            <span className="text-sm text-gray-600">Account registered successfully</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-yellow-500 mt-0.5">○</span>
            <span className="text-sm text-gray-600">Awaiting admin verification</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-gray-300 mt-0.5">○</span>
            <span className="text-sm text-gray-400">WhatsApp number assignment</span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-gray-300 mt-0.5">○</span>
            <span className="text-sm text-gray-400">Account activation</span>
          </div>
        </div>

        <p className="text-xs text-gray-400 mb-6">
          Need help? Contact us at{' '}
          <a href="mailto:support@receptionai.in" className="text-teal-600 hover:underline">
            support@receptionai.in
          </a>
        </p>

        <button
          onClick={handleLogout}
          className="w-full py-2.5 px-4 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Sign out
        </button>
      </div>

      <p className="text-slate-500 text-xs mt-6">ReceptionAI · Powered by AI</p>
    </div>
  )
}
