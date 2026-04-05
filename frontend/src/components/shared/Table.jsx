import React from 'react';
import Spinner from './Spinner';

const Table = ({ columns, data, loading = false, emptyMessage = 'No data found', onRowClick }) => {
  if (loading) {
    return (
      <div className="w-full flex justify-center items-center py-12 bg-white rounded-lg border border-gray-200">
        <Spinner size="lg" color="blue" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="w-full flex justify-center items-center py-12 bg-white rounded-lg border border-gray-200 text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col, i) => (
              <th 
                key={col.key || i}
                scope="col" 
                className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {data.map((row, rowIndex) => (
            <tr 
              key={row.id || rowIndex} 
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`
                ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                ${onRowClick ? 'hover:bg-blue-50 cursor-pointer transition-colors' : ''}
              `}
            >
              {columns.map((col, colIndex) => (
                <td key={col.key || colIndex} className="px-6 py-4 whitespace-nowrap text-gray-900">
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Table;
