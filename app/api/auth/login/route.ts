import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AUTH_SALT = process.env.AUTH_SALT || 'peter_daniels_salt_2026';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + AUTH_SALT).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Пожалуйста, введите корректный адрес электронной почты' }, { status: 400 });
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Пожалуйста, введите пароль' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = hashPassword(password);

    // 1. Fetch user by user_key (email)
    const { data: user, error } = await supabase
      .from('user_sync')
      .select('*')
      .eq('user_key', normalizedEmail)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Аккаунт с таким Email не найден. Пожалуйста, зарегистрируйтесь.' },
        { status: 404 }
      );
    }

    // 2. Validate password hash
    if (user.password_hash && user.password_hash !== passwordHash) {
      return NextResponse.json({ error: 'Неверный пароль. Попробуйте еще раз.' }, { status: 401 });
    }

    // If existing legacy user didn't have password_hash, set it on first login
    if (!user.password_hash) {
      await supabase
        .from('user_sync')
        .update({ password_hash: passwordHash })
        .eq('user_key', normalizedEmail);
    }

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      data: user,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
