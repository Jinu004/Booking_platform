import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Input from '../components/shared/Input';
import Select from '../components/shared/Select';
import useStore from '../store/useStore';
import api from '../utils/api';
import { storeAuthData } from '../services/auth.service';

const toTitleCase = (str) => str.replace(/\b\w/g, c => c.toUpperCase());

const Onboarding = () => {
  const navigate = useNavigate();
  const { setTenant, setStaff } = useStore();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [checkingWhatsapp, setCheckingWhatsapp] = useState(false);
  const [whatsappAvailable, setWhatsappAvailable] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const plans = [
    {
      id: 'starter',
      name: 'Starter',
      price: '₹2,999',
      doctors: '1 doctor',
      conversations: '1,000 conversations/month',
      features: [
        'AI WhatsApp booking',
        'Token queue management',
        'Basic analytics',
        'Email support'
      ]
    },
    {
      id: 'growth',
      name: 'Growth',
      price: '₹5,999',
      doctors: 'Up to 5 doctors',
      conversations: '3,000 conversations/month',
      features: [
        'AI WhatsApp booking',
        'Token queue management',
        'Advanced analytics',
        'Priority support'
      ],
      popular: true
    },
    {
      id: 'pro',
      name: 'Pro',
      price: '₹9,999',
      doctors: 'Up to 10 doctors',
      conversations: '6,000 conversations/month',
      features: [
        'AI WhatsApp booking',
        'Token queue management',
        'Full analytics & reports',
        '24/7 support',
        'Custom AI responses'
      ]
    }
  ];

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'None'];

  const [formData, setFormData] = useState({
    clinicName: '',
    ownerName: '',
    email: '',
    phone: '',
    whatsappNumber: '',
    plan: 'starter',
    openingTime: '09:00',
    closingTime: '17:00',
    weeklyOff: 'Sunday',
    avgConsultationMinutes: 10,
    password: '',
    confirmPassword: ''
  });

  const handleChange = (e) => {
    let { name, value } = e.target;
    if (name === 'whatsappNumber' || name === 'phone') {
      value = value.replace(/\D/g, '').slice(0, 10);
    } else if (name === 'clinicName' || name === 'ownerName') {
      value = toTitleCase(value);
    }
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => { const n = {...prev}; delete n[name]; return n; });
    }
    if (name === 'whatsappNumber') {
      setWhatsappAvailable(null);
    }
  };

  const handleWhatsappBlur = async () => {
    if (formData.whatsappNumber.length === 10) {
      setCheckingWhatsapp(true);
      try {
        const { data } = await api.get(`/onboarding/check-whatsapp/${formData.whatsappNumber}`);
        if (!data.data.available) {
          setWhatsappAvailable(false);
          setErrors(prev => ({ ...prev, whatsappNumber: 'This number is already registered' }));
        } else {
          setWhatsappAvailable(true);
        }
      } catch(err) {
        // Ignored or handled gracefully
        setWhatsappAvailable(true);
      } finally {
        setCheckingWhatsapp(false);
      }
    }
  };

  const validateStep1 = () => {
    const newErrors = {};
    if (!formData.clinicName?.trim() || formData.clinicName.length < 3) newErrors.clinicName = 'Clinic name is required (min 3 chars)';
    if (!formData.ownerName?.trim()) newErrors.ownerName = 'Owner name is required';
    if (!formData.email?.trim() || !formData.email.includes('@')) newErrors.email = 'Valid email is required';
    if (formData.phone?.length !== 10) newErrors.phone = 'Requires exactly 10 digits';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors = {};
    if (!formData.openingTime) newErrors.openingTime = 'Opening time is required';
    if (!formData.closingTime) newErrors.closingTime = 'Closing time is required';
    if (formData.openingTime && formData.closingTime && formData.closingTime <= formData.openingTime) {
      newErrors.closingTime = 'Closing time must be after opening time';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = () => {
    const newErrors = {};
    if (formData.whatsappNumber?.length !== 10) {
      newErrors.whatsappNumber = 'Must be exactly 10 digits';
      setErrors(newErrors);
      return false;
    }
    if (whatsappAvailable === false) {
      newErrors.whatsappNumber = 'This number is already registered';
      setErrors(newErrors);
      return false;
    }
    return true;
  };

  const validateStep4 = () => {
    const newErrors = {};
    if (!formData.password || formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    } else if (!/\d/.test(formData.password)) {
      newErrors.password = 'Password must contain at least 1 number';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    let isValid = false;
    if (step === 1) isValid = validateStep1();
    if (step === 2) isValid = validateStep2();
    if (step === 3) isValid = validateStep3();
    if (isValid) setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    if (!validateStep4()) return;

    setLoading(true);
    setError(null);
    try {
      const response = await api.post(
        '/onboarding/clinic',
        {
          clinicName: formData.clinicName,
          ownerName: formData.ownerName,
          email: formData.email,
          phone: formData.phone,
          whatsappNumber: formData.whatsappNumber,
          plan: formData.plan || 'starter',
          openingTime: formData.openingTime || '09:00',
          closingTime: formData.closingTime || '17:00',
          weeklyOff: formData.weeklyOff || 'Sunday',
          avgConsultationMinutes: formData.avgConsultationMinutes || 10,
          password: formData.password
        }
      );

      if (response.success && response.data.token) {
        storeAuthData(response.data.token, response.data.staff);
        setStep(5); // success screen
        setTimeout(() => navigate('/dashboard'), 2000);
      } else {
        setError(response.error || 'Failed to create clinic');
      }
    } catch (err) {
      setError('Failed to create clinic. Please try again.');
      console.error('Onboarding error:', err);
    } finally {
      setLoading(false);
    }
  };

  console.log('Selected plan:', formData.plan);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative">
      <div className="absolute top-0 right-0 left-0 bg-white h-2 shadow-sm">
        <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${(Math.min(step, 4)/4)*100}%`}}></div>
      </div>

      {step < 5 && (
        <div className="sm:mx-auto sm:w-full sm:max-w-2xl text-center mb-8">
          <h2 className="text-4xl font-black text-gray-900 tracking-tight">Setup Your Clinic</h2>
          <p className="mt-2 text-md text-gray-500 font-medium">Step {Math.min(step, 4)} of 4</p>
        </div>
      )}

      <div className="sm:mx-auto sm:w-full sm:max-w-4xl">
        <div className="bg-white py-10 px-8 shadow-2xl sm:rounded-2xl border border-gray-100">
          
          {step === 1 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
              <h3 className="text-xl font-bold border-b pb-2">Clinic Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="col-span-1 md:col-span-2">
                  <Input label="Clinic Name" name="clinicName" value={formData.clinicName} onChange={handleChange} error={errors.clinicName} required />
                </div>
                <Input label="Owner Name" name="ownerName" value={formData.ownerName} onChange={handleChange} error={errors.ownerName} required />
                <Input label="Owner Email" name="email" type="email" value={formData.email} onChange={handleChange} error={errors.email} required />
                <Input label="Owner Phone" name="phone" type="tel" value={formData.phone} onChange={handleChange} error={errors.phone} hint="10 digit format" required />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
              <h3 className="text-xl font-bold border-b pb-2">Clinic Timings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Opening Time" name="openingTime" type="time" value={formData.openingTime} onChange={handleChange} error={errors.openingTime} required />
                <Input label="Closing Time" name="closingTime" type="time" value={formData.closingTime} onChange={handleChange} error={errors.closingTime} required />
                <Select 
                  label="Weekly Off" 
                  name="weeklyOff" 
                  value={formData.weeklyOff} 
                  onChange={handleChange} 
                  options={days.map(d => ({ value: d, label: d === 'None' ? 'No weekly off' : d }))} 
                />
                <Input 
                  label="Avg Consultation (Mins)" 
                  name="avgConsultationMinutes" 
                  type="number" 
                  min="5" 
                  max="60" 
                  value={formData.avgConsultationMinutes} 
                  onChange={handleChange} 
                  error={errors.avgConsultationMinutes} 
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
               <h3 className="text-xl font-bold border-b pb-2">WhatsApp Setup & Plan</h3>
               
               <div className="relative max-w-sm">
                 <Input 
                   label="Business WhatsApp Number" 
                   name="whatsappNumber" 
                   type="tel" 
                   value={formData.whatsappNumber} 
                   onChange={handleChange} 
                   onBlur={handleWhatsappBlur}
                   error={errors.whatsappNumber} 
                   required 
                 />
                 <div className="absolute top-[34px] left-3 flex items-center bg-transparent pointer-events-none text-gray-500 font-medium">+91</div>
                 {whatsappAvailable === true && (
                   <div className="absolute top-[34px] right-3 text-green-500">
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                   </div>
                 )}
                 {checkingWhatsapp && (
                   <div className="absolute top-[34px] right-3 text-gray-400">
                     <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                   </div>
                 )}
                 <style>{`input[name="whatsappNumber"] { padding-left: 2.8rem; font-weight: bold; }`}</style>
               </div>

               <label className="block text-sm font-medium text-gray-700 pt-4">Select Plan</label>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 {plans.map((plan) => (
                   <div 
                      key={plan.id} 
                      onClick={() => setFormData({ ...formData, plan: plan.id })}
                      className={`relative cursor-pointer border-2 rounded-xl p-5 transition-all duration-200 ${formData.plan === plan.id ? 'border-blue-600 bg-blue-50 shadow-md transform scale-105' : 'border-gray-200 bg-white hover:border-blue-300'}`}
                    >
                     {plan.popular && (
                       <div className="absolute top-0 right-0 transform translate-x-2 -translate-y-2">
                         <span className="bg-blue-600 text-white text-[10px] font-bold uppercase px-2 py-1 rounded-full tracking-wide">Popular</span>
                       </div>
                     )}
                     {formData.plan === plan.id && (
                       <div className="absolute top-3 right-3 text-blue-600">
                         <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                       </div>
                     )}
                     <h4 className="font-bold text-lg text-gray-900">{plan.name}</h4>
                     <p className="text-2xl font-black text-gray-900 my-2">{plan.price}<span className="text-sm font-medium text-gray-500">/mo</span></p>
                     
                     <div className="mt-4 space-y-3">
                       <div className="text-sm font-medium text-gray-800 flex items-center gap-2">
                         <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                         {plan.doctors}
                       </div>
                       <div className="text-sm font-medium text-gray-800 flex items-center gap-2">
                         <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                         {plan.conversations}
                       </div>
                     </div>

                     <ul className="text-sm text-gray-600 space-y-2 mt-4 pt-4 border-t border-gray-100">
                       {plan.features.map((f,i) => (
                         <li key={i} className="flex items-start gap-2">
                           <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                           <span>{f}</span>
                         </li>
                       ))}
                     </ul>
                   </div>
                 ))}
               </div>
               
               {error && (
                 <p className="text-red-500 text-sm mt-4 text-center font-medium">
                   {error}
                 </p>
               )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
              <h3 className="text-xl font-bold border-b pb-2">Create Your Password</h3>
              <p className="text-sm text-gray-500">You will use this to login to your ReceptionAI dashboard.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="relative">
                  <Input label="Password" name="password" type={showPassword ? 'text' : 'password'} value={formData.password} onChange={handleChange} error={errors.password} required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-9 text-sm text-gray-500 font-medium">{showPassword ? 'Hide' : 'Show'}</button>
                </div>
                <Input label="Confirm Password" name="confirmPassword" type={showPassword ? 'text' : 'password'} value={formData.confirmPassword} onChange={handleChange} error={errors.confirmPassword} required />
              </div>
              {error && (
                <p className="text-red-500 text-sm mt-4 text-center font-medium">
                  {error}
                </p>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6 animate-[fadeIn_0.3s] text-center max-w-lg mx-auto py-8">
               <div className="text-6xl mb-6">🎉</div>
               <h3 className="text-3xl font-black text-gray-900 mb-4">Welcome to ReceptionAI!</h3>
               <p className="text-xl text-gray-500 font-medium">Setting up your dashboard...</p>
            </div>
          )}

          <div className="mt-10 flex flex-col md:flex-row justify-between items-center gap-4">
             {step > 1 && step < 5 && (
               <button type="button" onClick={() => setStep(s=>s-1)} className="px-6 py-2 border rounded-lg hover:bg-gray-50 font-medium order-2 md:order-1 w-full md:w-auto text-gray-700">Back</button>
             )}
             <div className="order-1 md:order-2 ml-auto w-full md:w-auto">
               {step < 4 ? (
                  <button onClick={handleNext} className="w-full md:w-40 bg-gray-900 text-white hover:bg-gray-800 font-medium py-3 rounded-lg shadow transition">Next Step &rarr;</button>
               ) : step === 4 ? (
                  <button onClick={handleSubmit} disabled={loading} className="w-full md:w-56 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg shadow disabled:opacity-50 transition flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                        Creating...
                      </>
                    ) : 'Create My Clinic'}
                  </button>
               ) : null}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
