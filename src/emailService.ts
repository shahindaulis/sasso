import nodemailer from 'nodemailer';

export async function sendVerificationEmail(
  toEmail: string,
  code: string,
  userId?: string
): Promise<{ success: boolean; message: string; previewCode?: string }> {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
  const rawPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : '';
  const pass = rawPass.replace(/\s+/g, '');
  const from = `sasso <${user || 'noreply@sasso.auth'}>`;

  if (!user || !pass) {
    console.log(`\n======================================================`);
    console.log(`📧 [SMTP DEV MODE] Email verification code for ${toEmail}: ${code}`);
    console.log(`======================================================\n`);
    return {
      success: true,
      message: 'Verification code generated! (Configure SMTP_USER & SMTP_PASS in .env for real Gmail delivery)',
      previewCode: code
    };
  }

  try {
    const isGmail = host.includes('gmail') || user.endsWith('@gmail.com');
    
    const transportConfig: any = isGmail
      ? {
          service: 'gmail',
          auth: { user, pass }
        }
      : {
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
          tls: { rejectUnauthorized: false }
        };

    const transporter = nodemailer.createTransport(transportConfig);

    await transporter.sendMail({
      from,
      to: toEmail,
      subject: 'sasso - Verification Code',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; color: #111827;">
          <h2 style="color: #4f46e5; margin-top: 0; margin-bottom: 16px; font-size: 22px; font-weight: 800;">sasso</h2>
          <p style="font-size: 15px; margin-bottom: 12px;">Hello <strong>${userId || 'User'}</strong>,</p>
          <p style="font-size: 14px; color: #374151; margin-bottom: 20px; line-height: 1.5;">Your verification code is:</p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; background-color: #f3f4f6; color: #4f46e5; padding: 12px 24px; border-radius: 8px; border: 1px solid #e5e7eb; display: inline-block;">${code}</span>
          </div>
          <p style="font-size: 13px; color: #6b7280; margin-top: 20px;">This code will expire in 15 minutes.</p>
        </div>
      `
    });

    return { success: true, message: 'Verification code sent to your email address!' };
  } catch (err: any) {
    console.error('SMTP Email Error:', err);
    return {
      success: false,
      message: `Failed to send email via SMTP: ${err.message}`,
      previewCode: code
    };
  }
}
