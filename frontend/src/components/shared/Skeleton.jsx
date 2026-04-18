import React from 'react';

export function StatCardSkeleton() {
  return (
    <div className="bg-white p-6 rounded-lg shadow border border-gray-200 animate-pulse relative overflow-hidden">
      <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
      <div className="h-8 bg-gray-200 rounded w-1/4"></div>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent translate-x-[-100%] animate-[shimmer_1.5s_infinite]"></div>
    </div>
  );
}

export function TableRowSkeleton({ rows = 5 }) {
  return (
    <div className="divide-y divide-gray-200 w-full animate-pulse">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="p-6 flex items-center justify-between relative overflow-hidden">
          <div className="w-1/2 space-y-3">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-3 bg-gray-100 rounded w-1/2"></div>
          </div>
          <div className="text-right w-1/4 space-y-3 flex flex-col items-end">
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-5 bg-gray-200 rounded-full w-2/3"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-white shadow rounded-lg border border-gray-200 animate-pulse relative overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <div className="h-5 bg-gray-200 rounded w-1/3"></div>
      </div>
      <div className="p-6 space-y-4">
        <div className="h-4 bg-gray-200 rounded w-full"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6"></div>
        <div className="h-4 bg-gray-100 rounded w-4/6"></div>
      </div>
    </div>
  );
}
