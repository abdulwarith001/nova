import React from "react";

const Introduction = () => (
  <div className="prose prose-invert prose-emerald max-w-none">
    <h2 className="font-geom text-5xl font-black text-brand-text mb-10 uppercase tracking-tighter italic leading-none">
      Introduction to <span className="text-brand-accent">Nova</span>
    </h2>
    <p className="font-sans text-xl text-brand-text-muted leading-relaxed max-w-3xl font-medium italic">
      Nova is an autonomous, open-source reasoning engine designed for privacy,
      security, and high-performance agency. Sovereignty by design.
    </p>

    <div className="bg-brand-card border border-brand-border p-10 mb-16 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 left-0 w-2 h-full bg-brand-accent/20"></div>
      <h3 className="font-geom text-2xl font-black text-brand-text mb-6 uppercase italic tracking-tighter">
        Core Philosophy
      </h3>
      <p className="text-brand-text-muted leading-relaxed mb-8 italic">
        Nova is built around three core pillars that define its existence and
        operation:
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="p-6 bg-brand-bg border border-brand-border">
          <div className="text-brand-accent font-black uppercase tracking-widest mb-3 italic">
            Evolve.
          </div>
          <p className="text-xs text-brand-text-muted font-medium">
            Continuous learning and adaptation to user preferences.
          </p>
        </div>
        <div className="p-6 bg-brand-bg border border-brand-border">
          <div className="text-brand-text font-black uppercase tracking-widest mb-3 italic">
            Execute.
          </div>
          <p className="text-xs text-brand-text-muted font-medium">
            Autonomous multi-step tool use in parallel threads.
          </p>
        </div>
        <div className="p-6 bg-brand-bg border border-brand-border">
          <div className="text-brand-text font-black uppercase tracking-widest mb-3 italic">
            Empower.
          </div>
          <p className="text-xs text-brand-text-muted font-medium">
            Sovereign control over your data and local environment.
          </p>
        </div>
      </div>
    </div>

    <h2 className="font-geom text-3xl font-black text-brand-text mb-6 uppercase italic tracking-tighter">
      Why Nova?
    </h2>
    <p className="text-brand-text-muted mb-10 leading-relaxed font-medium italic">
      Standard AI bots often lack the ability to effectively plan and execute
      long-running tasks. They are reactive and context-limited. Nova is
      proactive, maintains a persistent Markdown-first memory, and utilizes a
      military-grade OODA Loop for reasoning depth.
    </p>

    <div className="grid grid-cols-2 gap-8 mb-16">
      <div className="p-6 border-l-4 border-brand-accent bg-brand-accent/5">
        <h4 className="text-brand-text font-black uppercase tracking-widest italic mb-2">
          Observe → Orient
        </h4>
        <p className="text-xs text-brand-text-muted font-medium">
          Deep analysis of intent before any action.
        </p>
      </div>
      <div className="p-6 border-l-4 border-brand-text-muted bg-brand-text-muted/5">
        <h4 className="text-brand-text font-black uppercase tracking-widest italic mb-2">
          Decide → Act
        </h4>
        <p className="text-xs text-brand-text-muted font-medium">
          Strategic execution with tool-chaining.
        </p>
      </div>
    </div>
  </div>
);

export default Introduction;
