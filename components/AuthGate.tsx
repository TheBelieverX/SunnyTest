import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, initialLinkType, initialLinkError } from '../services/supabase';
import { refreshUsage, track } from '../services/api';

const inputCls = 'w-full p-2 rounded bg-slate-700';
const buttonCls = 'w-full p-2 rounded bg-purple-600 hover:bg-purple-500 font-semibold disabled:opacity-50';

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState(initialLinkError ? 'This link is invalid or has expired. Ask for a new one.' : '');
  const [busy, setBusy] = useState(false);
  // Invite and password-reset links must ask the user to choose a password.
  const [needsPassword, setNeedsPassword] = useState(initialLinkType === 'invite' || initialLinkType === 'recovery');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId || needsPassword) return;
    refreshUsage();
    track('session_start');
  }, [userId, needsPassword]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message);
  };

  const forgotPassword = async () => {
    if (!email) return setMessage('Enter your email above first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setMessage(error ? error.message : 'If this email has an account, a reset link is on its way.');
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    if (newPassword.length < 8) return setMessage('Password must be at least 8 characters.');
    if (newPassword !== confirm) return setMessage('Passwords do not match.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) return setMessage(error.message);
    setNeedsPassword(false);
  };

  if (loading) return null;
  if (session && !needsPassword) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-4">
      {session && needsPassword ? (
        <form onSubmit={savePassword} className="w-full max-w-sm space-y-4 bg-slate-800 p-6 rounded-xl">
          <h1 className="text-2xl font-bold">Choose your password</h1>
          <p className="text-sm text-slate-300">Welcome{session.user.email ? `, ${session.user.email}` : ''}! Set a password to finish your account.</p>
          <input className={inputCls} type="password" placeholder="New password (min 8 characters)" required minLength={8}
            autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          <input className={inputCls} type="password" placeholder="Confirm password" required minLength={8}
            autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          <button className={buttonCls} type="submit" disabled={busy}>Save password</button>
          {message && <p className="text-sm text-amber-300">{message}</p>}
        </form>
      ) : (
        <form onSubmit={signIn} className="w-full max-w-sm space-y-4 bg-slate-800 p-6 rounded-xl">
          <h1 className="text-2xl font-bold">Povești Magice</h1>
          <input className={inputCls} type="email" placeholder="Email" required autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)} />
          <input className={inputCls} type="password" placeholder="Password" required minLength={6}
            autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className={buttonCls} type="submit">Sign in</button>
          {message && <p className="text-sm text-amber-300">{message}</p>}
          <button type="button" onClick={forgotPassword} className="text-sm text-slate-300 underline">
            Forgot password?
          </button>
          <p className="text-xs text-slate-400">Access is by invitation only.</p>
        </form>
      )}
    </div>
  );
};
