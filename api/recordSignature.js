const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { documentId, vendorName, vendorEmail, signed } = req.body;

  try {
    await db.collection('signatures').add({
      documentId: documentId,
      vendorName: vendorName,
      vendorEmail: vendorEmail,
      signed: signed,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({ success: true, message: 'Signature recorded' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}