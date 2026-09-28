-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/pcnixjqmllcyhchkubdc/sql/new

-- Create sync table for users (profile, history, commitments, notes)
CREATE TABLE IF NOT EXISTS public.user_sync (
  user_key TEXT PRIMARY KEY,
  password_hash TEXT,
  profile JSONB DEFAULT '{}'::jsonb,
  conversations JSONB DEFAULT '[]'::jsonb,
  commitments JSONB DEFAULT '[]'::jsonb,
  notes JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add password_hash if table was created previously without it
ALTER TABLE public.user_sync ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Enable RLS
ALTER TABLE public.user_sync ENABLE ROW LEVEL SECURITY;

-- Allow read & write access
DROP POLICY IF EXISTS "Allow anon full access to user_sync" ON public.user_sync;
CREATE POLICY "Allow anon full access to user_sync" 
ON public.user_sync 
FOR ALL 
TO anon, authenticated, service_role 
USING (true) 
WITH CHECK (true);
