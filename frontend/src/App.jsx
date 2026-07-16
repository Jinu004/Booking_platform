import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Toast from './components/shared/Toast';
import Layout from './components/shared/Layout';
import PrivateRoute from './components/shared/PrivateRoute';
import RoleRoute from './components/shared/RoleRoute';
import { useIndustry } from './hooks/useIndustry';

const Dashboard      = React.lazy(() => import('./pages/Dashboard'));
const Bookings       = React.lazy(() => import('./pages/Bookings'));
const Patients       = React.lazy(() => import('./pages/Patients'));
const Doctors        = React.lazy(() => import('./pages/Doctors'));
const Conversations  = React.lazy(() => import('./pages/Conversations'));
const Analytics      = React.lazy(() => import('./pages/Analytics'));
const TokenQueue     = React.lazy(() => import('./pages/TokenQueue'));
const Settings       = React.lazy(() => import('./pages/Settings'));
const Login          = React.lazy(() => import('./pages/Login'));
const Staff          = React.lazy(() => import('./pages/Staff'));
const Onboarding     = React.lazy(() => import('./pages/Onboarding'));
const ResetPassword  = React.lazy(() => import('./pages/ResetPassword'));
const NotFound       = React.lazy(() => import('./pages/NotFound'));
const SuperAdmin          = React.lazy(() => import('./pages/SuperAdmin'));
const PricingCalculator   = React.lazy(() => import('./pages/superadmin/PricingCalculator'));
const EnquiryDashboard    = React.lazy(() => import('./pages/enquiry/EnquiryDashboard'));
const Catalogue           = React.lazy(() => import('./pages/enquiry/Catalogue'));
const Leads               = React.lazy(() => import('./pages/enquiry/Leads'));
const Landing        = React.lazy(() => import('./pages/Landing'));
const PendingApproval = React.lazy(() => import('./pages/PendingApproval'));
const PatientProfile = React.lazy(() => import('./pages/PatientProfile'));

const PageLoader = (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
  </div>
);

// Picks clinic or enquiry dashboard based on tenant industry
function DashboardWrapper() {
  const { industry } = useIndustry();
  return industry === 'enquiry' ? <EnquiryDashboard /> : <Dashboard />;
}

const App = () => {
  return (
    <BrowserRouter>
      <Toast />
      <Suspense fallback={PageLoader}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/pending" element={<PendingApproval />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<Landing />} />

          <Route element={<PrivateRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<DashboardWrapper />} />
              <Route path="/bookings" element={<Bookings />} />
              <Route path="/patients" element={<Patients />} />
              <Route path="/patients/:customerId" element={<PatientProfile />} />
              <Route path="/doctors" element={<Doctors />} />
              <Route path="/queue" element={<TokenQueue />} />
              <Route path="/staff" element={<Staff />} />
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/leads" element={<Leads />} />
              <Route element={<RoleRoute allowedRoles={['super_admin']} />}>
                <Route path="/superadmin" element={<SuperAdmin />} />
                <Route path="/superadmin/pricing-calculator" element={<PricingCalculator />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
