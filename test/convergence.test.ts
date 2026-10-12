import { describe, expect, test } from 'bun:test'
import { type Drink, findSoberTime, SOBER_THRESHOLD_GDL, type UserProfile } from '../src'
import { simulate } from '../src/simulate'
import { hrs, MALE_80KG, T0 } from './fixtures'

/**
 * The step sizes the queries use (15 s and 60 s) against a 1-second
 * integration of the same equations, over a shot, a mixed evening and ten
 * drinks in five hours, for an average man and a fast-absorbing profile on an
 * empty, light and full stomach. docs/MODEL.md quotes these bounds.
 */
const FAST_ABSORBER: UserProfile = {
    ...MALE_80KG,
    sex: 'female',
    weightKg: 60,
    heightCm: 165,
    kaMultiplier: 1.5,
    fpFactor: 0
}

const min = (m: number) => m * 60_000
const EVENINGS: Record<string, Drink[]> = {
    shot: [{ alcoholGrams: 14, start: T0, end: T0 }],
    evening: [
        { alcoholGrams: 20, start: T0, end: T0 + min(25) },
        { alcoholGrams: 14, start: T0 + min(40), end: T0 + min(60) },
        { alcoholGrams: 28, start: T0 + min(95), end: T0 + min(105) }
    ],
    heavy: Array.from({ length: 10 }, (_, i) => ({
        alcoholGrams: 18,
        start: T0 + i * min(30),
        end: T0 + i * min(30) + min(15)
    }))
}

const BOUNDS = [
    { stepMs: 15_000, peak: 0.005, curve: 0.0005, soberMs: 60_000 },
    { stepMs: 60_000, peak: 0.015, curve: 0.0015, soberMs: 150_000 }
]

function run(drinks: Drink[], user: UserProfile, food: number, stepMs: number) {
    return simulate({
        drinks,
        user,
        startMs: T0,
        endMs: T0 + hrs(12),
        stepMs,
        collectPoints: true,
        initialFoodLevel: food,
        initialFoodAtMs: T0,
        peakFromMs: T0
    })
}

describe('integration step convergence', () => {
    for (const [name, drinks] of Object.entries(EVENINGS)) {
        for (const [who, user] of [
            ['average man', MALE_80KG],
            ['fast absorber', FAST_ABSORBER]
        ] as const) {
            test(`${name}, ${who}: 15 s and 60 s steps stay close to 1 s steps`, () => {
                for (const food of [0, 0.33, 1]) {
                    const reference = run(drinks, user, food, 1_000)
                    const referencePeak = reference.peak?.bacGdl ?? 0
                    const referenceSober = findSoberTime(drinks, SOBER_THRESHOLD_GDL, user, [], food, { stepMs: 1_000 })

                    for (const bound of BOUNDS) {
                        const result = run(drinks, user, food, bound.stepMs)
                        const peak = result.peak?.bacGdl ?? 0
                        expect(Math.abs(peak - referencePeak) / referencePeak).toBeLessThan(bound.peak)

                        for (const point of result.points) {
                            const exact = reference.points[(point.x - T0) / 1_000]
                            expect(Math.abs(point.y - exact.y)).toBeLessThan(bound.curve)
                        }

                        const sober = findSoberTime(drinks, SOBER_THRESHOLD_GDL, user, [], food, {
                            stepMs: bound.stepMs
                        })
                        expect(Math.abs(sober - referenceSober)).toBeLessThan(bound.soberMs)
                    }
                }
            })
        }
    }
})
