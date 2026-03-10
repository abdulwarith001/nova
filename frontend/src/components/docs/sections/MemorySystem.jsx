import React from "react";

const MemorySystem = () => (
  <div className="prose prose-invert prose-emerald max-w-none font-sans">
    <h1 className="font-geom text-5xl md:text-7xl font-black mb-12 text-brand-text leading-none uppercase italic tracking-tightest">
      Markdown <span className="text-brand-accent">Memory</span>
    </h1>
    <p className="font-sans text-xl text-brand-text-muted mb-20 leading-relaxed font-medium italic max-w-3xl">
      Sovereignty starts with data ownership. Nova stores everything in
      plain-text files on your disk. Open-source recall by design.
    </p>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-20">
      <div className="space-y-6">
        <h3 className="font-geom text-2xl font-black text-brand-text uppercase italic tracking-tighter">
          Open File Layout
        </h3>
        <p className="text-brand-text-muted leading-relaxed font-medium italic">
          All memory lives in{" "}
          <code className="text-brand-accent bg-brand-accent/5 px-2">
            ~/.nova/memory/
          </code>
          . You can edit these files directly with any text editor to update
          your agent's knowledge.
        </p>
        <ul className="space-y-4 text-xs font-mono text-brand-accent bg-brand-card/50 backdrop-blur-md border border-brand-border p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-brand-accent/20"></div>
          <li className="flex items-center space-x-3">
            <span className="opacity-40">├──</span> <span>conversations/</span>{" "}
            <span className="text-[10px] opacity-40 uppercase ml-auto">
              Chat Logs
            </span>
          </li>
          <li className="flex items-center space-x-3">
            <span className="opacity-40">├──</span> <span>user.md</span>{" "}
            <span className="text-[10px] opacity-40 uppercase ml-auto">
              Your Traits
            </span>
          </li>
          <li className="flex items-center space-x-3">
            <span className="opacity-40">├──</span> <span>knowledge.md</span>{" "}
            <span className="text-[10px] opacity-40 uppercase ml-auto">
              Facts Learned
            </span>
          </li>
          <li className="flex items-center space-x-3">
            <span className="opacity-40">├──</span>{" "}
            <span>relationships.md</span>{" "}
            <span className="text-[10px] opacity-40 uppercase ml-auto">
              People
            </span>
          </li>
          <li className="flex items-center space-x-3">
            <span className="opacity-40">└──</span> <span>identity.md</span>{" "}
            <span className="text-[10px] opacity-40 uppercase ml-auto">
              Agent Self
            </span>
          </li>
        </ul>
      </div>

      <div className="bg-brand-card/30 backdrop-blur-3xl border border-brand-border p-10 flex flex-col justify-center relative group">
        <div className="absolute inset-0 bg-brand-accent/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
        <div className="text-center mb-8 relative">
          <div className="text-[10px] font-black text-brand-text-muted uppercase tracking-[0.4em] mb-4 opacity-40">
            Context Assembler
          </div>
          <div className="w-24 h-1 bg-brand-accent mx-auto"></div>
        </div>
        <p className="text-brand-text-muted italic text-center leading-relaxed font-medium text-sm relative">
          "Before every thought, Nova reads through its Markdown memory and
          assembles a real-time{" "}
          <span className="text-brand-text font-black not-italic px-1">
            'current context'
          </span>{" "}
          to inform its decision making."
        </p>
      </div>
    </div>

    <h2 className="font-geom text-3xl font-black text-brand-text mb-8 italic uppercase tracking-tighter">
      Auditing Memories
    </h2>
    <p className="text-brand-text-muted mb-12 leading-relaxed font-medium italic">
      You can use the CLI to manage what Nova remembers. Use{" "}
      <code className="text-brand-accent bg-brand-accent/5 px-2">
        nova memory list
      </code>
      to see stored facts, or{" "}
      <code className="text-brand-accent bg-brand-accent/5 px-2">
        nova memory forget
      </code>{" "}
      to remove sensitive information.
    </p>

    <div className="p-10 border border-brand-accent/30 bg-brand-accent/5 relative overflow-hidden group">
      <div className="absolute top-0 right-0 w-24 h-24 bg-brand-accent opacity-10 blur-3xl rounded-full transition-transform group-hover:scale-150"></div>
      <p className="text-xs text-brand-accent leading-relaxed uppercase tracking-[0.5em] font-black italic text-center">
        NO BLACK BOXES. NO CLOUD LOCK-IN. JUST MARKDOWN.
      </p>
    </div>
  </div>
);

export default MemorySystem;
