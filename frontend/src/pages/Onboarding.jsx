import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Input from '../components/shared/Input';
import Select from '../components/shared/Select';
import Button from '../components/shared/Button';
import useStore from '../store/useStore';
import api from '../utils/api';

const Onboarding = () => {
  const navigate = useNavigate();
  const { addToast, setTenant, setStaff } = useStore();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);

  const [formData, setFormData] = useState({
    clinicName: '',
    industry: 'clinic',
    ownerName: '',
    email: '',
    phone: '',
    whatsappNumber: '',
    plan: 'starter',
    openingTime: '09:00',
    closingTime: '18:00',
    weeklyOff: 'sunday',
    avgConsultationMinutes: 15,
    maxTokens: 50,
    doctorName: '',
    doctorSpecialization: '',
    doctorQualification: '',
    doctorFee: '',
    doctorMaxTokens: 30
  });

  const industries = [
    { value: 'clinic', label: 'Clinic / Hospital' },
    { value: 'service_centre', label: 'Car / Bike Service Centre' },
    { value: 'salon', label: 'Salon / Spa' }
  ];

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'none'];

  useEffect(() => {
    // Fetch plans
    api.get('/onboarding/plans').then(res => setPlans(res.data?.data || {})).catch(console.error);
  }, []);

  const handleChange = (e) => {
    let { name, value } = e.target;
    if (name === 'whatsappNumber' || name === 'phone') {
      value = value.replace(/\D/g, '').slice(0, 10);
    }
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => { const n = {...prev}; delete n[name]; return n; });
    }
  };

  const validateStep1 = () => {
    const newErrors = {};
    if (!formData.clinicName.trim()) newErrors.clinicName = 'Clinic name is required';
    if (!formData.ownerName.trim()) newErrors.ownerName = 'Owner name is required';
    if (!formData.email.trim() || !formData.email.includes('@')) newErrors.email = 'Valid email is required';
    if (formData.phone.length !== 10) newErrors.phone = 'Requires 10 digits';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors = {};
    if (!formData.doctorName.trim()) newErrors.doctorName = 'Doctor name is required';
    if (!formData.doctorSpecialization.trim()) newErrors.doctorSpecialization = 'Specialization is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = () => true;

  const validateStep4 = async () => {
    const newErrors = {};
    if (formData.whatsappNumber.length !== 10) {
      newErrors.whatsappNumber = 'Must be exactly 10 digits';
      setErrors(newErrors);
      return false;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/onboarding/check-whatsapp/${formData.whatsappNumber}`);
      if (!data.data.available) {
        newErrors.whatsappNumber = 'This number is already registered';
        setErrors(newErrors);
        setLoading(false);
        return false;
      }
    } catch(err) {
      // Ignored
    }
    setLoading(false);
    return true;
  };

  const handleNext = async () => {
    let isValid = false;
    if (step === 1) isValid = validateStep1();
    if (step === 2) isValid = validateStep2();
    if (step === 3) isValid = validateStep3();
    if (step === 4) isValid = await validateStep4();
    if (isValid) setStep(s => s + 1);
  };

  const handleSubmit = async () => {
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
          closingTime: formData.closingTime || '18:00',
          weeklyOff: formData.weeklyOff || 'sunday',
          avgConsultationMinutes: formData.avgConsultationMinutes || 15,
          maxTokens: formData.maxTokens || 50,
          doctorName: formData.doctorName,
          doctorSpecialization: formData.doctorSpecialization,
          doctorQualification: formData.doctorQualification,
          doctorFee: formData.doctorFee,
          doctorMaxTokens: formData.doctorMaxTokens || 30
        }
      );

      if (response.success) {
        setStep(6); // success screen
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative">
      <div className="absolute top-0 right-0 left-0 bg-white h-2 shadow-sm">
        <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${(Math.min(step, 5)/5)*100}%`}}></div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-2xl text-center mb-8">
        <h2 className="text-4xl font-black text-gray-900 tracking-tight">Setup Your Clinic</h2>
        <p className="mt-2 text-md text-gray-500 font-medium">Step {Math.min(step, 5)} of 5</p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-3xl">
        <div className="bg-white py-10 px-8 shadow-2xl sm:rounded-2xl border border-gray-100">
          
          {step === 1 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
              <h3 className="text-xl font-bold border-b pb-2">Clinic Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Clinic Name" name="clinicName" value={formData.clinicName} onChange={handleChange} error={errors.clinicName} required />
                <Select label="Industry" name="industry" value={formData.industry} onChange={handleChange} options={industries} />
                <Input label="Owner Name" name="ownerName" value={formData.ownerName} onChange={handleChange} error={errors.ownerName} required />
                <Input label="Owner Email" name="email" type="email" value={formData.email} onChange={handleChange} error={errors.email} required />
                <Input label="Owner Phone" name="phone" type="tel" value={formData.phone} onChange={handleChange} error={errors.phone} hint="10 digit format" required />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
              <h3 className="text-xl font-bold border-b pb-2">Add Your First Doctor</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Doctor Name" name="doctorName" value={formData.doctorName} onChange={handleChange} error={errors.doctorName} required />
                <Input label="Specialization" name="doctorSpecialization" value={formData.doctorSpecialization} onChange={handleChange} error={errors.doctorSpecialization} required />
                <Input label="Qualification" name="doctorQualification" value={formData.doctorQualification} onChange={handleChange} />
                <Input label="Consultation Fee (₹)" name="doctorFee" type="number" value={formData.doctorFee} onChange={handleChange} />
                <Input label="Max Tokens per Day" name="doctorMaxTokens" type="number" value={formData.doctorMaxTokens} onChange={handleChange} />
              </div>
              <p className="text-sm text-gray-500 mt-2">Note: You can add more doctors later from the Doctors page</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
              <h3 className="text-xl font-bold border-b pb-2">Clinic Timings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Opening Time" name="openingTime" type="time" value={formData.openingTime} onChange={handleChange} />
                <Input label="Closing Time" name="closingTime" type="time" value={formData.closingTime} onChange={handleChange} />
                <Select label="Weekly Off" name="weeklyOff" value={formData.weeklyOff} onChange={handleChange} options={days.map(d=>({value: d, label: d.toUpperCase()}))} />
                <Input label="Avg Consultation (Mins)" name="avgConsultationMinutes" type="number" value={formData.avgConsultationMinutes} onChange={handleChange} />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
               <h3 className="text-xl font-bold border-b pb-2">WhatsApp Setup</h3>
               <div className="space-y-4">
                 <div className="relative max-w-sm">
                   <Input label="Business WhatsApp Number" name="whatsappNumber" type="tel" value={formData.whatsappNumber} onChange={handleChange} error={errors.whatsappNumber} required />
                   <div className="absolute top-[34px] left-3 flex items-center bg-transparent pointer-events-none text-gray-500 font-medium">+91</div>
                   <style>{`input[name="whatsappNumber"] { padding-left: 2.8rem; font-weight: bold; }`}</style>
                 </div>

                 <label className="block text-sm font-medium text-gray-700 pt-4">Select Plan</label>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   {Object.entries(plans).map(([key, plan]) => (
                     <div 
                        key={key} 
                        onClick={() => setFormData(p => ({...p, plan: key}))}
                        className={`cursor-pointer border-2 rounded-xl p-4 transition-all duration-200 ${formData.plan === key ? 'border-indigo-600 bg-indigo-50 shadow-md transform scale-105' : 'border-gray-200 hover:border-indigo-300'}`}
                      >
                       <h4 className="font-bold text-lg capitalize">{plan.name}</h4>
                       <p className="text-2xl font-black text-gray-900 my-2">₹{plan.price}</p>
                       <ul className="text-xs text-gray-600 space-y-1 mt-4">
                         {plan.features?.slice(0,4).map((f,i) => <li key={i}>✓ {f}</li>)}
                       </ul>
                     </div>
                   ))}
                 </div>
                 
                 <div className="mt-6 bg-blue-50 border border-blue-100 rounded-lg p-4">
                   <h4 className="font-bold text-blue-900 mb-2">Meta Cloud API Connection</h4>
                   <p className="text-sm text-blue-800 mb-2">Instructions for Meta Cloud API connection:</p>
                   <ol className="list-decimal pl-5 text-sm text-blue-800 space-y-1 mb-3">
                     <li>Create an app in Meta Developer portal.</li>
                     <li>Add WhatsApp product and configure webhook.</li>
                     <li>Use the following Webhook URL:</li>
                   </ol>
                   <div className="bg-white px-3 py-2 rounded border border-blue-200 text-sm font-mono break-all select-all">
                     https://receptionai.in/webhook/whatsapp
                   </div>
                   <p className="text-sm text-blue-800 mt-3 italic">Note: WhatsApp connection requires Meta Cloud API approval. Our team will help you connect after signup.</p>
                 </div>
               </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
               <h3 className="text-xl font-bold border-b text-center border-none mb-6">Confirm Setup</h3>
               <div className="bg-gray-50 rounded-xl p-6 shadow-inner space-y-4 max-w-xl mx-auto">
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Clinic Name</span><span className="font-bold">{formData.clinicName}</span></div>
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">WhatsApp Number</span><span className="font-bold">+91 {formData.whatsappNumber}</span></div>
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Selected Plan</span><span className="font-bold capitalize text-indigo-700">{formData.plan}</span></div>
                 <div className="flex justify-between"><span className="text-gray-500">Hours</span><span className="font-bold">{formData.openingTime} - {formData.closingTime}</span></div>
               </div>
               <p className="text-center text-sm text-gray-500 mt-4">By clicking Create, you agree to our Terms of Service.</p>
               {error && (
                 <p className="text-red-500 text-sm mt-2 text-center font-medium">
                   {error}
                 </p>
               )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
               <div className="flex justify-center mb-4">
                 <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center">
                   <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                 </div>
               </div>
               <h3 className="text-2xl font-black text-center border-none mb-6">You are Ready!</h3>
               <div className="bg-gray-50 rounded-xl p-6 shadow-inner space-y-4 max-w-xl mx-auto">
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Clinic Name</span><span className="font-bold">{formData.clinicName}</span></div>
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Doctor Added</span><span className="font-bold">Dr. {formData.doctorName}</span></div>
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Selected Plan</span><span className="font-bold capitalize text-indigo-700">{formData.plan}</span></div>
                 <div className="flex justify-between"><span className="text-gray-500">WhatsApp Number</span><span className="font-bold">+91 {formData.whatsappNumber}</span></div>
               </div>
               <p className="text-center text-sm text-gray-500 mt-6 max-w-md mx-auto">
                 Your AI receptionist is being set up. We will contact you within 24 hours to complete WhatsApp connection.
               </p>
            </div>
          )}

          <div className="mt-10 flex flex-col md:flex-row justify-between items-center gap-4">
             {step > 1 && step < 6 && (
               <button type="button" onClick={() => setStep(s=>s-1)} className="px-6 py-2 border rounded-lg hover:bg-gray-50 font-medium order-2 md:order-1 w-full md:w-auto">Back</button>
             )}
             <div className="order-1 md:order-2 ml-auto w-full md:w-auto">
               {step < 5 ? (
                  <Button onClick={handleNext} loading={loading} className="w-full md:w-40" size="lg">Next Step &rarr;</Button>
               ) : step === 5 ? (
                  <button onClick={handleSubmit} disabled={loading} className="w-full md:w-48 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 rounded-lg shadow disabled:opacity-50 transition">
                    {loading ? 'Creating...' : 'Create My Clinic'}
                  </button>
               ) : (
                  <Button onClick={() => navigate('/dashboard')} className="w-full md:w-48 bg-emerald-600 hover:bg-emerald-700" size="lg">Go to Dashboard</Button>
               )}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
