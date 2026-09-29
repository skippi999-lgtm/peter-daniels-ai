import nodemailer from 'nodemailer';

// Service to send transactional emails
// Supports Gmail SMTP (official Google servers for testing & friends)
// and Resend API as fallback

export async function sendWelcomeEmail({
  email,
  password,
  name,
}: {
  email: string;
  password?: string;
  name?: string;
}) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const resendApiKey = process.env.RESEND_API_KEY;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background-color: #0c0d0e; color: #f5f5f5; border-radius: 16px; border: 1px solid #27272a;">
      <div style="text-align: center; margin-bottom: 28px;">
        <div style="display: inline-block; width: 60px; height: 60px; line-height: 60px; border-radius: 50%; background-color: #c9a84c; color: #000; font-size: 28px; font-weight: bold;">
          P
        </div>
        <h1 style="color: #c9a84c; font-size: 24px; margin-top: 16px; margin-bottom: 6px; letter-spacing: 0.5px;">Peter Daniels AI</h1>
        <p style="color: #a1a1aa; font-size: 13px; margin: 0;">Персональная система виртуального наставничества</p>
      </div>

      <div style="background-color: #18181b; border: 1px solid #3f3f46; border-radius: 12px; padding: 22px; margin-bottom: 24px;">
        <h2 style="color: #fef08a; font-size: 17px; margin-top: 0; margin-bottom: 12px;">Поздравляем с регистрацией${name ? `, ${name}` : ''}!</h2>
        <p style="color: #d4d4d8; font-size: 14px; line-height: 1.6; margin: 0 0 18px 0;">
          Вы сделали осознанный шаг к развитию мышления, железной дисциплины и масштабных целей под руководством мудрости и принципов Питера Дэниелса.
        </p>

        <div style="background-color: #09090b; border: 1px solid #27272a; border-radius: 8px; padding: 14px 16px;">
          <div style="font-size: 13px; color: #a1a1aa; margin-bottom: 8px;">
            🔑 <strong>Ваш логин (Email):</strong> <span style="color: #fef08a; font-family: monospace; font-size: 14px;">${email}</span>
          </div>
          ${
            password
              ? `<div style="font-size: 13px; color: #a1a1aa;">
                  🔒 <strong>Ваш пароль:</strong> <span style="color: #fef08a; font-family: monospace; font-size: 14px;">${password}</span>
                </div>`
              : ''
          }
        </div>
      </div>

      <div style="background-color: rgba(201, 168, 76, 0.1); border-left: 4px solid #c9a84c; padding: 14px 16px; border-radius: 4px; margin-bottom: 24px;">
        <p style="color: #fef08a; font-size: 13px; margin: 0; font-style: italic; line-height: 1.5;">
          «Слова стоят дёшево. Но готовность действовать и держать слово разделяет лидеров и мечтателей. Иди и победи!»
        </p>
        <p style="color: #c9a84c; font-size: 11px; margin: 6px 0 0 0; text-align: right; font-weight: bold;">— Peter Daniels</p>
      </div>

      <div style="text-align: center; color: #71717a; font-size: 12px; line-height: 1.5;">
        <p style="margin: 0;">Сохраните это письмо для входа с телефона и компьютера.</p>
        <p style="margin: 4px 0 0 0;">Синхронизация между устройствами подключена автоматически.</p>
      </div>
    </div>
  `;

  // 1. Primary Method: Gmail SMTP (Sends to anyone without custom domain)
  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass.replace(/\s+/g, ''), // cleans spaces from Google 16-char app password
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      const info = await transporter.sendMail({
        from: `"Peter Daniels AI" <${gmailUser}>`,
        to: email,
        subject: 'Добро пожаловать в Peter Daniels AI — Ваши данные для входа',
        html: htmlContent,
      });

      console.log('[Gmail SMTP] Successfully delivered welcome email to', email, 'MessageId:', info.messageId);
      return { success: true, provider: 'gmail', messageId: info.messageId };
    } catch (err: any) {
      console.error('[Gmail SMTP Error]', err?.message || err);
    }
  }

  // 2. Fallback: Resend REST API
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Peter Daniels AI <onboarding@resend.dev>',
          to: [email],
          subject: 'Добро пожаловать в Peter Daniels AI — Ваши данные для входа',
          html: htmlContent,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error('[Resend Email Error]', data);
        return { success: false, error: data };
      }

      console.log('[Resend API] Delivered welcome email to', email);
      return { success: true, provider: 'resend', data };
    } catch (err: any) {
      console.error('[Resend Network Error]', err);
      return { success: false, error: err.message };
    }
  }

  console.warn('[Email Service] Neither GMAIL credentials nor RESEND_API_KEY configured.');
  return { success: false, reason: 'No email transport configured' };
}
