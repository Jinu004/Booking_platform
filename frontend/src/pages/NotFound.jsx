import React from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/shared/Button';

const NotFound = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center py-12 sm:px-6 lg:px-8">
      <h1 className="text-9xl font-extrabold text-gray-200 tracking-widest">404</h1>
      <div className="bg-blue-600 px-2 text-sm text-white rounded rotate-12 absolute">
        Page Not Found
      </div>
      <div className="mt-8 text-center relative z-10">
        <p className="text-gray-500 mb-6">Oops! The page you're looking for doesn't exist.</p>
        <Link to="/dashboard">
          <Button variant="primary">Return to Dashboard</Button>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
