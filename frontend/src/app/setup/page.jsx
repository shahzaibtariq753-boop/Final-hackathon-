'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import API from '../../lib/api';

export default function SetupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    companyName: '',
    adminEmail: '',
    adminPassword: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.adminPassword !== formData.confirmPassword) {
      return setError('Passwords do not match');
    }

    if (formData.adminPassword.length < 10) {
      return setError('Password must be at least 10 characters');
    }

    setLoading(true);
    try {
      await API.post('/setup/first-run', {
        companyName: formData.companyName,
        adminEmail: formData.adminEmail,
        adminPassword: formData.adminPassword
      });

      alert('First-run setup complete! Please login with your Admin credentials.');
      router.push('/login');
    } catch (err) {
      setError(err.response?.data?.error || 'Setup failed. Please check backend connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden p-8 border border-slate-100">
        <div className="text-center mb-6">
          <span className="bg-indigo-100 text-indigo-700 text-xs px-3 py-1 rounded-full font-semibold uppercase tracking-wider">
            First-Run Setup
          </span>
          <h1 className="text-2xl font-bold text-gray-900 mt-3">HCM Lite System Setup</h1>
          <p className="text-xs text-gray-500 mt-1">
            Initialize company profile & create the primary Admin account
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-xs p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSetup} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Company Name</label>
            <input
              type="text"
              name="companyName"
              required
              placeholder="e.g. Saylani Tech Ltd."
              value={formData.companyName}
              onChange={handleChange}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-600 transition text-gray-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Admin Email Address</label>
            <input
              type="email"
              name="adminEmail"
              required
              placeholder="admin@company.com"
              value={formData.adminEmail}
              onChange={handleChange}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-600 transition text-gray-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Admin Password</label>
            <input
              type="password"
              name="adminPassword"
              required
              placeholder="••••••••"
              value={formData.adminPassword}
              onChange={handleChange}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-600 transition text-gray-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Confirm Password</label>
            <input
              type="password"
              name="confirmPassword"
              required
              placeholder="••••••••"
              value={formData.confirmPassword}
              onChange={handleChange}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-600 transition text-gray-900"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg text-sm transition shadow-md disabled:opacity-50 mt-2"
          >
            {loading ? 'Initializing Company...' : 'Initialize System'}
          </button>
        </form>
      </div>
    </div>
  );
}