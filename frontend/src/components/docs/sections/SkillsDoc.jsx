import React from "react";

const SkillItem = ({ name, description, tools }) => (
  <div className="space-y-8">
    <div className="flex items-center space-x-6">
      <div className="w-14 h-14 bg-brand-accent flex items-center justify-center font-black text-brand-bg text-xl shadow-lg group-hover:rotate-12 transition-transform">
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={3}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>
      <h3 className="font-geom text-4xl font-black text-brand-text uppercase tracking-tightest italic leading-none">
        {name}
      </h3>
    </div>
    <p className="text-brand-text-muted leading-relaxed pl-20 font-medium italic">
      {description}
    </p>
    <div className="pl-20 overflow-x-auto">
      <table className="w-full text-left text-xs text-brand-text-muted border-separate border-spacing-y-4">
        <thead>
          <tr className="text-brand-text font-black uppercase tracking-[0.3em] text-[10px] opacity-40">
            <th className="pb-6 px-6">Tool_ID</th>
            <th className="pb-6 px-6 text-right">Function_Manifest</th>
          </tr>
        </thead>
        <tbody className="space-y-2">
          {tools.map((t, i) => (
            <tr
              key={i}
              className="bg-brand-card/50 backdrop-blur-md border border-brand-border group hover:bg-brand-accent/5 transition-all"
            >
              <td className="p-8 font-mono text-brand-accent font-black text-base tracking-tightest italic">
                {t.name}
              </td>
              <td className="p-8 text-right font-sans font-medium italic text-brand-text-muted leading-relaxed opacity-80 group-hover:opacity-100 group-hover:text-brand-text transition-all">
                {t.desc}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const SkillsDoc = () => {
  const skillsList = [
    {
      name: "Computer Skill",
      description: "Base-level system interaction. Enabled by default.",
      tools: [
        {
          name: "bash",
          desc: "Execute shell commands in the local environment.",
        },
        { name: "read", desc: "Read file contents with multi-line support." },
        { name: "write", desc: "Create or modify files on your machine." },
        { name: "curl", desc: "Perform raw HTTP requests." },
      ],
    },
    {
      name: "Web Browsing",
      description:
        "Advanced autonomous research. Requires visual analysis capabilities.",
      tools: [
        { name: "web_search", desc: "Search via Brave Search API." },
        {
          name: "browse",
          desc: "Open URL, take screenshot, and analyze layout.",
        },
        { name: "scrape", desc: "Extract clean readable text from pages." },
        {
          name: "web_act",
          desc: "Automated clicks, typing, and interactions.",
        },
      ],
    },
  ];

  return (
    <div className="prose prose-invert prose-emerald max-w-none">
      <h1 className="font-geom text-5xl md:text-7xl font-black mb-12 text-brand-text leading-none uppercase italic tracking-tightest">
        Skills & <span className="text-brand-accent">Extensions</span>
      </h1>
      <p className="font-sans text-xl text-brand-text-muted mb-20 leading-relaxed font-medium italic max-w-3xl">
        Nova's capabilities are modular. Skills are discovered at runtime from
        the{" "}
        <code className="text-brand-accent font-black px-2 bg-brand-accent/10 italic">
          skills/
        </code>{" "}
        directory.
      </p>

      <div className="space-y-16">
        {skillsList.map((s, i) => (
          <SkillItem key={i} {...s} />
        ))}
      </div>

      <div className="mt-32 p-12 bg-brand-card border border-brand-border relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 left-0 w-2 h-full bg-brand-accent/20"></div>
        <h4 className="font-geom text-3xl font-black mb-10 italic text-brand-text uppercase tracking-tightest leading-none">
          Skill Discovery <span className="text-brand-accent">Manifest</span>
        </h4>
        <p className="text-sm text-brand-text-muted mb-10 leading-relaxed font-medium italic">
          Every skill requires a{" "}
          <code className="text-brand-accent bg-brand-accent/5 px-2">
            SKILL.md
          </code>{" "}
          manifest file in its directory for Nova to recognize and load its
          tools.
        </p>
        <div className="bg-brand-bg p-12 border-l-8 border-brand-accent text-lg font-mono text-brand-accent font-black shadow-inner italic overflow-x-auto whitespace-pre">
          {`---
name: google-workspace
description: Full access to Gmail, Calendar, and Drive
env: GOOGLE_CLIENT_ID
---`}
        </div>
      </div>
    </div>
  );
};

export default SkillsDoc;
