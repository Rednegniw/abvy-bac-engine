import { MS_PER_HOUR, VMAX_BASE } from './constants'
import type { UserProfile } from './types'

const MS_PER_YEAR = 365.25 * 24 * MS_PER_HOUR

/**
 * Highest BAC the clearance bound allows for, g/L (0.6 g/dL). A numerical
 * sanity bound: the median BAC in fatal alcohol poisonings is about 0.36 g/dL.
 */
const MAX_PLAUSIBLE_BAC_GL = 6

/** Allowance on top of the linear clearance time for the slow tail below Km. */
const CLEARANCE_TAIL_BUFFER_MS = 6 * MS_PER_HOUR

function yearsBetween(birthday: number, atTime: number): number {
    'worklet'
    return (atTime - birthday) / MS_PER_YEAR
}

/**
 * Total body water in liters (Watson, Watson & Batt 1980). The equations were
 * fitted separately by sex; the female equation has no age term.
 */
export function watsonTbw(sex: 'male' | 'female', ageYears: number, heightCm: number, weightKg: number): number {
    'worklet'
    if (sex === 'male') {
        return 2.447 - 0.09516 * ageYears + 0.1074 * heightCm + 0.3362 * weightKg
    }
    return -2.097 + 0.1069 * heightCm + 0.2466 * weightKg
}

/** Watson total body water in liters for a profile, with age taken at `atTime`. */
export function calculateTBW(user: UserProfile, atTime: number = Date.now()): number {
    'worklet'
    return watsonTbw(user.sex, yearsBetween(user.birthday, atTime), user.heightCm, user.weightKg)
}

/**
 * A generous bound on how long this person can take to clear any plausible
 * BAC, for callers that need to know how far back a drink can still matter.
 *
 * Without the fed-state boost, Michaelis-Menten elimination from C0 to C takes
 * (C0 - C) / Vmax + (Km / Vmax) x ln(C0 / C) hours. The bound takes C0 = 6 g/L
 * and covers the logarithmic term with a fixed buffer, which suffices down to
 * a metabolicFactor of about 0.3; real evenings start far below 6 g/L, which
 * leaves many hours of slack on top.
 */
export function maxBacClearanceMs(user: UserProfile): number {
    const vmaxPerHour = VMAX_BASE * user.metabolicFactor
    return (MAX_PLAUSIBLE_BAC_GL / vmaxPerHour) * MS_PER_HOUR + CLEARANCE_TAIL_BUFFER_MS
}
