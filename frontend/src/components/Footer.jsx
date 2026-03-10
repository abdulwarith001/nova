import React from "react";

const Footer = () => {
  return (
    <footer className="py-24 px-6 border-t border-brand-border bg-brand-bg">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-10">
        <div className="flex flex-col items-center md:items-start group">
          <div className="flex items-center space-x-4 mb-8">
            <div className="w-12 h-12 bg-brand-accent flex items-center justify-center font-black text-brand-bg text-xl group-hover:rotate-12 transition-transform shadow-lg">
              N
            </div>
            <span className="font-geom text-3xl font-black tracking-tighter text-brand-text italic">
              NOVA
            </span>
          </div>
          <p className="font-sans text-brand-text-muted text-sm max-w-xs text-center md:text-left font-medium italic leading-relaxed">
            Building the foundation for autonomous, secure, and personal AI
            systems. Sovereignty by design.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-12 md:gap-24">
          <div className="flex flex-col space-y-4">
            <h4 className="font-geom text-brand-bg bg-brand-accent px-3 py-1 text-[10px] font-black uppercase tracking-[3px] w-fit rounded-full">
              PROJECT
            </h4>
            <a
              href="/docs"
              className="font-sans text-sm text-brand-text-muted hover:text-brand-accent transition-colors font-medium lowercase italic underline decoration-brand-accent/20 underline-offset-8"
            >
              Documentation
            </a>
            <a
              href="https://github.com/abdulwarith001/nova"
              className="font-sans text-sm text-brand-text-muted hover:text-brand-accent transition-colors font-medium lowercase italic underline decoration-brand-accent/20 underline-offset-8"
            >
              Source Code
            </a>
          </div>
          <div className="flex flex-col space-y-4">
            <h4 className="font-geom text-brand-bg bg-brand-text-muted px-3 py-1 text-[10px] font-black uppercase tracking-[3px] w-fit rounded-full">
              LEGAL
            </h4>
            <a
              href="#"
              className="font-sans text-sm text-brand-text-muted hover:text-brand-text transition-colors font-medium lowercase italic underline decoration-brand-text-muted/20 underline-offset-8"
            >
              Privacy Policy
            </a>
            <a
              href="#"
              className="font-sans text-sm text-brand-text-muted hover:text-brand-text transition-colors font-medium lowercase italic underline decoration-brand-text-muted/20 underline-offset-8"
            >
              License (MIT)
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-24 pt-10 border-t border-brand-border flex flex-col md:flex-row justify-between items-center gap-8">
        <p className="font-sans text-xs text-brand-text-muted/40 font-black tracking-widest uppercase italic">
          &copy; {new Date().getFullYear()} NOVA_SYSTEM // ALL RIGHTS RECLAIMED.
        </p>
        <div className="flex items-center space-x-8">
          <span className="font-mono text-[10px] text-brand-text-muted font-black uppercase tracking-[2px]">
            BUILD_4.0.0_PRODUCTION
          </span>
          <div className="w-2.5 h-2.5 bg-brand-accent animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.5)]"></div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
