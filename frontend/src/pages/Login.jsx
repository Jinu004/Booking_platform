import React from 'react';
import { SignIn } from "@clerk/clerk-react";

export default function Login() {
  return (
    <div className="flex justify-center items-center min-h-screen">
      <SignIn />
    </div>
  );
}
