import api from '../utils/api'

export async function login(email, password) {
  return api.post('/auth/login', {
    email,
    password
  })
}

export async function logout() {
  try {
    await api.post('/auth/logout')
  } finally {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('staff_data')
  }
}

export async function getMe() {
  return api.get('/auth/me')
}

export async function forgotPassword(email) {
  return api.post('/auth/forgot-password',
    { email })
}

export async function resetPassword(
  token, password
) {
  return api.post('/auth/reset-password',
    { token, password })
}

export function getStoredToken() {
  return localStorage.getItem('auth_token')
}

export function getStoredStaff() {
  const data = localStorage.getItem('staff_data')
  return data ? JSON.parse(data) : null
}

export function storeAuthData(token, staff) {
  localStorage.setItem('auth_token', token)
  localStorage.setItem(
    'staff_data', JSON.stringify(staff)
  )
}

export function isAuthenticated() {
  return !!localStorage.getItem('auth_token')
}
