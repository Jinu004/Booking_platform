import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import useStore from '../../store/useStore';
import Spinner from './Spinner';

const PrivateRoute = () => {
  const { isAuthenticated, isLoading } = useStore();

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <Spinner size="lg" color="blue" />
      </div>
    );
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

export default PrivateRoute;
