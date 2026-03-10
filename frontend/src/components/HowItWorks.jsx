import React from "react";

const Step = ({ number, title, text, isActive }) => (
  <div
    className={`p-12 border transition-all duration-500 relative group overflow-hidden ${isActive ? "bg-brand-card border-brand-accent shadow-[15px_15px_0px_0px_rgba(16,185,129,0.1)]" : "bg-transparent border-brand-border"}`}
  >
    <div className="absolute top-0 left-0 w-1 h-0 bg-brand-accent group-hover:h-full transition-all duration-500"></div>
    <div
      className={`w-16 h-16 flex items-center justify-center font-black mb-8 text-2xl italic shadow-lg transition-transform group-hover:rotate-12 ${isActive ? "bg-brand-accent text-brand-bg" : "bg-brand-card text-brand-text-muted border border-brand-border"}`}
    >
      {number}
    </div>
    <h4 className="font-geom text-3xl font-black text-brand-text mb-6 uppercase tracking-tightest italic leading-none group-hover:text-brand-accent transition-colors">
      {title}
    </h4>
    <p className="font-sans text-brand-text-muted leading-relaxed font-medium italic opacity-80 group-hover:opacity-100 transition-opacity">
      {text}
    </p>
  </div>
);

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="py-24 px-6 relative overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-24">
          <div className="lg:w-1/2">
            <h2 className="font-geom text-6xl md:text-8xl font-black text-brand-text mb-10 uppercase tracking-tightest italic leading-[0.8]">
              THE <br />
              <span className="text-brand-accent">OODA</span> <br />
              LOOP<span className="text-brand-accent">.</span>
            </h2>
            <p className="font-sans text-brand-text-muted text-xl mb-10 leading-relaxed font-medium italic opacity-80">
              Nova doesn't just respond; it thinks. Built around the
              military-grade OODA Loop, Nova self-corrects and adaptively plans
              every action in real-time.
            </p>
            <div className="flex items-center space-x-6 font-black text-[10px] uppercase tracking-[0.3em] italic">
              <span className="px-8 py-3 bg-brand-accent text-brand-bg shadow-lg">
                Continuous_Sync
              </span>
              <span className="px-8 py-3 border border-brand-accent/40 text-brand-accent">
                Self_Correcting
              </span>
            </div>
          </div>

          <div className="lg:w-1/2 grid grid-cols-2 gap-4">
            <Step
              number="1"
              title="Observe"
              text="Analyzes user intent, tone, urgency, and retrieves relevant memory context."
              isActive={true}
            />
            <Step
              number="2"
              title="Orient"
              text="Assesses approach, chooses tools, and decides if sub-agents are needed."
              isActive={true}
            />
            <Step
              number="3"
              title="Decide"
              text="Formulates a concrete strategy and plans the sequence of tool execution."
              isActive={true}
            />
            <Step
              number="4"
              title="Act"
              text="Executes tools in parallel, evaluates results, and recurses if necessary."
              isActive={true}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
