import { describe, expect, test } from 'bun:test'
import {
    bacAt,
    calculateTimeToNextDrink,
    calculateTimeWhenBelowThreshold,
    type Drink,
    findPeakBac,
    findPeakBacInWindow,
    findPeakBacResult,
    findSoberTime,
    perDrinkSeries,
    SOBER_TIME_UNAVAILABLE,
    series,
    type UserProfile
} from '../src'
import { FEMALE_60KG, hrs, MALE_80KG, sippedDrink, standardDrink, T0 } from './fixtures'

describe('findPeakBacResult', () => {
    test('captures a slow-absorption peak more than 30 minutes out', () => {
        const slowAbsorptionProfile: UserProfile = {
            ...FEMALE_60KG,
            weightKg: 50,
            heightCm: 160,
            metabolicFactor: 0.85,
            kaMultiplier: 0.5,
            fpFactor: 1
        }
        const drink = sippedDrink(T0, 1, 28)
        const thirtyMinutesAfter = drink.end + 30 * 60_000
        const peakWithinThirtyMinutes = findPeakBacInWindow(
            [drink],
            slowAbsorptionProfile,
            drink.start,
            thirtyMinutesAfter
        )
        const result = findPeakBacResult([drink], slowAbsorptionProfile, drink.start)

        expect(result.timeMs).toBeGreaterThan(thirtyMinutesAfter)
        expect(result.bacGdl).toBeGreaterThan(peakWithinThirtyMinutes * 1.3)
        expect(result.bacGdl).toBeCloseTo(findPeakBac([drink], slowAbsorptionProfile, drink.start), 10)
    })

    test('timestamps the peak at the end of the interval that produced it', () => {
        const noClearanceProfile: UserProfile = { ...MALE_80KG, metabolicFactor: 0 }
        const drink = sippedDrink(T0, 1, 28)
        const result = findPeakBacResult([drink], noClearanceProfile, drink.start)

        expect(result.timeMs).toBe(drink.end + hrs(6))
    })

    test('includes BAC exactly at a non-grid-aligned search boundary', () => {
        const drink = { ...standardDrink(T0), alcoholGrams: 70 }
        const fromMs = T0 + hrs(2) + 37_000
        const bacAtBoundary = bacAt(fromMs, [drink], MALE_80KG)
        const result = findPeakBacResult([drink], MALE_80KG, fromMs)

        expect(result.timeMs).toBe(fromMs)
        expect(result.bacGdl).toBeCloseTo(bacAtBoundary, 10)
    })
})

describe('calculateTimeWhenBelowThreshold', () => {
    test('returns null when already sober', () => {
        const result = calculateTimeWhenBelowThreshold([], 0.08, MALE_80KG, T0)
        expect(result).toBeNull()
    })

    test('returns null for pre-drink time', () => {
        const drinks = [standardDrink(T0)]
        const result = calculateTimeWhenBelowThreshold(drinks, 0.08, MALE_80KG, T0 - hrs(1))
        expect(result).toBeNull()
    })

    test('returns future Date when BAC is above threshold', () => {
        // Three drinks put BAC above the 0.02% threshold
        const drinks: Drink[] = [standardDrink(T0), standardDrink(T0 + 5 * 60_000), standardDrink(T0 + 10 * 60_000)]
        const checkTime = T0 + hrs(0.5) // 30 min after first drink

        const result = calculateTimeWhenBelowThreshold(drinks, 0.02, MALE_80KG, checkTime)
        expect(result).toBeInstanceOf(Date)
        expect(result?.getTime()).toBeGreaterThan(checkTime)
    })

    test('threshold time is reasonable (within a few hours for standard drinks)', () => {
        const drinks = [standardDrink(T0)]
        const checkTime = T0 + 10 * 60_000 // 10 min after

        const result = calculateTimeWhenBelowThreshold(drinks, 0.005, MALE_80KG, checkTime)
        expect(result).not.toBeNull()

        // Should clear 14g within a few hours
        const hoursUntilClear = ((result?.getTime() ?? 0) - checkTime) / hrs(1)
        expect(hoursUntilClear).toBeLessThan(4)
        expect(hoursUntilClear).toBeGreaterThan(0)
    })

    test('returns null instead of an unverified horizon when BAC cannot clear', () => {
        const drinks = [standardDrink(T0)]
        const noClearanceProfile = { ...MALE_80KG, metabolicFactor: 0 }
        const checkTime = T0 + hrs(1)

        expect(bacAt(checkTime, drinks, noClearanceProfile)).toBeGreaterThan(0.005)
        expect(calculateTimeWhenBelowThreshold(drinks, 0.005, noClearanceProfile, checkTime)).toBeNull()
    })
})

describe('series', () => {
    test('returns correct number of points', () => {
        const pts = series(T0, hrs(2), 60_000, [standardDrink(T0)], MALE_80KG)
        // 2 hours / 1 min = 120 steps + 1 = 121 points
        expect(pts.length).toBe(121)
    })

    test('x values are evenly spaced', () => {
        const pts = series(T0, hrs(1), 60_000, [standardDrink(T0)], MALE_80KG)
        for (let i = 1; i < pts.length; i++) {
            expect(pts[i].x - pts[i - 1].x).toBe(60_000)
        }
    })

    test('y values match bacAt for same timestamps', () => {
        const drinks = [standardDrink(T0)]
        const pts = series(T0, hrs(2), 60_000, drinks, MALE_80KG)

        const checks = [30, 60, 90]
        for (const idx of checks) {
            const seriesVal = pts[idx].y
            const directVal = bacAt(pts[idx].x, drinks, MALE_80KG)
            // Allow small numerical difference due to different step sizes
            expect(Math.abs(seriesVal - directVal)).toBeLessThan(0.003)
        }
    })
})

describe('findSoberTime', () => {
    test('returns 0 for no drinks', () => {
        expect(findSoberTime([], 0.0005, MALE_80KG)).toBe(0)
    })

    /**
     * Each sample holds the state at its own label, so the answer is the first
     * sampled moment at or below the threshold; padding it by a step would put
     * the crossing a step late.
     */
    test('returns the first sampled moment at or below the threshold', () => {
        const drinks = [standardDrink(T0)]
        const threshold = 0.001
        const soberAt = findSoberTime(drinks, threshold, MALE_80KG, [], 0)

        expect(bacAt(soberAt, drinks, MALE_80KG, [], 0)).toBeLessThanOrEqual(threshold)
        expect(bacAt(soberAt - 15_000, drinks, MALE_80KG, [], 0)).toBeGreaterThan(threshold)
    })

    test('matches calculateTimeWhenBelowThreshold for standard case', () => {
        const drinks: Drink[] = [standardDrink(T0), standardDrink(T0 + 5 * 60_000), standardDrink(T0 + 10 * 60_000)]
        const checkTime = T0 + hrs(0.5)

        const bisected = calculateTimeWhenBelowThreshold(drinks, 0.0005, MALE_80KG, checkTime)
        const forward = findSoberTime(drinks, 0.0005, MALE_80KG)

        expect(bisected).not.toBeNull()

        // Bisection stops at 1 minute, the forward scan at its 15 s step
        expect(Math.abs(forward - (bisected?.getTime() ?? 0))).toBeLessThan(2 * 60_000)
    })

    test('handles multi-session drinks correctly', () => {
        // Two sessions: one now, one 12h later
        const session1 = [standardDrink(T0), standardDrink(T0 + 5 * 60_000)]
        const session2 = [standardDrink(T0 + hrs(12)), standardDrink(T0 + hrs(12) + 5 * 60_000)]
        const allDrinks = [...session1, ...session2]

        const soberTime = findSoberTime(allDrinks, 0.0005, MALE_80KG)

        // Sober time should be AFTER the second session (not after the first)
        expect(soberTime).toBeGreaterThan(T0 + hrs(12))
        // And within a reasonable time after second session (< 6h for 2 drinks)
        expect(soberTime).toBeLessThan(T0 + hrs(18))
    })

    test('returns reasonable time for single drink', () => {
        const drinks = [standardDrink(T0)]
        const soberTime = findSoberTime(drinks, 0.0005, MALE_80KG)

        // Single standard drink should clear within 3h
        expect(soberTime).toBeGreaterThan(T0)
        expect(soberTime - T0).toBeLessThan(hrs(3))
    })

    test('never returns a finite sober time above the requested threshold', () => {
        const drinks = Array.from({ length: 50 }, (_, index) => standardDrink(T0 + index * 30 * 60_000))
        const slowProfile = { ...MALE_80KG, metabolicFactor: 0.8 }
        const soberTime = findSoberTime(drinks, 0.001, slowProfile, [], 0)

        expect(soberTime).not.toBe(SOBER_TIME_UNAVAILABLE)
        expect(soberTime).toBeGreaterThan(drinks[drinks.length - 1].end + hrs(48))
        expect(bacAt(soberTime, drinks, slowProfile, [], 0)).toBeLessThanOrEqual(0.001)
    })

    test('returns the unavailable sentinel when BAC cannot clear within the safety horizon', () => {
        const noClearanceProfile = { ...MALE_80KG, metabolicFactor: 0 }

        expect(findSoberTime([standardDrink(T0)], 0.001, noClearanceProfile, [], 0)).toBe(SOBER_TIME_UNAVAILABLE)
    })

    test('does not synthesize a zero-BAC crossing while simulation state remains positive', () => {
        const drinks = [standardDrink(T0)]
        const soberTime = findSoberTime(drinks, 0, MALE_80KG, [], 0)

        expect(soberTime).not.toBe(SOBER_TIME_UNAVAILABLE)
        expect(bacAt(soberTime, drinks, MALE_80KG, [], 0)).toBe(0)
    })
})

describe('findPeakBac', () => {
    test('returns 0 for no drinks', () => {
        expect(findPeakBac([], MALE_80KG, T0)).toBe(0)
    })

    test('peak matches series max for standard drinks', () => {
        const drinks: Drink[] = [standardDrink(T0), standardDrink(T0 + 5 * 60_000), standardDrink(T0 + 10 * 60_000)]

        const peak = findPeakBac(drinks, MALE_80KG, T0)
        const pts = series(T0, hrs(6), 60_000, drinks, MALE_80KG)
        const seriesMax = Math.max(...pts.map(p => p.y))

        // Should agree within 0.002 g/dL (different step sizes)
        expect(Math.abs(peak - seriesMax)).toBeLessThan(0.002)
    })

    test('finds peak from multi-session drinks', () => {
        // Heavy session followed by light session
        const heavy = [standardDrink(T0), standardDrink(T0 + 5 * 60_000), standardDrink(T0 + 10 * 60_000)]
        const light = [standardDrink(T0 + hrs(12))]

        const peakHeavy = findPeakBac(heavy, MALE_80KG, T0)
        const peakAll = findPeakBac([...heavy, ...light], MALE_80KG, T0)

        // Peak should be from the heavy session (3 drinks > 1 drink)
        expect(peakAll).toBeCloseTo(peakHeavy, 2)
    })
})

describe('findPeakBacInWindow', () => {
    test('does not look ahead to a future peak when the current BAC is still near zero', () => {
        const grams = 22.4076
        const drink = sippedDrink(T0, 10, grams)
        const sessionStart = T0 + 4_000
        const peakSoFar = findPeakBacInWindow([drink], MALE_80KG, sessionStart, sessionStart, [], 0.67)
        const eventualPeak = findPeakBac([drink], MALE_80KG, sessionStart, [], 0.67)

        expect(peakSoFar).toBeLessThan(0.0005)
        expect(eventualPeak).toBeGreaterThan(0.0005)
    })

    /**
     * A window narrower than the 15s sample grid can contain no sample label at
     * all. Reading only the labels would report zero while BAC is clearly
     * above it.
     */
    test('reports a real peak for a window narrower than the sample grid', () => {
        const drinks = [{ ...standardDrink(T0), alcoholGrams: 28 }]
        const offGrid = T0 + 5 * 60_000 + 5_000

        const narrow = findPeakBacInWindow(drinks, MALE_80KG, offGrid, offGrid + 1, [], 0)

        expect(narrow).toBeCloseTo(bacAt(offGrid + 1, drinks, MALE_80KG, [], 0), 10)
        expect(narrow).toBeGreaterThan(0.01)
    })

    /**
     * On a falling limb the maximum sits at `fromMs`, so reading only the end of
     * the window makes the reported maximum shrink as the window grows.
     */
    test('never reports a smaller maximum as the window widens', () => {
        const drinks = [{ ...standardDrink(T0), alcoholGrams: 28 }]
        const from = T0 + hrs(2) + 1_000

        let previous = 0
        for (let seconds = 1; seconds <= 15; seconds++) {
            const peak = findPeakBacInWindow(drinks, MALE_80KG, from, from + seconds * 1_000, [], 0)
            expect(peak).toBeGreaterThanOrEqual(previous)
            previous = peak
        }
        expect(previous).toBeCloseTo(bacAt(from, drinks, MALE_80KG, [], 0), 10)
    })
})

describe('perDrinkSeries', () => {
    test('per-drink curves add up to the total, sample by sample', () => {
        const drinks = [sippedDrink(T0, 30, 20), sippedDrink(T0 + hrs(0.75), 20), standardDrink(T0 + hrs(1.5))]
        const meals = [{ timeMs: T0 + hrs(0.5), level: 0.67 }]
        const { perDrink, totalPoints } = perDrinkSeries(T0, hrs(6), 60_000, drinks, FEMALE_60KG, meals, 0)

        expect(perDrink.map(curve => curve.drinkIndex)).toEqual([0, 1, 2])
        for (let i = 0; i < totalPoints.length; i++) {
            const sum = perDrink.reduce((acc, curve) => acc + curve.points[i].y, 0)
            expect(Math.abs(sum - totalPoints[i].y)).toBeLessThan(1e-12)
        }
    })

    test('the total matches series on the same grid', () => {
        const drinks = [sippedDrink(T0, 30, 20), standardDrink(T0 + hrs(1))]
        const { totalPoints } = perDrinkSeries(T0, hrs(4), 60_000, drinks, MALE_80KG, [], 0.33)

        expect(totalPoints).toEqual(series(T0, hrs(4), 60_000, drinks, MALE_80KG, [], 0.33))
    })

    test('a drink contributes nothing before it starts', () => {
        const drinks = [standardDrink(T0), standardDrink(T0 + hrs(2))]
        const { perDrink } = perDrinkSeries(T0, hrs(4), 60_000, drinks, MALE_80KG)

        for (const point of perDrink[1].points) {
            if (point.x <= T0 + hrs(2)) expect(point.y).toBe(0)
        }
    })
})

describe('calculateTimeToNextDrink', () => {
    const now = T0 + hrs(1)

    test('returns null when the next drink can start now', () => {
        expect(calculateTimeToNextDrink([standardDrink(T0)], MALE_80KG, 0.08, 14, 30, now)).toBeNull()
    })

    test('returns Infinity when BAC is already at the limit', () => {
        const drinks = [sippedDrink(T0, 30, 60)]
        expect(bacAt(now, drinks, MALE_80KG)).toBeGreaterThan(0.03)
        expect(calculateTimeToNextDrink(drinks, MALE_80KG, 0.03, 14, 30, now)).toBe(Infinity)
    })

    test('returns a future time from which the next drink keeps the peak under the limit', () => {
        const drinks = [sippedDrink(T0, 30, 36)]
        const limit = 0.05
        const waitUntil = calculateTimeToNextDrink(drinks, MALE_80KG, limit, 14, 30, now)

        expect(waitUntil).not.toBeNull()
        expect(waitUntil).toBeGreaterThan(now)
        expect(waitUntil).toBeLessThan(Infinity)

        const start = waitUntil as number
        const next = (t: number) => [...drinks, sippedDrink(t, 30, 14)]
        expect(findPeakBac(next(start), MALE_80KG, start)).toBeLessThanOrEqual(limit)
        expect(findPeakBac(next(start - 60_000), MALE_80KG, start - 60_000)).toBeGreaterThan(limit)
    })
})
