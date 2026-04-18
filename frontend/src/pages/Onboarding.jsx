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
    maxTokens: 50
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

  const validateStep2 = async () => {
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

  const skipStep3 = () => true;

  const handleNext = async () => {
    let isValid = false;
    if (step === 1) isValid = validateStep1();
    if (step === 2) isValid = await validateStep2();
    if (step === 3) isValid = skipStep3();
    if (isValid) setStep(s => s + 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/onboarding/clinic', formData);
      addToast('Clinic created successfully', 'success');
      setTenant(data.data);
      // Auth bypass mock
      setStaff({ name: formData.ownerName, role: 'admin', tenantId: data.data.tenant_id });
      navigate('/dashboard');
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to create clinic', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative">
      <div className="absolute top-0 right-0 left-0 bg-white h-2 shadow-sm">
        <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${(step/4)*100}%`}}></div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-2xl text-center mb-8">
        <h2 className="text-4xl font-black text-gray-900 tracking-tight">Setup Your Clinic</h2>
        <p className="mt-2 text-md text-gray-500 font-medium">Step {step} of 4</p>
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
               <h3 className="text-xl font-bold border-b pb-2">WhatsApp & Plan Selection</h3>
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
               </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
              <h3 className="text-xl font-bold border-b pb-2">Clinic Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Opening Time" name="openingTime" type="time" value={formData.openingTime} onChange={handleChange} />
                <Input label="Closing Time" name="closingTime" type="time" value={formData.closingTime} onChange={handleChange} />
                <Select label="Weekly Off" name="weeklyOff" value={formData.weeklyOff} onChange={handleChange} options={days.map(d=>({value: d, label: d.toUpperCase()}))} />
                
                <Input label="Avg Consultation (Mins)" name="avgConsultationMinutes" type="number" value={formData.avgConsultationMinutes} onChange={handleChange} />
                <Input label="Max Tokens per Day" name="maxTokens" type="number" value={formData.maxTokens} onChange={handleChange} />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6 animate-[fadeIn_0.3s]">
               <h3 className="text-xl font-bold border-b text-center border-none mb-6">Confirm Setup</h3>
               <div className="bg-gray-50 rounded-xl p-6 shadow-inner space-y-4 max-w-xl mx-auto">
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Clinic Name</span><span className="font-bold">{formData.clinicName}</span></div>
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">WhatsApp Number</span><span className="font-bold">+91 {formData.whatsappNumber}</span></div>
                 <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Selected Plan</span><span className="font-bold capitalize text-indigo-700">{formData.plan}</span></div>
                 <div className="flex justify-between"><span className="text-gray-500">Hours</span><span className="font-bold">{formData.openingTime} - {formData.closingTime}</span></div>
               </div>
               <p className="text-center text-sm text-gray-500 mt-4">By clicking Create, you agree to our Terms of Service.</p>
            </div>
          )}

          <div className="mt-10 flex flex-col md:flex-row justify-between items-center gap-4">
             {step > 1 && (
               <button type="button" onClick={() => setStep(s=>s-1)} className="px-6 py-2 border rounded-lg hover:bg-gray-50 font-medium order-2 md:order-1 w-full md:w-auto">Back</button>
             )}
             <div className="order-1 md:order-2 ml-auto w-full md:w-auto">
               {step < 4 ? (
                  <Button onClick={handleNext} loading={loading} className="w-full md:w-40" size="lg">Next Step &rarr;</Button>
               ) : (
                  <Button onClick={handleSubmit} loading={loading} className="w-full md:w-48 bg-emerald-600 hover:bg-emerald-700" size="lg">Create My Clinic</Button>
               )}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
