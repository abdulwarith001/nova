import React from "react";

const SkillCard = ({ name, count, description, icon }) => (
  <div className="p-10 bg-brand-card border border-brand-border hover:border-brand-accent transition-all duration-500 group relative overflow-hidden">
    <div className="absolute top-0 right-0 w-1 h-0 bg-brand-accent group-hover:h-full transition-all duration-500"></div>
    <div className="flex justify-between items-start mb-10">
      <div className="w-14 h-14 bg-brand-accent text-brand-bg flex items-center justify-center group-hover:rotate-12 transition-transform shadow-lg">
        {icon}
      </div>
      <span className="font-mono text-[10px] font-black bg-brand-accent text-brand-bg px-4 py-2 uppercase tracking-widest rounded-full">
        {count} CTX
      </span>
    </div>
    <h4 className="font-geom text-3xl font-black text-brand-text mb-4 uppercase tracking-tighter italic group-hover:text-brand-accent transition-colors">
      {name}
    </h4>
    <p className="font-sans text-brand-text-muted leading-relaxed font-medium italic">
      {description}
    </p>
  </div>
);

const Skills = () => {
  const skills = [
    {
      name: "Computer",
      count: 4,
      description:
        "Bash, Read, Write, and Curl. Direct system sovereignty for automation.",
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9.75 17L9 21h6l-.75-4M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      name: "Web Browsing",
      count: 9,
      description:
        "Visual analysis, scraping, and persistent browser sessions for research.",
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
          />
        </svg>
      ),
    },
    {
      name: "Google Workspace",
      count: 14,
      description: "Full automation for Gmail, Calendar, and Drive processes.",
      icon: (
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76"
          />
        </svg>
      ),
    },
  ];

  return (
    <section
      id="skills"
      className="py-32 px-6 bg-brand-bg border-t border-brand-border"
    >
      <div className="max-w-7xl mx-auto">
        <div className="mb-24 text-center md:text-left">
          <h2 className="font-geom text-6xl md:text-7xl font-black text-brand-text mb-12 uppercase tracking-tightest italic leading-[0.8]">
            MODULAR <br />
            <span className="text-brand-accent">SKILLS</span>
            <span className="text-brand-text">.</span>
          </h2>
          <p className="font-sans text-brand-text-muted text-xl mb-16 leading-relaxed font-medium italic opacity-80 max-w-2xl">
            Nova adapts to your workflow. Skills are loaded at runtime via
            standard Markdown manifests.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0 border border-brand-border">
          {skills.map((s, i) => (
            <SkillCard key={i} {...s} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default Skills;
