/** One drink: how much pure alcohol, and the window it was drunk over. */
export interface Drink {
    /** Grams of pure ethanol (milliliters x ABV x 0.789). */
    alcoholGrams: number

    /** When drinking started, Unix ms. */
    start: number

    /** When drinking finished, Unix ms. Windows shorter than a minute count as one minute. */
    end: number
}

/** The person the model is run for. */
export interface UserProfile {
    /** Selects the sex-specific Watson body-water equation. */
    sex: 'male' | 'female'

    weightKg: number

    heightCm: number

    /** Date of birth, Unix ms. Age enters the male Watson equation only. */
    birthday: number

    /** Multiplier on the maximum elimination rate (Vmax). 1 = population average, below 1 = slower. */
    metabolicFactor: number

    /** Multiplier on the absorption rate constant. 1 = baseline, above 1 = faster absorption. */
    kaMultiplier: number

    /** Multiplier on the fed-state first-pass loss. 1 = baseline, 0 = no first-pass loss. */
    fpFactor: number
}

/** A meal, which slows absorption and raises elimination while it digests. */
export interface MealEvent {
    /** When the meal was eaten, Unix ms. */
    timeMs: number

    /** Size of the meal on the 0-1 food-state scale (see MEAL_LEVEL). */
    level: number
}

/** One sample of a BAC curve: x is Unix ms, y is BAC in g/dL. */
export interface BacPoint {
    x: number
    y: number
}

export interface PeakBacResult {
    /** Peak BAC in g/dL. */
    bacGdl: number

    /** When the peak occurs, Unix ms. */
    timeMs: number
}
