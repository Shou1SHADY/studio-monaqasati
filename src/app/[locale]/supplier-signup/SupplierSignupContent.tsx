"use client"

import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import { ArrowRight, BadgeCheck, Building2, FileSearch, Receipt, Send, ShieldCheck, Smartphone, Truck } from "lucide-react"
import { Link } from "@/i18n/routing"
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher"
import { Button } from "@/components/ui/button"
import { JoinFreeButton } from "@/components/supplier-free/JoinFreeButton"
import { FIRST_STEPS_HREF } from "@/components/supplier-free/home-model"

const GIVES = [
  { key: "g1", icon: FileSearch },
  { key: "g2", icon: Send },
  { key: "g3", icon: Truck },
  { key: "g4", icon: Receipt },
  { key: "g5", icon: Building2 },
] as const

const STEPS = ["s1", "s2", "s3"] as const

export function SupplierSignupContent() {
  const t = useTranslations("SupplierSignup")
  const locale = useLocale()

  return (
    <div className="min-h-svh bg-[#020617] font-body text-white">
      <a href="#signup-main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-primary">
        {t("skip")}
      </a>

      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-5">
        <Link href="/" className="flex items-center">
          <Image src="/logo1.png" alt={locale === "ar" ? "مدماك تيك" : "Mdmak Tech"} width={140} height={48} className="h-10 w-auto object-contain" priority />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher className="text-slate-300 hover:bg-white/5 hover:text-white" />
          <Link href="/login">
            <Button variant="ghost" className="h-10 px-4 text-sm font-bold text-slate-300 hover:bg-white/5 hover:text-white">
              {t("navLogin")}
            </Button>
          </Link>
        </div>
      </header>

      <main id="signup-main" className="mx-auto max-w-6xl px-6 pb-24">
        <section className="mx-auto max-w-3xl py-12 text-center md:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-sky-400/[0.07] px-3.5 py-1.5 text-[12px] font-bold text-sky-300">
            <BadgeCheck size={14} aria-hidden="true" />
            {t("badge")}
          </span>
          <h1 className="mt-5 text-4xl font-black leading-[1.6] md:text-5xl ltr:leading-[1.15]">{t("title")}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base font-medium leading-[1.9] text-slate-300 md:text-lg">{t("subtitle")}</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <JoinFreeButton source="self" className="h-12 gap-2.5 rounded-xl border-none bg-cta px-8 text-sm font-black text-white shadow-xl shadow-cta/25 hover:bg-sky-600">
              <Smartphone size={17} aria-hidden="true" />
              {t("cta")}
            </JoinFreeButton>
            <p className="text-xs font-medium text-slate-400">{t("ctaHint")}</p>
            <p className="text-sm text-slate-400">
              {t("haveAccount")}{" "}
              <JoinFreeButton mode="signin" source="self" variant="link" className="h-auto p-0 text-sm font-bold text-sky-300">
                {t("signIn")}
              </JoinFreeButton>
            </p>
          </div>
        </section>

        <section aria-labelledby="signup-gives" className="py-10">
          <h2 id="signup-gives" className="text-center text-2xl font-black md:text-3xl">
            {t("givesTitle")}
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GIVES.map(({ key, icon: Icon }) => (
              <li key={key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-cta/10 text-sky-400">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <h3 className="mt-3 text-base font-extrabold">{t(`${key}_t`)}</h3>
                <p className="mt-1.5 text-sm leading-[1.8] text-slate-400">{t(`${key}_d`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="signup-steps" className="py-10">
          <h2 id="signup-steps" className="text-center text-2xl font-black md:text-3xl">
            {t("stepsTitle")}
          </h2>
          <ol className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-3">
            {STEPS.map((key, i) => (
              <li key={key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-sky-400 text-sm font-black text-primary" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="mt-3 text-base font-extrabold">{t(`${key}_t`)}</h3>
                <p className="mt-1.5 text-sm leading-[1.8] text-slate-400">{t(`${key}_d`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="signup-approval" className="mx-auto max-w-3xl py-10">
          <div className="flex gap-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-5">
            <ShieldCheck size={22} className="mt-1 shrink-0 text-amber-300" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="signup-approval" className="text-base font-extrabold">
                {t("approvalTitle")}
              </h2>
              <p className="mt-1.5 text-sm leading-[1.9] text-slate-300">{t("approvalBody")}</p>
              <Link href={FIRST_STEPS_HREF} className="mt-3 inline-flex items-center gap-1.5 rounded text-sm font-bold text-sky-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                {t("approvalLink")}
                <ArrowRight size={14} className="rtl:rotate-180" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <footer className="mx-auto mt-6 max-w-3xl space-y-2 border-t border-white/10 pt-8 text-center text-sm text-slate-400">
          <p>
            {t("contractorLine")}{" "}
            <Link href="/#demo" className="font-bold text-sky-300 hover:underline">
              {t("contractorLink")}
            </Link>
          </p>
          <p className="text-xs">
            <Link href="/terms" className="hover:text-white hover:underline">
              {t("terms")}
            </Link>
            {" · "}
            <Link href="/privacy" className="hover:text-white hover:underline">
              {t("privacy")}
            </Link>
          </p>
        </footer>
      </main>
    </div>
  )
}
