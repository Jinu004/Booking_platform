import React from 'react';
import useStore from '../../store/useStore';

const TokenReceipt = ({ booking, onClose }) => {
  const { tenant } = useStore();

  const handlePrint = () => {
    window.print();
  };

  if (!booking) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900 bg-opacity-75 p-4 print:p-0 print:bg-white print:static print:block transition-opacity duration-300">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden print:shadow-none print:w-full print:max-w-none print:h-auto print:m-0 transform scale-100 transition-transform">
        
        {/* Receipt Content */}
        <div className="p-8 text-center print:p-4">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-1">{tenant?.name || 'Clinic Registration'}</h2>
          <p className="text-[10px] text-gray-400 mb-8 uppercase tracking-[0.2em] font-bold font-mono">BookingAI Platform</p>
          
          <div className="flex justify-center mb-8">
            <div className="h-40 w-40 rounded-full border-[6px] border-indigo-100 flex items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-50 shadow-inner">
              <span className="text-6xl font-black text-indigo-700 print:text-black">
                #{booking.token_number}
              </span>
            </div>
          </div>
          
          <div className="space-y-5 mb-10 text-left border-y-2 border-dashed border-gray-200 py-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] text-gray-400 uppercase font-bold tracking-wider mb-1">Patient Name</p>
                <p className="text-lg font-bold text-gray-900">{booking.patient_name || booking.name || 'Patient'}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-gray-400 uppercase font-bold tracking-wider mb-1">Assigned Doctor</p>
                <p className="text-lg font-bold text-gray-900">Dr. {booking.doctor_name || 'Assigned'}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] text-gray-400 uppercase font-bold tracking-wider mb-1">Date</p>
                <p className="text-sm font-semibold text-gray-800">{new Date().toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-gray-400 uppercase font-bold tracking-wider mb-1">Status</p>
                <p className="text-sm font-bold text-emerald-600 uppercase tracking-wide">{booking.status || 'Confirmed'}</p>
              </div>
            </div>
          </div>
          
          <p className="text-sm text-gray-600 font-medium">
            <span role="img" aria-label="clock">⏳</span> Please arrive <strong className="text-indigo-600 print:text-black">10 minutes early</strong> to secure your spot.
          </p>
        </div>

        {/* Actions (Hidden on Print) */}
        <div className="px-8 py-5 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 print:hidden">
          <button 
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 shadow-md flex items-center gap-2 transition-colors duration-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
            Print Token
          </button>
        </div>
      </div>
    </div>
  );
};

export default TokenReceipt;
