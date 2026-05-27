const { db } = require('./_firebase');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { docId } = req.query;
  if (!docId) return res.status(400).json({ error: 'docId required' });

  try {
    const [docSnap, signersSnap] = await Promise.all([
      db.collection('documents').doc(docId).get(),
      db.collection('documents').doc(docId).collection('signers').get(),
    ]);

    if (!docSnap.exists) return res.status(404).json({ error: 'Document not found' });

    const { name, status, createdAt } = docSnap.data();

    const signers = signersSnap.docs.map(d => {
      const { name: signerName, email, status: signerStatus, signedAt } = d.data();
      return { id: d.id, name: signerName, email, status: signerStatus, signedAt };
    });

    res.status(200).json({ docId, name, status, createdAt, signers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
