import { describe, expect, test } from 'bun:test'
import { bacAt, type Drink, type UserProfile } from '../src'
import { hrs, sippedDrink, T0 } from './fixtures'

/**
 * The only tests here that compare the model to measured people rather than to
 * itself or to another formula.
 *
 * Jones & Jönsson 1994 (J Forensic Sci 39:1084-93): 10 healthy men, 0.80 g/kg
 * after an overnight fast or immediately after breakfast, crossover.
 *   fasted peak 104 +/- 16.5 mg/dL      fed peak 67 +/- 9.5 mg/dL
 * The abstract gives neither body sizes nor drinking time, so the fixture uses
 * a 75 kg, 178 cm man drinking over 20 minutes.
 *
 * The bounds below are deliberately loose and symmetric: they record where the
 * model actually stands, so that changing a constant shows up as a movement
 * against real data instead of only against our own fixtures.
 */
describe('validation against measured human BAC', () => {
    const JONES_MAN: UserProfile = {
        sex: 'male',
        weightKg: 75,
        heightCm: 178,
        birthday: Date.UTC(1991, 0, 1),
        metabolicFactor: 1,
        kaMultiplier: 1,
        fpFactor: 1
    }
    const JONES_DOSE: Drink[] = [{ ...sippedDrink(T0, 20, 60) }]

    const peakOf = (foodLevel: number) => {
        let peak = 0
        for (let t = T0; t <= T0 + hrs(6); t += 30_000) {
            peak = Math.max(peak, bacAt(t, JONES_DOSE, JONES_MAN, [], foodLevel))
        }
        return peak
    }

    test('fasted peak is within 15% of the measured mean', () => {
        // The engine is 9.3% under the measured mean (see Limitations in docs/MODEL.md).
        const peak = peakOf(0)

        expect(peak).toBeGreaterThan(0.104 * 0.85)
        expect(peak).toBeLessThan(0.104 * 1.15)
    })

    test('fed peak is within 15% of the measured mean', () => {
        /**
         * The fed-state first-pass loss (FIRST_PASS_MAX) and elimination boost
         * (VMAX_FOOD_BOOST) were tuned against this fixture; the symmetric
         * bound keeps future constant changes honest against measured people
         * rather than against our own fixtures.
         */
        const peak = peakOf(1.0)

        expect(peak).toBeGreaterThan(0.067 * 0.85)
        expect(peak).toBeLessThan(0.067 * 1.15)
    })
})
