import { describe, expect, test } from 'bun:test'
import { bacAt, type Drink, type MealEvent, series, type UserProfile } from '../src'
import { FEMALE_60KG, hrs, MALE_80KG, sippedDrink, standardDrink, T0 } from './fixtures'

describe('single standard drink (14g)', () => {
    const drinks = [standardDrink(T0)]

    test('peaks around 0.02% for 80kg male', () => {
        // Sample every minute for 2 hours, find peak
        let peak = 0
        for (let t = T0; t <= T0 + hrs(2); t += 60_000) {
            const bac = bacAt(t, drinks, MALE_80KG)
            if (bac > peak) peak = bac
        }
        expect(peak).toBeGreaterThan(0.01)
        expect(peak).toBeLessThan(0.04)
    })

    test('returns to near zero within 2 hours', () => {
        const bac = bacAt(T0 + hrs(2), drinks, MALE_80KG)
        expect(bac).toBeLessThan(0.005)
    })
})

describe('dose proportionality', () => {
    test('double alcohol gives roughly 2x peak (not exact due to MM)', () => {
        const single = [standardDrink(T0)]
        const double = [{ ...standardDrink(T0), alcoholGrams: 28 }]

        let peakSingle = 0
        let peakDouble = 0
        for (let t = T0; t <= T0 + hrs(2); t += 60_000) {
            peakSingle = Math.max(peakSingle, bacAt(t, single, MALE_80KG))
            peakDouble = Math.max(peakDouble, bacAt(t, double, MALE_80KG))
        }

        const ratio = peakDouble / peakSingle
        /**
         * Should be roughly 2x. MM nonlinearity means elimination is saturated at higher
         * dose, so peak can be slightly >2x (more alcohol survives the absorption window).
         */
        expect(ratio).toBeGreaterThan(1.7)
        expect(ratio).toBeLessThan(2.6)
    })
})

describe('sex difference', () => {
    test('female gets higher BAC than male for same drink', () => {
        const drinks = [standardDrink(T0)]
        const tCheck = T0 + hrs(0.5)

        const maleBac = bacAt(tCheck, drinks, MALE_80KG)
        const femaleBac = bacAt(tCheck, drinks, FEMALE_60KG)

        expect(femaleBac).toBeGreaterThan(maleBac)
        // Female Vd is smaller, so BAC should be meaningfully higher
        expect(femaleBac / maleBac).toBeGreaterThan(1.3)
    })
})

describe('metabolic factor', () => {
    test('higher factor means faster clearance', () => {
        const drinks = [standardDrink(T0)]
        const slow: UserProfile = { ...MALE_80KG, metabolicFactor: 0.8 }
        const fast: UserProfile = { ...MALE_80KG, metabolicFactor: 1.5 }

        // Check at 1 hour - fast metabolizer should have lower BAC
        const tCheck = T0 + hrs(1)
        const slowBac = bacAt(tCheck, drinks, slow)
        const fastBac = bacAt(tCheck, drinks, fast)

        expect(fastBac).toBeLessThan(slowBac)
    })
})

describe('food state', () => {
    test('empty stomach gives higher earlier peak than full', () => {
        const drinks = [standardDrink(T0)]

        const tEarly = T0 + 15 * 60_000
        const emptyBac = bacAt(tEarly, drinks, MALE_80KG, [], 0.0)
        const fullBac = bacAt(tEarly, drinks, MALE_80KG, [], 1.0)

        expect(emptyBac).toBeGreaterThan(fullBac)
    })

    test('full stomach has lower peak overall', () => {
        const drinks = [standardDrink(T0)]

        let peakEmpty = 0
        let peakFull = 0
        for (let t = T0; t <= T0 + hrs(2); t += 60_000) {
            peakEmpty = Math.max(peakEmpty, bacAt(t, drinks, MALE_80KG, [], 0.0))
            peakFull = Math.max(peakFull, bacAt(t, drinks, MALE_80KG, [], 1.0))
        }

        expect(peakFull).toBeLessThan(peakEmpty)
    })

    test('rate spread preserved: empty=4.6, full=1.5 per hour', () => {
        const drinks = [standardDrink(T0)]
        // At early time, empty absorbs much faster
        const emptyBac = bacAt(T0 + 10 * 60_000, drinks, MALE_80KG, [], 0.0)
        const fullBac = bacAt(T0 + 10 * 60_000, drinks, MALE_80KG, [], 1.0)
        expect(emptyBac).toBeGreaterThan(fullBac * 1.3)
    })
})

describe('time-varying food state', () => {
    test('a meal after the drink lowers the peak', () => {
        const drinks = [standardDrink(T0)]
        const noMeals: MealEvent[] = []
        const mealAfter: MealEvent[] = [{ timeMs: T0 + 15 * 60_000, level: 1.0 }]

        let peakNoMeal = 0
        let peakWithMeal = 0
        for (let t = T0; t <= T0 + hrs(3); t += 60_000) {
            peakNoMeal = Math.max(peakNoMeal, bacAt(t, drinks, MALE_80KG, noMeals, 0.0))
            peakWithMeal = Math.max(peakWithMeal, bacAt(t, drinks, MALE_80KG, mealAfter, 0.0))
        }
        expect(peakWithMeal).toBeLessThan(peakNoMeal)
    })

    test('an old meal has a decayed effect', () => {
        const drinks = [standardDrink(T0)]
        const oldMeal: MealEvent[] = [{ timeMs: T0 - 4 * 3_600_000, level: 1.0 }]
        const recentMeal: MealEvent[] = [{ timeMs: T0 - 5 * 60_000, level: 1.0 }]

        let peakOldMeal = 0
        let peakRecentMeal = 0
        for (let t = T0; t <= T0 + hrs(3); t += 60_000) {
            peakOldMeal = Math.max(peakOldMeal, bacAt(t, drinks, MALE_80KG, oldMeal, 0.0))
            peakRecentMeal = Math.max(peakRecentMeal, bacAt(t, drinks, MALE_80KG, recentMeal, 0.0))
        }
        // Old meal barely slows absorption, so peak should be higher (closer to no-meal)
        expect(peakOldMeal).toBeGreaterThan(peakRecentMeal)
    })

    test('initialFoodLevel affects absorption', () => {
        const drinks = [standardDrink(T0)]
        const emptyStart = bacAt(T0 + 30 * 60_000, drinks, MALE_80KG, [], 0.0)
        const fullStart = bacAt(T0 + 30 * 60_000, drinks, MALE_80KG, [], 1.0)
        expect(emptyStart).toBeGreaterThan(fullStart)
    })

    test('multiple meals stack, clamped at 1.0', () => {
        const drinks = [standardDrink(T0)]
        const oneMeal: MealEvent[] = [{ timeMs: T0 - 10 * 60_000, level: 0.33 }]
        const twoMeals: MealEvent[] = [
            { timeMs: T0 - 20 * 60_000, level: 0.33 },
            { timeMs: T0 - 10 * 60_000, level: 0.67 }
        ]

        let peakOne = 0
        let peakTwo = 0
        for (let t = T0; t <= T0 + hrs(3); t += 60_000) {
            peakOne = Math.max(peakOne, bacAt(t, drinks, MALE_80KG, oneMeal, 0.0))
            peakTwo = Math.max(peakTwo, bacAt(t, drinks, MALE_80KG, twoMeals, 0.0))
        }
        expect(peakTwo).toBeLessThan(peakOne)
    })

    test('default behavior matches light food state', () => {
        const drinks = [standardDrink(T0)]
        const defaultBac = bacAt(T0 + 30 * 60_000, drinks, MALE_80KG)
        const lightBac = bacAt(T0 + 30 * 60_000, drinks, MALE_80KG, [], 0.33)
        expect(defaultBac).toBeCloseTo(lightBac, 6)
    })

    test('meal before drink slows absorption', () => {
        const drinks = [standardDrink(T0)]
        const mealBefore: MealEvent[] = [{ timeMs: T0 - 15 * 60_000, level: 1.0 }]

        let peakNoMeal = 0
        let peakWithMeal = 0
        for (let t = T0; t <= T0 + hrs(3); t += 60_000) {
            peakNoMeal = Math.max(peakNoMeal, bacAt(t, drinks, MALE_80KG, [], 0.0))
            peakWithMeal = Math.max(peakWithMeal, bacAt(t, drinks, MALE_80KG, mealBefore, 0.0))
        }
        expect(peakWithMeal).toBeLessThan(peakNoMeal)
    })
})

describe('shot vs sipping', () => {
    test('shot has higher peak than same amount sipped over 30 min', () => {
        const shot = [standardDrink(T0)]
        const sipped = [sippedDrink(T0, 30)]

        let peakShot = 0
        let peakSipped = 0
        for (let t = T0; t <= T0 + hrs(2); t += 60_000) {
            peakShot = Math.max(peakShot, bacAt(t, shot, MALE_80KG))
            peakSipped = Math.max(peakSipped, bacAt(t, sipped, MALE_80KG))
        }

        expect(peakShot).toBeGreaterThan(peakSipped)
    })
})

describe('multiple drinks stacking', () => {
    test('3 beers for 80kg male peaks around 0.05-0.08%', () => {
        // 3 beers (~14g each) over 2 hours
        const drinks: Drink[] = [standardDrink(T0), standardDrink(T0 + hrs(1)), standardDrink(T0 + hrs(2))]

        let peak = 0
        for (let t = T0; t <= T0 + hrs(4); t += 60_000) {
            peak = Math.max(peak, bacAt(t, drinks, MALE_80KG))
        }

        expect(peak).toBeGreaterThan(0.03)
        expect(peak).toBeLessThan(0.1)
    })
})

describe('edge cases', () => {
    test('no drinks returns 0', () => {
        expect(bacAt(T0, [], MALE_80KG)).toBe(0)
    })

    test('time before first drink returns 0', () => {
        const drinks = [standardDrink(T0)]
        expect(bacAt(T0 - hrs(1), drinks, MALE_80KG)).toBe(0)
    })

    test('24 hours later BAC is essentially zero', () => {
        const drinks = [standardDrink(T0)]
        const bac = bacAt(T0 + hrs(24), drinks, MALE_80KG)
        expect(bac).toBeLessThan(0.001)
    })

    test('zero-gram drink gives 0', () => {
        const drinks: Drink[] = [{ alcoholGrams: 0, start: T0, end: T0 }]
        expect(bacAt(T0 + hrs(1), drinks, MALE_80KG)).toBe(0)
    })

    test('series throws on stepMs <= 0', () => {
        expect(() => series(T0, hrs(1), 0, [], MALE_80KG)).toThrow(RangeError)
        expect(() => series(T0, hrs(1), -1000, [], MALE_80KG)).toThrow(RangeError)
    })

    test('series with no drinks returns all zeros', () => {
        const pts = series(T0, hrs(1), 60_000, [], MALE_80KG)
        expect(pts.length).toBeGreaterThan(0)
        for (const p of pts) {
            expect(p.y).toBe(0)
        }
    })
})

describe('Widmark cross-reference', () => {
    test('peak BAC roughly consistent with Widmark estimate', () => {
        /**
         * Widmark: BAC = (A / (r * W * 1000)) * 100
         * where A=grams, r=0.68 (male), W=kg
         * For 14g: BAC ≈ 14 / (0.68 * 80 * 10) = 0.0257%
         * Our model should be in the same ballpark
         */
        const drinks = [standardDrink(T0)]
        let peak = 0
        for (let t = T0; t <= T0 + hrs(2); t += 60_000) {
            peak = Math.max(peak, bacAt(t, drinks, MALE_80KG))
        }

        const widmarkEstimate = 14 / (0.68 * 80 * 10)
        // Peak should be within 50% of Widmark (Widmark ignores absorption delay)
        expect(peak).toBeGreaterThan(widmarkEstimate * 0.5)
        expect(peak).toBeLessThan(widmarkEstimate * 1.5)
    })
})

describe('MM tail behavior', () => {
    test('elimination rate decreases at low BAC', () => {
        /**
         * Use a large dose so the declining phase spans a wide BAC range.
         * Measure well after absorption is complete (ka is about 3.6/h on the default light stomach, so 99% is absorbed within about 1.3 h).
         */
        const drinks = [{ ...standardDrink(T0), alcoholGrams: 70 }] // 5 standard drinks at once

        // High-BAC window: 2.5-2.75 h (absorption finished, BAC still elevated)
        const t1 = T0 + hrs(2.5)
        const t2 = T0 + hrs(2.75)
        const bac1 = bacAt(t1, drinks, MALE_80KG)
        const bac2 = bacAt(t2, drinks, MALE_80KG)
        const rateHigh = (bac1 - bac2) / 0.25

        // Low-BAC window: 5-5.25 h (BAC much lower)
        const t3 = T0 + hrs(5)
        const t4 = T0 + hrs(5.25)
        const bac3 = bacAt(t3, drinks, MALE_80KG)
        const bac4 = bacAt(t4, drinks, MALE_80KG)
        const rateLow = (bac3 - bac4) / 0.25

        // MM predicts slower elimination at lower concentration
        expect(bac1).toBeGreaterThan(bac3) // confirm BAC is actually lower in second window
        expect(rateLow).toBeLessThan(rateHigh)
    })
})
