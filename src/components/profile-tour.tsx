"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ChevronRight, ChevronLeft, X, CheckCircle2 } from "lucide-react"

export interface TourStep {
  targetId: string
  title: string
  description: string
  action?: string
}

interface ProfileTourProps {
  steps: TourStep[]
  onComplete: () => void
  onDismiss: () => void
  onStepChange?: (stepIndex: number) => void
}

export function ProfileTour({ steps, onComplete, onDismiss, onStepChange }: ProfileTourProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})
  const [isAbove, setIsAbove] = useState(false)
  const locale = useLocale()
  const isRTL = locale === 'ar'
  const step = steps[currentStep]
  const totalSteps = steps.length
  const targetRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setIsVisible(true)
  }, [])

  useEffect(() => {
    if (onStepChange) onStepChange(currentStep)
  }, [currentStep, onStepChange])

  const positionPopup = useCallback(() => {
    const el = document.getElementById(step.targetId)
    if (!el) return

    el.scrollIntoView({ behavior: 'instant', block: 'center' })

    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      const viewportH = window.innerHeight
      const viewportW = window.innerWidth
      const popoverH = 200
      const popoverW = 320

      let top: number
      let above: boolean

      const spaceAbove = rect.top
      const spaceBelow = viewportH - rect.bottom

      if (spaceAbove > popoverH + 40) {
        top = rect.top - popoverH - 16
        above = true
      } else if (spaceBelow > popoverH + 40) {
        top = rect.bottom + 16
        above = false
      } else {
        top = Math.max(16, viewportH / 2 - popoverH / 2)
        above = top < viewportH / 2
      }

      top = Math.max(16, Math.min(top, viewportH - popoverH - 16))

      let left = Math.max(16, rect.left - popoverW / 2 + rect.width / 2)
      left = Math.min(left, viewportW - popoverW - 16)

      setIsAbove(above)
      setPopoverStyle({
        position: 'fixed',
        top,
        left,
        width: popoverW,
        zIndex: 9999,
      })

      el.classList.add('ring-4', 'ring-primary/40', 'rounded-xl')
    })
  }, [step.targetId])

  useEffect(() => {
    positionPopup()
    return () => {
      const el = document.getElementById(step.targetId)
      if (el) {
        el.classList.remove('ring-4', 'ring-primary/40', 'rounded-xl')
      }
    }
  }, [currentStep, step.targetId, positionPopup])

  useEffect(() => {
    const handleScroll = () => {
      positionPopup()
    }
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [positionPopup])

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      onComplete()
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const progress = ((currentStep + 1) / totalSteps) * 100

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[9998] transition-opacity duration-300" style={{ opacity: isVisible ? 1 : 0 }} onClick={onDismiss} />
      
      <div
        ref={targetRef}
        className="transition-all duration-500 ease-out"
        style={{
          ...popoverStyle,
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
        }}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="h-1 bg-slate-100">
            <div 
              className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-black">
                  {currentStep + 1}
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  {currentStep + 1} / {totalSteps}
                </span>
              </div>
              <button 
                onClick={onDismiss}
                className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <h3 className="font-bold text-slate-900 text-base mb-2">{step.title}</h3>
            <p className="text-sm text-slate-500 leading-relaxed mb-4">{step.description}</p>

            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrev}
                  className="gap-1 h-9 px-3 rounded-xl text-xs font-bold"
                >
                  {isRTL ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                  {isRTL ? "السابق" : "Previous"}
                </Button>
              )}
              <Button
                onClick={handleNext}
                className="gap-1 h-9 px-4 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-white ml-auto"
              >
                {currentStep === totalSteps - 1 ? (
                  <>
                    <CheckCircle2 size={14} />
                    {isRTL ? "إنهاء" : "Finish"}
                  </>
                ) : (
                  <>
                    {isRTL ? "التالي" : "Next"}
                    {isRTL ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div 
          className={cn(
            "absolute w-4 h-4 bg-white border-l border-t border-slate-200 rotate-45",
            isAbove ? '-bottom-2' : '-top-2'
          )}
          style={{
            left: '50%',
            marginLeft: '-8px',
            ...(isAbove ? { bottom: '-8px', top: 'auto' } : { top: '-8px' }),
          }}
        />
      </div>
    </>
  )
}
