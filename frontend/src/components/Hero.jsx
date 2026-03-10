import React from "react";

const Hero = () => {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-20 pb-20 overflow-hidden bg-brand-bg">
      {/* Background Orbs & Texture */}
      <div className="absolute inset-0 -z-10 bg-brand-bg">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-accent/5 blur-[150px] rounded-full"></div>
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 blur-[120px] rounded-full"></div>
      </div>

      <div className="max-w-7xl mx-auto px-6 text-center z-10">
        <h1 className="font-geom text-7xl md:text-[8rem] font-black mb-12 tracking-tightest leading-[0.8] uppercase italic text-brand-text">
          AUTO
          <span className="relative inline-block px-8 group">
            NOMOUS
            <span className="absolute inset-x-0 inset-y-4 bg-brand-accent/10 backdrop-blur-3xl border border-brand-accent/30 -skew-x-12 -z-10 shadow-[0_0_80px_rgba(16,185,129,0.2)] group-hover:scale-110 transition-transform duration-700"></span>
          </span>
          <br />
          REASONING.
        </h1>

        <p className="font-sans text-xl md:text-2xl text-brand-text-muted mb-20 max-w-4xl mx-auto font-medium leading-relaxed italic opacity-80 decoration-brand-accent/30 underline decoration-2 underline-offset-10">
          The autonomous reasoning engine for high-stakes workflows.
        </p>

        <div className="flex flex-col md:flex-row items-center justify-center gap-10 mb-32">
          <div className="relative group">
            <div className="absolute -inset-1 bg-brand-accent/30 blur-2xl opacity-0 group-hover:opacity-100 transition duration-1000 rounded-full"></div>
            <code className="relative flex items-center bg-brand-card/90 backdrop-blur-xl border border-brand-accent/40 px-16 py-10 font-mono text-brand-accent text-2xl font-black rounded-full shadow-2xl group-hover:scale-105 transition-all">
              <span className="mr-6 text-brand-text-muted/30">$</span> npm
              install -g novaa-agent
            </code>
          </div>
          <button className="px-16 py-10 bg-brand-text text-brand-bg rounded-full font-black text-2xl hover:scale-110 transition-all shadow-[0_30px_60px_-15px_rgba(240,236,229,0.4)] uppercase italic tracking-tightest">
            Deploy_Loop ⚡
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 md:gap-24 max-w-6xl mx-auto border-t border-brand-border/30 pt-24">
          {[
            { label: "Local-First", sub: "FULL_SOVEREIGNTY" },
            { label: "OODA Loop", sub: "DEEP_COGNITION" },
            { label: "Multi-Tool", sub: "PARALLEL_EXEC" },
            { label: "Markdown", sub: "OPEN_MEMORY_STORE" },
          ].map((item, i) => (
            <div key={i} className="group cursor-default">
              <div className="text-4xl font-black text-brand-text mb-4 uppercase tracking-tightest italic group-hover:text-brand-accent transition-colors leading-none">
                {item.label}
              </div>
              <div className="text-[10px] text-brand-text-muted font-black uppercase tracking-[0.4em] opacity-30 group-hover:opacity-100 transition-opacity whitespace-nowrap italic">
                {item.sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Hero;
