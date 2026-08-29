"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldCheck, KeyRound, Sparkles } from "lucide-react";

import { AgentMandiLogo } from "@/components/logo";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [architectId, setArchitectId] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      router.push("/dashboard");
    }, 800);
  };

  return (
    <main className="min-h-screen bg-[#131314] text-[#e5e2e3] font-sans antialiased overflow-hidden selection:bg-[#ffb77b] selection:text-[#2e1500]">
      {/* Background 3D Face Wireframe Animation (Left Side, Vivid Holographic) */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-full md:w-3/4 overflow-hidden z-0">
        <img
          src="/login.gif"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover object-left opacity-90"
        />
        {/* Soft directional gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#131314]/30 via-transparent to-[#131314]" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#131314] via-transparent to-[#131314]/40" />
      </div>

      {/* Ambient glowing radial orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_25%_25%,rgba(255,183,123,0.15),transparent_40%),radial-gradient(circle_at_75%_75%,rgba(177,109,46,0.12),transparent_50%)]" />

      {/* Cybernetic grid overlay */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(rgba(229,226,227,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(229,226,227,0.15)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.06]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-between px-6 py-6 sm:px-10">
        {/* Top Header */}
        <header className="flex items-center justify-between">
          <Link href="/" className="transition hover:opacity-90">
            <AgentMandiLogo size={30} textClassName="text-lg tracking-[0.16em]" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold tracking-[0.2em] text-mute-300 uppercase backdrop-blur-md transition-all hover:border-[#ffb77b]/40 hover:text-[#ffb77b]"
          >
            <ArrowLeft size={13} />
            BACK
          </Link>
        </header>

        {/* Main Content Grid */}
        <section className="grid grow items-center gap-12 py-12 lg:grid-cols-[1.1fr_460px]">
          {/* Left Intro Column */}
          <div className="max-w-xl">
            <p className="mb-4 font-mono text-[10px] tracking-[0.38em] text-[#ffb77b] uppercase">
              CORE PROTOCOL v0.1 // MANDATE GATEWAY
            </p>

            <h1 className="font-serif text-[56px] leading-[0.9] font-normal italic text-[#e5e2e3] sm:text-[76px] md:text-[88px]">
              Initialize
              <br />
              Session
            </h1>

            <p className="mt-8 max-w-md text-[16px] leading-relaxed text-[#c7b0a6]">
              Entry point for the architectural orchestration of live AI agent commerce. Secure cryptographic access required for mandate control.
            </p>

            <div className="mt-10 flex items-center gap-6 text-[12px] font-mono text-mute-400">
              <span className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-pass-500" />
                <span>Zero Private Key Storage</span>
              </span>
              <span className="flex items-center gap-2">
                <KeyRound size={14} className="text-[#ffb77b]" />
                <span>HMAC-SHA256 Signed</span>
              </span>
            </div>
          </div>

          {/* Right Auth Panel */}
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[#141416]/90 p-8 shadow-2xl backdrop-blur-xl">
            {/* Left amber highlight bar */}
            <div className="absolute top-0 bottom-0 left-0 w-1 bg-gradient-to-b from-[#ffd0a8] via-[#ffb77b] to-[#b16d2e]" />

            {/* System status indicator */}
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              <p className="font-mono text-[10px] tracking-[0.24em] text-mute-400 uppercase">
                SYSTEM STATUS: <span className="text-[#ffb77b] font-semibold">AWAITING AUTH</span>
              </p>
              <span className="size-2 rounded-full bg-[#ffb77b] animate-pulse shadow-[0_0_8px_#ffb77b]" />
            </div>

            {/* Tab switch */}
            <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl bg-white/[0.04] p-1 border border-white/[0.06]">
              <button
                type="button"
                onClick={() => setTab("login")}
                className={`py-2 text-[11px] font-bold tracking-[0.2em] transition-all rounded-lg ${
                  tab === "login"
                    ? "bg-gradient-to-r from-[#ffd0a8] to-[#ffb77b] text-[#2e1500] shadow-md"
                    : "text-mute-400 hover:text-white"
                }`}
              >
                LOGIN
              </button>
              <button
                type="button"
                onClick={() => setTab("register")}
                className={`py-2 text-[11px] font-bold tracking-[0.2em] transition-all rounded-lg ${
                  tab === "register"
                    ? "bg-gradient-to-r from-[#ffd0a8] to-[#ffb77b] text-[#2e1500] shadow-md"
                    : "text-mute-400 hover:text-white"
                }`}
              >
                REGISTER
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div>
                <label className="block font-mono text-[10px] tracking-[0.22em] text-mute-300 uppercase mb-2">
                  ARCHITECT ID
                </label>
                <input
                  type="text"
                  required
                  value={architectId}
                  onChange={(e) => setArchitectId(e.target.value)}
                  placeholder="architect@agentmandi.void"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-[13px] text-white placeholder:text-mute-500 focus:border-[#ffb77b] focus:bg-white/[0.06] focus:outline-none transition-all font-mono"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] tracking-[0.22em] text-mute-300 uppercase mb-2">
                  ACCESS KEY
                </label>
                <input
                  type="password"
                  required
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-[13px] text-white placeholder:text-mute-500 focus:border-[#ffb77b] focus:bg-white/[0.06] focus:outline-none transition-all font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-[12px] font-bold tracking-[0.2em] text-[#2e1500] uppercase transition-all duration-300 hover:brightness-110 shadow-lg disabled:opacity-75"
                style={{
                  background: "linear-gradient(135deg, #ffd0a8 0%, #ffb77b 50%, #b16d2e 100%)",
                  boxShadow: "0 6px 24px -4px rgba(255, 183, 123, 0.4)",
                }}
              >
                <span>{loading ? "AUTHENTICATING..." : "PROCEED"}</span>
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
              </button>
            </form>

            {/* Footer sub links */}
            <div className="mt-8 flex items-center justify-between border-t border-white/[0.06] pt-4 text-[10px] tracking-[0.18em] text-mute-500 font-mono">
              <button type="button" className="hover:text-[#ffb77b] transition-colors">
                ACCESS RECOVERY
              </button>
              <span>//</span>
              <button type="button" className="hover:text-[#ffb77b] transition-colors">
                SECURITY PROTOCOL
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center sm:text-left text-[11px] tracking-[0.2em] text-mute-500 font-mono py-2">
          AGENTMANDI CORE ARCHITECTURE // LIVE ENVIRONMENT
        </footer>
      </div>
    </main>
  );
}
