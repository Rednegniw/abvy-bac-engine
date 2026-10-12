/**
 * Public queries over the simulator. Every BAC is in g/dL and every time is
 * Unix ms.
 *
 * Functions marked 'worklet' also run on react-native-worklets runtimes in
 * the Abvy app; anywhere else the directive is an inert string. Worklets do
 * not capture module constants used in default parameter values, so an
 * omitted initialFoodLevel is passed through as undefined and defaulted
 * inside `simulate`.
 */

import {
    INITIAL_SOBER_SEARCH_MS,
    MAX_SOBER_SEARCH_MS,
    NEXT_DRINK_SEARCH_MS,
    NEXT_DRINK_TOLERANCE_MS,
    PEAK_SEARCH_TAIL_MS,
    SOBER_TIME_UNAVAILABLE
} from './constants'
import { findEarliestDrink, findLatestDrinkEnd, sampleAtInterval, simulate } from './simulate'
import type { BacPoint, Drink, MealEvent, PeakBacResult, UserProfile } from './types'

/** Step used wherever a single precise value is needed. */
const PRECISE_STEP_MS = 15_000

/** Coarsest step used internally for curves; finer requested steps are honoured. */
const MAX_CURVE_STEP_MS = 60_000

export interface SoberSearchOptions {
    /** Simulation step, default 15 s. The crossing is reported on this grid. */
    stepMs?: number
}

export interface PerDrinkSeriesResult {
    /** One curve per drink; `drinkIndex` is the drink's position in the input array. */
    perDrink: { drinkIndex: number; points: BacPoint[] }[]

    /** The combined curve, from the same simulation pass. */
    totalPoints: BacPoint[]
}

/** BAC at time `t`. */
export function bacAt(
    t: number,
    drinks: ReadonlyArray<Drink>,
    user: UserProfile,
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number
): number {
    'worklet'

    if (drinks.length === 0) return 0

    const earliest = findEarliestDrink(drinks)
    if (t <= earliest) return 0

    return simulate({
        drinks,
        user,
        startMs: earliest,
        endMs: t,
        stepMs: PRECISE_STEP_MS,
        meals,
        initialFoodLevel,
        initialFoodAtMs: earliest
    }).finalBac
}

/**
 * The BAC curve from `startMs` over `spanMs`, sampled every `stepMs`
 * (both ends included). Drinks before `startMs` are carried into the curve.
 *
 * @throws RangeError when `stepMs` is not positive.
 */
export function series(
    startMs: number,
    spanMs: number,
    stepMs: number,
    drinks: ReadonlyArray<Drink>,
    user: UserProfile,
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number
): BacPoint[] {
    'worklet'

    if (stepMs <= 0) {
        throw new RangeError('stepMs must be > 0')
    }

    if (drinks.length === 0) {
        const steps = Math.floor(spanMs / stepMs)
        const samples: BacPoint[] = new Array(steps + 1)
        let t = startMs
        for (let i = 0; i <= steps; i++, t += stepMs) {
            samples[i] = { x: t, y: 0 }
        }
        return samples
    }

    const earliest = findEarliestDrink(drinks)
    const { points } = simulate({
        drinks,
        user,
        startMs: Math.min(earliest, startMs),
        endMs: startMs + spanMs,
        stepMs: Math.min(stepMs, MAX_CURVE_STEP_MS),
        collectPoints: true,
        meals,
        initialFoodLevel,
        initialFoodAtMs: earliest
    })

    return sampleAtInterval(points, startMs, spanMs, stepMs)
}

/**
 * Like `series`, plus each drink's own share of the curve. Elimination is
 * attributed to drinks in proportion to their share of the alcohol in the
 * blood, so the per-drink curves add up to the total.
 *
 * @throws RangeError when `stepMs` is not positive.
 */
export function perDrinkSeries(
    startMs: number,
    spanMs: number,
    stepMs: number,
    drinks: ReadonlyArray<Drink>,
    user: UserProfile,
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number
): PerDrinkSeriesResult {
    'worklet'

    if (stepMs <= 0) {
        throw new RangeError('stepMs must be > 0')
    }

    if (drinks.length === 0) {
        return { perDrink: [], totalPoints: [] }
    }

    const earliest = findEarliestDrink(drinks)
    const { points, perDrinkPoints } = simulate({
        drinks,
        user,
        startMs: Math.min(earliest, startMs),
        endMs: startMs + spanMs,
        stepMs: Math.min(stepMs, MAX_CURVE_STEP_MS),
        collectPoints: true,
        collectPerDrink: true,
        meals,
        initialFoodLevel,
        initialFoodAtMs: earliest
    })

    return {
        perDrink: (perDrinkPoints ?? []).map((drinkPoints, drinkIndex) => ({
            drinkIndex,
            points: sampleAtInterval(drinkPoints, startMs, spanMs, stepMs)
        })),
        totalPoints: sampleAtInterval(points, startMs, spanMs, stepMs)
    }
}

/**
 * When BAC finally falls to `threshold` or below, found with one forward
 * simulation whose horizon doubles until the crossing is proven.
 *
 * @returns The crossing time (Unix ms), 0 when BAC never exceeds `threshold`,
 * or SOBER_TIME_UNAVAILABLE when no crossing is found within
 * MAX_SOBER_SEARCH_MS of the last drink.
 */
export function findSoberTime(
    drinks: ReadonlyArray<Drink>,
    threshold: number,
    user: UserProfile,
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number,
    options?: SoberSearchOptions
): number {
    'worklet'

    if (drinks.length === 0) return 0

    const earliest = findEarliestDrink(drinks)
    const latestEnd = findLatestDrinkEnd(drinks)

    // Callers that only show minutes pass 60 s: a quarter of the cost, within about 2 minutes (docs/MODEL.md)
    const stepMs = options?.stepMs ?? PRECISE_STEP_MS
    let horizonMs = INITIAL_SOBER_SEARCH_MS

    while (true) {
        const { points } = simulate({
            drinks,
            user,
            startMs: earliest,
            endMs: latestEnd + horizonMs,
            stepMs,
            collectPoints: true,
            meals,
            initialFoodLevel,
            initialFoodAtMs: earliest
        })
        const finalPoint = points[points.length - 1]

        if (!finalPoint || finalPoint.y <= threshold) {
            /**
             * Scan back to the last sample above the threshold. Each sample
             * holds the state at its own time, so the sample after it is the
             * crossing.
             */
            for (let i = points.length - 1; i >= 0; i--) {
                if (points[i].y > threshold) {
                    return i + 1 < points.length ? points[i + 1].x : SOBER_TIME_UNAVAILABLE
                }
            }
            return 0
        }

        if (horizonMs === MAX_SOBER_SEARCH_MS) {
            return SOBER_TIME_UNAVAILABLE
        }
        horizonMs = Math.min(horizonMs * 2, MAX_SOBER_SEARCH_MS)
    }
}

/**
 * When BAC falls to `threshold` or below after `currentTime`, by binary
 * search to the minute between `currentTime` and the first search horizon at
 * which BAC is at or below `threshold`. If BAC crosses the threshold more
 * than once in that span (drinks still to come), the crossing found is not
 * necessarily the last one; `findSoberTime` returns the final crossing.
 *
 * @returns The crossing time, or null when BAC is already at or below
 * `threshold` or no crossing is found within MAX_SOBER_SEARCH_MS.
 */
export function calculateTimeWhenBelowThreshold(
    drinks: ReadonlyArray<Drink>,
    threshold: number,
    user: UserProfile,
    currentTime: number = Date.now(),
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number
): Date | null {
    'worklet'

    if (bacAt(currentTime, drinks, user, meals, initialFoodLevel) <= threshold) {
        return null
    }

    let left = currentTime
    let horizonMs = INITIAL_SOBER_SEARCH_MS
    let right = currentTime + horizonMs

    while (bacAt(right, drinks, user, meals, initialFoodLevel) > threshold) {
        if (horizonMs === MAX_SOBER_SEARCH_MS) return null
        horizonMs = Math.min(horizonMs * 2, MAX_SOBER_SEARCH_MS)
        right = currentTime + horizonMs
    }

    while (right - left > 60_000) {
        const mid = Math.floor((left + right) / 2)
        if (bacAt(mid, drinks, user, meals, initialFoodLevel) > threshold) {
            left = mid
        } else {
            right = mid
        }
    }

    return new Date(right)
}

/**
 * The highest BAC from `fromMs` on, and when it happens. Searches until
 * PEAK_SEARCH_TAIL_MS after the last drink, at 1-minute resolution.
 */
export function findPeakBacResult(
    drinks: ReadonlyArray<Drink>,
    user: UserProfile,
    fromMs: number,
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number
): PeakBacResult {
    'worklet'

    if (drinks.length === 0) return { bacGdl: 0, timeMs: fromMs }

    const earliest = findEarliestDrink(drinks)
    const { peak } = simulate({
        drinks,
        user,
        startMs: Math.min(earliest, fromMs),
        endMs: Math.max(fromMs, findLatestDrinkEnd(drinks)) + PEAK_SEARCH_TAIL_MS,
        stepMs: MAX_CURVE_STEP_MS,
        meals,
        initialFoodLevel,
        initialFoodAtMs: earliest,
        peakFromMs: fromMs
    })

    const forwardPeak = peak ?? { bacGdl: 0, timeMs: fromMs }
    const bacAtStart = bacAt(fromMs, drinks, user, meals, initialFoodLevel)

    return bacAtStart >= forwardPeak.bacGdl ? { bacGdl: bacAtStart, timeMs: fromMs } : forwardPeak
}

/** The highest BAC from `fromMs` on (see findPeakBacResult). */
export function findPeakBac(
    drinks: ReadonlyArray<Drink>,
    user: UserProfile,
    fromMs: number,
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number
): number {
    return findPeakBacResult(drinks, user, fromMs, meals, initialFoodLevel).bacGdl
}

/**
 * The highest BAC between `fromMs` and `toMs`, at the same 15 s resolution as
 * `bacAt`, so a short window never picks up absorption that happens after it.
 */
export function findPeakBacInWindow(
    drinks: ReadonlyArray<Drink>,
    user: UserProfile,
    fromMs: number,
    toMs: number,
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number
): number {
    if (drinks.length === 0 || toMs < fromMs) return 0

    const earliest = findEarliestDrink(drinks)
    const { points, finalBac } = simulate({
        drinks,
        user,
        startMs: Math.min(earliest, fromMs),
        endMs: toMs,
        stepMs: PRECISE_STEP_MS,
        collectPoints: true,
        meals,
        initialFoodLevel,
        initialFoodAtMs: earliest
    })

    /**
     * Seed with both endpoints. A window narrower than the step can hold no
     * sample at all, and its maximum sits at `fromMs` on a falling curve and
     * at `toMs` on a rising one; seeding with only one would make the
     * reported maximum shrink as the window grows.
     */
    let peak = Math.max(finalBac, bacAt(fromMs, drinks, user, meals, initialFoodLevel))
    for (const point of points) {
        if (point.x >= fromMs && point.x <= toMs && point.y > peak) {
            peak = point.y
        }
    }
    return peak
}

/**
 * The earliest time a drink of `alcoholGrams`, drunk over `durationMinutes`,
 * can start without the resulting peak exceeding `bacLimit`. Binary search
 * to NEXT_DRINK_TOLERANCE_MS within NEXT_DRINK_SEARCH_MS.
 *
 * @returns null when the drink can start now, a future Unix ms timestamp when
 * it has to wait, or Infinity when BAC is already at or above `bacLimit` or
 * no start within the search window stays under it.
 */
export function calculateTimeToNextDrink(
    drinks: ReadonlyArray<Drink>,
    user: UserProfile,
    bacLimit: number,
    alcoholGrams: number,
    durationMinutes: number,
    now: number = Date.now(),
    meals: ReadonlyArray<MealEvent> = [],
    initialFoodLevel?: number
): number | null {
    if (bacAt(now, drinks, user, meals, initialFoodLevel) >= bacLimit) {
        return Infinity
    }

    const peakWithNextDrinkAt = (start: number): number =>
        findPeakBac(
            [...drinks, { alcoholGrams, start, end: start + durationMinutes * 60_000 }],
            user,
            start,
            meals,
            initialFoodLevel
        )

    if (peakWithNextDrinkAt(now) <= bacLimit) {
        return null
    }

    let left = now
    let right = now + NEXT_DRINK_SEARCH_MS

    while (right - left > NEXT_DRINK_TOLERANCE_MS) {
        const mid = Math.floor((left + right) / 2)
        if (peakWithNextDrinkAt(mid) <= bacLimit) {
            right = mid
        } else {
            left = mid
        }
    }

    if (right >= now + NEXT_DRINK_SEARCH_MS - NEXT_DRINK_TOLERANCE_MS) {
        return Infinity
    }

    return right
}
