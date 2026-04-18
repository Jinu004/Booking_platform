import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Toast from './components/shared/Toast';
import Layout from './components/shared/Layout';
import PrivateRoute from './components/shared/PrivateRoute';

import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Patients from './pages/Patients';
import Doctors from './pages/Doctors';
import Conversations from './pages/Conversations';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Staff from './pages/Staff';
import Onboarding from './pages/Onboarding';
import NotFound from './pages/NotFound';
import SuperAdmin from './pages/SuperAdmin';

const App = () => {
  return (
    <BrowserRouter>
      <Toast />
      
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />

        <Route path="/" element={<PrivateRoute />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="patients" element={<Patients />} />
            <Route path="doctors" element={<Doctors />} />
            <Route path="staff" element={<Staff />} />
            <Route path="conversations" element={<Conversations />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="settings" element={<Settings />} />
            <Route path="superadmin" element={<SuperAdmin />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
