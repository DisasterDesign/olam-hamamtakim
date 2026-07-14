/**
 * Cloudflare Pages Function — POST /api/contact
 * Receives the site contact form and emails the lead via Resend.
 * Pattern copied from roza-rehovot-website (canonical landing-page contact primitive).
 *
 * Required env (set on the Pages project, NOT in source):
 *   RESEND_API_KEY   — Resend API key (secret)
 * Optional env (sensible defaults below):
 *   EMAIL_TO         — recipient inbox (default: olamhamamtakim@gmail.com)
 *   EMAIL_FROM       — verified Resend sender (default: noreply@olamhamamtakim.co.il)
 */

const DEFAULT_TO = 'olamhamamtakim@gmail.com';
const DEFAULT_FROM = 'עולם הממתקים <noreply@olamhamamtakim.co.il>';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // Accept both multipart/form-data (current frontend) and JSON.
    const contentType = request.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await request.json();
    } else {
      const form = await request.formData();
      data = Object.fromEntries(form.entries());
    }

    const name = (data.name || '').toString().trim().slice(0, 200);
    const phone = (data.phone || '').toString().trim().slice(0, 50);
    const email = (data.email || '').toString().trim().slice(0, 200);
    const subject = (data.subject || '').toString().trim().slice(0, 100);
    const message = (data.message || '').toString().trim().slice(0, 5000);
    const honeypot = (data._honey || data._gotcha || '').toString().trim();

    // Honeypot: a real user never fills this hidden field. Pretend success.
    if (honeypot) return json({ success: true });

    if (!name || !phone || !subject) {
      return json({ success: false, error: 'missing_fields' }, 400);
    }

    if (!env.RESEND_API_KEY) {
      return json({ success: false, error: 'not_configured' }, 500);
    }

    const to = (env.EMAIL_TO || DEFAULT_TO).trim();
    const from = (env.EMAIL_FROM || DEFAULT_FROM).trim();

    const safeName = escapeHtml(name);
    const safePhone = escapeHtml(phone);
    const safeEmail = email ? escapeHtml(email) : '';
    const safeSubject = escapeHtml(subject);
    const safeMessage = message ? escapeHtml(message).replace(/\n/g, '<br>') : '—';

    const html = `
      <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#222">
        <h2 style="margin:0 0 12px">פנייה חדשה מאתר עולם הממתקים</h2>
        <p style="margin:4px 0"><strong>שם:</strong> ${safeName}</p>
        <p style="margin:4px 0"><strong>טלפון:</strong> <a href="tel:${safePhone}">${safePhone}</a></p>
        ${safeEmail ? `<p style="margin:4px 0"><strong>אימייל:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>` : ''}
        <p style="margin:4px 0"><strong>נושא:</strong> ${safeSubject}</p>
        <p style="margin:4px 0"><strong>הודעה:</strong><br>${safeMessage}</p>
      </div>`;

    const payload = {
      from,
      to: [to],
      subject: `פנייה חדשה מהאתר — ${subject} — ${name}`,
      html,
    };
    if (email && EMAIL_RE.test(email)) payload.reply_to = email;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Log provider detail server-side only (visible via `wrangler pages deployment tail`).
      console.error('Resend send failed', res.status, await res.text());
      return json({ success: false, error: 'send_failed' }, 502);
    }

    return json({ success: true });
  } catch (err) {
    console.error('contact function exception', err);
    return json({ success: false, error: 'exception' }, 500);
  }
}
