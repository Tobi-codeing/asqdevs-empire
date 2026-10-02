// Barrel for demo data. Structured data lives in ./data/*.

export * from './data/projects';
export * from './data/properties';

export const brand = {
  name: 'ASQDEVS EMPIRE',
  tagline: 'Digital systems for modern real-estate businesses.',
  whatsapp: 'https://wa.me/917404296309',
  whatsappNumber: '+91 74042 96309',
  email: 'contact@asqdevs.com',
  phone: '+917404296309',
} as const;

// The fictional business used inside the interactive demos.
export const demoCompany = {
  name: 'Delhi Homes',
  initials: 'DH',
  subtitle: 'Property Advisor',
} as const;

export const serviceOptions = [
  'Real Estate Website',
  'WhatsApp Automation',
  'AI Phone Receptionist',
  'Website + Automation',
  'Complete Digital System',
  'Something Else',
] as const;
