import { describe, expect, test } from 'bun:test'
import { calculateTBW, maxBacClearanceMs, type UserProfile } from '../src'
import { FEMALE_60KG, MALE_80KG, T0 } from './fixtures'

describe('Watson TBW formula', () => {
    test('80kg male, 180cm, age ~31', () => {
        const tbw = calculateTBW(MALE_80KG, T0)
        // 2.447 - 0.09516*31 + 0.1074*180 + 0.3362*80 = 2.447 - 2.94996 + 19.332 + 26.896 = 45.725
        expect(tbw).toBeCloseTo(45.73, 0)
    })

    test('60kg female, 165cm', () => {
        const tbw = calculateTBW(FEMALE_60KG, T0)
        // -2.097 + 0.1069*165 + 0.2466*60 = -2.097 + 17.6385 + 14.796 = 30.3375
        expect(tbw).toBeCloseTo(30.34, 0)
    })

    test('female TBW does not depend on age', () => {
        const young: UserProfile = { ...FEMALE_60KG, birthday: Date.UTC(2000, 0, 1) }
        const old: UserProfile = { ...FEMALE_60KG, birthday: Date.UTC(1960, 0, 1) }
        expect(calculateTBW(young, T0)).toBeCloseTo(calculateTBW(old, T0), 5)
    })
})

describe('maxBacClearanceMs', () => {
    test('bounds clearance by the linear elimination rate plus a tail buffer', () => {
        // 6 g/L at Vmax 0.17 g/L/h is ~35.3h, plus the 6h tail buffer
        const expectedHours = 6 / 0.17 + 6
        expect(maxBacClearanceMs(MALE_80KG)).toBeCloseTo(expectedHours * 3_600_000, 0)
    })

    test('widens well past 72h for a pathologically slow calibrated profile', () => {
        const slow: UserProfile = { ...MALE_80KG, metabolicFactor: 0.08 }
        expect(maxBacClearanceMs(slow)).toBeGreaterThan(72 * 3_600_000)
    })
})
