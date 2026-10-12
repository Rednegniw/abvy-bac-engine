/**
 * Abvy's BAC engine: a one-compartment pharmacokinetic model of blood alcohol
 * concentration. Pure TypeScript with no runtime dependencies. See README.md
 * for usage and docs/MODEL.md for the model and its sources.
 */

export {
    BLOOD_WATER_FRACTION,
    DEFAULT_INITIAL_FOOD_LEVEL,
    EFFECTIVELY_ZERO_BAC_GDL,
    FAST_METABOLIZER_FACTOR,
    FIRST_PASS_MAX,
    FOOD_DECAY_LAMBDA,
    FP_FACTOR_BARIATRIC,
    FP_FACTOR_FEMALE,
    KA_EMPTY,
    KA_FULL,
    KA_MULTIPLIER_BARIATRIC,
    KA_MULTIPLIER_GLP1,
    KM,
    LIVER_CONDITION_CAP,
    MEAL_LEVEL,
    MIN_POUR_MS,
    SLOW_METABOLIZER_FACTOR,
    SOBER_THRESHOLD_GDL,
    SOBER_TIME_UNAVAILABLE,
    VMAX_BASE,
    VMAX_FOOD_BOOST
} from './constants'
export { calculateTBW, maxBacClearanceMs, watsonTbw } from './physiology'
export type { PerDrinkSeriesResult, SoberSearchOptions } from './queries'
export {
    bacAt,
    calculateTimeToNextDrink,
    calculateTimeWhenBelowThreshold,
    findPeakBac,
    findPeakBacInWindow,
    findPeakBacResult,
    findSoberTime,
    perDrinkSeries,
    series
} from './queries'
export type { BacPoint, Drink, MealEvent, PeakBacResult, UserProfile } from './types'
