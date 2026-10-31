import api from '../utils/api'
import { STORAGE_KEYS } from '../constants'
import useStore from '../store/useStore'

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
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN)
    localStorage.removeItem(STORAGE_KEYS.STAFF_DATA)
    localStorage.removeItem('tenant_data') // the clinic name of this login must not stay for the next one
    useStore.getState().logout() // the store's own reset: staff, tenant and permissions go back to empty (used only when this runs, so the import cycle is harmless)
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
  return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)
}

export function getStoredStaff() {
  const data = localStorage.getItem(STORAGE_KEYS.STAFF_DATA)
  return data ? JSON.parse(data) : null
}

export function storeAuthData(token, staff) {
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token)
  localStorage.setItem(STORAGE_KEYS.STAFF_DATA, JSON.stringify(staff)
  )
  localStorage.removeItem('tenant_data') // a new login never inherits the clinic of an earlier one (the callers also reset the store)
}

export function isAuthenticated() {
  return !!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)
}
