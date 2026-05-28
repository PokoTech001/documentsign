const { supabase } = require('./_supabase');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { docId } = req.query;
  if (!docId) return res.status(400).json({ error: 'docId required' });

  try {
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', docId)
      .single();

    if (docError || !document) return res.status(404).json({ error: 'Document not found' });

    const { data: signers, error: signersError } = await supabase
      .from('signers')
      .select('id, name, email, status, signed_at')
      .eq('doc_id', docId);

    if (signersError) throw signersError;

    res.status(200).json({
      docId,
      name: document.name,
      status: document.status,
      createdAt: document.created_at,
      finalHash: document.final_hash || null,
      signers: signers.map(s => ({
        id: s.id,
        name: s.name,
        email: s.email,
        status: s.status,
        signedAt: s.signed_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
