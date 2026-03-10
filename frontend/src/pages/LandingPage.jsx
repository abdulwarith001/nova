import React from "react";
import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import Features from "../components/Features";
import HowItWorks from "../components/HowItWorks";
import UseCases from "../components/UseCases";
import Architecture from "../components/Architecture";
import Skills from "../components/Skills";
import Footer from "../components/Footer";

const LandingPage = () => {
  return (
    <div className="bg-brand-bg text-brand-text selection:bg-brand-accent selection:text-brand-bg scroll-smooth">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <UseCases />
      <Architecture />
      <Skills />

      {/* CTA Section */}
      <section className="py-48 px-6 text-center bg-brand-bg border-t border-brand-border relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-accent/5 blur-[120px] rounded-full -z-10"></div>
        <div className="max-w-6xl mx-auto p-24 bg-brand-card border border-brand-accent/20 relative shadow-2xl group overflow-hidden">
          <div className="absolute top-0 left-0 w-2 h-full bg-brand-accent/30 group-hover:w-full transition-all duration-700 -z-10 opacity-5"></div>
          <h2 className="font-geom text-6xl md:text-9xl font-black mb-10 italic text-brand-text uppercase tracking-tightest leading-none">
            Ready to enter the <span className="text-brand-accent">Loop?</span>
          </h2>
          <p className="font-sans text-brand-text-muted text-xl md:text-2xl mb-16 max-w-2xl mx-auto font-medium leading-relaxed italic opacity-80">
            Join the future of autonomous agents. Deploy Nova locally and take
            full control of your intelligence. Sovereignty is non-negotiable.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-8 items-center">
            <button className="bg-brand-accent text-brand-bg px-14 py-7 font-black uppercase tracking-widest hover:scale-110 transition-all rounded-full text-xl italic shadow-[0_20px_40px_-10px_rgba(16,185,129,0.3)]">
              Initialize Engine
            </button>
            <button className="border-2 border-brand-accent/40 text-brand-accent px-14 py-7 font-black uppercase tracking-widest hover:bg-brand-accent hover:text-brand-bg transition-all rounded-full text-xl italic shadow-2xl">
              Source Terminal
            </button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default LandingPage;
