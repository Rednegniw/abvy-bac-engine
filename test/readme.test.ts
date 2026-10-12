import { describe, expect, test } from 'bun:test'
import {
    bacAt,
    calculateTimeToNextDrink,
    type Drink,
    FP_FACTOR_FEMALE,
    findPeakBacResult,
    findSoberTime,
    MEAL_LEVEL,
    type MealEvent,
    SOBER_THRESHOLD_GDL,
    series,
    type UserProfile
} from '../src'

/** Replays the README usage example, so the outputs it quotes cannot drift from the engine. */
describe('README example', () => {
    const me: UserProfile = {
        sex: 'female',
        weightKg: 64,
        heightCm: 168,
        birthday: Date.UTC(1995, 3, 12),
        metabolicFactor: 1,
        kaMultiplier: 1,
        fpFactor: FP_FACTOR_FEMALE
    }
    const t0 = Date.UTC(2026, 9, 10, 19, 0)
    const min = (m: number) => m * 60_000
    const drinks: Drink[] = [
        { alcoholGrams: 20, start: t0, end: t0 + min(30) },
        { alcoholGrams: 14, start: t0 + min(45), end: t0 + min(75) }
    ]
    const meals: MealEvent[] = [{ timeMs: t0 + min(20), level: MEAL_LEVEL.moderate }]
    const stomachAtFirstDrink = MEAL_LEVEL.empty

    const clock = (t: number) => new Date(t).toISOString().slice(11, 16)

    test('quoted outputs', () => {
        expect(bacAt(t0 + min(90), drinks, me, meals, stomachAtFirstDrink)).toBeCloseTo(0.0508, 4)

        const peak = findPeakBacResult(drinks, me, t0, meals, stomachAtFirstDrink)
        expect(peak.bacGdl).toBeCloseTo(0.0517, 4)
        expect(clock(peak.timeMs)).toBe('20:40')

        expect(clock(findSoberTime(drinks, SOBER_THRESHOLD_GDL, me, meals, stomachAtFirstDrink))).toBe('00:52')
        expect(series(t0, min(360), min(1), drinks, me, meals, stomachAtFirstDrink)).toHaveLength(361)

        const next = calculateTimeToNextDrink(drinks, me, 0.06, 14, 30, t0 + min(90), meals, stomachAtFirstDrink)
        expect(clock(next as number)).toBe('21:26')

        expect(findPeakBacResult(drinks, me, t0, [], stomachAtFirstDrink).bacGdl).toBeCloseTo(0.062, 3)
    })
})
