import Navigation from '@/components/navigation/Navigation';
import Hero from '@/components/hero/Hero';
import Portfolio from '@/components/portfolio/Portfolio';
import WhatsAppSection from '@/components/whatsapp/WhatsAppSection';
import PhoneSection from '@/components/phone/PhoneSection';
import ConnectedSystem from '@/components/shared/ConnectedSystem';
import WhySection from '@/components/shared/WhySection';
import Contact from '@/components/contact/Contact';
import Footer from '@/components/shared/Footer';
import { portfolioProjects } from '@/lib/data';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0a0a0a]">
      <Navigation />
      <Hero />
      <Portfolio projects={portfolioProjects} />
      <WhatsAppSection />
      <PhoneSection />
      <ConnectedSystem />
      <WhySection />
      <Contact />
      <Footer />
    </main>
  );
}
