/**
 * Every model parameter lives here and nowhere else. Concentrations are grams
 * per liter of blood (g/L) inside the model; BAC outputs are g/dL (0.08 means
 * 0.08%). Sources and derivations are in docs/MODEL.md.
 *
 * Abvy's iOS widgets and Wear OS app run Swift and Kotlin ports of this
 * engine; differential tests in the app repository fail when a value here
 * drifts from those ports.
 */

export const MS_PER_HOUR = 3_600_000

// Distribution

/**
 * Water content of whole blood conventionally used in BAC estimation; converts
 * the body-water volume to the blood-equivalent volume of distribution.
 */
export const BLOOD_WATER_FRACTION = 0.806

// Elimination: Michaelis-Menten

/** Maximum elimination rate, g/L per hour, before the personal metabolicFactor. */
export const VMAX_BASE = 0.17

/** Michaelis constant, g/L: below it elimination slows from roughly constant to roughly proportional. */
export const KM = 0.05

// Absorption

/**
 * First-order absorption rate constants, per hour, on an empty and on a full
 * stomach; the food state F(t) interpolates linearly between them. KA_EMPTY
 * is the repeated-drinking fit of Lee et al. 2013, on the fast side of the
 * published fasted range (1-8 per hour); KA_FULL is close to the fed estimate
 * of Büsker et al. 2023 (1.45 per hour).
 */
export const KA_EMPTY = 4.6
export const KA_FULL = 1.5

/** Decay rate of the food state, per hour: ln(2) / 2, a 2-hour half-life. A modeling assumption. */
export const FOOD_DECAY_LAMBDA = 0.347

// Fed state

/**
 * At a full food state (F = 1), FIRST_PASS_MAX of the absorbed alcohol is
 * lost before it reaches the blood and Vmax rises by VMAX_FOOD_BOOST; both
 * scale linearly with F. The pair is calibrated to the fed arm of Jones &
 * Jönsson 1994 (see the validation tests). Measured first-pass metabolism is
 * disputed, so FIRST_PASS_MAX is best read as an empirical term.
 */
export const FIRST_PASS_MAX = 0.15
export const VMAX_FOOD_BOOST = 0.3

/** Food state contributed by each meal size, on the 0-1 scale. */
export const MEAL_LEVEL: Record<string, number> = {
    empty: 0,
    light: 0.33,
    moderate: 0.67,
    full: 1.0
}

/** Food state at the first drink when the caller does not provide one: a light meal. */
export const DEFAULT_INITIAL_FOOD_LEVEL = MEAL_LEVEL.light

// Personal modifiers, applied by the caller when building a UserProfile

/** fpFactor for women: between Frezza et al. 1990 (23% of men's first-pass) and Ammon et al. 1996 (no difference). */
export const FP_FACTOR_FEMALE = 0.8

/**
 * Bariatric surgery bypasses the stomach and speeds delivery to the small
 * intestine. Measured peaks after sleeve or bypass surgery are 1.3 to 2 times
 * higher; these presets understate that (see docs/MODEL.md).
 */
export const FP_FACTOR_BARIATRIC = 0
export const KA_MULTIPLIER_BARIATRIC = 1.5

/** kaMultiplier on GLP-1 receptor agonists, which slow gastric emptying. An assumption: no study measures it. */
export const KA_MULTIPLIER_GLP1 = 0.5

/** Upper bound on metabolicFactor for people who report a liver condition. A precaution, not a measured effect. */
export const LIVER_CONDITION_CAP = 0.85

// Uncertainty range

/**
 * The range shown around an estimate is the same evening replayed with
 * elimination at 80% (the upper, conservative edge) and 120% (the lower edge)
 * of the person's rate. It is a sensitivity band, not a confidence interval.
 */
export const SLOW_METABOLIZER_FACTOR = 0.8
export const FAST_METABOLIZER_FACTOR = 1.2

// Thresholds

/** BAC treated as "sober" when estimating the time to sober, g/dL. */
export const SOBER_THRESHOLD_GDL = 0.001

/**
 * BAC below which alcohol can be treated as fully cleared, g/dL. Tighter than
 * SOBER_THRESHOLD_GDL, so a "cleared" decision never fires while the sober time
 * from findSoberTime still lies ahead.
 */
export const EFFECTIVELY_ZERO_BAC_GDL = 0.0005

/** Returned by findSoberTime when no crossing can be proven within the search horizon. */
export const SOBER_TIME_UNAVAILABLE = -1

// Numerical settings

/**
 * Pours shorter than this are modeled as lasting this long, so every drink
 * enters the stomach at a finite rate.
 */
export const MIN_POUR_MS = 60_000

/**
 * Amounts of alcohol, in grams, below which a compartment is treated as
 * empty. At a typical 50 L volume of distribution, 1e-10 g is about 2e-13
 * g/dL, many orders of magnitude below any displayed digit.
 */
export const BLOOD_INERT_GRAMS = 1e-10
export const STOMACH_INERT_GRAMS = 1e-10

/**
 * The sober-time search first simulates this far past the last drink and
 * doubles the horizon until the curve provably crosses the threshold, up to
 * MAX_SOBER_SEARCH_MS. Typical evenings clear well inside the first pass.
 */
export const INITIAL_SOBER_SEARCH_MS = 12 * MS_PER_HOUR
export const MAX_SOBER_SEARCH_MS = 30 * 24 * MS_PER_HOUR

/** How far past the last drink findPeakBacResult looks, so slow absorption is still caught. */
export const PEAK_SEARCH_TAIL_MS = 6 * MS_PER_HOUR

/** How far ahead calculateTimeToNextDrink searches, and the precision it stops at. */
export const NEXT_DRINK_SEARCH_MS = 12 * MS_PER_HOUR
export const NEXT_DRINK_TOLERANCE_MS = 30_000
