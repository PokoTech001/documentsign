const { supabase } = require('./_supabase');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const { data: tokenRow, error: tokenError } = await supabase
      .from('tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (tokenError || !tokenRow) return res.status(404).json({ error: 'Invalid signing link' });

    if (new Date(tokenRow.expiry) < new Date()) {
      return res.status(410).json({ error: 'This signing link has expired' });
    }

    const { doc_id: docId, signer_id: signerId } = tokenRow;

    const [{ data: signer, error: signerError }, { data: document, error: docError }] = await Promise.all([
      supabase.from('signers').select('*').eq('id', signerId).single(),
      supabase.from('documents').select('*').eq('id', docId).single(),
    ]);

    if (signerError || docError || !signer || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (signer.status === 'signed') {
      return res.status(200).json({
        alreadySigned: true,
        documentName: document.name,
        signerName: signer.name,
      });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(`pdfs/${docId}/document.pdf`);
    if (downloadError) throw downloadError;

    const pdfBuffer = Buffer.from(await blob.arrayBuffer());

    res.status(200).json({
      alreadySigned: false,
      docId,
      signerId,
      documentName: document.name,
      signerName: signer.name,
      pdfData: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
      sigField: signer.sig_x != null
        ? { x: signer.sig_x, y: signer.sig_y, w: signer.sig_w, h: signer.sig_h, page: signer.sig_page || 1 }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
