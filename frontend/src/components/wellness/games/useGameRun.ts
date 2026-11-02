import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAudioContext } from '@/components/wellness/audio/ambientAudio'
import { playTone } from '@/components/wellness/audio/sfx'
import { useActivityXp } from '@/components/wellness/breathing/useActivityXp'
import { useReducedMotion } from '@/components/wellness/breathing/useReducedMotion'
import { celebrate, useWellness } from '@/components/wellness/WellnessContext'
import { readBests, readMuted, recordScore, writeMuted } from './bestScores'
import type { GameInfo } from './catalog'

/** A synthesised one-shot tone (components/wellness/audio/sfx). */
export type Tone = Parameters<typeof playTone>[1]
export type GamePhase = 'ready' | 'playing' | 'over'

export interface GameOutcome {
  score: number
  /** The round was played to its natural end (earns XP); false when it was cut short. */
  completed: boolean
  headline: string
  details: string[]
  /** Anything else for the end screen (e.g. the finished drawing). */
  extra?: ReactNode
  /** What a round that earned no XP needed (default: "Finish a full round to earn XP."). */
  xpNote?: string
  /** Label for the big number on the end screen (default "Score"). */
  scoreLabel?: string
}
export interface GameResult extends GameOutcome { best: number; isNewBest: boolean }

export const GAME_XP_FALLBACK = 25

/**
 * Shared state for one Game Zone game: start screen → playing (pausable) → end screen, plus the sound toggle, the
 * student's best score and the XP report for a finished round.
 *  - Pauses itself when the browser tab is hidden (the game's timers and loops follow `active`).
 *  - Sounds are optional: the mute choice is remembered, and the AudioContext is only created from a click.
 *  - Finishing a full round reports `game_complete` with the game id; the server decides the XP (fixed, daily cap).
 */
export function useGameRun(info: GameInfo) {
  const { me, meta } = useWellness()
  const student = me.student.code
  const { report } = useActivityXp()
  const audio = useAudioContext()
  const reducedMotion = useReducedMotion()

  const [phase, setPhase] = useState<GamePhase>('ready')
  const [paused, setPaused] = useState(false)
  const [round, setRound] = useState(0)
  const [result, setResult] = useState<GameResult | null>(null)
  const [best, setBest] = useState(() => readBests(student)[info.id] ?? 0)
  const [muted, setMuted] = useState(readMuted)
  const [announcement, setAnnouncement] = useState('')
  const phaseRef = useRef<GamePhase>('ready')
  const mutedRef = useRef(muted)

  // Hidden tab → pause (the student comes back to a Resume button rather than a game that ran on without them)
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && phaseRef.current === 'playing') setPaused(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const start = useCallback(() => {
    if (!mutedRef.current) audio.ensure() // inside the Start click, so the browser allows sound
    phaseRef.current = 'playing'
    setResult(null)
    setPaused(false)
    setAnnouncement('')
    setRound((r) => r + 1)
    setPhase('playing')
  }, [audio])

  const finish = useCallback((outcome: GameOutcome) => {
    if (phaseRef.current !== 'playing') return
    phaseRef.current = 'over'
    const record = recordScore(student, info.id, outcome.score)
    setBest(record.best)
    setResult({ ...outcome, ...record })
    setPaused(false)
    setPhase('over')
    if (outcome.completed && info.xp === 'game_complete') {
      report('game_complete', `Game Zone · ${info.name}`, info.id)
      celebrate({ particleCount: 120, spread: 70, origin: { y: 0.6 } })
    }
  }, [info, report, student])

  const pause = useCallback(() => { if (phaseRef.current === 'playing') setPaused(true) }, [])
  const resume = useCallback(() => setPaused(false), [])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    writeMuted(next)
    if (!next) audio.ensure()
  }, [audio])

  const play = useCallback((tone: Tone) => {
    if (mutedRef.current) return
    const ctx = audio.current()
    if (ctx && ctx.state !== 'closed') playTone(ctx, tone)
  }, [audio])

  // Screen-reader announcements; a trailing space toggles so the same message twice is still read out
  const flip = useRef(false)
  const announce = useCallback((text: string) => {
    flip.current = !flip.current
    setAnnouncement(flip.current ? text : `${text} `)
  }, [])

  const xpEach = meta?.xpRules?.game_complete ?? GAME_XP_FALLBACK
  const active = phase === 'playing' && !paused

  return useMemo(() => ({
    info, phase, paused, active, round, result, best, muted, reducedMotion, announcement, xpEach,
    start, finish, pause, resume, toggleMute, play, announce,
  }), [info, phase, paused, active, round, result, best, muted, reducedMotion, announcement, xpEach, start, finish, pause, resume, toggleMute, play, announce])
}

export type GameRun = ReturnType<typeof useGameRun>
