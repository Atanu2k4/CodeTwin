'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import { useState } from 'react'
import BorderGlow from './BorderGlow'

const features = [
  {
    label: 'Write your task',
    heading: 'Give it a task. It shows its plan.',
    description:
      'CodeTwin builds a pre-flight impact map before touching any file. See exactly which files get written, which shell commands run, and which functions get affected. You always know what\'s about to happen before it happens.',
    imageSrc: '/Images/giveitatask.png',
    imageGallery: null,
    frameAspect: 'aspect-[1017/528]',
    imagePosition: 'right' as const,
  },
  {
    label: 'See tools in context, always',
    heading: 'Five autonomy levels. You choose when to intervene.',
    description:
      'At dependence level 3, it asks when multiple approaches exist. At level 1, it asks before every write. At level 5, it executes and reports. Change the level mid-task. You control how autonomous it gets.',
    imageSrc: null,
    imageGallery: [
      '/Images/level1.png',
      '/Images/level2.png',
      '/Images/level3.png',
      '/Images/level4.png',
      '/Images/level5.png',
    ],
    frameAspect: 'aspect-[19/10]',
    imagePosition: 'left' as const,
  },
  {
    label: 'Act on behalf without losing control',
    heading: 'Project memory. Stored locally.',
    description:
      'CodeTwin maintains a twin profile per project — stored locally in SQLite, never sent anywhere. It remembers past decisions and why they were made, active constraints, and failure patterns — what broke and in what context.',
    imageSrc: '/Images/sqlite.png',
    imageGallery: null,
    frameAspect: 'aspect-[3/2]',
    imagePosition: 'right' as const,
  },
  {
    label: 'Write and share badges',
    heading: 'Works with every major LLM provider.',
    description:
      'OpenAI, Anthropic, Groq, Gemini, Mistral, Ollama, Azure. One config field. No vendor lock-in. Bring your own API key and switch providers with a single config change. Zero code changes required.',
    imageSrc: '/Images/ai.png',
    imageGallery: null,
    frameAspect: 'aspect-[3/2]',
    imagePosition: 'left' as const,
  },
]

const easeOut = [0.16, 1, 0.3, 1] as const

export default function FeatureWalkthrough() {
  const [activeGalleryByFeature, setActiveGalleryByFeature] = useState<Record<number, number>>({})

  return (
    <section className="py-24 px-6 border-t border-border-default">
      <div className="max-w-6xl mx-auto">
        {/* Section heading */}
        <div className="text-center mb-20">
          <p className="text-xs text-[#a6a6ed] uppercase tracking-[0.2em] font-mono mb-4">
            How It Works
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold text-text-primary leading-tight">
            A New Paradigm for Coding with Agents
          </h2>
        </div>


        {/* Feature blocks */}
        <div className="flex flex-col gap-32">
          {features.map((feature, i) => {
            const activeGalleryIndex = activeGalleryByFeature[i] ?? 0
            const activeGalleryImage = feature.imageGallery?.[activeGalleryIndex] ?? null

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-100px' }}
                transition={{ duration: 0.6, ease: easeOut }}
                className="relative"
              >
                <div
                  className={`grid grid-cols-1 gap-12 lg:gap-16 items-center ${feature.imagePosition === 'left'
                      ? 'lg:grid-cols-[1.15fr_1fr]'
                      : 'lg:grid-cols-[1fr_1.15fr]'
                    }`}
                >
                  {/* Text content */}
                  <div className={`flex flex-col ${feature.imagePosition === 'left' ? 'lg:order-2' : 'lg:order-1'}`}>
                    <span className="text-xs text-[#a6a6ed] uppercase tracking-[0.2em] font-mono mb-4">
                      {feature.label}
                    </span>
                    <h3 className="text-xl md:text-2xl font-medium text-text-primary mb-4 leading-snug">
                      {feature.heading}
                    </h3>
                    <p className="text-sm text-text-secondary leading-relaxed">
                      {feature.description}
                    </p>
                  </div>

                  {/* Image placeholder */}
                  <div className={`relative ${feature.imagePosition === 'left' ? 'lg:order-1' : 'lg:order-2'}`}>
                    <div className={feature.imageGallery ? 'mx-auto w-full max-w-[440px]' : ''}>
                      <BorderGlow
                        edgeSensitivity={40}
                        glowColor="240 60 70"
                        backgroundColor="#0a0a0a"
                        borderRadius={8}
                        glowRadius={40}
                        glowIntensity={1}
                        coneSpread={25}
                        animated={true}
                        colors={['#a6a6ed', '#ffffff', '#2dd4bf']}
                        className={`w-full ${feature.frameAspect}`}
                      >
                        {feature.imageGallery && feature.imageGallery.length > 0 ? (
                          <div className="absolute inset-[2px] overflow-hidden rounded-[6px] z-10 bg-[#06070d]">
                            {activeGalleryImage && (
                              <Image
                                src={activeGalleryImage}
                                alt={`Autonomy level ${activeGalleryIndex + 1} screenshot`}
                                fill
                                unoptimized
                                className="object-contain object-center"
                                sizes="(min-width: 1024px) 440px, 92vw"
                              />
                            )}

                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#06070d] to-transparent" />

                            <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-1.5 p-2">
                              {feature.imageGallery.map((_, idx) => {
                                const isActive = activeGalleryIndex === idx
                                return (
                                  <button
                                    key={`${feature.heading}-level-${idx + 1}`}
                                    type="button"
                                    onClick={() => setActiveGalleryByFeature((prev) => ({ ...prev, [i]: idx }))}
                                    className={`h-7 min-w-7 rounded-md px-2 text-[11px] font-mono transition-colors ${isActive
                                        ? 'border border-[#a6a6ed] bg-[#a6a6ed1f] text-[#d6d6ff]'
                                        : 'border border-white/15 bg-black/35 text-text-muted hover:bg-black/55 hover:text-text-primary'
                                      }`}
                                    aria-label={`Show autonomy level ${idx + 1}`}
                                  >
                                    L{idx + 1}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ) : feature.imageSrc ? (
                          <div className="absolute inset-[2px] overflow-hidden rounded-[6px] z-10 bg-[#06070d]">
                            <Image
                              src={feature.imageSrc}
                              alt={`${feature.label} screenshot`}
                              fill
                              unoptimized
                              className="object-cover object-center"
                              sizes="(min-width: 1024px) 40vw, 92vw"
                            />
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center z-10">
                            <div className="text-text-muted text-xs font-mono opacity-40">
                              screenshot
                            </div>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-br from-[#a6a6ed05] to-transparent z-0" />
                      </BorderGlow>
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
