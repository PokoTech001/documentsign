const { supabase } = require('./_supabase');
const { Resend } = require('resend');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { docName, pdfData, signers, appUrl } = req.body;

  try {
    const docId = crypto.randomUUID();
    const base64 = pdfData.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');

    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(`pdfs/${docId}/document.pdf`, buffer, { contentType: 'application/pdf', upsert: true });
    if (storageError) throw storageError;

    const { error: docError } = await supabase.from('documents').insert({ id: docId, name: docName, status: 'pending' });
    if (docError) throw docError;

    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const signerResults = [];

    for (const signer of signers) {
      const signerId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const field = signer.sigField || {};

      const { error: signerError } = await supabase.from('signers').insert({
        id: signerId,
        doc_id: docId,
        name: signer.name,
        email: signer.email,
        token,
        status: 'pending',
        token_expiry: expiry,
        sig_x: field.x ?? null,
        sig_y: field.y ?? null,
        sig_w: field.w ?? null,
        sig_h: field.h ?? null,
        sig_page: field.page ?? 1,
      });
      if (signerError) throw signerError;

      const { error: tokenError } = await supabase.from('tokens').insert({ token, doc_id: docId, signer_id: signerId, expiry });
      if (tokenError) throw tokenError;

      const signingLink = `${appUrl}/sign.html?token=${token}`;

      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: signer.email,
        subject: `Action Required: Please Sign "${docName}"`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#1e40af;">Document Signature Request</h2>
            <p>Hi ${signer.name},</p>
            <p>You have been requested to sign: <strong>${docName}</strong></p>
            <p style="margin:30px 0;">
              <a href="${signingLink}" style="background:#2563eb;color:white;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
                Click Here to Sign
              </a>
            </p>
            <p style="color:#64748b;font-size:13px;">This link expires in 7 days.</p>
          </div>
        `,
      });

      signerResults.push({ id: signerId, name: signer.name, email: signer.email });
    }

    res.status(200).json({ success: true, docId, signers: signerResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
