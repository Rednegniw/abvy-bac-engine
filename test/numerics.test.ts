import { describe, expect, test } from 'bun:test'
import { bacAt, findPeakBac, findPeakBacInWindow, type MealEvent, series } from '../src'
import { hrs, MALE_80KG, sippedDrink, standardDrink, T0 } from './fixtures'

describe('simulation interval invariants', () => {
    test('an off-grid sip duration agrees between 15 s and 60 s steps', () => {
        const drink = sippedDrink(T0, 70 / 60)
        const peak15s = findPeakBacInWindow([drink], MALE_80KG, T0, T0 + hrs(6), [], 0)
        const peak60s = findPeakBac([drink], MALE_80KG, T0, [], 0)

        expect(Math.abs(peak60s - peak15s)).toBeLessThan(0.0002)
    })

    /**
     * The peak comparison above is nearly blind: the curve is flat at its
     * summit, so a whole-step timing error barely moves it. The rising limb is
     * where the two step sizes diverge, so compare them there, sample by
     * sample.
     */
    test('sampled series agrees with bacAt sample by sample across the rising limb', () => {
        const drinks = [standardDrink(T0), standardDrink(T0 + 5 * 60_000), standardDrink(T0 + 10 * 60_000)]
        const sampled = series(T0, hrs(2), 60_000, drinks, MALE_80KG, [], 0)

        /**
         * The bound is first-order Euler error, which scales with the absorption
         * rate: measured 0.00067 at KA_EMPTY = 4.6. Filing each sample one step
         * early or late costs several times this, so the guard catches it.
         */
        for (const point of sampled) {
            expect(Math.abs(point.y - bacAt(point.x, drinks, MALE_80KG, [], 0))).toBeLessThan(0.0009)
        }
    })

    test('a sample carries the state at its own timestamp, not the next step', () => {
        const sampled = series(T0, hrs(1), 60_000, [standardDrink(T0)], MALE_80KG, [], 0)

        // Nothing has been absorbed at the instant of the pour.
        expect(sampled[0]).toEqual({ x: T0, y: 0 })
    })

    /**
     * The samples stop short of an off-grid `endMs`, so the state there is only
     * reachable from the post-loop value. Without it the peak both under-reports
     * and lands a partial step early.
     */
    test('peak includes the state at an off-grid end of the search window', () => {
        const drinks = [{ ...standardDrink(T0), alcoholGrams: 28 }]

        /**
         * Deliberately on the rising limb, so the window's maximum is its end
         * point and only the off-grid tail can supply it. A window reaching
         * past the peak would pass on the interior maximum alone.
         */
        const offGridEnd = T0 + 20 * 60_000 + 7_250
        const peak = findPeakBacInWindow(drinks, MALE_80KG, T0, offGridEnd, [], 0)

        let denseMax = 0
        for (let t = T0; t <= offGridEnd; t += 1_000) {
            denseMax = Math.max(denseMax, bacAt(t, drinks, MALE_80KG, [], 0))
        }

        expect(peak).toBeCloseTo(bacAt(offGridEnd, drinks, MALE_80KG, [], 0), 10)

        /**
         * Looser than the endpoint check above: `bacAt` re-integrates from the
         * first drink for every query, and its partial final interval leaves a
         * ~2e-6 g/dL ripple, so a dense scan can top the endpoint by that much.
         */
        expect(peak).toBeCloseTo(denseMax, 5)
    })

    test('captures a drink whose duration falls entirely between grid timestamps', () => {
        const anchor = { ...standardDrink(T0), alcoholGrams: 0 }
        const betweenTicks = sippedDrink(T0 + 1, 14_998 / 60_000)

        expect(findPeakBac([anchor, betweenTicks], MALE_80KG, T0, [], 0)).toBeGreaterThan(0.01)
    })

    test('does not ingest a future shot beyond the query time', () => {
        const anchor = { ...standardDrink(T0), alcoholGrams: 0 }
        const futureShot = standardDrink(T0 + 58_000)

        expect(bacAt(T0 + 50_000, [anchor, futureShot], MALE_80KG, [], 0)).toBe(0)
    })

    test('scales absorption and elimination to a partial final interval', () => {
        const bacAfterOneMillisecond = bacAt(T0 + 1, [standardDrink(T0)], MALE_80KG, [], 0)

        expect(bacAfterOneMillisecond).toBeGreaterThan(0)
        expect(bacAfterOneMillisecond).toBeLessThan(0.000001)
    })

    test('applies only one millisecond of elimination at a partial boundary', () => {
        const drinks = Array.from({ length: 5 }, () => standardDrink(T0))
        const decliningAt = T0 + hrs(2)
        const bacAtBoundary = bacAt(decliningAt, drinks, MALE_80KG, [], 0)
        const bacAfterOneMillisecond = bacAt(decliningAt + 1, drinks, MALE_80KG, [], 0)
        const bacAfterFullStep = bacAt(decliningAt + 15_000, drinks, MALE_80KG, [], 0)
        const oneMillisecondDrop = bacAtBoundary - bacAfterOneMillisecond
        const fullStepDrop = bacAtBoundary - bacAfterFullStep

        expect(oneMillisecondDrop).toBeGreaterThan(0)
        expect(fullStepDrop).toBeGreaterThan(0)
        expect(oneMillisecondDrop).toBeLessThan(fullStepDrop / 1_000)
    })

    test('initial food state is invariant to an earlier series window', () => {
        const drinks = [sippedDrink(T0, 10, 20)]
        const target = T0 + 30 * 60_000
        const aligned = series(T0, hrs(1), 60_000, drinks, MALE_80KG, [], 1)
        const chartLike = series(T0 - hrs(48), hrs(49), 60_000, drinks, MALE_80KG, [], 1)
        const alignedSample = aligned.find(point => point.x === target)?.y
        const earlySample = chartLike.find(point => point.x === target)?.y

        expect(alignedSample).toBeDefined()
        expect(earlySample).toBeDefined()
        expect(earlySample).toBeCloseTo(alignedSample ?? 0, 10)
    })
})

describe('dead-time skipping over drink-free history', () => {
    test('a months-old occasion contributes exactly nothing to today', () => {
        const oldNight = [sippedDrink(T0 - hrs(24 * 90), 60, 40), sippedDrink(T0 - hrs(24 * 90) + hrs(1), 60, 40)]
        const tonight = sippedDrink(T0, 30, 28)

        /**
         * TBW anchors the user's age at the earliest drink, so the comparison
         * set pins the same anchor with a zero-alcohol drink; only the old
         * night's alcohol may then differ between the two calls.
         */
        const anchor = { ...sippedDrink(T0 - hrs(24 * 90), 60, 40), alcoholGrams: 0 }

        // Unsorted input on purpose: the newest drink first
        const withHistory = bacAt(T0 + hrs(1), [tonight, ...oldNight], MALE_80KG, [], 0)
        const alone = bacAt(T0 + hrs(1), [tonight, anchor], MALE_80KG, [], 0)

        expect(alone).toBeGreaterThan(0)
        expect(withHistory).toBeCloseTo(alone, 12)
    })

    test('overnight residual still carries into the next drink', () => {
        const heavyNight = sippedDrink(T0, 120, 120)
        const nextDrink = sippedDrink(T0 + hrs(8), 30, 14)
        const probeMs = T0 + hrs(8.5)

        const withResidual = bacAt(probeMs, [heavyNight, nextDrink], MALE_80KG, [], 0)
        const freshStart = bacAt(probeMs, [nextDrink], MALE_80KG, [], 0)

        expect(withResidual).toBeGreaterThan(freshStart + 0.01)
    })

    test('series over sparse history keeps the sample grid and zeroed gaps', () => {
        const staleDrink = sippedDrink(T0 - hrs(24 * 200), 60, 30)
        const recentDrink = sippedDrink(T0, 60, 30)
        const startMs = T0 - hrs(2)
        const spanMs = hrs(6)
        const stepMs = 60_000

        // Zero-alcohol drink pins the TBW age anchor (see the test above)
        const anchor = { ...staleDrink, alcoholGrams: 0 }
        const pts = series(startMs, spanMs, stepMs, [staleDrink, recentDrink], MALE_80KG, [], 0)
        const alonePts = series(startMs, spanMs, stepMs, [recentDrink, anchor], MALE_80KG, [], 0)

        expect(pts.length).toBe(spanMs / stepMs + 1)
        expect(pts[0].y).toBe(0)
        expect(pts.find(p => p.x >= T0 + hrs(1))?.y).toBeGreaterThan(0)
        pts.forEach((p, i) => {
            expect(p.x).toBe(alonePts[i].x)
            expect(p.y).toBeCloseTo(alonePts[i].y, 12)
        })
    })

    test('a meal before the drink still dampens absorption', () => {
        const drink = sippedDrink(T0, 30, 28)
        const meal: MealEvent = { timeMs: T0 - hrs(2), level: 1.0 }

        const withMeal = bacAt(T0 + hrs(0.5), [drink], MALE_80KG, [meal], 0)
        const withoutMeal = bacAt(T0 + hrs(0.5), [drink], MALE_80KG, [], 0)

        expect(withMeal).toBeLessThan(withoutMeal)
        expect(withMeal).toBeGreaterThan(0)
    })
})
