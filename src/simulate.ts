import {
    BLOOD_INERT_GRAMS,
    BLOOD_WATER_FRACTION,
    DEFAULT_INITIAL_FOOD_LEVEL,
    FIRST_PASS_MAX,
    FOOD_DECAY_LAMBDA,
    KA_EMPTY,
    KA_FULL,
    KM,
    MIN_POUR_MS,
    MS_PER_HOUR,
    STOMACH_INERT_GRAMS,
    VMAX_BASE,
    VMAX_FOOD_BOOST
} from './constants'
import { calculateTBW } from './physiology'
import type { BacPoint, Drink, MealEvent, PeakBacResult, UserProfile } from './types'

export interface SimulationInput {
    drinks: ReadonlyArray<Drink>
    user: UserProfile
    startMs: number
    endMs: number
    stepMs: number

    /** Record the total curve at every step. */
    collectPoints?: boolean

    /** Also record each drink's share of the curve. */
    collectPerDrink?: boolean

    meals?: ReadonlyArray<MealEvent>

    /** Food state at `initialFoodAtMs`, decaying from there. Defaults to DEFAULT_INITIAL_FOOD_LEVEL. */
    initialFoodLevel?: number

    /** When the initial food state applies; also the moment age is taken for body water. Defaults to `startMs`. */
    initialFoodAtMs?: number

    /** Track the peak from this time on. */
    peakFromMs?: number
}

export interface SimulationResult {
    /** BAC at `endMs`, g/dL. */
    finalBac: number

    /** Present when `peakFromMs` was given. */
    peak?: PeakBacResult

    points: BacPoint[]

    /** One curve per drink, in input order, when `collectPerDrink` was set. */
    perDrinkPoints?: BacPoint[][]
}

/**
 * Integrates the model from `startMs` to `endMs` with a fixed step and
 * returns BAC in g/dL.
 *
 * Every drink has its own stomach compartment, filled at a constant rate over
 * its pour window and emptied into the blood at a shared absorption rate set
 * by the current food state F(t). F(t) is the initial food level plus every
 * meal so far, each decaying exponentially, clamped at 1. Elimination is
 * Michaelis-Menten. With `collectPerDrink`, elimination is attributed to the
 * drinks in proportion to their share of the alcohol in the blood.
 */
export function simulate(input: SimulationInput): SimulationResult {
    'worklet'

    const { drinks, user, startMs, endMs, stepMs, peakFromMs } = input
    const collectPoints = input.collectPoints ?? false
    const collectPerDrink = input.collectPerDrink ?? false
    const meals = input.meals ?? []
    const initialFoodLevel = input.initialFoodLevel ?? DEFAULT_INITIAL_FOOD_LEVEL
    const initialFoodAtMs = input.initialFoodAtMs ?? startMs

    // Volume of distribution: body water scaled up to its blood equivalent (L)
    const volumeL = calculateTBW(user, initialFoodAtMs) / BLOOD_WATER_FRACTION

    // Personal rate constants; all loop-invariant
    const vmaxPerHour = VMAX_BASE * user.metabolicFactor
    const kaEmptyScaled = KA_EMPTY * user.kaMultiplier
    const kaSpreadScaled = (KA_EMPTY - KA_FULL) * user.kaMultiplier
    const firstPassScaled = FIRST_PASS_MAX * user.fpFactor

    // Each drink's stomach contents and pour window, clamped to MIN_POUR_MS
    const stomachGrams = new Array(drinks.length).fill(0) as number[]
    const pourMs = new Array(drinks.length).fill(0) as number[]
    const pourEndMs = new Array(drinks.length).fill(0) as number[]
    for (let i = 0; i < drinks.length; i++) {
        pourMs[i] = Math.max(drinks[i].end - drinks[i].start, MIN_POUR_MS)
        pourEndMs[i] = drinks[i].start + pourMs[i]
    }

    /**
     * Drinks join the active set on the step their pour starts and leave once
     * fully poured and absorbed. Only active drinks are touched per step, and
     * stretches with a provably zero state are skipped, so the cost scales
     * with drinking time rather than with elapsed time x number of drinks.
     */
    const startOrder: number[] = new Array(drinks.length)
    for (let i = 0; i < drinks.length; i++) startOrder[i] = i
    startOrder.sort((a, b) => drinks[a].start - drinks[b].start)
    const active: number[] = []
    let nextStartIdx = 0

    /**
     * Meals that have happened fold into one decaying accumulator, which is
     * exact because exponentials compose; the initial level keeps its closed
     * form. Folding needs the meals in time order.
     */
    const mealOrder: number[] = new Array(meals.length)
    for (let i = 0; i < meals.length; i++) mealOrder[i] = i
    mealOrder.sort((a, b) => meals[a].timeMs - meals[b].timeMs)
    const decayPerMs = FOOD_DECAY_LAMBDA / MS_PER_HOUR
    let mealFood = 0
    let mealFoodAtMs = startMs
    let nextMealIdx = 0

    let bloodGrams = 0
    const bloodGramsPerDrink = collectPerDrink ? (new Array(drinks.length).fill(0) as number[]) : null
    const points: BacPoint[] = []
    const perDrinkPoints: BacPoint[][] = collectPerDrink ? drinks.map(() => []) : []
    let peakBac = 0
    let peakTime = peakFromMs ?? startMs

    let t = startMs
    while (t <= endMs) {
        const intervalEnd = Math.min(t + stepMs, endMs)
        const intervalMs = Math.max(0, intervalEnd - t)
        const intervalHours = intervalMs / MS_PER_HOUR

        /**
         * 1. Sample the state at `t` before integrating this interval;
         * sampling afterwards would label the state at `intervalEnd` as `t`
         * and shift the whole curve one step early.
         */
        const bac = bloodGrams / volumeL / 10
        if (peakFromMs !== undefined && t >= peakFromMs && bac > peakBac) {
            peakBac = bac
            peakTime = t
        }
        if (collectPoints) {
            points.push({ x: t, y: bac })
        }
        if (bloodGramsPerDrink) {
            for (let i = 0; i < drinks.length; i++) {
                perDrinkPoints[i].push({ x: t, y: bloodGramsPerDrink[i] / volumeL / 10 })
            }
        }

        // Admit drinks whose pour starts within this interval
        while (nextStartIdx < drinks.length && drinks[startOrder[nextStartIdx]].start < intervalEnd) {
            active.push(startOrder[nextStartIdx])
            nextStartIdx++
        }

        // 2. Food state F(t), shared by absorption, first-pass loss and elimination
        if (t > mealFoodAtMs) {
            mealFood *= Math.exp(-decayPerMs * (t - mealFoodAtMs))
            mealFoodAtMs = t
        }
        while (nextMealIdx < meals.length && meals[mealOrder[nextMealIdx]].timeMs <= t) {
            const meal = meals[mealOrder[nextMealIdx]]
            mealFood += meal.level * Math.exp(-decayPerMs * (t - meal.timeMs))
            nextMealIdx++
        }
        const initialFood = initialFoodLevel * Math.exp(-decayPerMs * Math.max(0, t - initialFoodAtMs))
        const food = Math.min(initialFood + mealFood, 1.0)
        const kaPerHour = kaEmptyScaled - kaSpreadScaled * food
        const kaThisStep = kaPerHour * intervalHours

        // Only this fraction of absorbed alcohol reaches the blood; the rest is first-pass loss
        const systemicFraction = 1 - firstPassScaled * food

        /**
         * 3. Intake, then absorption, per active drink. Alcohol poured during
         * this interval was only in the stomach for part of it, so it is
         * absorbed at half weight (trapezoid rule); without that, how much of
         * a pour is absorbed would depend on the step size, and a 15 s and a
         * 60 s step would disagree on the rising limb of a short pour.
         */
        for (let a = active.length - 1; a >= 0; a--) {
            const i = active[a]
            const drink = drinks[i]

            let poured = 0
            if (drink.alcoholGrams > 0) {
                const overlapStart = Math.max(t, drink.start)
                const overlapEnd = Math.min(intervalEnd, pourEndMs[i])
                if (overlapEnd > overlapStart) {
                    poured = drink.alcoholGrams * ((overlapEnd - overlapStart) / pourMs[i])
                    stomachGrams[i] += poured
                }
            }

            if (stomachGrams[i] > 0) {
                const absorbed = Math.min(stomachGrams[i], (stomachGrams[i] - poured / 2) * kaThisStep)
                stomachGrams[i] -= absorbed
                bloodGrams += absorbed * systemicFraction
                if (bloodGramsPerDrink) {
                    bloodGramsPerDrink[i] += absorbed * systemicFraction
                }
            }

            // Retire drinks that are fully poured with nothing left to absorb
            if (intervalEnd >= pourEndMs[i] && stomachGrams[i] < STOMACH_INERT_GRAMS) {
                stomachGrams[i] = 0
                active[a] = active[active.length - 1]
                active.pop()
            }
        }

        // 4. Michaelis-Menten elimination, with Vmax raised in the fed state
        if (bloodGrams > 0) {
            const concGL = bloodGrams / volumeL
            const eliminatedGL = (vmaxPerHour * (1 + VMAX_FOOD_BOOST * food) * intervalHours * concGL) / (KM + concGL)
            const eliminated = eliminatedGL * volumeL
            bloodGrams = Math.max(0, bloodGrams - eliminated)

            if (bloodGramsPerDrink) {
                const totalBefore = bloodGrams + eliminated
                for (let i = 0; i < drinks.length; i++) {
                    if (bloodGramsPerDrink[i] > 0) {
                        const fraction = bloodGramsPerDrink[i] / totalBefore
                        bloodGramsPerDrink[i] = Math.max(0, bloodGramsPerDrink[i] - eliminated * fraction)
                    }
                }
            }
        }

        /**
         * 5. With nothing pouring, nothing in any stomach and no measurable
         * blood alcohol, the state stays exactly zero until the next drink
         * starts: fill zero samples on the same grid and resume on the step
         * whose interval contains that start.
         */
        if (active.length === 0 && bloodGrams < BLOOD_INERT_GRAMS) {
            bloodGrams = 0
            if (bloodGramsPerDrink) bloodGramsPerDrink.fill(0)
            const nextStartMs = nextStartIdx < drinks.length ? drinks[startOrder[nextStartIdx]].start : Infinity

            let g = t + stepMs
            while (g <= endMs && g + stepMs <= nextStartMs) {
                if (collectPoints) {
                    points.push({ x: g, y: 0 })
                }
                if (collectPerDrink) {
                    for (let i = 0; i < drinks.length; i++) {
                        perDrinkPoints[i].push({ x: g, y: 0 })
                    }
                }
                g += stepMs
            }
            t = g
            continue
        }

        t += stepMs
    }

    const finalBac = bloodGrams / volumeL / 10

    // An `endMs` between samples is integrated but never sampled, so check it for the peak too
    if (peakFromMs !== undefined && endMs >= peakFromMs && finalBac > peakBac) {
        peakBac = finalBac
        peakTime = endMs
    }

    return {
        finalBac,
        peak: peakFromMs === undefined ? undefined : { bacGdl: peakBac, timeMs: peakTime },
        points,
        perDrinkPoints: collectPerDrink ? perDrinkPoints : undefined
    }
}

export function findEarliestDrink(drinks: ReadonlyArray<Drink>): number {
    'worklet'
    let earliest = Infinity
    for (const drink of drinks) {
        if (drink.start < earliest) earliest = drink.start
    }
    return earliest
}

export function findLatestDrinkEnd(drinks: ReadonlyArray<Drink>): number {
    'worklet'
    let latest = 0
    for (const drink of drinks) {
        if (drink.end > latest) latest = drink.end
    }
    return latest
}

/** Resamples a simulated curve onto a fixed grid, holding the last sample at or before each grid time. */
export function sampleAtInterval(
    simPoints: ReadonlyArray<BacPoint>,
    startMs: number,
    spanMs: number,
    stepMs: number
): BacPoint[] {
    'worklet'
    const steps = Math.floor(spanMs / stepMs)
    const samples: BacPoint[] = new Array(steps + 1)
    let simIdx = 0
    let t = startMs
    for (let i = 0; i <= steps; i++, t += stepMs) {
        while (simIdx < simPoints.length - 1 && simPoints[simIdx + 1].x <= t) {
            simIdx++
        }
        samples[i] = { x: t, y: simIdx < simPoints.length ? simPoints[simIdx].y : 0 }
    }
    return samples
}
