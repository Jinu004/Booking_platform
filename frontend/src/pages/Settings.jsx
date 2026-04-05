import React, { useState, useEffect } from 'react';
import PageHeader from '../components/shared/PageHeader';
import Button from '../components/shared/Button';
import Input from '../components/shared/Input';
import Select from '../components/shared/Select';
import Badge from '../components/shared/Badge';
import Spinner from '../components/shared/Spinner';
import useTenant from '../hooks/useTenant';
import useStore from '../store/useStore';

const Settings = () => {
  const { tenant, configs, loading, updateConfig } = useTenant();
  const { addToast } = useStore();
  const [saving, setSaving] = useState(false);
  
  const [localConfigs, setLocalConfigs] = useState({});

  useEffect(() => {
    if (configs && Object.keys(configs).length > 0) {
      setLocalConfigs({
        avg_consultation_minutes: configs.avg_consultation_minutes || '',
        max_tokens_per_day: configs.max_tokens_per_day || '',
        reset_time: configs.reset_time || '',
        language: configs.language || 'english',
        weekly_off: configs.weekly_off || 'sunday',
        booking_mode: configs.booking_mode || 'token',
        reminder_24h: configs.reminder_24h === 'true',
        reminder_2h: configs.reminder_2h === 'true'
      });
    }
  }, [configs]);

  const handleConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    const finalValue = type === 'checkbox' ? checked : value;
    setLocalConfigs(prev => ({ ...prev, [name]: finalValue }));
  };

  const handleSaveConfigs = async () => {
    setSaving(true);
    let allSuccess = true;
    try {
      for (const key of Object.keys(localConfigs)) {
        const newValue = String(localConfigs[key]);
        const oldValue = String(configs[key] || '');
        // Only update changed explicit keys
        if (newValue !== oldValue) {
          const success = await updateConfig(key, newValue);
          if (!success) {
            allSuccess = false;
          }
        }
      }

      if (allSuccess) {
        addToast('Configuration saved successfully', 'success');
      }
    } finally {
      setSaving(false);
    }
  };

  const formatIndustry = (industry) => {
    if (!industry) return '';
    const map = {
      'clinic': 'Clinic / Hospital',
      'service_centre': 'Car / Bike Service Centre',
      'salon': 'Salon / Spa'
    };
    return map[industry] || industry.replace('_', ' ');
  };

  if (!tenant || loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <Spinner size="lg" color="blue" />
      </div>
    );
  }

  const isGrowthOrPro = ['growth', 'pro'].includes(tenant?.plan);

  return (
    <div className="w-full">
      <PageHeader title="Settings" subtitle="Manage your clinic profile and system preferences" />

      {/* SECTION 1: Clinic Information */}
      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden mb-8">
        <div className="px-6 py-5 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Clinic Information</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            <div>
              <p className="block text-sm font-medium text-gray-500 mb-1">Clinic Name</p>
              <p className="text-base font-semibold text-gray-900">{tenant?.name || '-'}</p>
            </div>
            <div>
              <p className="block text-sm font-medium text-gray-500 mb-1">Industry</p>
              <p className="text-base text-gray-900 capitalize">{formatIndustry(tenant?.industry)}</p>
            </div>
            <div>
              <p className="block text-sm font-medium text-gray-500 mb-1">WhatsApp Number</p>
              <p className="text-base text-gray-900">{tenant?.whatsapp_number || '-'}</p>
            </div>
            <div>
              <p className="block text-sm font-medium text-gray-500 mb-1">Current Plan</p>
              <Badge variant="info">{tenant?.plan ? tenant.plan.toUpperCase() : 'UNKNOWN'}</Badge>
            </div>
            <div>
              <p className="block text-sm font-medium text-gray-500 mb-1">Account Status</p>
              <Badge variant={tenant?.status === 'active' ? 'active' : 'inactive'}>
                {tenant?.status || 'UNKNOWN'}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: Configuration */}
      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Configuration</h3>
        </div>
        <div className="p-6">
          {tenant?.industry === 'clinic' ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                <Input 
                  type="number" 
                  label="Average Consultation (minutes)" 
                  name="avg_consultation_minutes" 
                  value={localConfigs.avg_consultation_minutes} 
                  onChange={handleConfigChange} 
                />
                <Input 
                  type="number" 
                  label="Max Tokens Per Day" 
                  name="max_tokens_per_day" 
                  value={localConfigs.max_tokens_per_day} 
                  onChange={handleConfigChange} 
                />
                <Input 
                  type="time" 
                  label="Daily Reset Time" 
                  name="reset_time" 
                  value={localConfigs.reset_time} 
                  onChange={handleConfigChange} 
                />
                <Select 
                  label="Language" 
                  name="language" 
                  value={localConfigs.language} 
                  onChange={handleConfigChange} 
                  options={[
                    {value: 'english', label: 'English'}, 
                    {value: 'malayalam', label: 'Malayalam'}
                  ]} 
                />
                <Select 
                  label="Weekly Off" 
                  name="weekly_off" 
                  value={localConfigs.weekly_off} 
                  onChange={handleConfigChange} 
                  options={[
                    {value: 'sunday', label: 'Sunday'},
                    {value: 'monday', label: 'Monday'},
                    {value: 'tuesday', label: 'Tuesday'},
                    {value: 'wednesday', label: 'Wednesday'},
                    {value: 'thursday', label: 'Thursday'},
                    {value: 'friday', label: 'Friday'},
                    {value: 'saturday', label: 'Saturday'}
                  ]} 
                />
                <Select 
                  label="Booking Mode" 
                  name="booking_mode" 
                  value={localConfigs.booking_mode} 
                  onChange={handleConfigChange} 
                  options={[
                    {value: 'token', label: 'Token'}, 
                    {value: 'appointment', label: 'Appointment'}
                  ]} 
                />
              </div>
              
              <div className="mt-8 mb-4 border-t border-gray-100 pt-6">
                <h4 className="text-base font-medium text-gray-900 mb-4">Notifications</h4>
                <div className="space-y-4">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      name="reminder_24h" 
                      checked={localConfigs.reminder_24h || false} 
                      onChange={handleConfigChange} 
                      className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500" 
                    />
                    <span className="text-gray-700 font-medium">24hr Reminder</span>
                  </label>
                  
                  <label className={`flex items-center space-x-3 ${!isGrowthOrPro ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`} title={!isGrowthOrPro ? 'Available on Growth plan' : ''}>
                    <input 
                      type="checkbox" 
                      name="reminder_2h" 
                      checked={isGrowthOrPro ? (localConfigs.reminder_2h || false) : false} 
                      disabled={!isGrowthOrPro}
                      onChange={handleConfigChange} 
                      className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 disabled:opacity-50" 
                    />
                    <span className="text-gray-700 font-medium flex items-center">
                      2hr Reminder
                      {!isGrowthOrPro && (
                        <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded flex items-center">
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                          Growth Plan Required
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              </div>
            </>
          ) : (
             <div className="py-8 text-center text-gray-500 bg-gray-50 rounded border border-gray-200">
               Configuration options for {tenant?.industry} industry are coming soon.
             </div>
          )}

          <div className="flex justify-end pt-6 border-t border-gray-200 mt-6">
            <Button onClick={handleSaveConfigs} loading={saving}>
              Save Configuration
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
