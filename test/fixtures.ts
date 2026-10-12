import type { Drink, UserProfile } from '../src'

// 2025-01-01 18:00 UTC
export const T0 = Date.UTC(2025, 0, 1, 18, 0, 0)

export const MALE_80KG: UserProfile = {
    sex: 'male',
    weightKg: 80,
    heightCm: 180,
    // ~31 years old at T0
    birthday: Date.UTC(1994, 0, 1),
    metabolicFactor: 1.0,
    kaMultiplier: 1.0,
    fpFactor: 1
}

export const FEMALE_60KG: UserProfile = {
    sex: 'female',
    weightKg: 60,
    heightCm: 165,
    birthday: Date.UTC(1994, 0, 1),
    metabolicFactor: 1.0,
    kaMultiplier: 1.0,
    fpFactor: 1
}

/** One "standard drink" = 14g pure alcohol */
export function standardDrink(start: number): Drink {
    return { alcoholGrams: 14, start, end: start }
}

export function sippedDrink(start: number, durationMin: number, grams: number = 14): Drink {
    return {
        alcoholGrams: grams,
        start,
        end: start + durationMin * 60_000
    }
}

export const hrs = (h: number) => h * 3_600_000
