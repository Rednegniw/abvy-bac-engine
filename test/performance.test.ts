import { describe, expect, test } from 'bun:test'
import { bacAt, calculateTimeToNextDrink, type MealEvent, perDrinkSeries, series } from '../src'
import { hrs, MALE_80KG, sippedDrink, standardDrink, T0 } from './fixtures'

/**
 * A single timed call swings several-fold run to run (JIT warm-up, GC), so
 * every budget is the mean over many calls after a warm-up pass. Budgets are
 * skipped when CI is set, because shared runners make wall-clock timings
 * unreliable.
 */
const ITERATIONS = 50

function meanMs(call: () => unknown): number {
    for (let i = 0; i < ITERATIONS; i++) call()

    const start = performance.now()
    for (let i = 0; i < ITERATIONS; i++) call()
    return (performance.now() - start) / ITERATIONS
}

describe.skipIf(Boolean(process.env.CI))('performance', () => {
    test('bacAt completes within 2ms with meals', () => {
        const drinks = Array.from({ length: 10 }, (_, i) => standardDrink(T0 + i * 30 * 60_000))
        const meals: MealEvent[] = [
            { timeMs: T0 - 60 * 60_000, level: 0.67 },
            { timeMs: T0 + 45 * 60_000, level: 1.0 },
            { timeMs: T0 + 2 * 3_600_000, level: 0.33 }
        ]

        expect(meanMs(() => bacAt(T0 + hrs(3), drinks, MALE_80KG, meals, 0.33))).toBeLessThan(2)
    })

    test('series (6hr span) completes within 10ms with meals', () => {
        const drinks = Array.from({ length: 8 }, (_, i) => standardDrink(T0 + i * 45 * 60_000))
        const meals: MealEvent[] = [
            { timeMs: T0 - 30 * 60_000, level: 0.67 },
            { timeMs: T0 + 60 * 60_000, level: 1.0 },
            { timeMs: T0 + 3 * 3_600_000, level: 0.33 }
        ]

        expect(meanMs(() => series(T0, hrs(6), 60_000, drinks, MALE_80KG, meals, 0.33))).toBeLessThan(10)
    })

    test('perDrinkSeries completes within 15ms with meals', () => {
        const drinks = Array.from({ length: 8 }, (_, i) => standardDrink(T0 + i * 45 * 60_000))
        const meals: MealEvent[] = [
            { timeMs: T0, level: 0.67 },
            { timeMs: T0 + 2 * 3_600_000, level: 1.0 }
        ]

        expect(meanMs(() => perDrinkSeries(T0, hrs(6), 60_000, drinks, MALE_80KG, meals, 0.33))).toBeLessThan(15)
    })

    test('calculateTimeToNextDrink stays within its per-call budget with meals', () => {
        const drinks = Array.from({ length: 5 }, (_, i) => sippedDrink(T0 + i * 30 * 60_000, 20))
        const meals: MealEvent[] = [
            { timeMs: T0 - 60 * 60_000, level: 0.67 },
            { timeMs: T0 + 60 * 60_000, level: 1.0 }
        ]

        /**
         * This fixture takes the full binary-search path (~20 findPeakBac
         * simulations) over drinks sipped at a realistic pace. Steady state
         * measures ~27 ms here; the budget leaves headroom for slower hardware.
         */
        const call = () => calculateTimeToNextDrink(drinks, MALE_80KG, 0.06, 14, 30, T0 + hrs(2.5), meals, 0.33)
        expect(meanMs(call)).toBeLessThan(45)
    })

    test('bacAt without meals stays fast', () => {
        const drinks = Array.from({ length: 10 }, (_, i) => sippedDrink(T0 + i * 20 * 60_000, 20))

        expect(meanMs(() => bacAt(T0 + hrs(4), drinks, MALE_80KG))).toBeLessThan(6)
    })
})
