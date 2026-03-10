import React from "react";
import Introduction from "../components/docs/sections/Introduction";
import GettingStarted from "../components/docs/sections/GettingStarted";
import FeaturesDoc from "../components/docs/sections/FeaturesDoc";
import ArchitectureDoc from "../components/docs/sections/ArchitectureDoc";
import SkillsDoc from "../components/docs/sections/SkillsDoc";
import MemorySystem from "../components/docs/sections/MemorySystem";

const categories = [
  {
    id: "core",
    title: "Core",
    sections: [
      { id: "intro", title: "Introduction", component: <Introduction /> },
      {
        id: "get-started",
        title: "Getting Started",
        component: <GettingStarted />,
      },
      {
        id: "architecture",
        title: "Architecture",
        component: <ArchitectureDoc />,
      },
    ],
  },
  {
    id: "intelligence",
    title: "Intelligence",
    sections: [
      { id: "features", title: "Capabilities", component: <FeaturesDoc /> },
      { id: "skills", title: "Modular Skills", component: <SkillsDoc /> },
      { id: "memory", title: "Memory System", component: <MemorySystem /> },
    ],
  },
];

const DocsPage = () => {
  const [activeCategory, setActiveCategory] = React.useState("core");
  const [activeTab, setActiveTab] = React.useState("intro");

  const currentCategory = categories.find((c) => c.id === activeCategory);
  const currentSection =
    currentCategory.sections.find((s) => s.id === activeTab) ||
    currentCategory.sections[0];

  return (
    <div className="flex bg-brand-bg text-brand-text min-h-screen font-sans selection:bg-brand-accent selection:text-brand-bg">
      {/* Sidebar */}
      <aside className="w-80 border-r border-brand-border p-10 hidden lg:flex flex-col h-screen sticky top-0 bg-brand-bg/50 backdrop-blur-md">
        <div
          className="flex items-center space-x-4 mb-16 group cursor-pointer"
          onClick={() => (window.location.href = "/")}
        >
          <div className="w-12 h-12 bg-brand-accent flex items-center justify-center font-black text-brand-bg text-xl group-hover:rotate-12 transition-transform shadow-lg">
            N
          </div>
          <span className="font-geom text-3xl font-black italic tracking-tighter text-brand-text">
            NOVA<span className="text-brand-accent">.</span>DOCS
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto">
          <div className="text-[10px] font-black text-brand-text-muted uppercase tracking-[3px] mb-8 px-4 opacity-40">
            {activeCategory.toUpperCase()} / SECTIONS
          </div>
          <ul className="space-y-2">
            {currentCategory.sections.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setActiveTab(s.id)}
                  className={`font-geom w-full text-left px-6 py-4 transition-all duration-300 text-sm font-black uppercase tracking-widest italic leading-none border-l-2 ${activeTab === s.id ? "border-brand-accent bg-brand-accent/5 text-brand-accent translate-x-1" : "border-transparent text-brand-text-muted/60 hover:text-brand-text hover:translate-x-1"}`}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-8 pt-8 border-t border-brand-border">
          <a
            href="/"
            className="text-[10px] font-black uppercase tracking-widest text-brand-text-muted/40 hover:text-brand-accent flex items-center space-x-3 transition-colors group"
          >
            <svg
              className="w-4 h-4 group-hover:-translate-x-2 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            <span>Back to Terminal</span>
          </a>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="h-20 border-b border-brand-border px-8 md:px-16 flex items-center justify-between sticky top-0 bg-brand-bg/80 backdrop-blur-xl z-20">
          <div className="flex items-center space-x-12">
            <nav className="flex space-x-8">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setActiveTab(cat.sections[0].id);
                  }}
                  className={`text-xs font-black uppercase tracking-[2px] transition-all relative py-2 ${activeCategory === cat.id ? "text-brand-accent" : "text-brand-text-muted hover:text-brand-text"}`}
                >
                  {cat.title}
                  {activeCategory === cat.id && (
                    <span className="absolute bottom-0 left-0 w-full h-0.5 bg-brand-accent"></span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="hidden md:flex items-center space-x-6">
            <div className="flex items-center space-x-2 bg-brand-card border border-brand-border px-4 py-2 rounded-full">
              <span className="w-2 h-2 bg-brand-accent rounded-full animate-pulse"></span>
              <span className="text-[10px] font-black text-brand-text-muted tracking-widest uppercase">
                System Stable
              </span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 p-8 md:p-24 overflow-y-auto">
          <div className="max-w-4xl">
            <div className="mb-16">
              <div className="text-[10px] font-black text-brand-accent uppercase tracking-[5px] mb-4">
                {activeCategory} / {activeTab}
              </div>
              <h1 className="font-geom text-6xl md:text-8xl font-black text-brand-text mb-8 uppercase tracking-tightest italic leading-none">
                {currentSection.title}
              </h1>
              <div className="w-24 h-2 bg-brand-accent"></div>
            </div>

            <div className="prose prose-invert prose-emerald max-w-none">
              {currentSection.component}
            </div>

            <div className="mt-32 pt-12 border-t border-brand-border flex flex-col sm:flex-row justify-between items-center text-[10px] text-brand-text-muted/40 font-black uppercase tracking-[3px] gap-6">
              <span className="italic">
                Memory Cycle: {new Date().toLocaleDateString()}
              </span>
              <div className="flex space-x-10">
                <a
                  href="https://github.com/abdulwarith001/nova"
                  className="hover:text-brand-accent transition-colors"
                >
                  Source_Terminal
                </a>
                <a
                  href="#"
                  className="hover:text-brand-accent transition-colors"
                >
                  Control_Center
                </a>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DocsPage;
