'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabaseBrowser } from '@/lib/client/supabase';
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js';

export type AppRole = 'super_admin' | 'pm_lead' | 'pm';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: AppRole;
  active: boolean;
}

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const sb = supabaseBrowser();

  const fetchProfile = useCallback(async (uid: string) => {
    const { data } = await sb
      .from('profiles')
      .select('id, full_name, email, phone, role, active')
      .eq('id', uid)
      .single();
    if (data) setProfile(data as Profile);
  }, [sb]);

  useEffect(() => {
    // Initial session check
    async function init() {
      const { data: { user: u } } = await sb.auth.getUser();
      setUser(u);
      if (u) await fetchProfile(u.id);
      setLoading(false);
    }
    init();

    // Listen for auth changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchProfile(u.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [sb, fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, [sb]);

  const signOut = useCallback(async () => {
    await sb.auth.signOut();
    setUser(null);
    setProfile(null);
  }, [sb]);

  const changePassword = useCallback(async (newPassword: string) => {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  }, [sb]);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  return (
    <AuthContext value={{
      user,
      profile,
      loading,
      signIn,
      signOut,
      changePassword,
      refreshProfile,
    }}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
