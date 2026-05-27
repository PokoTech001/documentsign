const { db } = require('./_firebase');
const { supabase } = require('./_supabase');
const crypto = require('crypto');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name, data } = req.body;

  try {
    const docId = crypto.randomUUID();
    const base64 = data.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');

    const { error } = await supabase.storage
      .from('documents')
      .upload(`pdfs/${docId}/document.pdf`, buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) throw error;

    await db.collection('documents').doc(docId).set({
      name,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    res.status(200).json({ success: true, docId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
