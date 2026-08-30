import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

type OnlineTable = {
  readonly Row: Record<string, unknown>;
  readonly Insert: Record<string, unknown>;
  readonly Update: Record<string, unknown>;
  readonly Relationships: [];
};

type OnlineDatabase = {
  readonly __InternalSupabase: { readonly PostgrestVersion: '12' };
  readonly public: {
    readonly Tables: Record<string, OnlineTable>;
    readonly Views: Record<string, OnlineTable>;
    readonly Functions: Record<string, { readonly Args: Record<string, unknown>; readonly Returns: unknown }>;
  };
};

type SupabaseBrowserClient = SupabaseClient<OnlineDatabase>;

export interface SupabaseServices {
  readonly client: SupabaseBrowserClient;
}

export const isSupabaseConfigured = (): boolean => Boolean(url && anonKey);

let cachedServices: SupabaseServices | null | undefined;

export const supabaseServices = (): SupabaseServices | null => {
  if (cachedServices !== undefined) return cachedServices;
  if (!isSupabaseConfigured()) {
    cachedServices = null;
    return cachedServices;
  }
  cachedServices = {
    client: createClient<OnlineDatabase>(url!, anonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    }),
  };
  return cachedServices;
};

export const ensureAnonymousUser = async (): Promise<User> => {
  const services = supabaseServices();
  if (!services) throw new Error('Supabase no está configurado. Revisa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.');
  const current = await services.client.auth.getUser();
  if (current.data.user) return current.data.user;
  const { data, error } = await services.client.auth.signInAnonymously();
  if (error || !data.user) {
    const message = error?.message ?? 'Supabase no pudo autenticar este dispositivo.';
    throw new Error(`No se pudo abrir una identidad anónima: ${message}`);
  }
  return data.user;
};

export const requireSupabaseClient = (): SupabaseBrowserClient => {
  const services = supabaseServices();
  if (!services) throw new Error('Supabase no está configurado. Revisa las variables VITE_SUPABASE_*.');
  return services.client;
};
