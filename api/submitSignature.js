const { db } = require('./_firebase');
const { supabase } = require('./_supabase');
const { PDFDocument } = require('pdf-lib');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function generateFinalPDF(docId) {
  const { data: blob, error } = await supabase.storage
    .from('documents')
    .download(`pdfs/${docId}/document.pdf`);

  if (error) throw error;

  const pdfBuffer = Buffer.from(await blob.arrayBuffer());
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const firstPage = pdfDoc.getPages()[0];
  const { width } = firstPage.getSize();

  const signersSnap = await db.collection('documents').doc(docId)
    .collection('signers').orderBy('signedAt').get();

  const sigWidth = width * 0.25;
  let yOffset = 30;

  for (const snap of signersSnap.docs) {
    const { signatureData } = snap.data();
    if (!signatureData) continue;

    const sigBase64 = signatureData.split(',')[1];
    const sigBuffer = Buffer.from(sigBase64, 'base64');

    const isJpeg = signatureData.startsWith('data:image/jpeg') ||
                   signatureData.startsWith('data:image/jpg');
    const sigImage = isJpeg
      ? await pdfDoc.embedJpg(sigBuffer)
      : await pdfDoc.embedPng(sigBuffer);

    const sh = sigImage.height * (sigWidth / sigImage.width);
    firstPage.drawImage(sigImage, { x: width - sigWidth - 20, y: yOffset, width: sigWidth, height: sh });
    yOffset += sh + 15;
  }

  const finalBytes = await pdfDoc.save();
  const finalBuffer = Buffer.from(finalBytes);

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
  const [docSnap, signersSnap] = await Promise.all([
    db.collection('documents').doc(docId).get(),
    db.collection('documents').doc(docId).collection('signers').get(),
  ]);

  const { name } = docSnap.data();
  const base64PDF = finalBuffer.toString('base64');
  const emails = signersSnap.docs.map(d => d.data().email);

  for (const email of emails) {
    await sgMail.send({
      to: email,
      from: process.env.FROM_EMAIL,
      subject: `Fully Signed: "${name}"`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#166534;">All Parties Have Signed</h2>
          <p>The document <strong>${name}</strong> has been signed by all parties.</p>
          <p>Please find the fully signed document attached.</p>
        </div>
      `,
      attachments: [{
        content: base64PDF,
        filename: `signed_${name}`,
        type: 'application/pdf',
        disposition: 'attachment',
      }],
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { token, signatureData } = req.body;

  try {
    const tokenDoc = await db.collection('tokens').doc(token).get();
    if (!tokenDoc.exists) return res.status(404).json({ error: 'Invalid token' });

    const { docId, signerId, expiry } = tokenDoc.data();

    if (new Date(expiry) < new Date()) {
      return res.status(410).json({ error: 'Signing link has expired' });
    }

    const signerRef = db.collection('documents').doc(docId)
      .collection('signers').doc(signerId);
    const signerSnap = await signerRef.get();

    if (signerSnap.data().status === 'signed') {
      return res.status(400).json({ error: 'Already signed' });
    }

    await signerRef.update({
      status: 'signed',
      signedAt: new Date().toISOString(),
      signatureData,
    });

    const allSignersSnap = await db.collection('documents').doc(docId)
      .collection('signers').get();
    const allSigned = allSignersSnap.docs.every(d =>
      d.id === signerId ? true : d.data().status === 'signed'
    );

    if (allSigned) {
      const finalBuffer = await generateFinalPDF(docId);
      await db.collection('documents').doc(docId).update({ status: 'completed' });
      await emailFinalPDF(docId, finalBuffer);
    }

    res.status(200).json({ success: true, allSigned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
