import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { sendWelcomeEmail } from '@/lib/email';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AUTH_SALT = process.env.AUTH_SALT || 'peter_daniels_salt_2026';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + AUTH_SALT).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json();

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Пожалуйста, введите корректный адрес электронной почты' }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: 'Пароль должен содержать минимум 6 символов' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = hashPassword(password);

    // 1. Check if user already exists
    const { data: existingUser } = await supabase
      .from('user_sync')
      .select('user_key, password_hash')
      .eq('user_key', normalizedEmail)
      .maybeSingle();

    if (existingUser && existingUser.password_hash) {
      return NextResponse.json(
        { error: 'Аккаунт с таким Email уже существует. Пожалуйста, выполните вход.' },
        { status: 400 }
      );
    }

    const studentName = typeof name === 'string' ? name.trim() : '';

    const initialProfile = {
      name: studentName,
      occupation: '',
      goals: '',
      challenges: '',
    };

    // 3. Upsert user in user_sync
    const { data: newUser, error: insertError } = await supabase
      .from('user_sync')
      .upsert(
        {
          user_key: normalizedEmail,
          password_hash: passwordHash,
          profile: initialProfile,
          conversations: [],
          commitments: [],
          notes: [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_key' }
      )
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // 4. Send welcome email (awaited to ensure serverless function does not terminate mid-flight)
    let emailDelivery: any = null;
    try {
      emailDelivery = await sendWelcomeEmail({
        email: normalizedEmail,
        password: password,
        name: studentName,
      });
      console.log('[Register] Welcome email delivery status:', emailDelivery);
    } catch (emailErr) {
      console.error('[Register] Error sending welcome email:', emailErr);
    }

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      data: newUser,
      emailDelivery,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
