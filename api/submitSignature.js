const { supabase } = require('./_supabase');
const { PDFDocument } = require('pdf-lib');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function generateFinalPDF(docId) {
  const { data: blob, error } = await supabase.storage
    .from('documents')
    .download(`pdfs/${docId}/document.pdf`);
  if (error) throw error;

  const pdfDoc = await PDFDocument.load(Buffer.from(await blob.arrayBuffer()));
  const firstPage = pdfDoc.getPages()[0];
  const { width } = firstPage.getSize();

  const { data: signers } = await supabase
    .from('signers')
    .select('signature_data, sig_x, sig_y, sig_w, sig_h')
    .eq('doc_id', docId)
    .order('signed_at', { ascending: true });

  for (const signer of signers) {
    if (!signer.signature_data) continue;

    const sigBuffer = Buffer.from(signer.signature_data.split(',')[1], 'base64');
    const isJpeg = signer.signature_data.startsWith('data:image/jpeg') ||
                   signer.signature_data.startsWith('data:image/jpg');
    const sigImage = isJpeg
      ? await pdfDoc.embedJpg(sigBuffer)
      : await pdfDoc.embedPng(sigBuffer);

    if (signer.sig_x != null) {
      firstPage.drawImage(sigImage, { x: signer.sig_x, y: signer.sig_y, width: signer.sig_w, height: signer.sig_h });
    } else {
      // Fallback: stack at bottom-right if no field was placed
      const sw = width * 0.25;
      const sh = sigImage.height * (sw / sigImage.width);
      firstPage.drawImage(sigImage, { x: width - sw - 20, y: 30, width: sw, height: sh });
    }
  }

  const finalBuffer = Buffer.from(await pdfDoc.save());

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(`pdfs/${docId}/final.pdf`, finalBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (uploadError) throw uploadError;

  return finalBuffer;
}

async function emailFinalPDF(docId, finalBuffer) {
  const { data: document } = await supabase.from('documents').select('name').eq('id', docId).single();
  const { data: signers } = await supabase.from('signers').select('email').eq('doc_id', docId);

  for (const signer of signers) {
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: signer.email,
      subject: `Fully Signed: "${document.name}"`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#166534;">All Parties Have Signed</h2>
          <p>The document <strong>${document.name}</strong> has been signed by all parties.</p>
          <p>Please find the fully signed document attached.</p>
        </div>
      `,
      attachments: [{
        filename: `signed_${document.name}`,
        content: finalBuffer,
      }],
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { token, signatureData } = req.body;

  try {
    const { data: tokenRow, error: tokenError } = await supabase
      .from('tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (tokenError || !tokenRow) return res.status(404).json({ error: 'Invalid token' });

    if (new Date(tokenRow.expiry) < new Date()) {
      return res.status(410).json({ error: 'Signing link has expired' });
    }

    const { doc_id: docId, signer_id: signerId } = tokenRow;

    const { data: signer } = await supabase.from('signers').select('status').eq('id', signerId).single();
    if (signer.status === 'signed') {
      return res.status(400).json({ error: 'Already signed' });
    }

    await supabase.from('signers').update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signature_data: signatureData,
    }).eq('id', signerId);

    const { data: allSigners } = await supabase
      .from('signers')
      .select('status')
      .eq('doc_id', docId);

    const allSigned = allSigners.every(s => s.status === 'signed');

    if (allSigned) {
      const finalBuffer = await generateFinalPDF(docId);
      await supabase.from('documents').update({ status: 'completed' }).eq('id', docId);
      await emailFinalPDF(docId, finalBuffer);
    }

    res.status(200).json({ success: true, allSigned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
