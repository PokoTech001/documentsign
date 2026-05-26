const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, vendorName, documentName, appLink } = req.body;

  const msg = {
    to: to,
    from: 'noreply@signflow.app', // Change to your verified email
    subject: `Please Sign: ${documentName}`,
    html: `
      <h2>Document Signature Request</h2>
      <p>Hi ${vendorName},</p>
      <p>I need you to review and sign the document: <strong>${documentName}</strong></p>
      
      <p><a href="${appLink}" style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
        Click Here to Sign Document
      </a></p>
      
      <p>Steps:</p>
      <ol>
        <li>Click the link above</li>
        <li>Find the document: ${documentName}</li>
        <li>Click "Open"</li>
        <li>Click "✍️ Sign Document"</li>
        <li>Choose: Draw, Upload, or Type Name</li>
        <li>Click "✓ Use This Signature"</li>
      </ol>
      
      <p>Your signature will appear immediately.</p>
      <p>Thank you!</p>
    `,
  };

  try {
    await sgMail.send(msg);
    res.status(200).json({ success: true, message: 'Email sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
