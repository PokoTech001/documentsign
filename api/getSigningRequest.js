const { db } = require('./_firebase');
const { supabase } = require('./_supabase');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const tokenDoc = await db.collection('tokens').doc(token).get();
    if (!tokenDoc.exists) return res.status(404).json({ error: 'Invalid signing link' });

    const { docId, signerId, expiry } = tokenDoc.data();

    if (new Date(expiry) < new Date()) {
      return res.status(410).json({ error: 'This signing link has expired' });
    }

    const [signerDoc, documentDoc] = await Promise.all([
      db.collection('documents').doc(docId).collection('signers').doc(signerId).get(),
      db.collection('documents').doc(docId).get(),
    ]);

    if (!signerDoc.exists || !documentDoc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const signerData = signerDoc.data();
    const documentData = documentDoc.data();

    if (signerData.status === 'signed') {
      return res.status(200).json({
        alreadySigned: true,
        documentName: documentData.name,
        signerName: signerData.name,
      });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(`pdfs/${docId}/document.pdf`);

    if (downloadError) throw downloadError;

    const pdfBuffer = Buffer.from(await blob.arrayBuffer());
    const pdfBase64 = pdfBuffer.toString('base64');

    res.status(200).json({
      alreadySigned: false,
      docId,
      signerId,
      documentName: documentData.name,
      signerName: signerData.name,
      pdfData: `data:application/pdf;base64,${pdfBase64}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
