import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// GET /api/sync?key=... (key is email)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userKey = searchParams.get('key')?.trim().toLowerCase();

    if (!userKey) {
      return NextResponse.json({ error: 'Missing user key' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('user_sync')
      .select('*')
      .eq('user_key', userKey)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/sync
export async function POST(req: NextRequest) {
  try {
    const { userKey, profile, conversations, commitments, notes } = await req.json();

    const normalizedKey = (userKey || '').trim().toLowerCase();
    if (!normalizedKey) {
      return NextResponse.json({ error: 'Missing user key' }, { status: 400 });
    }

    const updatePayload: any = {
      user_key: normalizedKey,
      profile: profile || {},
      conversations: conversations || [],
      commitments: commitments || [],
      notes: notes || [],
      updated_at: new Date().toISOString(),
    };

    // Preserve existing password_hash during sync update
    const { data: existing } = await supabase
      .from('user_sync')
      .select('password_hash')
      .eq('user_key', normalizedKey)
      .maybeSingle();

    if (existing?.password_hash) {
      updatePayload.password_hash = existing.password_hash;
    }

    const { data, error } = await supabase
      .from('user_sync')
      .upsert(updatePayload, { onConflict: 'user_key' })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
