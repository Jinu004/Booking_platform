import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Input from '../components/shared/Input';
import Select from '../components/shared/Select';
import Button from '../components/shared/Button';
import useStore from '../store/useStore';
import { createTenant } from '../services/tenant.service';

const Onboarding = () => {
  const navigate = useNavigate();
  const { addToast, setTenant } = useStore();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    name: '',
    industry: '',
    whatsappNumber: '',
    plan: ''
  });

  const industries = [
    { value: 'clinic', label: 'Clinic / Hospital' },
    { value: 'service_centre', label: 'Car / Bike Service Centre' },
    { value: 'salon', label: 'Salon / Spa' },
    { value: 'diagnostic_lab', label: 'Diagnostic Lab' },
    { value: 'coaching', label: 'Coaching Centre' },
    { value: 'hotel', label: 'Hotel / Homestay' }
  ];

  const plans = [
    { value: 'starter', label: 'Starter — ₹2,999/month' },
    { value: 'growth', label: 'Growth — ₹5,999/month' },
    { value: 'pro', label: 'Pro — ₹9,999/month' }
  ];

  const handleChange = (e) => {
    let { name, value } = e.target;
    
    if (name === 'whatsappNumber') {
      value = value.replace(/\D/g, '').slice(0, 10);
    }

    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear validation error if user types
    if (errors[name]) {
      setErrors(prev => {
        const newErrs = { ...prev };
        delete newErrs[name];
        return newErrs;
      });
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim() || formData.name.length < 2) newErrors.name = 'Clinic name is required (min 2 chars)';
    if (!formData.industry) newErrors.industry = 'Industry is required';
    if (formData.whatsappNumber.length !== 10) newErrors.whatsappNumber = 'Must be exactly 10 digits';
    if (!formData.plan) newErrors.plan = 'Plan is required';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    
    setLoading(true);
    try {
      const data = await createTenant(formData);
      
      addToast('Clinic created successfully', 'success');
      setTenant(data);
      
      // Mock login until Auth module integration
      useStore.getState().setStaff({ name: 'Admin User', role: 'super_admin' });
      navigate('/dashboard');
    } catch (err) {
      if (err?.error) {
        addToast(err.error, 'error');
      } else {
        addToast('Failed to create clinic', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h2 className="text-3xl font-extrabold text-gray-900">
          Booking Platform
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Set up your clinic in minutes
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl sm:rounded-lg sm:px-10 border border-gray-100">
          <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            <Input
              label="Clinic Name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              error={errors.name}
              placeholder="e.g. Apollo Medical Centre"
              required
            />
            
            <Select
              label="Industry"
              name="industry"
              value={formData.industry}
              onChange={handleChange}
              options={industries}
              error={errors.industry}
              placeholder="Select an industry"
              required
            />

            <div className="relative">
              <Input
                label="WhatsApp Number"
                name="whatsappNumber"
                type="tel"
                value={formData.whatsappNumber}
                onChange={handleChange}
                error={errors.whatsappNumber}
                hint="10 digit Indian mobile number"
                placeholder="9876543210"
                required
              />
              <div className="absolute top-[34px] left-3 flex items-center bg-transparent pointer-events-none text-gray-500">
                +91
              </div>
              <style>{`input[name="whatsappNumber"] { padding-left: 2.5rem; }`}</style>
            </div>

            <Select
              label="Plan"
              name="plan"
              value={formData.plan}
              onChange={handleChange}
              options={plans}
              error={errors.plan}
              placeholder="Select a plan"
              required
            />

            <div className="pt-2">
              <Button type="submit" fullWidth loading={loading} size="lg">
                Create Clinic Account
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
