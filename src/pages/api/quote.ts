import nodemailer from 'nodemailer';

export const prerender = false;

function makeLabelSafe(value: string | null | undefined, fallback: string) {
  return value && value.trim() ? value.trim() : fallback;
}

async function analyzeWithOpenAI(files: File[]) {
  if (!process.env.OPENAI_API_KEY || files.length === 0) {
    return 'AI pricing review is ready once an OpenAI API key is configured in the environment.';
  }

  const prompt = `Review the uploaded project photos and provide a brief, practical estimate recommendation for a construction or restoration quote. Focus on type of damage or scope, likely severity, and any obvious issues for pricing or planning. Keep the response concise and practical for a homeowner or contractor.`;

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      ...await Promise.all(files.map(async (file) => {
        const bytes = Buffer.from(await file.arrayBuffer());
        const mime = file.type || 'image/jpeg';
        const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
        return {
          type: 'image_url',
          image_url: { url: dataUrl }
        };
      }))
    ]
  }];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.4,
      max_tokens: 400
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI analysis failed:', errorText);
    return 'AI pricing review could not run. The site was still able to send the quote request for manual review.';
  }

  const result = await response.json();
  const assistantText = result?.choices?.[0]?.message?.content;

  return assistantText || 'AI image review completed. Please confirm with a site visit and final scope review.';
}

export async function POST({ request }: { request: Request }) {
  const formData = await request.formData();
  const name = makeLabelSafe(String(formData.get('name') || ''), 'Customer');
  const email = makeLabelSafe(String(formData.get('email') || ''), 'No email provided');
  const phone = makeLabelSafe(String(formData.get('phone') || ''), 'No phone provided');
  const projectType = makeLabelSafe(String(formData.get('projectType') || ''), 'General');
  const scope = makeLabelSafe(String(formData.get('scope') || ''), 'Not specified');
  const insuranceJob = makeLabelSafe(String(formData.get('insuranceJob') || ''), 'No');
  const location = makeLabelSafe(String(formData.get('location') || ''), 'Not specified');
  const details = makeLabelSafe(String(formData.get('details') || ''), 'No project details provided');
  const imageFiles = formData.getAll('images').filter((item): item is File => item instanceof File && item.size > 0);

  const aiSummary = await analyzeWithOpenAI(imageFiles);

  const emailText = [
    'Lara Bear Construction Quote Request',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    `Project Type: ${projectType}`,
    `Scope of Work: ${scope}`,
    `Insurance Job: ${insuranceJob}`,
    `Service Area: ${location}`,
    '',
    'Project Details:',
    details,
    '',
    'AI Pricing Review:',
    aiSummary,
    ''
  ].join('\n');

  const contactEmail = process.env.CONTACT_EMAIL || 'larabearco@outlook.com';

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: contactEmail,
      subject: `Detailed Quote Request - ${projectType}`,
      text: emailText,
      attachments: await Promise.all(
        imageFiles.map(async (file) => ({
          filename: file.name,
          content: Buffer.from(await file.arrayBuffer()),
          contentType: file.type || 'application/octet-stream'
        }))
      )
    });

    return Response.json({
      success: true,
      message: 'Your request was sent successfully. Our team will follow up shortly.'
    });
  }

  return Response.json({
    success: true,
    message: 'Your request was prepared successfully. Please send it via your email app or configure SMTP to send automatically.',
    fallbackMailto: `mailto:${contactEmail}?subject=${encodeURIComponent(`Detailed Quote Request - ${projectType}`)}&body=${encodeURIComponent(emailText)}`
  });
}
