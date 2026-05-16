import api from '../utils/api'
import { STORAGE_KEYS } from '../constants'

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
}

export function isAuthenticated() {
  return !!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)
}
